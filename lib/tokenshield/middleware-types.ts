/**
 * TokenShield Middleware - Shared Types & Helpers
 *
 * Type definitions, interfaces, constants, and utility functions
 * shared across the middleware pipeline modules.
 */

import type { ResponseCache } from "./response-cache"
import type { RequestGuard } from "./request-guard"
import type { CostLedger } from "./cost-ledger"
import type { CostCircuitBreaker, BreakerConfig } from "./circuit-breaker"
import type { UserBudgetManager, UserBudgetConfig, BudgetExceededEvent, BudgetWarningEvent } from "./user-budget-manager"
import type { createEventBus, TokenShieldEvents } from "./event-bus"
import type { TokenShieldLogger, LogEntry } from "./logger"
import type { ProviderAdapter, AdapterConfig } from "./provider-adapter"
import type { ComplexityScore } from "./model-router"
import type { AnomalyDetector, AnomalyConfig, AnomalyEvent } from "./anomaly-detector"
import { estimateCost } from "./cost-estimator"

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

/**
 * Metadata key used to pass data from transformParams to wrapGenerate.
 * This avoids globals and is safe for concurrent requests.
 */
export const SHIELD_META = Symbol("tokenshield")

/** Per-message token overhead: 4 structural tokens + ~1 role token (see token-counter.ts) */
export const MSG_OVERHEAD_TOKENS = 5

/**
 * Fallback pricing used when a model is not in MODEL_PRICING.
 * Uses GPT-4o-mini rates as a conservative middle-ground estimate
 * so that budget enforcement and cost tracking still function.
 */
export const FALLBACK_INPUT_PER_MILLION = 0.15
export const FALLBACK_OUTPUT_PER_MILLION = 0.60

// -------------------------------------------------------
// Config Interface
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
    anomaly?: boolean
  }

  /** Request guard config */
  guard?: {
    debounceMs?: number
    maxRequestsPerMinute?: number
    maxCostPerHour?: number
    /** Window in ms during which identical prompts are deduplicated even after completion (default: 0 = off) */
    deduplicateWindow?: number
  }

  /** Response cache config */
  cache?: {
    maxEntries?: number
    ttlMs?: number
    similarityThreshold?: number
    persist?: boolean
    /**
     * Similarity matching strategy:
     * - "bigram" (default): Fast bigram Dice coefficient. Good for near-duplicate detection.
     * - "holographic": Trigram-based holographic encoding with semantic seeding.
     *   Better for catching paraphrased prompts at the cost of slightly higher memory.
     */
    encodingStrategy?: "bigram" | "holographic"
    /** Semantic seeds for holographic encoding (maps domain terms to seed angles) */
    semanticSeeds?: Record<string, number>
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
    /**
     * A/B test holdback percentage (0-1). When set, this fraction of requests
     * will skip routing and use the default model, enabling quality comparison
     * between routed and unrouted calls. Set to 0.1 for a 10% holdback.
     * Default: 0 (all requests are routed).
     */
    abTestHoldback?: number
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

  /** Anomaly detection config */
  anomaly?: AnomalyConfig & {
    /** Called when an anomaly is detected */
    onAnomalyDetected?: (event: AnomalyEvent) => void
  }

  /**
   * Dry-run mode: log what TokenShield WOULD do without modifying behavior.
   * When enabled, the middleware passes params through unchanged but emits
   * events and calls onDryRun with a description of each optimization that
   * would have been applied. Useful for evaluating Token Shield before
   * committing to production use.
   */
  dryRun?: boolean

  /** Called in dry-run mode with a description of each optimization that would be applied */
  onDryRun?: (action: { module: string; description: string; estimatedSavings?: number }) => void

  /**
   * Per-request router override. When set, the model router is skipped for
   * requests where this function returns a non-null model ID.
   * Use this to force specific models for particular prompts.
   *
   * @example
   * ```ts
   * routerOverride: (prompt) => prompt.includes('[IMPORTANT]') ? 'gpt-4o' : null
   * ```
   */
  routerOverride?: (prompt: string) => string | null

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
// Return Type
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
  /** Access the anomaly detector */
  anomalyDetector: AnomalyDetector | null
  /** Per-instance event bus. Events are also forwarded to the global shieldEvents. */
  events: ReturnType<typeof createEventBus>
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
  /** Returns a snapshot of all module health indicators */
  healthCheck: () => HealthCheckResult
  /** Clean up event forwarding listeners. Call when disposing a middleware instance. */
  dispose: () => void
}

/** Health check result for operational monitoring */
export interface HealthCheckResult {
  /** Whether the middleware is operational */
  healthy: boolean
  /** Active modules */
  modules: {
    guard: boolean
    cache: boolean
    context: boolean
    router: boolean
    prefix: boolean
    ledger: boolean
    breaker: boolean
    userBudget: boolean
    anomaly: boolean
  }
  /** Cache hit rate (0-1), null if cache disabled */
  cacheHitRate: number | null
  /** Guard blocked request rate (0-1), null if guard disabled */
  guardBlockedRate: number | null
  /** Whether circuit breaker is tripped */
  breakerTripped: boolean | null
  /** Ledger total spend, null if ledger disabled */
  totalSpent: number | null
  /** Ledger total saved, null if ledger disabled */
  totalSaved: number | null
}

// -------------------------------------------------------
// Internal Types
// -------------------------------------------------------

export interface ShieldMeta {
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
  /** True when this request was held back from routing for A/B quality comparison */
  abTestHoldout?: boolean
  /** Cached last user text to avoid redundant extraction in wrapGenerate/wrapStream */
  lastUserText?: string
}

/** AI SDK prompt type used internally for type-safe extraction */
export type AISDKPrompt = Array<{ role: string; content: Array<{ type: string; text?: string }> }>

export interface ModuleFlags {
  guard: boolean
  cache: boolean
  context: boolean
  router: boolean
  prefix: boolean
  ledger: boolean
  anomaly: boolean
}

/**
 * Shared context passed to pipeline builder functions.
 * Holds all initialized module instances and configuration.
 */
export interface MiddlewareContext {
  config: TokenShieldMiddlewareConfig
  modules: ModuleFlags
  guard: RequestGuard | null
  cache: ResponseCache | null
  ledger: CostLedger | null
  breaker: CostCircuitBreaker | null
  userBudgetManager: UserBudgetManager | null
  anomalyDetector: AnomalyDetector | null
  instanceEvents: ReturnType<typeof createEventBus>
  log: TokenShieldLogger | null
  adapter: ProviderAdapter | null
}

// -------------------------------------------------------
// Helper Functions
// -------------------------------------------------------

/**
 * Extract the last user message text from an AI SDK prompt array.
 * Centralizes the repeated pattern of filtering for user role, extracting
 * text parts, and joining them — previously duplicated 4+ times.
 */
export function extractLastUserText(params: Record<string, unknown>): string {
  const prompt = params.prompt as AISDKPrompt | undefined
  if (!prompt || !Array.isArray(prompt)) return ""
  const lastUserMsg = prompt.filter((m) => m.role === "user").pop()
  return lastUserMsg?.content
    ?.filter((p: { type: string }) => p.type === "text")
    .map((p: { text?: string }) => p.text ?? "")
    .join("") ?? ""
}

/**
 * Safe cost estimation helper. Falls back to conservative average pricing
 * for unknown models instead of returning 0, which would silently bypass
 * budget enforcement and produce incorrect savings calculations.
 */
export function safeCost(modelId: string, inputTokens: number, outputTokens: number): number {
  try {
    return estimateCost(modelId, inputTokens, outputTokens).totalCost
  } catch {
    // Unknown model — use fallback pricing to keep budget checks functional
    return (inputTokens / 1_000_000) * FALLBACK_INPUT_PER_MILLION +
           (outputTokens / 1_000_000) * FALLBACK_OUTPUT_PER_MILLION
  }
}
