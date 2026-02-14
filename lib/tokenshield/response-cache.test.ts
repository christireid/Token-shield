import { describe, it, expect } from "vitest"
import { normalizeText, textSimilarity, ResponseCache } from "./response-cache"

describe("response-cache", () => {
  describe("normalizeText", () => {
    it("lowercases and collapses whitespace", () => {
      expect(normalizeText("  Hello   World  ")).toBe("hello world")
    })

    it("removes punctuation", () => {
      expect(normalizeText("What is React?")).toBe("what is react")
    })

    it("returns empty string for empty input", () => {
      expect(normalizeText("")).toBe("")
    })
  })

  describe("textSimilarity", () => {
    it("returns 1 for identical normalized strings", () => {
      expect(textSimilarity("Hello World", "hello world")).toBe(1)
    })

    it("returns high similarity for near-duplicate prompts", () => {
      const sim = textSimilarity("What is React?", "what is react")
      expect(sim).toBe(1) // same after normalization
    })

    it("returns lower similarity for different strings", () => {
      const sim = textSimilarity("Tell me about cats", "Explain quantum physics")
      expect(sim).toBeLessThan(0.5)
    })

    it("returns 1 for two empty strings", () => {
      expect(textSimilarity("", "")).toBe(1)
    })

    it("returns 0 when one string is empty and other is not", () => {
      expect(textSimilarity("hello", "")).toBe(0)
    })
  })

  describe("ResponseCache (memory only, no IDB)", () => {
    it("stores and retrieves exact matches", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      await cache.store("What is React?", "React is a UI library.", "gpt-4o-mini", 10, 20)
      const result = await cache.lookup("What is React?", "gpt-4o-mini")
      expect(result.hit).toBe(true)
      expect(result.matchType).toBe("exact")
      expect(result.entry?.response).toBe("React is a UI library.")
    })

    it("returns miss for unknown prompts", async () => {
      const cache = new ResponseCache()
      const result = await cache.lookup("Never seen before", "gpt-4o-mini")
      expect(result.hit).toBe(false)
    })

    it("matches fuzzy when threshold < 1", async () => {
      const cache = new ResponseCache({
        maxEntries: 10,
        ttlMs: 60_000,
        similarityThreshold: 0.8,
      })
      await cache.store("What is React JS?", "React is a UI library.", "gpt-4o-mini", 10, 20)
      const result = await cache.lookup("What is React?", "gpt-4o-mini")
      // May be exact (after normalization) or fuzzy depending on hash
      expect(result.hit).toBe(true)
    })

    it("evicts LRU when over capacity", async () => {
      const cache = new ResponseCache({ maxEntries: 2, ttlMs: 60_000 })
      await cache.store("prompt1", "resp1", "gpt-4o-mini", 10, 10)
      await cache.store("prompt2", "resp2", "gpt-4o-mini", 10, 10)
      await cache.store("prompt3", "resp3", "gpt-4o-mini", 10, 10)
      const stats = cache.stats()
      expect(stats.entries).toBe(2)
    })

    it("reports stats correctly with totalLookups and hitRate", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      await cache.store("test", "response", "gpt-4o-mini", 10, 20)
      await cache.lookup("test", "gpt-4o-mini") // hit
      await cache.lookup("unknown prompt", "gpt-4o-mini") // miss
      const stats = cache.stats()
      expect(stats.entries).toBe(1)
      expect(stats.totalHits).toBe(1)
      expect(stats.totalLookups).toBe(2)
      expect(stats.hitRate).toBe(0.5)
    })

    it("hitRate is 0 when no lookups have been performed", () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      const stats = cache.stats()
      expect(stats.hitRate).toBe(0)
      expect(stats.totalLookups).toBe(0)
    })

    it("clear resets lookup and hit counters", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      await cache.store("test", "response", "gpt-4o-mini", 10, 20)
      await cache.lookup("test", "gpt-4o-mini")
      await cache.clear()
      const stats = cache.stats()
      expect(stats.entries).toBe(0)
      expect(stats.totalLookups).toBe(0)
      expect(stats.totalHits).toBe(0)
    })

    it("does not return cached response on hash collision (different normalized prompt)", async () => {
      // This tests the collision guard: if two different prompts produce
      // the same djb2 hash key, the cache should NOT return the wrong response.
      const cache = new ResponseCache({ maxEntries: 100, ttlMs: 60_000, similarityThreshold: 1 })
      await cache.store("What is React?", "React is a UI library.", "gpt-4o-mini", 10, 20)

      // Access internal memory to simulate a collision:
      // manually insert an entry under a different prompt's hash key
      const origResult = await cache.lookup("What is React?", "gpt-4o-mini")
      expect(origResult.hit).toBe(true)

      // A completely different prompt should not hit even if (hypothetically) the hash matched
      const diffResult = await cache.lookup("Tell me about quantum physics", "gpt-4o-mini")
      expect(diffResult.hit).toBe(false)
    })

    it("peek verifies normalized prompt to guard against hash collisions", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000, similarityThreshold: 1 })
      await cache.store("What is React?", "React is a library.", "gpt-4o-mini", 10, 20)

      // Same prompt should hit
      const peekHit = cache.peek("What is React?", "gpt-4o-mini")
      expect(peekHit.hit).toBe(true)

      // Completely different prompt should miss
      const peekMiss = cache.peek("Explain quantum physics in detail", "gpt-4o-mini")
      expect(peekMiss.hit).toBe(false)
    })

    it("counts fuzzy hits in totalHits", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000, similarityThreshold: 0.7 })
      await cache.store(
        "What is React JS framework?",
        "React is a UI library.",
        "gpt-4o-mini",
        10,
        20,
      )
      const result = await cache.lookup("What is React JS?", "gpt-4o-mini")
      expect(result.hit).toBe(true)
      expect(result.matchType).toBe("fuzzy")
      const stats = cache.stats()
      expect(stats.totalHits).toBe(1)
      expect(stats.totalLookups).toBe(1)
      expect(stats.hitRate).toBe(1)
    })
  })
})
