"use client"

/**
 * TokenShield React Integration
 *
 * Hooks and context provider that wire the SDK into React/Next.js apps.
 * Tracks cumulative savings across the session and exposes
 * real-time cost data to any component.
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useMemo,
  useState,
  useEffect,
  useSyncExternalStore,
} from "react"
import { countExactTokens, type ChatMessage } from "./token-counter"
import { estimateCost, calculateSavings, type ModelPricing } from "./cost-estimator"
import { smartFit, type Message, type ContextBudget } from "./context-manager"
import { ResponseCache } from "./response-cache"
import { CostLedger } from "./cost-ledger"
import { routeToModel, type RoutingDecision } from "./model-router"
import { RequestGuard, type GuardConfig, type GuardResult } from "./request-guard"
import { CostCircuitBreaker } from "./circuit-breaker"
import { UserBudgetManager, type UserBudgetStatus } from "./user-budget-manager"
import { shieldEvents, type TokenShieldEvents } from "./event-bus"
import type { ProviderAdapter, ProviderHealth } from "./provider-adapter"

// ---------------------
// Session savings store
// ---------------------
interface SavingsEvent {
  timestamp: number
  type: "cache_hit" | "context_trim" | "model_downgrade" | "request_blocked"
  tokensSaved: number
  dollarsSaved: number
  details: string
}

interface SavingsState {
  events: SavingsEvent[]
  totalTokensSaved: number
  totalDollarsSaved: number
  totalRequestsMade: number
  totalRequestsBlocked: number
  totalCacheHits: number
}

function createSavingsStore() {
  let state: SavingsState = {
    events: [],
    totalTokensSaved: 0,
    totalDollarsSaved: 0,
    totalRequestsMade: 0,
    totalRequestsBlocked: 0,
    totalCacheHits: 0,
  }
  const listeners = new Set<() => void>()

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addEvent: (event: SavingsEvent) => {
      const MAX_EVENTS = 500
      const newEvents = [...state.events, event]
      state = {
        ...state,
        events: newEvents.length > MAX_EVENTS ? newEvents.slice(-MAX_EVENTS) : newEvents,
        totalTokensSaved: state.totalTokensSaved + event.tokensSaved,
        totalDollarsSaved: state.totalDollarsSaved + event.dollarsSaved,
        totalCacheHits:
          state.totalCacheHits + (event.type === "cache_hit" ? 1 : 0),
        totalRequestsBlocked:
          state.totalRequestsBlocked +
          (event.type === "request_blocked" ? 1 : 0),
      }
      for (const l of listeners) l()
    },
    incrementRequests: () => {
      state = { ...state, totalRequestsMade: state.totalRequestsMade + 1 }
      for (const l of listeners) l()
    },
    reset: () => {
      state = {
        events: [],
        totalTokensSaved: 0,
        totalDollarsSaved: 0,
        totalRequestsMade: 0,
        totalRequestsBlocked: 0,
        totalCacheHits: 0,
      }
      for (const l of listeners) l()
    },
  }
}

// ---------------------
// Context
// ---------------------
interface TokenShieldContextValue {
  cache: ResponseCache
  guard: RequestGuard
  savingsStore: ReturnType<typeof createSavingsStore>
  defaultModelId: string
  /** Global CostLedger instance. Optional: only present when ledgerConfig is provided */
  ledger?: CostLedger
}

const TokenShieldContext = createContext<TokenShieldContextValue | null>(null)

export interface TokenShieldProviderProps {
  children: React.ReactNode
  defaultModelId?: string
  guardConfig?: Partial<GuardConfig>
  cacheConfig?: {
    maxEntries?: number
    ttlMs?: number
    similarityThreshold?: number
  }

  /**
   * Optional ledger configuration. When provided, TokenShieldProvider will
   * instantiate a CostLedger and make it available via useCostLedger().
   */
  ledgerConfig?: {
    /** Persist ledger entries to IndexedDB across sessions */
    persist?: boolean
    /** Optional default feature tag applied to all ledger entries */
    feature?: string
  }
}

/**
 * Provider that initializes the SDK and makes it available to all hooks.
 * Wrap your app (or the part that uses AI) with this.
 */
export function TokenShieldProvider({
  children,
  defaultModelId = "gpt-4o-mini",
  guardConfig,
  cacheConfig,
  ledgerConfig,
}: TokenShieldProviderProps) {
  const cacheRef = useRef<ResponseCache | null>(null)
  const guardRef = useRef<RequestGuard | null>(null)
  const storeRef = useRef<ReturnType<typeof createSavingsStore> | null>(null)
  const ledgerRef = useRef<CostLedger | null>(null)

  if (!cacheRef.current) {
    cacheRef.current = new ResponseCache(cacheConfig)
  }
  if (!guardRef.current) {
    guardRef.current = new RequestGuard({
      ...guardConfig,
      modelId: defaultModelId,
    })
  }
  if (!storeRef.current) {
    storeRef.current = createSavingsStore()
  }
  if (!ledgerRef.current && ledgerConfig !== undefined) {
    ledgerRef.current = new CostLedger({ persist: ledgerConfig.persist })
  }

  const value = useMemo(
    () => ({
      cache: cacheRef.current!,
      guard: guardRef.current!,
      savingsStore: storeRef.current!,
      defaultModelId,
      ledger: ledgerRef.current ?? undefined,
    }),
    [defaultModelId]
  )

  return (
    <TokenShieldContext.Provider value={value}>
      {children}
    </TokenShieldContext.Provider>
  )
}

function useTokenShield() {
  const ctx = useContext(TokenShieldContext)
  if (!ctx) {
    throw new Error("useTokenShield hooks must be used within <TokenShieldProvider>")
  }
  return ctx
}

// ---------------------
// Hooks
// ---------------------

/**
 * Track cumulative savings across the session.
 * Reactively updates when any savings event occurs.
 */
export function useSavings() {
  const { savingsStore } = useTokenShield()
  return useSyncExternalStore(
    savingsStore.subscribe,
    savingsStore.getState,
    savingsStore.getState
  )
}

/**
 * Count tokens in real-time as the user types.
 * Returns exact BPE token count and estimated cost.
 */
export function useTokenCount(text: string, modelId?: string) {
  const { defaultModelId } = useTokenShield()
  const model = modelId ?? defaultModelId

  return useMemo(() => {
    if (!text || text.length === 0) {
      return { tokens: 0, cost: 0, characters: 0, ratio: 0 }
    }
    const count = countExactTokens(text)
    const cost = estimateCost(model, count.tokens, 0)
    return {
      tokens: count.tokens,
      cost: cost.inputCost,
      characters: count.characters,
      ratio: count.ratio,
    }
  }, [text, model])
}

/**
 * Analyze prompt complexity and get a routing recommendation.
 */
export function useComplexityAnalysis(prompt: string, defaultModel?: string) {
  const { defaultModelId } = useTokenShield()
  const model = defaultModel ?? defaultModelId

  return useMemo(() => {
    if (!prompt || prompt.length === 0) {
      return null
    }
    return routeToModel(prompt, model)
  }, [prompt, model])
}

/**
 * Manage conversation context within a token budget.
 * Returns the trimmed messages and savings data.
 */
export function useContextManager(
  messages: Message[],
  budget: ContextBudget
) {
  const { defaultModelId } = useTokenShield()

  return useMemo(() => {
    const result = smartFit(messages, budget)

    if (result.evictedTokens > 0) {
      const savings = calculateSavings(
        defaultModelId,
        result.totalTokens + result.evictedTokens,
        result.totalTokens,
        budget.reservedForOutput
      )
      // We don't fire events in useMemo (side effects)
      // Instead, return the data and let the consumer decide
      return {
        ...result,
        savings: {
          tokensSaved: result.evictedTokens,
          dollarsSaved: savings.savedDollars,
          percentSaved: savings.savedPercent,
        },
      }
    }

    return { ...result, savings: null }
  }, [messages, budget, defaultModelId])
}

/**
 * Check the response cache before making an API call.
 * Returns a function that wraps your API call with caching.
 */
export function useResponseCache() {
  const { cache, savingsStore, defaultModelId } = useTokenShield()

  const cachedFetch = useCallback(
    async (
      prompt: string,
      apiFn: (prompt: string) => Promise<{ response: string; inputTokens: number; outputTokens: number }>,
      model?: string
    ) => {
      const modelId = model ?? defaultModelId

      // Check cache first
      const cacheResult = await cache.lookup(prompt, modelId)
      if (cacheResult.hit && cacheResult.entry) {
        const cost = estimateCost(
          modelId,
          cacheResult.entry.inputTokens,
          cacheResult.entry.outputTokens
        )
        savingsStore.addEvent({
          timestamp: Date.now(),
          type: "cache_hit",
          tokensSaved: cacheResult.entry.inputTokens + cacheResult.entry.outputTokens,
          dollarsSaved: cost.totalCost,
          details: `Cache ${cacheResult.matchType} (${((cacheResult.similarity ?? 1) * 100).toFixed(0)}% match)`,
        })
        return {
          response: cacheResult.entry.response,
          fromCache: true,
          matchType: cacheResult.matchType,
          similarity: cacheResult.similarity,
        }
      }

      // Cache miss - call API
      savingsStore.incrementRequests()
      const result = await apiFn(prompt)
      await cache.store(prompt, result.response, modelId, result.inputTokens, result.outputTokens)

      return {
        response: result.response,
        fromCache: false,
        matchType: undefined,
        similarity: undefined,
      }
    },
    [cache, savingsStore, defaultModelId]
  )

  const stats = useCallback(() => cache.stats(), [cache])

  return { cachedFetch, stats }
}

/**
 * Guard requests with debouncing, rate limiting, and cost gating.
 */
export function useRequestGuard() {
  const { guard, savingsStore } = useTokenShield()

  const checkRequest = useCallback(
    (prompt: string, expectedOutputTokens?: number): GuardResult => {
      const result = guard.check(prompt, expectedOutputTokens)
      if (!result.allowed) {
        savingsStore.addEvent({
          timestamp: Date.now(),
          type: "request_blocked",
          tokensSaved: 0,
          dollarsSaved: result.estimatedCost,
          details: result.reason ?? "Request blocked",
        })
      }
      return result
    },
    [guard, savingsStore]
  )

  const startRequest = useCallback(
    (prompt: string) => guard.startRequest(prompt),
    [guard]
  )

  const completeRequest = useCallback(
    (prompt: string, inputTokens: number, outputTokens: number) =>
      guard.completeRequest(prompt, inputTokens, outputTokens),
    [guard]
  )

  const stats = useCallback(() => guard.stats(), [guard])

  return { checkRequest, startRequest, completeRequest, stats }
}

/**
 * Subscribe to the CostLedger summary. Requires that TokenShieldProvider
 * was initialized with a ledgerConfig. Returns overall spending and
 * savings statistics, or, if a featureName is provided, a breakdown for
 * that specific feature. The return shape matches the ledger summary but
 * filters out only the relevant fields.
 *
 * Uses a version-based cache so that getSnapshot returns a referentially
 * stable object when the underlying data hasn't changed. This prevents
 * the infinite re-render loop that would occur if useSyncExternalStore
 * received a new object reference on every call.
 */
export function useCostLedger(featureName?: string) {
  const { ledger } = useTokenShield()
  if (!ledger) {
    throw new Error(
      "useCostLedger requires TokenShieldProvider with ledgerConfig; no ledger is available"
    )
  }

  // Version counter incremented by subscribe callback when ledger changes
  const versionRef = useRef(0)
  // Cached snapshot: only recomputed when version changes
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
 * Alias for useCostLedger that emphasizes per-feature cost tracking.
 */
export function useFeatureCost(featureName: string) {
  return useCostLedger(featureName)
}

/**
 * Route a prompt to the cheapest appropriate model.
 */
export function useModelRouter(prompt: string, options?: {
  allowedProviders?: ModelPricing["provider"][]
  defaultModel?: string
}) {
  const { defaultModelId, savingsStore } = useTokenShield()
  const model = options?.defaultModel ?? defaultModelId
  // Derive a stable key from the providers array so callers don't need to memoize it
  const providersKey = options?.allowedProviders?.join(",") ?? ""

  const routing = useMemo((): RoutingDecision | null => {
    if (!prompt || prompt.length === 0) return null
    const providers = providersKey ? providersKey.split(",") as ModelPricing["provider"][] : undefined
    return routeToModel(prompt, model, {
      allowedProviders: providers,
    })
  }, [prompt, model, providersKey])

  const confirmRouting = useCallback(() => {
    if (routing && routing.savingsVsDefault > 0) {
      savingsStore.addEvent({
        timestamp: Date.now(),
        type: "model_downgrade",
        tokensSaved: 0,
        dollarsSaved: routing.savingsVsDefault,
        details: `Routed to ${routing.selectedModel.name} instead of default`,
      })
    }
  }, [routing, savingsStore])

  return { routing, confirmRouting }
}

/**
 * Fast approximate token count for keystroke-level feedback.
 * Uses a character heuristic (~4 chars per token for English,
 * ~1.5 chars per token for CJK characters).
 */
export function useTokenEstimate(text: string): { estimatedTokens: number } {
  return useMemo(() => {
    if (!text || text.length === 0) return { estimatedTokens: 0 }
    // CJK detection
    const cjkMatch = text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
    const cjkChars = cjkMatch ? cjkMatch.length : 0
    const nonCjkChars = text.length - cjkChars
    const estimatedTokens = Math.max(1, Math.ceil(nonCjkChars / 4 + cjkChars / 1.5))
    return { estimatedTokens }
  }, [text])
}

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

      // Find the most critical tripped limit, or the highest percentUsed window
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
        // No limits tripped - find highest spend ratio across windows
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

    // Poll immediately, then every 2 seconds
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [breaker])

  return budgetState
}

/**
 * Track per-user budget status in real time.
 *
 * Subscribes to a UserBudgetManager instance and returns the current
 * budget state for the given userId. Updates reactively when spending
 * changes.
 *
 * Usage:
 *   const budgetManager = new UserBudgetManager({ ... })
 *   const { remaining, percentUsed, isOverBudget } = useUserBudget(budgetManager, 'user-123')
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

// ---------------------
// Event Log Hook
// ---------------------

export interface EventLogEntry {
  id: number
  timestamp: number
  type: string
  data: Record<string, unknown>
}

let _eventIdCounter = 0

/**
 * Subscribe to the event bus and maintain a rolling log of recent events.
 * Events are ordered most-recent-first and capped at maxEntries to prevent
 * unbounded memory growth.
 */
export function useEventLog(maxEntries = 50): EventLogEntry[] {
  const [log, setLog] = useState<EventLogEntry[]>([])

  useEffect(() => {
    const allEventTypes: Array<keyof TokenShieldEvents> = [
      "request:blocked",
      "request:allowed",
      "cache:hit",
      "cache:miss",
      "cache:store",
      "context:trimmed",
      "router:downgraded",
      "ledger:entry",
      "breaker:warning",
      "breaker:tripped",
      "userBudget:warning",
      "userBudget:exceeded",
      "userBudget:spend",
      "stream:chunk",
      "stream:abort",
      "stream:complete",
    ]

    const handlers: Array<() => void> = []

    for (const eventType of allEventTypes) {
      const handler = (data: Record<string, unknown>) => {
        const entry: EventLogEntry = {
          id: ++_eventIdCounter,
          timestamp: Date.now(),
          type: eventType,
          data: data as Record<string, unknown>,
        }
        setLog((prev) => {
          const next = [entry, ...prev]
          return next.length > maxEntries ? next.slice(0, maxEntries) : next
        })
      }
      shieldEvents.on(eventType, handler as any)
      handlers.push(() => shieldEvents.off(eventType, handler as any))
    }

    return () => {
      for (const unsub of handlers) unsub()
    }
  }, [maxEntries])

  return log
}

// ---------------------
// Provider Health Hook
// ---------------------

/**
 * Subscribe to provider health data. Polls the adapter every 2 seconds
 * (matching the useBudgetAlert pattern). If no adapter is provided,
 * returns an empty array.
 */
export function useProviderHealth(adapter?: ProviderAdapter): ProviderHealth[] {
  const [health, setHealth] = useState<ProviderHealth[]>([])

  useEffect(() => {
    if (!adapter) {
      setHealth([])
      return
    }

    function poll() {
      setHealth(adapter!.getHealth())
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [adapter])

  return health
}

// ---------------------
// Pipeline Metrics Hook
// ---------------------

export interface PipelineMetrics {
  totalRequests: number
  avgLatencyMs: number
  cacheHitRate: number
  blockedRate: number
  lastEvent: EventLogEntry | null
}

const EMPTY_PIPELINE_METRICS: PipelineMetrics = {
  totalRequests: 0,
  avgLatencyMs: 0,
  cacheHitRate: 0,
  blockedRate: 0,
  lastEvent: null,
}

/**
 * Track pipeline stage timing from the event bus.
 * Subscribes to cache:hit, cache:miss, request:blocked, request:allowed,
 * and ledger:entry events to maintain running statistics.
 */
export function usePipelineMetrics(): PipelineMetrics {
  const [metrics, setMetrics] = useState<PipelineMetrics>(EMPTY_PIPELINE_METRICS)

  // Use refs for running counters so we don't close over stale state
  const countersRef = useRef({
    totalRequests: 0,
    totalCacheHits: 0,
    totalBlocked: 0,
    cumulativeLatencyMs: 0,
    latencySamples: 0,
  })

  const lastEventRef = useRef<EventLogEntry | null>(null)

  useEffect(() => {
    const trackedEvents: Array<keyof TokenShieldEvents> = [
      "cache:hit",
      "cache:miss",
      "request:blocked",
      "request:allowed",
      "ledger:entry",
    ]

    function updateMetrics() {
      const c = countersRef.current
      setMetrics({
        totalRequests: c.totalRequests,
        avgLatencyMs: c.latencySamples > 0 ? Math.round(c.cumulativeLatencyMs / c.latencySamples) : 0,
        cacheHitRate: c.totalRequests > 0 ? c.totalCacheHits / c.totalRequests : 0,
        blockedRate: c.totalRequests > 0 ? c.totalBlocked / c.totalRequests : 0,
        lastEvent: lastEventRef.current,
      })
    }

    const handlers: Array<() => void> = []

    for (const eventType of trackedEvents) {
      const handler = (data: Record<string, unknown>) => {
        const c = countersRef.current

        const entry: EventLogEntry = {
          id: ++_eventIdCounter,
          timestamp: Date.now(),
          type: eventType,
          data: data as Record<string, unknown>,
        }
        lastEventRef.current = entry

        switch (eventType) {
          case "cache:hit":
            c.totalRequests++
            c.totalCacheHits++
            break
          case "cache:miss":
            c.totalRequests++
            break
          case "request:blocked":
            c.totalRequests++
            c.totalBlocked++
            break
          case "request:allowed":
            c.totalRequests++
            break
          case "ledger:entry": {
            // Use cost as a proxy for latency if latencyMs is present in data
            const latency = typeof data.latencyMs === "number" ? data.latencyMs : 0
            if (latency > 0) {
              c.cumulativeLatencyMs += latency
              c.latencySamples++
            }
            break
          }
        }

        updateMetrics()
      }
      shieldEvents.on(eventType, handler as any)
      handlers.push(() => shieldEvents.off(eventType, handler as any))
    }

    return () => {
      for (const unsub of handlers) unsub()
    }
  }, [])

  return metrics
}

// -------------------------------------------------------
// High-level useShieldedCall hook
// -------------------------------------------------------

export interface ShieldedCallMetrics {
  /** Where the response came from */
  source: "cache" | "api" | "none"
  /** Similarity/resonance score (0-1, only for cache hits) */
  confidence: number
  /** Response latency in ms */
  latencyMs: number
}

/**
 * High-level hook that wraps any API call with the full TokenShield pipeline.
 * Checks the response cache first (bigram or holographic), calls the API on miss,
 * and teaches the cache on new responses. Exposes source/confidence/latency metrics.
 *
 * @example
 * ```tsx
 * const { call, metrics, isReady } = useShieldedCall()
 *
 * const response = await call(
 *   "Explain React hooks",
 *   async (prompt) => {
 *     const res = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ prompt }) })
 *     const data = await res.json()
 *     return { response: data.text, inputTokens: data.usage.input, outputTokens: data.usage.output }
 *   },
 *   "gpt-4o"
 * )
 * ```
 */
export function useShieldedCall() {
  const { cache, savingsStore, defaultModelId } = useTokenShield()
  const [metrics, setMetrics] = useState<ShieldedCallMetrics>({
    source: "none",
    confidence: 0,
    latencyMs: 0,
  })

  const call = useCallback(
    async (
      prompt: string,
      apiFn: (prompt: string) => Promise<{ response: string; inputTokens: number; outputTokens: number }>,
      model?: string
    ): Promise<string> => {
      const modelId = model ?? defaultModelId
      const start = performance.now()

      // Check cache first
      const cacheResult = await cache.lookup(prompt, modelId)
      if (cacheResult.hit && cacheResult.entry) {
        const latencyMs = performance.now() - start
        setMetrics({
          source: "cache",
          confidence: cacheResult.similarity ?? 1,
          latencyMs,
        })

        const cost = estimateCost(
          modelId,
          cacheResult.entry.inputTokens,
          cacheResult.entry.outputTokens
        )
        savingsStore.addEvent({
          timestamp: Date.now(),
          type: "cache_hit",
          tokensSaved: cacheResult.entry.inputTokens + cacheResult.entry.outputTokens,
          dollarsSaved: cost.totalCost,
          details: `Shield ${cacheResult.matchType} (${((cacheResult.similarity ?? 1) * 100).toFixed(0)}% confidence)`,
        })

        return cacheResult.entry.response
      }

      // Cache miss — call the API
      savingsStore.incrementRequests()
      const result = await apiFn(prompt)
      const latencyMs = performance.now() - start

      // Teach the cache
      await cache.store(prompt, result.response, modelId, result.inputTokens, result.outputTokens)

      setMetrics({
        source: "api",
        confidence: 0,
        latencyMs,
      })

      return result.response
    },
    [cache, savingsStore, defaultModelId]
  )

  return { call, metrics, isReady: true }
}
