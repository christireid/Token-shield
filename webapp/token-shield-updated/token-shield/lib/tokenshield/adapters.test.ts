/**
 * Framework-Agnostic Adapters Tests
 *
 * Tests for createGenericAdapter, createOpenAIAdapter,
 * createAnthropicAdapter, and createStreamAdapter.
 */

import { describe, it, expect, vi } from "vitest"
import { tokenShieldMiddleware } from "./middleware"
import {
  createGenericAdapter,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createStreamAdapter,
} from "./adapters"

/**
 * Create a minimal TokenShield instance with all modules disabled
 * to isolate adapter behavior from middleware pipeline logic.
 */
function createMinimalShield() {
  return tokenShieldMiddleware({
    modules: {
      guard: false,
      cache: false,
      context: false,
      router: false,
      prefix: false,
      ledger: false,
    },
  })
}

describe("createGenericAdapter", () => {
  it("calls the underlying function and returns the result", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({
      text: "Hello!",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
    })

    const call = createGenericAdapter(shield, callFn, { modelId: "gpt-4o-mini" })
    const result = await call({
      messages: [{ role: "user", content: "Hi" }],
    })

    expect(callFn).toHaveBeenCalledOnce()
    expect(result).toHaveProperty("text", "Hello!")
    shield.dispose()
  })

  it("uses the modelId from options", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    })

    const call = createGenericAdapter(shield, callFn, { modelId: "gpt-4o-mini" })
    await call({ messages: [{ role: "user", content: "test" }] })

    // The callFn should receive params that include the modelId
    const calledParams = callFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("gpt-4o-mini")
    shield.dispose()
  })

  it("allows per-call modelId override", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    })

    const call = createGenericAdapter(shield, callFn, { modelId: "gpt-4o-mini" })
    await call({
      modelId: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    })

    const calledParams = callFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("gpt-4o")
    shield.dispose()
  })

  it("propagates errors from the callFn", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockRejectedValue(new Error("API error"))

    const call = createGenericAdapter(shield, callFn, { modelId: "gpt-4o-mini" })
    await expect(
      call({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("API error")
    shield.dispose()
  })

  it("passes extra params through", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    })

    const call = createGenericAdapter(shield, callFn, { modelId: "gpt-4o-mini" })
    await call({
      messages: [{ role: "user", content: "test" }],
      temperature: 0.5,
    })

    const calledParams = callFn.mock.calls[0][0]
    expect(calledParams.temperature).toBe(0.5)
    shield.dispose()
  })
})

describe("createOpenAIAdapter", () => {
  it("converts messages and normalises OpenAI response shape", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Hello from OpenAI!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 15, completion_tokens: 8 },
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o-mini" })
    const result = await chat({
      messages: [{ role: "user", content: "Hello" }],
    })

    expect(result).toHaveProperty("text", "Hello from OpenAI!")
    expect(result).toHaveProperty("rawResponse")
    expect(createFn).toHaveBeenCalledOnce()
    shield.dispose()
  })

  it("sends messages in OpenAI format (role + content strings)", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o-mini" })
    await chat({
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.model).toBe("gpt-4o-mini")
    expect(calledParams.messages).toBeDefined()
    expect(Array.isArray(calledParams.messages)).toBe(true)
    // Messages should be in flat format (role + content string)
    for (const msg of calledParams.messages) {
      expect(typeof msg.role).toBe("string")
      expect(typeof msg.content).toBe("string")
    }
    shield.dispose()
  })

  it("uses per-call model override", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o-mini" })
    await chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "test" }],
    })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.model).toBe("gpt-4o")
    shield.dispose()
  })

  it("handles missing usage gracefully", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "no usage" } }],
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o-mini" })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toHaveProperty("text", "no usage")
    shield.dispose()
  })
})

describe("createAnthropicAdapter", () => {
  it("converts messages and normalises Anthropic response shape", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Hello from Claude!" }],
      usage: { input_tokens: 12, output_tokens: 6 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 1024,
    })
    const result = await chat({
      messages: [{ role: "user", content: "Hello" }],
    })

    expect(result).toHaveProperty("text", "Hello from Claude!")
    expect(result).toHaveProperty("rawResponse")
    expect(createFn).toHaveBeenCalledOnce()
    shield.dispose()
  })

  it("separates system messages into top-level system param", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    await chat({
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.system).toBe("You are helpful")
    // Non-system messages should not include system messages
    const msgs = calledParams.messages as Array<{ role: string }>
    expect(msgs.every((m) => m.role !== "system")).toBe(true)
    shield.dispose()
  })

  it("includes max_tokens parameter", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 2048,
    })
    await chat({
      messages: [{ role: "user", content: "test" }],
    })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.max_tokens).toBe(2048)
    shield.dispose()
  })

  it("allows per-call max_tokens override", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultMaxTokens: 1024,
    })
    await chat({
      messages: [{ role: "user", content: "test" }],
      max_tokens: 4096,
    })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.max_tokens).toBe(4096)
    shield.dispose()
  })

  it("handles empty content array", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    })

    const chat = createAnthropicAdapter(shield, createFn)
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toHaveProperty("text", "")
    shield.dispose()
  })
})

describe("createStreamAdapter", () => {
  it("returns a ReadableStream", async () => {
    const shield = createMinimalShield()
    const streamFn = vi.fn().mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "Hello" })
          controller.close()
        },
      })
    )

    const stream = createStreamAdapter(shield, streamFn, { modelId: "gpt-4o-mini" })
    const result = await stream({
      messages: [{ role: "user", content: "Hi" }],
    })

    expect(result).toBeInstanceOf(ReadableStream)
    shield.dispose()
  })

  it("uses the modelId from options", async () => {
    const shield = createMinimalShield()
    const streamFn = vi.fn().mockResolvedValue(
      new ReadableStream({ start(c) { c.close() } })
    )

    const stream = createStreamAdapter(shield, streamFn, { modelId: "gpt-4o-mini" })
    await stream({
      messages: [{ role: "user", content: "test" }],
    })

    const calledParams = streamFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("gpt-4o-mini")
    shield.dispose()
  })

  it("propagates stream errors", async () => {
    const shield = createMinimalShield()
    const streamFn = vi.fn().mockRejectedValue(new Error("Stream error"))

    const stream = createStreamAdapter(shield, streamFn, { modelId: "gpt-4o-mini" })
    await expect(
      stream({ messages: [{ role: "user", content: "test" }] })
    ).rejects.toThrow("Stream error")
    shield.dispose()
  })
})
