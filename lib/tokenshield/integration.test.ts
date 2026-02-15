/**
 * TokenShield - Comprehensive Integration / Battle Test
 *
 * Exercises the FULL TokenShield pipeline end-to-end, verifying that ALL
 * modules are properly wired and working together.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------- Module imports (tested individually AND via pipeline) ----------
import {
  tokenShieldMiddleware,
  type TokenShieldMiddleware,
  type TokenShieldMiddlewareConfig,
} from "./middleware"
import { ResponseCache } from "./response-cache"
import { NeuroElasticEngine } from "./neuro-elastic"
import { ShieldWorker } from "./shield-worker"
import {
  createGenericAdapter,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createStreamAdapter,
} from "./adapters"
import { shieldEvents, type TokenShieldEvents } from "./event-bus"
import { TokenShieldLogger, createLogger } from "./logger"
import { ProviderAdapter } from "./provider-adapter"
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

// ---------- Helpers ----------

/** Build an AI SDK-style prompt array from plain messages. */
function makePrompt(messages: Array<{ role: string; content: string }>) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.content }],
  }))
}

/** Build a realistic doGenerate mock that returns AI SDK-shaped responses. */
function mockDoGenerate(text = "This is a mock response from the model.") {
  return vi.fn().mockResolvedValue({
    text,
    usage: { promptTokens: 50, completionTokens: 20 },
    finishReason: "stop",
  })
}

/** Build a doStream mock returning a ReadableStream of text-delta chunks. */
function mockDoStream(text = "Hello world from stream") {
  return vi.fn().mockResolvedValue({
    stream: new ReadableStream({
      start(controller) {
        const words = text.split(" ")
        for (const word of words) {
          controller.enqueue({ type: "text-delta", textDelta: word + " " })
        }
        controller.close()
      },
    }),
  })
}

/** Create a fresh pipeline context for pipeline tests. */
function makePipelineContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    params: { modelId: "gpt-4.1" },
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello, how are you today?" },
    ],
    lastUserText: "Hello, how are you today?",
    modelId: "gpt-4.1",
    meta: {},
    aborted: false,
    ...overrides,
  }
}

// Clean up event-bus listeners between tests to prevent leaking
let cleanupFns: Array<() => void> = []
function onEvent<K extends keyof TokenShieldEvents>(
  type: K,
  handler: (data: TokenShieldEvents[K]) => void,
) {
  shieldEvents.on(type, handler)
  cleanupFns.push(() => shieldEvents.off(type, handler))
}

beforeEach(() => {
  cleanupFns = []
})
afterEach(() => {
  for (const fn of cleanupFns) fn()
})

// ====================================================================
// 1. Full middleware pipeline
// ====================================================================

describe("Full middleware pipeline", () => {
  let shield: TokenShieldMiddleware

  beforeEach(() => {
    shield = tokenShieldMiddleware({
      modules: {
        guard: true,
        cache: true,
        context: true,
        router: false,
        prefix: true,
        ledger: true,
      },
      guard: {
        debounceMs: 0,
        maxRequestsPerMinute: 1000,
        maxCostPerHour: 100,
      },
      cache: {
        maxEntries: 100,
        ttlMs: 60_000,
        similarityThreshold: 0.85,
      },
      breaker: {
        limits: { perSession: 100 },
        action: "stop",
      },
      logger: { level: "debug", enableSpans: true },
      providerAdapter: {
        providers: [
          { name: "openai", models: ["gpt-4.1", "gpt-4o-mini"], priority: 0 },
        ],
      },
    })
  })

  it("exposes all module instances on the middleware object", () => {
    expect(shield.ledger).not.toBeNull()
    expect(shield.cache).not.toBeNull()
    expect(shield.guard).not.toBeNull()
    expect(shield.events).toBeDefined()
    expect(shield.logger).not.toBeNull()
    expect(shield.providerAdapter).not.toBeNull()
    // Verify the events object has mitt-like interface
    expect(typeof shield.events.on).toBe("function")
    expect(typeof shield.events.off).toBe("function")
    expect(typeof shield.events.emit).toBe("function")
  })

  it("transformParams + wrapGenerate pipeline flows through correctly", async () => {
    const doGenerate = mockDoGenerate("The answer is 42.")

    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "What is the meaning of life, the universe, and everything?" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    const result = await shield.wrapGenerate({
      doGenerate,
      params: transformed,
    })

    // The model should have been called since this is the first request
    expect(doGenerate).toHaveBeenCalledTimes(1)
    expect(result.text).toBe("The answer is 42.")
    expect(result.finishReason).toBe("stop")
  })

  it("second call with same prompt is a cache hit", async () => {
    const doGenerate = mockDoGenerate("Cached answer.")

    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Tell me a unique and interesting fact about the planet Mars and its moons" },
      ]),
    }

    // First call -- cache miss, model is called
    const t1 = await shield.transformParams({ params })
    await shield.wrapGenerate({ doGenerate, params: t1 })
    expect(doGenerate).toHaveBeenCalledTimes(1)

    // Wait a tick for the fire-and-forget cache store to finish
    await new Promise((r) => setTimeout(r, 50))

    // Second call -- should be a cache hit
    const t2 = await shield.transformParams({ params })
    const result2 = await shield.wrapGenerate({ doGenerate, params: t2 })

    // doGenerate should NOT have been called a second time (cache returned)
    expect(doGenerate).toHaveBeenCalledTimes(1)
    expect(result2.text).toBe("Cached answer.")
  })

  it("emits events during the pipeline", async () => {
    const events: string[] = []

    // Subscribe BEFORE making the call
    onEvent("request:allowed", () => events.push("request:allowed"))
    onEvent("cache:miss", () => events.push("cache:miss"))
    onEvent("ledger:entry", () => events.push("ledger:entry"))

    const doGenerate = mockDoGenerate("Event test response.")
    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Describe the event emission pathway in TokenShield middleware" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    await shield.wrapGenerate({ doGenerate, params: transformed })

    expect(events).toContain("request:allowed")
    expect(events).toContain("cache:miss")
    expect(events).toContain("ledger:entry")
  })

  it("ledger records usage after generate", async () => {
    const doGenerate = mockDoGenerate("Ledger test.")

    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Test the cost ledger integration with detailed prompt text" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    await shield.wrapGenerate({ doGenerate, params: transformed })

    const summary = shield.ledger!.getSummary()
    expect(summary.totalCalls).toBeGreaterThanOrEqual(1)
    expect(summary.entries.length).toBeGreaterThanOrEqual(1)
  })

  it("wrapStream works end-to-end with token tracking", async () => {
    const doStream = mockDoStream("Streaming tokens arrive here")

    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Stream me a response about advanced machine learning techniques" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    const result = await shield.wrapStream({ doStream, params: transformed })

    // Read the entire stream
    const reader = (result.stream as ReadableStream).getReader()
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && typeof value === "object" && "textDelta" in value) {
        chunks.push((value as { textDelta: string }).textDelta)
      }
    }

    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join("")).toContain("Streaming")
  })
})

// ====================================================================
// 2. NeuroElastic + ResponseCache integration
// ====================================================================

describe("NeuroElastic + ResponseCache integration", () => {
  let cache: ResponseCache

  beforeEach(() => {
    cache = new ResponseCache({
      maxEntries: 100,
      ttlMs: 60_000,
      similarityThreshold: 0.6,
      encodingStrategy: "holographic",
      semanticSeeds: { cost: 10, price: 10, explain: 20, tell: 20 },
    })
  })

  it("holographic fuzzy match: cost/price synonyms", async () => {
    await cache.store(
      "What is the cost of GPT-4?",
      "GPT-4 costs $30 per million input tokens.",
      "gpt-4.1",
      100,
      50,
    )

    const lookup = await cache.lookup("What is the price of GPT-4?", "gpt-4.1")
    // With holographic encoding and semantic seeds mapping cost/price together,
    // this should be a fuzzy match
    expect(lookup.hit).toBe(true)
    expect(lookup.matchType).toBe("fuzzy")
    expect(lookup.entry!.response).toBe("GPT-4 costs $30 per million input tokens.")
  })

  it("holographic fuzzy match: explain/tell paraphrases", async () => {
    await cache.store(
      "Explain React hooks in detail for beginners",
      "React hooks are functions that let you use state...",
      "gpt-4.1",
      200,
      150,
    )

    const lookup = await cache.lookup(
      "Tell me about React hooks in detail for beginners",
      "gpt-4.1",
    )
    expect(lookup.hit).toBe(true)
    if (lookup.hit) {
      expect(lookup.entry!.response).toContain("React hooks")
    }
  })

  it("stats work with holographic encoding", async () => {
    await cache.store("prompt A about tokens", "response A", "gpt-4.1", 10, 5)
    await cache.store("prompt B about tokens", "response B", "gpt-4.1", 20, 10)

    const stats = cache.stats()
    expect(stats.entries).toBe(2)
    expect(stats.totalHits).toBe(0)
    expect(stats.totalSavedTokens).toBe(0) // no lookups yet
  })

  it("clear empties all entries", async () => {
    await cache.store("clearable prompt", "clearable response", "gpt-4.1", 10, 5)
    expect(cache.stats().entries).toBe(1)

    await cache.clear()
    expect(cache.stats().entries).toBe(0)

    const lookup = await cache.lookup("clearable prompt", "gpt-4.1")
    expect(lookup.hit).toBe(false)
  })
})

// ====================================================================
// 3. ShieldWorker inline mode end-to-end
// ====================================================================

describe("ShieldWorker inline mode end-to-end", () => {
  it("init -> learn -> find returns a match", async () => {
    const worker = new ShieldWorker()
    await worker.init({ threshold: 0.5, enableInhibition: false })

    expect(worker.isReady).toBe(true)
    expect(worker.executionMode).toBe("inline")

    await worker.learn(
      "How do I deploy to Vercel?",
      "You can deploy by running vercel --prod...",
      "gpt-4.1",
      100,
      80,
    )

    const result = await worker.find("How do I deploy to Vercel?")
    expect(result).not.toBeNull()
    expect(result!.response).toContain("vercel --prod")
    expect(result!.score).toBeGreaterThan(0.5)
  })

  it("learn multiple -> stats returns correct count", async () => {
    const worker = new ShieldWorker()
    await worker.init({ threshold: 0.5, enableInhibition: false })

    await worker.learn("Prompt one about alpha", "Response one", "gpt-4.1", 10, 5)
    await worker.learn("Prompt two about beta", "Response two", "gpt-4.1", 20, 10)
    await worker.learn("Prompt three about gamma", "Response three", "gpt-4.1", 30, 15)

    const stats = await worker.stats()
    expect(stats.entries).toBe(3)
    expect(stats.totalHits).toBe(3) // Each learn sets hits=1
  })

  it("clear -> find returns null", async () => {
    const worker = new ShieldWorker()
    await worker.init({ threshold: 0.5, enableInhibition: false })

    await worker.learn("Something to remember", "The remembered thing", "gpt-4.1", 10, 5)
    await worker.clear()

    const result = await worker.find("Something to remember")
    expect(result).toBeNull()

    const stats = await worker.stats()
    expect(stats.entries).toBe(0)
  })
})

// ====================================================================
// 4. Framework adapters
// ====================================================================

describe("Framework adapters", () => {
  let shield: TokenShieldMiddleware

  beforeEach(() => {
    shield = tokenShieldMiddleware({
      modules: {
        cache: false,
        guard: false,
        context: false,
        router: false,
        prefix: false,
        ledger: true,
      },
    })
  })

  it("createGenericAdapter: wraps a mock fn and pipeline runs", async () => {
    const mockFn = vi.fn().mockResolvedValue({
      text: "Generic adapter response",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
    })

    const call = createGenericAdapter(shield, mockFn, { modelId: "gpt-4.1" })
    const result = await call({
      messages: [{ role: "user", content: "Hello from the generic adapter test" }],
    })

    expect(mockFn).toHaveBeenCalledTimes(1)
    // Expect raw response
    expect(result).toEqual({
      text: "Generic adapter response",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
    })
  })

  it("createOpenAIAdapter: converts OpenAI-format response", async () => {
    const mockCreateFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "OpenAI adapter response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 25, completion_tokens: 15 },
    })

    const chat = createOpenAIAdapter(shield, mockCreateFn, { defaultModel: "gpt-4.1" })
    const result = await chat({
      messages: [{ role: "user", content: "Test the OpenAI adapter with a meaningful prompt" }],
    })

    expect(mockCreateFn).toHaveBeenCalledTimes(1)
    // Expect raw response
    expect(result.choices[0].message.content).toBe("OpenAI adapter response")
  })

  it("createAnthropicAdapter: converts Anthropic-format response", async () => {
    const mockCreateFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Anthropic adapter response" }],
      usage: { input_tokens: 30, output_tokens: 20 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, mockCreateFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 1024,
    })
    const result = await chat({
      messages: [{ role: "user", content: "Test the Anthropic adapter with a thorough prompt" }],
    })

    expect(mockCreateFn).toHaveBeenCalledTimes(1)
    // Expect raw response
    expect(result.content[0].text).toBe("Anthropic adapter response")
  })

  it("createStreamAdapter: returns a ReadableStream", async () => {
    const mockStreamFn = vi.fn().mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "chunk1 " })
          controller.enqueue({ type: "text-delta", textDelta: "chunk2 " })
          controller.close()
        },
      }),
    )

    const streamCall = createStreamAdapter(shield, mockStreamFn, { modelId: "gpt-4.1" })
    const stream = await streamCall({
      messages: [{ role: "user", content: "Stream adapter test prompt with adequate length" }],
    })

    expect(stream).toBeInstanceOf(ReadableStream)

    // Read all chunks
    const reader = stream.getReader()
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && typeof value === "object" && "textDelta" in value) {
        chunks.push((value as { textDelta: string }).textDelta)
      }
    }

    expect(chunks).toContain("chunk1 ")
    expect(chunks).toContain("chunk2 ")
  })
})

// ====================================================================
// 5. Pipeline stages compose correctly
// ====================================================================

describe("Pipeline stages compose correctly", () => {
  it("all 7 stages execute in order via hooks", async () => {
    const breaker = new CostCircuitBreaker({
      limits: { perSession: 100 },
      action: "stop",
    })
    const guard = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 1000,
      maxCostPerHour: 100,
    })
    const cache = new ResponseCache({ maxEntries: 100, ttlMs: 60_000, similarityThreshold: 1 })

    const pipeline = createPipeline(
      createBreakerStage(breaker, { reserveForOutput: 500 }),
      createGuardStage(guard),
      createCacheStage(cache),
      createContextStage({ maxInputTokens: 4000, reserveForOutput: 500 }),
      createRouterStage([]),
      createPrefixStage("auto"),
    )

    const stageOrder: string[] = []
    pipeline.addHook({
      afterStage: (name) => stageOrder.push(name),
    })

    const ctx = makePipelineContext()
    await pipeline.execute(ctx)

    expect(stageOrder).toEqual(["breaker", "guard", "cache", "context", "router", "prefix"])
  })

  it("pipeline with only breaker + guard runs only those stages", async () => {
    const breaker = new CostCircuitBreaker({
      limits: { perSession: 100 },
      action: "stop",
    })
    const guard = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 1000,
      maxCostPerHour: 100,
    })

    const pipeline = createPipeline(
      createBreakerStage(breaker, { reserveForOutput: 500 }),
      createGuardStage(guard),
    )

    const stageOrder: string[] = []
    pipeline.addHook({
      afterStage: (name) => stageOrder.push(name),
    })

    const ctx = makePipelineContext()
    await pipeline.execute(ctx)

    expect(stageOrder).toEqual(["breaker", "guard"])
  })

  it("cache stage aborts pipeline on cache hit", async () => {
    const cache = new ResponseCache({
      maxEntries: 100,
      ttlMs: 60_000,
      similarityThreshold: 1,
    })

    // Pre-populate cache
    await cache.store(
      "Hello, how are you today?",
      "I am doing well!",
      "gpt-4.1",
      50,
      20,
    )

    const pipeline = createPipeline(
      createCacheStage(cache),
      createContextStage({ maxInputTokens: 4000, reserveForOutput: 500 }),
      createPrefixStage("auto"),
    )

    const stageOrder: string[] = []
    pipeline.addHook({
      afterStage: (name) => stageOrder.push(name),
    })

    const ctx = makePipelineContext()
    const result = await pipeline.execute(ctx)

    // Cache stage sets aborted=true with reason "cache-hit"
    expect(result.aborted).toBe(true)
    expect(result.abortReason).toBe("cache-hit")
    // Only cache stage should have run; subsequent stages are skipped
    expect(stageOrder).toEqual(["cache"])
    expect(result.meta.cacheHit).toBeDefined()
  })
})

// ====================================================================
// 6. Event bus + Logger + Provider Adapter integration
// ====================================================================

describe("Event bus + Logger + Provider Adapter integration", () => {
  it("logger receives events from the pipeline", async () => {
    const logEntries: Array<{ module: string; message: string }> = []

    const shield = tokenShieldMiddleware({
      modules: {
        guard: true,
        cache: true,
        context: false,
        router: false,
        prefix: false,
        ledger: true,
      },
      guard: {
        debounceMs: 0,
        maxRequestsPerMinute: 1000,
        maxCostPerHour: 100,
      },
      logger: {
        level: "debug",
        handler: (entry) => {
          logEntries.push({ module: entry.module, message: entry.message })
        },
      },
    })

    const doGenerate = mockDoGenerate("Logger integration test response.")
    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Check that the logger receives structured event data from middleware" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    await shield.wrapGenerate({ doGenerate, params: transformed })

    // The logger should have received events via the event bus connection
    expect(logEntries.length).toBeGreaterThan(0)

    // Should include at least a request:allowed and cache:miss event
    const modules = logEntries.map((e) => e.module)
    expect(modules).toContain("request:allowed")
    expect(modules).toContain("cache:miss")
  })

  it("provider adapter tracks health after request", async () => {
    const adapter = new ProviderAdapter({
      providers: [
        { name: "openai", models: ["gpt-4.1"], priority: 0 },
        { name: "anthropic", models: ["claude-sonnet-4-20250514"], priority: 1 },
      ],
    })

    // Record some successes and failures
    adapter.recordSuccess("openai", 150)
    adapter.recordSuccess("openai", 200)
    adapter.recordFailure("anthropic", "Rate limit exceeded")

    const healthList = adapter.getHealth()
    expect(healthList.length).toBe(2)

    const openaiHealth = adapter.getProviderHealth("openai")
    expect(openaiHealth).toBeDefined()
    expect(openaiHealth!.healthy).toBe(true)
    expect(openaiHealth!.totalRequests).toBe(2)
    expect(openaiHealth!.avgLatencyMs).toBeGreaterThan(0)

    const anthropicHealth = adapter.getProviderHealth("anthropic")
    expect(anthropicHealth).toBeDefined()
    expect(anthropicHealth!.consecutiveFailures).toBe(1)
    expect(anthropicHealth!.lastError).toBe("Rate limit exceeded")
  })

  it("provider adapter integrates with middleware pipeline", async () => {
    const shield = tokenShieldMiddleware({
      modules: {
        guard: false,
        cache: false,
        context: false,
        router: false,
        prefix: false,
        ledger: true,
      },
      providerAdapter: {
        providers: [
          { name: "openai", models: ["gpt-4.1", "gpt-4o-mini"], priority: 0 },
        ],
      },
    })

    expect(shield.providerAdapter).not.toBeNull()

    const doGenerate = mockDoGenerate("Provider adapter pipeline test.")
    const params = {
      modelId: "gpt-4.1",
      prompt: makePrompt([
        { role: "user", content: "Test the provider adapter tracking through the middleware pipeline" },
      ]),
    }

    const transformed = await shield.transformParams({ params })
    await shield.wrapGenerate({ doGenerate, params: transformed })

    // After a successful call, the provider adapter should have recorded a success
    const health = shield.providerAdapter!.getProviderHealth("openai")
    expect(health).toBeDefined()
    expect(health!.totalRequests).toBe(1)
    expect(health!.healthy).toBe(true)
  })
})

// ====================================================================
// 7. All index.ts exports are importable
// ====================================================================

describe("All index.ts exports are importable", () => {
  it("every named export from index.ts is defined", async () => {
    const idx = await import("./index")

    // Core modules
    const coreExports = [
      // 1. Token Counter
      "countExactTokens",
      "countChatTokens",
      "countFast",
      "fitsInBudget",
      "encodeText",
      "decodeTokens",
      "truncateToTokenBudget",
      "countModelTokens",
      // 2. Cost Estimator
      "estimateCost",
      "compareCosts",
      "calculateSavings",
      "cheapestModelForBudget",
      "projectMonthlyCost",
      "MODEL_PRICING",
      // 3. Context Manager
      "fitToBudget",
      "slidingWindow",
      "priorityFit",
      "smartFit",
      "createSummaryMessage",
      // 4. Response Cache
      "ResponseCache",
      "normalizeText",
      "textSimilarity",
      "classifyContentType",
      // 5. Model Router
      "analyzeComplexity",
      "routeToModel",
      "rankModels",
      // 6. Request Guard
      "RequestGuard",
      // 7. Prefix Optimizer
      "optimizePrefix",
      "detectProvider",
      "getCacheDiscountRate",
      "projectPrefixSavings",
      // 8. Cost Ledger
      "CostLedger",
      // 9. Tool Token Counter
      "countToolTokens",
      "optimizeToolDefinitions",
      "countImageTokens",
      "predictOutputTokens",
      // 10. Stream Tracker
      "StreamTokenTracker",
      // 11. Circuit Breaker
      "CostCircuitBreaker",
      // 12. User Budget Manager
      "UserBudgetManager",
      // 13. Anomaly Detector
      "AnomalyDetector",
      // Middleware
      "tokenShieldMiddleware",
      "getLedger",
      // React (exported but may be undefined in non-React env -- we just check the key exists)
      "TokenShieldProvider",
      "useSavings",
      "useTokenCount",
      "useBudgetAlert",
      "useTokenEstimate",
      "useComplexityAnalysis",
      "useContextManager",
      "useResponseCache",
      "useRequestGuard",
      "useModelRouter",
      "useCostLedger",
      "useFeatureCost",
      "useUserBudget",
      "useEventLog",
      "useProviderHealth",
      "usePipelineMetrics",
      "useShieldedCall",
      // Dashboard
      "TokenShieldDashboard",
      // Pricing Registry
      "PRICING_REGISTRY",
      "registerModel",
      "getModelPricing",
      "getModelsByProvider",
      // Event Bus
      "shieldEvents",
      "createEventBus",
      // Errors
      "TokenShieldError",
      "TokenShieldBlockedError",
      "TokenShieldConfigError",
      "TokenShieldBudgetError",
      "TokenShieldCryptoError",
      "ERROR_CODES",
      // Config Schemas
      "validateConfig",
      "TokenShieldConfigSchema",
      "GuardConfigSchema",
      "CacheConfigSchema",
      "ContextConfigSchema",
      "RouterConfigSchema",
      "BreakerConfigSchema",
      "UserBudgetConfigSchema",
      "UserBudgetLimitsSchema",
      // Encrypted Storage
      "EncryptedStore",
      "createEncryptedStore",
      // Pipeline
      "Pipeline",
      "createPipeline",
      "createBreakerStage",
      "createBudgetStage",
      "createGuardStage",
      "createCacheStage",
      "createContextStage",
      "createRouterStage",
      "createPrefixStage",
      // Logger
      "TokenShieldLogger",
      "logger",
      "createLogger",
      // Provider Adapter
      "ProviderAdapter",
      "createProviderAdapter",
      "retryWithBackoff",
      // Framework Adapters
      "createGenericAdapter",
      "createOpenAIAdapter",
      "createAnthropicAdapter",
      "createStreamAdapter",
      // NeuroElastic
      "NeuroElasticEngine",
      "createNeuroElasticEngine",
      // Worker
      "ShieldWorker",
      "createShieldWorker",
      // Benchmarks
      "bench",
      "benchAsync",
      "runAllBenchmarks",
      "formatResults",
    ]

    const indexModule = idx as Record<string, unknown>
    const missing: string[] = []
    for (const name of coreExports) {
      if (indexModule[name] === undefined) {
        missing.push(name)
      }
    }

    expect(missing).toEqual([])
  })
})
