import { describe, it, expect, vi, beforeEach } from "vitest"
import { tokenShieldMiddleware } from "../middleware"
import { AuditLog } from "../audit-log"

/**
 * Tests that compressor:applied and delta:applied events
 * are emitted by the middleware and flow through to the audit log.
 */
describe("Middleware compressor/delta event emission", () => {
  let auditLog: AuditLog

  beforeEach(() => {
    auditLog = new AuditLog()
  })

  it("audit log records compressor:applied events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("compressor:applied", {
      savedTokens: 200,
      originalTokens: 1000,
      compressedTokens: 800,
    })
    const entries = auditLog.getEntries({ eventType: "compressor_applied" })
    expect(entries).toHaveLength(1)
    expect(entries[0].eventType).toBe("compressor_applied")
    expect(entries[0].severity).toBe("info")
    expect(entries[0].data.savedTokens).toBe(200)
    expect(entries[0].data.originalTokens).toBe(1000)
    expect(entries[0].data.compressedTokens).toBe(800)
    mw.dispose()
  })

  it("audit log records delta:applied events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("delta:applied", {
      savedTokens: 150,
      originalTokens: 900,
      encodedTokens: 750,
    })
    const entries = auditLog.getEntries({ eventType: "delta_applied" })
    expect(entries).toHaveLength(1)
    expect(entries[0].eventType).toBe("delta_applied")
    expect(entries[0].severity).toBe("info")
    expect(entries[0].data.savedTokens).toBe(150)
    expect(entries[0].data.originalTokens).toBe(900)
    expect(entries[0].data.encodedTokens).toBe(750)
    mw.dispose()
  })

  it("compressor and delta events maintain audit chain integrity", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.events.emit("compressor:applied", {
      savedTokens: 100,
      originalTokens: 500,
      compressedTokens: 400,
    })
    mw.events.emit("delta:applied", {
      savedTokens: 50,
      originalTokens: 400,
      encodedTokens: 350,
    })
    mw.events.emit("ledger:entry", {
      model: "gpt-4o",
      inputTokens: 350,
      outputTokens: 200,
      cost: 0.005,
      saved: 0.003,
    })

    expect(auditLog.size).toBe(3)
    expect(auditLog.verifyIntegrity().valid).toBe(true)
    mw.dispose()
  })

  it("dispose removes compressor/delta event listeners", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    mw.dispose()

    // After dispose, events should NOT reach the audit log
    mw.events.emit("compressor:applied", {
      savedTokens: 100,
      originalTokens: 500,
      compressedTokens: 400,
    })
    mw.events.emit("delta:applied", {
      savedTokens: 50,
      originalTokens: 400,
      encodedTokens: 350,
    })

    expect(auditLog.size).toBe(0)
  })

  it("external listener receives compressor:applied events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    const handler = vi.fn()
    mw.events.on("compressor:applied", handler)

    mw.events.emit("compressor:applied", {
      savedTokens: 300,
      originalTokens: 1200,
      compressedTokens: 900,
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      savedTokens: 300,
      originalTokens: 1200,
      compressedTokens: 900,
    })
    mw.dispose()
  })

  it("external listener receives delta:applied events", () => {
    const mw = tokenShieldMiddleware({ auditLog })
    const handler = vi.fn()
    mw.events.on("delta:applied", handler)

    mw.events.emit("delta:applied", {
      savedTokens: 100,
      originalTokens: 600,
      encodedTokens: 500,
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      savedTokens: 100,
      originalTokens: 600,
      encodedTokens: 500,
    })
    mw.dispose()
  })
})
