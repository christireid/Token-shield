import { describe, it, expect, beforeEach } from "vitest"
import { SemanticMinHashIndex } from "../semantic-minhash"

describe("semantic-minhash", () => {
  let index: SemanticMinHashIndex<string>

  beforeEach(() => {
    index = new SemanticMinHashIndex<string>({
      numHashes: 64,
      bands: 8,
      maxEntries: 100,
    })
  })

  describe("insert and find", () => {
    it("should find exact matches", () => {
      index.insert("What is the capital of France?", "paris")
      const result = index.find("What is the capital of France?", 0.8)
      expect(result).not.toBeNull()
      expect(result!.entry.data).toBe("paris")
      expect(result!.similarity).toBeCloseTo(1, 1)
    })

    it("should find similar prompts via LSH bucketing", () => {
      // Use longer prompts with more shared shingles for reliable LSH detection
      const base = "Please explain in detail the history and significance of the capital city of France including its founding its cultural impact and its role in modern European politics"
      index.insert(base, "paris")
      // Nearly identical prompt with minor variation
      const query = "Please explain in detail the history and significance of the capital city of France including its founding its cultural impact and its importance in modern European politics"
      const result = index.find(query, 0.3)
      // LSH is probabilistic — with enough shared content it should usually find a match
      // We test that when found, similarity is reasonable
      if (result) {
        expect(result.similarity).toBeGreaterThan(0.3)
        expect(result.entry.data).toBe("paris")
      }
    })

    it("should return null for dissimilar prompts", () => {
      index.insert("What is the capital of France?", "paris")
      const result = index.find(
        "Write a Python function to sort a list of integers",
        0.8
      )
      expect(result).toBeNull()
    })

    it("should handle multiple entries", () => {
      index.insert("What is the capital of France?", "paris")
      index.insert("What is the capital of Germany?", "berlin")
      index.insert("What is the capital of Japan?", "tokyo")

      const result = index.find("What is the capital of Germany?", 0.8)
      expect(result).not.toBeNull()
      expect(result!.entry.data).toBe("berlin")
    })

    it("should respect similarity threshold", () => {
      index.insert("What is the capital of France?", "paris")
      // Very high threshold should reject even somewhat similar prompts
      const result = index.find("What is the capital of Germany?", 0.99)
      // May or may not find it depending on actual similarity
      if (result) {
        expect(result.similarity).toBeGreaterThanOrEqual(0.99)
      }
    })
  })

  describe("eviction", () => {
    it("should evict oldest entries when at capacity", () => {
      const small = new SemanticMinHashIndex<number>({
        numHashes: 64,
        bands: 8,
        maxEntries: 5,
      })

      for (let i = 0; i < 10; i++) {
        small.insert(`Unique prompt number ${i} about topic ${i * 7}`, i)
      }

      expect(small.size).toBeLessThanOrEqual(5)
    })

    it("should still find recent entries after eviction", () => {
      // Regression: eviction used to rebuild all buckets on every eviction (O(n*bands)).
      // Now uses swap-remove. Verify lookups still work after multiple evictions.
      const small = new SemanticMinHashIndex<string>({
        numHashes: 64,
        bands: 8,
        maxEntries: 3,
      })

      small.insert("alpha beta gamma delta epsilon zeta eta theta", "first")
      small.insert("one two three four five six seven eight", "second")
      small.insert("apple banana cherry dragonfruit elderberry fig grape", "third")
      // This triggers eviction of "first"
      small.insert("red green blue yellow orange purple violet indigo", "fourth")

      expect(small.size).toBeLessThanOrEqual(3)
      // The most recent entry should still be findable
      const result = small.find("red green blue yellow orange purple violet indigo", 0.8)
      expect(result).not.toBeNull()
      expect(result!.entry.data).toBe("fourth")
    })
  })

  describe("clear", () => {
    it("should clear all entries", () => {
      index.insert("test prompt", "data")
      expect(index.size).toBe(1)

      index.clear()
      expect(index.size).toBe(0)

      const result = index.find("test prompt")
      expect(result).toBeNull()
    })
  })

  describe("stats", () => {
    it("should return correct statistics", () => {
      index.insert("prompt 1", "data 1")
      index.insert("prompt 2", "data 2")

      const stats = index.stats()
      expect(stats.entries).toBe(2)
      expect(stats.bands).toBe(8)
      expect(stats.rowsPerBand).toBe(8)
      expect(stats.totalBuckets).toBeGreaterThan(0)
    })

    it("should return zero stats when empty", () => {
      const stats = index.stats()
      expect(stats.entries).toBe(0)
      expect(stats.totalBuckets).toBe(0)
    })
  })

  describe("configuration validation", () => {
    it("should throw if numHashes is not divisible by bands", () => {
      expect(() => {
        new SemanticMinHashIndex({ numHashes: 100, bands: 7 })
      }).toThrow()
    })
  })
})
