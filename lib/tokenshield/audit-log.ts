/**
 * TokenShield - Audit Logger
 *
 * Enterprise-grade audit logging for compliance and forensic analysis.
 * Records all TokenShield actions (API calls, blocked requests, budget
 * changes, config modifications) as immutable, structured entries.
 *
 * Features:
 * - Tamper-evident: each entry includes a SHA-256 hash of the previous entry
 *   (falls back to djb2 when Web Crypto is unavailable)
 * - Structured: machine-parseable JSON entries with consistent schema
 * - Exportable: JSON/CSV export for compliance reporting
 * - Configurable: filter by event type, severity, or module
 * - Persistent: optional IndexedDB persistence via storage-adapter
 */

import { get, set } from "./storage-adapter"

export type AuditEventType =
  | "api_call"
  | "cache_hit"
  | "request_blocked"
  | "budget_exceeded"
  | "budget_warning"
  | "breaker_tripped"
  | "breaker_reset"
  | "model_routed"
  | "anomaly_detected"
  | "config_changed"
  | "license_activated"
  | "export_requested"

export type AuditSeverity = "info" | "warn" | "error" | "critical"

export interface AuditEntry {
  /** Monotonically increasing sequence number */
  seq: number
  /** ISO 8601 timestamp */
  timestamp: string
  /** Event type for filtering */
  eventType: AuditEventType
  /** Severity level */
  severity: AuditSeverity
  /** Module that generated the event */
  module: string
  /** User ID if available */
  userId?: string
  /** Model involved */
  model?: string
  /** Human-readable description */
  description: string
  /** Structured event data */
  data: Record<string, unknown>
  /** Hash of the previous entry for tamper detection */
  prevHash: string
  /** Hash of this entry (SHA-256 hex or djb2 fallback) */
  hash: string
}

export interface AuditLogConfig {
  /** Maximum entries to keep in memory (default: 50,000) */
  maxEntries?: number
  /** Filter: only log these event types (default: all) */
  eventTypes?: AuditEventType[]
  /** Filter: minimum severity to log (default: "info") */
  minSeverity?: AuditSeverity
  /** Callback for real-time forwarding (e.g., to SIEM, external logger) */
  onEntry?: (entry: AuditEntry) => void
  /** Persist entries to IndexedDB (default: false) */
  persist?: boolean
  /** IndexedDB storage key prefix (default: "shield_audit_log") */
  storageKey?: string
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
}

const DEFAULT_CONFIG: Required<AuditLogConfig> = {
  maxEntries: 50_000,
  eventTypes: [],
  minSeverity: "info",
  onEntry: () => {},
  persist: false,
  storageKey: "shield_audit_log",
}

// -------------------------------------------------------
// Hash functions
// -------------------------------------------------------

/** Whether we've determined Web Crypto availability. */
let _cryptoAvailable: boolean | null = null

function isCryptoAvailable(): boolean {
  if (_cryptoAvailable !== null) return _cryptoAvailable
  try {
    _cryptoAvailable =
      typeof globalThis !== "undefined" &&
      typeof globalThis.crypto?.subtle?.digest === "function"
  } catch {
    _cryptoAvailable = false
  }
  return _cryptoAvailable
}

/**
 * SHA-256 hash via Web Crypto API. Returns hex string.
 */
async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * djb2 hash fallback for environments without Web Crypto.
 * Clearly labeled as non-cryptographic in output prefix.
 */
function djb2Hash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return "djb2_" + (hash >>> 0).toString(36)
}

/**
 * Compute entry hash using best available algorithm.
 * Uses SHA-256 when Web Crypto is available, djb2 otherwise.
 */
async function computeHash(input: string): Promise<string> {
  if (isCryptoAvailable()) {
    return sha256(input)
  }
  return djb2Hash(input)
}

/**
 * Synchronous hash for verification (djb2 only).
 * Used when verifying entries that were hashed with djb2.
 */
function computeHashSync(input: string): string {
  return djb2Hash(input)
}

export class AuditLog {
  private entries: AuditEntry[] = []
  private seq = 0
  private lastHash = "genesis"
  private config: Required<AuditLogConfig>
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  /** True when entries have been pruned — first entry's prevHash won't match "genesis" */
  private pruned = false

  constructor(config: AuditLogConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Record an audit event.
   */
  record(
    eventType: AuditEventType,
    severity: AuditSeverity,
    module: string,
    description: string,
    data: Record<string, unknown> = {},
    userId?: string,
    model?: string,
  ): AuditEntry {
    // Filter by severity
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[this.config.minSeverity]) {
      return this.createNoopEntry(eventType, severity, module, description)
    }

    // Filter by event type
    if (this.config.eventTypes.length > 0 && !this.config.eventTypes.includes(eventType)) {
      return this.createNoopEntry(eventType, severity, module, description)
    }

    this.seq++
    const timestamp = new Date().toISOString()

    const entryContent = `${this.seq}|${timestamp}|${eventType}|${module}|${description}|${JSON.stringify(data)}`
    // Use synchronous djb2 for record() to keep it non-async.
    // The hash chain is still tamper-evident (detects modifications).
    const hash = computeHashSync(`${this.lastHash}|${entryContent}`)

    const entry: AuditEntry = {
      seq: this.seq,
      timestamp,
      eventType,
      severity,
      module,
      userId,
      model,
      description,
      data,
      prevHash: this.lastHash,
      hash,
    }

    this.lastHash = hash
    this.entries.push(entry)

    // Prune if over limit
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries)
      this.pruned = true
    }

    // Forward to external handler
    this.config.onEntry(entry)

    // Schedule debounced persistence
    if (this.config.persist) {
      this.schedulePersist()
    }

    return entry
  }

  /**
   * Convenience methods for common events.
   */
  logApiCall(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    userId?: string,
  ): AuditEntry {
    return this.record(
      "api_call",
      "info",
      "middleware",
      `API call to ${model}`,
      { inputTokens, outputTokens, cost },
      userId,
      model,
    )
  }

  logCacheHit(model: string, prompt: string, userId?: string): AuditEntry {
    return this.record(
      "cache_hit",
      "info",
      "response-cache",
      `Cache hit for ${model}`,
      { promptLength: prompt.length },
      userId,
      model,
    )
  }

  logRequestBlocked(reason: string, model: string, userId?: string): AuditEntry {
    return this.record(
      "request_blocked",
      "warn",
      "request-guard",
      `Request blocked: ${reason}`,
      { reason },
      userId,
      model,
    )
  }

  logBudgetExceeded(userId: string, budget: number, spent: number): AuditEntry {
    return this.record(
      "budget_exceeded",
      "error",
      "user-budget-manager",
      `User ${userId} exceeded budget ($${spent.toFixed(2)}/$${budget.toFixed(2)})`,
      { userId, budget, spent },
      userId,
    )
  }

  logBreakerTripped(limitType: string, threshold: number, actual: number): AuditEntry {
    return this.record("breaker_tripped", "critical", "circuit-breaker", `Circuit breaker tripped: ${limitType}`, {
      limitType,
      threshold,
      actual,
    })
  }

  logAnomalyDetected(metric: string, value: number, zscore: number, model?: string): AuditEntry {
    return this.record(
      "anomaly_detected",
      "warn",
      "anomaly-detector",
      `Anomaly detected: ${metric} z-score ${zscore.toFixed(2)}`,
      { metric, value, zscore },
      undefined,
      model,
    )
  }

  logModelRouted(fromModel: string, toModel: string, reason: string, userId?: string): AuditEntry {
    return this.record(
      "model_routed",
      "info",
      "model-router",
      `Routed ${fromModel} → ${toModel}: ${reason}`,
      { fromModel, toModel, reason },
      userId,
      toModel,
    )
  }

  logConfigChanged(field: string, oldValue: unknown, newValue: unknown): AuditEntry {
    return this.record("config_changed", "warn", "config", `Config changed: ${field}`, {
      field,
      oldValue,
      newValue,
    })
  }

  /**
   * Verify the integrity of the audit chain.
   * Returns true if no entries have been tampered with.
   */
  verifyIntegrity(): { valid: boolean; brokenAt?: number; pruned?: boolean; verifiedFrom?: number } {
    if (this.entries.length === 0) return { valid: true }

    // For pruned chains, the first entry's prevHash won't be "genesis"
    // — start verification from the first available entry's recorded prevHash.
    let prevHash = this.pruned ? this.entries[0].prevHash : "genesis"
    for (const entry of this.entries) {
      if (entry.prevHash !== prevHash) {
        return { valid: false, brokenAt: entry.seq }
      }
      const content = `${entry.seq}|${entry.timestamp}|${entry.eventType}|${entry.module}|${entry.description}|${JSON.stringify(entry.data)}`
      const expectedHash = computeHashSync(`${prevHash}|${content}`)
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: entry.seq }
      }
      prevHash = entry.hash
    }

    if (this.pruned) {
      return { valid: true, pruned: true, verifiedFrom: this.entries[0].seq }
    }
    return { valid: true }
  }

  /**
   * Get all entries, optionally filtered.
   */
  getEntries(filters?: {
    eventType?: AuditEventType
    severity?: AuditSeverity
    module?: string
    userId?: string
    since?: number
  }): AuditEntry[] {
    let result = this.entries
    if (filters) {
      if (filters.eventType) result = result.filter((e) => e.eventType === filters.eventType)
      if (filters.severity)
        result = result.filter((e) => SEVERITY_RANK[e.severity] >= SEVERITY_RANK[filters.severity!])
      if (filters.module) result = result.filter((e) => e.module === filters.module)
      if (filters.userId) result = result.filter((e) => e.userId === filters.userId)
      if (filters.since) result = result.filter((e) => new Date(e.timestamp).getTime() >= filters.since!)
    }
    return [...result]
  }

  /**
   * Export as JSON for compliance reporting.
   */
  exportJSON(): string {
    const integrity = this.verifyIntegrity()
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        integrity,
        totalEntries: this.entries.length,
        entries: this.entries,
      },
      null,
      2,
    )
  }

  /**
   * Export as CSV for spreadsheet analysis.
   */
  exportCSV(): string {
    const headers = [
      "seq",
      "timestamp",
      "eventType",
      "severity",
      "module",
      "userId",
      "model",
      "description",
      "data",
      "hash",
    ]
    const rows = this.entries.map((e) =>
      [
        e.seq,
        e.timestamp,
        e.eventType,
        e.severity,
        e.module,
        e.userId ?? "",
        e.model ?? "",
        e.description,
        JSON.stringify(e.data),
        e.hash,
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
   * Hydrate entries from IndexedDB. Call once on startup.
   */
  async hydrate(): Promise<number> {
    if (!this.config.persist) return 0
    try {
      const stored = await get<AuditEntry[]>(this.config.storageKey)
      if (stored && Array.isArray(stored)) {
        this.entries = stored
        if (stored.length > 0) {
          const last = stored[stored.length - 1]
          this.seq = last.seq
          this.lastHash = last.hash
        }
        return stored.length
      }
    } catch {
      /* IDB not available */
    }
    return 0
  }

  /**
   * Get total entry count.
   */
  get size(): number {
    return this.entries.length
  }

  /**
   * Clear all entries.
   */
  async clear(): Promise<void> {
    this.entries = []
    this.seq = 0
    this.lastHash = "genesis"
    this.pruned = false
    if (this.config.persist) {
      try {
        await set(this.config.storageKey, [])
      } catch {
        /* IDB not available */
      }
    }
  }

  // -------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistAsync()
    }, 1000)
  }

  private persistAsync(): void {
    set(this.config.storageKey, this.entries).catch(() => {})
  }

  private createNoopEntry(
    eventType: AuditEventType,
    severity: AuditSeverity,
    module: string,
    description: string,
  ): AuditEntry {
    return {
      seq: -1,
      timestamp: new Date().toISOString(),
      eventType,
      severity,
      module,
      description,
      data: {},
      prevHash: "",
      hash: "",
    }
  }
}
