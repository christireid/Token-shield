/**
 * TokenShield - Token Optimizer (Unified Facade)
 *
 * Combines all complementary token-saving features into a single,
 * easy-to-use class. Instead of manually wiring together the prompt
 * compressor, delta encoder, adaptive output optimizer, template pool,
 * cache, and context manager — this facade does it all in one call.
 *
 * UNIQUE IP: No competing tool offers a unified client-side optimization
 * pipeline that combines compression, deduplication, adaptive learning,
 * caching, and context management in a single composable class.
 *
 * Usage:
 * ```ts
 * const optimizer = createTokenOptimizer({
 *   compression: true,
 *   deltaEncoding: true,
 *   adaptiveOutput: true,
 *   cache: true,
 *   model: "gpt-4o",
 * })
 *
 * const result = await optimizer.optimize(messages)
 * // result.messages — fully optimized messages
 * // result.totalSaved — total tokens saved across all techniques
 * // result.suggestedMaxTokens — adaptive max_tokens for this request
 * // result.cacheHit — true if a cached response is available
 * ```
 *
 * All client-side. Zero network overhead. Zero backend.
 */

import { countTokens } from "gpt-tokenizer"
import { compressMessages, type CompressorConfig } from "./prompt-compressor"
import { encodeDelta, type DeltaEncoderConfig } from "./conversation-delta-encoder"
import { AdaptiveOutputOptimizer, type AdaptiveOptimizerConfig } from "./adaptive-output-optimizer"
import { ResponseCache, type CacheConfig } from "./response-cache"
import { fitToBudget, type ContextBudget } from "./context-manager"
import { optimizePrefix, detectProvider } from "./prefix-optimizer"
import { estimateCost, MODEL_PRICING } from "./cost-estimator"
import { PromptTemplatePool, type TemplateConfig } from "./prompt-template-pool"
import { SemanticMinHashIndex, type MinHashConfig } from "./semantic-minhash"
import type { ChatMessage } from "./token-counter"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface TokenOptimizerConfig {
  /** Default model ID for cost calculations. Default: "gpt-4o" */
  model?: string

  /** Enable prompt compression (stopwords, patterns, structural). Default: true */
  compression?: boolean | CompressorConfig

  /** Enable conversation delta encoding (cross-turn dedup). Default: true */
  deltaEncoding?: boolean | DeltaEncoderConfig

  /** Enable adaptive output prediction (learns from actual responses). Default: true */
  adaptiveOutput?: boolean | AdaptiveOptimizerConfig

  /** Enable response cache (exact + fuzzy matching). Default: true */
  cache?: boolean | Partial<CacheConfig>

  /** Enable MinHash-based fuzzy cache index (O(1) lookup). Default: true */
  minhashIndex?: boolean | MinHashConfig

  /** Enable context budget management. Default: undefined (disabled unless configured) */
  contextBudget?: ContextBudget

  /** Enable prefix optimization for provider cache hits. Default: true */
  prefixOptimize?: boolean

  /** Template pool configuration. Default: enabled */
  templates?: boolean | TemplateConfig

  /** Persist learned data to IndexedDB. Default: true */
  persist?: boolean
}

export interface OptimizeResult {
  /** The optimized messages array */
  messages: { role: string; content: string }[]
  /** Total input tokens after optimization */
  totalTokens: number
  /** Total tokens saved across all techniques */
  totalSaved: number
  /** Breakdown of token savings by technique */
  savings: {
    compression: number
    deltaEncoding: number
    contextTrimming: number
    /** Estimated dollar savings from prefix caching (not tokens — prefix optimization doesn't reduce token count) */
    prefixCacheDollarSavings: number
  }
  /** Suggested max_tokens for the API call (from adaptive learning) */
  suggestedMaxTokens: number
  /** Whether a cached response was found */
  cacheHit: boolean
  /** The cached response text (if cacheHit is true) */
  cachedResponse?: string
  /** Estimated cost of this request in USD */
  estimatedCost: number
  /** Estimated cost without optimization in USD */
  estimatedCostWithout: number
  /** Dollar savings for this request */
  dollarSavings: number
}

// -------------------------------------------------------
// Token Optimizer
// -------------------------------------------------------

export class TokenOptimizer {
  private config: TokenOptimizerConfig
  private model: string

  /** Sub-modules (lazily initialized) */
  private adaptiveOptimizer: AdaptiveOutputOptimizer | null = null
  private responseCache: ResponseCache | null = null
  private minhashIndex: SemanticMinHashIndex<string> | null = null
  private templatePool: PromptTemplatePool | null = null

  private isHydrated = false

  constructor(config: TokenOptimizerConfig = {}) {
    this.config = config
    this.model = config.model ?? "gpt-4o"

    // Initialize sub-modules based on config
    if (config.adaptiveOutput !== false) {
      const adaptiveConfig = typeof config.adaptiveOutput === "object"
        ? config.adaptiveOutput
        : { persist: config.persist ?? true }
      this.adaptiveOptimizer = new AdaptiveOutputOptimizer(adaptiveConfig)
    }

    if (config.cache !== false) {
      const cacheConfig = typeof config.cache === "object"
        ? config.cache
        : {}
      this.responseCache = new ResponseCache(cacheConfig)
    }

    if (config.minhashIndex !== false) {
      const minhashConfig = typeof config.minhashIndex === "object"
        ? config.minhashIndex
        : {}
      this.minhashIndex = new SemanticMinHashIndex<string>(minhashConfig)
    }

    if (config.templates !== false) {
      const templateConfig = typeof config.templates === "object"
        ? config.templates
        : {}
      this.templatePool = new PromptTemplatePool(templateConfig)
    }
  }

  /**
   * Hydrate persisted data from IndexedDB. Call once on startup.
   */
  async hydrate(): Promise<void> {
    const promises: Promise<unknown>[] = []
    if (this.adaptiveOptimizer) promises.push(this.adaptiveOptimizer.hydrate())
    if (this.responseCache) promises.push(this.responseCache.hydrate())
    await Promise.all(promises)
    this.isHydrated = true
  }

  /**
   * Optimize a conversation for minimum token expenditure.
   *
   * Runs the full optimization pipeline:
   * 1. Check cache for an existing response
   * 2. Apply prompt compression to user messages
   * 3. Apply delta encoding to remove cross-turn redundancy
   * 4. Apply context budget trimming (if configured)
   * 5. Optimize message prefix for provider cache hits
   * 6. Predict optimal max_tokens via adaptive learning
   *
   * Each step is independently controlled via config.
   *
   * @param messages - The conversation messages to optimize
   * @param model - Optional model override (defaults to config.model)
   * @returns An {@link OptimizeResult} with optimized messages and complete savings breakdown
   */
  async optimize(
    messages: { role: string; content: string }[],
    model?: string
  ): Promise<OptimizeResult> {
    const effectiveModel = model ?? this.model
    const originalTokens = messages.reduce(
      (sum, m) => sum + countTokens(m.content) + 4, // +4 per message overhead
      3 // reply priming
    )

    const savings = {
      compression: 0,
      deltaEncoding: 0,
      contextTrimming: 0,
      prefixCacheDollarSavings: 0,
    }

    // Extract last user message for cache lookup and prediction
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
    const lastUserText = lastUserMsg?.content ?? ""

    // -- 1. CACHE CHECK --
    if (this.responseCache && lastUserText) {
      const lookup = await this.responseCache.lookup(lastUserText, effectiveModel)
      if (lookup.hit && lookup.entry) {
        // Also check MinHash index for fuzzy match
        return {
          messages,
          totalTokens: 0,
          totalSaved: originalTokens,
          savings,
          suggestedMaxTokens: 0,
          cacheHit: true,
          cachedResponse: lookup.entry.response,
          estimatedCost: 0,
          estimatedCostWithout: this.safeCost(effectiveModel, originalTokens, 500),
          dollarSavings: this.safeCost(effectiveModel, originalTokens, 500),
        }
      }

      // Try MinHash fuzzy lookup
      if (this.minhashIndex) {
        const minhashResult = this.minhashIndex.find(lastUserText, 0.85)
        if (minhashResult) {
          // The data stored in MinHash is the cache key — look up the full cache entry
          const cacheKey = minhashResult.entry.data
          if (typeof cacheKey === "string") {
            const cacheHit = await this.responseCache.lookup(cacheKey, effectiveModel)
            if (cacheHit.hit && cacheHit.entry) {
              return {
                messages,
                totalTokens: 0,
                totalSaved: originalTokens,
                savings,
                suggestedMaxTokens: 0,
                cacheHit: true,
                cachedResponse: cacheHit.entry.response,
                estimatedCost: 0,
                estimatedCostWithout: this.safeCost(effectiveModel, originalTokens, 500),
                dollarSavings: this.safeCost(effectiveModel, originalTokens, 500),
              }
            }
          }
        }
      }
    }

    let workingMessages = [...messages]

    // -- 2. PROMPT COMPRESSION --
    if (this.config.compression !== false) {
      const compressorConfig = typeof this.config.compression === "object"
        ? this.config.compression
        : {}
      const compressed = compressMessages(workingMessages, compressorConfig)
      savings.compression = compressed.totalSavedTokens
      workingMessages = compressed.messages
    }

    // -- 3. DELTA ENCODING --
    if (this.config.deltaEncoding !== false) {
      const deltaConfig = typeof this.config.deltaEncoding === "object"
        ? this.config.deltaEncoding
        : {}
      const delta = encodeDelta(workingMessages, deltaConfig)
      savings.deltaEncoding = delta.savedTokens
      if (delta.applied) {
        workingMessages = delta.messages
      }
    }

    // -- 4. CONTEXT BUDGET TRIMMING --
    if (this.config.contextBudget) {
      const contextMessages = workingMessages.map(m => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
      }))
      const trimResult = fitToBudget(contextMessages, this.config.contextBudget)
      savings.contextTrimming = trimResult.evictedTokens
      workingMessages = trimResult.messages
    }

    // -- 5. PREFIX OPTIMIZATION --
    if (this.config.prefixOptimize !== false) {
      const pricing = MODEL_PRICING[effectiveModel]
      if (pricing) {
        const chatMessages: ChatMessage[] = workingMessages.map(m => ({
          role: m.role as ChatMessage["role"],
          content: m.content,
        }))
        const prefixed = optimizePrefix(chatMessages, effectiveModel, pricing.inputPerMillion)
        savings.prefixCacheDollarSavings = prefixed.estimatedPrefixSavings
        workingMessages = prefixed.messages
      }
    }

    // -- 6. ADAPTIVE OUTPUT PREDICTION --
    let suggestedMaxTokens = 4096 // default blanket
    if (this.adaptiveOptimizer && lastUserText) {
      const prediction = this.adaptiveOptimizer.predict(lastUserText, effectiveModel)
      suggestedMaxTokens = prediction.suggestedMaxTokens
    }

    // Calculate final token counts and costs
    const finalTokens = workingMessages.reduce(
      (sum, m) => sum + countTokens(m.content) + 4,
      3
    )
    const totalSaved = savings.compression + savings.deltaEncoding + savings.contextTrimming

    const estimatedCost = this.safeCost(effectiveModel, finalTokens, suggestedMaxTokens)
    const estimatedCostWithout = this.safeCost(effectiveModel, originalTokens, 4096)

    return {
      messages: workingMessages,
      totalTokens: finalTokens,
      totalSaved,
      savings,
      suggestedMaxTokens,
      cacheHit: false,
      estimatedCost,
      estimatedCostWithout,
      dollarSavings: Math.max(0, estimatedCostWithout - estimatedCost) + savings.prefixCacheDollarSavings,
    }
  }

  /**
   * Record an actual API response for adaptive learning and caching.
   *
   * Call this after every API response to:
   * - Update the adaptive output predictor with actual token counts
   * - Store the response in the cache for future lookups
   * - Index the prompt in MinHash for fuzzy matching
   *
   * @param prompt - The user prompt that was sent
   * @param response - The model's response text
   * @param model - The model that generated the response
   * @param inputTokens - Actual input token count from the API response
   * @param outputTokens - Actual output token count from the API response
   */
  async recordResponse(
    prompt: string,
    response: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    const promises: Promise<void>[] = []

    // Update adaptive output predictions
    if (this.adaptiveOptimizer) {
      promises.push(this.adaptiveOptimizer.recordActual(prompt, model, outputTokens))
    }

    // Store in response cache
    if (this.responseCache) {
      promises.push(this.responseCache.store(prompt, response, model, inputTokens, outputTokens))
    }

    // Index in MinHash for fuzzy matching
    if (this.minhashIndex) {
      this.minhashIndex.insert(prompt, prompt) // store prompt as data for cache lookup
    }

    await Promise.all(promises)
  }

  /**
   * Register a prompt template for pre-tokenization.
   *
   * @param name - Template name
   * @param template - Template string with {{variable}} placeholders
   */
  registerTemplate(name: string, template: string): void {
    if (this.templatePool) {
      this.templatePool.register(name, template)
    }
  }

  /**
   * Render a registered template with exact token counting.
   *
   * @param name - Template name
   * @param variables - Variable values
   * @returns Rendered text and token counts
   */
  renderTemplate(name: string, variables: Record<string, string>) {
    if (!this.templatePool) {
      throw new Error("Template pool is disabled")
    }
    return this.templatePool.render(name, variables)
  }

  /**
   * Get a comprehensive summary of all optimization statistics.
   */
  summary(): {
    cache: { entries: number; hitRate: number; totalSavedTokens: number } | null
    minhash: { entries: number; totalBuckets: number } | null
    adaptive: { taskTypes: number; totalObservations: number } | null
    templates: { templates: number; totalUses: number } | null
  } {
    return {
      cache: this.responseCache?.stats() ?? null,
      minhash: this.minhashIndex ? this.minhashIndex.stats() : null,
      adaptive: this.adaptiveOptimizer ? (() => {
        const s = this.adaptiveOptimizer!.summary()
        return { taskTypes: s.totalTaskTypes, totalObservations: s.totalObservations }
      })() : null,
      templates: this.templatePool ? this.templatePool.stats() : null,
    }
  }

  /** Clear all cached and learned data. */
  async clear(): Promise<void> {
    const promises: Promise<void>[] = []
    if (this.responseCache) promises.push(this.responseCache.clear())
    if (this.adaptiveOptimizer) promises.push(this.adaptiveOptimizer.clear())
    this.minhashIndex?.clear()
    this.templatePool?.clear()
    await Promise.all(promises)
  }

  /** Get the adaptive output optimizer instance. */
  getAdaptiveOptimizer(): AdaptiveOutputOptimizer | null {
    return this.adaptiveOptimizer
  }

  /** Get the response cache instance. */
  getCache(): ResponseCache | null {
    return this.responseCache
  }

  /** Get the MinHash index instance. */
  getMinHashIndex(): SemanticMinHashIndex<string> | null {
    return this.minhashIndex
  }

  /** Get the template pool instance. */
  getTemplatePool(): PromptTemplatePool | null {
    return this.templatePool
  }

  private safeCost(model: string, inputTokens: number, outputTokens: number): number {
    try {
      return estimateCost(model, inputTokens, outputTokens).totalCost
    } catch {
      return 0
    }
  }
}

/**
 * Create a TokenOptimizer with sensible defaults.
 *
 * This is the recommended entry point for using all TokenShield
 * optimization features together. All sub-modules are enabled by default.
 *
 * @param config - Optional configuration overrides
 * @returns A new TokenOptimizer instance
 * @example
 * ```ts
 * const optimizer = createTokenOptimizer({ model: "gpt-4o" })
 * await optimizer.hydrate() // load persisted data
 *
 * const result = await optimizer.optimize(messages)
 * console.log(`Saved ${result.totalSaved} tokens ($${result.dollarSavings.toFixed(4)})`)
 *
 * // After API response:
 * await optimizer.recordResponse(prompt, response, "gpt-4o", 500, 200)
 * ```
 */
export function createTokenOptimizer(config: TokenOptimizerConfig = {}): TokenOptimizer {
  return new TokenOptimizer(config)
}
