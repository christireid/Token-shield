import * as v from "valibot"

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export const GuardConfigSchema = v.object({
  debounceMs: v.optional(v.pipe(v.number(), v.minValue(0)), 300),
  maxRequestsPerMinute: v.optional(v.pipe(v.number(), v.minValue(1)), 60),
  maxCostPerHour: v.optional(v.pipe(v.number(), v.minValue(0)), 10),
  deduplicateWindow: v.optional(v.pipe(v.number(), v.minValue(0)), 5000),
  minInputLength: v.optional(v.pipe(v.number(), v.minValue(0)), 2),
  maxInputTokens: v.optional(v.pipe(v.number(), v.minValue(1))),
})

export type GuardConfig = v.InferOutput<typeof GuardConfigSchema>

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export const CacheConfigSchema = v.object({
  maxEntries: v.optional(v.pipe(v.number(), v.minValue(1)), 500),
  ttlMs: v.optional(v.pipe(v.number(), v.minValue(0)), 3_600_000),
  similarityThreshold: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1)), 0.85),
  scopeByModel: v.optional(v.boolean(), true),
})

export type CacheConfig = v.InferOutput<typeof CacheConfigSchema>

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const ContextConfigSchema = v.object({
  maxInputTokens: v.optional(v.pipe(v.number(), v.minValue(1))),
  reserveForOutput: v.optional(v.pipe(v.number(), v.minValue(0)), 1000),
})

export type ContextConfig = v.InferOutput<typeof ContextConfigSchema>

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const RouterConfigSchema = v.object({
  tiers: v.optional(
    v.array(
      v.object({
        modelId: v.string(),
        maxComplexity: v.number(),
      }),
    ),
  ),
  complexityThreshold: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(100)), 50),
})

export type RouterConfig = v.InferOutput<typeof RouterConfigSchema>

// ---------------------------------------------------------------------------
// Prefix
// ---------------------------------------------------------------------------

export const PrefixConfigSchema = v.object({
  provider: v.optional(v.picklist(["openai", "anthropic", "google", "auto"]), "auto"),
})

export type PrefixConfig = v.InferOutput<typeof PrefixConfigSchema>

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const LedgerConfigSchema = v.object({
  persist: v.optional(v.boolean(), false),
  feature: v.optional(v.string()),
})

export type LedgerConfig = v.InferOutput<typeof LedgerConfigSchema>

// ---------------------------------------------------------------------------
// Breaker
// ---------------------------------------------------------------------------

export const BreakerConfigSchema = v.object({
  limits: v.object({
    perSession: v.optional(v.pipe(v.number(), v.minValue(0))),
    perHour: v.optional(v.pipe(v.number(), v.minValue(0))),
    perDay: v.optional(v.pipe(v.number(), v.minValue(0))),
    perMonth: v.optional(v.pipe(v.number(), v.minValue(0))),
  }),
  action: v.optional(v.picklist(["warn", "throttle", "stop"]), "stop"),
  persist: v.optional(v.boolean(), false),
})

export type BreakerConfig = v.InferOutput<typeof BreakerConfigSchema>

// ---------------------------------------------------------------------------
// User Budget
// ---------------------------------------------------------------------------

export const UserBudgetLimitsSchema = v.object({
  daily: v.pipe(v.number(), v.minValue(0)),
  monthly: v.pipe(v.number(), v.minValue(0)),
  tier: v.optional(v.picklist(["standard", "premium", "unlimited"])),
})

export type UserBudgetLimitsConfig = v.InferOutput<typeof UserBudgetLimitsSchema>

export const UserBudgetConfigSchema = v.object({
  users: v.optional(v.record(v.string(), UserBudgetLimitsSchema)),
  defaultBudget: v.optional(UserBudgetLimitsSchema),
  persist: v.optional(v.boolean(), false),
  tierModels: v.optional(v.record(v.picklist(["standard", "premium", "unlimited"]), v.string())),
})

export type UserBudgetConfig = v.InferOutput<typeof UserBudgetConfigSchema>

// ---------------------------------------------------------------------------
// Master config
// ---------------------------------------------------------------------------

export const TokenShieldConfigSchema = v.object({
  modules: v.optional(
    v.object({
      guard: v.optional(v.boolean()),
      cache: v.optional(v.boolean()),
      context: v.optional(v.boolean()),
      router: v.optional(v.boolean()),
      prefix: v.optional(v.boolean()),
      ledger: v.optional(v.boolean()),
    }),
  ),
  guard: v.optional(GuardConfigSchema),
  cache: v.optional(CacheConfigSchema),
  context: v.optional(ContextConfigSchema),
  router: v.optional(RouterConfigSchema),
  prefix: v.optional(PrefixConfigSchema),
  ledger: v.optional(LedgerConfigSchema),
  breaker: v.optional(BreakerConfigSchema),
  userBudget: v.optional(UserBudgetConfigSchema),
})

export type TokenShieldConfig = v.InferOutput<typeof TokenShieldConfigSchema>

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate an unknown value against the TokenShield config schema.
 * Returns the validated (and default-filled) config object.
 * Throws a `ValiError` when the input does not satisfy the schema.
 */
export function validateConfig(config: unknown): TokenShieldConfig {
  return v.parse(TokenShieldConfigSchema, config)
}
