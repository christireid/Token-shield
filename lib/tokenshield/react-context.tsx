"use client"

/**
 * TokenShield React Context & Provider
 *
 * Initializes SDK instances (cache, guard, ledger) and provides them
 * to all hooks via React context. Uses the split-context pattern for
 * fine-grained re-render control:
 *
 *   - TokenShieldInstanceContext  — stable SDK instances (never re-renders)
 *   - TokenShieldSavingsContext   — savings state (re-renders on savings changes)
 *   - TokenShieldConfigContext    — config values (re-renders on config changes)
 *
 * The legacy single-context API (TokenShieldContext / useTokenShield) is
 * preserved as a backward-compatible wrapper that combines all three.
 */

import React, { createContext, useContext, useRef, useMemo } from "react"
import { ResponseCache } from "./response-cache"
import { CostLedger } from "./cost-ledger"
import { RequestGuard, type GuardConfig } from "./request-guard"
import { shieldEvents, createEventBus } from "./event-bus"
import { useSyncExternalStore } from "react"

// ---------------------
// Session savings store
// ---------------------
export interface SavingsEvent {
  timestamp: number
  type: "cache_hit" | "context_trim" | "model_downgrade" | "request_blocked"
  tokensSaved: number
  dollarsSaved: number
  details: string
}

export interface SavingsState {
  events: SavingsEvent[]
  totalTokensSaved: number
  totalDollarsSaved: number
  totalRequestsMade: number
  totalRequestsBlocked: number
  totalCacheHits: number
}

export function createSavingsStore() {
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
        totalCacheHits: state.totalCacheHits + (event.type === "cache_hit" ? 1 : 0),
        totalRequestsBlocked:
          state.totalRequestsBlocked + (event.type === "request_blocked" ? 1 : 0),
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
// Split contexts
// ---------------------

/** Stable SDK instances — context value never changes after mount. */
interface TokenShieldInstanceValue {
  cache: ResponseCache
  guard: RequestGuard
  /** Global CostLedger instance. Optional: only present when ledgerConfig is provided */
  ledger?: CostLedger
  /** Per-instance event bus. Falls back to global shieldEvents when not provided via props. */
  eventBus: ReturnType<typeof createEventBus>
}

const TokenShieldInstanceContext = createContext<TokenShieldInstanceValue | null>(null)

/** Savings external store — re-renders consumers when savings events fire. */
const TokenShieldSavingsContext = createContext<ReturnType<typeof createSavingsStore> | null>(null)

/** Config values — re-renders consumers only when config props change. */
interface TokenShieldConfigValue {
  defaultModelId: string
}

const TokenShieldConfigContext = createContext<TokenShieldConfigValue | null>(null)

// ---------------------
// Backward-compatible combined context
// ---------------------
export interface TokenShieldContextValue {
  cache: ResponseCache
  guard: RequestGuard
  savingsStore: ReturnType<typeof createSavingsStore>
  defaultModelId: string
  /** Global CostLedger instance. Optional: only present when ledgerConfig is provided */
  ledger?: CostLedger
  /** Per-instance event bus. Falls back to global shieldEvents when not provided via props. */
  eventBus: ReturnType<typeof createEventBus>
}

/**
 * Legacy combined context.
 * @deprecated Prefer the split contexts via useTokenShieldInstances(),
 * useTokenShieldSavings(), or useTokenShieldConfig() for fine-grained
 * re-render control.
 */
export const TokenShieldContext = createContext<TokenShieldContextValue | null>(null)

// ---------------------
// Provider props
// ---------------------
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

  /**
   * Optional per-instance event bus. Pass middleware.events to connect hooks
   * to a specific middleware instance. Falls back to global shieldEvents.
   */
  eventBus?: ReturnType<typeof createEventBus>
}

// ---------------------
// Provider
// ---------------------

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
  eventBus: eventBusProp,
}: TokenShieldProviderProps) {
  const eventBus = eventBusProp ?? shieldEvents
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

  // Split context values — each memoized independently for fine-grained control.

  const instanceValue = useMemo<TokenShieldInstanceValue>(
    () => ({
      cache: cacheRef.current!,
      guard: guardRef.current!,
      ledger: ledgerRef.current ?? undefined,
      eventBus,
    }),
    // eventBus is the only dependency that can change (when the prop changes).
    // cache, guard, and ledger are created once via refs and are stable.
    [eventBus],
  )

  const configValue = useMemo<TokenShieldConfigValue>(() => ({ defaultModelId }), [defaultModelId])

  // The savings store ref itself is stable — it never changes after mount.
  const savingsStore = storeRef.current!

  // Legacy combined value for backward-compatible TokenShieldContext.
  const legacyValue = useMemo<TokenShieldContextValue>(
    () => ({
      cache: cacheRef.current!,
      guard: guardRef.current!,
      savingsStore,
      defaultModelId,
      ledger: ledgerRef.current ?? undefined,
      eventBus,
    }),
    [defaultModelId, eventBus, savingsStore],
  )

  return (
    <TokenShieldContext.Provider value={legacyValue}>
      <TokenShieldConfigContext.Provider value={configValue}>
        <TokenShieldInstanceContext.Provider value={instanceValue}>
          <TokenShieldSavingsContext.Provider value={savingsStore}>
            {children}
          </TokenShieldSavingsContext.Provider>
        </TokenShieldInstanceContext.Provider>
      </TokenShieldConfigContext.Provider>
    </TokenShieldContext.Provider>
  )
}

// ---------------------
// Fine-grained hooks
// ---------------------

/**
 * Access stable SDK instances (cache, guard, ledger, eventBus).
 * The returned object reference is stable and never causes re-renders
 * unless the eventBus prop on the provider changes.
 */
export function useTokenShieldInstances(): TokenShieldInstanceValue {
  const ctx = useContext(TokenShieldInstanceContext)
  if (!ctx) {
    throw new Error("useTokenShieldInstances must be used within <TokenShieldProvider>")
  }
  return ctx
}

/**
 * Access the savings external store.
 * Only re-renders when savings events fire (addEvent, incrementRequests, reset).
 *
 * Returns the raw savings store. For the derived SavingsState snapshot,
 * use the existing `useSavings()` hook instead.
 */
export function useTokenShieldSavings(): ReturnType<typeof createSavingsStore> {
  const ctx = useContext(TokenShieldSavingsContext)
  if (!ctx) {
    throw new Error("useTokenShieldSavings must be used within <TokenShieldProvider>")
  }
  return ctx
}

/**
 * Access config values (defaultModelId).
 * Only re-renders when the config props on the provider change.
 */
export function useTokenShieldConfig(): TokenShieldConfigValue {
  const ctx = useContext(TokenShieldConfigContext)
  if (!ctx) {
    throw new Error("useTokenShieldConfig must be used within <TokenShieldProvider>")
  }
  return ctx
}

// ---------------------
// Backward-compatible hooks
// ---------------------

/**
 * Access the full TokenShield context (all instances, savings store, and config).
 * Re-renders on any context change.
 *
 * @deprecated Prefer useTokenShieldInstances(), useTokenShieldSavings(),
 * or useTokenShieldConfig() for fine-grained re-render control.
 */
export function useTokenShield(): TokenShieldContextValue {
  const ctx = useContext(TokenShieldContext)
  if (!ctx) {
    throw new Error("useTokenShield hooks must be used within <TokenShieldProvider>")
  }
  return ctx
}

/**
 * Track cumulative savings across the session.
 * Reactively updates when any savings event occurs.
 */
export function useSavings() {
  const { savingsStore } = useTokenShield()
  return useSyncExternalStore(savingsStore.subscribe, savingsStore.getState, savingsStore.getState)
}
