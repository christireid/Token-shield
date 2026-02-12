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

import { get, set, del, keys, createStore } from "idb-keyval"
import { NeuroElasticEngine, type NeuroElasticConfig } from "./neuro-elastic"

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
}

export interface CacheConfig {
  /** Max entries before LRU eviction */
  maxEntries: number
  /** Max age in ms before entry expires */
  ttlMs: number
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

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  similarityThreshold: 0.85,
  storeName: "tokenshield-cache",
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

  private getStore(): ReturnType<typeof createStore> | null {
    if (typeof window === "undefined") return null
    if (!this.idbStore) {
      this.idbStore = createStore(this.config.storeName, "responses")
    }
    return this.idbStore
  }

  /**
   * Look up a cached response. Checks exact match first, then fuzzy.
   */
  async lookup(
    prompt: string,
    model?: string
  ): Promise<{
    hit: boolean
    entry?: CacheEntry
    matchType?: "exact" | "fuzzy"
    similarity?: number
  }> {
    const key = hashKey(prompt, model)

    // 1. Exact match from memory (key is already model-scoped)
    const memHit = this.memoryCache.get(key)
    if (memHit) {
      if (Date.now() - memHit.createdAt < this.config.ttlMs) {
        // Copy-on-read: create a new object to avoid shared mutable state
        // across concurrent lookups that could cause inconsistent IDB writes
        const updated: CacheEntry = { ...memHit, accessCount: memHit.accessCount + 1, lastAccessed: Date.now() }
        this.memoryCache.set(key, updated)
        return { hit: true, entry: updated, matchType: "exact", similarity: 1 }
      }
      // Expired
      this.memoryCache.delete(key)
    }

    // 2. Exact match from IDB
    try {
      const store = this.getStore()
      if (!store) throw new Error("no idb")
      const idbHit = await get<CacheEntry>(key, store)
      if (idbHit) {
        if (Date.now() - idbHit.createdAt < this.config.ttlMs) {
          // Copy-on-read: create a fresh object before mutating and storing
          const updated: CacheEntry = { ...idbHit, accessCount: idbHit.accessCount + 1, lastAccessed: Date.now() }
          this.memoryCache.set(key, updated)
          await set(key, updated, store)
          return {
            hit: true,
            entry: updated,
            matchType: "exact",
            similarity: 1,
          }
        }
        await del(key, store)
      }
    } catch {
      // IDB not available (SSR), fall through
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
              // TTL check — skip expired entries
              if (Date.now() - entry.createdAt >= this.config.ttlMs) continue
              const updated: CacheEntry = { ...entry, accessCount: entry.accessCount + 1, lastAccessed: Date.now() }
              this.memoryCache.set(entryKey, updated)
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
        if (Date.now() - entry.createdAt >= this.config.ttlMs) continue

        const sim = textSimilarity(prompt, entry.prompt)
        if (sim > bestSimilarity && sim >= this.config.similarityThreshold) {
          bestSimilarity = sim
          bestMatch = entry
        }
      }

      if (bestMatch) {
        const updated: CacheEntry = { ...bestMatch, accessCount: bestMatch.accessCount + 1, lastAccessed: Date.now() }
        this.memoryCache.set(updated.key, updated)
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
    outputTokens: number
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
        } catch { /* IDB not available */ }
      }
    }

    // Persist to IDB
    try {
      const store = this.getStore()
      if (!store) throw new Error("no idb")
      await set(key, entry, store)
    } catch {
      // IDB not available (SSR)
    }
  }

  /**
   * Load cache from IDB into memory on startup.
   */
  async hydrate(): Promise<number> {
    try {
      const store = this.getStore()
      if (!store) return 0
      const allKeys = await keys<string>(store)
      let loaded = 0
      for (const key of allKeys) {
        const entry = await get<CacheEntry>(key, store)
        if (entry && Date.now() - entry.createdAt < this.config.ttlMs) {
          this.memoryCache.set(key, entry)
          // Populate holographic engine so fuzzy matching works after reload
          if (this.holoEngine) {
            this.holoEngine.learn(entry.prompt, entry.response, entry.model, entry.inputTokens, entry.outputTokens).catch(() => {})
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
  } {
    let totalSavedTokens = 0
    let totalHits = 0
    for (const entry of this.memoryCache.values()) {
      totalSavedTokens +=
        (entry.inputTokens + entry.outputTokens) * entry.accessCount
      totalHits += entry.accessCount
    }
    return {
      entries: this.memoryCache.size,
      totalSavedTokens,
      totalHits,
    }
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    this.memoryCache.clear()
    if (this.holoEngine) {
      await this.holoEngine.clear()
    }
    try {
      const store = this.getStore()
      if (!store) return
      const allKeys = await keys<string>(store)
      for (const key of allKeys) {
        await del(key, store)
      }
    } catch {
      // IDB not available
    }
  }
}
