/**
 * TokenShield - User Budget Types & Utilities
 *
 * Type definitions, constants, and pure utility functions for per-user
 * token budget management. Extracted from user-budget-manager.ts to
 * keep file sizes manageable.
 *
 * Team tier feature ($99/month).
 */

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export type UserBudgetTier = "standard" | "premium" | "unlimited"

export interface UserBudgetLimits {
  /** Maximum dollar spend per 24-hour rolling window (0 = no daily limit) */
  daily: number
  /** Maximum dollar spend per 30-day rolling window (0 = no monthly limit) */
  monthly: number
  /** Model tier — controls which models this user can access */
  tier?: UserBudgetTier
}

export interface UserBudgetConfig {
  /** Per-user budget overrides keyed by opaque user ID */
  users?: Record<string, UserBudgetLimits>
  /** Default budget applied when a user has no specific config */
  defaultBudget?: UserBudgetLimits
  /** Persist budget usage to IndexedDB (survives page refresh) */
  persist?: boolean
  /** Called when a user exceeds their daily or monthly limit */
  onBudgetExceeded?: (userId: string, event: BudgetExceededEvent) => void
  /** Called when a user reaches a warning threshold (80% of a limit) */
  onBudgetWarning?: (userId: string, event: BudgetWarningEvent) => void
  /** Model ID mappings per tier — used for automatic model routing */
  tierModels?: Partial<Record<UserBudgetTier, string>>
}

export interface BudgetExceededEvent {
  /** Which limit was hit */
  limitType: "daily" | "monthly"
  /** Current spend in that window */
  currentSpend: number
  /** The limit value in dollars */
  limit: number
  /** Percentage of limit used (capped at 999) */
  percentUsed: number
  timestamp: number
}

export interface BudgetWarningEvent {
  /** Which limit is approaching */
  limitType: "daily" | "monthly"
  /** Current spend in that window */
  currentSpend: number
  /** The limit value in dollars */
  limit: number
  /** Percentage of limit used (capped at 999) */
  percentUsed: number
  timestamp: number
}

export interface UserBudgetStatus {
  userId: string
  /** Budget limits for this user (resolved via inheritance) */
  limits: UserBudgetLimits | null
  /** Current spend in rolling windows */
  spend: { daily: number; monthly: number }
  /** Remaining budget (null = unlimited or limit is 0) */
  remaining: { daily: number | null; monthly: number | null }
  /** Percentage of each limit used (0 when limit is 0/unlimited) */
  percentUsed: { daily: number; monthly: number }
  /** Whether any limit is exceeded (accounts for in-flight requests) */
  isOverBudget: boolean
  /** Estimated cost of currently in-flight requests for this user */
  inflight: number
  /** The model tier for this user */
  tier: UserBudgetTier
}

/** Internal record of a single user spend event */
export interface UserSpendRecord {
  timestamp: number
  cost: number
  model: string
  userId: string
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

export const ONE_DAY_MS = 24 * 60 * 60 * 1000
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_CACHE_SIZE = 1000
export const MAX_WARNING_MAP_SIZE = 500
/** Maximum distinct users tracked in inflightByUser before FIFO eviction */
export const MAX_TRACKED_USERS = 5000
/** Maximum spend records kept in memory (prevents unbounded growth in high-throughput) */
export const MAX_BUDGET_RECORDS = 50_000

// -------------------------------------------------------
// Utility functions
// -------------------------------------------------------

/** Safe percentage capped at 999 to avoid Infinity in event payloads */
export function budgetPct(value: number, limit: number): number {
  return limit > 0 ? Math.min((value / limit) * 100, 999) : 0
}

/**
 * Resolve the budget limits for a user via the inheritance chain:
 * user-specific config → defaultBudget → null (no limits).
 */
export function resolveUserLimits(
  config: UserBudgetConfig,
  userId: string,
): UserBudgetLimits | null {
  const userConfig = config.users?.[userId]
  if (userConfig) return userConfig
  if (config.defaultBudget) return config.defaultBudget
  return null
}

/**
 * Compute daily and monthly spend for a user from a list of spend records.
 */
export function computeSpendWindows(
  records: UserSpendRecord[],
  userId: string,
  now: number,
): { daily: number; monthly: number } {
  const oneDayAgo = now - ONE_DAY_MS
  const thirtyDaysAgo = now - THIRTY_DAYS_MS

  let dailySpend = 0
  let monthlySpend = 0

  for (const r of records) {
    if (r.userId !== userId) continue
    if (r.timestamp >= oneDayAgo) dailySpend += r.cost
    if (r.timestamp >= thirtyDaysAgo) monthlySpend += r.cost
  }

  return { daily: dailySpend, monthly: monthlySpend }
}

/**
 * Build a full UserBudgetStatus snapshot from resolved limits, spend windows,
 * and in-flight cost.
 */
export function buildBudgetSnapshot(
  userId: string,
  limits: UserBudgetLimits | null,
  spend: { daily: number; monthly: number },
  userInflight: number,
): UserBudgetStatus {
  const tier = limits?.tier ?? "standard"

  if (!limits) {
    return {
      userId,
      limits: null,
      spend: { daily: spend.daily, monthly: spend.monthly },
      remaining: { daily: null, monthly: null },
      percentUsed: { daily: 0, monthly: 0 },
      isOverBudget: false,
      inflight: userInflight,
      tier,
    }
  }

  const dailyRemaining = limits.daily > 0 ? Math.max(0, limits.daily - spend.daily) : null
  const monthlyRemaining = limits.monthly > 0 ? Math.max(0, limits.monthly - spend.monthly) : null
  const dailyPercent = limits.daily > 0 ? Math.min((spend.daily / limits.daily) * 100, 999) : 0
  const monthlyPercent =
    limits.monthly > 0 ? Math.min((spend.monthly / limits.monthly) * 100, 999) : 0

  // isOverBudget accounts for in-flight; 0-limit means no limit for that window
  const dailyOver = limits.daily > 0 && spend.daily + userInflight >= limits.daily
  const monthlyOver = limits.monthly > 0 && spend.monthly + userInflight >= limits.monthly

  return {
    userId,
    limits,
    spend: { daily: spend.daily, monthly: spend.monthly },
    remaining: { daily: dailyRemaining, monthly: monthlyRemaining },
    percentUsed: { daily: dailyPercent, monthly: monthlyPercent },
    isOverBudget: dailyOver || monthlyOver,
    inflight: userInflight,
    tier,
  }
}

/**
 * Evict stale warning entries to prevent unbounded map growth.
 * Mutates the provided map in place.
 */
export function evictStaleWarnings(warningFired: Map<string, number>, now: number): void {
  if (warningFired.size <= MAX_WARNING_MAP_SIZE) return

  // First pass: remove expired entries (>30 days old)
  for (const [key, time] of warningFired) {
    if (now - time > THIRTY_DAYS_MS) warningFired.delete(key)
  }
  // Hard cap: if still over limit, evict oldest entries (FIFO)
  if (warningFired.size > MAX_WARNING_MAP_SIZE) {
    const excess = warningFired.size - MAX_WARNING_MAP_SIZE
    let evicted = 0
    for (const key of warningFired.keys()) {
      if (evicted >= excess) break
      warningFired.delete(key)
      evicted++
    }
  }
}
