/**
 * TokenShield SDK
 *
 * Frontend-only React/TypeScript toolkit for reducing AI/LLM token expenses.
 * Every module uses exact token counting (gpt-tokenizer BPE),
 * real provider pricing data, and deterministic algorithms.
 *
 * 11 Modules:
 *  1. token-counter      - Exact BPE token counting (matches OpenAI's tiktoken)
 *  2. cost-estimator     - Real pricing from OpenAI, Anthropic, Google
 *  3. context-manager    - Token-budget-aware conversation history management
 *  4. response-cache     - Client-side exact + fuzzy response caching (IndexedDB)
 *  5. model-router       - Complexity-based routing to cheapest capable model
 *  6. request-guard      - Debounce, dedup, rate limit, cost gate
 *  7. prefix-optimizer   - Message ordering for provider prompt cache hits
 *  8. cost-ledger        - Real usage tracking with per-module attribution
 *  9. tool-token-counter - Hidden tool/function definition token overhead + image tokens + output prediction
 * 10. stream-tracker     - Real-time output token counting during streaming (survives abort)
 * 11. circuit-breaker    - Session/hourly/daily spending limits with hard-stop protection
 *
 * Plus:
 * - AI SDK Middleware   - Drop-in LanguageModelV3Middleware for Vercel AI SDK
 * - React Integration   - Provider, hooks, and real-time cost tracking
 *
 * npm deps: gpt-tokenizer (BPE encoding), idb-keyval (IndexedDB persistence)
 */

// 1. Token Counter
export {
  countExactTokens,
  countChatTokens,
  countFast,
  fitsInBudget,
  encodeText,
  decodeTokens,
  truncateToTokenBudget,
  countModelTokens,
  type ChatMessage,
  type TokenCount,
  type ChatTokenCount,
} from "./token-counter"

// 2. Cost Estimator
export {
  estimateCost,
  compareCosts,
  calculateSavings,
  cheapestModelForBudget,
  projectMonthlyCost,
  MODEL_PRICING,
  type ModelPricing,
  type CostEstimate,
} from "./cost-estimator"

// 3. Context Manager
export {
  fitToBudget,
  slidingWindow,
  priorityFit,
  smartFit,
  createSummaryMessage,
  type Message,
  type ContextBudget,
  type ContextResult,
} from "./context-manager"

// 4. Response Cache
export {
  ResponseCache,
  normalizeText,
  textSimilarity,
  type CacheEntry,
  type CacheConfig,
} from "./response-cache"

// 5. Model Router
export {
  analyzeComplexity,
  routeToModel,
  rankModels,
  type ComplexitySignals,
  type ComplexityScore,
  type RoutingDecision,
} from "./model-router"

// 6. Request Guard
export {
  RequestGuard,
  type GuardConfig,
  type GuardResult,
} from "./request-guard"

// 7. Prefix Optimizer
export {
  optimizePrefix,
  detectProvider,
  getCacheDiscountRate,
  projectPrefixSavings,
  type PrefixOptimizerConfig,
  type OptimizedResult,
  type Provider,
} from "./prefix-optimizer"

// 8. Cost Ledger (CostLedger class includes exportJSON() and exportCSV() methods)
export {
  CostLedger,
  type LedgerEntry,
  type LedgerSummary,
  type ModuleSavings,
} from "./cost-ledger"

// 9. Tool / Image / Output Token Counter
export {
  countToolTokens,
  optimizeToolDefinitions,
  countImageTokens,
  predictOutputTokens,
  type ToolDefinition,
  type ToolParameter,
  type ToolTokenResult,
  type ImageTokenResult,
  type OutputPrediction,
} from "./tool-token-counter"

// 10. Streaming Token Tracker
export {
  StreamTokenTracker,
  type StreamUsage,
  type StreamTrackerConfig,
} from "./stream-tracker"

// 11. Cost Circuit Breaker
export {
  CostCircuitBreaker,
  type BreakerLimits,
  type BreakerConfig,
  type BreakerEvent,
  type BreakerStatus,
  type BreakerCheckResult,
} from "./circuit-breaker"

// AI SDK Middleware
export {
  tokenShieldMiddleware,
  TokenShieldBlockedError,
  getLedger,
  type TokenShieldMiddlewareConfig,
} from "./middleware"

// React Integration
export {
  TokenShieldProvider,
  useSavings,
  useTokenCount,
  useBudgetAlert,
  useTokenEstimate,
  useComplexityAnalysis,
  useContextManager,
  useResponseCache,
  useRequestGuard,
  useModelRouter,
  useCostLedger,
  useFeatureCost,
  type TokenShieldProviderProps,
} from "./react"

// Pricing Registry
export {
  PRICING_REGISTRY,
  registerModel,
  getModelPricing,
  getModelsByProvider,
  type ModelPricingEntry,
} from "./pricing-registry"

// Event Bus
export {
  shieldEvents,
  createEventBus,
  type TokenShieldEvents,
} from "./event-bus"

// Config Schemas
export {
  validateConfig,
  TokenShieldConfigSchema,
  GuardConfigSchema,
  CacheConfigSchema,
  ContextConfigSchema,
  RouterConfigSchema,
  BreakerConfigSchema,
  type TokenShieldConfig,
} from "./config-schemas"
