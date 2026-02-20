import { describe, it, expect, afterEach } from "vitest"
import { analyzeComplexity, routeToModel, rankModels, resetComplexityCache } from "./model-router"

describe("model-router", () => {
  afterEach(() => {
    resetComplexityCache()
  })

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
})
