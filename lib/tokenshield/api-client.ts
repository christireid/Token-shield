/**
 * Client-side helpers to call OpenAI, Anthropic, and Google proxies.
 * Returns the real usage data from each provider alongside the response.
 */

import { TokenShieldAPIError, ERROR_CODES } from "./errors"

export type Provider = "openai" | "anthropic" | "google"

export interface LLMResult {
  content: string
  model: string
  provider: Provider
  /**
   * Raw usage information from the provider.
   *
   * OpenAI uses `prompt_tokens` and `completion_tokens` to refer to input and
   * output tokens respectively. Other providers return `input_tokens` and
   * `output_tokens`. To make it easy for callers to work with either naming
   * convention, both sets of keys are exposed when possible.
   *
   * - `prompt_tokens` is an alias for `input_tokens` when returned from
   *   providers that use the latter.
   * - `completion_tokens` is an alias for `output_tokens` when returned from
   *   providers that use the latter.
   * - `total_tokens` is always provided and represents the sum of input and
   *   output tokens.
   */
  usage: {
    /** Total input tokens billed (alias of prompt_tokens) */
    input_tokens: number
    /** Total output tokens billed (alias of completion_tokens) */
    output_tokens: number
    /** OpenAI-style name for input tokens (alias of input_tokens) */
    prompt_tokens?: number
    /** OpenAI-style name for output tokens (alias of output_tokens) */
    completion_tokens?: number
    /** Sum of input and output tokens */
    total_tokens: number
  }
  latencyMs: number
  id: string
}

// Unified message format (OpenAI-style, routes convert as needed)
export interface LLMMessage {
  role: "system" | "user" | "assistant"
  content: string
}

// -------------------------------------------------------
// OpenAI
// -------------------------------------------------------

export async function callOpenAI(
  messages: LLMMessage[],
  model: string,
  options?: { max_tokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<LLMResult> {
  const res = await fetch("/api/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model,
      max_tokens: options?.max_tokens ?? 300,
      temperature: options?.temperature ?? 0.7,
    }),
    signal: options?.signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }))
    throw new TokenShieldAPIError(
      err.error ?? `OpenAI API error: ${res.status}`,
      "openai",
      res.status,
    )
  }

  const data = await res.json().catch(() => {
    throw new TokenShieldAPIError(
      `OpenAI API returned invalid JSON (status ${res.status})`,
      "openai",
      res.status,
      ERROR_CODES.API_INVALID_RESPONSE,
    )
  })
  // OpenAI returns prompt_tokens and completion_tokens; fallback to input/output tokens if present
  const promptTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0
  const completionTokens = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0
  const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens
  return {
    content: data.content,
    model: data.model,
    provider: "openai" as const,
    usage: {
      // Provide both naming conventions
      input_tokens: promptTokens,
      output_tokens: completionTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
    latencyMs: data.latencyMs,
    id: data.id,
  }
}

// -------------------------------------------------------
// Anthropic
// -------------------------------------------------------

export async function callAnthropic(
  messages: LLMMessage[],
  model: string,
  options?: { max_tokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<LLMResult> {
  // Extract system message for Anthropic (sent separately)
  const systemMessages = messages.filter((m) => m.role === "system")
  const chatMessages = messages.filter((m) => m.role !== "system")

  const res = await fetch("/api/anthropic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: chatMessages,
      model,
      system: systemMessages.map((m) => m.content).join("\n") || undefined,
      max_tokens: options?.max_tokens ?? 300,
      temperature: options?.temperature ?? 0.7,
    }),
    signal: options?.signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }))
    throw new TokenShieldAPIError(
      err.error ?? `Anthropic API error: ${res.status}`,
      "anthropic",
      res.status,
    )
  }

  const data = await res.json().catch(() => {
    throw new TokenShieldAPIError(
      `Anthropic API returned invalid JSON (status ${res.status})`,
      "anthropic",
      res.status,
      ERROR_CODES.API_INVALID_RESPONSE,
    )
  })
  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  const totalTokens = data.usage?.total_tokens ?? inputTokens + outputTokens
  return {
    content: data.content,
    model: data.model,
    provider: "anthropic" as const,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      // Alias to OpenAI naming for convenience
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens,
    },
    latencyMs: data.latencyMs,
    id: data.id,
  }
}

// -------------------------------------------------------
// Google Gemini
// -------------------------------------------------------

export async function callGoogle(
  messages: LLMMessage[],
  model: string,
  options?: { max_tokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<LLMResult> {
  const res = await fetch("/api/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model,
      max_tokens: options?.max_tokens ?? 300,
      temperature: options?.temperature ?? 0.7,
    }),
    signal: options?.signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }))
    throw new TokenShieldAPIError(
      err.error ?? `Google API error: ${res.status}`,
      "google",
      res.status,
    )
  }

  const data = await res.json().catch(() => {
    throw new TokenShieldAPIError(
      `Google API returned invalid JSON (status ${res.status})`,
      "google",
      res.status,
      ERROR_CODES.API_INVALID_RESPONSE,
    )
  })
  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  const totalTokens = data.usage?.total_tokens ?? inputTokens + outputTokens
  return {
    content: data.content,
    model: data.model,
    provider: "google" as const,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      // Alias to OpenAI naming for convenience
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: totalTokens,
    },
    latencyMs: data.latencyMs,
    id: data.id,
  }
}

// -------------------------------------------------------
// Universal caller
// -------------------------------------------------------

export async function callLLM(
  provider: Provider,
  messages: LLMMessage[],
  model: string,
  options?: { max_tokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<LLMResult> {
  switch (provider) {
    case "openai":
      return callOpenAI(messages, model, options)
    case "anthropic":
      return callAnthropic(messages, model, options)
    case "google":
      return callGoogle(messages, model, options)
    default: {
      const _exhaustive: never = provider
      throw new TokenShieldAPIError(
        `Unknown provider: ${_exhaustive}`,
        "openai",
        400,
        ERROR_CODES.API_INVALID_RESPONSE,
      )
    }
  }
}

// -------------------------------------------------------
// Accurate pricing per million tokens
// -------------------------------------------------------

const PROVIDER_PRICES: Record<string, { input: number; output: number; provider: Provider }> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0, provider: "openai" },
  "gpt-4o-2024-11-20": { input: 2.5, output: 10.0, provider: "openai" },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10.0, provider: "openai" },
  "gpt-4o-mini": { input: 0.15, output: 0.6, provider: "openai" },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6, provider: "openai" },
  "gpt-4.1": { input: 2.0, output: 8.0, provider: "openai" },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, provider: "openai" },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, provider: "openai" },

  // Anthropic (from anthropic.com/pricing)
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, provider: "anthropic" },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, provider: "anthropic" },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0, provider: "anthropic" },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, provider: "anthropic" },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0, provider: "anthropic" },

  // Google Gemini (from ai.google.dev/pricing)
  "gemini-2.5-flash": { input: 0.15, output: 0.6, provider: "google" },
  "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.6, provider: "google" },
  "gemini-2.0-flash": { input: 0.1, output: 0.4, provider: "google" },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.3, provider: "google" },
  "gemini-1.5-flash": { input: 0.075, output: 0.3, provider: "google" },
  "gemini-1.5-pro": { input: 1.25, output: 5.0, provider: "google" },
}

/**
 * Calculate exact dollar cost from a provider's usage object.
 * Works across OpenAI, Anthropic, and Google with accurate pricing.
 */
export function calculateRealCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { inputCost: number; outputCost: number; totalCost: number; provider: Provider } {
  // Try exact match first, then prefix match
  let pricing = PROVIDER_PRICES[model]
  if (!pricing) {
    const prefix = Object.keys(PROVIDER_PRICES).find((k) => model.startsWith(k))
    pricing = prefix
      ? PROVIDER_PRICES[prefix]
      : { input: 2.5, output: 10.0, provider: "openai" as Provider }
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    provider: pricing.provider,
  }
}

/**
 * Detect the provider for a given model name.
 */
export function detectModelProvider(model: string): Provider {
  const lower = model.toLowerCase()
  if (lower.includes("claude")) return "anthropic"
  if (lower.includes("gemini")) return "google"
  return "openai"
}
