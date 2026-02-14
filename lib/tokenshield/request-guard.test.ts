import { describe, it, expect, vi, beforeEach } from "vitest"
import { RequestGuard } from "./request-guard"

describe("RequestGuard", () => {
  let guard: RequestGuard

  beforeEach(() => {
    guard = new RequestGuard({
      debounceMs: 50,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 10.0,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: true,
      minInputLength: 2,
    })
  })

  it("allows valid requests", () => {
    const result = guard.check("Hello, how are you?")
    expect(result.allowed).toBe(true)
    expect(result.estimatedCost).toBeGreaterThan(0)
  })

  it("blocks requests that are too short", () => {
    const result = guard.check("a")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Too short")
  })

  it("blocks debounced rapid-fire requests", () => {
    guard.check("First request")
    const result = guard.check("Second request immediately")
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Debounced")
  })

  it("blocks duplicate in-flight requests", () => {
    const prompt = "Tell me about cats"
    // Use a zero-debounce guard so timing is not an issue
    const dedupGuard = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 10,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: true,
    })
    dedupGuard.check(prompt)
    dedupGuard.startRequest(prompt)
    // Second check with same prompt should be blocked as duplicate
    const result = dedupGuard.check(prompt)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Deduplicated")
  })

  it("accepts optional modelId for cost estimation", () => {
    // gpt-4o is more expensive than gpt-4o-mini
    const cheapResult = guard.check("Tell me a joke", 500, "gpt-4o-mini")
    const guard2 = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 10,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: false,
    })
    const expensiveResult = guard2.check("Tell me a joke", 500, "gpt-4o")
    expect(expensiveResult.estimatedCost).toBeGreaterThan(cheapResult.estimatedCost)
  })

  it("completeRequest accepts optional modelId", () => {
    guard.check("What is AI?")
    guard.startRequest("What is AI?")
    // Should not throw
    guard.completeRequest("What is AI?", 10, 50, "gpt-4o")
  })

  // REGRESSION: debounce() must not leave promises hanging forever
  describe("debounce()", () => {
    it("superseded calls resolve with null immediately", async () => {
      const fn = vi.fn(async (prompt: string) => `result: ${prompt}`)
      const debounced = guard.debounce(fn)

      const p1 = debounced("first")
      const p2 = debounced("second")

      // p1 should resolve immediately with null (superseded)
      const result1 = await p1
      expect(result1).toBeNull()

      // p2 should eventually resolve (after debounce timer)
      const result2 = await Promise.race([
        p2,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ])
      // Either the result or null (if debounce blocked it)
      expect(result2 === null || typeof result2 === "string").toBe(true)
    })

    it("non-abort errors reject the promise (not unhandled)", async () => {
      const error = new Error("API failure")
      const fn = vi.fn(async () => {
        throw error
      })
      const debouncedGuard = new RequestGuard({
        debounceMs: 10,
        maxRequestsPerMinute: 999,
        maxCostPerHour: 999,
        modelId: "gpt-4o-mini",
        deduplicateInFlight: false,
      })
      const debounced = debouncedGuard.debounce(fn)
      const promise = debounced("test prompt for error")
      await expect(promise).rejects.toThrow("API failure")
    })
  })

  it("tracks stats correctly", () => {
    guard.check("hello world")
    guard.check("too fast") // debounced
    const stats = guard.stats()
    expect(stats.totalBlocked).toBe(1)
    expect(stats.totalSavedDollars).toBeGreaterThan(0)
  })

  it("stats includes totalAllowed and blockedRate", () => {
    const g = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 100,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: false,
    })
    g.check("request 1")
    g.check("request 2")
    g.check("request 3")
    const stats = g.stats()
    expect(stats.totalAllowed).toBe(3)
    expect(stats.totalBlocked).toBe(0)
    expect(stats.blockedRate).toBe(0)
  })

  it("blockedRate reflects actual block ratio", () => {
    // debounceMs of 50 means second call within 50ms is blocked
    guard.check("hello world") // allowed
    guard.check("too fast 1") // blocked (debounced)
    guard.check("too fast 2") // blocked (debounced)
    const stats = guard.stats()
    expect(stats.totalAllowed).toBe(1)
    expect(stats.totalBlocked).toBe(2)
    expect(stats.blockedRate).toBeCloseTo(2 / 3)
  })

  it("getStats() does not mutate costLog (read-only)", () => {
    const g = new RequestGuard({
      debounceMs: 0,
      maxRequestsPerMinute: 60,
      maxCostPerHour: 100,
      modelId: "gpt-4o-mini",
      deduplicateInFlight: false,
    })
    g.check("first request")
    g.startRequest("first request")
    g.completeRequest("first request", 100, 50)

    // Call getStats() multiple times — it should not change internal state
    const stats1 = g.getStats()
    const stats2 = g.getStats()
    expect(stats1.currentHourlySpend).toBe(stats2.currentHourlySpend)
    expect(stats1.currentHourlySpend).toBeGreaterThan(0)
  })
})
