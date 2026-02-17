/**
 * TokenShield - Simplified API
 *
 * The `shield()` function is the primary entry point for TokenShield.
 * It creates middleware with sensible defaults using simple boolean flags
 * instead of the full configuration object.
 *
 * @example With Vercel AI SDK
 * ```ts
 * import { wrapLanguageModel } from "ai"
 * import { shield } from "@tokenshield/ai-sdk"
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4o"),
 *   middleware: shield(),
 * })
 * ```
 *
 * @example With options
 * ```ts
 * const middleware = shield({
 *   cache: true,
 *   compression: true,
 *   monthlyBudget: 100,
 *   onUsage: (e) => console.log(`$${e.cost.toFixed(4)} spent`),
 * })
 * ```
 */

import { tokenShieldMiddleware } from "./middleware"
import type { TokenShieldMiddleware, TokenShieldMiddlewareConfig } from "./middleware-types"

/**
 * Simplified shield configuration.
 * Boolean flags enable modules with sensible defaults.
 */
export interface ShieldConfig {
  /** Enable semantic response caching (default: true) */
  cache?: boolean
  /** Enable prompt compression and delta encoding (default: true) */
  compression?: boolean
  /** Enable cost tracking via the ledger (default: true) */
  trackCosts?: boolean
  /** Enable request deduplication and rate limiting (default: true) */
  guard?: boolean
  /** Monthly spending limit in USD. Enables circuit breaker when set.
   *  Must be a positive number. Omit or set to `undefined` for no limit.
   *  Note: `0` is treated as "no limit" (falsy), not "block all requests". */
  monthlyBudget?: number
  /** Daily spending limit in USD. Enables circuit breaker when set.
   *  Must be a positive number. Omit or set to `undefined` for no limit.
   *  Note: `0` is treated as "no limit" (falsy), not "block all requests". */
  dailyBudget?: number
  /** Cache similarity threshold 0-1 (default: 0.85) */
  similarityThreshold?: number
  /** Called with usage data after each request */
  onUsage?: (entry: {
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
    saved: number
  }) => void
}

/**
 * Snapshot of current shield stats.
 */
export interface ShieldStats {
  /** Total amount saved in USD */
  totalSaved: number
  /** Total amount spent in USD */
  totalSpent: number
  /** Savings rate (0-1) */
  savingsRate: number
  /** Cache hit rate (0-1), null if cache disabled */
  cacheHitRate: number | null
  /** Whether circuit breaker is tripped */
  breakerTripped: boolean | null
}

/**
 * Create TokenShield middleware with sensible defaults.
 *
 * Returns a middleware instance compatible with Vercel AI SDK's
 * `wrapLanguageModel()`, and also usable via the OpenAI/Anthropic adapters.
 *
 * @param config - Simple boolean flags and budget limits
 * @returns A configured TokenShieldMiddleware instance
 *
 * @example Zero-config (caching + compression + cost tracking enabled)
 * ```ts
 * const middleware = shield()
 * ```
 *
 * @example With budget enforcement
 * ```ts
 * const middleware = shield({ monthlyBudget: 500, dailyBudget: 25 })
 * ```
 */
export function shield(config: ShieldConfig = {}): TokenShieldMiddleware {
  const {
    cache = true,
    compression = true,
    trackCosts = true,
    guard = true,
    monthlyBudget,
    dailyBudget,
    similarityThreshold = 0.85,
    onUsage,
  } = config

  const fullConfig: TokenShieldMiddlewareConfig = {
    modules: {
      guard,
      cache,
      context: true,
      router: false,
      prefix: true,
      ledger: trackCosts,
      compressor: compression,
      delta: compression,
    },
    ...(cache ? { cache: { similarityThreshold } } : {}),
    ...(monthlyBudget || dailyBudget
      ? {
          breaker: {
            limits: {
              ...(monthlyBudget ? { perMonth: monthlyBudget } : {}),
              ...(dailyBudget ? { perDay: dailyBudget } : {}),
            },
            action: "stop" as const,
          },
        }
      : {}),
    ...(onUsage ? { onUsage } : {}),
  }

  return tokenShieldMiddleware(fullConfig)
}

/**
 * Get a snapshot of current stats from a shield middleware instance.
 *
 * @example
 * ```ts
 * const stats = getStats(middleware)
 * console.log(`Saved $${stats.totalSaved.toFixed(2)} (${(stats.savingsRate * 100).toFixed(0)}%)`)
 * ```
 */
export function getStats(middleware: TokenShieldMiddleware): ShieldStats {
  const health = middleware.healthCheck()
  const totalSaved = health.totalSaved ?? 0
  const totalSpent = health.totalSpent ?? 0
  const total = totalSaved + totalSpent
  return {
    totalSaved,
    totalSpent,
    savingsRate: total > 0 ? totalSaved / total : 0,
    cacheHitRate: health.cacheHitRate,
    breakerTripped: health.breakerTripped,
  }
}
