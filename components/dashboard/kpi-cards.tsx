"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useDashboard, type KpiDelta } from "./dashboard-provider"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { DollarSign, Percent, Zap, ShieldOff, Timer, TrendingUp, TrendingDown } from "lucide-react"
import { AreaChart, Area, ResponsiveContainer } from "recharts"

/* ─────────────────────────── useCountUp hook ─────────────────────────── */

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Animates a number from its previous value to the new target using
 * requestAnimationFrame with an easeOutExpo curve.
 */
function useCountUp(target: number, duration = 800): number {
  const [current, setCurrent] = useState(target)
  const prevTarget = useRef(target)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const from = prevTarget.current
    const to = target
    prevTarget.current = target

    // Nothing to animate
    if (from === to) return

    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutExpo(progress)
      const value = from + (to - from) * eased

      setCurrent(value)

      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick)
      } else {
        setCurrent(to)
      }
    }

    rafId.current = requestAnimationFrame(tick)

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [target, duration])

  return current
}

/* ────────────────────────── AnimatedValue ─────────────────────────────── */

/**
 * Takes a value string like "$12.5k", "82.4%", "1,234", or "38ms",
 * extracts the first numeric portion (including decimals), animates it,
 * then reconstructs the string with the same prefix and suffix.
 */
function AnimatedValue({ value, className }: { value: string; className?: string }) {
  // Match: optional leading non-digit chars, the number (with optional commas/decimals), trailing chars
  const match = value.match(/^([^0-9]*?)([\d,]+\.?\d*)(.*?)$/)

  if (!match) {
    // No number found — just render as-is
    return <span className={className}>{value}</span>
  }

  const prefix = match[1]
  const rawNumber = match[2].replace(/,/g, "")
  const suffix = match[3]
  const numericTarget = parseFloat(rawNumber)

  if (isNaN(numericTarget)) {
    return <span className={className}>{value}</span>
  }

  return (
    <AnimatedNumber
      prefix={prefix}
      target={numericTarget}
      originalFormatted={match[2]}
      suffix={suffix}
      className={className}
    />
  )
}

function AnimatedNumber({
  prefix,
  target,
  originalFormatted,
  suffix,
  className,
}: {
  prefix: string
  target: number
  originalFormatted: string
  suffix: string
  className?: string
}) {
  const animated = useCountUp(target)

  // Determine decimal places from the original formatted string
  const decimalIndex = originalFormatted.indexOf(".")
  const decimals = decimalIndex >= 0 ? originalFormatted.length - decimalIndex - 1 : 0

  // Check if the original used commas (e.g. "1,234")
  const usesCommas = originalFormatted.includes(",")

  let formatted: string
  if (usesCommas) {
    formatted = animated.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  } else {
    formatted = animated.toFixed(decimals)
  }

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}

/* ────────────────────────── MiniSparkline ─────────────────────────────── */

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const chartData = data.map((v, i) => ({ i, v }))
  return (
    <div className="h-10 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.6} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
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

/* ──────────────────────────── KpiCard ─────────────────────────────────── */

interface KpiCardProps {
  label: string
  value: string
  sparkline: number[]
  color: string
  accentClass: string
  /** Tailwind gradient class for the card's subtle accent background */
  gradientClass: string
  icon: React.ReactNode
  delta: KpiDelta
  /** When true, an "up" direction is favorable (green). When false, "up" is unfavorable (red). */
  upIsGood: boolean
  /** When true, renders the card with a more prominent "hero" treatment. */
  isHero?: boolean
}

function KpiCard({ label, value, sparkline, color, accentClass, gradientClass, icon, delta, upIsGood, isHero }: KpiCardProps) {
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
    <Card
      className={cn(
        "group relative overflow-hidden border-border/40 p-4 transition-all duration-300 hover:translate-y-[-2px] hover:border-border/80 hover:shadow-[0_0_30px_var(--card-glow)]",
        gradientClass,
        isHero && "border-primary/20",
      )}
      style={{ "--card-glow": color + "20" } as React.CSSProperties}
    >
      <div className={cn("absolute left-0 top-0 h-full w-0.5", accentClass)} />
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <AnimatedValue
            value={value}
            className={cn(
              "font-mono tabular-nums tracking-tight text-foreground",
              isHero ? "text-3xl font-black" : "text-2xl font-bold",
            )}
          />
          {delta.direction !== "flat" && (
            <div className="flex items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                  trendColor,
                  isFavorable === null
                    ? ""
                    : isFavorable
                      ? "bg-emerald-500/10"
                      : "bg-red-500/10",
                )}
              >
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

/* ──────────────────────────── KpiCards ────────────────────────────────── */

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
      gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-primary/[0.03]",
      icon: <TrendingUp className="h-4 w-4" />,
      delta: data.kpiDeltas.totalSaved,
      upIsGood: true,
      isHero: true,
    },
    {
      label: "Total Spent",
      value: fmt(data.totalSpent),
      sparkline: data.sparklines.spent,
      color: "hsl(215, 15%, 55%)",
      accentClass: "bg-muted-foreground",
      gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-muted-foreground/[0.04]",
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
      gradientClass:
        data.savingsRate >= 30
          ? "bg-gradient-to-br from-card/80 via-card/50 to-primary/[0.03]"
          : data.savingsRate >= 15
            ? "bg-gradient-to-br from-card/80 via-card/50 to-amber-500/[0.04]"
            : "bg-gradient-to-br from-card/80 via-card/50 to-destructive/[0.04]",
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
      gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-cyan-500/[0.04]",
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
      gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-amber-500/[0.04]",
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
      gradientClass: "bg-gradient-to-br from-card/80 via-card/50 to-slate-500/[0.04]",
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
