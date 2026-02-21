import { describe, it, expect } from "vitest"
import { formatDollars, formatPercent, summarizeEventData } from "../dashboard-sections"

describe("dashboard-sections utilities", () => {
  describe("formatDollars", () => {
    it("formats >= $1 with 2 decimals", () => {
      expect(formatDollars(5.5)).toBe("$5.50")
      expect(formatDollars(100)).toBe("$100.00")
    })

    it("formats >= $0.01 with 4 decimals", () => {
      expect(formatDollars(0.05)).toBe("$0.0500")
      expect(formatDollars(0.0123)).toBe("$0.0123")
    })

    it("formats >= $0.0001 with 6 decimals", () => {
      expect(formatDollars(0.0005)).toBe("$0.000500")
      expect(formatDollars(0.0001)).toBe("$0.000100")
    })

    it("formats very small amounts as $0.00", () => {
      expect(formatDollars(0)).toBe("$0.00")
      expect(formatDollars(0.00001)).toBe("$0.00")
    })
  })

  describe("formatPercent", () => {
    it("formats ratio as percentage", () => {
      expect(formatPercent(0.5)).toBe("50.0%")
      expect(formatPercent(1)).toBe("100.0%")
      expect(formatPercent(0.123)).toBe("12.3%")
    })
  })

  describe("summarizeEventData", () => {
    it("summarizes cache:hit events", () => {
      const result = summarizeEventData("cache:hit", { similarity: 0.95, savedCost: 0.005 })
      expect(result).toContain("95%")
      expect(result).toContain("$0.0050")
    })

    it("summarizes cache:miss events", () => {
      const result = summarizeEventData("cache:miss", { prompt: "Hello world this is a test" })
      expect(result).toContain("Hello world")
    })

    it("summarizes request:blocked events", () => {
      const result = summarizeEventData("request:blocked", {
        reason: "rate_limit",
        estimatedCost: 0.02,
      })
      expect(result).toContain("rate_limit")
    })

    it("summarizes ledger:entry events", () => {
      const result = summarizeEventData("ledger:entry", { cost: 0.05, saved: 0.01 })
      expect(result).toContain("cost:")
      expect(result).toContain("saved:")
    })

    it("summarizes context:trimmed events", () => {
      const result = summarizeEventData("context:trimmed", { savedTokens: 500 })
      expect(result).toContain("500")
      expect(result).toContain("tokens")
    })

    it("summarizes router:downgraded events", () => {
      const result = summarizeEventData("router:downgraded", {
        originalModel: "gpt-4o",
        selectedModel: "gpt-4o-mini",
        savedCost: 0.003,
      })
      expect(result).toContain("gpt-4o")
      expect(result).toContain("gpt-4o-mini")
    })

    it("summarizes breaker:tripped events", () => {
      const result = summarizeEventData("breaker:tripped", {
        limitType: "hourly",
        action: "blocked",
      })
      expect(result).toContain("hourly")
      expect(result).toContain("blocked")
    })

    it("summarizes userBudget:exceeded events", () => {
      const result = summarizeEventData("userBudget:exceeded", {
        userId: "user-1",
        limitType: "daily",
      })
      expect(result).toContain("user-1")
      expect(result).toContain("daily")
    })

    it("summarizes compressor:applied events", () => {
      const result = summarizeEventData("compressor:applied", {
        savedTokens: 200,
        originalTokens: 1000,
        compressedTokens: 800,
      })
      expect(result).toContain("200")
      expect(result).toContain("1000")
      expect(result).toContain("800")
    })

    it("summarizes delta:applied events", () => {
      const result = summarizeEventData("delta:applied", {
        savedTokens: 150,
        originalTokens: 900,
        encodedTokens: 750,
      })
      expect(result).toContain("150")
      expect(result).toContain("900")
      expect(result).toContain("750")
    })

    it("summarizes anomaly:detected events", () => {
      const result = summarizeEventData("anomaly:detected", {
        type: "cost_spike",
        zScore: 5.2,
        value: 0.5,
      })
      expect(result).toContain("cost_spike")
      expect(result).toContain("5.2")
    })

    it("summarizes router:holdback events", () => {
      const result = summarizeEventData("router:holdback", {
        model: "gpt-4o",
        holdbackRate: 0.1,
      })
      expect(result).toContain("gpt-4o")
      expect(result).toContain("10%")
    })

    it("summarizes stream:complete events", () => {
      const result = summarizeEventData("stream:complete", { totalCost: 0.05 })
      expect(result).toContain("cost:")
    })

    it("handles unknown event types gracefully", () => {
      const result = summarizeEventData("unknown:event", { foo: "bar", baz: 42 })
      expect(result).toContain("foo")
      expect(result).toContain("bar")
    })

    it("handles missing data gracefully", () => {
      const result = summarizeEventData("cache:hit", {})
      expect(result).toContain("?")
    })
  })
})
