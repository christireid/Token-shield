/**
 * TokenShield - Model Router
 *
 * Routes requests to the cheapest model that can handle the task.
 * Uses a deterministic complexity scorer based on measurable text
 * features - no AI needed, no approximation.
 *
 * The idea: "What is the capital of France?" doesn't need GPT-5.2.
 * A $0.15/M model handles it identically. But "Analyze this contract
 * for liability risks and compare to Delaware law" does need a
 * more capable model.
 *
 * This scorer is based on real measurable signals, not vibes.
 */

import { countTokens } from "gpt-tokenizer"
import {
  MODEL_PRICING,
  type ModelPricing,
  estimateCost,
} from "./cost-estimator"

export interface ComplexitySignals {
  /** Raw token count of the prompt */
  tokenCount: number
  /** Average word length (longer words = more technical) */
  avgWordLength: number
  /** Sentence count */
  sentenceCount: number
  /** Ratio of unique words to total words (lexical diversity) */
  lexicalDiversity: number
  /** Number of code-related tokens (backticks, braces, etc) */
  codeSignals: number
  /** Number of reasoning keywords (analyze, compare, evaluate, etc) */
  reasoningKeywords: number
  /** Number of constraint keywords (must, exactly, always, never, etc) */
  constraintKeywords: number
  /** Whether it contains structured output requirements (JSON, XML, etc) */
  hasStructuredOutput: boolean
  /** Number of distinct sub-questions or tasks */
  subTaskCount: number
  /** Whether the prompt references prior context */
  hasContextDependency: boolean
}

export interface ComplexityScore {
  /** 0-100 composite score */
  score: number
  /** Human-readable tier */
  tier: "trivial" | "simple" | "moderate" | "complex" | "expert"
  /** The individual signals that contributed */
  signals: ComplexitySignals
  /** Recommended model tier */
  recommendedTier: ModelPricing["tier"]
}

export interface RoutingDecision {
  complexity: ComplexityScore
  selectedModel: ModelPricing
  fallbackModel: ModelPricing
  estimatedCost: ReturnType<typeof estimateCost>
  cheapestAlternativeCost: ReturnType<typeof estimateCost>
  savingsVsDefault: number
  /** Whether the selected model is from a different provider than the default */
  crossProvider: boolean
}

// Keyword sets for signal detection
const REASONING_KEYWORDS = new Set([
  "analyze",
  "analyse",
  "compare",
  "contrast",
  "evaluate",
  "assess",
  "critique",
  "synthesize",
  "infer",
  "deduce",
  "reason",
  "explain why",
  "pros and cons",
  "trade-off",
  "tradeoff",
  "implications",
  "consequences",
  "recommend",
  "justify",
  "argue",
  "debate",
  "differentiate",
  "distinguish",
])

const CONSTRAINT_KEYWORDS = new Set([
  "must",
  "exactly",
  "always",
  "never",
  "strictly",
  "precisely",
  "no more than",
  "at least",
  "required",
  "mandatory",
  "forbidden",
  "ensure",
  "guarantee",
  "constraint",
  "requirement",
  "specification",
])

const CODE_PATTERNS = /```|{|}|\bfunction\b|\bclass\b|\bimport\b|\bexport\b|\bconst\b|\blet\b|\bvar\b|\breturn\b|=>|\bif\s*\(|\bfor\s*\(/g

const STRUCTURED_OUTPUT_PATTERNS =
  /\bjson\b|\bxml\b|\byaml\b|\bcsv\b|\bschema\b|\bformat.*?as\b|\boutput.*?format\b|\breturn.*?object\b|\bstructured\b/i

const SUBTASK_PATTERNS =
  /^\s*[-*\d]+[.)]\s/gm

const CONTEXT_PATTERNS =
  /\babove\b|\bprevious\b|\bearlier\b|\bmentioned\b|\brefer.*?to\b|\bgiven\b|\bbased on\b/i

/** FIFO cache for analyzeComplexity — avoids re-running BPE + regex on identical prompts */
const MAX_COMPLEXITY_CACHE = 100
/** Skip caching prompts longer than this to prevent large memory consumption */
const MAX_CACHEABLE_PROMPT_LENGTH = 10_000
const complexityCache = new Map<string, ComplexityScore>()

/**
 * Analyze a prompt and return measurable complexity signals with a composite score.
 *
 * Every signal is computed from the actual text -- no guessing. The composite
 * score (0-100) is a weighted sum of token count, reasoning keywords, constraint
 * keywords, code signals, lexical diversity, structured output requirements,
 * sub-task count, and context dependency. Results are cached (FIFO, max 100
 * entries) for prompts under 10,000 characters.
 *
 * @param prompt - The user prompt text to analyze
 * @returns A {@link ComplexityScore} with the 0-100 score, tier, individual signals, and recommended model tier
 * @example
 * ```ts
 * const cx = analyzeComplexity("What is the capital of France?")
 * // cx.score === 12
 * // cx.tier === "trivial"
 * // cx.recommendedTier === "budget"
 * ```
 */
export function analyzeComplexity(prompt: string): ComplexityScore {
  const cached = complexityCache.get(prompt)
  if (cached) return cached
  const words = prompt.split(/\s+/).filter((w) => w.length > 0)
  const wordCount = words.length
  const sentences = prompt.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()))
  const lowerPrompt = prompt.toLowerCase()

  const signals: ComplexitySignals = {
    tokenCount: countTokens(prompt),
    avgWordLength:
      wordCount > 0
        ? words.reduce((sum, w) => sum + w.length, 0) / wordCount
        : 0,
    sentenceCount: sentences.length,
    lexicalDiversity:
      wordCount > 0 ? uniqueWords.size / wordCount : 0,
    codeSignals: (prompt.match(CODE_PATTERNS) || []).length,
    reasoningKeywords: [...REASONING_KEYWORDS].filter((kw) =>
      lowerPrompt.includes(kw)
    ).length,
    constraintKeywords: [...CONSTRAINT_KEYWORDS].filter((kw) =>
      lowerPrompt.includes(kw)
    ).length,
    hasStructuredOutput: STRUCTURED_OUTPUT_PATTERNS.test(prompt),
    subTaskCount: (prompt.match(SUBTASK_PATTERNS) || []).length,
    hasContextDependency: CONTEXT_PATTERNS.test(prompt),
  }

  // Weighted composite score (0-100)
  let score = 0

  // Token count contribution (0-25 points)
  // <50 tokens = trivial, 50-200 = moderate, 200-500 = complex, 500+ = expert
  score += Math.min(25, (signals.tokenCount / 500) * 25)

  // Reasoning keywords (0-20 points)
  score += Math.min(20, signals.reasoningKeywords * 5)

  // Constraint keywords (0-10 points)
  score += Math.min(10, signals.constraintKeywords * 2.5)

  // Code signals (0-15 points)
  score += Math.min(15, signals.codeSignals * 1.5)

  // Lexical diversity (0-10 points)
  // Higher diversity = more complex vocabulary
  score += signals.lexicalDiversity * 10

  // Structured output requirement (5 points)
  if (signals.hasStructuredOutput) score += 5

  // Sub-tasks (0-10 points)
  score += Math.min(10, signals.subTaskCount * 3)

  // Context dependency (5 points)
  if (signals.hasContextDependency) score += 5

  score = Math.min(100, Math.round(score))

  let tier: ComplexityScore["tier"]
  let recommendedTier: ModelPricing["tier"]

  if (score <= 15) {
    tier = "trivial"
    recommendedTier = "budget"
  } else if (score <= 35) {
    tier = "simple"
    recommendedTier = "budget"
  } else if (score <= 55) {
    tier = "moderate"
    recommendedTier = "standard"
  } else if (score <= 75) {
    tier = "complex"
    recommendedTier = "premium"
  } else {
    tier = "expert"
    recommendedTier = "flagship"
  }

  const result: ComplexityScore = { score, tier, signals, recommendedTier }

  // Store in LRU cache; evict oldest entry when at capacity
  // Only cache short prompts to prevent memory bloat from very long inputs
  if (prompt.length <= MAX_CACHEABLE_PROMPT_LENGTH) {
    complexityCache.set(prompt, result)
    if (complexityCache.size > MAX_COMPLEXITY_CACHE) {
      const oldest = complexityCache.keys().next().value
      if (oldest !== undefined) complexityCache.delete(oldest)
    }
  }

  return result
}

/**
 * Route a prompt to the cheapest model that meets its complexity requirements.
 *
 * Analyzes the prompt's complexity, determines the minimum model tier needed,
 * filters available models by provider and tier, and selects the cheapest
 * candidate. Also reports how much money is saved compared to the default model.
 *
 * @param prompt - The user prompt text to route
 * @param defaultModelId - The model you would normally use (for savings comparison)
 * @param options - Optional routing constraints
 * @param options.allowedProviders - Only consider models from these providers (e.g., ["openai", "anthropic"])
 * @param options.minTier - Override the minimum model tier (defaults to the complexity-recommended tier)
 * @param options.expectedOutputTokens - Expected output tokens for cost comparison (defaults to 500)
 * @returns A {@link RoutingDecision} with the selected model, fallback, estimated cost, and savings
 * @example
 * ```ts
 * const decision = routeToModel("What is 2+2?", "gpt-4o")
 * // decision.selectedModel.name === "GPT-4.1 Nano"
 * // decision.savingsVsDefault === 0.0024
 * ```
 */
export function routeToModel(
  prompt: string,
  defaultModelId: string,
  options: {
    /** Only consider models from these providers */
    allowedProviders?: ModelPricing["provider"][]
    /** Override the minimum tier */
    minTier?: ModelPricing["tier"]
    /** Expected output tokens (for cost comparison) */
    expectedOutputTokens?: number
    /**
     * Enable cross-provider routing. When true (default), the router considers
     * models from all providers. When false, only routes within the default
     * model's provider. Set to false if your code depends on provider-specific
     * response formats or features (e.g., Anthropic cache_control).
     */
    crossProvider?: boolean
    /**
     * Minimum context window required. Filters out models whose context window
     * is smaller than this value. Useful when routing long-context requests.
     */
    minContextWindow?: number
    /**
     * Required capabilities. When set, only models that support these features
     * are considered. Skips models that don't match.
     */
    requiredCapabilities?: {
      vision?: boolean
      functions?: boolean
    }
  } = {}
): RoutingDecision {
  const complexity = analyzeComplexity(prompt)
  const expectedOutput = options.expectedOutputTokens ?? 500
  const enableCrossProvider = options.crossProvider ?? true

  const tierOrder: Record<ModelPricing["tier"], number> = {
    budget: 0,
    standard: 1,
    premium: 2,
    flagship: 3,
  }

  const minTier = options.minTier ?? complexity.recommendedTier
  const minTierNum = tierOrder[minTier]

  // Determine the default model's provider for same-provider filtering
  const defaultModel = MODEL_PRICING[defaultModelId]
  const defaultProvider = defaultModel?.provider

  // Filter models by criteria
  const candidates = Object.values(MODEL_PRICING).filter((m) => {
    // Explicit provider filter takes highest priority
    if (options.allowedProviders && !options.allowedProviders.includes(m.provider)) {
      return false
    }
    // When cross-provider is disabled, restrict to same provider as default
    if (!enableCrossProvider && defaultProvider && m.provider !== defaultProvider) {
      return false
    }
    // Tier filter
    if (tierOrder[m.tier] < minTierNum) return false
    // Context window filter
    if (options.minContextWindow && m.contextWindow < options.minContextWindow) return false
    // Capability filters — use pricing registry for richer metadata
    if (options.requiredCapabilities) {
      const registryEntry = PRICING_REGISTRY_LOOKUP(m.id)
      if (options.requiredCapabilities.vision && registryEntry && !registryEntry.supportsVision) return false
      if (options.requiredCapabilities.functions && registryEntry && !registryEntry.supportsFunctions) return false
    }
    return true
  })

  // Sort by total cost (cheapest first)
  const sorted = candidates
    .map((m) => ({
      model: m,
      cost: estimateCost(m.id, complexity.signals.tokenCount, expectedOutput),
    }))
    .sort((a, b) => a.cost.totalCost - b.cost.totalCost)

  const defaultCost = estimateCost(
    defaultModelId,
    complexity.signals.tokenCount,
    expectedOutput
  )

  // If no candidates match the filter, fall back to the default model
  if (sorted.length === 0) {
    const fallbackModel = MODEL_PRICING[defaultModelId] ?? Object.values(MODEL_PRICING)[0]
    return {
      complexity,
      selectedModel: fallbackModel,
      fallbackModel: fallbackModel,
      estimatedCost: defaultCost,
      cheapestAlternativeCost: defaultCost,
      savingsVsDefault: 0,
      crossProvider: false,
    }
  }

  const selected = sorted[0]
  const fallback =
    sorted.find((s) => tierOrder[s.model.tier] > tierOrder[selected.model.tier]) ??
    sorted[sorted.length - 1]

  return {
    complexity,
    selectedModel: selected.model,
    fallbackModel: fallback.model,
    estimatedCost: selected.cost,
    cheapestAlternativeCost: selected.cost,
    savingsVsDefault: defaultCost.totalCost - selected.cost.totalCost,
    crossProvider: defaultProvider !== undefined && selected.model.provider !== defaultProvider,
  }
}

/** Lazy import helper for pricing registry capabilities lookup */
function PRICING_REGISTRY_LOOKUP(modelId: string): { supportsVision: boolean; supportsFunctions: boolean } | undefined {
  try {
    // Access the pricing registry for richer metadata (vision, functions)
    const { PRICING_REGISTRY } = require("./pricing-registry")
    return PRICING_REGISTRY[modelId]
  } catch {
    return undefined
  }
}

/**
 * Rank all available models by total cost for a given token usage.
 *
 * Returns every model in {@link MODEL_PRICING} paired with its cost estimate,
 * sorted from cheapest to most expensive. Useful for displaying model
 * comparison tables or picking a model within a budget.
 *
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @returns An array of objects with `model` and `cost` fields, sorted by ascending total cost
 * @example
 * ```ts
 * const ranked = rankModels(2000, 500)
 * console.log(ranked[0].model.name)    // cheapest model name
 * console.log(ranked[0].cost.totalCost) // its cost in USD
 * ```
 */
export function rankModels(
  inputTokens: number,
  outputTokens: number
): { model: ModelPricing; cost: ReturnType<typeof estimateCost> }[] {
  return Object.values(MODEL_PRICING)
    .map((m) => ({
      model: m,
      cost: estimateCost(m.id, inputTokens, outputTokens),
    }))
    .sort((a, b) => a.cost.totalCost - b.cost.totalCost)
}
