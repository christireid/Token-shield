"use client"

import * as React from "react"

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

export interface DashboardData {
  totalSpent: number
  totalSaved: number
  savingsRate: number
  cacheHitRate: number
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
  }

  users: UserBudget[]
}

export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d"

interface DashboardContextValue {
  data: DashboardData
  mode: "demo" | "live"
  setMode: (m: "demo" | "live") => void
  timeRange: TimeRange
  setTimeRange: (t: TimeRange) => void
  updateUserBudget: (
    userId: string,
    updates: Partial<Pick<UserBudget, "limits" | "tier">>
  ) => void
  addUser: (user: Omit<UserBudget, "spend" | "remaining" | "percentUsed" | "isOverBudget">) => void
  removeUser: (userId: string) => void
  resetUserSpend: (userId: string) => void
  isPaused: boolean
  setIsPaused: (p: boolean) => void
}

const DashboardContext = React.createContext<DashboardContextValue | null>(null)

export function useDashboard() {
  const ctx = React.useContext(DashboardContext)
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}

/* ------------------------------------------------------------------ */
/*  Demo data helpers                                                  */
/* ------------------------------------------------------------------ */

const MODELS = [
  { id: "gpt-4o", weight: 0.35, costPer1k: 0.005 },
  { id: "claude-sonnet-4", weight: 0.25, costPer1k: 0.003 },
  { id: "gemini-2.5-flash", weight: 0.2, costPer1k: 0.00035 },
  { id: "gpt-4o-mini", weight: 0.15, costPer1k: 0.00015 },
  { id: "claude-haiku-3.5", weight: 0.05, costPer1k: 0.0008 },
]

const MODULE_KEYS = ["guard", "cache", "context", "router", "prefix"] as const

const EVENT_TYPES: DashboardEvent["type"][] = [
  "cache:hit",
  "cache:miss",
  "request:blocked",
  "router:downgraded",
  "context:trimmed",
  "prefix:optimized",
  "ledger:entry",
  "breaker:warning",
]

const INITIAL_USERS: UserBudget[] = [
  {
    userId: "usr_alice",
    displayName: "Alice Chen",
    tier: "premium",
    limits: { daily: 25, monthly: 500 },
    spend: { daily: 0, monthly: 0 },
    remaining: { daily: 25, monthly: 500 },
    percentUsed: { daily: 0, monthly: 0 },
    isOverBudget: false,
  },
  {
    userId: "usr_bob",
    displayName: "Bob Martinez",
    tier: "standard",
    limits: { daily: 10, monthly: 200 },
    spend: { daily: 0, monthly: 0 },
    remaining: { daily: 10, monthly: 200 },
    percentUsed: { daily: 0, monthly: 0 },
    isOverBudget: false,
  },
  {
    userId: "usr_carol",
    displayName: "Carol Nguyen",
    tier: "unlimited",
    limits: { daily: 100, monthly: 2000 },
    spend: { daily: 0, monthly: 0 },
    remaining: { daily: 100, monthly: 2000 },
    percentUsed: { daily: 0, monthly: 0 },
    isOverBudget: false,
  },
  {
    userId: "usr_dave",
    displayName: "Dave Patel",
    tier: "standard",
    limits: { daily: 8, monthly: 150 },
    spend: { daily: 0, monthly: 0 },
    remaining: { daily: 8, monthly: 150 },
    percentUsed: { daily: 0, monthly: 0 },
    isOverBudget: false,
  },
]

function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const r = Math.random()
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (r <= acc) return item
  }
  return items[items.length - 1]
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function randInt(min: number, max: number) {
  return Math.floor(rand(min, max))
}

function generateEventMessage(type: DashboardEvent["type"], model: string, savings: number): string {
  switch (type) {
    case "cache:hit":
      return `Cache hit for ${model} — saved $${savings.toFixed(4)}`
    case "cache:miss":
      return `Cache miss for ${model} — full request sent`
    case "request:blocked":
      return `Request blocked by guard — duplicate detected`
    case "router:downgraded":
      return `Routed from ${model} to cheaper model — saved $${savings.toFixed(4)}`
    case "context:trimmed":
      return `Context trimmed ${randInt(15, 45)}% for ${model} — saved $${savings.toFixed(4)}`
    case "prefix:optimized":
      return `Prefix cache hit for ${model} — saved $${savings.toFixed(4)}`
    case "ledger:entry":
      return `Completed ${model} request — $${(savings * 0.3).toFixed(4)} spent`
    case "breaker:warning":
      return `Budget threshold reached ${randInt(75, 95)}% — hourly limit`
  }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<"demo" | "live">("demo")
  const [timeRange, setTimeRange] = React.useState<TimeRange>("24h")
  const [isPaused, setIsPaused] = React.useState(false)
  const [data, setData] = React.useState<DashboardData>(() => ({
    totalSpent: 0,
    totalSaved: 0,
    savingsRate: 0,
    cacheHitRate: 0,
    totalRequests: 0,
    requestsBlocked: 0,
    avgLatencyMs: 0,
    sparklines: { saved: [], spent: [], savingsRate: [], cacheHitRate: [], blocked: [], latency: [] },
    timeSeries: [],
    byModule: { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 },
    byModel: {},
    events: [],
    budget: {
      isOverBudget: false,
      currentSpend: 0,
      limit: 50,
      percentUsed: 0,
      remaining: { session: 50, hour: 10, day: 50, month: 500 },
    },
    users: INITIAL_USERS.map((u) => ({ ...u })),
  }))
  const eventIdRef = React.useRef(0)

  React.useEffect(() => {
    if (mode !== "demo" || isPaused) return

    /* Seed with initial history on first mount */
    setData((prev) => {
      if (prev.timeSeries.length > 0) return prev
      const now = Date.now()
      const points: TimeSeriesPoint[] = []
      let cumSpent = 0
      let cumSaved = 0
      const modules = { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 }
      const models: DashboardData["byModel"] = {}
      const events: DashboardEvent[] = []
      const users = INITIAL_USERS.map((u) => ({ ...u }))

      for (let i = 60; i >= 1; i--) {
        const ts = now - i * 60_000
        const model = pickWeighted(MODELS)
        const tokens = randInt(200, 4000)
        const baseCost = (tokens / 1000) * model.costPer1k
        const savingsPercent = rand(0.25, 0.65)
        const saved = baseCost * savingsPercent
        const spent = baseCost - saved

        cumSpent += spent
        cumSaved += saved

        const moduleKey = MODULE_KEYS[randInt(0, MODULE_KEYS.length)]
        modules[moduleKey] += saved

        if (!models[model.id]) models[model.id] = { calls: 0, cost: 0, tokens: 0 }
        models[model.id].calls += 1
        models[model.id].cost += spent
        models[model.id].tokens += tokens

        const user = users[randInt(0, users.length)]
        user.spend.daily += spent
        user.spend.monthly += spent

        const evType = EVENT_TYPES[randInt(0, EVENT_TYPES.length)]
        eventIdRef.current++
        events.push({
          id: eventIdRef.current,
          timestamp: ts,
          type: evType,
          message: generateEventMessage(evType, model.id, saved),
          savings: saved,
          model: model.id,
          userId: user.userId,
        })

        points.push({ timestamp: ts, spent, saved, cumulativeSpent: cumSpent, cumulativeSaved: cumSaved })
      }

      const totalReqs = 60
      const blocked = Math.round(totalReqs * rand(0.03, 0.08))
      const cacheHits = Math.round(totalReqs * rand(0.25, 0.45))

      const updatedUsers = users.map((u) => {
        const pctDaily = u.limits.daily > 0 ? (u.spend.daily / u.limits.daily) * 100 : 0
        const pctMonthly = u.limits.monthly > 0 ? (u.spend.monthly / u.limits.monthly) * 100 : 0
        return {
          ...u,
          remaining: {
            daily: Math.max(0, u.limits.daily - u.spend.daily),
            monthly: Math.max(0, u.limits.monthly - u.spend.monthly),
          },
          percentUsed: { daily: pctDaily, monthly: pctMonthly },
          isOverBudget: pctDaily >= 100 || pctMonthly >= 100,
        }
      })

      return {
        totalSpent: cumSpent,
        totalSaved: cumSaved,
        savingsRate: (cumSaved / (cumSpent + cumSaved)) * 100,
        cacheHitRate: (cacheHits / totalReqs) * 100,
        totalRequests: totalReqs,
        requestsBlocked: blocked,
        avgLatencyMs: rand(120, 350),
        sparklines: {
          saved: points.slice(-20).map((p) => p.saved),
          spent: points.slice(-20).map((p) => p.spent),
          savingsRate: points.slice(-20).map(() => rand(30, 55)),
          cacheHitRate: points.slice(-20).map(() => rand(25, 50)),
          blocked: points.slice(-20).map(() => randInt(0, 3)),
          latency: points.slice(-20).map(() => rand(100, 400)),
        },
        timeSeries: points,
        byModule: modules,
        byModel: models,
        events: events.slice(-50),
        budget: {
          isOverBudget: false,
          currentSpend: cumSpent,
          limit: 50,
          percentUsed: (cumSpent / 50) * 100,
          remaining: {
            session: Math.max(0, 50 - cumSpent),
            hour: Math.max(0, 10 - cumSpent * 0.15),
            day: Math.max(0, 50 - cumSpent),
            month: Math.max(0, 500 - cumSpent),
          },
        },
        users: updatedUsers,
      }
    })

    const interval = setInterval(() => {
      setData((prev) => {
        const now = Date.now()
        const model = pickWeighted(MODELS)
        const tokens = randInt(200, 4000)
        const baseCost = (tokens / 1000) * model.costPer1k
        const savingsPercent = rand(0.25, 0.65)
        const saved = baseCost * savingsPercent
        const spent = baseCost - saved

        const newCumSpent = prev.totalSpent + spent
        const newCumSaved = prev.totalSaved + saved
        const totalReqs = prev.totalRequests + 1
        const isBlocked = Math.random() < 0.05
        const newBlocked = prev.requestsBlocked + (isBlocked ? 1 : 0)
        const isCacheHit = Math.random() < 0.38

        const moduleKey = MODULE_KEYS[randInt(0, MODULE_KEYS.length)]
        const newModules = { ...prev.byModule }
        newModules[moduleKey] += saved

        const newModels = { ...prev.byModel }
        if (!newModels[model.id]) newModels[model.id] = { calls: 0, cost: 0, tokens: 0 }
        newModels[model.id] = {
          calls: newModels[model.id].calls + 1,
          cost: newModels[model.id].cost + spent,
          tokens: newModels[model.id].tokens + tokens,
        }

        const userIdx = randInt(0, prev.users.length)
        const newUsers = prev.users.map((u, i) => {
          if (i !== userIdx) return u
          const newDaily = u.spend.daily + spent
          const newMonthly = u.spend.monthly + spent
          const pctDaily = u.limits.daily > 0 ? (newDaily / u.limits.daily) * 100 : 0
          const pctMonthly = u.limits.monthly > 0 ? (newMonthly / u.limits.monthly) * 100 : 0
          return {
            ...u,
            spend: { daily: newDaily, monthly: newMonthly },
            remaining: {
              daily: Math.max(0, u.limits.daily - newDaily),
              monthly: Math.max(0, u.limits.monthly - newMonthly),
            },
            percentUsed: { daily: pctDaily, monthly: pctMonthly },
            isOverBudget: pctDaily >= 100 || pctMonthly >= 100,
          }
        })

        const evType = isBlocked
          ? ("request:blocked" as const)
          : isCacheHit
            ? ("cache:hit" as const)
            : EVENT_TYPES[randInt(0, EVENT_TYPES.length)]
        eventIdRef.current++
        const newEvent: DashboardEvent = {
          id: eventIdRef.current,
          timestamp: now,
          type: evType,
          message: generateEventMessage(evType, model.id, saved),
          savings: saved,
          model: model.id,
          userId: newUsers[userIdx]?.userId,
        }

        const newTimeSeries = [
          ...prev.timeSeries,
          { timestamp: now, spent, saved, cumulativeSpent: newCumSpent, cumulativeSaved: newCumSaved },
        ].slice(-200)

        const cacheHits = (prev.cacheHitRate * prev.totalRequests) / 100 + (isCacheHit ? 1 : 0)
        const newCacheRate = (cacheHits / totalReqs) * 100
        const newSavingsRate = (newCumSaved / (newCumSpent + newCumSaved)) * 100
        const newLatency = prev.avgLatencyMs * 0.95 + rand(100, 400) * 0.05

        const pushSparkline = (arr: number[], val: number) => [...arr.slice(-19), val]

        return {
          totalSpent: newCumSpent,
          totalSaved: newCumSaved,
          savingsRate: newSavingsRate,
          cacheHitRate: newCacheRate,
          totalRequests: totalReqs,
          requestsBlocked: newBlocked,
          avgLatencyMs: newLatency,
          sparklines: {
            saved: pushSparkline(prev.sparklines.saved, saved),
            spent: pushSparkline(prev.sparklines.spent, spent),
            savingsRate: pushSparkline(prev.sparklines.savingsRate, newSavingsRate),
            cacheHitRate: pushSparkline(prev.sparklines.cacheHitRate, newCacheRate),
            blocked: pushSparkline(prev.sparklines.blocked, isBlocked ? 1 : 0),
            latency: pushSparkline(prev.sparklines.latency, newLatency),
          },
          timeSeries: newTimeSeries,
          byModule: newModules,
          byModel: newModels,
          events: [...prev.events, newEvent].slice(-50),
          budget: {
            isOverBudget: newCumSpent >= 50,
            currentSpend: newCumSpent,
            limit: 50,
            percentUsed: (newCumSpent / 50) * 100,
            remaining: {
              session: Math.max(0, 50 - newCumSpent),
              hour: Math.max(0, 10 - newCumSpent * 0.15),
              day: Math.max(0, 50 - newCumSpent),
              month: Math.max(0, 500 - newCumSpent),
            },
          },
          users: newUsers,
        }
      })
    }, 1500)

    return () => clearInterval(interval)
  }, [mode, isPaused])

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
    []
  )

  const addUser = React.useCallback(
    (user: Omit<UserBudget, "spend" | "remaining" | "percentUsed" | "isOverBudget">) => {
      setData((prev) => ({
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
      }))
    },
    []
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

  return (
    <DashboardContext.Provider
      value={{
        data,
        mode,
        setMode,
        timeRange,
        setTimeRange,
        updateUserBudget,
        addUser,
        removeUser,
        resetUserSpend,
        isPaused,
        setIsPaused,
      }}
    >
      {children}
    </DashboardContext.Provider>
  )
}
