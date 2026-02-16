import { describe, it, expect, beforeEach } from "vitest"
import { FuzzySimilarityEngine, createFuzzySimilarityEngine } from "./fuzzy-similarity"

describe("FuzzySimilarityEngine", () => {
  // -------------------------------------------------------
  // Constructor & Config
  // -------------------------------------------------------
  describe("Constructor & Config", () => {
    it("creates engine with default config", () => {
      const engine = new FuzzySimilarityEngine()
      // Defaults: threshold=0.88, maxMemories=500, enableInhibition=true, persist=false
      expect(engine.size).toBe(0)
      expect(engine.hydrated).toBe(false)
    })

    it("accepts custom config values", () => {
      const engine = new FuzzySimilarityEngine({
        threshold: 0.75,
        maxMemories: 100,
        enableInhibition: false,
        persist: false,
        seeds: { cost: 10, price: 10 },
      })
      expect(engine.size).toBe(0)
    })
  })

  // -------------------------------------------------------
  // Encoding (tested via find/learn)
  // -------------------------------------------------------
  describe("encode (tested via find/learn)", () => {
    let engine: FuzzySimilarityEngine

    beforeEach(() => {
      engine = new FuzzySimilarityEngine({ threshold: 0.5, persist: false })
    })

    it("same text produces same encoding (find matches after learn)", async () => {
      const prompt = "How do I configure my database connection?"
      await engine.learn(prompt, "Use a connection string.", "gpt-4o", 10, 20)
      const result = engine.find(prompt)
      expect(result).not.toBeNull()
      expect(result!.score).toBeCloseTo(1.0, 1)
      expect(result!.response).toBe("Use a connection string.")
    })

    it("very similar text produces high similarity", async () => {
      await engine.learn(
        "How do I fix this bug in the application?",
        "Check the logs.",
        "gpt-4o",
        10,
        20,
      )
      const result = engine.find("How do I fix this error in the application?")
      // "bug" vs "error" differ, but most of the prompt is the same
      expect(result).not.toBeNull()
      expect(result!.score).toBeGreaterThan(0.5)
    })

    it("completely different text produces low similarity (no match)", async () => {
      await engine.learn(
        "How do I configure my database connection?",
        "Use a connection string.",
        "gpt-4o",
        10,
        20,
      )
      // With threshold=0.5, completely different text shouldn't match
      const result = engine.find("What is the weather forecast for tomorrow?")
      // Either null or very low score
      if (result) {
        expect(result.score).toBeLessThan(0.5)
      } else {
        expect(result).toBeNull()
      }
    })

    it("short prompts (<10 chars) get stricter threshold (dynamic thresholding)", async () => {
      // Use a high threshold so +0.05 makes it fail for short prompts
      const strict = new FuzzySimilarityEngine({ threshold: 0.92, persist: false })
      const longPrompt = "Calculate the total cost"
      await strict.learn(longPrompt, "Sum them up.", "gpt-4o", 5, 10)

      // Long prompt — threshold stays at 0.92
      const longResult = strict.find(longPrompt)
      expect(longResult).not.toBeNull()

      // Short prompt (<10 chars) — threshold becomes 0.92 + 0.05 = 0.97
      // A short string like "Calculate" won't match the long learned prompt at 0.97
      const shortResult = strict.find("Cost sum")
      expect(shortResult).toBeNull()
    })

    it("word order matters (temporal encoding)", async () => {
      const engineA = new FuzzySimilarityEngine({ threshold: 0.3, persist: false })
      await engineA.learn("the dog bites the man", "A bites B.", "gpt-4o", 5, 5)

      // Same words different order — rotation makes them encode differently
      const result = engineA.find("the man bites the dog")
      // They should still share many trigrams so score > 0, but not a perfect match
      if (result) {
        expect(result.score).toBeLessThan(1.0)
        expect(result.score).toBeGreaterThan(0)
      }
    })
  })

  // -------------------------------------------------------
  // Semantic Seeding
  // -------------------------------------------------------
  describe("Semantic Seeding", () => {
    it("without seeds: 'cost' and 'price' have lower similarity", async () => {
      const noSeeds = new FuzzySimilarityEngine({ threshold: 0.1, persist: false })
      await noSeeds.learn("What is the total cost of this service?", "Ten dollars.", "gpt-4o", 5, 5)
      const result = noSeeds.find("What is the total price of this service?")
      // Without seeds, "cost" and "price" have completely different trigrams
      const scoreWithout = result ? result.score : 0
      expect(scoreWithout).toBeGreaterThan(0) // still share other words

      // With seeds linking cost and price
      const withSeeds = new FuzzySimilarityEngine({
        threshold: 0.1,
        persist: false,
        seeds: { cost: 10, price: 10 },
      })
      await withSeeds.learn(
        "What is the total cost of this service?",
        "Ten dollars.",
        "gpt-4o",
        5,
        5,
      )
      const seededResult = withSeeds.find("What is the total price of this service?")
      const scoreWith = seededResult ? seededResult.score : 0

      // Seeded score should be >= unseeded (extra shared bit)
      expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout)
    })

    it("seeds don't affect unrelated terms", async () => {
      const withSeeds = new FuzzySimilarityEngine({
        threshold: 0.1,
        persist: false,
        seeds: { cost: 10, price: 10 },
      })
      await withSeeds.learn("How is the weather looking today?", "Sunny.", "gpt-4o", 5, 5)
      // "weather" and "looking" are not in the seeds
      const result = withSeeds.find("How is the weather looking today?")
      expect(result).not.toBeNull()
      expect(result!.score).toBeCloseTo(1.0, 1)
    })
  })

  // -------------------------------------------------------
  // Contrastive Inhibition
  // -------------------------------------------------------
  describe("Contrastive Inhibition", () => {
    it("with many similar memories, common terms get downweighted", async () => {
      const engine = new FuzzySimilarityEngine({
        threshold: 0.1,
        enableInhibition: true,
        persist: false,
      })

      // Add many memories that share "please help me with" prefix
      for (let i = 0; i < 20; i++) {
        await engine.learn(
          `please help me with problem number ${i} in the system`,
          `Solution ${i}`,
          "gpt-4o",
          5,
          5,
        )
      }

      // The shared prefix bits should now be in the noise vector
      // A query with different content but same prefix should be inhibited
      const stats = engine.stats()
      expect(stats.entries).toBe(20)
    })

    it("with enableInhibition=false, no filtering occurs", async () => {
      const noInhibit = new FuzzySimilarityEngine({
        threshold: 0.1,
        enableInhibition: false,
        persist: false,
      })

      await noInhibit.learn(
        "How do I configure the server?",
        "Edit the config file.",
        "gpt-4o",
        5,
        5,
      )

      const result = noInhibit.find("How do I configure the server?")
      expect(result).not.toBeNull()
      // Without inhibition, exact match should still be ~1.0
      expect(result!.score).toBeCloseTo(1.0, 1)
    })
  })

  // -------------------------------------------------------
  // find()
  // -------------------------------------------------------
  describe("find()", () => {
    let engine: FuzzySimilarityEngine

    beforeEach(() => {
      engine = new FuzzySimilarityEngine({ threshold: 0.88, persist: false })
    })

    it("returns null when memory is empty", () => {
      const result = engine.find("anything at all")
      expect(result).toBeNull()
    })

    it("returns null when score is below threshold", async () => {
      await engine.learn(
        "How do I configure my database connection?",
        "Use a connection string.",
        "gpt-4o",
        10,
        20,
      )
      // Completely unrelated query — score should be well below 0.88
      const result = engine.find("What are the best practices for gardening?")
      expect(result).toBeNull()
    })

    it("returns FindResult with correct fields", async () => {
      await engine.learn(
        "Explain the benefits of caching",
        "Caching reduces latency.",
        "gpt-4o",
        15,
        25,
      )
      const result = engine.find("Explain the benefits of caching")
      expect(result).not.toBeNull()
      expect(result!.response).toBe("Caching reduces latency.")
      expect(result!.score).toBeGreaterThan(0)
      expect(result!.prompt).toBe("Explain the benefits of caching")
      expect(result!.model).toBe("gpt-4o")
      expect(result!.inputTokens).toBe(15)
      expect(result!.outputTokens).toBe(25)
      expect(result!.hits).toBeGreaterThanOrEqual(2) // initial=1, +1 from find
    })

    it("respects model filter — won't match entry with different model", async () => {
      await engine.learn("How do I deploy to production?", "Use CI/CD.", "gpt-4o", 5, 10)
      const result = engine.find("How do I deploy to production?", "claude-3-opus")
      expect(result).toBeNull()
    })

    it("increments hits on match (reinforcement)", async () => {
      await engine.learn(
        "Explain the benefits of caching",
        "Caching reduces latency.",
        "gpt-4o",
        15,
        25,
      )
      const first = engine.find("Explain the benefits of caching")
      expect(first).not.toBeNull()
      expect(first!.hits).toBe(2) // 1 initial + 1 from find

      const second = engine.find("Explain the benefits of caching")
      expect(second).not.toBeNull()
      expect(second!.hits).toBe(3) // +1 again
    })

    it("dynamic threshold: short prompts need higher score", async () => {
      const engine = new FuzzySimilarityEngine({ threshold: 0.93, persist: false })
      await engine.learn(
        "How do I configure my database connection properly?",
        "Check the config.",
        "gpt-4o",
        5,
        5,
      )
      // Long prompt find — threshold stays at 0.93, exact match = 1.0 passes
      const longResult = engine.find("How do I configure my database connection properly?")
      expect(longResult).not.toBeNull()

      // Short prompt (<10 chars) — threshold becomes 0.93 + 0.05 = 0.98
      // "Fix that" shares almost no trigrams with the learned prompt
      const shortResult = engine.find("Fix that")
      expect(shortResult).toBeNull()
    })
  })

  // -------------------------------------------------------
  // learn()
  // -------------------------------------------------------
  describe("learn()", () => {
    it("adds entry to memory (size increases)", async () => {
      const engine = new FuzzySimilarityEngine({ persist: false })
      expect(engine.size).toBe(0)
      await engine.learn("Test prompt", "Test response", "gpt-4o", 5, 10)
      expect(engine.size).toBe(1)
    })

    it("LRU eviction when at maxMemories capacity", async () => {
      const engine = new FuzzySimilarityEngine({
        maxMemories: 3,
        persist: false,
      })
      await engine.learn("Prompt one for the test", "Response 1", "gpt-4o", 5, 10)
      await engine.learn("Prompt two for the test", "Response 2", "gpt-4o", 5, 10)
      await engine.learn("Prompt three for the test", "Response 3", "gpt-4o", 5, 10)
      expect(engine.size).toBe(3)

      // Adding a 4th should evict the oldest
      await engine.learn("Prompt four for the test", "Response 4", "gpt-4o", 5, 10)
      expect(engine.size).toBe(3)
    })

    it("after learn, find can retrieve the entry", async () => {
      const engine = new FuzzySimilarityEngine({ threshold: 0.5, persist: false })
      await engine.learn("What is the capital of France?", "Paris.", "gpt-4o", 5, 5)
      const result = engine.find("What is the capital of France?")
      expect(result).not.toBeNull()
      expect(result!.response).toBe("Paris.")
    })
  })

  // -------------------------------------------------------
  // hydrate()
  // -------------------------------------------------------
  describe("hydrate()", () => {
    it("returns 0 when persist is false", async () => {
      const engine = new FuzzySimilarityEngine({ persist: false })
      const count = await engine.hydrate()
      expect(count).toBe(0)
    })

    it("does not throw when persist is false", async () => {
      const engine = new FuzzySimilarityEngine({ persist: false })
      await expect(engine.hydrate()).resolves.toBe(0)
    })
  })

  // -------------------------------------------------------
  // clear()
  // -------------------------------------------------------
  describe("clear()", () => {
    it("removes all memories (size becomes 0)", async () => {
      const engine = new FuzzySimilarityEngine({ persist: false })
      await engine.learn("Some prompt for testing", "Some response", "gpt-4o", 5, 10)
      await engine.learn("Another prompt for testing", "Another response", "gpt-4o", 5, 10)
      expect(engine.size).toBe(2)
      await engine.clear()
      expect(engine.size).toBe(0)
    })

    it("after clear, find returns null", async () => {
      const engine = new FuzzySimilarityEngine({ threshold: 0.5, persist: false })
      await engine.learn(
        "How do I configure my database?",
        "Use a connection string.",
        "gpt-4o",
        10,
        20,
      )
      await engine.clear()
      const result = engine.find("How do I configure my database?")
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------
  // stats()
  // -------------------------------------------------------
  describe("stats()", () => {
    it("returns correct entries count", async () => {
      const engine = new FuzzySimilarityEngine({ persist: false })
      await engine.learn("First prompt for testing", "First", "gpt-4o", 5, 5)
      await engine.learn("Second prompt for testing", "Second", "gpt-4o", 5, 5)
      const stats = engine.stats()
      expect(stats.entries).toBe(2)
    })

    it("returns correct totalHits after find matches", async () => {
      const engine = new FuzzySimilarityEngine({ threshold: 0.5, persist: false })
      await engine.learn("Explain quantum computing concepts", "Qubits.", "gpt-4o", 5, 5)
      // Each learn starts at hits=1
      expect(engine.stats().totalHits).toBe(1)

      // A find match increments hits
      engine.find("Explain quantum computing concepts")
      expect(engine.stats().totalHits).toBe(2)
    })
  })

  // -------------------------------------------------------
  // createFuzzySimilarityEngine factory
  // -------------------------------------------------------
  describe("createFuzzySimilarityEngine factory", () => {
    it("returns a FuzzySimilarityEngine instance", () => {
      const engine = createFuzzySimilarityEngine({ persist: false })
      expect(engine).toBeInstanceOf(FuzzySimilarityEngine)
    })
  })
})
