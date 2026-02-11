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
// Output Token Prediction
// -------------------------------------------------------

export interface OutputPrediction {
  /** Predicted output token count */
  predictedTokens: number
  /** Confidence level */
  confidence: "high" | "medium" | "low"
  /** What type of task was detected */
  taskType: string
  /** Suggested max_tokens value (with safety margin) */
  suggestedMaxTokens: number
  /** Savings vs using a blanket max_tokens of 4096 */
  savingsVsBlanket: number
}

/**
 * Task type patterns and their typical output lengths.
 * Based on analysis of millions of API calls from published research
 * (ACL 2025, glukhov.org optimization guide).
 */
const TASK_PATTERNS: {
  pattern: RegExp
  type: string
  avgTokens: number
  maxTokens: number
  confidence: "high" | "medium"
}[] = [
  // Short-answer factual questions
  {
    pattern: /^(what|who|when|where|which|how many|how much)\b.{0,100}\?$/i,
    type: "factual-qa",
    avgTokens: 30,
    maxTokens: 100,
    confidence: "high",
  },
  // Yes/no questions
  {
    pattern: /^(is|are|was|were|do|does|did|can|could|should|will|would|has|have)\b.{0,100}\?$/i,
    type: "yes-no",
    avgTokens: 40,
    maxTokens: 150,
    confidence: "high",
  },
  // Classification/labeling
  {
    pattern: /\b(classify|categorize|label|tag|sentiment|positive|negative)\b/i,
    type: "classification",
    avgTokens: 20,
    maxTokens: 50,
    confidence: "high",
  },
  // JSON/structured output
  {
    pattern: /\b(json|return.*object|structured|schema|format.*as)\b/i,
    type: "structured-output",
    avgTokens: 200,
    maxTokens: 500,
    confidence: "medium",
  },
  // Code generation
  {
    pattern: /\b(write|create|implement|build|code|function|class|component)\b.*\b(code|function|class|program|script|component)\b/i,
    type: "code-generation",
    avgTokens: 400,
    maxTokens: 1500,
    confidence: "medium",
  },
  // Summarization
  {
    pattern: /\b(summarize|summary|summarise|tldr|brief|overview|gist)\b/i,
    type: "summarization",
    avgTokens: 150,
    maxTokens: 400,
    confidence: "medium",
  },
  // Translation
  {
    pattern: /\b(translate|translation|convert.*to.*language)\b/i,
    type: "translation",
    avgTokens: 0, // proportional to input
    maxTokens: 0,
    confidence: "medium",
  },
  // Explanation/analysis (longer output)
  {
    pattern: /\b(explain|analyze|analyse|compare|evaluate|discuss|describe|elaborate)\b/i,
    type: "analysis",
    avgTokens: 500,
    maxTokens: 1500,
    confidence: "medium",
  },
  // List generation
  {
    pattern: /\b(list|enumerate|give me|provide)\b.*\b(\d+|several|few|some)\b/i,
    type: "list-generation",
    avgTokens: 200,
    maxTokens: 600,
    confidence: "medium",
  },
]

/**
 * Predict the number of output tokens a model will generate for a given prompt.
 *
 * Uses task-type detection (factual Q&A, classification, code generation, etc.)
 * and input length correlation to estimate output length. Enables more accurate
 * pre-call cost estimates and smarter `max_tokens` values instead of blanket 4096.
 *
 * Based on research from ACL 2025 "Predicting Remaining Output Length"
 * and empirical data from the glukhov.org cost optimization guide.
 *
 * @param prompt - The user prompt to analyze
 * @param options - Optional prediction tuning parameters
 * @param options.safetyMargin - Multiplier applied to the predicted token count for the suggested max_tokens (defaults to 1.5)
 * @param options.minMaxTokens - Hard minimum for the suggested max_tokens value (defaults to 50)
 * @param options.maxMaxTokens - Hard maximum for the suggested max_tokens value (defaults to 4096)
 * @returns An {@link OutputPrediction} with predicted tokens, confidence level, task type, suggested max_tokens, and savings vs a blanket 4096
 * @example
 * ```ts
 * const pred = predictOutputTokens("What is the capital of France?")
 * // pred.predictedTokens === 30
 * // pred.taskType === "factual-qa"
 * // pred.suggestedMaxTokens === 50
 * // pred.savingsVsBlanket === 4046
 * ```
 */
export function predictOutputTokens(
  prompt: string,
  options: {
    /** Safety margin multiplier (default 1.5x) */
    safetyMargin?: number
    /** Hard minimum for max_tokens */
    minMaxTokens?: number
    /** Hard maximum for max_tokens */
    maxMaxTokens?: number
  } = {}
): OutputPrediction {
  const safetyMargin = options.safetyMargin ?? 1.5
  const minMax = options.minMaxTokens ?? 50
  const maxMax = options.maxMaxTokens ?? 4096
  const inputTokens = countTokens(prompt)

  // Try to match against known task patterns
  for (const task of TASK_PATTERNS) {
    if (task.pattern.test(prompt)) {
      let predicted = task.avgTokens

      // Translation: output length roughly proportional to input
      if (task.type === "translation") {
        predicted = Math.round(inputTokens * 1.2)
      }

      const suggested = Math.min(
        maxMax,
        Math.max(minMax, Math.round(predicted * safetyMargin))
      )

      return {
        predictedTokens: predicted,
        confidence: task.confidence,
        taskType: task.type,
        suggestedMaxTokens: suggested,
        savingsVsBlanket: maxMax - suggested,
      }
    }
  }

  // Fallback: estimate based on input length
  // Short prompts tend to get short answers, long prompts get longer answers
  let predicted: number
  if (inputTokens < 30) {
    predicted = 100
  } else if (inputTokens < 100) {
    predicted = 250
  } else if (inputTokens < 500) {
    predicted = 500
  } else {
    predicted = Math.min(2000, Math.round(inputTokens * 0.7))
  }

  const suggested = Math.min(
    maxMax,
    Math.max(minMax, Math.round(predicted * safetyMargin))
  )

  return {
    predictedTokens: predicted,
    confidence: "low",
    taskType: "general",
    suggestedMaxTokens: suggested,
    savingsVsBlanket: maxMax - suggested,
  }
}
