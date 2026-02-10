/**
 * TokenShield - User Budget Manager
 *
 * Per-user token budget management for teams. Assigns daily and monthly
 * dollar limits to individual users, tracks spending per user, and
 * optionally routes budget-tier users to cheaper models.
 *
 * Architecture decisions:
 * - Client-side only — all data in IndexedDB via idb-keyval
 * - User IDs are opaque strings (JWT sub, database ID, username — your call)
 * - Budget inheritance: user-specific → defaultBudget → no limits
 * - Model tier routing: budget users can be auto-routed to cheaper models
 *
 * Team tier feature ($99/month).
 */

import { get, set, createStore, type UseStore } from "idb-keyval"
import { estimateCost } from "./cost-estimator"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export type UserBudgetTier = "standard" | "premium" | "unlimited"

export interface UserBudgetLimits {
  /** Maximum dollar spend per 24-hour rolling window */
  daily: number
  /** Maximum dollar spend per 30-day rolling window */
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
  /** Percentage of limit used */
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
  /** Percentage of limit used */
  percentUsed: number
  timestamp: number
}

export interface UserBudgetStatus {
  userId: string
  /** Budget limits for this user (resolved via inheritance) */
  limits: UserBudgetLimits | null
  /** Current spend in rolling windows */
  spend: { daily: number; monthly: number }
  /** Remaining budget (null = unlimited) */
  remaining: { daily: number | null; monthly: number | null }
  /** Percentage of each limit used */
  percentUsed: { daily: number; monthly: number }
  /** Whether any limit is exceeded */
  isOverBudget: boolean
  /** The model tier for this user */
  tier: UserBudgetTier
}

/** Internal record of a single user spend event */
interface UserSpendRecord {
  timestamp: number
  cost: number
  model: string
  userId: string
}

// -------------------------------------------------------
// Implementation
// -------------------------------------------------------

export class UserBudgetManager {
  private config: UserBudgetConfig
  private records: UserSpendRecord[] = []
  private listeners = new Set<() => void>()
  private idbStore: UseStore | null = null
  private warningFired = new Map<string, number>()

  constructor(config: UserBudgetConfig = {}) {
    this.config = config

    if (config.persist && typeof window !== "undefined") {
      try {
        this.idbStore = createStore("tokenshield-user-budgets", "spend-records")
      } catch {
        // SSR or IDB unavailable
      }
    }
  }

  /**
   * Subscribe to budget state changes. Returns an unsubscribe function.
   * Compatible with React's useSyncExternalStore.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const l of this.listeners) l()
  }

  /**
   * Resolve the budget limits for a user via the inheritance chain:
   * user-specific config → defaultBudget → null (no limits).
   */
  private resolveLimits(userId: string): UserBudgetLimits | null {
    const userConfig = this.config.users?.[userId]
    if (userConfig) return userConfig
    if (this.config.defaultBudget) return this.config.defaultBudget
    return null
  }

  /**
   * Check if a user is allowed to make a request. Call before every API call.
   * Returns { allowed, reason, status }.
   */
  check(userId: string, modelId?: string, estimatedInputTokens?: number, estimatedOutputTokens?: number): {
    allowed: boolean
    reason?: string
    status: UserBudgetStatus
  } {
    const status = this.getStatus(userId)

    // No limits configured — always allow
    if (!status.limits) {
      return { allowed: true, status }
    }

    // Estimate cost of this request
    let estimatedCostDollars = 0
    if (modelId && estimatedInputTokens) {
      try {
        estimatedCostDollars = estimateCost(
          modelId,
          estimatedInputTokens,
          estimatedOutputTokens ?? 500
        ).totalCost
      } catch {
        // Unknown model, skip cost estimate
      }
    }

    // Helper: safe percentage that avoids division by zero
    const pct = (value: number, limit: number) =>
      limit > 0 ? (value / limit) * 100 : (value > 0 ? Infinity : 100)

    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

    // Check daily limit
    const projectedDaily = status.spend.daily + estimatedCostDollars
    const dailyWarningKey = `${userId}-daily`
    // Reset daily warning if it was fired more than 24 hours ago
    const dailyWarningTime = this.warningFired.get(dailyWarningKey)
    if (dailyWarningTime !== undefined && now - dailyWarningTime > oneDayMs) {
      this.warningFired.delete(dailyWarningKey)
    }
    if (status.limits.daily > 0 && projectedDaily >= status.limits.daily * 0.8 && !this.warningFired.has(dailyWarningKey)) {
      this.warningFired.set(dailyWarningKey, now)
      this.config.onBudgetWarning?.(userId, {
        limitType: "daily",
        currentSpend: status.spend.daily,
        limit: status.limits.daily,
        percentUsed: pct(projectedDaily, status.limits.daily),
        timestamp: Date.now(),
      })
    }
    if (projectedDaily >= status.limits.daily) {
      this.config.onBudgetExceeded?.(userId, {
        limitType: "daily",
        currentSpend: status.spend.daily,
        limit: status.limits.daily,
        percentUsed: pct(projectedDaily, status.limits.daily),
        timestamp: Date.now(),
      })
      return {
        allowed: false,
        reason: `User ${userId} daily budget exceeded ($${status.spend.daily.toFixed(4)} / $${status.limits.daily.toFixed(2)})`,
        status,
      }
    }

    // Check monthly limit
    const projectedMonthly = status.spend.monthly + estimatedCostDollars
    const monthlyWarningKey = `${userId}-monthly`
    // Reset monthly warning if it was fired more than 30 days ago
    const monthlyWarningTime = this.warningFired.get(monthlyWarningKey)
    if (monthlyWarningTime !== undefined && now - monthlyWarningTime > thirtyDaysMs) {
      this.warningFired.delete(monthlyWarningKey)
    }
    if (status.limits.monthly > 0 && projectedMonthly >= status.limits.monthly * 0.8 && !this.warningFired.has(monthlyWarningKey)) {
      this.warningFired.set(monthlyWarningKey, now)
      this.config.onBudgetWarning?.(userId, {
        limitType: "monthly",
        currentSpend: status.spend.monthly,
        limit: status.limits.monthly,
        percentUsed: pct(projectedMonthly, status.limits.monthly),
        timestamp: Date.now(),
      })
    }
    if (projectedMonthly >= status.limits.monthly) {
      this.config.onBudgetExceeded?.(userId, {
        limitType: "monthly",
        currentSpend: status.spend.monthly,
        limit: status.limits.monthly,
        percentUsed: pct(projectedMonthly, status.limits.monthly),
        timestamp: Date.now(),
      })
      return {
        allowed: false,
        reason: `User ${userId} monthly budget exceeded ($${status.spend.monthly.toFixed(4)} / $${status.limits.monthly.toFixed(2)})`,
        status,
      }
    }

    return { allowed: true, status }
  }

  /**
   * Record actual spending after a request completes.
   */
  async recordSpend(userId: string, cost: number, model: string): Promise<void> {
    const record: UserSpendRecord = {
      timestamp: Date.now(),
      cost,
      model,
      userId,
    }

    this.records.push(record)

    // Clean up old records (keep last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    this.records = this.records.filter((r) => r.timestamp > thirtyDaysAgo)

    // Persist to IndexedDB
    if (this.idbStore) {
      try {
        await set("user-budget-records", this.records, this.idbStore)
      } catch {
        // IDB write failed, data still in memory
      }
    }

    this.notify()
  }

  /**
   * Get comprehensive budget status for a user.
   */
  getStatus(userId: string): UserBudgetStatus {
    const limits = this.resolveLimits(userId)
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    let dailySpend = 0
    let monthlySpend = 0

    for (const r of this.records) {
      if (r.userId !== userId) continue
      if (r.timestamp >= oneDayAgo) dailySpend += r.cost
      if (r.timestamp >= thirtyDaysAgo) monthlySpend += r.cost
    }

    const tier = limits?.tier ?? "standard"

    if (!limits) {
      return {
        userId,
        limits: null,
        spend: { daily: dailySpend, monthly: monthlySpend },
        remaining: { daily: null, monthly: null },
        percentUsed: { daily: 0, monthly: 0 },
        isOverBudget: false,
        tier,
      }
    }

    const dailyRemaining = Math.max(0, limits.daily - dailySpend)
    const monthlyRemaining = Math.max(0, limits.monthly - monthlySpend)
    const dailyPercent = limits.daily > 0 ? (dailySpend / limits.daily) * 100 : 0
    const monthlyPercent = limits.monthly > 0 ? (monthlySpend / limits.monthly) * 100 : 0

    return {
      userId,
      limits,
      spend: { daily: dailySpend, monthly: monthlySpend },
      remaining: { daily: dailyRemaining, monthly: monthlyRemaining },
      percentUsed: { daily: dailyPercent, monthly: monthlyPercent },
      isOverBudget: dailySpend >= limits.daily || monthlySpend >= limits.monthly,
      tier,
    }
  }

  /**
   * Get the model ID for a user based on their budget tier.
   * Returns null if no tier routing is configured.
   */
  getModelForUser(userId: string): string | null {
    const limits = this.resolveLimits(userId)
    const tier = limits?.tier ?? "standard"
    return this.config.tierModels?.[tier] ?? null
  }

  /**
   * Get status for all known users (those with explicit config + those with spend records).
   */
  getAllUserStatuses(): UserBudgetStatus[] {
    const userIds = new Set<string>()

    // Users with explicit configs
    if (this.config.users) {
      for (const id of Object.keys(this.config.users)) {
        userIds.add(id)
      }
    }

    // Users with spend records
    for (const r of this.records) {
      userIds.add(r.userId)
    }

    return Array.from(userIds).map((id) => this.getStatus(id))
  }

  /**
   * Load spend records from IndexedDB (for session restore).
   */
  async hydrate(): Promise<number> {
    if (!this.idbStore) return 0
    try {
      const records = await get<UserSpendRecord[]>("user-budget-records", this.idbStore)
      if (records && records.length > 0) {
        // Filter out expired records
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        this.records = records.filter((r) => r.timestamp > thirtyDaysAgo)
        this.notify()
        return this.records.length
      }
      return 0
    } catch {
      return 0
    }
  }

  /**
   * Update budget config for a specific user at runtime.
   */
  updateUserBudget(userId: string, limits: UserBudgetLimits): void {
    if (!this.config.users) this.config.users = {}
    this.config.users[userId] = limits
    // Clear warnings so they can re-fire with new limits
    this.warningFired.delete(`${userId}-daily`)
    this.warningFired.delete(`${userId}-monthly`)
    this.notify()
  }

  /**
   * Remove a user's budget configuration (falls back to defaultBudget).
   */
  removeUserBudget(userId: string): void {
    if (this.config.users) {
      delete this.config.users[userId]
    }
    this.warningFired.delete(`${userId}-daily`)
    this.warningFired.delete(`${userId}-monthly`)
    this.notify()
  }

  /**
   * Reset spend records for a specific user.
   */
  async resetUser(userId: string): Promise<void> {
    this.records = this.records.filter((r) => r.userId !== userId)
    this.warningFired.delete(`${userId}-daily`)
    this.warningFired.delete(`${userId}-monthly`)

    if (this.idbStore) {
      try {
        await set("user-budget-records", this.records, this.idbStore)
      } catch {
        // IDB write failed
      }
    }

    this.notify()
  }

  /**
   * Reset all spend records.
   */
  async reset(): Promise<void> {
    this.records = []
    this.warningFired.clear()

    if (this.idbStore) {
      try {
        await set("user-budget-records", [], this.idbStore)
      } catch {
        // IDB write failed
      }
    }

    this.notify()
  }
}
