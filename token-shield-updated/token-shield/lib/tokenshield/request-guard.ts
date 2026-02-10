/**
 * TokenShield - Request Guard
 *
 * Prevents wasteful API calls at the request level:
 * - Debouncing: collapses rapid-fire requests into one
 * - Deduplication: detects identical in-flight requests
 * - AbortController: cancels superseded requests
 * - Rate limiting: enforces requests-per-minute budgets
 * - Cost gate: blocks requests that would exceed a dollar budget
 *
 * Every prevented request = 100% savings on that call.
 */

import { countTokens } from "gpt-tokenizer"
import { estimateCost } from "./cost-estimator"

export interface GuardConfig {
  /** Minimum ms between API calls */
  debounceMs: number
  /** Max requests per minute */
  maxRequestsPerMinute: number
  /** Max dollar spend per hour */
  maxCostPerHour: number
  /** Model ID for cost calculations */
  modelId: string
  /** Whether to deduplicate identical in-flight prompts */
  deduplicateInFlight: boolean

  /**
   * Minimum number of characters required in a prompt.
   * Prompts shorter than this are rejected immediately. Default: 2
   */
  minInputLength?: number

  /**
   * Maximum number of tokens allowed for a prompt. If the prompt exceeds
   * this value, the request is blocked before any API call is made.
   * Use Infinity (or omit) to disable. Default: Infinity
   */
  maxInputTokens?: number

  /**
   * Window in milliseconds during which identical prompts are deduplicated.
   * If a prompt identical to one sent within this window is received,
   * the new request is blocked even if the previous call has completed.
   * Default: 0 (no time‑based deduplication). A value of 5000 will dedup
   * identical prompts for five seconds.
   */
  deduplicateWindow?: number
}

export interface GuardResult {
  allowed: boolean
  reason?: string
  /** How many requests were blocked since last allowed */
  blockedCount: number
  /** Estimated cost this request would have incurred */
  estimatedCost: number
  /** Current spend in the active hour window */
  currentHourlySpend: number
}

interface InFlightRequest {
  prompt: string
  controller: AbortController
  startedAt: number
}

const DEFAULT_CONFIG: GuardConfig = {
  debounceMs: 300,
  maxRequestsPerMinute: 30,
  maxCostPerHour: 5.0,
  modelId: "gpt-4o-mini",
  deduplicateInFlight: true,

  // Enforce a minimal prompt length of 2 characters by default
  minInputLength: 2,
  // No hard limit on input tokens by default
  maxInputTokens: Infinity,
  // No time‑window deduplication by default
  deduplicateWindow: 0,
}

export class RequestGuard {
  private config: GuardConfig
  private lastRequestTime = 0
  private requestTimestamps: number[] = []
  private costLog: { timestamp: number; cost: number }[] = []
  private inFlight = new Map<string, InFlightRequest>()
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private blockedCount = 0
  private totalBlocked = 0
  private totalSaved = 0

  /**
   * Track recently processed prompts for time‑based deduplication.
   * Maps normalized prompt -> timestamp of last request.
   */
  private recentPrompts = new Map<string, number>()

  constructor(config: Partial<GuardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if a request should proceed. Returns a gate decision
   * with the reason if blocked.
   */
  check(prompt: string, expectedOutputTokens = 500): GuardResult {
    const now = Date.now()
    const inputTokens = countTokens(prompt)
    const cost = estimateCost(
      this.config.modelId,
      inputTokens,
      expectedOutputTokens
    )

    const normalized = prompt.trim().toLowerCase()

    // 0. Minimum length check
    const minLen = this.config.minInputLength ?? DEFAULT_CONFIG.minInputLength
    if (minLen !== undefined && prompt.trim().length < minLen) {
      this.blockedCount++
      this.totalBlocked++
      this.totalSaved += cost.totalCost
      return {
        allowed: false,
        reason: `Too short: ${prompt.trim().length} chars < ${minLen}`,
        blockedCount: this.blockedCount,
        estimatedCost: cost.totalCost,
        currentHourlySpend: this.getCurrentHourlySpend(),
      }
    }

    // 0.5 Maximum token check
    const maxTok = this.config.maxInputTokens ?? DEFAULT_CONFIG.maxInputTokens
    if (maxTok !== undefined && Number.isFinite(maxTok) && inputTokens > maxTok) {
      this.blockedCount++
      this.totalBlocked++
      this.totalSaved += cost.totalCost
      return {
        allowed: false,
        reason: `Over budget: ${inputTokens} tokens > ${maxTok}`,
        blockedCount: this.blockedCount,
        estimatedCost: cost.totalCost,
        currentHourlySpend: this.getCurrentHourlySpend(),
      }
    }

    // Time-based deduplication check
    const dedupWindow = this.config.deduplicateWindow ?? DEFAULT_CONFIG.deduplicateWindow
    if (dedupWindow && this.recentPrompts.has(normalized)) {
      const lastTime = this.recentPrompts.get(normalized)!
      if (now - lastTime < dedupWindow) {
        this.blockedCount++
        this.totalBlocked++
        this.totalSaved += cost.totalCost
        return {
          allowed: false,
          reason: `Deduped: identical prompt within ${dedupWindow}ms window`,
          blockedCount: this.blockedCount,
          estimatedCost: cost.totalCost,
          currentHourlySpend: this.getCurrentHourlySpend(),
        }
      }
    }
    // 1. Debounce check
    if (now - this.lastRequestTime < this.config.debounceMs) {
      this.blockedCount++
      this.totalBlocked++
      this.totalSaved += cost.totalCost
      return {
        allowed: false,
        reason: `Debounced: ${now - this.lastRequestTime}ms since last request (min: ${this.config.debounceMs}ms)`,
        blockedCount: this.blockedCount,
        estimatedCost: cost.totalCost,
        currentHourlySpend: this.getCurrentHourlySpend(),
      }
    }

    // 2. Rate limit check
    const oneMinuteAgo = now - 60_000
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => t > oneMinuteAgo
    )
    if (
      this.requestTimestamps.length >= this.config.maxRequestsPerMinute
    ) {
      this.blockedCount++
      this.totalBlocked++
      this.totalSaved += cost.totalCost
      return {
        allowed: false,
        reason: `Rate limited: ${this.requestTimestamps.length}/${this.config.maxRequestsPerMinute} requests in the last minute`,
        blockedCount: this.blockedCount,
        estimatedCost: cost.totalCost,
        currentHourlySpend: this.getCurrentHourlySpend(),
      }
    }

    // 3. Cost gate check
    const currentSpend = this.getCurrentHourlySpend()
    if (currentSpend + cost.totalCost > this.config.maxCostPerHour) {
      this.blockedCount++
      this.totalBlocked++
      this.totalSaved += cost.totalCost
      return {
        allowed: false,
        reason: `Cost gate: would exceed hourly budget ($${(currentSpend + cost.totalCost).toFixed(4)} > $${this.config.maxCostPerHour.toFixed(2)})`,
        blockedCount: this.blockedCount,
        estimatedCost: cost.totalCost,
        currentHourlySpend: currentSpend,
      }
    }

    // 4. Deduplication check
    if (this.config.deduplicateInFlight) {
      const existing = this.inFlight.get(normalized)
      if (existing) {
        this.blockedCount++
        this.totalBlocked++
        this.totalSaved += cost.totalCost
        return {
          allowed: false,
          reason: "Deduplicated: identical request already in flight",
          blockedCount: this.blockedCount,
          estimatedCost: cost.totalCost,
          currentHourlySpend: currentSpend,
        }
      }
    }

    // Allowed - record this request
    this.lastRequestTime = now
    this.requestTimestamps.push(now)
    this.blockedCount = 0

    // Record this prompt for time-based deduplication
    if (dedupWindow) {
      this.recentPrompts.set(normalized, now)
      // Purge entries older than the window to prevent unbounded growth
      const cutoff = now - dedupWindow
      for (const [p, ts] of this.recentPrompts) {
        if (ts < cutoff) this.recentPrompts.delete(p)
      }
    }

    return {
      allowed: true,
      blockedCount: 0,
      estimatedCost: cost.totalCost,
      currentHourlySpend: currentSpend,
    }
  }

  /**
   * Register a request as in-flight. Returns an AbortController
   * that can be used to cancel it if a newer request supersedes it.
   */
  startRequest(prompt: string): AbortController {
    const normalized = prompt.trim().toLowerCase()

    // Cancel any existing request with the same prompt
    const existing = this.inFlight.get(normalized)
    if (existing) {
      existing.controller.abort()
    }

    const controller = new AbortController()
    this.inFlight.set(normalized, {
      prompt: normalized,
      controller,
      startedAt: Date.now(),
    })

    return controller
  }

  /**
   * Mark a request as completed and log its cost.
   */
  completeRequest(
    prompt: string,
    actualInputTokens: number,
    actualOutputTokens: number
  ): void {
    const normalized = prompt.trim().toLowerCase()
    this.inFlight.delete(normalized)

    const cost = estimateCost(
      this.config.modelId,
      actualInputTokens,
      actualOutputTokens
    )
    this.costLog.push({ timestamp: Date.now(), cost: cost.totalCost })
  }

  /**
   * Create a debounced version of a function that only calls through
   * after the debounce period. Previous calls are aborted.
   *
   * When a new call supersedes a pending one, the previous promise
   * resolves with null immediately (it does not hang).
   */
  debounce<T>(
    fn: (prompt: string, signal: AbortSignal) => Promise<T>
  ): (prompt: string) => Promise<T | null> {
    let pendingController: AbortController | null = null
    let pendingResolve: ((value: T | null) => void) | null = null

    return (prompt: string) => {
      return new Promise<T | null>((resolve, reject) => {
        // Resolve the superseded call with null so its promise doesn't hang
        if (pendingResolve) {
          pendingResolve(null)
          pendingResolve = null
        }
        // Cancel previous in-flight request
        if (pendingController) {
          pendingController.abort()
        }
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer)
        }

        pendingResolve = resolve

        this.debounceTimer = setTimeout(async () => {
          pendingResolve = null

          const guardResult = this.check(prompt)
          if (!guardResult.allowed) {
            resolve(null)
            return
          }

          pendingController = this.startRequest(prompt)
          try {
            const result = await fn(prompt, pendingController.signal)
            resolve(result)
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              resolve(null)
            } else {
              reject(err)
            }
          }
        }, this.config.debounceMs)
      })
    }
  }

  private getCurrentHourlySpend(): number {
    const oneHourAgo = Date.now() - 3_600_000
    this.costLog = this.costLog.filter((c) => c.timestamp > oneHourAgo)
    return this.costLog.reduce((sum, c) => sum + c.cost, 0)
  }

  /**
   * Get guard statistics.
   */
  stats(): {
    totalBlocked: number
    totalSavedDollars: number
    currentRequestsPerMinute: number
    currentHourlySpend: number
    inFlightCount: number
  } {
    const oneMinuteAgo = Date.now() - 60_000
    return {
      totalBlocked: this.totalBlocked,
      totalSavedDollars: this.totalSaved,
      currentRequestsPerMinute: this.requestTimestamps.filter(
        (t) => t > oneMinuteAgo
      ).length,
      currentHourlySpend: this.getCurrentHourlySpend(),
      inFlightCount: this.inFlight.size,
    }
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<GuardConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
