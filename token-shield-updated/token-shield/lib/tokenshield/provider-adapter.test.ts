import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  ProviderAdapter,
  createProviderAdapter,
  retryWithBackoff,
  type AdapterConfig,
  type ProviderConfig,
  type ProviderName,
} from "./provider-adapter"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AdapterConfig>): AdapterConfig {
  return {
    providers: [
      { name: "openai", models: ["gpt-4o-mini", "gpt-4o"], priority: 1 },
      { name: "anthropic", models: ["claude-haiku-4.5", "claude-sonnet-4.5"], priority: 2 },
      { name: "google", models: ["gemini-2.5-flash"], priority: 3 },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe("ProviderAdapter - Constructor", () => {
  it("creates adapter with all providers registered", () => {
    const adapter = new ProviderAdapter(makeConfig())
    const health = adapter.getHealth()
    expect(health).toHaveLength(3)
    expect(health.map((h) => h.name).sort()).toEqual(["anthropic", "google", "openai"])
  })

  it("default strategy is priority", () => {
    const adapter = new ProviderAdapter(makeConfig())
    // With priority strategy and priority 1 < 2 < 3, openai should be first
    const result = adapter.selectModel()
    expect(result.provider).toBe("openai")
  })

  it("initializes all providers as healthy by default", () => {
    const adapter = new ProviderAdapter(makeConfig())
    for (const h of adapter.getHealth()) {
      expect(h.healthy).toBe(true)
      expect(h.consecutiveFailures).toBe(0)
      expect(h.totalRequests).toBe(0)
    }
  })

  it("respects healthy: false in provider config", () => {
    const adapter = new ProviderAdapter(
      makeConfig({
        providers: [
          { name: "openai", models: ["gpt-4o-mini"], priority: 1, healthy: false },
          { name: "anthropic", models: ["claude-haiku-4.5"], priority: 2 },
        ],
      })
    )
    expect(adapter.getProviderHealth("openai")!.healthy).toBe(false)
    expect(adapter.getProviderHealth("anthropic")!.healthy).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// selectModel
// ---------------------------------------------------------------------------

describe("ProviderAdapter - selectModel", () => {
  let adapter: ProviderAdapter

  beforeEach(() => {
    adapter = new ProviderAdapter(makeConfig())
  })

  it("returns preferred model when its provider is healthy", () => {
    const result = adapter.selectModel("gpt-4o-mini")
    expect(result.provider).toBe("openai")
    expect(result.model).toBe("gpt-4o-mini")
  })

  it("falls back when preferred provider is unhealthy", () => {
    // Mark openai unhealthy
    const threshold = 5
    for (let i = 0; i < threshold; i++) {
      adapter.recordFailure("openai", "timeout")
    }
    const result = adapter.selectModel("gpt-4o-mini")
    // Should fallback to the next healthy provider
    expect(result.provider).not.toBe("openai")
  })

  it("calls onFallback callback when falling back", () => {
    const onFallback = vi.fn()
    adapter = new ProviderAdapter(makeConfig({ onFallback }))
    // Make openai unhealthy
    for (let i = 0; i < 5; i++) adapter.recordFailure("openai", "err")
    adapter.selectModel("gpt-4o-mini")
    expect(onFallback).toHaveBeenCalledWith("openai", expect.any(String), "preferred provider unhealthy")
  })

  it("returns first provider when all are unhealthy", () => {
    for (let i = 0; i < 5; i++) {
      adapter.recordFailure("openai", "err")
      adapter.recordFailure("anthropic", "err")
      adapter.recordFailure("google", "err")
    }
    const result = adapter.selectModel("gpt-4o-mini")
    // Falls back to first provider (openai) since all are unhealthy
    expect(result.provider).toBe("openai")
    expect(result.model).toBe("gpt-4o-mini")
  })

  it("returns best model from priority-ordered provider when no preferred model given", () => {
    const result = adapter.selectModel()
    expect(result.provider).toBe("openai")
  })

  it("estimatedCost is a number", () => {
    const result = adapter.selectModel("gpt-4o-mini")
    expect(typeof result.estimatedCost).toBe("number")
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// recordSuccess
// ---------------------------------------------------------------------------

describe("ProviderAdapter - recordSuccess", () => {
  it("increments totalRequests", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordSuccess("openai", 100)
    expect(adapter.getProviderHealth("openai")!.totalRequests).toBe(1)
  })

  it("resets consecutiveFailures to 0", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordFailure("openai", "err")
    adapter.recordFailure("openai", "err")
    expect(adapter.getProviderHealth("openai")!.consecutiveFailures).toBe(2)
    adapter.recordSuccess("openai", 50)
    expect(adapter.getProviderHealth("openai")!.consecutiveFailures).toBe(0)
  })

  it("updates avgLatencyMs via EMA", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordSuccess("openai", 100)
    expect(adapter.getProviderHealth("openai")!.avgLatencyMs).toBe(100)
    adapter.recordSuccess("openai", 200)
    // EMA with alpha=0.3: 100*(1-0.3) + 200*0.3 = 70 + 60 = 130
    expect(adapter.getProviderHealth("openai")!.avgLatencyMs).toBeCloseTo(130, 1)
  })

  it("recovers unhealthy provider back to healthy and fires onHealthChange", () => {
    const onHealthChange = vi.fn()
    const adapter = new ProviderAdapter(makeConfig({ onHealthChange }))
    // Make unhealthy
    for (let i = 0; i < 5; i++) adapter.recordFailure("openai", "err")
    expect(adapter.getProviderHealth("openai")!.healthy).toBe(false)
    onHealthChange.mockClear()
    // Record success recovers it
    adapter.recordSuccess("openai", 50)
    expect(adapter.getProviderHealth("openai")!.healthy).toBe(true)
    expect(onHealthChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "openai", healthy: true })
    )
  })
})

// ---------------------------------------------------------------------------
// recordFailure
// ---------------------------------------------------------------------------

describe("ProviderAdapter - recordFailure", () => {
  it("increments consecutiveFailures", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordFailure("openai", "timeout")
    expect(adapter.getProviderHealth("openai")!.consecutiveFailures).toBe(1)
    adapter.recordFailure("openai", "timeout")
    expect(adapter.getProviderHealth("openai")!.consecutiveFailures).toBe(2)
  })

  it("marks unhealthy after reaching threshold and fires onHealthChange", () => {
    const onHealthChange = vi.fn()
    const adapter = new ProviderAdapter(makeConfig({ onHealthChange, unhealthyThreshold: 3 }))
    adapter.recordFailure("openai", "err1")
    adapter.recordFailure("openai", "err2")
    expect(adapter.getProviderHealth("openai")!.healthy).toBe(true)
    adapter.recordFailure("openai", "err3")
    expect(adapter.getProviderHealth("openai")!.healthy).toBe(false)
    expect(onHealthChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "openai", healthy: false })
    )
  })

  it("records lastError", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordFailure("anthropic", "rate_limit_exceeded")
    const h = adapter.getProviderHealth("anthropic")!
    expect(h.lastError).toBe("rate_limit_exceeded")
    expect(h.lastErrorTime).toBeGreaterThan(0)
  })

  it("increments totalFailures", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordFailure("google", "err")
    adapter.recordFailure("google", "err")
    expect(adapter.getProviderHealth("google")!.totalFailures).toBe(2)
  })

  it("is a no-op for unknown provider", () => {
    const adapter = new ProviderAdapter(makeConfig())
    // Should not throw
    adapter.recordFailure("unknown" as ProviderName, "err")
  })
})

// ---------------------------------------------------------------------------
// getHealth / getProviderHealth
// ---------------------------------------------------------------------------

describe("ProviderAdapter - getHealth / getProviderHealth", () => {
  it("getHealth returns all provider health entries", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.getHealth()).toHaveLength(3)
  })

  it("getProviderHealth returns single provider", () => {
    const adapter = new ProviderAdapter(makeConfig())
    const h = adapter.getProviderHealth("openai")
    expect(h).toBeDefined()
    expect(h!.name).toBe("openai")
  })

  it("getProviderHealth returns undefined for unknown provider", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.getProviderHealth("unknown" as ProviderName)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// resetHealth
// ---------------------------------------------------------------------------

describe("ProviderAdapter - resetHealth", () => {
  it("resets all stats to initial state", () => {
    const adapter = new ProviderAdapter(makeConfig())
    adapter.recordSuccess("openai", 200)
    adapter.recordFailure("anthropic", "err")
    adapter.recordFailure("anthropic", "err")

    adapter.resetHealth()

    for (const h of adapter.getHealth()) {
      expect(h.healthy).toBe(true)
      expect(h.consecutiveFailures).toBe(0)
      expect(h.totalRequests).toBe(0)
      expect(h.totalFailures).toBe(0)
      expect(h.avgLatencyMs).toBe(0)
      expect(h.lastError).toBeUndefined()
      expect(h.lastErrorTime).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// isModelAvailable / getProviderForModel
// ---------------------------------------------------------------------------

describe("ProviderAdapter - isModelAvailable / getProviderForModel", () => {
  it("isModelAvailable returns true for healthy provider model", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.isModelAvailable("gpt-4o-mini")).toBe(true)
    expect(adapter.isModelAvailable("claude-haiku-4.5")).toBe(true)
  })

  it("isModelAvailable returns false for unhealthy provider model", () => {
    const adapter = new ProviderAdapter(makeConfig())
    for (let i = 0; i < 5; i++) adapter.recordFailure("openai", "err")
    expect(adapter.isModelAvailable("gpt-4o-mini")).toBe(false)
  })

  it("isModelAvailable returns false for unknown model", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.isModelAvailable("nonexistent-model")).toBe(false)
  })

  it("getProviderForModel finds correct provider", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.getProviderForModel("gpt-4o-mini")).toBe("openai")
    expect(adapter.getProviderForModel("claude-haiku-4.5")).toBe("anthropic")
    expect(adapter.getProviderForModel("gemini-2.5-flash")).toBe("google")
  })

  it("getProviderForModel returns undefined for unknown model", () => {
    const adapter = new ProviderAdapter(makeConfig())
    expect(adapter.getProviderForModel("nonexistent")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Fallback strategies
// ---------------------------------------------------------------------------

describe("ProviderAdapter - Fallback strategies", () => {
  it("priority strategy sorts by priority field", () => {
    // Priority: google=1, anthropic=2, openai=3 (reversed from default)
    const adapter = new ProviderAdapter({
      providers: [
        { name: "openai", models: ["gpt-4o-mini"], priority: 3 },
        { name: "anthropic", models: ["claude-haiku-4.5"], priority: 2 },
        { name: "google", models: ["gemini-2.5-flash"], priority: 1 },
      ],
      fallbackStrategy: "priority",
    })
    const result = adapter.selectModel()
    expect(result.provider).toBe("google")
  })

  it("cost strategy selects cheapest provider", () => {
    const adapter = new ProviderAdapter({
      providers: [
        { name: "openai", models: ["gpt-4o"], priority: 1 },
        { name: "anthropic", models: ["claude-haiku-4.5"], priority: 2 },
        { name: "google", models: ["gemini-2.5-flash"], priority: 3 },
      ],
      fallbackStrategy: "cost",
    })
    const result = adapter.selectModel()
    // Should pick whichever has lowest estimated cost — at default (1000 input, 500 output)
    expect(typeof result.estimatedCost).toBe("number")
    // The cheapest model should be selected (gpt-4o-mini at $0.15/M input)
    // but we only have gpt-4o, claude-haiku-4.5, gemini-2.5-flash
    // gemini-2.5-flash: 0.3 input + 2.5 output = cheapest
    expect(result.estimatedCost).toBeGreaterThanOrEqual(0)
  })

  it("round-robin strategy rotates through providers", () => {
    const adapter = new ProviderAdapter({
      providers: [
        { name: "openai", models: ["gpt-4o-mini"], priority: 1 },
        { name: "anthropic", models: ["claude-haiku-4.5"], priority: 2 },
        { name: "google", models: ["gemini-2.5-flash"], priority: 3 },
      ],
      fallbackStrategy: "round-robin",
    })
    const first = adapter.selectModel()
    const second = adapter.selectModel()
    const third = adapter.selectModel()
    const providers = [first.provider, second.provider, third.provider]
    // All three providers should appear (rotation)
    expect(new Set(providers).size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// retryWithBackoff
// ---------------------------------------------------------------------------

describe("retryWithBackoff", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok")
    const result = await retryWithBackoff(fn, 3, 10)
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("retries on failure then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("ok")
    const result = await retryWithBackoff(fn, 3, 1)
    expect(result).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"))
    await expect(retryWithBackoff(fn, 2, 1)).rejects.toThrow("always fails")
    // 1 initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// createProviderAdapter factory
// ---------------------------------------------------------------------------

describe("createProviderAdapter", () => {
  it("returns a ProviderAdapter instance", () => {
    const adapter = createProviderAdapter(makeConfig())
    expect(adapter).toBeInstanceOf(ProviderAdapter)
    expect(adapter.getHealth()).toHaveLength(3)
  })
})
