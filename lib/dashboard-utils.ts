/**
 * Shared dashboard utilities — single source of truth for formatting,
 * color palettes, and badge classes used across dashboard components.
 */

/* ------------------------------------------------------------------ */
/*  Relative time formatting                                           */
/* ------------------------------------------------------------------ */

/**
 * Format a timestamp into a human-readable relative time string.
 * Uses a "just now" threshold of < 5 seconds.
 */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const diff = Math.floor((now - ts) / 1000)
  if (diff < 5) return "just now"
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/* ------------------------------------------------------------------ */
/*  Currency / number formatting                                       */
/* ------------------------------------------------------------------ */

/** Compact currency: "$12.5k", "$3.45", "$0.0012", "-$5.00" */
export function formatCurrency(n: number, prefix = "$"): string {
  if (n < 0) return `-${formatCurrency(Math.abs(n), prefix)}`
  if (n >= 1000) return `${prefix}${(n / 1000).toFixed(1)}k`
  if (n >= 1) return `${prefix}${n.toFixed(2)}`
  return `${prefix}${n.toFixed(4)}`
}

/** Format a percentage to one decimal place */
export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`
}

/* ------------------------------------------------------------------ */
/*  Event type formatting                                              */
/* ------------------------------------------------------------------ */

/** "cache:hit" -> "Cache Hit" */
export function formatEventType(type: string): string {
  return type.replace(":", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/* ------------------------------------------------------------------ */
/*  Dashboard color palette                                            */
/* ------------------------------------------------------------------ */

export const COLORS = {
  primary: "hsl(152, 60%, 52%)",
  cyan: "hsl(190, 70%, 50%)",
  amber: "hsl(38, 92%, 50%)",
  red: "hsl(0, 72%, 51%)",
  purple: "hsl(270, 60%, 60%)",
  orange: "hsl(25, 95%, 53%)",
  blue: "hsl(215, 70%, 55%)",
  muted: "hsl(215, 15%, 45%)",
  grid: "hsl(220, 14%, 12%)",
} as const

/* ------------------------------------------------------------------ */
/*  Pipeline stage colors                                              */
/* ------------------------------------------------------------------ */

export const STAGE_COLORS: Record<string, string> = {
  "Circuit Breaker": "hsl(0, 72%, 60%)",
  "Request Guard": "hsl(38, 92%, 50%)",
  "Response Cache": "hsl(190, 70%, 50%)",
  "Context Manager": "hsl(270, 60%, 60%)",
  "Model Router": "hsl(152, 60%, 52%)",
  "Prefix Optimizer": "hsl(330, 60%, 55%)",
}

/* ------------------------------------------------------------------ */
/*  Module colors & labels                                             */
/* ------------------------------------------------------------------ */

export const MODULE_COLORS: Record<string, string> = {
  guard: "hsl(0, 72%, 60%)",
  cache: "hsl(190, 70%, 50%)",
  context: "hsl(38, 92%, 50%)",
  router: "hsl(270, 60%, 60%)",
  prefix: "hsl(152, 60%, 52%)",
}

export const MODULE_LABELS: Record<string, string> = {
  guard: "Request Guard",
  cache: "Response Cache",
  context: "Context Manager",
  router: "Model Router",
  prefix: "Prefix Optimizer",
}

/* ------------------------------------------------------------------ */
/*  Model colors                                                       */
/* ------------------------------------------------------------------ */

export const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "hsl(152, 60%, 52%)",
  "claude-sonnet-4": "hsl(190, 70%, 50%)",
  "gemini-2.5-flash": "hsl(38, 92%, 50%)",
  "gpt-4o-mini": "hsl(270, 60%, 60%)",
  "claude-haiku-3.5": "hsl(0, 72%, 60%)",
}

const MODEL_FALLBACK_COLORS = [
  "hsl(160, 50%, 45%)",
  "hsl(200, 60%, 50%)",
  "hsl(30, 80%, 55%)",
  "hsl(280, 50%, 55%)",
  "hsl(350, 60%, 55%)",
]

export function getModelColor(id: string, idx: number): string {
  return MODEL_COLORS[id] || MODEL_FALLBACK_COLORS[idx % MODEL_FALLBACK_COLORS.length]
}

/* ------------------------------------------------------------------ */
/*  Event dot & badge colors                                           */
/* ------------------------------------------------------------------ */

type EventType =
  | "cache:hit"
  | "cache:miss"
  | "request:blocked"
  | "router:downgraded"
  | "context:trimmed"
  | "prefix:optimized"
  | "ledger:entry"
  | "breaker:warning"

export const EVENT_DOT_COLORS: Record<EventType, string> = {
  "cache:hit": "bg-[hsl(190,70%,50%)]",
  "cache:miss": "bg-[hsl(215,15%,45%)]",
  "request:blocked": "bg-[hsl(0,72%,51%)]",
  "router:downgraded": "bg-[hsl(270,60%,60%)]",
  "context:trimmed": "bg-[hsl(38,92%,50%)]",
  "prefix:optimized": "bg-[hsl(152,60%,52%)]",
  "ledger:entry": "bg-[hsl(152,60%,52%)]",
  "breaker:warning": "bg-[hsl(25,95%,53%)]",
}

export const EVENT_BADGE_COLORS: Record<EventType, string> = {
  "cache:hit": "border-[hsl(190,70%,50%)]/30 bg-[hsl(190,70%,50%)]/10 text-[hsl(190,70%,65%)]",
  "cache:miss": "border-border/30 bg-secondary/30 text-muted-foreground",
  "request:blocked": "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
  "router:downgraded":
    "border-[hsl(270,60%,60%)]/30 bg-[hsl(270,60%,60%)]/10 text-[hsl(270,60%,75%)]",
  "context:trimmed": "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  "prefix:optimized":
    "border-[hsl(152,60%,52%)]/30 bg-[hsl(152,60%,52%)]/10 text-[hsl(152,60%,65%)]",
  "ledger:entry": "border-[hsl(152,60%,52%)]/30 bg-[hsl(152,60%,52%)]/10 text-[hsl(152,60%,65%)]",
  "breaker:warning": "border-[hsl(25,95%,53%)]/30 bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,65%)]",
}

/* ------------------------------------------------------------------ */
/*  Severity / anomaly colors                                          */
/* ------------------------------------------------------------------ */

export const SEVERITY_DOT_COLOR: Record<"high" | "medium" | "low", string> = {
  high: "bg-[hsl(0,72%,51%)]",
  medium: "bg-[hsl(38,92%,50%)]",
  low: "bg-[hsl(152,60%,52%)]",
}

export const SEVERITY_DOT_ANIMATION: Record<"high" | "medium" | "low", string> = {
  high: "animate-pulse",
  medium: "animate-pulse [animation-duration:2.5s]",
  low: "",
}

export const ANOMALY_TYPE_BADGE_COLOR: Record<string, string> = {
  cost_spike: "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
  token_spike: "border-[hsl(270,60%,60%)]/30 bg-[hsl(270,60%,60%)]/10 text-[hsl(270,60%,75%)]",
  cost_rate_change: "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  token_rate_change:
    "border-[hsl(190,70%,50%)]/30 bg-[hsl(190,70%,50%)]/10 text-[hsl(190,70%,65%)]",
  cost_percentile: "border-[hsl(25,95%,53%)]/30 bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,65%)]",
}

export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  cost_spike: "Cost Spike",
  token_spike: "Token Spike",
  cost_rate_change: "Cost Rate Change",
  token_rate_change: "Token Rate Change",
  cost_percentile: "Cost Percentile",
}

/* ------------------------------------------------------------------ */
/*  Alert severity config                                              */
/* ------------------------------------------------------------------ */

export const ALERT_SEVERITY_CONFIG: Record<
  "info" | "warning" | "critical",
  {
    containerClass: string
    iconClass: string
    titleClass: string
    badgeClass: string
  }
> = {
  info: {
    containerClass: "bg-blue-500/5 border-blue-500/20",
    iconClass: "text-blue-400",
    titleClass: "text-blue-300",
    badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  warning: {
    containerClass: "bg-[hsl(38,92%,50%)]/5 border-[hsl(38,92%,50%)]/20",
    iconClass: "text-[hsl(38,92%,60%)]",
    titleClass: "text-[hsl(38,92%,65%)]",
    badgeClass: "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  },
  critical: {
    containerClass: "bg-[hsl(0,72%,51%)]/5 border-[hsl(0,72%,51%)]/20",
    iconClass: "text-[hsl(0,72%,60%)]",
    titleClass: "text-[hsl(0,72%,65%)]",
    badgeClass: "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
  },
}

/* ------------------------------------------------------------------ */
/*  Provider health colors                                             */
/* ------------------------------------------------------------------ */

export const STATUS_DOT_CLASS: Record<"healthy" | "degraded" | "down", string> = {
  healthy: "bg-[hsl(152,60%,52%)] ring-2 ring-[hsl(152,60%,52%)]/20",
  degraded: "bg-[hsl(38,92%,50%)] ring-2 ring-[hsl(38,92%,50%)]/20",
  down: "bg-[hsl(0,72%,51%)] ring-2 ring-[hsl(0,72%,51%)]/20",
}

export const STATUS_BADGE_CLASS: Record<"healthy" | "degraded" | "down", string> = {
  healthy: "border-primary/30 bg-primary/10 text-primary",
  degraded: "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  down: "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
}

export const STATUS_LABEL: Record<"healthy" | "degraded" | "down", string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
}

export const PROVIDER_ACCENT: Record<string, { bg: string; border: string }> = {
  OpenAI: { bg: "bg-emerald-500/5", border: "border-l-emerald-500" },
  Anthropic: { bg: "bg-orange-500/5", border: "border-l-orange-500" },
  Google: { bg: "bg-blue-500/5", border: "border-l-blue-500" },
}
