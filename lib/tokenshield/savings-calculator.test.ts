/**
 * Savings Calculator Tests
 *
 * Tests for the estimateSavings() pure utility function.
 * Does NOT test the React component (requires React Testing Library).
 */

import { describe, it, expect } from "vitest"
import { estimateSavings } from "./savings-calculator"

describe("estimateSavings", () => {
  it("returns correct structure with all modules", () => {
    const result = estimateSavings({ monthlySpend: 10000 })

    expect(result).toHaveProperty("totalSavings")
    expect(result).toHaveProperty("savingsPercent")
    expect(result).toHaveProperty("byModule.cache")
    expect(result).toHaveProperty("byModule.router")
    expect(result).toHaveProperty("byModule.prefix")
    expect(result).toHaveProperty("byModule.context")
    expect(result).toHaveProperty("byModule.guard")
    expect(result).toHaveProperty("tokenShieldCost")
    expect(result).toHaveProperty("netSavings")
    expect(result).toHaveProperty("roi")
    expect(result).toHaveProperty("recommendedTier")
  })

  it("calculates cache savings from duplicateRate", () => {
    const result = estimateSavings({ monthlySpend: 10000, duplicateRate: 0.2 })
    expect(result.byModule.cache.savings).toBe(2000)
    expect(result.byModule.cache.percent).toBe(20)
  })

  it("uses default duplicateRate of 15%", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.byModule.cache.savings).toBe(1500)
  })

  it("calculates router savings from simpleRequestRate", () => {
    const result = estimateSavings({ monthlySpend: 10000, simpleRequestRate: 0.3 })
    expect(result.byModule.router.savings).toBe(1800)
  })

  it("calculates prefix savings with OpenAI discount (50%)", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      provider: "openai",
      hasSteadySystemPrompt: true,
    })
    expect(result.byModule.prefix.savings).toBe(800)
  })

  it("calculates prefix savings with Anthropic discount (90%)", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      provider: "anthropic",
      hasSteadySystemPrompt: true,
    })
    expect(result.byModule.prefix.savings).toBe(1440)
  })

  it("calculates prefix savings with Google discount (75%)", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      provider: "google",
      hasSteadySystemPrompt: true,
    })
    expect(result.byModule.prefix.savings).toBe(1200)
  })

  it("returns zero prefix savings when no system prompt", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      hasSteadySystemPrompt: false,
    })
    expect(result.byModule.prefix.savings).toBe(0)
    expect(result.byModule.prefix.percent).toBe(0)
  })

  it("calculates context savings for long conversations", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      avgConversationLength: 20,
    })
    expect(result.byModule.context.savings).toBe(1500)
  })

  it("returns zero context savings for short conversations", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      avgConversationLength: 5,
    })
    expect(result.byModule.context.savings).toBe(0)
  })

  it("guard savings are 3% of spend", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.byModule.guard.savings).toBe(300)
    expect(result.byModule.guard.percent).toBe(3)
  })

  it("totalSavings is sum of all modules", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      duplicateRate: 0.15,
      simpleRequestRate: 0.25,
      avgConversationLength: 10,
      hasSteadySystemPrompt: true,
      provider: "openai",
    })

    const moduleSum =
      result.byModule.cache.savings +
      result.byModule.router.savings +
      result.byModule.prefix.savings +
      result.byModule.context.savings +
      result.byModule.guard.savings

    expect(result.totalSavings).toBeCloseTo(moduleSum, 1)
  })

  it("savingsPercent is totalSavings / monthlySpend * 100", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    const expectedPercent = (result.totalSavings / 10000) * 100
    expect(result.savingsPercent).toBeCloseTo(expectedPercent, 0)
  })

  it("recommends starter tier for spend under $5000", () => {
    const result = estimateSavings({ monthlySpend: 1000 })
    expect(result.recommendedTier).toBe("starter")
    expect(result.tokenShieldCost).toBe(29)
  })

  it("recommends team tier for spend $5000-$49999", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.recommendedTier).toBe("team")
    expect(result.tokenShieldCost).toBe(99)
  })

  it("recommends enterprise tier for spend >= $50000", () => {
    const result = estimateSavings({ monthlySpend: 100000 })
    expect(result.recommendedTier).toBe("enterprise")
    expect(result.tokenShieldCost).toBe(499)
  })

  it("calculates netSavings as totalSavings - tokenShieldCost", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.netSavings).toBeCloseTo(result.totalSavings - result.tokenShieldCost, 1)
  })

  it("calculates ROI correctly", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    const expectedRoi = result.netSavings / result.tokenShieldCost
    expect(result.roi).toBeCloseTo(expectedRoi, 0)
  })

  it("handles zero spend", () => {
    const result = estimateSavings({ monthlySpend: 0 })
    expect(result.totalSavings).toBe(0)
    expect(result.savingsPercent).toBe(0)
    expect(result.byModule.cache.savings).toBe(0)
    expect(result.byModule.router.savings).toBe(0)
  })

  it("handles very small spend", () => {
    const result = estimateSavings({ monthlySpend: 1 })
    expect(result.totalSavings).toBeGreaterThanOrEqual(0)
    expect(result.netSavings).toBeLessThan(0)
  })

  it("rounds savings to 2 decimal places", () => {
    const result = estimateSavings({ monthlySpend: 333 })
    const checkRounding = (v: number) => {
      const rounded = Math.round(v * 100) / 100
      expect(v).toBe(rounded)
    }
    checkRounding(result.totalSavings)
    checkRounding(result.netSavings)
    checkRounding(result.byModule.cache.savings)
  })
})
