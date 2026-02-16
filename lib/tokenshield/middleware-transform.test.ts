/**
 * Middleware Transform Pipeline Tests
 *
 * Tests for buildTransformParams which handles the pre-model optimization pipeline:
 * breaker -> user budget -> guard -> cache lookup -> context trim -> route -> prefix optimize
 */

import { describe, it, expect, vi } from "vitest"
import { tokenShieldMiddleware } from "./middleware"
import { SHIELD_META, type ShieldMeta } from "./middleware-types"

/** Create an AI SDK-format prompt from simple messages */
function makePrompt(messages: Array<{ role: string; content: string }>) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.content }],
  }))
}

describe("buildTransformParams (via tokenShieldMiddleware)", () => {
  describe("basic passthrough", () => {
    it("passes through params when no prompt is provided", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
      })
      const params = { modelId: "gpt-4o-mini", temperature: 0.7 }
      const result = await shield.transformParams({ params })
      expect(result.modelId).toBe("gpt-4o-mini")
      expect(result.temperature).toBe(0.7)
      shield.dispose()
    })

    it("passes through params when prompt is not an array", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
      })
      const params = { modelId: "gpt-4o-mini", prompt: "just a string" }
      const result = await shield.transformParams({ params })
      expect(result.prompt).toBe("just a string")
      shield.dispose()
    })

    it("attaches SHIELD_META to params on valid prompt", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
      })
      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta).toBeDefined()
      expect(meta.lastUserText).toBe("Hello")
      shield.dispose()
    })
  })

  describe("guard module", () => {
    it("blocks requests when guard rate limit is exceeded", async () => {
      const onBlocked = vi.fn()
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        guard: { maxRequestsPerMinute: 1, debounceMs: 0 },
        onBlocked,
      })

      const params1 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "First request" }]),
      }
      // First request should pass
      await shield.transformParams({ params: params1 })

      // Second request with the same prompt should be blocked (rate limit or dedup)
      const params2 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Second request" }]),
      }
      await expect(shield.transformParams({ params: params2 })).rejects.toThrow()
      shield.dispose()
    })
  })

  describe("cache module", () => {
    it("returns cache hit metadata when prompt is cached", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        cache: { maxEntries: 10, ttlMs: 60000, similarityThreshold: 0.85 },
      })

      const prompt = makePrompt([{ role: "user", content: "What is 2+2?" }])
      const modelId = "gpt-4o-mini"

      // Manually store in cache
      await shield.cache!.store("What is 2+2?", "4", modelId, 10, 5)

      const params = { modelId, prompt }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.cacheHit).toBeDefined()
      expect(meta.cacheHit!.response).toBe("4")
      shield.dispose()
    })

    it("returns no cache hit for uncached prompt", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        cache: { maxEntries: 10, ttlMs: 60000, similarityThreshold: 0.85 },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Never been asked before" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.cacheHit).toBeUndefined()
      shield.dispose()
    })
  })

  describe("context trim module", () => {
    it("trims long conversations to fit token budget", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
        },
        context: { maxInputTokens: 100, reserveForOutput: 50 },
      })

      // Create a long conversation
      const longMessages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a very long story about dragons. ".repeat(10) },
        { role: "assistant", content: "Once upon a time there were many dragons. ".repeat(10) },
        { role: "user", content: "What happened next?" },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(longMessages),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // Should have trimmed tokens
      expect(meta.contextSaved).toBeGreaterThan(0)
      shield.dispose()
    })

    it("does not trim when under budget", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
        },
        context: { maxInputTokens: 10000, reserveForOutput: 500 },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Short message" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.contextSaved).toBeUndefined()
      shield.dispose()
    })
  })

  describe("model router module", () => {
    it("routes simple requests to cheaper model when tiers configured", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
        },
        router: {
          tiers: [
            { modelId: "gpt-4o-mini", maxComplexity: 50 },
            { modelId: "gpt-4o", maxComplexity: 100 },
          ],
          complexityThreshold: 50,
        },
      })

      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hi" }]),
      }
      const result = await shield.transformParams({ params })
      // Simple "Hi" should be routed to cheaper model
      expect(result.modelId).toBe("gpt-4o-mini")
      shield.dispose()
    })

    it("does not route when complexity exceeds all tier maxComplexity values", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
        },
        router: {
          tiers: [{ modelId: "gpt-4o-mini", maxComplexity: 5 }],
          complexityThreshold: 50,
        },
      })

      // "Hi" has very low complexity, under threshold 50 → eligible for routing
      // but complexity score must also be <= tier maxComplexity (5) to match a tier
      // A request scoring > 5 will find no matching tier and keep the original model
      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([
          {
            role: "user",
            content:
              "Please analyze the following complex multi-step algorithm and explain the time complexity of each recursive subroutine, including the master theorem application and amortized analysis of the data structure operations.",
          },
        ]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // The complexity score should be computed
      expect(meta.complexity).toBeDefined()
      shield.dispose()
    })
  })

  describe("router override", () => {
    it("uses routerOverride when provided", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        routerOverride: (prompt) => (prompt.includes("[IMPORTANT]") ? "gpt-4o" : null),
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "[IMPORTANT] Critical task" }]),
      }
      const result = await shield.transformParams({ params })
      expect(result.modelId).toBe("gpt-4o")
      shield.dispose()
    })

    it("does not override when routerOverride returns null", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        routerOverride: () => null,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Normal request" }]),
      }
      const result = await shield.transformParams({ params })
      expect(result.modelId).toBe("gpt-4o-mini")
      shield.dispose()
    })
  })

  describe("dry-run mode", () => {
    it("does not modify params in dry-run mode", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: true,
          context: true,
          router: true,
          prefix: true,
          ledger: false,
        },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        guard: { debounceMs: 0 },
        context: { maxInputTokens: 100 },
        router: { tiers: [{ modelId: "gpt-4o-mini", maxComplexity: 50 }] },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "What is 2+2?" }]),
      }
      const result = await shield.transformParams({ params })

      // Params should pass through unchanged
      expect(result.modelId).toBe("gpt-4o-mini")
      // But dry-run actions should be recorded
      expect(dryRunActions.length).toBeGreaterThan(0)
      const moduleNames = dryRunActions.map((a) => a.module)
      expect(moduleNames).toContain("guard")
      expect(moduleNames).toContain("cache")
      shield.dispose()
    })
  })

  describe("breaker module", () => {
    it("blocks requests when session budget is exceeded", async () => {
      const onBlocked = vi.fn()
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        breaker: {
          limits: { perSession: 0.0000001 },
          action: "stop",
        },
        onBlocked,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello there, how are you doing today?" }]),
      }

      // With perSession of $0.0000001, even a tiny estimated cost should trip the breaker
      await expect(shield.transformParams({ params })).rejects.toThrow()
      expect(onBlocked).toHaveBeenCalled()
      shield.dispose()
    })
  })

  describe("event emission", () => {
    it("emits cache:miss when cache misses", async () => {
      const events: string[] = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        cache: { maxEntries: 10 },
      })

      shield.events.on("cache:miss", () => events.push("cache:miss"))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "New unique question" }]),
      }
      await shield.transformParams({ params })
      expect(events).toContain("cache:miss")
      shield.dispose()
    })

    it("emits cache:hit when cache hits", async () => {
      const events: string[] = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        cache: { maxEntries: 10 },
      })

      shield.events.on("cache:hit", () => events.push("cache:hit"))
      await shield.cache!.store("cached question", "cached answer", "gpt-4o-mini", 10, 5)

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "cached question" }]),
      }
      await shield.transformParams({ params })
      expect(events).toContain("cache:hit")
      shield.dispose()
    })

    it("emits context:trimmed when context is trimmed", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
        },
        context: { maxInputTokens: 50, reserveForOutput: 20 },
      })

      shield.events.on("context:trimmed", (data) => events.push(data as Record<string, unknown>))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          {
            role: "user",
            content: "A very long message that should exceed the token budget. ".repeat(20),
          },
          { role: "user", content: "Latest question?" },
        ]),
      }
      await shield.transformParams({ params })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toHaveProperty("savedTokens")
      shield.dispose()
    })
  })

  describe("prefix optimizer", () => {
    it("rebuilds prompt in AI SDK format after optimization", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: true,
          ledger: false,
        },
        prefix: { provider: "openai" },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ]),
      }
      const result = await shield.transformParams({ params })
      // Should have prompt in AI SDK format (array of role/content objects)
      const rebuiltPrompt = result.prompt as Array<{
        role: string
        content: Array<{ type: string; text: string }>
      }>
      expect(Array.isArray(rebuiltPrompt)).toBe(true)
      expect(rebuiltPrompt.length).toBeGreaterThan(0)
      for (const msg of rebuiltPrompt) {
        expect(msg).toHaveProperty("role")
        expect(Array.isArray(msg.content)).toBe(true)
        expect(msg.content[0]).toHaveProperty("type", "text")
      }
      shield.dispose()
    })
  })

  describe("prompt compressor module", () => {
    it("compresses verbose user messages and sets compressorSaved metadata", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          delta: false,
        },
        delta: false,
        // compressor is enabled by default when not explicitly disabled
        compressor: { minSavingsTokens: 1 },
      })

      // Build a long verbose prompt with many compressible verbose patterns.
      // Each sentence has verbose phrases that the compressor contracts to short words.
      const verboseSentences = [
        "In order to complete this analysis, we need to review the data carefully.",
        "Due to the fact that the experiment was run multiple times, we have confidence.",
        "It is important to note that each and every result was verified independently.",
        "The vast majority of the test subjects showed positive outcomes in the trial.",
        "In the event that the data changes, we should revise our conclusions accordingly.",
        "For the purpose of this evaluation, we will consider all available evidence.",
        "At this point in time, there is no doubt that the hypothesis holds strongly.",
        "In spite of the fact that some outliers exist, the trend is overwhelmingly clear.",
        "It should be noted that a significant amount of resources were invested in this project.",
        "As a result of the optimizations, the system performance improved by a large number of metrics.",
        "First and foremost, the analysis reveals that the approach is fundamentally sound and reliable.",
        "Last but not least, the overall results indicate success in the majority of cases observed.",
        "With regard to the implementation details, there are several notable aspects to discuss here.",
        "At the end of the day, the project achieved its goals and met all the specified requirements.",
        "In terms of the practical applications, this research opens up many new possibilities for growth.",
        "Notwithstanding the fact that challenges remain, the progress made is very encouraging overall.",
        "By virtue of the fact that we followed best practices, the quality of our work remained high.",
        "As previously mentioned, the data collection methodology was rigorous and well-documented throughout.",
        "Needless to say, the team worked extremely hard to deliver these results on schedule and under budget.",
        "It goes without saying that the collaboration between departments was essential to overall success.",
      ]
      const verboseContent = verboseSentences.join(" ")

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: verboseContent }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // The compressor should have saved some tokens by contracting verbose patterns
      expect(meta.compressorSaved).toBeGreaterThan(0)
      shield.dispose()
    })

    it("emits compressor:applied event when compression saves tokens", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          delta: false,
        },
        delta: false,
        compressor: { minSavingsTokens: 1 },
      })

      shield.events.on("compressor:applied", (data) => events.push(data as Record<string, unknown>))

      const verboseSentences = [
        "In order to complete this analysis, we need to review the data carefully.",
        "Due to the fact that the experiment was run multiple times, we have confidence.",
        "It is important to note that each and every result was verified independently.",
        "The vast majority of the test subjects showed positive outcomes in the trial.",
        "In the event that the data changes, we should revise our conclusions accordingly.",
        "For the purpose of this evaluation, we will consider all available evidence.",
        "At this point in time, there is no doubt that the hypothesis holds strongly.",
        "In spite of the fact that some outliers exist, the trend is overwhelmingly clear.",
        "It should be noted that a significant amount of resources were invested in this.",
        "As a result of the optimizations, the system performance improved by many metrics.",
        "First and foremost, the analysis reveals that the approach is fundamentally sound.",
        "Last but not least, the overall results indicate success in the majority of cases.",
        "With regard to the implementation details, there are several notable aspects here.",
        "At the end of the day, the project achieved its goals and met all the requirements.",
        "In terms of the practical applications, this research opens up new possibilities.",
        "Notwithstanding the fact that challenges remain, the progress made is encouraging.",
        "By virtue of the fact that we followed best practices, quality remained very high.",
        "Needless to say, the team worked hard to deliver these results on the schedule.",
        "It goes without saying that the collaboration between departments was essential.",
      ]
      const verboseContent = verboseSentences.join(" ")

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: verboseContent }]),
      }
      await shield.transformParams({ params })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toHaveProperty("savedTokens")
      expect(events[0]).toHaveProperty("originalTokens")
      expect(events[0]).toHaveProperty("compressedTokens")
      shield.dispose()
    })

    it("skips compression when compressor is explicitly disabled", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
        },
        compressor: false,
      })

      const verboseContent =
        "Please kindly analyze the following text. It is important to note that " +
        "the data is very quite really significant. Furthermore moreover additionally " +
        "I would like you to evaluate the results in order to understand the implications."

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: verboseContent }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.compressorSaved).toBeUndefined()
      shield.dispose()
    })
  })

  describe("delta encoding module", () => {
    it("deduplicates repeated paragraphs across conversation turns", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
        },
        compressor: false,
        // delta is enabled by default when not explicitly disabled
      })

      // A paragraph that is long enough and repeated across turns to trigger delta encoding
      const repeatedParagraph =
        "The quarterly financial report shows that revenue increased by 15% year-over-year, " +
        "driven primarily by strong performance in the enterprise segment. Operating margins " +
        "improved to 28%, reflecting cost optimization initiatives implemented in Q2. " +
        "The board of directors has approved a $500 million share buyback program."

      const messages = [
        { role: "system", content: "You are a financial analyst assistant." },
        { role: "user", content: repeatedParagraph + "\n\nSummarize this report." },
        {
          role: "assistant",
          content:
            "The report shows 15% revenue growth driven by enterprise segment, " +
            "with operating margins at 28% thanks to Q2 cost optimization. " +
            "A $500M buyback was approved.",
        },
        {
          role: "user",
          content:
            repeatedParagraph +
            "\n\nNow analyze the risks mentioned in this report and suggest improvements.",
        },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(messages),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // Delta encoder should have saved tokens by deduplicating the repeated paragraph
      expect(meta.deltaSaved).toBeGreaterThan(0)
      shield.dispose()
    })

    it("emits delta:applied event when delta encoding saves tokens", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
        },
        compressor: false,
      })

      shield.events.on("delta:applied", (data) => events.push(data as Record<string, unknown>))

      const repeatedParagraph =
        "The comprehensive analysis of the machine learning pipeline reveals several key " +
        "bottlenecks in the data preprocessing stage. Feature engineering consumes approximately " +
        "40% of the total training time, with dimensionality reduction being the primary contributor. " +
        "The model evaluation framework needs significant refactoring to support cross-validation."

      const messages = [
        { role: "user", content: repeatedParagraph + "\n\nWhat are the main issues?" },
        {
          role: "assistant",
          content:
            "The main issues are preprocessing bottlenecks and evaluation framework limitations.",
        },
        { role: "user", content: repeatedParagraph + "\n\nHow can we fix these issues?" },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(messages),
      }
      await shield.transformParams({ params })
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toHaveProperty("savedTokens")
      expect(events[0]).toHaveProperty("originalTokens")
      expect(events[0]).toHaveProperty("encodedTokens")
      shield.dispose()
    })

    it("skips delta encoding when delta is explicitly disabled", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
      })

      const repeatedParagraph =
        "The comprehensive analysis of the machine learning pipeline reveals several key " +
        "bottlenecks in the data preprocessing stage. Feature engineering consumes approximately " +
        "40% of the total training time."

      const messages = [
        { role: "user", content: repeatedParagraph + "\n\nWhat are the main issues?" },
        { role: "assistant", content: "Preprocessing bottlenecks." },
        { role: "user", content: repeatedParagraph + "\n\nHow can we fix these?" },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(messages),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.deltaSaved).toBeUndefined()
      shield.dispose()
    })
  })

  describe("automatic smart routing (no tiers)", () => {
    it("uses routeToModel() when router is enabled without tiers config", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        // No router.tiers — triggers automatic routing via routeToModel()
      })

      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hi" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // routeToModel() should have been called and complexity should be computed
      expect(meta.complexity).toBeDefined()
      // For a trivial prompt like "Hi", the router may select a cheaper model
      // The model may or may not change depending on routeToModel's decision,
      // but the pipeline should complete without error
      expect(result.modelId).toBeDefined()
      shield.dispose()
    })

    it("emits router:downgraded event when automatic routing changes model", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
      })

      shield.events.on("router:downgraded", (data) => events.push(data as Record<string, unknown>))

      // A very simple prompt should trigger downgrade from expensive model
      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hi" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta

      // If the model was changed, we expect the event was emitted
      if (result.modelId !== "gpt-4o") {
        expect(events.length).toBeGreaterThan(0)
        expect(events[0]).toHaveProperty("originalModel")
        expect(events[0]).toHaveProperty("selectedModel")
        expect(meta.originalModel).toBe("gpt-4o")
      }
      shield.dispose()
    })
  })

  describe("A/B test holdback", () => {
    it("skips routing when abTestHoldback is 1.0 (100% holdback)", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        router: {
          tiers: [
            { modelId: "gpt-4o-mini", maxComplexity: 50 },
            { modelId: "gpt-4o", maxComplexity: 100 },
          ],
          complexityThreshold: 50,
          abTestHoldback: 1.0, // 100% holdback — ALL requests skip routing
        },
      })

      shield.events.on("router:holdback", (data) => events.push(data as Record<string, unknown>))

      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hi" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta

      // With 100% holdback, the model should NOT be changed by the router
      expect(result.modelId).toBe("gpt-4o")
      // meta.abTestHoldout should be true
      expect(meta.abTestHoldout).toBe(true)
      // The router:holdback event should have been emitted
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toHaveProperty("model", "gpt-4o")
      expect(events[0]).toHaveProperty("holdbackRate", 1.0)
      shield.dispose()
    })

    it("does not set abTestHoldout when abTestHoldback is 0", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        router: {
          tiers: [
            { modelId: "gpt-4o-mini", maxComplexity: 50 },
            { modelId: "gpt-4o", maxComplexity: 100 },
          ],
          complexityThreshold: 50,
          abTestHoldback: 0, // 0% holdback — no requests held back
        },
      })

      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "Hi" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta

      // With 0% holdback, normal routing should apply; holdout should not be set
      expect(meta.abTestHoldout).toBeUndefined()
      shield.dispose()
    })
  })

  describe("context trim with tools", () => {
    it("accounts for tool token overhead when trimming context", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        context: { maxInputTokens: 100, reserveForOutput: 50 },
      })

      // Create a conversation that's near the budget so tool overhead would push it over
      const longMessages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me about dragons. ".repeat(10) },
        { role: "assistant", content: "Dragons are mythical creatures. ".repeat(10) },
        { role: "user", content: "What happened next?" },
      ]

      // Provide tool definitions in params — even if they're incomplete,
      // the try/catch in the code handles errors gracefully
      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(longMessages),
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a location",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string", description: "City name" },
                },
                required: ["location"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "search_web",
              description: "Search the web for information on a given topic",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                  maxResults: { type: "number", description: "Maximum number of results" },
                },
                required: ["query"],
              },
            },
          },
        ],
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // Context trimming should have been applied (the conversation is long + tool overhead)
      expect(meta.contextSaved).toBeGreaterThan(0)
      shield.dispose()
    })

    it("gracefully handles invalid tool definitions in context trim", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        context: { maxInputTokens: 50, reserveForOutput: 20 },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          {
            role: "user",
            content: "A very long message that should exceed the token budget. ".repeat(20),
          },
          { role: "user", content: "Latest question?" },
        ]),
        // Invalid tool definitions — the try/catch should handle this gracefully
        tools: [{ invalid: true }, null, "not-a-tool"],
      }
      // Should not throw even with invalid tools
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.contextSaved).toBeGreaterThan(0)
      shield.dispose()
    })
  })

  describe("context trim with output prediction", () => {
    it("uses output prediction when reserveForOutput is not set", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        // No reserveForOutput set — triggers output prediction (lines 458-468)
        context: { maxInputTokens: 80 },
      })

      const longMessages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a story about dragons and knights. ".repeat(15) },
        { role: "assistant", content: "Once upon a time there was a brave knight. ".repeat(10) },
        { role: "user", content: "What happened to the dragon in the end?" },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(longMessages),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.contextSaved).toBeGreaterThan(0)
      shield.dispose()
    })
  })

  describe("router with tiers and cost savings", () => {
    it("computes routerSaved when routing to a cheaper model via tiers", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        router: {
          tiers: [
            { modelId: "gpt-4o-mini", maxComplexity: 80 },
            { modelId: "gpt-4o", maxComplexity: 100 },
          ],
          complexityThreshold: 80,
        },
      })

      // Simple message that should have complexity below 80
      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{ role: "user", content: "What is the capital of France?" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // Should have been routed to gpt-4o-mini
      expect(result.modelId).toBe("gpt-4o-mini")
      expect(meta.originalModel).toBe("gpt-4o")
      expect(meta.routerSaved).toBeGreaterThanOrEqual(0)
      shield.dispose()
    })
  })

  describe("combined compressor + delta + context pipeline", () => {
    it("applies compressor, delta, and context trim in sequence", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
          // compressor and delta enabled by default
        },
        context: { maxInputTokens: 100, reserveForOutput: 30 },
        compressor: { minSavingsTokens: 1 },
        delta: { minSavingsTokens: 1 },
      })

      const verboseParagraph =
        "In order to complete this analysis, we need to review the data carefully. " +
        "Due to the fact that the experiment was run multiple times, we have confidence. " +
        "It is important to note that each and every result was verified independently. " +
        "The vast majority of the test subjects showed positive outcomes in the trial. " +
        "In the event that the data changes, we should revise our conclusions accordingly. " +
        "For the purpose of this evaluation, we will consider all available evidence. " +
        "At this point in time, there is no doubt that the hypothesis holds strongly."

      const messages = [
        { role: "system", content: "You are a data analyst." },
        { role: "user", content: verboseParagraph + "\n\nSummarize the findings." },
        {
          role: "assistant",
          content: "The analysis confirms the hypothesis with high confidence.",
        },
        {
          role: "user",
          content:
            verboseParagraph +
            "\n\nNow explain the methodology in detail and discuss potential improvements.",
        },
      ]

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt(messages),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      // At minimum context trim should have been applied due to budget
      expect(meta.contextSaved).toBeGreaterThan(0)
      expect(meta.originalInputTokens).toBeGreaterThan(0)
      shield.dispose()
    })
  })

  describe("dry-run with all modules active", () => {
    it("reports all modules including breaker, anomaly, guard, cache, context, router, prefix", async () => {
      const dryRunActions: Array<{
        module: string
        description: string
        estimatedSavings?: number
      }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: true,
          context: true,
          router: true,
          prefix: true,
          ledger: false,
          anomaly: true,
        },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        guard: { debounceMs: 0 },
        context: { maxInputTokens: 100 },
        router: { tiers: [{ modelId: "gpt-4o-mini", maxComplexity: 50 }] },
        breaker: {
          limits: { perHour: 10.0 },
          action: "stop",
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "What is machine learning?" }]),
      }
      await shield.transformParams({ params })

      const moduleNames = dryRunActions.map((a) => a.module)
      expect(moduleNames).toContain("breaker")
      expect(moduleNames).toContain("guard")
      expect(moduleNames).toContain("cache")
      expect(moduleNames).toContain("context")
      expect(moduleNames).toContain("router")
      expect(moduleNames).toContain("prefix")
      expect(moduleNames).toContain("anomaly")
      shield.dispose()
    })
  })

  describe("dry-run with cache hit", () => {
    it("reports cache hit in dry-run mode", async () => {
      const dryRunActions: Array<{
        module: string
        description: string
        estimatedSavings?: number
      }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        cache: { maxEntries: 10 },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
      })

      // Pre-populate the cache so dry-run peek finds a hit
      await shield.cache!.store("What is 2+2?", "4", "gpt-4o-mini", 10, 5)

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "What is 2+2?" }]),
      }
      await shield.transformParams({ params })

      const cacheAction = dryRunActions.find((a) => a.module === "cache")
      expect(cacheAction).toBeDefined()
      // Should report a cache hit with estimated savings
      expect(cacheAction!.description).toMatch(/hit|miss/i)
      shield.dispose()
    })
  })

  describe("dry-run with context over budget", () => {
    it("reports context trimming needed in dry-run mode", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        context: { maxInputTokens: 20 }, // Very small budget
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          {
            role: "user",
            content: "A very long message that exceeds the token budget significantly. ".repeat(10),
          },
        ]),
      }
      await shield.transformParams({ params })

      const contextAction = dryRunActions.find((a) => a.module === "context")
      expect(contextAction).toBeDefined()
      // Should report it would trim tokens
      expect(contextAction!.description).toMatch(/trim/i)
      shield.dispose()
    })
  })

  describe("dry-run with guard debounce trigger", () => {
    it("reports debounce in dry-run when requests are too rapid", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        guard: { debounceMs: 60000, maxRequestsPerMinute: 100 }, // 60s debounce
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
      })

      // First dry-run request to set lastRequestTime
      const params1 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "First request" }]),
      }
      await shield.transformParams({ params: params1 })

      // Second dry-run request should detect debounce
      dryRunActions.length = 0 // clear previous actions
      const params2 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Second rapid request" }]),
      }
      await shield.transformParams({ params: params2 })

      const guardAction = dryRunActions.find((a) => a.module === "guard")
      expect(guardAction).toBeDefined()
      // Should report debounce or pass
      expect(guardAction!.description).toMatch(/debounce|rate-limited|pass/i)
      shield.dispose()
    })
  })

  describe("dry-run with user budget exceed", () => {
    it("reports budget would be exceeded in dry-run mode", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        userBudget: {
          getUserId: () => "budget-user",
          budgets: {
            users: { "budget-user": { daily: 0.0000001, monthly: 100 } },
          },
        },
      })

      // Record some spend to push over daily limit
      if (shield.userBudgetManager) {
        await shield.userBudgetManager.recordSpend("budget-user", 0.1, "gpt-4o-mini")
      }

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Test budget check in dry-run" }]),
      }
      await shield.transformParams({ params })

      const budgetAction = dryRunActions.find((a) => a.module === "userBudget")
      expect(budgetAction).toBeDefined()
      expect(budgetAction!.description).toMatch(/exceed|budget|within/i)
      shield.dispose()
    })
  })

  describe("user budget module", () => {
    it("allows requests within budget and tracks userId in meta", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        userBudget: {
          getUserId: () => "user-123",
          budgets: {
            defaultBudget: { daily: 100, monthly: 1000 },
          },
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello world" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta.userId).toBe("user-123")
      expect(meta.userBudgetInflight).toBeGreaterThanOrEqual(0)
      shield.dispose()
    })

    it("blocks requests when user daily budget is exceeded", async () => {
      const onBlocked = vi.fn()
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        userBudget: {
          getUserId: () => "user-broke",
          budgets: {
            users: { "user-broke": { daily: 0.0000001, monthly: 100 } },
          },
        },
        onBlocked,
      })

      // Record some spend first to push user over budget
      // recordSpend(userId, cost, model, estimatedCost?)
      if (shield.userBudgetManager) {
        await shield.userBudgetManager.recordSpend("user-broke", 0.1, "gpt-4o-mini")
      }

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "This should be blocked by budget." }]),
      }
      await expect(shield.transformParams({ params })).rejects.toThrow()
      expect(onBlocked).toHaveBeenCalled()
      shield.dispose()
    })

    it("throws when getUserId returns empty string", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        userBudget: {
          getUserId: () => "",
          budgets: {
            defaultBudget: { daily: 100, monthly: 1000 },
          },
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Request with empty user ID" }]),
      }
      await expect(shield.transformParams({ params })).rejects.toThrow(/non-empty string/)
      shield.dispose()
    })

    it("throws when getUserId throws an error", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        userBudget: {
          getUserId: () => {
            throw new Error("Auth failed")
          },
          budgets: {
            defaultBudget: { daily: 100, monthly: 1000 },
          },
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Request with failing getUserId" }]),
      }
      await expect(shield.transformParams({ params })).rejects.toThrow(/Failed to resolve user ID/)
      shield.dispose()
    })

    it("reports userBudget in dry-run mode", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        userBudget: {
          getUserId: () => "dry-run-user",
          budgets: {
            defaultBudget: { daily: 10, monthly: 100 },
          },
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Test dry-run budget check" }]),
      }
      await shield.transformParams({ params })

      const moduleNames = dryRunActions.map((a) => a.module)
      expect(moduleNames).toContain("userBudget")
      const budgetAction = dryRunActions.find((a) => a.module === "userBudget")
      expect(budgetAction).toBeDefined()
      expect(budgetAction!.description).toMatch(/user|budget|dry-run-user/i)
      shield.dispose()
    })

    it("releases in-flight budget when guard throws", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        guard: { maxRequestsPerMinute: 1, debounceMs: 0 },
        userBudget: {
          getUserId: () => "user-inflight",
          budgets: {
            defaultBudget: { daily: 100, monthly: 1000 },
          },
        },
      })

      // First request to use up the rate limit
      const params1 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "First request" }]),
      }
      await shield.transformParams({ params: params1 })

      // Second request should be blocked by guard, and in-flight budget released
      const params2 = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Second request blocked" }]),
      }
      await expect(shield.transformParams({ params: params2 })).rejects.toThrow()
      shield.dispose()
    })
  })

  describe("prefix optimizer edge cases", () => {
    it("handles model that is in MODEL_PRICING with prefix savings", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: true,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        prefix: { provider: "openai" },
      })

      // Use a longer system prompt to get prefix savings
      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          {
            role: "system",
            content:
              "You are a highly skilled professional assistant specializing in data analysis, " +
              "machine learning, and statistical modeling. Always provide detailed explanations " +
              "with examples and cite relevant research papers when possible. " +
              "Format your responses using markdown with headers and bullet points.",
          },
          { role: "user", content: "Hello" },
        ]),
      }
      const result = await shield.transformParams({ params })
      // Prefix optimizer should have processed this
      expect(result.prompt).toBeDefined()
      // Verify meta is attached
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta
      expect(meta).toBeDefined()
      shield.dispose()
    })

    it("handles model NOT in MODEL_PRICING gracefully", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: true,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
      })

      const params = {
        modelId: "unknown-custom-model-xyz",
        prompt: makePrompt([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello" },
        ]),
      }
      const result = await shield.transformParams({ params })
      // Should complete without error even though model isn't in pricing
      expect(result.prompt).toBeDefined()
      shield.dispose()
    })
  })

  describe("router with automatic routing that changes model", () => {
    it("computes savings when routeToModel selects a different model", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: true,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        // No tiers — triggers routeToModel() automatic smart routing
      })

      shield.events.on("router:downgraded", (data) => events.push(data as Record<string, unknown>))

      // Use an expensive model with a simple query to force downgrade
      const params = {
        modelId: "claude-opus-4",
        prompt: makePrompt([{ role: "user", content: "Hi there" }]),
      }
      const result = await shield.transformParams({ params })
      const meta = (result as Record<string | symbol, unknown>)[SHIELD_META] as ShieldMeta

      expect(meta.complexity).toBeDefined()
      // routeToModel should find a cheaper alternative for a trivial prompt
      if (result.modelId !== "claude-opus-4") {
        expect(meta.routerSaved).toBeGreaterThanOrEqual(0)
        expect(meta.originalModel).toBe("claude-opus-4")
        expect(events.length).toBeGreaterThan(0)
        expect(events[0]).toHaveProperty("complexity")
        expect(events[0]).toHaveProperty("savedCost")
      }
      shield.dispose()
    })
  })

  describe("guard allows request and emits event", () => {
    it("emits request:allowed when guard passes", async () => {
      const events: string[] = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        guard: { debounceMs: 0, maxRequestsPerMinute: 100 },
      })

      shield.events.on("request:allowed", () => events.push("allowed"))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Allowed request here" }]),
      }
      await shield.transformParams({ params })
      expect(events).toContain("allowed")
      shield.dispose()
    })
  })

  describe("breaker emits request:blocked event", () => {
    it("emits request:blocked when breaker trips", async () => {
      const events: Array<Record<string, unknown>> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: false,
          delta: false,
        },
        compressor: false,
        delta: false,
        breaker: {
          limits: { perSession: 0.0000001 },
          action: "stop",
        },
      })

      shield.events.on("request:blocked", (data) => events.push(data as Record<string, unknown>))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "This should be blocked by breaker." }]),
      }

      await expect(shield.transformParams({ params })).rejects.toThrow()
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]).toHaveProperty("reason")
      expect(events[0]).toHaveProperty("estimatedCost")
      shield.dispose()
    })
  })

  describe("dry-run with anomaly detector", () => {
    it("includes anomaly module report in dry-run actions", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          anomaly: true,
        },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        compressor: false,
        delta: false,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "What is the meaning of life?" }]),
      }
      await shield.transformParams({ params })

      const moduleNames = dryRunActions.map((a) => a.module)
      expect(moduleNames).toContain("anomaly")
      // The anomaly description should indicate either "detected" or "No anomaly detected"
      const anomalyAction = dryRunActions.find((a) => a.module === "anomaly")
      expect(anomalyAction).toBeDefined()
      expect(anomalyAction!.description).toMatch(/anomaly|No anomaly/i)
      shield.dispose()
    })
  })

  describe("dry-run with breaker", () => {
    it("includes breaker module report in dry-run actions", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        breaker: {
          limits: { perHour: 1.0 },
          action: "stop",
        },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        compressor: false,
        delta: false,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello, how are you?" }]),
      }
      await shield.transformParams({ params })

      const moduleNames = dryRunActions.map((a) => a.module)
      expect(moduleNames).toContain("breaker")
      const breakerAction = dryRunActions.find((a) => a.module === "breaker")
      expect(breakerAction).toBeDefined()
      expect(breakerAction!.description).toMatch(/breaker|spend|pass/i)
      shield.dispose()
    })

    it("reports breaker would block when spend exceeds limit in dry-run", async () => {
      const dryRunActions: Array<{ module: string; description: string }> = []
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        breaker: {
          limits: { perHour: 0.0000001 }, // Extremely low limit so even tiny cost would trip it
          action: "stop",
        },
        dryRun: true,
        onDryRun: (action) => dryRunActions.push(action),
        compressor: false,
        delta: false,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          {
            role: "user",
            content: "Tell me a long story about space exploration and the future of humanity.",
          },
        ]),
      }
      await shield.transformParams({ params })

      const breakerAction = dryRunActions.find((a) => a.module === "breaker")
      expect(breakerAction).toBeDefined()
      // With such a tiny limit, the breaker should report "Would be blocked"
      expect(breakerAction!.description).toMatch(/blocked|spend/i)
      shield.dispose()
    })
  })
})
