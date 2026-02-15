"use client"

import { useDashboard, type KpiDelta } from "./dashboard-provider"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { DollarSign, Percent, Zap, ShieldOff, Timer, TrendingUp, TrendingDown } from "lucide-react"
import { AreaChart, Area, ResponsiveContainer } from "recharts"

interface KpiCardProps {
  label: string
  value: string
  sparkline: number[]
  color: string
  accentClass: string
  icon: React.ReactNode
  delta: KpiDelta
  /** When true, an "up" direction is favorable (green). When false, "up" is unfavorable (red). */
  upIsGood: boolean
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const chartData = data.map((v, i) => ({ i, v }))
  return (
    <div className="h-8 w-16">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${color.replace("#", "")})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function KpiCard({ label, value, sparkline, color, accentClass, icon, delta, upIsGood }: KpiCardProps) {
  const isFavorable =
    delta.direction === "flat"
      ? null
      : delta.direction === "up"
        ? upIsGood
        : !upIsGood

  const trendColor =
    isFavorable === null
      ? "text-muted-foreground"
      : isFavorable
        ? "text-emerald-500"
        : "text-red-500"

  return (
    <Card className="group relative overflow-hidden border-border/40 bg-card/50 p-4 transition-colors hover:border-border/80">
      <div className={cn("absolute left-0 top-0 h-full w-0.5", accentClass)} />
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="font-mono text-2xl font-bold tabular-nums tracking-tight text-foreground">
            {value}
          </span>
          {delta.direction !== "flat" && (
            <div className="flex items-center gap-1">
              <div className={cn("flex items-center gap-0.5 text-xs font-medium", trendColor)}>
                {delta.direction === "up" ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                <span className="tabular-nums">{delta.percentChange.toFixed(1)}%</span>
              </div>
              <span className="text-[10px] text-muted-foreground/70">vs prior period</span>
            </div>
          )}
          {delta.direction === "flat" && (
            <span className="text-[10px] text-muted-foreground/70">no change vs prior period</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border border-border/30",
              accentClass.replace("bg-", "text-"),
            )}
          >
            {icon}
          </div>
          <MiniSparkline data={sparkline} color={color} />
        </div>
      </div>
    </Card>
  )
}

export function KpiCards() {
  const { data } = useDashboard()

  const fmt = (n: number, prefix = "$") => {
    if (n >= 1000) return `${prefix}${(n / 1000).toFixed(1)}k`
    if (n >= 1) return `${prefix}${n.toFixed(2)}`
    return `${prefix}${n.toFixed(4)}`
  }

  const cards: KpiCardProps[] = [
    {
      label: "Total Saved",
      value: fmt(data.totalSaved),
      sparkline: data.sparklines.saved,
      color: "hsl(152, 60%, 52%)",
      accentClass: "bg-primary",
      icon: <TrendingUp className="h-4 w-4" />,
      delta: data.kpiDeltas.totalSaved,
      upIsGood: true,
    },
    {
      label: "Total Spent",
      value: fmt(data.totalSpent),
      sparkline: data.sparklines.spent,
      color: "hsl(215, 15%, 55%)",
      accentClass: "bg-muted-foreground",
      icon: <DollarSign className="h-4 w-4" />,
      delta: data.kpiDeltas.totalSpent,
      upIsGood: false,
    },
    {
      label: "Savings Rate",
      value: `${data.savingsRate.toFixed(1)}%`,
      sparkline: data.sparklines.savingsRate,
      color:
        data.savingsRate >= 30
          ? "hsl(152, 60%, 52%)"
          : data.savingsRate >= 15
            ? "hsl(38, 92%, 50%)"
            : "hsl(0, 72%, 51%)",
      accentClass:
        data.savingsRate >= 30
          ? "bg-primary"
          : data.savingsRate >= 15
            ? "bg-chart-3"
            : "bg-destructive",
      icon: <Percent className="h-4 w-4" />,
      delta: data.kpiDeltas.savingsRate,
      upIsGood: true,
    },
    {
      label: "Cache Hit Rate",
      value: `${data.cacheHitRate.toFixed(1)}%`,
      sparkline: data.sparklines.cacheHitRate,
      color: "hsl(190, 70%, 50%)",
      accentClass: "bg-chart-2",
      icon: <Zap className="h-4 w-4" />,
      delta: data.kpiDeltas.cacheHitRate,
      upIsGood: true,
    },
    {
      label: "Requests Blocked",
      value: data.requestsBlocked.toLocaleString(),
      sparkline: data.sparklines.blocked,
      color: "hsl(38, 92%, 50%)",
      accentClass: "bg-chart-3",
      icon: <ShieldOff className="h-4 w-4" />,
      delta: data.kpiDeltas.requestsBlocked,
      upIsGood: true,
    },
    {
      label: "Avg Latency",
      value: `${data.avgLatencyMs.toFixed(0)}ms`,
      sparkline: data.sparklines.latency,
      color: "hsl(215, 15%, 55%)",
      accentClass: "bg-muted-foreground",
      icon: <Timer className="h-4 w-4" />,
      delta: data.kpiDeltas.avgLatency,
      upIsGood: false,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <KpiCard key={card.label} {...card} />
      ))}
    </div>
  )
}
