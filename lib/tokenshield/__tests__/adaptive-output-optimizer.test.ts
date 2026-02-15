import { describe, it, expect, beforeEach } from "vitest"
import { AdaptiveOutputOptimizer } from "../adaptive-output-optimizer"

describe("adaptive-output-optimizer", () => {
  let optimizer: AdaptiveOutputOptimizer

  beforeEach(() => {
    optimizer = new AdaptiveOutputOptimizer({
      minObservations: 3,
      alpha: 0.2,
      persist: false,
    })
  })

  describe("predict", () => {
    it("should return static prediction when no observations exist", () => {
      const pred = optimizer.predict("What is the capital of France?", "gpt-4o")
      expect(pred.source).toBe("static")
      expect(pred.predictedTokens).toBeGreaterThan(0)
      expect(pred.observations).toBe(0)
    })

    it("should return static prediction when below minObservations", () => {
      optimizer.recordActual("What is the capital of France?", "gpt-4o", 25)
      optimizer.recordActual("What is the capital of Germany?", "gpt-4o", 30)
      const pred = optimizer.predict("What is the capital of Japan?", "gpt-4o")
      expect(pred.source).toBe("static")
    })

    it("should return adaptive prediction after enough observations", async () => {
      // Record enough observations for "factual-qa" task type
      await optimizer.recordActual("What is the capital of France?", "gpt-4o", 20)
      await optimizer.recordActual("What is the capital of Germany?", "gpt-4o", 25)
      await optimizer.recordActual("What is the capital of Japan?", "gpt-4o", 22)

      const pred = optimizer.predict("What is the capital of Italy?", "gpt-4o")
      expect(pred.source).toBe("adaptive")
      expect(pred.observations).toBe(3)
      expect(pred.predictedTokens).toBeGreaterThan(0)
      expect(pred.suggestedMaxTokens).toBeLessThan(4096)
    })

    it("should have tighter max_tokens with more observations", async () => {
      // Simulate consistent output lengths
      for (let i = 0; i < 10; i++) {
        await optimizer.recordActual(`What is ${i}+${i}?`, "gpt-4o", 20 + Math.floor(Math.random() * 5))
      }

      const pred = optimizer.predict("What is 5+5?", "gpt-4o")
      expect(pred.suggestedMaxTokens).toBeLessThan(200) // much tighter than 4096
    })

    it("should save tokens vs blanket 4096", async () => {
      for (let i = 0; i < 5; i++) {
        await optimizer.recordActual(`What is ${i}?`, "gpt-4o", 30)
      }

      const pred = optimizer.predict("What is 10?", "gpt-4o")
      expect(pred.savingsVsBlanket).toBeGreaterThan(0)
    })

    it("should track different task types independently", async () => {
      // Factual QA
      for (let i = 0; i < 5; i++) {
        await optimizer.recordActual(`What is ${i}?`, "gpt-4o", 25)
      }
      // Code generation
      for (let i = 0; i < 5; i++) {
        await optimizer.recordActual(`Write a function to compute ${i}`, "gpt-4o", 400)
      }

      const qaPred = optimizer.predict("What is 100?", "gpt-4o")
      // Different task types should have different predictions
      expect(qaPred.predictedTokens).toBeLessThan(200)
    })
  })

  describe("recordActual", () => {
    it("should update EMA over time", async () => {
      await optimizer.recordActual("What is 1?", "gpt-4o", 100)
      await optimizer.recordActual("What is 2?", "gpt-4o", 100)
      await optimizer.recordActual("What is 3?", "gpt-4o", 100)

      // Now record a much larger value
      await optimizer.recordActual("What is 4?", "gpt-4o", 500)

      const pred = optimizer.predict("What is 5?", "gpt-4o")
      // EMA should be between 100 and 500, weighted toward recent
      expect(pred.predictedTokens).toBeGreaterThan(100)
      expect(pred.predictedTokens).toBeLessThan(500)
    })

    it("should cap observations at 100", async () => {
      for (let i = 0; i < 120; i++) {
        await optimizer.recordActual(`What is ${i}?`, "gpt-4o", 30)
      }

      const stats = optimizer.getStatsForKey("factual-qa", "gpt-4o")
      expect(stats).toBeDefined()
      expect(stats!.observations.length).toBeLessThanOrEqual(100)
      expect(stats!.count).toBe(120)
    })
  })

  describe("summary", () => {
    it("should return empty summary with no data", () => {
      const sum = optimizer.summary()
      expect(sum.totalTaskTypes).toBe(0)
      expect(sum.totalObservations).toBe(0)
    })

    it("should return correct summary with data", async () => {
      await optimizer.recordActual("What is 1?", "gpt-4o", 25)
      await optimizer.recordActual("Classify this text as positive", "gpt-4o", 10)

      const sum = optimizer.summary()
      expect(sum.totalObservations).toBe(2)
      expect(sum.entries.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("clear", () => {
    it("should clear all learned data", async () => {
      await optimizer.recordActual("What is 1?", "gpt-4o", 25)
      expect(optimizer.summary().totalObservations).toBe(1)

      await optimizer.clear()
      expect(optimizer.summary().totalObservations).toBe(0)
    })
  })
})
