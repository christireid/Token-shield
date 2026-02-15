import { describe, it, expect, vi, beforeEach } from "vitest"
import { UserBudgetManager } from "./user-budget-manager"

describe("UserBudgetManager", () => {
  let manager: UserBudgetManager

  beforeEach(() => {
    manager = new UserBudgetManager({
      users: {
        "user-1": { daily: 5.0, monthly: 50.0, tier: "standard" },
        "user-2": { daily: 0, monthly: 10.0, tier: "premium" },
      },
      defaultBudget: { daily: 1.0, monthly: 10.0 },
      tierModels: {
        standard: "gpt-4o-mini",
        premium: "gpt-4o",
      },
    })
  })

  // ---- check() ----

  it("allows requests when user has no spend", () => {
    const result = manager.check("user-1")
    expect(result.allowed).toBe(true)
    expect(result.status.spend.daily).toBe(0)
  })

  it("allows requests when no user ID is provided", () => {
    const result = manager.check("")
    expect(result.allowed).toBe(true)
  })

  it("allows requests for users with no configured limits", () => {
    const noLimitsManager = new UserBudgetManager({})
    const result = noLimitsManager.check("anyone")
    expect(result.allowed).toBe(true)
    expect(result.status.limits).toBeNull()
  })

  it("blocks when daily limit exceeded", async () => {
    await manager.recordSpend("user-1", 5.0, "gpt-4o-mini")
    const result = manager.check("user-1")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("daily")
  })

  it("blocks when monthly limit exceeded", async () => {
    // user-2 has daily=0 (no daily limit) but monthly=10
    await manager.recordSpend("user-2", 10.0, "gpt-4o")
    const result = manager.check("user-2")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("monthly")
  })

  it("zero daily limit means no daily enforcement", async () => {
    // user-2 has daily=0, meaning no daily limit
    await manager.recordSpend("user-2", 9.0, "gpt-4o")
    const result = manager.check("user-2")
    // Should be allowed because daily=0 skips daily check
    // Monthly limit is 10.0 and spend is 9.0, so still under
    expect(result.allowed).toBe(true)
  })

  // ---- recordSpend ----

  it("records spend and updates status", async () => {
    await manager.recordSpend("user-1", 2.5, "gpt-4o-mini")
    const status = manager.getStatus("user-1")
    expect(status.spend.daily).toBe(2.5)
    expect(status.spend.monthly).toBe(2.5)
  })

  it("ignores negative costs", async () => {
    await manager.recordSpend("user-1", -1.0, "gpt-4o-mini")
    const status = manager.getStatus("user-1")
    expect(status.spend.daily).toBe(0)
  })

  it("ignores empty user IDs", async () => {
    await manager.recordSpend("", 1.0, "gpt-4o-mini")
    // Should not throw and not record anything
  })

  it("releases inflight reservation using estimated cost", async () => {
    // check() reserves inflight when estimatedCost > 0
    manager.check("user-1", "gpt-4o-mini", 1000, 500)
    const statusBefore = manager.getStatus("user-1")
    expect(statusBefore.inflight).toBeGreaterThan(0)

    // recordSpend with estimatedCost releases by the estimate, not actual
    const inflight = statusBefore.inflight
    await manager.recordSpend("user-1", 0.001, "gpt-4o-mini", inflight)
    const statusAfter = manager.getStatus("user-1")
    expect(statusAfter.inflight).toBe(0)
  })

  // ---- releaseInflight ----

  it("releases inflight without recording spend", () => {
    manager.check("user-1", "gpt-4o-mini", 1000, 500)
    const inflight = manager.getStatus("user-1").inflight
    expect(inflight).toBeGreaterThan(0)

    manager.releaseInflight("user-1", inflight)
    expect(manager.getStatus("user-1").inflight).toBe(0)
  })

  it("releaseInflight ignores empty userId or non-positive cost", () => {
    // Should not throw
    manager.releaseInflight("", 1.0)
    manager.releaseInflight("user-1", 0)
    manager.releaseInflight("user-1", -1)
  })

  // ---- getStatus ----

  it("returns correct remaining and percentUsed", async () => {
    await manager.recordSpend("user-1", 2.0, "gpt-4o-mini")
    const status = manager.getStatus("user-1")
    expect(status.remaining.daily).toBe(3.0)
    expect(status.remaining.monthly).toBe(48.0)
    expect(status.percentUsed.daily).toBeCloseTo(40) // 2/5 * 100
    expect(status.percentUsed.monthly).toBeCloseTo(4) // 2/50 * 100
  })

  it("returns null remaining when limit is 0", () => {
    // user-2 has daily=0
    const status = manager.getStatus("user-2")
    expect(status.remaining.daily).toBeNull()
    expect(status.percentUsed.daily).toBe(0)
  })

  it("isOverBudget is true when spend exceeds limit", async () => {
    // Record spend that exceeds the $5 daily limit
    await manager.recordSpend("user-1", 5.01, "gpt-4o-mini")
    const status = manager.getStatus("user-1")
    expect(status.isOverBudget).toBe(true)
  })

  it("check blocks when inflight + estimated would exceed limit", async () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 0.01, monthly: 100 } },
    })
    await mgr.recordSpend("u1", 0.008, "gpt-4o-mini")
    // Small check passes: projected = $0.008 + ~$0.00045 < $0.01
    const r1 = mgr.check("u1", "gpt-4o-mini", 1000, 500)
    expect(r1.allowed).toBe(true)
    // Expensive check blocked: projected = $0.008 + $0.075 + inflight >> $0.01
    const r2 = mgr.check("u1", "gpt-4o", 10000, 5000)
    expect(r2.allowed).toBe(false)
  })

  it("uses default budget for unconfigured users", () => {
    const status = manager.getStatus("unknown-user")
    expect(status.limits).toEqual({ daily: 1.0, monthly: 10.0 })
    expect(status.tier).toBe("standard")
  })

  it("caches snapshots and returns same reference when unchanged", () => {
    const s1 = manager.getStatus("user-1")
    const s2 = manager.getStatus("user-1")
    expect(s1).toBe(s2) // Same reference
  })

  // ---- getModelForUser ----

  it("returns tier model for configured user", () => {
    expect(manager.getModelForUser("user-1")).toBe("gpt-4o-mini")
    expect(manager.getModelForUser("user-2")).toBe("gpt-4o")
  })

  it("returns null when no tier models configured", () => {
    const noTierManager = new UserBudgetManager({
      defaultBudget: { daily: 1, monthly: 10 },
    })
    expect(noTierManager.getModelForUser("user")).toBeNull()
  })

  // ---- getAllUserStatuses ----

  it("returns statuses for all known users", async () => {
    await manager.recordSpend("user-3", 1.0, "gpt-4o-mini")
    const statuses = manager.getAllUserStatuses()
    const ids = statuses.map((s) => s.userId)
    // user-1 and user-2 from config, user-3 from spend records
    expect(ids).toContain("user-1")
    expect(ids).toContain("user-2")
    expect(ids).toContain("user-3")
  })

  // ---- updateUserBudget / removeUserBudget ----

  it("updateUserBudget changes limits at runtime", () => {
    manager.updateUserBudget("user-1", { daily: 100, monthly: 1000, tier: "unlimited" })
    const status = manager.getStatus("user-1")
    expect(status.limits!.daily).toBe(100)
    expect(status.tier).toBe("unlimited")
  })

  it("removeUserBudget falls back to default", () => {
    manager.removeUserBudget("user-1")
    const status = manager.getStatus("user-1")
    // Falls back to defaultBudget
    expect(status.limits!.daily).toBe(1.0)
    expect(status.limits!.monthly).toBe(10.0)
  })

  // ---- resetUser / reset ----

  it("resetUser clears a specific user's data", async () => {
    await manager.recordSpend("user-1", 3.0, "gpt-4o-mini")
    await manager.resetUser("user-1")
    const status = manager.getStatus("user-1")
    expect(status.spend.daily).toBe(0)
    expect(status.inflight).toBe(0)
  })

  it("reset clears all data", async () => {
    await manager.recordSpend("user-1", 3.0, "gpt-4o-mini")
    await manager.recordSpend("user-2", 5.0, "gpt-4o")
    await manager.reset()
    expect(manager.getStatus("user-1").spend.daily).toBe(0)
    expect(manager.getStatus("user-2").spend.daily).toBe(0)
  })

  // ---- subscribe ----

  it("subscribe notifies on state changes", async () => {
    const listener = vi.fn()
    const unsub = manager.subscribe(listener)
    await manager.recordSpend("user-1", 1.0, "gpt-4o-mini")
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    await manager.recordSpend("user-1", 1.0, "gpt-4o-mini")
    expect(listener).toHaveBeenCalledTimes(1) // no more calls after unsub
  })

  // ---- hydrate ----

  it("hydrate returns 0 when persistence is disabled", async () => {
    const count = await manager.hydrate()
    expect(count).toBe(0)
  })

  // ---- warning / exceeded callbacks ----

  it("fires onBudgetWarning at 80% of daily limit", async () => {
    const onWarning = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 10.0, monthly: 100.0 } },
      onBudgetWarning: onWarning,
    })
    await mgr.recordSpend("u1", 8.0, "gpt-4o-mini")
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toBe("u1")
    expect(onWarning.mock.calls[0][1].limitType).toBe("daily")
  })

  it("fires onBudgetExceeded when daily limit hit", async () => {
    const onExceeded = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 5.0, monthly: 100.0 } },
      onBudgetExceeded: onExceeded,
    })
    await mgr.recordSpend("u1", 5.0, "gpt-4o-mini")
    const result = mgr.check("u1")
    expect(result.allowed).toBe(false)
    expect(onExceeded).toHaveBeenCalledTimes(1)
  })

  // ---- REGRESSION: inflight phantom drift ----

  it("does not accumulate phantom inflight from estimation inaccuracies", async () => {
    // Simulate: check reserves inflight, actual cost differs.
    // If we release by actual cost, phantom remains forever.
    // Fix: release by estimated cost (what was reserved).
    const checkResult = manager.check("user-1", "gpt-4o-mini", 1000, 500)
    expect(checkResult.allowed).toBe(true)
    const inflightAfterCheck = manager.getStatus("user-1").inflight
    expect(inflightAfterCheck).toBeGreaterThan(0)

    // Record actual spend (different from estimate) passing the estimate
    const actualCost = inflightAfterCheck * 0.5 // actual is 50% of estimate
    await manager.recordSpend("user-1", actualCost, "gpt-4o-mini", inflightAfterCheck)

    // Inflight should be zero — released by estimated amount, not actual
    expect(manager.getStatus("user-1").inflight).toBe(0)
  })
})
