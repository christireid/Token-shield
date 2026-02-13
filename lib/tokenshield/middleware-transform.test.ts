/**
 * Middleware Transform Pipeline Tests
 *
 * Tests for buildTransformParams which handles the pre-model optimization pipeline:
 * breaker -> user budget -> guard -> cache lookup -> context trim -> route -> prefix optimize
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
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
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
      })
      const params = { modelId: "gpt-4o-mini", temperature: 0.7 }
      const result = await shield.transformParams({ params })
      expect(result.modelId).toBe("gpt-4o-mini")
      expect(result.temperature).toBe(0.7)
      shield.dispose()
    })

    it("passes through params when prompt is not an array", async () => {
      const shield = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
      })
      const params = { modelId: "gpt-4o-mini", prompt: "just a string" }
      const result = await shield.transformParams({ params })
      expect(result.prompt).toBe("just a string")
      shield.dispose()
    })

    it("attaches SHIELD_META to params on valid prompt", async () => {
      const shield = tokenShieldMiddleware({
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: true, cache: false, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: true, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: true, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: false, context: true, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: false, context: true, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: false, context: false, router: true, prefix: false, ledger: false },
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
        modules: { guard: false, cache: false, context: false, router: true, prefix: false, ledger: false },
        router: {
          tiers: [
            { modelId: "gpt-4o-mini", maxComplexity: 5 },
          ],
          complexityThreshold: 50,
        },
      })

      // "Hi" has very low complexity, under threshold 50 → eligible for routing
      // but complexity score must also be <= tier maxComplexity (5) to match a tier
      // A request scoring > 5 will find no matching tier and keep the original model
      const params = {
        modelId: "gpt-4o",
        prompt: makePrompt([{
          role: "user",
          content: "Please analyze the following complex multi-step algorithm and explain the time complexity of each recursive subroutine, including the master theorem application and amortized analysis of the data structure operations.",
        }]),
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
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
        routerOverride: (prompt) => prompt.includes("[IMPORTANT]") ? "gpt-4o" : null,
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
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: true, cache: true, context: true, router: true, prefix: true, ledger: false },
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
        modules: { guard: false, cache: false, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: true, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: true, context: false, router: false, prefix: false, ledger: false },
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
        modules: { guard: false, cache: false, context: true, router: false, prefix: false, ledger: false },
        context: { maxInputTokens: 50, reserveForOutput: 20 },
      })

      shield.events.on("context:trimmed", (data) => events.push(data as Record<string, unknown>))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([
          { role: "user", content: "A very long message that should exceed the token budget. ".repeat(20) },
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
        modules: { guard: false, cache: false, context: false, router: false, prefix: true, ledger: false },
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
      const rebuiltPrompt = result.prompt as Array<{ role: string; content: Array<{ type: string; text: string }> }>
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
})
