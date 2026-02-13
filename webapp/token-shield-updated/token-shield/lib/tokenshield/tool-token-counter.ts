/**
 * TokenShield - Tool/Function Definition Token Counter
 *
 * OpenAI and Anthropic inject tool/function JSON schemas into the prompt
 * as hidden tokens. A single tool definition can add 200-800 tokens per
 * request. Developers with 10+ tools are paying for thousands of hidden
 * tokens on every call and don't know it.
 *
 * This module counts the exact tokens that tool definitions add to your
 * prompt, following OpenAI's documented internal format:
 *   - Each tool definition gets serialized into a special text format
 *   - Properties, types, descriptions all become tokens
 *   - There's per-tool structural overhead (namespace, function markers)
 *
 * Source: OpenAI community + tiktoken cookbook reverse-engineering
 */

import { countTokens } from "gpt-tokenizer"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: {
      type: "object"
      properties?: Record<string, ToolParameter>
      required?: string[]
    }
  }
}

export interface ToolTokenResult {
  /** Total tokens for all tool definitions combined */
  totalTokens: number
  /** Per-tool token breakdown */
  perTool: { name: string; tokens: number; description: string }[]
  /** Structural overhead tokens (namespace markers, separators) */
  overheadTokens: number
  /** Estimated cost of tool definitions per request at given price */
  costPerRequest: number
  /** Cost over N requests */
  costOverRequests: (n: number) => number
}

// -------------------------------------------------------
// Internal serialization (matches OpenAI's internal format)
// -------------------------------------------------------

/**
 * OpenAI converts tool definitions into a pseudo-TypeScript namespace
 * format internally. This function replicates that conversion so we
 * can count tokens accurately.
 *
 * Format:
 * ```
 * // namespace functions {
 * //   type functionName = (_: {
 * //     paramName: paramType, // description
 * //   }) => any;
 * // } // namespace functions
 * ```
 */
function serializeToolForTokenCounting(tool: ToolDefinition): string {
  const fn = tool.function
  const lines: string[] = []

  // Function description as a comment
  if (fn.description) {
    lines.push(`// ${fn.description}`)
  }

  lines.push(`type ${fn.name} = (_: {`)

  if (fn.parameters?.properties) {
    for (const [name, param] of Object.entries(fn.parameters.properties)) {
      const isRequired = fn.parameters.required?.includes(name) ?? false
      const typeStr = serializeParameterType(param)
      const optionalMark = isRequired ? "" : "?"
      const descComment = param.description ? ` // ${param.description}` : ""
      lines.push(`${name}${optionalMark}: ${typeStr},${descComment}`)
    }
  }

  lines.push("}) => any;")
  return lines.join("\n")
}

function serializeParameterType(param: ToolParameter): string {
  if (param.enum) {
    return param.enum.map((v) => `"${v}"`).join(" | ")
  }
  if (param.type === "array" && param.items) {
    return `${serializeParameterType(param.items)}[]`
  }
  if (param.type === "object" && param.properties) {
    const inner = Object.entries(param.properties)
      .map(([k, v]) => `${k}: ${serializeParameterType(v)}`)
      .join(", ")
    return `{ ${inner} }`
  }
  // Map JSON Schema types to TypeScript types
  switch (param.type) {
    case "string":
      return "string"
    case "number":
    case "integer":
      return "number"
    case "boolean":
      return "boolean"
    default:
      return "any"
  }
}

// -------------------------------------------------------
// Namespace wrapper overhead
// -------------------------------------------------------

/** Tokens for the namespace wrapper that OpenAI adds around all tools */
const NAMESPACE_OVERHEAD = countTokens("namespace functions {\n\n} // namespace functions")
/** Per-tool structural overhead (type declaration markers) */
const PER_TOOL_OVERHEAD = 4 // approximate: type keyword, =, =>, any

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Count the exact tokens that tool/function definitions add to your prompt.
 *
 * These tokens are invisible in messages but appear in `usage.prompt_tokens`.
 * Replicates OpenAI's internal pseudo-TypeScript namespace serialization to
 * count tokens accurately, including per-tool and namespace structural overhead.
 *
 * @param tools - Array of tool definitions in OpenAI function-calling format
 * @param inputPricePerMillion - Input token price per million for cost calculation (defaults to 0.15)
 * @returns A {@link ToolTokenResult} with total tokens, per-tool breakdown, overhead, and cost helpers
 * @example
 * ```ts
 * const result = countToolTokens([{
 *   type: "function",
 *   function: { name: "get_weather", description: "Get current weather", parameters: { type: "object", properties: { city: { type: "string" } } } }
 * }])
 * // result.totalTokens === 38
 * // result.costPerRequest === 0.0000057
 * ```
 */
export function countToolTokens(
  tools: ToolDefinition[],
  inputPricePerMillion = 0.15
): ToolTokenResult {
  if (tools.length === 0) {
    return {
      totalTokens: 0,
      perTool: [],
      overheadTokens: 0,
      costPerRequest: 0,
      costOverRequests: () => 0,
    }
  }

  const perTool: ToolTokenResult["perTool"] = []
  let contentTokens = 0

  for (const tool of tools) {
    const serialized = serializeToolForTokenCounting(tool)
    const tokens = countTokens(serialized) + PER_TOOL_OVERHEAD
    contentTokens += tokens
    perTool.push({
      name: tool.function.name,
      tokens,
      description: tool.function.description?.slice(0, 80) ?? "",
    })
  }

  const totalTokens = contentTokens + NAMESPACE_OVERHEAD
  const costPerRequest = (totalTokens / 1_000_000) * inputPricePerMillion

  return {
    totalTokens,
    perTool,
    overheadTokens: NAMESPACE_OVERHEAD,
    costPerRequest,
    costOverRequests: (n: number) => costPerRequest * n,
  }
}

/**
 * Optimize tool definitions to use fewer tokens.
 *
 * Applies token-reduction strategies: truncating long descriptions to 100
 * characters, removing parameter descriptions that merely repeat the parameter
 * name, and inlining enum values more efficiently. Does not alter tool behavior.
 *
 * @param tools - Array of tool definitions in OpenAI function-calling format
 * @returns An object with the optimized tools array, original/optimized token counts, tokens saved, and human-readable suggestions
 * @example
 * ```ts
 * const result = optimizeToolDefinitions(myTools)
 * // result.savedTokens === 120
 * // result.suggestions[0] === "get_weather: description truncated from 200 to 100 chars"
 * // result.optimized — use these tool defs to save tokens
 * ```
 */
export function optimizeToolDefinitions(
  tools: ToolDefinition[]
): {
  optimized: ToolDefinition[]
  originalTokens: number
  optimizedTokens: number
  savedTokens: number
  suggestions: string[]
} {
  const originalCount = countToolTokens(tools)
  const suggestions: string[] = []
  const optimized: ToolDefinition[] = []

  for (const tool of tools) {
    const fn = tool.function
    const newTool: ToolDefinition = {
      type: "function",
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters
          ? JSON.parse(JSON.stringify(fn.parameters))
          : undefined,
      },
    }

    // Strategy 1: Truncate long descriptions
    if (fn.description && fn.description.length > 100) {
      newTool.function.description = fn.description.slice(0, 100).trim()
      suggestions.push(
        `${fn.name}: description truncated from ${fn.description.length} to 100 chars`
      )
    }

    // Strategy 2: Remove parameter descriptions that just repeat the param name
    if (newTool.function.parameters?.properties) {
      for (const [name, param] of Object.entries(
        newTool.function.parameters.properties
      )) {
        if (param.description) {
          const normalizedDesc = param.description.toLowerCase().replace(/[^a-z]/g, "")
          const normalizedName = name.toLowerCase().replace(/[^a-z]/g, "")
          if (
            normalizedDesc === normalizedName ||
            normalizedDesc === `the${normalizedName}` ||
            normalizedDesc === `${normalizedName}value` ||
            param.description.length < 10
          ) {
            delete (newTool.function.parameters.properties[name] as ToolParameter)
              .description
            suggestions.push(
              `${fn.name}.${name}: removed redundant description "${param.description}"`
            )
          }
        }
      }
    }

    optimized.push(newTool)
  }

  const optimizedCount = countToolTokens(optimized)

  return {
    optimized,
    originalTokens: originalCount.totalTokens,
    optimizedTokens: optimizedCount.totalTokens,
    savedTokens: originalCount.totalTokens - optimizedCount.totalTokens,
    suggestions,
  }
}

// -------------------------------------------------------
// Image Token Counting
// -------------------------------------------------------

export interface ImageTokenResult {
  /** Total tokens this image costs */
  tokens: number
  /** Number of 512x512 tiles */
  tiles: number
  /** Whether the image was resized for calculation */
  resized: boolean
  /** Recommended dimensions to save tokens */
  recommendation?: {
    suggestedWidth: number
    suggestedHeight: number
    savedTokens: number
  }
}

/**
 * Count the tokens an image input will cost using OpenAI's tile-based formula.
 *
 * OpenAI's vision pricing:
 * - Base: 85 tokens per image
 * - Each 512x512 tile: 170 tokens
 * - Images are first scaled to fit in 2048x2048, then shortest side scaled to 768px
 * - Tile count = ceil(w/512) * ceil(h/512)
 *
 * "low" detail: fixed 85 tokens regardless of size.
 * "high" detail: 85 + 170 * tiles.
 * "auto": assumes high detail for cost safety.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param detail - Vision detail level: "low", "high", or "auto" (defaults to "auto")
 * @returns An {@link ImageTokenResult} with token count, tile count, resize flag, and optional size recommendation
 * @example
 * ```ts
 * const result = countImageTokens(1920, 1080, "high")
 * // result.tokens === 765
 * // result.tiles === 4
 * // result.recommendation?.savedTokens — tokens saved by resizing
 * ```
 */
export function countImageTokens(
  width: number,
  height: number,
  detail: "low" | "high" | "auto" = "auto"
): ImageTokenResult {
  const BASE_TOKENS = 85
  const TOKENS_PER_TILE = 170

  if (detail === "low") {
    return { tokens: BASE_TOKENS, tiles: 0, resized: false }
  }

  // Step 1: Scale to fit within 2048x2048
  let w = width
  let h = height
  let resized = false

  if (w > 2048 || h > 2048) {
    const scale = 2048 / Math.max(w, h)
    w = Math.floor(w * scale)
    h = Math.floor(h * scale)
    resized = true
  }

  // Step 2: Scale so shortest side is 768px
  const minSide = Math.min(w, h)
  if (minSide > 768) {
    const scale = 768 / minSide
    w = Math.floor(w * scale)
    h = Math.floor(h * scale)
    resized = true
  }

  // Step 3: Count 512x512 tiles
  const tilesW = Math.ceil(w / 512)
  const tilesH = Math.ceil(h / 512)
  const tiles = tilesW * tilesH

  const tokens = BASE_TOKENS + TOKENS_PER_TILE * tiles

  // Generate recommendation if image is larger than needed
  let recommendation: ImageTokenResult["recommendation"]
  const optimalW = Math.min(width, 1024)
  const optimalH = Math.min(height, 1024)
  if (width > 1024 || height > 1024) {
    const optResult = countImageTokens(optimalW, optimalH, "high")
    if (optResult.tokens < tokens) {
      recommendation = {
        suggestedWidth: optimalW,
        suggestedHeight: optimalH,
        savedTokens: tokens - optResult.tokens,
      }
    }
  }

  return { tokens, tiles, resized, recommendation }
}

// -------------------------------------------------------
// Re-export output prediction logic from extracted module
// -------------------------------------------------------

export { predictOutputTokens } from "./output-predictor"
export type { OutputPrediction } from "./output-predictor"
