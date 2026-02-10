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
 *   1. transformParams: guard -> cache lookup -> context trim -> route -> prefix optimize
 *   2. wrapGenerate: cache return OR call model + record usage in ledger
 */

import { countTokens } from "gpt-tokenizer"
import { fitToBudget, type Message } from "./context-manager"
import { ResponseCache } from "./response-cache"
import { analyzeComplexity, type ComplexityScore } from "./model-router"
import { RequestGuard } from "./request-guard"
import { optimizePrefix, detectProvider } from "./prefix-optimizer"
import { CostLedger } from "./cost-ledger"
import { MODEL_PRICING, estimateCost } from "./cost-estimator"
import { CostCircuitBreaker, type BreakerConfig } from "./circuit-breaker"
import { StreamTokenTracker } from "./stream-tracker"
import { UserBudgetManager, type UserBudgetConfig } from "./user-budget-manager"
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
    onBudgetExceeded?: (userId: string, event: { limitType: string; currentSpend: number; limit: number }) => void
    /** Called when a user approaches their budget (80%) */
    onBudgetWarning?: (userId: string, event: { limitType: string; currentSpend: number; limit: number; percentUsed: number }) => void
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
        const userId = config.userBudget.getUserId()
        meta.userId = userId
        const modelId = String(params.modelId ?? "")
        const estimatedInput = lastUserText ? countTokens(lastUserText) : 0
        const expectedOut = config.context?.reserveForOutput ?? 500
        const budgetCheck = userBudgetManager.check(userId, modelId, estimatedInput, expectedOut)
        if (!budgetCheck.allowed) {
          config.onBlocked?.(budgetCheck.reason ?? "User budget exceeded")
          throw new TokenShieldBlockedError(budgetCheck.reason ?? "Request blocked by user budget limit")
        }

        // Apply model tier routing if configured
        const tierModel = userBudgetManager.getModelForUser(userId)
        if (tierModel && tierModel !== params.modelId) {
          meta.originalModel = String(params.modelId)
          params = { ...params, modelId: tierModel }
        }
      }

      // -- 1. GUARD CHECK --
      if (guard && lastUserText) {
        const check = guard.check(lastUserText)
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

      const originalInputTokens = messages.reduce((sum, m) => sum + countTokens(m.content) + 5, 0)
      meta.originalInputTokens = originalInputTokens
      meta.originalModel = String(params.modelId ?? "")

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

      // -- 4. MODEL ROUTER --
      if (modules.router && config.router?.tiers && config.router.tiers.length > 0 && lastUserText) {
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
            meta.originalModel = String(params.modelId)
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
        if (ledger) {
          await ledger.recordCacheHit({
            model: modelId,
            savedInputTokens: meta.cacheHit.inputTokens,
            savedOutputTokens: meta.cacheHit.outputTokens,
            feature: config.ledger?.feature,
          })
        }

        config.onUsage?.({
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          saved: meta.cacheHit.inputTokens + meta.cacheHit.outputTokens,
        })

        return {
          text: meta.cacheHit.response,
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: "stop",
        }
      }

      // Call the real model
      const startTime = Date.now()
      const result = await doGenerate()
      const latencyMs = Date.now() - startTime

      // Extract usage from result
      const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined
      const inputTokens = usage?.promptTokens ?? 0
      const outputTokens = usage?.completionTokens ?? 0
      const modelId = String(params.modelId ?? "")
      const responseText = String(result.text ?? "")

      // Store in cache for future requests
      if (cache && responseText) {
        const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>
        const lastUserMsg = prompt?.filter((m) => m.role === "user").pop()
        const lastUserText = lastUserMsg?.content
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("") ?? ""

        if (lastUserText) {
          await cache.store(lastUserText, responseText, modelId, inputTokens, outputTokens)
        }
      }

      // Record in ledger
      if (ledger) {
        const contextSavedDollars = meta?.contextSaved
          ? (meta.contextSaved / 1_000_000) * (MODEL_PRICING[modelId]?.inputPerMillion ?? 2.5)
          : 0
        const routerSavedDollars = meta?.routerSaved ?? 0
        const prefixSavedDollars = meta?.prefixSaved ?? 0

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

        const entry = ledger.getSummary()
        config.onUsage?.({
          model: modelId,
          inputTokens,
          outputTokens,
          cost: entry.avgCostPerCall,
          saved: entry.totalSaved,
        })
      }

      // Complete the guard request tracking
      if (guard) {
        const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>
        const lastUserMsg = prompt?.filter((m) => m.role === "user").pop()
        const lastUserText = lastUserMsg?.content
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("") ?? ""
        if (lastUserText) {
          guard.completeRequest(lastUserText, inputTokens, outputTokens)
        }
      }

      // Record spending in circuit breaker
      if (breaker) {
        try {
          const costEst = estimateCost(modelId, inputTokens, outputTokens)
          breaker.recordSpend(costEst.totalCost, modelId)
        } catch {
          // If estimate fails (unknown model), ignore
        }
      }

      // Record spending in per-user budget manager
      if (userBudgetManager && meta?.userId) {
        try {
          const costEst = estimateCost(modelId, inputTokens, outputTokens)
          await userBudgetManager.recordSpend(meta.userId, costEst.totalCost, modelId)
        } catch {
          // If estimate fails (unknown model), ignore
        }
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
        if (ledger) {
          await ledger.recordCacheHit({
            model: modelId,
            savedInputTokens: meta.cacheHit.inputTokens,
            savedOutputTokens: meta.cacheHit.outputTokens,
            feature: config.ledger?.feature,
          })
        }

        config.onUsage?.({
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          saved: meta.cacheHit.inputTokens + meta.cacheHit.outputTokens,
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
      const result = await doStream()

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

        // Store in cache for future requests
        if (cache) {
          const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>
          const lastUserMsg = prompt?.filter((m) => m.role === "user").pop()
          const lastUserText = lastUserMsg?.content
            ?.filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("") ?? ""
          const responseText = tracker.getText()

          if (lastUserText && responseText) {
            cache.store(lastUserText, responseText, modelId, usage.inputTokens, usage.outputTokens)
          }
        }

        // Record in ledger
        if (ledger) {
          const contextSavedDollars = meta?.contextSaved
            ? (meta.contextSaved / 1_000_000) * (MODEL_PRICING[modelId]?.inputPerMillion ?? 2.5)
            : 0
          const routerSavedDollars = meta?.routerSaved ?? 0
          const prefixSavedDollars = meta?.prefixSaved ?? 0

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
          })

          const entry = ledger.getSummary()
          config.onUsage?.({
            model: modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost: entry.avgCostPerCall,
            saved: entry.totalSaved,
          })
        }

        // Complete guard request tracking
        if (guard) {
          const prompt = params.prompt as Array<{ role: string; content: Array<{ type: string; text?: string }> }>
          const lastUserMsg = prompt?.filter((m) => m.role === "user").pop()
          const lastUserText = lastUserMsg?.content
            ?.filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("") ?? ""
          if (lastUserText) {
            guard.completeRequest(lastUserText, usage.inputTokens, usage.outputTokens)
          }
        }

        // Record spending in circuit breaker
        if (breaker) {
          try {
            const costEst = estimateCost(modelId, usage.inputTokens, usage.outputTokens)
            breaker.recordSpend(costEst.totalCost, modelId)
          } catch {
            // If estimate fails (unknown model), ignore
          }
        }

        // Record spending in per-user budget manager
        if (userBudgetManager && meta?.userId) {
          try {
            const costEst = estimateCost(modelId, usage.inputTokens, usage.outputTokens)
            userBudgetManager.recordSpend(meta.userId, costEst.totalCost, modelId)
          } catch {
            // If estimate fails (unknown model), ignore
          }
        }
      }

      // Create a ReadableStream that reads from the original, pipes chunks
      // through the tracker, and handles both normal completion and abort.
      const reader = originalStream.getReader()
      const monitoredStream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read()
            if (done) {
              // Stream completed normally
              const usage = tracker.finish()
              recordStreamUsage(usage)
              controller.close()
              return
            }

            // Track text-delta chunks for token counting
            const c = value as Record<string, unknown>
            if (c && c.type === "text-delta" && typeof c.textDelta === "string") {
              tracker.addChunk(c.textDelta)
            }

            controller.enqueue(value)
          } catch (err) {
            // Stream errored -- still record what we have
            const usage = tracker.abort()
            recordStreamUsage(usage)
            controller.error(err)
          }
        },
        cancel() {
          // Stream was aborted by the consumer (e.g., user clicked "Stop generating")
          reader.cancel()
          const usage = tracker.abort()
          recordStreamUsage(usage)
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
