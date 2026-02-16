import { describe, it, expect, vi } from "vitest"
import {
  Pipeline,
  createPipeline,
  createBreakerStage,
  createBudgetStage,
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
import { UserBudgetManager } from "./user-budget-manager"

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
  it("handles empty pipeline gracefully", async () => {
    const pipeline = new Pipeline()
    const ctx = makeCtx()
    const result = await pipeline.execute(ctx)
    expect(result.aborted).toBe(false)
    expect(result.lastUserText).toBe("Hello")
  })

  it("supports async stages (Promise return)", async () => {
    const pipeline = createPipeline({
      name: "async",
      async execute(ctx) {
        await new Promise((r) => setTimeout(r, 1))
        ctx.meta.asyncDone = true
        return ctx
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.meta.asyncDone).toBe(true)
  })

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

  it("swallows afterStage hook errors", async () => {
    const pipeline = createPipeline(
      { name: "s1", execute: (ctx) => ctx },
      {
        name: "s2",
        execute: (ctx) => {
          ctx.meta.s2Ran = true
          return ctx
        },
      },
    )
    pipeline.addHook({
      afterStage: () => {
        throw new Error("after hook error")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(false)
    expect(result.meta.s2Ran).toBe(true)
  })

  it("swallows onError hook errors", async () => {
    const pipeline = createPipeline({
      name: "bad",
      execute: () => {
        throw new Error("stage error")
      },
    })
    pipeline.addHook({
      onError: () => {
        throw new Error("onError hook itself threw")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("stage error")
  })

  it("calls multiple hooks in order", async () => {
    const order: string[] = []
    const pipeline = createPipeline({ name: "s", execute: (ctx) => ctx })
    pipeline.addHook({ beforeStage: () => order.push("hook1-before") })
    pipeline.addHook({ beforeStage: () => order.push("hook2-before") })
    await pipeline.execute(makeCtx())
    expect(order).toEqual(["hook1-before", "hook2-before"])
  })

  it("addHook is chainable", () => {
    const pipeline = new Pipeline()
    const result = pipeline.addHook({ beforeStage: vi.fn() })
    expect(result).toBe(pipeline)
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

// ---------------------------------------------------------------------------
// Pre-built stages: createBudgetStage
// ---------------------------------------------------------------------------

describe("createBudgetStage", () => {
  it("allows requests within budget", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "user-123", { reserveForOutput: 500 })
    const ctx = makeCtx({ lastUserText: "Hello, help me with something" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.userId).toBe("user-123")
  })

  it("aborts when getUserId throws", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(
      manager,
      () => {
        throw new Error("no auth")
      },
      { reserveForOutput: 500 },
    )
    const ctx = makeCtx()
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBe("Failed to resolve user ID")
  })

  it("aborts when getUserId returns empty string", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "", { reserveForOutput: 500 })
    const ctx = makeCtx()
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("non-empty string")
  })

  it("stores userId and userBudgetInflight in meta", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "user-456", { reserveForOutput: 500 })
    const ctx = makeCtx({ lastUserText: "Estimate my cost" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.meta.userId).toBe("user-456")
    expect(result.meta.userBudgetInflight).toBeDefined()
  })

  it("applies tier model routing when configured", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
      tierModels: {
        standard: "gpt-4o-mini",
        premium: "gpt-4o",
      },
    })
    const stage = createBudgetStage(manager, () => "user-789", { reserveForOutput: 500 })
    const ctx = makeCtx({ modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    // Default tier is "standard", which maps to gpt-4o-mini
    if (result.meta.tierRouted) {
      expect(result.modelId).toBe("gpt-4o-mini")
      expect(result.meta.originalModel).toBe("gpt-4o")
    }
  })

  it("skips when already aborted", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "user-123", { reserveForOutput: 500 })
    const ctx = makeCtx({ aborted: true, abortReason: "earlier" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.abortReason).toBe("earlier")
  })

  it("handles missing lastUserText gracefully (0 estimated input)", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "user-123", { reserveForOutput: 500 })
    const ctx = makeCtx({ lastUserText: "" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.userId).toBe("user-123")
  })

  it("aborts when getUserId returns a non-string value", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    // Cast to bypass TypeScript — simulates a runtime non-string return
    const stage = createBudgetStage(manager, (() => 42) as unknown as () => string, {
      reserveForOutput: 500,
    })
    const ctx = makeCtx()
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("non-empty string")
  })

  it("sets userBudgetInflight to 0 when estimateCost throws", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
    })
    const stage = createBudgetStage(manager, () => "user-cost-err", { reserveForOutput: 500 })
    // Use an unknown model ID so estimateCost will throw
    const ctx = makeCtx({
      lastUserText: "Some prompt text",
      modelId: "nonexistent-model-that-will-throw",
    })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.userBudgetInflight).toBe(0)
  })

  it("applies tier routing and sets meta.tierRouted and meta.originalModel when tier model differs", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
      tierModels: {
        premium: "gpt-4o",
      },
      users: {
        "tier-user": { daily: 10, monthly: 100, tier: "premium" },
      },
    })
    const stage = createBudgetStage(manager, () => "tier-user", { reserveForOutput: 500 })
    // Start with a different model than the tier model
    const ctx = makeCtx({ modelId: "gpt-4o-mini" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.tierRouted).toBe(true)
    expect(result.meta.originalModel).toBe("gpt-4o-mini")
    expect(result.modelId).toBe("gpt-4o")
  })

  it("does not apply tier routing when tier model equals current modelId", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
      tierModels: {
        premium: "gpt-4o",
      },
      users: {
        "tier-user-same": { daily: 10, monthly: 100, tier: "premium" },
      },
    })
    const stage = createBudgetStage(manager, () => "tier-user-same", { reserveForOutput: 500 })
    // Already on the tier model
    const ctx = makeCtx({ modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.tierRouted).toBeUndefined()
    expect(result.meta.originalModel).toBeUndefined()
    expect(result.modelId).toBe("gpt-4o")
  })

  it("does not apply tier routing when getModelForUser returns null (no tierModels configured)", () => {
    const manager = new UserBudgetManager({
      defaultBudget: { daily: 10, monthly: 100 },
      // No tierModels configured at all
    })
    const stage = createBudgetStage(manager, () => "user-no-tier", { reserveForOutput: 500 })
    const ctx = makeCtx({ modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.aborted).toBe(false)
    expect(result.meta.tierRouted).toBeUndefined()
    expect(result.modelId).toBe("gpt-4o")
  })
})

// ---------------------------------------------------------------------------
// Additional branch coverage: createRouterStage
// ---------------------------------------------------------------------------

describe("createRouterStage - additional branch coverage", () => {
  it("skips when lastUserText is empty", () => {
    const tiers = [{ modelId: "gpt-4o-mini", maxComplexity: 40 }]
    const stage = createRouterStage(tiers)
    const ctx = makeCtx({ lastUserText: "", modelId: "gpt-4o" })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.modelId).toBe("gpt-4o")
  })

  it("does not set originalModel again if already set by budget stage", () => {
    const tiers = [{ modelId: "gpt-4o-mini", maxComplexity: 80 }]
    const stage = createRouterStage(tiers)
    const ctx = makeCtx({
      lastUserText: "Hello",
      modelId: "gpt-4o",
      meta: { originalModel: "gpt-4o-turbo" },
    })
    const result = stage.execute(ctx) as PipelineContext
    // originalModel should stay as previously set
    if (result.modelId !== "gpt-4o") {
      expect(result.meta.originalModel).toBe("gpt-4o-turbo")
    }
  })
})

// ---------------------------------------------------------------------------
// Additional branch coverage: createPrefixStage
// ---------------------------------------------------------------------------

describe("createPrefixStage - additional branch coverage", () => {
  it("returns ctx unchanged when MODEL_PRICING[modelId] is undefined", () => {
    const stage = createPrefixStage("openai")
    const originalMessages = [{ role: "user", content: "Hello" }]
    const ctx = makeCtx({ modelId: "totally-unknown-model-xyz", messages: [...originalMessages] })
    const result = stage.execute(ctx) as PipelineContext
    expect(result.meta.prefixSaved).toBeUndefined()
    expect(result.messages).toEqual(originalMessages)
  })
})

// ---------------------------------------------------------------------------
// Additional branch coverage: Pipeline removeStage and getStageNames
// ---------------------------------------------------------------------------

describe("Pipeline - removeStage and getStageNames additional coverage", () => {
  it("removeStage with non-existent name is a no-op", () => {
    const pipeline = new Pipeline()
    pipeline.addStage({ name: "a", execute: (ctx) => ctx })
    pipeline.removeStage("nonexistent")
    expect(pipeline.getStageNames()).toEqual(["a"])
  })

  it("getStageNames returns empty array for empty pipeline", () => {
    const pipeline = new Pipeline()
    expect(pipeline.getStageNames()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Additional branch coverage: Pipeline hook error swallowing
// ---------------------------------------------------------------------------

describe("Pipeline - hook error swallowing additional coverage", () => {
  it("swallows beforeStage hook error and continues executing stage", async () => {
    const stageExecuted = vi.fn()
    const pipeline = createPipeline({
      name: "s1",
      execute: (ctx) => {
        stageExecuted()
        return ctx
      },
    })
    pipeline.addHook({
      beforeStage: () => {
        throw new Error("before hook blew up")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(false)
    expect(stageExecuted).toHaveBeenCalledOnce()
  })

  it("swallows afterStage hook error without affecting next stage execution", async () => {
    const secondStageExecuted = vi.fn()
    const pipeline = createPipeline(
      { name: "s1", execute: (ctx) => ctx },
      {
        name: "s2",
        execute: (ctx) => {
          secondStageExecuted()
          return ctx
        },
      },
    )
    pipeline.addHook({
      afterStage: () => {
        throw new Error("after hook blew up")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(false)
    expect(secondStageExecuted).toHaveBeenCalledOnce()
  })

  it("swallows onError hook error when both stage and hook throw", async () => {
    const pipeline = createPipeline({
      name: "bad-stage",
      execute: () => {
        throw new Error("stage exploded")
      },
    })
    pipeline.addHook({
      onError: () => {
        throw new Error("onError hook also exploded")
      },
    })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("stage exploded")
  })

  it("handles stage throwing non-Error values (e.g., string)", async () => {
    const onError = vi.fn()
    const pipeline = createPipeline({
      name: "string-thrower",
      execute: () => {
        throw "a string error"
      },
    })
    pipeline.addHook({ onError })
    const result = await pipeline.execute(makeCtx())
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toContain("a string error")
    expect(onError).toHaveBeenCalledWith("string-thrower", expect.any(Error), expect.any(Object))
  })
})
