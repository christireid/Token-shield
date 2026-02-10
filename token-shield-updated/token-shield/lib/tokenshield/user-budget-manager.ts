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
 * - A limit of 0 means "no limit" for that time window
 *
 * Team tier feature ($99/month).
 */

import { get, set, createStore, type UseStore } from "idb-keyval"
import { estimateCost } from "./cost-estimator"
import { shieldEvents } from "./event-bus"

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
interface UserSpendRecord {
  timestamp: number
  cost: number
  model: string
  userId: string
}

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CACHE_SIZE = 1000
const MAX_WARNING_MAP_SIZE = 500
/** Maximum distinct users tracked in inflightByUser before FIFO eviction */
const MAX_TRACKED_USERS = 5000

// -------------------------------------------------------
// Implementation
// -------------------------------------------------------

export class UserBudgetManager {
  private config: UserBudgetConfig
  private records: UserSpendRecord[] = []
  private listeners = new Set<() => void>()
  private idbStore: UseStore | null = null
  private warningFired = new Map<string, number>()
  /** Estimated cost of in-flight requests per user (prevents concurrent overspend) */
  private inflightByUser = new Map<string, number>()
  /** Monotonic version counter — incremented on every state change */
  private _version = 0
  /** Cached snapshots per user, invalidated when _version or time bucket changes */
  private _snapshotCache = new Map<string, { version: number; timeBucket: number; snapshot: UserBudgetStatus }>()

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
    this._version++
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
   *
   * A limit value of 0 means "no limit" for that time window — only positive
   * limits are enforced.
   */
  check(userId: string, modelId?: string, estimatedInputTokens?: number, estimatedOutputTokens?: number): {
    allowed: boolean
    reason?: string
    status: UserBudgetStatus
  } {
    const status = this.getStatus(userId)

    // No user ID — always allow (nothing to track)
    if (!userId) {
      return { allowed: true, status }
    }

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

    // Helper: safe percentage capped at 999 to avoid Infinity in event payloads
    const pct = (value: number, limit: number) =>
      limit > 0 ? Math.min((value / limit) * 100, 999) : 0

    const now = Date.now()

    // Evict stale warning entries to prevent unbounded map growth
    if (this.warningFired.size > MAX_WARNING_MAP_SIZE) {
      // First pass: remove expired entries (>30 days old)
      for (const [key, time] of this.warningFired) {
        if (now - time > THIRTY_DAYS_MS) this.warningFired.delete(key)
      }
      // Hard cap: if still over limit, evict oldest entries (FIFO)
      if (this.warningFired.size > MAX_WARNING_MAP_SIZE) {
        const excess = this.warningFired.size - MAX_WARNING_MAP_SIZE
        let evicted = 0
        for (const key of this.warningFired.keys()) {
          if (evicted >= excess) break
          this.warningFired.delete(key)
          evicted++
        }
      }
    }

    // Include in-flight cost from concurrent requests that haven't completed yet
    const inflight = this.inflightByUser.get(userId) ?? 0

    // Check daily limit (0 = no daily limit)
    if (status.limits.daily > 0) {
      const projectedDaily = status.spend.daily + estimatedCostDollars + inflight
      const dailyWarningKey = `${userId}-daily`
      // Reset daily warning if it was fired more than 24 hours ago
      const dailyWarningTime = this.warningFired.get(dailyWarningKey)
      if (dailyWarningTime !== undefined && now - dailyWarningTime > ONE_DAY_MS) {
        this.warningFired.delete(dailyWarningKey)
      }
      if (projectedDaily >= status.limits.daily * 0.8 && !this.warningFired.has(dailyWarningKey)) {
        this.warningFired.set(dailyWarningKey, now)
        const warningEvent = {
          limitType: "daily" as const,
          currentSpend: status.spend.daily,
          limit: status.limits.daily,
          percentUsed: pct(projectedDaily, status.limits.daily),
          timestamp: Date.now(),
        }
        this.config.onBudgetWarning?.(userId, warningEvent)
        shieldEvents.emit('userBudget:warning', { userId, limitType: warningEvent.limitType, currentSpend: warningEvent.currentSpend, limit: warningEvent.limit, percentUsed: warningEvent.percentUsed })
      }
      if (projectedDaily >= status.limits.daily) {
        const exceededEvent = {
          limitType: "daily" as const,
          currentSpend: status.spend.daily,
          limit: status.limits.daily,
          percentUsed: pct(projectedDaily, status.limits.daily),
          timestamp: Date.now(),
        }
        this.config.onBudgetExceeded?.(userId, exceededEvent)
        shieldEvents.emit('userBudget:exceeded', { userId, limitType: exceededEvent.limitType, currentSpend: exceededEvent.currentSpend, limit: exceededEvent.limit })
        return {
          allowed: false,
          reason: `User ${userId} daily budget exceeded ($${status.spend.daily.toFixed(4)} / $${status.limits.daily.toFixed(2)})`,
          status,
        }
      }
    }

    // Check monthly limit (0 = no monthly limit)
    if (status.limits.monthly > 0) {
      const projectedMonthly = status.spend.monthly + estimatedCostDollars + inflight
      const monthlyWarningKey = `${userId}-monthly`
      // Reset monthly warning if it was fired more than 30 days ago
      const monthlyWarningTime = this.warningFired.get(monthlyWarningKey)
      if (monthlyWarningTime !== undefined && now - monthlyWarningTime > THIRTY_DAYS_MS) {
        this.warningFired.delete(monthlyWarningKey)
      }
      if (projectedMonthly >= status.limits.monthly * 0.8 && !this.warningFired.has(monthlyWarningKey)) {
        this.warningFired.set(monthlyWarningKey, now)
        const warningEvent = {
          limitType: "monthly" as const,
          currentSpend: status.spend.monthly,
          limit: status.limits.monthly,
          percentUsed: pct(projectedMonthly, status.limits.monthly),
          timestamp: Date.now(),
        }
        this.config.onBudgetWarning?.(userId, warningEvent)
        shieldEvents.emit('userBudget:warning', { userId, limitType: warningEvent.limitType, currentSpend: warningEvent.currentSpend, limit: warningEvent.limit, percentUsed: warningEvent.percentUsed })
      }
      if (projectedMonthly >= status.limits.monthly) {
        const exceededEvent = {
          limitType: "monthly" as const,
          currentSpend: status.spend.monthly,
          limit: status.limits.monthly,
          percentUsed: pct(projectedMonthly, status.limits.monthly),
          timestamp: Date.now(),
        }
        this.config.onBudgetExceeded?.(userId, exceededEvent)
        shieldEvents.emit('userBudget:exceeded', { userId, limitType: exceededEvent.limitType, currentSpend: exceededEvent.currentSpend, limit: exceededEvent.limit })
        return {
          allowed: false,
          reason: `User ${userId} monthly budget exceeded ($${status.spend.monthly.toFixed(4)} / $${status.limits.monthly.toFixed(2)})`,
          status,
        }
      }
    }

    // Reserve estimated cost as in-flight to prevent concurrent overspend
    if (estimatedCostDollars > 0) {
      this.inflightByUser.set(userId, inflight + estimatedCostDollars)
      // Invalidate snapshot cache so next getStatus() reflects the new inflight
      // (no notify() — this is a read-path change, not a state mutation for React)
      this._snapshotCache.delete(userId)
      // FIFO eviction: remove the oldest entry when the map exceeds capacity
      if (this.inflightByUser.size > MAX_TRACKED_USERS) {
        const oldest = this.inflightByUser.keys().next().value
        if (oldest !== undefined) this.inflightByUser.delete(oldest)
      }
    }

    return { allowed: true, status }
  }

  /**
   * Record actual spending after a request completes.
   * Clears any in-flight reservation for this user.
   *
   * @param estimatedCost - The estimated cost that was reserved as in-flight by check().
   *   When provided, this amount (not the actual cost) is subtracted from in-flight
   *   to prevent phantom accumulation from estimation inaccuracies.
   */
  async recordSpend(userId: string, cost: number, model: string, estimatedCost?: number): Promise<void> {
    if (cost < 0) return // Ignore negative costs
    if (!userId) return // Ignore empty user IDs

    // Always clear in-flight reservation, even for zero-cost responses.
    // Use estimatedCost (what was reserved) rather than actual cost to prevent
    // phantom in-flight accumulation from estimation inaccuracies.
    const inflight = this.inflightByUser.get(userId) ?? 0
    if (inflight > 0) {
      const inflightRelease = estimatedCost ?? cost
      const remaining = Math.max(0, inflight - inflightRelease)
      if (remaining > 0) {
        this.inflightByUser.set(userId, remaining)
      } else {
        this.inflightByUser.delete(userId)
      }
    }

    // Skip creating a record for zero-cost responses
    if (cost === 0) return

    const record: UserSpendRecord = {
      timestamp: Date.now(),
      cost,
      model,
      userId,
    }

    this.records.push(record)

    // Clean up old records (keep last 30 days)
    const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS
    this.records = this.records.filter((r) => r.timestamp > thirtyDaysAgo)

    // Persist to IndexedDB
    if (this.idbStore) {
      try {
        await set("user-budget-records", this.records, this.idbStore)
      } catch {
        // IDB write failed, data still in memory
      }
    }

    shieldEvents.emit('userBudget:spend', { userId, cost, model })
    this.notify()
  }

  /**
   * Release in-flight cost reservation without recording actual spend.
   * Call this when a request fails/is cancelled and recordSpend won't be called.
   */
  releaseInflight(userId: string, estimatedCost: number): void {
    if (!userId || estimatedCost <= 0) return
    const inflight = this.inflightByUser.get(userId) ?? 0
    if (inflight > 0) {
      const remaining = Math.max(0, inflight - estimatedCost)
      if (remaining > 0) {
        this.inflightByUser.set(userId, remaining)
      } else {
        this.inflightByUser.delete(userId)
      }
      // Invalidate snapshot cache so next getStatus() reflects released inflight
      this._snapshotCache.delete(userId)
    }
  }

  /**
   * Get comprehensive budget status for a user.
   * Returns the same object reference if the underlying data hasn't changed,
   * making it safe for use with React's useSyncExternalStore.
   *
   * Snapshots are cached per version and refreshed every ~10 seconds
   * so that time-window expiry of old records is reflected.
   */
  getStatus(userId: string): UserBudgetStatus {
    // 10-second freshness window ensures expired records are excluded
    const timeBucket = Math.floor(Date.now() / 10_000)

    // Return cached snapshot if version and time bucket haven't changed
    const cached = this._snapshotCache.get(userId)
    if (cached && cached.version === this._version && cached.timeBucket === timeBucket) {
      return cached.snapshot
    }

    // Evict all cache entries when the cache grows too large
    if (this._snapshotCache.size > MAX_CACHE_SIZE) {
      this._snapshotCache.clear()
    }

    const limits = this.resolveLimits(userId)
    const now = Date.now()
    const oneDayAgo = now - ONE_DAY_MS
    const thirtyDaysAgo = now - THIRTY_DAYS_MS

    let dailySpend = 0
    let monthlySpend = 0

    for (const r of this.records) {
      if (r.userId !== userId) continue
      if (r.timestamp >= oneDayAgo) dailySpend += r.cost
      if (r.timestamp >= thirtyDaysAgo) monthlySpend += r.cost
    }

    const tier = limits?.tier ?? "standard"
    const userInflight = this.inflightByUser.get(userId) ?? 0

    let snapshot: UserBudgetStatus

    if (!limits) {
      snapshot = {
        userId,
        limits: null,
        spend: { daily: dailySpend, monthly: monthlySpend },
        remaining: { daily: null, monthly: null },
        percentUsed: { daily: 0, monthly: 0 },
        isOverBudget: false,
        inflight: userInflight,
        tier,
      }
    } else {
      const dailyRemaining = limits.daily > 0 ? Math.max(0, limits.daily - dailySpend) : null
      const monthlyRemaining = limits.monthly > 0 ? Math.max(0, limits.monthly - monthlySpend) : null
      const dailyPercent = limits.daily > 0 ? Math.min((dailySpend / limits.daily) * 100, 999) : 0
      const monthlyPercent = limits.monthly > 0 ? Math.min((monthlySpend / limits.monthly) * 100, 999) : 0

      // isOverBudget accounts for in-flight; 0-limit means no limit for that window
      const dailyOver = limits.daily > 0 && (dailySpend + userInflight) >= limits.daily
      const monthlyOver = limits.monthly > 0 && (monthlySpend + userInflight) >= limits.monthly

      snapshot = {
        userId,
        limits,
        spend: { daily: dailySpend, monthly: monthlySpend },
        remaining: { daily: dailyRemaining, monthly: monthlyRemaining },
        percentUsed: { daily: dailyPercent, monthly: monthlyPercent },
        isOverBudget: dailyOver || monthlyOver,
        inflight: userInflight,
        tier,
      }
    }

    // If cached snapshot has identical values, keep the old reference
    if (cached &&
      cached.snapshot.spend.daily === snapshot.spend.daily &&
      cached.snapshot.spend.monthly === snapshot.spend.monthly &&
      cached.snapshot.isOverBudget === snapshot.isOverBudget &&
      cached.snapshot.inflight === snapshot.inflight &&
      cached.snapshot.tier === snapshot.tier &&
      cached.snapshot.limits === snapshot.limits
    ) {
      this._snapshotCache.set(userId, { version: this._version, timeBucket, snapshot: cached.snapshot })
      return cached.snapshot
    }

    this._snapshotCache.set(userId, { version: this._version, timeBucket, snapshot })
    return snapshot
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
   * Merges with any records already in memory to avoid losing
   * spend data from requests that arrived before hydration completed.
   */
  async hydrate(): Promise<number> {
    if (!this.idbStore) return 0
    try {
      const persisted = await get<UserSpendRecord[]>("user-budget-records", this.idbStore)
      if (persisted && persisted.length > 0) {
        const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS
        const validPersisted = persisted.filter((r: UserSpendRecord) => r.timestamp > thirtyDaysAgo)

        // Merge: keep any in-memory records that were added while hydration was in flight.
        // Deduplicate by checking timestamp+userId+cost+model.
        const existingKeys = new Set(
          this.records.map((r) => `${r.userId}:${r.timestamp}:${r.cost}:${r.model}`)
        )
        const merged = [...this.records]
        for (const r of validPersisted) {
          const key = `${r.userId}:${r.timestamp}:${r.cost}:${r.model}`
          if (!existingKeys.has(key)) {
            merged.push(r)
          }
        }
        this.records = merged
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
    this._snapshotCache.delete(userId)
    this.notify()
  }

  /**
   * Reset spend records for a specific user.
   */
  async resetUser(userId: string): Promise<void> {
    this.records = this.records.filter((r) => r.userId !== userId)
    this.warningFired.delete(`${userId}-daily`)
    this.warningFired.delete(`${userId}-monthly`)
    this.inflightByUser.delete(userId)
    this._snapshotCache.delete(userId)

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
    this.inflightByUser.clear()
    this._snapshotCache.clear()

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
