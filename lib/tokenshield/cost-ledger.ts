/**
 * TokenShield - Cost Ledger
 *
 * Tracks every dollar spent and every dollar saved using REAL numbers
 * from the provider's usage response object. Not estimates.
 *
 * Data sources per request:
 * - usage.prompt_tokens from OpenAI/Anthropic response
 * - usage.completion_tokens from response
 * - usage.cached_tokens from OpenAI (when prompt cache hits)
 * - Model name from response (to look up real pricing)
 * - Module attribution (which module saved how much and how)
 *
 * Free tier: session-only (Map in memory). Resets on page refresh.
 * Pro tier: persists to IndexedDB via idb-keyval, export to JSON.
 *
 * Concurrency Safety:
 * - Uses BroadcastChannel to sync ledger entries across multiple tabs/windows.
 * - Ensures global visibility of spend/savings in real-time.
 */

import { get, set, keys, createStore, type UseStore } from "./storage-adapter"
import { estimateCost, MODEL_PRICING } from "./cost-estimator"
import { FALLBACK_INPUT_PER_MILLION, FALLBACK_OUTPUT_PER_MILLION } from "./middleware-types"

// ----------------------------
// Types
// ----------------------------

export interface ModuleSavings {
  guard: number
  cache: number
  context: number
  router: number
  prefix: number
}

export interface LedgerEntry {
  id: string
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  actualCost: number
  costWithoutShield: number
  totalSaved: number
  savings: ModuleSavings
  /** Optional feature tag for cost attribution */
  feature?: string
  /** Latency in ms */
  latencyMs?: number
  /** Whether this was a cache hit (no API call) */
  cacheHit: boolean
}

export interface LedgerSummary {
  totalSpent: number
  totalSaved: number
  totalCalls: number
  callsBlocked: number
  cacheHits: number
  cacheHitRate: number
  avgCostPerCall: number
  avgSavingsPerCall: number
  savingsRate: number
  byModule: ModuleSavings
  byModel: Record<string, { calls: number; cost: number; tokens: number }>
  byFeature: Record<string, { calls: number; cost: number; saved: number }>
  entries: LedgerEntry[]
}

// ----------------------------
// Implementation
// ----------------------------

const MAX_LEDGER_ENTRIES = 10_000
const BROADCAST_CHANNEL_NAME = "tokenshield-ledger-sync"

export class CostLedger {
  private entries: LedgerEntry[] = []
  private listeners = new Set<() => void>()
  private idbStore: UseStore | null = null
  private persistEnabled: boolean
  private hydrated = false
  private channel: BroadcastChannel | null = null

  constructor(options?: { persist?: boolean; storeName?: string }) {
    this.persistEnabled = options?.persist ?? false
    if (typeof window !== "undefined") {
      // Setup persistence
      if (this.persistEnabled) {
        try {
          this.idbStore = createStore(options?.storeName ?? "tokenshield-ledger", "entries")
        } catch {
          // SSR or IDB unavailable
        }
      }

      // Cross-tab synchronization via BroadcastChannel. When one tab records
      // a ledger entry, other tabs merge it into their in-memory state so
      // dashboards stay up-to-date across browser tabs. Entries are deduplicated
      // by timestamp+model in mergeEntry(). Tabs that go offline simply miss
      // messages and resync from IDB on next page load.
      try {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        this.channel.onmessage = (event) => {
          try {
            if (event.data && event.data.type === "NEW_ENTRY" && event.data.entry) {
              this.mergeEntry(event.data.entry as LedgerEntry)
            }
          } catch {
            // Malformed cross-tab message — ignore to avoid crashing the handler
          }
        }
      } catch {
        // BroadcastChannel not supported (SSR, Workers, or older browsers)
      }
    }
  }

  /**
   * Subscribe to ledger updates. Returns an unsubscribe function.
   * Consumers (e.g. React hooks) can use this with useSyncExternalStore
   * to reactively track cost changes.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const l of this.listeners) l()
  }

  /**
   * Merge an external entry (from sync) into local state.
   */
  private mergeEntry(entry: LedgerEntry) {
    // Avoid duplicates
    if (this.entries.some((e) => e.id === entry.id)) return

    this.entries.push(entry)
    this.pruneEntries()

    // Sort to ensure chronological order despite async arrival
    this.entries.sort((a, b) => a.timestamp - b.timestamp)

    this.notify()
  }

  private pruneEntries() {
    if (this.entries.length > MAX_LEDGER_ENTRIES) {
      this.entries = this.entries.slice(-MAX_LEDGER_ENTRIES)
    }
  }

  /**
   * Record a real API call with its actual usage from the provider response.
   */
  async record(entry: {
    model: string
    inputTokens: number
    outputTokens: number
    cachedTokens?: number
    savings: Partial<ModuleSavings>
    feature?: string
    latencyMs?: number
    cacheHit?: boolean
    /** Token count that would have been sent without TokenShield */
    originalInputTokens?: number
    /** Model that would have been used without TokenShield */
    originalModel?: string
  }): Promise<LedgerEntry> {
    const actualCost = this.calculateCost(
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.cachedTokens ?? 0,
    )

    // Calculate counterfactual: what would this have cost without TokenShield?
    const originalInput = entry.originalInputTokens ?? entry.inputTokens
    const originalModel = entry.originalModel ?? entry.model
    const counterfactualCost = this.calculateCost(
      originalModel,
      originalInput,
      entry.outputTokens,
      0, // no caching without prefix optimization
    )

    const savings: ModuleSavings = {
      guard: 0,
      cache: 0,
      context: 0,
      router: 0,
      prefix: 0,
      ...entry.savings,
    }

    const ledgerEntry: LedgerEntry = {
      id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cachedTokens: entry.cachedTokens ?? 0,
      actualCost,
      costWithoutShield: counterfactualCost,
      totalSaved: counterfactualCost - actualCost,
      savings,
      feature: entry.feature,
      latencyMs: entry.latencyMs,
      cacheHit: entry.cacheHit ?? false,
    }

    // Update local state
    this.entries.push(ledgerEntry)
    this.pruneEntries()

    // Broadcast to other tabs
    if (this.channel) {
      this.channel.postMessage({ type: "NEW_ENTRY", entry: ledgerEntry })
    }

    // Persist to IndexedDB if enabled
    if (this.persistEnabled && this.idbStore) {
      try {
        await set(ledgerEntry.id, ledgerEntry, this.idbStore)
      } catch {
        // IDB write failed, data still in memory
      }
    }

    this.notify()
    return ledgerEntry
  }

  /**
   * Record a blocked request (guard prevented the call entirely).
   */
  async recordBlocked(entry: {
    model: string
    estimatedInputTokens: number
    estimatedOutputTokens: number
    reason: string
    feature?: string
  }): Promise<LedgerEntry> {
    const wouldHaveCost = this.calculateCost(
      entry.model,
      entry.estimatedInputTokens,
      entry.estimatedOutputTokens,
      0,
    )

    return this.record({
      model: entry.model,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      savings: { guard: wouldHaveCost },
      feature: entry.feature,
      cacheHit: false,
    })
  }

  /**
   * Record a cache hit (no API call made).
   */
  async recordCacheHit(entry: {
    model: string
    savedInputTokens: number
    savedOutputTokens: number
    feature?: string
  }): Promise<LedgerEntry> {
    const wouldHaveCost = this.calculateCost(
      entry.model,
      entry.savedInputTokens,
      entry.savedOutputTokens,
      0,
    )

    return this.record({
      model: entry.model,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      savings: { cache: wouldHaveCost },
      feature: entry.feature,
      cacheHit: true,
    })
  }

  /**
   * Get a full summary of all tracked costs and savings.
   */
  getSummary(): LedgerSummary {
    const byModule: ModuleSavings = { guard: 0, cache: 0, context: 0, router: 0, prefix: 0 }
    const byModel: Record<string, { calls: number; cost: number; tokens: number }> = {}
    const byFeature: Record<string, { calls: number; cost: number; saved: number }> = {}

    let totalSpent = 0
    let totalSaved = 0
    let cacheHits = 0
    let callsBlocked = 0

    for (const e of this.entries) {
      totalSpent += e.actualCost
      totalSaved += e.totalSaved

      byModule.guard += e.savings.guard
      byModule.cache += e.savings.cache
      byModule.context += e.savings.context
      byModule.router += e.savings.router
      byModule.prefix += e.savings.prefix

      if (e.cacheHit) cacheHits++
      if (e.savings.guard > 0 && e.inputTokens === 0) callsBlocked++

      // Per-model breakdown
      if (!byModel[e.model]) byModel[e.model] = { calls: 0, cost: 0, tokens: 0 }
      byModel[e.model].calls++
      byModel[e.model].cost += e.actualCost
      byModel[e.model].tokens += e.inputTokens + e.outputTokens

      // Per-feature breakdown
      const feat = e.feature ?? "_untagged"
      if (!byFeature[feat]) byFeature[feat] = { calls: 0, cost: 0, saved: 0 }
      byFeature[feat].calls++
      byFeature[feat].cost += e.actualCost
      byFeature[feat].saved += e.totalSaved
    }

    const totalCalls = this.entries.length
    const totalPossibleSpend = totalSpent + totalSaved

    return {
      totalSpent,
      totalSaved,
      totalCalls,
      callsBlocked,
      cacheHits,
      cacheHitRate: totalCalls > 0 ? cacheHits / totalCalls : 0,
      avgCostPerCall: totalCalls > 0 ? totalSpent / totalCalls : 0,
      avgSavingsPerCall: totalCalls > 0 ? totalSaved / totalCalls : 0,
      savingsRate: totalPossibleSpend > 0 ? totalSaved / totalPossibleSpend : 0,
      byModule,
      byModel,
      byFeature,
      entries: [...this.entries],
    }
  }

  /**
   * Load entries from IndexedDB (for session restore).
   * Idempotent: calling multiple times is safe (second call returns 0).
   */
  async hydrate(): Promise<number> {
    if (!this.persistEnabled || !this.idbStore || this.hydrated) return 0
    this.hydrated = true
    try {
      const allKeys = (await keys(this.idbStore)) as string[]
      const existingIds = new Set(this.entries.map((e) => e.id))
      let loaded = 0
      for (const key of allKeys) {
        const entry = await get<LedgerEntry>(key, this.idbStore)
        if (entry && !existingIds.has(entry.id)) {
          this.entries.push(entry)
          loaded++
        }
      }
      if (loaded > 0) {
        this.entries.sort((a, b) => a.timestamp - b.timestamp)
        this.pruneEntries()
        this.notify()
      }
      return loaded
    } catch {
      return 0
    }
  }

  /**
   * Export all entries as JSON (for finance teams / reporting).
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        summary: this.getSummary(),
        entries: this.entries,
      },
      null,
      2,
    )
  }

  /**
   * Export all entries as CSV (for spreadsheet / finance tooling).
   */
  exportCSV(): string {
    const headers = [
      "id",
      "timestamp",
      "model",
      "inputTokens",
      "outputTokens",
      "cachedTokens",
      "actualCost",
      "costWithoutShield",
      "totalSaved",
      "feature",
      "cacheHit",
      "guard",
      "cache",
      "context",
      "router",
      "prefix",
    ]
    const rows = this.entries.map((e) =>
      [
        e.id,
        new Date(e.timestamp).toISOString(),
        e.model,
        e.inputTokens,
        e.outputTokens,
        e.cachedTokens,
        e.actualCost.toFixed(6),
        e.costWithoutShield.toFixed(6),
        e.totalSaved.toFixed(6),
        e.feature ?? "",
        e.cacheHit,
        e.savings.guard.toFixed(6),
        e.savings.cache.toFixed(6),
        e.savings.context.toFixed(6),
        e.savings.router.toFixed(6),
        e.savings.prefix.toFixed(6),
      ]
        .map((v) => {
          const s = String(v)
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`
          }
          return s
        })
        .join(","),
    )
    return [headers.join(","), ...rows].join("\n")
  }

  /**
   * Get entries for a specific time window.
   */
  getEntriesSince(sinceMs: number): LedgerEntry[] {
    const cutoff = Date.now() - sinceMs
    return this.entries.filter((e) => e.timestamp >= cutoff)
  }

  /**
   * Reset ledger (clear all entries).
   */
  reset(): void {
    this.entries = []
    this.notify()
  }

  /**
   * Dispose resources (close channels).
   */
  dispose(): void {
    if (this.channel) {
      this.channel.onmessage = null
      this.channel.close()
      this.channel = null
    }
    this.listeners.clear()
  }

  /**
   * Exact dollar cost from token counts and model pricing.
   * Accounts for OpenAI cached token discount.
   */
  private calculateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
  ): number {
    const pricing = MODEL_PRICING[modelId]
    if (!pricing) {
      // Fallback: use estimateCost which handles unknown models
      try {
        return estimateCost(modelId, inputTokens, outputTokens).totalCost
      } catch {
        // Unknown model — use fallback pricing instead of 0 to keep
        // ledger entries, summaries, and exports accurate
        return (
          (inputTokens / 1_000_000) * FALLBACK_INPUT_PER_MILLION +
          (outputTokens / 1_000_000) * FALLBACK_OUTPUT_PER_MILLION
        )
      }
    }

    const uncachedInput = Math.max(0, inputTokens - cachedTokens)
    const cachedCost = pricing.cachedInputPerMillion
      ? (cachedTokens / 1_000_000) * pricing.cachedInputPerMillion
      : (cachedTokens / 1_000_000) * pricing.inputPerMillion * 0.5
    const uncachedCost = (uncachedInput / 1_000_000) * pricing.inputPerMillion
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion

    return cachedCost + uncachedCost + outputCost
  }
}
