/**
 * token-shield — Model pricing data.
 *
 * Prices are in USD per 1 million tokens.
 * Sources: openai.com/api/pricing, anthropic.com/pricing, ai.google.dev/pricing
 *
 * Last updated: 2026-02-17
 */

export interface ModelPricing {
  id: string
  provider: string
  name: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
}

/**
 * Built-in pricing data for common models.
 * Extend with `registerModel()` for custom/fine-tuned models.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { id: "gpt-4o", provider: "openai", name: "GPT-4o", inputPerMillion: 2.5, outputPerMillion: 10, contextWindow: 128_000 },
  "gpt-4o-mini": { id: "gpt-4o-mini", provider: "openai", name: "GPT-4o Mini", inputPerMillion: 0.15, outputPerMillion: 0.6, contextWindow: 128_000 },
  "gpt-4.1": { id: "gpt-4.1", provider: "openai", name: "GPT-4.1", inputPerMillion: 2, outputPerMillion: 8, contextWindow: 1_048_576 },
  "gpt-4.1-mini": { id: "gpt-4.1-mini", provider: "openai", name: "GPT-4.1 Mini", inputPerMillion: 0.4, outputPerMillion: 1.6, contextWindow: 1_048_576 },
  "gpt-4.1-nano": { id: "gpt-4.1-nano", provider: "openai", name: "GPT-4.1 Nano", inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1_048_576 },
  "o3": { id: "o3", provider: "openai", name: "o3", inputPerMillion: 2, outputPerMillion: 8, contextWindow: 200_000 },
  "o3-mini": { id: "o3-mini", provider: "openai", name: "o3 Mini", inputPerMillion: 1.1, outputPerMillion: 4.4, contextWindow: 200_000 },
  "o4-mini": { id: "o4-mini", provider: "openai", name: "o4 Mini", inputPerMillion: 1.1, outputPerMillion: 4.4, contextWindow: 200_000 },
  "gpt-5": { id: "gpt-5", provider: "openai", name: "GPT-5", inputPerMillion: 2, outputPerMillion: 8, contextWindow: 128_000 },
  // Anthropic
  "claude-opus-4": { id: "claude-opus-4", provider: "anthropic", name: "Claude Opus 4", inputPerMillion: 15, outputPerMillion: 75, contextWindow: 200_000 },
  "claude-sonnet-4": { id: "claude-sonnet-4", provider: "anthropic", name: "Claude Sonnet 4", inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200_000 },
  "claude-sonnet-4.5": { id: "claude-sonnet-4.5", provider: "anthropic", name: "Claude Sonnet 4.5", inputPerMillion: 3, outputPerMillion: 15, contextWindow: 200_000 },
  "claude-haiku-3.5": { id: "claude-haiku-3.5", provider: "anthropic", name: "Claude Haiku 3.5", inputPerMillion: 0.8, outputPerMillion: 4, contextWindow: 200_000 },
  "claude-haiku-4.5": { id: "claude-haiku-4.5", provider: "anthropic", name: "Claude Haiku 4.5", inputPerMillion: 1, outputPerMillion: 5, contextWindow: 200_000 },
  // Google
  "gemini-2.5-pro": { id: "gemini-2.5-pro", provider: "google", name: "Gemini 2.5 Pro", inputPerMillion: 1.25, outputPerMillion: 10, contextWindow: 1_048_576 },
  "gemini-2.5-flash": { id: "gemini-2.5-flash", provider: "google", name: "Gemini 2.5 Flash", inputPerMillion: 0.15, outputPerMillion: 0.6, contextWindow: 1_048_576 },
  "gemini-2.0-flash": { id: "gemini-2.0-flash", provider: "google", name: "Gemini 2.0 Flash", inputPerMillion: 0.1, outputPerMillion: 0.4, contextWindow: 1_048_576 },
}

/**
 * Register a custom model in the pricing registry.
 * Overwrites any existing entry with the same id.
 */
export function registerModel(entry: ModelPricing): void {
  MODEL_PRICING[entry.id] = entry
}

/**
 * Look up pricing for a model. Returns undefined for unknown models.
 * Tries exact match first, then longest-prefix match.
 */
export function getModelPricing(modelId: string): ModelPricing | undefined {
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId]

  // Prefix match: "gpt-4o-2024-08-06" → "gpt-4o"
  let best: ModelPricing | undefined
  let bestLen = 0
  for (const entry of Object.values(MODEL_PRICING)) {
    if (modelId.startsWith(entry.id) && entry.id.length > bestLen) {
      best = entry
      bestLen = entry.id.length
    }
  }
  return best
}
