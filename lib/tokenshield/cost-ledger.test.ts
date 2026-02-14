import { describe, it, expect, beforeEach } from "vitest"
import { CostLedger } from "./cost-ledger"

describe("CostLedger", () => {
  let ledger: CostLedger

  beforeEach(() => {
    ledger = new CostLedger({ persist: false })
  })

  it("records an entry and computes cost", async () => {
    const entry = await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      savings: { context: 0.001 },
    })
    expect(entry.id).toBeTruthy()
    expect(entry.actualCost).toBeGreaterThan(0)
    expect(entry.inputTokens).toBe(1000)
  })

  it("getSummary aggregates correctly", async () => {
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, savings: {} })
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 2000,
      outputTokens: 1000,
      savings: {},
    })
    const summary = ledger.getSummary()
    expect(summary.totalCalls).toBe(2)
    expect(summary.totalSpent).toBeGreaterThan(0)
  })

  it("recordCacheHit tracks cache savings", async () => {
    const entry = await ledger.recordCacheHit({
      model: "gpt-4o-mini",
      savedInputTokens: 5000,
      savedOutputTokens: 2000,
    })
    expect(entry.cacheHit).toBe(true)
    // Savings are tracked in the module attribution field, not totalSaved
    expect(entry.savings.cache).toBeGreaterThan(0)
  })

  it("subscribe notifies on new entries", async () => {
    let notified = false
    ledger.subscribe(() => {
      notified = true
    })
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    expect(notified).toBe(true)
  })

  it("getSummary().entries returns all entries", async () => {
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 200, outputTokens: 100, savings: {} })
    const entries = ledger.getSummary().entries
    expect(entries.length).toBe(2)
  })

  it("exportJSON produces valid JSON", async () => {
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    const json = ledger.exportJSON()
    expect(() => JSON.parse(json)).not.toThrow()
    const parsed = JSON.parse(json)
    expect(parsed.entries.length).toBe(1)
  })

  // REGRESSION: hydrate must be idempotent
  it("hydrate returns 0 when persistence is disabled", async () => {
    const count = await ledger.hydrate()
    expect(count).toBe(0)
  })

  it("exportCSV escapes double quotes in feature names", async () => {
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      savings: {},
      feature: 'my "special" feature',
    })
    const csv = ledger.exportCSV()
    // RFC 4180: double quotes inside a quoted field are escaped by doubling
    expect(csv).toContain('"my ""special"" feature"')
  })

  it("exportCSV escapes commas in feature names", async () => {
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      savings: {},
      feature: "chat, assistant",
    })
    const csv = ledger.exportCSV()
    expect(csv).toContain('"chat, assistant"')
  })

  it("exportCSV escapes newlines in feature names", async () => {
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      savings: {},
      feature: "line1\nline2",
    })
    const csv = ledger.exportCSV()
    expect(csv).toContain('"line1\nline2"')
  })
})
