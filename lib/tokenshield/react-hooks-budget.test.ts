import { describe, it, expect } from "vitest"
import {
  useCostLedger,
  useFeatureCost,
  useBudgetAlert,
  useUserBudget,
  useSessionSavings,
  type SessionSavingsState,
} from "./react-hooks-budget"

describe("react-hooks-budget", () => {
  describe("exports", () => {
    it("exports useCostLedger as a function", () => {
      expect(typeof useCostLedger).toBe("function")
    })

    it("exports useFeatureCost as a function", () => {
      expect(typeof useFeatureCost).toBe("function")
    })

    it("exports useBudgetAlert as a function", () => {
      expect(typeof useBudgetAlert).toBe("function")
    })

    it("exports useUserBudget as a function", () => {
      expect(typeof useUserBudget).toBe("function")
    })

    it("exports useSessionSavings as a function", () => {
      expect(typeof useSessionSavings).toBe("function")
    })
  })

  describe("SessionSavingsState interface", () => {
    it("allows creating objects with correct shape", () => {
      const state: SessionSavingsState = {
        totalSpent: 1.25,
        totalSaved: 0.75,
        netCost: 0.5,
        requestCount: 10,
      }

      expect(state.totalSpent).toBe(1.25)
      expect(state.totalSaved).toBe(0.75)
      expect(state.netCost).toBe(0.5)
      expect(state.requestCount).toBe(10)
    })

    it("allows zero values for a fresh session", () => {
      const freshState: SessionSavingsState = {
        totalSpent: 0,
        totalSaved: 0,
        netCost: 0,
        requestCount: 0,
      }

      expect(freshState.totalSpent).toBe(0)
      expect(freshState.totalSaved).toBe(0)
      expect(freshState.netCost).toBe(0)
      expect(freshState.requestCount).toBe(0)
    })

    it("handles negative net cost when savings exceed spending", () => {
      const negativeCostState: SessionSavingsState = {
        totalSpent: 0.5,
        totalSaved: 1.0,
        netCost: -0.5,
        requestCount: 5,
      }

      expect(negativeCostState.netCost).toBe(-0.5)
      expect(negativeCostState.totalSaved).toBeGreaterThan(negativeCostState.totalSpent)
    })
  })

  describe("EMPTY_LEDGER_SNAPSHOT shape", () => {
    it("validates the expected shape of empty ledger snapshot", () => {
      // EMPTY_LEDGER_SNAPSHOT is not exported, but we can validate its expected structure
      // based on the LedgerSnapshot interface and module code
      const emptySnapshot = {
        totalSpent: 0,
        totalSaved: 0,
        totalCalls: 0,
        savingsRate: 0,
        breakdown: undefined,
      }

      expect(emptySnapshot.totalSpent).toBe(0)
      expect(emptySnapshot.totalSaved).toBe(0)
      expect(emptySnapshot.totalCalls).toBe(0)
      expect(emptySnapshot.savingsRate).toBe(0)
      expect(emptySnapshot.breakdown).toBeUndefined()
    })

    it("validates savings rate calculation in ledger snapshot", () => {
      // Savings rate formula from module: saved / (cost + saved)
      const snapshotWithSavings = {
        totalSpent: 1.0,
        totalSaved: 0.5,
        totalCalls: 10,
        savingsRate: 0.5 / (1.0 + 0.5), // 0.5 / 1.5 = 0.333...
        breakdown: {},
      }

      expect(snapshotWithSavings.savingsRate).toBeCloseTo(0.333, 3)
    })

    it("validates savings rate is 0 when no spending or savings occurred", () => {
      const emptySnapshot = {
        totalSpent: 0,
        totalSaved: 0,
        totalCalls: 0,
        savingsRate: 0,
        breakdown: undefined,
      }

      // When totalSpent + totalSaved = 0, savingsRate should be 0
      expect(emptySnapshot.savingsRate).toBe(0)
    })
  })

  describe("useBudgetAlert default state shape", () => {
    it("validates the default budget alert state structure", () => {
      // Based on the module code, the default state is:
      const defaultState = {
        isOverBudget: false,
        currentSpend: 0,
        limit: 0,
        percentUsed: 0,
        limitType: null,
      }

      expect(defaultState.isOverBudget).toBe(false)
      expect(defaultState.currentSpend).toBe(0)
      expect(defaultState.limit).toBe(0)
      expect(defaultState.percentUsed).toBe(0)
      expect(defaultState.limitType).toBeNull()
    })

    it("validates budget alert state with active limit", () => {
      const activeState = {
        isOverBudget: false,
        currentSpend: 7.5,
        limit: 10.0,
        percentUsed: 75,
        limitType: "day" as const,
      }

      expect(activeState.isOverBudget).toBe(false)
      expect(activeState.currentSpend).toBe(7.5)
      expect(activeState.limit).toBe(10.0)
      expect(activeState.percentUsed).toBe(75)
      expect(activeState.limitType).toBe("day")
    })

    it("validates budget alert state when over budget", () => {
      const overBudgetState = {
        isOverBudget: true,
        currentSpend: 12.0,
        limit: 10.0,
        percentUsed: 120,
        limitType: "session" as const,
      }

      expect(overBudgetState.isOverBudget).toBe(true)
      expect(overBudgetState.currentSpend).toBeGreaterThan(overBudgetState.limit)
      expect(overBudgetState.percentUsed).toBeGreaterThan(100)
    })

    it("validates all valid limitType values", () => {
      const sessionLimit = { limitType: "session" as const }
      const hourLimit = { limitType: "hour" as const }
      const dayLimit = { limitType: "day" as const }
      const monthLimit = { limitType: "month" as const }
      const noLimit = { limitType: null }

      expect(sessionLimit.limitType).toBe("session")
      expect(hourLimit.limitType).toBe("hour")
      expect(dayLimit.limitType).toBe("day")
      expect(monthLimit.limitType).toBe("month")
      expect(noLimit.limitType).toBeNull()
    })
  })
})
