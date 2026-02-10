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
 *     showDetails={true}
 *   />
 */

import React, { Component, useMemo } from "react"
import { useSavings, useCostLedger, useBudgetAlert, useUserBudget } from "./react"
import type { CostCircuitBreaker } from "./circuit-breaker"
import type { UserBudgetManager } from "./user-budget-manager"

// -------------------------------------------------------
// Sub-components (all inline — zero external deps)
// -------------------------------------------------------

function formatDollars(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`
  if (amount >= 0.01) return `$${amount.toFixed(4)}`
  if (amount >= 0.0001) return `$${amount.toFixed(6)}`
  return "$0.00"
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

/** Horizontal bar gauge */
function Gauge({
  value,
  max,
  label,
  color = "#22c55e",
  warnColor = "#f59e0b",
  dangerColor = "#ef4444",
}: {
  value: number
  max: number
  label: string
  color?: string
  warnColor?: string
  dangerColor?: string
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const barColor = pct >= 90 ? dangerColor : pct >= 70 ? warnColor : color

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span>{formatDollars(value)} / {formatDollars(max)}</span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            borderRadius: 4,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  )
}

/** Stat card */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      padding: "12px 16px",
      background: "#f9fafb",
      borderRadius: 8,
      border: "1px solid #e5e7eb",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// -------------------------------------------------------
// Dashboard sections
// -------------------------------------------------------

function SavingsSection() {
  const savings = useSavings()

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Session Savings</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat label="Saved" value={formatDollars(savings.totalDollarsSaved)} />
        <Stat label="Tokens Saved" value={savings.totalTokensSaved.toLocaleString()} />
        <Stat label="Requests" value={String(savings.totalRequestsMade)} />
        <Stat label="Cache Hits" value={String(savings.totalCacheHits)} />
        <Stat label="Blocked" value={String(savings.totalRequestsBlocked)} />
      </div>
    </div>
  )
}

/** Error boundary that silently renders nothing when a child throws (e.g., useCostLedger with no ledger configured) */
class OptionalSection extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? null : this.props.children }
}

function LedgerSection() {
  const ledger = useCostLedger()

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Cost Ledger</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat
          label="Total Spent"
          value={formatDollars(ledger.totalSpent)}
          sub={`${ledger.totalCalls} calls`}
        />
        <Stat
          label="Total Saved"
          value={formatDollars(ledger.totalSaved)}
          sub={`${formatPercent(ledger.savingsRate)} savings rate`}
        />
      </div>
    </div>
  )
}

function BreakerSection({ breaker }: { breaker: CostCircuitBreaker }) {
  const budget = useBudgetAlert(breaker)

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>
        Circuit Breaker
        {budget.isOverBudget && (
          <span style={{ color: "#ef4444", marginLeft: 8, fontSize: 12 }}>TRIPPED</span>
        )}
      </h3>
      {budget.limit > 0 && (
        <Gauge
          value={budget.currentSpend}
          max={budget.limit}
          label={budget.limitType ? `${budget.limitType} limit` : "Budget"}
        />
      )}
      <div style={{ fontSize: 12, color: "#6b7280" }}>
        {budget.percentUsed.toFixed(1)}% used
      </div>
    </div>
  )
}

function UserBudgetSection({
  manager,
  userId,
}: {
  manager: UserBudgetManager
  userId: string
}) {
  const status = useUserBudget(manager, userId)

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>
        User Budget: {userId}
        {status.isOverBudget && (
          <span style={{ color: "#ef4444", marginLeft: 8, fontSize: 12 }}>OVER BUDGET</span>
        )}
      </h3>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
        Tier: {status.tier} | In-flight: {formatDollars(status.inflight)}
      </div>
      {status.limits?.daily != null && status.limits.daily > 0 && (
        <Gauge
          value={status.spend.daily}
          max={status.limits.daily}
          label="Daily"
        />
      )}
      {status.limits?.monthly != null && status.limits.monthly > 0 && (
        <Gauge
          value={status.spend.monthly}
          max={status.limits.monthly}
          label="Monthly"
        />
      )}
    </div>
  )
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
      </div>
    </div>
  )
}
