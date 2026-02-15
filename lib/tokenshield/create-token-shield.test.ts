/**
 * createTokenShield Factory + healthCheck Tests
 *
 * Tests for the quick-start factory and the middleware health check API.
 */

import { describe, it, expect, vi } from "vitest"
import { createTokenShield } from "./create-token-shield"

describe("createTokenShield", () => {
  it("creates a middleware with default chatApp preset", () => {
    const shield = createTokenShield()
    expect(shield).toHaveProperty("transformParams")
    expect(shield).toHaveProperty("wrapGenerate")
    expect(shield).toHaveProperty("wrapStream")
    expect(shield).toHaveProperty("healthCheck")
    expect(shield).toHaveProperty("dispose")
    shield.dispose()
  })

  it("creates middleware with chatApp preset", () => {
    const shield = createTokenShield({ preset: "chatApp" })
    const health = shield.healthCheck()
    expect(health.modules.guard).toBe(true)
    expect(health.modules.cache).toBe(true)
    expect(health.modules.context).toBe(true)
    expect(health.modules.ledger).toBe(true)
    shield.dispose()
  })

  it("creates middleware with apiBackend preset", () => {
    const shield = createTokenShield({ preset: "apiBackend" })
    const health = shield.healthCheck()
    expect(health.modules.guard).toBe(true)
    expect(health.modules.cache).toBe(true)
    expect(health.modules.context).toBe(false)
    expect(health.modules.ledger).toBe(true)
    shield.dispose()
  })

  it("creates middleware with development preset", () => {
    const shield = createTokenShield({ preset: "development" })
    const health = shield.healthCheck()
    expect(health.modules.guard).toBe(false)
    expect(health.modules.cache).toBe(false)
    expect(health.modules.ledger).toBe(true)
    shield.dispose()
  })

  it("creates middleware with custom preset (empty config)", () => {
    const shield = createTokenShield({ preset: "custom" })
    // Custom preset starts with defaults from tokenShieldMiddleware
    expect(shield).toHaveProperty("transformParams")
    shield.dispose()
  })

  it("enables circuit breaker when monthlyBudget is set", () => {
    const shield = createTokenShield({ monthlyBudget: 50 })
    const health = shield.healthCheck()
    expect(health.modules.breaker).toBe(true)
    shield.dispose()
  })

  it("enables circuit breaker when dailyBudget is set", () => {
    const shield = createTokenShield({ dailyBudget: 5 })
    const health = shield.healthCheck()
    expect(health.modules.breaker).toBe(true)
    shield.dispose()
  })

  it("does not enable breaker when no budget is set", () => {
    const shield = createTokenShield({ preset: "chatApp" })
    const health = shield.healthCheck()
    expect(health.modules.breaker).toBe(false)
    shield.dispose()
  })

  it("passes onBlocked callback", async () => {
    const onBlocked = vi.fn()
    const shield = createTokenShield({
      preset: "chatApp",
      monthlyBudget: 0.0000001,
      onBlocked,
    })

    const params = {
      modelId: "gpt-4o-mini",
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    }

    try {
      await shield.transformParams({ params })
    } catch {
      // Breaker should block this
    }
    expect(onBlocked).toHaveBeenCalled()
    shield.dispose()
  })

  it("passes onUsage callback", () => {
    const onUsage = vi.fn()
    const shield = createTokenShield({ onUsage })
    // We just verify it was configured (actual usage is tested in middleware tests)
    expect(shield).toHaveProperty("transformParams")
    shield.dispose()
  })

  it("supports dry-run mode", async () => {
    const dryRunActions: Array<{ module: string; description: string }> = []
    const shield = createTokenShield({
      preset: "chatApp",
      dryRun: true,
      onDryRun: (action) => dryRunActions.push(action),
    })

    const params = {
      modelId: "gpt-4o-mini",
      prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
    }
    await shield.transformParams({ params })
    expect(dryRunActions.length).toBeGreaterThan(0)
    shield.dispose()
  })

  it("allows config overrides that take precedence", () => {
    const shield = createTokenShield({
      preset: "chatApp",
      config: {
        modules: {
          guard: false,
          cache: false,
          context: false,
          router: false,
          prefix: false,
          ledger: false,
        },
      },
    })
    const health = shield.healthCheck()
    expect(health.modules.guard).toBe(false)
    expect(health.modules.cache).toBe(false)
    shield.dispose()
  })
})

describe("healthCheck", () => {
  it("returns correct shape", () => {
    const shield = createTokenShield()
    const health = shield.healthCheck()

    expect(health).toHaveProperty("healthy", true)
    expect(health).toHaveProperty("modules")
    expect(health).toHaveProperty("cacheHitRate")
    expect(health).toHaveProperty("guardBlockedRate")
    expect(health).toHaveProperty("breakerTripped")
    expect(health).toHaveProperty("totalSpent")
    expect(health).toHaveProperty("totalSaved")
    shield.dispose()
  })

  it("reports null for disabled modules", () => {
    const shield = createTokenShield({ preset: "development" })
    const health = shield.healthCheck()
    expect(health.cacheHitRate).toBeNull()
    expect(health.guardBlockedRate).toBeNull()
    expect(health.breakerTripped).toBeNull()
    // Ledger is enabled in dev preset
    expect(health.totalSpent).toBe(0)
    expect(health.totalSaved).toBe(0)
    shield.dispose()
  })

  it("reports initial zero values for enabled modules", () => {
    const shield = createTokenShield({ preset: "chatApp" })
    const health = shield.healthCheck()
    expect(health.cacheHitRate).toBe(0)
    expect(typeof health.guardBlockedRate).toBe("number")
    expect(health.totalSpent).toBe(0)
    expect(health.totalSaved).toBe(0)
    shield.dispose()
  })
})
