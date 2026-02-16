/**
 * TokenShield SDK
 *
 * Client-side TypeScript middleware for reducing LLM API costs.
 * Provides caching, model routing, budget enforcement, and cost tracking
 * as drop-in middleware for Vercel AI SDK, OpenAI, and Anthropic.
 *
 * Core Modules:
 *  1. token-counter      - Exact BPE token counting
 *  2. cost-estimator     - Real pricing from OpenAI, Anthropic, Google
 *  3. context-manager    - Token-budget-aware conversation trimming
 *  4. response-cache     - Client-side exact + fuzzy response caching
 *  5. model-router       - Complexity-based routing to cheapest capable model
 *  6. request-guard      - Debounce, dedup, rate limit, cost gate
 *  7. prefix-optimizer   - Message ordering for provider prompt cache hits
 *  8. cost-ledger        - Real usage tracking with per-module attribution
 *  9. circuit-breaker    - Spending limits with hard-stop protection
 * 10. stream-tracker     - Real-time output token counting during streaming
 */

// -------------------------------------------------------
// Primary API — the middleware entry point
// -------------------------------------------------------

export {
  tokenShieldMiddleware,
  getLedger,
  type TokenShieldMiddleware,
  type TokenShieldMiddlewareConfig,
} from "./middleware"

export { createTokenShield } from "./create-token-shield"

// -------------------------------------------------------
// Core Modules
// -------------------------------------------------------

// Token Counter
export {
  countExactTokens,
  countChatTokens,
  countFast,
  fitsInBudget,
  countModelTokens,
  type ChatMessage,
  type TokenCount,
  type ChatTokenCount,
} from "./token-counter"

// Cost Estimator
export {
  estimateCost,
  compareCosts,
  calculateSavings,
  cheapestModelForBudget,
  MODEL_PRICING,
  type ModelPricing,
  type CostEstimate,
  type KnownModelId,
} from "./cost-estimator"

// Context Manager
export {
  fitToBudget,
  slidingWindow,
  priorityFit,
  smartFit,
  type Message,
  type ContextBudget,
  type ContextResult,
} from "./context-manager"

// Response Cache
export {
  ResponseCache,
  normalizeText,
  textSimilarity,
  classifyContentType,
  type ContentType,
  type CacheEntry,
  type CacheConfig,
} from "./response-cache"

// Model Router
export {
  analyzeComplexity,
  routeToModel,
  type ComplexityScore,
  type RoutingDecision,
} from "./model-router"

// Request Guard
export { RequestGuard, type GuardConfig, type GuardResult } from "./request-guard"

// Prefix Optimizer
export {
  optimizePrefix,
  detectProvider,
  type PrefixOptimizerConfig,
  type OptimizedResult,
  type Provider,
} from "./prefix-optimizer"

// Cost Ledger
export { CostLedger, type LedgerEntry, type LedgerSummary, type ModuleSavings } from "./cost-ledger"

// Circuit Breaker
export {
  CostCircuitBreaker,
  type BreakerLimits,
  type BreakerConfig,
  type BreakerStatus,
} from "./circuit-breaker"

// Stream Tracker
export { StreamTokenTracker, type StreamUsage } from "./stream-tracker"

// User Budget Manager
export {
  UserBudgetManager,
  type UserBudgetConfig,
  type UserBudgetLimits,
  type UserBudgetStatus,
} from "./user-budget-manager"

// -------------------------------------------------------
// Framework Adapters
// -------------------------------------------------------

export {
  createGenericAdapter,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createStreamAdapter,
} from "./adapters"

// -------------------------------------------------------
// React Integration
// -------------------------------------------------------

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
  useUserBudget,
  useEventLog,
  useSessionSavings,
  useShieldedCall,
  type TokenShieldProviderProps,
} from "./react"

// Dashboard Component
export { TokenShieldDashboard, type TokenShieldDashboardProps } from "./dashboard"

// -------------------------------------------------------
// Error Handling
// -------------------------------------------------------

export {
  TokenShieldError,
  TokenShieldBlockedError,
  TokenShieldConfigError,
  TokenShieldBudgetError,
  ERROR_CODES,
  type ErrorCode,
} from "./errors"

// -------------------------------------------------------
// Configuration & Events
// -------------------------------------------------------

export { validateConfig, TokenShieldConfigSchema } from "./config-schemas"

export {
  shieldEvents,
  subscribeToEvent,
  subscribeToAnyEvent,
  type EventBus,
  type TokenShieldEvents,
} from "./event-bus"

// Storage
export { isPersistent } from "./storage-adapter"

// -------------------------------------------------------
// License (Open-Core)
// -------------------------------------------------------

export {
  activateLicense,
  getLicenseInfo,
  isModulePermitted,
  getModuleTier,
  resetLicense,
  type LicenseTier,
  type LicenseInfo,
} from "./license"

// -------------------------------------------------------
// Advanced (re-exported for power users, not primary API)
// -------------------------------------------------------

// Fuzzy Similarity Engine (Trigram-based matching)
export {
  FuzzySimilarityEngine,
  createFuzzySimilarityEngine,
  type FuzzySimilarityConfig,
  type FindResult,
} from "./fuzzy-similarity"

// Semantic MinHash Cache Index
export {
  SemanticMinHashIndex,
  type MinHashConfig,
  type MinHashLookupResult,
} from "./semantic-minhash"

// Prompt Compressor
export { compressPrompt, compressMessages, type CompressionResult } from "./prompt-compressor"

// Conversation Delta Encoder
export { encodeDelta, analyzeRedundancy, type DeltaResult } from "./conversation-delta-encoder"

// Anomaly Detector
export { AnomalyDetector, type AnomalyConfig, type AnomalyEvent } from "./anomaly-detector"

// Tool Token Counter
export {
  countToolTokens,
  countImageTokens,
  predictOutputTokens,
  type ToolDefinition,
  type ToolTokenResult,
} from "./tool-token-counter"

// Audit Logging (Enterprise)
export { AuditLog, type AuditEntry, type AuditLogConfig } from "./audit-log"
