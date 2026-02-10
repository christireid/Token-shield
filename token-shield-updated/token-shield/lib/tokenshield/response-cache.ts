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
}

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  similarityThreshold: 0.85,
  storeName: "tokenshield-cache",
}

// In-memory map for fast lookups without hitting IDB every time
let memoryCache = new Map<string, CacheEntry>()
let idbStore: ReturnType<typeof createStore> | null = null

function getStore(config: CacheConfig) {
  if (typeof window === "undefined") return null
  if (!idbStore) {
    idbStore = createStore(config.storeName, "responses")
  }
  return idbStore
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

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1
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
 */
function hashKey(text: string): string {
  const normalized = normalizeText(text)
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0
  }
  return `ts_${(hash >>> 0).toString(36)}`
}

export class ResponseCache {
  private config: CacheConfig

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
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
    const key = hashKey(prompt)

    // 1. Exact match from memory
    const memHit = memoryCache.get(key)
    if (memHit && (!model || memHit.model === model)) {
      if (Date.now() - memHit.createdAt < this.config.ttlMs) {
        memHit.accessCount++
        memHit.lastAccessed = Date.now()
        return { hit: true, entry: memHit, matchType: "exact", similarity: 1 }
      }
      // Expired
      memoryCache.delete(key)
    }

    // 2. Exact match from IDB
    try {
      const store = getStore(this.config)
      if (!store) throw new Error("no idb")
      const idbHit = await get<CacheEntry>(key, store)
      if (idbHit && (!model || idbHit.model === model)) {
        if (Date.now() - idbHit.createdAt < this.config.ttlMs) {
          idbHit.accessCount++
          idbHit.lastAccessed = Date.now()
          memoryCache.set(key, idbHit)
          await set(key, idbHit, store)
          return {
            hit: true,
            entry: idbHit,
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
      let bestMatch: CacheEntry | undefined
      let bestSimilarity = 0

      for (const entry of memoryCache.values()) {
        if (model && entry.model !== model) continue
        if (Date.now() - entry.createdAt >= this.config.ttlMs) continue

        const sim = textSimilarity(prompt, entry.prompt)
        if (sim > bestSimilarity && sim >= this.config.similarityThreshold) {
          bestSimilarity = sim
          bestMatch = entry
        }
      }

      if (bestMatch) {
        bestMatch.accessCount++
        bestMatch.lastAccessed = Date.now()
        return {
          hit: true,
          entry: bestMatch,
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
    const key = hashKey(prompt)
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

    memoryCache.set(key, entry)

    // Evict LRU if over capacity
    if (memoryCache.size > this.config.maxEntries) {
      let oldestKey = ""
      let oldestAccess = Infinity
      for (const [k, v] of memoryCache) {
        if (v.lastAccessed < oldestAccess) {
          oldestAccess = v.lastAccessed
          oldestKey = k
        }
      }
      if (oldestKey) memoryCache.delete(oldestKey)
    }

    // Persist to IDB
    try {
      const store = getStore(this.config)
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
      const store = getStore(this.config)
      if (!store) return 0
      const allKeys = await keys<string>(store)
      let loaded = 0
      for (const key of allKeys) {
        const entry = await get<CacheEntry>(key, store)
        if (entry && Date.now() - entry.createdAt < this.config.ttlMs) {
          memoryCache.set(key, entry)
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
    for (const entry of memoryCache.values()) {
      totalSavedTokens +=
        (entry.inputTokens + entry.outputTokens) * entry.accessCount
      totalHits += entry.accessCount
    }
    return {
      entries: memoryCache.size,
      totalSavedTokens,
      totalHits,
    }
  }

  /**
   * Clear all cached entries.
   */
  async clear(): Promise<void> {
    memoryCache = new Map()
    try {
      const store = getStore(this.config)
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
