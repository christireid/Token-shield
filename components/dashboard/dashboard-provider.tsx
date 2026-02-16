"use client"

import * as React from "react"
import {
  createEmptyState,
  generateSeedData,
  preGenerateTickIds,
  computeNextTick,
  filterDataByTimeRange,
  DEMO_SCENARIOS,
  DEFAULT_MODIFIERS,
  type DemoScenarioId,
  type ScenarioModifiers,
} from "@/lib/demo-data-engine"

/* ------------------------------------------------------------------ */
/*  Shared types                                                       */
/* ------------------------------------------------------------------ */

export interface TimeSeriesPoint {
  timestamp: number
  spent: number
  saved: number
  cumulativeSpent: number
  cumulativeSaved: number
}

export interface DashboardEvent {
  id: number
  timestamp: number
  type:
    | "cache:hit"
    | "cache:miss"
    | "request:blocked"
    | "router:downgraded"
    | "context:trimmed"
    | "prefix:optimized"
    | "ledger:entry"
    | "breaker:warning"
  message: string
  savings?: number
  model?: string
  userId?: string
}

export interface UserBudget {
  userId: string
  displayName: string
  tier: "standard" | "premium" | "unlimited"
  limits: { daily: number; monthly: number }
  spend: { daily: number; monthly: number }
  remaining: { daily: number; monthly: number }
  percentUsed: { daily: number; monthly: number }
  isOverBudget: boolean
}

export interface KpiDelta {
  previousValue: number
  percentChange: number
  direction: "up" | "down" | "flat"
}

export interface AnomalyRecord {
  id: number
  timestamp: number
  type: "cost_spike" | "token_spike" | "cost_rate_change" | "token_rate_change" | "cost_percentile"
  severity: "low" | "medium" | "high"
  metric: string
  value: number
  expected: number
  message: string
  acknowledged: boolean
}

export interface PipelineStageMetric {
  stage: string
  avgDurationMs: number
  totalExecutions: number
  totalSavings: number
  errorCount: number
  lastDurationMs: number
  successRate: number
}

export interface ProviderHealthRecord {
  provider: string
  status: "healthy" | "degraded" | "down"
  latencyMs: number
  errorRate: number
  lastChecked: number
  requestCount: number
  uptimePercent: number
}

export interface DashboardAlert {
  id: number
  timestamp: number
  severity: "info" | "warning" | "critical"
  title: string
  message: string
  source: string
  dismissed: boolean
}

export interface DashboardData {
  totalSpent: number
  totalSaved: number
  savingsRate: number
  cacheHitRate: number
  cacheHitCount: number
  totalRequests: number
  requestsBlocked: number
  avgLatencyMs: number

  sparklines: {
    saved: number[]
    spent: number[]
    savingsRate: number[]
    cacheHitRate: number[]
    blocked: number[]
    latency: number[]
  }

  kpiDeltas: {
    totalSaved: KpiDelta
    totalSpent: KpiDelta
    savingsRate: KpiDelta
    cacheHitRate: KpiDelta
    requestsBlocked: KpiDelta
    avgLatency: KpiDelta
  }

  timeSeries: TimeSeriesPoint[]

  byModule: {
    guard: number
    cache: number
    context: number
    router: number
    prefix: number
  }

  byModel: Record<string, { calls: number; cost: number; tokens: number }>

  events: DashboardEvent[]

  budget: {
    isOverBudget: boolean
    currentSpend: number
    limit: number
    percentUsed: number
    remaining: {
      session: number | null
      hour: number | null
      day: number | null
      month: number | null
    }
    limits: {
      session: number
      hour: number
      day: number
      month: number
    }
  }

  users: UserBudget[]

  anomalies: AnomalyRecord[]

  pipelineMetrics: PipelineStageMetric[]

  providerHealth: ProviderHealthRecord[]

  alerts: DashboardAlert[]
}

export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d"

/* ------------------------------------------------------------------ */
/*  Split contexts: Data (tick-driven), Actions (stable), Settings     */
/* ------------------------------------------------------------------ */

const DashboardDataContext = React.createContext<DashboardData | null>(null)

interface DashboardActions {
  updateUserBudget: (userId: string, updates: Partial<Pick<UserBudget, "limits" | "tier">>) => void
  addUser: (user: Omit<UserBudget, "spend" | "remaining" | "percentUsed" | "isOverBudget">) => void
  removeUser: (userId: string) => void
  resetUserSpend: (userId: string) => void
  dismissAlert: (id: number) => void
  acknowledgeAnomaly: (id: number) => void
}

const DashboardActionsContext = React.createContext<DashboardActions | null>(null)

interface DashboardSettings {
  mode: "demo" | "live"
  setMode: (m: "demo" | "live") => void
  timeRange: TimeRange
  setTimeRange: (t: TimeRange) => void
  isPaused: boolean
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>
  scenario: DemoScenarioId
  setScenario: (s: DemoScenarioId) => void
}

export type { DemoScenarioId }

const DashboardSettingsContext = React.createContext<DashboardSettings | null>(null)

/* ------------------------------------------------------------------ */
/*  Backward-compatible combined context (for existing consumers)      */
/* ------------------------------------------------------------------ */

interface DashboardContextValue {
  data: DashboardData
  mode: "demo" | "live"
  setMode: (m: "demo" | "live") => void
  timeRange: TimeRange
  setTimeRange: (t: TimeRange) => void
  updateUserBudget: (userId: string, updates: Partial<Pick<UserBudget, "limits" | "tier">>) => void
  addUser: (user: Omit<UserBudget, "spend" | "remaining" | "percentUsed" | "isOverBudget">) => void
  removeUser: (userId: string) => void
  resetUserSpend: (userId: string) => void
  dismissAlert: (id: number) => void
  acknowledgeAnomaly: (id: number) => void
  isPaused: boolean
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>
  scenario: DemoScenarioId
  setScenario: (s: DemoScenarioId) => void
}

/* ------------------------------------------------------------------ */
/*  Consumer hooks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Full context (backward compatible) — re-renders on every tick.
 * @deprecated Prefer useDashboardData(), useDashboardActions(), or useDashboardSettings()
 * for fine-grained re-render control.
 */
export function useDashboard(): DashboardContextValue {
  const data = React.useContext(DashboardDataContext)
  const actions = React.useContext(DashboardActionsContext)
  const settings = React.useContext(DashboardSettingsContext)
  if (!data || !actions || !settings) {
    throw new Error("useDashboard must be used within DashboardProvider")
  }
  return { data, ...actions, ...settings }
}

/** Data only — re-renders on every tick */
export function useDashboardData(): DashboardData {
  const data = React.useContext(DashboardDataContext)
  if (!data) throw new Error("useDashboardData must be used within DashboardProvider")
  return data
}

/** Stable actions — never triggers re-renders */
export function useDashboardActions(): DashboardActions {
  const actions = React.useContext(DashboardActionsContext)
  if (!actions) throw new Error("useDashboardActions must be used within DashboardProvider")
  return actions
}

/** Settings — only re-renders on mode/timeRange/pause changes */
export function useDashboardSettings(): DashboardSettings {
  const settings = React.useContext(DashboardSettingsContext)
  if (!settings) throw new Error("useDashboardSettings must be used within DashboardProvider")
  return settings
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<"demo" | "live">("demo")
  const [timeRange, setTimeRange] = React.useState<TimeRange>("24h")
  const [isPaused, setIsPaused] = React.useState(false)
  const [scenario, setScenario] = React.useState<DemoScenarioId>("normal")
  const eventIdRef = React.useRef(0)

  const nextId = React.useCallback(() => ++eventIdRef.current, [])

  const [data, setData] = React.useState<DashboardData>(createEmptyState)

  /* Resolve active scenario modifiers (stable ref — only changes on scenario switch) */
  const modifiers = React.useMemo<ScenarioModifiers>(
    () => DEMO_SCENARIOS[scenario]?.modifiers ?? DEFAULT_MODIFIERS,
    [scenario],
  )

  /* Seed with initial history on first mount */
  React.useEffect(() => {
    if (mode !== "demo" || isPaused) return

    setData((prev) => {
      if (prev.timeSeries.length > 0) return prev
      return generateSeedData(nextId)
    })

    const interval = setInterval(() => {
      const ids = preGenerateTickIds(nextId, modifiers)
      setData((prev) => computeNextTick(prev, ids, modifiers))
    }, 1500)

    return () => clearInterval(interval)
  }, [mode, isPaused, nextId, modifiers])

  /* ---- Filtered view of data based on time range ---- */
  const filteredData = React.useMemo(
    () => filterDataByTimeRange(data, timeRange),
    [data, timeRange],
  )

  /* ---- Action callbacks (stable — empty deps) ---- */

  const updateUserBudget = React.useCallback(
    (userId: string, updates: Partial<Pick<UserBudget, "limits" | "tier">>) => {
      setData((prev) => ({
        ...prev,
        users: prev.users.map((u) => {
          if (u.userId !== userId) return u
          const newLimits = updates.limits ? { ...u.limits, ...updates.limits } : u.limits
          const pctDaily = newLimits.daily > 0 ? (u.spend.daily / newLimits.daily) * 100 : 0
          const pctMonthly = newLimits.monthly > 0 ? (u.spend.monthly / newLimits.monthly) * 100 : 0
          return {
            ...u,
            ...(updates.tier ? { tier: updates.tier } : {}),
            limits: newLimits,
            remaining: {
              daily: Math.max(0, newLimits.daily - u.spend.daily),
              monthly: Math.max(0, newLimits.monthly - u.spend.monthly),
            },
            percentUsed: { daily: pctDaily, monthly: pctMonthly },
            isOverBudget: pctDaily >= 100 || pctMonthly >= 100,
          }
        }),
      }))
    },
    [],
  )

  const addUser = React.useCallback(
    (user: Omit<UserBudget, "spend" | "remaining" | "percentUsed" | "isOverBudget">) => {
      setData((prev) => {
        if (prev.users.some((u) => u.userId === user.userId)) return prev
        return {
          ...prev,
          users: [
            ...prev.users,
            {
              ...user,
              spend: { daily: 0, monthly: 0 },
              remaining: { daily: user.limits.daily, monthly: user.limits.monthly },
              percentUsed: { daily: 0, monthly: 0 },
              isOverBudget: false,
            },
          ],
        }
      })
    },
    [],
  )

  const removeUser = React.useCallback((userId: string) => {
    setData((prev) => ({
      ...prev,
      users: prev.users.filter((u) => u.userId !== userId),
    }))
  }, [])

  const resetUserSpend = React.useCallback((userId: string) => {
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) => {
        if (u.userId !== userId) return u
        return {
          ...u,
          spend: { daily: 0, monthly: 0 },
          remaining: { daily: u.limits.daily, monthly: u.limits.monthly },
          percentUsed: { daily: 0, monthly: 0 },
          isOverBudget: false,
        }
      }),
    }))
  }, [])

  const dismissAlert = React.useCallback((id: number) => {
    setData((prev) => ({
      ...prev,
      alerts: prev.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    }))
  }, [])

  const acknowledgeAnomaly = React.useCallback((id: number) => {
    setData((prev) => ({
      ...prev,
      anomalies: prev.anomalies.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    }))
  }, [])

  /* ---- Memoized context values ---- */

  const actionsValue = React.useMemo<DashboardActions>(
    () => ({
      updateUserBudget,
      addUser,
      removeUser,
      resetUserSpend,
      dismissAlert,
      acknowledgeAnomaly,
    }),
    [updateUserBudget, addUser, removeUser, resetUserSpend, dismissAlert, acknowledgeAnomaly],
  )

  const settingsValue = React.useMemo<DashboardSettings>(
    () => ({
      mode,
      setMode,
      timeRange,
      setTimeRange,
      isPaused,
      setIsPaused,
      scenario,
      setScenario,
    }),
    [mode, timeRange, isPaused, scenario],
  )

  return (
    <DashboardSettingsContext.Provider value={settingsValue}>
      <DashboardActionsContext.Provider value={actionsValue}>
        <DashboardDataContext.Provider value={filteredData}>
          {children}
        </DashboardDataContext.Provider>
      </DashboardActionsContext.Provider>
    </DashboardSettingsContext.Provider>
  )
}
