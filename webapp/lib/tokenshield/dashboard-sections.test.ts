/**
 * Dashboard Sections Utility Tests
 *
 * Tests for pure utility functions exported from dashboard-sections.tsx:
 * formatDollars, formatPercent, formatTime, summarizeEventData,
 * EVENT_COLORS, DEFAULT_EVENT_COLOR.
 */

import { describe, it, expect } from "vitest"
import {
  formatDollars,
  formatPercent,
  formatTime,
  summarizeEventData,
  EVENT_COLORS,
  DEFAULT_EVENT_COLOR,
} from "./dashboard-sections"

describe("formatDollars", () => {
  it("formats amounts >= $1 with 2 decimal places", () => {
    expect(formatDollars(1)).toBe("$1.00")
    expect(formatDollars(10.5)).toBe("$10.50")
    expect(formatDollars(1234.56)).toBe("$1234.56")
  })

  it("formats amounts >= $0.01 with 4 decimal places", () => {
    expect(formatDollars(0.05)).toBe("$0.0500")
    expect(formatDollars(0.01)).toBe("$0.0100")
    expect(formatDollars(0.99)).toBe("$0.9900")
  })

  it("formats amounts >= $0.0001 with 6 decimal places", () => {
    expect(formatDollars(0.001)).toBe("$0.001000")
    expect(formatDollars(0.0001)).toBe("$0.000100")
    expect(formatDollars(0.005)).toBe("$0.005000")
  })

  it("returns $0.00 for amounts below threshold", () => {
    expect(formatDollars(0)).toBe("$0.00")
    expect(formatDollars(0.00001)).toBe("$0.00")
  })
})

describe("formatPercent", () => {
  it("formats ratio as percentage with 1 decimal", () => {
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatPercent(0.5)).toBe("50.0%")
    expect(formatPercent(1)).toBe("100.0%")
    expect(formatPercent(0.333)).toBe("33.3%")
  })

  it("handles values over 100%", () => {
    expect(formatPercent(1.5)).toBe("150.0%")
  })
})

describe("formatTime", () => {
  it("formats timestamp to HH:MM:SS in 24h format", () => {
    const d = new Date(2024, 0, 1, 14, 30, 45)
    const result = formatTime(d.getTime())
    expect(result).toMatch(/14:30:45/)
  })

  it("zero-pads hours, minutes, seconds", () => {
    const d = new Date(2024, 0, 1, 2, 5, 8)
    const result = formatTime(d.getTime())
    expect(result).toMatch(/02:05:08/)
  })
})

describe("summarizeEventData", () => {
  it("summarizes cache:hit with similarity and savedCost", () => {
    const result = summarizeEventData("cache:hit", { similarity: 0.95, savedCost: 0.05 })
    expect(result).toContain("95%")
    expect(result).toContain("$0.0500")
  })

  it("summarizes cache:miss with truncated prompt", () => {
    const longPrompt = "This is a very long prompt that should be truncated at 30 characters"
    const result = summarizeEventData("cache:miss", { prompt: longPrompt })
    expect(result).toContain("This is a very long prompt tha")
    expect(result).toContain("...")
  })

  it("summarizes cache:store with model", () => {
    const result = summarizeEventData("cache:store", { model: "gpt-4o" })
    expect(result).toBe("model: gpt-4o")
  })

  it("summarizes request:allowed with model", () => {
    const result = summarizeEventData("request:allowed", { model: "gpt-4o" })
    expect(result).toBe("model: gpt-4o")
  })

  it("summarizes request:blocked with reason and estimatedCost", () => {
    const result = summarizeEventData("request:blocked", {
      reason: "duplicate",
      estimatedCost: 0.05,
    })
    expect(result).toContain("duplicate")
    expect(result).toContain("$0.0500")
  })

  it("summarizes ledger:entry with cost and saved", () => {
    const result = summarizeEventData("ledger:entry", { cost: 0.5, saved: 0.2 })
    expect(result).toContain("$0.50")
    expect(result).toContain("$0.20")
  })

  it("summarizes context:trimmed with savedTokens", () => {
    const result = summarizeEventData("context:trimmed", { savedTokens: 500 })
    expect(result).toBe("saved: 500 tokens")
  })

  it("summarizes router:downgraded with model change and cost", () => {
    const result = summarizeEventData("router:downgraded", {
      originalModel: "gpt-4o",
      selectedModel: "gpt-4o-mini",
      savedCost: 0.03,
    })
    expect(result).toContain("gpt-4o")
    expect(result).toContain("gpt-4o-mini")
    expect(result).toContain("$0.0300")
  })

  it("summarizes breaker:warning with limitType and percentUsed", () => {
    const result = summarizeEventData("breaker:warning", {
      limitType: "perSession",
      percentUsed: 85.7,
    })
    expect(result).toContain("perSession")
    expect(result).toContain("86%")
  })

  it("summarizes breaker:tripped with limitType and action", () => {
    const result = summarizeEventData("breaker:tripped", {
      limitType: "perDay",
      action: "stop",
    })
    expect(result).toContain("perDay")
    expect(result).toContain("stop")
  })

  it("summarizes userBudget:warning", () => {
    const result = summarizeEventData("userBudget:warning", {
      userId: "u-123",
      limitType: "daily",
      percentUsed: 80,
    })
    expect(result).toContain("u-123")
    expect(result).toContain("daily")
    expect(result).toContain("80%")
  })

  it("summarizes userBudget:exceeded", () => {
    const result = summarizeEventData("userBudget:exceeded", {
      userId: "u-123",
      limitType: "monthly",
    })
    expect(result).toContain("u-123")
    expect(result).toContain("monthly")
  })

  it("summarizes userBudget:spend", () => {
    const result = summarizeEventData("userBudget:spend", {
      userId: "u-123",
      cost: 1.5,
    })
    expect(result).toContain("u-123")
    expect(result).toContain("$1.50")
  })

  it("summarizes stream:chunk with tokens and cost", () => {
    const result = summarizeEventData("stream:chunk", {
      outputTokens: 50,
      estimatedCost: 0.001,
    })
    expect(result).toContain("50")
    expect(result).toContain("$0.001000")
  })

  it("summarizes stream:complete with totalCost", () => {
    const result = summarizeEventData("stream:complete", { totalCost: 0.5 })
    expect(result).toContain("$0.50")
  })

  it("summarizes stream:abort", () => {
    const result = summarizeEventData("stream:abort", {
      outputTokens: 30,
      estimatedCost: 0.02,
    })
    expect(result).toContain("30")
    expect(result).toContain("$0.0200")
  })

  it("falls back to first 2 keys for unknown event types", () => {
    const result = summarizeEventData("custom:event", { foo: "bar", baz: "qux", extra: "skip" })
    expect(result).toContain("foo: bar")
    expect(result).toContain("baz: qux")
    expect(result).not.toContain("extra")
  })

  it("handles missing data gracefully with ? placeholders", () => {
    const result = summarizeEventData("cache:hit", {})
    expect(result).toContain("?")
  })

  it("returns a string for unknown types with empty data", () => {
    const result = summarizeEventData("unknown:type", {})
    expect(typeof result).toBe("string")
  })
})

describe("EVENT_COLORS", () => {
  it("maps success events to green", () => {
    expect(EVENT_COLORS["cache:hit"]).toBe("#22c55e")
    expect(EVENT_COLORS["request:allowed"]).toBe("#22c55e")
    expect(EVENT_COLORS["stream:complete"]).toBe("#22c55e")
  })

  it("maps warning events to yellow", () => {
    expect(EVENT_COLORS["breaker:warning"]).toBe("#f59e0b")
    expect(EVENT_COLORS["context:trimmed"]).toBe("#f59e0b")
    expect(EVENT_COLORS["router:downgraded"]).toBe("#f59e0b")
  })

  it("maps error events to red", () => {
    expect(EVENT_COLORS["request:blocked"]).toBe("#ef4444")
    expect(EVENT_COLORS["breaker:tripped"]).toBe("#ef4444")
    expect(EVENT_COLORS["userBudget:exceeded"]).toBe("#ef4444")
  })
})

describe("DEFAULT_EVENT_COLOR", () => {
  it("is a gray color", () => {
    expect(DEFAULT_EVENT_COLOR).toBe("#6b7280")
  })
})
