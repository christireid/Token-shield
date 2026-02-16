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

// -------------------------------------------------------
// NEW TESTS – improving branch and function coverage
// -------------------------------------------------------

/**
 * Helper: build a mock Response whose .json() rejects (simulates invalid JSON).
 */
function mockInvalidJsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
  }
}

/**
 * Helper: build a mock Response whose first .json() call rejects
 * (used for error paths where the error body itself is invalid JSON).
 */
function mockErrorWithBadJson(status: number) {
  return {
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
  }
}

// -------------------------------------------------------
// callOpenAI – additional branch coverage
// -------------------------------------------------------

describe("callOpenAI – additional branches", () => {
  it("throws TokenShieldAPIError with API_INVALID_RESPONSE when res.json() returns invalid JSON on success", async () => {
    mockFetch.mockResolvedValue(mockInvalidJsonResponse(200))

    await expect(callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")).rejects.toThrow(
      "OpenAI API returned invalid JSON",
    )
  })

  it("falls back to input_tokens / output_tokens when prompt_tokens / completion_tokens are absent", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "Hello!",
        model: "gpt-4o",
        usage: { input_tokens: 20, output_tokens: 10 },
        latencyMs: 150,
        id: "chatcmpl-fallback",
      }),
    )

    const result = await callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")

    expect(result.usage.input_tokens).toBe(20)
    expect(result.usage.output_tokens).toBe(10)
    expect(result.usage.prompt_tokens).toBe(20)
    expect(result.usage.completion_tokens).toBe(10)
    expect(result.usage.total_tokens).toBe(30)
  })

  it("computes total_tokens as sum when total_tokens is absent from response", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 7, completion_tokens: 3 },
        latencyMs: 80,
        id: "chatcmpl-no-total",
      }),
    )

    const result = await callOpenAI([{ role: "user", content: "test" }], "gpt-4o")
    expect(result.usage.total_tokens).toBe(10)
  })

  it("defaults all token counts to 0 when usage is undefined", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        latencyMs: 50,
        id: "chatcmpl-no-usage",
      }),
    )

    const result = await callOpenAI([{ role: "user", content: "test" }], "gpt-4o")
    expect(result.usage.input_tokens).toBe(0)
    expect(result.usage.output_tokens).toBe(0)
    expect(result.usage.total_tokens).toBe(0)
  })

  it("falls back to 'Unknown error' when error response body is invalid JSON", async () => {
    mockFetch.mockResolvedValue(mockErrorWithBadJson(500))

    await expect(callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")).rejects.toThrow(
      "Unknown error",
    )
  })

  it("uses generic error message when error response has no error field", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 502))

    await expect(callOpenAI([{ role: "user", content: "Hi" }], "gpt-4o")).rejects.toThrow(
      "OpenAI API error: 502",
    )
  })

  it("passes AbortSignal to fetch", async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "chatcmpl-signal",
      }),
    )

    await callOpenAI([{ role: "user", content: "test" }], "gpt-4o", {
      signal: controller.signal,
    })

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/openai",
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})

// -------------------------------------------------------
// callAnthropic – additional branch coverage
// -------------------------------------------------------

describe("callAnthropic – additional branches", () => {
  it("sets system to undefined when no system messages are present", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "Hello!",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        latencyMs: 200,
        id: "msg-no-sys",
      }),
    )

    await callAnthropic([{ role: "user", content: "Hi" }], "claude-sonnet-4-20250514")

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.system).toBeUndefined()
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }])
  })

  it("concatenates multiple system messages with newline", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        latencyMs: 200,
        id: "msg-multi-sys",
      }),
    )

    await callAnthropic(
      [
        { role: "system", content: "First instruction" },
        { role: "system", content: "Second instruction" },
        { role: "user", content: "Hi" },
      ],
      "claude-sonnet-4-20250514",
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.system).toBe("First instruction\nSecond instruction")
  })

  it("throws on HTTP error with error message from body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: "Overloaded" }, 529))

    await expect(
      callAnthropic([{ role: "user", content: "Hi" }], "claude-sonnet-4-20250514"),
    ).rejects.toThrow("Overloaded")
  })

  it("falls back to generic error when error response body is invalid JSON", async () => {
    mockFetch.mockResolvedValue(mockErrorWithBadJson(500))

    await expect(
      callAnthropic([{ role: "user", content: "Hi" }], "claude-sonnet-4-20250514"),
    ).rejects.toThrow("Unknown error")
  })

  it("uses generic error message when error body has no error field", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 503))

    await expect(
      callAnthropic([{ role: "user", content: "Hi" }], "claude-sonnet-4-20250514"),
    ).rejects.toThrow("Anthropic API error: 503")
  })

  it("throws TokenShieldAPIError with API_INVALID_RESPONSE when success body is invalid JSON", async () => {
    mockFetch.mockResolvedValue(mockInvalidJsonResponse(200))

    await expect(
      callAnthropic([{ role: "user", content: "Hi" }], "claude-sonnet-4-20250514"),
    ).rejects.toThrow("Anthropic API returned invalid JSON")
  })

  it("passes custom max_tokens, temperature, and signal", async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "msg-opts",
      }),
    )

    await callAnthropic([{ role: "user", content: "test" }], "claude-sonnet-4-20250514", {
      max_tokens: 500,
      temperature: 0.3,
      signal: controller.signal,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(500)
    expect(body.temperature).toBe(0.3)
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/anthropic",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("computes total_tokens as sum when total_tokens is absent from response", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 12, output_tokens: 8 },
        latencyMs: 100,
        id: "msg-no-total",
      }),
    )

    const result = await callAnthropic(
      [{ role: "user", content: "test" }],
      "claude-sonnet-4-20250514",
    )
    expect(result.usage.total_tokens).toBe(20)
    expect(result.usage.prompt_tokens).toBe(12)
    expect(result.usage.completion_tokens).toBe(8)
  })

  it("defaults token counts to 0 when usage is undefined", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        latencyMs: 50,
        id: "msg-no-usage",
      }),
    )

    const result = await callAnthropic(
      [{ role: "user", content: "test" }],
      "claude-sonnet-4-20250514",
    )
    expect(result.usage.input_tokens).toBe(0)
    expect(result.usage.output_tokens).toBe(0)
    expect(result.usage.total_tokens).toBe(0)
  })
})

// -------------------------------------------------------
// callGoogle – additional branch coverage
// -------------------------------------------------------

describe("callGoogle – additional branches", () => {
  it("throws on HTTP error with error message from body", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: "Quota exceeded" }, 429))

    await expect(callGoogle([{ role: "user", content: "Hi" }], "gemini-2.0-flash")).rejects.toThrow(
      "Quota exceeded",
    )
  })

  it("falls back to generic error when error body is invalid JSON", async () => {
    mockFetch.mockResolvedValue(mockErrorWithBadJson(500))

    await expect(callGoogle([{ role: "user", content: "Hi" }], "gemini-2.0-flash")).rejects.toThrow(
      "Unknown error",
    )
  })

  it("uses generic error message when error body has no error field", async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 502))

    await expect(callGoogle([{ role: "user", content: "Hi" }], "gemini-2.0-flash")).rejects.toThrow(
      "Google API error: 502",
    )
  })

  it("throws TokenShieldAPIError with API_INVALID_RESPONSE when success body is invalid JSON", async () => {
    mockFetch.mockResolvedValue(mockInvalidJsonResponse(200))

    await expect(callGoogle([{ role: "user", content: "Hi" }], "gemini-2.0-flash")).rejects.toThrow(
      "Google API returned invalid JSON",
    )
  })

  it("passes custom max_tokens, temperature, and signal", async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "gen-opts",
      }),
    )

    await callGoogle([{ role: "user", content: "test" }], "gemini-2.0-flash", {
      max_tokens: 800,
      temperature: 0.9,
      signal: controller.signal,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(800)
    expect(body.temperature).toBe(0.9)
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/google",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("uses default max_tokens and temperature when no options provided", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "gen-defaults",
      }),
    )

    await callGoogle([{ role: "user", content: "test" }], "gemini-2.0-flash")

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(300)
    expect(body.temperature).toBe(0.7)
  })

  it("computes total_tokens as sum when total_tokens is absent", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 15, output_tokens: 10 },
        latencyMs: 90,
        id: "gen-no-total",
      }),
    )

    const result = await callGoogle([{ role: "user", content: "test" }], "gemini-2.0-flash")
    expect(result.usage.total_tokens).toBe(25)
    expect(result.usage.prompt_tokens).toBe(15)
    expect(result.usage.completion_tokens).toBe(10)
  })

  it("defaults token counts to 0 when usage is undefined", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        latencyMs: 50,
        id: "gen-no-usage",
      }),
    )

    const result = await callGoogle([{ role: "user", content: "test" }], "gemini-2.0-flash")
    expect(result.usage.input_tokens).toBe(0)
    expect(result.usage.output_tokens).toBe(0)
    expect(result.usage.total_tokens).toBe(0)
  })
})

// -------------------------------------------------------
// callLLM – additional branch coverage
// -------------------------------------------------------

describe("callLLM – additional branches", () => {
  it("forwards options to callOpenAI", async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gpt-4o",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "chatcmpl-fwd",
      }),
    )

    await callLLM("openai", [{ role: "user", content: "test" }], "gpt-4o", {
      max_tokens: 600,
      temperature: 0.1,
      signal: controller.signal,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(600)
    expect(body.temperature).toBe(0.1)
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/openai",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("forwards options to callAnthropic", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "msg-fwd",
      }),
    )

    await callLLM("anthropic", [{ role: "user", content: "test" }], "claude-sonnet-4-20250514", {
      max_tokens: 400,
      temperature: 0.5,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(400)
    expect(body.temperature).toBe(0.5)
  })

  it("forwards options to callGoogle", async () => {
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        content: "ok",
        model: "gemini-2.0-flash",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        latencyMs: 100,
        id: "gen-fwd",
      }),
    )

    await callLLM("google", [{ role: "user", content: "test" }], "gemini-2.0-flash", {
      max_tokens: 700,
      temperature: 0.8,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(700)
    expect(body.temperature).toBe(0.8)
  })
})

// -------------------------------------------------------
// calculateRealCost – additional branch coverage
// -------------------------------------------------------

describe("calculateRealCost – additional branches", () => {
  it("uses prefix matching for a model name that starts with a known prefix but is not an exact match", async () => {
    // "gpt-4o-something-2025" starts with "gpt-4o" but is not an exact key
    const cost = calculateRealCost("gpt-4o-something-2025", 500_000, 500_000)
    expect(cost.inputCost).toBe(1.25)
    expect(cost.outputCost).toBe(5.0)
    expect(cost.totalCost).toBe(6.25)
    expect(cost.provider).toBe("openai")
  })

  it("uses prefix matching for Anthropic versioned model names", () => {
    // "claude-3-opus-20240229-extra" starts with "claude-3-opus-20240229"
    const cost = calculateRealCost("claude-3-opus-20240229-extra", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(15.0)
    expect(cost.outputCost).toBe(75.0)
    expect(cost.provider).toBe("anthropic")
  })

  it("uses prefix matching for Google versioned model names", () => {
    const cost = calculateRealCost("gemini-2.5-flash-extra-suffix", 1_000_000, 1_000_000)
    expect(cost.inputCost).toBe(0.15)
    expect(cost.outputCost).toBe(0.6)
    expect(cost.provider).toBe("google")
  })

  it("falls back to OpenAI pricing for completely unknown model with no prefix match", () => {
    const cost = calculateRealCost("totally-unknown-model-v3", 2_000_000, 1_000_000)
    expect(cost.inputCost).toBe(5.0)
    expect(cost.outputCost).toBe(10.0)
    expect(cost.totalCost).toBe(15.0)
    expect(cost.provider).toBe("openai")
  })

  it("calculates fractional token costs correctly", () => {
    const cost = calculateRealCost("gpt-4o-mini", 100, 50)
    expect(cost.inputCost).toBeCloseTo(0.000000015)
    expect(cost.outputCost).toBeCloseTo(0.00000003)
    expect(cost.totalCost).toBeCloseTo(0.000000045)
    expect(cost.provider).toBe("openai")
  })
})

// -------------------------------------------------------
// detectModelProvider – additional branch coverage
// -------------------------------------------------------

describe("detectModelProvider – additional branches", () => {
  it("detects Anthropic with mixed case model name", () => {
    expect(detectModelProvider("Claude-Sonnet-4")).toBe("anthropic")
    expect(detectModelProvider("CLAUDE-3-OPUS")).toBe("anthropic")
  })

  it("detects Google with mixed case model name", () => {
    expect(detectModelProvider("Gemini-2.5-Flash")).toBe("google")
    expect(detectModelProvider("GEMINI-PRO")).toBe("google")
  })

  it("defaults to openai for model names not containing claude or gemini", () => {
    expect(detectModelProvider("llama-3.1-70b")).toBe("openai")
    expect(detectModelProvider("mixtral-8x7b")).toBe("openai")
    expect(detectModelProvider("o1-preview")).toBe("openai")
  })
})
