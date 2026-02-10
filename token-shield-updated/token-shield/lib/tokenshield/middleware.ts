/**
 * TokenShield - Vercel AI SDK Middleware
 *
 * Implements LanguageModelV3Middleware to intercept every LLM call
 * made through the AI SDK (streamText, generateText, etc.) and
 * apply all TokenShield optimizations automatically.
 *
 * Usage:
 *   import { wrapLanguageModel } from 'ai'
 *   import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'
 *
 *   const model = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware: tokenShieldMiddleware({ ... }),
 *   })
 *
 *   // Use exactly like before -- all optimizations are automatic
 *   const result = await streamText({ model, messages })
 *
 * The middleware pipeline:
 *   1. transformParams: breaker -> user budget -> guard -> cache lookup -> context trim -> route -> prefix optimize
 *   2. wrapGenerate/wrapStream: cache return OR call model + record usage in ledger + record user budget spend
 */

import { countTokens } from "gpt-tokenizer"
import { fitToBudget, type Message } from "./context-manager"
import { ResponseCache } from "./response-cache"
import { analyzeComplexity, type ComplexityScore } from "./model-router"
import { RequestGuard } from "./request-guard"
import { optimizePrefix } from "./prefix-optimizer"
import { CostLedger } from "./cost-ledger"
import { MODEL_PRICING, estimateCost } from "./cost-estimator"
import { CostCircuitBreaker, type BreakerConfig } from "./circuit-breaker"
import { StreamTokenTracker } from "./stream-tracker"
import { UserBudgetManager, type UserBudgetConfig, type BudgetExceededEvent, type BudgetWarningEvent } from "./user-budget-manager"
import type { ChatMessage } from "./token-counter"

// -------------------------------------------------------
// Config
// -------------------------------------------------------

export interface TokenShieldMiddlewareConfig {
  /** Enable/disable each module individually */
  modules?: {
    guard?: boolean
    cache?: boolean
    context?: boolean
    router?: boolean
    prefix?: boolean
    ledger?: boolean
  }

  /** Request guard config */
  guard?: {
    debounceMs?: number
    maxRequestsPerMinute?: number
    maxCostPerHour?: number
  }

  /** Response cache config */
  cache?: {
    maxEntries?: number
    ttlMs?: number
    similarityThreshold?: number
    persist?: boolean
  }

  /** Context manager config */
  context?: {
    maxInputTokens?: number
    reserveForOutput?: number
  }

  /** Model router config */
  router?: {
    /** Model tiers from cheapest to most expensive */
    tiers?: { modelId: string; maxComplexity: number }[]
    /** Complexity threshold above which to keep the default model */
    complexityThreshold?: number
  }

  /** Prefix optimizer config */
  prefix?: {
    provider?: "openai" | "anthropic" | "google" | "auto"
  }

  /** Cost ledger config */
  ledger?: {
    persist?: boolean
    /** Optional feature tag attached to every entry */
    feature?: string
  }

  /**
   * Optional cost circuit breaker. If provided, requests exceeding the configured
   * limits will be blocked before the API call is made. The breaker tracks
   * spending across sessions or time windows and can warn, throttle or stop
   * requests when budgets are hit. See CostCircuitBreaker for details.
   */
  breaker?: BreakerConfig

  /**
   * Optional per-user budget management. When provided, each request is checked
   * against the user's daily/monthly limits before proceeding.
   * Requires a getUserId function to identify the current user.
   */
  userBudget?: {
    /** Function that returns the current user's ID */
    getUserId: () => string
    /** Budget configuration (users, defaultBudget, tierModels, etc.) */
    budgets: Omit<UserBudgetConfig, 'onBudgetExceeded' | 'onBudgetWarning'>
    /** Called when a user exceeds their budget */
    onBudgetExceeded?: (userId: string, event: BudgetExceededEvent) => void
    /** Called when a user approaches their budget (80%) */
    onBudgetWarning?: (userId: string, event: BudgetWarningEvent) => void
  }

  /** Called when a request is blocked by the guard */
  onBlocked?: (reason: string) => void
  /** Called with every ledger entry after a request completes */
  onUsage?: (entry: { model: string; inputTokens: number; outputTokens: number; cost: number; saved: number }) => void
}

// -------------------------------------------------------
// Middleware factory
// -------------------------------------------------------

/**
 * Metadata key used to pass data from transformParams to wrapGenerate.
 * This avoids globals and is safe for concurrent requests.
 */
const SHIELD_META = Symbol("tokenshield")

/** Per-message token overhead: 4 structural tokens + ~1 role token (see token-counter.ts) */
const MSG_OVERHEAD_TOKENS = 5

interface ShieldMeta {
  cacheHit?: {
    response: string
    inputTokens: number
    outputTokens: number
  }
  originalInputTokens?: number
  originalModel?: string
  contextSaved?: number
  routerSaved?: number
  prefixSaved?: number
  complexity?: ComplexityScore
  /** User ID for per-user budget tracking */
  userId?: string
  /** Estimated cost reserved as in-flight during budget check */
  userBudgetInflight?: number
  /** True when user budget tier routing was applied — prevents complexity router from overriding */
  tierRouted?: boolean
}

/** AI SDK prompt type used internally for type-safe extraction */
type AISDKPrompt = Array<{ role: string; content: Array<{ type: string; text?: string }> }>

/**
 * Extract the last user message text from an AI SDK prompt array.
 * Centralizes the repeated pattern of filtering for user role, extracting
 * text parts, and joining them — previously duplicated 4+ times.
 */
function extractLastUserText(params: Record<string, unknown>): string {
  const prompt = params.prompt as AISDKPrompt | undefined
  if (!prompt || !Array.isArray(prompt)) return ""
  const lastUserMsg = prompt.filter((m) => m.role === "user").pop()
  return lastUserMsg?.content
    ?.filter((p: { type: string }) => p.type === "text")
    .map((p: { text?: string }) => p.text ?? "")
    .join("") ?? ""
}

/**
 * Create the TokenShield middleware.
 *
 * Returns a LanguageModelV3Middleware-compatible object that can be
 * passed directly to wrapLanguageModel().
 */
export function tokenShieldMiddleware(config: TokenShieldMiddlewareConfig = {}) {
  const modules = {
    guard: true,
    cache: true,
    context: true,
    router: false, // opt-in: requires tier config
    prefix: true,
    ledger: true,
    ...config.modules,
  }

  // Initialize singleton instances
  const guard = modules.guard
    ? new RequestGuard({
        debounceMs: config.guard?.debounceMs ?? 300,
        maxRequestsPerMinute: config.guard?.maxRequestsPerMinute ?? 60,
        maxCostPerHour: config.guard?.maxCostPerHour ?? 10,
        modelId: "gpt-4o-mini",
      })
    : null

  const cache = modules.cache
    ? new ResponseCache({
        maxEntries: config.cache?.maxEntries ?? 500,
        ttlMs: config.cache?.ttlMs ?? 3600000,
        similarityThreshold: config.cache?.similarityThreshold ?? 0.85,
      })
    : null

  const ledger = modules.ledger ? new CostLedger({ persist: config.ledger?.persist }) : null

  // Create a cost circuit breaker if configured
  const breaker = config.breaker ? new CostCircuitBreaker(config.breaker) : null

  // Create a per-user budget manager if configured
  const userBudgetManager = config.userBudget
    ? new UserBudgetManager({
        ...config.userBudget.budgets,
        onBudgetExceeded: config.userBudget.onBudgetExceeded
          ? (userId, event) => config.userBudget!.onBudgetExceeded!(userId, event)
          : undefined,
        onBudgetWarning: config.userBudget.onBudgetWarning
          ? (userId, event) => config.userBudget!.onBudgetWarning!(userId, event)
          : undefined,
      })
    : null

  // Hydrate persisted budget data from IndexedDB
  if (userBudgetManager && config.userBudget?.budgets.persist) {
    userBudgetManager.hydrate().catch(() => {
      // Hydration failed silently — budget starts from $0
    })
  }

  // Expose ledger for external access (e.g., useCostLedger hook)
  const middleware = {
    /** Access the cost ledger for reading savings data */
    ledger,
    /** Access the response cache for stats */
    cache,
    /** Access the request guard for stats */
    guard,
    /** Access the per-user budget manager */
    userBudgetManager,

    /**
     * transformParams runs BEFORE the model receives the request.
     * This is where we intercept and optimize.
     */
    transformParams: async ({ params }: { params: Record<string, unknown> }) => {
      const meta: ShieldMeta = {}
      const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }> | undefined

      if (!prompt || !Array.isArray(prompt)) {
        return params
      }

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

      // -- 0. BREAKER CHECK --
      if (breaker && lastUserText) {
        // Estimate input tokens for the user text only. If context trimming is enabled, the
        // budget may be lower, but this provides a conservative estimate.
        const estimatedInput = countTokens(lastUserText)
        // Use reserved output tokens if context manager is enabled; otherwise default to 500
        const expectedOut = config.context?.reserveForOutput ?? 500
        const modelId = String(params.modelId ?? "")
        const breakCheck = breaker.check(modelId, estimatedInput, expectedOut)
        if (!breakCheck.allowed) {
          config.onBlocked?.(breakCheck.reason ?? "Budget exceeded")
          throw new TokenShieldBlockedError(breakCheck.reason ?? "Request blocked by TokenShield breaker")
        }
      }

      // -- 0b. USER BUDGET CHECK --
      if (userBudgetManager && config.userBudget) {
        let userId: string
        try {
          userId = config.userBudget.getUserId()
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error"
          throw new TokenShieldBlockedError(`Failed to resolve user ID: ${msg}`)
        }
        if (!userId || typeof userId !== "string") {
          throw new TokenShieldBlockedError("getUserId() must return a non-empty string")
        }
        meta.userId = userId
        const modelId = String(params.modelId ?? "")
        const estimatedInput = lastUserText ? countTokens(lastUserText) : 0
        const expectedOut = config.context?.reserveForOutput ?? 500
        const budgetCheck = userBudgetManager.check(userId, modelId, estimatedInput, expectedOut)
        if (!budgetCheck.allowed) {
          config.onBlocked?.(budgetCheck.reason ?? "User budget exceeded")
          throw new TokenShieldBlockedError(budgetCheck.reason ?? "Request blocked by user budget limit")
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
          // Compute savings from tier-based model routing
          try {
            const origCost = estimateCost(String(params.modelId), estimatedInput, expectedOut)
            const tierCost = estimateCost(tierModel, estimatedInput, expectedOut)
            meta.routerSaved = Math.max(0, origCost.totalCost - tierCost.totalCost)
          } catch {
            // Unknown model — can't compute savings
          }
          if (!meta.originalModel) meta.originalModel = String(params.modelId)
          params = { ...params, modelId: tierModel }
          meta.tierRouted = true
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
            config.onBlocked?.(check.reason ?? "Request blocked")
            throw new TokenShieldBlockedError(check.reason ?? "Request blocked by TokenShield guard")
          }
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
            // Attach meta to params for wrapGenerate to use
            ;(params as Record<string | symbol, unknown>)[SHIELD_META] = meta
            return params // wrapGenerate will short-circuit
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
        const budget = {
          maxContextTokens: config.context.maxInputTokens + (config.context.reserveForOutput ?? 1000),
          reservedForOutput: config.context.reserveForOutput ?? 1000,
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
        }
      }

      // -- 4. MODEL ROUTER (skipped when tier routing already applied a budget-enforced model) --
      if (modules.router && !meta.tierRouted && config.router?.tiers && config.router.tiers.length > 0 && lastUserText) {
        const complexity = analyzeComplexity(lastUserText)
        meta.complexity = complexity
        const threshold = config.router.complexityThreshold ?? 50

        if (complexity.score < threshold) {
          // Route to cheapest tier that fits
          const cheapestTier = config.router.tiers
            .filter((t) => complexity.score <= t.maxComplexity)
            .sort((a, b) => {
              const pa = MODEL_PRICING[a.modelId]
              const pb = MODEL_PRICING[b.modelId]
              if (!pa || !pb) return 0
              return pa.inputPerMillion - pb.inputPerMillion
            })[0]

          if (cheapestTier && cheapestTier.modelId !== params.modelId) {
            // Compute savings from complexity-based model routing
            const beforeRoutingModel = String(params.modelId)
            try {
              const origCost = estimateCost(beforeRoutingModel, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
              const cheaperCost = estimateCost(cheapestTier.modelId, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
              meta.routerSaved = (meta.routerSaved ?? 0) + Math.max(0, origCost.totalCost - cheaperCost.totalCost)
            } catch {
              // Unknown model — can't compute savings
            }
            if (!meta.originalModel) meta.originalModel = beforeRoutingModel
            params = { ...params, modelId: cheapestTier.modelId }
          }
        }
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
            { provider: config.prefix?.provider ?? "auto" }
          )
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
      return { ...params, prompt: rebuiltPrompt }
    },

    /**
     * wrapGenerate runs AROUND the actual model call.
     * If cache hit, return cached result. Otherwise, call the model
     * and record usage in the ledger.
     */
    wrapGenerate: async ({ doGenerate, params }: { doGenerate: () => Promise<Record<string, unknown>>; params: Record<string, unknown> }) => {
      const meta = (params as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta | undefined

      // Cache hit: return cached response without calling the model
      if (meta?.cacheHit) {
        const modelId = String(params.modelId ?? "")

        // Release in-flight reservation — no API call will happen
        if (userBudgetManager && meta.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }

        if (ledger) {
          await ledger.recordCacheHit({
            model: modelId,
            savedInputTokens: meta.cacheHit.inputTokens,
            savedOutputTokens: meta.cacheHit.outputTokens,
            feature: config.ledger?.feature,
          })
        }

        // Compute dollar savings for the cache hit (consistent units: dollars)
        let cacheHitSavedDollars = 0
        try {
          cacheHitSavedDollars = estimateCost(modelId, meta.cacheHit.inputTokens, meta.cacheHit.outputTokens).totalCost
        } catch {
          // Unknown model — can't estimate dollar savings
        }

        config.onUsage?.({
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          saved: cacheHitSavedDollars,
        })

        return {
          text: meta.cacheHit.response,
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: "stop",
        }
      }

      // Call the real model
      const startTime = Date.now()
      let result: Record<string, unknown>
      try {
        result = await doGenerate()
      } catch (err) {
        // Release in-flight budget reservation on API failure
        if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }
        throw err
      }
      const latencyMs = Date.now() - startTime

      // Extract usage from result
      const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined
      const inputTokens = usage?.promptTokens ?? 0
      const outputTokens = usage?.completionTokens ?? 0
      const modelId = String(params.modelId ?? "")
      const responseText = String(result.text ?? "")

      // Store in cache for future requests (fire-and-forget to avoid blocking response)
      if (cache && responseText) {
        const cachedUserText = extractLastUserText(params)
        if (cachedUserText) {
          cache.store(cachedUserText, responseText, modelId, inputTokens, outputTokens).catch(() => {})
        }
      }

      // Compute per-request savings (needed for both ledger and onUsage)
      const contextSavedDollars = meta?.contextSaved
        ? (meta.contextSaved / 1_000_000) * (MODEL_PRICING[modelId]?.inputPerMillion ?? 2.5)
        : 0
      const routerSavedDollars = meta?.routerSaved ?? 0
      const prefixSavedDollars = meta?.prefixSaved ?? 0

      // Record in ledger
      if (ledger) {
        await ledger.record({
          model: modelId,
          inputTokens,
          outputTokens,
          savings: {
            context: contextSavedDollars,
            router: routerSavedDollars,
            prefix: prefixSavedDollars,
          },
          originalInputTokens: meta?.originalInputTokens,
          originalModel: meta?.originalModel,
          feature: config.ledger?.feature,
          latencyMs,
        })
      }

      // Compute cost once for all downstream consumers (onUsage, breaker, userBudget)
      let perRequestCost = 0
      try {
        perRequestCost = estimateCost(modelId, inputTokens, outputTokens).totalCost
      } catch {
        // Unknown model — cost stays 0
      }
      const perRequestSaved = contextSavedDollars + routerSavedDollars + prefixSavedDollars

      config.onUsage?.({
        model: modelId,
        inputTokens,
        outputTokens,
        cost: perRequestCost,
        saved: perRequestSaved,
      })

      // Complete the guard request tracking (pass actual model for accurate cost logging)
      if (guard) {
        const guardUserText = extractLastUserText(params)
        if (guardUserText) {
          guard.completeRequest(guardUserText, inputTokens, outputTokens, modelId)
        }
      }

      // Record spending in circuit breaker
      if (breaker && perRequestCost > 0) {
        breaker.recordSpend(perRequestCost, modelId)
      }

      // Record spending in per-user budget manager
      // (recordSpend handles cost=0 correctly: releases inflight, skips record creation)
      if (userBudgetManager && meta?.userId) {
        await userBudgetManager.recordSpend(meta.userId, perRequestCost, modelId, meta.userBudgetInflight)
          .catch(() => { /* IDB write failed — inflight already released synchronously */ })
      }

      return result
    },

    /**
     * wrapStream runs AROUND streaming model calls (streamText).
     * If cache hit, return a simulated stream. Otherwise, call the model,
     * pipe chunks through a StreamTokenTracker so token usage is counted
     * in real time, and record usage in the ledger when the stream ends
     * (or is aborted).
     */
    wrapStream: async ({ doStream, params }: { doStream: () => Promise<Record<string, unknown>>; params: Record<string, unknown> }) => {
      const meta = (params as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta | undefined

      // Cache hit: return a simulated stream without calling the model
      if (meta?.cacheHit) {
        const modelId = String(params.modelId ?? "")

        // Release in-flight reservation — no API call will happen
        if (userBudgetManager && meta.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }

        if (ledger) {
          await ledger.recordCacheHit({
            model: modelId,
            savedInputTokens: meta.cacheHit.inputTokens,
            savedOutputTokens: meta.cacheHit.outputTokens,
            feature: config.ledger?.feature,
          })
        }

        // Compute dollar savings for the cache hit (consistent units: dollars)
        let streamCacheHitSavedDollars = 0
        try {
          streamCacheHitSavedDollars = estimateCost(modelId, meta.cacheHit.inputTokens, meta.cacheHit.outputTokens).totalCost
        } catch {
          // Unknown model — can't estimate dollar savings
        }

        config.onUsage?.({
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          saved: streamCacheHitSavedDollars,
        })

        // Create a ReadableStream that emits the cached response as a single chunk
        const cachedText = meta.cacheHit.response
        const simulatedStream = new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", textDelta: cachedText })
            controller.close()
          },
        })

        return {
          stream: simulatedStream,
          usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
          finishReason: Promise.resolve("stop"),
        }
      }

      // Call the real model's stream
      const startTime = Date.now()
      let result: Record<string, unknown>
      try {
        result = await doStream()
      } catch (err) {
        // Release in-flight budget reservation on stream init failure
        if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }
        throw err
      }

      const modelId = String(params.modelId ?? "")
      const tracker = new StreamTokenTracker({ modelId })

      // Set known input tokens from meta if available
      if (meta?.originalInputTokens) {
        tracker.setInputTokens(meta.originalInputTokens)
      }

      const originalStream = result.stream as ReadableStream

      // Helper to record usage in ledger and breaker after streaming ends
      const recordStreamUsage = (usage: { inputTokens: number; outputTokens: number }) => {
        const latencyMs = Date.now() - startTime

        // Store in cache for future requests (fire-and-forget)
        if (cache) {
          const cachedUserText = extractLastUserText(params)
          const responseText = tracker.getText()
          if (cachedUserText && responseText) {
            cache.store(cachedUserText, responseText, modelId, usage.inputTokens, usage.outputTokens).catch(() => {})
          }
        }

        // Compute per-request savings (needed for both ledger and onUsage)
        const contextSavedDollars = meta?.contextSaved
          ? (meta.contextSaved / 1_000_000) * (MODEL_PRICING[modelId]?.inputPerMillion ?? 2.5)
          : 0
        const routerSavedDollars = meta?.routerSaved ?? 0
        const prefixSavedDollars = meta?.prefixSaved ?? 0

        // Record in ledger (fire-and-forget)
        if (ledger) {
          ledger.record({
            model: modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            savings: {
              context: contextSavedDollars,
              router: routerSavedDollars,
              prefix: prefixSavedDollars,
            },
            originalInputTokens: meta?.originalInputTokens,
            originalModel: meta?.originalModel,
            feature: config.ledger?.feature,
            latencyMs,
          }).catch(() => {})
        }

        // Compute cost once for all downstream consumers (onUsage, breaker, userBudget)
        let streamPerRequestCost = 0
        try {
          streamPerRequestCost = estimateCost(modelId, usage.inputTokens, usage.outputTokens).totalCost
        } catch {
          // Unknown model — cost stays 0
        }
        const streamPerRequestSaved = contextSavedDollars + routerSavedDollars + prefixSavedDollars

        config.onUsage?.({
          model: modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: streamPerRequestCost,
          saved: streamPerRequestSaved,
        })

        // Complete guard request tracking (pass actual model for accurate cost logging)
        if (guard) {
          const guardUserText = extractLastUserText(params)
          if (guardUserText) {
            guard.completeRequest(guardUserText, usage.inputTokens, usage.outputTokens, modelId)
          }
        }

        // Record spending in circuit breaker
        if (breaker && streamPerRequestCost > 0) {
          breaker.recordSpend(streamPerRequestCost, modelId)
        }

        // Record spending in per-user budget manager (fire-and-forget with .catch)
        // (recordSpend handles cost=0 correctly: releases inflight, skips record creation)
        if (userBudgetManager && meta?.userId) {
          userBudgetManager.recordSpend(meta.userId, streamPerRequestCost, modelId, meta.userBudgetInflight)
            .catch(() => { /* IDB write failed — inflight already released synchronously */ })
        }
      }

      // Guard flag to prevent double-recording when cancel() fires while
      // a pending pull() read is still in-flight (both paths would call
      // recordStreamUsage, leading to double billing).
      let usageRecorded = false
      const recordStreamUsageOnce = (usage: { inputTokens: number; outputTokens: number }) => {
        if (usageRecorded) return
        usageRecorded = true
        recordStreamUsage(usage)
      }

      // Create a ReadableStream that reads from the original, pipes chunks
      // through the tracker, and handles both normal completion and abort.
      const reader = originalStream.getReader()
      let streamCancelled = false
      const monitoredStream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done || streamCancelled) {
              // Stream completed normally (or cancel fired while read was pending)
              const usage = tracker.finish()
              recordStreamUsageOnce(usage)
              try { controller.close() } catch { /* already closed by cancel */ }
              return
            }

            // Track text-delta chunks for token counting
            const c = value as Record<string, unknown>
            if (c && c.type === "text-delta" && typeof c.textDelta === "string") {
              tracker.addChunk(c.textDelta)
            }

            try { controller.enqueue(value) } catch { /* stream cancelled mid-read */ }
          } catch (err) {
            // Stream errored -- still record what we have
            const usage = tracker.abort()
            recordStreamUsageOnce(usage)
            try { controller.error(err) } catch { /* already closed/errored */ }
          }
        },
        cancel() {
          // Stream was aborted by the consumer (e.g., user clicked "Stop generating")
          streamCancelled = true
          reader.cancel()
          const usage = tracker.abort()
          recordStreamUsageOnce(usage)
        },
      })

      return { ...result, stream: monitoredStream }
    },
  }

  return middleware
}

/**
 * Custom error thrown when the request guard blocks a request.
 * Callers can catch this specifically to show user-friendly messages.
 */
export class TokenShieldBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TokenShieldBlockedError"
  }
}

/**
 * Convenience: get the cost ledger from a middleware instance.
 */
export function getLedger(middleware: ReturnType<typeof tokenShieldMiddleware>): CostLedger | null {
  return middleware.ledger
}
