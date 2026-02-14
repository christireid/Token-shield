"use client"

import * as React from "react"
import { useDashboard } from "./dashboard-provider"
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

const MODEL_COLORS: Record<string, string> = {
  "gpt-4o": "hsl(152, 60%, 52%)",
  "claude-sonnet-4": "hsl(190, 70%, 50%)",
  "gemini-2.5-flash": "hsl(38, 92%, 50%)",
  "gpt-4o-mini": "hsl(270, 60%, 60%)",
  "claude-haiku-3.5": "hsl(0, 72%, 60%)",
}

const fallbackColors = [
  "hsl(160, 50%, 45%)",
  "hsl(200, 60%, 50%)",
  "hsl(30, 80%, 55%)",
  "hsl(280, 50%, 55%)",
  "hsl(350, 60%, 55%)",
]

function getModelColor(id: string, idx: number): string {
  return MODEL_COLORS[id] || fallbackColors[idx % fallbackColors.length]
}

export function ModelUsageChart() {
  const { data } = useDashboard()
  const [sortKey, setSortKey] = React.useState<"cost" | "calls" | "tokens">("cost")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")

  const entries = Object.entries(data.byModel).map(([id, d], idx) => ({
    id,
    ...d,
    color: getModelColor(id, idx),
  }))

  const sorted = [...entries].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
    return sortDir === "desc" ? -diff : diff
  })

  const pieData = entries.map((e) => ({
    name: e.id,
    value: e.cost,
    fill: e.color,
  }))

  const totalCost = entries.reduce((a, e) => a + e.cost, 0)

  const handleSort = (key: "cost" | "calls" | "tokens") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const chartConfig = Object.fromEntries(
    entries.map((e) => [e.id, { label: e.id, color: e.color }]),
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
            >
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  strokeWidth={2}
                  stroke="hsl(220, 18%, 7%)"
                  isAnimationActive={false}
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
            {/* Center label */}
            <div className="-mt-[118px] flex flex-col items-center justify-center pb-[40px]">
              <span className="font-mono text-lg font-bold text-foreground">
                ${totalCost.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground">Total Cost</span>
            </div>
          </div>

          {/* Table */}
          <div className="min-w-0 flex-1 overflow-x-auto">
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
                  >
                    Calls {sortKey === "calls" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                  <TableHead
                    className={cn(
                      "cursor-pointer text-right text-xs",
                      sortKey === "cost" && "text-foreground",
                    )}
                    onClick={() => handleSort("cost")}
                  >
                    Cost {sortKey === "cost" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                  <TableHead
                    className={cn(
                      "cursor-pointer text-right text-xs",
                      sortKey === "tokens" && "text-foreground",
                    )}
                    onClick={() => handleSort("tokens")}
                  >
                    Tokens {sortKey === "tokens" && (sortDir === "desc" ? "↓" : "↑")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((entry) => (
                  <TableRow key={entry.id} className="border-border/20">
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: entry.color }}
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
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
