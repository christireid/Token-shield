import { describe, it, expect, vi } from "vitest"
import { tokenShieldMiddleware, TokenShieldBlockedError } from "./middleware"

/**
 * End-to-end integration test: exercises the entire SDK pipeline.
 * Verifies that all 12 modules work together correctly.
 */
describe("TokenShield E2E", () => {
  const makeParams = (text: string, modelId = "gpt-4o-mini") => ({
    modelId,
    prompt: [{ role: "user", content: [{ type: "text", text }] }],
  })

  const mockDoGenerate = (text = "Response") =>
    vi.fn(async () => ({
      text,
      usage: { promptTokens: 100, completionTokens: 50 },
      finishReason: "stop",
    }))

  it("full pipeline: uncached → cached → budget-blocked", async () => {
    const onUsage = vi.fn()
    const onBlocked = vi.fn()

    // Budget math:
    //   gpt-4o-mini actual cost: 100 input * $0.15/M + 50 output * $0.60/M = $0.000045
    //   gpt-4o-mini estimate in transformParams: ~7 input * $0.15/M + 10 output * $0.60/M ≈ $0.000007
    //   gpt-4o estimate in transformParams: ~8 input * $2.5/M + 10 output * $10/M ≈ $0.00012
    //
    // With daily limit $0.0001:
    //   Request 1 (gpt-4o-mini): projected = 0 + $0.000007 < $0.0001 → passes
    //   After request 1: actual spend = $0.000045
    //   Request 2 (gpt-4o-mini, cached): projected = $0.000045 + $0.000007 = $0.000052 < $0.0001 → passes
    //   Request 3 (gpt-4o, expensive): projected = $0.000045 + $0.00012 = $0.000165 >= $0.0001 → BLOCKED
    const mw = tokenShieldMiddleware({
      modules: {
        guard: true,
        cache: true,
        context: false,
        router: false,
        prefix: false,
        ledger: true,
      },
      guard: { debounceMs: 0, maxRequestsPerMinute: 999, maxCostPerHour: 999 },
      cache: { maxEntries: 100, ttlMs: 60_000, similarityThreshold: 1.0 },
      userBudget: {
        getUserId: () => "e2e-user",
        budgets: {
          users: { "e2e-user": { daily: 0.0001, monthly: 1000 } },
        },
      },
      context: { reserveForOutput: 10 },
      onUsage,
      onBlocked,
    })

    // Request 1: uncached — hits the model, records usage
    const params1 = makeParams("What is the capital of France?")
    const transformed1 = await mw.transformParams({ params: params1 })
    const result1 = await mw.wrapGenerate({
      doGenerate: mockDoGenerate("Paris is the capital of France."),
      params: transformed1 as Record<string, unknown>,
    })
    expect(result1.text).toBe("Paris is the capital of France.")
    expect(onUsage).toHaveBeenCalledTimes(1)
    const firstUsage = onUsage.mock.calls[0][0]
    expect(firstUsage.cost).toBeGreaterThan(0)

    // Request 2: cached — same prompt returns cached response
    const params2 = makeParams("What is the capital of France?")
    const transformed2 = await mw.transformParams({ params: params2 })
    const result2 = await mw.wrapGenerate({
      doGenerate: mockDoGenerate("Should not be called"),
      params: transformed2 as Record<string, unknown>,
    })
    expect(result2.text).toBe("Paris is the capital of France.")
    expect(onUsage).toHaveBeenCalledTimes(2)
    const secondUsage = onUsage.mock.calls[1][0]
    expect(secondUsage.cost).toBe(0) // Cache hit = no cost

    // Request 3: budget exceeded — switching to expensive model (gpt-4o) pushes
    // projected cost past the daily limit after request 1's actual spend
    const params3 = makeParams("What is the capital of Germany?", "gpt-4o")
    await expect(mw.transformParams({ params: params3 })).rejects.toThrow(TokenShieldBlockedError)
    expect(onBlocked).toHaveBeenCalled()

    // Verify ledger state
    const ledger = mw.ledger!
    const summary = ledger.getSummary()
    expect(summary.totalCalls).toBeGreaterThanOrEqual(1)

    // Verify budget state
    const budgetStatus = mw.userBudgetManager!.getStatus("e2e-user")
    expect(budgetStatus.spend.daily).toBeGreaterThan(0)
    expect(budgetStatus.inflight).toBe(0) // All inflight resolved
  })
})
