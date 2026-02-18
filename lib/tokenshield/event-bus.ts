import mitt from "mitt"
import type { AnomalyEvent } from "./anomaly-detector"

export type TokenShieldEvents = {
  "request:blocked": { reason: string; estimatedCost: number }
  "request:allowed": { prompt: string; model: string }
  "cache:hit": { matchType: "exact" | "fuzzy"; similarity: number; savedCost: number }
  "cache:miss": { prompt: string }
  "cache:store": { prompt: string; model: string }
  "context:trimmed": { originalTokens: number; trimmedTokens: number; savedTokens: number }
  "router:downgraded": {
    originalModel: string
    selectedModel: string
    complexity: number
    savedCost: number
  }
  "router:holdback": { model: string; holdbackRate: number }
  "ledger:entry": {
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
    saved: number
  }
  "breaker:warning": { limitType: string; currentSpend: number; limit: number; percentUsed: number }
  "breaker:tripped": { limitType: string; currentSpend: number; limit: number; action: string }
  "userBudget:warning": {
    userId: string
    limitType: string
    currentSpend: number
    limit: number
    percentUsed: number
  }
  "userBudget:exceeded": { userId: string; limitType: string; currentSpend: number; limit: number }
  "userBudget:spend": { userId: string; cost: number; model: string }
  "stream:chunk": { outputTokens: number; estimatedCost: number }
  "stream:abort": { inputTokens: number; outputTokens: number; estimatedCost: number }
  "stream:complete": { inputTokens: number; outputTokens: number; totalCost: number }
  "anomaly:detected": AnomalyEvent
  "compressor:applied": { savedTokens: number; originalTokens: number; compressedTokens: number }
  "delta:applied": { savedTokens: number; originalTokens: number; encodedTokens: number }
  "storage:error": { module: string; operation: string; error: unknown }
  "cost:fallback": {
    modelId: string
    fallbackInputPerMillion: number
    fallbackOutputPerMillion: number
  }
}

export type EventBus = ReturnType<typeof mitt<TokenShieldEvents>>

export const shieldEvents: EventBus = mitt<TokenShieldEvents>()

export function createEventBus(): EventBus {
  return mitt<TokenShieldEvents>()
}

/**
 * Type-safe event subscription using generics to narrow the event name
 * and handler payload. Eliminates the need for `as never` casts at call sites.
 *
 * Returns an unsubscribe function for easy cleanup.
 */
export function subscribeToEvent<K extends keyof TokenShieldEvents>(
  bus: EventBus,
  name: K,
  handler: (data: TokenShieldEvents[K]) => void,
): () => void {
  bus.on(name, handler)
  return () => {
    bus.off(name, handler)
  }
}

/**
 * Subscribe to an event with a loosely-typed handler.
 *
 * Use this in dynamic iteration loops where the event name is a runtime
 * variable (e.g. forwarding all events). The handler receives `unknown`
 * data, so callers must narrow the type themselves. This avoids the need
 * for `as never` casts at every call site.
 */
export function subscribeToAnyEvent(
  bus: EventBus,
  name: keyof TokenShieldEvents,
  handler: (data: unknown) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: handler accepts any event payload
  bus.on(name, handler as any)
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus.off(name, handler as any)
  }
}
