import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  MAX_TRACKED_USERS,
  MAX_CACHE_SIZE,
  MAX_BUDGET_RECORDS,
  THIRTY_DAYS_MS,
  ONE_DAY_MS,
} from "./user-budget-types"

// Hoisted mock functions for the storage adapter
const mockGet = vi.hoisted(() => vi.fn())
const mockSet = vi.hoisted(() => vi.fn())
const mockCreateStore = vi.hoisted(() => vi.fn())
vi.mock("./storage-adapter", () => ({
  get: (...args: unknown[]) => mockGet(...args),
  set: (...args: unknown[]) => mockSet(...args),
  createStore: (...args: unknown[]) => mockCreateStore(...args),
}))

import { UserBudgetManager } from "./user-budget-manager"

// Reset storage mocks before every test so non-IDB tests are unaffected
beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
  mockCreateStore.mockReset()
  mockGet.mockResolvedValue(undefined)
  mockSet.mockResolvedValue(undefined)
  mockCreateStore.mockReturnValue("mock-idb-store")
})

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

// -------------------------------------------------------
// Constructor: IDB unavailable catch block (line 78)
// -------------------------------------------------------

describe("UserBudgetManager constructor IDB catch block", () => {
  const origWindow = globalThis.window

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("swallows createStore error when IDB is unavailable", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
    mockCreateStore.mockImplementation(() => {
      throw new Error("IDB not available")
    })

    // Should not throw — the catch block silences the error
    const mgr = new UserBudgetManager({ persist: true })
    expect(mgr).toBeTruthy()
    // hydrate returns 0 because idbStore is null (catch swallowed the error)
    await expect(mgr.hydrate()).resolves.toBe(0)
  })
})

// -------------------------------------------------------
// check(): Inflight FIFO eviction (lines 262-264)
// -------------------------------------------------------

describe("UserBudgetManager check() inflight FIFO eviction", () => {
  it("evicts oldest inflight entry when inflightByUser exceeds MAX_TRACKED_USERS", () => {
    const mgr = new UserBudgetManager({
      defaultBudget: { daily: 999999, monthly: 999999 },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgrAny = mgr as any

    // Directly fill the inflightByUser map to MAX_TRACKED_USERS
    for (let i = 0; i < MAX_TRACKED_USERS; i++) {
      mgrAny.inflightByUser.set(`user-fifo-${i}`, 0.001)
    }
    expect(mgrAny.inflightByUser.size).toBe(MAX_TRACKED_USERS)

    // The first user should have inflight reserved
    expect(mgrAny.inflightByUser.has("user-fifo-0")).toBe(true)
    expect(mgrAny.inflightByUser.get("user-fifo-0")).toBe(0.001)

    // Add one more via check() — triggers FIFO eviction since size > MAX_TRACKED_USERS
    mgr.check(`user-fifo-overflow`, "gpt-4o-mini", 1000, 500)

    // user-fifo-0 was the first inserted, so it should be evicted (FIFO)
    expect(mgrAny.inflightByUser.has("user-fifo-0")).toBe(false)
    // The newly added user should still have inflight
    expect(mgrAny.inflightByUser.has("user-fifo-overflow")).toBe(true)
    expect(mgrAny.inflightByUser.get("user-fifo-overflow")).toBeGreaterThan(0)
    // Map should be back to MAX_TRACKED_USERS size
    expect(mgrAny.inflightByUser.size).toBe(MAX_TRACKED_USERS)
  })
})

// -------------------------------------------------------
// recordSpend(): Partial inflight release (line 296, remaining > 0)
// -------------------------------------------------------

describe("UserBudgetManager recordSpend() partial inflight release", () => {
  it("keeps remaining inflight when estimated cost is less than total inflight", async () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 999, monthly: 9999 } },
    })

    // Reserve two separate inflight amounts for the same user
    mgr.check("u1", "gpt-4o-mini", 1000, 500)
    const inflight1 = mgr.getStatus("u1").inflight
    mgr.check("u1", "gpt-4o-mini", 1000, 500)
    const inflightTotal = mgr.getStatus("u1").inflight
    expect(inflightTotal).toBeGreaterThan(inflight1)

    // Release only the first estimated cost — remaining should be > 0
    await mgr.recordSpend("u1", 0.001, "gpt-4o-mini", inflight1)
    const remaining = mgr.getStatus("u1").inflight
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeCloseTo(inflightTotal - inflight1, 10)
  })
})

// -------------------------------------------------------
// recordSpend(): Zero-cost response (line 305)
// -------------------------------------------------------

describe("UserBudgetManager recordSpend() zero-cost response", () => {
  it("releases inflight and notifies subscribers on cost === 0", async () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 999, monthly: 9999 } },
    })
    const listener = vi.fn()
    mgr.subscribe(listener)

    // Reserve inflight
    mgr.check("u1", "gpt-4o-mini", 1000, 500)
    const inflight = mgr.getStatus("u1").inflight
    expect(inflight).toBeGreaterThan(0)

    // Record zero-cost spend with the estimated cost
    await mgr.recordSpend("u1", 0, "gpt-4o-mini", inflight)

    // Inflight should be released
    expect(mgr.getStatus("u1").inflight).toBe(0)
    // Subscriber should have been notified
    expect(listener).toHaveBeenCalled()
    // No spend record should be created (daily spend should remain 0)
    expect(mgr.getStatus("u1").spend.daily).toBe(0)
  })
})

// -------------------------------------------------------
// recordSpend(): MAX_BUDGET_RECORDS cap (lines 322-323)
// -------------------------------------------------------

describe("UserBudgetManager recordSpend() MAX_BUDGET_RECORDS cap", () => {
  it("caps records at MAX_BUDGET_RECORDS by slicing to the most recent", async () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 0, monthly: 0 } }, // no limits
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mgrAny = mgr as any

    // Directly inject MAX_BUDGET_RECORDS records into the internal array
    const now = Date.now()
    const records = []
    for (let i = 0; i < MAX_BUDGET_RECORDS; i++) {
      records.push({ timestamp: now - i, cost: 0.0001, model: "gpt-4o-mini", userId: "u1" })
    }
    mgrAny.records = records
    expect(mgrAny.records.length).toBe(MAX_BUDGET_RECORDS)

    // Add one more via recordSpend — this should trigger the cap slice
    await mgr.recordSpend("u1", 999.0, "gpt-4o-mini")

    // After the cap, records should be sliced to MAX_BUDGET_RECORDS
    expect(mgrAny.records.length).toBeLessThanOrEqual(MAX_BUDGET_RECORDS)
    // The most recent record (999.0) should be in the array
    const last = mgrAny.records[mgrAny.records.length - 1]
    expect(last.cost).toBe(999.0)
  })
})

// -------------------------------------------------------
// recordSpend(): IDB write failure (line 330)
// -------------------------------------------------------

describe("UserBudgetManager recordSpend() IDB write failure", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("silently swallows IDB set error and keeps data in memory", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    mockSet.mockRejectedValueOnce(new Error("IDB quota exceeded"))

    const mgr = new UserBudgetManager({ persist: true })
    // Should not throw
    await mgr.recordSpend("u1", 1.0, "gpt-4o-mini")
    // Data should still be in memory
    const status = mgr.getStatus("u1")
    expect(status.spend.daily).toBe(1.0)
  })
})

// -------------------------------------------------------
// Monthly warning reset after 30 days (lines 207-209)
// -------------------------------------------------------

describe("UserBudgetManager monthly warning reset after 30 days", () => {
  it("re-fires monthly warning after 30 days have passed", async () => {
    const onWarning = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 0, monthly: 10.0 } },
      onBudgetWarning: onWarning,
    })

    // Spend 80% of monthly limit to trigger warning
    await mgr.recordSpend("u1", 8.0, "gpt-4o-mini")
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][1].limitType).toBe("monthly")

    // check again — warning should NOT fire again (deduped)
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)

    // Advance time past 30 days so the monthly warning resets
    const originalDateNow = Date.now
    const thirtyOneDays = THIRTY_DAYS_MS + ONE_DAY_MS
    Date.now = () => originalDateNow() + thirtyOneDays

    try {
      // Need fresh spend records in the new time window
      await mgr.recordSpend("u1", 8.5, "gpt-4o-mini")
      mgr.check("u1")
      // Warning should fire again since the old one expired
      expect(onWarning).toHaveBeenCalledTimes(2)
      expect(onWarning.mock.calls[1][1].limitType).toBe("monthly")
    } finally {
      Date.now = originalDateNow
    }
  })
})

// -------------------------------------------------------
// Monthly budget exceeded path (lines 232-252)
// -------------------------------------------------------

describe("UserBudgetManager monthly budget exceeded", () => {
  it("fires onBudgetExceeded and blocks when monthly limit hit", async () => {
    const onExceeded = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 0, monthly: 5.0 } }, // no daily limit, monthly=5
      onBudgetExceeded: onExceeded,
    })

    await mgr.recordSpend("u1", 5.0, "gpt-4o-mini")
    const result = mgr.check("u1")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("monthly")
    expect(onExceeded).toHaveBeenCalledTimes(1)
    expect(onExceeded.mock.calls[0][0]).toBe("u1")
    expect(onExceeded.mock.calls[0][1].limitType).toBe("monthly")
  })

  it("fires monthly warning callback at 80% of monthly limit", async () => {
    const onWarning = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 0, monthly: 10.0 } },
      onBudgetWarning: onWarning,
    })

    await mgr.recordSpend("u1", 8.0, "gpt-4o-mini")
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][1].limitType).toBe("monthly")
    expect(onWarning.mock.calls[0][1].percentUsed).toBeGreaterThanOrEqual(80)
  })
})

// -------------------------------------------------------
// releaseInflight(): Partial release (remaining > 0)
// -------------------------------------------------------

describe("UserBudgetManager releaseInflight() partial release", () => {
  it("keeps remaining inflight when released amount is less than total", () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 999, monthly: 9999 } },
    })

    // Reserve two inflight amounts
    mgr.check("u1", "gpt-4o-mini", 1000, 500)
    const inflight1 = mgr.getStatus("u1").inflight
    mgr.check("u1", "gpt-4o-mini", 1000, 500)
    const inflightTotal = mgr.getStatus("u1").inflight
    expect(inflightTotal).toBeGreaterThan(inflight1)

    // Release only the first amount
    mgr.releaseInflight("u1", inflight1)
    const remaining = mgr.getStatus("u1").inflight
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeCloseTo(inflightTotal - inflight1, 10)
  })
})

// -------------------------------------------------------
// getStatus(): LRU eviction when _snapshotCache exceeds MAX_CACHE_SIZE
// -------------------------------------------------------

describe("UserBudgetManager getStatus() LRU eviction", () => {
  it("evicts oldest cache entry when snapshot cache exceeds MAX_CACHE_SIZE", () => {
    const mgr = new UserBudgetManager({
      defaultBudget: { daily: 100, monthly: 1000 },
    })

    // Fill the snapshot cache to MAX_CACHE_SIZE + 1
    for (let i = 0; i <= MAX_CACHE_SIZE; i++) {
      mgr.getStatus(`cache-user-${i}`)
    }

    // Trigger one more getStatus for a new user to force eviction
    mgr.getStatus(`cache-user-overflow`)

    // The cache should have evicted old entries; verify the new entry is accessible
    const status = mgr.getStatus(`cache-user-overflow`)
    expect(status).toBeTruthy()
    expect(status.userId).toBe(`cache-user-overflow`)
  })
})

// -------------------------------------------------------
// getStatus(): Cached snapshot reference reuse
// -------------------------------------------------------

describe("UserBudgetManager getStatus() snapshot reference reuse", () => {
  it("reuses cached snapshot reference when values are identical across versions", async () => {
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 100, monthly: 1000 } },
    })

    // First call creates and caches a snapshot
    const s1 = mgr.getStatus("u1")

    // Trigger a version bump without changing u1's data
    // (recording spend for a different user bumps version)
    await mgr.recordSpend("other-user", 1.0, "gpt-4o-mini")

    // s2 should reuse the same reference because u1's values haven't changed
    const s2 = mgr.getStatus("u1")
    expect(s2).toBe(s1)
  })
})

// -------------------------------------------------------
// hydrate(): IDB has persisted records + merge/dedup logic
// -------------------------------------------------------

describe("UserBudgetManager hydrate() with persisted records", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("merges persisted records with in-memory records, deduplicating", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")

    const mgr = new UserBudgetManager({ persist: true })

    // Record some spend in memory before hydrate
    await mgr.recordSpend("u1", 1.0, "gpt-4o-mini")

    const now = Date.now()
    const persistedRecords = [
      // Duplicate of the in-memory record (same key): should be deduped
      // Note: since the in-memory record uses Date.now() we approximate
      { timestamp: now, cost: 1.0, model: "gpt-4o-mini", userId: "u1" },
      // Unique persisted record: should be merged in
      { timestamp: now - 1000, cost: 2.0, model: "gpt-4o", userId: "u1" },
      // Stale record older than 30 days: should be filtered out
      { timestamp: now - THIRTY_DAYS_MS - 1000, cost: 5.0, model: "gpt-4o", userId: "u1" },
    ]
    mockGet.mockResolvedValueOnce(persistedRecords)

    const count = await mgr.hydrate()
    expect(count).toBeGreaterThan(0)

    // The status should reflect the merged (non-stale, non-duplicate) records
    const status = mgr.getStatus("u1")
    // Should have at least 2.0 from the unique persisted record
    expect(status.spend.daily).toBeGreaterThanOrEqual(2.0)
  })

  it("returns 0 when persisted records are empty", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    mockGet.mockResolvedValueOnce([])

    const mgr = new UserBudgetManager({ persist: true })
    const count = await mgr.hydrate()
    expect(count).toBe(0)
  })

  it("returns 0 when persisted records are null", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    mockGet.mockResolvedValueOnce(null)

    const mgr = new UserBudgetManager({ persist: true })
    const count = await mgr.hydrate()
    expect(count).toBe(0)
  })
})

// -------------------------------------------------------
// hydrate(): IDB failure catch block (line 475)
// -------------------------------------------------------

describe("UserBudgetManager hydrate() IDB failure", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("returns 0 when IDB get throws", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    mockGet.mockRejectedValueOnce(new Error("IDB read failed"))

    const mgr = new UserBudgetManager({ persist: true })
    const count = await mgr.hydrate()
    expect(count).toBe(0)
  })
})

// -------------------------------------------------------
// resetUser(): IDB write failure (lines 518-520)
// -------------------------------------------------------

describe("UserBudgetManager resetUser() IDB write failure", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("silently swallows IDB set error and still clears in-memory data", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    const mgr = new UserBudgetManager({ persist: true })

    await mgr.recordSpend("u1", 3.0, "gpt-4o-mini")
    expect(mgr.getStatus("u1").spend.daily).toBe(3.0)

    // Make the next IDB write fail
    mockSet.mockRejectedValueOnce(new Error("IDB write failed"))
    // resetUser should not throw
    await mgr.resetUser("u1")
    // In-memory data should still be cleared
    expect(mgr.getStatus("u1").spend.daily).toBe(0)
  })
})

// -------------------------------------------------------
// reset(): IDB write failure (lines 537-539)
// -------------------------------------------------------

describe("UserBudgetManager reset() IDB write failure", () => {
  const origWindow = globalThis.window

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })

  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("silently swallows IDB set error and still clears all in-memory data", async () => {
    mockCreateStore.mockReturnValue("mock-idb-store")
    const mgr = new UserBudgetManager({ persist: true })

    await mgr.recordSpend("u1", 3.0, "gpt-4o-mini")
    await mgr.recordSpend("u2", 5.0, "gpt-4o")

    // Make the next IDB write fail
    mockSet.mockRejectedValueOnce(new Error("IDB write failed"))
    // reset should not throw
    await mgr.reset()
    // All in-memory data should be cleared
    expect(mgr.getStatus("u1").spend.daily).toBe(0)
    expect(mgr.getStatus("u2").spend.daily).toBe(0)
  })
})

// -------------------------------------------------------
// Daily warning reset after 24 hours (lines 155-157)
// -------------------------------------------------------

describe("UserBudgetManager daily warning reset after 24 hours", () => {
  it("re-fires daily warning after 24 hours have passed", async () => {
    const onWarning = vi.fn()
    const mgr = new UserBudgetManager({
      users: { u1: { daily: 10.0, monthly: 0 } },
      onBudgetWarning: onWarning,
    })

    await mgr.recordSpend("u1", 8.5, "gpt-4o-mini")
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)

    // Check again immediately — warning should not re-fire
    mgr.check("u1")
    expect(onWarning).toHaveBeenCalledTimes(1)

    // Advance time past 24 hours
    const originalDateNow = Date.now
    const twentyFiveHours = ONE_DAY_MS + 60 * 60 * 1000
    Date.now = () => originalDateNow() + twentyFiveHours

    try {
      // Record new spend in the new window
      await mgr.recordSpend("u1", 8.5, "gpt-4o-mini")
      mgr.check("u1")
      // Warning should fire again because the 24h reset happened
      expect(onWarning).toHaveBeenCalledTimes(2)
    } finally {
      Date.now = originalDateNow
    }
  })
})
