import { describe, it, expect } from "vitest"
import { createShield, shield } from "../core/shield"

describe("createShield", () => {
  it("creates a shield with default options", () => {
    const s = createShield()
    expect(s).toBeDefined()
    expect(typeof s.process).toBe("function")
    expect(typeof s.record).toBe("function")
    expect(typeof s.reset).toBe("function")
    expect(s.stats).toBeDefined()
  })

  it("processes messages and returns ProcessResult", () => {
    const s = createShield()
    const result = s.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    })
    expect(result.cached).toBeNull()
    expect(result.messages).toHaveLength(1)
  })

  it("caches responses and returns hits", () => {
    const s = createShield({ cache: true, compression: false })

    // First call — miss
    const r1 = s.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    })
    expect(r1.cached).toBeNull()

    // Record response
    s.record({
      model: "gpt-4o",
      prompt: "What is TypeScript?",
      response: "TypeScript is a typed superset of JavaScript.",
      inputTokens: 10,
      outputTokens: 20,
    })

    // Second call — hit
    const r2 = s.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    })
    expect(r2.cached).not.toBeNull()
    expect(r2.cached?.response).toBe("TypeScript is a typed superset of JavaScript.")
    expect(r2.cached?.matchType).toBe("exact")
  })

  it("does not contaminate cache across models", () => {
    const s = createShield({ cache: true, compression: false })

    s.record({
      model: "gpt-4o",
      prompt: "What is TypeScript?",
      response: "GPT-4o says TS is...",
      inputTokens: 10,
      outputTokens: 20,
    })

    const result = s.process({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    })
    expect(result.cached).toBeNull()
  })

  it("applies compression when enabled", () => {
    const s = createShield({ cache: false, compression: true })
    const result = s.process({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: "Please kindly analyze the following text. It is important to note that the text contains several verbose phrases. In order to achieve the best results, you should carefully consider each and every word. Furthermore, it should be noted that the text is quite long.",
      }],
    })
    // May or may not compress depending on savings threshold
    expect(result.messages).toBeDefined()
    expect(result.originalTokens).toBeGreaterThan(0)
  })

  it("tracks stats correctly", () => {
    const s = createShield({ cache: true, compression: false })

    s.process({ model: "gpt-4o", messages: [{ role: "user", content: "q1" }] })
    s.record({ model: "gpt-4o", prompt: "q1", response: "r1", inputTokens: 10, outputTokens: 20 })
    s.process({ model: "gpt-4o", messages: [{ role: "user", content: "q1" }] }) // hit
    s.process({ model: "gpt-4o", messages: [{ role: "user", content: "q2" }] }) // miss

    const stats = s.stats
    expect(stats.requests).toBe(3)
    expect(stats.cacheHits).toBe(1)
    expect(stats.cacheMisses).toBe(2)
    expect(stats.totalInputTokens).toBe(10)
    expect(stats.totalOutputTokens).toBe(20)
  })

  it("reset clears everything", () => {
    const s = createShield()
    s.process({ model: "gpt-4o", messages: [{ role: "user", content: "test" }] })
    s.record({ model: "gpt-4o", prompt: "test", response: "resp", inputTokens: 5, outputTokens: 10 })
    s.reset()

    expect(s.stats.requests).toBe(0)
    expect(s.stats.cacheHits).toBe(0)
  })

  it("works with cache disabled", () => {
    const s = createShield({ cache: false })
    const result = s.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    })
    expect(result.cached).toBeNull()
  })

  it("works with compression disabled", () => {
    const s = createShield({ compression: false })
    const result = s.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    })
    expect(result.compressed).toBe(false)
  })

  it("works with cost tracking disabled", () => {
    const s = createShield({ costTracking: false })
    s.record({ model: "gpt-4o", prompt: "q", response: "r", inputTokens: 10, outputTokens: 20 })
    expect(s.stats.totalEstimatedCost).toBe(0)
  })
})

describe("shield alias", () => {
  it("is the same function as createShield", () => {
    expect(shield).toBe(createShield)
  })
})
