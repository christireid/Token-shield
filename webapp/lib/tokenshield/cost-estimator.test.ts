import { describe, it, expect } from "vitest"
import {
  estimateCost,
  compareCosts,
  calculateSavings,
  cheapestModelForBudget,
  MODEL_PRICING,
} from "./cost-estimator"

describe("estimateCost", () => {
  it("calculates correct cost for known model", () => {
    // gpt-4o-mini: $0.15/M input, $0.6/M output
    const result = estimateCost("gpt-4o-mini", 1_000_000, 1_000_000)
    expect(result.inputCost).toBeCloseTo(0.15, 5)
    expect(result.outputCost).toBeCloseTo(0.6, 5)
    expect(result.totalCost).toBeCloseTo(0.75, 5)
  })

  it("calculates cached input cost when available", () => {
    const result = estimateCost("gpt-4o-mini", 1_000_000, 0)
    expect(result.cachedInputCost).toBeDefined()
    expect(result.cachedInputCost!).toBeLessThan(result.inputCost)
    expect(result.totalWithCache).toBeDefined()
  })

  it("throws on unknown model", () => {
    expect(() => estimateCost("unknown-model", 100, 100)).toThrow("Unknown model")
  })

  it("handles zero tokens", () => {
    const result = estimateCost("gpt-4o-mini", 0, 0)
    expect(result.totalCost).toBe(0)
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })

  it("includes the correct model pricing data", () => {
    const result = estimateCost("gpt-4o-mini", 500, 200)
    expect(result.model.id).toBe("gpt-4o-mini")
    expect(result.model.provider).toBe("openai")
  })
})

describe("compareCosts", () => {
  it("returns all models sorted by cost ascending", () => {
    const costs = compareCosts(1000, 500)
    expect(costs.length).toBe(Object.keys(MODEL_PRICING).length)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i].totalCost).toBeGreaterThanOrEqual(costs[i - 1].totalCost)
    }
  })
})

describe("calculateSavings", () => {
  it("reports positive savings when tokens are reduced", () => {
    const result = calculateSavings("gpt-4o-mini", 10000, 5000, 500)
    expect(result.savedDollars).toBeGreaterThan(0)
    expect(result.savedPercent).toBeGreaterThan(0)
    expect(result.tokensSaved).toBe(5000)
  })

  it("reports zero savings when tokens are unchanged", () => {
    const result = calculateSavings("gpt-4o-mini", 5000, 5000, 500)
    expect(result.savedDollars).toBe(0)
    expect(result.savedPercent).toBe(0)
    expect(result.tokensSaved).toBe(0)
  })
})

describe("cheapestModelForBudget", () => {
  it("finds a model within budget", () => {
    const result = cheapestModelForBudget(1000, 500, 1.0)
    expect(result).not.toBeNull()
    expect(result!.totalCost).toBeLessThanOrEqual(1.0)
  })

  it("returns null when no model fits budget", () => {
    const result = cheapestModelForBudget(1000, 500, 0.0000001)
    expect(result).toBeNull()
  })
})
