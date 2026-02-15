/**
 * TokenShield - Response Cache
 *
 * Client-side cache with two layers:
 * 1. Exact match: hash-based lookup for identical prompts
 * 2. Fuzzy match: normalized text similarity for near-duplicate prompts
 *
 * Uses idb-keyval for IndexedDB persistence (573 bytes, zero deps).
 * Cache hits = zero API calls = zero cost.
 *
 * npm dependencies: idb-keyval
 */

import { get, set, del, keys, createStore } from "./storage-adapter"
import { NeuroElasticEngine } from "./neuro-elastic"

/**
 * Content type classification for TTL-aware caching.
 * Different content types have different staleness characteristics:
 * - "factual": Stable facts (capitals, definitions) — long TTL
 * - "general": General knowledge, explanations — medium TTL
 * - "time-sensitive": Current events, prices, weather — short TTL
 */
export type ContentType = "factual" | "general" | "time-sensitive"

export interface CacheEntry {
  key: string
  normalizedKey: string
  prompt: string
  response: string
  model: string
  inputTokens: number
  outputTokens: number
  createdAt: number
  accessCount: number
  lastAccessed: number
  /** Detected content type for TTL resolution */
  contentType: ContentType
}

export interface CacheConfig {
  /** Max entries before LRU eviction */
  maxEntries: number
  /** Default max age in ms before entry expires (used for "general" content) */
  ttlMs: number
  /**
   * Per-content-type TTL overrides in milliseconds.
   * Falls back to `ttlMs` for any unset category.
   * - factual: Stable facts (e.g. "What is the capital of France?") — default 7 days
   * - general: General knowledge, explanations — default 24 hours (same as ttlMs)
   * - time-sensitive: Current events, prices, weather — default 5 minutes
   */
  ttlByContentType?: Partial<Record<ContentType, number>>
  /** Similarity threshold for fuzzy matching (0-1). 1 = exact only */
  similarityThreshold: number
  /** IndexedDB store name */
  storeName: string
  /**
   * Similarity encoding strategy:
   * - "bigram" (default): Fast bigram Dice coefficient — good for near-duplicates
   * - "holographic": Trigram-based holographic encoding with semantic seeding — better for paraphrases
   */
  encodingStrategy?: "bigram" | "holographic"
  /**
   * Semantic seeds for holographic encoding. Maps domain terms to seed angles.
   * Terms sharing the same seed value will be encoded closer together.
   * Only used when encodingStrategy is "holographic".
   * @example { cost: 10, price: 10, billing: 10, budget: 10 }
   */
  semanticSeeds?: Record<string, number>
}

/** Default per-content-type TTL values */
const DEFAULT_CONTENT_TTL: Record<ContentType, number> = {
  factual: 7 * 24 * 60 * 60 * 1000, // 7 days
  general: 24 * 60 * 60 * 1000, // 24 hours
  "time-sensitive": 5 * 60 * 1000, // 5 minutes
}

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  similarityThreshold: 0.85,
  storeName: "tokenshield-cache",
}

// -------------------------------------------------------
// Content-Type Classification
// -------------------------------------------------------

/** Patterns that indicate factual, stable content (long cache life) */
const FACTUAL_PATTERNS: RegExp[] = [
  /^(what|who|where|which)\s+(is|are|was|were)\s+(the|a|an)\b/i,
  /\b(capital of|definition of|meaning of|formula for)\b/i,
  /\b(invented|discovered|founded|born|died)\b.*\b(in|by|at)\b/i,
  /\b(how many|how much)\b.*\b(in a|per)\b/i,
  /\b(convert|conversion)\b.*\b(to|from)\b/i,
  /\b(element|symbol|atomic|molecule|chemical)\b/i,
  /\b(population|area|height|distance|length|weight)\b.*\b(of)\b/i,
]

/** Patterns that indicate time-sensitive content (short cache life) */
const TIME_SENSITIVE_PATTERNS: RegExp[] = [
  /\b(today|tonight|yesterday|tomorrow|this week|this month|this year)\b/i,
  /\b(current|latest|recent|now|live|real[- ]?time)\b/i,
  /\b(stock price|market|trading|crypto|bitcoin|eth)\b/i,
  /\b(weather|forecast|temperature)\b/i,
  /\b(news|headline|breaking|trending|viral)\b/i,
  /\b(score|game|match|playoff|tournament)\b.*\b(today|tonight|now|live)\b/i,
  /\b(schedule|upcoming|next game|when does)\b/i,
  /\b(election|poll|vote|ballot)\b.*\b(result|count|update)\b/i,
  /\b(status|outage|incident|downtime)\b/i,
  /\b(20\d{2})\b/i, // Year references often indicate time-sensitivity
]

/**
 * Classify a prompt's content type for TTL resolution.
 * Returns "factual" for stable facts, "time-sensitive" for current/live data,
 * and "general" as the default for everything else.
 */
export function classifyContentType(prompt: string): ContentType {
  // Check time-sensitive first — if the prompt mentions "current", "today", etc.,
  // even a factual question like "What is the current population of France?" is time-sensitive
  for (const pattern of TIME_SENSITIVE_PATTERNS) {
    if (pattern.test(prompt)) return "time-sensitive"
  }

  for (const pattern of FACTUAL_PATTERNS) {
    if (pattern.test(prompt)) return "factual"
  }

  return "general"
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace,
 * remove punctuation, trim. This catches near-duplicate prompts
 * like "What is React?" vs "what is react" vs "What is React"
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Simple but effective string similarity using bigram overlap.
 * Returns 0-1 (1 = identical). This runs in O(n) and is good enough
 * for catching rephrased prompts without needing embeddings.
 */
export function textSimilarity(a: string, b: string): number {
  const aNorm = normalizeText(a)
  const bNorm = normalizeText(b)

  if (aNorm === bNorm) return 1

  // Bigram-based Dice coefficient
  const bigramsA = new Set<string>()
  const bigramsB = new Set<string>()

  for (let i = 0; i < aNorm.length - 1; i++) {
    bigramsA.add(aNorm.slice(i, i + 2))
  }
  for (let i = 0; i < bNorm.length - 1; i++) {
    bigramsB.add(bNorm.slice(i, i + 2))
  }

  if (bigramsA.size === 0 && bigramsB.size === 0) return aNorm.length === bNorm.length ? 1 : 0
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let intersection = 0
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

/**
 * Generate a hash key for exact-match lookups.
 * Uses a fast djb2 hash - no crypto needed for cache keys.
 * Includes the model ID so that different models produce different cache keys,
 * preventing cross-model contamination (e.g. a gpt-4o response being served
 * for a gpt-4o-mini request).
 */
function hashKey(text: string, model?: string): string {
  const normalized = normalizeText(text)
  const input = model ? `${normalized}|model:${model}` : normalized
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return `ts_${(hash >>> 0).toString(36)}`
}

export class ResponseCache {
  private config: CacheConfig
  /** Per-instance in-memory map for fast lookups without hitting IDB every time */
  private memoryCache = new Map<string, CacheEntry>()
  /** Per-instance IDB store (lazy-initialized on first access) */
  private idbStore: ReturnType<typeof createStore> | null = null
  /** Optional holographic encoding engine for enhanced fuzzy matching */
  private holoEngine: NeuroElasticEngine | null = null
  /** Total lookup() calls (hits + misses) for accurate hit rate calculation */
  private totalLookups = 0
  /** Total cache hits across all lookup() calls */
  private totalHits = 0

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Initialize holographic engine if strategy is set
    if (this.config.encodingStrategy === "holographic") {
      this.holoEngine = new NeuroElasticEngine({
        threshold: this.config.similarityThreshold,
        seeds: this.config.semanticSeeds,
        maxMemories: this.config.maxEntries,
        enableInhibition: true,
        persist: false, // Persistence handled by ResponseCache's own IDB
      })
    }
  }

  /** Resolve the TTL for a cache entry based on its content type */
  private getTtl(contentType: ContentType): number {
    // Check explicit per-content-type overrides first
    const overrides = this.config.ttlByContentType
    if (overrides && overrides[contentType] !== undefined) {
      return overrides[contentType]!
    }
    // For "general" content, respect the user-configured ttlMs (backward compat)
    if (contentType === "general") {
      return this.config.ttlMs
    }
    // For factual/time-sensitive, use built-in defaults
    return DEFAULT_CONTENT_TTL[contentType]
  }

  /** Check if a cache entry has expired */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt >= this.getTtl(entry.contentType)
  }

  private getStore(): ReturnType<typeof createStore> | null {
    if (typeof window === "undefined") return null
    if (!this.idbStore) {
      this.idbStore = createStore(this.config.storeName, "responses")
    }
    return this.idbStore
  }

  /**
   * Copy-on-read: create a new entry with incremented access count.
   * Avoids shared mutable state across concurrent lookups.
   */
  private touchEntry(entry: CacheEntry): CacheEntry {
    return {
      ...entry,
      accessCount: entry.accessCount + 1,
      lastAccessed: Date.now(),
    }
  }

  /**
   * Read-only cache probe. Returns hit/miss info without mutating
   * access counts or timestamps. Used by dry-run mode to avoid
   * side-effects while still reporting what would happen.
   */
  peek(
    prompt: string,
    model: string,
  ): { hit: boolean; matchType?: "exact" | "fuzzy"; similarity?: number; entry?: CacheEntry } {
    const key = hashKey(prompt, model)
    const normalized = normalizeText(prompt)

    // Exact match from memory only (no IDB, no mutations)
    const memHit = this.memoryCache.get(key)
    if (memHit && !this.isExpired(memHit)) {
      // Verify normalized prompt matches to guard against djb2 hash collisions
      if (memHit.normalizedKey === normalized) {
        return { hit: true, entry: memHit, matchType: "exact", similarity: 1 }
      }
    }

    // Fuzzy match from memory (read-only scan)
    if (this.config.similarityThreshold < 1) {
      let bestMatch: CacheEntry | undefined
      let bestSimilarity = 0
      for (const entry of this.memoryCache.values()) {
        if (model && entry.model !== model) continue
        if (this.isExpired(entry)) continue
        const sim = textSimilarity(prompt, entry.prompt)
        if (sim > bestSimilarity && sim >= this.config.similarityThreshold) {
          bestSimilarity = sim
          bestMatch = entry
        }
      }
      if (bestMatch) {
        return { hit: true, entry: bestMatch, matchType: "fuzzy", similarity: bestSimilarity }
      }
    }

    return { hit: false }
  }

  /**
   * Look up a cached response. Checks exact match first, then fuzzy.
   */
  async lookup(
    prompt: string,
    model: string,
  ): Promise<{
    hit: boolean
    entry?: CacheEntry
    matchType?: "exact" | "fuzzy"
    similarity?: number
  }> {
    const key = hashKey(prompt, model)
    const normalized = normalizeText(prompt)
    this.totalLookups++

    // 1. Exact match from memory (key is already model-scoped)
    const memHit = this.memoryCache.get(key)
    if (memHit) {
      if (!this.isExpired(memHit)) {
        // Verify normalized prompt matches to guard against djb2 hash collisions
        if (memHit.normalizedKey === normalized) {
          const updated = this.touchEntry(memHit)
          this.memoryCache.set(key, updated)
          this.totalHits++
          return { hit: true, entry: updated, matchType: "exact", similarity: 1 }
        }
      } else {
        this.memoryCache.delete(key)
      }
    }

    // 2. Exact match from IDB
    const lookupStore = this.getStore()
    if (lookupStore) {
      try {
        const idbHit = await get<CacheEntry>(key, lookupStore)
        if (idbHit) {
          if (!this.isExpired(idbHit)) {
            // Verify normalized prompt matches to guard against hash collisions
            if (idbHit.normalizedKey === normalized) {
              const updated = this.touchEntry(idbHit)
              this.memoryCache.set(key, updated)
              await set(key, updated, lookupStore)
              this.totalHits++
              return {
                hit: true,
                entry: updated,
                matchType: "exact",
                similarity: 1,
              }
            }
          }
          await del(key, lookupStore)
        }
      } catch (err) {
        // IDB read failed — fall through to fuzzy match (in-memory)
        // eslint-disable-next-line no-console
        console.warn("[TokenShield] Cache IDB read failed, falling back to in-memory lookup:", err)
      }
    }

    // 3. Fuzzy match against memory cache
    if (this.config.similarityThreshold < 1) {
      // 3a. Holographic encoding (enhanced paraphrase detection)
      if (this.holoEngine) {
        const holoResult = this.holoEngine.find(prompt, model)
        if (holoResult) {
          // Find the corresponding cache entry by prompt, with TTL check
          for (const [entryKey, entry] of this.memoryCache.entries()) {
            if (entry.prompt === holoResult.prompt && (!model || entry.model === model)) {
              if (this.isExpired(entry)) continue
              const updated = this.touchEntry(entry)
              this.memoryCache.set(entryKey, updated)
              this.totalHits++
              return {
                hit: true,
                entry: updated,
                matchType: "fuzzy",
                similarity: holoResult.score,
              }
            }
          }
        }
      }

      // 3b. Bigram fallback (original algorithm)
      let bestMatch: CacheEntry | undefined
      let bestSimilarity = 0

      for (const entry of this.memoryCache.values()) {
        if (model && entry.model !== model) continue
        if (this.isExpired(entry)) continue

        const sim = textSimilarity(prompt, entry.prompt)
        if (sim > bestSimilarity && sim >= this.config.similarityThreshold) {
          bestSimilarity = sim
          bestMatch = entry
        }
      }

      if (bestMatch) {
        const updated = this.touchEntry(bestMatch)
        this.memoryCache.set(updated.key, updated)
        this.totalHits++
        return {
          hit: true,
          entry: updated,
          matchType: "fuzzy",
          similarity: bestSimilarity,
        }
      }
    }

    return { hit: false }
  }

  /**
   * Store a response in the cache.
   */
  async store(
    prompt: string,
    response: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const key = hashKey(prompt, model)
    const entry: CacheEntry = {
      key,
      normalizedKey: normalizeText(prompt),
      prompt,
      response,
      model,
      inputTokens,
      outputTokens,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
      contentType: classifyContentType(prompt),
    }

    this.memoryCache.set(key, entry)

    // Teach the holographic engine about this entry
    if (this.holoEngine) {
      this.holoEngine.learn(prompt, response, model, inputTokens, outputTokens).catch(() => {})
    }

    // Evict LRU if over capacity
    if (this.memoryCache.size > this.config.maxEntries) {
      let oldestKey = ""
      let oldestAccess = Infinity
      for (const [k, v] of this.memoryCache) {
        if (v.lastAccessed < oldestAccess) {
          oldestAccess = v.lastAccessed
          oldestKey = k
        }
      }
      if (oldestKey) {
        this.memoryCache.delete(oldestKey)
        // Evict from IDB to keep stores coherent
        try {
          const store = this.getStore()
          if (store) del(oldestKey, store).catch(() => {})
        } catch {
          /* IDB not available */
        }
      }
    }

    // Persist to IDB
    const persistStore = this.getStore()
    if (persistStore) {
      try {
        await set(key, entry, persistStore)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[TokenShield] Cache IDB write failed (SSR or quota exceeded):", err)
      }
    }
  }

  /**
   * Load cache from IDB into memory on startup.
   */
  async hydrate(): Promise<number> {
    try {
      const store = this.getStore()
      if (!store) return 0
      const allKeys = (await keys(store)) as string[]
      let loaded = 0
      for (const key of allKeys) {
        const entry = (await get(key, store)) as CacheEntry | undefined
        if (entry) {
          // Backfill contentType for entries created before this feature
          if (!entry.contentType) {
            entry.contentType = classifyContentType(entry.prompt)
          }
        }
        if (entry && !this.isExpired(entry)) {
          this.memoryCache.set(key, entry)
          // Populate holographic engine so fuzzy matching works after reload
          if (this.holoEngine) {
            this.holoEngine
              .learn(
                entry.prompt,
                entry.response,
                entry.model,
                entry.inputTokens,
                entry.outputTokens,
              )
              .catch(() => {})
          }
          loaded++
        } else if (entry) {
          await del(key, store) // clean expired
        }
      }
      return loaded
    } catch {
      return 0
    }
  }

  /**
   * Get cache statistics.
   */
  stats(): {
    entries: number
    totalSavedTokens: number
    totalHits: number
    totalLookups: number
    hitRate: number
  } {
    let totalSavedTokens = 0
    for (const entry of this.memoryCache.values()) {
      totalSavedTokens += (entry.inputTokens + entry.outputTokens) * entry.accessCount
    }
    return {
      entries: this.memoryCache.size,
      totalSavedTokens,
      totalHits: this.totalHits,
      totalLookups: this.totalLookups,
      hitRate: this.totalLookups > 0 ? this.totalHits / this.totalLookups : 0,
    }
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.memoryCache.clear()
    this.totalLookups = 0
    this.totalHits = 0
    if (this.holoEngine) {
      await this.holoEngine.clear()
    }
    try {
      const store = this.getStore()
      if (!store) return
      const allKeys = (await keys(store)) as string[]
      for (const key of allKeys) {
        await del(key, store)
      }
    } catch {
      // IDB not available
    }
  }
}
