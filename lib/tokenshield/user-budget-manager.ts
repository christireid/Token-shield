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

import { get, set, createStore, type UseStore } from "./storage-adapter"
import { estimateCost } from "./cost-estimator"
import { shieldEvents } from "./event-bus"

import {
  type UserBudgetLimits,
  type UserBudgetConfig,
  type UserBudgetStatus,
  type UserSpendRecord,
  ONE_DAY_MS,
  THIRTY_DAYS_MS,
  MAX_CACHE_SIZE,
  MAX_TRACKED_USERS,
  MAX_BUDGET_RECORDS,
  budgetPct,
  resolveUserLimits,
  computeSpendWindows,
  buildBudgetSnapshot,
  evictStaleWarnings,
} from "./user-budget-types"

// Re-export all public types so existing imports from "./user-budget-manager" still work
export type {
  UserBudgetTier,
  UserBudgetLimits,
  UserBudgetConfig,
  BudgetExceededEvent,
  BudgetWarningEvent,
  UserBudgetStatus,
} from "./user-budget-types"

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

    const now = Date.now()

    // Evict stale warning entries to prevent unbounded map growth
    evictStaleWarnings(this.warningFired, now)

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
          percentUsed: budgetPct(projectedDaily, status.limits.daily),
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
          percentUsed: budgetPct(projectedDaily, status.limits.daily),
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
          percentUsed: budgetPct(projectedMonthly, status.limits.monthly),
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
          percentUsed: budgetPct(projectedMonthly, status.limits.monthly),
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

    // Return fresh status that includes the just-reserved inflight
    return { allowed: true, status: estimatedCostDollars > 0 ? this.getStatus(userId) : status }
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

    // Skip creating a record for zero-cost responses, but still notify
    // so that React subscribers see the inflight release
    if (cost === 0) {
      this.notify()
      return
    }

    const record: UserSpendRecord = {
      timestamp: Date.now(),
      cost,
      model,
      userId,
    }

    this.records.push(record)

    // Clean up old records (keep last 30 days) + enforce hard cap
    const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS
    this.records = this.records.filter((r) => r.timestamp > thirtyDaysAgo)
    if (this.records.length > MAX_BUDGET_RECORDS) {
      this.records = this.records.slice(-MAX_BUDGET_RECORDS)
    }

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

    const limits = resolveUserLimits(this.config, userId)
    const now = Date.now()
    const spend = computeSpendWindows(this.records, userId, now)
    const userInflight = this.inflightByUser.get(userId) ?? 0
    const snapshot = buildBudgetSnapshot(userId, limits, spend, userInflight)

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
    const limits = resolveUserLimits(this.config, userId)
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
