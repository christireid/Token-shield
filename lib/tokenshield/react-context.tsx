"use client"

/**
 * TokenShield React Context & Provider
 *
 * Initializes SDK instances (cache, guard, ledger) and provides them
 * to all hooks via React context. This file contains only the provider
 * and internal context — hooks are in separate files.
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
// Context
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

export const TokenShieldContext = createContext<TokenShieldContextValue | null>(null)

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

  const value = useMemo(
    () => ({
      cache: cacheRef.current!,
      guard: guardRef.current!,
      savingsStore: storeRef.current!,
      defaultModelId,
      ledger: ledgerRef.current ?? undefined,
      eventBus,
    }),
    [defaultModelId, eventBus],
  )

  return <TokenShieldContext.Provider value={value}>{children}</TokenShieldContext.Provider>
}

/**
 * Internal hook to access the TokenShield context.
 * Throws if used outside of TokenShieldProvider.
 */
export function useTokenShield() {
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
