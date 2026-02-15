import { describe, it, expect, beforeEach } from "vitest"
import { tokenShieldMiddleware } from "../middleware"
import { AuditLog } from "../audit-log"

/**
 * Integration tests for audit log wiring in the middleware.
 * Verifies that pipeline events flow through to the audit log correctly.
 */
describe("Middleware Audit Log Integration", () => {
  let auditLog: AuditLog

  beforeEach(() => {
    auditLog = new AuditLog()
  })

  it("creates middleware with audit log instance", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    expect(mw.auditLog).toBe(auditLog)
    mw.dispose()
  })

  it("creates middleware with audit log config object", () => {
    const mw = tokenShieldMiddleware({
      auditLog: { maxEntries: 100, minSeverity: "warn" },
    })
    expect(mw.auditLog).toBeInstanceOf(AuditLog)
    mw.dispose()
  })

  it("audit log records ledger:entry events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    // Emit a ledger:entry event via the event bus
    mw.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.0125,
      saved: 0.002,
    })
    const entries = auditLog.getEntries({ eventType: "api_call" })
    expect(entries).toHaveLength(1)
    expect(entries[0].model).toBe("gpt-4o")
    expect(entries[0].data.inputTokens).toBe(1000)
    expect(entries[0].data.outputTokens).toBe(500)
    expect(entries[0].data.cost).toBe(0.0125)
    mw.dispose()
  })

  it("audit log records cache:hit events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("cache:hit", {
      matchType: "fuzzy" as const,
      similarity: 0.92,
      savedCost: 0.005,
    })
    const entries = auditLog.getEntries({ eventType: "cache_hit" })
    expect(entries).toHaveLength(1)
    expect(entries[0].eventType).toBe("cache_hit")
    mw.dispose()
  })

  it("audit log records request:blocked events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("request:blocked", {
      reason: "rate_limit",
      estimatedCost: 0.05,
    })
    const entries = auditLog.getEntries({ eventType: "request_blocked" })
    expect(entries).toHaveLength(1)
    expect(entries[0].severity).toBe("warn")
    expect(entries[0].data.reason).toBe("rate_limit")
    mw.dispose()
  })

  it("audit log records breaker:tripped events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("breaker:tripped", {
      limitType: "hourly",
      currentSpend: 7.2,
      limit: 5,
      action: "blocked",
    })
    const entries = auditLog.getEntries({ eventType: "breaker_tripped" })
    expect(entries).toHaveLength(1)
    expect(entries[0].severity).toBe("critical")
    expect(entries[0].data.limitType).toBe("hourly")
    mw.dispose()
  })

  it("audit log records userBudget:exceeded events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("userBudget:exceeded", {
      userId: "user-123",
      limitType: "daily",
      currentSpend: 12.5,
      limit: 10,
    })
    const entries = auditLog.getEntries({ eventType: "budget_exceeded" })
    expect(entries).toHaveLength(1)
    expect(entries[0].severity).toBe("error")
    expect(entries[0].data.userId).toBe("user-123")
    mw.dispose()
  })

  it("audit log records anomaly:detected events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("anomaly:detected", {
      type: "cost_spike",
      value: 0.5,
      mean: 0.1,
      deviation: 0.05,
      zScore: 8.0,
      timestamp: Date.now(),
      detectionMethod: "z-score",
      severity: "critical",
    })
    const entries = auditLog.getEntries({ eventType: "anomaly_detected" })
    expect(entries).toHaveLength(1)
    expect(entries[0].severity).toBe("warn")
    expect(entries[0].data.value).toBe(0.5)
    mw.dispose()
  })

  it("audit log records router:downgraded events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("router:downgraded", {
      originalModel: "gpt-4o",
      selectedModel: "gpt-4o-mini",
      complexity: 25,
      savedCost: 0.003,
    })
    const entries = auditLog.getEntries({ eventType: "model_routed" })
    expect(entries).toHaveLength(1)
    expect(entries[0].data.fromModel).toBe("gpt-4o")
    expect(entries[0].data.toModel).toBe("gpt-4o-mini")
    mw.dispose()
  })

  it("dispose cleans up audit log event subscriptions", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.dispose()

    // After dispose, events should NOT reach the audit log
    mw.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.01,
      saved: 0,
    })
    expect(auditLog.size).toBe(0)
  })

  it("audit log integrity is maintained after multiple events", () => {
    const mw = tokenShieldMiddleware({ auditLog })

    mw.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      cost: 0.01,
      saved: 0,
    })
    mw.events.emit("cache:hit", {
      matchType: "exact" as const,
      similarity: 1,
      savedCost: 0.01,
    })
    mw.events.emit("request:blocked", {
      reason: "debounce",
      estimatedCost: 0.01,
    })

    expect(auditLog.size).toBe(3)
    expect(auditLog.verifyIntegrity().valid).toBe(true)
    mw.dispose()
  })

  it("multiple middleware instances have independent audit logs", () => {
    const log1 = new AuditLog()
    const log2 = new AuditLog()
    const mw1 = tokenShieldMiddleware({ auditLog: log1 })
    const mw2 = tokenShieldMiddleware({ auditLog: log2 })

    mw1.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      cost: 0.001,
      saved: 0,
    })

    expect(log1.size).toBe(1)
    expect(log2.size).toBe(0)

    mw1.dispose()
    mw2.dispose()
  })
})
