"use client"

import * as React from "react"
import { useMemo } from "react"
import { useDashboardData } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { PieChart, Pie, Cell } from "recharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { getModelColor } from "@/lib/dashboard-utils"

const CENTER_LABEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(135deg, hsl(152, 60%, 52%), hsl(190, 70%, 60%))",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  filter: "drop-shadow(0 0 8px rgba(52, 211, 153, 0.3))",
}

const ModelTableRow = React.memo(function ModelTableRow({
  entry,
  isHovered,
  onHover,
}: {
  entry: { id: string; color: string; calls: number; cost: number; tokens: number }
  isHovered: boolean
  onHover: (id: string | null) => void
}) {
  const handleMouseEnter = React.useCallback(() => onHover(entry.id), [onHover, entry.id])
  const handleMouseLeave = React.useCallback(() => onHover(null), [onHover])

  const rowStyle = React.useMemo(
    () => ({
      backgroundColor: isHovered ? `color-mix(in srgb, ${entry.color} 8%, transparent)` : undefined,
      boxShadow: isHovered ? `inset 2px 0 0 ${entry.color}, 0 0 12px ${entry.color}15` : undefined,
    }),
    [isHovered, entry.color],
  )

  const dotStyle = React.useMemo(
    () => ({
      backgroundColor: entry.color,
      boxShadow: isHovered ? `0 0 8px 2px ${entry.color}60` : "none",
    }),
    [isHovered, entry.color],
  )

  return (
    <TableRow
      className="border-border/20 cursor-default transition-all duration-200"
      style={rowStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <TableCell className="py-2">
        <div className="flex items-center gap-2">
          <div
            className="h-2.5 w-2.5 rounded-full transition-shadow duration-200"
            style={dotStyle}
          />
          <span className="font-mono text-xs text-foreground">{entry.id}</span>
        </div>
      </TableCell>
      <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {entry.calls.toLocaleString()}
      </TableCell>
      <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-foreground">
        ${entry.cost.toFixed(4)}
      </TableCell>
      <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {entry.tokens.toLocaleString()}
      </TableCell>
    </TableRow>
  )
})

export function ModelUsageChart() {
  const data = useDashboardData()
  const filterId = React.useId()
  const donutGlowId = `${filterId}-donut-glow`
  const [sortKey, setSortKey] = React.useState<"cost" | "calls" | "tokens">("cost")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")
  const [hoveredRow, setHoveredRow] = React.useState<string | null>(null)

  const entries = useMemo(
    () =>
      Object.entries(data.byModel).map(([id, d], idx) => ({
        id,
        ...d,
        color: getModelColor(id, idx),
      })),
    [data.byModel],
  )

  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const diff = a[sortKey] - b[sortKey]
        return sortDir === "desc" ? -diff : diff
      }),
    [entries, sortKey, sortDir],
  )

  const pieData = useMemo(
    () =>
      entries.map((e) => ({
        name: e.id,
        value: e.cost,
        fill: e.color,
      })),
    [entries],
  )

  const { totalCost, modelCount, topModel } = useMemo(() => {
    const totalCost = entries.reduce((a, e) => a + e.cost, 0)
    const modelCount = entries.length
    // Find the top model by cost
    const topModel =
      entries.length > 0
        ? entries.reduce((top, e) => (e.cost > top.cost ? e : top), entries[0])
        : null
    return { totalCost, modelCount, topModel }
  }, [entries])

  const handleSort = React.useCallback(
    (key: "cost" | "calls" | "tokens") => {
      if (sortKey === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"))
      } else {
        setSortKey(key)
        setSortDir("desc")
      }
    },
    [sortKey],
  )

  const handleHover = React.useCallback((id: string | null) => setHoveredRow(id), [])

  const chartConfig = useMemo(
    () => Object.fromEntries(entries.map((e) => [e.id, { label: e.id, color: e.color }])),
    [entries],
  )

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Model Usage</CardTitle>
        <CardDescription className="text-xs">
          Cost distribution and request volume by model
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          {/* Donut */}
          <div className="flex-shrink-0">
            <ChartContainer
              config={chartConfig}
              className="mx-auto aspect-square h-[180px] w-[180px]"
              aria-label="Model cost distribution chart"
            >
              <PieChart>
                <defs>
                  {/* Glow filter for donut segments */}
                  <filter id={donutGlowId} x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  strokeWidth={2}
                  stroke="hsl(var(--card))"
                  isAnimationActive={false}
                  filter={`url(#${donutGlowId})`}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">{String(name)}</span>
                          <span className="font-mono font-medium text-foreground">
                            ${Number(value).toFixed(4)}
                          </span>
                        </span>
                      )}
                    />
                  }
                />
              </PieChart>
            </ChartContainer>
            {/* Enhanced Center label with gradient text and model count */}
            <div className="-mt-[124px] flex flex-col items-center justify-center pb-[40px]">
              <span
                className="font-mono text-xl font-bold tracking-tight"
                style={CENTER_LABEL_STYLE}
              >
                ${totalCost.toFixed(2)}
              </span>
              <span className="text-[10px] font-medium text-muted-foreground">Total Cost</span>
              <span className="mt-0.5 text-[9px] text-muted-foreground/60">
                across {modelCount} model{modelCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Table section */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            {/* Top Model Callout Badge */}
            {topModel && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-border/30 bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-3 py-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: topModel.color,
                    boxShadow: `0 0 6px ${topModel.color}80`,
                  }}
                />
                <span className="text-[10px] text-muted-foreground">Top model:</span>
                <span className="font-mono text-[11px] font-semibold text-foreground">
                  {topModel.id}
                </span>
                <span className="font-mono text-[10px] text-amber-400/80">
                  ${topModel.cost.toFixed(4)}
                </span>
                <span className="text-[9px] text-muted-foreground/60">
                  ({totalCost > 0 ? ((topModel.cost / totalCost) * 100).toFixed(0) : 0}% of total)
                </span>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow className="border-border/30 hover:bg-transparent">
                  <TableHead className="text-xs">Model</TableHead>
                  <TableHead
                    className={cn(
                      "cursor-pointer text-right text-xs",
                      sortKey === "calls" && "text-foreground",
                    )}
                    onClick={() => handleSort("calls")}
                    tabIndex={0}
                    role="columnheader"
                    aria-sort={
                      sortKey === "calls"
                        ? sortDir === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleSort("calls")
                      }
                    }}
                  >
                    Calls {sortKey === "calls" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                  <TableHead
                    className={cn(
                      "cursor-pointer text-right text-xs",
                      sortKey === "cost" && "text-foreground",
                    )}
                    onClick={() => handleSort("cost")}
                    tabIndex={0}
                    role="columnheader"
                    aria-sort={
                      sortKey === "cost"
                        ? sortDir === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleSort("cost")
                      }
                    }}
                  >
                    Cost {sortKey === "cost" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                  <TableHead
                    className={cn(
                      "cursor-pointer text-right text-xs",
                      sortKey === "tokens" && "text-foreground",
                    )}
                    onClick={() => handleSort("tokens")}
                    tabIndex={0}
                    role="columnheader"
                    aria-sort={
                      sortKey === "tokens"
                        ? sortDir === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        handleSort("tokens")
                      }
                    }}
                  >
                    Tokens {sortKey === "tokens" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((entry) => (
                  <ModelTableRow
                    key={entry.id}
                    entry={entry}
                    isHovered={hoveredRow === entry.id}
                    onHover={handleHover}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
