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
 *   import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'
 *
 *   const model = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware: tokenShieldMiddleware({ ... }),
 *   })
 *   const result = await streamText({ model, messages })
 *
 * Generic adapter usage:
 *   import { tokenShieldMiddleware, createGenericAdapter } from '@tokenshield/ai-sdk'
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
import { AuditLog, type AuditLogConfig } from "./audit-log"
import { isModulePermitted } from "./license"

import type {
  TokenShieldMiddlewareConfig,
  TokenShieldMiddleware,
  MiddlewareContext,
  HealthCheckResult,
} from "./middleware-types"
import { buildTransformParams } from "./middleware-transform"
import { buildWrapGenerate, buildWrapStream } from "./middleware-wrap"
import { initializePlugins, type PluginCleanup } from "./middleware-plugin"

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
      throw new TokenShieldConfigError(`Invalid config at "${path}": ${err.message}`, path, {
        cause: err,
      })
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

  /** Default storage-error handler: emits on instance event bus. */
  const defaultOnStorageError = (module: string, operation: string) => (error: unknown) => {
    try {
      instanceEvents.emit("storage:error", { module, operation, error })
    } catch {
      /* non-fatal */
    }
  }

  const cache = modules.cache
    ? new ResponseCache({
        maxEntries: config.cache?.maxEntries ?? 500,
        ttlMs: config.cache?.ttlMs ?? 3600000,
        similarityThreshold: config.cache?.similarityThreshold ?? 0.85,
        encodingStrategy: config.cache?.encodingStrategy,
        semanticSeeds: config.cache?.semanticSeeds,
        backend: config.cache?.backend,
        onStorageError: config.cache?.onStorageError ?? defaultOnStorageError("cache", "idb"),
      })
    : null

  const ledger = modules.ledger ? new CostLedger({ persist: config.ledger?.persist }) : null

  const breaker = config.breaker
    ? new CostCircuitBreaker({
        ...config.breaker,
        onWarning: (detail) => {
          config.breaker?.onWarning?.(detail)
          try {
            instanceEvents.emit("breaker:warning", {
              limitType: detail.limitType,
              currentSpend: detail.currentSpend,
              limit: detail.limit,
              percentUsed: detail.percentUsed,
            })
          } catch {
            /* non-fatal */
          }
        },
        onTripped: (detail) => {
          config.breaker?.onTripped?.(detail)
          try {
            instanceEvents.emit("breaker:tripped", {
              limitType: detail.limitType,
              currentSpend: detail.currentSpend,
              limit: detail.limit,
              action: config.breaker?.action ?? "stop",
            })
          } catch {
            /* non-fatal */
          }
        },
        onReset: (window) => {
          config.breaker?.onReset?.(window)
          // breaker:reset is not an event bus type — call audit log directly if available
        },
      })
    : null

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
    "compressor:applied",
    "delta:applied",
    "storage:error",
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

  // Initialize audit log if configured
  const auditLog: AuditLog | null =
    config.auditLog instanceof AuditLog
      ? config.auditLog
      : config.auditLog
        ? new AuditLog(config.auditLog as AuditLogConfig)
        : null

  // Wire audit log to event bus — maps pipeline events to audit entries
  const auditCleanups: Array<() => void> = []
  if (auditLog) {
    const on = (
      event: keyof import("./event-bus").TokenShieldEvents,
      handler: (data: unknown) => void,
    ) => {
      const cleanup = subscribeToAnyEvent(instanceEvents, event, handler)
      auditCleanups.push(cleanup)
    }
    on("ledger:entry", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logApiCall(
        String(data.model ?? ""),
        Number(data.inputTokens ?? 0),
        Number(data.outputTokens ?? 0),
        Number(data.cost ?? 0),
      )
    })
    on("cache:hit", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logCacheHit(String(data.model ?? ""), String(data.prompt ?? ""))
    })
    on("request:blocked", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logRequestBlocked(String(data.reason ?? ""), String(data.model ?? ""))
    })
    on("breaker:tripped", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logBreakerTripped(
        String(data.limitType ?? ""),
        Number(data.threshold ?? 0),
        Number(data.actual ?? 0),
      )
    })
    on("userBudget:exceeded", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logBudgetExceeded(
        String(data.userId ?? ""),
        Number(data.limit ?? 0),
        Number(data.spent ?? 0),
      )
    })
    on("userBudget:warning", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logBudgetWarning(
        String(data.userId ?? ""),
        String(data.limitType ?? ""),
        Number(data.percentUsed ?? 0),
      )
    })
    on("anomaly:detected", (d) => {
      const data = d as unknown as Record<string, unknown>
      auditLog.logAnomalyDetected(
        String(data.metric ?? ""),
        Number(data.value ?? 0),
        Number(data.zscore ?? 0),
        data.model ? String(data.model) : undefined,
      )
    })
    on("router:downgraded", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logModelRouted(
        String(data.originalModel ?? data.from ?? ""),
        String(data.selectedModel ?? data.to ?? ""),
        String(data.reason ?? "complexity"),
      )
    })
    on("compressor:applied", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logCompressorApplied(
        Number(data.savedTokens ?? 0),
        Number(data.originalTokens ?? 0),
        Number(data.compressedTokens ?? 0),
      )
    })
    on("delta:applied", (d) => {
      const data = d as Record<string, unknown>
      auditLog.logDeltaApplied(
        Number(data.savedTokens ?? 0),
        Number(data.originalTokens ?? 0),
        Number(data.encodedTokens ?? 0),
      )
    })
  }

  // Auto-hydrate audit log from IndexedDB if persistence is enabled
  if (auditLog && config.auditLog && !(config.auditLog instanceof AuditLog)) {
    const auditConfig = config.auditLog as AuditLogConfig
    if (auditConfig.persist) {
      auditLog.hydrate().catch((err) => {
        log?.warn("audit", "Failed to hydrate audit log — starting fresh", {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }

  // License enforcement: warn when modules require a higher tier
  const moduleNameMap: Record<string, string> = {
    guard: "request-guard",
    cache: "response-cache",
    context: "context-manager",
    router: "model-router",
    prefix: "prefix-optimizer",
    ledger: "cost-ledger",
    anomaly: "anomaly-detector",
  }
  for (const [flag, enabled] of Object.entries(modules)) {
    if (enabled && moduleNameMap[flag]) {
      isModulePermitted(moduleNameMap[flag])
    }
  }
  if (config.breaker) isModulePermitted("circuit-breaker")
  if (config.userBudget) isModulePermitted("user-budget-manager")
  if (config.auditLog) isModulePermitted("audit-log")

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
    auditLog,
  }

  // Initialize registered plugins
  const pluginCleanups: PluginCleanup[] = initializePlugins({
    events: instanceEvents,
    log,
    auditLog,
    config: config as unknown as Record<string, unknown>,
  })

  return {
    ledger,
    cache,
    guard,
    userBudgetManager,
    anomalyDetector,
    events: instanceEvents,
    logger: log,
    providerAdapter: adapter,
    auditLog,
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
      for (const cleanup of auditCleanups) cleanup()
      auditCleanups.length = 0
      for (const cleanup of pluginCleanups) cleanup()
      pluginCleanups.length = 0
      loggerCleanup?.()
      loggerCleanup = null
      cache?.dispose()
      guard?.dispose()
      adapter?.dispose()
      auditLog?.dispose()
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
