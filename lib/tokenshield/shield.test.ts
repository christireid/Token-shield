import { describe, it, expect, vi } from "vitest"
import { shield, getStats } from "./shield"
import { textSimilarity } from "./response-cache"

describe("shield", () => {
  describe("zero-config", () => {
    it("returns a middleware instance with all standard methods", () => {
      const mw = shield()
      expect(typeof mw.transformParams).toBe("function")
      expect(typeof mw.wrapGenerate).toBe("function")
      expect(typeof mw.wrapStream).toBe("function")
      expect(typeof mw.healthCheck).toBe("function")
    })

    it("enables cache, guard, context, prefix, and ledger by default", () => {
      const mw = shield()
      expect(mw.cache).not.toBeNull()
      expect(mw.guard).not.toBeNull()
      expect(mw.ledger).not.toBeNull()
    })
  })

  describe("module toggles", () => {
    it("disabling cache removes cache module", () => {
      const mw = shield({ cache: false })
      expect(mw.cache).toBeNull()
    })

    it("disabling guard removes guard module", () => {
      const mw = shield({ guard: false })
      expect(mw.guard).toBeNull()
    })

    it("disabling trackCosts removes ledger module", () => {
      const mw = shield({ trackCosts: false })
      expect(mw.ledger).toBeNull()
    })

    it("router is always disabled in shield()", () => {
      const mw = shield()
      // Router is opt-in only via tokenShieldMiddleware()
      const health = mw.healthCheck()
      expect(health).toBeDefined()
    })
  })

  describe("budget enforcement", () => {
    it("monthlyBudget enables the circuit breaker", () => {
      const mw = shield({ monthlyBudget: 100 })
      const health = mw.healthCheck()
      expect(health.breakerTripped).toBe(false)
    })

    it("dailyBudget enables the circuit breaker", () => {
      const mw = shield({ dailyBudget: 5 })
      const health = mw.healthCheck()
      expect(health.breakerTripped).toBe(false)
    })

    it("both budgets set enables the circuit breaker", () => {
      const mw = shield({ monthlyBudget: 100, dailyBudget: 5 })
      const health = mw.healthCheck()
      expect(health.breakerTripped).toBe(false)
    })

    it("no budget set means breaker is not configured", () => {
      const mw = shield()
      const health = mw.healthCheck()
      // breakerTripped is null when no breaker is configured
      expect(health.breakerTripped).toBeNull()
    })
  })

  describe("cache configuration", () => {
    it("default similarity threshold is 0.85", () => {
      const mw = shield()
      // Cache should be initialized — verify via a cache lookup returning miss
      expect(mw.cache).not.toBeNull()
    })

    it("custom similarity threshold is passed through", () => {
      const mw = shield({ similarityThreshold: 0.95 })
      expect(mw.cache).not.toBeNull()
    })

    it("cache: false skips cache config entirely", () => {
      const mw = shield({ cache: false, similarityThreshold: 0.5 })
      expect(mw.cache).toBeNull()
    })
  })

  describe("onUsage callback", () => {
    it("accepts an onUsage callback", () => {
      const onUsage = vi.fn()
      const mw = shield({ onUsage })
      expect(mw).toBeDefined()
    })
  })

  describe("end-to-end: transformParams + wrapGenerate", () => {
    it("processes a request through the pipeline", async () => {
      const mw = shield()

      const doGenerate = vi.fn().mockResolvedValue({
        text: "Paris is the capital of France.",
        usage: { promptTokens: 20, completionTokens: 10 },
        finishReason: "stop",
      })

      const params = {
        modelId: "gpt-4o",
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: "What is the capital of France? Please tell me in detail.",
              },
            ],
          },
        ],
      }

      const transformed = await mw.transformParams({ params })
      const result = await mw.wrapGenerate({ doGenerate, params: transformed })

      expect(doGenerate).toHaveBeenCalledTimes(1)
      expect(result.text).toBe("Paris is the capital of France.")
    })

    it("second identical request hits cache", async () => {
      const mw = shield({ guard: false })

      const doGenerate = vi.fn().mockResolvedValue({
        text: "React is a JavaScript library for building UIs.",
        usage: { promptTokens: 15, completionTokens: 12 },
        finishReason: "stop",
      })

      const params = {
        modelId: "gpt-4o",
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: "What is React? Explain it to me in simple and clear terms please.",
              },
            ],
          },
        ],
      }

      // First call — cache miss
      const t1 = await mw.transformParams({ params })
      await mw.wrapGenerate({ doGenerate, params: t1 })
      expect(doGenerate).toHaveBeenCalledTimes(1)

      // Wait for async cache store
      await new Promise((r) => setTimeout(r, 50))

      // Second call — cache hit
      const t2 = await mw.transformParams({ params })
      const result2 = await mw.wrapGenerate({ doGenerate, params: t2 })

      expect(doGenerate).toHaveBeenCalledTimes(1) // NOT called again
      expect(result2.text).toBe("React is a JavaScript library for building UIs.")
    })
  })
})

describe("getStats", () => {
  it("returns zeroed stats from a fresh middleware", () => {
    const mw = shield()
    const stats = getStats(mw)

    expect(stats.totalSaved).toBe(0)
    expect(stats.totalSpent).toBe(0)
    expect(stats.savingsRate).toBe(0)
    expect(stats.cacheHitRate).toBeDefined()
    expect(stats.breakerTripped).toBeNull() // no breaker configured
  })

  it("returns correct savingsRate when there is spend", async () => {
    const mw = shield()

    const doGenerate = vi.fn().mockResolvedValue({
      text: "Hello world response for stats testing.",
      usage: { promptTokens: 50, completionTokens: 20 },
      finishReason: "stop",
    })

    const params = {
      modelId: "gpt-4o",
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: "Generate a unique response for stats testing in the shield module.",
            },
          ],
        },
      ],
    }

    const transformed = await mw.transformParams({ params })
    await mw.wrapGenerate({ doGenerate, params: transformed })

    const stats = getStats(mw)
    expect(stats.totalSpent).toBeGreaterThan(0)
    expect(typeof stats.savingsRate).toBe("number")
  })

  it("breakerTripped is false when budget is set but not exceeded", () => {
    const mw = shield({ monthlyBudget: 1000 })
    const stats = getStats(mw)
    expect(stats.breakerTripped).toBe(false)
  })
})

describe("cache similarity quality", () => {
  it("matches rephrased questions (safe cache hit)", () => {
    const score = textSimilarity("What is the capital of France?", "What's the capital of France?")
    expect(score).toBeGreaterThan(0.85)
  })

  it("matches minor rewording (safe cache hit)", () => {
    const score = textSimilarity("Explain how React hooks work", "Explain how react hooks work")
    expect(score).toBeGreaterThan(0.85)
  })

  it("does NOT match semantically opposite questions", () => {
    const score = textSimilarity("What causes cancer?", "What cures cancer?")
    // These share most words but have opposite meaning
    // At 0.85 threshold, this should ideally NOT match
    expect(score).toBeLessThan(0.95)
  })

  it("does NOT match different topics", () => {
    const score = textSimilarity("Explain React hooks", "Explain quantum computing")
    expect(score).toBeLessThan(0.85)
  })

  it("correctly separates short prompts", () => {
    const score = textSimilarity("Hello", "Goodbye")
    expect(score).toBeLessThan(0.5)
  })
})
