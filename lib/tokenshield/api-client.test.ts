/**
 * API Client Tests
 *
 * Tests for the multi-provider LLM API client helpers:
 * callOpenAI, callAnthropic, callGoogle, callLLM,
 * calculateRealCost, detectModelProvider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  callOpenAI,
  callAnthropic,
  callGoogle,
  callLLM,
  calculateRealCost,
  detectModelProvider,
} from "./api-client"

// Mock global fetch
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  }
}

describe("callOpenAI", () => {
  it("sends correct request format", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "Hello!",
        model: "gpt-4o",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        latencyMs: 200,
        id: "chatcmpl-123",
      }),
    )

    const result = await callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/openai",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )
    expect(result.content).toBe("Hello!")
    expect(result.provider).toBe("openai")
    expect(result.usage.input_tokens).toBe(10)
    expect(result.usage.output_tokens).toBe(5)
    expect(result.usage.prompt_tokens).toBe(10)
    expect(result.usage.completion_tokens).toBe(5)
    expect(result.usage.total_tokens).toBe(15)
  })

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: "Rate limit exceeded" }, 429))

    await expect(callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")).rejects.toThrow(
      "Rate limit exceeded",
    )
  })

  it("uses default max_tokens and temperature", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "chatcmpl-456",
      }),
    )

    await callOpenAI([{ role: "user", content: "test" }], "gpt-4o")

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(300)
    expect(body.temperature).toBe(0.7)
  })

  it("passes custom options", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "chatcmpl-789",
      }),
    )

    await callOpenAI([{ role: "user", content: "test" }], "gpt-4o", {
      max_tokens: 1000,
      temperature: 0.2,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(1000)
    expect(body.temperature).toBe(0.2)
  })
})

describe("callAnthropic", () => {
  it("separates system messages", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "Hello from Claude!",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
        latencyMs: 300,
        id: "msg-123",
      }),
    )

    const result = await callAnthropic(
      [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
      "claude-sonnet-4-20250514",
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.system).toBe("You are helpful")
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }])
    expect(result.provider).toBe("anthropic")
    expect(result.usage.input_tokens).toBe(12)
    expect(result.usage.output_tokens).toBe(6)
  })

  it("calls /api/anthropic endpoint", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1 },
        latencyMs: 100,
        id: "msg-456",
      }),
    )

    await callAnthropic([{ role: "user", content: "test" }], "claude-sonnet-4-20250514")

    expect(mockFetch).toHaveBeenCalledWith("/api/anthropic", expect.anything())
  })
})

describe("callGoogle", () => {
  it("returns correct result shape", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "Hello from Gemini!",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
        latencyMs: 150,
        id: "gen-123",
      }),
    )

    const result = await callGoogle([{ role: "user", content: "Hi" }], "gemini-2.0-flash")

    expect(result.content).toBe("Hello from Gemini!")
    expect(result.provider).toBe("google")
    expect(result.usage.input_tokens).toBe(8)
    expect(result.usage.output_tokens).toBe(4)
  })

  it("calls /api/google endpoint", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 1, output_tokens: 1 },
        latencyMs: 100,
        id: "gen-456",
      }),
    )

    await callGoogle([{ role: "user", content: "test" }], "gemini-2.0-flash")

    expect(mockFetch).toHaveBeenCalledWith("/api/google", expect.anything())
  })
})

describe("callLLM", () => {
  it("routes to callOpenAI for openai provider", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "chatcmpl-llm",
      }),
    )

    const result = await callLLM("openai", [{ role: "user", content: "test" }], "gpt-4o")

    expect(result.provider).toBe("openai")
    expect(mockFetch).toHaveBeenCalledWith("/api/openai", expect.anything())
  })

  it("routes to callAnthropic for anthropic provider", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1 },
        latencyMs: 100,
        id: "msg-llm",
      }),
    )

    const result = await callLLM(
      "anthropic",
      [{ role: "user", content: "test" }],
      "claude-sonnet-4-20250514",
    )

    expect(result.provider).toBe("anthropic")
    expect(mockFetch).toHaveBeenCalledWith("/api/anthropic", expect.anything())
  })

  it("routes to callGoogle for google provider", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 1, output_tokens: 1 },
        latencyMs: 100,
        id: "gen-llm",
      }),
    )

    const result = await callLLM("google", [{ role: "user", content: "test" }], "gemini-2.0-flash")

    expect(result.provider).toBe("google")
    expect(mockFetch).toHaveBeenCalledWith("/api/google", expect.anything())
  })
})

describe("calculateRealCost", () => {
  it("calculates correct cost for known OpenAI model", () => {
    const cost = calculateRealCost("gpt-4o", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(2.5)
    expect(cost.outputCost).toBe(10.0)
    expect(cost.totalCost).toBe(12.5)
    expect(cost.provider).toBe("openai")
  })

  it("calculates correct cost for known Anthropic model", () => {
    const cost = calculateRealCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(3.0)
    expect(cost.outputCost).toBe(15.0)
    expect(cost.totalCost).toBe(18.0)
    expect(cost.provider).toBe("anthropic")
  })

  it("calculates correct cost for known Google model", () => {
    const cost = calculateRealCost("gemini-2.0-flash", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(0.1)
    expect(cost.outputCost).toBe(0.4)
    expect(cost.totalCost).toBeCloseTo(0.5)
    expect(cost.provider).toBe("google")
  })

  it("falls back to GPT-4o pricing for unknown models", () => {
    const cost = calculateRealCost("unknown-model-xyz", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(2.5)
    expect(cost.outputCost).toBe(10.0)
    expect(cost.provider).toBe("openai")
  })

  it("handles zero tokens", () => {
    const cost = calculateRealCost("gpt-4o", 0, 0)
    expect(cost.totalCost).toBe(0)
  })

  it("uses prefix matching for versioned models", () => {
    const cost = calculateRealCost("gpt-4o-2024-11-20", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(2.5)
    expect(cost.outputCost).toBe(10.0)
    expect(cost.provider).toBe("openai")
  })
})

describe("detectModelProvider", () => {
  it("detects OpenAI models", () => {
    expect(detectModelProvider("gpt-4o")).toBe("openai")
    expect(detectModelProvider("gpt-4o-mini")).toBe("openai")
    expect(detectModelProvider("gpt-3.5-turbo")).toBe("openai")
  })

  it("detects Anthropic models", () => {
    expect(detectModelProvider("claude-sonnet-4-20250514")).toBe("anthropic")
    expect(detectModelProvider("claude-3-haiku")).toBe("anthropic")
  })

  it("detects Google models", () => {
    expect(detectModelProvider("gemini-2.0-flash")).toBe("google")
    expect(detectModelProvider("gemini-1.5-pro")).toBe("google")
  })

  it("defaults to openai for unknown models", () => {
    expect(detectModelProvider("unknown-model")).toBe("openai")
  })
})
