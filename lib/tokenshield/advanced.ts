/**
 * TokenShield - Advanced Exports
 *
 * Power-user modules, internals, and standalone utilities.
 * Import from "@tokenshield/ai-sdk/advanced" when you need
 * direct access to individual modules outside the middleware pipeline.
 *
 * Most users should use `shield()` from the main entry point instead.
 */

// -------------------------------------------------------
// Core Modules (standalone usage)
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
// Fuzzy Similarity Engine (Trigram-based matching)
// -------------------------------------------------------

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

// -------------------------------------------------------
// Prompt Optimization
// -------------------------------------------------------

// Prompt Compressor
export { compressPrompt, compressMessages, type CompressionResult } from "./prompt-compressor"

// Conversation Delta Encoder
export { encodeDelta, analyzeRedundancy, type DeltaResult } from "./conversation-delta-encoder"

// -------------------------------------------------------
// Monitoring & Detection
// -------------------------------------------------------

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

// -------------------------------------------------------
// Enterprise
// -------------------------------------------------------

// Audit Logging
export { AuditLog, type AuditEntry, type AuditLogConfig } from "./audit-log"

// -------------------------------------------------------
// Events & Config
// -------------------------------------------------------

export {
  shieldEvents,
  subscribeToEvent,
  subscribeToAnyEvent,
  type EventBus,
  type TokenShieldEvents,
} from "./event-bus"

export { validateConfig, TokenShieldConfigSchema } from "./config-schemas"

// Storage
export { isPersistent } from "./storage-adapter"

// -------------------------------------------------------
// Error Types
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
// React (re-export for convenience — also available via /react)
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
// License
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
