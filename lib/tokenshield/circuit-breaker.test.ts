import { describe, it, expect, beforeEach } from "vitest"
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
})
