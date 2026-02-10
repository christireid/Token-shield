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
      state = {
        ...state,
        events: [...state.events, event],
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
