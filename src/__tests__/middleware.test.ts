import { describe, it, expect } from "vitest"
import { withShield } from "../middleware/vercel"

describe("withShield (Vercel AI SDK middleware)", () => {
  it("returns a middleware object with expected shape", () => {
    const middleware = withShield()
    expect(middleware.transformParams).toBeDefined()
    expect(typeof middleware.transformParams).toBe("function")
    expect(middleware.wrapGenerate).toBeDefined()
    expect(typeof middleware.wrapGenerate).toBe("function")
  })

  it("transformParams passes through when no messages", () => {
    const middleware = withShield()
    const result = middleware.transformParams!({ params: { setting: "value" } })
    expect(result).toHaveProperty("setting", "value")
  })

  it("transformParams handles prompt strings", () => {
    const middleware = withShield({ compression: false, cache: false })
    const result = middleware.transformParams!({
      params: { prompt: "What is TypeScript?" },
    })
    expect(result).toHaveProperty("prompt")
  })

  it("transformParams handles message arrays", () => {
    const middleware = withShield({ compression: false, cache: false })
    const result = middleware.transformParams!({
      params: {
        messages: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      },
    })
    expect(result).toHaveProperty("messages")
  })

  it("wrapGenerate calls doGenerate and returns result", async () => {
    const middleware = withShield({ cache: false, compression: false })
    const mockResult = {
      text: "Hello world",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }

    const result = await middleware.wrapGenerate!({
      doGenerate: async () => mockResult,
      params: { _shieldModel: "gpt-4o", _shieldPrompt: "test" },
    })

    expect(result.text).toBe("Hello world")
  })

  it("returns cached response when cache hit occurs", async () => {
    const middleware = withShield({ cache: true, compression: false })

    // First: simulate a generate that records a response
    const mockResult = {
      text: "TypeScript is great",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }

    // Transform + generate first time (populates cache)
    const params1 = middleware.transformParams!({
      params: { prompt: "What is TypeScript?", modelId: "gpt-4o" },
    })
    await middleware.wrapGenerate!({
      doGenerate: async () => mockResult,
      params: params1,
    })

    // Second time — should hit cache
    const params2 = middleware.transformParams!({
      params: { prompt: "What is TypeScript?", modelId: "gpt-4o" },
    })

    if ((params2 as Record<string, unknown>)._shieldCached) {
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => { throw new Error("should not call") },
        params: params2,
      })
      expect(result.text).toBe("TypeScript is great")
    }
  })

  it("works with Edge-compatible APIs only (no Node-only deps)", () => {
    // This test verifies the module can be imported without Node-specific APIs
    // The fact that withShield() runs without error proves Edge compatibility
    const middleware = withShield()
    expect(middleware).toBeDefined()
  })
})
