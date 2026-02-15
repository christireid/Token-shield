"use client"

import { useMemo } from "react"
import { useDashboard, type PipelineStageMetric } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { STAGE_COLORS } from "@/lib/dashboard-utils"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { Activity, AlertTriangle } from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSuccessRateColor(rate: number): string {
  if (rate >= 99) return "text-[hsl(152,60%,52%)]"
  if (rate >= 97) return "text-[hsl(38,92%,60%)]"
  return "text-[hsl(0,72%,65%)]"
}

/* ------------------------------------------------------------------ */
/*  Stacked bar visualization                                          */
/* ------------------------------------------------------------------ */

function PipelineBar({ metrics }: { metrics: PipelineStageMetric[] }) {
  const totalDuration = metrics.reduce((sum, m) => sum + m.avgDurationMs, 0)
  if (totalDuration === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground">Avg pipeline duration</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {totalDuration.toFixed(1)}ms total
        </span>
      </div>
      <div className="flex h-4 w-full gap-px overflow-hidden rounded-full bg-secondary/50">
        {metrics
          .filter((m) => (m.avgDurationMs / totalDuration) * 100 >= 0.5)
          .map((m, idx, arr) => {
            const pct = (m.avgDurationMs / totalDuration) * 100
            return (
              <div
                key={m.stage}
                className={cn(
                  "h-full transition-all duration-500",
                  idx === 0 && "rounded-l-full",
                  idx === arr.length - 1 && "rounded-r-full",
                )}
                style={{
                  width: `${pct}%`,
                  backgroundColor: STAGE_COLORS[m.stage] ?? "hsl(215, 15%, 45%)",
                }}
                title={`${m.stage}: ${m.avgDurationMs.toFixed(1)}ms (${pct.toFixed(1)}%)`}
              />
            )
          })}
      </div>

      {/* Inline legend under the bar */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {metrics.map((m) => {
          const pct = totalDuration > 0 ? (m.avgDurationMs / totalDuration) * 100 : 0
          return (
            <div key={m.stage} className="flex items-center gap-1.5">
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STAGE_COLORS[m.stage] }}
              />
              <span className="text-[10px] text-muted-foreground">{m.stage}</span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {pct.toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stage row                                                          */
/* ------------------------------------------------------------------ */

function StageRow({
  metric,
  isTopSaver,
  index,
  reducedMotion,
}: {
  metric: PipelineStageMetric
  isTopSaver: boolean
  index: number
  reducedMotion: boolean
}) {
  const color = STAGE_COLORS[metric.stage] ?? "hsl(215, 15%, 45%)"

  return (
    <div
      className={cn(
        "group grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-4 rounded-md border-l-2 border-l-transparent px-2 py-1.5 transition-all",
        "hover:bg-secondary/30",
        index % 2 === 1 && "bg-secondary/10",
      )}
      style={{ ["--stage-color" as string]: color }}
      onMouseEnter={(e) => (e.currentTarget.style.borderLeftColor = color)}
      onMouseLeave={(e) => (e.currentTarget.style.borderLeftColor = "transparent")}
    >
      {/* Stage name with color dot */}
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isTopSaver && !reducedMotion && "animate-[pulse-glow_2s_ease-in-out_infinite]",
          )}
          style={{
            backgroundColor: color,
            ...(isTopSaver ? { boxShadow: `0 0 6px 2px ${color}` } : {}),
          }}
        />
        <span className="truncate text-xs font-medium text-foreground">{metric.stage}</span>
      </div>

      {/* Avg Duration */}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {metric.avgDurationMs.toFixed(1)}ms
      </span>

      {/* Executions */}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {metric.totalExecutions.toLocaleString()}
      </span>

      {/* Savings */}
      <span className="font-mono text-xs tabular-nums text-foreground">
        ${metric.totalSavings.toFixed(4)}
      </span>

      {/* Success Rate */}
      <span
        className={cn(
          "font-mono text-xs tabular-nums font-medium",
          getSuccessRateColor(metric.successRate),
        )}
      >
        {metric.successRate.toFixed(1)}%
      </span>

      {/* Errors */}
      {metric.errorCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(0,72%,51%)]/10 px-1.5 font-mono text-xs font-medium tabular-nums text-[hsl(0,72%,65%)]">
          <AlertTriangle className="h-3 w-3" />
          {metric.errorCount}
        </span>
      ) : (
        <span className="font-mono text-xs tabular-nums text-muted-foreground/60">
          {metric.errorCount}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PipelineMetrics() {
  const { data } = useDashboard()
  const metrics = data.pipelineMetrics
  const reducedMotion = useReducedMotion()

  const totalDuration = useMemo(
    () => metrics.reduce((sum, m) => sum + m.avgDurationMs, 0),
    [metrics],
  )
  const totalExecutions = useMemo(
    () => metrics.reduce((sum, m) => sum + m.totalExecutions, 0),
    [metrics],
  )
  const totalSavings = useMemo(() => metrics.reduce((sum, m) => sum + m.totalSavings, 0), [metrics])

  const topSaverStage = useMemo(
    () =>
      metrics.length > 0
        ? metrics.reduce((best, m) => (m.totalSavings > best.totalSavings ? m : best)).stage
        : "",
    [metrics],
  )

  return (
    <Card className="border-border/40 bg-card/50">
      {/* Pulse-glow keyframe for top-saver dot */}
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.35); }
        }
      `}</style>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">
              Pipeline Performance
            </CardTitle>
            <CardDescription className="text-xs">
              Per-stage execution metrics across the middleware pipeline
            </CardDescription>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 text-muted-foreground">
            <Activity className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Stacked bar visualization */}
          <PipelineBar metrics={metrics} />

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-4 border-b border-border/30 px-2 pb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Stage
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Avg
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Execs
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Savings
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Success
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Errors
            </span>
          </div>

          {/* Stage rows */}
          <div className="flex flex-col gap-0.5">
            {metrics.map((m, idx) => (
              <StageRow
                key={m.stage}
                metric={m}
                isTopSaver={m.stage === topSaverStage}
                index={idx}
                reducedMotion={reducedMotion}
              />
            ))}
          </div>

          {/* Totals footer */}
          <div className="flex items-center justify-between rounded-md border border-border/30 bg-gradient-to-r from-secondary/30 via-secondary/20 to-secondary/30 px-3 py-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Pipeline totals
            </span>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] text-muted-foreground/60">Duration</span>
                <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                  {totalDuration.toFixed(1)}ms
                </span>
              </div>
              <div className="h-6 w-px bg-border/30" />
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] text-muted-foreground/60">Executions</span>
                <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                  {totalExecutions.toLocaleString()}
                </span>
              </div>
              <div className="h-6 w-px bg-border/30" />
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[10px] text-muted-foreground/60">Savings</span>
                <span className="font-mono text-sm font-bold tabular-nums text-primary">
                  ${totalSavings.toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
