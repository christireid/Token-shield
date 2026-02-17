/**
 * token-shield — Core Shield factory.
 *
 * `createShield` (aliased as `shield`) is the primary entry point.
 * It creates an instance that combines semantic caching, prompt compression,
 * and cost tracking into a single process/record workflow.
 */

import { semanticCache, type SemanticCache } from "../cache/semantic-cache"
import { promptCompression, compressMessages } from "../compression/compressor"
import { costTracker, estimateCost } from "../cost/tracker"
import type {
  ShieldOptions,
  ShieldStats,
  ProcessResult,
  Message,
  CacheOptions,
  CompressionOptions,
  CostEstimate,
} from "../types"
import type { CostTracker } from "../cost/tracker"

/** A configured Shield instance. */
export interface Shield {
  /**
   * Process messages before sending to the LLM.
   *
   * Checks cache first. If no cache hit, applies compression.
   * Returns the processed messages and metadata.
   */
  process(request: { model: string; messages: Message[] }): ProcessResult

  /**
   * Record a completed LLM response for caching and cost tracking.
   *
   * Call this after receiving the LLM response to populate the cache
   * and track costs.
   */
  record(response: {
    model: string
    prompt: string
    response: string
    inputTokens: number
    outputTokens: number
  }): void

  /** Current cumulative statistics. */
  readonly stats: ShieldStats

  /** Reset all stats, cache, and tracking data. */
  reset(): void
}

function resolveCacheOptions(opt: boolean | CacheOptions | undefined): CacheOptions | false {
  if (opt === false) return false
  if (opt === true || opt === undefined) return {}
  return opt
}

function resolveCompressionOptions(opt: boolean | CompressionOptions | undefined): CompressionOptions | false {
  if (opt === false) return false
  if (opt === true || opt === undefined) return {}
  return opt
}

/**
 * Create a Shield instance.
 *
 * @param options - Configuration. All fields are optional with sensible defaults.
 * @returns A Shield instance for processing requests and tracking costs.
 *
 * @example
 * ```ts
 * import { createShield } from "token-shield";
 *
 * const shield = createShield({ cache: true, compression: true });
 *
 * const result = shield.process({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "What is TypeScript?" }],
 * });
 *
 * if (result.cached) {
 *   console.log(result.cached.response);
 * } else {
 *   // Call your LLM, then:
 *   shield.record({
 *     model: "gpt-4o",
 *     prompt: "What is TypeScript?",
 *     response: "TypeScript is...",
 *     inputTokens: 10,
 *     outputTokens: 50,
 *   });
 * }
 *
 * console.log(shield.stats);
 * ```
 */
export function createShield(options?: ShieldOptions): Shield {
  const cacheOpts = resolveCacheOptions(options?.cache)
  const compressionOpts = resolveCompressionOptions(options?.compression)
  const trackCosts = options?.costTracking !== false

  const cache: SemanticCache | null = cacheOpts !== false ? semanticCache(cacheOpts) : null
  const tracker: CostTracker | null = trackCosts ? costTracker() : null

  let requests = 0
  let cacheHits = 0
  let cacheMisses = 0
  let compressionTokensSaved = 0
  let cacheTokensSaved = 0

  return {
    process(request: { model: string; messages: Message[] }): ProcessResult {
      requests++

      // Concatenate user messages for cache lookup
      const userContent = request.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n")

      // 1. Cache lookup
      if (cache && userContent) {
        const result = cache.lookup(userContent, request.model)
        if (result.hit && result.entry) {
          cacheHits++
          cacheTokensSaved += result.entry.inputTokens + result.entry.outputTokens
          return {
            messages: request.messages,
            cached: {
              response: result.entry.response,
              matchType: result.matchType!,
              similarity: result.similarity!,
            },
            compressed: false,
            originalTokens: 0,
            processedTokens: 0,
            tokensSaved: 0,
          }
        }
        cacheMisses++
      }

      // 2. Compression
      if (compressionOpts !== false) {
        const { messages: compressed, totalSavedTokens, perMessage } = compressMessages(
          request.messages,
          compressionOpts,
        )
        compressionTokensSaved += totalSavedTokens

        const originalTokens = perMessage.reduce((sum, r) => sum + r.originalTokens, 0)
        const processedTokens = perMessage.reduce((sum, r) => sum + r.compressedTokens, 0)

        return {
          messages: compressed,
          cached: null,
          compressed: totalSavedTokens > 0,
          originalTokens,
          processedTokens,
          tokensSaved: totalSavedTokens,
        }
      }

      return {
        messages: request.messages,
        cached: null,
        compressed: false,
        originalTokens: 0,
        processedTokens: 0,
        tokensSaved: 0,
      }
    },

    record(response) {
      // Store in cache
      if (cache) {
        cache.store(
          response.prompt,
          response.response,
          response.model,
          response.inputTokens,
          response.outputTokens,
        )
      }

      // Track cost
      if (tracker) {
        tracker.record(response.model, response.inputTokens, response.outputTokens)
      }
    },

    get stats(): ShieldStats {
      const trackerStats = tracker?.stats
      const totalTokensSaved = compressionTokensSaved + cacheTokensSaved

      return {
        requests,
        cacheHits,
        cacheMisses,
        cacheHitRate: requests > 0 ? cacheHits / requests : 0,
        compressionTokensSaved,
        cacheTokensSaved,
        totalTokensSaved,
        totalInputTokens: trackerStats?.totalInputTokens ?? 0,
        totalOutputTokens: trackerStats?.totalOutputTokens ?? 0,
        totalEstimatedCost: trackerStats?.totalCost ?? 0,
        estimatedCostSaved: 0, // Future: calculate based on saved tokens
      }
    },

    reset() {
      requests = 0
      cacheHits = 0
      cacheMisses = 0
      compressionTokensSaved = 0
      cacheTokensSaved = 0
      cache?.clear()
      tracker?.reset()
    },
  }
}

/**
 * Alias for `createShield`. The primary entry point for token-shield.
 *
 * @example
 * ```ts
 * import { shield } from "token-shield";
 * const s = shield({ cache: true, compression: true });
 * ```
 */
export const shield = createShield
