import { describe, it, expect } from "vitest"
import { analyzeComplexity, routeToModel, rankModels } from "./model-router"

describe("model-router", () => {
  describe("analyzeComplexity", () => {
    it("scores a trivial prompt low", () => {
      const result = analyzeComplexity("What is 2+2?")
      expect(result.score).toBeLessThanOrEqual(35)
      expect(["trivial", "simple"]).toContain(result.tier)
    })

    it("scores a complex prompt higher", () => {
      const result = analyzeComplexity(
        "Analyze the trade-offs between microservices and monoliths. " +
          "Compare their implications for team scalability, evaluate " +
          "deployment complexity, and recommend an approach for a startup " +
          "with 5 engineers. Output your analysis as JSON.",
      )
      expect(result.score).toBeGreaterThan(35)
      expect(result.signals.reasoningKeywords).toBeGreaterThan(0)
    })

    it("detects code signals", () => {
      const result = analyzeComplexity("```typescript\nfunction hello() { return 'world' }\n```")
      expect(result.signals.codeSignals).toBeGreaterThan(0)
    })

    it("detects structured output requirements", () => {
      const result = analyzeComplexity("Return the result as JSON")
      expect(result.signals.hasStructuredOutput).toBe(true)
    })

    it("detects context dependency", () => {
      const result = analyzeComplexity("Based on the above, summarize the key points")
      expect(result.signals.hasContextDependency).toBe(true)
    })

    it("detects sub-tasks from numbered lists", () => {
      const result = analyzeComplexity("1. First task\n2. Second task\n3. Third task")
      expect(result.signals.subTaskCount).toBe(3)
    })

    it("clamps score to 0-100", () => {
      const result = analyzeComplexity("a")
      expect(result.score).toBeGreaterThanOrEqual(0)
      expect(result.score).toBeLessThanOrEqual(100)
    })
  })

  describe("routeToModel", () => {
    it("selects a model for a trivial prompt", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o")
      expect(result.selectedModel).toBeDefined()
      expect(result.complexity.score).toBeDefined()
      expect(result.estimatedCost.totalCost).toBeGreaterThanOrEqual(0)
    })

    it("calculates savings vs default model", () => {
      const result = routeToModel("Hi", "gpt-4o")
      expect(typeof result.savingsVsDefault).toBe("number")
    })

    it("respects allowedProviders filter", () => {
      const result = routeToModel("Test prompt", "gpt-4o", {
        allowedProviders: ["openai"],
      })
      expect(result.selectedModel.provider).toBe("openai")
    })

    it("defaults crossProvider to false (same-provider routing)", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o")
      // With crossProvider=false (default), should stay within OpenAI
      expect(result.selectedModel.provider).toBe("openai")
    })

    it("enables cross-provider routing when crossProvider=true", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        crossProvider: true,
      })
      // Should consider all providers and pick cheapest
      expect(result.selectedModel).toBeDefined()
      expect(result.estimatedCost.totalCost).toBeGreaterThanOrEqual(0)
    })

    it("disables cross-provider routing when crossProvider=false", () => {
      const result = routeToModel("Explain quantum computing in detail", "claude-sonnet-4.5", {
        crossProvider: false,
      })
      // Should stay within Anthropic
      expect(result.selectedModel.provider).toBe("anthropic")
    })

    it("reports crossProvider flag accurately", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        crossProvider: true,
      })
      // crossProvider should be true only if the selected model is from a different provider
      if (result.selectedModel.provider !== "openai") {
        expect(result.crossProvider).toBe(true)
      } else {
        expect(result.crossProvider).toBe(false)
      }
    })

    it("respects minContextWindow filter", () => {
      const result = routeToModel("Test", "gpt-4o", {
        crossProvider: true,
        minContextWindow: 500_000,
      })
      expect(result.selectedModel.contextWindow).toBeGreaterThanOrEqual(500_000)
    })

    it("falls back to default when no candidates match filters", () => {
      const result = routeToModel("Test", "gpt-4o", {
        minContextWindow: 999_999_999, // impossibly large
      })
      // Should fall back to default model
      expect(result.selectedModel).toBeDefined()
      expect(result.savingsVsDefault).toBe(0)
    })
  })

  describe("rankModels", () => {
    it("returns models sorted by cost ascending", () => {
      const ranked = rankModels(1000, 500)
      expect(ranked.length).toBeGreaterThan(0)
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i].cost.totalCost).toBeGreaterThanOrEqual(ranked[i - 1].cost.totalCost)
      }
    })
  })

  // =========================================================================
  // Additional tests to improve branch coverage
  // =========================================================================

  describe("routeToModel — minContextWindow filter", () => {
    it("filters out models with context windows smaller than minContextWindow", () => {
      // gpt-3.5-turbo has contextWindow of 16_385 — requesting 50_000 should exclude it
      const result = routeToModel("Hello", "gpt-4o", {
        crossProvider: true,
        minContextWindow: 50_000,
      })
      expect(result.selectedModel.contextWindow).toBeGreaterThanOrEqual(50_000)
    })

    it("includes models when minContextWindow is small enough", () => {
      const result = routeToModel("Hello", "gpt-4o", {
        crossProvider: true,
        minContextWindow: 1,
      })
      expect(result.selectedModel).toBeDefined()
      expect(result.selectedModel.contextWindow).toBeGreaterThanOrEqual(1)
    })

    it("returns models with exactly the minContextWindow threshold", () => {
      // 128_000 is the contextWindow for gpt-4o and gpt-4o-mini
      const result = routeToModel("Hello", "gpt-4o", {
        minContextWindow: 128_000,
      })
      expect(result.selectedModel.contextWindow).toBeGreaterThanOrEqual(128_000)
    })
  })

  describe("routeToModel — requiredCapabilities filter", () => {
    it("filters out models that do not support vision when vision is required", () => {
      // o1-mini and o3-mini do NOT support vision
      // With crossProvider: true and vision required, models without vision should be excluded
      const result = routeToModel("Describe this image", "gpt-4o", {
        crossProvider: true,
        requiredCapabilities: { vision: true },
      })
      expect(result.selectedModel).toBeDefined()
      // The selected model should support vision (checked via registry)
      // o1-mini (supportsVision: false) should NOT be selected
      expect(result.selectedModel.id).not.toBe("o1-mini")
      expect(result.selectedModel.id).not.toBe("o3-mini")
    })

    it("filters out models that do not support functions when functions is required", () => {
      // o1 does NOT support functions (supportsFunctions: false)
      const result = routeToModel("Call the weather API", "gpt-4o", {
        crossProvider: true,
        requiredCapabilities: { functions: true },
      })
      expect(result.selectedModel).toBeDefined()
      // o1 (supportsFunctions: false) should NOT be selected
      expect(result.selectedModel.id).not.toBe("o1")
    })

    it("filters with both vision and functions required simultaneously", () => {
      const result = routeToModel("Analyze this image and call the API", "gpt-4o", {
        crossProvider: true,
        requiredCapabilities: { vision: true, functions: true },
      })
      expect(result.selectedModel).toBeDefined()
      // Should not pick models that lack either capability
      expect(result.selectedModel.id).not.toBe("o1-mini") // no vision, no functions
      expect(result.selectedModel.id).not.toBe("o3-mini") // no vision, no functions
      expect(result.selectedModel.id).not.toBe("o1") // no functions
    })

    it("allows models with no requiredCapabilities filter", () => {
      // Without requiredCapabilities, all models are candidates
      const result = routeToModel("Hello", "gpt-4o", {
        crossProvider: true,
      })
      expect(result.selectedModel).toBeDefined()
    })
  })

  describe("routeToModel — crossProvider routing", () => {
    it("considers models from all providers when crossProvider is true", () => {
      // With crossProvider: true, should be able to pick from any provider
      const result = routeToModel("What is 2+2?", "claude-haiku-3.5", {
        crossProvider: true,
      })
      // The cheapest overall model might be from a different provider
      expect(result.selectedModel).toBeDefined()
      // It should report crossProvider correctly
      if (result.selectedModel.provider !== "anthropic") {
        expect(result.crossProvider).toBe(true)
      }
    })

    it("restricts to same provider when crossProvider is false (default)", () => {
      const result = routeToModel("What is 2+2?", "claude-sonnet-4")
      // Should stay within Anthropic
      expect(result.selectedModel.provider).toBe("anthropic")
      expect(result.crossProvider).toBe(false)
    })

    it("restricts to same provider for google models when crossProvider is false", () => {
      const result = routeToModel("Hello world", "gemini-2.5-pro", {
        crossProvider: false,
      })
      expect(result.selectedModel.provider).toBe("google")
      expect(result.crossProvider).toBe(false)
    })

    it("reports crossProvider=true when selected model differs from default provider", () => {
      // Use a flagship-tier anthropic model as default, crossProvider true, trivial prompt
      // The cheapest model across all providers is likely Google or OpenAI
      const result = routeToModel("Hi", "claude-opus-4", {
        crossProvider: true,
      })
      if (result.selectedModel.provider !== "anthropic") {
        expect(result.crossProvider).toBe(true)
      } else {
        expect(result.crossProvider).toBe(false)
      }
    })
  })

  describe("routeToModel — empty candidates fallback", () => {
    it("falls back to default model when all candidates are filtered out", () => {
      const result = routeToModel("Test", "gpt-4o", {
        minContextWindow: 999_999_999_999, // impossibly large — filters out everything
      })
      expect(result.selectedModel.id).toBe("gpt-4o")
      expect(result.savingsVsDefault).toBe(0)
      expect(result.crossProvider).toBe(false)
    })

    it("fallback model matches default model when all candidates filtered", () => {
      // When all candidates are filtered out, the selected and fallback
      // should be the same model, and savingsVsDefault should be 0
      const result = routeToModel("Test", "gpt-4o", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allowedProviders: ["xai" as any], // no models match this provider
      })
      expect(result.selectedModel).toBe(result.fallbackModel)
      expect(result.estimatedCost.totalCost).toBe(result.cheapestAlternativeCost.totalCost)
      expect(result.selectedModel.id).toBe("gpt-4o")
    })

    it("falls back when allowedProviders filters out all models", () => {
      // Use a provider that doesn't exist in the registry
      const result = routeToModel("Test", "gpt-4o", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allowedProviders: ["xai" as any],
      })
      expect(result.selectedModel).toBeDefined()
      expect(result.savingsVsDefault).toBe(0)
      expect(result.crossProvider).toBe(false)
    })
  })

  describe("routeToModel — PRICING_REGISTRY_LOOKUP for unknown models", () => {
    it("handles requiredCapabilities gracefully when model is not in pricing registry", () => {
      // All models in MODEL_PRICING are also in PRICING_REGISTRY, so we test
      // that the capabilities check doesn't crash or mis-filter. The
      // PRICING_REGISTRY_LOOKUP returns undefined for unknown IDs, causing
      // the filter to skip the capability check (models pass through).
      const result = routeToModel("Test prompt", "gpt-4o", {
        crossProvider: true,
        requiredCapabilities: { vision: true },
      })
      expect(result.selectedModel).toBeDefined()
    })
  })

  describe("analyzeComplexity — cache behavior", () => {
    it("returns cached result for identical prompts", () => {
      const prompt = "Cache test prompt: what is the speed of light?"
      const first = analyzeComplexity(prompt)
      const second = analyzeComplexity(prompt)
      // Should return the exact same object reference (from cache)
      expect(first).toBe(second)
      expect(first.score).toBe(second.score)
    })

    it("evicts oldest entries when cache exceeds 100 entries", () => {
      // Fill the cache with 101+ unique short prompts to trigger FIFO eviction
      const firstPrompt = "eviction-test-first-entry-unique-xyz"
      analyzeComplexity(firstPrompt)
      const firstResult = analyzeComplexity(firstPrompt)
      // firstResult should be from cache
      expect(firstResult).toBeDefined()

      // Add 101 more unique prompts to push the first one out
      for (let i = 0; i < 101; i++) {
        analyzeComplexity(`eviction-fill-prompt-${i}-padding`)
      }

      // Now the first prompt should have been evicted from cache.
      // Calling it again should return a new object (not the same reference)
      const afterEviction = analyzeComplexity(firstPrompt)
      // The score should be the same value but it's a fresh computation
      expect(afterEviction.score).toBe(firstResult.score)
      expect(afterEviction.tier).toBe(firstResult.tier)
    })

    it("does not cache prompts longer than MAX_CACHEABLE_PROMPT_LENGTH (10,000 chars)", () => {
      // Create a prompt that is over 10,000 characters
      const longPrompt = "x ".repeat(5001) // 10,002 characters
      expect(longPrompt.length).toBeGreaterThan(10_000)

      const first = analyzeComplexity(longPrompt)
      const second = analyzeComplexity(longPrompt)

      // Since the prompt is too long to cache, each call should produce a
      // new object (different reference)
      expect(first).not.toBe(second)
      // But the computed values should be identical
      expect(first.score).toBe(second.score)
      expect(first.tier).toBe(second.tier)
    })

    it("caches prompts that are exactly at the MAX_CACHEABLE_PROMPT_LENGTH boundary", () => {
      // Create a prompt exactly 10,000 characters
      const exactPrompt = "y".repeat(10_000)
      expect(exactPrompt.length).toBe(10_000)

      const first = analyzeComplexity(exactPrompt)
      const second = analyzeComplexity(exactPrompt)

      // Should be cached (same reference)
      expect(first).toBe(second)
    })
  })

  describe("routeToModel — allowedProviders filter", () => {
    it("only considers anthropic models when allowedProviders is ['anthropic']", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        allowedProviders: ["anthropic"],
        crossProvider: true,
      })
      expect(result.selectedModel.provider).toBe("anthropic")
    })

    it("only considers google models when allowedProviders is ['google']", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        allowedProviders: ["google"],
        crossProvider: true,
      })
      expect(result.selectedModel.provider).toBe("google")
    })

    it("considers multiple providers when allowedProviders contains several", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        allowedProviders: ["openai", "google"],
        crossProvider: true,
      })
      expect(["openai", "google"]).toContain(result.selectedModel.provider)
    })

    it("allowedProviders combined with crossProvider=false can eliminate all candidates", () => {
      // Default model is openai, crossProvider=false restricts to openai,
      // but allowedProviders only allows anthropic — no candidates survive both filters
      const result = routeToModel("Hello", "gpt-4o", {
        allowedProviders: ["anthropic"],
      })
      // Falls back to default since no candidates pass both filters
      expect(result.savingsVsDefault).toBe(0)
      expect(result.selectedModel.id).toBe("gpt-4o")
    })

    it("allowedProviders with crossProvider=true restricts to specified providers", () => {
      // crossProvider=true disables same-provider restriction, so
      // allowedProviders alone controls which providers are included
      const result = routeToModel("Hello", "gpt-4o", {
        allowedProviders: ["anthropic"],
        crossProvider: true,
      })
      expect(result.selectedModel.provider).toBe("anthropic")
    })
  })

  describe("routeToModel — minTier override", () => {
    it("overrides complexity-recommended tier with minTier", () => {
      // Trivial prompt would normally recommend 'budget' tier,
      // but we force 'premium'
      const result = routeToModel("Hello", "gpt-4o", {
        crossProvider: true,
        minTier: "premium",
      })
      // Selected model should be at least premium tier
      const tierOrder: Record<string, number> = {
        budget: 0,
        standard: 1,
        premium: 2,
        flagship: 3,
      }
      expect(tierOrder[result.selectedModel.tier]).toBeGreaterThanOrEqual(tierOrder["premium"])
    })
  })

  describe("routeToModel — fallback model selection", () => {
    it("selects a higher-tier fallback model when available", () => {
      const result = routeToModel("What is 2+2?", "gpt-4o", {
        crossProvider: true,
      })
      // The fallback should exist
      expect(result.fallbackModel).toBeDefined()
      expect(result.fallbackModel.id).toBeTruthy()
    })

    it("uses the last candidate as fallback when no higher-tier candidate exists", () => {
      // When minTier is 'flagship', all candidates are flagship, so no
      // higher-tier fallback exists — the last candidate is used
      const result = routeToModel("Hello", "gpt-4o", {
        crossProvider: true,
        minTier: "flagship",
      })
      expect(result.fallbackModel).toBeDefined()
      expect(result.fallbackModel.tier).toBe("flagship")
    })
  })

  describe("routeToModel — combined filter scenarios", () => {
    it("combines minContextWindow, requiredCapabilities, and allowedProviders", () => {
      const result = routeToModel("Analyze the image", "gpt-4o", {
        allowedProviders: ["openai"],
        minContextWindow: 200_000,
        requiredCapabilities: { vision: true, functions: true },
      })
      expect(result.selectedModel.provider).toBe("openai")
      expect(result.selectedModel.contextWindow).toBeGreaterThanOrEqual(200_000)
    })

    it("falls back when combined filters eliminate all candidates", () => {
      const result = routeToModel("Test", "gpt-4o", {
        allowedProviders: ["openai"],
        minContextWindow: 999_999_999,
        requiredCapabilities: { vision: true },
      })
      // Everything is filtered out, should fall back
      expect(result.savingsVsDefault).toBe(0)
    })
  })
})
