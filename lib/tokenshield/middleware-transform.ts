/**
 * TokenShield Middleware - Transform Params Pipeline
 *
 * Builds the transformParams function that runs BEFORE the model receives
 * the request. This is where all pre-model optimizations happen:
 * breaker -> user budget -> guard -> cache lookup -> context trim -> route -> prefix optimize
 */

import { countTokens } from "gpt-tokenizer"
import { fitToBudget, type Message } from "./context-manager"
import { analyzeComplexity, routeToModel } from "./model-router"
import { optimizePrefix } from "./prefix-optimizer"
import { MODEL_PRICING, estimateCost } from "./cost-estimator"
import { countToolTokens, predictOutputTokens, type ToolDefinition } from "./tool-token-counter"
import type { ChatMessage } from "./token-counter"
import { TokenShieldBlockedError, ERROR_CODES } from "./errors"
import {
  SHIELD_META,
  MSG_OVERHEAD_TOKENS,
  safeCost,
  type MiddlewareContext,
  type ShieldMeta,
} from "./middleware-types"

/**
 * Build the transformParams function for the middleware pipeline.
 * Captures the initialized module instances via the context object.
 */
export function buildTransformParams(ctx: MiddlewareContext) {
  const { config, modules, guard, cache, breaker, userBudgetManager, anomalyDetector, instanceEvents, log, adapter } = ctx

  return async ({ params }: { params: Record<string, unknown> }) => {
    const meta: ShieldMeta = {}
    const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }> | undefined

    // Start a logger span around the entire transformParams pipeline
    const span = log?.startSpan('transformParams', { modelId: String(params.modelId ?? '') })

    if (!prompt || !Array.isArray(prompt)) {
      span?.end()
      return params
    }

    try {
      // Extract text content from AI SDK prompt format
      const messages: ChatMessage[] = prompt.map((msg) => ({
        role: msg.role as ChatMessage["role"],
        content: Array.isArray(msg.content)
          ? msg.content
              .filter((p: { type: string }) => p.type === "text")
              .map((p: { text?: string }) => p.text ?? "")
              .join("")
          : String(msg.content ?? ""),
      }))

      const lastUserMessage = messages.filter((m) => m.role === "user").pop()
      const lastUserText = lastUserMessage?.content ?? ""
      meta.lastUserText = lastUserText

      // -- DRY-RUN MODE: simulate pipeline without modifying params --
      // Uses side-effect-free read-only probes (cache.peek, guard.stats)
      // so that dry-run doesn't pollute rate-limit state or cache access counts.
      if (config.dryRun) {
        const modelId = String(params.modelId ?? "")
        const inputTokens = messages.reduce((sum, m) => sum + countTokens(m.content) + MSG_OVERHEAD_TOKENS, 0)
        const expectedOut = config.context?.reserveForOutput ?? 500
        const estimatedCost = safeCost(modelId, inputTokens, expectedOut)

        // Breaker dry-run check
        if (breaker && lastUserText) {
          const breakStatus = breaker.getStatus()
          const wouldTrip = breakStatus.tripped ||
            (breakStatus.currentSpend !== undefined && config.breaker?.limits?.perHour !== undefined &&
              (breakStatus.currentSpend + estimatedCost) > config.breaker.limits.perHour)
          config.onDryRun?.({
            module: 'breaker',
            description: wouldTrip
              ? `Would be blocked (spend: $${breakStatus.currentSpend?.toFixed(4) ?? '?'}, est cost: $${estimatedCost.toFixed(4)})`
              : `Would pass breaker (spend: $${breakStatus.currentSpend?.toFixed(4) ?? '0'})`,
          })
        }

        // User budget dry-run check
        if (userBudgetManager && config.userBudget) {
          try {
            const userId = config.userBudget.getUserId()
            if (userId) {
              const status = userBudgetManager.getStatus(userId)
              const wouldExceedDaily = status.limits?.daily ? (status.spend.daily + estimatedCost) >= status.limits.daily : false
              const wouldExceedMonthly = status.limits?.monthly ? (status.spend.monthly + estimatedCost) >= status.limits.monthly : false
              config.onDryRun?.({
                module: 'userBudget',
                description: wouldExceedDaily
                  ? `User ${userId} would exceed daily budget ($${status.spend.daily.toFixed(4)}/$${status.limits?.daily?.toFixed(2)})`
                  : wouldExceedMonthly
                    ? `User ${userId} would exceed monthly budget ($${status.spend.monthly.toFixed(4)}/$${status.limits?.monthly?.toFixed(2)})`
                    : `User ${userId} within budget (daily: $${status.spend.daily.toFixed(4)}, monthly: $${status.spend.monthly.toFixed(4)})`,
              })
            }
          } catch { /* getUserId failed — skip */ }
        }

        if (guard && lastUserText) {
          const stats = guard.getStats()
          const wouldDebounce = Date.now() - (stats.lastRequestTime ?? 0) < (config.guard?.debounceMs ?? 300)
          const wouldRateLimit = (stats.requestsLastMinute ?? 0) >= (config.guard?.maxRequestsPerMinute ?? 60)
          const description = wouldDebounce ? 'Request would be debounced' : wouldRateLimit ? 'Request would be rate-limited' : 'Request would pass guard'
          config.onDryRun?.({ module: 'guard', description })
        }
        if (cache && lastUserText) {
          const peek = cache.peek(lastUserText, modelId)
          config.onDryRun?.({ module: 'cache', description: peek.hit ? `Cache ${peek.matchType} hit (similarity: ${peek.similarity?.toFixed(2)})` : 'Cache miss', estimatedSavings: peek.hit ? safeCost(modelId, peek.entry!.inputTokens, peek.entry!.outputTokens) : 0 })
        }
        if (modules.context && config.context?.maxInputTokens) {
          const overBudget = inputTokens > config.context.maxInputTokens
          config.onDryRun?.({ module: 'context', description: overBudget ? `Would trim ${inputTokens - config.context.maxInputTokens} tokens` : `Within budget (${inputTokens}/${config.context.maxInputTokens})` })
        }
        if (modules.router && lastUserText) {
          // Check complexity even if tiers not configured
          const complexity = analyzeComplexity(lastUserText)
          config.onDryRun?.({ module: 'router', description: `Complexity: ${complexity.score}/100 (${complexity.tier}). Recommended tier: ${complexity.recommendedTier}` })
        }
        if (modules.prefix) {
          const pricing = MODEL_PRICING[modelId]
          if (pricing) {
            const optimized = optimizePrefix(messages, modelId, pricing.inputPerMillion, { provider: config.prefix?.provider ?? "auto" })
            config.onDryRun?.({ module: 'prefix', description: `Prefix: ${optimized.prefixTokens} tokens (${optimized.prefixEligibleForCaching ? 'eligible' : 'not eligible'} for caching)`, estimatedSavings: optimized.estimatedPrefixSavings })
          }
        }

        // Anomaly dry-run check
        if (anomalyDetector) {
          const anomaly = anomalyDetector.check(estimatedCost, inputTokens + expectedOut)
          config.onDryRun?.({
            module: 'anomaly',
            description: anomaly
              ? `Anomaly detected: ${anomaly.type} (z-score: ${anomaly.zScore.toFixed(2)}, value: ${anomaly.value.toFixed(4)}, mean: ${anomaly.mean.toFixed(4)})`
              : 'No anomaly detected',
          })
        }

        span?.end({ dryRun: true })
        ;(params as Record<string | symbol, unknown>)[SHIELD_META] = meta
        return params // Pass through unchanged
      }

      // -- 0. BREAKER CHECK --
      if (breaker && lastUserText) {
        const estimatedInput = countTokens(lastUserText)
        const expectedOut = config.context?.reserveForOutput ?? 500
        const modelId = String(params.modelId ?? "")
        const breakCheck = breaker.check(modelId, estimatedInput, expectedOut)
        if (!breakCheck.allowed) {
          const estCost = safeCost(modelId, estimatedInput, expectedOut)
          try { instanceEvents.emit('request:blocked', { reason: breakCheck.reason ?? "Budget exceeded", estimatedCost: estCost }) } catch { /* non-fatal */ }
          config.onBlocked?.(breakCheck.reason ?? "Budget exceeded")
          throw new TokenShieldBlockedError(breakCheck.reason ?? "Request blocked by TokenShield breaker", ERROR_CODES.BREAKER_SESSION_LIMIT)
        }
      }

      // -- 0b. USER BUDGET CHECK --
      if (userBudgetManager && config.userBudget) {
        let userId: string
        try {
          userId = config.userBudget.getUserId()
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error"
          throw new TokenShieldBlockedError(`Failed to resolve user ID: ${msg}`, ERROR_CODES.BUDGET_USER_ID_INVALID)
        }
        if (!userId || typeof userId !== "string") {
          throw new TokenShieldBlockedError("getUserId() must return a non-empty string", ERROR_CODES.BUDGET_USER_ID_INVALID)
        }
        meta.userId = userId
        const modelId = String(params.modelId ?? "")
        const estimatedInput = lastUserText ? countTokens(lastUserText) : 0
        const expectedOut = config.context?.reserveForOutput ?? 500
        const budgetCheck = userBudgetManager.check(userId, modelId, estimatedInput, expectedOut)
        if (!budgetCheck.allowed) {
          config.onBlocked?.(budgetCheck.reason ?? "User budget exceeded")
          throw new TokenShieldBlockedError(
            budgetCheck.reason ?? "Request blocked by user budget limit",
            budgetCheck.status.spend.daily >= (budgetCheck.status.limits?.daily ?? Infinity)
              ? ERROR_CODES.BUDGET_DAILY_EXCEEDED
              : ERROR_CODES.BUDGET_MONTHLY_EXCEEDED
          )
        }

        // Store the estimated cost that was reserved as in-flight
        try {
          meta.userBudgetInflight = estimateCost(modelId, estimatedInput, expectedOut).totalCost
        } catch {
          meta.userBudgetInflight = 0
        }

        // Apply model tier routing if configured
        const tierModel = userBudgetManager.getModelForUser(userId)
        if (tierModel && tierModel !== params.modelId) {
          const originalModelId = String(params.modelId)
          let tierSaved = 0
          try {
            const origCost = estimateCost(originalModelId, estimatedInput, expectedOut)
            const tierCost = estimateCost(tierModel, estimatedInput, expectedOut)
            tierSaved = Math.max(0, origCost.totalCost - tierCost.totalCost)
            meta.routerSaved = tierSaved
          } catch {
            // Unknown model — can't compute savings
          }
          if (!meta.originalModel) meta.originalModel = originalModelId
          params = { ...params, modelId: tierModel }
          meta.tierRouted = true

          try {
            instanceEvents.emit('router:downgraded', {
              originalModel: originalModelId,
              selectedModel: tierModel,
              complexity: 0,
              savedCost: tierSaved,
            })
          } catch { /* non-fatal */ }
        }
      }

      // Wrap guard + cache in try-catch so in-flight budget reservations
      // are released if either step throws (prevents phantom accumulation).
      try {
        // -- 1. GUARD CHECK --
        if (guard && lastUserText) {
          const guardModelId = String(params.modelId ?? "")
          const check = guard.check(lastUserText, undefined, guardModelId || undefined)
          if (!check.allowed) {
            const estCost = safeCost(guardModelId, countTokens(lastUserText), config.context?.reserveForOutput ?? 500)
            try { instanceEvents.emit('request:blocked', { reason: check.reason ?? "Request blocked", estimatedCost: estCost }) } catch { /* non-fatal */ }
            config.onBlocked?.(check.reason ?? "Request blocked")
            throw new TokenShieldBlockedError(check.reason ?? "Request blocked by TokenShield guard", ERROR_CODES.GUARD_RATE_LIMIT)
          }
          try { instanceEvents.emit('request:allowed', { prompt: lastUserText, model: guardModelId }) } catch { /* non-fatal */ }
        }

        // -- 2. CACHE LOOKUP --
        if (cache && lastUserText) {
          const modelId = String(params.modelId ?? "")
          const lookup = await cache.lookup(lastUserText, modelId)
          if (lookup.hit && lookup.entry) {
            meta.cacheHit = {
              response: lookup.entry.response,
              inputTokens: lookup.entry.inputTokens,
              outputTokens: lookup.entry.outputTokens,
            }
            const savedCost = safeCost(modelId, lookup.entry.inputTokens, lookup.entry.outputTokens)
            try {
              instanceEvents.emit('cache:hit', {
                matchType: lookup.matchType ?? 'fuzzy',
                similarity: lookup.similarity ?? 1,
                savedCost,
              })
            } catch { /* non-fatal */ }
            ;(params as Record<string | symbol, unknown>)[SHIELD_META] = meta
            span?.end({ cacheHit: true, contextSaved: 0 })
            return params // wrapGenerate will short-circuit
          } else {
            try { instanceEvents.emit('cache:miss', { prompt: lastUserText }) } catch { /* non-fatal */ }
          }
        }
      } catch (err) {
        // Release in-flight budget reservation if guard/cache throws
        if (userBudgetManager && meta.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }
        throw err
      }

      const originalInputTokens = messages.reduce((sum, m) => sum + countTokens(m.content) + MSG_OVERHEAD_TOKENS, 0)
      meta.originalInputTokens = originalInputTokens
      if (!meta.originalModel) meta.originalModel = String(params.modelId ?? "")

      let workingMessages = messages

      // -- 3. CONTEXT TRIM --
      if (modules.context && config.context?.maxInputTokens) {
        // Account for tool definition token overhead
        let toolTokenOverhead = 0
        const tools = (params as Record<string, unknown>).tools as ToolDefinition[] | undefined
        if (tools && Array.isArray(tools) && tools.length > 0) {
          try {
            toolTokenOverhead = countToolTokens(tools).totalTokens
          } catch { /* non-fatal: tool counting failed, proceed without overhead */ }
        }

        // Use output prediction to dynamically estimate reserved output tokens
        let reserveForOutput = config.context.reserveForOutput ?? 1000
        if (!config.context.reserveForOutput && lastUserText) {
          try {
            const prediction = predictOutputTokens(lastUserText)
            if (prediction.confidence !== "low") {
              reserveForOutput = prediction.suggestedMaxTokens
            }
          } catch { /* non-fatal: fall back to default */ }
        }

        const budget = {
          maxContextTokens: config.context.maxInputTokens + reserveForOutput - toolTokenOverhead,
          reservedForOutput: reserveForOutput,
        }
        const trimResult = fitToBudget(
          workingMessages.map((m) => ({ ...m } as Message)),
          budget
        )
        if (trimResult.evictedTokens > 0) {
          meta.contextSaved = trimResult.evictedTokens
          workingMessages = trimResult.messages.map((m) => ({
            role: m.role,
            content: m.content,
          }))
          try {
            instanceEvents.emit('context:trimmed', {
              originalTokens: originalInputTokens,
              trimmedTokens: originalInputTokens - trimResult.evictedTokens,
              savedTokens: trimResult.evictedTokens,
              })
          } catch { /* non-fatal */ }
        }
      }

      // -- 4. MODEL ROUTER (skipped when tier routing already applied a budget-enforced model) --
      if (config.routerOverride && lastUserText) {
        const overrideModel = config.routerOverride(lastUserText)
        if (overrideModel && overrideModel !== params.modelId) {
          if (!meta.originalModel) meta.originalModel = String(params.modelId)
          params = { ...params, modelId: overrideModel }
          try {
            instanceEvents.emit('router:downgraded', {
              originalModel: meta.originalModel,
              selectedModel: overrideModel,
              complexity: 0,
              savedCost: 0,
            })
          } catch { /* non-fatal */ }
        }
      } else if (modules.router && !meta.tierRouted && lastUserText) {
        // A/B test holdback: skip routing for a fraction of requests
        const holdback = config.router?.abTestHoldback ?? 0
        if (holdback > 0 && Math.random() < holdback) {
          meta.abTestHoldout = true
          try {
            instanceEvents.emit('router:holdback', {
              model: String(params.modelId),
              holdbackRate: holdback,
            })
          } catch { /* non-fatal */ }
        } else {
          // Smart Routing Logic
          const complexity = analyzeComplexity(lastUserText)
          meta.complexity = complexity
          
          let selectedModelId = String(params.modelId)
          let complexitySaved = 0

          // Strategy 1: User-defined tiers
          if (config.router?.tiers && config.router.tiers.length > 0) {
            const threshold = config.router.complexityThreshold ?? 50
            if (complexity.score < threshold) {
              const cheapestTier = config.router.tiers
                .filter((t) => complexity.score <= t.maxComplexity)
                .sort((a, b) => {
                  const pa = MODEL_PRICING[a.modelId]
                  const pb = MODEL_PRICING[b.modelId]
                  if (!pa || !pb) return 0
                  return pa.inputPerMillion - pb.inputPerMillion
                })[0]

              if (cheapestTier) {
                selectedModelId = cheapestTier.modelId
              }
            }
          } 
          // Strategy 2: Automatic Smart Routing (routeToModel)
          else {
            // If no custom tiers, use built-in smart routing
            const decision = routeToModel(lastUserText, String(params.modelId), {
                expectedOutputTokens: config.context?.reserveForOutput ?? 500
            })
            // Only switch if we found a cheaper model that is suitable
            if (decision.selectedModel.id !== params.modelId) {
                selectedModelId = decision.selectedModel.id
            }
          }

          // Apply switch if model changed
          if (selectedModelId !== params.modelId) {
            const originalModelId = String(params.modelId)
            try {
              const origCost = estimateCost(originalModelId, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
              const newCost = estimateCost(selectedModelId, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
              complexitySaved = Math.max(0, origCost.totalCost - newCost.totalCost)
              meta.routerSaved = (meta.routerSaved ?? 0) + complexitySaved
            } catch {
              // Unknown model — can't compute savings
            }
            
            if (!meta.originalModel) meta.originalModel = originalModelId
            params = { ...params, modelId: selectedModelId }

            try {
              instanceEvents.emit('router:downgraded', {
                originalModel: originalModelId,
                selectedModel: selectedModelId,
                complexity: complexity.score,
                savedCost: complexitySaved,
              })
            } catch { /* non-fatal */ }
          }
        } // end holdback else
      }

      // -- 5. PREFIX OPTIMIZE --
      if (modules.prefix) {
        const modelId = String(params.modelId ?? "")
        const pricing = MODEL_PRICING[modelId]
        if (pricing) {
          const optimized = optimizePrefix(
            workingMessages,
            modelId,
            pricing.inputPerMillion,
            {
              provider: config.prefix?.provider ?? "auto",
              contextWindow: pricing.contextWindow,
              reservedOutputTokens: config.context?.reserveForOutput ?? 500,
            }
          )
          if (optimized.contextWindowExceeded) {
            try {
              instanceEvents.emit('context:trimmed', {
                originalTokens: optimized.prefixTokens + optimized.volatileTokens,
                trimmedTokens: optimized.prefixTokens + optimized.volatileTokens,
                savedTokens: 0,
              })
            } catch { /* non-fatal */ }
            log?.warn('prefix', 'Total tokens exceed context window', {
              total: optimized.prefixTokens + optimized.volatileTokens,
              contextWindow: pricing.contextWindow,
              overflow: optimized.overflowTokens,
            })
          }
          if (optimized.estimatedPrefixSavings > 0) {
            meta.prefixSaved = optimized.estimatedPrefixSavings
            workingMessages = optimized.messages
          }
        }
      }

      // Rebuild the prompt in AI SDK format
      const rebuiltPrompt = workingMessages.map((msg) => ({
        role: msg.role,
        content: [{ type: "text" as const, text: msg.content }],
      }))

      ;(params as Record<string | symbol, unknown>)[SHIELD_META] = meta
      span?.end({ cacheHit: !!meta.cacheHit, contextSaved: meta.contextSaved ?? 0 })
      return { ...params, prompt: rebuiltPrompt }
    } catch (err) {
      span?.end({ error: true })
      throw err
    }
  }
}
