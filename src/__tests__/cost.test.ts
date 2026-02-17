import { describe, it, expect } from "vitest"
import { estimateCost, costTracker } from "../cost/tracker"

describe("estimateCost", () => {
  it("returns correct cost for known model", () => {
    const result = estimateCost("gpt-4o", 1000, 500)
    expect(result.known).toBe(true)
    expect(result.provider).toBe("openai")
    expect(result.inputCost).toBeCloseTo(0.0025, 6)
    expect(result.outputCost).toBeCloseTo(0.005, 6)
    expect(result.totalCost).toBeCloseTo(0.0075, 6)
  })

  it("returns known:false for unknown model — no silent fallback", () => {
    const result = estimateCost("unknown-model-xyz", 1000, 500)
    expect(result.known).toBe(false)
    expect(result.provider).toBe("unknown")
    expect(result.totalCost).toBe(0)
    expect(result.inputCost).toBe(0)
    expect(result.outputCost).toBe(0)
  })

  it("handles zero tokens", () => {
    const result = estimateCost("gpt-4o", 0, 0)
    expect(result.totalCost).toBe(0)
    expect(result.known).toBe(true)
  })

  it("clamps negative tokens to zero", () => {
    const result = estimateCost("gpt-4o", -100, -50)
    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
    expect(result.totalCost).toBe(0)
  })

  it("works for Anthropic models", () => {
    const result = estimateCost("claude-sonnet-4", 1000, 500)
    expect(result.known).toBe(true)
    expect(result.provider).toBe("anthropic")
    expect(result.totalCost).toBeGreaterThan(0)
  })

  it("works for Google models", () => {
    const result = estimateCost("gemini-2.5-flash", 1000, 500)
    expect(result.known).toBe(true)
    expect(result.provider).toBe("google")
  })

  it("handles prefix matching (model with date suffix)", () => {
    const result = estimateCost("gpt-4o-2024-08-06", 1000, 500)
    expect(result.known).toBe(true)
    expect(result.model).toBe("gpt-4o")
  })
})

describe("costTracker", () => {
  it("accumulates costs across multiple records", () => {
    const tracker = costTracker()
    tracker.record("gpt-4o", 1000, 500)
    tracker.record("gpt-4o", 2000, 800)

    const stats = tracker.stats
    expect(stats.requests).toBe(2)
    expect(stats.totalInputTokens).toBe(3000)
    expect(stats.totalOutputTokens).toBe(1300)
    expect(stats.totalCost).toBeGreaterThan(0)
  })

  it("tracks by model", () => {
    const tracker = costTracker()
    tracker.record("gpt-4o", 1000, 500)
    tracker.record("gpt-4o-mini", 2000, 800)

    const stats = tracker.stats
    expect(stats.byModel["gpt-4o"]).toBeDefined()
    expect(stats.byModel["gpt-4o-mini"]).toBeDefined()
    expect(stats.byModel["gpt-4o"].requests).toBe(1)
    expect(stats.byModel["gpt-4o-mini"].requests).toBe(1)
  })

  it("returns CostEstimate from record()", () => {
    const tracker = costTracker()
    const estimate = tracker.record("gpt-4o", 1000, 500)
    expect(estimate.known).toBe(true)
    expect(estimate.totalCost).toBeGreaterThan(0)
  })

  it("reset clears all data", () => {
    const tracker = costTracker()
    tracker.record("gpt-4o", 1000, 500)
    tracker.reset()

    const stats = tracker.stats
    expect(stats.requests).toBe(0)
    expect(stats.totalCost).toBe(0)
    expect(Object.keys(stats.byModel)).toHaveLength(0)
  })

  it("handles unknown models without failing", () => {
    const tracker = costTracker()
    const estimate = tracker.record("my-custom-model", 1000, 500)
    expect(estimate.known).toBe(false)
    expect(estimate.totalCost).toBe(0)
    // Still tracked
    expect(tracker.stats.requests).toBe(1)
  })
})
