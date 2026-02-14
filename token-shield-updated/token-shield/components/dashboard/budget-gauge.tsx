"use client"

import { useDashboard } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"

function getGaugeColor(percent: number): string {
  if (percent >= 80) return "hsl(0, 72%, 51%)"
  if (percent >= 60) return "hsl(38, 92%, 50%)"
  return "hsl(152, 60%, 52%)"
}

function getGaugeTextClass(percent: number): string {
  if (percent >= 80) return "text-[hsl(0,72%,65%)]"
  if (percent >= 60) return "text-[hsl(38,92%,65%)]"
  return "text-primary"
}

interface MiniBarProps {
  label: string
  value: number | null
  max: number | null
}

function MiniBar({ label, value, max }: MiniBarProps) {
  if (value === null || max === null) return null
  const percent = max > 0 ? Math.min(100, (1 - value / max) * 100) : 0
  const remaining = value
  const barColor = getGaugeColor(percent)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          ${remaining.toFixed(2)} left
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
    </div>
  )
}

export function BudgetGauge() {
  const { data } = useDashboard()
  const { budget } = data

  const percent = Math.min(100, budget.percentUsed)
  const gaugeColor = getGaugeColor(percent)

  // SVG arc gauge
  const radius = 70
  const strokeWidth = 10
  const cx = 90
  const cy = 90
  const startAngle = 135
  const endAngle = 405
  const totalAngle = endAngle - startAngle
  const fillAngle = startAngle + (totalAngle * percent) / 100

  const polarToCartesian = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
  }

  const describeArc = (start: number, end: number) => {
    const s = polarToCartesian(start)
    const e = polarToCartesian(end)
    const largeArc = end - start > 180 ? 1 : 0
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArc} 1 ${e.x} ${e.y}`
  }

  return (
    <Card
      className={cn(
        "border-border/40 bg-card/50 transition-all",
        budget.isOverBudget && "border-[hsl(0,72%,51%)]/40 shadow-[0_0_20px_hsl(0,72%,51%,0.1)]"
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">Budget Utilization</CardTitle>
            <CardDescription className="text-xs">
              Overall spending against configured limits
            </CardDescription>
          </div>
          {budget.isOverBudget && (
            <div className="flex h-6 items-center rounded-md border border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 px-2">
              <span className="text-[10px] font-medium text-[hsl(0,72%,65%)]">OVER BUDGET</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-4">
          {/* Arc gauge */}
          <div className="relative">
            <svg width="180" height="130" viewBox="0 0 180 130" role="img" aria-label={`Budget gauge at ${percent.toFixed(0)}%`}>
              {/* Background arc */}
              <path
                d={describeArc(startAngle, endAngle)}
                fill="none"
                stroke="hsl(220, 14%, 12%)"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
              {/* Filled arc */}
              {percent > 0 && (
                <path
                  d={describeArc(startAngle, fillAngle)}
                  fill="none"
                  stroke={gaugeColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              )}
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
              <span className={cn("font-mono text-2xl font-bold tabular-nums", getGaugeTextClass(percent))}>
                {percent.toFixed(0)}%
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                ${budget.currentSpend.toFixed(2)} / ${budget.limit.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Mini progress bars */}
          <div className="flex w-full flex-col gap-3">
            <MiniBar label="Session" value={budget.remaining.session} max={50} />
            <MiniBar label="Hourly" value={budget.remaining.hour} max={10} />
            <MiniBar label="Daily" value={budget.remaining.day} max={50} />
            <MiniBar label="Monthly" value={budget.remaining.month} max={500} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
