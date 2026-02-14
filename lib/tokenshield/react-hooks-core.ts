"use client"

/**
 * TokenShield React Hooks - Core
 *
 * Basic hooks for token counting, complexity analysis, token estimation,
 * and the high-level useShieldedCall hook.
 */

import { useMemo, useState, useCallback } from "react"
import { countExactTokens } from "./token-counter"
import { estimateCost, type ModelPricing } from "./cost-estimator"
import { routeToModel, type RoutingDecision } from "./model-router"
import { useTokenShield } from "./react-context"

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
 * Route a prompt to the cheapest appropriate model.
 */
export function useModelRouter(
  prompt: string,
  options?: {
    allowedProviders?: ModelPricing["provider"][]
    defaultModel?: string
  },
) {
  const { defaultModelId, savingsStore } = useTokenShield()
  const model = options?.defaultModel ?? defaultModelId
  // Derive a stable key from the providers array so callers don't need to memoize it
  const providersKey = options?.allowedProviders?.join(",") ?? ""

  const routing = useMemo((): RoutingDecision | null => {
    if (!prompt || prompt.length === 0) return null
    const providers = providersKey
      ? (providersKey.split(",") as ModelPricing["provider"][])
      : undefined
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
      apiFn: (
        prompt: string,
      ) => Promise<{ response: string; inputTokens: number; outputTokens: number }>,
      model?: string,
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
          cacheResult.entry.outputTokens,
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
    [cache, savingsStore, defaultModelId],
  )

  return { call, metrics, isReady: true }
}
