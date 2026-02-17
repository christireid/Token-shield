/**
 * token-shield — Cost estimation and tracking.
 *
 * `estimateCost` does one-shot cost calculation.
 * `costTracker` creates an accumulator for tracking spend over time.
 *
 * Unknown models are handled explicitly — never silently.
 */

import { getModelPricing } from "./pricing"
import type { CostEstimate, CostTrackerStats } from "../types"

/**
 * Estimate the cost of an LLM request.
 *
 * For known models, returns exact USD costs based on published pricing.
 * For unknown models, returns `known: false` with zeroed costs —
 * no silent fallback, no fabricated numbers.
 *
 * @param model - Model identifier (e.g. "gpt-4o", "claude-sonnet-4")
 * @param inputTokens - Number of input (prompt) tokens
 * @param outputTokens - Number of output (completion) tokens
 * @returns A cost estimate with `known` flag indicating reliability
 *
 * @example
 * ```ts
 * const cost = estimateCost("gpt-4o", 1000, 500);
 * // cost.totalCost === 0.0075
 * // cost.known === true
 * ```
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): CostEstimate {
  const safeInput = Math.max(0, inputTokens)
  const safeOutput = Math.max(0, outputTokens)
  const pricing = getModelPricing(model)

  if (!pricing) {
    return {
      model,
      provider: "unknown",
      inputTokens: safeInput,
      outputTokens: safeOutput,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      known: false,
    }
  }

  const inputCost = (safeInput / 1_000_000) * pricing.inputPerMillion
  const outputCost = (safeOutput / 1_000_000) * pricing.outputPerMillion

  return {
    model: pricing.id,
    provider: pricing.provider,
    inputTokens: safeInput,
    outputTokens: safeOutput,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    known: true,
  }
}

/**
 * Create a cost tracker that accumulates usage over time.
 *
 * @example
 * ```ts
 * const tracker = costTracker();
 * tracker.record("gpt-4o", 1000, 500);
 * tracker.record("gpt-4o-mini", 2000, 300);
 * console.log(tracker.stats);
 * // { requests: 2, totalCost: 0.00793, byModel: { ... } }
 * ```
 */
export function costTracker(): CostTracker {
  return new CostTrackerImpl()
}

/** Cost tracker instance. Records usage and provides cumulative stats. */
export interface CostTracker {
  /** Record a completed request. */
  record(model: string, inputTokens: number, outputTokens: number): CostEstimate
  /** Get cumulative stats. */
  readonly stats: CostTrackerStats
  /** Reset all tracked data. */
  reset(): void
}

class CostTrackerImpl implements CostTracker {
  private _requests = 0
  private _totalInputTokens = 0
  private _totalOutputTokens = 0
  private _totalCost = 0
  private _byModel: Record<string, { requests: number; inputTokens: number; outputTokens: number; cost: number }> = {}

  record(model: string, inputTokens: number, outputTokens: number): CostEstimate {
    const estimate = estimateCost(model, inputTokens, outputTokens)

    this._requests++
    this._totalInputTokens += estimate.inputTokens
    this._totalOutputTokens += estimate.outputTokens
    this._totalCost += estimate.totalCost

    if (!this._byModel[estimate.model]) {
      this._byModel[estimate.model] = { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    }
    const entry = this._byModel[estimate.model]
    entry.requests++
    entry.inputTokens += estimate.inputTokens
    entry.outputTokens += estimate.outputTokens
    entry.cost += estimate.totalCost

    return estimate
  }

  get stats(): CostTrackerStats {
    return {
      requests: this._requests,
      totalInputTokens: this._totalInputTokens,
      totalOutputTokens: this._totalOutputTokens,
      totalCost: this._totalCost,
      byModel: { ...this._byModel },
    }
  }

  reset(): void {
    this._requests = 0
    this._totalInputTokens = 0
    this._totalOutputTokens = 0
    this._totalCost = 0
    this._byModel = {}
  }
}
