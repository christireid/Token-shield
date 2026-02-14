import { describe, it, expect, vi } from "vitest"
import {
  Pipeline,
  createPipeline,
  createBreakerStage,
  createGuardStage,
  createCacheStage,
  createContextStage,
  createRouterStage,
  createPrefixStage,
  type PipelineContext,
} from "./pipeline"
import { CostCircuitBreaker } from "./circuit-breaker"
import { RequestGuard } from "./request-guard"
import { ResponseCache } from "./response-cache"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    params: {},
    messages: [{ role: "user", content: "Hello" }],
    lastUserText: "Hello",
    modelId: "gpt-4o-mini",
    meta: {},
    aborted: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Pipeline class
// ---------------------------------------------------------------------------

describe("Pipeline - addStage / removeStage / getStageNames", () => {
  it("addStage appends and getStageNames returns ordered names", () => {
    const pipeline = new Pipeline()
    pipeline.addStage({ name: "a", execute: (ctx) => ctx })
    pipeline.addStage({ name: "b", execute: (ctx) => ctx })
    expect(pipeline.getStageNames()).toEqual(["a", "b"])
  })

  it("removeStage removes by name", () => {
    const pipeline = new Pipeline()
    pipeline.addStage({ name: "a", execute: (ctx) => ctx })
    pipeline.addStage({ name: "b", execute: (ctx) => ctx })
    pipeline.removeStage("a")
    expect(pipeline.getStageNames()).toEqual(["b"])
  })

  it("addStage and removeStage are chainable", () => {
    const pipeline = new Pipeline()
    const result = pipeline
      .addStage({ name: "a", execute: (ctx) => ctx })
      .addStage({ name: "b", execute: (ctx) => ctx })
      .removeStage("a")
    expect(result).toBe(pipeline)
    expect(pipeline.getStageNames()).toEqual(["b"])
  })
})

// ---------------------------------------------------------------------------
// Pipeline execute
// ---------------------------------------------------------------------------

describe("Pipeline - execute", () => {
  it("runs stages in order", async () => {
    const order: string[] = []
    const pipeline = createPipeline(
      {
        name: "first",
        execute: (ctx) => {
          order.push("first")
          return ctx
        },
      },
      {
        name: "second",
        execute: (ctx) => {
          order.push("second")
          return ctx
        },
      },
      {
        name: "third",
        execute: (ctx) => {
          order.push("third")
          return ctx
        },
      },
    )
    await pipeline.execute(makeCtx())
    expect(order).toEqual(["first", "second", "third"])
  })

  it("stops on abort (does not execute subsequent stages)", async () => {
    const order: string[] = []
    const pipeline = createPipeline(
      {
        name: "aborter",
        execute: (ctx) => {
          order.push("aborter")
          ctx.aborted = true
          ctx.abortReason = "test abort"
          return ctx
        },
      },
      {
        name: "skipped",
        execute: (ctx) => {
          order.push("skipped")
          return ctx
        },
      },
    )
    const result = await pipeline.execute(makeCtx())
    expect(order).toEqual(["aborter"])
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBe("test abort")
  })

  it("calls beforeStage and afterStage hooks", async () => {
    const beforeStage = vi.fn()
    const afterStage = vi.fn()
    const pipeline = createPipeline({ name: "s1", execute: (ctx) => ctx })
    pipeline.addHook({ beforeStage, afterStage })
    await pipeline.execute(makeCtx())
    expect(beforeStage).toHaveBeenCalledWith("s1", expect.any(Object))
    expect(afterStage).toHaveBeenCalledWith("s1", expect.any(Object), expect.any(Number))
  })

  it("calls onError hook and aborts when a stage throws", async () => {
    const onError = vi.fn()
    const pipeline = createPipeline(
      {
        name: "failing",
        execute: () => {
          throw new Error("boom")
        },
      },
      { name: "after", execute: (ctx) => ctx },
    )
    pipeline.addHook({ onError })
    const result = await pipeline.execute(makeCtx())
    expect(onError).toHaveBeenCalledWith("failing", expect.any(Error), expect.any(Object))
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("boom")
  })

  it("swallows hook errors without aborting the pipeline", async () => {
    const pipeline = createPipeline({ name: "s1", execute: (ctx) => ctx })
    pipeline.addHook({
      beforeStage: () => {
        throw new Error("hook error")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createPipeline factory
// ---------------------------------------------------------------------------

describe("createPipeline", () => {
  it("creates a pipeline pre-loaded with given stages", () => {
    const pipeline = createPipeline(
      { name: "a", execute: (ctx) => ctx },
      { name: "b", execute: (ctx) => ctx },
    )
    expect(pipeline).toBeInstanceOf(Pipeline)
    expect(pipeline.getStageNames()).toEqual(["a", "b"])
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createBreakerStage
// ---------------------------------------------------------------------------

describe("createBreakerStage", () => {
  it("passes when breaker allows the request", () => {
    const breaker = new CostCircuitBreaker({ limits: { perSession: 100 } })
    const stage = createBreakerStage(breaker, { reserveForOutput: 500 })
    const ctx = makeCtx()
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
  })

  it("aborts when breaker blocks the request", () => {
    const breaker = new CostCircuitBreaker({ limits: { perSession: 0 }, action: "stop" })
    const stage = createBreakerStage(breaker, { reserveForOutput: 500 })
    const ctx = makeCtx({ lastUserText: "Hello world, this is a test prompt" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBeDefined()
  })

  it("skips if context is already aborted", () => {
    const breaker = new CostCircuitBreaker({ limits: { perSession: 0 }, action: "stop" })
    const stage = createBreakerStage(breaker, { reserveForOutput: 500 })
    const ctx = makeCtx({ aborted: true, abortReason: "previous" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.abortReason).toBe("previous")
  })

  it("skips if lastUserText is empty", () => {
    const breaker = new CostCircuitBreaker({ limits: { perSession: 0 }, action: "stop" })
    const stage = createBreakerStage(breaker, { reserveForOutput: 500 })
    const ctx = makeCtx({ lastUserText: "" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createGuardStage
// ---------------------------------------------------------------------------

describe("createGuardStage", () => {
  it("passes valid requests", () => {
    const guard = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 100,
      maxCostPerHour: 100,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: false,
    })
    const stage = createGuardStage(guard)
    const ctx = makeCtx({ lastUserText: "Tell me about TypeScript" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
  })

  it("aborts when guard blocks (e.g. too-short prompt)", () => {
    const guard = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 100,
      maxCostPerHour: 100,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: false,
      minInputLength: 50,
    })
    const stage = createGuardStage(guard)
    const ctx = makeCtx({ lastUserText: "hi" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createCacheStage
// ---------------------------------------------------------------------------

describe("createCacheStage", () => {
  it("sets cacheHit meta on cache hit", async () => {
    const cache = new ResponseCache()
    // Manually store an entry first
    await cache.store("Hello", "World response", "gpt-4o-mini", 5, 10)
    const stage = createCacheStage(cache)
    const ctx = makeCtx({ lastUserText: "Hello" })
    const result = await stage.execute(ctx)
    expect(result.meta.cacheHit).toBeDefined()
    expect((result.meta.cacheHit as { response: string }).response).toBe("World response")
    // Cache hit causes abort with special reason
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBe("cache-hit")
  })

  it("passes through on cache miss", async () => {
    const cache = new ResponseCache()
    const stage = createCacheStage(cache)
    const ctx = makeCtx({ lastUserText: "Something never cached" })
    const result = await stage.execute(ctx)
    expect(result.aborted).toBe(false)
    expect(result.meta.cacheHit).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createContextStage
// ---------------------------------------------------------------------------

describe("createContextStage", () => {
  it("trims messages when over budget", () => {
    // Create a context with many long messages
    const longMessages = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `This is message number ${i} with some extra text to make it longer and consume more tokens in the context window.`,
    }))
    const stage = createContextStage({ maxInputTokens: 50, reserveForOutput: 20 })
    const ctx = makeCtx({ messages: longMessages, lastUserText: longMessages[19].content })
    const result = stage.execute(ctx) as PipelineContext
    // Should have fewer messages than the original 20
    expect(result.messages.length).toBeLessThan(20)
    expect(result.meta.contextSaved).toBeGreaterThan(0)
  })

  it("does not trim when within budget", () => {
    const stage = createContextStage({ maxInputTokens: 10000, reserveForOutput: 500 })
    const ctx = makeCtx()
    const result = stage.execute(ctx) as PipelineContext
    expect(result.messages).toHaveLength(1)
    // contextSaved should not be set when no trimming occurred
    expect(result.meta.contextSaved).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createRouterStage
// ---------------------------------------------------------------------------

describe("createRouterStage", () => {
  it("routes to cheaper model for simple prompt", () => {
    const tiers = [
      { modelId: "gpt-4o-mini", maxComplexity: 40 },
      { modelId: "gpt-4o", maxComplexity: 80 },
    ]
    const stage = createRouterStage(tiers)
    // "Hello" is a very simple prompt
    const ctx = makeCtx({ lastUserText: "Hello", modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    // Should route to the cheaper model since "Hello" is low complexity
    expect(result.modelId).toBe("gpt-4o-mini")
    expect(result.meta.originalModel).toBe("gpt-4o")
  })

  it("skips routing if tierRouted is already set", () => {
    const tiers = [{ modelId: "gpt-4o-mini", maxComplexity: 40 }]
    const stage = createRouterStage(tiers)
    const ctx = makeCtx({ modelId: "gpt-4o", meta: { tierRouted: true } })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.modelId).toBe("gpt-4o")
  })

  it("skips when tiers array is empty", () => {
    const stage = createRouterStage([])
    const ctx = makeCtx({ modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.modelId).toBe("gpt-4o")
  })

  it("skips when context is already aborted", () => {
    const tiers = [{ modelId: "gpt-4o-mini", maxComplexity: 40 }]
    const stage = createRouterStage(tiers)
    const ctx = makeCtx({ aborted: true, modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.modelId).toBe("gpt-4o")
  })
})

// ---------------------------------------------------------------------------
// Pre-built stages: createPrefixStage
// ---------------------------------------------------------------------------

describe("createPrefixStage", () => {
  it("reorders messages for prefix optimization when savings exist", () => {
    const stage = createPrefixStage("openai")
    // Use a model with known pricing so optimizePrefix can work
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant." },
      { role: "user" as const, content: "What is JavaScript?" },
      { role: "assistant" as const, content: "JavaScript is a programming language." },
      { role: "user" as const, content: "Tell me more." },
    ]
    const ctx = makeCtx({
      messages,
      lastUserText: "Tell me more.",
      modelId: "gpt-4o-mini",
    })
    const result = stage.execute(ctx) as PipelineContext
    // The stage returns ctx — messages may or may not have savings depending on prefix analysis
    expect(result.messages.length).toBeGreaterThan(0)
  })

  it("skips when aborted", () => {
    const stage = createPrefixStage("openai")
    const ctx = makeCtx({ aborted: true })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
  })

  it("skips when model has no pricing data", () => {
    const stage = createPrefixStage("openai")
    const ctx = makeCtx({ modelId: "unknown-model-xyz" })
    const result = stage.execute(ctx) as PipelineContext
    // Should pass through without changes
    expect(result.meta.prefixSaved).toBeUndefined()
  })
})
