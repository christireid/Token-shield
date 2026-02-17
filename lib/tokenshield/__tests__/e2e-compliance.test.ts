import { describe, it, expect, beforeEach } from "vitest"
import { tokenShieldMiddleware } from "../middleware"
import { AuditLog } from "../audit-log"
import {
  activateLicense,
  getLicenseInfo,
  isModulePermitted,
  resetLicense,
  generateTestKey,
  generateTestKeySync,
  setLicenseSecret,
} from "../license"

/**
 * End-to-end compliance test: simulates a production lifecycle
 * with license activation, API calls, and audit log verification.
 */
describe("E2E License + Audit Compliance", () => {
  beforeEach(() => {
    resetLicense()
  })

  it("full lifecycle: activate → API calls → cache → block → export → verify", async () => {
    // 1. Activate a signed enterprise license
    const SECRET = "e2e-test-secret"
    setLicenseSecret(SECRET)
    const key = await generateTestKey("enterprise", "E2E Corp", 365, SECRET)
    const license = await activateLicense(key)
    expect(license.tier).toBe("enterprise")
    expect(license.valid).toBe(true)
    expect(license.holder).toBe("E2E Corp")

    // 2. Verify module access at enterprise tier
    expect(isModulePermitted("token-counter")).toBe(true)
    expect(isModulePermitted("response-cache")).toBe(true)
    expect(isModulePermitted("circuit-breaker")).toBe(true)
    expect(isModulePermitted("audit-log")).toBe(true)

    // 3. Create middleware with audit logging
    const auditLog = new AuditLog({ maxEntries: 1000 })
    const mw = tokenShieldMiddleware({
      auditLog,
      modules: { guard: true, cache: true, ledger: true },
    })

    // 4. Simulate pipeline events
    // 4a. Successful API call
    mw.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 500,
      outputTokens: 200,
      cost: 0.005,
      saved: 0.001,
    })

    // 4b. Cache hit
    mw.events.emit("cache:hit", {
      matchType: "fuzzy" as const,
      similarity: 0.93,
      savedCost: 0.005,
    })

    // 4c. Another API call
    mw.events.emit("ledger:entry", {
      model: "gpt-4o-mini",
      inputTokens: 200,
      outputTokens: 100,
      cost: 0.0001,
      saved: 0,
    })

    // 4d. Request blocked
    mw.events.emit("request:blocked", {
      reason: "rate_limit",
      estimatedCost: 0.02,
    })

    // 4e. Anomaly detected
    mw.events.emit("anomaly:detected", {
      type: "cost_spike",
      value: 0.5,
      mean: 0.01,
      deviation: 0.005,
      zScore: 98.0,
      timestamp: Date.now(),
      detectionMethod: "z-score",
      severity: "critical",
    })

    // 5. Verify audit log captured all events
    expect(auditLog.size).toBe(5)

    const apiCalls = auditLog.getEntries({ eventType: "api_call" })
    expect(apiCalls).toHaveLength(2)
    expect(apiCalls[0].model).toBe("gpt-4o")
    expect(apiCalls[1].model).toBe("gpt-4o-mini")

    const cacheHits = auditLog.getEntries({ eventType: "cache_hit" })
    expect(cacheHits).toHaveLength(1)

    const blocked = auditLog.getEntries({ eventType: "request_blocked" })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].severity).toBe("warn")

    const anomalies = auditLog.getEntries({ eventType: "anomaly_detected" })
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].severity).toBe("warn")

    // 6. Verify hash chain integrity
    const integrity = auditLog.verifyIntegrity()
    expect(integrity.valid).toBe(true)

    // 7. Export audit log as JSON
    const jsonExport = auditLog.exportJSON()
    const parsed = JSON.parse(jsonExport)
    expect(parsed.totalEntries).toBe(5)
    expect(parsed.integrity.valid).toBe(true)
    expect(parsed.entries).toHaveLength(5)

    // 8. Export as CSV
    const csvExport = auditLog.exportCSV()
    const csvLines = csvExport.split("\n")
    expect(csvLines).toHaveLength(7) // header + 5 original entries + 1 export_requested from exportJSON

    // 9. Verify filtering
    const warnAndAbove = auditLog.getEntries({ severity: "warn" })
    expect(warnAndAbove).toHaveLength(2) // request_blocked + anomaly

    // 10. Clean up
    mw.dispose()
  })

  it("license restricts module access by tier", async () => {
    // Activate team license
    const key = generateTestKeySync("team", "Team User")
    await activateLicense(key)

    expect(isModulePermitted("response-cache")).toBe(true) // community
    expect(isModulePermitted("circuit-breaker")).toBe(true) // community
    expect(isModulePermitted("user-budget-manager")).toBe(true) // team
    expect(isModulePermitted("audit-log")).toBe(false) // enterprise
  })

  it("expired license falls back to community", async () => {
    const expiredKey = generateTestKeySync("enterprise", "Expired Corp", -30)
    const info = await activateLicense(expiredKey)
    expect(info.valid).toBe(false)
    expect(info.tier).toBe("community")
  })

  it("forged key is rejected when secret is set", async () => {
    const SECRET = "server-secret"
    setLicenseSecret(SECRET)

    // First activate a valid key to exit dev mode
    const validKey = await generateTestKey("team", "Legit User", 365, SECRET)
    await activateLicense(validKey)
    expect(getLicenseInfo().tier).toBe("team")

    // Now an attacker creates a key signed with a different secret
    const forgedKey = generateTestKeySync("enterprise", "Attacker", 365, "hacker-secret")
    const info = await activateLicense(forgedKey)
    expect(info.valid).toBe(false)
    expect(info.tier).toBe("community")

    // With dev mode disabled, only community modules allowed
    expect(isModulePermitted("token-counter")).toBe(true) // community
    expect(isModulePermitted("response-cache")).toBe(true) // community
    expect(isModulePermitted("user-budget-manager")).toBe(false) // team
  })

  it("audit log survives many events without integrity loss", () => {
    const auditLog = new AuditLog({ maxEntries: 500 })
    const mw = tokenShieldMiddleware({ auditLog })

    // Fire 100 events
    for (let i = 0; i < 100; i++) {
      mw.events.emit("ledger:entry", {
        model: "gpt-4o",
        inputTokens: 100 + i,
        outputTokens: 50 + i,
        cost: 0.001 * i,
        saved: 0,
      })
    }

    expect(auditLog.size).toBe(100)
    expect(auditLog.verifyIntegrity().valid).toBe(true)

    // Verify sequential ordering
    const entries = auditLog.getEntries()
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].seq).toBe(entries[i - 1].seq + 1)
      expect(entries[i].prevHash).toBe(entries[i - 1].hash)
    }

    mw.dispose()
  })
})
