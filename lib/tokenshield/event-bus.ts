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
}

export type EventBus = ReturnType<typeof mitt<TokenShieldEvents>>

export const shieldEvents: EventBus = mitt<TokenShieldEvents>()

export function createEventBus(): EventBus {
  return mitt<TokenShieldEvents>()
}

/**
 * Type-safe event subscription that handles the dynamic event name union narrowing
 * inherent to mitt. Centralizes the unavoidable cast in one place so consumers
 * don't need per-callsite eslint-disable comments.
 *
 * Returns an unsubscribe function for easy cleanup.
 */
export function subscribeToEvent(
  bus: EventBus,
  name: keyof TokenShieldEvents,
  handler: (data: never) => void,
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bus.on(name, handler as any)
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bus.off(name, handler as any)
  }
}
