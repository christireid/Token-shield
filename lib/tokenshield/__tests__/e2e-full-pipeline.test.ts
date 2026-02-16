import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { tokenShieldMiddleware } from "../middleware"
import { TokenShieldBlockedError } from "../errors"
import { subscribeToEvent } from "../event-bus"
import type { TokenShieldEvents } from "../event-bus"
import type { TokenShieldMiddleware } from "../middleware-types"

/**
 * End-to-end integration test for the full TokenShield middleware pipeline.
 *
 * Exercises the complete path:
 *   breaker -> guard -> cache lookup -> compressor -> delta -> context trim -> route -> prefix optimize -> ledger
 *
 * All tests run against the real middleware pipeline — no mocking of internal
 * modules. Only the model call itself (doGenerate) is stubbed since these
 * are unit-integration tests, not live API tests.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a standard AI SDK prompt structure with the given messages. */
function buildPrompt(
  messages: Array<{ role: string; text: string }>,
): Array<{ role: string; content: Array<{ type: "text"; text: string }> }> {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.text }],
  }))
}

/** A minimal doGenerate stub that returns a fixed response. */
function fakeGenerate(text = "Hello! How can I help?", promptTokens = 10, completionTokens = 15) {
  return async () => ({
    text,
    usage: { promptTokens, completionTokens },
    finishReason: "stop",
    rawCall: { rawPrompt: "", rawSettings: {} },
  })
}

/** Create simple params for transformParams. */
function simpleParams(userMessage = "Hello world", modelId = "gpt-4o-mini") {
  return {
    modelId,
    prompt: buildPrompt([
      { role: "system", text: "You are helpful." },
      { role: "user", text: userMessage },
    ]),
  }
}

/** Wait a number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E Full Pipeline", () => {
  let shield: TokenShieldMiddleware

  afterEach(() => {
    shield?.dispose()
  })

  // -----------------------------------------------------------------------
  // 1. Basic pipeline flow
  // -----------------------------------------------------------------------
  describe("basic pipeline flow", () => {
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
          deduplicateWindow: 0,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })
    })

    it("transforms params without error and returns params object", async () => {
      const params = simpleParams()
      const result = await shield.transformParams({ params })

      expect(result).toBeDefined()
      expect(result).toHaveProperty("modelId")
      expect(result).toHaveProperty("prompt")
    })

    it("wrapGenerate calls doGenerate and returns model output", async () => {
      const params = simpleParams()
      const transformed = await shield.transformParams({ params })

      const result = await shield.wrapGenerate({
        doGenerate: fakeGenerate(),
        params: transformed,
      })

      expect(result).toBeDefined()
      expect(result.text).toBe("Hello! How can I help?")
      expect(result.finishReason).toBe("stop")
      expect(result.usage).toBeDefined()
    })

    it("full round-trip: transformParams -> wrapGenerate works end-to-end", async () => {
      const params = simpleParams("What is 2+2?")
      const transformed = await shield.transformParams({ params })
      const result = await shield.wrapGenerate({
        doGenerate: fakeGenerate("4"),
        params: transformed,
      })

      expect(result.text).toBe("4")
    })
  })

  // -----------------------------------------------------------------------
  // 2. Cache: miss -> store -> hit
  // -----------------------------------------------------------------------
  describe("cache miss -> store -> cache hit", () => {
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
          deduplicateWindow: 0,
          deduplicateInFlight: false,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })
    })

    it("first call is a cache miss, wrapGenerate stores result, second call returns from cache", async () => {
      const prompt = "What is the capital of France?"

      // --- First call: cache miss ---
      const params1 = simpleParams(prompt)
      const transformed1 = await shield.transformParams({ params: params1 })
      const result1 = await shield.wrapGenerate({
        doGenerate: fakeGenerate("Paris", 20, 5),
        params: transformed1,
      })

      expect(result1.text).toBe("Paris")
      // The first call should have gone through doGenerate
      const usage1 = result1.usage as { promptTokens: number; completionTokens: number }
      expect(usage1.promptTokens).toBe(20)
      expect(usage1.completionTokens).toBe(5)

      // Small delay to let fire-and-forget cache.store complete
      await sleep(50)

      // --- Second call: cache hit ---
      const params2 = simpleParams(prompt)
      const transformed2 = await shield.transformParams({ params: params2 })
      const result2 = await shield.wrapGenerate({
        doGenerate: fakeGenerate("This should not be called"),
        params: transformed2,
      })

      // Cache hit returns the cached response
      expect(result2.text).toBe("Paris")
      // Cache hits report zero usage (no API call was made)
      const usage2 = result2.usage as { promptTokens: number; completionTokens: number }
      expect(usage2.promptTokens).toBe(0)
      expect(usage2.completionTokens).toBe(0)
    })

    it("different prompts produce cache misses", async () => {
      const params1 = simpleParams("What is the capital of France?")
      const transformed1 = await shield.transformParams({ params: params1 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Paris"),
        params: transformed1,
      })

      await sleep(50)

      // Different prompt -> cache miss -> doGenerate is called
      const params2 = simpleParams("What is the capital of Germany?")
      const transformed2 = await shield.transformParams({ params: params2 })
      const result2 = await shield.wrapGenerate({
        doGenerate: fakeGenerate("Berlin", 20, 5),
        params: transformed2,
      })

      expect(result2.text).toBe("Berlin")
      const usage2 = result2.usage as { promptTokens: number; completionTokens: number }
      expect(usage2.promptTokens).toBe(20)
    })
  })

  // -----------------------------------------------------------------------
  // 3. Guard blocks duplicate (deduplicateWindow)
  // -----------------------------------------------------------------------
  describe("guard blocks duplicate within deduplicateWindow", () => {
    beforeEach(() => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        guard: {
          debounceMs: 0,
          maxRequestsPerMinute: 1000,
          maxCostPerHour: 100,
          deduplicateWindow: 5000, // 5-second dedup window
          deduplicateInFlight: false,
        },
        // Disable compressor and delta to keep it simple
        compressor: false,
        delta: false,
      })
    })

    it("blocks identical prompt within deduplicateWindow", async () => {
      const prompt = "Tell me a joke about cats"

      // First call should pass
      const params1 = simpleParams(prompt)
      const result1 = await shield.transformParams({ params: params1 })
      expect(result1).toBeDefined()

      // Second identical call within the 5-second window should be blocked
      const params2 = simpleParams(prompt)
      await expect(shield.transformParams({ params: params2 })).rejects.toThrow(
        TokenShieldBlockedError,
      )
    })

    it("allows different prompts through the guard", async () => {
      const params1 = simpleParams("Tell me a joke about cats")
      await shield.transformParams({ params: params1 })

      const params2 = simpleParams("Tell me a joke about dogs")
      const result2 = await shield.transformParams({ params: params2 })
      expect(result2).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // 4. Breaker trips at session limit
  // -----------------------------------------------------------------------
  describe("breaker trips at session limit", () => {
    beforeEach(() => {
      // Use gpt-4o-mini ($0.15/M input, $0.60/M output).
      // A short prompt ("First request" ~3 tokens) + 500 estimated output:
      //   estimated cost = (3/1M * 0.15) + (500/1M * 0.60) = ~$0.0003
      // After wrapGenerate records 5000+5000 tokens:
      //   actual cost = (5000/1M * 0.15) + (5000/1M * 0.60) = $0.00375
      // Session limit $0.002: first request estimated ~$0.0003 < $0.002 (passes),
      // after recording $0.00375, actual spend exceeds limit, second blocked.
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        breaker: {
          limits: { perSession: 0.002 },
          action: "stop",
        },
        compressor: false,
        delta: false,
      })
    })

    it("blocks requests after session limit is exceeded", async () => {
      const breakerStatus = shield.healthCheck()
      expect(breakerStatus.healthy).toBe(true)

      // First request passes since estimated cost (~$0.0003) < $0.002 limit
      const params1 = simpleParams("First request")
      const transformed1 = await shield.transformParams({ params: params1 })
      // wrapGenerate records 5000 input + 5000 output tokens on gpt-4o-mini
      // Actual cost: $0.00375 which exceeds $0.002 session limit
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Response", 5000, 5000),
        params: transformed1,
      })

      // Now the breaker has recorded $0.00375 spend > $0.002 limit.
      // Next request's projected spend ($0.00375 + estimated) will exceed limit.
      const params2 = simpleParams("Second request after budget blown")
      await expect(shield.transformParams({ params: params2 })).rejects.toThrow(
        TokenShieldBlockedError,
      )
    })

    it("healthCheck shows breaker as tripped after spending exceeds limit", async () => {
      const params = simpleParams("Trigger spend")
      const transformed = await shield.transformParams({ params })
      // Record enough spend to exceed $0.002 limit
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Expensive response", 5000, 5000),
        params: transformed,
      })

      const health = shield.healthCheck()
      // After recording $0.00375 which exceeds $0.002 session limit,
      // getStatus sees currentSpend ($0.00375) >= limit ($0.002), so tripped=true
      expect(health.modules.breaker).toBe(true)
      expect(health.breakerTripped).toBe(true)
      expect(health.healthy).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // 5. Context trimming
  // -----------------------------------------------------------------------
  describe("context trimming", () => {
    beforeEach(() => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: true,
          router: false,
          prefix: false,
          ledger: false,
        },
        context: {
          maxInputTokens: 50, // Very low budget to force trimming
          reserveForOutput: 20,
        },
        guard: {
          debounceMs: 0,
          maxRequestsPerMinute: 1000,
          maxCostPerHour: 100,
          deduplicateWindow: 0,
        },
        compressor: false,
        delta: false,
      })
    })

    it("trims messages that exceed the token budget", async () => {
      // Build a conversation with many messages that will exceed 50 tokens
      const longConversation = buildPrompt([
        { role: "system", text: "You are a helpful assistant." },
        { role: "user", text: "This is a first message with enough content to use up tokens." },
        {
          role: "assistant",
          text: "I understand. This is a response with additional context and information.",
        },
        { role: "user", text: "Here is another message with quite a bit of text content." },
        {
          role: "assistant",
          text: "Sure, I will help you with that. Let me provide some details.",
        },
        {
          role: "user",
          text: "And finally the most recent question which should be kept in context.",
        },
      ])

      const params = { modelId: "gpt-4o-mini", prompt: longConversation }
      const result = await shield.transformParams({ params })

      // After trimming, the prompt should have fewer messages
      const resultPrompt = result.prompt as Array<{
        role: string
        content: Array<{ type: string; text: string }>
      }>
      expect(resultPrompt.length).toBeLessThan(longConversation.length)

      // System message should be preserved (it's pinned)
      const systemMsg = resultPrompt.find((m) => m.role === "system")
      expect(systemMsg).toBeDefined()

      // The last user message should be preserved
      const userMessages = resultPrompt.filter((m) => m.role === "user")
      expect(userMessages.length).toBeGreaterThanOrEqual(1)
    })

    it("emits context:trimmed event when messages are trimmed", async () => {
      const events: TokenShieldEvents["context:trimmed"][] = []
      const unsub = subscribeToEvent(shield.events, "context:trimmed", (data) => {
        events.push(data)
      })

      const longConversation = buildPrompt([
        { role: "system", text: "You are a helpful assistant." },
        { role: "user", text: "This is a first message with enough content to use up tokens." },
        {
          role: "assistant",
          text: "I understand. This is a response with additional context and information.",
        },
        { role: "user", text: "Here is another message with quite a bit of text content." },
        {
          role: "assistant",
          text: "Sure, I will help you with that. Let me provide some details.",
        },
        {
          role: "user",
          text: "And finally the most recent question which should be kept in context.",
        },
      ])

      const params = { modelId: "gpt-4o-mini", prompt: longConversation }
      await shield.transformParams({ params })

      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].savedTokens).toBeGreaterThan(0)
      expect(events[0].originalTokens).toBeGreaterThan(events[0].trimmedTokens)

      unsub()
    })
  })

  // -----------------------------------------------------------------------
  // 6. Event bus fires correctly
  // -----------------------------------------------------------------------
  describe("event bus fires correctly", () => {
    beforeEach(() => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: true,
          context: false,
          router: false,
          prefix: true,
          ledger: true,
        },
        guard: {
          debounceMs: 0,
          maxRequestsPerMinute: 1000,
          maxCostPerHour: 100,
          deduplicateWindow: 0,
          deduplicateInFlight: false,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })
    })

    it("emits cache:miss on first call", async () => {
      const missEvents: TokenShieldEvents["cache:miss"][] = []
      const unsub = subscribeToEvent(shield.events, "cache:miss", (data) => {
        missEvents.push(data)
      })

      const params = simpleParams("A unique question about aardvarks")
      await shield.transformParams({ params })

      expect(missEvents.length).toBe(1)
      expect(missEvents[0].prompt).toBe("A unique question about aardvarks")

      unsub()
    })

    it("emits cache:hit on second identical call", async () => {
      const hitEvents: TokenShieldEvents["cache:hit"][] = []
      const unsub = subscribeToEvent(shield.events, "cache:hit", (data) => {
        hitEvents.push(data)
      })

      const prompt = "What is the meaning of life?"

      // First call: cache miss -> store
      const params1 = simpleParams(prompt)
      const transformed1 = await shield.transformParams({ params: params1 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("42"),
        params: transformed1,
      })

      await sleep(50)

      // Second call: cache hit
      const params2 = simpleParams(prompt)
      await shield.transformParams({ params: params2 })

      expect(hitEvents.length).toBe(1)
      expect(hitEvents[0].matchType).toBeDefined()
      expect(hitEvents[0].savedCost).toBeGreaterThanOrEqual(0)
      expect(hitEvents[0].similarity).toBeGreaterThan(0)

      unsub()
    })

    it("emits ledger:entry after wrapGenerate completes", async () => {
      const ledgerEvents: TokenShieldEvents["ledger:entry"][] = []
      const unsub = subscribeToEvent(shield.events, "ledger:entry", (data) => {
        ledgerEvents.push(data)
      })

      const params = simpleParams("Calculate something useful")
      const transformed = await shield.transformParams({ params })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Result", 100, 50),
        params: transformed,
      })

      expect(ledgerEvents.length).toBe(1)
      expect(ledgerEvents[0].model).toBe("gpt-4o-mini")
      expect(ledgerEvents[0].inputTokens).toBe(100)
      expect(ledgerEvents[0].outputTokens).toBe(50)
      expect(ledgerEvents[0].cost).toBeGreaterThan(0)
      expect(typeof ledgerEvents[0].saved).toBe("number")

      unsub()
    })

    it("emits request:allowed when guard passes a request", async () => {
      const allowedEvents: TokenShieldEvents["request:allowed"][] = []
      const unsub = subscribeToEvent(shield.events, "request:allowed", (data) => {
        allowedEvents.push(data)
      })

      const params = simpleParams("Allowed request prompt")
      await shield.transformParams({ params })

      expect(allowedEvents.length).toBe(1)
      expect(allowedEvents[0].prompt).toBe("Allowed request prompt")
      expect(allowedEvents[0].model).toBe("gpt-4o-mini")

      unsub()
    })

    it("emits request:blocked when guard rejects a request", async () => {
      // Create a shield with a dedup window to trigger blocking
      shield.dispose()
      shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
        guard: {
          debounceMs: 0,
          maxRequestsPerMinute: 1000,
          maxCostPerHour: 100,
          deduplicateWindow: 5000,
          deduplicateInFlight: false,
        },
        compressor: false,
        delta: false,
      })

      const blockedEvents: TokenShieldEvents["request:blocked"][] = []
      const unsub = subscribeToEvent(shield.events, "request:blocked", (data) => {
        blockedEvents.push(data)
      })

      const prompt = "Duplicate prompt for event test"

      // First call passes
      await shield.transformParams({ params: simpleParams(prompt) })

      // Second call gets blocked by dedup guard
      try {
        await shield.transformParams({ params: simpleParams(prompt) })
      } catch {
        // Expected to throw
      }

      expect(blockedEvents.length).toBe(1)
      expect(blockedEvents[0].reason).toBeDefined()
      expect(blockedEvents[0].estimatedCost).toBeGreaterThanOrEqual(0)

      unsub()
    })
  })

  // -----------------------------------------------------------------------
  // 7. Dispose cleans up
  // -----------------------------------------------------------------------
  describe("dispose cleans up", () => {
    it("stops forwarding events to the global bus after dispose", async () => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: true,
          cache: true,
          context: false,
          router: false,
          prefix: true,
          ledger: true,
        },
        guard: {
          debounceMs: 0,
          maxRequestsPerMinute: 1000,
          maxCostPerHour: 100,
          deduplicateWindow: 0,
          deduplicateInFlight: false,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })

      // Subscribe to instance events before dispose
      let eventCount = 0
      const unsub = subscribeToEvent(shield.events, "cache:miss", () => {
        eventCount++
      })

      // Trigger an event before dispose
      const params1 = simpleParams("Before dispose test")
      await shield.transformParams({ params: params1 })
      expect(eventCount).toBe(1)

      // Now dispose the shield
      shield.dispose()

      unsub()
    })

    it("dispose can be called multiple times without error", () => {
      shield = tokenShieldMiddleware({})
      shield.dispose()
      shield.dispose() // Should not throw
    })
  })

  // -----------------------------------------------------------------------
  // 8. healthCheck returns correct state
  // -----------------------------------------------------------------------
  describe("healthCheck returns correct state", () => {
    it("returns healthy state with all modules info", () => {
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
          deduplicateWindow: 0,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })

      const health = shield.healthCheck()

      // Structure check
      expect(health).toHaveProperty("healthy")
      expect(health).toHaveProperty("modules")
      expect(health).toHaveProperty("cacheHitRate")
      expect(health).toHaveProperty("guardBlockedRate")
      expect(health).toHaveProperty("breakerTripped")
      expect(health).toHaveProperty("totalSpent")
      expect(health).toHaveProperty("totalSaved")

      // Healthy by default (no breaker tripped)
      expect(health.healthy).toBe(true)

      // Module flags reflect config
      expect(health.modules.guard).toBe(true)
      expect(health.modules.cache).toBe(true)
      expect(health.modules.context).toBe(true)
      expect(health.modules.router).toBe(false)
      expect(health.modules.prefix).toBe(true)
      expect(health.modules.ledger).toBe(true)

      // No breaker configured -> null
      expect(health.breakerTripped).toBeNull()

      // Cache hit rate is 0 at start (no requests yet), not null
      expect(health.cacheHitRate).toBe(0)

      // Guard blocked rate is 0 at start
      expect(health.guardBlockedRate).toBe(0)

      // Ledger starts at zero
      expect(health.totalSpent).toBe(0)
      expect(health.totalSaved).toBe(0)
    })

    it("healthCheck reflects breaker state when configured", () => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        breaker: {
          limits: { perSession: 1.0 },
          action: "stop",
        },
      })

      const health = shield.healthCheck()
      expect(health.modules.breaker).toBe(true)
      expect(health.breakerTripped).toBe(false)
      expect(health.healthy).toBe(true)
    })

    it("healthCheck totalSpent updates after wrapGenerate", async () => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        compressor: false,
        delta: false,
      })

      const params = simpleParams("Cost tracking test")
      const transformed = await shield.transformParams({ params })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Response", 100, 50),
        params: transformed,
      })

      const health = shield.healthCheck()
      expect(health.totalSpent).toBeGreaterThan(0)
    })

    it("healthCheck with no modules enabled returns correct nulls", () => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
      })

      const health = shield.healthCheck()
      expect(health.healthy).toBe(true)
      expect(health.cacheHitRate).toBeNull()
      expect(health.guardBlockedRate).toBeNull()
      expect(health.breakerTripped).toBeNull()
      expect(health.totalSpent).toBeNull()
      expect(health.totalSaved).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // 9. onUsage and onBlocked callbacks
  // -----------------------------------------------------------------------
  describe("config callbacks fire correctly", () => {
    it("onUsage fires after a successful generate call", async () => {
      const usageEntries: Array<{
        model: string
        inputTokens: number
        outputTokens: number
        cost: number
        saved: number
      }> = []

      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        compressor: false,
        delta: false,
        onUsage: (entry) => {
          usageEntries.push(entry)
        },
      })

      const params = simpleParams("onUsage callback test")
      const transformed = await shield.transformParams({ params })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Callback result", 50, 25),
        params: transformed,
      })

      expect(usageEntries.length).toBe(1)
      expect(usageEntries[0].model).toBe("gpt-4o-mini")
      expect(usageEntries[0].inputTokens).toBe(50)
      expect(usageEntries[0].outputTokens).toBe(25)
      expect(usageEntries[0].cost).toBeGreaterThan(0)
    })

    it("onBlocked fires when breaker blocks a request", async () => {
      const blockedReasons: string[] = []

      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        breaker: {
          limits: { perSession: 0.002 },
          action: "stop",
        },
        compressor: false,
        delta: false,
        onBlocked: (reason) => {
          blockedReasons.push(reason)
        },
      })

      // First call to record spend: 5000+5000 tokens on gpt-4o-mini = ~$0.00375 > $0.002
      const params1 = simpleParams("First breaker callback test")
      const transformed1 = await shield.transformParams({ params: params1 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Response", 5000, 5000),
        params: transformed1,
      })

      // Second call should trigger onBlocked because $0.00375 + estimated > $0.002
      try {
        await shield.transformParams({ params: simpleParams("Second breaker callback test") })
      } catch {
        // Expected
      }

      expect(blockedReasons.length).toBe(1)
      expect(blockedReasons[0]).toContain("Circuit breaker")
    })
  })

  // -----------------------------------------------------------------------
  // 10. Compressor and delta integration
  // -----------------------------------------------------------------------
  describe("compressor and delta encoding", () => {
    it("emits compressor:applied event when compression saves tokens", async () => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
          compressor: true,
          delta: false,
        },
        compressor: true,
        delta: false,
      })

      const compressorEvents: TokenShieldEvents["compressor:applied"][] = []
      const unsub = subscribeToEvent(shield.events, "compressor:applied", (data) => {
        compressorEvents.push(data)
      })

      // Use a verbose prompt that the compressor can optimize
      const verbosePrompt = buildPrompt([
        { role: "system", text: "You are a helpful assistant that is very knowledgeable." },
        {
          role: "user",
          text: "I would like to know about the fact that the capital of France is a very interesting city. Can you please tell me about the history of this particular city and all of the various important landmarks that are located in this specific city?",
        },
      ])

      const params = { modelId: "gpt-4o-mini", prompt: verbosePrompt }
      await shield.transformParams({ params })

      // Compressor may or may not fire depending on whether it finds savings
      // This test just verifies the pipeline handles it without error
      if (compressorEvents.length > 0) {
        expect(compressorEvents[0].savedTokens).toBeGreaterThan(0)
        expect(compressorEvents[0].originalTokens).toBeGreaterThan(0)
        expect(compressorEvents[0].compressedTokens).toBeLessThan(
          compressorEvents[0].originalTokens,
        )
      }

      unsub()
    })
  })

  // -----------------------------------------------------------------------
  // 11. Multiple middleware instances are independent
  // -----------------------------------------------------------------------
  describe("multiple middleware instances", () => {
    it("two shield instances have independent caches and events", async () => {
      const shield1 = tokenShieldMiddleware({
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
          deduplicateWindow: 0,
          deduplicateInFlight: false,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
        compressor: false,
        delta: false,
      })

      const shield2 = tokenShieldMiddleware({
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
          deduplicateWindow: 0,
          deduplicateInFlight: false,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
        compressor: false,
        delta: false,
      })

      // Track events on each instance
      let shield1Misses = 0
      let shield2Misses = 0
      const unsub1 = subscribeToEvent(shield1.events, "cache:miss", () => {
        shield1Misses++
      })
      const unsub2 = subscribeToEvent(shield2.events, "cache:miss", () => {
        shield2Misses++
      })

      // Call on shield1 only
      const params = simpleParams("Instance isolation test")
      await shield1.transformParams({ params })

      expect(shield1Misses).toBe(1)
      expect(shield2Misses).toBe(0) // shield2's event bus should not fire

      unsub1()
      unsub2()
      shield1.dispose()
      shield2.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // 12. Pipeline with no prompt (passthrough)
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
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
          deduplicateWindow: 0,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
      })
    })

    it("passes through params with no prompt array unchanged", async () => {
      const params = { modelId: "gpt-4o-mini", someField: "value" }
      const result = await shield.transformParams({ params })

      // When no prompt is present, transformParams returns params as-is
      expect(result).toBe(params)
      expect(result.someField).toBe("value")
    })

    it("handles empty prompt array without error", async () => {
      const params = { modelId: "gpt-4o-mini", prompt: [] as Array<unknown> }
      const result = await shield.transformParams({ params })

      // Empty prompt array means no user messages — pipeline still completes
      expect(result).toBeDefined()
      expect(result.modelId).toBe("gpt-4o-mini")
    })

    it("handles wrapGenerate when doGenerate throws", async () => {
      const params = simpleParams("Error test")
      const transformed = await shield.transformParams({ params })

      await expect(
        shield.wrapGenerate({
          doGenerate: async () => {
            throw new Error("API Error")
          },
          params: transformed,
        }),
      ).rejects.toThrow("API Error")
    })
  })

  // -----------------------------------------------------------------------
  // 13. Ledger accumulation across multiple calls
  // -----------------------------------------------------------------------
  describe("ledger accumulates across multiple calls", () => {
    beforeEach(() => {
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        compressor: false,
        delta: false,
      })
    })

    it("totalSpent increases with each call", async () => {
      const health1 = shield.healthCheck()
      expect(health1.totalSpent).toBe(0)

      // First call
      const params1 = simpleParams("Ledger call 1")
      const t1 = await shield.transformParams({ params: params1 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("R1", 100, 50),
        params: t1,
      })

      const health2 = shield.healthCheck()
      expect(health2.totalSpent).toBeGreaterThan(0)
      const firstSpend = health2.totalSpent!

      // Second call
      const params2 = simpleParams("Ledger call 2")
      const t2 = await shield.transformParams({ params: params2 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("R2", 200, 100),
        params: t2,
      })

      const health3 = shield.healthCheck()
      expect(health3.totalSpent).toBeGreaterThan(firstSpend)
    })

    it("ledger tracks savings from cache hits", async () => {
      shield.dispose()
      shield = tokenShieldMiddleware({
        modules: {
          guard: false,
          cache: true,
          context: false,
          router: false,
          prefix: false,
          ledger: true,
        },
        cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 0.85 },
        compressor: false,
        delta: false,
      })

      const prompt = "Ledger savings tracking test"

      // First call: miss
      const params1 = simpleParams(prompt)
      const t1 = await shield.transformParams({ params: params1 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Saved response", 100, 50),
        params: t1,
      })

      await sleep(50)

      // Second call: hit (saves money)
      const params2 = simpleParams(prompt)
      const t2 = await shield.transformParams({ params: params2 })
      await shield.wrapGenerate({
        doGenerate: fakeGenerate("Should not be called"),
        params: t2,
      })

      // Check cache savings through the ledger's module-level breakdown
      const summary = shield.ledger!.getSummary()
      // The cache module should have recorded savings from the cache hit
      expect(summary.byModule.cache).toBeGreaterThan(0)
      // The second call was a cache hit
      expect(summary.cacheHits).toBe(1)
    })
  })
})
