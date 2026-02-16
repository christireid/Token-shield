"use client"

/**
 * TokenShield React Integration
 *
 * Barrel re-export for all React hooks and the context provider.
 * This file exists so that consumers can import everything from
 * a single path: `import { TokenShieldProvider, useSavings } from "tokenshield/react"`
 *
 * Hooks are organized into focused files:
 *   - react-context.tsx     — Provider, context, savings store
 *   - react-hooks-core.ts   — Token counting, complexity analysis, shielded calls
 *   - react-hooks-budget.ts — Cost ledger, circuit breaker, user budget, session savings
 *   - react-hooks-pipeline.ts — Context manager, cache, guard, event log, metrics
 */

// Context & Provider
export {
  TokenShieldProvider,
  useSavings,
  createSavingsStore,
  // Fine-grained split-context hooks
  useTokenShieldInstances,
  useTokenShieldSavings,
  useTokenShieldConfig,
  type TokenShieldProviderProps,
  type TokenShieldContextValue,
  type SavingsEvent,
  type SavingsState,
} from "./react-context"

// Core hooks
export {
  useTokenCount,
  useComplexityAnalysis,
  useTokenEstimate,
  useModelRouter,
  useShieldedCall,
  type ShieldedCallMetrics,
} from "./react-hooks-core"

// Budget & cost tracking hooks
export {
  useCostLedger,
  useFeatureCost,
  useBudgetAlert,
  useUserBudget,
  useSessionSavings,
  type SessionSavingsState,
} from "./react-hooks-budget"

// Pipeline & monitoring hooks
export {
  useContextManager,
  useResponseCache,
  useRequestGuard,
  useEventLog,
  useProviderHealth,
  usePipelineMetrics,
  type EventLogEntry,
  type PipelineMetrics,
} from "./react-hooks-pipeline"

// Dashboard Components
export { TokenShieldDashboard, type TokenShieldDashboardProps } from "./dashboard"

export {
  SavingsSection,
  LedgerSection,
  BreakerSection,
  UserBudgetSection,
  EventLogSection,
  ProviderHealthSection,
  PipelineMetricsSection,
} from "./dashboard-sections"
