"use client"

/**
 * TokenShield - Dashboard Component
 *
 * A self-contained, drop-in React component that visualizes real-time
 * cost savings, model routing decisions, and budget status. Uses only
 * the existing TokenShield hooks — no new dependencies.
 *
 * Usage:
 *   import { TokenShieldDashboard } from '@tokenshield/ai-sdk'
 *
 *   // Inside a <TokenShieldProvider>:
 *   <TokenShieldDashboard />
 *
 *   // Or with optional props:
 *   <TokenShieldDashboard
 *     breaker={myBreaker}
 *     budgetManager={myBudgetManager}
 *     userId="user-123"
 *     showEventLog={true}
 *     showPipeline={true}
 *     providerAdapter={myAdapter}
 *   />
 */

import React, { Component, useMemo } from "react"
import type { CostCircuitBreaker } from "./circuit-breaker"
import type { UserBudgetManager } from "./user-budget-manager"
import type { ProviderAdapter } from "./provider-adapter"

import {
  SavingsSection,
  LedgerSection,
  BreakerSection,
  UserBudgetSection,
  EventLogSection,
  ProviderHealthSection,
  PipelineMetricsSection,
} from "./dashboard-sections"

// -------------------------------------------------------
// Error boundary
// -------------------------------------------------------

/** Error boundary that silently renders nothing when a child throws (e.g., useCostLedger with no ledger configured) */
class OptionalSection extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? null : this.props.children }
}

// -------------------------------------------------------
// Main Dashboard
// -------------------------------------------------------

export interface TokenShieldDashboardProps {
  /** Optional circuit breaker for budget gauge */
  breaker?: CostCircuitBreaker
  /** Optional user budget manager for per-user tracking */
  budgetManager?: UserBudgetManager
  /** User ID to display budget for (requires budgetManager) */
  userId?: string
  /** Show the detailed ledger section */
  showLedger?: boolean
  /** Show the event log section (default true) */
  showEventLog?: boolean
  /** Show the pipeline metrics section (default true) */
  showPipeline?: boolean
  /** Optional provider adapter for health monitoring */
  providerAdapter?: ProviderAdapter
  /** CSS class name for the outer container */
  className?: string
  /** Inline styles for the outer container */
  style?: React.CSSProperties
}

/**
 * Self-contained dashboard component that visualizes TokenShield metrics.
 * Must be rendered inside a <TokenShieldProvider>.
 */
export function TokenShieldDashboard({
  breaker,
  budgetManager,
  userId,
  showLedger = true,
  showEventLog = true,
  showPipeline = true,
  providerAdapter,
  className,
  style,
}: TokenShieldDashboardProps) {
  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      padding: 20,
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      ...style,
    }),
    [style]
  )

  return (
    <div className={className} style={containerStyle}>
      <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>
        TokenShield Dashboard
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SavingsSection />

        {showLedger && <OptionalSection><LedgerSection /></OptionalSection>}

        {breaker && <BreakerSection breaker={breaker} />}

        {budgetManager && userId && (
          <UserBudgetSection manager={budgetManager} userId={userId} />
        )}

        {showEventLog && (
          <OptionalSection><EventLogSection /></OptionalSection>
        )}

        {providerAdapter && (
          <OptionalSection><ProviderHealthSection adapter={providerAdapter} /></OptionalSection>
        )}

        {showPipeline && (
          <OptionalSection><PipelineMetricsSection /></OptionalSection>
        )}
      </div>
    </div>
  )
}
