/**
 * token-shield — Vercel AI SDK middleware.
 *
 * `withShield` returns a middleware object compatible with
 * `wrapLanguageModel` from the Vercel AI SDK (ai >= 3.0).
 *
 * It intercepts `transformParams` to apply compression and check cache,
 * and `wrapGenerate` to record responses for caching and cost tracking.
 *
 * Edge runtime compatible — no Node-only APIs.
 */

import { createShield } from "../core/shield"
import type { ShieldOptions, Message } from "../types"

/**
 * Vercel AI SDK middleware-compatible interface.
 * This matches LanguageModelV1Middleware from the `ai` package
 * without requiring it as a direct import.
 */
export interface ShieldMiddleware {
  transformParams?: (args: { params: Record<string, unknown> }) => Record<string, unknown> | Promise<Record<string, unknown>>
  wrapGenerate?: (args: {
    doGenerate: () => Promise<Record<string, unknown>>
    params: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
  wrapStream?: (args: {
    doStream: () => Promise<Record<string, unknown>>
    params: Record<string, unknown>
  }) => Promise<Record<string, unknown>>
}

/**
 * Create a Vercel AI SDK middleware that applies token-shield optimizations.
 *
 * Compatible with `wrapLanguageModel` from the `ai` package (v3+).
 * Works in both Node.js and Edge runtimes.
 *
 * @param options - Shield configuration
 * @returns A middleware object for `wrapLanguageModel`
 *
 * @example
 * ```ts
 * import { withShield } from "token-shield";
 * import { wrapLanguageModel } from "ai";
 * import { openai } from "@ai-sdk/openai";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4o"),
 *   middleware: withShield({ cache: true, compression: true }),
 * });
 *
 * const result = await generateText({ model, prompt: "What is TypeScript?" });
 * ```
 */
export function withShield(options?: ShieldOptions): ShieldMiddleware {
  const shieldInstance = createShield(options)

  return {
    transformParams({ params }) {
      // Extract messages from params and apply compression
      const messages = extractMessages(params)
      if (!messages.length) return params

      const modelId = extractModelId(params, options?.model)
      const result = shieldInstance.process({ model: modelId, messages })

      // If cached, store the cached response for wrapGenerate to return
      if (result.cached) {
        return {
          ...params,
          _shieldCached: result.cached,
          _shieldModel: modelId,
          _shieldPrompt: messages.map((m) => m.content).join("\n"),
        }
      }

      // Replace messages with compressed versions
      if (result.compressed && params.prompt) {
        return {
          ...params,
          prompt: result.messages.find((m) => m.role === "user")?.content ?? params.prompt,
          _shieldModel: modelId,
          _shieldPrompt: messages.map((m) => m.content).join("\n"),
        }
      }

      if (result.compressed && Array.isArray(params.messages)) {
        return {
          ...params,
          messages: result.messages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] })),
          _shieldModel: modelId,
          _shieldPrompt: messages.map((m) => m.content).join("\n"),
        }
      }

      return {
        ...params,
        _shieldModel: modelId,
        _shieldPrompt: messages.map((m) => m.content).join("\n"),
      }
    },

    async wrapGenerate({ doGenerate, params }) {
      // Return cached response if available
      const cached = (params as Record<string, unknown>)._shieldCached as
        | { response: string }
        | undefined
      if (cached) {
        return {
          text: cached.response,
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        }
      }

      const result = await doGenerate()

      // Record for cache + cost tracking
      const modelId = ((params as Record<string, unknown>)._shieldModel as string) ?? "unknown"
      const prompt = ((params as Record<string, unknown>)._shieldPrompt as string) ?? ""
      const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined
      const text = (result.text as string) ?? ""

      if (prompt && text) {
        shieldInstance.record({
          model: modelId,
          prompt,
          response: text,
          inputTokens: usage?.promptTokens ?? 0,
          outputTokens: usage?.completionTokens ?? 0,
        })
      }

      return result
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessages(params: Record<string, unknown>): Message[] {
  // Vercel AI SDK puts messages in params.messages as structured objects
  if (Array.isArray(params.messages)) {
    return (params.messages as Array<Record<string, unknown>>).map((m) => ({
      role: (m.role as Message["role"]) ?? "user",
      content: extractTextContent(m.content),
    }))
  }

  // Simple prompt string
  if (typeof params.prompt === "string") {
    return [{ role: "user", content: params.prompt }]
  }

  return []
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((part: Record<string, unknown>) => part.type === "text")
      .map((part: Record<string, unknown>) => part.text as string)
      .join("")
  }
  return String(content ?? "")
}

function extractModelId(params: Record<string, unknown>, defaultModel?: string): string {
  if (typeof params.modelId === "string") return params.modelId
  if (typeof params.model === "string") return params.model
  return defaultModel ?? "unknown"
}
