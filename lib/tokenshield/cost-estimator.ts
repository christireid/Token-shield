import { TokenShieldConfigError } from "./errors"
import { PRICING_REGISTRY, type ModelPricingEntry } from "./pricing-registry"

/**
 * TokenShield - Cost Estimator
 *
 * Real pricing data for major LLM providers as of February 2026.
 * Prices are in USD per 1 million tokens.
 * Sources: openai.com/api/pricing, anthropic.com/pricing, ai.google.dev/pricing
 *
 * Single source of truth: PRICING_REGISTRY (pricing-registry.ts)
 * MODEL_PRICING is derived from PRICING_REGISTRY for backward compatibility.
 */

export interface ModelPricing {
  id: string
  provider: "openai" | "anthropic" | "google" | "xai" | "meta"
  name: string
  inputPerMillion: number
  outputPerMillion: number
  cachedInputPerMillion?: number
  contextWindow: number
  tier: "budget" | "standard" | "premium" | "flagship"
}

/**
 * Derive a ModelPricing entry from the richer PRICING_REGISTRY format.
 */
function toModelPricing(entry: ModelPricingEntry): ModelPricing {
  const cachedInputPerMillion =
    entry.cachedInputDiscount > 0 && entry.cachedInputDiscount < 1
      ? entry.inputPerMillion * entry.cachedInputDiscount
      : undefined
  return {
    id: entry.id,
    provider: entry.provider as ModelPricing["provider"],
    name: entry.name,
    inputPerMillion: entry.inputPerMillion,
    outputPerMillion: entry.outputPerMillion,
    cachedInputPerMillion,
    contextWindow: entry.contextWindow,
    tier: inferTier(entry.inputPerMillion),
  }
}

function inferTier(inputPerMillion: number): ModelPricing["tier"] {
  if (inputPerMillion >= 10) return "flagship"
  if (inputPerMillion >= 2) return "premium"
  if (inputPerMillion >= 1) return "standard"
  return "budget"
}

/**
 * MODEL_PRICING derived from PRICING_REGISTRY — single source of truth.
 * Backward-compatible shape used by estimateCost, compareCosts, etc.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(PRICING_REGISTRY).map(([id, entry]) => [id, toModelPricing(entry)]),
)

/**
 * Union of all model IDs with built-in pricing data.
 * Provides IDE autocomplete for model selection while still
 * accepting arbitrary strings for custom/fine-tuned models.
 */
export type KnownModelId = keyof typeof MODEL_PRICING

export interface CostEstimate {
  model: ModelPricing
  inputTokens: number
  outputTokens: number
  inputCost: number
  outputCost: number
  totalCost: number
  cachedInputCost?: number
  totalWithCache?: number
}

/**
 * Calculate the exact USD cost of an API request given token counts and model.
 *
 * Uses the per-million pricing from {@link MODEL_PRICING} to compute input cost,
 * output cost, and (if available) the discounted cost when prompt caching is active.
 *
 * @param modelId - The model identifier (must exist in MODEL_PRICING)
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @returns A {@link CostEstimate} with per-component and total costs
 * @throws Error if `modelId` is not found in MODEL_PRICING
 * @example
 * ```ts
 * const cost = estimateCost("gpt-4o", 1000, 500)
 * // cost.totalCost === 0.0075
 * // cost.totalWithCache === 0.00625
 * ```
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  const model = MODEL_PRICING[modelId]
  if (!model) {
    const modelCount = Object.keys(MODEL_PRICING).length
    throw new TokenShieldConfigError(
      `Unknown model: "${modelId}". ${modelCount} models available — use MODEL_PRICING to list them, or use safeCost() for automatic fallback pricing.`,
    )
  }

  // Clamp negative token counts to zero to prevent negative costs
  const safeInput = Math.max(0, inputTokens)
  const safeOutput = Math.max(0, outputTokens)

  const inputCost = (safeInput / 1_000_000) * model.inputPerMillion
  const outputCost = (safeOutput / 1_000_000) * model.outputPerMillion

  const result: CostEstimate = {
    model,
    inputTokens: safeInput,
    outputTokens: safeOutput,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  }

  if (model.cachedInputPerMillion !== undefined) {
    result.cachedInputCost = (safeInput / 1_000_000) * model.cachedInputPerMillion
    result.totalWithCache = result.cachedInputCost + outputCost
  }

  return result
}

/**
 * Compare the cost of the same request across all available models.
 *
 * Calculates the cost for every model in {@link MODEL_PRICING} and returns
 * the results sorted from cheapest to most expensive.
 *
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @returns An array of {@link CostEstimate} objects sorted by ascending total cost
 * @example
 * ```ts
 * const ranked = compareCosts(5000, 1000)
 * console.log(ranked[0].model.name) // cheapest model
 * console.log(ranked[0].totalCost)  // its cost in USD
 * ```
 */
export function compareCosts(inputTokens: number, outputTokens: number): CostEstimate[] {
  return Object.keys(MODEL_PRICING)
    .map((modelId) => estimateCost(modelId, inputTokens, outputTokens))
    .sort((a, b) => a.totalCost - b.totalCost)
}

/**
 * Calculate the dollar savings from reducing input token count on a given model.
 *
 * Compares the cost before and after token reduction and returns the absolute
 * dollar savings, percentage saved, and the number of tokens removed.
 *
 * @param modelId - The model identifier (must exist in MODEL_PRICING)
 * @param originalInputTokens - Input token count before optimization
 * @param reducedInputTokens - Input token count after optimization
 * @param outputTokens - Number of output (completion) tokens (same for both)
 * @returns An object with original/reduced costs, dollar savings, percentage saved, and tokens saved
 * @throws Error if `modelId` is not found in MODEL_PRICING
 * @example
 * ```ts
 * const savings = calculateSavings("gpt-4o", 10000, 5000, 500)
 * // savings.savedDollars === 0.0125
 * // savings.savedPercent === 45.45
 * // savings.tokensSaved === 5000
 * ```
 */
export function calculateSavings(
  modelId: string,
  originalInputTokens: number,
  reducedInputTokens: number,
  outputTokens: number,
): {
  originalCost: CostEstimate
  reducedCost: CostEstimate
  savedDollars: number
  savedPercent: number
  tokensSaved: number
} {
  const originalCost = estimateCost(modelId, originalInputTokens, outputTokens)
  const reducedCost = estimateCost(modelId, reducedInputTokens, outputTokens)
  const savedDollars = originalCost.totalCost - reducedCost.totalCost
  const savedPercent =
    originalCost.totalCost > 0 ? (savedDollars / originalCost.totalCost) * 100 : 0

  return {
    originalCost,
    reducedCost,
    savedDollars,
    savedPercent,
    tokensSaved: originalInputTokens - reducedInputTokens,
  }
}

/**
 * Find the cheapest model whose total request cost does not exceed a budget.
 *
 * Evaluates all models in {@link MODEL_PRICING}, sorted by total cost, and
 * returns the first one that fits within `maxCostPerRequest`. Returns `null`
 * if no model is cheap enough.
 *
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @param maxCostPerRequest - Maximum allowed cost in USD per request
 * @returns The cheapest {@link CostEstimate} within budget, or `null` if none qualifies
 * @example
 * ```ts
 * const pick = cheapestModelForBudget(50000, 2000, 0.01)
 * if (pick) console.log(pick.model.name) // e.g. "GPT-4.1 Nano"
 * ```
 */
export function cheapestModelForBudget(
  inputTokens: number,
  outputTokens: number,
  maxCostPerRequest: number,
): CostEstimate | null {
  const costs = compareCosts(inputTokens, outputTokens)
  return costs.find((c) => c.totalCost <= maxCostPerRequest) ?? null
}

/**
 * Project daily, monthly, and yearly costs based on average request volume.
 *
 * Multiplies the per-request cost by the daily request count and extrapolates
 * to 30-day and 365-day projections.
 *
 * @param modelId - The model identifier (must exist in MODEL_PRICING)
 * @param avgInputTokens - Average input tokens per request
 * @param avgOutputTokens - Average output tokens per request
 * @param requestsPerDay - Average number of API requests per day
 * @returns An object with daily, monthly (30d), and yearly (365d) cost projections, plus the per-request cost
 * @throws Error if `modelId` is not found in MODEL_PRICING
 * @example
 * ```ts
 * const projection = projectMonthlyCost("gpt-4o-mini", 2000, 500, 1000)
 * // projection.dailyCost === 0.60
 * // projection.monthlyCost === 18.0
 * // projection.yearlyProjection === 219.0
 * ```
 */
export function projectMonthlyCost(
  modelId: string,
  avgInputTokens: number,
  avgOutputTokens: number,
  requestsPerDay: number,
): {
  dailyCost: number
  monthlyCost: number
  yearlyProjection: number
  costPerRequest: CostEstimate
} {
  const costPerRequest = estimateCost(modelId, avgInputTokens, avgOutputTokens)
  const dailyCost = costPerRequest.totalCost * requestsPerDay
  return {
    dailyCost,
    monthlyCost: dailyCost * 30,
    yearlyProjection: dailyCost * 365,
    costPerRequest,
  }
}
