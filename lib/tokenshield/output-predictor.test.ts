/**
 * Output Predictor Tests
 *
 * Tests for the predictOutputTokens function which estimates
 * output token counts based on task-type detection and input analysis.
 */

import { describe, it, expect } from "vitest"
import { predictOutputTokens } from "./output-predictor"

describe("predictOutputTokens", () => {
  describe("task type detection", () => {
    it("detects factual-qa for simple questions", () => {
      const result = predictOutputTokens("What is the capital of France?")
      expect(result.taskType).toBe("factual-qa")
      expect(result.confidence).toBe("high")
      expect(result.predictedTokens).toBe(30)
    })

    it("detects yes-no questions", () => {
      const result = predictOutputTokens("Is TypeScript a superset of JavaScript?")
      expect(result.taskType).toBe("yes-no")
      expect(result.confidence).toBe("high")
      expect(result.predictedTokens).toBe(40)
    })

    it("detects classification tasks", () => {
      const result = predictOutputTokens("Classify this text as positive or negative sentiment")
      expect(result.taskType).toBe("classification")
      expect(result.confidence).toBe("high")
      expect(result.predictedTokens).toBe(20)
    })

    it("detects structured output / JSON requests", () => {
      const result = predictOutputTokens(
        "Return the data as a JSON object with name and age fields",
      )
      expect(result.taskType).toBe("structured-output")
      expect(result.confidence).toBe("medium")
      expect(result.predictedTokens).toBe(200)
    })

    it("detects code generation", () => {
      const result = predictOutputTokens("Write a function that implements a binary search")
      expect(result.taskType).toBe("code-generation")
      expect(result.confidence).toBe("medium")
      expect(result.predictedTokens).toBe(400)
    })

    it("detects summarization", () => {
      const result = predictOutputTokens("Summarize the following article in a brief overview")
      expect(result.taskType).toBe("summarization")
      expect(result.confidence).toBe("medium")
      expect(result.predictedTokens).toBe(150)
    })

    it("detects translation tasks", () => {
      const result = predictOutputTokens("Translate this sentence to Spanish: Hello, how are you?")
      expect(result.taskType).toBe("translation")
      expect(result.confidence).toBe("medium")
      // Translation: output proportional to input (~1.2x)
      expect(result.predictedTokens).toBeGreaterThan(0)
    })

    it("detects analysis/explanation tasks", () => {
      const result = predictOutputTokens("Explain how garbage collection works in JavaScript")
      expect(result.taskType).toBe("analysis")
      expect(result.confidence).toBe("medium")
      expect(result.predictedTokens).toBe(500)
    })

    it("detects list generation", () => {
      const result = predictOutputTokens("List 10 popular JavaScript frameworks")
      expect(result.taskType).toBe("list-generation")
      expect(result.confidence).toBe("medium")
      expect(result.predictedTokens).toBe(200)
    })
  })

  describe("fallback behavior", () => {
    it("returns low confidence for unrecognized prompts", () => {
      const result = predictOutputTokens("banana")
      expect(result.taskType).toBe("general")
      expect(result.confidence).toBe("low")
    })

    it("scales prediction with short input length (<30 tokens)", () => {
      const result = predictOutputTokens("Tell me about cats")
      // Short prompt, general task
      if (result.taskType === "general") {
        expect(result.predictedTokens).toBe(100)
      }
    })

    it("scales prediction with medium input length", () => {
      // Create a prompt that doesn't match any task pattern
      const longPrompt = "Here is some random text that ".repeat(10) + "nothing special."
      const result = predictOutputTokens(longPrompt)
      if (result.taskType === "general") {
        expect(result.predictedTokens).toBeGreaterThanOrEqual(100)
      }
    })

    it("caps prediction for very long inputs", () => {
      const veryLongPrompt = "word ".repeat(2000)
      const result = predictOutputTokens(veryLongPrompt)
      if (result.taskType === "general") {
        expect(result.predictedTokens).toBeLessThanOrEqual(2000)
      }
    })
  })

  describe("suggestedMaxTokens", () => {
    it("applies safety margin to predicted tokens", () => {
      const result = predictOutputTokens("What is the capital of France?")
      // Predicted 30, safety margin 1.5x = 45, but min is 50
      expect(result.suggestedMaxTokens).toBe(50)
    })

    it("respects custom safety margin", () => {
      const result = predictOutputTokens("What is the capital of France?", { safetyMargin: 3 })
      // Predicted 30, 3x margin = 90
      expect(result.suggestedMaxTokens).toBe(90)
    })

    it("respects minMaxTokens", () => {
      const result = predictOutputTokens("What is the capital of France?", { minMaxTokens: 200 })
      expect(result.suggestedMaxTokens).toBeGreaterThanOrEqual(200)
    })

    it("respects maxMaxTokens", () => {
      const result = predictOutputTokens(
        "Explain everything about quantum physics in great detail",
        { maxMaxTokens: 500 },
      )
      expect(result.suggestedMaxTokens).toBeLessThanOrEqual(500)
    })

    it("never exceeds maxMaxTokens default of 4096", () => {
      const result = predictOutputTokens("Write an extremely detailed essay about everything")
      expect(result.suggestedMaxTokens).toBeLessThanOrEqual(4096)
    })
  })

  describe("savingsVsBlanket", () => {
    it("calculates savings compared to 4096 blanket", () => {
      const result = predictOutputTokens("What is 2+2?")
      expect(result.savingsVsBlanket).toBe(4096 - result.suggestedMaxTokens)
      expect(result.savingsVsBlanket).toBeGreaterThan(0)
    })

    it("uses custom maxMaxTokens as blanket baseline", () => {
      const result = predictOutputTokens("What is 2+2?", { maxMaxTokens: 1000 })
      expect(result.savingsVsBlanket).toBe(1000 - result.suggestedMaxTokens)
    })
  })

  describe("length modifiers", () => {
    it("reduces prediction for brevity instructions on general tasks", () => {
      const verbose = predictOutputTokens("Tell me about quantum computing")
      const brief = predictOutputTokens("Tell me about quantum computing. Be concise.")
      // Brief should predict fewer tokens or equal (due to modifier)
      expect(brief.predictedTokens).toBeLessThanOrEqual(verbose.predictedTokens)
    })

    it("increases prediction for verbosity instructions on analysis tasks", () => {
      const normal = predictOutputTokens("Explain how React works")
      const detailed = predictOutputTokens("Explain how React works in detail, step by step")
      expect(detailed.predictedTokens).toBeGreaterThanOrEqual(normal.predictedTokens)
    })

    it("does not apply length modifiers to classification tasks", () => {
      // "brief" in the prompt should not affect classification predictions
      const result = predictOutputTokens(
        "Classify this brief text as positive or negative sentiment",
      )
      expect(result.taskType).toBe("classification")
      expect(result.predictedTokens).toBe(20) // unchanged by "brief"
    })

    it("does not apply length modifiers to summarization tasks", () => {
      const result = predictOutputTokens("Summarize the following article in a brief overview")
      expect(result.taskType).toBe("summarization")
      expect(result.predictedTokens).toBe(150) // unchanged by "brief"
    })
  })

  describe("model multipliers", () => {
    it("adjusts predictions for verbose models (Claude)", () => {
      const base = predictOutputTokens("Explain gravity", {})
      const claude = predictOutputTokens("Explain gravity", { modelId: "claude-opus-4.5" })
      // Claude should predict more tokens (1.3x multiplier)
      expect(claude.predictedTokens).toBeGreaterThan(base.predictedTokens)
    })

    it("adjusts predictions for concise models (GPT-4.1 Nano)", () => {
      const base = predictOutputTokens("Explain gravity", {})
      const nano = predictOutputTokens("Explain gravity", { modelId: "gpt-4.1-nano" })
      // Nano should predict fewer tokens (0.75x multiplier)
      expect(nano.predictedTokens).toBeLessThan(base.predictedTokens)
    })

    it("uses 1.0 multiplier for unknown models", () => {
      const base = predictOutputTokens("What is the capital of France?", {})
      const unknown = predictOutputTokens("What is the capital of France?", {
        modelId: "unknown-model-xyz",
      })
      expect(unknown.predictedTokens).toBe(base.predictedTokens)
    })

    it("matches model prefix for versioned models", () => {
      const versioned = predictOutputTokens("What is the capital of France?", {
        modelId: "gpt-4o-2024-08-06",
      })
      const base = predictOutputTokens("What is the capital of France?", { modelId: "gpt-4o" })
      expect(versioned.predictedTokens).toBe(base.predictedTokens)
    })
  })

  describe("OutputPrediction shape", () => {
    it("returns all required fields", () => {
      const result = predictOutputTokens("Hello")
      expect(result).toHaveProperty("predictedTokens")
      expect(result).toHaveProperty("confidence")
      expect(result).toHaveProperty("taskType")
      expect(result).toHaveProperty("suggestedMaxTokens")
      expect(result).toHaveProperty("savingsVsBlanket")
      expect(typeof result.predictedTokens).toBe("number")
      expect(typeof result.suggestedMaxTokens).toBe("number")
      expect(typeof result.savingsVsBlanket).toBe("number")
      expect(["high", "medium", "low"]).toContain(result.confidence)
    })

    it("all numeric fields are non-negative", () => {
      const prompts = ["What is 1+1?", "Summarize this text", "Write a Python class", "Hello world"]
      for (const prompt of prompts) {
        const result = predictOutputTokens(prompt)
        expect(result.predictedTokens).toBeGreaterThanOrEqual(0)
        expect(result.suggestedMaxTokens).toBeGreaterThanOrEqual(0)
        expect(result.savingsVsBlanket).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
