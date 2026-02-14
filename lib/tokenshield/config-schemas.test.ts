import { describe, it, expect } from "vitest"
import { validateConfig } from "./config-schemas"

describe("validateConfig", () => {
  // -----------------------------------------------------------------------
  // 1. Empty object returns valid default-filled config
  // -----------------------------------------------------------------------
  it("returns a valid default-filled config for an empty object", () => {
    const config = validateConfig({})

    // Top-level optional sections should be undefined when not provided
    expect(config).toBeDefined()
    expect(config).toEqual({})
  })

  // -----------------------------------------------------------------------
  // 2. Accepts valid partial config (guard.debounceMs)
  // -----------------------------------------------------------------------
  it("accepts a valid partial config with guard.debounceMs", () => {
    const config = validateConfig({ guard: { debounceMs: 500 } })

    expect(config.guard).toBeDefined()
    expect(config.guard!.debounceMs).toBe(500)
    // Other guard fields should receive their defaults
    expect(config.guard!.maxRequestsPerMinute).toBe(60)
    expect(config.guard!.maxCostPerHour).toBe(10)
    expect(config.guard!.deduplicateWindow).toBe(5000)
    expect(config.guard!.minInputLength).toBe(2)
  })

  // -----------------------------------------------------------------------
  // 3. Rejects negative debounceMs (minValue: 0)
  // -----------------------------------------------------------------------
  it("throws for guard.debounceMs = -1 (minValue: 0)", () => {
    expect(() => validateConfig({ guard: { debounceMs: -1 } })).toThrow()
  })

  // -----------------------------------------------------------------------
  // 4. Rejects similarityThreshold > 1 (maxValue: 1)
  // -----------------------------------------------------------------------
  it("throws for cache.similarityThreshold = 1.5 (maxValue: 1)", () => {
    expect(() => validateConfig({ cache: { similarityThreshold: 1.5 } })).toThrow()
  })

  // -----------------------------------------------------------------------
  // 5. Accepts valid breaker config with limits and action
  // -----------------------------------------------------------------------
  it("accepts a valid breaker config with limits and action", () => {
    const config = validateConfig({
      breaker: { limits: { perSession: 10 }, action: "stop" },
    })

    expect(config.breaker).toBeDefined()
    expect(config.breaker!.limits.perSession).toBe(10)
    expect(config.breaker!.action).toBe("stop")
    expect(config.breaker!.persist).toBe(false) // default
  })

  // -----------------------------------------------------------------------
  // 6. Rejects invalid breaker action (picklist)
  // -----------------------------------------------------------------------
  it("throws for breaker.action = 'invalid' (not in picklist)", () => {
    expect(() => validateConfig({ breaker: { limits: {}, action: "invalid" } })).toThrow()
  })

  // -----------------------------------------------------------------------
  // 7. Accepts valid userBudget config with users
  // -----------------------------------------------------------------------
  it("accepts a valid userBudget config with per-user limits", () => {
    const config = validateConfig({
      userBudget: {
        users: {
          u1: { daily: 5, monthly: 50 },
        },
      },
    })

    expect(config.userBudget).toBeDefined()
    expect(config.userBudget!.users).toBeDefined()
    expect(config.userBudget!.users!["u1"]).toEqual({
      daily: 5,
      monthly: 50,
    })
    expect(config.userBudget!.persist).toBe(false) // default
  })

  // -----------------------------------------------------------------------
  // 8. Accepts valid prefix config with provider
  // -----------------------------------------------------------------------
  it("accepts a valid prefix config with provider 'openai'", () => {
    const config = validateConfig({ prefix: { provider: "openai" } })

    expect(config.prefix).toBeDefined()
    expect(config.prefix!.provider).toBe("openai")
  })

  // -----------------------------------------------------------------------
  // 9. Accepts valid modules config
  // -----------------------------------------------------------------------
  it("accepts a valid modules config with boolean flags", () => {
    const config = validateConfig({
      modules: { guard: true, cache: false },
    })

    expect(config.modules).toBeDefined()
    expect(config.modules!.guard).toBe(true)
    expect(config.modules!.cache).toBe(false)
  })

  // -----------------------------------------------------------------------
  // 10. Rejects non-object input
  // -----------------------------------------------------------------------
  it('throws for non-object input "not an object"', () => {
    expect(() => validateConfig("not an object")).toThrow()
  })

  // -----------------------------------------------------------------------
  // Additional edge-case tests
  // -----------------------------------------------------------------------

  it("throws for cache.maxEntries = 0 (minValue: 1)", () => {
    expect(() => validateConfig({ cache: { maxEntries: 0 } })).toThrow()
  })

  it("throws for guard.maxRequestsPerMinute = 0 (minValue: 1)", () => {
    expect(() => validateConfig({ guard: { maxRequestsPerMinute: 0 } })).toThrow()
  })

  it("accepts all valid breaker actions", () => {
    for (const action of ["warn", "throttle", "stop"] as const) {
      const config = validateConfig({
        breaker: { limits: {}, action },
      })
      expect(config.breaker!.action).toBe(action)
    }
  })

  it("accepts all valid prefix providers", () => {
    for (const provider of ["openai", "anthropic", "google", "auto"] as const) {
      const config = validateConfig({ prefix: { provider } })
      expect(config.prefix!.provider).toBe(provider)
    }
  })

  it("throws for prefix.provider = 'azure' (not in picklist)", () => {
    expect(() => validateConfig({ prefix: { provider: "azure" } })).toThrow()
  })

  it("accepts userBudget with tier and tierModels", () => {
    const config = validateConfig({
      userBudget: {
        users: {
          u1: { daily: 5, monthly: 50, tier: "premium" },
        },
        tierModels: {
          standard: "gpt-4o-mini",
          premium: "gpt-4o",
        },
      },
    })

    expect(config.userBudget!.users!["u1"].tier).toBe("premium")
    expect(config.userBudget!.tierModels!["premium"]).toBe("gpt-4o")
  })

  it("fills default values for cache config when partially provided", () => {
    const config = validateConfig({ cache: { maxEntries: 100 } })

    expect(config.cache!.maxEntries).toBe(100)
    expect(config.cache!.ttlMs).toBe(3_600_000)
    expect(config.cache!.similarityThreshold).toBe(0.85)
    expect(config.cache!.scopeByModel).toBe(true)
  })

  it("accepts router config with tiers array", () => {
    const config = validateConfig({
      router: {
        tiers: [
          { modelId: "gpt-4o-mini", maxComplexity: 30 },
          { modelId: "gpt-4o", maxComplexity: 70 },
        ],
        complexityThreshold: 40,
      },
    })

    expect(config.router!.tiers).toHaveLength(2)
    expect(config.router!.complexityThreshold).toBe(40)
  })

  it("throws for router.complexityThreshold > 100", () => {
    expect(() => validateConfig({ router: { complexityThreshold: 101 } })).toThrow()
  })

  it("throws for null input", () => {
    expect(() => validateConfig(null)).toThrow()
  })

  it("throws for undefined input", () => {
    expect(() => validateConfig(undefined)).toThrow()
  })

  it("fills ledger defaults correctly", () => {
    const config = validateConfig({ ledger: {} })

    expect(config.ledger!.persist).toBe(false)
    expect(config.ledger!.feature).toBeUndefined()
  })

  it("accepts context config with maxInputTokens", () => {
    const config = validateConfig({
      context: { maxInputTokens: 4096, reserveForOutput: 500 },
    })

    expect(config.context!.maxInputTokens).toBe(4096)
    expect(config.context!.reserveForOutput).toBe(500)
  })

  it("accepts cache.similarityThreshold at boundaries 0 and 1", () => {
    const configZero = validateConfig({ cache: { similarityThreshold: 0 } })
    expect(configZero.cache!.similarityThreshold).toBe(0)

    const configOne = validateConfig({ cache: { similarityThreshold: 1 } })
    expect(configOne.cache!.similarityThreshold).toBe(1)
  })
})
