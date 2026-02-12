/**
 * Savings Calculator Tests
 *
 * Tests the estimateSavings() utility function that estimates
 * potential monthly savings from Token Shield optimization modules.
 */

import { describe, it, expect } from "vitest"
import { estimateSavings, type SavingsEstimateInput } from "./savings-calculator"

describe("estimateSavings", () => {
  it("returns all required fields", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result).toHaveProperty("totalSavings")
    expect(result).toHaveProperty("savingsPercent")
    expect(result).toHaveProperty("byModule")
    expect(result).toHaveProperty("tokenShieldCost")
    expect(result).toHaveProperty("netSavings")
    expect(result).toHaveProperty("roi")
    expect(result).toHaveProperty("recommendedTier")
    expect(result.byModule).toHaveProperty("cache")
    expect(result.byModule).toHaveProperty("router")
    expect(result.byModule).toHaveProperty("prefix")
    expect(result.byModule).toHaveProperty("context")
    expect(result.byModule).toHaveProperty("guard")
  })

  it("returns zero savings for zero spend", () => {
    const result = estimateSavings({ monthlySpend: 0 })
    expect(result.totalSavings).toBe(0)
    expect(result.savingsPercent).toBe(0)
    expect(result.byModule.cache.savings).toBe(0)
    expect(result.byModule.router.savings).toBe(0)
  })

  it("calculates cache savings based on duplicate rate", () => {
    const result = estimateSavings({ monthlySpend: 10000, duplicateRate: 0.2 })
    // 20% of $10k = $2000 cache savings
    expect(result.byModule.cache.savings).toBe(2000)
    expect(result.byModule.cache.percent).toBe(20)
  })

  it("calculates router savings based on simple request rate", () => {
    const result = estimateSavings({ monthlySpend: 10000, simpleRequestRate: 0.5 })
    // 50% * 60% cost reduction * $10k = $3000
    expect(result.byModule.router.savings).toBe(3000)
  })

  it("disables prefix savings when no steady system prompt", () => {
    const result = estimateSavings({
      monthlySpend: 10000,
      hasSteadySystemPrompt: false,
    })
    expect(result.byModule.prefix.savings).toBe(0)
    expect(result.byModule.prefix.percent).toBe(0)
  })

  it("applies Anthropic prefix discount (90%)", () => {
    const anthropic = estimateSavings({ monthlySpend: 10000, provider: "anthropic" })
    const openai = estimateSavings({ monthlySpend: 10000, provider: "openai" })
    // Anthropic has 90% discount vs OpenAI 50%, so prefix savings should be higher
    expect(anthropic.byModule.prefix.savings).toBeGreaterThan(openai.byModule.prefix.savings)
  })

  it("applies Google prefix discount (75%)", () => {
    const google = estimateSavings({ monthlySpend: 10000, provider: "google" })
    const openai = estimateSavings({ monthlySpend: 10000, provider: "openai" })
    expect(google.byModule.prefix.savings).toBeGreaterThan(openai.byModule.prefix.savings)
  })

  it("calculates context savings only for long conversations", () => {
    const short = estimateSavings({ monthlySpend: 10000, avgConversationLength: 5 })
    const long = estimateSavings({ monthlySpend: 10000, avgConversationLength: 20 })
    expect(short.byModule.context.savings).toBe(0)
    expect(long.byModule.context.savings).toBeGreaterThan(0)
  })

  it("guard savings are always 3% of spend", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.byModule.guard.savings).toBe(300)
    expect(result.byModule.guard.percent).toBe(3)
  })

  it("total savings equals sum of all module savings", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    const moduleSum =
      result.byModule.cache.savings +
      result.byModule.router.savings +
      result.byModule.prefix.savings +
      result.byModule.context.savings +
      result.byModule.guard.savings
    expect(result.totalSavings).toBeCloseTo(moduleSum, 1)
  })

  it("net savings = total savings - TokenShield cost", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.netSavings).toBeCloseTo(result.totalSavings - result.tokenShieldCost, 1)
  })

  it("recommends pro tier for small spend", () => {
    const result = estimateSavings({ monthlySpend: 1000 })
    expect(result.recommendedTier).toBe("pro")
    expect(result.tokenShieldCost).toBe(29)
  })

  it("recommends team tier for medium spend", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    expect(result.recommendedTier).toBe("team")
    expect(result.tokenShieldCost).toBe(99)
  })

  it("recommends enterprise tier for large spend", () => {
    const result = estimateSavings({ monthlySpend: 100000 })
    expect(result.recommendedTier).toBe("enterprise")
    expect(result.tokenShieldCost).toBe(499)
  })

  it("ROI is net savings divided by cost", () => {
    const result = estimateSavings({ monthlySpend: 10000 })
    const expectedRoi = Math.round(result.netSavings / result.tokenShieldCost * 10) / 10
    expect(result.roi).toBe(expectedRoi)
  })

  it("uses sensible defaults when no options provided", () => {
    const result = estimateSavings({ monthlySpend: 5000 })
    // Default: 15% cache, 25% routing, steady prefix, 10 msg conversations
    expect(result.totalSavings).toBeGreaterThan(0)
    expect(result.savingsPercent).toBeGreaterThan(20) // should be > 20% total
    expect(result.savingsPercent).toBeLessThan(80) // but not unreasonably high
  })
})
