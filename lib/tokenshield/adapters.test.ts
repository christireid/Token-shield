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
  type AdapterMessage,
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
    // Generic adapter now returns the raw result
    expect(result).toEqual({
      text: "Hello!",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
    })
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
    await expect(call({ messages: [{ role: "user", content: "test" }] })).rejects.toThrow(
      "API error",
    )
    shield.dispose()
  })

  it("passes extra params through", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({
      text: "ok",
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: "stop",
    })

    // Explicitly type the generic to allow 'temperature'
    const call = createGenericAdapter<
      { messages: AdapterMessage[]; modelId?: string; temperature?: number },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    >(shield, callFn, { modelId: "gpt-4o-mini" })

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
    const result = (await chat({
      messages: [{ role: "user", content: "Hello" }],
    })) as { choices: { message: { content: string } }[] }

    // Expect raw OpenAI response, not normalized shape
    expect(result.choices[0].message.content).toBe("Hello from OpenAI!")
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
    const result = (await chat({
      messages: [{ role: "user", content: "test" }],
    })) as { choices: { message: { content: string } }[] }

    expect(result.choices[0].message.content).toBe("no usage")
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
    const result = (await chat({
      messages: [{ role: "user", content: "Hello" }],
    })) as { content: { type: string; text: string }[] }

    // Expect raw Anthropic response
    expect(result.content[0].text).toBe("Hello from Claude!")
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
    const result = (await chat({
      messages: [{ role: "user", content: "test" }],
    })) as { content: { type: string; text: string }[] }

    // Expect raw result
    expect(result.content).toEqual([])
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
      }),
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
      new ReadableStream({
        start(c) {
          c.close()
        },
      }),
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
    await expect(stream({ messages: [{ role: "user", content: "test" }] })).rejects.toThrow(
      "Stream error",
    )
    shield.dispose()
  })
})

// ---------------------------------------------------------------------------
// Additional branch-coverage tests
// ---------------------------------------------------------------------------

/**
 * Create a mock shield whose transformParams returns the params as-is
 * and whose wrapGenerate / wrapStream execute the provided callback directly.
 * Optionally, transformParams can be overridden to inject custom transformed values.
 */
function createMockShield(overrides?: {
  transformParams?: (args: { params: Record<string, unknown> }) => Promise<Record<string, unknown>>
}) {
  return {
    transformParams:
      overrides?.transformParams ??
      (async ({ params }: { params: Record<string, unknown> }) => params),
    wrapGenerate: async ({
      doGenerate,
    }: {
      doGenerate: () => Promise<Record<string, unknown>>
      params: Record<string, unknown>
    }) => doGenerate(),
    wrapStream: async ({
      doStream,
    }: {
      doStream: () => Promise<{ stream: ReadableStream }>
      params: Record<string, unknown>
    }) => doStream(),
    dispose: () => {},
  } as unknown as ReturnType<typeof tokenShieldMiddleware>
}

describe("fromAiSdkPrompt — non-array / empty content branch", () => {
  it("returns empty string when m.content is not an array (OpenAI adapter)", async () => {
    // Override transformParams to inject a prompt entry where content is a plain string
    // instead of an array, triggering the `""` fallback in fromAiSdkPrompt.
    const shield = createMockShield({
      transformParams: async ({ params }) => ({
        ...params,
        prompt: [
          { role: "user", content: "not-an-array" as unknown }, // content is a string, not array
        ],
      }),
    })

    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o" })
    await chat({ messages: [{ role: "user", content: "Hello" }] })

    const calledParams = createFn.mock.calls[0][0]
    // The message content should be "" because the content was not an array
    expect(calledParams.messages[0].content).toBe("")
  })

  it("returns empty string when m.content is an empty array (OpenAI adapter)", async () => {
    const shield = createMockShield({
      transformParams: async ({ params }) => ({
        ...params,
        prompt: [
          { role: "user", content: [] }, // empty array
        ],
      }),
    })

    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })

    const chat = createOpenAIAdapter(shield, createFn, { defaultModel: "gpt-4o" })
    await chat({ messages: [{ role: "user", content: "Hello" }] })

    const calledParams = createFn.mock.calls[0][0]
    expect(calledParams.messages[0].content).toBe("")
  })

  it("returns empty string when m.content is not an array (Anthropic adapter)", async () => {
    const shield = createMockShield({
      transformParams: async ({ params }) => ({
        ...params,
        prompt: [
          { role: "user", content: 42 as unknown }, // content is a number, not array
        ],
      }),
    })

    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    await chat({ messages: [{ role: "user", content: "Hello" }] })

    const calledParams = createFn.mock.calls[0][0]
    // The non-system message should have content "" since the prompt content was not an array
    expect(calledParams.messages[0].content).toBe("")
  })
})

describe("createGenericAdapter — modelId fallback to 'unknown'", () => {
  it("falls through to 'unknown' when paramModelId is undefined and no options provided", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({ text: "ok" })

    // No options passed at all (no modelId in options)
    const call = createGenericAdapter(shield, callFn)
    await call({ messages: [{ role: "user", content: "test" }] })

    const calledParams = callFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("unknown")
    shield.dispose()
  })

  it("falls through to 'unknown' when paramModelId is undefined and options.modelId is undefined", async () => {
    const shield = createMinimalShield()
    const callFn = vi.fn().mockResolvedValue({ text: "ok" })

    // Pass options but without modelId
    const call = createGenericAdapter(shield, callFn, undefined)
    await call({ messages: [{ role: "user", content: "test" }] })

    const calledParams = callFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("unknown")
    shield.dispose()
  })
})

describe("createAnthropicAdapter — no system messages branch", () => {
  it("does NOT set the system param when there are no system messages", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "response" }],
      usage: { input_tokens: 5, output_tokens: 3 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 512,
    })
    await chat({
      messages: [{ role: "user", content: "Hello, no system message here" }],
    })

    const calledParams = createFn.mock.calls[0][0]
    // The system param should NOT be present
    expect(calledParams.system).toBeUndefined()
    // Only user messages should be in messages
    expect(calledParams.messages).toHaveLength(1)
    expect(calledParams.messages[0].role).toBe("user")
    shield.dispose()
  })
})

describe("createAnthropicAdapter — modelId and max_tokens fallback branches", () => {
  it("uses fallback modelId when transformed.modelId is undefined", async () => {
    // Use a mock shield that strips modelId from transformed params
    const shield = createMockShield({
      transformParams: async ({ params }) => {
        const { modelId: _modelId, ...rest } = params
        return rest // modelId is now undefined in transformed
      },
    })

    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 1024,
    })
    await chat({ messages: [{ role: "user", content: "test" }] })

    const calledParams = createFn.mock.calls[0][0]
    // Should fall back to the local modelId variable ("claude-sonnet-4-20250514")
    expect(calledParams.model).toBe("claude-sonnet-4-20250514")
  })

  it("uses fallback max_tokens when transformed.max_tokens is undefined", async () => {
    // Use a mock shield that strips max_tokens from transformed params
    const shield = createMockShield({
      transformParams: async ({ params }) => {
        const { max_tokens: _max_tokens, ...rest } = params
        return rest // max_tokens is now undefined in transformed
      },
    })

    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
      defaultMaxTokens: 2048,
    })
    await chat({ messages: [{ role: "user", content: "test" }] })

    const calledParams = createFn.mock.calls[0][0]
    // Should fall back to the local maxTokens variable (2048)
    expect(calledParams.max_tokens).toBe(2048)
  })
})

describe("createAnthropicAdapter — undefined content and usage in response", () => {
  it("handles undefined content blocks in the Anthropic response", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      // No 'content' field at all
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    // Should not throw; the adapter handles undefined contentBlocks gracefully
    expect(result).toBeDefined()
    shield.dispose()
  })

  it("handles undefined usage in the Anthropic response", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      // No 'usage' field
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    // Should not throw; the adapter handles undefined usage gracefully
    expect(result).toBeDefined()
    shield.dispose()
  })

  it("handles response with no content, no usage, and no stop_reason", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({})

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeDefined()
    shield.dispose()
  })
})

describe("createStreamAdapter — modelId fallback to 'unknown'", () => {
  it("falls through to 'unknown' when paramModelId is undefined and no options provided", async () => {
    const shield = createMinimalShield()
    const streamFn = vi.fn().mockResolvedValue(
      new ReadableStream({
        start(c) {
          c.close()
        },
      }),
    )

    // No options at all
    const stream = createStreamAdapter(shield, streamFn)
    const result = await stream({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeInstanceOf(ReadableStream)
    const calledParams = streamFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("unknown")
    shield.dispose()
  })

  it("falls through to 'unknown' when paramModelId is undefined and options is undefined", async () => {
    const shield = createMinimalShield()
    const streamFn = vi.fn().mockResolvedValue(
      new ReadableStream({
        start(c) {
          c.close()
        },
      }),
    )

    const stream = createStreamAdapter(shield, streamFn, undefined)
    const result = await stream({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeInstanceOf(ReadableStream)
    const calledParams = streamFn.mock.calls[0][0]
    expect(calledParams.modelId).toBe("unknown")
    shield.dispose()
  })
})

describe("createAnthropicAdapter — transformed.prompt fallback branch", () => {
  it("uses the original prompt when transformed.prompt is undefined", async () => {
    // Mock shield that strips 'prompt' from transformed output
    const shield = createMockShield({
      transformParams: async ({ params }) => {
        const { prompt: _prompt, ...rest } = params
        return rest // prompt is now undefined in transformed
      },
    })

    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    await chat({
      messages: [{ role: "user", content: "Hello from fallback test" }],
    })

    const calledParams = createFn.mock.calls[0][0]
    // Even without transformed.prompt, the original prompt should be used
    expect(calledParams.messages).toBeDefined()
    expect(calledParams.messages[0].content).toBe("Hello from fallback test")
  })
})

describe("createAnthropicAdapter — content block edge cases", () => {
  it("handles content blocks with undefined text (b.text ?? '')", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text" /* text is undefined */ }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeDefined()
    shield.dispose()
  })

  it("handles content blocks with undefined type (b.type === undefined)", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ text: "block with no type" /* type is undefined */ }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeDefined()
    shield.dispose()
  })

  it("handles usage with missing output_tokens", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 5 /* output_tokens is missing */ },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeDefined()
    shield.dispose()
  })

  it("handles usage with missing input_tokens", async () => {
    const shield = createMinimalShield()
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { output_tokens: 3 /* input_tokens is missing */ },
      stop_reason: "end_turn",
    })

    const chat = createAnthropicAdapter(shield, createFn, {
      defaultModel: "claude-sonnet-4-20250514",
    })
    const result = await chat({
      messages: [{ role: "user", content: "test" }],
    })

    expect(result).toBeDefined()
    shield.dispose()
  })
})
