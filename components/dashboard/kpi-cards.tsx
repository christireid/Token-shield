"use client"

import { useMemo } from "react"
import { useDashboard } from "./dashboard-provider"
import { KpiCard, type KpiCardProps } from "./kpi-card"
import { formatCurrency, COLORS } from "@/lib/dashboard-utils"
import { DollarSign, Percent, Zap, ShieldOff, Timer, TrendingUp } from "lucide-react"

/* Hoisted icon elements — never change so they avoid re-creation */
const ICON_TRENDING_UP = <TrendingUp className="h-4 w-4" />
const ICON_DOLLAR_SIGN = <DollarSign className="h-4 w-4" />
const ICON_PERCENT = <Percent className="h-4 w-4" />
const ICON_ZAP = <Zap className="h-4 w-4" />
const ICON_SHIELD_OFF = <ShieldOff className="h-4 w-4" />
const ICON_TIMER = <Timer className="h-4 w-4" />

export function KpiCards() {
  const { data } = useDashboard()

  const cards: KpiCardProps[] = useMemo(
    () => [
      {
        label: "Total Saved",
        value: formatCurrency(data.totalSaved),
        sparkline: data.sparklines.saved,
        color: COLORS.primary,
        accentClass: "bg-primary",
        iconColorClass: "text-primary",
        gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-primary/[0.03]",
        icon: ICON_TRENDING_UP,
        delta: data.kpiDeltas.totalSaved,
        upIsGood: true,
        isHero: true,
      },
      {
        label: "Total Spent",
        value: formatCurrency(data.totalSpent),
        sparkline: data.sparklines.spent,
        color: "hsl(215, 15%, 55%)",
        accentClass: "bg-muted-foreground",
        iconColorClass: "text-muted-foreground",
        gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-muted-foreground/[0.04]",
        icon: ICON_DOLLAR_SIGN,
        delta: data.kpiDeltas.totalSpent,
        upIsGood: false,
      },
      {
        label: "Savings Rate",
        value: `${data.savingsRate.toFixed(1)}%`,
        sparkline: data.sparklines.savingsRate,
        color:
          data.savingsRate >= 30
            ? COLORS.primary
            : data.savingsRate >= 15
              ? COLORS.amber
              : COLORS.red,
        accentClass:
          data.savingsRate >= 30
            ? "bg-primary"
            : data.savingsRate >= 15
              ? "bg-chart-3"
              : "bg-destructive",
        iconColorClass:
          data.savingsRate >= 30
            ? "text-primary"
            : data.savingsRate >= 15
              ? "text-chart-3"
              : "text-destructive",
        gradientClass:
          data.savingsRate >= 30
            ? "bg-gradient-to-br from-card/80 via-card/50 to-primary/[0.03]"
            : data.savingsRate >= 15
              ? "bg-gradient-to-br from-card/80 via-card/50 to-amber-500/[0.04]"
              : "bg-gradient-to-br from-card/80 via-card/50 to-destructive/[0.04]",
        icon: ICON_PERCENT,
        delta: data.kpiDeltas.savingsRate,
        upIsGood: true,
      },
      {
        label: "Cache Hit Rate",
        value: `${data.cacheHitRate.toFixed(1)}%`,
        sparkline: data.sparklines.cacheHitRate,
        color: COLORS.cyan,
        accentClass: "bg-chart-2",
        iconColorClass: "text-chart-2",
        gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-cyan-500/[0.04]",
        icon: ICON_ZAP,
        delta: data.kpiDeltas.cacheHitRate,
        upIsGood: true,
      },
      {
        label: "Requests Blocked",
        value: data.requestsBlocked.toLocaleString(),
        sparkline: data.sparklines.blocked,
        color: COLORS.amber,
        accentClass: "bg-chart-3",
        iconColorClass: "text-chart-3",
        gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-amber-500/[0.04]",
        icon: ICON_SHIELD_OFF,
        delta: data.kpiDeltas.requestsBlocked,
        upIsGood: true,
      },
      {
        label: "Avg Latency",
        value: `${data.avgLatencyMs.toFixed(0)}ms`,
        sparkline: data.sparklines.latency,
        color: "hsl(215, 15%, 55%)",
        accentClass: "bg-muted-foreground",
        iconColorClass: "text-muted-foreground",
        gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-slate-500/[0.04]",
        icon: ICON_TIMER,
        delta: data.kpiDeltas.avgLatency,
        upIsGood: false,
      },
    ],
    [
      data.totalSaved,
      data.totalSpent,
      data.savingsRate,
      data.cacheHitRate,
      data.requestsBlocked,
      data.avgLatencyMs,
      data.sparklines,
      data.kpiDeltas,
    ],
  )

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <KpiCard key={card.label} {...card} />
      ))}
    </div>
  )
}
