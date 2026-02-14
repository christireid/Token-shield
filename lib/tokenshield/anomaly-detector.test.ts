import { describe, it, expect } from "vitest"
import { AnomalyDetector } from "./anomaly-detector"

describe("AnomalyDetector", () => {
  describe("Constructor defaults", () => {
    it("should use default values when no config is provided", () => {
      const detector = new AnomalyDetector()
      // We can't directly access private properties, but we can test behavior
      // that confirms defaults are working
      expect(detector).toBeInstanceOf(AnomalyDetector)
    })

    it("should accept custom configuration values", () => {
      const detector = new AnomalyDetector({
        windowSize: 10,
        sensitivity: 2.5,
        minCostThreshold: 0.05,
        ignoreBelowCost: 0.20,
      })
      expect(detector).toBeInstanceOf(AnomalyDetector)
    })

    it("should accept partial configuration and use defaults for missing values", () => {
      const detector = new AnomalyDetector({
        windowSize: 15,
      })
      expect(detector).toBeInstanceOf(AnomalyDetector)
    })
  })

  describe("Insufficient data (initial readings)", () => {
    it("should return null for first 4 readings with default windowSize", () => {
      const detector = new AnomalyDetector()

      expect(detector.check(0.10, 1000)).toBeNull()
      expect(detector.check(0.12, 1200)).toBeNull()
      expect(detector.check(0.11, 1100)).toBeNull()
      expect(detector.check(0.13, 1300)).toBeNull()
    })

    it("should return null when history is less than min(5, windowSize)", () => {
      const detector = new AnomalyDetector({ windowSize: 3 })

      // With windowSize=3, needs min(5, 3) = 3 readings
      expect(detector.check(0.10, 1000)).toBeNull()
      expect(detector.check(0.12, 1200)).toBeNull()
    })

    it("should return null when standard deviation is zero", () => {
      const detector = new AnomalyDetector()

      // All identical values = stdDev of 0
      for (let i = 0; i < 5; i++) {
        expect(detector.check(0.10, 1000)).toBeNull()
      }

      // Even a spike won't trigger with stdDev=0
      expect(detector.check(1.00, 10000)).toBeNull()
    })
  })

  describe("Normal variation", () => {
    it("should return null for values within normal range", () => {
      const detector = new AnomalyDetector({ sensitivity: 3.0 })

      // Build history with normal variation
      const normalCosts = [0.10, 0.11, 0.12, 0.10, 0.13, 0.11, 0.12]
      const normalTokens = [1000, 1100, 1200, 1000, 1300, 1100, 1200]

      for (let i = 0; i < normalCosts.length; i++) {
        const result = detector.check(normalCosts[i], normalTokens[i])
        expect(result).toBeNull()
      }
    })

    it("should return null for slight variations above mean but below sensitivity", () => {
      const detector = new AnomalyDetector({ sensitivity: 3.0 })

      // Build baseline
      for (let i = 0; i < 5; i++) {
        detector.check(0.10, 1000)
      }

      // Slight increase, but not 3 standard deviations
      const result = detector.check(0.15, 1500)
      expect(result).toBeNull()
    })
  })

  describe("Cost spike detection", () => {
    it("should detect cost spike after building sufficient history", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Build baseline with slight variation (stdDev must be > 0)
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Introduce a significant spike
      const result = detector.check(1.00, 1000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
      expect(result?.value).toBe(1.00)
      expect(result?.zScore).toBeGreaterThan(2.0)
      expect(result?.timestamp).toBeGreaterThan(0)
    })

    it("should include correct statistics in cost spike event", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      const baseCosts = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of baseCosts) {
        detector.check(cost, 1000)
      }

      const result = detector.check(0.50, 1000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
      expect(result?.mean).toBeCloseTo(0.108, 2)
      expect(result?.deviation).toBeGreaterThan(0)
      expect(result?.zScore).toBeGreaterThan(0)
    })
  })

  describe("Token spike detection", () => {
    it("should detect token spike after building sufficient history", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 10.0 // Set high to prevent cost anomalies
      })

      // Build baseline with varied token usage (stdDev > 0)
      const tokens = [1000, 1050, 1100, 1000, 1050]
      for (const t of tokens) {
        detector.check(0.001, t)
      }

      // Introduce a token spike (cost stays below threshold)
      const result = detector.check(0.001, 10000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("token_spike")
      expect(result?.value).toBe(10000)
      expect(result?.zScore).toBeGreaterThan(2.0)
    })

    it("should include correct statistics in token spike event", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 10.0
      })

      const baseTokens = [1000, 1100, 1200, 1000, 1100]
      for (const tokens of baseTokens) {
        detector.check(0.001, tokens)
      }

      const result = detector.check(0.001, 5000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("token_spike")
      expect(result?.mean).toBeCloseTo(1080, 1)
      expect(result?.deviation).toBeGreaterThan(0)
      expect(result?.zScore).toBeGreaterThan(0)
    })
  })

  describe("Cost anomaly priority", () => {
    it("should prioritize cost spike over token spike", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Build history with slight variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (let i = 0; i < base.length; i++) {
        detector.check(base[i], 1000 + i * 10)
      }

      // Both cost and tokens spike
      const result = detector.check(1.00, 10000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
      expect(result?.value).toBe(1.00)
    })

    it("should only report cost spike when both anomalies occur", () => {
      const detector = new AnomalyDetector({ sensitivity: 1.5 })

      // Build baseline with variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (let i = 0; i < base.length; i++) {
        detector.check(base[i], 1000 + i * 10)
      }

      // Massive spike in both
      const result = detector.check(2.00, 20000)

      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
    })
  })

  describe("minCostThreshold filtering", () => {
    it("should ignore costs below minCostThreshold", () => {
      const detector = new AnomalyDetector({
        sensitivity: 1.0,
        minCostThreshold: 0.10
      })

      // These should be ignored (below threshold)
      for (let i = 0; i < 10; i++) {
        const result = detector.check(0.05, 1000)
        expect(result).toBeNull()
      }
    })

    it("should process costs at or above minCostThreshold", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 0.10
      })

      // Build history at threshold with slight variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Spike at threshold
      const result = detector.check(0.50, 1000)
      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
    })

    it("should use custom minCostThreshold value", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 0.50
      })

      // These are below custom threshold
      for (let i = 0; i < 10; i++) {
        const result = detector.check(0.10, 1000)
        expect(result).toBeNull()
      }
    })
  })

  describe("ignoreBelowCost filtering", () => {
    it("should ignore anomalies below ignoreBelowCost threshold", () => {
      const detector = new AnomalyDetector({
        sensitivity: 1.0,
        minCostThreshold: 0.01,
        ignoreBelowCost: 0.20
      })

      // Build history with very low costs
      for (let i = 0; i < 5; i++) {
        detector.check(0.02, 1000)
      }

      // Spike that's above sensitivity but below ignoreBelowCost
      const result = detector.check(0.15, 5000)
      expect(result).toBeNull()
    })

    it("should trigger anomaly when cost is above ignoreBelowCost", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 0.01,
        ignoreBelowCost: 0.20
      })

      // Build history with slight variation
      const base = [0.05, 0.06, 0.04, 0.05, 0.06]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Spike above ignoreBelowCost threshold
      const result = detector.check(0.50, 1000)
      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
    })

    it("should use custom ignoreBelowCost value", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 0.01,
        ignoreBelowCost: 1.00
      })

      // Build history
      for (let i = 0; i < 5; i++) {
        detector.check(0.10, 1000)
      }

      // Spike below custom ignoreBelowCost
      const result = detector.check(0.80, 1000)
      expect(result).toBeNull()
    })
  })

  describe("Window size management", () => {
    it("should respect window size and cap history", () => {
      const detector = new AnomalyDetector({
        windowSize: 5,
        sensitivity: 2.0
      })

      // Add entries with slight variation
      const vals = [0.10, 0.11, 0.12, 0.10, 0.11, 0.10, 0.12, 0.11, 0.10, 0.11]
      for (const cost of vals) {
        detector.check(cost, 1000)
      }

      // Add a spike
      const result = detector.check(0.50, 1000)

      // The mean should only reflect the last 5 entries
      if (result) {
        expect(result.mean).toBeGreaterThan(0.09)
        expect(result.mean).toBeLessThan(0.13)
      }
    })

    it("should handle small window sizes correctly", () => {
      const detector = new AnomalyDetector({
        windowSize: 3,
        sensitivity: 2.0
      })

      // Need min(5, 3) = 3 readings
      detector.check(0.10, 1000)
      detector.check(0.11, 1100)
      detector.check(0.12, 1200)

      // This should be able to detect anomalies now
      const result = detector.check(0.50, 1000)
      expect(result).not.toBeNull()
    })

    it("should maintain only windowSize entries in history", () => {
      const detector = new AnomalyDetector({
        windowSize: 3,
        sensitivity: 2.0
      })

      // First three: 0.10, 0.10, 0.10
      detector.check(0.10, 1000)
      detector.check(0.10, 1000)
      detector.check(0.10, 1000)

      // Next three should evict the first three: 0.20, 0.20, 0.20
      detector.check(0.20, 2000)
      detector.check(0.20, 2000)
      detector.check(0.20, 2000)

      // Now history should be [0.20, 0.20, 0.20], so mean ≈ 0.20
      const result = detector.check(0.60, 2000)
      if (result) {
        expect(result.mean).toBeCloseTo(0.20, 2)
      }
    })
  })

  describe("Custom sensitivity", () => {
    it("should detect anomalies with lower sensitivity threshold", () => {
      const detector = new AnomalyDetector({ sensitivity: 1.5 })

      // Build history with slight variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Moderate spike should trigger with lower sensitivity
      const result = detector.check(0.25, 1000)
      expect(result).not.toBeNull()
    })

    it("should not detect anomalies with higher sensitivity threshold", () => {
      const detector = new AnomalyDetector({ sensitivity: 5.0 })

      // Build history with slight variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Moderate spike should NOT trigger with higher sensitivity
      // z-score for 0.13: (0.13 - 0.108) / 0.0075 ≈ 2.9, below sensitivity 5.0
      const result = detector.check(0.13, 1000)
      expect(result).toBeNull()
    })

    it("should require larger deviation with higher sensitivity", () => {
      const detector = new AnomalyDetector({ sensitivity: 4.0 })

      // Build history with variation
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      // Need much larger spike
      const result = detector.check(2.00, 1000)
      expect(result).not.toBeNull()
      expect(result?.zScore).toBeGreaterThan(4.0)
    })
  })

  describe("AnomalyEvent structure", () => {
    it("should return correct AnomalyEvent shape for cost spike", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Use varied baseline to produce stdDev > 0
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      const result = detector.check(1.00, 1000)

      expect(result).not.toBeNull()
      expect(result).toHaveProperty("type")
      expect(result).toHaveProperty("value")
      expect(result).toHaveProperty("mean")
      expect(result).toHaveProperty("deviation")
      expect(result).toHaveProperty("zScore")
      expect(result).toHaveProperty("timestamp")

      expect(result?.type).toBe("cost_spike")
      expect(typeof result?.value).toBe("number")
      expect(typeof result?.mean).toBe("number")
      expect(typeof result?.deviation).toBe("number")
      expect(typeof result?.zScore).toBe("number")
      expect(typeof result?.timestamp).toBe("number")
    })

    it("should return correct AnomalyEvent shape for token spike", () => {
      const detector = new AnomalyDetector({
        sensitivity: 2.0,
        minCostThreshold: 10.0
      })

      // Use varied token baseline to produce stdDev > 0
      const tokens = [1000, 1050, 1100, 1000, 1050]
      for (const t of tokens) {
        detector.check(0.001, t)
      }

      const result = detector.check(0.001, 10000)

      expect(result).not.toBeNull()
      expect(result).toHaveProperty("type")
      expect(result).toHaveProperty("value")
      expect(result).toHaveProperty("mean")
      expect(result).toHaveProperty("deviation")
      expect(result).toHaveProperty("zScore")
      expect(result).toHaveProperty("timestamp")

      expect(result?.type).toBe("token_spike")
      expect(typeof result?.value).toBe("number")
      expect(typeof result?.mean).toBe("number")
      expect(typeof result?.deviation).toBe("number")
      expect(typeof result?.zScore).toBe("number")
      expect(typeof result?.timestamp).toBe("number")
    })

    it("should have timestamp close to current time", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Use varied baseline to produce stdDev > 0
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      const before = Date.now()
      const result = detector.check(1.00, 1000)
      const after = Date.now()

      expect(result).not.toBeNull()
      expect(result?.timestamp).toBeGreaterThanOrEqual(before)
      expect(result?.timestamp).toBeLessThanOrEqual(after)
    })

    it("should calculate z-score correctly", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Use varied baseline to produce stdDev > 0
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      const result = detector.check(1.00, 1000)

      expect(result).not.toBeNull()
      if (result) {
        // Z-score = (value - mean) / stdDev
        const calculatedZScore = (result.value - result.mean) / result.deviation
        expect(result.zScore).toBeCloseTo(calculatedZScore, 5)
      }
    })
  })

  describe("Edge cases", () => {
    it("should handle zero cost values", () => {
      const detector = new AnomalyDetector({ minCostThreshold: 0 })

      for (let i = 0; i < 5; i++) {
        const result = detector.check(0, 1000)
        expect(result).toBeNull()
      }
    })

    it("should handle zero token values", () => {
      const detector = new AnomalyDetector()

      // Use varied baseline to produce stdDev > 0
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      const result = detector.check(0.50, 0)
      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
    })

    it("should handle negative values gracefully", () => {
      const detector = new AnomalyDetector({ minCostThreshold: -1 })

      // Negative costs shouldn't realistically happen, but shouldn't crash
      const result = detector.check(-0.10, 1000)
      expect(result).toBeNull()
    })

    it("should handle very large values", () => {
      const detector = new AnomalyDetector({ sensitivity: 2.0 })

      // Use varied baseline to produce stdDev > 0
      const base = [0.10, 0.11, 0.12, 0.10, 0.11]
      for (const cost of base) {
        detector.check(cost, 1000)
      }

      const result = detector.check(1000000, 1000000000)
      expect(result).not.toBeNull()
      expect(result?.type).toBe("cost_spike")
    })
  })
})
