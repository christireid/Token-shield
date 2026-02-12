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

    it("reports stats correctly", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      await cache.store("test", "response", "gpt-4o-mini", 10, 20)
      await cache.lookup("test", "gpt-4o-mini") // hit
      const stats = cache.stats()
      expect(stats.entries).toBe(1)
      expect(stats.totalHits).toBe(1)
    })

    it("clear removes all entries", async () => {
      const cache = new ResponseCache({ maxEntries: 10, ttlMs: 60_000 })
      await cache.store("test", "response", "gpt-4o-mini", 10, 20)
      await cache.clear()
      const stats = cache.stats()
      expect(stats.entries).toBe(0)
    })
  })
})
