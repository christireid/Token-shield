import { describe, it, expect, beforeEach, vi } from "vitest"
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

  // -------------------------------------------------------
  // recordBlocked
  // -------------------------------------------------------

  it("recordBlocked records a blocked request with zero actual tokens and guard savings", async () => {
    const entry = await ledger.recordBlocked({
      model: "gpt-4o-mini",
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 2000,
      reason: "budget exceeded",
      feature: "chat",
    })
    expect(entry.inputTokens).toBe(0)
    expect(entry.outputTokens).toBe(0)
    expect(entry.actualCost).toBe(0)
    expect(entry.savings.guard).toBeGreaterThan(0)
    expect(entry.feature).toBe("chat")
    expect(entry.cacheHit).toBe(false)
  })

  // -------------------------------------------------------
  // getEntriesSince
  // -------------------------------------------------------

  it("getEntriesSince filters entries within the given time window", async () => {
    vi.useFakeTimers()
    try {
      const base = 1_000_000
      vi.setSystemTime(base)

      // Record an entry at t=base
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })

      // Advance time by 10 seconds and record another entry at t=base+10_000
      vi.setSystemTime(base + 10_000)
      await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 200,
        outputTokens: 100,
        savings: {},
      })

      // Advance time by another 10 seconds (now at t=base+20_000)
      vi.setSystemTime(base + 20_000)

      // A 25-second window covers both entries (cutoff = base+20k - 25k = base-5k)
      const all = ledger.getEntriesSince(25_000)
      expect(all.length).toBe(2)

      // A 15-second window: cutoff = base+20k - 15k = base+5k
      // First entry at base (< base+5k) excluded, second at base+10k (>= base+5k) included
      const recent = ledger.getEntriesSince(15_000)
      expect(recent.length).toBe(1)
      expect(recent[0].inputTokens).toBe(200)
    } finally {
      vi.useRealTimers()
    }
  })

  // -------------------------------------------------------
  // reset
  // -------------------------------------------------------

  it("reset clears all entries and notifies listeners", async () => {
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    expect(ledger.getSummary().totalCalls).toBe(1)

    let notified = false
    ledger.subscribe(() => {
      notified = true
    })

    ledger.reset()

    expect(ledger.getSummary().totalCalls).toBe(0)
    expect(ledger.getSummary().entries.length).toBe(0)
    expect(notified).toBe(true)
  })

  // -------------------------------------------------------
  // dispose
  // -------------------------------------------------------

  it("dispose clears listeners so they are no longer notified", async () => {
    let callCount = 0
    ledger.subscribe(() => {
      callCount++
    })

    // First record should trigger the listener
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    expect(callCount).toBe(1)

    ledger.dispose()

    // After dispose, listener should not fire
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    expect(callCount).toBe(1)
  })

  // -------------------------------------------------------
  // calculateCost with cachedTokens > 0
  // -------------------------------------------------------

  it("calculateCost applies cached token discount when cachedTokens > 0", async () => {
    // gpt-4o-mini pricing:
    //   inputPerMillion = 0.15, cachedInputPerMillion = 0.075, outputPerMillion = 0.6
    //
    // With 1000 input, 500 output, 0 cached:
    //   cost = (1000/1e6)*0.15 + (500/1e6)*0.6
    //
    // With 1000 input, 500 output, 600 cached:
    //   uncachedInput = 400
    //   cachedCost = (600/1e6)*0.075
    //   uncachedCost = (400/1e6)*0.15
    //   outputCost  = (500/1e6)*0.6
    //   total should be less than the no-cache case

    const noCacheEntry = await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      savings: {},
    })

    const cachedEntry = await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 600,
      savings: {},
    })

    expect(cachedEntry.actualCost).toBeLessThan(noCacheEntry.actualCost)
    expect(cachedEntry.cachedTokens).toBe(600)

    // Verify exact cached cost:
    // cachedCost  = (600/1e6) * 0.075 = 0.000045
    // uncachedCost = (400/1e6) * 0.15  = 0.00006
    // outputCost  = (500/1e6) * 0.6   = 0.0003
    // total = 0.000405
    const expected = (600 / 1e6) * 0.075 + (400 / 1e6) * 0.15 + (500 / 1e6) * 0.6
    expect(cachedEntry.actualCost).toBeCloseTo(expected, 10)
  })

  // -------------------------------------------------------
  // calculateCost with unknown model (fallback pricing)
  // -------------------------------------------------------

  it("calculateCost uses fallback pricing for an unknown model", async () => {
    // Fallback: inputPerMillion = 0.15, outputPerMillion = 0.6
    const entry = await ledger.record({
      model: "totally-unknown-model-xyz",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      savings: {},
    })

    // With 1M tokens each at fallback rates: 0.15 + 0.6 = 0.75
    expect(entry.actualCost).toBeCloseTo(0.15 + 0.6, 6)
    expect(entry.model).toBe("totally-unknown-model-xyz")
  })

  // -------------------------------------------------------
  // getSummary breakdowns: byModule, byModel, byFeature,
  //   callsBlocked, cacheHitRate, savingsRate
  // -------------------------------------------------------

  it("getSummary computes byModule breakdown across multiple entries", async () => {
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      savings: { context: 0.005, prefix: 0.002 },
    })
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 2000,
      outputTokens: 1000,
      savings: { guard: 0.01, router: 0.003 },
    })

    const summary = ledger.getSummary()
    expect(summary.byModule.context).toBeCloseTo(0.005, 10)
    expect(summary.byModule.prefix).toBeCloseTo(0.002, 10)
    expect(summary.byModule.guard).toBeCloseTo(0.01, 10)
    expect(summary.byModule.router).toBeCloseTo(0.003, 10)
    expect(summary.byModule.cache).toBe(0)
  })

  it("getSummary computes byModel breakdown", async () => {
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, savings: {} })
    await ledger.record({ model: "gpt-4o", inputTokens: 2000, outputTokens: 1000, savings: {} })
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 500, outputTokens: 200, savings: {} })

    const summary = ledger.getSummary()
    expect(summary.byModel["gpt-4o-mini"].calls).toBe(2)
    expect(summary.byModel["gpt-4o-mini"].tokens).toBe(1000 + 500 + 500 + 200)
    expect(summary.byModel["gpt-4o"].calls).toBe(1)
    expect(summary.byModel["gpt-4o"].tokens).toBe(2000 + 1000)
  })

  it("getSummary computes byFeature breakdown and groups untagged under _untagged", async () => {
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      savings: { context: 0.003 },
      feature: "chat",
    })
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      savings: {},
      feature: "search",
    })
    // No feature tag — should go to _untagged
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 300,
      outputTokens: 100,
      savings: {},
    })

    const summary = ledger.getSummary()
    expect(summary.byFeature["chat"].calls).toBe(1)
    expect(summary.byFeature["search"].calls).toBe(1)
    expect(summary.byFeature["_untagged"].calls).toBe(1)
  })

  it("getSummary counts callsBlocked for blocked requests", async () => {
    await ledger.recordBlocked({
      model: "gpt-4o-mini",
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 2000,
      reason: "budget exceeded",
    })
    await ledger.recordBlocked({
      model: "gpt-4o-mini",
      estimatedInputTokens: 3000,
      estimatedOutputTokens: 1000,
      reason: "rate limit",
    })
    // A normal (non-blocked) call
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, savings: {} })

    const summary = ledger.getSummary()
    expect(summary.callsBlocked).toBe(2)
    expect(summary.totalCalls).toBe(3)
  })

  it("getSummary computes cacheHitRate", async () => {
    await ledger.recordCacheHit({
      model: "gpt-4o-mini",
      savedInputTokens: 1000,
      savedOutputTokens: 500,
    })
    await ledger.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, savings: {} })

    const summary = ledger.getSummary()
    // 1 cache hit out of 2 total calls
    expect(summary.cacheHits).toBe(1)
    expect(summary.cacheHitRate).toBeCloseTo(0.5, 10)
  })

  it("getSummary computes savingsRate as totalSaved / (totalSpent + totalSaved)", async () => {
    // Record a call with original tokens higher than actual to generate savings
    await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      savings: { context: 0.01 },
      originalInputTokens: 2000,
    })

    const summary = ledger.getSummary()
    const expectedRate = summary.totalSaved / (summary.totalSpent + summary.totalSaved)
    expect(summary.savingsRate).toBeCloseTo(expectedRate, 10)
    expect(summary.savingsRate).toBeGreaterThan(0)
    expect(summary.savingsRate).toBeLessThanOrEqual(1)
  })

  // -------------------------------------------------------
  // subscribe unsubscribe function
  // -------------------------------------------------------

  it("subscribe returns an unsubscribe function that stops notifications", async () => {
    let callCount = 0
    const unsubscribe = ledger.subscribe(() => {
      callCount++
    })

    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    expect(callCount).toBe(1)

    // Unsubscribe
    unsubscribe()

    await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
    // Should still be 1 — listener was removed
    expect(callCount).toBe(1)
  })

  // -------------------------------------------------------
  // mergeEntry (cross-tab sync simulation)
  // -------------------------------------------------------

  it("mergeEntry adds external entries and notifies listeners", async () => {
    let notified = false
    ledger.subscribe(() => {
      notified = true
    })

    const merge = (
      ledger as unknown as { mergeEntry: (entry: Record<string, unknown>) => void }
    ).mergeEntry.bind(ledger)

    merge({
      id: "external-001",
      timestamp: Date.now(),
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      cachedTokens: 0,
      actualCost: 0.0002,
      costWithoutShield: 0.0003,
      totalSaved: 0.0001,
      savings: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
      cacheHit: false,
    })

    expect(ledger.getSummary().totalCalls).toBe(1)
    expect(notified).toBe(true)
  })

  it("mergeEntry deduplicates entries by ID", () => {
    const merge = (
      ledger as unknown as { mergeEntry: (entry: Record<string, unknown>) => void }
    ).mergeEntry.bind(ledger)

    const entry = {
      id: "dedup-001",
      timestamp: Date.now(),
      model: "gpt-4o-mini",
      inputTokens: 500,
      outputTokens: 200,
      cachedTokens: 0,
      actualCost: 0.0002,
      costWithoutShield: 0.0003,
      totalSaved: 0.0001,
      savings: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
      cacheHit: false,
    }

    merge(entry)
    merge(entry)

    expect(ledger.getSummary().totalCalls).toBe(1)
  })

  it("mergeEntry maintains chronological order", () => {
    const merge = (
      ledger as unknown as { mergeEntry: (entry: Record<string, unknown>) => void }
    ).mergeEntry.bind(ledger)

    merge({
      id: "later",
      timestamp: 2000,
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      actualCost: 0.0001,
      costWithoutShield: 0.0001,
      totalSaved: 0,
      savings: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
      cacheHit: false,
    })
    merge({
      id: "earlier",
      timestamp: 1000,
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      actualCost: 0.0001,
      costWithoutShield: 0.0001,
      totalSaved: 0,
      savings: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
      cacheHit: false,
    })

    const entries = ledger.getSummary().entries
    expect(entries[0].id).toBe("earlier")
    expect(entries[1].id).toBe("later")
  })

  // -------------------------------------------------------
  // pruneEntries
  // -------------------------------------------------------

  it("prunes entries when exceeding MAX_LEDGER_ENTRIES", () => {
    const internals = ledger as unknown as {
      entries: Array<Record<string, unknown>>
      pruneEntries: () => void
    }

    for (let i = 0; i < 10_005; i++) {
      internals.entries.push({
        id: `prune-${i}`,
        timestamp: i,
        model: "gpt-4o-mini",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        actualCost: 0.00001,
        costWithoutShield: 0.00001,
        totalSaved: 0,
        savings: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
        cacheHit: false,
      })
    }
    internals.pruneEntries()
    expect(internals.entries.length).toBe(10_000)
    expect(internals.entries[0].id).toBe("prune-5")
  })

  // -------------------------------------------------------
  // record with originalModel (counterfactual savings)
  // -------------------------------------------------------

  it("calculates counterfactual savings when originalModel differs", async () => {
    const entry = await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      savings: { router: 0 },
      originalModel: "gpt-4o",
      originalInputTokens: 1000,
    })

    expect(entry.costWithoutShield).toBeGreaterThan(entry.actualCost)
    expect(entry.totalSaved).toBeGreaterThan(0)
  })

  // -------------------------------------------------------
  // dispose safety
  // -------------------------------------------------------

  it("dispose can be called multiple times safely", () => {
    ledger.dispose()
    ledger.dispose()
    expect(() =>
      ledger.record({ model: "gpt-4o-mini", inputTokens: 10, outputTokens: 5, savings: {} }),
    ).not.toThrow()
  })
})
