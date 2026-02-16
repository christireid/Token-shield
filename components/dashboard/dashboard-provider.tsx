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

export interface DashboardProviderProps {
  children: React.ReactNode
  /**
   * Optional middleware instance for live mode. When provided and mode is "live",
   * the dashboard subscribes to real-time events from the middleware's event bus
   * instead of generating demo data.
   *
   * Usage:
   * ```tsx
   * const shield = tokenShieldMiddleware({ ... })
   * <DashboardProvider middleware={shield}>
   *   <DashboardShell />
   * </DashboardProvider>
   * ```
   */
  middleware?: {
    events: import("@/lib/tokenshield/event-bus").EventBus
    ledger?: { getSummary(): { totalSpent: number; totalSaved: number } } | null
    cache?: { stats(): { hitRate: number; hits: number; misses: number } } | null
    healthCheck?: () => { healthy: boolean; breakerTripped: boolean | null }
  }
}

export function DashboardProvider({ children, middleware }: DashboardProviderProps) {
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

  /* ---- Live mode: subscribe to real middleware events ---- */
  React.useEffect(() => {
    if (mode !== "live" || !middleware) return

    const bus = middleware.events
    const cleanups: Array<() => void> = []

    const sub = <K extends keyof import("@/lib/tokenshield/event-bus").TokenShieldEvents>(
      event: K,
      handler: (data: import("@/lib/tokenshield/event-bus").TokenShieldEvents[K]) => void,
    ) => {
      bus.on(event, handler)
      cleanups.push(() => bus.off(event, handler))
    }

    sub("ledger:entry", (d) => {
      const now = Date.now()
      setData((prev) => {
        const newPoint = {
          timestamp: now,
          spent: d.cost,
          saved: d.saved,
          cumulativeSpent: prev.totalSpent + d.cost,
          cumulativeSaved: prev.totalSaved + d.saved,
        }
        return {
          ...prev,
          totalSpent: prev.totalSpent + d.cost,
          totalSaved: prev.totalSaved + d.saved,
          totalRequests: prev.totalRequests + 1,
          savingsRate:
            prev.totalSpent + d.cost > 0
              ? ((prev.totalSaved + d.saved) /
                  (prev.totalSpent + d.cost + prev.totalSaved + d.saved)) *
                100
              : 0,
          timeSeries: [...prev.timeSeries, newPoint],
          byModel: {
            ...prev.byModel,
            [d.model]: {
              calls: (prev.byModel[d.model]?.calls ?? 0) + 1,
              cost: (prev.byModel[d.model]?.cost ?? 0) + d.cost,
              tokens: (prev.byModel[d.model]?.tokens ?? 0) + d.inputTokens + d.outputTokens,
            },
          },
          events: [
            ...prev.events,
            {
              id: nextId(),
              timestamp: now,
              type: "ledger:entry" as const,
              message: `${d.model}: ${d.inputTokens}→${d.outputTokens} tokens ($${d.cost.toFixed(4)})`,
              savings: d.saved,
              model: d.model,
            },
          ],
        }
      })
    })

    sub("cache:hit", (d) => {
      setData((prev) => ({
        ...prev,
        cacheHitCount: prev.cacheHitCount + 1,
        cacheHitRate: (prev.cacheHitCount + 1) / Math.max(1, prev.totalRequests),
        events: [
          ...prev.events,
          {
            id: nextId(),
            timestamp: Date.now(),
            type: "cache:hit" as const,
            message: `Cache hit (${d.matchType}, ${(d.similarity * 100).toFixed(0)}% similarity)`,
            savings: d.savedCost,
          },
        ],
      }))
    })

    sub("request:blocked", (d) => {
      setData((prev) => ({
        ...prev,
        requestsBlocked: prev.requestsBlocked + 1,
        events: [
          ...prev.events,
          {
            id: nextId(),
            timestamp: Date.now(),
            type: "request:blocked" as const,
            message: `Blocked: ${d.reason}`,
          },
        ],
      }))
    })

    sub("router:downgraded", (d) => {
      setData((prev) => ({
        ...prev,
        events: [
          ...prev.events,
          {
            id: nextId(),
            timestamp: Date.now(),
            type: "router:downgraded" as const,
            message: `Routed ${d.originalModel} → ${d.selectedModel}`,
            savings: d.savedCost,
            model: d.selectedModel,
          },
        ],
      }))
    })

    sub("context:trimmed", (d) => {
      setData((prev) => ({
        ...prev,
        byModule: {
          ...prev.byModule,
          context: prev.byModule.context + d.savedTokens * 0.000003,
        },
        events: [
          ...prev.events,
          {
            id: nextId(),
            timestamp: Date.now(),
            type: "context:trimmed" as const,
            message: `Trimmed ${d.savedTokens} tokens (${d.originalTokens}→${d.trimmedTokens})`,
          },
        ],
      }))
    })

    sub("breaker:warning", (d) => {
      setData((prev) => ({
        ...prev,
        budget: {
          ...prev.budget,
          currentSpend: d.currentSpend,
          percentUsed: d.percentUsed,
        },
        events: [
          ...prev.events,
          {
            id: nextId(),
            timestamp: Date.now(),
            type: "breaker:warning" as const,
            message: `${d.limitType} at ${d.percentUsed.toFixed(0)}% ($${d.currentSpend.toFixed(2)}/$${d.limit.toFixed(2)})`,
          },
        ],
      }))
    })

    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [mode, middleware, nextId])

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
