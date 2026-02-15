"use client"

import * as React from "react"
import { useDashboard, type AnomalyRecord } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Check, Activity, ShieldAlert, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatRelativeTime,
  SEVERITY_DOT_COLOR,
  SEVERITY_DOT_ANIMATION,
  ANOMALY_TYPE_BADGE_COLOR,
  ANOMALY_TYPE_LABELS,
} from "@/lib/dashboard-utils"

/* ------------------------------------------------------------------ */
/*  Summary stats bar                                                  */
/* ------------------------------------------------------------------ */

const SummaryStats = React.memo(function SummaryStats({
  anomalies,
}: {
  anomalies: AnomalyRecord[]
}) {
  const { total, unacknowledged, high, medium, low } = React.useMemo(() => {
    let unack = 0
    let h = 0
    let m = 0
    let l = 0
    for (const a of anomalies) {
      if (!a.acknowledged) unack++
      if (a.severity === "high") h++
      else if (a.severity === "medium") m++
      else l++
    }
    return { total: anomalies.length, unacknowledged: unack, high: h, medium: m, low: l }
  }, [anomalies])

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/30 bg-secondary/20 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
          {total}
        </span>
      </div>

      <div className="h-3 w-px bg-border/40" />

      <div className="flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Unacknowledged</span>
        <span
          className={cn(
            "font-mono text-xs font-semibold tabular-nums",
            unacknowledged > 0 ? "text-[hsl(38,92%,65%)]" : "text-foreground",
          )}
        >
          {unacknowledged}
        </span>
      </div>

      <div className="h-3 w-px bg-border/40" />

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-md bg-[hsl(0,72%,51%)]/5 px-1.5 py-0.5">
          <div className="h-2 w-2 rounded-full bg-[hsl(0,72%,51%)]" />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{high}</span>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-[hsl(38,92%,50%)]/5 px-1.5 py-0.5">
          <div className="h-2 w-2 rounded-full bg-[hsl(38,92%,50%)]" />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{medium}</span>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-[hsl(152,60%,52%)]/5 px-1.5 py-0.5">
          <div className="h-2 w-2 rounded-full bg-[hsl(152,60%,52%)]" />
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{low}</span>
        </div>
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  Anomaly row                                                        */
/* ------------------------------------------------------------------ */

const AnomalyRow = React.memo(function AnomalyRow({
  anomaly,
  onAcknowledge,
}: {
  anomaly: AnomalyRecord
  onAcknowledge: (id: number) => void
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-secondary/30",
        !anomaly.acknowledged &&
          anomaly.severity === "high" &&
          "bg-[hsl(0,72%,51%)]/5 border-l-2 border-l-[hsl(0,72%,51%)]",
      )}
    >
      {/* Severity dot */}
      <div className="flex h-5 items-center">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            SEVERITY_DOT_COLOR[anomaly.severity] ?? "bg-muted-foreground",
            !anomaly.acknowledged && (SEVERITY_DOT_ANIMATION[anomaly.severity] ?? ""),
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 rounded px-1.5 py-0 text-[10px] font-medium",
              ANOMALY_TYPE_BADGE_COLOR[anomaly.type] ??
                "border-border/30 bg-secondary/30 text-muted-foreground",
            )}
          >
            {ANOMALY_TYPE_LABELS[anomaly.type] ?? anomaly.type}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{anomaly.message}</span>
        </div>
      </div>

      {/* Timestamp */}
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
        {formatRelativeTime(anomaly.timestamp)}
      </span>

      {/* Acknowledge button */}
      <div className="flex h-5 items-center">
        {anomaly.acknowledged ? (
          <div className="flex h-6 w-6 items-center justify-center text-[hsl(152,60%,52%)]">
            <Check className="h-3.5 w-3.5" />
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAcknowledge(anomaly.id)}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            title="Acknowledge anomaly"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AnomalyPanel() {
  const { data, acknowledgeAnomaly } = useDashboard()
  const anomalies = data.anomalies
  const displayAnomalies = React.useMemo(
    () => [...anomalies].sort((a, b) => b.timestamp - a.timestamp),
    [anomalies],
  )

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">Anomaly Detection</CardTitle>
            <CardDescription className="text-xs">
              AI-powered spending anomaly detection
            </CardDescription>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 text-[hsl(38,92%,65%)]">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Summary statistics */}
        <SummaryStats anomalies={anomalies} />

        {/* Anomaly list */}
        <ScrollArea className="h-[300px]">
          <div
            className="flex flex-col gap-1"
            role="log"
            aria-live="polite"
            aria-label="Anomaly events"
          >
            {displayAnomalies.map((anomaly) => (
              <AnomalyRow key={anomaly.id} anomaly={anomaly} onAcknowledge={acknowledgeAnomaly} />
            ))}
            {displayAnomalies.length === 0 && (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-secondary/10">
                <ShieldCheck className="h-6 w-6 text-[hsl(152,60%,52%)]/60" />
                <span className="text-xs font-medium text-muted-foreground">
                  All clear &mdash; no anomalies detected
                </span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
