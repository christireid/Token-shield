/**
 * User Budget Types & Utilities Tests
 *
 * Tests for pure utility functions: budgetPct, resolveUserLimits,
 * computeSpendWindows, buildBudgetSnapshot, evictStaleWarnings.
 */

import { describe, it, expect } from "vitest"
import {
  budgetPct,
  resolveUserLimits,
  computeSpendWindows,
  buildBudgetSnapshot,
  evictStaleWarnings,
  ONE_DAY_MS,
  THIRTY_DAYS_MS,
  MAX_WARNING_MAP_SIZE,
  MAX_CACHE_SIZE,
  MAX_TRACKED_USERS,
  MAX_BUDGET_RECORDS,
  type UserBudgetConfig,
  type UserSpendRecord,
} from "./user-budget-types"

// -------------------------------------------------------
// budgetPct
// -------------------------------------------------------

describe("budgetPct", () => {
  it("returns percentage of value relative to limit", () => {
    expect(budgetPct(50, 100)).toBe(50)
    expect(budgetPct(75, 100)).toBe(75)
    expect(budgetPct(100, 100)).toBe(100)
  })

  it("caps at 999 to avoid Infinity", () => {
    expect(budgetPct(10000, 100)).toBe(999)
    expect(budgetPct(999999, 1)).toBe(999)
  })

  it("returns 0 when limit is 0", () => {
    expect(budgetPct(50, 0)).toBe(0)
    expect(budgetPct(0, 0)).toBe(0)
  })

  it("returns 0 when value is 0", () => {
    expect(budgetPct(0, 100)).toBe(0)
  })

  it("handles fractional values", () => {
    expect(budgetPct(0.5, 1)).toBe(50)
    expect(budgetPct(1, 3)).toBeCloseTo(33.333, 2)
  })
})

// -------------------------------------------------------
// resolveUserLimits
// -------------------------------------------------------

describe("resolveUserLimits", () => {
  it("returns user-specific config when present", () => {
    const config: UserBudgetConfig = {
      users: {
        "user-1": { daily: 10, monthly: 100, tier: "premium" },
      },
      defaultBudget: { daily: 5, monthly: 50 },
    }

    const limits = resolveUserLimits(config, "user-1")
    expect(limits).toEqual({ daily: 10, monthly: 100, tier: "premium" })
  })

  it("falls back to defaultBudget when user not in config", () => {
    const config: UserBudgetConfig = {
      users: {
        "user-1": { daily: 10, monthly: 100 },
      },
      defaultBudget: { daily: 5, monthly: 50, tier: "standard" },
    }

    const limits = resolveUserLimits(config, "user-unknown")
    expect(limits).toEqual({ daily: 5, monthly: 50, tier: "standard" })
  })

  it("returns null when no user config and no default", () => {
    const config: UserBudgetConfig = {}
    expect(resolveUserLimits(config, "user-1")).toBeNull()
  })

  it("returns null when users map is empty and no default", () => {
    const config: UserBudgetConfig = { users: {} }
    expect(resolveUserLimits(config, "user-1")).toBeNull()
  })
})

// -------------------------------------------------------
// computeSpendWindows
// -------------------------------------------------------

describe("computeSpendWindows", () => {
  const NOW = Date.now()

  it("sums daily and monthly spend for matching user", () => {
    const records: UserSpendRecord[] = [
      { timestamp: NOW - 1000, cost: 5, model: "gpt-4o", userId: "user-1" },
      { timestamp: NOW - 2000, cost: 3, model: "gpt-4o", userId: "user-1" },
    ]

    const result = computeSpendWindows(records, "user-1", NOW)
    expect(result.daily).toBe(8)
    expect(result.monthly).toBe(8)
  })

  it("excludes other users' records", () => {
    const records: UserSpendRecord[] = [
      { timestamp: NOW - 1000, cost: 5, model: "gpt-4o", userId: "user-1" },
      { timestamp: NOW - 2000, cost: 10, model: "gpt-4o", userId: "user-2" },
    ]

    const result = computeSpendWindows(records, "user-1", NOW)
    expect(result.daily).toBe(5)
    expect(result.monthly).toBe(5)
  })

  it("separates daily and monthly windows correctly", () => {
    const records: UserSpendRecord[] = [
      // Within the last day
      { timestamp: NOW - 1000, cost: 5, model: "gpt-4o", userId: "user-1" },
      // 2 days ago - only in monthly window
      { timestamp: NOW - 2 * ONE_DAY_MS, cost: 10, model: "gpt-4o", userId: "user-1" },
      // 35 days ago - outside both windows
      { timestamp: NOW - 35 * ONE_DAY_MS, cost: 100, model: "gpt-4o", userId: "user-1" },
    ]

    const result = computeSpendWindows(records, "user-1", NOW)
    expect(result.daily).toBe(5)
    expect(result.monthly).toBe(15)
  })

  it("returns zeros for empty records", () => {
    const result = computeSpendWindows([], "user-1", NOW)
    expect(result.daily).toBe(0)
    expect(result.monthly).toBe(0)
  })

  it("returns zeros when no records match user", () => {
    const records: UserSpendRecord[] = [
      { timestamp: NOW - 1000, cost: 5, model: "gpt-4o", userId: "user-2" },
    ]

    const result = computeSpendWindows(records, "user-1", NOW)
    expect(result.daily).toBe(0)
    expect(result.monthly).toBe(0)
  })
})

// -------------------------------------------------------
// buildBudgetSnapshot
// -------------------------------------------------------

describe("buildBudgetSnapshot", () => {
  it("returns unlimited snapshot when limits is null", () => {
    const snapshot = buildBudgetSnapshot("user-1", null, { daily: 5, monthly: 50 }, 0)

    expect(snapshot.userId).toBe("user-1")
    expect(snapshot.limits).toBeNull()
    expect(snapshot.remaining.daily).toBeNull()
    expect(snapshot.remaining.monthly).toBeNull()
    expect(snapshot.percentUsed.daily).toBe(0)
    expect(snapshot.percentUsed.monthly).toBe(0)
    expect(snapshot.isOverBudget).toBe(false)
    expect(snapshot.tier).toBe("standard")
  })

  it("calculates remaining budget correctly", () => {
    const limits = { daily: 10, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 3, monthly: 40 }, 0)

    expect(snapshot.remaining.daily).toBe(7)
    expect(snapshot.remaining.monthly).toBe(60)
  })

  it("clamps remaining to zero (not negative)", () => {
    const limits = { daily: 10, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 15, monthly: 120 }, 0)

    expect(snapshot.remaining.daily).toBe(0)
    expect(snapshot.remaining.monthly).toBe(0)
  })

  it("returns null remaining when limit is 0 (unlimited)", () => {
    const limits = { daily: 0, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 5, monthly: 50 }, 0)

    expect(snapshot.remaining.daily).toBeNull()
    expect(snapshot.remaining.monthly).toBe(50)
  })

  it("calculates percentUsed correctly", () => {
    const limits = { daily: 10, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 5, monthly: 80 }, 0)

    expect(snapshot.percentUsed.daily).toBe(50)
    expect(snapshot.percentUsed.monthly).toBe(80)
  })

  it("caps percentUsed at 999", () => {
    const limits = { daily: 1, monthly: 1 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 100, monthly: 100 }, 0)

    expect(snapshot.percentUsed.daily).toBe(999)
    expect(snapshot.percentUsed.monthly).toBe(999)
  })

  it("isOverBudget accounts for inflight cost", () => {
    const limits = { daily: 10, monthly: 100 }
    // spend.daily = 8, inflight = 3 => total = 11 >= 10 => over
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 8, monthly: 50 }, 3)

    expect(snapshot.isOverBudget).toBe(true)
  })

  it("isOverBudget is false when within limits", () => {
    const limits = { daily: 10, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 5, monthly: 50 }, 1)

    expect(snapshot.isOverBudget).toBe(false)
  })

  it("uses tier from limits when provided", () => {
    const limits = { daily: 10, monthly: 100, tier: "premium" as const }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 0, monthly: 0 }, 0)

    expect(snapshot.tier).toBe("premium")
  })

  it("defaults to standard tier", () => {
    const limits = { daily: 10, monthly: 100 }
    const snapshot = buildBudgetSnapshot("user-1", limits, { daily: 0, monthly: 0 }, 0)

    expect(snapshot.tier).toBe("standard")
  })
})

// -------------------------------------------------------
// evictStaleWarnings
// -------------------------------------------------------

describe("evictStaleWarnings", () => {
  it("does nothing when map is under MAX_WARNING_MAP_SIZE", () => {
    const map = new Map<string, number>()
    for (let i = 0; i < 10; i++) {
      map.set(`key-${i}`, Date.now())
    }

    evictStaleWarnings(map, Date.now())
    expect(map.size).toBe(10)
  })

  it("removes expired entries (>30 days old) when over limit", () => {
    const now = Date.now()
    const map = new Map<string, number>()

    // Fill to over MAX_WARNING_MAP_SIZE with old entries
    for (let i = 0; i < MAX_WARNING_MAP_SIZE + 10; i++) {
      if (i < 10) {
        // 10 recent entries
        map.set(`recent-${i}`, now - 1000)
      } else {
        // Old entries (>30 days)
        map.set(`old-${i}`, now - THIRTY_DAYS_MS - 1000)
      }
    }

    evictStaleWarnings(map, now)
    // Old entries should be removed, recent entries kept
    expect(map.size).toBeLessThanOrEqual(MAX_WARNING_MAP_SIZE)
    expect(map.has("recent-0")).toBe(true)
  })

  it("uses FIFO eviction when all entries are recent", () => {
    const now = Date.now()
    const map = new Map<string, number>()

    // Fill to over MAX_WARNING_MAP_SIZE with all-recent entries
    const overCount = MAX_WARNING_MAP_SIZE + 50
    for (let i = 0; i < overCount; i++) {
      map.set(`key-${i}`, now - i * 100) // all within 30 days
    }

    evictStaleWarnings(map, now)
    expect(map.size).toBe(MAX_WARNING_MAP_SIZE)
  })
})

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

describe("constants", () => {
  it("ONE_DAY_MS equals 86400000", () => {
    expect(ONE_DAY_MS).toBe(86_400_000)
  })

  it("THIRTY_DAYS_MS equals 30 days", () => {
    expect(THIRTY_DAYS_MS).toBe(30 * 86_400_000)
  })

  it("MAX_CACHE_SIZE is 1000", () => {
    expect(MAX_CACHE_SIZE).toBe(1000)
  })

  it("MAX_WARNING_MAP_SIZE is 500", () => {
    expect(MAX_WARNING_MAP_SIZE).toBe(500)
  })

  it("MAX_TRACKED_USERS is 5000", () => {
    expect(MAX_TRACKED_USERS).toBe(5000)
  })

  it("MAX_BUDGET_RECORDS is 50000", () => {
    expect(MAX_BUDGET_RECORDS).toBe(50_000)
  })
})
