/**
 * TokenShield - Output Token Prediction
 *
 * Predicts the number of output tokens a model will generate for a given prompt.
 * Uses task-type detection (factual Q&A, classification, code generation, etc.)
 * and input length correlation to estimate output length. Enables more accurate
 * pre-call cost estimates and smarter `max_tokens` values instead of blanket 4096.
 *
 * Based on research from ACL 2025 "Predicting Remaining Output Length"
 * and empirical data from the glukhov.org cost optimization guide.
 */

import { countTokens } from "gpt-tokenizer"

// -------------------------------------------------------
// Types
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

// -------------------------------------------------------
// Task Patterns
// -------------------------------------------------------

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

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

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
/**
 * Model-specific output multipliers. Different models tend to produce
 * different output lengths for the same prompt. These are empirically
 * derived from published benchmarks and community observations.
 */
const MODEL_OUTPUT_MULTIPLIERS: Record<string, number> = {
  // @generated:start — DO NOT EDIT. Run `npm run sync-pricing` to regenerate from data/models.json
  // OpenAI
  "gpt-4o": 1,
  "gpt-4o-mini": 0.9,
  "gpt-4.1": 1,
  "gpt-4.1-mini": 0.85,
  "gpt-4.1-nano": 0.75,
  "o1": 1.4,
  "o3": 1.3,
  "o3-pro": 1.5,
  "o4-mini": 1.1,
  "gpt-5": 1.05,
  "gpt-5.2": 1.1,
  "gpt-5-mini": 0.9,
  "gpt-5-nano": 0.75,
  // Anthropic
  "claude-opus-4": 1.3,
  "claude-opus-4.5": 1.3,
  "claude-opus-4.6": 1.3,
  "claude-sonnet-4": 1.2,
  "claude-sonnet-4.5": 1.2,
  "claude-haiku-3.5": 0.95,
  "claude-haiku-4.5": 0.95,
  // Google
  "gemini-2.5-pro": 1.15,
  "gemini-2.5-flash": 0.9,
  "gemini-2.5-flash-lite": 0.85,
  "gemini-3-pro": 1.15,
  "gemini-3-flash": 0.9,
  // @generated:end
}

/**
 * Secondary instruction signals that modify predicted output length.
 * These patterns detect explicit instructions about output length/format.
 */
const LENGTH_MODIFIERS: { pattern: RegExp; multiplier: number }[] = [
  // Brevity instructions
  { pattern: /\b(brief|concise|short|one[- ]?word|one[- ]?sentence|terse)\b/i, multiplier: 0.3 },
  { pattern: /\b(in \d+ words?|under \d+ words?|max \d+ words?)\b/i, multiplier: 0.5 },
  { pattern: /\b(yes or no|true or false|one word)\b/i, multiplier: 0.1 },
  // Verbosity instructions
  { pattern: /\b(detailed|thorough|comprehensive|in[- ]?depth|extensive|elaborate on)\b/i, multiplier: 1.8 },
  { pattern: /\b(step[- ]?by[- ]?step|walk me through|explain in detail)\b/i, multiplier: 1.6 },
  { pattern: /\b(write|draft|compose|create)\b.*\b(essay|article|report|whitepaper|document)\b/i, multiplier: 2.0 },
  // Multi-part output instructions
  { pattern: /\b(with examples?|include examples?|provide examples?)\b/i, multiplier: 1.4 },
  { pattern: /\b(pros and cons|advantages and disadvantages|for and against)\b/i, multiplier: 1.5 },
]

export function predictOutputTokens(
  prompt: string,
  options: {
    /** Safety margin multiplier (default 1.5x) */
    safetyMargin?: number
    /** Hard minimum for max_tokens */
    minMaxTokens?: number
    /** Hard maximum for max_tokens */
    maxMaxTokens?: number
    /** Model ID for model-specific adjustments */
    modelId?: string
  } = {}
): OutputPrediction {
  const safetyMargin = options.safetyMargin ?? 1.5
  const minMax = options.minMaxTokens ?? 50
  const maxMax = options.maxMaxTokens ?? 4096
  const inputTokens = countTokens(prompt)

  // Model-specific output multiplier
  const modelMultiplier = options.modelId
    ? getModelMultiplier(options.modelId)
    : 1.0

  // Try to match against known task patterns
  for (const task of TASK_PATTERNS) {
    if (task.pattern.test(prompt)) {
      let predicted = task.avgTokens

      // Translation: output length roughly proportional to input
      if (task.type === "translation") {
        predicted = Math.round(inputTokens * 1.2)
      }

      // Only apply length modifiers for general/analysis tasks where the
      // modifier is clearly a separate instruction. For task-specific patterns
      // (classification, summarization, etc.), the avgTokens already reflects
      // the expected output length for that task type.
      const lengthModifier = (task.type === "general" || task.type === "analysis" || task.type === "code-generation")
        ? detectLengthModifier(prompt)
        : 1.0

      // Apply multi-signal adjustments
      predicted = applySignalAdjustments(predicted, inputTokens, modelMultiplier, lengthModifier, task.type)

      const suggested = Math.min(
        maxMax,
        Math.max(minMax, Math.round(predicted * safetyMargin))
      )

      // Boost confidence when length modifier confirms the task pattern
      const confidence = lengthModifier !== 1.0 && task.confidence === "medium" ? "medium" : task.confidence

      return {
        predictedTokens: predicted,
        confidence,
        taskType: task.type,
        suggestedMaxTokens: suggested,
        savingsVsBlanket: maxMax - suggested,
      }
    }
  }

  // Fallback: multi-signal estimation based on input characteristics
  let predicted = estimateFromInputSignals(prompt, inputTokens)

  // Detect length modifiers from the prompt (always apply for general tasks)
  const lengthModifier = detectLengthModifier(prompt)

  // Apply adjustments
  predicted = applySignalAdjustments(predicted, inputTokens, modelMultiplier, lengthModifier, "general")

  const suggested = Math.min(
    maxMax,
    Math.max(minMax, Math.round(predicted * safetyMargin))
  )

  // Boost confidence from low to medium if we have strong length modifier signals
  const confidence = lengthModifier !== 1.0 ? "medium" : "low"

  return {
    predictedTokens: predicted,
    confidence,
    taskType: "general",
    suggestedMaxTokens: suggested,
    savingsVsBlanket: maxMax - suggested,
  }
}

/**
 * Multi-signal estimation for general prompts that don't match task patterns.
 * Combines input length, question complexity, and instruction density.
 */
function estimateFromInputSignals(prompt: string, inputTokens: number): number {
  // Base estimate from input length
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

  // Signal: Question mark density — more questions = longer answer
  const questionMarks = (prompt.match(/\?/g) ?? []).length
  if (questionMarks > 1) {
    predicted = Math.round(predicted * (1 + questionMarks * 0.15))
  }

  // Signal: Numbered/bulleted requirements — more structure = longer output
  const numberedItems = (prompt.match(/^\s*[-*\d]+[.)]\s/gm) ?? []).length
  if (numberedItems > 2) {
    predicted = Math.round(predicted * (1 + numberedItems * 0.1))
  }

  // Signal: Code context provided — usually expects code back
  const hasCodeBlock = /```[\s\S]*```/.test(prompt)
  if (hasCodeBlock) {
    predicted = Math.max(predicted, 300)
  }

  return Math.min(2000, predicted)
}

/** Get model-specific output multiplier with prefix fallback */
function getModelMultiplier(modelId: string): number {
  if (MODEL_OUTPUT_MULTIPLIERS[modelId]) return MODEL_OUTPUT_MULTIPLIERS[modelId]
  // Prefix match for variants (e.g., "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, value] of Object.entries(MODEL_OUTPUT_MULTIPLIERS)) {
    if (modelId.startsWith(key)) return value
  }
  return 1.0
}

/** Detect explicit length modifiers in the prompt */
function detectLengthModifier(prompt: string): number {
  let modifier = 1.0
  for (const { pattern, multiplier } of LENGTH_MODIFIERS) {
    if (pattern.test(prompt)) {
      // Use the most extreme modifier (don't stack them)
      if (Math.abs(multiplier - 1.0) > Math.abs(modifier - 1.0)) {
        modifier = multiplier
      }
    }
  }
  return modifier
}

/** Apply model multiplier and length modifier to a base prediction */
function applySignalAdjustments(
  predicted: number,
  _inputTokens: number,
  modelMultiplier: number,
  lengthModifier: number,
  _taskType: string
): number {
  let adjusted = predicted

  // Apply length modifier (explicit instructions trump defaults)
  if (lengthModifier !== 1.0) {
    adjusted = Math.round(adjusted * lengthModifier)
  }

  // Apply model multiplier
  adjusted = Math.round(adjusted * modelMultiplier)

  // Ensure minimum reasonable output
  return Math.max(5, adjusted)
}
