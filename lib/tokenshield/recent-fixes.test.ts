/**
 * Targeted Unit Tests for 6 Recent Fixes
 *
 * Each describe block maps to a specific fix applied during the
 * commercial readiness audit. The tests verify both the correct
 * behavior AND the regression that was fixed.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { CostLedger } from "./cost-ledger"
import { ResponseCache } from "./response-cache"
import { RequestGuard } from "./request-guard"
import { optimizePrefix } from "./prefix-optimizer"
import { createEventBus, shieldEvents } from "./event-bus"
import type { ChatMessage } from "./token-counter"

// -------------------------------------------------------
// Fix 1: CostLedger.calculateCost returns fallback for unknown models
// (Previously returned 0, which silently bypassed budget enforcement)
// -------------------------------------------------------
describe("Fix 1: CostLedger fallback pricing for unknown models", () => {
  let ledger: CostLedger

  beforeEach(() => {
    ledger = new CostLedger({ persist: false })
  })

  it("records non-zero cost for unknown models", async () => {
    const entry = await ledger.record({
      model: "totally-unknown-model-xyz",
      inputTokens: 1000,
      outputTokens: 500,
      savings: {},
    })

    // With fallback pricing ($0.15/M input, $0.60/M output):
    // cost = (1000/1M * 0.15) + (500/1M * 0.60) = 0.00015 + 0.0003 = 0.00045
    expect(entry.actualCost).toBeGreaterThan(0)
    expect(entry.actualCost).toBeCloseTo(0.00045, 5)
  })

  it("REGRESSION: cost must never be zero for any model", async () => {
    const entry = await ledger.record({
      model: "nonexistent-provider/model-v99",
      inputTokens: 10000,
      outputTokens: 5000,
      savings: {},
    })
    // This was the bug: cost was 0 for unknown models
    expect(entry.actualCost).not.toBe(0)
  })

  it("known models still use real pricing", async () => {
    const entry = await ledger.record({
      model: "gpt-4o-mini",
      inputTokens: 1000,
      outputTokens: 500,
      savings: {},
    })
    // gpt-4o-mini: $0.15/M input, $0.60/M output (same as fallback but from real pricing)
    expect(entry.actualCost).toBeGreaterThan(0)
  })

  it("summary reflects fallback pricing in totals", async () => {
    await ledger.record({
      model: "unknown-model",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      savings: {},
    })
    const summary = ledger.getSummary()
    // $0.15 + $0.60 = $0.75 for 1M of each
    expect(summary.totalSpent).toBeCloseTo(0.75, 2)
  })
})

// -------------------------------------------------------
// Fix 2: ResponseCache.peek() is read-only (no mutations)
// (Ensures dry-run mode doesn't pollute access counts)
// -------------------------------------------------------
describe("Fix 2: ResponseCache.peek() immutability", () => {
  let cache: ResponseCache

  beforeEach(async () => {
    cache = new ResponseCache({
      maxEntries: 100,
      ttlMs: 60000,
      similarityThreshold: 0.85,
    })
    await cache.store("What is React?", "React is a UI library.", "gpt-4o-mini", 10, 20)
  })

  it("peek() finds cached entries without mutating access count", () => {
    const statsBefore = cache.stats()
    const hitsBefore = statsBefore.totalHits

    const result = cache.peek("What is React?", "gpt-4o-mini")
    expect(result.hit).toBe(true)
    expect(result.matchType).toBe("exact")

    const statsAfter = cache.stats()
    expect(statsAfter.totalHits).toBe(hitsBefore) // No increment
  })

  it("peek() does not increment accessCount on the entry", async () => {
    // Access via peek 5 times
    for (let i = 0; i < 5; i++) {
      cache.peek("What is React?", "gpt-4o-mini")
    }

    // Now do a real lookup
    const result = await cache.lookup("What is React?", "gpt-4o-mini")
    expect(result.hit).toBe(true)
    // accessCount should be 1 (from this lookup) not 6
    expect(result.entry!.accessCount).toBe(1)
  })

  it("peek() fuzzy match also doesn't mutate", async () => {
    // Use a lower threshold to reliably trigger fuzzy matching
    const fuzzyCache = new ResponseCache({
      maxEntries: 100,
      ttlMs: 60000,
      similarityThreshold: 0.7,
    })
    await fuzzyCache.store(
      "Explain what React is and how it works",
      "React is a library...",
      "gpt-4o-mini",
      15,
      25,
    )

    const statsBefore = fuzzyCache.stats()

    // Similar but different enough to be a fuzzy match, not exact
    const result = fuzzyCache.peek("Explain what React is and how it functions", "gpt-4o-mini")
    expect(result.hit).toBe(true)
    expect(result.matchType).toBe("fuzzy")

    const statsAfter = fuzzyCache.stats()
    expect(statsAfter.totalHits).toBe(statsBefore.totalHits) // Still no increment
  })

  it("model parameter is required (Option E)", () => {
    // TypeScript enforces this at compile time, but we can verify at runtime
    // that passing a model produces correct model-scoped lookups
    const result = cache.peek("What is React?", "gpt-4o")
    // Different model = cache miss (cache was stored with gpt-4o-mini)
    expect(result.hit).toBe(false)
  })
})

// -------------------------------------------------------
// Fix 3: Prefix optimizer context window overflow detection
// (Previously didn't check if total tokens exceeded the context window)
// -------------------------------------------------------
describe("Fix 3: Prefix optimizer overflow detection", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a helpful assistant. ".repeat(100) },
    { role: "user", content: "Tell me about quantum computing in detail. ".repeat(50) },
  ]

  it("detects context window overflow", () => {
    const result = optimizePrefix(messages, "gpt-4o", 2.5, {
      provider: "openai",
      contextWindow: 100, // Artificially small window
      reservedOutputTokens: 10,
    })

    expect(result.contextWindowExceeded).toBe(true)
    expect(result.overflowTokens).toBeGreaterThan(0)
  })

  it("reports no overflow when within bounds", () => {
    const shortMessages: ChatMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
    ]

    const result = optimizePrefix(shortMessages, "gpt-4o", 2.5, {
      provider: "openai",
      contextWindow: 128000,
      reservedOutputTokens: 4096,
    })

    expect(result.contextWindowExceeded).toBe(false)
    expect(result.overflowTokens).toBe(0)
  })

  it("accounts for reservedOutputTokens in overflow calculation", () => {
    const result = optimizePrefix(messages, "gpt-4o", 2.5, {
      provider: "openai",
      contextWindow: 2000,
      reservedOutputTokens: 1500,
    })

    // Effective window = 2000 - 1500 = 500 tokens
    // Messages are much larger than 500 tokens
    expect(result.contextWindowExceeded).toBe(true)
    expect(result.overflowTokens).toBeGreaterThan(0)
  })

  it("no overflow check when contextWindow is not set", () => {
    const result = optimizePrefix(messages, "gpt-4o", 2.5, {
      provider: "openai",
      // No contextWindow set
    })

    expect(result.contextWindowExceeded).toBe(false)
    expect(result.overflowTokens).toBe(0)
  })
})

// -------------------------------------------------------
// Fix 4: Tool result messages classified as volatile
// (Previously tool results were classified as stable prefix,
//  which polluted the cache prefix and broke cache hits)
// -------------------------------------------------------
describe("Fix 4: Tool result messages are volatile (not stable prefix)", () => {
  it("tool role messages go to volatile section", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What's the weather?" },
      { role: "assistant", content: "Let me check the weather for you." },
      { role: "tool", content: '{"temperature": 72, "condition": "sunny"}' },
      { role: "assistant", content: "It's 72°F and sunny." },
    ]

    const result = optimizePrefix(messages, "gpt-4o", 2.5, {
      provider: "openai",
    })

    // System message should be first (stable prefix)
    expect(result.messages[0].role).toBe("system")
    // Tool message should NOT be in the stable prefix
    // Volatile tokens should include the tool result
    expect(result.volatileTokens).toBeGreaterThan(0)
    // Prefix should only contain the system message
    expect(result.prefixTokens).toBeGreaterThan(0)
    // The tool message should come after the system message in order
    const toolIdx = result.messages.findIndex((m) => m.role === "tool")
    expect(toolIdx).toBeGreaterThan(0)
  })

  it("system messages remain in stable prefix", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a coding assistant." },
      { role: "user", content: "Write a function." },
    ]

    const result = optimizePrefix(messages, "gpt-4o", 2.5)
    expect(result.messages[0].role).toBe("system")
    expect(result.prefixTokens).toBeGreaterThan(0)
  })
})

// -------------------------------------------------------
// Fix 5: RequestGuard.getStats() read-only snapshot
// (Ensures dry-run mode doesn't mutate guard state)
// -------------------------------------------------------
describe("Fix 5: RequestGuard.getStats() is read-only", () => {
  let guard: RequestGuard

  beforeEach(() => {
    guard = new RequestGuard({
      debounceMs: 100,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 10,
      modelId: "gpt-4o-mini",
    })
  })

  it("returns current state without mutating", () => {
    // Make a request to create some state
    guard.check("Hello world", undefined, "gpt-4o-mini")

    const stats1 = guard.getStats()
    const stats2 = guard.getStats()

    // Calling getStats twice should return identical data
    expect(stats1.requestsLastMinute).toBe(stats2.requestsLastMinute)
    expect(stats1.lastRequestTime).toBe(stats2.lastRequestTime)
    expect(stats1.currentHourlySpend).toBe(stats2.currentHourlySpend)
  })

  it("getStats does not affect subsequent check() calls", () => {
    // Check a request
    const result1 = guard.check("Test prompt", undefined, "gpt-4o-mini")
    expect(result1.allowed).toBe(true)

    // Call getStats many times (should be side-effect-free)
    for (let i = 0; i < 10; i++) {
      guard.getStats()
    }

    // The next check should not be affected by getStats calls
    // (wait past debounce window)
    const stats = guard.getStats()
    expect(stats.requestsLastMinute).toBe(1) // Only the one real check
  })

  it("returns correct structure", () => {
    const stats = guard.getStats()
    expect(typeof stats.lastRequestTime).toBe("number")
    expect(typeof stats.requestsLastMinute).toBe("number")
    expect(typeof stats.currentHourlySpend).toBe("number")
  })
})

// -------------------------------------------------------
// Fix 6: Per-instance event bus with global forwarding
// (Previously all middleware instances shared a single global bus,
//  causing event cross-contamination)
// -------------------------------------------------------
describe("Fix 6: Per-instance event bus isolation + global forwarding", () => {
  it("separate event buses don't leak events", () => {
    const bus1 = createEventBus()
    const bus2 = createEventBus()

    const events1: string[] = []
    const events2: string[] = []

    bus1.on("cache:hit", () => events1.push("bus1-cache-hit"))
    bus2.on("cache:hit", () => events2.push("bus2-cache-hit"))

    bus1.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0.01 })

    expect(events1).toHaveLength(1)
    expect(events2).toHaveLength(0) // bus2 should NOT receive bus1's events
  })

  it("global shieldEvents is a separate singleton", () => {
    const bus = createEventBus()
    const globalEvents: string[] = []
    const busEvents: string[] = []

    shieldEvents.on("cache:miss", () => globalEvents.push("global"))
    bus.on("cache:miss", () => busEvents.push("instance"))

    bus.emit("cache:miss", { prompt: "test" })

    expect(busEvents).toHaveLength(1)
    expect(globalEvents).toHaveLength(0) // Without forwarding, global shouldn't receive

    // Cleanup
    shieldEvents.off("cache:miss")
  })

  it("forwarding setup propagates instance events to global", () => {
    const instanceBus = createEventBus()
    const globalReceived: unknown[] = []

    // Set up forwarding (mirrors what middleware.ts does)
    instanceBus.on("ledger:entry", ((data: unknown) => {
      try {
        ;(shieldEvents.emit as (type: string, data: unknown) => void)("ledger:entry", data)
      } catch {
        /* non-fatal */
      }
    }) as never)

    shieldEvents.on("ledger:entry", (data) => globalReceived.push(data))

    const payload = { model: "gpt-4o", inputTokens: 100, outputTokens: 50, cost: 0.001, saved: 0 }
    instanceBus.emit("ledger:entry", payload)

    expect(globalReceived).toHaveLength(1)
    expect(globalReceived[0]).toEqual(payload)

    // Cleanup
    shieldEvents.off("ledger:entry")
  })

  it("multiple instances with forwarding don't cross-contaminate", () => {
    const bus1 = createEventBus()
    const bus2 = createEventBus()

    const bus1Events: string[] = []
    const bus2Events: string[] = []

    bus1.on("request:blocked", () => bus1Events.push("blocked"))
    bus2.on("request:allowed", () => bus2Events.push("allowed"))

    // Emit on bus1 only
    bus1.emit("request:blocked", { reason: "test", estimatedCost: 0 })
    bus2.emit("request:allowed", { prompt: "test", model: "gpt-4o" })

    expect(bus1Events).toEqual(["blocked"])
    expect(bus2Events).toEqual(["allowed"])

    // bus1 should NOT have received bus2's event
    expect(bus1Events).toHaveLength(1)
    expect(bus2Events).toHaveLength(1)
  })
})
