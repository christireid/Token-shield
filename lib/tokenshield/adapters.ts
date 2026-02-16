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
 *   (p) => client.chat.completions.create(p),
 *   { defaultModel: "gpt-4o" },
 * )
 * const res = await chat({ messages: [{ role: "user", content: "Hello" }] })
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
      Array.isArray(m.content) && m.content.length > 0 ? m.content.map((c) => c.text).join("") : "",
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
 * the full TokenShield pipeline.
 *
 * @param shield - The TokenShield middleware instance.
 * @param callFn - A callback that performs the actual model call.
 * @param options - Optional configuration (model ID for cost estimation).
 * @returns A wrapped function with the same call signature.
 */
export function createGenericAdapter<
  TParams extends { messages: AdapterMessage[]; modelId?: string },
  TResult,
>(
  shield: TokenShieldMiddleware,
  callFn: (params: TParams) => Promise<TResult>,
  options?: GenericAdapterOptions,
): (params: TParams) => Promise<TResult> {
  return async (params) => {
    const { modelId: paramModelId, messages, ...rest } = params
    const modelId = paramModelId ?? options?.modelId ?? "unknown"
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    const result = await shield.wrapGenerate({
      doGenerate: async () => {
        // Strip the internal AI-SDK `prompt` field before reconstructing user-facing
        // params. `modelId` is kept since it's part of the generic adapter's TParams.
        const {
          prompt: _prompt,
          ...cleanTransformed
        } = transformed as Record<string, unknown>
        const executionParams = {
          ...params,
          ...cleanTransformed,
        } as TParams

        const rawResult = await callFn(executionParams)

        // For generic adapters, we can't normalize the output for TokenShield's
        // internal accounting perfectly unless TResult follows a known shape.
        // We do a best-effort check or default to empty usage.
        return {
          text: "",
          usage: { promptTokens: 0, completionTokens: 0 },
          rawResponse: rawResult as Record<string, unknown>,
        }
      },
      params: transformed,
    })

    // Explicitly return the rawResponse from the wrapGenerate result
    // This is the fix: return result.rawResponse instead of result directly or casting it
    return result.rawResponse as TResult
  }
}

// ---------------------------------------------------------------------------
// 2. OpenAI Adapter
// ---------------------------------------------------------------------------

export interface OpenAIAdapterOptions {
  defaultModel?: string
}

/**
 * Adapter for the OpenAI SDK (`client.chat.completions.create`).
 */
export function createOpenAIAdapter<TParams extends { messages: AdapterMessage[]; model?: string }, TResult>(
  shield: TokenShieldMiddleware,
  createFn: (params: TParams) => Promise<TResult>,
  options?: OpenAIAdapterOptions,
): (params: TParams & { messages: AdapterMessage[] }) => Promise<TResult> {
  return async (params) => {
    // 1. Extract what we need for middleware
    const { model, messages, ...rest } = params
    const modelId = model ?? options?.defaultModel ?? "gpt-4o"
    const prompt = toAiSdkPrompt(messages)

    // 2. Run Transform Pipeline
    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    // 3. Wrap Execution
    const result = await shield.wrapGenerate({
      doGenerate: async () => {
        // Convert back to OpenAI format
        const openAiMessages = fromAiSdkPrompt(
          (transformed.prompt ?? prompt) as Array<{
            role: string
            content: Array<{ type: string; text: string }>
          }>,
        )

        // Reconstruct params, excluding TokenShield internal fields
        const {
          prompt: _prompt,
          modelId: _modelId,
          ...cleanTransformed
        } = transformed as Record<string, unknown>
        const openAiParams = {
          ...rest,
          ...cleanTransformed,
          model: transformed.modelId ?? modelId,
          messages: openAiMessages,
        }

        const raw = await createFn(openAiParams as TParams)

        // Helper to safely access response fields without strictly typing TResult
        // (since it might be Stream or non-standard response)
        const anyRaw = raw as Record<string, unknown>
        const choices = anyRaw.choices as
          | Array<{ message?: { content?: string }; finish_reason?: string }>
          | undefined
        const usage = anyRaw.usage as
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined

        return {
          text: choices?.[0]?.message?.content ?? "",
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
          },
          finishReason: choices?.[0]?.finish_reason ?? "stop",
          rawResponse: anyRaw,
        }
      },
      params: transformed,
    })

    // 4. Return the raw response (which might be the cached one, casted back)
    return result.rawResponse as TResult
  }
}

// ---------------------------------------------------------------------------
// 3. Anthropic Adapter
// ---------------------------------------------------------------------------

export interface AnthropicAdapterOptions {
  defaultModel?: string
  defaultMaxTokens?: number
}

/**
 * Adapter for the Anthropic SDK (`client.messages.create`).
 */
export function createAnthropicAdapter<
  TParams extends { messages: AdapterMessage[]; model?: string; max_tokens?: number },
  TResult,
>(
  shield: TokenShieldMiddleware,
  createFn: (params: TParams) => Promise<TResult>,
  options?: AnthropicAdapterOptions,
): (params: TParams & { messages: AdapterMessage[] }) => Promise<TResult> {
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

    const result = await shield.wrapGenerate({
      doGenerate: async () => {
        const flatMessages = fromAiSdkPrompt(
          (transformed.prompt ?? prompt) as Array<{
            role: string
            content: Array<{ type: string; text: string }>
          }>,
        )

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
          ...rest,
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

        const raw = await createFn(anthropicParams as TParams)
        const anyRaw = raw as Record<string, unknown>

        const contentBlocks = anyRaw.content as Array<{ type?: string; text?: string }> | undefined
        const usageData = anyRaw.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined

        return {
          text:
            contentBlocks
              ?.filter((b) => b.type === "text" || b.type === undefined)
              .map((b) => b.text ?? "")
              .join("") ?? "",
          usage: {
            promptTokens: usageData?.input_tokens ?? 0,
            completionTokens: usageData?.output_tokens ?? 0,
          },
          finishReason: (anyRaw.stop_reason as string) ?? "end_turn",
          rawResponse: anyRaw,
        }
      },
      params: transformed,
    })

    return result.rawResponse as TResult
  }
}

// ---------------------------------------------------------------------------
// 4. Stream Adapter
// ---------------------------------------------------------------------------

export function createStreamAdapter<
  TParams extends { messages: AdapterMessage[]; modelId?: string },
>(
  shield: TokenShieldMiddleware,
  streamFn: (params: TParams) => Promise<ReadableStream>,
  options?: GenericAdapterOptions,
): (params: TParams) => Promise<ReadableStream> {
  return async (params) => {
    const { modelId: paramModelId, messages, ...rest } = params
    const modelId = paramModelId ?? options?.modelId ?? "unknown"
    const prompt = toAiSdkPrompt(messages)

    const baseParams: Record<string, unknown> = { modelId, prompt, ...rest }
    const transformed = await shield.transformParams({ params: baseParams })

    const result = await shield.wrapStream({
      doStream: async () => {
        // Strip the internal AI-SDK `prompt` field; keep `modelId` as it's part of TParams
        const {
          prompt: _prompt,
          ...cleanTransformed
        } = transformed as Record<string, unknown>
        const executionParams = {
          ...params,
          ...cleanTransformed,
        } as TParams
        return { stream: await streamFn(executionParams) }
      },
      params: transformed,
    })

    return (result as { stream: ReadableStream }).stream
  }
}
