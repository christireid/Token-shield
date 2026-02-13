/**
 * TokenShield - Anomaly Detector
 *
 * Detects unusual spending patterns or token usage spikes in real-time.
 * Uses a sliding window Z-score algorithm to identify outliers.
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
}

export interface AnomalyEvent {
  type: "cost_spike" | "token_spike"
  value: number
  mean: number
  deviation: number
  zScore: number
  timestamp: number
}

export class AnomalyDetector {
  private costHistory: number[] = []
  private tokenHistory: number[] = []
  private windowSize: number
  private sensitivity: number
  private minCostThreshold: number
  private ignoreBelowCost: number

  constructor(config: AnomalyConfig = {}) {
    this.windowSize = config.windowSize ?? 20
    this.sensitivity = config.sensitivity ?? 3.0
    this.minCostThreshold = config.minCostThreshold ?? 0.01
    this.ignoreBelowCost = config.ignoreBelowCost ?? 0.10
  }

  /**
   * Record a transaction and check for anomalies.
   * Returns an event if anomaly detected, null otherwise.
   */
  check(cost: number, tokens: number): AnomalyEvent | null {
    // 1. Check Cost Anomaly
    let anomaly: AnomalyEvent | null = null

    if (cost >= this.minCostThreshold) {
      const costStats = this.calculateStats(this.costHistory)
      if (this.costHistory.length >= Math.min(5, this.windowSize) && costStats.stdDev > 0) {
        const zScore = (cost - costStats.mean) / costStats.stdDev
        
        if (zScore > this.sensitivity && cost > this.ignoreBelowCost) {
          anomaly = {
            type: "cost_spike",
            value: cost,
            mean: costStats.mean,
            deviation: costStats.stdDev,
            zScore,
            timestamp: Date.now(),
          }
        }
      }
      this.updateHistory(this.costHistory, cost)
    }

    // 2. Check Token Anomaly (only if cost didn't trigger, or prioritize cost?)
    // Let's report cost spike primarily.
    if (!anomaly && tokens > 0) {
        const tokenStats = this.calculateStats(this.tokenHistory)
        if (this.tokenHistory.length >= Math.min(5, this.windowSize) && tokenStats.stdDev > 0) {
            const zScore = (tokens - tokenStats.mean) / tokenStats.stdDev
            // Tokens usually correlate with cost, but maybe model changed
            if (zScore > this.sensitivity) {
                 anomaly = {
                    type: "token_spike",
                    value: tokens,
                    mean: tokenStats.mean,
                    deviation: tokenStats.stdDev,
                    zScore,
                    timestamp: Date.now(),
                 }
            }
        }
        this.updateHistory(this.tokenHistory, tokens)
    }

    return anomaly
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
}
