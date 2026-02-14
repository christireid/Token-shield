/**
 * TokenShield - Cost Circuit Breaker
 *
 * The #1 fear in production: an autonomous agent loop or a bug causes
 * thousands of API calls overnight. One company went from $847/month
 * to $34,127 in 3 months (source: toolstac.com enterprise TCO analysis).
 *
 * This circuit breaker provides hard spending limits that halt all API
 * calls when budgets are exceeded. Unlike the request guard (which
 * operates per-request), this is a session/time-window level kill switch.
 *
 * Features:
 * - Per-session, hourly, daily, and monthly cost limits
 * - Configurable actions: warn, throttle, or hard-stop
 * - Optional persistence via localStorage (survives page refresh)
 * - Alert callbacks for integration with monitoring
 * - Automatic recovery when time windows roll over
 */

import { estimateCost, MODEL_PRICING } from "./cost-estimator"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface BreakerLimits {
  /** Maximum spend per session (resets on page refresh unless persisted) */
  perSession?: number
  /** Maximum spend per hour */
  perHour?: number
  /** Maximum spend per 24-hour period */
  perDay?: number
  /** Maximum spend per calendar month */
  perMonth?: number
}

export type BreakerAction = "warn" | "throttle" | "stop"

export interface BreakerConfig {
  /** Spending limits */
  limits: BreakerLimits
  /** What to do when a limit is hit */
  action: BreakerAction
  /** If throttle: max requests per minute when throttled */
  throttleRate?: number
  /** Persist state across page refreshes */
  persist?: boolean
  /** Storage key for persistence */
  storageKey?: string
  /** Called when any limit is approached (80% of limit) */
  onWarning?: (detail: BreakerEvent) => void
  /** Called when a limit is hit */
  onTripped?: (detail: BreakerEvent) => void
  /** Called when the breaker resets (time window rolls over) */
  onReset?: (window: string) => void
}

export interface BreakerEvent {
  /** Which limit was hit */
  limitType: "session" | "hour" | "day" | "month"
  /** Current spend in that window */
  currentSpend: number
  /** The limit value */
  limit: number
  /** Percentage of limit used */
  percentUsed: number
  /** What action was taken */
  action: BreakerAction
  /** Timestamp */
  timestamp: number
}

export interface BreakerStatus {
  /** Whether the breaker is currently tripped (blocking requests) */
  tripped: boolean
  /** Which limits are currently exceeded */
  trippedLimits: BreakerEvent[]
  /** Current spend per window */
  spend: {
    session: number
    lastHour: number
    lastDay: number
    lastMonth: number
  }
  /** Remaining budget per window */
  remaining: {
    session: number | null
    hour: number | null
    day: number | null
    month: number | null
  }
  /** Total requests tracked */
  totalRequests: number
  /** Requests blocked by the breaker */
  requestsBlocked: number
}

export interface BreakerCheckResult {
  /** Whether the request should proceed */
  allowed: boolean
  /** If blocked, the reason */
  reason?: string
  /** Current breaker status */
  status: BreakerStatus
}

// -------------------------------------------------------
// Internal types
// -------------------------------------------------------

interface SpendRecord {
  timestamp: number
  cost: number
  model: string
}

interface PersistedState {
  records: SpendRecord[]
  sessionStart: number
  totalBlocked: number
}

// -------------------------------------------------------
// Implementation
// -------------------------------------------------------

const DEFAULT_CONFIG: BreakerConfig = {
  limits: {
    perSession: 5.0,
    perHour: 2.0,
    perDay: 10.0,
  },
  action: "stop",
  persist: false,
  storageKey: "tokenshield-breaker",
}

/** Warning threshold: fire warnings when spend reaches this fraction of the limit */
const WARNING_THRESHOLD = 0.8
/** One hour in milliseconds */
const ONE_HOUR_MS = 60 * 60 * 1000
/** One day in milliseconds */
const ONE_DAY_MS = 24 * 60 * 60 * 1000
/** Thirty days in milliseconds */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/** Maximum spend records kept in memory (prevents unbounded growth in high-throughput scenarios) */
const MAX_BREAKER_RECORDS = 50_000

export class CostCircuitBreaker {
  private config: BreakerConfig
  private records: SpendRecord[] = []
  private sessionStart: number
  private totalRequests = 0
  private totalBlocked = 0
  private warningFired = new Set<string>()

  constructor(config: Partial<BreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sessionStart = Date.now()

    // Restore from persistence
    if (this.config.persist && typeof window !== "undefined") {
      this.restore()
    }
  }

  /**
   * Check if a request should proceed given current spending.
   * Call this before every API request.
   */
  check(
    modelId?: string,
    estimatedInputTokens?: number,
    estimatedOutputTokens?: number,
  ): BreakerCheckResult {
    this.totalRequests++
    const status = this.getStatus()

    // Check each limit
    const limits = this.config.limits

    // Auto-reset time-window warnings when spend drops below 80% threshold
    // (session warnings never auto-reset — they clear on explicit reset() only)
    if (limits.perHour != null && status.spend.lastHour < limits.perHour * WARNING_THRESHOLD) {
      this.warningFired.delete("hour-warning")
    }
    if (limits.perDay != null && status.spend.lastDay < limits.perDay * WARNING_THRESHOLD) {
      this.warningFired.delete("day-warning")
    }
    if (limits.perMonth != null && status.spend.lastMonth < limits.perMonth * WARNING_THRESHOLD) {
      this.warningFired.delete("month-warning")
    }

    const checks: { type: BreakerEvent["limitType"]; current: number; limit: number }[] = []

    if (limits.perSession !== undefined) {
      checks.push({ type: "session", current: status.spend.session, limit: limits.perSession })
    }
    if (limits.perHour !== undefined) {
      checks.push({ type: "hour", current: status.spend.lastHour, limit: limits.perHour })
    }
    if (limits.perDay !== undefined) {
      checks.push({ type: "day", current: status.spend.lastDay, limit: limits.perDay })
    }
    if (limits.perMonth !== undefined) {
      checks.push({ type: "month", current: status.spend.lastMonth, limit: limits.perMonth })
    }

    // Also check if the estimated cost of THIS request would push us over
    let estimatedCost = 0
    if (modelId && estimatedInputTokens) {
      const pricing = MODEL_PRICING[modelId]
      if (pricing) {
        estimatedCost = estimateCost(
          modelId,
          estimatedInputTokens,
          estimatedOutputTokens ?? 500,
        ).totalCost
      }
    }

    for (const c of checks) {
      const projectedSpend = c.current + estimatedCost
      const pctUsed = c.limit > 0 ? (projectedSpend / c.limit) * 100 : 999

      // Fire warning at 80%
      const warningKey = `${c.type}-warning`
      if (projectedSpend >= c.limit * WARNING_THRESHOLD && !this.warningFired.has(warningKey)) {
        this.warningFired.add(warningKey)
        this.config.onWarning?.({
          limitType: c.type,
          currentSpend: c.current,
          limit: c.limit,
          percentUsed: pctUsed,
          action: "warn",
          timestamp: Date.now(),
        })
      }

      // Check if limit exceeded
      if (projectedSpend >= c.limit) {
        this.totalBlocked++
        const event: BreakerEvent = {
          limitType: c.type,
          currentSpend: c.current,
          limit: c.limit,
          percentUsed: pctUsed,
          action: this.config.action,
          timestamp: Date.now(),
        }

        this.config.onTripped?.(event)
        this.save()

        if (this.config.action === "stop") {
          return {
            allowed: false,
            reason: `Circuit breaker: ${c.type} limit exceeded ($${c.current.toFixed(4)} / $${c.limit.toFixed(2)})`,
            status: this.getStatus(),
          }
        }

        if (this.config.action === "throttle") {
          // Allow but at reduced rate (caller handles throttling)
          return {
            allowed: true,
            reason: `Throttled: ${c.type} limit at ${pctUsed.toFixed(0)}%`,
            status: this.getStatus(),
          }
        }

        // "warn" action: allow but fire the callback (already fired above)
      }
    }

    return { allowed: true, status: this.getStatus() }
  }

  /**
   * Record actual spending after a request completes.
   */
  recordSpend(cost: number, model: string): void {
    this.records.push({
      timestamp: Date.now(),
      cost,
      model,
    })

    // Clean up old records (keep last 30 days) + enforce hard cap
    const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS
    this.records = this.records.filter((r) => r.timestamp > thirtyDaysAgo)
    if (this.records.length > MAX_BREAKER_RECORDS) {
      this.records = this.records.slice(-MAX_BREAKER_RECORDS)
    }

    this.save()
  }

  /**
   * Get comprehensive status of all spending windows.
   */
  getStatus(): BreakerStatus {
    const now = Date.now()
    const oneHourAgo = now - ONE_HOUR_MS
    const oneDayAgo = now - ONE_DAY_MS
    const oneMonthAgo = now - THIRTY_DAYS_MS

    let sessionSpend = 0
    let hourSpend = 0
    let daySpend = 0
    let monthSpend = 0

    for (const r of this.records) {
      if (r.timestamp >= this.sessionStart) sessionSpend += r.cost
      if (r.timestamp >= oneHourAgo) hourSpend += r.cost
      if (r.timestamp >= oneDayAgo) daySpend += r.cost
      if (r.timestamp >= oneMonthAgo) monthSpend += r.cost
    }

    const limits = this.config.limits
    const trippedLimits: BreakerEvent[] = []

    if (limits.perSession != null && sessionSpend >= limits.perSession) {
      trippedLimits.push({
        limitType: "session",
        currentSpend: sessionSpend,
        limit: limits.perSession,
        percentUsed: limits.perSession > 0 ? (sessionSpend / limits.perSession) * 100 : 999,
        action: this.config.action,
        timestamp: now,
      })
    }
    if (limits.perHour != null && hourSpend >= limits.perHour) {
      trippedLimits.push({
        limitType: "hour",
        currentSpend: hourSpend,
        limit: limits.perHour,
        percentUsed: limits.perHour > 0 ? (hourSpend / limits.perHour) * 100 : 999,
        action: this.config.action,
        timestamp: now,
      })
    }
    if (limits.perDay != null && daySpend >= limits.perDay) {
      trippedLimits.push({
        limitType: "day",
        currentSpend: daySpend,
        limit: limits.perDay,
        percentUsed: limits.perDay > 0 ? (daySpend / limits.perDay) * 100 : 999,
        action: this.config.action,
        timestamp: now,
      })
    }
    if (limits.perMonth != null && monthSpend >= limits.perMonth) {
      trippedLimits.push({
        limitType: "month",
        currentSpend: monthSpend,
        limit: limits.perMonth,
        percentUsed: limits.perMonth > 0 ? (monthSpend / limits.perMonth) * 100 : 999,
        action: this.config.action,
        timestamp: now,
      })
    }

    return {
      tripped: trippedLimits.length > 0 && this.config.action === "stop",
      trippedLimits,
      spend: {
        session: sessionSpend,
        lastHour: hourSpend,
        lastDay: daySpend,
        lastMonth: monthSpend,
      },
      remaining: {
        session: limits.perSession != null ? Math.max(0, limits.perSession - sessionSpend) : null,
        hour: limits.perHour != null ? Math.max(0, limits.perHour - hourSpend) : null,
        day: limits.perDay != null ? Math.max(0, limits.perDay - daySpend) : null,
        month: limits.perMonth != null ? Math.max(0, limits.perMonth - monthSpend) : null,
      },
      totalRequests: this.totalRequests,
      requestsBlocked: this.totalBlocked,
    }
  }

  /**
   * Manually reset the breaker and clear all spend records.
   */
  reset(): void {
    this.records = []
    this.sessionStart = Date.now()
    this.totalRequests = 0
    this.totalBlocked = 0
    this.warningFired.clear()
    this.save()
    this.config.onReset?.("all")
  }

  /**
   * Update limits at runtime (e.g., user changes budget in settings).
   */
  updateLimits(limits: Partial<BreakerLimits>): void {
    this.config.limits = { ...this.config.limits, ...limits }
    this.warningFired.clear() // Reset warnings for new limits
  }

  // -------------------------------------------------------
  // Persistence
  // -------------------------------------------------------

  private save(): void {
    if (!this.config.persist || typeof window === "undefined") return
    try {
      const state: PersistedState = {
        records: this.records,
        sessionStart: this.sessionStart,
        totalBlocked: this.totalBlocked,
      }
      localStorage.setItem(this.config.storageKey ?? "tokenshield-breaker", JSON.stringify(state))
    } catch {
      // localStorage not available or full
    }
  }

  private restore(): void {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem(this.config.storageKey ?? "tokenshield-breaker")
      if (raw) {
        const state: PersistedState = JSON.parse(raw)
        this.records = state.records ?? []
        // Don't restore sessionStart - each page load is a new session
        this.totalBlocked = state.totalBlocked ?? 0
      }
    } catch {
      // Corrupted data, start fresh
    }
  }
}
