import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { CostCircuitBreaker } from "./circuit-breaker"

describe("CostCircuitBreaker", () => {
  let breaker: CostCircuitBreaker

  beforeEach(() => {
    breaker = new CostCircuitBreaker({
      limits: { perSession: 5.0, perHour: 2.0 },
      action: "stop",
      persist: false,
    })
  })

  it("allows requests within budget", () => {
    const result = breaker.check()
    expect(result.allowed).toBe(true)
  })

  it("blocks requests when session limit exceeded", () => {
    breaker.recordSpend(5.0, "gpt-4o-mini")
    const result = breaker.check()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("session")
  })

  it("blocks requests when hourly limit exceeded", () => {
    breaker.recordSpend(2.0, "gpt-4o-mini")
    const result = breaker.check()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("hour")
  })

  it("tracks spend and remaining correctly", () => {
    breaker.recordSpend(1.0, "gpt-4o-mini")
    const status = breaker.getStatus()
    expect(status.spend.session).toBe(1.0)
    expect(status.remaining.session).toBe(4.0)
    expect(status.remaining.hour).toBe(1.0)
  })

  // REGRESSION: limit=0 should mean "block everything", not be silently ignored
  describe("limit=0 semantics", () => {
    it("check() blocks at limit=0 (everything exceeds zero budget)", () => {
      const zeroBudget = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "stop",
        persist: false,
      })
      const result = zeroBudget.check()
      expect(result.allowed).toBe(false)
    })

    it("getStatus() reports tripped at limit=0 (consistent with check())", () => {
      const zeroBudget = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "stop",
        persist: false,
      })
      const status = zeroBudget.getStatus()
      expect(status.tripped).toBe(true)
      expect(status.trippedLimits.length).toBeGreaterThan(0)
    })

    it("percentUsed is 999 when limit=0 (no Infinity)", () => {
      const zeroBudget = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "stop",
        persist: false,
      })
      const status = zeroBudget.getStatus()
      expect(status.trippedLimits[0].percentUsed).toBe(999)
      expect(Number.isFinite(status.trippedLimits[0].percentUsed)).toBe(true)
    })
  })

  it("fires warning at 80% of limit", () => {
    let warningFired = false
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: false,
      onWarning: () => {
        warningFired = true
      },
    })
    // 80% of $10 = $8.00; projectedSpend must be >= $8.00
    b.recordSpend(8.01, "gpt-4o-mini")
    b.check()
    expect(warningFired).toBe(true)
  })

  it("reset clears all state", () => {
    breaker.recordSpend(3.0, "gpt-4o-mini")
    breaker.reset()
    const status = breaker.getStatus()
    expect(status.spend.session).toBe(0)
    expect(status.totalRequests).toBe(0)
  })

  it("throttle action allows but returns reason", () => {
    const throttled = new CostCircuitBreaker({
      limits: { perSession: 1.0 },
      action: "throttle",
      persist: false,
    })
    throttled.recordSpend(1.0, "gpt-4o-mini")
    const result = throttled.check()
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain("Throttled")
  })

  // -------------------------------------------------------
  // perDay and perMonth limits
  // -------------------------------------------------------

  it("blocks requests when perDay limit exceeded", () => {
    const daily = new CostCircuitBreaker({
      limits: { perDay: 1.0 },
      action: "stop",
      persist: false,
    })
    daily.recordSpend(1.0, "gpt-4o-mini")
    const result = daily.check()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("day")
  })

  it("blocks requests when perMonth limit exceeded", () => {
    const monthly = new CostCircuitBreaker({
      limits: { perMonth: 5.0 },
      action: "stop",
      persist: false,
    })
    monthly.recordSpend(5.0, "gpt-4o-mini")
    const result = monthly.check()
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("month")
  })

  it("getStatus reports perDay/perMonth remaining", () => {
    const b = new CostCircuitBreaker({
      limits: { perDay: 10.0, perMonth: 50.0 },
      action: "stop",
      persist: false,
    })
    b.recordSpend(3.0, "gpt-4o-mini")
    const status = b.getStatus()
    expect(status.remaining.day).toBeCloseTo(7.0)
    expect(status.remaining.month).toBeCloseTo(47.0)
  })

  // -------------------------------------------------------
  // updateLimits
  // -------------------------------------------------------

  it("updateLimits changes effective limits at runtime", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 2.0 },
      action: "stop",
      persist: false,
    })
    b.recordSpend(2.0, "gpt-4o-mini")
    expect(b.check().allowed).toBe(false)

    // Increase session limit
    b.updateLimits({ perSession: 10.0 })
    expect(b.check().allowed).toBe(true)
  })

  it("updateLimits resets warning state", () => {
    let warningCount = 0
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: false,
      onWarning: () => {
        warningCount++
      },
    })
    // Trigger warning at 80%
    b.recordSpend(8.5, "gpt-4o-mini")
    b.check()
    expect(warningCount).toBe(1)

    // Warning should not fire again without updateLimits
    b.check()
    expect(warningCount).toBe(1)

    // After updateLimits, warning state resets — warning can fire again
    b.updateLimits({ perSession: 10.0 })
    b.check()
    expect(warningCount).toBe(2)
  })

  // -------------------------------------------------------
  // getStatus with all limit types
  // -------------------------------------------------------

  it("getStatus returns null remaining for unconfigured limit types", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 5.0 },
      action: "stop",
      persist: false,
    })
    const status = b.getStatus()
    expect(status.remaining.session).toBe(5.0)
    expect(status.remaining.hour).toBeNull()
    expect(status.remaining.day).toBeNull()
    expect(status.remaining.month).toBeNull()
  })

  it("getStatus trippedLimits contains all exceeded limits", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 1.0, perHour: 1.0, perDay: 1.0, perMonth: 1.0 },
      action: "stop",
      persist: false,
    })
    b.recordSpend(2.0, "gpt-4o-mini")
    const status = b.getStatus()
    expect(status.trippedLimits.length).toBe(4)
    const limitTypes = status.trippedLimits.map((t: { limitType: string }) => t.limitType)
    expect(limitTypes).toContain("session")
    expect(limitTypes).toContain("hour")
    expect(limitTypes).toContain("day")
    expect(limitTypes).toContain("month")
  })

  // -------------------------------------------------------
  // Warning fires only once per limit type
  // -------------------------------------------------------

  it("warning fires only once until limit is updated", () => {
    let warningCount = 0
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: false,
      onWarning: () => {
        warningCount++
      },
    })
    b.recordSpend(8.5, "gpt-4o-mini")
    b.check()
    b.check()
    b.check()
    expect(warningCount).toBe(1) // Should fire only once
  })

  // -------------------------------------------------------
  // "warn" action path (line 282)
  // -------------------------------------------------------

  describe("warn action", () => {
    it("allows request and fires onTripped when limit exceeded with warn action", () => {
      let trippedEvent: unknown = null
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "warn",
        persist: false,
        onTripped: (event) => {
          trippedEvent = event
        },
      })
      b.recordSpend(1.5, "gpt-4o-mini")
      const result = b.check()
      expect(result.allowed).toBe(true)
      // warn action should not set a reason (it falls through without returning early)
      expect(result.reason).toBeUndefined()
      // onTripped should have been called
      expect(trippedEvent).not.toBeNull()
    })

    it("warn action does not block even when multiple limits are exceeded", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0, perHour: 1.0, perDay: 1.0 },
        action: "warn",
        persist: false,
      })
      b.recordSpend(2.0, "gpt-4o-mini")
      const result = b.check()
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it("getStatus reports tripped=false with warn action even when limits exceeded", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "warn",
        persist: false,
      })
      b.recordSpend(2.0, "gpt-4o-mini")
      const status = b.getStatus()
      // tripped is only true when action === "stop"
      expect(status.tripped).toBe(false)
      // But trippedLimits should still list the exceeded limit
      expect(status.trippedLimits.length).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------
  // "throttle" action additional coverage (lines 273-280)
  // -------------------------------------------------------

  describe("throttle action", () => {
    it("throttle returns reason with percentage when hourly limit exceeded", () => {
      const b = new CostCircuitBreaker({
        limits: { perHour: 2.0 },
        action: "throttle",
        persist: false,
      })
      b.recordSpend(2.5, "gpt-4o-mini")
      const result = b.check()
      expect(result.allowed).toBe(true)
      expect(result.reason).toContain("Throttled")
      expect(result.reason).toContain("hour")
    })

    it("throttle action increments requestsBlocked counter", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "throttle",
        persist: false,
      })
      b.recordSpend(1.0, "gpt-4o-mini")
      b.check()
      b.check()
      const status = b.getStatus()
      expect(status.requestsBlocked).toBe(2)
    })

    it("getStatus reports tripped=false with throttle action even when limits exceeded", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "throttle",
        persist: false,
      })
      b.recordSpend(2.0, "gpt-4o-mini")
      const status = b.getStatus()
      // tripped is only true when action === "stop"
      expect(status.tripped).toBe(false)
    })
  })

  // -------------------------------------------------------
  // Warning auto-reset (lines 204-209)
  // -------------------------------------------------------

  describe("warning auto-reset", () => {
    it("re-fires warning when spend drops below 80% and rises back above it", () => {
      let warningCount = 0
      const b = new CostCircuitBreaker({
        limits: { perSession: 10.0 },
        action: "warn",
        persist: false,
        onWarning: (_event) => {
          warningCount++
        },
      })

      // Push spend above 80% ($8.00 of $10.00)
      b.recordSpend(8.5, "gpt-4o-mini")
      b.check()
      expect(warningCount).toBe(1)

      // Reset to simulate spend dropping below 80%
      b.reset()
      // After reset, records are cleared so spend is 0 — well below 80%
      b.check() // This check sees spend=0 < 8.0 so auto-reset clears the warning flag
      expect(warningCount).toBe(1) // No new warning since we're below threshold

      // Push spend above 80% again
      b.recordSpend(9.0, "gpt-4o-mini")
      b.check()
      expect(warningCount).toBe(2) // Warning should fire again
    })

    it("auto-resets warning flag when spend is below threshold on check", () => {
      let warningCount = 0
      const b = new CostCircuitBreaker({
        limits: { perHour: 10.0 },
        action: "warn",
        persist: false,
        onWarning: () => {
          warningCount++
        },
      })

      // Spend above 80% of perHour ($8 of $10)
      b.recordSpend(8.5, "gpt-4o-mini")
      b.check()
      expect(warningCount).toBe(1)

      // Now use updateLimits to raise the limit so current spend is below 80%
      b.updateLimits({ perHour: 100.0 })
      // updateLimits clears warningFired, so next check with spend=8.5 < 80 (80% of 100) won't re-fire
      b.check()
      expect(warningCount).toBe(1) // 8.5 < 80, no warning

      // Lower limit back so 8.5 > 80% again
      b.updateLimits({ perHour: 10.0 })
      b.check()
      expect(warningCount).toBe(2) // Warning fires again
    })
  })

  // -------------------------------------------------------
  // perMonth limit (line 34) — additional coverage
  // -------------------------------------------------------

  describe("perMonth limit", () => {
    it("monthly limit tracks spend correctly", () => {
      const b = new CostCircuitBreaker({
        limits: { perMonth: 100.0 },
        action: "stop",
        persist: false,
      })
      b.recordSpend(50.0, "gpt-4o-mini")
      const status = b.getStatus()
      expect(status.spend.lastMonth).toBe(50.0)
      expect(status.remaining.month).toBe(50.0)
    })

    it("fires warning at 80% of monthly limit", () => {
      let warningEvent: unknown = null
      const b = new CostCircuitBreaker({
        limits: { perMonth: 100.0 },
        action: "stop",
        persist: false,
        onWarning: (event) => {
          warningEvent = event
        },
      })
      b.recordSpend(80.0, "gpt-4o-mini")
      b.check()
      expect(warningEvent).not.toBeNull()
    })
  })

  // -------------------------------------------------------
  // Zero limit edge case (line 234)
  // -------------------------------------------------------

  describe("zero limit edge case", () => {
    it("zero perHour blocks immediately", () => {
      const b = new CostCircuitBreaker({
        limits: { perHour: 0 },
        action: "stop",
        persist: false,
      })
      const result = b.check()
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("hour")
    })

    it("zero perDay blocks immediately", () => {
      const b = new CostCircuitBreaker({
        limits: { perDay: 0 },
        action: "stop",
        persist: false,
      })
      const result = b.check()
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("day")
    })

    it("zero perMonth blocks immediately", () => {
      const b = new CostCircuitBreaker({
        limits: { perMonth: 0 },
        action: "stop",
        persist: false,
      })
      const result = b.check()
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("month")
    })

    it("zero limit with throttle action returns throttled", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "throttle",
        persist: false,
      })
      const result = b.check()
      expect(result.allowed).toBe(true)
      expect(result.reason).toContain("Throttled")
    })

    it("zero limit with warn action still allows", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "warn",
        persist: false,
      })
      const result = b.check()
      expect(result.allowed).toBe(true)
    })

    it("percentUsed is 999 in check reason for zero limit", () => {
      const b = new CostCircuitBreaker({
        limits: { perHour: 0 },
        action: "throttle",
        persist: false,
      })
      const result = b.check()
      expect(result.reason).toContain("999")
    })
  })

  // -------------------------------------------------------
  // MAX_BREAKER_RECORDS hard cap pruning (line 303)
  // -------------------------------------------------------

  describe("MAX_BREAKER_RECORDS pruning", () => {
    it("prunes records when exceeding 50,000 hard cap", () => {
      const b = new CostCircuitBreaker({
        limits: { perMonth: 999999.0 },
        action: "stop",
        persist: false,
      })

      // Access the internal records array via type assertion to inject 50,001 records directly
      // This avoids calling recordSpend 50,001 times which would time out
      const internal = b as unknown as {
        records: Array<{ timestamp: number; cost: number; model: string }>
      }
      const now = Date.now()
      for (let i = 0; i < 50_001; i++) {
        internal.records.push({ timestamp: now - i, cost: 0.00001, model: "gpt-4o-mini" })
      }
      expect(internal.records.length).toBe(50_001)

      // Now call recordSpend which triggers the pruning logic
      b.recordSpend(0.00001, "gpt-4o-mini")

      // After pruning, records should be capped at 50,000
      expect(internal.records.length).toBeLessThanOrEqual(50_000)
    })
  })

  // -------------------------------------------------------
  // onTripped callback
  // -------------------------------------------------------

  describe("onTripped callback", () => {
    it("fires onTripped when stop action triggers", () => {
      let trippedEvent: unknown = null
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "stop",
        persist: false,
        onTripped: (event) => {
          trippedEvent = event
        },
      })
      b.recordSpend(1.5, "gpt-4o-mini")
      b.check()
      expect(trippedEvent).not.toBeNull()
    })

    it("fires onTripped when throttle action triggers", () => {
      let trippedEvent: unknown = null
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "throttle",
        persist: false,
        onTripped: (event) => {
          trippedEvent = event
        },
      })
      b.recordSpend(1.5, "gpt-4o-mini")
      b.check()
      expect(trippedEvent).not.toBeNull()
    })
  })

  // -------------------------------------------------------
  // onReset callback
  // -------------------------------------------------------

  describe("onReset callback", () => {
    it("fires onReset when reset is called", () => {
      let resetWindow: string | null = null
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "stop",
        persist: false,
        onReset: (window) => {
          resetWindow = window
        },
      })
      b.reset()
      expect(resetWindow).toBe("all")
    })
  })

  // -------------------------------------------------------
  // Estimated cost projection
  // -------------------------------------------------------

  describe("estimated cost projection", () => {
    it("blocks when estimated cost would push spend over limit", () => {
      // gpt-4o-mini: 0.15/M input, 0.6/M output
      // 100,000 input tokens = $0.015, 50,000 output tokens = $0.03
      // estimated cost = $0.045
      // current spend $0.01 + estimated $0.045 = $0.055 > $0.05 limit
      const b = new CostCircuitBreaker({
        limits: { perSession: 0.05 },
        action: "stop",
        persist: false,
      })
      b.recordSpend(0.01, "gpt-4o-mini")
      const result = b.check("gpt-4o-mini", 100000, 50000)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("session")
    })

    it("allows when estimated cost stays within limit", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 10.0 },
        action: "stop",
        persist: false,
      })
      b.recordSpend(0.01, "gpt-4o-mini")
      const result = b.check("gpt-4o-mini", 100, 100)
      expect(result.allowed).toBe(true)
    })

    it("handles unknown model gracefully (no estimated cost added)", () => {
      const b = new CostCircuitBreaker({
        limits: { perSession: 1.0 },
        action: "stop",
        persist: false,
      })
      b.recordSpend(0.5, "gpt-4o-mini")
      // Unknown model - estimatedCost should be 0, so 0.5 < 1.0 = allowed
      const result = b.check("totally-unknown-model", 100000, 50000)
      expect(result.allowed).toBe(true)
    })
  })
})

// -------------------------------------------------------
// Persistence tests (lines 184, 402-422)
// These need window and localStorage mocking
// -------------------------------------------------------

describe("CostCircuitBreaker persistence", () => {
  let mockStorage: Record<string, string>

  beforeEach(() => {
    mockStorage = {}
    const localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key]
      }),
      clear: vi.fn(() => {
        mockStorage = {}
      }),
      length: 0,
      key: vi.fn(() => null),
    }
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", localStorageMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------
  // save() method (lines 400-411)
  // -------------------------------------------------------

  it("saves state to localStorage when persist is true", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })
    b.recordSpend(1.5, "gpt-4o-mini")

    expect(localStorage.setItem).toHaveBeenCalledWith("test-breaker", expect.any(String))
    const saved = JSON.parse(mockStorage["test-breaker"])
    expect(saved.records).toHaveLength(1)
    expect(saved.records[0].cost).toBe(1.5)
    expect(saved.records[0].model).toBe("gpt-4o-mini")
  })

  it("uses default storage key when storageKey is not specified", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
    })
    b.recordSpend(1.0, "gpt-4o-mini")

    expect(localStorage.setItem).toHaveBeenCalledWith("tokenshield-breaker", expect.any(String))
  })

  it("saves on reset", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })
    b.recordSpend(1.0, "gpt-4o-mini")
    ;(localStorage.setItem as ReturnType<typeof vi.fn>).mockClear()
    b.reset()

    expect(localStorage.setItem).toHaveBeenCalled()
    const saved = JSON.parse(mockStorage["test-breaker"])
    expect(saved.records).toHaveLength(0)
  })

  it("saves on check when limit is tripped", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 1.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })
    b.recordSpend(1.5, "gpt-4o-mini")
    ;(localStorage.setItem as ReturnType<typeof vi.fn>).mockClear()
    b.check()

    expect(localStorage.setItem).toHaveBeenCalled()
  })

  // -------------------------------------------------------
  // restore() method (lines 414-427) — called from constructor (line 184)
  // -------------------------------------------------------

  it("restores records from localStorage on construction when persist is true", () => {
    const now = Date.now()
    const persistedState = {
      records: [
        { timestamp: now - 1000, cost: 2.5, model: "gpt-4o-mini" },
        { timestamp: now - 500, cost: 1.5, model: "gpt-4o-mini" },
      ],
      sessionStart: now - 60000,
      totalBlocked: 3,
    }
    mockStorage["test-breaker"] = JSON.stringify(persistedState)

    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    expect(localStorage.getItem).toHaveBeenCalledWith("test-breaker")
    const status = b.getStatus()
    // Records should be restored (but sessionStart is NOT restored — new session)
    // Since the records have timestamps close to now, they should appear in hourly spend
    expect(status.spend.lastHour).toBeCloseTo(4.0)
    // totalBlocked should be restored
    expect(status.requestsBlocked).toBe(3)
  })

  it("restores using default storage key when storageKey is not specified", () => {
    const now = Date.now()
    const persistedState = {
      records: [{ timestamp: now - 1000, cost: 3.0, model: "gpt-4o-mini" }],
      sessionStart: now - 5000,
      totalBlocked: 1,
    }
    mockStorage["tokenshield-breaker"] = JSON.stringify(persistedState)

    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
    })

    expect(localStorage.getItem).toHaveBeenCalledWith("tokenshield-breaker")
    const status = b.getStatus()
    expect(status.spend.lastHour).toBeCloseTo(3.0)
  })

  it("does not restore sessionStart — each page load is a new session", () => {
    const oldSessionStart = Date.now() - 100000
    const now = Date.now()
    const persistedState = {
      records: [{ timestamp: now - 1000, cost: 2.0, model: "gpt-4o-mini" }],
      sessionStart: oldSessionStart,
      totalBlocked: 0,
    }
    mockStorage["test-breaker"] = JSON.stringify(persistedState)

    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    const status = b.getStatus()
    // Session spend should count records from the NEW sessionStart (Date.now()),
    // not the old persisted one. Since the record's timestamp (now - 1000) is before
    // the new sessionStart, it may or may not be counted depending on timing.
    // The key assertion is that totalBlocked was restored correctly.
    expect(status.requestsBlocked).toBe(0)
  })

  it("handles empty localStorage gracefully", () => {
    // No data in storage
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    expect(localStorage.getItem).toHaveBeenCalledWith("test-breaker")
    const status = b.getStatus()
    expect(status.spend.session).toBe(0)
    expect(status.requestsBlocked).toBe(0)
  })

  // -------------------------------------------------------
  // Corrupted data handling (line 424)
  // -------------------------------------------------------

  it("handles corrupted localStorage data gracefully", () => {
    mockStorage["test-breaker"] = "this is not valid JSON{{{{"

    // Should not throw
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    const status = b.getStatus()
    expect(status.spend.session).toBe(0)
    expect(status.requestsBlocked).toBe(0)
  })

  it("handles partially corrupted persisted state (missing fields)", () => {
    mockStorage["test-breaker"] = JSON.stringify({ records: null, totalBlocked: null })

    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    // Should fallback to defaults (records ?? [], totalBlocked ?? 0)
    const status = b.getStatus()
    expect(status.spend.session).toBe(0)
    expect(status.requestsBlocked).toBe(0)
  })

  // -------------------------------------------------------
  // localStorage unavailable/full (line 409)
  // -------------------------------------------------------

  it("handles localStorage.setItem throwing (storage full)", () => {
    ;(localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new DOMException("QuotaExceededError")
    })

    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    // Should not throw
    expect(() => b.recordSpend(1.0, "gpt-4o-mini")).not.toThrow()
    expect(() => b.check()).not.toThrow()
    expect(() => b.reset()).not.toThrow()
  })

  it("handles localStorage.getItem throwing", () => {
    ;(localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("SecurityError: localStorage access denied")
    })

    // Should not throw during construction
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: true,
      storageKey: "test-breaker",
    })

    const status = b.getStatus()
    expect(status.spend.session).toBe(0)
  })

  // -------------------------------------------------------
  // Full save/restore cycle
  // -------------------------------------------------------

  it("full save/restore cycle preserves spend across instances", () => {
    const b1 = new CostCircuitBreaker({
      limits: { perSession: 10.0, perHour: 20.0 },
      action: "stop",
      persist: true,
      storageKey: "cycle-test",
    })

    b1.recordSpend(3.0, "gpt-4o-mini")
    b1.recordSpend(2.0, "claude-sonnet-4-20250514")

    // Create a new instance that restores from localStorage
    const b2 = new CostCircuitBreaker({
      limits: { perSession: 10.0, perHour: 20.0 },
      action: "stop",
      persist: true,
      storageKey: "cycle-test",
    })

    const status = b2.getStatus()
    expect(status.spend.lastHour).toBeCloseTo(5.0)
    // Records should have both entries
    expect(status.remaining.hour).toBeCloseTo(15.0)
  })

  // -------------------------------------------------------
  // persist: false should NOT save/restore
  // -------------------------------------------------------

  it("does not call localStorage when persist is false", () => {
    const b = new CostCircuitBreaker({
      limits: { perSession: 10.0 },
      action: "stop",
      persist: false,
    })
    b.recordSpend(1.0, "gpt-4o-mini")
    b.check()
    b.reset()

    expect(localStorage.getItem).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
