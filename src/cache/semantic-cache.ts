/**
 * token-shield — Semantic cache.
 *
 * In-memory cache with two layers:
 * 1. Exact match: hash-based lookup for identical prompts (model-scoped)
 * 2. Fuzzy match: bigram Dice similarity for near-duplicate prompts
 *
 * Cache keys are namespaced by model to prevent cross-model contamination.
 * No browser APIs (IndexedDB, window) — works in Node.js and Edge runtimes.
 */

import { hashKey, normalizeText, textSimilarity } from "./normalize"

/** A single cache entry. */
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

/** Configuration for the semantic cache. */
export interface SemanticCacheConfig {
  /** Maximum entries before LRU eviction. Default: 500. */
  maxEntries?: number
  /** Time-to-live in milliseconds. Default: 3_600_000 (1 hour). */
  ttlMs?: number
  /** Similarity threshold (0–1) for fuzzy matching. 1 = exact only. Default: 0.85. */
  similarityThreshold?: number
}

const DEFAULTS: Required<SemanticCacheConfig> = {
  maxEntries: 500,
  ttlMs: 3_600_000,
  similarityThreshold: 0.85,
}

/** Cache lookup result. */
export interface CacheLookupResult {
  hit: boolean
  entry?: CacheEntry
  matchType?: "exact" | "fuzzy"
  similarity?: number
}

/**
 * Create a semantic cache instance.
 *
 * @example
 * ```ts
 * const cache = semanticCache({ maxEntries: 200, ttlMs: 1800000 });
 * cache.store("What is TS?", "TypeScript is...", "gpt-4o", 10, 50);
 * const result = cache.lookup("what is typescript?", "gpt-4o");
 * // result.hit === true, result.matchType === "fuzzy"
 * ```
 */
export function semanticCache(config?: SemanticCacheConfig): SemanticCache {
  return new SemanticCacheImpl(config)
}

/** Semantic cache instance. */
export interface SemanticCache {
  /** Look up a cached response. Checks exact match first, then fuzzy. */
  lookup(prompt: string, model: string): CacheLookupResult
  /** Store a response in the cache. */
  store(prompt: string, response: string, model: string, inputTokens: number, outputTokens: number): void
  /** Get cache statistics. */
  stats(): { entries: number; totalHits: number; totalLookups: number; hitRate: number; totalSavedTokens: number }
  /** Clear all entries. */
  clear(): void
}

class SemanticCacheImpl implements SemanticCache {
  private config: Required<SemanticCacheConfig>
  private entries = new Map<string, CacheEntry>()
  private totalLookups = 0
  private totalHits = 0

  constructor(config?: SemanticCacheConfig) {
    this.config = { ...DEFAULTS, ...config }
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.createdAt >= this.config.ttlMs
  }

  lookup(prompt: string, model: string): CacheLookupResult {
    this.totalLookups++
    const key = hashKey(prompt, model)
    const normalized = normalizeText(prompt)

    // 1. Exact match
    const exact = this.entries.get(key)
    if (exact && !this.isExpired(exact) && exact.normalizedKey === normalized) {
      exact.accessCount++
      exact.lastAccessed = Date.now()
      this.totalHits++
      return { hit: true, entry: exact, matchType: "exact", similarity: 1 }
    }
    if (exact && this.isExpired(exact)) {
      this.entries.delete(key)
    }

    // 2. Fuzzy match
    if (this.config.similarityThreshold < 1) {
      let bestMatch: CacheEntry | undefined
      let bestSim = 0

      for (const entry of this.entries.values()) {
        if (entry.model !== model) continue
        if (this.isExpired(entry)) continue
        const sim = textSimilarity(prompt, entry.prompt)
        if (sim > bestSim && sim >= this.config.similarityThreshold) {
          bestSim = sim
          bestMatch = entry
        }
      }

      if (bestMatch) {
        bestMatch.accessCount++
        bestMatch.lastAccessed = Date.now()
        this.totalHits++
        return { hit: true, entry: bestMatch, matchType: "fuzzy", similarity: bestSim }
      }
    }

    return { hit: false }
  }

  store(prompt: string, response: string, model: string, inputTokens: number, outputTokens: number): void {
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

    this.entries.set(key, entry)

    // LRU eviction
    if (this.entries.size > this.config.maxEntries) {
      let oldestKey = ""
      let oldestAccess = Infinity
      for (const [k, v] of this.entries) {
        if (v.lastAccessed < oldestAccess) {
          oldestAccess = v.lastAccessed
          oldestKey = k
        }
      }
      if (oldestKey) this.entries.delete(oldestKey)
    }
  }

  stats() {
    let totalSavedTokens = 0
    for (const entry of this.entries.values()) {
      totalSavedTokens += (entry.inputTokens + entry.outputTokens) * entry.accessCount
    }
    return {
      entries: this.entries.size,
      totalHits: this.totalHits,
      totalLookups: this.totalLookups,
      hitRate: this.totalLookups > 0 ? this.totalHits / this.totalLookups : 0,
      totalSavedTokens,
    }
  }

  clear(): void {
    this.entries.clear()
    this.totalLookups = 0
    this.totalHits = 0
  }
}
