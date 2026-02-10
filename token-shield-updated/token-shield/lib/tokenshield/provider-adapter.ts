/**
 * TokenShield - Multi-Provider Adapter
 *
 * Unified interface for multiple LLM providers (OpenAI, Anthropic, Google) with
 * automatic retry logic, fallback chains, and cost-aware routing.
 */

import { estimateCost } from "./cost-estimator"

export type ProviderName = "openai" | "anthropic" | "google"

export interface ProviderConfig {
  name: ProviderName
  models: string[]
  maxRetries?: number
  retryDelayMs?: number
  timeoutMs?: number
  priority?: number
  healthy?: boolean
}

export interface ProviderHealth {
  name: ProviderName
  healthy: boolean
  lastError?: string
  lastErrorTime?: number
  consecutiveFailures: number
  totalRequests: number
  totalFailures: number
  avgLatencyMs: number
}

export interface AdapterConfig {
  providers: ProviderConfig[]
  fallbackStrategy?: "priority" | "cost" | "round-robin"
  unhealthyThreshold?: number
  recoveryMs?: number
  onFallback?: (from: ProviderName, to: ProviderName, error: string) => void
  onHealthChange?: (health: ProviderHealth) => void
}

/** Retry an async fn with exponential backoff + jitter. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

const EMA_ALPHA = 0.3

export class ProviderAdapter {
  private configs: Map<ProviderName, ProviderConfig> = new Map()
  private healthMap: Map<ProviderName, ProviderHealth> = new Map()
  private unhealthyThreshold: number
  private recoveryMs: number
  private strategy: AdapterConfig["fallbackStrategy"]
  private onFallback?: AdapterConfig["onFallback"]
  private onHealthChange?: AdapterConfig["onHealthChange"]
  private rrIndex = 0

  constructor(config: AdapterConfig) {
    this.unhealthyThreshold = config.unhealthyThreshold ?? 5
    this.recoveryMs = config.recoveryMs ?? 60_000
    this.strategy = config.fallbackStrategy ?? "priority"
    this.onFallback = config.onFallback
    this.onHealthChange = config.onHealthChange
    for (const p of config.providers) {
      this.configs.set(p.name, p)
      this.healthMap.set(p.name, {
        name: p.name, healthy: p.healthy !== false,
        consecutiveFailures: 0, totalRequests: 0, totalFailures: 0, avgLatencyMs: 0,
      })
    }
  }

  selectModel(
    preferredModel?: string, inputTokens = 1000, outputTokens = 500
  ): { provider: ProviderName; model: string; estimatedCost: number } {
    if (preferredModel) {
      const prov = this.getProviderForModel(preferredModel)
      if (prov && this.isHealthy(prov)) {
        return { provider: prov, model: preferredModel, estimatedCost: this.cost(preferredModel, inputTokens, outputTokens) }
      }
    }
    const ordered = this.orderProviders(inputTokens, outputTokens)
    for (const entry of ordered) {
      if (this.isHealthy(entry.provider)) {
        if (preferredModel) {
          const from = this.getProviderForModel(preferredModel)
          if (from && from !== entry.provider) this.onFallback?.(from, entry.provider, "preferred provider unhealthy")
        }
        return entry
      }
    }
    // All unhealthy — return first provider's first model
    const first = Array.from(this.configs.values())[0]
    return { provider: first.name, model: first.models[0], estimatedCost: this.cost(first.models[0], inputTokens, outputTokens) }
  }

  recordSuccess(provider: ProviderName, latencyMs: number): void {
    const h = this.healthMap.get(provider)
    if (!h) return
    const wasUnhealthy = !h.healthy
    h.totalRequests++
    h.consecutiveFailures = 0
    h.healthy = true
    h.avgLatencyMs = h.avgLatencyMs === 0 ? latencyMs : h.avgLatencyMs * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA
    if (wasUnhealthy) this.onHealthChange?.(h)
  }

  recordFailure(provider: ProviderName, error: string): void {
    const h = this.healthMap.get(provider)
    if (!h) return
    h.totalRequests++
    h.totalFailures++
    h.consecutiveFailures++
    h.lastError = error
    h.lastErrorTime = Date.now()
    if (h.consecutiveFailures >= this.unhealthyThreshold && h.healthy) {
      h.healthy = false
      this.onHealthChange?.(h)
      setTimeout(() => {
        const cur = this.healthMap.get(provider)
        if (cur && !cur.healthy) { cur.healthy = true; this.onHealthChange?.(cur) }
      }, this.recoveryMs)
    }
  }

  getHealth(): ProviderHealth[] { return Array.from(this.healthMap.values()) }

  getProviderHealth(name: ProviderName): ProviderHealth | undefined { return this.healthMap.get(name) }

  resetHealth(): void {
    Array.from(this.healthMap.values()).forEach((h) => {
      h.healthy = true; h.consecutiveFailures = 0; h.totalRequests = 0
      h.totalFailures = 0; h.avgLatencyMs = 0; h.lastError = undefined; h.lastErrorTime = undefined
    })
  }

  isModelAvailable(modelId: string): boolean {
    const p = this.getProviderForModel(modelId)
    return p != null && this.isHealthy(p)
  }

  getProviderForModel(modelId: string): ProviderName | undefined {
    const entries = Array.from(this.configs.entries())
    for (let i = 0; i < entries.length; i++) {
      if (entries[i][1].models.includes(modelId)) return entries[i][0]
    }
    return undefined
  }

  // -- internals --

  private isHealthy(name: ProviderName): boolean {
    return this.healthMap.get(name)?.healthy !== false
  }

  private cost(modelId: string, inp: number, out: number): number {
    try { return estimateCost(modelId, inp, out).totalCost } catch { return 0 }
  }

  private orderProviders(inp: number, out: number): { provider: ProviderName; model: string; estimatedCost: number }[] {
    const entries = Array.from(this.configs.entries()).map(([name, cfg]) => {
      let bestModel = cfg.models[0], bestCost = this.cost(bestModel, inp, out)
      for (let i = 1; i < cfg.models.length; i++) {
        const c = this.cost(cfg.models[i], inp, out)
        if (c < bestCost) { bestCost = c; bestModel = cfg.models[i] }
      }
      return { provider: name, model: bestModel, estimatedCost: bestCost, priority: cfg.priority ?? 0 }
    })
    if (this.strategy === "cost") {
      entries.sort((a, b) => a.estimatedCost - b.estimatedCost)
    } else if (this.strategy === "round-robin") {
      const idx = this.rrIndex++ % entries.length
      const rotated = entries.slice(idx).concat(entries.slice(0, idx))
      return rotated.map(({ provider, model, estimatedCost }) => ({ provider, model, estimatedCost }))
    } else {
      entries.sort((a, b) => a.priority - b.priority)
    }
    return entries.map(({ provider, model, estimatedCost }) => ({ provider, model, estimatedCost }))
  }
}

export function createProviderAdapter(config: AdapterConfig): ProviderAdapter {
  return new ProviderAdapter(config)
}
