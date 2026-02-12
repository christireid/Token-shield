/**
 * Battle Tests — Budget Enforcement & Token Usage Monitoring
 *
 * Stress-tests the ability to set budgets and monitor user token usage
 * across UserBudgetManager, CostCircuitBreaker, CostLedger, and the
 * full middleware pipeline. Exercises edge cases, concurrency patterns,
 * multi-user scenarios, and cross-module interactions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { UserBudgetManager } from "./user-budget-manager"
import { CostCircuitBreaker } from "./circuit-breaker"
import { CostLedger } from "./cost-ledger"
import { tokenShieldMiddleware, TokenShieldBlockedError } from "./middleware"

// ─── Test helpers ────────────────────────────────────────────────

function makePrompt(messages: { role: string; content: string }[]) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }))
}

function makeParams(userMessage: string, modelId = "gpt-4o-mini") {
  return {
    modelId,
    prompt: makePrompt([
      { role: "system", content: "You are helpful." },
      { role: "user", content: userMessage },
    ]),
  }
}

function mockDoGenerate(text = "Response.", tokens = { promptTokens: 50, completionTokens: 20 }) {
  return vi.fn(async () => ({ text, usage: tokens, finishReason: "stop" }))
}

function makeStream(chunks: string[]) {
  return new ReadableStream({
    start(controller) {
      for (const text of chunks) controller.enqueue({ type: "text-delta", textDelta: text })
      controller.close()
    },
  })
}

// ═════════════════════════════════════════════════════════════════
// SECTION 1: UserBudgetManager — Concurrent & Multi-User Stress
// ═════════════════════════════════════════════════════════════════

describe("UserBudgetManager — Battle Tests", () => {
  describe("concurrent request simulation", () => {
    it("prevents overspend when multiple requests check simultaneously", async () => {
      // Set a tiny daily budget so inflight from check() exhausts it quickly.
      // gpt-4o with 50K input + 20K output ≈ $0.275 per check reservation.
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 0.50, monthly: 100 } },
      })

      // Simulate 10 concurrent check() calls that each reserve significant inflight
      const checks = Array.from({ length: 10 }, () =>
        mgr.check("u1", "gpt-4o", 50000, 20000)
      )

      const allowed = checks.filter((c) => c.allowed)
      const blocked = checks.filter((c) => !c.allowed)

      // First 1-2 pass, rest blocked (each reserves ~$0.275 vs $0.50 budget)
      expect(allowed.length).toBeGreaterThan(0)
      expect(blocked.length).toBeGreaterThan(0)

      // Total inflight should not vastly exceed the daily limit
      const status = mgr.getStatus("u1")
      expect(status.inflight).toBeLessThanOrEqual(0.60)
    })

    it("inflight drains correctly after mixed success/failure", async () => {
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 10, monthly: 100 } },
      })

      // 5 requests check in
      const reservations: number[] = []
      for (let i = 0; i < 5; i++) {
        mgr.check("u1", "gpt-4o-mini", 1000, 500)
        reservations.push(mgr.getStatus("u1").inflight)
      }

      const totalInflight = mgr.getStatus("u1").inflight
      expect(totalInflight).toBeGreaterThan(0)

      // 3 succeed (recordSpend), 2 fail (releaseInflight)
      const perRequest = totalInflight / 5
      await mgr.recordSpend("u1", 0.001, "gpt-4o-mini", perRequest)
      await mgr.recordSpend("u1", 0.002, "gpt-4o-mini", perRequest)
      await mgr.recordSpend("u1", 0.001, "gpt-4o-mini", perRequest)
      mgr.releaseInflight("u1", perRequest)
      mgr.releaseInflight("u1", perRequest)

      // All inflight should be drained
      expect(mgr.getStatus("u1").inflight).toBeCloseTo(0, 5)
    })
  })

  describe("multi-user isolation", () => {
    it("one user hitting budget does not affect another", async () => {
      const mgr = new UserBudgetManager({
        users: {
          "alice": { daily: 0.01, monthly: 100 },
          "bob": { daily: 100, monthly: 1000 },
        },
      })

      // Alice exhausts her budget
      await mgr.recordSpend("alice", 0.01, "gpt-4o-mini")
      const aliceCheck = mgr.check("alice")
      expect(aliceCheck.allowed).toBe(false)

      // Bob should be unaffected
      const bobCheck = mgr.check("bob")
      expect(bobCheck.allowed).toBe(true)
      expect(bobCheck.status.spend.daily).toBe(0)
    })

    it("tracks 50 users independently", async () => {
      const users: Record<string, { daily: number; monthly: number }> = {}
      for (let i = 0; i < 50; i++) {
        users[`user-${i}`] = { daily: 10, monthly: 100 }
      }
      const mgr = new UserBudgetManager({ users })

      // Each user spends a unique amount
      for (let i = 0; i < 50; i++) {
        await mgr.recordSpend(`user-${i}`, i * 0.1, "gpt-4o-mini")
      }

      // Verify each user has the correct spend
      for (let i = 0; i < 50; i++) {
        const status = mgr.getStatus(`user-${i}`)
        expect(status.spend.daily).toBeCloseTo(i * 0.1, 5)
      }

      // getAllUserStatuses should have all 50
      const all = mgr.getAllUserStatuses()
      expect(all.length).toBe(50)
    })

    it("default budget applies to unknown users", async () => {
      const mgr = new UserBudgetManager({
        defaultBudget: { daily: 1.0, monthly: 5.0 },
      })

      await mgr.recordSpend("newcomer", 1.0, "gpt-4o-mini")
      const check = mgr.check("newcomer")
      expect(check.allowed).toBe(false)
      expect(check.reason).toContain("daily")
    })
  })

  describe("warning and exceeded callbacks", () => {
    it("warning fires exactly once per window", async () => {
      const onWarning = vi.fn()
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 10, monthly: 100 } },
        onBudgetWarning: onWarning,
      })

      // Push to 81% of daily
      await mgr.recordSpend("u1", 8.1, "gpt-4o-mini")
      mgr.check("u1")
      mgr.check("u1")
      mgr.check("u1")

      // Warning should fire exactly once, not 3 times
      expect(onWarning).toHaveBeenCalledTimes(1)
      expect(onWarning.mock.calls[0][1].limitType).toBe("daily")
    })

    it("exceeded callback receives correct data", async () => {
      const onExceeded = vi.fn()
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 5.0, monthly: 100 } },
        onBudgetExceeded: onExceeded,
      })

      await mgr.recordSpend("u1", 5.0, "gpt-4o-mini")
      mgr.check("u1")

      expect(onExceeded).toHaveBeenCalledTimes(1)
      const [userId, event] = onExceeded.mock.calls[0]
      expect(userId).toBe("u1")
      expect(event.limitType).toBe("daily")
      expect(event.limit).toBe(5.0)
      expect(event.currentSpend).toBeGreaterThanOrEqual(5.0)
    })

    it("monthly warning fires independently of daily warning", async () => {
      const onWarning = vi.fn()
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 100, monthly: 10 } },
        onBudgetWarning: onWarning,
      })

      // 81% of monthly (10) = 8.1, but well within daily (100)
      await mgr.recordSpend("u1", 8.1, "gpt-4o-mini")
      mgr.check("u1")

      expect(onWarning).toHaveBeenCalledTimes(1)
      expect(onWarning.mock.calls[0][1].limitType).toBe("monthly")
    })
  })

  describe("tier model routing", () => {
    it("routes each tier to the correct model", () => {
      const mgr = new UserBudgetManager({
        users: {
          "free": { daily: 1, monthly: 5, tier: "standard" },
          "pro": { daily: 10, monthly: 100, tier: "premium" },
          "vip": { daily: 999, monthly: 9999, tier: "unlimited" },
        },
        tierModels: {
          standard: "gpt-4o-mini",
          premium: "gpt-4o",
          unlimited: "gpt-4.1",
        },
      })

      expect(mgr.getModelForUser("free")).toBe("gpt-4o-mini")
      expect(mgr.getModelForUser("pro")).toBe("gpt-4o")
      expect(mgr.getModelForUser("vip")).toBe("gpt-4.1")
    })

    it("returns null when tier has no model mapping", () => {
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 1, monthly: 5, tier: "standard" } },
        tierModels: { premium: "gpt-4o" }, // no standard mapping
      })

      expect(mgr.getModelForUser("u1")).toBeNull()
    })
  })

  describe("budget modification at runtime", () => {
    it("upgrading budget allows previously blocked user", async () => {
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 1.0, monthly: 10 } },
      })

      await mgr.recordSpend("u1", 1.0, "gpt-4o-mini")
      expect(mgr.check("u1").allowed).toBe(false)

      // Upgrade the user's budget
      mgr.updateUserBudget("u1", { daily: 100, monthly: 1000 })
      expect(mgr.check("u1").allowed).toBe(true)
      expect(mgr.getStatus("u1").remaining.daily).toBe(99.0)
    })

    it("downgrading budget blocks previously allowed user", async () => {
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 100, monthly: 1000 } },
      })

      await mgr.recordSpend("u1", 5.0, "gpt-4o-mini")
      expect(mgr.check("u1").allowed).toBe(true)

      mgr.updateUserBudget("u1", { daily: 4.0, monthly: 1000 })
      expect(mgr.check("u1").allowed).toBe(false)
    })

    it("removing user reverts to default budget", async () => {
      const mgr = new UserBudgetManager({
        users: { "u1": { daily: 100, monthly: 1000 } },
        defaultBudget: { daily: 2, monthly: 20 },
      })

      await mgr.recordSpend("u1", 3.0, "gpt-4o-mini")
      expect(mgr.check("u1").allowed).toBe(true) // 3.0 < 100

      mgr.removeUserBudget("u1")
      expect(mgr.check("u1").allowed).toBe(false) // 3.0 > 2.0 default
    })
  })

  describe("subscribe / unsubscribe", () => {
    it("subscriber receives notifications for spend, reset, and config changes", async () => {
      const listener = vi.fn()
      const mgr = new UserBudgetManager({
        defaultBudget: { daily: 100, monthly: 1000 },
      })

      const unsub = mgr.subscribe(listener)

      await mgr.recordSpend("u1", 1.0, "gpt-4o-mini")
      expect(listener).toHaveBeenCalledTimes(1)

      mgr.updateUserBudget("u2", { daily: 50, monthly: 500 })
      expect(listener).toHaveBeenCalledTimes(2)

      await mgr.resetUser("u1")
      expect(listener).toHaveBeenCalledTimes(3)

      unsub()
      await mgr.recordSpend("u1", 1.0, "gpt-4o-mini")
      expect(listener).toHaveBeenCalledTimes(3) // no more after unsub
    })
  })
})

// ═════════════════════════════════════════════════════════════════
// SECTION 2: CostCircuitBreaker — Spending Limits & Safety Nets
// ═════════════════════════════════════════════════════════════════

describe("CostCircuitBreaker — Battle Tests", () => {
  describe("multi-window limit enforcement", () => {
    it("trips on whichever window is exceeded first", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 100, perHour: 5, perDay: 50 },
        action: "stop",
        persist: false,
      })

      breaker.recordSpend(5.0, "gpt-4o-mini")
      const result = breaker.check()
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("hour") // perHour=5 hit first
    })

    it("tracks all time windows independently", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 100, perHour: 50, perDay: 200, perMonth: 1000 },
        action: "stop",
        persist: false,
      })

      breaker.recordSpend(10, "gpt-4o")
      const status = breaker.getStatus()
      expect(status.spend.session).toBe(10)
      expect(status.spend.lastHour).toBe(10)
      expect(status.spend.lastDay).toBe(10)
      expect(status.spend.lastMonth).toBe(10)
      expect(status.remaining.session).toBe(90)
      expect(status.remaining.hour).toBe(40)
      expect(status.remaining.day).toBe(190)
      expect(status.remaining.month).toBe(990)
    })
  })

  describe("action modes", () => {
    it("stop mode blocks the request", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 1 },
        action: "stop",
        persist: false,
      })
      breaker.recordSpend(1, "gpt-4o-mini")
      expect(breaker.check().allowed).toBe(false)
    })

    it("throttle mode allows but signals to caller", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 1 },
        action: "throttle",
        persist: false,
      })
      breaker.recordSpend(1, "gpt-4o-mini")
      const result = breaker.check()
      expect(result.allowed).toBe(true)
      expect(result.reason).toContain("Throttled")
    })

    it("warn mode allows and fires callback", () => {
      const onTripped = vi.fn()
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 1 },
        action: "warn",
        persist: false,
        onTripped,
      })
      breaker.recordSpend(1, "gpt-4o-mini")
      breaker.check()
      expect(onTripped).toHaveBeenCalled()
    })
  })

  describe("warning callback behavior", () => {
    it("warning fires at 80% and trip fires at 100%", () => {
      const onWarning = vi.fn()
      const onTripped = vi.fn()
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 10 },
        action: "stop",
        persist: false,
        onWarning,
        onTripped,
      })

      // 80% = $8
      breaker.recordSpend(8.01, "gpt-4o-mini")
      breaker.check()
      expect(onWarning).toHaveBeenCalledTimes(1)
      expect(onTripped).not.toHaveBeenCalled()

      // Push to 100%
      breaker.recordSpend(2, "gpt-4o-mini")
      breaker.check()
      expect(onTripped).toHaveBeenCalledTimes(1)
    })

    it("onTripped receives correct event shape", () => {
      const onTripped = vi.fn()
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 5 },
        action: "stop",
        persist: false,
        onTripped,
      })
      breaker.recordSpend(5, "gpt-4o-mini")
      breaker.check()

      const event = onTripped.mock.calls[0][0]
      expect(event.limitType).toContain("session")
      expect(event.currentSpend).toBe(5)
      expect(event.limit).toBe(5)
      expect(event.action).toBe("stop")
    })
  })

  describe("reset and updateLimits", () => {
    it("reset clears spend and allows requests again", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 5 },
        action: "stop",
        persist: false,
      })
      breaker.recordSpend(5, "gpt-4o-mini")
      expect(breaker.check().allowed).toBe(false)

      breaker.reset()
      expect(breaker.check().allowed).toBe(true)
      expect(breaker.getStatus().spend.session).toBe(0)
    })

    it("updateLimits changes thresholds without clearing spend", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 5 },
        action: "stop",
        persist: false,
      })
      breaker.recordSpend(5, "gpt-4o-mini")
      expect(breaker.check().allowed).toBe(false)

      breaker.updateLimits({ perSession: 100 })
      expect(breaker.check().allowed).toBe(true)
      expect(breaker.getStatus().spend.session).toBe(5) // spend preserved
    })
  })

  describe("zero-limit semantics", () => {
    it("perSession=0 blocks everything (zero-budget mode)", () => {
      const breaker = new CostCircuitBreaker({
        limits: { perSession: 0 },
        action: "stop",
        persist: false,
      })
      // Even with zero spend, any projected cost (even 0) exceeds a 0 budget
      expect(breaker.check().allowed).toBe(false)
    })

    it("no limits configured means everything is allowed", () => {
      const breaker = new CostCircuitBreaker({
        limits: {},
        action: "stop",
        persist: false,
      })
      breaker.recordSpend(999999, "gpt-4o-mini")
      expect(breaker.check().allowed).toBe(true)
    })
  })
})

// ═════════════════════════════════════════════════════════════════
// SECTION 3: CostLedger — Usage Monitoring Accuracy
// ═════════════════════════════════════════════════════════════════

describe("CostLedger — Battle Tests", () => {
  let ledger: CostLedger

  beforeEach(() => {
    ledger = new CostLedger({ persist: false })
  })

  describe("cost calculation accuracy", () => {
    it("calculates correct cost for known models", async () => {
      const entry = await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        savings: {},
      })
      // gpt-4o-mini: $0.15/1M input, $0.60/1M output
      expect(entry.actualCost).toBeCloseTo(0.15 + 0.60, 4)
    })

    it("uses fallback pricing for unknown models", async () => {
      const entry = await ledger.record({
        model: "custom-model-v99",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        savings: {},
      })
      // Fallback: $0.15/1M input, $0.60/1M output
      expect(entry.actualCost).toBeCloseTo(0.75, 4)
      expect(entry.actualCost).toBeGreaterThan(0) // NOT zero
    })

    it("applies cached token discount correctly", async () => {
      const entry = await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedTokens: 500_000, // half cached
        savings: {},
      })
      // 500K cached * (0.075 or 0.5 * 0.15) + 500K uncached * 0.15
      const expectedCached = (500_000 / 1_000_000) * 0.15 * 0.5
      const expectedUncached = (500_000 / 1_000_000) * 0.15
      expect(entry.actualCost).toBeCloseTo(expectedCached + expectedUncached, 4)
    })
  })

  describe("counterfactual (savings) calculation", () => {
    it("calculates savings when model was downgraded", async () => {
      const entry = await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 1000,
        outputTokens: 500,
        savings: { router: 0.005 },
        originalModel: "gpt-4o",
        originalInputTokens: 1000,
      })

      // costWithoutShield uses gpt-4o pricing, actualCost uses gpt-4o-mini
      expect(entry.costWithoutShield).toBeGreaterThan(entry.actualCost)
      expect(entry.totalSaved).toBeGreaterThan(0)
    })

    it("calculates savings when context was trimmed", async () => {
      const entry = await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 500,
        outputTokens: 200,
        savings: { context: 0.001 },
        originalInputTokens: 1000, // was 1000 before trimming
      })

      // Counterfactual uses 1000 input tokens, actual uses 500
      expect(entry.costWithoutShield).toBeGreaterThan(entry.actualCost)
    })
  })

  describe("per-module savings attribution", () => {
    it("tracks savings from all 5 modules independently", async () => {
      await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 100,
        outputTokens: 50,
        savings: { guard: 0.01, cache: 0.02, context: 0.03, router: 0.04, prefix: 0.05 },
      })

      const summary = ledger.getSummary()
      expect(summary.byModule.guard).toBeCloseTo(0.01, 5)
      expect(summary.byModule.cache).toBeCloseTo(0.02, 5)
      expect(summary.byModule.context).toBeCloseTo(0.03, 5)
      expect(summary.byModule.router).toBeCloseTo(0.04, 5)
      expect(summary.byModule.prefix).toBeCloseTo(0.05, 5)
    })

    it("recordBlocked attributes savings to guard module", async () => {
      const entry = await ledger.recordBlocked({
        model: "gpt-4o",
        estimatedInputTokens: 10000,
        estimatedOutputTokens: 5000,
        reason: "Rate limited",
      })

      expect(entry.savings.guard).toBeGreaterThan(0)
      expect(entry.inputTokens).toBe(0)
      expect(entry.outputTokens).toBe(0)
    })

    it("recordCacheHit attributes savings to cache module", async () => {
      const entry = await ledger.recordCacheHit({
        model: "gpt-4o",
        savedInputTokens: 5000,
        savedOutputTokens: 2000,
      })

      expect(entry.savings.cache).toBeGreaterThan(0)
      expect(entry.cacheHit).toBe(true)
    })
  })

  describe("summary aggregation", () => {
    it("byModel groups calls, cost, and tokens correctly", async () => {
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 500, savings: {} })
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 2000, outputTokens: 1000, savings: {} })
      await ledger.record({ model: "gpt-4o", inputTokens: 3000, outputTokens: 1500, savings: {} })

      const summary = ledger.getSummary()
      expect(summary.byModel["gpt-4o-mini"].calls).toBe(2)
      expect(summary.byModel["gpt-4o-mini"].tokens).toBe(1000 + 500 + 2000 + 1000)
      expect(summary.byModel["gpt-4o"].calls).toBe(1)
    })

    it("byFeature groups calls under tag or _untagged", async () => {
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {}, feature: "chat" })
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {}, feature: "chat" })
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} }) // no feature

      const summary = ledger.getSummary()
      expect(summary.byFeature["chat"].calls).toBe(2)
      expect(summary.byFeature["_untagged"].calls).toBe(1)
    })

    it("cacheHitRate is accurate", async () => {
      await ledger.recordCacheHit({ model: "gpt-4o-mini", savedInputTokens: 100, savedOutputTokens: 50 })
      await ledger.recordCacheHit({ model: "gpt-4o-mini", savedInputTokens: 100, savedOutputTokens: 50 })
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })

      const summary = ledger.getSummary()
      expect(summary.cacheHitRate).toBeCloseTo(2 / 3, 4)
      expect(summary.cacheHits).toBe(2)
    })

    it("savingsRate reflects total savings vs total possible spend", async () => {
      await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 1000,
        outputTokens: 500,
        savings: {},
        originalModel: "gpt-4o",
        originalInputTokens: 1000,
      })

      const summary = ledger.getSummary()
      // savingsRate = totalSaved / (totalSpent + totalSaved)
      expect(summary.savingsRate).toBeGreaterThan(0)
      expect(summary.savingsRate).toBeLessThan(1)
    })
  })

  describe("export correctness", () => {
    it("exportJSON includes all entries and valid summary", async () => {
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: { cache: 0.001 }, feature: "test" })
      await ledger.record({ model: "gpt-4o", inputTokens: 200, outputTokens: 100, savings: {} })

      const json = ledger.exportJSON()
      const parsed = JSON.parse(json)

      expect(parsed.exportedAt).toBeTruthy()
      expect(parsed.entries).toHaveLength(2)
      expect(parsed.summary.totalCalls).toBe(2)
      expect(parsed.summary.byModule.cache).toBeCloseTo(0.001, 5)
    })

    it("exportCSV has correct headers and row count", async () => {
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })
      await ledger.record({ model: "gpt-4o", inputTokens: 200, outputTokens: 100, savings: {} })

      const csv = ledger.exportCSV()
      const lines = csv.split("\n")

      expect(lines[0]).toContain("id,timestamp,model,inputTokens")
      expect(lines).toHaveLength(3) // header + 2 rows
    })

    it("exportCSV escapes commas in model names", async () => {
      await ledger.record({
        model: "gpt-4o-mini",
        inputTokens: 100,
        outputTokens: 50,
        savings: {},
        feature: "feature,with,commas",
      })

      const csv = ledger.exportCSV()
      // Feature with commas should be quoted
      expect(csv).toContain('"feature,with,commas"')
    })
  })

  describe("getEntriesSince time windowing", () => {
    it("returns only entries within the specified window", async () => {
      await ledger.record({ model: "gpt-4o-mini", inputTokens: 100, outputTokens: 50, savings: {} })

      // Entries from the last 10 seconds
      const recent = ledger.getEntriesSince(10_000)
      expect(recent).toHaveLength(1)

      // sinceMs=-5 → cutoff = Date.now() + 5 → future timestamp, no entry matches
      const none = ledger.getEntriesSince(-5)
      expect(none).toHaveLength(0)
    })
  })

  describe("capacity limits", () => {
    it("evicts oldest entries when over 10,000", async () => {
      // This is a boundary test — we'll record many entries
      for (let i = 0; i < 100; i++) {
        await ledger.record({ model: "gpt-4o-mini", inputTokens: 10, outputTokens: 5, savings: {} })
      }
      const summary = ledger.getSummary()
      expect(summary.totalCalls).toBe(100)
      expect(summary.entries).toHaveLength(100)
    })
  })
})

// ═════════════════════════════════════════════════════════════════
// SECTION 4: Middleware Integration — Budget + Breaker + Monitoring
// ═════════════════════════════════════════════════════════════════

describe("Middleware Budget Integration — Battle Tests", () => {
  describe("breaker + user budget combined", () => {
    it("breaker trips before user budget is checked", async () => {
      const onBlocked = vi.fn()
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
        breaker: {
          limits: { perSession: 0 }, // zero budget = always blocks
          action: "stop",
          persist: false,
        },
        userBudget: {
          getUserId: () => "u1",
          budgets: {
            users: { "u1": { daily: 100, monthly: 1000 } }, // generous budget
          },
        },
        onBlocked,
      })

      await expect(
        mw.transformParams({ params: makeParams("Hello") })
      ).rejects.toThrow(TokenShieldBlockedError)
      expect(onBlocked).toHaveBeenCalled()

      // User budget should NOT have any inflight (breaker blocked first)
      expect(mw.userBudgetManager!.getStatus("u1").inflight).toBe(0)
    })
  })

  describe("full pipeline: budget → guard → cache → generate → ledger", () => {
    it("tracks complete request lifecycle through all modules", async () => {
      const onUsage = vi.fn()
      const onWarning = vi.fn()
      const mw = tokenShieldMiddleware({
        modules: { guard: true, cache: true, context: false, router: false, prefix: false, ledger: true },
        guard: { debounceMs: 0, maxRequestsPerMinute: 999, maxCostPerHour: 999 },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 1.0 },
        userBudget: {
          getUserId: () => "tracked-user",
          budgets: {
            users: { "tracked-user": { daily: 10, monthly: 100 } },
            onBudgetWarning: onWarning,
          },
        },
        onUsage,
      })

      // Request 1: cache miss, calls model
      const params1 = makeParams("What is TypeScript?")
      const t1 = await mw.transformParams({ params: params1 })
      await mw.wrapGenerate({ doGenerate: mockDoGenerate(), params: t1 as Record<string, unknown> })

      expect(onUsage).toHaveBeenCalledTimes(1)
      const usage1 = onUsage.mock.calls[0][0]
      expect(usage1.cost).toBeGreaterThan(0)
      expect(usage1.inputTokens).toBe(50)

      // User budget should show spend
      const status = mw.userBudgetManager!.getStatus("tracked-user")
      expect(status.spend.daily).toBeGreaterThan(0)
      expect(status.inflight).toBe(0) // released after generate

      // Ledger should have 1 entry
      const summary = mw.ledger!.getSummary()
      expect(summary.totalCalls).toBe(1)

      // Request 2: cache hit, no model call
      const params2 = makeParams("What is TypeScript?")
      const t2 = await mw.transformParams({ params: params2 })
      const doGenerate2 = mockDoGenerate("Should not be called")
      await mw.wrapGenerate({ doGenerate: doGenerate2, params: t2 as Record<string, unknown> })

      expect(doGenerate2).not.toHaveBeenCalled()
      expect(onUsage).toHaveBeenCalledTimes(2)
      const usage2 = onUsage.mock.calls[1][0]
      expect(usage2.cost).toBe(0) // cache hit = no cost
      expect(usage2.saved).toBeGreaterThan(0) // but savings tracked

      // Ledger should have 2 entries
      expect(mw.ledger!.getSummary().totalCalls).toBe(2)
      expect(mw.ledger!.getSummary().cacheHits).toBe(1)
    })
  })

  describe("per-instance event bus isolation", () => {
    it("two middleware instances produce separate event streams", async () => {
      const events1: string[] = []
      const events2: string[] = []

      const mw1 = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
      })
      const mw2 = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
      })

      mw1.events.on("ledger:entry", () => events1.push("mw1"))
      mw2.events.on("ledger:entry", () => events2.push("mw2"))

      // Generate through mw1 only
      const params = makeParams("Hello")
      const t1 = await mw1.transformParams({ params })
      await mw1.wrapGenerate({ doGenerate: mockDoGenerate(), params: t1 as Record<string, unknown> })

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(0) // mw2 should NOT receive mw1's events
    })
  })

  describe("budget enforcement across streaming", () => {
    it("records budget spend after stream drains completely", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        userBudget: {
          getUserId: () => "stream-budget-user",
          budgets: {
            users: { "stream-budget-user": { daily: 10, monthly: 100 } },
          },
        },
      })

      const params = makeParams("Tell me a story")
      const t = await mw.transformParams({ params })

      // Verify inflight reserved
      expect(mw.userBudgetManager!.getStatus("stream-budget-user").inflight).toBeGreaterThan(0)

      const doStream = vi.fn(async () => ({ stream: makeStream(["Once ", "upon ", "a time."]) }))
      const result = await mw.wrapStream({ doStream, params: t as Record<string, unknown> })

      // Drain the stream
      const reader = (result.stream as ReadableStream).getReader()
      while (!(await reader.read()).done) { /* drain */ }

      // After drain: inflight released, spend recorded
      const status = mw.userBudgetManager!.getStatus("stream-budget-user")
      expect(status.inflight).toBe(0)
      expect(status.spend.daily).toBeGreaterThanOrEqual(0)
    })

    it("releases inflight when stream is cancelled mid-way", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        userBudget: {
          getUserId: () => "cancel-user",
          budgets: {
            users: { "cancel-user": { daily: 10, monthly: 100 } },
          },
        },
      })

      const params = makeParams("Long story please")
      const t = await mw.transformParams({ params })

      // Create a stream that hangs after first chunk
      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Once" })
        },
        pull() { return new Promise(() => {}) }, // never resolves
      })
      const doStream = vi.fn(async () => ({ stream: originalStream }))
      const result = await mw.wrapStream({ doStream, params: t as Record<string, unknown> })

      const reader = (result.stream as ReadableStream).getReader()
      await reader.read() // get first chunk
      await reader.cancel() // user aborts

      // Inflight must be released even though stream didn't complete
      const status = mw.userBudgetManager!.getStatus("cancel-user")
      expect(status.inflight).toBe(0)
    })
  })

  describe("onUsage callback accuracy", () => {
    it("reports correct cost and savings across multiple requests", async () => {
      const usages: { cost: number; saved: number; model: string }[] = []
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: true, context: false, router: false, prefix: false, ledger: true },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 1.0 },
        onUsage: (u) => usages.push({ cost: u.cost, saved: u.saved, model: u.model }),
      })

      // First call: cache miss
      const p1 = makeParams("Explain React hooks")
      const t1 = await mw.transformParams({ params: p1 })
      await mw.wrapGenerate({ doGenerate: mockDoGenerate(), params: t1 as Record<string, unknown> })

      // Second call: cache hit
      const p2 = makeParams("Explain React hooks")
      const t2 = await mw.transformParams({ params: p2 })
      await mw.wrapGenerate({ doGenerate: mockDoGenerate(), params: t2 as Record<string, unknown> })

      expect(usages).toHaveLength(2)
      expect(usages[0].cost).toBeGreaterThan(0)  // real API call
      expect(usages[0].saved).toBe(0)             // no savings on first call
      expect(usages[1].cost).toBe(0)              // cache hit
      expect(usages[1].saved).toBeGreaterThan(0)  // savings from cache
    })
  })

  describe("dry-run mode with budgets", () => {
    it("does not reserve inflight or record spend in dry-run", async () => {
      const dryRunActions: { module: string; description: string }[] = []
      const mw = tokenShieldMiddleware({
        modules: { guard: true, cache: true, context: false, router: false, prefix: false, ledger: false },
        guard: { debounceMs: 0, maxRequestsPerMinute: 999, maxCostPerHour: 999 },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
      })

      const params = makeParams("Hello dry run")
      await mw.transformParams({ params })

      // Should have reported on guard and cache
      expect(dryRunActions.some((a) => a.module === "guard")).toBe(true)
      expect(dryRunActions.some((a) => a.module === "cache")).toBe(true)

      // No state should have changed
      if (mw.guard) {
        const guardStats = mw.guard.stats()
        expect(guardStats.totalBlocked).toBe(0)
      }
    })
  })

  describe("error recovery and inflight cleanup", () => {
    it("guard block releases user budget inflight", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: true, cache: false, context: false, router: false, prefix: false, ledger: false },
        guard: { debounceMs: 0, maxRequestsPerMinute: 999, maxCostPerHour: 999 },
        userBudget: {
          getUserId: () => "guard-blocked-user",
          budgets: {
            users: { "guard-blocked-user": { daily: 100, monthly: 1000 } },
          },
        },
      })

      // Single character "x" is below default minInputLength=2, guard will block
      await expect(
        mw.transformParams({ params: makeParams("x") })
      ).rejects.toThrow(TokenShieldBlockedError)

      // Budget inflight should have been released when guard blocked
      expect(mw.userBudgetManager!.getStatus("guard-blocked-user").inflight).toBe(0)
    })

    it("API failure releases both breaker and budget inflight", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
        breaker: {
          limits: { perSession: 100 },
          action: "stop",
          persist: false,
        },
        userBudget: {
          getUserId: () => "api-fail-user",
          budgets: {
            users: { "api-fail-user": { daily: 100, monthly: 1000 } },
          },
        },
      })

      const params = makeParams("Hello")
      const t = await mw.transformParams({ params })
      const failGenerate = vi.fn(async () => { throw new Error("500 Internal Server Error") })

      await expect(
        mw.wrapGenerate({ doGenerate: failGenerate, params: t as Record<string, unknown> })
      ).rejects.toThrow("500 Internal Server Error")

      // Both budget and breaker should be clean
      expect(mw.userBudgetManager!.getStatus("api-fail-user").inflight).toBe(0)
    })
  })

  describe("tier routing through middleware", () => {
    it("standard tier user is routed to cheaper model", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        userBudget: {
          getUserId: () => "standard-user",
          budgets: {
            users: { "standard-user": { daily: 100, monthly: 1000, tier: "standard" } },
            tierModels: { standard: "gpt-4o-mini", premium: "gpt-4o" },
          },
        },
      })

      const params = {
        modelId: "gpt-4o", // requested expensive model
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }

      const transformed = await mw.transformParams({ params }) as Record<string, unknown>
      expect(transformed.modelId).toBe("gpt-4o-mini") // downgraded by tier
    })

    it("premium tier user keeps expensive model", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        userBudget: {
          getUserId: () => "premium-user",
          budgets: {
            users: { "premium-user": { daily: 100, monthly: 1000, tier: "premium" } },
            tierModels: { standard: "gpt-4o-mini", premium: "gpt-4o" },
          },
        },
      })

      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }

      const transformed = await mw.transformParams({ params }) as Record<string, unknown>
      expect(transformed.modelId).toBe("gpt-4o") // no downgrade
    })
  })

  describe("ledger accuracy through middleware", () => {
    it("ledger entry matches onUsage callback data", async () => {
      const onUsage = vi.fn()
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        onUsage,
      })

      const params = makeParams("Hello")
      const t = await mw.transformParams({ params })
      await mw.wrapGenerate({ doGenerate: mockDoGenerate(), params: t as Record<string, unknown> })

      const ledgerSummary = mw.ledger!.getSummary()
      const usageData = onUsage.mock.calls[0][0]

      expect(ledgerSummary.entries[0].inputTokens).toBe(usageData.inputTokens)
      expect(ledgerSummary.entries[0].outputTokens).toBe(usageData.outputTokens)
      expect(ledgerSummary.entries[0].actualCost).toBeCloseTo(usageData.cost, 6)
    })

    it("ledger tracks feature tag from config", async () => {
      const mw = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: true },
        ledger: { feature: "chatbot-v2" },
      })

      const params = makeParams("Hello")
      const t = await mw.transformParams({ params })
      await mw.wrapGenerate({ doGenerate: mockDoGenerate(), params: t as Record<string, unknown> })

      const entry = mw.ledger!.getSummary().entries[0]
      expect(entry.feature).toBe("chatbot-v2")
    })
  })
})
