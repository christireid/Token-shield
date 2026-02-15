"use client"

import { useDashboard, type PipelineStageMetric } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Activity, AlertTriangle } from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Stage color mapping                                                */
/* ------------------------------------------------------------------ */

const STAGE_COLORS: Record<string, string> = {
  "Circuit Breaker": "hsl(0, 72%, 60%)",
  "Request Guard": "hsl(38, 92%, 50%)",
  "Response Cache": "hsl(190, 70%, 50%)",
  "Context Manager": "hsl(270, 60%, 60%)",
  "Model Router": "hsl(152, 60%, 52%)",
  "Prefix Optimizer": "hsl(330, 60%, 55%)",
}

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
        <span className="text-[10px] font-medium text-muted-foreground">
          Avg pipeline duration
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {totalDuration.toFixed(1)}ms total
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary/50">
        {metrics.map((m) => {
          const pct = (m.avgDurationMs / totalDuration) * 100
          if (pct < 0.5) return null
          return (
            <div
              key={m.stage}
              className="h-full transition-all duration-500"
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
              <span className="text-[10px] text-muted-foreground">
                {m.stage}
              </span>
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

function StageRow({ metric }: { metric: PipelineStageMetric }) {
  const color = STAGE_COLORS[metric.stage] ?? "hsl(215, 15%, 45%)"

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-x-4 rounded-md px-2 py-1.5 transition-colors hover:bg-secondary/30">
      {/* Stage name with color dot */}
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate text-xs font-medium text-foreground">
          {metric.stage}
        </span>
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
      <span
        className={cn(
          "font-mono text-xs tabular-nums",
          metric.errorCount > 0
            ? "font-medium text-[hsl(0,72%,65%)]"
            : "text-muted-foreground/60",
        )}
      >
        {metric.errorCount > 0 && (
          <AlertTriangle className="mr-1 inline-block h-3 w-3 align-text-bottom" />
        )}
        {metric.errorCount}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PipelineMetrics() {
  const { data } = useDashboard()
  const metrics = data.pipelineMetrics

  const totalDuration = metrics.reduce((sum, m) => sum + m.avgDurationMs, 0)
  const totalExecutions = metrics.reduce((sum, m) => sum + m.totalExecutions, 0)
  const totalSavings = metrics.reduce((sum, m) => sum + m.totalSavings, 0)

  return (
    <Card className="border-border/40 bg-card/50">
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
            {metrics.map((m) => (
              <StageRow key={m.stage} metric={m} />
            ))}
          </div>

          {/* Totals footer */}
          <div className="flex items-center justify-between rounded-md border border-border/30 bg-secondary/20 px-3 py-2">
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
                <span className="font-mono text-xs font-medium tabular-nums text-primary">
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
