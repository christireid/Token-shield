"use client"

/**
 * TokenShield React Hooks - Budget & Cost Tracking
 *
 * Hooks for cost ledger subscriptions, circuit breaker budget alerts,
 * per-user budget tracking, and session savings accumulation.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react"
import { CostCircuitBreaker } from "./circuit-breaker"
import { UserBudgetManager, type UserBudgetStatus } from "./user-budget-manager"
import { useTokenShield } from "./react-context"

// -------------------------------------------------------
// Cost Ledger Hook
// -------------------------------------------------------

interface LedgerSnapshot {
  totalSpent: number
  totalSaved: number
  totalCalls: number
  savingsRate: number
  breakdown: unknown
}

const EMPTY_LEDGER_SNAPSHOT: LedgerSnapshot = {
  totalSpent: 0,
  totalSaved: 0,
  totalCalls: 0,
  savingsRate: 0,
  breakdown: undefined,
}

function getServerSnapshot(): LedgerSnapshot {
  return EMPTY_LEDGER_SNAPSHOT
}

/**
 * Subscribe to the CostLedger summary. Requires that TokenShieldProvider
 * was initialized with a ledgerConfig. Returns overall spending and
 * savings statistics, or, if a featureName is provided, a breakdown for
 * that specific feature.
 *
 * Uses a version-based cache so that getSnapshot returns a referentially
 * stable object when the underlying data hasn't changed.
 */
export function useCostLedger(featureName?: string) {
  const { ledger } = useTokenShield()
  if (!ledger) {
    throw new Error(
      "useCostLedger requires TokenShieldProvider with ledgerConfig; no ledger is available"
    )
  }

  const versionRef = useRef(0)
  const cacheRef = useRef<{ version: number; snapshot: LedgerSnapshot }>({
    version: -1,
    snapshot: EMPTY_LEDGER_SNAPSHOT,
  })

  const subscribe = useCallback(
    (listener: () => void) =>
      ledger.subscribe(() => {
        versionRef.current++
        listener()
      }),
    [ledger]
  )

  const getSnapshot = useCallback((): LedgerSnapshot => {
    if (cacheRef.current.version === versionRef.current) {
      return cacheRef.current.snapshot
    }
    const summary = ledger.getSummary()
    let snapshot: LedgerSnapshot

    if (featureName) {
      const data = summary.byFeature[featureName]
      snapshot = {
        totalSpent: data?.cost ?? 0,
        totalSaved: data?.saved ?? 0,
        totalCalls: data?.calls ?? 0,
        savingsRate:
          data && data.cost + data.saved > 0
            ? data.saved / (data.cost + data.saved)
            : 0,
        breakdown: data,
      }
    } else {
      snapshot = {
        totalSpent: summary.totalSpent,
        totalSaved: summary.totalSaved,
        totalCalls: summary.totalCalls,
        savingsRate:
          summary.totalSpent + summary.totalSaved > 0
            ? summary.totalSaved /
              (summary.totalSpent + summary.totalSaved)
            : 0,
        breakdown: summary.byFeature,
      }
    }

    cacheRef.current = { version: versionRef.current, snapshot }
    return snapshot
  }, [ledger, featureName])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Alias for useCostLedger that emphasizes per-feature cost tracking.
 */
export function useFeatureCost(featureName: string) {
  return useCostLedger(featureName)
}

// -------------------------------------------------------
// Circuit Breaker Budget Alert
// -------------------------------------------------------

/**
 * Subscribe to circuit breaker events for budget warnings.
 * Polls the breaker's status every 2 seconds and returns
 * derived budget alert values.
 */
export function useBudgetAlert(breaker?: CostCircuitBreaker): {
  isOverBudget: boolean
  currentSpend: number
  limit: number
  percentUsed: number
  limitType: string | null
} {
  const [budgetState, setBudgetState] = useState<{
    isOverBudget: boolean
    currentSpend: number
    limit: number
    percentUsed: number
    limitType: string | null
  }>({
    isOverBudget: false,
    currentSpend: 0,
    limit: 0,
    percentUsed: 0,
    limitType: null,
  })

  useEffect(() => {
    if (!breaker) return

    function poll() {
      const status = breaker!.getStatus()

      if (status.trippedLimits.length > 0) {
        const worst = status.trippedLimits.reduce((a, b) =>
          a.percentUsed >= b.percentUsed ? a : b
        )
        setBudgetState({
          isOverBudget: status.tripped,
          currentSpend: worst.currentSpend,
          limit: worst.limit,
          percentUsed: worst.percentUsed,
          limitType: worst.limitType,
        })
      } else {
        const spend = status.spend
        const remaining = status.remaining

        let highestPercent = 0
        let highestSpend = 0
        let highestLimit = 0
        let highestType: string | null = null

        if (remaining.session !== null) {
          const limit = spend.session + remaining.session
          const pct = limit > 0 ? (spend.session / limit) * 100 : 0
          if (pct > highestPercent) {
            highestPercent = pct
            highestSpend = spend.session
            highestLimit = limit
            highestType = "session"
          }
        }
        if (remaining.hour !== null) {
          const limit = spend.lastHour + remaining.hour
          const pct = limit > 0 ? (spend.lastHour / limit) * 100 : 0
          if (pct > highestPercent) {
            highestPercent = pct
            highestSpend = spend.lastHour
            highestLimit = limit
            highestType = "hour"
          }
        }
        if (remaining.day !== null) {
          const limit = spend.lastDay + remaining.day
          const pct = limit > 0 ? (spend.lastDay / limit) * 100 : 0
          if (pct > highestPercent) {
            highestPercent = pct
            highestSpend = spend.lastDay
            highestLimit = limit
            highestType = "day"
          }
        }
        if (remaining.month !== null) {
          const limit = spend.lastMonth + remaining.month
          const pct = limit > 0 ? (spend.lastMonth / limit) * 100 : 0
          if (pct > highestPercent) {
            highestPercent = pct
            highestSpend = spend.lastMonth
            highestLimit = limit
            highestType = "month"
          }
        }

        setBudgetState({
          isOverBudget: false,
          currentSpend: highestSpend,
          limit: highestLimit,
          percentUsed: highestPercent,
          limitType: highestType,
        })
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [breaker])

  return budgetState
}

// -------------------------------------------------------
// Per-User Budget Hook
// -------------------------------------------------------

/**
 * Track per-user budget status in real time.
 * Subscribes to a UserBudgetManager instance and returns the current
 * budget state for the given userId.
 */
export function useUserBudget(
  manager: UserBudgetManager,
  userId: string
): UserBudgetStatus {
  const getSnapshot = useCallback(
    () => manager.getStatus(userId),
    [manager, userId]
  )

  const subscribe = useCallback(
    (listener: () => void) => manager.subscribe(listener),
    [manager]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// -------------------------------------------------------
// Session Savings Hook
// -------------------------------------------------------

export interface SessionSavingsState {
  /** Cumulative dollars spent this session */
  totalSpent: number
  /** Cumulative dollars saved this session */
  totalSaved: number
  /** Net cost (totalSpent - totalSaved) */
  netCost: number
  /** Number of requests recorded */
  requestCount: number
}

/**
 * Track real-time running dollar totals for the current session.
 * Subscribes to ledger:entry events on the per-instance event bus
 * and accumulates spend/savings as they arrive.
 */
export function useSessionSavings(): SessionSavingsState {
  const { eventBus } = useTokenShield()
  const [state, setState] = useState<SessionSavingsState>({
    totalSpent: 0,
    totalSaved: 0,
    netCost: 0,
    requestCount: 0,
  })

  useEffect(() => {
    const handler = (data: { cost: number; saved: number }) => {
      setState((prev) => ({
        totalSpent: prev.totalSpent + data.cost,
        totalSaved: prev.totalSaved + data.saved,
        netCost: prev.netCost + data.cost - data.saved,
        requestCount: prev.requestCount + 1,
      }))
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventBus.on("ledger:entry", handler as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => eventBus.off("ledger:entry", handler as any)
  }, [eventBus])

  return state
}
