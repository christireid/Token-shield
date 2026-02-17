import { describe, it, expect, beforeEach } from "vitest"
import { semanticCache } from "../cache/semantic-cache"
import type { SemanticCache } from "../cache/semantic-cache"

describe("semanticCache", () => {
  let cache: SemanticCache

  beforeEach(() => {
    cache = semanticCache({ maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 })
  })

  describe("exact match", () => {
    it("returns hit for identical prompt and model", () => {
      cache.store("What is TypeScript?", "TS is a typed superset of JS.", "gpt-4o", 10, 20)
      const result = cache.lookup("What is TypeScript?", "gpt-4o")
      expect(result.hit).toBe(true)
      expect(result.matchType).toBe("exact")
      expect(result.similarity).toBe(1)
      expect(result.entry?.response).toBe("TS is a typed superset of JS.")
    })

    it("returns miss for different model (no cross-model contamination)", () => {
      cache.store("What is TypeScript?", "TS is...", "gpt-4o", 10, 20)
      const result = cache.lookup("What is TypeScript?", "gpt-4o-mini")
      expect(result.hit).toBe(false)
    })

    it("returns miss for different prompt", () => {
      cache.store("What is TypeScript?", "TS is...", "gpt-4o", 10, 20)
      const result = cache.lookup("What is JavaScript?", "gpt-4o")
      expect(result.hit).toBe(false)
    })
  })

  describe("fuzzy match", () => {
    it("matches near-duplicate prompts", () => {
      cache.store("What is TypeScript?", "TS is a typed superset.", "gpt-4o", 10, 20)
      const result = cache.lookup("what is typescript", "gpt-4o")
      expect(result.hit).toBe(true)
      expect(result.matchType).toBe("exact") // normalized to same key
    })

    it("matches rephrased prompts above threshold", () => {
      cache.store(
        "Explain the benefits of using TypeScript over JavaScript in large projects",
        "TypeScript adds type safety...",
        "gpt-4o",
        15,
        30,
      )
      const result = cache.lookup(
        "Explain the benefits of using TypeScript over JavaScript in big projects",
        "gpt-4o",
      )
      // "large" vs "big" — most of the prompt is identical, well above 0.85
      expect(result.hit).toBe(true)
      expect(result.matchType).toBe("fuzzy")
      expect(result.similarity).toBeGreaterThan(0.85)
    })

    it("does not match very different prompts", () => {
      cache.store("What is TypeScript?", "TS is...", "gpt-4o", 10, 20)
      const result = cache.lookup("How do I cook pasta?", "gpt-4o")
      expect(result.hit).toBe(false)
    })

    it("does not fuzzy match across models", () => {
      cache.store(
        "Explain the benefits of TypeScript",
        "TS adds type safety...",
        "gpt-4o",
        15,
        30,
      )
      const result = cache.lookup(
        "Explain the advantages of TypeScript",
        "claude-sonnet-4",
      )
      expect(result.hit).toBe(false)
    })
  })

  describe("TTL", () => {
    it("expires entries after TTL", () => {
      const shortCache = semanticCache({ ttlMs: 1 })
      shortCache.store("test", "response", "gpt-4o", 5, 10)
      // Wait for TTL to expire
      const start = Date.now()
      while (Date.now() - start < 5) { /* spin */ }
      const result = shortCache.lookup("test", "gpt-4o")
      expect(result.hit).toBe(false)
    })
  })

  describe("LRU eviction", () => {
    it("evicts oldest entry when capacity is exceeded", () => {
      const tinyCache = semanticCache({ maxEntries: 2, ttlMs: 60_000 })
      tinyCache.store("first", "r1", "gpt-4o", 5, 10)
      tinyCache.store("second", "r2", "gpt-4o", 5, 10)
      tinyCache.store("third", "r3", "gpt-4o", 5, 10)

      // First should be evicted
      expect(tinyCache.lookup("first", "gpt-4o").hit).toBe(false)
      expect(tinyCache.lookup("second", "gpt-4o").hit).toBe(true)
      expect(tinyCache.lookup("third", "gpt-4o").hit).toBe(true)
    })
  })

  describe("stats", () => {
    it("tracks hits and misses", () => {
      cache.store("q1", "r1", "gpt-4o", 10, 20)
      cache.lookup("q1", "gpt-4o") // hit
      cache.lookup("q2", "gpt-4o") // miss

      const stats = cache.stats()
      expect(stats.totalHits).toBe(1)
      expect(stats.totalLookups).toBe(2)
      expect(stats.hitRate).toBe(0.5)
      expect(stats.entries).toBe(1)
    })

    it("tracks saved tokens", () => {
      cache.store("q1", "r1", "gpt-4o", 10, 20)
      cache.lookup("q1", "gpt-4o") // hit — saves 10+20=30 tokens

      const stats = cache.stats()
      expect(stats.totalSavedTokens).toBe(30)
    })
  })

  describe("clear", () => {
    it("removes all entries and resets stats", () => {
      cache.store("q1", "r1", "gpt-4o", 10, 20)
      cache.lookup("q1", "gpt-4o")
      cache.clear()

      const stats = cache.stats()
      expect(stats.entries).toBe(0)
      expect(stats.totalHits).toBe(0)
      expect(stats.totalLookups).toBe(0)
    })
  })
})
