"use client"

/**
 * TokenShield React Hooks - Pipeline & Monitoring
 *
 * Hooks for context management, response caching, request guarding,
 * event logging, pipeline metrics, and provider health monitoring.
 */

import { useMemo, useState, useEffect, useCallback, useRef } from "react"
import { estimateCost } from "./cost-estimator"
import { smartFit, type Message, type ContextBudget, type ContextResult } from "./context-manager"
import { calculateSavings } from "./cost-estimator"
import type { GuardResult } from "./request-guard"
import { subscribeToAnyEvent, type TokenShieldEvents } from "./event-bus"
import type { ProviderAdapter, ProviderHealth } from "./provider-adapter"
import { useTokenShield } from "./react-context"

// -------------------------------------------------------
// Context Manager Hook
// -------------------------------------------------------

/**
 * Manage conversation context within a token budget.
 * Returns the trimmed messages and savings data.
 */
export function useContextManager(
  messages: Message[],
  budget: ContextBudget,
): ContextResult & {
  savings: { tokensSaved: number; dollarsSaved: number; percentSaved: number } | null
} {
  const { defaultModelId } = useTokenShield()

  return useMemo(() => {
    const result = smartFit(messages, budget)

    if (result.evictedTokens > 0) {
      const savings = calculateSavings(
        defaultModelId,
        result.totalTokens + result.evictedTokens,
        result.totalTokens,
        budget.reservedForOutput,
      )
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

// -------------------------------------------------------
// Response Cache Hook
// -------------------------------------------------------

/**
 * Check the response cache before making an API call.
 * Returns a function that wraps your API call with caching.
 */
export function useResponseCache(): {
  cachedFetch: (
    prompt: string,
    apiFn: (
      prompt: string,
    ) => Promise<{ response: string; inputTokens: number; outputTokens: number }>,
    model?: string,
  ) => Promise<{
    response: string
    fromCache: boolean
    matchType: string | undefined
    similarity: number | undefined
  }>
  stats: () => ReturnType<typeof import("./response-cache").ResponseCache.prototype.stats>
} {
  const { cache, savingsStore, defaultModelId } = useTokenShield()

  const cachedFetch = useCallback(
    async (
      prompt: string,
      apiFn: (
        prompt: string,
      ) => Promise<{ response: string; inputTokens: number; outputTokens: number }>,
      model?: string,
    ) => {
      const modelId = model ?? defaultModelId

      const cacheResult = await cache.lookup(prompt, modelId)
      if (cacheResult.hit && cacheResult.entry) {
        const cost = estimateCost(
          modelId,
          cacheResult.entry.inputTokens,
          cacheResult.entry.outputTokens,
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
    [cache, savingsStore, defaultModelId],
  )

  const stats = useCallback(() => cache.stats(), [cache])

  return { cachedFetch, stats }
}

// -------------------------------------------------------
// Request Guard Hook
// -------------------------------------------------------

/**
 * Guard requests with debouncing, rate limiting, and cost gating.
 */
export function useRequestGuard(): {
  checkRequest: (prompt: string, expectedOutputTokens?: number) => GuardResult
  startRequest: (prompt: string) => void
  completeRequest: (prompt: string, inputTokens: number, outputTokens: number) => void
  stats: () => ReturnType<import("./request-guard").RequestGuard["stats"]>
} {
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
    [guard, savingsStore],
  )

  const startRequest = useCallback((prompt: string) => guard.startRequest(prompt), [guard])

  const completeRequest = useCallback(
    (prompt: string, inputTokens: number, outputTokens: number) =>
      guard.completeRequest(prompt, inputTokens, outputTokens),
    [guard],
  )

  const stats = useCallback(() => guard.stats(), [guard])

  return { checkRequest, startRequest, completeRequest, stats }
}

// -------------------------------------------------------
// Event Log Hook
// -------------------------------------------------------

export interface EventLogEntry {
  id: number
  timestamp: number
  type: string
  data: Record<string, unknown>
}

/**
 * Module-scoped counter for generating unique event IDs.
 * Safe for client-side only (React hooks require browser).
 * SSR-safe because hooks never run during server rendering.
 */
let _eventIdCounter = 0

/**
 * Subscribe to the event bus and maintain a rolling log of recent events.
 * Events are ordered most-recent-first and capped at maxEntries.
 */
export function useEventLog(maxEntries = 50): EventLogEntry[] {
  const { eventBus } = useTokenShield()
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
      "compressor:applied",
      "delta:applied",
    ]

    const handlers: Array<() => void> = []

    for (const eventType of allEventTypes) {
      const handler = (data: unknown) => {
        const entry: EventLogEntry = {
          id: ++_eventIdCounter,
          timestamp: Date.now(),
          type: eventType,
          data: (data ?? {}) as Record<string, unknown>,
        }
        setLog((prev) => {
          const next = [entry, ...prev]
          return next.length > maxEntries ? next.slice(0, maxEntries) : next
        })
      }
      handlers.push(subscribeToAnyEvent(eventBus, eventType, handler))
    }

    return () => {
      for (const unsub of handlers) unsub()
    }
  }, [maxEntries, eventBus])

  return log
}

// -------------------------------------------------------
// Provider Health Hook
// -------------------------------------------------------

/**
 * Subscribe to provider health data. Polls the adapter every 2 seconds.
 * If no adapter is provided, returns an empty array.
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

// -------------------------------------------------------
// Pipeline Metrics Hook
// -------------------------------------------------------

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
  const { eventBus } = useTokenShield()
  const [metrics, setMetrics] = useState<PipelineMetrics>(EMPTY_PIPELINE_METRICS)

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
        avgLatencyMs:
          c.latencySamples > 0 ? Math.round(c.cumulativeLatencyMs / c.latencySamples) : 0,
        cacheHitRate: c.totalRequests > 0 ? c.totalCacheHits / c.totalRequests : 0,
        blockedRate: c.totalRequests > 0 ? c.totalBlocked / c.totalRequests : 0,
        lastEvent: lastEventRef.current,
      })
    }

    const handlers: Array<() => void> = []

    for (const eventType of trackedEvents) {
      const handler = (data: unknown) => {
        const c = countersRef.current
        const record = (data ?? {}) as Record<string, unknown>

        const entry: EventLogEntry = {
          id: ++_eventIdCounter,
          timestamp: Date.now(),
          type: eventType,
          data: record,
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
            const latency = typeof record.latencyMs === "number" ? record.latencyMs : 0
            if (latency > 0) {
              c.cumulativeLatencyMs += latency
              c.latencySamples++
            }
            break
          }
        }

        updateMetrics()
      }
      handlers.push(subscribeToAnyEvent(eventBus, eventType, handler))
    }

    return () => {
      for (const unsub of handlers) unsub()
    }
  }, [eventBus])

  return metrics
}
