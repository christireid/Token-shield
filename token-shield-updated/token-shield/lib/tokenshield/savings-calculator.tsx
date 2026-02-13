"use client"

/**
 * TokenShield - Savings Calculator
 *
 * A standalone utility + React component that estimates potential savings
 * based on monthly LLM spend. Used on landing pages, onboarding flows,
 * and pricing pages to demonstrate ROI before integration.
 *
 * Usage:
 *   // Utility function (no React required)
 *   const estimate = estimateSavings({ monthlySpend: 10000, provider: 'openai' })
 *
 *   // React component
 *   <SavingsCalculator />
 */

import React, { useState, useMemo } from "react"

// -------------------------------------------------------
// Savings estimation engine (framework-agnostic)
// -------------------------------------------------------

export interface SavingsEstimateInput {
  /** Current monthly LLM API spend in USD */
  monthlySpend: number
  /** Primary LLM provider */
  provider?: "openai" | "anthropic" | "google" | "mixed"
  /** Estimated percentage of requests that are near-duplicates (default: 15%) */
  duplicateRate?: number
  /** Estimated percentage of requests that are simple enough for cheaper models (default: 25%) */
  simpleRequestRate?: number
  /** Average conversation length in messages (default: 10) */
  avgConversationLength?: number
  /** Whether prefix optimization is applicable (default: true) */
  hasSteadySystemPrompt?: boolean
}

export interface SavingsEstimate {
  /** Total estimated monthly savings in USD */
  totalSavings: number
  /** Savings as a percentage of current spend */
  savingsPercent: number
  /** Per-module breakdown */
  byModule: {
    cache: { savings: number; percent: number; description: string }
    router: { savings: number; percent: number; description: string }
    prefix: { savings: number; percent: number; description: string }
    context: { savings: number; percent: number; description: string }
    guard: { savings: number; percent: number; description: string }
  }
  /** Token Shield cost at recommended tier */
  tokenShieldCost: number
  /** Net savings after Token Shield cost */
  netSavings: number
  /** Return on investment (net savings / Token Shield cost) */
  roi: number
  /** Recommended pricing tier */
  recommendedTier: "pro" | "team" | "enterprise"
}

/**
 * Estimate the potential monthly savings from Token Shield.
 *
 * Uses conservative, documented assumptions for each module's impact.
 * All percentages are based on published research and real-world data
 * from similar optimization tools.
 */
export function estimateSavings(input: SavingsEstimateInput): SavingsEstimate {
  const {
    monthlySpend,
    provider = "openai",
    duplicateRate = 0.15,
    simpleRequestRate = 0.25,
    avgConversationLength = 10,
    hasSteadySystemPrompt = true,
  } = input

  // Response Cache: savings = duplicateRate * spend
  // Conservative: only exact + near-duplicate matches
  const cacheSavings = monthlySpend * duplicateRate
  const cachePercent = duplicateRate * 100

  // Model Router: savings from routing simple requests to cheaper models
  // Average cost reduction when downgrading: ~60% per request
  const routerSavings = monthlySpend * simpleRequestRate * 0.6
  const routerPercent = simpleRequestRate * 0.6 * 100

  // Prefix Optimizer: savings from provider prompt cache hits
  // Provider discounts: OpenAI 50%, Anthropic 90%, Google 75%
  const prefixDiscountRate = provider === "anthropic" ? 0.9 : provider === "google" ? 0.75 : 0.5
  // Assume ~40% of input tokens are in the stable prefix, ~80% cache hit rate
  const prefixSavings = hasSteadySystemPrompt ? monthlySpend * 0.4 * prefixDiscountRate * 0.8 * 0.5 : 0
  const prefixPercent = hasSteadySystemPrompt ? 0.4 * prefixDiscountRate * 0.8 * 0.5 * 100 : 0

  // Context Manager: savings from trimming long conversations
  // Only applies when conversations exceed typical context budgets
  const contextFactor = avgConversationLength > 8 ? Math.min(0.15, (avgConversationLength - 8) * 0.015) : 0
  const contextSavings = monthlySpend * contextFactor
  const contextPercent = contextFactor * 100

  // Request Guard: savings from preventing accidental duplicates
  // Conservative: 3% of requests are accidental spam/duplicates
  const guardSavings = monthlySpend * 0.03
  const guardPercent = 3

  const totalSavings = cacheSavings + routerSavings + prefixSavings + contextSavings + guardSavings
  const savingsPercent = monthlySpend > 0 ? (totalSavings / monthlySpend) * 100 : 0

  // Recommended tier and cost
  let recommendedTier: "pro" | "team" | "enterprise"
  let tokenShieldCost: number
  if (monthlySpend >= 50000) {
    recommendedTier = "enterprise"
    tokenShieldCost = 499 // placeholder
  } else if (monthlySpend >= 5000) {
    recommendedTier = "team"
    tokenShieldCost = 99
  } else {
    recommendedTier = "pro"
    tokenShieldCost = 29
  }

  const netSavings = totalSavings - tokenShieldCost
  const roi = tokenShieldCost > 0 ? netSavings / tokenShieldCost : 0

  return {
    totalSavings: Math.round(totalSavings * 100) / 100,
    savingsPercent: Math.round(savingsPercent * 10) / 10,
    byModule: {
      cache: { savings: Math.round(cacheSavings * 100) / 100, percent: Math.round(cachePercent * 10) / 10, description: `${Math.round(duplicateRate * 100)}% of requests are near-duplicates served from cache` },
      router: { savings: Math.round(routerSavings * 100) / 100, percent: Math.round(routerPercent * 10) / 10, description: `${Math.round(simpleRequestRate * 100)}% of requests routed to cheaper models (60% avg cost reduction)` },
      prefix: { savings: Math.round(prefixSavings * 100) / 100, percent: Math.round(prefixPercent * 10) / 10, description: hasSteadySystemPrompt ? `Provider prompt cache hits (${Math.round(prefixDiscountRate * 100)}% discount for ${provider})` : "No steady system prompt — prefix optimization not applicable" },
      context: { savings: Math.round(contextSavings * 100) / 100, percent: Math.round(contextPercent * 10) / 10, description: avgConversationLength > 8 ? `Long conversations (${avgConversationLength} msgs avg) trimmed to fit token budgets` : "Short conversations — context trimming not needed" },
      guard: { savings: Math.round(guardSavings * 100) / 100, percent: Math.round(guardPercent * 10) / 10, description: "Accidental duplicate/spam requests prevented" },
    },
    tokenShieldCost,
    netSavings: Math.round(netSavings * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    recommendedTier,
  }
}

// -------------------------------------------------------
// React component
// -------------------------------------------------------

export interface SavingsCalculatorProps {
  /** Initial monthly spend value (default: 5000) */
  initialSpend?: number
  /** CSS class name for the container */
  className?: string
}

/**
 * Interactive savings calculator React component.
 *
 * Renders a spend input and displays a per-module savings breakdown.
 * Suitable for embedding in landing pages, onboarding flows, or settings.
 */
export function SavingsCalculator({ initialSpend = 5000, className }: SavingsCalculatorProps) {
  const [monthlySpend, setMonthlySpend] = useState(initialSpend)
  const [provider, setProvider] = useState<"openai" | "anthropic" | "google" | "mixed">("openai")

  const estimate = useMemo(
    () => estimateSavings({ monthlySpend, provider }),
    [monthlySpend, provider]
  )

  return (
    <div className={className} role="region" aria-label="Token Shield Savings Calculator" style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600 }}>
      <h3 id="savings-calc-heading" style={{ margin: "0 0 16px" }}>Token Shield Savings Calculator</h3>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }} role="group" aria-labelledby="savings-calc-heading">
        <label style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: 14, marginBottom: 4 }}>Monthly LLM Spend ($)</span>
          <input
            type="number"
            value={monthlySpend}
            onChange={(e) => setMonthlySpend(Math.max(0, Number(e.target.value)))}
            aria-label="Monthly LLM spend in dollars"
            min={0}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 16 }}
          />
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ display: "block", fontSize: 14, marginBottom: 4 }}>Primary Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as typeof provider)}
            aria-label="Primary LLM provider"
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 16 }}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
      </div>

      <div aria-live="polite" role="status" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: "#166534" }}>Estimated Monthly Savings</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: "#15803d" }} aria-label={`Estimated savings: $${estimate.totalSavings.toLocaleString()} per month, ${estimate.savingsPercent}% of spend`}>
          ${estimate.totalSavings.toLocaleString()} <span style={{ fontSize: 16, fontWeight: 400 }}>/ mo ({estimate.savingsPercent}%)</span>
        </div>
        <div style={{ fontSize: 14, color: "#166534", marginTop: 4 }}>
          Net after Token Shield (${estimate.tokenShieldCost}/mo): <strong>${estimate.netSavings.toLocaleString()}/mo</strong> &mdash; {estimate.roi}x ROI
        </div>
      </div>

      <table role="table" aria-label="Savings breakdown by module" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th scope="col" style={{ textAlign: "left", padding: "8px 4px" }}>Module</th>
            <th scope="col" style={{ textAlign: "right", padding: "8px 4px" }}>Savings</th>
            <th scope="col" style={{ textAlign: "left", padding: "8px 4px" }}>How</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(estimate.byModule).map(([name, mod]) => (
            <tr key={name} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "8px 4px", fontWeight: 500, textTransform: "capitalize" }}>{name}</td>
              <td style={{ padding: "8px 4px", textAlign: "right", fontFamily: "monospace" }}>${mod.savings.toLocaleString()}</td>
              <td style={{ padding: "8px 4px", color: "#6b7280" }}>{mod.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
