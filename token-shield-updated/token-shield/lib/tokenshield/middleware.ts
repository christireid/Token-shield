/**
 * TokenShield - AI SDK Middleware (Framework-Agnostic)
 *
 * Core middleware pipeline that intercepts LLM calls and applies all
 * TokenShield optimizations automatically. Compatible with:
 *
 *   - Vercel AI SDK (via wrapLanguageModel)
 *   - Plain OpenAI SDK (via createOpenAIAdapter)
 *   - Anthropic SDK (via createAnthropicAdapter)
 *   - Any framework (via createGenericAdapter)
 *
 * Vercel AI SDK usage:
 *   import { wrapLanguageModel } from 'ai'
 *   import { tokenShieldMiddleware } from 'tokenshield'
 *
 *   const model = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware: tokenShieldMiddleware({ ... }),
 *   })
 *   const result = await streamText({ model, messages })
 *
 * Generic adapter usage:
 *   import { tokenShieldMiddleware, createGenericAdapter } from 'tokenshield'
 *
 *   const shield = tokenShieldMiddleware({ ... })
 *   const protectedCall = createGenericAdapter(shield, myModelCallFn)
 *   const result = await protectedCall({ model: 'gpt-4o', messages: [...] })
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
import { TokenShieldConfigSchema } from "./config-schemas"
import { TokenShieldConfigError, TokenShieldBlockedError, ERROR_CODES } from "./errors"
import * as v from "valibot"
import { shieldEvents } from "./event-bus"
import { TokenShieldLogger, createLogger, type LogEntry, type LoggerConfig } from "./logger"
import { ProviderAdapter, type AdapterConfig } from "./provider-adapter"

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

  /** Optional logger for structured observability */
  logger?: TokenShieldLogger | { level?: 'debug' | 'info' | 'warn' | 'error'; handler?: (entry: LogEntry) => void; enableSpans?: boolean }

  /** Optional multi-provider adapter for routing, retries, and health tracking */
  providerAdapter?: ProviderAdapter | AdapterConfig
}

// -------------------------------------------------------
// Return type
// -------------------------------------------------------

/**
 * The shape returned by tokenShieldMiddleware().
 * Compatible with Vercel AI SDK's LanguageModelV3Middleware, but also
 * usable standalone via the framework adapters or pipeline API.
 */
export interface TokenShieldMiddleware {
  /** Access the cost ledger for reading savings data */
  ledger: CostLedger | null
  /** Access the response cache for stats */
  cache: ResponseCache | null
  /** Access the request guard for stats */
  guard: RequestGuard | null
  /** Access the per-user budget manager */
  userBudgetManager: UserBudgetManager | null
  /** Access the event bus for subscribing to events */
  events: typeof shieldEvents
  /** Access the logger for span/event data */
  logger: TokenShieldLogger | null
  /** Access the provider adapter for health data */
  providerAdapter: ProviderAdapter | null
  /** Pre-model transform — runs breaker, budget, guard, cache, context, router, prefix */
  transformParams: (args: { params: Record<string, unknown> }) => Promise<Record<string, unknown>>
  /** Wraps non-streaming model calls with caching, ledger, budget tracking */
  wrapGenerate: (args: { doGenerate: () => Promise<Record<string, unknown>>; params: Record<string, unknown> }) => Promise<Record<string, unknown>>
  /** Wraps streaming model calls with token tracking, caching, budget accounting */
  wrapStream: (args: { doStream: () => Promise<Record<string, unknown>>; params: Record<string, unknown> }) => Promise<Record<string, unknown>>
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
  /** Cached last user text to avoid redundant extraction in wrapGenerate/wrapStream */
  lastUserText?: string
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
 * Safe cost estimation helper. Returns 0 if the model is unknown.
 */
function safeCost(modelId: string, inputTokens: number, outputTokens: number): number {
  try {
    return estimateCost(modelId, inputTokens, outputTokens).totalCost
  } catch {
    return 0
  }
}

/**
 * Create the TokenShield middleware.
 *
 * Returns a LanguageModelV3Middleware-compatible object that can be
 * passed directly to wrapLanguageModel().
 */
export function tokenShieldMiddleware(config: TokenShieldMiddlewareConfig = {}): TokenShieldMiddleware {
  // Validate config against valibot schema (catches typos, wrong types, out-of-range values)
  try {
    // Extract the schema-validatable subset (excludes functions like getUserId, onBlocked, onUsage)
    const schemaInput: Record<string, unknown> = {}
    if (config.modules) schemaInput.modules = config.modules
    if (config.guard) schemaInput.guard = config.guard
    if (config.cache) schemaInput.cache = config.cache
    if (config.context) schemaInput.context = config.context
    if (config.router) schemaInput.router = config.router
    if (config.prefix) schemaInput.prefix = config.prefix
    if (config.ledger) schemaInput.ledger = config.ledger
    if (config.breaker) schemaInput.breaker = config.breaker
    if (config.userBudget?.budgets) schemaInput.userBudget = config.userBudget.budgets
    v.parse(TokenShieldConfigSchema, schemaInput)
  } catch (err) {
    if (err instanceof v.ValiError) {
      const path = err.issues?.[0]?.path?.map((p: { key: string | number }) => p.key).join(".") ?? "unknown"
      throw new TokenShieldConfigError(`Invalid config at "${path}": ${err.message}`, path)
    }
    throw err
  }

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

  // Initialize logger if configured
  const log: TokenShieldLogger | null =
    config.logger instanceof TokenShieldLogger
      ? config.logger
      : config.logger
        ? createLogger(config.logger as { level?: 'debug' | 'info' | 'warn' | 'error'; handler?: (entry: LogEntry) => void; enableSpans?: boolean })
        : null

  // Auto-connect logger to the event bus for structured observability
  // Store cleanup function to prevent listener leaks
  let disconnectLogger: (() => void) | null = null
  if (log) {
    disconnectLogger = log.connectEventBus(shieldEvents)
  }

  // Initialize provider adapter if configured
  const adapter: ProviderAdapter | null =
    config.providerAdapter instanceof ProviderAdapter
      ? config.providerAdapter
      : config.providerAdapter
        ? new ProviderAdapter(config.providerAdapter as AdapterConfig)
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
    /** Access the event bus for subscribing to events */
    events: shieldEvents,
    /** Access the logger for span/event data */
    logger: log,
    /** Access the provider adapter for health data */
    providerAdapter: adapter,

    /**
     * transformParams runs BEFORE the model receives the request.
     * This is where we intercept and optimize.
     */
    transformParams: async ({ params }: { params: Record<string, unknown> }) => {
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
            const estCost = safeCost(modelId, estimatedInput, expectedOut)
            try { shieldEvents.emit('request:blocked', { reason: breakCheck.reason ?? "Budget exceeded", estimatedCost: estCost }) } catch { /* non-fatal */ }
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
            // budgetCheck.status already has real spend/limit data — the exceeded event
            // was already emitted by userBudgetManager.check() with correct data
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
            // Compute savings from tier-based model routing
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
              shieldEvents.emit('router:downgraded', {
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
              try { shieldEvents.emit('request:blocked', { reason: check.reason ?? "Request blocked", estimatedCost: estCost }) } catch { /* non-fatal */ }
              config.onBlocked?.(check.reason ?? "Request blocked")
              throw new TokenShieldBlockedError(check.reason ?? "Request blocked by TokenShield guard", ERROR_CODES.GUARD_RATE_LIMIT)
            }
            // Guard passed
            try { shieldEvents.emit('request:allowed', { prompt: lastUserText, model: guardModelId }) } catch { /* non-fatal */ }
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
                shieldEvents.emit('cache:hit', {
                  matchType: lookup.matchType ?? 'fuzzy',
                  similarity: lookup.similarity ?? 1,
                  savedCost,
                })
              } catch { /* non-fatal */ }
              // Attach meta to params for wrapGenerate to use
              ;(params as Record<string | symbol, unknown>)[SHIELD_META] = meta
              span?.end({ cacheHit: true, contextSaved: 0 })
              return params // wrapGenerate will short-circuit
            } else {
              try { shieldEvents.emit('cache:miss', { prompt: lastUserText }) } catch { /* non-fatal */ }
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
            try {
              shieldEvents.emit('context:trimmed', {
                originalTokens: originalInputTokens,
                trimmedTokens: originalInputTokens - trimResult.evictedTokens,
                savedTokens: trimResult.evictedTokens,
              })
            } catch { /* non-fatal */ }
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
              let complexitySaved = 0
              try {
                const origCost = estimateCost(beforeRoutingModel, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
                const cheaperCost = estimateCost(cheapestTier.modelId, meta.originalInputTokens ?? 0, config.context?.reserveForOutput ?? 500)
                complexitySaved = Math.max(0, origCost.totalCost - cheaperCost.totalCost)
                meta.routerSaved = (meta.routerSaved ?? 0) + complexitySaved
              } catch {
                // Unknown model — can't compute savings
              }
              if (!meta.originalModel) meta.originalModel = beforeRoutingModel
              params = { ...params, modelId: cheapestTier.modelId }

              try {
                shieldEvents.emit('router:downgraded', {
                  originalModel: beforeRoutingModel,
                  selectedModel: cheapestTier.modelId,
                  complexity: complexity.score,
                  savedCost: complexitySaved,
                })
              } catch { /* non-fatal */ }
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
        span?.end({ cacheHit: !!meta.cacheHit, contextSaved: meta.contextSaved ?? 0 })
        return { ...params, prompt: rebuiltPrompt }
      } catch (err) {
        span?.end({ error: true })
        throw err
      }
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
        const cacheHitSavedDollars = safeCost(modelId, meta.cacheHit.inputTokens, meta.cacheHit.outputTokens)

        // cache:hit event already emitted by transformParams — no duplicate here

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
      const modelId = String(params.modelId ?? "")
      const startTime = Date.now()
      let result: Record<string, unknown>
      try {
        result = await doGenerate()
      } catch (err) {
        // Release in-flight budget reservation on API failure
        if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }
        // Record failure in provider adapter
        if (adapter) {
          const provider = adapter.getProviderForModel(modelId)
          if (provider) {
            try { adapter.recordFailure(provider, err instanceof Error ? err.message : String(err)) } catch { /* non-fatal */ }
          }
        }
        throw err
      }
      const latencyMs = Date.now() - startTime

      // Record success in provider adapter
      if (adapter) {
        const provider = adapter.getProviderForModel(modelId)
        if (provider) {
          try { adapter.recordSuccess(provider, latencyMs) } catch { /* non-fatal */ }
        }
      }

      // Extract usage from result
      const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined
      const inputTokens = usage?.promptTokens ?? 0
      const outputTokens = usage?.completionTokens ?? 0
      const responseText = String(result.text ?? "")

      // Store in cache for future requests (fire-and-forget to avoid blocking response)
      if (cache && responseText) {
        const cachedUserText = meta?.lastUserText ?? extractLastUserText(params)
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
      const perRequestCost = safeCost(modelId, inputTokens, outputTokens)
      const perRequestSaved = contextSavedDollars + routerSavedDollars + prefixSavedDollars

      try {
        shieldEvents.emit('ledger:entry', {
          model: modelId,
          inputTokens,
          outputTokens,
          cost: perRequestCost,
          saved: perRequestSaved,
        })
      } catch { /* non-fatal */ }

      config.onUsage?.({
        model: modelId,
        inputTokens,
        outputTokens,
        cost: perRequestCost,
        saved: perRequestSaved,
      })

      // Complete the guard request tracking (pass actual model for accurate cost logging)
      if (guard) {
        const guardUserText = meta?.lastUserText ?? extractLastUserText(params)
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
      // Note: recordSpend() internally emits userBudget:spend — no duplicate here
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
        const streamCacheHitSavedDollars = safeCost(modelId, meta.cacheHit.inputTokens, meta.cacheHit.outputTokens)

        // cache:hit event already emitted by transformParams — no duplicate here

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
      const modelId = String(params.modelId ?? "")
      const startTime = Date.now()
      let result: Record<string, unknown>
      try {
        result = await doStream()
      } catch (err) {
        // Release in-flight budget reservation on stream init failure
        if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
          userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
        }
        // Record failure in provider adapter
        if (adapter) {
          const provider = adapter.getProviderForModel(modelId)
          if (provider) {
            try { adapter.recordFailure(provider, err instanceof Error ? err.message : String(err)) } catch { /* non-fatal */ }
          }
        }
        throw err
      }
      const streamLatencyMs = Date.now() - startTime

      // Record stream establishment success in provider adapter
      if (adapter) {
        const provider = adapter.getProviderForModel(modelId)
        if (provider) {
          try { adapter.recordSuccess(provider, streamLatencyMs) } catch { /* non-fatal */ }
        }
      }

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
          const cachedUserText = meta?.lastUserText ?? extractLastUserText(params)
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
        const streamPerRequestCost = safeCost(modelId, usage.inputTokens, usage.outputTokens)
        const streamPerRequestSaved = contextSavedDollars + routerSavedDollars + prefixSavedDollars

        try {
          shieldEvents.emit('ledger:entry', {
            model: modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cost: streamPerRequestCost,
            saved: streamPerRequestSaved,
          })
        } catch { /* non-fatal */ }

        config.onUsage?.({
          model: modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: streamPerRequestCost,
          saved: streamPerRequestSaved,
        })

        // Complete guard request tracking (pass actual model for accurate cost logging)
        if (guard) {
          const guardUserText = meta?.lastUserText ?? extractLastUserText(params)
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
        // Note: recordSpend() internally emits userBudget:spend — no duplicate here
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
        try {
          recordStreamUsage(usage)
        } catch {
          // recordStreamUsage threw — swallow to prevent stream corruption
        }
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

              // Emit stream:complete event
              try {
                shieldEvents.emit('stream:complete', {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
                })
              } catch { /* non-fatal */ }

              try { controller.close() } catch { /* already closed by cancel */ }
              return
            }

            // Track text-delta chunks for token counting
            const c = value as Record<string, unknown>
            if (c && c.type === "text-delta" && typeof c.textDelta === "string") {
              tracker.addChunk(c.textDelta)

              // Emit stream:chunk event
              try {
                const chunkUsage = tracker.getUsage()
                shieldEvents.emit('stream:chunk', {
                  outputTokens: chunkUsage.outputTokens,
                  estimatedCost: chunkUsage.estimatedCost,
                })
              } catch { /* non-fatal */ }
            }

            try { controller.enqueue(value) } catch { /* stream cancelled mid-read */ }
          } catch (err) {
            // Stream errored -- still record what we have
            const usage = tracker.abort()
            recordStreamUsageOnce(usage)

            // Emit stream:abort on stream error
            try {
              shieldEvents.emit('stream:abort', {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                estimatedCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
              })
            } catch { /* non-fatal */ }

            try { controller.error(err) } catch { /* already closed/errored */ }
          }
        },
        cancel() {
          // Stream was aborted by the consumer (e.g., user clicked "Stop generating")
          streamCancelled = true
          reader.cancel()
          const usage = tracker.abort()
          recordStreamUsageOnce(usage)

          // Emit stream:abort event
          try {
            shieldEvents.emit('stream:abort', {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              estimatedCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
            })
          } catch { /* non-fatal */ }
        },
      })

      return { ...result, stream: monitoredStream }
    },
  }

  return middleware
}

// TokenShieldBlockedError is now imported from ./errors and re-exported for backward compatibility
export { TokenShieldBlockedError } from "./errors"

/**
 * Convenience: get the cost ledger from a middleware instance.
 */
export function getLedger(middleware: ReturnType<typeof tokenShieldMiddleware>): CostLedger | null {
  return middleware.ledger
}
