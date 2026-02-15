"use client"

import * as React from "react"
import { useCountUp } from "@/hooks/use-count-up"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { TrendingUp, TrendingDown } from "lucide-react"
import { AreaChart, Area, ResponsiveContainer } from "recharts"
import type { KpiDelta } from "./dashboard-provider"

/* ────────────────────────── AnimatedValue ─────────────────────────────── */

function AnimatedValue({ value, className }: { value: string; className?: string }) {
  const match = value.match(/^([^0-9]*?)([\d,]+\.?\d*)(.*?)$/)

  if (!match) {
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
  const reduced = useReducedMotion()
  const animated = useCountUp(target, 800, reduced)

  const decimalIndex = originalFormatted.indexOf(".")
  const decimals = decimalIndex >= 0 ? originalFormatted.length - decimalIndex - 1 : 0
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

const MiniSparkline = React.memo(function MiniSparkline({
  data,
  color,
}: {
  data: number[]
  color: string
}) {
  const uniqueId = React.useId()
  if (data.length < 2) return null
  const chartData = data.map((v, i) => ({ i, v }))
  const gradientId = `${uniqueId}-spark`
  return (
    <div className="h-10 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.6} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
})

/* ──────────────────────────── KpiCard ─────────────────────────────────── */

export interface KpiCardProps {
  label: string
  value: string
  sparkline: number[]
  color: string
  accentClass: string
  iconColorClass: string
  gradientClass: string
  icon: React.ReactNode
  delta: KpiDelta
  upIsGood: boolean
  isHero?: boolean
}

export const KpiCard = React.memo(function KpiCard({
  label,
  value,
  sparkline,
  color,
  accentClass,
  iconColorClass,
  gradientClass,
  icon,
  delta,
  upIsGood,
  isHero,
}: KpiCardProps) {
  const isFavorable =
    delta.direction === "flat" ? null : delta.direction === "up" ? upIsGood : !upIsGood

  const trendColor =
    isFavorable === null
      ? "text-muted-foreground"
      : isFavorable
        ? "text-emerald-500"
        : "text-red-500"

  const cardGlowStyle = React.useMemo(
    () => ({ "--card-glow": color + "20" }) as React.CSSProperties,
    [color],
  )

  return (
    <Card
      className={cn(
        "group relative overflow-hidden border-border/40 p-4 transition-all duration-300 hover:translate-y-[-2px] hover:border-border/80 hover:shadow-[0_0_30px_var(--card-glow)]",
        gradientClass,
        isHero && "border-primary/20",
      )}
      style={cardGlowStyle}
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
                  isFavorable === null ? "" : isFavorable ? "bg-emerald-500/10" : "bg-red-500/10",
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
              iconColorClass,
            )}
          >
            {icon}
          </div>
          <MiniSparkline data={sparkline} color={color} />
        </div>
      </div>
    </Card>
  )
})
