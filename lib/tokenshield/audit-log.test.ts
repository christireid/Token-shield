import { describe, it, expect, beforeEach } from "vitest"
import { AuditLog } from "./audit-log"
import type { AuditEntry } from "./audit-log"

describe("AuditLog", () => {
  let log: AuditLog

  beforeEach(() => {
    log = new AuditLog()
  })

  describe("record", () => {
    it("records an event and returns a valid entry", () => {
      const entry = log.record("api_call", "info", "middleware", "Test API call", { cost: 0.05 })
      expect(entry.seq).toBe(1)
      expect(entry.eventType).toBe("api_call")
      expect(entry.severity).toBe("info")
      expect(entry.module).toBe("middleware")
      expect(entry.description).toBe("Test API call")
      expect(entry.data).toEqual({ cost: 0.05 })
      expect(entry.hash).toBeTruthy()
      expect(entry.prevHash).toBe("genesis")
    })

    it("increments sequence numbers", () => {
      const e1 = log.record("api_call", "info", "m1", "first")
      const e2 = log.record("cache_hit", "info", "m2", "second")
      expect(e1.seq).toBe(1)
      expect(e2.seq).toBe(2)
    })

    it("chains hashes correctly", () => {
      const e1 = log.record("api_call", "info", "m1", "first")
      const e2 = log.record("cache_hit", "info", "m2", "second")
      expect(e2.prevHash).toBe(e1.hash)
    })

    it("includes userId and model when provided", () => {
      const entry = log.record("api_call", "info", "middleware", "call", {}, "user-123", "gpt-4o")
      expect(entry.userId).toBe("user-123")
      expect(entry.model).toBe("gpt-4o")
    })

    it("filters by minimum severity", () => {
      const warnLog = new AuditLog({ minSeverity: "warn" })
      const entry = warnLog.record("api_call", "info", "m", "should be filtered")
      expect(entry.seq).toBe(-1) // noop entry
      expect(warnLog.size).toBe(0)

      const warnEntry = warnLog.record("request_blocked", "warn", "m", "should pass")
      expect(warnEntry.seq).toBe(1)
      expect(warnLog.size).toBe(1)
    })

    it("filters by event types", () => {
      const filtered = new AuditLog({ eventTypes: ["api_call", "cache_hit"] })
      filtered.record("api_call", "info", "m", "allowed")
      filtered.record("request_blocked", "warn", "m", "not allowed")
      filtered.record("cache_hit", "info", "m", "allowed too")
      expect(filtered.size).toBe(2)
    })

    it("prunes old entries when exceeding maxEntries", () => {
      const small = new AuditLog({ maxEntries: 3 })
      small.record("api_call", "info", "m", "1")
      small.record("api_call", "info", "m", "2")
      small.record("api_call", "info", "m", "3")
      small.record("api_call", "info", "m", "4")
      expect(small.size).toBe(3)
    })

    it("calls onEntry callback for each recorded entry", () => {
      const received: AuditEntry[] = []
      const cbLog = new AuditLog({ onEntry: (e) => received.push(e) })
      cbLog.record("api_call", "info", "m", "test")
      cbLog.record("cache_hit", "info", "m", "test2")
      expect(received).toHaveLength(2)
      expect(received[0].eventType).toBe("api_call")
      expect(received[1].eventType).toBe("cache_hit")
    })
  })

  describe("convenience methods", () => {
    it("logApiCall creates correct entry", () => {
      const entry = log.logApiCall("gpt-4o", 1000, 500, 0.05, "user1")
      expect(entry.eventType).toBe("api_call")
      expect(entry.model).toBe("gpt-4o")
      expect(entry.userId).toBe("user1")
      expect(entry.data).toEqual({ inputTokens: 1000, outputTokens: 500, cost: 0.05 })
    })

    it("logCacheHit creates correct entry", () => {
      const entry = log.logCacheHit("gpt-4o", "What is React?", "user2")
      expect(entry.eventType).toBe("cache_hit")
      expect(entry.data.promptLength).toBe(14)
    })

    it("logRequestBlocked creates correct entry", () => {
      const entry = log.logRequestBlocked("rate-limit", "gpt-4o", "user3")
      expect(entry.eventType).toBe("request_blocked")
      expect(entry.severity).toBe("warn")
    })

    it("logBudgetExceeded creates correct entry", () => {
      const entry = log.logBudgetExceeded("user4", 10, 12.5)
      expect(entry.eventType).toBe("budget_exceeded")
      expect(entry.severity).toBe("error")
      expect(entry.data.budget).toBe(10)
      expect(entry.data.spent).toBe(12.5)
    })

    it("logBreakerTripped creates correct entry", () => {
      const entry = log.logBreakerTripped("perHour", 5.0, 6.2)
      expect(entry.eventType).toBe("breaker_tripped")
      expect(entry.severity).toBe("critical")
    })

    it("logAnomalyDetected creates correct entry", () => {
      const entry = log.logAnomalyDetected("cost_spike", 2.5, 4.2, "gpt-4o")
      expect(entry.eventType).toBe("anomaly_detected")
      expect(entry.data.zscore).toBe(4.2)
    })

    it("logModelRouted creates correct entry", () => {
      const entry = log.logModelRouted("gpt-4o", "gpt-4o-mini", "cost-optimization")
      expect(entry.eventType).toBe("model_routed")
      expect(entry.data.fromModel).toBe("gpt-4o")
      expect(entry.data.toModel).toBe("gpt-4o-mini")
    })

    it("logConfigChanged creates correct entry", () => {
      const entry = log.logConfigChanged("breaker.limits.perHour", 5, 10)
      expect(entry.eventType).toBe("config_changed")
      expect(entry.severity).toBe("warn")
      expect(entry.data.oldValue).toBe(5)
      expect(entry.data.newValue).toBe(10)
    })
  })

  describe("verifyIntegrity", () => {
    it("returns valid for unmodified chain", () => {
      log.logApiCall("gpt-4o", 100, 50, 0.01)
      log.logCacheHit("gpt-4o", "test")
      log.logModelRouted("gpt-4o", "gpt-4o-mini", "cheaper")
      expect(log.verifyIntegrity()).toEqual({ valid: true })
    })

    it("returns valid for empty log", () => {
      expect(log.verifyIntegrity()).toEqual({ valid: true })
    })
  })

  describe("getEntries", () => {
    beforeEach(() => {
      log.logApiCall("gpt-4o", 100, 50, 0.01, "user1")
      log.logCacheHit("gpt-4o-mini", "test", "user2")
      log.logRequestBlocked("rate-limit", "gpt-4o", "user1")
      log.logBreakerTripped("perHour", 5.0, 6.0)
    })

    it("returns all entries without filters", () => {
      expect(log.getEntries()).toHaveLength(4)
    })

    it("filters by eventType", () => {
      const entries = log.getEntries({ eventType: "api_call" })
      expect(entries).toHaveLength(1)
      expect(entries[0].eventType).toBe("api_call")
    })

    it("filters by severity (minimum)", () => {
      const entries = log.getEntries({ severity: "warn" })
      expect(entries.length).toBeGreaterThanOrEqual(2) // warn + critical
    })

    it("filters by module", () => {
      const entries = log.getEntries({ module: "request-guard" })
      expect(entries).toHaveLength(1)
    })

    it("filters by userId", () => {
      const entries = log.getEntries({ userId: "user1" })
      expect(entries).toHaveLength(2)
    })

    it("returns a copy (mutations don't affect internal state)", () => {
      const entries = log.getEntries()
      entries.pop()
      expect(log.getEntries()).toHaveLength(4)
    })
  })

  describe("exportJSON", () => {
    it("produces valid JSON with integrity check", () => {
      log.logApiCall("gpt-4o", 100, 50, 0.01)
      const json = log.exportJSON()
      const parsed = JSON.parse(json)
      expect(parsed.integrity.valid).toBe(true)
      expect(parsed.totalEntries).toBe(1)
      expect(parsed.entries).toHaveLength(1)
      expect(parsed.exportedAt).toBeTruthy()
    })
  })

  describe("exportCSV", () => {
    it("produces valid CSV with headers", () => {
      log.logApiCall("gpt-4o", 100, 50, 0.01, "user1")
      const csv = log.exportCSV()
      const lines = csv.split("\n")
      expect(lines[0]).toBe(
        "seq,timestamp,eventType,severity,module,userId,model,description,data,hash",
      )
      expect(lines).toHaveLength(2) // header + 1 row
    })

    it("escapes commas and quotes in CSV values", () => {
      log.record("config_changed", "warn", "config", 'Field with "quotes" and, commas', {})
      const csv = log.exportCSV()
      // Description with quotes should be properly escaped
      expect(csv).toContain('""quotes""')
    })
  })

  describe("clear", () => {
    it("removes all entries and resets sequence", () => {
      log.logApiCall("gpt-4o", 100, 50, 0.01)
      log.logApiCall("gpt-4o", 200, 100, 0.02)
      expect(log.size).toBe(2)

      log.clear()
      expect(log.size).toBe(0)

      // New entries start from seq 1 again
      const entry = log.logApiCall("gpt-4o", 100, 50, 0.01)
      expect(entry.seq).toBe(1)
      expect(entry.prevHash).toBe("genesis")
    })
  })

  describe("size", () => {
    it("returns 0 for empty log", () => {
      expect(log.size).toBe(0)
    })

    it("tracks entry count accurately", () => {
      log.logApiCall("gpt-4o", 100, 50, 0.01)
      log.logCacheHit("gpt-4o", "test")
      expect(log.size).toBe(2)
    })
  })
})
