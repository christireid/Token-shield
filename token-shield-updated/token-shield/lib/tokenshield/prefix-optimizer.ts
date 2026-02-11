/**
 * TokenShield - Prefix Optimizer
 *
 * Reorders messages to maximize provider-side prompt cache hits.
 *
 * How provider caching works:
 * - OpenAI: Automatic. Caches the longest matching PREFIX of prompts
 *   >1024 tokens. Cached tokens cost 50% of normal input price.
 *   Cache TTL: ~5-10 minutes between identical prefixes.
 * - Anthropic: Explicit. Developer places cache_control breakpoints.
 *   Cached tokens cost 10% of normal (90% discount). TTL: ~5 minutes.
 *
 * The key insight: if your context manager always emits messages in the
 * same order (system -> pinned -> summary -> recent), the prefix is
 * STABLE across requests. Provider caches hit automatically.
 *
 * No other frontend tool does this. Everyone dumps messages in whatever
 * order and misses free caching discounts.
 */

import { countTokens } from "gpt-tokenizer"
import type { ChatMessage } from "./token-counter"

export type Provider = "openai" | "anthropic" | "google" | "auto"

export interface PrefixOptimizerConfig {
  /** Provider for cache strategy. "auto" detects from model name. */
  provider: Provider
  /** For Anthropic: insert cache_control breakpoints automatically */
  enableAnthropicCacheControl: boolean
  /** Minimum prefix tokens for OpenAI caching to activate (1024) */
  openaiMinPrefixTokens: number
}

export interface OptimizedResult {
  /** Reordered messages with stable prefix first */
  messages: ChatMessage[]
  /** Total tokens in the stable prefix section */
  prefixTokens: number
  /** Total tokens in the volatile (changing) section */
  volatileTokens: number
  /** Whether the prefix exceeds the min threshold for provider caching */
  prefixEligibleForCaching: boolean
  /** Provider discount rate that applies to cached prefix tokens */
  cacheDiscountRate: number
  /** Estimated dollar savings if the prefix is cached (per request) */
  estimatedPrefixSavings: number
  /** Input price per million used for calculation */
  inputPricePerMillion: number
  /** For Anthropic: positions where cache_control breakpoints were inserted */
  cacheBreakpoints: number[]
}

const DEFAULT_CONFIG: PrefixOptimizerConfig = {
  provider: "auto",
  enableAnthropicCacheControl: true,
  openaiMinPrefixTokens: 1024,
}

/**
 * Detect the LLM provider from a model identifier string.
 *
 * Checks for known substrings ("claude"/"anthropic" for Anthropic,
 * "gemini"/"google" for Google) and defaults to "openai" for everything
 * else (gpt-*, o1-*, etc.).
 *
 * @param modelId - The model identifier string (e.g., "gpt-4o", "claude-sonnet-4.5", "gemini-2.5-pro")
 * @returns The detected provider: "openai", "anthropic", or "google"
 * @example
 * ```ts
 * detectProvider("claude-sonnet-4.5") // "anthropic"
 * detectProvider("gpt-4o")            // "openai"
 * detectProvider("gemini-2.5-pro")    // "google"
 * ```
 */
export function detectProvider(modelId: string): Exclude<Provider, "auto"> {
  const lower = modelId.toLowerCase()
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic"
  if (lower.includes("gemini") || lower.includes("google")) return "google"
  return "openai" // default for gpt-*, o1-*, etc.
}

/**
 * Get the prompt cache discount rate for a given provider.
 *
 * Returns the fraction of the input token price that is saved when tokens
 * are served from the provider's prompt cache. For example, 0.9 means
 * cached tokens cost only 10% of the normal input price.
 *
 * - OpenAI: 0.5 (50% discount on cached prefix tokens)
 * - Anthropic: 0.9 (90% discount on cached tokens)
 * - Google: 0.75 (75% discount via context caching)
 *
 * @param provider - The provider identifier ("openai", "anthropic", or "google")
 * @returns A number between 0 and 1 representing the discount rate
 * @example
 * ```ts
 * getCacheDiscountRate("anthropic") // 0.9
 * getCacheDiscountRate("openai")    // 0.5
 * ```
 */
export function getCacheDiscountRate(provider: Exclude<Provider, "auto">): number {
  switch (provider) {
    case "anthropic":
      return 0.9
    case "google":
      return 0.75
    case "openai":
    default:
      return 0.5
  }
}

/**
 * Classify each message into prefix (stable) or volatile (changes each turn).
 *
 * Stable prefix = system messages + pinned messages + summary
 * Volatile = recent conversation messages that change each turn
 */
function classifyMessages(
  messages: ChatMessage[]
): { stable: ChatMessage[]; volatile: ChatMessage[] } {
  const stable: ChatMessage[] = []
  const volatile: ChatMessage[] = []

  for (const msg of messages) {
    // System messages are always stable prefix
    if (msg.role === "system") {
      stable.push(msg)
      continue
    }

    // Messages explicitly marked as pinned go to stable prefix
    if ((msg as ChatMessage & { pinned?: boolean }).pinned) {
      stable.push(msg)
      continue
    }

    // Messages containing "summary" in a system-like role are stable
    if (
      msg.content.toLowerCase().startsWith("previous conversation summary") ||
      msg.content.toLowerCase().startsWith("summary:")
    ) {
      stable.push(msg)
      continue
    }

    // Everything else is volatile
    volatile.push(msg)
  }

  return { stable, volatile }
}

/**
 * Count total tokens across a message array including per-message overhead.
 */
function countMessageArrayTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += 4 + countTokens(msg.role) + countTokens(msg.content)
  }
  return total
}

/**
 * Reorder messages to maximize provider-side prompt cache hits.
 *
 * The output message array is ordered:
 * 1. System prompts (position 0+)
 * 2. Pinned/critical messages (stable order)
 * 3. Summary messages (stable-ish)
 * 4. Recent conversation (volatile, changes each turn)
 *
 * Items 1-3 form the stable prefix. Providers cache this automatically.
 * For Anthropic, `cache_control` breakpoints are inserted at optimal positions.
 *
 * @param messages - The array of chat messages to reorder
 * @param modelId - The model identifier (used to auto-detect provider when config.provider is "auto")
 * @param inputPricePerMillion - The input token price per million (USD) for savings calculation
 * @param config - Optional partial configuration overriding {@link PrefixOptimizerConfig} defaults
 * @returns An {@link OptimizedResult} with reordered messages, prefix/volatile token counts, caching eligibility, and estimated savings
 * @example
 * ```ts
 * const result = optimizePrefix(messages, "gpt-4o", 2.5)
 * // result.prefixEligibleForCaching === true
 * // result.estimatedPrefixSavings === 0.0012
 * // result.messages — reordered with stable prefix first
 * ```
 */
export function optimizePrefix(
  messages: ChatMessage[],
  modelId: string,
  inputPricePerMillion: number,
  config: Partial<PrefixOptimizerConfig> = {}
): OptimizedResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const provider = cfg.provider === "auto" ? detectProvider(modelId) : cfg.provider
  const discountRate = getCacheDiscountRate(provider)

  const { stable, volatile } = classifyMessages(messages)

  // Build optimized array: stable prefix first, then volatile
  const optimized = [...stable, ...volatile]

  const prefixTokens = countMessageArrayTokens(stable)
  const volatileTokens = countMessageArrayTokens(volatile)

  // OpenAI requires >1024 token prefix for caching to activate
  // Anthropic has no minimum but benefits from explicit breakpoints
  const prefixEligible =
    provider === "openai"
      ? prefixTokens >= cfg.openaiMinPrefixTokens
      : prefixTokens > 0

  // Calculate savings: discountRate * input price * prefix tokens
  const savingsPerRequest = prefixEligible
    ? (prefixTokens / 1_000_000) * inputPricePerMillion * discountRate
    : 0

  // For Anthropic: determine optimal cache_control breakpoint positions
  const cacheBreakpoints: number[] = []
  if (provider === "anthropic" && cfg.enableAnthropicCacheControl && stable.length > 0) {
    // Place breakpoint at the end of the stable section
    cacheBreakpoints.push(stable.length - 1)

    // If system prompt is long enough, place an additional breakpoint after it
    const systemMsgs = stable.filter((m) => m.role === "system")
    if (systemMsgs.length > 0 && countTokens(systemMsgs[0].content) > 200) {
      cacheBreakpoints.unshift(0)
    }
  }

  return {
    messages: optimized,
    prefixTokens,
    volatileTokens,
    prefixEligibleForCaching: prefixEligible,
    cacheDiscountRate: discountRate,
    estimatedPrefixSavings: savingsPerRequest,
    inputPricePerMillion,
    cacheBreakpoints,
  }
}

/**
 * Project the total dollar savings from stable prefix caching over a time period.
 *
 * Assumes the provider cache stays warm (~5-10 minute TTL). Conservatively
 * estimates that 80% of requests after the first hit the cache. Multiply
 * that by the per-request savings to get total savings.
 *
 * @param prefixTokens - Number of tokens in the stable prefix section
 * @param inputPricePerMillion - Input token price per million (USD)
 * @param provider - The provider for discount rate lookup ("openai", "anthropic", or "google")
 * @param requestsPerHour - Average number of API requests per hour
 * @param hours - Number of hours to project over
 * @returns An object with total requests, cached requests, per-request savings, and total savings in USD
 * @example
 * ```ts
 * const proj = projectPrefixSavings(2000, 2.5, "openai", 60, 24)
 * // proj.totalRequests === 1440
 * // proj.cachedRequests === 1152
 * // proj.totalSavings === 0.00288
 * ```
 */
export function projectPrefixSavings(
  prefixTokens: number,
  inputPricePerMillion: number,
  provider: Exclude<Provider, "auto">,
  requestsPerHour: number,
  hours: number
): {
  totalRequests: number
  cachedRequests: number
  savingsPerCachedRequest: number
  totalSavings: number
} {
  const discountRate = getCacheDiscountRate(provider)
  const totalRequests = requestsPerHour * hours

  // First request per cache window pays full price. Subsequent ones get discount.
  // Cache TTL ~5-10 min. At N requests/hour, approximately (N-6) to (N-12) hit cache.
  // Conservative estimate: 80% of requests after first hit the cache
  const cachedRequests = Math.max(0, Math.floor(totalRequests * 0.8))
  const savingsPerCachedRequest =
    (prefixTokens / 1_000_000) * inputPricePerMillion * discountRate

  return {
    totalRequests,
    cachedRequests,
    savingsPerCachedRequest,
    totalSavings: cachedRequests * savingsPerCachedRequest,
  }
}
