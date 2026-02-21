/**
 * TokenShield - Anomaly Detector
 *
 * Detects unusual spending patterns or token usage spikes in real-time.
 * Uses multiple detection strategies:
 * 1. Z-score: Statistical outlier detection (existing)
 * 2. EWMA (Exponentially Weighted Moving Average): Adapts faster to recent trends
 * 3. Rate-of-change: Detects sudden acceleration in spending
 * 4. Percentile-based: Flags values above the Nth percentile of the window
 *
 * Adaptive thresholds: sensitivity automatically adjusts based on data variance.
 * High-variance workloads get more lenient thresholds; low-variance get stricter.
 */

export interface AnomalyConfig {
  /** Window size for moving average (default: 20) */
  windowSize?: number
  /** Sensitivity threshold (Z-score). Higher = less sensitive. Default: 3.0 */
  sensitivity?: number
  /** Minimum cost to trigger anomaly detection (ignore cheap noise). Default: 0.01 */
  minCostThreshold?: number
  /** Ignore anomalies if cost is below this absolute value (safety floor). Default: 0.10 */
  ignoreBelowCost?: number
  /**
   * EWMA smoothing factor (0-1). Higher = more weight on recent values.
   * Default: 0.3. Set to 0 to disable EWMA detection.
   */
  ewmaAlpha?: number
  /**
   * Enable rate-of-change detection. Flags when consecutive values
   * increase by more than this multiplier (e.g., 3.0 = 3x jump).
   * Default: 3.0. Set to 0 to disable.
   */
  rateOfChangeThreshold?: number
  /**
   * Percentile threshold for percentile-based detection (0-100).
   * Values above this percentile of the window are flagged.
   * Default: 95. Set to 0 to disable.
   */
  percentileThreshold?: number
  /**
   * Enable adaptive sensitivity. When true, the Z-score threshold
   * automatically adjusts: tighter for low-variance data, more lenient
   * for high-variance workloads. Default: true.
   */
  adaptiveSensitivity?: boolean
}

export interface AnomalyEvent {
  type:
    | "cost_spike"
    | "token_spike"
    | "cost_rate_change"
    | "token_rate_change"
    | "cost_percentile"
    | "token_percentile"
  value: number
  mean: number
  deviation: number
  zScore: number
  timestamp: number
  /** Which detection method flagged this anomaly */
  detectionMethod: "z-score" | "ewma" | "rate-of-change" | "percentile"
  /** Severity level based on how far the value deviates */
  severity: "warning" | "critical"
}

export class AnomalyDetector {
  private costHistory: number[] = []
  private tokenHistory: number[] = []
  private windowSize: number
  private sensitivity: number
  private minCostThreshold: number
  private ignoreBelowCost: number
  private ewmaAlpha: number
  private rateOfChangeThreshold: number
  private percentileThreshold: number
  private adaptiveSensitivity: boolean

  // EWMA state
  private costEwma: number | null = null
  private costEwmaVar: number | null = null
  private tokenEwma: number | null = null
  private tokenEwmaVar: number | null = null

  // Previous values for rate-of-change
  private prevCost: number | null = null
  private prevTokens: number | null = null

  constructor(config: AnomalyConfig = {}) {
    this.windowSize = config.windowSize ?? 20
    this.sensitivity = config.sensitivity ?? 3.0
    this.minCostThreshold = config.minCostThreshold ?? 0.01
    this.ignoreBelowCost = config.ignoreBelowCost ?? 0.1
    this.ewmaAlpha = config.ewmaAlpha ?? 0.3
    this.rateOfChangeThreshold = config.rateOfChangeThreshold ?? 3.0
    this.percentileThreshold = config.percentileThreshold ?? 95
    this.adaptiveSensitivity = config.adaptiveSensitivity ?? true
  }

  /**
   * Record a transaction and check for anomalies using all enabled detectors.
   * Returns the most severe anomaly event if any are detected, null otherwise.
   */
  check(cost: number, tokens: number): AnomalyEvent | null {
    const anomalies: AnomalyEvent[] = []

    // --- Cost anomaly detection ---
    if (cost >= this.minCostThreshold) {
      const costAnomaly = this.detectAnomaly(
        cost,
        this.costHistory,
        "cost_spike",
        "cost_rate_change",
        "cost_percentile",
        this.ignoreBelowCost,
      )
      if (costAnomaly) anomalies.push(costAnomaly)

      // EWMA detection for cost
      const ewmaCostAnomaly = this.checkEwma(
        cost,
        this.costEwma,
        this.costEwmaVar,
        "cost_spike",
        this.ignoreBelowCost,
      )
      if (ewmaCostAnomaly) anomalies.push(ewmaCostAnomaly)

      // Update EWMA state
      const { ewma, ewmaVar } = this.updateEwma(cost, this.costEwma, this.costEwmaVar)
      this.costEwma = ewma
      this.costEwmaVar = ewmaVar

      // Rate-of-change detection for cost
      if (this.rateOfChangeThreshold > 0 && this.prevCost !== null && this.prevCost > 0) {
        const ratio = cost / this.prevCost
        if (ratio >= this.rateOfChangeThreshold && cost > this.ignoreBelowCost) {
          const costStats = this.calculateStats(this.costHistory)
          anomalies.push({
            type: "cost_rate_change",
            value: cost,
            mean: costStats.mean,
            deviation: costStats.stdDev,
            zScore: ratio,
            timestamp: Date.now(),
            detectionMethod: "rate-of-change",
            severity: ratio >= this.rateOfChangeThreshold * 2 ? "critical" : "warning",
          })
        }
      }
      this.prevCost = cost

      this.updateHistory(this.costHistory, cost)
    }

    // --- Token anomaly detection ---
    if (tokens > 0) {
      const tokenAnomaly = this.detectAnomaly(
        tokens,
        this.tokenHistory,
        "token_spike",
        "token_rate_change",
        "token_percentile",
        0,
      )
      if (tokenAnomaly) anomalies.push(tokenAnomaly)

      // EWMA detection for tokens
      const ewmaTokenAnomaly = this.checkEwma(
        tokens,
        this.tokenEwma,
        this.tokenEwmaVar,
        "token_spike",
        0,
      )
      if (ewmaTokenAnomaly) anomalies.push(ewmaTokenAnomaly)

      // Update EWMA state
      const { ewma, ewmaVar } = this.updateEwma(tokens, this.tokenEwma, this.tokenEwmaVar)
      this.tokenEwma = ewma
      this.tokenEwmaVar = ewmaVar

      // Rate-of-change detection for tokens
      if (this.rateOfChangeThreshold > 0 && this.prevTokens !== null && this.prevTokens > 0) {
        const ratio = tokens / this.prevTokens
        if (ratio >= this.rateOfChangeThreshold) {
          const tokenStats = this.calculateStats(this.tokenHistory)
          anomalies.push({
            type: "token_rate_change",
            value: tokens,
            mean: tokenStats.mean,
            deviation: tokenStats.stdDev,
            zScore: ratio,
            timestamp: Date.now(),
            detectionMethod: "rate-of-change",
            severity: ratio >= this.rateOfChangeThreshold * 2 ? "critical" : "warning",
          })
        }
      }
      this.prevTokens = tokens

      this.updateHistory(this.tokenHistory, tokens)
    }

    // Return the most severe anomaly (critical > warning, higher z-score wins)
    if (anomalies.length === 0) return null
    return anomalies.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1
      return b.zScore - a.zScore
    })[0]
  }

  /** Get current EWMA baselines for monitoring dashboards */
  getBaselines(): {
    costEwma: number | null
    tokenEwma: number | null
    costHistory: number
    tokenHistory: number
  } {
    return {
      costEwma: this.costEwma,
      tokenEwma: this.tokenEwma,
      costHistory: this.costHistory.length,
      tokenHistory: this.tokenHistory.length,
    }
  }

  /** Reset all detection state */
  reset(): void {
    this.costHistory = []
    this.tokenHistory = []
    this.costEwma = null
    this.costEwmaVar = null
    this.tokenEwma = null
    this.tokenEwmaVar = null
    this.prevCost = null
    this.prevTokens = null
  }

  // --- Private detection methods ---

  private detectAnomaly(
    value: number,
    history: number[],
    spikeType: AnomalyEvent["type"],
    _rateType: AnomalyEvent["type"],
    percentileType: AnomalyEvent["type"],
    minAbsoluteValue: number,
  ): AnomalyEvent | null {
    const stats = this.calculateStats(history)
    const minSamples = Math.min(5, this.windowSize)

    // Z-score detection with adaptive sensitivity
    if (history.length >= minSamples && stats.stdDev > 0) {
      const threshold = this.getAdaptiveThreshold(stats)
      const zScore = (value - stats.mean) / stats.stdDev

      if (zScore > threshold && value > minAbsoluteValue) {
        return {
          type: spikeType,
          value,
          mean: stats.mean,
          deviation: stats.stdDev,
          zScore,
          timestamp: Date.now(),
          detectionMethod: "z-score",
          severity: zScore > threshold * 1.5 ? "critical" : "warning",
        }
      }
    }

    // Percentile-based detection
    if (this.percentileThreshold > 0 && history.length >= minSamples) {
      const percentileValue = this.calculatePercentile(history, this.percentileThreshold)
      if (value > percentileValue && value > minAbsoluteValue) {
        const zScore = stats.stdDev > 0 ? (value - stats.mean) / stats.stdDev : 0
        // Only flag if it's significantly above the percentile (not barely above)
        if (value > percentileValue * 1.2) {
          return {
            type: percentileType,
            value,
            mean: stats.mean,
            deviation: stats.stdDev,
            zScore,
            timestamp: Date.now(),
            detectionMethod: "percentile",
            severity: value > percentileValue * 2 ? "critical" : "warning",
          }
        }
      }
    }

    return null
  }

  private checkEwma(
    value: number,
    ewma: number | null,
    ewmaVar: number | null,
    spikeType: AnomalyEvent["type"],
    minAbsoluteValue: number,
  ): AnomalyEvent | null {
    if (this.ewmaAlpha <= 0 || ewma === null || ewmaVar === null) return null

    const ewmaStdDev = Math.sqrt(ewmaVar)
    if (ewmaStdDev <= 0 || !isFinite(ewmaStdDev)) return null

    const threshold = this.sensitivity
    const zScore = (value - ewma) / ewmaStdDev

    if (zScore > threshold && value > minAbsoluteValue) {
      return {
        type: spikeType,
        value,
        mean: ewma,
        deviation: ewmaStdDev,
        zScore,
        timestamp: Date.now(),
        detectionMethod: "ewma",
        severity: zScore > threshold * 1.5 ? "critical" : "warning",
      }
    }

    return null
  }

  private updateEwma(
    value: number,
    currentEwma: number | null,
    currentVar: number | null,
  ): { ewma: number; ewmaVar: number } {
    if (!isFinite(value)) return { ewma: currentEwma ?? 0, ewmaVar: currentVar ?? 0 }

    if (currentEwma === null || currentVar === null) {
      return { ewma: value, ewmaVar: 0 }
    }

    const alpha = this.ewmaAlpha
    const newEwma = alpha * value + (1 - alpha) * currentEwma
    const diff = value - currentEwma
    const newVar = (1 - alpha) * (currentVar + alpha * diff * diff)

    // Guard against NaN/Infinity propagation
    if (!isFinite(newEwma) || !isFinite(newVar)) {
      return { ewma: currentEwma, ewmaVar: currentVar }
    }

    return { ewma: newEwma, ewmaVar: newVar }
  }

  /**
   * Adaptive threshold: tighter for low-variance data, more lenient for high-variance.
   * Coefficient of Variation (CV) = stdDev / mean measures relative variability.
   */
  private getAdaptiveThreshold(stats: { mean: number; stdDev: number }): number {
    if (!this.adaptiveSensitivity || stats.mean === 0) {
      return this.sensitivity
    }

    const cv = stats.stdDev / Math.abs(stats.mean)

    // Low CV (<0.3): very consistent data → tighten threshold by 20%
    if (cv < 0.3) return this.sensitivity * 0.8
    // High CV (>1.0): highly variable data → loosen threshold by 30%
    if (cv > 1.0) return this.sensitivity * 1.3
    // Medium: interpolate linearly
    return this.sensitivity
  }

  private updateHistory(history: number[], value: number) {
    history.push(value)
    if (history.length > this.windowSize) {
      history.shift()
    }
  }

  private calculateStats(data: number[]) {
    if (data.length === 0) return { mean: 0, stdDev: 0 }
    const sum = data.reduce((a, b) => a + b, 0)
    const mean = sum / data.length
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length
    return { mean, stdDev: Math.sqrt(variance) }
  }

  private calculatePercentile(data: number[], percentile: number): number {
    const sorted = [...data].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
  }
}
