"use client"

import { memo, useId, useMemo } from "react"
import { useDashboard } from "./dashboard-provider"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { COLORS } from "@/lib/dashboard-utils"

function getGaugeColor(percent: number): string {
  if (percent >= 80) return COLORS.red
  if (percent >= 60) return COLORS.amber
  return COLORS.primary
}

function getGaugeTextClass(percent: number): string {
  if (percent >= 80) return "text-[hsl(0,72%,65%)]"
  if (percent >= 60) return "text-[hsl(38,92%,65%)]"
  return "text-primary"
}

/* Hoisted geometry helpers — depend only on constants */
const GAUGE_RADIUS = 70
const GAUGE_CX = 90
const GAUGE_CY = 90
const START_ANGLE = 135
const END_ANGLE = 405
const TOTAL_ANGLE = END_ANGLE - START_ANGLE

function polarToCartesian(angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180
  return { x: GAUGE_CX + GAUGE_RADIUS * Math.cos(rad), y: GAUGE_CY + GAUGE_RADIUS * Math.sin(rad) }
}

function describeArc(start: number, end: number) {
  const s = polarToCartesian(start)
  const e = polarToCartesian(end)
  const largeArc = end - start > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 ${largeArc} 1 ${e.x} ${e.y}`
}

interface MiniBarProps {
  label: string
  value: number | null
  max: number | null
}

const MiniBar = memo(function MiniBar({ label, value, max }: MiniBarProps) {
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
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-secondary to-secondary/60"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} budget usage`}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${percent}%`,
            backgroundColor: barColor,
            boxShadow: `0 0 8px ${barColor}, 0 0 4px ${barColor}`,
          }}
        />
      </div>
    </div>
  )
})

export function BudgetGauge() {
  const { data } = useDashboard()
  const { budget } = data
  const reducedMotion = useReducedMotion()
  const filterId = useId()
  const gaugeGlowId = `${filterId}-gauge-glow`

  const percent = Math.min(100, budget.percentUsed)
  const gaugeColor = getGaugeColor(percent)

  // SVG arc gauge
  const strokeWidth = 10
  const fillAngle = START_ANGLE + (TOTAL_ANGLE * percent) / 100

  // Tick marks at 0%, 25%, 50%, 75%, 100% — all inputs are constants
  const { ticks, labelStartPos, labelEndPos } = useMemo(() => {
    const tickPercents = [0, 25, 50, 75, 100]
    const tickLength = 8
    const ticks = tickPercents.map((tp) => {
      const angle = START_ANGLE + (TOTAL_ANGLE * tp) / 100
      const inner = polarToCartesian(angle)
      const outerRadius = GAUGE_RADIUS + tickLength
      const rad = ((angle - 90) * Math.PI) / 180
      const outer = {
        x: GAUGE_CX + outerRadius * Math.cos(rad),
        y: GAUGE_CY + outerRadius * Math.sin(rad),
      }
      return { percent: tp, inner, outer, angle }
    })

    // Label positions (slightly further out than tick marks)
    const labelRadius = GAUGE_RADIUS + tickLength + 10
    const labelStartRad = ((START_ANGLE - 90) * Math.PI) / 180
    const labelEndRad = ((END_ANGLE - 90) * Math.PI) / 180
    const labelStartPos = {
      x: GAUGE_CX + labelRadius * Math.cos(labelStartRad),
      y: GAUGE_CY + labelRadius * Math.sin(labelStartRad),
    }
    const labelEndPos = {
      x: GAUGE_CX + labelRadius * Math.cos(labelEndRad),
      y: GAUGE_CY + labelRadius * Math.sin(labelEndRad),
    }

    return { ticks, labelStartPos, labelEndPos }
  }, [])

  return (
    <>
      <style>{`
        @keyframes budget-pulse {
          0%, 100% { box-shadow: 0 0 20px hsl(0 72% 51% / 0.1); }
          50% { box-shadow: 0 0 30px hsl(0 72% 51% / 0.2); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[budget-pulse_2s_ease-in-out_infinite\\] { animation: none; }
        }
      `}</style>
      <Card
        className={cn(
          "border-border/40 bg-card/50 transition-all",
          budget.isOverBudget && "border-[hsl(0,72%,51%)]/40 shadow-[0_0_20px_hsl(0,72%,51%,0.1)]",
          budget.isOverBudget && !reducedMotion && "animate-[budget-pulse_2s_ease-in-out_infinite]",
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium text-foreground">
                Budget Utilization
              </CardTitle>
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
              <div
                className="absolute inset-0 rounded-full opacity-30"
                style={{
                  background: `radial-gradient(circle at 50% 60%, ${gaugeColor}22 0%, transparent 60%)`,
                }}
              />
              <svg
                width="180"
                height="130"
                viewBox="0 0 180 130"
                role="img"
                aria-label={`Budget gauge at ${percent.toFixed(0)}%`}
              >
                {/* SVG glow filter */}
                <defs>
                  <filter id={gaugeGlowId} x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Tick marks */}
                {ticks.map((tick) => (
                  <line
                    key={tick.percent}
                    x1={tick.inner.x}
                    y1={tick.inner.y}
                    x2={tick.outer.x}
                    y2={tick.outer.y}
                    stroke="hsl(220, 14%, 18%)"
                    strokeWidth="1"
                  />
                ))}

                {/* Labels at 0% and 100% */}
                <text
                  x={labelStartPos.x}
                  y={labelStartPos.y}
                  fontSize="8"
                  fill="hsl(215, 20%, 50%)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  0%
                </text>
                <text
                  x={labelEndPos.x}
                  y={labelEndPos.y}
                  fontSize="8"
                  fill="hsl(215, 20%, 50%)"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  100%
                </text>

                {/* Background arc */}
                <path
                  d={describeArc(START_ANGLE, END_ANGLE)}
                  fill="none"
                  stroke="hsl(220, 14%, 12%)"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
                {/* Filled arc with glow */}
                {percent > 0 && (
                  <path
                    d={describeArc(START_ANGLE, fillAngle)}
                    fill="none"
                    stroke={gaugeColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    filter={`url(#${gaugeGlowId})`}
                    className="transition-all duration-700"
                  />
                )}
              </svg>
              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-2">
                <span
                  className={cn(
                    "font-mono text-2xl font-bold tabular-nums",
                    getGaugeTextClass(percent),
                  )}
                >
                  {percent.toFixed(0)}%
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  ${budget.currentSpend.toFixed(2)} / ${budget.limit.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Mini progress bars */}
            <div className="flex w-full flex-col gap-3">
              <MiniBar
                label="Session"
                value={budget.remaining.session}
                max={budget.limits.session}
              />
              <MiniBar label="Hourly" value={budget.remaining.hour} max={budget.limits.hour} />
              <MiniBar label="Daily" value={budget.remaining.day} max={budget.limits.day} />
              <MiniBar label="Monthly" value={budget.remaining.month} max={budget.limits.month} />
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
