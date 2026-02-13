"use client"

/**
 * TokenShield - Dashboard Section Components
 *
 * Extracted sub-components used by the main TokenShieldDashboard.
 * This file is an internal implementation detail — all public exports
 * are re-exported from dashboard.tsx.
 */

import React from "react"
import {
  useSavings,
  useCostLedger,
  useBudgetAlert,
  useUserBudget,
  useEventLog,
  useProviderHealth,
  usePipelineMetrics,
} from "./react"
import type { CostCircuitBreaker } from "./circuit-breaker"
import type { UserBudgetManager } from "./user-budget-manager"
import type { ProviderAdapter } from "./provider-adapter"

// -------------------------------------------------------
// Utility functions
// -------------------------------------------------------

export function formatDollars(amount: number): string {
  if (amount >= 1) return `$${amount.toFixed(2)}`
  if (amount >= 0.01) return `$${amount.toFixed(4)}`
  if (amount >= 0.0001) return `$${amount.toFixed(6)}`
  return "$0.00"
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

// -------------------------------------------------------
// Sub-components (all inline — zero external deps)
// -------------------------------------------------------

/** Horizontal bar gauge */
export function Gauge({
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
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${formatDollars(value)} of ${formatDollars(max)}`}
        style={{ background: "#e5e7eb", borderRadius: 4, height: 8, overflow: "hidden" }}
      >
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
export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

export function SavingsSection() {
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

export function LedgerSection() {
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

export function BreakerSection({ breaker }: { breaker: CostCircuitBreaker }) {
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

export function UserBudgetSection({
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
// New sections: Event Log, Provider Health, Pipeline Metrics
// -------------------------------------------------------

/** Color map for event types used in the EventLogSection */
export const EVENT_COLORS: Record<string, string> = {
  // Green: success / positive events
  "request:allowed": "#22c55e",
  "cache:hit": "#22c55e",
  "stream:complete": "#22c55e",
  "cache:store": "#22c55e",
  // Yellow: warnings
  "breaker:warning": "#f59e0b",
  "userBudget:warning": "#f59e0b",
  "context:trimmed": "#f59e0b",
  "router:downgraded": "#f59e0b",
  "stream:chunk": "#f59e0b",
  // Red: blocked / tripped / exceeded
  "request:blocked": "#ef4444",
  "breaker:tripped": "#ef4444",
  "userBudget:exceeded": "#ef4444",
  "stream:abort": "#ef4444",
}

export const DEFAULT_EVENT_COLOR = "#6b7280"

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

/** Summarize key data fields from an event into a short string. */
export function summarizeEventData(type: string, data: Record<string, unknown>): string {
  try {
    switch (type) {
      case "cache:hit":
        return `similarity: ${typeof data.similarity === "number" ? Math.round(data.similarity * 100) : "?"}%, savedCost: ${typeof data.savedCost === "number" ? formatDollars(data.savedCost) : "?"}`
      case "cache:miss":
        return `prompt: ${typeof data.prompt === "string" ? data.prompt.slice(0, 30) : "?"}...`
      case "cache:store":
        return `model: ${data.model ?? "?"}`
      case "request:allowed":
        return `model: ${data.model ?? "?"}`
      case "request:blocked":
        return `reason: ${data.reason ?? "?"}, est: ${typeof data.estimatedCost === "number" ? formatDollars(data.estimatedCost) : "?"}`
      case "ledger:entry":
        return `cost: ${typeof data.cost === "number" ? formatDollars(data.cost) : "?"}, saved: ${typeof data.saved === "number" ? formatDollars(data.saved) : "?"}`
      case "context:trimmed":
        return `saved: ${data.savedTokens ?? "?"} tokens`
      case "router:downgraded":
        return `${data.originalModel} -> ${data.selectedModel}, saved: ${typeof data.savedCost === "number" ? formatDollars(data.savedCost) : "?"}`
      case "breaker:warning":
        return `${data.limitType}: ${typeof data.percentUsed === "number" ? data.percentUsed.toFixed(0) : "?"}% used`
      case "breaker:tripped":
        return `${data.limitType}: ${data.action ?? "blocked"}`
      case "userBudget:warning":
        return `user: ${data.userId}, ${data.limitType}: ${typeof data.percentUsed === "number" ? data.percentUsed.toFixed(0) : "?"}%`
      case "userBudget:exceeded":
        return `user: ${data.userId}, ${data.limitType}`
      case "userBudget:spend":
        return `user: ${data.userId}, cost: ${typeof data.cost === "number" ? formatDollars(data.cost) : "?"}`
      case "stream:chunk":
        return `tokens: ${data.outputTokens ?? "?"}, est: ${typeof data.estimatedCost === "number" ? formatDollars(data.estimatedCost) : "?"}`
      case "stream:abort":
        return `tokens: ${data.outputTokens ?? "?"}, est: ${typeof data.estimatedCost === "number" ? formatDollars(data.estimatedCost) : "?"}`
      case "stream:complete":
        return `cost: ${typeof data.totalCost === "number" ? formatDollars(data.totalCost) : "?"}`
      default: {
        // Fallback: show first 2 keys
        const keys = Object.keys(data).slice(0, 2)
        return keys.map((k) => `${k}: ${String(data[k]).slice(0, 20)}`).join(", ")
      }
    }
  } catch {
    return ""
  }
}

export function EventLogSection() {
  const events = useEventLog(50)
  // Display at most 20 most recent events in the dashboard
  const visibleEvents = events.slice(0, 20)

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Event Log</h3>
      <div
        style={{
          maxHeight: 260,
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "#f9fafb",
        }}
      >
        {visibleEvents.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: "#9ca3af", textAlign: "center" }}>
            No events yet. Events will appear as the SDK processes requests.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f3f4f6" }}>
                <th scope="col" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Time</th>
                <th scope="col" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Event</th>
                <th scope="col" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((evt) => (
                <tr key={evt.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "4px 10px", fontFamily: "monospace", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {formatTime(evt.timestamp)}
                  </td>
                  <td style={{ padding: "4px 10px", whiteSpace: "nowrap" }}>
                    <span
                      style={{
                        color: EVENT_COLORS[evt.type] ?? DEFAULT_EVENT_COLOR,
                        fontWeight: 500,
                      }}
                    >
                      {evt.type}
                    </span>
                  </td>
                  <td style={{ padding: "4px 10px", color: "#6b7280", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {summarizeEventData(evt.type, evt.data)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function ProviderHealthSection({ adapter }: { adapter: ProviderAdapter }) {
  const healthData = useProviderHealth(adapter)

  if (healthData.length === 0) {
    return (
      <div>
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Provider Health</h3>
        <div style={{ fontSize: 12, color: "#9ca3af" }}>No providers configured.</div>
      </div>
    )
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Provider Health</h3>
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          background: "#f9fafb",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f3f4f6" }}>
              <th scope="col" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Provider</th>
              <th scope="col" style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#374151" }}>Status</th>
              <th scope="col" style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Latency</th>
              <th scope="col" style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Failures</th>
              <th scope="col" style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#374151" }}>Requests</th>
            </tr>
          </thead>
          <tbody>
            {healthData.map((h) => {
              const statusLabel = h.healthy
                ? h.consecutiveFailures > 0
                  ? "Degraded"
                  : "Healthy"
                : "Unhealthy"
              const statusColor = h.healthy
                ? h.consecutiveFailures > 0
                  ? "#f59e0b"
                  : "#22c55e"
                : "#ef4444"

              return (
                <tr key={h.name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 10px", fontWeight: 500 }}>{h.name}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>
                    {h.avgLatencyMs > 0 ? `${Math.round(h.avgLatencyMs)}ms` : "--"}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: h.totalFailures > 0 ? "#ef4444" : "#6b7280" }}>
                    {h.totalFailures}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: "monospace", color: "#6b7280" }}>
                    {h.totalRequests}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PipelineMetricsSection() {
  const metrics = usePipelineMetrics()

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Pipeline Metrics</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Stat
          label="Total Requests"
          value={String(metrics.totalRequests)}
        />
        <Stat
          label="Avg Latency"
          value={metrics.avgLatencyMs > 0 ? `${metrics.avgLatencyMs}ms` : "--"}
        />
        <Stat
          label="Cache Hit Rate"
          value={formatPercent(metrics.cacheHitRate)}
        />
        <Stat
          label="Blocked Rate"
          value={formatPercent(metrics.blockedRate)}
        />
      </div>
      {metrics.lastEvent && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
          Last event: <span style={{ color: EVENT_COLORS[metrics.lastEvent.type] ?? DEFAULT_EVENT_COLOR }}>{metrics.lastEvent.type}</span>{" "}
          at {formatTime(metrics.lastEvent.timestamp)}
        </div>
      )}
    </div>
  )
}
