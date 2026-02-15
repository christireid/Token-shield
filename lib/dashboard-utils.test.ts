import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  formatRelativeTime,
  formatCurrency,
  formatPercent,
  formatEventType,
  getModelColor,
  COLORS,
  STAGE_COLORS,
  MODULE_COLORS,
  MODULE_LABELS,
  MODEL_COLORS,
  EVENT_DOT_COLORS,
  EVENT_BADGE_COLORS,
  SEVERITY_DOT_COLOR,
  SEVERITY_DOT_ANIMATION,
  ANOMALY_TYPE_BADGE_COLOR,
  ANOMALY_TYPE_LABELS,
  ALERT_SEVERITY_CONFIG,
  STATUS_DOT_CLASS,
  STATUS_BADGE_CLASS,
  STATUS_LABEL,
  PROVIDER_ACCENT,
} from "./dashboard-utils"

/* ------------------------------------------------------------------ */
/*  formatRelativeTime                                                  */
/* ------------------------------------------------------------------ */

describe("formatRelativeTime", () => {
  let dateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000)
  })

  afterEach(() => {
    dateSpy.mockRestore()
  })

  it('returns "just now" for < 5 seconds ago', () => {
    expect(formatRelativeTime(1_000_000 - 2_000)).toBe("just now")
    expect(formatRelativeTime(1_000_000 - 4_999)).toBe("just now")
  })

  it("returns seconds for < 60 seconds", () => {
    expect(formatRelativeTime(1_000_000 - 10_000)).toBe("10s ago")
    expect(formatRelativeTime(1_000_000 - 59_000)).toBe("59s ago")
  })

  it("returns minutes for < 60 minutes", () => {
    expect(formatRelativeTime(1_000_000 - 120_000)).toBe("2m ago")
    expect(formatRelativeTime(1_000_000 - 3_540_000)).toBe("59m ago")
  })

  it("returns hours for < 24 hours", () => {
    expect(formatRelativeTime(1_000_000 - 3_600_000)).toBe("1h ago")
    expect(formatRelativeTime(1_000_000 - 7_200_000)).toBe("2h ago")
  })

  it("returns days for >= 24 hours", () => {
    expect(formatRelativeTime(1_000_000 - 86_400_000)).toBe("1d ago")
    expect(formatRelativeTime(1_000_000 - 172_800_000)).toBe("2d ago")
  })
})

/* ------------------------------------------------------------------ */
/*  formatCurrency                                                      */
/* ------------------------------------------------------------------ */

describe("formatCurrency", () => {
  it("formats large values with k suffix", () => {
    expect(formatCurrency(1500)).toBe("$1.5k")
    expect(formatCurrency(12345)).toBe("$12.3k")
  })

  it("formats values >= 1 with 2 decimal places", () => {
    expect(formatCurrency(5.678)).toBe("$5.68")
    expect(formatCurrency(1)).toBe("$1.00")
  })

  it("formats small values with 4 decimal places", () => {
    expect(formatCurrency(0.1234)).toBe("$0.1234")
    expect(formatCurrency(0.0001)).toBe("$0.0001")
  })

  it("supports custom prefix", () => {
    expect(formatCurrency(100, "EUR ")).toBe("EUR 100.00")
  })

  it("handles zero", () => {
    expect(formatCurrency(0)).toBe("$0.0000")
  })
})

/* ------------------------------------------------------------------ */
/*  formatPercent                                                       */
/* ------------------------------------------------------------------ */

describe("formatPercent", () => {
  it("formats to one decimal", () => {
    expect(formatPercent(42.567)).toBe("42.6%")
    expect(formatPercent(0)).toBe("0.0%")
    expect(formatPercent(100)).toBe("100.0%")
  })
})

/* ------------------------------------------------------------------ */
/*  formatEventType                                                     */
/* ------------------------------------------------------------------ */

describe("formatEventType", () => {
  it("converts colon-separated types to Title Case", () => {
    expect(formatEventType("cache:hit")).toBe("Cache Hit")
    expect(formatEventType("request:blocked")).toBe("Request Blocked")
    expect(formatEventType("breaker:warning")).toBe("Breaker Warning")
  })
})

/* ------------------------------------------------------------------ */
/*  getModelColor                                                       */
/* ------------------------------------------------------------------ */

describe("getModelColor", () => {
  it("returns known model color", () => {
    expect(getModelColor("gpt-4o", 0)).toBe(MODEL_COLORS["gpt-4o"])
    expect(getModelColor("claude-sonnet-4", 1)).toBe(MODEL_COLORS["claude-sonnet-4"])
  })

  it("returns fallback color for unknown models", () => {
    const color = getModelColor("unknown-model", 0)
    expect(color).toBeTruthy()
    expect(color).not.toBe(MODEL_COLORS["gpt-4o"])
  })

  it("cycles fallback colors by index", () => {
    const color0 = getModelColor("a", 0)
    const color1 = getModelColor("b", 1)
    const color5 = getModelColor("f", 5)
    expect(color0).not.toBe(color1)
    // index 5 should cycle back to index 0
    expect(color5).toBe(color0)
  })
})

/* ------------------------------------------------------------------ */
/*  Color palette completeness                                          */
/* ------------------------------------------------------------------ */

describe("color constants", () => {
  it("COLORS has all required keys", () => {
    expect(COLORS).toHaveProperty("primary")
    expect(COLORS).toHaveProperty("cyan")
    expect(COLORS).toHaveProperty("amber")
    expect(COLORS).toHaveProperty("red")
    expect(COLORS).toHaveProperty("purple")
    expect(COLORS).toHaveProperty("muted")
    expect(COLORS).toHaveProperty("grid")
  })

  it("STAGE_COLORS covers all pipeline stages", () => {
    const stages = [
      "Circuit Breaker",
      "Request Guard",
      "Response Cache",
      "Context Manager",
      "Model Router",
      "Prefix Optimizer",
    ]
    for (const stage of stages) {
      expect(STAGE_COLORS).toHaveProperty(stage)
    }
  })

  it("MODULE_COLORS and MODULE_LABELS have matching keys", () => {
    const colorKeys = Object.keys(MODULE_COLORS).sort()
    const labelKeys = Object.keys(MODULE_LABELS).sort()
    expect(colorKeys).toEqual(labelKeys)
  })

  it("EVENT_DOT_COLORS covers all event types", () => {
    const types = [
      "cache:hit",
      "cache:miss",
      "request:blocked",
      "router:downgraded",
      "context:trimmed",
      "prefix:optimized",
      "ledger:entry",
      "breaker:warning",
    ]
    for (const t of types) {
      expect(EVENT_DOT_COLORS).toHaveProperty(t)
    }
  })

  it("EVENT_BADGE_COLORS covers all event types", () => {
    const types = Object.keys(EVENT_DOT_COLORS)
    for (const t of types) {
      expect(EVENT_BADGE_COLORS).toHaveProperty(t)
    }
  })

  it("severity colors cover all levels", () => {
    for (const level of ["high", "medium", "low"]) {
      expect(SEVERITY_DOT_COLOR).toHaveProperty(level)
      expect(SEVERITY_DOT_ANIMATION).toHaveProperty(level)
    }
  })

  it("anomaly type colors cover all types", () => {
    for (const t of Object.keys(ANOMALY_TYPE_LABELS)) {
      expect(ANOMALY_TYPE_BADGE_COLOR).toHaveProperty(t)
    }
  })

  it("alert severity config covers all severities", () => {
    for (const s of ["info", "warning", "critical"]) {
      expect(ALERT_SEVERITY_CONFIG).toHaveProperty(s)
      expect(ALERT_SEVERITY_CONFIG[s]).toHaveProperty("containerClass")
      expect(ALERT_SEVERITY_CONFIG[s]).toHaveProperty("iconClass")
      expect(ALERT_SEVERITY_CONFIG[s]).toHaveProperty("titleClass")
      expect(ALERT_SEVERITY_CONFIG[s]).toHaveProperty("badgeClass")
    }
  })

  it("status classes cover all provider states", () => {
    for (const s of ["healthy", "degraded", "down"]) {
      expect(STATUS_DOT_CLASS).toHaveProperty(s)
      expect(STATUS_BADGE_CLASS).toHaveProperty(s)
      expect(STATUS_LABEL).toHaveProperty(s)
    }
  })

  it("provider accents cover known providers", () => {
    for (const p of ["OpenAI", "Anthropic", "Google"]) {
      expect(PROVIDER_ACCENT).toHaveProperty(p)
      expect(PROVIDER_ACCENT[p]).toHaveProperty("bg")
      expect(PROVIDER_ACCENT[p]).toHaveProperty("border")
    }
  })
})
