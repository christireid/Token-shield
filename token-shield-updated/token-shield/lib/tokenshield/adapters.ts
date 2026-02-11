/**
 * TokenShield — Framework-Agnostic Adapters
 *
 * Wraps the TokenShield middleware pipeline (transformParams → wrapGenerate/wrapStream)
 * around ANY LLM SDK so you get caching, budgeting, cost tracking, and guardrails
 * without depending on Vercel AI SDK at runtime.
 *
 * Each adapter accepts the already-constructed TokenShieldMiddleware instance and
 * a user-provided callback that performs the actual model call. No external SDK
 * packages are imported — all SDK-specific logic lives in the callback.
 *
 * @example Generic (any SDK)
 * ```ts
 * const shield = tokenShieldMiddleware({ ... })
 * const call = createGenericAdapter(shield, myCallFn, { modelId: "gpt-4o" })
 * const result = await call({ messages: [{ role: "user", content: "Hi" }] })
 * ```
 *
 * @example OpenAI SDK
 * ```ts
 * import OpenAI from "openai"
 * const client = new OpenAI()
 * const shield = tokenShieldMiddleware({ ... })
 * const chat = createOpenAIAdapter(
 *   shield,
 *   (p) => client.chat.completions.create(p as any),
 *   { defaultModel: "gpt-4o" },
 * )
 * const res = await chat({ messages: [{ role: "user", content: "Hello" }] })
 * ```
 *
 * @example Anthropic SDK
 * ```ts
 * import Anthropic from "@anthropic-ai/sdk"
 * const client = new Anthropic()
 * const shield = tokenShieldMiddleware({ ... })
 * const chat = createAnthropicAdapter(
 *   shield,
 *   (p) => client.messages.create(p as any),
 *   { defaultModel: "claude-sonnet-4-20250514", defaultMaxTokens: 1024 },
 * )
 * const res = await chat({ messages: [{ role: "user", content: "Hello" }] })
 * ```
 *
 * @example Streaming (any SDK)
 * ```ts
 * const shield = tokenShieldMiddleware({ ... })
 * const stream = createStreamAdapter(shield, myStreamFn, { modelId: "gpt-4o" })
 * const readable = await stream({ messages: [{ role: "user", content: "Hi" }] })
 * ```
 */

import type { TokenShieldMiddleware } from "./middleware"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Message shape accepted by all adapters (plain role + content strings). */
export interface AdapterMessage {
  role: string
  content: string
}

/**
 * Convert a flat messages array into the AI SDK prompt format that the
 * middleware pipeline expects internally.
 */
function toAiSdkPrompt(
  messages: AdapterMessage[],
): Array<{ role: string; content: Array<{ type: "text"; text: string }> }> {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: "text" as const, text: m.content }],
  }))
}

/**
 * Convert an AI SDK-format prompt back into a flat messages array
 * (role + content string).
 */
function fromAiSdkPrompt(
  prompt: Array<{ role: string; content: Array<{ type: string; text: string }> }>,
): AdapterMessage[] {
  return prompt.map((m) => ({
    role: m.role,
    content:
      Array.isArray(m.content) && m.content.length > 0
        ? m.content.map((c) => c.text).join("")
        : "",
  }))
}

// ---------------------------------------------------------------------------
// 1. Generic Adapter
// ---------------------------------------------------------------------------

/** Options for {@link createGenericAdapter}. */
export interface GenericAdapterOptions {
  /** The model ID used for cost estimation (e.g. `"gpt-4o"`). */
  modelId: string
}

/**
 * Universal adapter that wraps any `(params) => Promise<result>` function with
 * the full TokenShield pipeline (breaker, budget, guard, cache, context, router,
 * prefix, ledger).
 *
 * @param shield - The TokenShield middleware instance.
 * @param callFn - A callback that performs the actual model call.
 * @param options - Optional configuration (model ID for cost estimation).
 * @returns A wrapped function with the same call signature that runs through the
 *          TokenShield pipeline before/after calling `callFn`.
 *
 * @example
 * ```ts
 * const shield = tokenShieldMiddleware({ ... })
 * const call = createGenericAdapter(shield, myCallFn, { modelId: "gpt-4o" })
 * const result = await call({ messages: [{ role: "user", content: "Hello" }] })
 * ```
 */
export function createGenericAdapter(
  shield: TokenShieldMiddleware,
  callFn: (params: Record<string, unknown>) => Promise<Record<string, unknown>>,
  options?: GenericAdapterOptions,
): (
  params: {
    modelId?: string
    messages: AdapterMessage[]
    [key: string]: unknown
  },
) => Promise<Record<string, unknown>> {
  return async (params) => {
    const { modelId: paramModelId, messages, ...rest } = params
    const modelId = paramModelId ?? options?.modelId ?? "unknown"
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    return shield.wrapGenerate({
      doGenerate: () => callFn(transformed),
      params: transformed,
    })
  }
}

// ---------------------------------------------------------------------------
// 2. OpenAI Adapter
// ---------------------------------------------------------------------------

/** Options for {@link createOpenAIAdapter}. */
export interface OpenAIAdapterOptions {
  /** Default model to use when not specified per-call (e.g. `"gpt-4o"`). */
  defaultModel?: string
}

/**
 * Adapter for the OpenAI SDK (`client.chat.completions.create`).
 *
 * Converts between OpenAI's message format and the AI SDK prompt format used
 * internally by TokenShield, runs the full middleware pipeline, then converts the
 * response back so callers see the familiar OpenAI shape.
 *
 * @param shield - The TokenShield middleware instance.
 * @param createFn - A callback wrapping `client.chat.completions.create()`.
 * @param options - Optional configuration (default model).
 * @returns A wrapped function that runs through the TokenShield pipeline.
 *
 * @example
 * ```ts
 * const chat = createOpenAIAdapter(
 *   shield,
 *   (p) => client.chat.completions.create(p as any),
 *   { defaultModel: "gpt-4o" },
 * )
 * const res = await chat({ messages: [{ role: "user", content: "Hi" }] })
 * ```
 */
export function createOpenAIAdapter(
  shield: TokenShieldMiddleware,
  createFn: (params: Record<string, unknown>) => Promise<Record<string, unknown>>,
  options?: OpenAIAdapterOptions,
): (
  params: {
    model?: string
    messages: AdapterMessage[]
    [key: string]: unknown
  },
) => Promise<Record<string, unknown>> {
  return async (params) => {
    const { model, messages, ...rest } = params
    const modelId = model ?? options?.defaultModel ?? "gpt-4o"
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    return shield.wrapGenerate({
      doGenerate: async () => {
        // Convert AI SDK prompt back to OpenAI format for the actual API call
        const openAiMessages = fromAiSdkPrompt(
          (transformed.prompt ?? prompt) as Array<{
            role: string
            content: Array<{ type: string; text: string }>
          }>,
        )
        const openAiParams: Record<string, unknown> = {
          ...transformed,
          model: transformed.modelId ?? modelId,
          messages: openAiMessages,
        }
        delete openAiParams.prompt
        delete openAiParams.modelId

        const raw = await createFn(openAiParams)

        // Normalise OpenAI response to the shape wrapGenerate expects
        const choices = raw.choices as
          | Array<{ message?: { content?: string }; finish_reason?: string }>
          | undefined
        const usage = raw.usage as
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined

        return {
          text: choices?.[0]?.message?.content ?? "",
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
          },
          finishReason: choices?.[0]?.finish_reason ?? "stop",
          rawResponse: raw,
        }
      },
      params: transformed,
    })
  }
}

// ---------------------------------------------------------------------------
// 3. Anthropic Adapter
// ---------------------------------------------------------------------------

/** Options for {@link createAnthropicAdapter}. */
export interface AnthropicAdapterOptions {
  /** Default model to use when not specified per-call. */
  defaultModel?: string
  /** Default max_tokens value (Anthropic requires this parameter). */
  defaultMaxTokens?: number
}

/**
 * Adapter for the Anthropic SDK (`client.messages.create`).
 *
 * Converts between Anthropic's message format and the AI SDK prompt format,
 * separates system messages (Anthropic uses a top-level `system` param), runs
 * the middleware pipeline, and normalises the response.
 *
 * @param shield - The TokenShield middleware instance.
 * @param createFn - A callback wrapping `client.messages.create()`.
 * @param options - Optional configuration (default model, max tokens).
 * @returns A wrapped function that runs through the TokenShield pipeline.
 *
 * @example
 * ```ts
 * const chat = createAnthropicAdapter(
 *   shield,
 *   (p) => client.messages.create(p as any),
 *   { defaultModel: "claude-sonnet-4-20250514", defaultMaxTokens: 1024 },
 * )
 * const res = await chat({ messages: [{ role: "user", content: "Hello" }] })
 * ```
 */
export function createAnthropicAdapter(
  shield: TokenShieldMiddleware,
  createFn: (params: Record<string, unknown>) => Promise<Record<string, unknown>>,
  options?: AnthropicAdapterOptions,
): (
  params: {
    model?: string
    messages: AdapterMessage[]
    max_tokens?: number
    [key: string]: unknown
  },
) => Promise<Record<string, unknown>> {
  return async (params) => {
    const { model, messages, max_tokens, ...rest } = params
    const modelId = model ?? options?.defaultModel ?? "claude-sonnet-4-20250514"
    const maxTokens = max_tokens ?? options?.defaultMaxTokens ?? 1024
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = {
      modelId,
      prompt,
      max_tokens: maxTokens,
      ...rest,
    }
    const transformed = await shield.transformParams({ params: baseParams })

    return shield.wrapGenerate({
      doGenerate: async () => {
        // Convert AI SDK prompt back to Anthropic format
        const flatMessages = fromAiSdkPrompt(
          (transformed.prompt ?? prompt) as Array<{
            role: string
            content: Array<{ type: string; text: string }>
          }>,
        )

        // Anthropic uses a top-level `system` param for system messages
        const systemParts: string[] = []
        const nonSystemMessages: AdapterMessage[] = []
        for (const msg of flatMessages) {
          if (msg.role === "system") {
            systemParts.push(msg.content)
          } else {
            nonSystemMessages.push(msg)
          }
        }

        const anthropicParams: Record<string, unknown> = {
          ...transformed,
          model: transformed.modelId ?? modelId,
          max_tokens: transformed.max_tokens ?? maxTokens,
          messages: nonSystemMessages,
        }
        if (systemParts.length > 0) {
          anthropicParams.system = systemParts.join("\n\n")
        }
        delete anthropicParams.prompt
        delete anthropicParams.modelId

        const raw = await createFn(anthropicParams)

        // Normalise Anthropic response to the shape wrapGenerate expects
        const content = raw.content as
          | Array<{ type?: string; text?: string }>
          | undefined
        const usage = raw.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined

        return {
          text: content?.[0]?.text ?? "",
          usage: {
            promptTokens: usage?.input_tokens ?? 0,
            completionTokens: usage?.output_tokens ?? 0,
          },
          finishReason: (raw.stop_reason as string) ?? "end_turn",
          rawResponse: raw,
        }
      },
      params: transformed,
    })
  }
}

// ---------------------------------------------------------------------------
// 4. Stream Adapter
// ---------------------------------------------------------------------------

/**
 * Generic streaming adapter that wraps any function returning a `ReadableStream`
 * with the TokenShield streaming pipeline (token tracking, caching, budget
 * accounting).
 *
 * @param shield - The TokenShield middleware instance.
 * @param streamFn - A callback that performs the streaming model call and
 *                   returns a `ReadableStream`.
 * @param options - Optional configuration (model ID for cost estimation).
 * @returns A wrapped function that runs through the TokenShield streaming
 *          pipeline before returning the stream.
 *
 * @example
 * ```ts
 * const stream = createStreamAdapter(
 *   shield,
 *   async (p) => fetchStream(p),
 *   { modelId: "gpt-4o" },
 * )
 * const readable = await stream({
 *   messages: [{ role: "user", content: "Write a poem" }],
 * })
 * ```
 */
export function createStreamAdapter(
  shield: TokenShieldMiddleware,
  streamFn: (params: Record<string, unknown>) => Promise<ReadableStream>,
  options?: GenericAdapterOptions,
): (
  params: {
    modelId?: string
    messages: AdapterMessage[]
    [key: string]: unknown
  },
) => Promise<ReadableStream> {
  return async (params) => {
    const { modelId: paramModelId, messages, ...rest } = params
    const modelId = paramModelId ?? options?.modelId ?? "unknown"
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    const result = await shield.wrapStream({
      doStream: async () => ({ stream: await streamFn(transformed) }),
      params: transformed,
    })

    return (result as { stream: ReadableStream }).stream
  }
}
