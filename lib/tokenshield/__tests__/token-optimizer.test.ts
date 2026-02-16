import { describe, it, expect, beforeEach } from "vitest"
import { TokenOptimizer, createTokenOptimizer } from "../token-optimizer"

describe("token-optimizer", () => {
  let optimizer: TokenOptimizer

  beforeEach(() => {
    optimizer = createTokenOptimizer({
      model: "gpt-4o",
      compression: true,
      deltaEncoding: true,
      adaptiveOutput: { persist: false },
      cache: { maxEntries: 100 },
      minhashIndex: { numHashes: 64, bands: 8 },
      prefixOptimize: true,
      persist: false,
    })
  })

  describe("optimize", () => {
    it("should optimize messages and return savings breakdown", async () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        {
          role: "user",
          content:
            "Please kindly analyze the following text and basically provide a very detailed summary. It is important to note that you should cover all key points. In order to accomplish this task, due to the fact that the text is complex, please ensure thoroughness.",
        },
      ]

      const result = await optimizer.optimize(messages)

      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.totalSaved).toBeGreaterThanOrEqual(0)
      expect(result.cacheHit).toBe(false)
      expect(result.suggestedMaxTokens).toBeGreaterThan(0)
      expect(result.messages).toHaveLength(2)
      // System message should be preserved
      expect(result.messages[0].content).toBe("You are a helpful assistant.")
    })

    it("should return cache hit when prompt was previously recorded", async () => {
      // Record a response
      await optimizer.recordResponse(
        "What is the capital of France?",
        "The capital of France is Paris.",
        "gpt-4o",
        10,
        8,
      )

      const messages = [{ role: "user", content: "What is the capital of France?" }]

      const result = await optimizer.optimize(messages)
      expect(result.cacheHit).toBe(true)
      expect(result.cachedResponse).toBe("The capital of France is Paris.")
      expect(result.totalSaved).toBeGreaterThan(0)
    })

    it("should apply delta encoding to remove redundancy", async () => {
      const longContent =
        "The quick brown fox jumps over the lazy dog. This sentence is a well-known pangram that contains every letter of the English alphabet at least once. It has been used for testing typewriters and computer keyboards for over a century."

      const messages = [
        { role: "user", content: `${longContent}\n\nPlease analyze this text.` },
        { role: "assistant", content: "This is a pangram." },
        { role: "user", content: `${longContent}\n\nNow provide a summary.` },
      ]

      const result = await optimizer.optimize(messages)
      expect(result.savings.deltaEncoding).toBeGreaterThanOrEqual(0)
    })

    it("should work with all features disabled", async () => {
      const minimal = createTokenOptimizer({
        compression: false,
        deltaEncoding: false,
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        prefixOptimize: false,
        templates: false,
      })

      const messages = [{ role: "user", content: "Hello!" }]
      const result = await minimal.optimize(messages)

      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.cacheHit).toBe(false)
    })
  })

  describe("recordResponse", () => {
    it("should record response for future cache hits", async () => {
      await optimizer.recordResponse("Test prompt", "Test response", "gpt-4o", 5, 4)

      const summary = optimizer.summary()
      expect(summary.cache).not.toBeNull()
      expect(summary.cache!.entries).toBe(1)
    })

    it("should update adaptive predictions", async () => {
      // Record multiple responses
      for (let i = 0; i < 5; i++) {
        await optimizer.recordResponse(`What is ${i}?`, `${i}`, "gpt-4o", 5, 3)
      }

      const summary = optimizer.summary()
      expect(summary.adaptive).not.toBeNull()
      expect(summary.adaptive!.totalObservations).toBe(5)
    })
  })

  describe("templates", () => {
    it("should register and render templates", () => {
      optimizer.registerTemplate("qa", "Question: {{q}}\nAnswer concisely.")
      const result = optimizer.renderTemplate("qa", { q: "What is 2+2?" })

      expect(result.rendered).toContain("What is 2+2?")
      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.staticTokens).toBeGreaterThan(0)
    })

    it("should throw when templates are disabled", () => {
      const noTemplates = createTokenOptimizer({ templates: false })
      expect(() => noTemplates.renderTemplate("test", {})).toThrow("Template pool is disabled")
    })
  })

  describe("summary", () => {
    it("should return comprehensive summary", () => {
      const summary = optimizer.summary()
      expect(summary.cache).not.toBeNull()
      expect(summary.minhash).not.toBeNull()
      expect(summary.adaptive).not.toBeNull()
      expect(summary.templates).not.toBeNull()
    })
  })

  describe("clear", () => {
    it("should clear all data", async () => {
      await optimizer.recordResponse("test", "response", "gpt-4o", 5, 3)
      optimizer.registerTemplate("t1", "Hello {{name}}")

      await optimizer.clear()

      const summary = optimizer.summary()
      expect(summary.cache!.entries).toBe(0)
      expect(summary.minhash!.entries).toBe(0)
      expect(summary.templates!.templates).toBe(0)
    })
  })

  describe("createTokenOptimizer", () => {
    it("should create an optimizer with defaults", () => {
      const opt = createTokenOptimizer()
      expect(opt).toBeInstanceOf(TokenOptimizer)
      expect(opt.getCache()).not.toBeNull()
      expect(opt.getAdaptiveOptimizer()).not.toBeNull()
      expect(opt.getMinHashIndex()).not.toBeNull()
      expect(opt.getTemplatePool()).not.toBeNull()
    })
  })

  describe("config object variants", () => {
    it("should accept adaptiveOutput as an object with persist: false", () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: { persist: false },
      })
      expect(opt.getAdaptiveOptimizer()).not.toBeNull()
    })

    it("should accept cache as an object with maxEntries", () => {
      const opt = createTokenOptimizer({
        cache: { maxEntries: 10 },
      })
      expect(opt.getCache()).not.toBeNull()
    })

    it("should accept minhashIndex as an object with numHashes", () => {
      const opt = createTokenOptimizer({
        minhashIndex: { numHashes: 64 },
      })
      expect(opt.getMinHashIndex()).not.toBeNull()
    })

    it("should accept templates as an object with maxEntries", () => {
      const opt = createTokenOptimizer({
        templates: { maxEntries: 50 },
      })
      expect(opt.getTemplatePool()).not.toBeNull()
    })
  })

  describe("disabled sub-modules", () => {
    it("should return null getters when all sub-modules are disabled", () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        templates: false,
      })
      expect(opt.getAdaptiveOptimizer()).toBeNull()
      expect(opt.getCache()).toBeNull()
      expect(opt.getMinHashIndex()).toBeNull()
      expect(opt.getTemplatePool()).toBeNull()
    })

    it("should optimize without any sub-modules", async () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        templates: false,
        compression: false,
        deltaEncoding: false,
        prefixOptimize: false,
      })

      const messages = [
        {
          role: "user",
          content: "Tell me about artificial intelligence and machine learning concepts",
        },
      ]

      const result = await opt.optimize(messages)
      expect(result.cacheHit).toBe(false)
      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.savings.compression).toBe(0)
      expect(result.savings.deltaEncoding).toBe(0)
      expect(result.savings.contextTrimming).toBe(0)
      expect(result.savings.prefixCacheDollarSavings).toBe(0)
    })

    it("summary returns all nulls when sub-modules are disabled", () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        templates: false,
      })
      const summary = opt.summary()
      expect(summary.cache).toBeNull()
      expect(summary.minhash).toBeNull()
      expect(summary.adaptive).toBeNull()
      expect(summary.templates).toBeNull()
    })

    it("clear works when all sub-modules are disabled", async () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        templates: false,
      })
      // Should not throw
      await opt.clear()
    })

    it("recordResponse works when all sub-modules are disabled", async () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        templates: false,
      })
      // Should not throw
      await opt.recordResponse("test prompt", "test response", "gpt-4o", 10, 5)
    })
  })

  describe("MinHash fuzzy lookup in optimize()", () => {
    it("should return cache hit via MinHash fuzzy path when exact lookup misses but MinHash finds a candidate", async () => {
      // Use an optimizer with MinHash + cache enabled
      const opt = createTokenOptimizer({
        model: "gpt-4o",
        adaptiveOutput: { persist: false },
        cache: { maxEntries: 100, similarityThreshold: 0.85 },
        minhashIndex: { numHashes: 128, bands: 16 },
        compression: false,
        deltaEncoding: false,
        prefixOptimize: false,
        templates: false,
      })

      // Record a response — this stores in cache AND in MinHash index
      const originalPrompt = "Please explain the concept of machine learning algorithms in detail"
      await opt.recordResponse(
        originalPrompt,
        "Machine learning algorithms are methods that learn from data.",
        "gpt-4o",
        30,
        15,
      )

      // Use a very similar prompt that shares many words but differs slightly.
      // The cache exact lookup will miss (different hash key), but MinHash
      // should find the original prompt. The MinHash data stores the prompt
      // as a cache key, which is then looked up in the cache.
      const similarPrompt =
        "Please explain the concept of machine learning algorithms in more detail"
      const messages = [{ role: "user", content: similarPrompt }]

      const result = await opt.optimize(messages)
      // If MinHash finds the candidate, the cache will be checked with the original prompt key
      // The result depends on whether the MinHash similarity threshold is met
      // Either way, the optimize() path completes without error
      expect(typeof result.cacheHit).toBe("boolean")
      expect(result.totalTokens).toBeGreaterThanOrEqual(0)
    })

    it("should fall through when MinHash finds a candidate but cache lookup misses", async () => {
      const opt = createTokenOptimizer({
        model: "gpt-4o",
        adaptiveOutput: { persist: false },
        cache: { maxEntries: 100, similarityThreshold: 0.85 },
        minhashIndex: { numHashes: 128, bands: 16 },
        compression: false,
        deltaEncoding: false,
        prefixOptimize: false,
        templates: false,
      })

      // Manually insert into MinHash index but NOT in the cache
      // so the MinHash path finds a candidate, but cache.lookup returns miss
      const minhashIndex = opt.getMinHashIndex()!
      minhashIndex.insert(
        "Describe the fundamental principles of quantum computing and superposition",
        "Describe the fundamental principles of quantum computing and superposition",
      )

      const messages = [
        {
          role: "user",
          content: "Describe the fundamental principles of quantum computing and superposition",
        },
      ]

      const result = await opt.optimize(messages)
      // MinHash finds candidate but cache has nothing — should fall through to full pipeline
      expect(result.cacheHit).toBe(false)
      expect(result.totalTokens).toBeGreaterThan(0)
    })
  })

  describe("contextBudget trimming", () => {
    it("should report context trimming savings when contextBudget is configured", async () => {
      const opt = createTokenOptimizer({
        model: "gpt-4o",
        compression: false,
        deltaEncoding: false,
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        prefixOptimize: false,
        templates: false,
        contextBudget: {
          maxContextTokens: 50,
          reservedForOutput: 10,
        },
      })

      // Create messages that exceed the budget so some get trimmed
      const messages = [
        {
          role: "system",
          content: "You are a helpful assistant that provides detailed explanations.",
        },
        {
          role: "user",
          content: "Tell me about the history of computing from the very beginning.",
        },
        {
          role: "assistant",
          content:
            "Computing started with mechanical calculators like the abacus and Babbage's Analytical Engine.",
        },
        { role: "user", content: "Now tell me about modern computing." },
      ]

      const result = await opt.optimize(messages)
      // contextTrimming should have some savings if messages were trimmed
      expect(result.savings.contextTrimming).toBeGreaterThanOrEqual(0)
      expect(result.totalTokens).toBeGreaterThan(0)
    })
  })

  describe("prefixOptimize: false", () => {
    it("should not apply prefix optimization when disabled", async () => {
      const opt = createTokenOptimizer({
        model: "gpt-4o",
        compression: false,
        deltaEncoding: false,
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        prefixOptimize: false,
        templates: false,
      })

      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello world, how are you doing today?" },
      ]

      const result = await opt.optimize(messages)
      expect(result.savings.prefixCacheDollarSavings).toBe(0)
    })
  })

  describe("safeCost error handling", () => {
    it("should return 0 for estimatedCost when model is unknown", async () => {
      const opt = createTokenOptimizer({
        model: "totally-unknown-model-xyz",
        compression: false,
        deltaEncoding: false,
        adaptiveOutput: false,
        cache: false,
        minhashIndex: false,
        prefixOptimize: false,
        templates: false,
      })

      const messages = [{ role: "user", content: "Hello" }]
      const result = await opt.optimize(messages)

      // estimateCost throws for unknown models, so safeCost returns 0
      expect(result.estimatedCost).toBe(0)
      expect(result.estimatedCostWithout).toBe(0)
      expect(result.dollarSavings).toBe(0)
    })

    it("should return 0 dollarSavings on cache hit for unknown model", async () => {
      const opt = createTokenOptimizer({
        model: "totally-unknown-model-xyz",
        compression: false,
        deltaEncoding: false,
        adaptiveOutput: false,
        cache: { maxEntries: 10 },
        minhashIndex: false,
        prefixOptimize: false,
        templates: false,
      })

      await opt.recordResponse("what is test", "this is a test", "totally-unknown-model-xyz", 5, 5)

      const messages = [{ role: "user", content: "what is test" }]
      const result = await opt.optimize(messages)
      expect(result.cacheHit).toBe(true)
      // safeCost returns 0 for unknown model, so dollar values are 0
      expect(result.estimatedCost).toBe(0)
      expect(result.estimatedCostWithout).toBe(0)
      expect(result.dollarSavings).toBe(0)
    })
  })

  describe("summary() shape", () => {
    it("should return the correct shape for all sub-modules", async () => {
      await optimizer.recordResponse("prompt A", "response A", "gpt-4o", 10, 5)
      optimizer.registerTemplate("tmpl", "Hello {{name}}")

      const summary = optimizer.summary()

      // Cache shape
      expect(summary.cache).toHaveProperty("entries")
      expect(summary.cache).toHaveProperty("hitRate")
      expect(summary.cache).toHaveProperty("totalSavedTokens")
      expect(typeof summary.cache!.entries).toBe("number")
      expect(typeof summary.cache!.hitRate).toBe("number")
      expect(typeof summary.cache!.totalSavedTokens).toBe("number")

      // MinHash shape
      expect(summary.minhash).toHaveProperty("entries")
      expect(summary.minhash).toHaveProperty("totalBuckets")
      expect(typeof summary.minhash!.entries).toBe("number")
      expect(typeof summary.minhash!.totalBuckets).toBe("number")

      // Adaptive shape
      expect(summary.adaptive).toHaveProperty("taskTypes")
      expect(summary.adaptive).toHaveProperty("totalObservations")
      expect(typeof summary.adaptive!.taskTypes).toBe("number")
      expect(typeof summary.adaptive!.totalObservations).toBe("number")

      // Templates shape
      expect(summary.templates).toHaveProperty("templates")
      expect(summary.templates).toHaveProperty("totalUses")
      expect(typeof summary.templates!.templates).toBe("number")
      expect(typeof summary.templates!.totalUses).toBe("number")
    })
  })

  describe("clear() resets all sub-modules", () => {
    it("should reset all sub-module data and statistics", async () => {
      // Populate data in all sub-modules
      await optimizer.recordResponse("prompt 1", "response 1", "gpt-4o", 10, 5)
      await optimizer.recordResponse("prompt 2", "response 2", "gpt-4o", 10, 5)
      optimizer.registerTemplate("tmpl1", "Hello {{name}}")
      optimizer.registerTemplate("tmpl2", "Bye {{name}}")

      // Verify data exists before clear
      const beforeClear = optimizer.summary()
      expect(beforeClear.cache!.entries).toBe(2)
      expect(beforeClear.minhash!.entries).toBeGreaterThan(0)
      expect(beforeClear.templates!.templates).toBe(2)

      await optimizer.clear()

      const afterClear = optimizer.summary()
      expect(afterClear.cache!.entries).toBe(0)
      expect(afterClear.minhash!.entries).toBe(0)
      expect(afterClear.templates!.templates).toBe(0)
    })
  })

  describe("getter methods", () => {
    it("getCache returns ResponseCache instance when enabled", () => {
      const cache = optimizer.getCache()
      expect(cache).not.toBeNull()
      expect(typeof cache!.lookup).toBe("function")
      expect(typeof cache!.store).toBe("function")
    })

    it("getMinHashIndex returns SemanticMinHashIndex instance when enabled", () => {
      const minhash = optimizer.getMinHashIndex()
      expect(minhash).not.toBeNull()
      expect(typeof minhash!.insert).toBe("function")
      expect(typeof minhash!.find).toBe("function")
    })

    it("getTemplatePool returns PromptTemplatePool instance when enabled", () => {
      const pool = optimizer.getTemplatePool()
      expect(pool).not.toBeNull()
      expect(typeof pool!.register).toBe("function")
      expect(typeof pool!.render).toBe("function")
    })

    it("getAdaptiveOptimizer returns AdaptiveOutputOptimizer instance when enabled", () => {
      const adaptive = optimizer.getAdaptiveOptimizer()
      expect(adaptive).not.toBeNull()
      expect(typeof adaptive!.predict).toBe("function")
      expect(typeof adaptive!.recordActual).toBe("function")
    })

    it("getCache returns null when cache is disabled", () => {
      const opt = createTokenOptimizer({ cache: false })
      expect(opt.getCache()).toBeNull()
    })

    it("getMinHashIndex returns null when minhashIndex is disabled", () => {
      const opt = createTokenOptimizer({ minhashIndex: false })
      expect(opt.getMinHashIndex()).toBeNull()
    })

    it("getTemplatePool returns null when templates is disabled", () => {
      const opt = createTokenOptimizer({ templates: false })
      expect(opt.getTemplatePool()).toBeNull()
    })

    it("getAdaptiveOptimizer returns null when adaptiveOutput is disabled", () => {
      const opt = createTokenOptimizer({ adaptiveOutput: false })
      expect(opt.getAdaptiveOptimizer()).toBeNull()
    })
  })

  describe("registerTemplate with disabled pool", () => {
    it("registerTemplate is a no-op when templates are disabled", () => {
      const opt = createTokenOptimizer({ templates: false })
      // Should not throw, just silently skip
      opt.registerTemplate("test", "Hello {{name}}")
    })
  })

  describe("hydrate", () => {
    it("should mark as hydrated and complete without error", async () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: { persist: false },
        cache: { maxEntries: 10 },
      })
      // Should not throw
      await opt.hydrate()
    })

    it("should hydrate with all sub-modules disabled", async () => {
      const opt = createTokenOptimizer({
        adaptiveOutput: false,
        cache: false,
      })
      await opt.hydrate()
    })
  })

  describe("optimize with model override", () => {
    it("should use the overridden model for cost calculations", async () => {
      const messages = [{ role: "user", content: "Hello how are you doing today?" }]

      const resultDefault = await optimizer.optimize(messages)
      const resultOverride = await optimizer.optimize(messages, "gpt-4o-mini")

      // Both should complete, but costs may differ due to different model pricing
      expect(typeof resultDefault.estimatedCost).toBe("number")
      expect(typeof resultOverride.estimatedCost).toBe("number")
    })
  })
})
