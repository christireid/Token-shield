/**
 * TokenShield SDK
 *
 * Frontend-only React/TypeScript toolkit for reducing AI/LLM token expenses.
 * Every module uses exact token counting (gpt-tokenizer BPE),
 * real provider pricing data, and deterministic algorithms.
 *
 * 12 Core Modules:
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
 * 12. user-budget-manager - Per-user daily/monthly token budget assignment (Team tier)
 * 13. anomaly-detector   - Statistical outlier detection for cost and token spikes
 * 14. prompt-compressor  - Client-side prompt compression (20-40% token reduction, zero API calls)
 * 15. adaptive-output    - Learns actual output lengths to set tight max_tokens per request
 * 16. delta-encoder      - Eliminates cross-turn redundancy in conversations
 * 17. semantic-minhash   - O(1) LSH-based fuzzy cache lookup (replaces O(n) linear scan)
 * 18. template-pool      - Pre-tokenizes static prompt template parts for instant token counts
 *
 * Plus:
 * - AI SDK Middleware    - Drop-in middleware for Vercel AI SDK + framework adapters
 * - React Integration    - Provider, hooks, and real-time cost tracking
 * - Typed Error Hierarchy - Structured, catchable errors with machine-readable codes
 * - Composable Pipeline  - Pick-and-choose middleware stages with hooks
 * - Structured Logger    - Observability with OTel-style spans
 * - Provider Adapter     - Multi-provider routing with retries and health tracking
 * - Token Optimizer      - Unified facade combining all complementary savings features
 * - Performance Benchmarks - Hot-path benchmarking suite
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
  getTokenizerAccuracy,
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
  type KnownModelId,
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
  classifyContentType,
  type ContentType,
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
export { RequestGuard, type GuardConfig, type GuardResult } from "./request-guard"

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
export { CostLedger, type LedgerEntry, type LedgerSummary, type ModuleSavings } from "./cost-ledger"

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
export { StreamTokenTracker, type StreamUsage, type StreamTrackerConfig } from "./stream-tracker"

// 11. Cost Circuit Breaker
export {
  CostCircuitBreaker,
  type BreakerLimits,
  type BreakerConfig,
  type BreakerEvent,
  type BreakerStatus,
  type BreakerCheckResult,
} from "./circuit-breaker"

// 12. User Budget Manager
export {
  UserBudgetManager,
  type UserBudgetConfig,
  type UserBudgetLimits,
  type UserBudgetTier,
  type UserBudgetStatus,
  type BudgetExceededEvent,
  type BudgetWarningEvent,
} from "./user-budget-manager"

// 13. Anomaly Detector
export { AnomalyDetector, type AnomalyConfig, type AnomalyEvent } from "./anomaly-detector"

// AI SDK Middleware
export {
  tokenShieldMiddleware,
  getLedger,
  type TokenShieldMiddleware,
  type TokenShieldMiddlewareConfig,
} from "./middleware"

// Middleware Health Check
export { type HealthCheckResult } from "./middleware-types"

// Quick-Start Factory
export { createTokenShield } from "./create-token-shield"

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
  useUserBudget,
  useEventLog,
  useProviderHealth,
  usePipelineMetrics,
  useSessionSavings,
  useShieldedCall,
  type TokenShieldProviderProps,
  type EventLogEntry,
  type PipelineMetrics,
  type SessionSavingsState,
  type ShieldedCallMetrics,
} from "./react"

// Dashboard Component
export { TokenShieldDashboard, type TokenShieldDashboardProps } from "./dashboard"

// Pricing Registry
export {
  PRICING_REGISTRY,
  registerModel,
  getModelPricing,
  getModelsByProvider,
  fetchLatestPricing,
  getLastPricingFetchTime,
  type ModelPricingEntry,
} from "./pricing-registry"

// Event Bus
export {
  shieldEvents,
  createEventBus,
  subscribeToEvent,
  type EventBus,
  type TokenShieldEvents,
} from "./event-bus"

// Typed Error Hierarchy
export {
  TokenShieldError,
  TokenShieldBlockedError,
  TokenShieldConfigError,
  TokenShieldBudgetError,
  TokenShieldCryptoError,
  TokenShieldAPIError,
  ERROR_CODES,
  type ErrorCode,
} from "./errors"

// Config Schemas
export {
  validateConfig,
  TokenShieldConfigSchema,
  GuardConfigSchema,
  CacheConfigSchema,
  ContextConfigSchema,
  RouterConfigSchema,
  BreakerConfigSchema,
  UserBudgetConfigSchema,
  UserBudgetLimitsSchema,
  type TokenShieldConfig,
} from "./config-schemas"

// Encrypted Storage
export { EncryptedStore, createEncryptedStore, type EncryptedStoreConfig } from "./crypto-store"

// Storage Adapter (Edge Runtime compatible)
export { isPersistent } from "./storage-adapter"

// Composable Pipeline
export {
  Pipeline,
  createPipeline,
  createBreakerStage,
  createBudgetStage,
  createGuardStage,
  createCacheStage,
  createContextStage,
  createRouterStage,
  createPrefixStage,
  type PipelineContext,
  type PipelineStage,
  type PipelineHook,
} from "./pipeline"

// Observability — Structured Logging + Spans
export {
  TokenShieldLogger,
  logger,
  createLogger,
  type LogLevel,
  type LogEntry,
  type LoggerConfig,
  type Span,
  type CompletedSpan,
} from "./logger"

// Multi-Provider Adapter
export {
  ProviderAdapter,
  createProviderAdapter,
  retryWithBackoff,
  type ProviderName,
  type ProviderConfig,
  type ProviderHealth,
  type AdapterConfig,
} from "./provider-adapter"

// Framework-Agnostic Adapters
export {
  createGenericAdapter,
  createOpenAIAdapter,
  createAnthropicAdapter,
  createStreamAdapter,
  type AdapterMessage,
  type GenericAdapterOptions,
  type OpenAIAdapterOptions,
  type AnthropicAdapterOptions,
} from "./adapters"

// NeuroElastic Engine (Holographic Encoding)
export {
  NeuroElasticEngine,
  createNeuroElasticEngine,
  type NeuroElasticConfig,
  type MemorySlot,
  type FindResult,
} from "./neuro-elastic"

// Worker Communication Layer
export {
  ShieldWorker,
  createShieldWorker,
  type WorkerCommand,
  type WorkerResponse,
} from "./shield-worker"

// LLM API Client (multi-provider call helpers)
export {
  callOpenAI,
  callAnthropic,
  callGoogle,
  callLLM,
  calculateRealCost,
  detectModelProvider,
  type LLMResult,
  type LLMMessage,
} from "./api-client"

// Savings Calculator
export {
  estimateSavings,
  SavingsCalculator,
  type SavingsEstimateInput,
  type SavingsEstimate,
  type SavingsCalculatorProps,
} from "./savings-calculator"

// Performance Benchmarks
export {
  bench,
  benchAsync,
  runAllBenchmarks,
  formatResults,
  type BenchmarkResult,
} from "./benchmark"

// 14. Prompt Compressor
export {
  compressPrompt,
  compressMessages,
  type CompressorConfig,
  type CompressionResult,
} from "./prompt-compressor"

// 15. Adaptive Output Optimizer
export {
  AdaptiveOutputOptimizer,
  type AdaptiveOptimizerConfig,
  type AdaptivePrediction,
  type OutputStats,
} from "./adaptive-output-optimizer"

// 16. Conversation Delta Encoder
export {
  encodeDelta,
  analyzeRedundancy,
  type DeltaEncoderConfig,
  type DeltaResult,
} from "./conversation-delta-encoder"

// 17. Semantic MinHash Cache Index
export {
  SemanticMinHashIndex,
  type MinHashConfig,
  type MinHashEntry,
  type MinHashLookupResult,
} from "./semantic-minhash"

// 18. Prompt Template Intern Pool
export {
  PromptTemplatePool,
  type TemplateConfig,
  type CompiledTemplate,
  type TemplateRenderResult,
} from "./prompt-template-pool"

// Unified Token Optimizer (combines all complementary features)
export {
  TokenOptimizer,
  createTokenOptimizer,
  type TokenOptimizerConfig,
  type OptimizeResult,
} from "./token-optimizer"

// License Gating (Open-Core)
export {
  activateLicense,
  getLicenseInfo,
  isModulePermitted,
  getModuleTier,
  getModulesForTier,
  resetLicense,
  generateTestKey,
  generateTestKeySync,
  setLicenseSecret,
  type LicenseTier,
  type LicenseInfo,
} from "./license"

// Audit Logging (Enterprise)
export {
  AuditLog,
  type AuditEntry,
  type AuditEventType,
  type AuditSeverity,
  type AuditLogConfig,
} from "./audit-log"
