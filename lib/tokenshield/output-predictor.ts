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
    pattern:
      /\b(write|create|implement|build|code|function|class|component)\b.*\b(code|function|class|program|script|component)\b/i,
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
export function predictOutputTokens(
  prompt: string,
  options: {
    /** Safety margin multiplier (default 1.5x) */
    safetyMargin?: number
    /** Hard minimum for max_tokens */
    minMaxTokens?: number
    /** Hard maximum for max_tokens */
    maxMaxTokens?: number
  } = {},
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

      const suggested = Math.min(maxMax, Math.max(minMax, Math.round(predicted * safetyMargin)))

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

  const suggested = Math.min(maxMax, Math.max(minMax, Math.round(predicted * safetyMargin)))

  return {
    predictedTokens: predicted,
    confidence: "low",
    taskType: "general",
    suggestedMaxTokens: suggested,
    savingsVsBlanket: maxMax - suggested,
  }
}
