import { describe, it, expect } from "vitest"
import {
  detectProvider,
  getCacheDiscountRate,
  optimizePrefix,
  projectPrefixSavings,
} from "./prefix-optimizer"

describe("prefix-optimizer", () => {
  describe("detectProvider", () => {
    it("detects OpenAI from model name", () => {
      expect(detectProvider("gpt-4o-mini")).toBe("openai")
      expect(detectProvider("gpt-4.1")).toBe("openai")
    })

    it("detects Anthropic from model name", () => {
      expect(detectProvider("claude-3-5-sonnet")).toBe("anthropic")
    })

    it("detects Google from model name", () => {
      expect(detectProvider("gemini-2.0-flash")).toBe("google")
    })

    it("defaults to openai for unknown models", () => {
      expect(detectProvider("some-unknown-model")).toBe("openai")
    })
  })

  describe("getCacheDiscountRate", () => {
    it("returns 0.5 for openai", () => {
      expect(getCacheDiscountRate("openai")).toBe(0.5)
    })

    it("returns 0.9 for anthropic", () => {
      expect(getCacheDiscountRate("anthropic")).toBe(0.9)
    })

    it("returns 0.75 for google", () => {
      expect(getCacheDiscountRate("google")).toBe(0.75)
    })
  })

  describe("optimizePrefix", () => {
    it("puts system messages in the stable prefix", () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "assistant" as const, content: "Hi!" },
      ]
      const result = optimizePrefix(messages, "gpt-4o-mini", 0.15)
      // System message should be first
      expect(result.messages[0].role).toBe("system")
      expect(result.prefixTokens).toBeGreaterThan(0)
    })

    it("calculates prefix savings for Anthropic (90% discount)", () => {
      const messages = [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: "Hello" },
      ]
      const result = optimizePrefix(messages, "claude-3-5-sonnet", 3.0, {
        provider: "auto",
      })
      expect(result.cacheDiscountRate).toBe(0.9)
      expect(result.prefixEligibleForCaching).toBe(true)
    })

    it("inserts Anthropic cache breakpoints", () => {
      const messages = [
        { role: "system" as const, content: "System prompt here." },
        { role: "user" as const, content: "User message" },
      ]
      const result = optimizePrefix(messages, "claude-3-5-sonnet", 3.0)
      // Should have at least one breakpoint at end of stable section
      expect(result.cacheBreakpoints.length).toBeGreaterThan(0)
    })

    it("respects OpenAI minimum prefix threshold", () => {
      const messages = [
        { role: "system" as const, content: "Short." },
        { role: "user" as const, content: "Hi" },
      ]
      const result = optimizePrefix(messages, "gpt-4o-mini", 0.15)
      // Short prefix < 1024 tokens, should not be eligible
      expect(result.prefixEligibleForCaching).toBe(false)
    })
  })

  describe("projectPrefixSavings", () => {
    it("calculates total savings over time", () => {
      const result = projectPrefixSavings(2000, 2.5, "openai", 60, 24)
      expect(result.totalRequests).toBe(60 * 24)
      expect(result.cachedRequests).toBeGreaterThan(0)
      expect(result.totalSavings).toBeGreaterThan(0)
    })

    it("returns zero cached requests when total is very small", () => {
      const result = projectPrefixSavings(2000, 2.5, "openai", 0, 0)
      expect(result.cachedRequests).toBe(0)
      expect(result.totalSavings).toBe(0)
    })
  })
})
