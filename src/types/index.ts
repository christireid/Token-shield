/**
 * token-shield — Core type definitions.
 *
 * All public types are exported from the package root.
 */

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** A chat message in the standard role/content format. */
export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}

// ---------------------------------------------------------------------------
// Shield Options
// ---------------------------------------------------------------------------

/** Configuration for the semantic cache. */
export interface CacheOptions {
  /** Maximum number of entries before LRU eviction. Default: 500. */
  maxEntries?: number
  /** Time-to-live in milliseconds. Default: 3_600_000 (1 hour). */
  ttlMs?: number
  /** Similarity threshold (0–1) for fuzzy matching. 1 = exact only. Default: 0.85. */
  similarityThreshold?: number
}

/** Configuration for prompt compression. */
export interface CompressionOptions {
  /** Collapse whitespace and remove markdown noise. Default: true. */
  structural?: boolean
  /** Remove filler words that add tokens but not meaning. Default: true. */
  stopwords?: boolean
  /** Deduplicate repeated sentences. Default: true. */
  dedup?: boolean
  /** Shorten common verbose patterns. Default: true. */
  patterns?: boolean
  /** Replace repeated entity mentions with abbreviations. Default: true. */
  references?: boolean
  /** Minimum token savings to apply compression. Default: 5. */
  minSavingsTokens?: number
  /** Patterns to preserve verbatim (e.g. code blocks, URLs). */
  preservePatterns?: RegExp[]
}

/**
 * Top-level configuration for `createShield` and `withShield`.
 *
 * Every option is optional — sensible defaults are applied.
 */
export interface ShieldOptions {
  /** Enable or configure the semantic cache. `true` uses defaults. Default: true. */
  cache?: boolean | CacheOptions
  /** Enable or configure prompt compression. `true` uses defaults. Default: true. */
  compression?: boolean | CompressionOptions
  /** Enable cost tracking. Default: true. */
  costTracking?: boolean
  /** Default model for cost estimation when not specified per-request. */
  model?: string
}

// ---------------------------------------------------------------------------
// Shield Stats
// ---------------------------------------------------------------------------

/** Cumulative statistics from a Shield instance. */
export interface ShieldStats {
  /** Total requests processed. */
  requests: number
  /** Number of cache hits (exact + fuzzy). */
  cacheHits: number
  /** Number of cache misses. */
  cacheMisses: number
  /** Cache hit rate (0–1). */
  cacheHitRate: number
  /** Total input tokens saved by compression. */
  compressionTokensSaved: number
  /** Total input tokens saved by cache hits (input + output tokens not re-generated). */
  cacheTokensSaved: number
  /** Combined total tokens saved (compression + cache). */
  totalTokensSaved: number
  /** Total input tokens processed (before savings). */
  totalInputTokens: number
  /** Total output tokens recorded. */
  totalOutputTokens: number
  /** Estimated total cost in USD (for known models). */
  totalEstimatedCost: number
  /** Estimated cost saved in USD. */
  estimatedCostSaved: number
}

// ---------------------------------------------------------------------------
// Process result
// ---------------------------------------------------------------------------

/** Result of processing a request through the shield. */
export interface ProcessResult {
  /** Possibly compressed messages to send to the LLM. */
  messages: Message[]
  /** Non-null when a cache hit occurred. */
  cached: { response: string; matchType: "exact" | "fuzzy"; similarity: number } | null
  /** Whether compression was applied. */
  compressed: boolean
  /** Input token count before processing. */
  originalTokens: number
  /** Input token count after processing. */
  processedTokens: number
  /** Tokens saved by compression on this request. */
  tokensSaved: number
}

// ---------------------------------------------------------------------------
// Cost types
// ---------------------------------------------------------------------------

/** Cost estimate for a single LLM request. */
export interface CostEstimate {
  /** Model identifier. */
  model: string
  /** Provider name (openai, anthropic, google). */
  provider: string
  /** Number of input tokens. */
  inputTokens: number
  /** Number of output tokens. */
  outputTokens: number
  /** Input cost in USD. */
  inputCost: number
  /** Output cost in USD. */
  outputCost: number
  /** Total cost in USD. */
  totalCost: number
  /**
   * Whether the model is known in the pricing registry.
   * When false, costs are explicitly marked as unknown.
   */
  known: boolean
}

/** Accumulated cost tracking data. */
export interface CostTrackerStats {
  /** Total requests tracked. */
  requests: number
  /** Total input tokens across all requests. */
  totalInputTokens: number
  /** Total output tokens across all requests. */
  totalOutputTokens: number
  /** Total estimated cost in USD. */
  totalCost: number
  /** Breakdown by model. */
  byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }>
}

// ---------------------------------------------------------------------------
// Compression result
// ---------------------------------------------------------------------------

/** Result from the prompt compression pipeline. */
export interface CompressionResult {
  /** The (possibly compressed) text. */
  compressed: string
  /** Original token count. */
  originalTokens: number
  /** Token count after compression. */
  compressedTokens: number
  /** Tokens saved. */
  savedTokens: number
  /** Compression ratio (compressed / original). Lower = more compression. */
  ratio: number
  /** Which techniques contributed savings. */
  techniques: { name: string; tokensSaved: number }[]
  /** Whether compression was actually applied. */
  applied: boolean
}
