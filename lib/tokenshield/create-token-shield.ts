/**
 * TokenShield Quick-Start Factory
 *
 * Provides a simplified, opinionated configuration for common use cases.
 * Instead of configuring 12 modules individually, pass a preset name
 * and the factory builds the optimal config.
 *
 * @example
 * ```ts
 * // Simple: 3 lines of code
 * import { createTokenShield } from 'tokenshield'
 * const shield = createTokenShield({ preset: 'chatApp', monthlyBudget: 100 })
 * // Use with Vercel AI SDK: wrapLanguageModel({ model, middleware: shield })
 * ```
 */

import { tokenShieldMiddleware } from "./middleware"
import type { TokenShieldMiddlewareConfig, TokenShieldMiddleware } from "./middleware-types"

/** Preset configurations for common use cases */
export type TokenShieldPreset = "chatApp" | "apiBackend" | "development" | "custom"

export interface CreateTokenShieldOptions {
  /** Use a named preset for quick setup */
  preset?: TokenShieldPreset
  /** Monthly budget in USD. Enables circuit breaker when set. */
  monthlyBudget?: number
  /** Daily budget in USD. Enables circuit breaker when set. */
  dailyBudget?: number
  /** Called when a request is blocked */
  onBlocked?: (reason: string) => void
  /** Called with usage data after each request */
  onUsage?: TokenShieldMiddlewareConfig["onUsage"]
  /** Enable dry-run mode (logs what would happen without modifying behavior) */
  dryRun?: boolean
  /** Called in dry-run mode with descriptions of optimizations */
  onDryRun?: TokenShieldMiddlewareConfig["onDryRun"]
  /** Full config override (merged with preset defaults) */
  config?: Partial<TokenShieldMiddlewareConfig>
}

const PRESET_CONFIGS: Record<
  Exclude<TokenShieldPreset, "custom">,
  Partial<TokenShieldMiddlewareConfig>
> = {
  chatApp: {
    modules: { guard: true, cache: true, context: true, router: false, prefix: true, ledger: true },
    guard: { debounceMs: 300, maxRequestsPerMinute: 30 },
    cache: { maxEntries: 200, ttlMs: 1800000, similarityThreshold: 0.85 },
    context: { maxInputTokens: 4000, reserveForOutput: 1000 },
  },
  apiBackend: {
    modules: {
      guard: true,
      cache: true,
      context: false,
      router: false,
      prefix: false,
      ledger: true,
    },
    guard: { debounceMs: 0, maxRequestsPerMinute: 120 },
    cache: { maxEntries: 1000, ttlMs: 3600000, similarityThreshold: 0.9 },
  },
  development: {
    modules: {
      guard: false,
      cache: false,
      context: false,
      router: false,
      prefix: false,
      ledger: true,
    },
  },
}

/**
 * Quick-start factory for TokenShield.
 *
 * Combines a preset configuration with optional budget limits and callbacks
 * to create a fully configured middleware instance in minimal code.
 *
 * @param options - Configuration options including preset, budget, and callbacks
 * @returns A configured TokenShieldMiddleware instance
 *
 * @example Chat application with $100/month budget
 * ```ts
 * const shield = createTokenShield({
 *   preset: 'chatApp',
 *   monthlyBudget: 100,
 *   onBlocked: (reason) => console.warn('Blocked:', reason),
 * })
 * ```
 *
 * @example API backend with dry-run evaluation
 * ```ts
 * const shield = createTokenShield({
 *   preset: 'apiBackend',
 *   dryRun: true,
 *   onDryRun: (action) => console.log(`[${action.module}] ${action.description}`),
 * })
 * ```
 */
export function createTokenShield(options: CreateTokenShieldOptions = {}): TokenShieldMiddleware {
  const {
    preset = "chatApp",
    monthlyBudget,
    dailyBudget,
    onBlocked,
    onUsage,
    dryRun,
    onDryRun,
    config: overrides,
  } = options

  // Start with preset defaults
  const presetConfig = preset !== "custom" ? { ...PRESET_CONFIGS[preset] } : {}

  // Build breaker config from budget parameters
  const breaker =
    monthlyBudget || dailyBudget
      ? {
          limits: {
            ...(monthlyBudget ? { perMonth: monthlyBudget } : {}),
            ...(dailyBudget ? { perDay: dailyBudget } : {}),
          },
          action: "stop" as const,
        }
      : undefined

  // Merge everything together: preset → budget → callbacks → user overrides
  const finalConfig: TokenShieldMiddlewareConfig = {
    ...presetConfig,
    ...(breaker ? { breaker } : {}),
    ...(onBlocked ? { onBlocked } : {}),
    ...(onUsage ? { onUsage } : {}),
    ...(dryRun !== undefined ? { dryRun } : {}),
    ...(onDryRun ? { onDryRun } : {}),
    ...overrides,
  }

  return tokenShieldMiddleware(finalConfig)
}
