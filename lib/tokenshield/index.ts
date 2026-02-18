/**
 * TokenShield SDK
 *
 * Drop-in middleware that reduces AI API costs without changing your prompts.
 * Works with Vercel AI SDK, OpenAI, and Anthropic.
 *
 * @example Quick start (zero-config)
 * ```ts
 * import { wrapLanguageModel } from "ai"
 * import { shield } from "@tokenshield/ai-sdk"
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4o"),
 *   middleware: shield(),
 * })
 * ```
 *
 * @example With budget enforcement
 * ```ts
 * const middleware = shield({
 *   cache: true,
 *   compression: true,
 *   monthlyBudget: 500,
 *   onUsage: (e) => console.log(`$${e.cost.toFixed(4)} spent`),
 * })
 * ```
 *
 * For advanced/standalone module usage, import from "@tokenshield/ai-sdk/advanced".
 * For React hooks, import from "@tokenshield/ai-sdk/react".
 */

// -------------------------------------------------------
// Primary API — the recommended entry point
// -------------------------------------------------------

export { shield, getStats, type ShieldConfig, type ShieldStats } from "./shield"

// -------------------------------------------------------
// Full-control API — for users who need explicit configuration
// -------------------------------------------------------

export {
  tokenShieldMiddleware,
  getLedger,
  type TokenShieldMiddleware,
  type TokenShieldMiddlewareConfig,
} from "./middleware"

export { createTokenShield, type CreateTokenShieldOptions } from "./create-token-shield"

// -------------------------------------------------------
// Framework Adapters — for non-Vercel AI SDK usage
// -------------------------------------------------------

export { createOpenAIAdapter, createAnthropicAdapter } from "./adapters"

// -------------------------------------------------------
// Cost Utility
// -------------------------------------------------------

export { estimateCost, type CostEstimate } from "./cost-estimator"

// -------------------------------------------------------
// Storage — for custom cache persistence
// -------------------------------------------------------

export { type StorageBackend } from "./storage-adapter"
