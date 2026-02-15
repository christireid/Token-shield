"use client"

import React, { useMemo } from "react"
import { useDashboard } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts"
import { CHART_MARGINS, GRID_STROKE, GRID_DASH } from "@/lib/chart-theme"
import { formatCurrency, COLORS } from "@/lib/dashboard-utils"

const chartConfig = {
  cumulativeSaved: {
    label: "Saved",
    color: "hsl(152, 60%, 52%)",
  },
  cumulativeSpent: {
    label: "Spent",
    color: "hsl(215, 15%, 45%)",
  },
}

const LEGEND_SAVED_STYLE: React.CSSProperties = {
  backgroundColor: "hsl(152, 60%, 52%)",
  boxShadow: "0 0 6px hsl(152, 60%, 52%)",
}
const LEGEND_SPENT_STYLE: React.CSSProperties = {
  backgroundColor: "hsl(215, 15%, 45%)",
}
const LEGEND_NOSHIELD_STYLE: React.CSSProperties = {
  borderColor: "hsl(215, 15%, 35%)",
}

export function SavingsTimelineChart() {
  const { data } = useDashboard()

  const chartData = useMemo(
    () =>
      data.timeSeries.map((p) => ({
        time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        cumulativeSaved: Number(p.cumulativeSaved.toFixed(4)),
        cumulativeSpent: Number(p.cumulativeSpent.toFixed(4)),
        wouldHaveSpent: Number((p.cumulativeSpent + p.cumulativeSaved).toFixed(4)),
      })),
    [data.timeSeries],
  )

  const savingsGapPercent = useMemo(() => {
    const wouldHave = data.totalSpent + data.totalSaved
    if (wouldHave === 0) return 0
    return (data.totalSaved / wouldHave) * 100
  }, [data.totalSpent, data.totalSaved])

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Savings Over Time</CardTitle>
        <CardDescription className="text-xs">
          Cumulative spend vs. what you would have spent without TokenShield
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* ── Hero Stat Banner ── */}
        <div className="flex items-center justify-between rounded-lg border border-primary/10 bg-gradient-to-r from-primary/[0.04] via-transparent to-transparent px-4 py-3 mb-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
              Total Saved
            </span>
            <span className="font-mono text-2xl font-black tabular-nums text-primary">
              {formatCurrency(data.totalSaved)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
              Total Spent
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-muted-foreground">
              {formatCurrency(data.totalSpent)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 text-right">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
              Savings Gap
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-emerald-400">
              {savingsGapPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* ── Chart ── */}
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[280px] w-full md:h-[320px]"
          aria-label="Savings over time chart"
        >
          <AreaChart data={chartData} margin={CHART_MARGINS}>
            <defs>
              {/* Vivid green gradient for the savings area */}
              <linearGradient id="gradSaved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 60%, 52%)" stopOpacity={0.45} />
                <stop offset="50%" stopColor="hsl(152, 60%, 52%)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(152, 60%, 52%)" stopOpacity={0.02} />
              </linearGradient>
              {/* Neutral gradient for actual spend */}
              <linearGradient id="gradSpent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(215, 15%, 45%)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="hsl(215, 15%, 45%)" stopOpacity={0.02} />
              </linearGradient>
              {/* Savings gap gradient (green, between wouldHaveSpent and cumulativeSpent) */}
              <linearGradient id="gradSavingsGap" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 70%, 55%)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="hsl(152, 70%, 55%)" stopOpacity={0.03} />
              </linearGradient>
              {/* Glow filter for the savings line */}
              <filter id="glowSaved" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                <feFlood floodColor="hsl(152, 60%, 52%)" floodOpacity="0.5" result="color" />
                <feComposite in="color" in2="blur" operator="in" result="glow" />
                <feMerge>
                  <feMergeNode in="glow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_STROKE} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              width={55}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => {
                    const label =
                      name === "wouldHaveSpent"
                        ? "Without Shield"
                        : name === "cumulativeSpent"
                          ? "Actually Spent"
                          : "Saved"
                    return (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium text-foreground">
                          ${Number(value).toFixed(4)}
                        </span>
                      </span>
                    )
                  }}
                />
              }
            />
            {/* Savings gap shaded region (between wouldHaveSpent and cumulativeSpent) */}
            <Area
              type="monotone"
              dataKey="wouldHaveSpent"
              stroke="none"
              fill="url(#gradSavingsGap)"
              fillOpacity={1}
              isAnimationActive={false}
            />
            {/* "Would have spent" dashed reference line */}
            <Area
              type="monotone"
              dataKey="wouldHaveSpent"
              stroke="hsl(215, 15%, 35%)"
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
              isAnimationActive={false}
            />
            {/* Actual spend area */}
            <Area
              type="monotone"
              dataKey="cumulativeSpent"
              stroke="hsl(215, 15%, 45%)"
              strokeWidth={1.5}
              fill="url(#gradSpent)"
              isAnimationActive={false}
            />
            {/* Savings area with glow */}
            <Area
              type="monotone"
              dataKey="cumulativeSaved"
              stroke="hsl(152, 60%, 52%)"
              strokeWidth={2.5}
              fill="url(#gradSaved)"
              filter="url(#glowSaved)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>

        {/* ── Legend ── */}
        <div className="mt-3 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={LEGEND_SAVED_STYLE} />
            <span>Savings</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={LEGEND_SPENT_STYLE} />
            <span>Actual Spend</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-4 border-t-2 border-dashed"
              style={LEGEND_NOSHIELD_STYLE}
            />
            <span>Without Shield</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
