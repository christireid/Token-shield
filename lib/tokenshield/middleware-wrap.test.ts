/**
 * Middleware Wrap Tests
 *
 * Tests for buildWrapGenerate and buildWrapStream which handle post-model
 * processing: cache returns, ledger recording, budget tracking, streaming.
 */

import { describe, it, expect, vi } from "vitest"
import { tokenShieldMiddleware } from "./middleware"

/** Create an AI SDK-format prompt from simple messages */
function makePrompt(messages: Array<{ role: string; content: string }>) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.content }],
  }))
}

describe("wrapGenerate", () => {
  describe("cache hit path", () => {
    it("returns cached response without calling doGenerate", async () => {
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

      // Store in cache
      await shield.cache!.store("What is 2+2?", "4", "gpt-4o-mini", 10, 5)

      // Run transformParams to get cache hit metadata
      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "What is 2+2?" }]),
      }
      const transformed = await shield.transformParams({ params })

      // doGenerate should NOT be called
      const doGenerate = vi.fn()
      const result = await shield.wrapGenerate({ doGenerate, params: transformed })

      expect(doGenerate).not.toHaveBeenCalled()
      expect(result).toHaveProperty("text", "4")
      expect(result).toHaveProperty("finishReason", "stop")
      shield.dispose()
    })

    it("calls onUsage with saved cost for cache hits", async () => {
      const onUsage = vi.fn()
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
        onUsage,
      })

      await shield.cache!.store("cached prompt", "cached response", "gpt-4o-mini", 100, 50)

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "cached prompt" }]),
      }
      const transformed = await shield.transformParams({ params })
      await shield.wrapGenerate({ doGenerate: vi.fn(), params: transformed })

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        }),
      )
      // Should report savings
      expect(onUsage.mock.calls[0][0].saved).toBeGreaterThan(0)
      shield.dispose()
    })
  })

  describe("normal call path", () => {
    it("calls doGenerate and returns the result", async () => {
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
      const transformed = await shield.transformParams({ params })

      const doGenerate = vi.fn().mockResolvedValue({
        text: "Hi there!",
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      })
      const result = await shield.wrapGenerate({ doGenerate, params: transformed })

      expect(doGenerate).toHaveBeenCalledOnce()
      expect(result).toHaveProperty("text", "Hi there!")
      shield.dispose()
    })

    it("calls onUsage after model call", async () => {
      const onUsage = vi.fn()
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        onUsage,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }
      const transformed = await shield.transformParams({ params })

      await shield.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "Hi!",
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
        }),
        params: transformed,
      })

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          inputTokens: 10,
          outputTokens: 5,
        }),
      )
      shield.dispose()
    })

    it("stores response in cache for future use", async () => {
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

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Store this response" }]),
      }
      const transformed = await shield.transformParams({ params })

      await shield.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "Stored!",
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
        }),
        params: transformed,
      })

      // Wait for fire-and-forget cache store
      await new Promise((r) => setTimeout(r, 50))

      // Now lookup should find it
      const lookup = await shield.cache!.lookup("Store this response", "gpt-4o-mini")
      expect(lookup.hit).toBe(true)
      expect(lookup.entry?.response).toBe("Stored!")
      shield.dispose()
    })

    it("records usage in ledger", async () => {
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }
      const transformed = await shield.transformParams({ params })

      await shield.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "Hi!",
          usage: { promptTokens: 100, completionTokens: 50 },
          finishReason: "stop",
        }),
        params: transformed,
      })

      const summary = shield.ledger!.getSummary()
      expect(summary.totalCalls).toBe(1)
      expect(summary.totalSpent).toBeGreaterThan(0)
      shield.dispose()
    })

    it("emits ledger:entry event", async () => {
      const events: Record<string, unknown>[] = []
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
      shield.events.on("ledger:entry", (data) => events.push(data as Record<string, unknown>))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Hello" }]),
      }
      const transformed = await shield.transformParams({ params })

      await shield.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "Hi!",
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
        }),
        params: transformed,
      })

      expect(events.length).toBe(1)
      expect(events[0]).toHaveProperty("model", "gpt-4o-mini")
      expect(events[0]).toHaveProperty("inputTokens", 10)
      expect(events[0]).toHaveProperty("outputTokens", 5)
      shield.dispose()
    })
  })

  describe("error handling", () => {
    it("propagates doGenerate errors", async () => {
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
      const transformed = await shield.transformParams({ params })

      await expect(
        shield.wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue(new Error("API failure")),
          params: transformed,
        }),
      ).rejects.toThrow("API failure")
      shield.dispose()
    })
  })
})

describe("wrapStream", () => {
  describe("cache hit path", () => {
    it("returns simulated stream for cache hits", async () => {
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

      await shield.cache!.store("stream cached", "Cached stream response", "gpt-4o-mini", 10, 5)

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "stream cached" }]),
      }
      const transformed = await shield.transformParams({ params })

      const doStream = vi.fn()
      const result = await shield.wrapStream({ doStream, params: transformed })

      expect(doStream).not.toHaveBeenCalled()
      expect(result).toHaveProperty("stream")
      expect((result as Record<string, unknown>).stream).toBeInstanceOf(ReadableStream)
      shield.dispose()
    })
  })

  describe("normal stream path", () => {
    it("wraps the original stream with monitoring", async () => {
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
        prompt: makePrompt([{ role: "user", content: "Stream hello" }]),
      }
      const transformed = await shield.transformParams({ params })

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Hello " })
          controller.enqueue({ type: "text-delta", textDelta: "world!" })
          controller.close()
        },
      })

      const result = await shield.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params: transformed,
      })

      expect(result).toHaveProperty("stream")
      const monitoredStream = (result as Record<string, unknown>).stream as ReadableStream
      expect(monitoredStream).toBeInstanceOf(ReadableStream)

      // Read the stream to verify chunks pass through
      const reader = monitoredStream.getReader()
      const chunks: unknown[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      expect(chunks.length).toBe(2)
      shield.dispose()
    })

    it("emits stream:complete event when stream ends", async () => {
      const events: string[] = []
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
      shield.events.on("stream:complete", () => events.push("stream:complete"))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Stream" }]),
      }
      const transformed = await shield.transformParams({ params })

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Done" })
          controller.close()
        },
      })

      const result = await shield.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params: transformed,
      })

      // Consume the stream to trigger completion
      const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
      while (!(await reader.read()).done) {
        /* empty */
      }

      expect(events).toContain("stream:complete")
      shield.dispose()
    })

    it("emits stream:chunk events during streaming", async () => {
      const chunkEvents: unknown[] = []
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
      shield.events.on("stream:chunk", (data) => chunkEvents.push(data))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Stream chunks" }]),
      }
      const transformed = await shield.transformParams({ params })

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "chunk1 " })
          controller.enqueue({ type: "text-delta", textDelta: "chunk2" })
          controller.close()
        },
      })

      const result = await shield.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params: transformed,
      })

      const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
      while (!(await reader.read()).done) {
        /* empty */
      }

      expect(chunkEvents.length).toBe(2)
      shield.dispose()
    })

    it("calls onUsage after stream completes", async () => {
      const onUsage = vi.fn()
      const shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        onUsage,
      })

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Stream usage" }]),
      }
      const transformed = await shield.transformParams({ params })

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Response" })
          controller.close()
        },
      })

      const result = await shield.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params: transformed,
      })

      const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
      while (!(await reader.read()).done) {
        /* empty */
      }

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
        }),
      )
      shield.dispose()
    })
  })

  describe("error handling", () => {
    it("propagates doStream errors", async () => {
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
        prompt: makePrompt([{ role: "user", content: "Stream error" }]),
      }
      const transformed = await shield.transformParams({ params })

      await expect(
        shield.wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("Stream failure")),
          params: transformed,
        }),
      ).rejects.toThrow("Stream failure")
      shield.dispose()
    })
  })
})
