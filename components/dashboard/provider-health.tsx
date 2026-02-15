"use client"

import { useDashboard, type ProviderHealthRecord } from "./dashboard-provider"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Activity, Wifi, WifiOff, Clock } from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_DOT_CLASS: Record<ProviderHealthRecord["status"], string> = {
  healthy: "bg-[hsl(152,60%,52%)] animate-pulse",
  degraded: "bg-[hsl(38,92%,50%)]",
  down: "bg-[hsl(0,72%,51%)]",
}

const STATUS_BADGE_CLASS: Record<ProviderHealthRecord["status"], string> = {
  healthy:
    "border-primary/30 bg-primary/10 text-primary",
  degraded:
    "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  down:
    "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
}

const STATUS_LABEL: Record<ProviderHealthRecord["status"], string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
}

const STATUS_ICON: Record<ProviderHealthRecord["status"], React.ReactNode> = {
  healthy: <Wifi className="h-3.5 w-3.5 text-primary" />,
  degraded: <Activity className="h-3.5 w-3.5 text-[hsl(38,92%,65%)]" />,
  down: <WifiOff className="h-3.5 w-3.5 text-[hsl(0,72%,65%)]" />,
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5) return "just now"
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

/** Latency bar scaled to a 0-500ms range */
function LatencyBar({ latencyMs }: { latencyMs: number }) {
  const clamped = Math.min(500, Math.max(0, latencyMs))
  const percent = (clamped / 500) * 100
  const color =
    clamped >= 400
      ? "bg-[hsl(0,72%,51%)]"
      : clamped >= 250
        ? "bg-[hsl(38,92%,50%)]"
        : "bg-primary"

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-xs tabular-nums text-foreground">
        {Math.round(latencyMs)}ms
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Provider row                                                       */
/* ------------------------------------------------------------------ */

function ProviderRow({ record }: { record: ProviderHealthRecord }) {
  const errorRateHigh = record.errorRate > 2

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/30 bg-secondary/20 px-4 py-3 transition-colors hover:border-border/50 hover:bg-secondary/30">
      {/* Top row: provider name + status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {STATUS_ICON[record.status]}
          <span className="text-sm font-bold text-foreground">
            {record.provider}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              STATUS_DOT_CLASS[record.status],
            )}
          />
          <Badge
            variant="outline"
            className={cn(
              "rounded px-1.5 py-0 text-[10px] font-medium",
              STATUS_BADGE_CLASS[record.status],
            )}
          >
            {STATUS_LABEL[record.status]}
          </Badge>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {/* Latency */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            Latency
          </span>
          <LatencyBar latencyMs={record.latencyMs} />
        </div>

        {/* Error rate */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            Error Rate
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              errorRateHigh
                ? "text-[hsl(0,72%,65%)]"
                : "text-foreground",
            )}
          >
            {record.errorRate.toFixed(2)}%
          </span>
        </div>

        {/* Request count */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            Requests
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {record.requestCount.toLocaleString()}
          </span>
        </div>

        {/* Uptime */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            Uptime
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              record.uptimePercent >= 99.5
                ? "text-primary"
                : record.uptimePercent >= 99
                  ? "text-[hsl(38,92%,65%)]"
                  : "text-[hsl(0,72%,65%)]",
            )}
          >
            {record.uptimePercent.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Last checked */}
      <div className="flex items-center gap-1 text-muted-foreground/60">
        <Clock className="h-3 w-3" />
        <span className="font-mono text-[10px] tabular-nums">
          {formatRelativeTime(record.lastChecked)}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ProviderHealth() {
  const { data } = useDashboard()

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">
          Provider Health
        </CardTitle>
        <CardDescription className="text-xs">
          Real-time API provider status and latency
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.providerHealth.map((record) => (
          <ProviderRow key={record.provider} record={record} />
        ))}
        {data.providerHealth.length === 0 && (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            No provider data available.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
