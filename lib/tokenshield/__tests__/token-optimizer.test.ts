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
        8
      )

      const messages = [
        { role: "user", content: "What is the capital of France?" },
      ]

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
      await optimizer.recordResponse(
        "Test prompt",
        "Test response",
        "gpt-4o",
        5,
        4
      )

      const summary = optimizer.summary()
      expect(summary.cache).not.toBeNull()
      expect(summary.cache!.entries).toBe(1)
    })

    it("should update adaptive predictions", async () => {
      // Record multiple responses
      for (let i = 0; i < 5; i++) {
        await optimizer.recordResponse(
          `What is ${i}?`,
          `${i}`,
          "gpt-4o",
          5,
          3
        )
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
      expect(() =>
        noTemplates.renderTemplate("test", {})
      ).toThrow("Template pool is disabled")
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
})
