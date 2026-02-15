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

import { ResponseCache } from "./response-cache"
import { RequestGuard } from "./request-guard"
import { CostLedger } from "./cost-ledger"
import { CostCircuitBreaker } from "./circuit-breaker"
import { UserBudgetManager } from "./user-budget-manager"
import { AnomalyDetector } from "./anomaly-detector"
import { TokenShieldConfigSchema } from "./config-schemas"
import { TokenShieldConfigError } from "./errors"
import * as v from "valibot"
import {
  shieldEvents,
  createEventBus,
  subscribeToAnyEvent,
  type TokenShieldEvents,
} from "./event-bus"
import { TokenShieldLogger, createLogger, type LogEntry } from "./logger"
import { ProviderAdapter, type AdapterConfig } from "./provider-adapter"

import type {
  TokenShieldMiddlewareConfig,
  TokenShieldMiddleware,
  MiddlewareContext,
  HealthCheckResult,
} from "./middleware-types"
import { buildTransformParams } from "./middleware-transform"
import { buildWrapGenerate, buildWrapStream } from "./middleware-wrap"

// Re-export types from middleware-types so existing import paths continue to work
export type {
  TokenShieldMiddlewareConfig,
  TokenShieldMiddleware,
  HealthCheckResult,
} from "./middleware-types"

/**
 * Create the TokenShield middleware.
 *
 * Returns a LanguageModelV3Middleware-compatible object that can be
 * passed directly to wrapLanguageModel().
 */
export function tokenShieldMiddleware(
  config: TokenShieldMiddlewareConfig = {},
): TokenShieldMiddleware {
  // Validate config against valibot schema (catches typos, wrong types, out-of-range values)
  try {
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
      const path =
        err.issues?.[0]?.path?.map((p: { key: string | number }) => p.key).join(".") ?? "unknown"
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
    anomaly: true,
    ...config.modules,
  }

  // Initialize singleton instances
  const guard = modules.guard
    ? new RequestGuard({
        debounceMs: config.guard?.debounceMs ?? 300,
        maxRequestsPerMinute: config.guard?.maxRequestsPerMinute ?? 60,
        maxCostPerHour: config.guard?.maxCostPerHour ?? 10,
        deduplicateWindow: config.guard?.deduplicateWindow ?? 0,
        modelId: "gpt-4o-mini",
      })
    : null

  const cache = modules.cache
    ? new ResponseCache({
        maxEntries: config.cache?.maxEntries ?? 500,
        ttlMs: config.cache?.ttlMs ?? 3600000,
        similarityThreshold: config.cache?.similarityThreshold ?? 0.85,
        encodingStrategy: config.cache?.encodingStrategy,
        semanticSeeds: config.cache?.semanticSeeds,
      })
    : null

  const ledger = modules.ledger ? new CostLedger({ persist: config.ledger?.persist }) : null

  const breaker = config.breaker ? new CostCircuitBreaker(config.breaker) : null

  const userBudgetManager = config.userBudget
    ? new UserBudgetManager({
        ...config.userBudget.budgets,
        onBudgetExceeded: config.userBudget.onBudgetExceeded
          ? (userId, event) => config.userBudget?.onBudgetExceeded?.(userId, event)
          : undefined,
        onBudgetWarning: config.userBudget.onBudgetWarning
          ? (userId, event) => config.userBudget?.onBudgetWarning?.(userId, event)
          : undefined,
      })
    : null

  const anomalyDetector = modules.anomaly ? new AnomalyDetector(config.anomaly) : null

  // Create a per-instance event bus so that multiple middleware instances
  // don't mix events. Forward all events to the global shieldEvents singleton
  // for backward compatibility with listeners on the module-level bus.
  const instanceEvents = createEventBus()
  const EVENT_NAMES: (keyof TokenShieldEvents)[] = [
    "request:blocked",
    "request:allowed",
    "cache:hit",
    "cache:miss",
    "cache:store",
    "context:trimmed",
    "router:downgraded",
    "router:holdback",
    "ledger:entry",
    "breaker:warning",
    "breaker:tripped",
    "userBudget:warning",
    "userBudget:exceeded",
    "userBudget:spend",
    "stream:chunk",
    "stream:abort",
    "stream:complete",
    "anomaly:detected",
  ]
  const forwardingCleanups: Array<() => void> = []
  for (const name of EVENT_NAMES) {
    const cleanup = subscribeToAnyEvent(instanceEvents, name, (data) => {
      try {
        ;(shieldEvents.emit as (type: string, data: unknown) => void)(name, data)
      } catch {
        /* non-fatal */
      }
    })
    forwardingCleanups.push(cleanup)
  }

  // Initialize logger if configured
  const log: TokenShieldLogger | null =
    config.logger instanceof TokenShieldLogger
      ? config.logger
      : config.logger
        ? createLogger(
            config.logger as {
              level?: "debug" | "info" | "warn" | "error"
              handler?: (entry: LogEntry) => void
              enableSpans?: boolean
            },
          )
        : null

  // Auto-connect logger to the event bus for structured observability
  let loggerCleanup: (() => void) | null = null
  if (log) {
    loggerCleanup = log.connectEventBus(instanceEvents)
  }

  // Hydrate persisted budget data from IndexedDB (after logger init so failures are logged)
  if (userBudgetManager && config.userBudget?.budgets.persist) {
    userBudgetManager.hydrate().catch((err) => {
      log?.warn("budget", "Failed to hydrate budget data — starting from $0", {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }

  // Initialize provider adapter if configured
  const adapter: ProviderAdapter | null =
    config.providerAdapter instanceof ProviderAdapter
      ? config.providerAdapter
      : config.providerAdapter
        ? new ProviderAdapter(config.providerAdapter as AdapterConfig)
        : null

  // Build the shared context for pipeline builders
  const ctx: MiddlewareContext = {
    config,
    modules,
    guard,
    cache,
    ledger,
    breaker,
    userBudgetManager,
    anomalyDetector,
    instanceEvents,
    log,
    adapter,
  }

  return {
    ledger,
    cache,
    guard,
    userBudgetManager,
    anomalyDetector,
    events: instanceEvents,
    logger: log,
    providerAdapter: adapter,
    transformParams: buildTransformParams(ctx),
    wrapGenerate: buildWrapGenerate(ctx),
    wrapStream: buildWrapStream(ctx),
    healthCheck(): HealthCheckResult {
      const cacheStats = cache?.stats() ?? null
      const guardStats = guard?.stats() ?? null
      const breakerStatus = breaker?.getStatus() ?? null
      const ledgerSummary = ledger?.getSummary() ?? null

      return {
        healthy: !(breakerStatus?.tripped ?? false),
        modules: {
          guard: modules.guard,
          cache: modules.cache,
          context: modules.context,
          router: modules.router,
          prefix: modules.prefix,
          ledger: modules.ledger,
          breaker: breaker !== null,
          userBudget: userBudgetManager !== null,
          anomaly: anomalyDetector !== null,
        },
        cacheHitRate: cacheStats ? cacheStats.hitRate : null,
        guardBlockedRate: guardStats ? guardStats.blockedRate : null,
        breakerTripped: breakerStatus ? breakerStatus.tripped : null,
        totalSpent: ledgerSummary ? ledgerSummary.totalSpent : null,
        totalSaved: ledgerSummary ? ledgerSummary.totalSaved : null,
      }
    },
    dispose() {
      for (const cleanup of forwardingCleanups) cleanup()
      forwardingCleanups.length = 0
      loggerCleanup?.()
      loggerCleanup = null
    },
  }
}

// TokenShieldBlockedError is now imported from ./errors and re-exported for backward compatibility
export { TokenShieldBlockedError } from "./errors"

/**
 * Convenience: get the cost ledger from a middleware instance.
 */
export function getLedger(middleware: ReturnType<typeof tokenShieldMiddleware>): CostLedger | null {
  return middleware.ledger
}
