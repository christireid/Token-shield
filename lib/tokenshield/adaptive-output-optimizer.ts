/**
 * TokenShield - Adaptive Output Optimizer
 *
 * Learns from actual API responses to predict output token length more
 * accurately over time. Sets tight `max_tokens` per request instead of
 * blanket 4096, saving money on providers that pre-allocate output tokens.
 *
 * UNIQUE IP: No competing tool does client-side adaptive output learning.
 * - Helicone/Portkey: server-side analytics only, no per-request optimization
 * - LiteLLM: no output prediction at all
 * - The existing output-predictor.ts uses static regex patterns
 *
 * This module improves on the static predictor by:
 * 1. Tracking actual output lengths per (taskType, model) pair
 * 2. Using exponential moving average (EMA) to adapt predictions
 * 3. Maintaining percentile-based safety margins (p95, not blanket 1.5x)
 * 4. Persisting learned statistics to IndexedDB across sessions
 * 5. Automatically tightening max_tokens as confidence grows
 *
 * All client-side. Zero network overhead. Zero backend.
 */

import { get, set } from "./storage-adapter"
import { predictOutputTokens, type OutputPrediction } from "./output-predictor"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface AdaptiveOptimizerConfig {
  /** Minimum number of observations before overriding static prediction. Default: 5 */
  minObservations?: number
  /** EMA smoothing factor (0-1). Higher = faster adaptation. Default: 0.15 */
  alpha?: number
  /** Safety margin percentile (0-1). 0.95 = p95 of observed outputs. Default: 0.95 */
  safetyPercentile?: number
  /** Absolute minimum max_tokens to never go below. Default: 32 */
  absoluteMin?: number
  /** Absolute maximum max_tokens to never exceed. Default: 8192 */
  absoluteMax?: number
  /** Persist learned stats to IndexedDB. Default: true */
  persist?: boolean
  /** IndexedDB key prefix. Default: "shield_adaptive_output" */
  storageKey?: string
}

/** Per-(taskType, model) learned statistics */
export interface OutputStats {
  /** Task type key (from output-predictor.ts) */
  taskType: string
  /** Model ID */
  model: string
  /** Number of observations */
  count: number
  /** Exponential moving average of actual output tokens */
  ema: number
  /** Running variance for standard deviation calculation */
  emVar: number
  /** All observed output lengths (capped at last 100 for percentile) */
  observations: number[]
  /** Last updated timestamp */
  updatedAt: number
}

export interface AdaptivePrediction {
  /** The predicted output tokens (from adaptive learning or static fallback) */
  predictedTokens: number
  /** Suggested max_tokens value with safety margin */
  suggestedMaxTokens: number
  /** Whether this prediction is from learned data or static fallback */
  source: "adaptive" | "static"
  /** Confidence level */
  confidence: "high" | "medium" | "low"
  /** Number of observations this prediction is based on */
  observations: number
  /** Estimated tokens saved vs blanket max (absoluteMax, default 8192) */
  savingsVsBlanket: number
  /** The task type detected */
  taskType: string
  /** Standard deviation of observed outputs (0 if static) */
  stdDev: number
}

const DEFAULT_CONFIG: Required<AdaptiveOptimizerConfig> = {
  minObservations: 5,
  alpha: 0.15,
  safetyPercentile: 0.95,
  absoluteMin: 32,
  absoluteMax: 8192,
  persist: true,
  storageKey: "shield_adaptive_output",
}

// -------------------------------------------------------
// Adaptive Output Optimizer
// -------------------------------------------------------

export class AdaptiveOutputOptimizer {
  private config: Required<AdaptiveOptimizerConfig>
  /** Learned stats keyed by "taskType:model" */
  private stats = new Map<string, OutputStats>()
  private isHydrated = false

  constructor(config?: AdaptiveOptimizerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Hydrate learned stats from IndexedDB. Call once on startup. */
  async hydrate(): Promise<number> {
    if (!this.config.persist) {
      this.isHydrated = true
      return 0
    }
    try {
      const stored = await get<[string, OutputStats][]>(this.config.storageKey)
      if (stored && Array.isArray(stored)) {
        this.stats = new Map(stored)
        this.isHydrated = true
        return stored.length
      }
    } catch { /* IDB not available */ }
    this.isHydrated = true
    return 0
  }

  /**
   * Predict output tokens for a prompt, using learned data if available.
   *
   * Falls back to the static predictor when insufficient observations exist.
   * As more observations are recorded via `recordActual()`, predictions
   * become tighter and more accurate.
   */
  predict(prompt: string, model: string): AdaptivePrediction {
    // Get the static prediction to determine task type
    const staticPred = predictOutputTokens(prompt)
    const key = `${staticPred.taskType}:${model}`
    const stats = this.stats.get(key)

    // Not enough data — fall back to static
    if (!stats || stats.count < this.config.minObservations) {
      return {
        predictedTokens: staticPred.predictedTokens,
        suggestedMaxTokens: staticPred.suggestedMaxTokens,
        source: "static",
        confidence: staticPred.confidence,
        observations: stats?.count ?? 0,
        savingsVsBlanket: this.config.absoluteMax - staticPred.suggestedMaxTokens,
        taskType: staticPred.taskType,
        stdDev: 0,
      }
    }

    // Use adaptive prediction
    const predicted = Math.round(stats.ema)
    const stdDev = Math.sqrt(stats.emVar)

    // Calculate percentile-based safety margin
    const sorted = [...stats.observations].sort((a, b) => a - b)
    const percentileIdx = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * this.config.safetyPercentile)
    )
    const percentileValue = sorted[percentileIdx]

    // Use the larger of: EMA + 1 stddev, or the observed percentile
    const safeMax = Math.max(
      Math.round(stats.ema + stdDev),
      percentileValue
    )

    // Clamp to absolute bounds
    const suggested = Math.min(
      this.config.absoluteMax,
      Math.max(this.config.absoluteMin, safeMax)
    )

    // Determine confidence based on observation count and variance
    const cv = stats.ema > 0 ? stdDev / stats.ema : 1 // coefficient of variation
    let confidence: "high" | "medium" | "low"
    if (stats.count >= 20 && cv < 0.3) {
      confidence = "high"
    } else if (stats.count >= 10 && cv < 0.5) {
      confidence = "medium"
    } else {
      confidence = "low"
    }

    return {
      predictedTokens: predicted,
      suggestedMaxTokens: suggested,
      source: "adaptive",
      confidence,
      observations: stats.count,
      savingsVsBlanket: this.config.absoluteMax - suggested,
      taskType: staticPred.taskType,
      stdDev: Math.round(stdDev),
    }
  }

  /**
   * Record an actual output token count after an API response.
   * Updates the EMA and running variance for the (taskType, model) pair.
   */
  async recordActual(
    prompt: string,
    model: string,
    actualOutputTokens: number
  ): Promise<void> {
    const staticPred = predictOutputTokens(prompt)
    const key = `${staticPred.taskType}:${model}`
    const existing = this.stats.get(key)

    if (existing) {
      // Update EMA: new_ema = alpha * actual + (1 - alpha) * old_ema
      const alpha = this.config.alpha
      const oldEma = existing.ema
      const newEma = alpha * actualOutputTokens + (1 - alpha) * oldEma

      // Update exponential moving variance (Welford's online algorithm adapted for EMA)
      const diff = actualOutputTokens - oldEma
      const newEmVar = (1 - alpha) * (existing.emVar + alpha * diff * diff)

      // Keep last 100 observations for percentile calculation.
      // Avoid spread+shift (both create copies/shift O(n)). Mutate in-place.
      existing.observations.push(actualOutputTokens)
      if (existing.observations.length > 100) {
        existing.observations.shift()
      }
      const observations = existing.observations

      existing.count++
      existing.ema = newEma
      existing.emVar = newEmVar
      existing.observations = observations
      existing.updatedAt = Date.now()
    } else {
      // First observation for this (taskType, model) pair
      this.stats.set(key, {
        taskType: staticPred.taskType,
        model,
        count: 1,
        ema: actualOutputTokens,
        emVar: 0,
        observations: [actualOutputTokens],
        updatedAt: Date.now(),
      })
    }

    if (this.config.persist) {
      await this.persistAsync()
    }
  }

  /** Get all learned statistics. */
  getStats(): Map<string, OutputStats> {
    return new Map(this.stats)
  }

  /** Get stats for a specific (taskType, model) pair. */
  getStatsForKey(taskType: string, model: string): OutputStats | undefined {
    return this.stats.get(`${taskType}:${model}`)
  }

  /** Get a summary of all learned task types. */
  summary(): {
    totalTaskTypes: number
    totalObservations: number
    entries: { key: string; count: number; avgTokens: number; stdDev: number }[]
  } {
    let totalObs = 0
    const entries: { key: string; count: number; avgTokens: number; stdDev: number }[] = []

    for (const [key, stats] of this.stats) {
      totalObs += stats.count
      entries.push({
        key,
        count: stats.count,
        avgTokens: Math.round(stats.ema),
        stdDev: Math.round(Math.sqrt(stats.emVar)),
      })
    }

    return {
      totalTaskTypes: this.stats.size,
      totalObservations: totalObs,
      entries: entries.sort((a, b) => b.count - a.count),
    }
  }

  /** Clear all learned data. */
  async clear(): Promise<void> {
    this.stats.clear()
    if (this.config.persist) {
      try { await set(this.config.storageKey, []) } catch { /* IDB not available */ }
    }
  }

  /** Check if hydrated from storage. */
  get hydrated(): boolean {
    return this.isHydrated
  }

  private persistAsync(): Promise<void> {
    return set(this.config.storageKey, [...this.stats.entries()]).catch(() => {})
  }
}
