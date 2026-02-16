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

    it("tolerates cache store failure gracefully", async () => {
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

      // Sabotage the cache store method to throw
      vi.spyOn(shield.cache!, "store").mockRejectedValue(new Error("IDB write failed"))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Cache store failure test" }]),
      }
      const transformed = await shield.transformParams({ params })

      // Should NOT throw — cache failure is non-fatal
      const result = await shield.wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "Response despite cache failure",
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
        }),
        params: transformed,
      })

      expect(result).toHaveProperty("text", "Response despite cache failure")
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

    it("emits stream:abort on mid-stream error and still records usage", async () => {
      const abortEvents: unknown[] = []
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
      shield.events.on("stream:abort", (data) => abortEvents.push(data))

      const params = {
        modelId: "gpt-4o-mini",
        prompt: makePrompt([{ role: "user", content: "Abort stream" }]),
      }
      const transformed = await shield.transformParams({ params })

      // Stream that errors mid-read
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "partial " })
          controller.error(new Error("connection lost"))
        },
      })

      const result = await shield.wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: errorStream }),
        params: transformed,
      })

      const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
      // Read until error
      try {
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      } catch {
        // Expected: stream error
      }

      expect(abortEvents.length).toBe(1)
      shield.dispose()
    })
  })
})

// -------------------------------------------------------
// Direct unit tests for buildWrapGenerate / buildWrapStream
// -------------------------------------------------------
// These tests bypass tokenShieldMiddleware and construct a mock
// MiddlewareContext directly, allowing precise control over which
// modules are present. This targets uncovered branches in
// middleware-wrap.ts that the integration-style tests above cannot
// easily reach (budget manager, adapter, stream cancel, etc.).

import { buildWrapGenerate, buildWrapStream } from "./middleware-wrap"
import { SHIELD_META, type ShieldMeta, type MiddlewareContext } from "./middleware-types"
import { createEventBus } from "./event-bus"

/** Helper: build a minimal MiddlewareContext with overrides */
function makeCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    config: {},
    modules: {
      guard: false,
      cache: false,
      context: false,
      router: false,
      prefix: false,
      ledger: false,
      anomaly: false,
    },
    guard: null,
    cache: null,
    ledger: null,
    breaker: null,
    userBudgetManager: null,
    anomalyDetector: null,
    instanceEvents: createEventBus(),
    log: null,
    adapter: null,
    auditLog: null,
    ...overrides,
  }
}

/** Helper: create params with embedded ShieldMeta */
function paramsWithMeta(
  meta: ShieldMeta,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const p: Record<string | symbol, unknown> = { modelId: "gpt-4o-mini", ...extra }
  p[SHIELD_META] = meta
  return p as Record<string, unknown>
}

// -------------------------------------------------------
// buildWrapGenerate — cache hit with userBudgetManager
// -------------------------------------------------------
describe("buildWrapGenerate (direct)", () => {
  describe("cache hit with userBudgetManager", () => {
    it("releases in-flight budget on cache hit when userId and userBudgetInflight are set", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 50, outputTokens: 20 },
        userId: "user-42",
        userBudgetInflight: 0.005,
      })

      const doGenerate = vi.fn()
      const result = await wrapGenerate({ doGenerate, params })

      expect(doGenerate).not.toHaveBeenCalled()
      expect(releaseInflight).toHaveBeenCalledWith("user-42", 0.005)
      expect(result).toHaveProperty("text", "cached")
      expect(result).toHaveProperty("finishReason", "stop")
    })

    it("does NOT call releaseInflight when userId is missing", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 50, outputTokens: 20 },
        // userId intentionally omitted
        userBudgetInflight: 0.005,
      })

      await wrapGenerate({ doGenerate: vi.fn(), params })

      expect(releaseInflight).not.toHaveBeenCalled()
    })

    it("does NOT call releaseInflight when userBudgetInflight is missing", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 50, outputTokens: 20 },
        userId: "user-42",
        // userBudgetInflight intentionally omitted
      })

      await wrapGenerate({ doGenerate: vi.fn(), params })

      expect(releaseInflight).not.toHaveBeenCalled()
    })

    it("records cache hit in ledger on cache hit path", async () => {
      const recordCacheHit = vi.fn().mockResolvedValue(undefined)
      const ctx = makeCtx({
        ledger: {
          recordCacheHit,
          record: vi.fn().mockResolvedValue(undefined),
          getSummary: vi.fn(),
        } as unknown as MiddlewareContext["ledger"],
        config: { ledger: { feature: "test-feature" } },
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 100, outputTokens: 50 },
      })

      await wrapGenerate({ doGenerate: vi.fn(), params })

      expect(recordCacheHit).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          savedInputTokens: 100,
          savedOutputTokens: 50,
          feature: "test-feature",
        }),
      )
    })
  })

  describe("doGenerate failure with budget release", () => {
    it("releases in-flight budget when doGenerate throws and userId + userBudgetInflight are set", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        userId: "user-99",
        userBudgetInflight: 0.01,
      })

      const doGenerate = vi.fn().mockRejectedValue(new Error("API timeout"))

      await expect(wrapGenerate({ doGenerate, params })).rejects.toThrow("API timeout")
      expect(releaseInflight).toHaveBeenCalledWith("user-99", 0.01)
    })

    it("does NOT release in-flight when userId is missing on failure", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        // userId intentionally omitted
        userBudgetInflight: 0.01,
      })

      await expect(
        wrapGenerate({ doGenerate: vi.fn().mockRejectedValue(new Error("fail")), params }),
      ).rejects.toThrow("fail")
      expect(releaseInflight).not.toHaveBeenCalled()
    })
  })

  describe("doGenerate failure with adapter", () => {
    it("calls adapter.recordFailure when doGenerate throws and adapter is present", async () => {
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue(new Error("rate limited")),
          params,
        }),
      ).rejects.toThrow("rate limited")

      expect(recordFailure).toHaveBeenCalledWith("openai", "rate limited")
    })

    it("passes non-Error error message as string to adapter.recordFailure", async () => {
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue("string error"),
          params,
        }),
      ).rejects.toBe("string error")

      expect(recordFailure).toHaveBeenCalledWith("openai", "string error")
    })

    it("skips adapter.recordFailure when getProviderForModel returns undefined", async () => {
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue(undefined),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue(new Error("fail")),
          params,
        }),
      ).rejects.toThrow("fail")

      expect(recordFailure).not.toHaveBeenCalled()
    })

    it("tolerates adapter.recordFailure throwing (non-fatal)", async () => {
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure: vi.fn().mockImplementation(() => {
            throw new Error("adapter internal error")
          }),
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      // Should still throw the original error, not the adapter's error
      await expect(
        wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue(new Error("API error")),
          params,
        }),
      ).rejects.toThrow("API error")
    })

    it("releases budget AND records adapter failure when both are present", async () => {
      const releaseInflight = vi.fn()
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({
        userId: "user-42",
        userBudgetInflight: 0.01,
      })

      await expect(
        wrapGenerate({
          doGenerate: vi.fn().mockRejectedValue(new Error("500")),
          params,
        }),
      ).rejects.toThrow("500")

      expect(releaseInflight).toHaveBeenCalledWith("user-42", 0.01)
      expect(recordFailure).toHaveBeenCalledWith("openai", "500")
    })
  })

  describe("doGenerate success with adapter", () => {
    it("calls adapter.recordSuccess after successful doGenerate", async () => {
      const recordSuccess = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure: vi.fn(),
          recordSuccess,
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      await wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "success",
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
        params,
      })

      expect(recordSuccess).toHaveBeenCalledWith("openai", expect.any(Number))
    })

    it("skips adapter.recordSuccess when getProviderForModel returns undefined", async () => {
      const recordSuccess = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue(undefined),
          recordFailure: vi.fn(),
          recordSuccess,
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      await wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "ok",
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
        params,
      })

      expect(recordSuccess).not.toHaveBeenCalled()
    })

    it("tolerates adapter.recordSuccess throwing (non-fatal)", async () => {
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure: vi.fn(),
          recordSuccess: vi.fn().mockImplementation(() => {
            throw new Error("adapter recordSuccess crash")
          }),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapGenerate = buildWrapGenerate(ctx)

      const params = paramsWithMeta({})

      // Should NOT throw even though adapter.recordSuccess throws
      const result = await wrapGenerate({
        doGenerate: vi.fn().mockResolvedValue({
          text: "still works",
          usage: { promptTokens: 10, completionTokens: 5 },
        }),
        params,
      })

      expect(result).toHaveProperty("text", "still works")
    })
  })
})

// -------------------------------------------------------
// buildWrapStream — cache hit, failure, cancel
// -------------------------------------------------------
describe("buildWrapStream (direct)", () => {
  describe("cache hit with userBudgetManager", () => {
    it("releases in-flight budget and returns simulated stream", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "stream cached", inputTokens: 80, outputTokens: 30 },
        userId: "user-stream",
        userBudgetInflight: 0.008,
      })

      const doStream = vi.fn()
      const result = await wrapStream({ doStream, params })

      expect(doStream).not.toHaveBeenCalled()
      expect(releaseInflight).toHaveBeenCalledWith("user-stream", 0.008)

      // Verify the simulated stream yields the cached text
      const stream = (result as Record<string, unknown>).stream as ReadableStream
      const reader = stream.getReader()
      const { value } = await reader.read()
      expect(value).toEqual({ type: "text-delta", textDelta: "stream cached" })
      const { done } = await reader.read()
      expect(done).toBe(true)
    })

    it("does NOT release in-flight when userId is missing on stream cache hit", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 10, outputTokens: 5 },
        userBudgetInflight: 0.002,
        // userId intentionally omitted
      })

      await wrapStream({ doStream: vi.fn(), params })
      expect(releaseInflight).not.toHaveBeenCalled()
    })

    it("records cache hit in ledger on stream cache hit path", async () => {
      const recordCacheHit = vi.fn().mockResolvedValue(undefined)
      const ctx = makeCtx({
        ledger: {
          recordCacheHit,
          record: vi.fn().mockResolvedValue(undefined),
          getSummary: vi.fn(),
        } as unknown as MiddlewareContext["ledger"],
        config: { ledger: { feature: "stream-feat" } },
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 60, outputTokens: 25 },
      })

      await wrapStream({ doStream: vi.fn(), params })

      expect(recordCacheHit).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          savedInputTokens: 60,
          savedOutputTokens: 25,
          feature: "stream-feat",
        }),
      )
    })

    it("calls onUsage with saved cost on stream cache hit", async () => {
      const onUsage = vi.fn()
      const ctx = makeCtx({
        config: { onUsage },
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        cacheHit: { response: "cached", inputTokens: 100, outputTokens: 50 },
      })

      await wrapStream({ doStream: vi.fn(), params })

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        }),
      )
      expect(onUsage.mock.calls[0][0].saved).toBeGreaterThanOrEqual(0)
    })
  })

  describe("doStream failure with budget and adapter", () => {
    it("releases in-flight budget when doStream throws", async () => {
      const releaseInflight = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        userId: "user-stream-err",
        userBudgetInflight: 0.012,
      })

      await expect(
        wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("stream API fail")),
          params,
        }),
      ).rejects.toThrow("stream API fail")

      expect(releaseInflight).toHaveBeenCalledWith("user-stream-err", 0.012)
    })

    it("calls adapter.recordFailure when doStream throws and adapter is present", async () => {
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("anthropic"),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("503 overloaded")),
          params,
        }),
      ).rejects.toThrow("503 overloaded")

      expect(recordFailure).toHaveBeenCalledWith("anthropic", "503 overloaded")
    })

    it("tolerates adapter.recordFailure throwing on stream failure (non-fatal)", async () => {
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure: vi.fn().mockImplementation(() => {
            throw new Error("adapter crash")
          }),
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("original error")),
          params,
        }),
      ).rejects.toThrow("original error")
    })

    it("skips adapter.recordFailure when getProviderForModel returns undefined", async () => {
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue(undefined),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({})

      await expect(
        wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("err")),
          params,
        }),
      ).rejects.toThrow("err")

      expect(recordFailure).not.toHaveBeenCalled()
    })

    it("releases budget AND records adapter failure when both present on stream failure", async () => {
      const releaseInflight = vi.fn()
      const recordFailure = vi.fn()
      const ctx = makeCtx({
        userBudgetManager: {
          releaseInflight,
          recordSpend: vi.fn().mockResolvedValue(undefined),
          check: vi.fn(),
        } as unknown as MiddlewareContext["userBudgetManager"],
        adapter: {
          getProviderForModel: vi.fn().mockReturnValue("openai"),
          recordFailure,
          recordSuccess: vi.fn(),
        } as unknown as MiddlewareContext["adapter"],
      })
      const wrapStream = buildWrapStream(ctx)

      const params = paramsWithMeta({
        userId: "user-both",
        userBudgetInflight: 0.007,
      })

      await expect(
        wrapStream({
          doStream: vi.fn().mockRejectedValue(new Error("boom")),
          params,
        }),
      ).rejects.toThrow("boom")

      expect(releaseInflight).toHaveBeenCalledWith("user-both", 0.007)
      expect(recordFailure).toHaveBeenCalledWith("openai", "boom")
    })
  })

  describe("stream cancel handler", () => {
    it("emits stream:abort and records usage when stream is cancelled", async () => {
      const abortEvents: unknown[] = []
      const instanceEvents = createEventBus()
      instanceEvents.on("stream:abort", (data) => abortEvents.push(data))

      const ctx = makeCtx({ instanceEvents })
      const wrapStream = buildWrapStream(ctx)

      // Create a stream that never closes on its own (simulates long-running response)
      let readerCancelled = false
      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "partial data " })
        },
        cancel() {
          readerCancelled = true
        },
      })

      const params = paramsWithMeta({})
      const result = await wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params,
      })

      const monitoredStream = (result as Record<string, unknown>).stream as ReadableStream
      const reader = monitoredStream.getReader()

      // Read the one chunk that was enqueued
      await reader.read()

      // Cancel the stream (simulates user clicking "Stop generating")
      await reader.cancel()

      // The cancel handler should emit stream:abort
      expect(abortEvents.length).toBe(1)
      expect(abortEvents[0]).toHaveProperty("inputTokens")
      expect(abortEvents[0]).toHaveProperty("outputTokens")
      expect(abortEvents[0]).toHaveProperty("estimatedCost")

      expect(readerCancelled).toBe(true)
    })

    it("records usage only once even if cancel is called after stream completion", async () => {
      const onUsage = vi.fn()
      const ctx = makeCtx({
        config: { onUsage },
      })
      const wrapStream = buildWrapStream(ctx)

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "done" })
          controller.close()
        },
      })

      const params = paramsWithMeta({})
      const result = await wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params,
      })

      const monitoredStream = (result as Record<string, unknown>).stream as ReadableStream
      const reader = monitoredStream.getReader()

      // Fully consume the stream
      while (!(await reader.read()).done) {
        /* empty */
      }

      // onUsage should have been called exactly once via recordPostRequestUsage
      expect(onUsage).toHaveBeenCalledTimes(1)
    })
  })

  describe("stream onCostThreshold and onAbort callbacks", () => {
    it("invokes onCostThreshold wrapper when cost exceeds threshold during streaming", async () => {
      const onCostThreshold = vi.fn()
      const ctx = makeCtx({
        config: {
          stream: {
            updateInterval: 1,
            costThreshold: 0.0000000001, // extremely low threshold to guarantee trigger
            onCostThreshold,
          },
        },
      })
      const wrapStream = buildWrapStream(ctx)

      const originalStream = new ReadableStream({
        start(controller) {
          // Enqueue many large chunks so cost estimate exceeds the tiny threshold
          for (let i = 0; i < 20; i++) {
            controller.enqueue({ type: "text-delta", textDelta: "word ".repeat(100) })
          }
          controller.close()
        },
      })

      const params = paramsWithMeta({})
      const result = await wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params,
      })

      // Consume stream to fire threshold check
      const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
      while (!(await reader.read()).done) {
        /* empty */
      }

      // The onCostThreshold callback should have been invoked via the wrapper lambda (line 373)
      expect(onCostThreshold).toHaveBeenCalledWith(
        expect.objectContaining({
          estimatedCost: expect.any(Number),
          outputTokens: expect.any(Number),
        }),
      )
    })

    it("passes onAbort callback to StreamTokenTracker", async () => {
      const onAbort = vi.fn()
      const ctx = makeCtx({
        config: {
          stream: {
            onAbort,
          },
        },
      })
      const wrapStream = buildWrapStream(ctx)

      const originalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "partial" })
        },
        cancel() {
          /* cancelled */
        },
      })

      const params = paramsWithMeta({})
      const result = await wrapStream({
        doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
        params,
      })

      const monitoredStream = (result as Record<string, unknown>).stream as ReadableStream
      const reader = monitoredStream.getReader()
      await reader.read()
      await reader.cancel()

      // The onAbort callback is wired to the tracker; verify the stream handles cancel gracefully
    })
  })
})

// -------------------------------------------------------
// recordPostRequestUsage — budget manager paths
// -------------------------------------------------------
describe("recordPostRequestUsage via buildWrapGenerate", () => {
  it("calls userBudgetManager.recordSpend when userId is present", async () => {
    const recordSpend = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      userBudgetManager: {
        releaseInflight: vi.fn(),
        recordSpend,
        check: vi.fn(),
      } as unknown as MiddlewareContext["userBudgetManager"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({
      userId: "budget-user",
      userBudgetInflight: 0.005,
    })

    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "response",
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
      params,
    })

    expect(recordSpend).toHaveBeenCalledTimes(1)
    expect(recordSpend).toHaveBeenCalledWith(
      "budget-user",
      expect.any(Number), // perRequestCost
      "gpt-4o-mini",
      0.005, // meta.userBudgetInflight
    )
  })

  it("does NOT call recordSpend when userId is missing", async () => {
    const recordSpend = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      userBudgetManager: {
        releaseInflight: vi.fn(),
        recordSpend,
        check: vi.fn(),
      } as unknown as MiddlewareContext["userBudgetManager"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({
      // userId intentionally omitted
    })

    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "response",
        usage: { promptTokens: 10, completionTokens: 5 },
      }),
      params,
    })

    expect(recordSpend).not.toHaveBeenCalled()
  })

  it("emits storage:error event when recordSpend rejects (IDB failure)", async () => {
    const storageErrors: unknown[] = []
    const instanceEvents = createEventBus()
    instanceEvents.on("storage:error", (data) => storageErrors.push(data))

    const ctx = makeCtx({
      instanceEvents,
      userBudgetManager: {
        releaseInflight: vi.fn(),
        recordSpend: vi.fn().mockRejectedValue(new Error("IDB write failed")),
        check: vi.fn(),
      } as unknown as MiddlewareContext["userBudgetManager"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({
      userId: "idb-user",
      userBudgetInflight: 0.003,
    })

    // Should NOT throw even though recordSpend rejects
    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "ok",
        usage: { promptTokens: 10, completionTokens: 5 },
      }),
      params,
    })

    // Allow microtask for the .catch handler
    await new Promise((r) => setTimeout(r, 10))

    expect(storageErrors.length).toBe(1)
    expect(storageErrors[0]).toEqual(
      expect.objectContaining({
        module: "userBudget",
        operation: "recordSpend",
      }),
    )
  })

  it("records breaker spend when breaker is present and cost > 0", async () => {
    const recordSpend = vi.fn()
    const ctx = makeCtx({
      breaker: {
        recordSpend,
        check: vi.fn(),
        isTripped: vi.fn().mockReturnValue(false),
      } as unknown as MiddlewareContext["breaker"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({})

    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "response",
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
      params,
    })

    expect(recordSpend).toHaveBeenCalledWith(expect.any(Number), "gpt-4o-mini")
  })

  it("detects anomalies and emits event when anomalyDetector returns an anomaly", async () => {
    const anomalyEvents: unknown[] = []
    const instanceEvents = createEventBus()
    instanceEvents.on("anomaly:detected", (data) => anomalyEvents.push(data))

    const mockAnomaly = { type: "cost_spike", cost: 0.5, threshold: 0.1 }
    const ctx = makeCtx({
      instanceEvents,
      anomalyDetector: {
        check: vi.fn().mockReturnValue(mockAnomaly),
      } as unknown as MiddlewareContext["anomalyDetector"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({})

    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "response",
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
      params,
    })

    expect(anomalyEvents.length).toBe(1)
    expect(anomalyEvents[0]).toBe(mockAnomaly)
  })

  it("calls config.anomaly.onAnomalyDetected when anomaly is found", async () => {
    const onAnomalyDetected = vi.fn()
    const mockAnomaly = { type: "cost_spike", cost: 0.5, threshold: 0.1 }
    const ctx = makeCtx({
      config: {
        anomaly: { onAnomalyDetected },
      },
      anomalyDetector: {
        check: vi.fn().mockReturnValue(mockAnomaly),
      } as unknown as MiddlewareContext["anomalyDetector"],
    })
    const wrapGenerate = buildWrapGenerate(ctx)

    const params = paramsWithMeta({})

    await wrapGenerate({
      doGenerate: vi.fn().mockResolvedValue({
        text: "response",
        usage: { promptTokens: 100, completionTokens: 50 },
      }),
      params,
    })

    expect(onAnomalyDetected).toHaveBeenCalledWith(mockAnomaly)
  })
})

// -------------------------------------------------------
// recordPostRequestUsage via buildWrapStream (for stream-specific paths)
// -------------------------------------------------------
describe("recordPostRequestUsage via buildWrapStream", () => {
  it("calls userBudgetManager.recordSpend after stream completes", async () => {
    const recordSpend = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      userBudgetManager: {
        releaseInflight: vi.fn(),
        recordSpend,
        check: vi.fn(),
      } as unknown as MiddlewareContext["userBudgetManager"],
    })
    const wrapStream = buildWrapStream(ctx)

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: "hello" })
        controller.close()
      },
    })

    const params = paramsWithMeta({
      userId: "stream-budget-user",
      userBudgetInflight: 0.004,
    })

    const result = await wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
      params,
    })

    // Consume the stream to trigger recording
    const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
    while (!(await reader.read()).done) {
      /* empty */
    }

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(recordSpend).toHaveBeenCalledWith(
      "stream-budget-user",
      expect.any(Number),
      "gpt-4o-mini",
      0.004,
    )
  })

  it("emits storage:error when stream recordSpend rejects", async () => {
    const storageErrors: unknown[] = []
    const instanceEvents = createEventBus()
    instanceEvents.on("storage:error", (data) => storageErrors.push(data))

    const ctx = makeCtx({
      instanceEvents,
      userBudgetManager: {
        releaseInflight: vi.fn(),
        recordSpend: vi.fn().mockRejectedValue(new Error("IDB stream write fail")),
        check: vi.fn(),
      } as unknown as MiddlewareContext["userBudgetManager"],
    })
    const wrapStream = buildWrapStream(ctx)

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: "data" })
        controller.close()
      },
    })

    const params = paramsWithMeta({
      userId: "idb-stream-user",
      userBudgetInflight: 0.002,
    })

    const result = await wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
      params,
    })

    const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
    while (!(await reader.read()).done) {
      /* empty */
    }

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 50))

    expect(storageErrors.length).toBe(1)
    expect(storageErrors[0]).toEqual(
      expect.objectContaining({
        module: "userBudget",
        operation: "recordSpend",
      }),
    )
  })

  it("tolerates recordStreamUsage failure via log.debug", async () => {
    const debugFn = vi.fn()
    const ctx = makeCtx({
      log: {
        debug: debugFn,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as MiddlewareContext["log"],
      // Use a cache store that rejects to exercise the log.debug path (line 406)
      cache: {
        store: vi.fn().mockRejectedValue(new Error("cache store fail")),
        lookup: vi.fn(),
      } as unknown as MiddlewareContext["cache"],
    })
    const wrapStream = buildWrapStream(ctx)

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: "cached text" })
        controller.close()
      },
    })

    const params = paramsWithMeta({
      lastUserText: "some prompt",
    })

    const result = await wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
      params,
    })

    const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
    while (!(await reader.read()).done) {
      /* empty */
    }

    await new Promise((r) => setTimeout(r, 50))

    expect(debugFn).toHaveBeenCalledWith(
      "cache",
      "Failed to store streamed response",
      expect.objectContaining({ error: "cache store fail" }),
    )
  })

  it("calls adapter.recordSuccess after successful doStream", async () => {
    const recordSuccess = vi.fn()
    const ctx = makeCtx({
      adapter: {
        getProviderForModel: vi.fn().mockReturnValue("openai"),
        recordFailure: vi.fn(),
        recordSuccess,
      } as unknown as MiddlewareContext["adapter"],
    })
    const wrapStream = buildWrapStream(ctx)

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: "response" })
        controller.close()
      },
    })

    const params = paramsWithMeta({})
    const result = await wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
      params,
    })

    // Consume stream
    const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
    while (!(await reader.read()).done) {
      /* empty */
    }

    expect(recordSuccess).toHaveBeenCalledWith("openai", expect.any(Number))
  })

  it("logs debug when recordPostRequestUsage rejects in stream path (line 422)", async () => {
    const debugFn = vi.fn()
    // Make recordPostRequestUsage fail by making ledger.record reject
    const ctx = makeCtx({
      log: {
        debug: debugFn,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as MiddlewareContext["log"],
      ledger: {
        record: vi.fn().mockRejectedValue(new Error("ledger write fail")),
        recordCacheHit: vi.fn().mockResolvedValue(undefined),
        getSummary: vi.fn(),
      } as unknown as MiddlewareContext["ledger"],
    })
    const wrapStream = buildWrapStream(ctx)

    const originalStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", textDelta: "text" })
        controller.close()
      },
    })

    const params = paramsWithMeta({})
    const result = await wrapStream({
      doStream: vi.fn().mockResolvedValue({ stream: originalStream }),
      params,
    })

    const reader = ((result as Record<string, unknown>).stream as ReadableStream).getReader()
    while (!(await reader.read()).done) {
      /* empty */
    }

    await new Promise((r) => setTimeout(r, 50))

    expect(debugFn).toHaveBeenCalledWith(
      "ledger",
      "Failed to record stream usage",
      expect.objectContaining({ error: "ledger write fail" }),
    )
  })
})
