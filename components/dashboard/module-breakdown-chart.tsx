"use client"

import { useDashboard } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts"

const MODULE_COLORS: Record<string, string> = {
  guard: "hsl(0, 72%, 60%)",
  cache: "hsl(190, 70%, 50%)",
  context: "hsl(38, 92%, 50%)",
  router: "hsl(270, 60%, 60%)",
  prefix: "hsl(152, 60%, 52%)",
}

const MODULE_LABELS: Record<string, string> = {
  guard: "Request Guard",
  cache: "Response Cache",
  context: "Context Manager",
  router: "Model Router",
  prefix: "Prefix Optimizer",
}

const chartConfig = Object.fromEntries(
  Object.entries(MODULE_LABELS).map(([key, label]) => [key, { label, color: MODULE_COLORS[key] }]),
)

export function ModuleBreakdownChart() {
  const { data } = useDashboard()

  const total = Object.values(data.byModule).reduce((a, b) => a + b, 0)

  const chartData = Object.entries(data.byModule)
    .map(([key, value]) => ({
      module: MODULE_LABELS[key] || key,
      key,
      savings: Number(value.toFixed(4)),
      percent: total > 0 ? ((value / total) * 100).toFixed(1) : "0.0",
    }))
    .sort((a, b) => b.savings - a.savings)

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Savings by Module</CardTitle>
        <CardDescription className="text-xs">
          Which TokenShield modules are saving you the most
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Total Savings Callout */}
        <div className="mb-4 flex items-center justify-between rounded-lg border border-border/30 bg-gradient-to-r from-emerald-500/10 via-transparent to-cyan-500/10 px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Total Module Savings</span>
          <span className="font-mono text-lg font-bold tracking-tight text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]">
            ${total.toFixed(4)}
          </span>
        </div>

        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full md:h-[320px]">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              {/* Gradient fills for each module */}
              {Object.entries(MODULE_COLORS).map(([key, color]) => (
                <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={color} stopOpacity={1} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                </linearGradient>
              ))}
              {/* Soft glow filter for bars */}
              <filter id="bar-glow" x="-20%" y="-50%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 12%)" horizontal={false} />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `$${v.toFixed(3)}`}
            />
            <YAxis
              type="category"
              dataKey="module"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              width={110}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, _name, props) => {
                    const item = props.payload
                    return (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{item.module}</span>
                        <span className="font-mono font-medium text-foreground">
                          ${Number(value).toFixed(4)} ({item.percent}%)
                        </span>
                      </span>
                    )
                  }}
                />
              }
            />
            <Bar
              dataKey="savings"
              radius={[0, 4, 4, 0]}
              maxBarSize={28}
              filter="url(#bar-glow)"
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={`url(#gradient-${entry.key})`}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        {/* Enhanced Legend Pills with inline percentage bars */}
        <div className="mt-4 flex flex-wrap gap-2">
          {chartData.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center gap-2 rounded-md border border-border/30 bg-secondary/30 px-2.5 py-1.5 transition-colors hover:bg-secondary/50"
            >
              <div
                className="h-2.5 w-2.5 rounded-full shadow-[0_0_6px_1px]"
                style={{
                  backgroundColor: MODULE_COLORS[entry.key],
                  boxShadow: `0 0 6px 1px ${MODULE_COLORS[entry.key]}40`,
                }}
              />
              <span className="text-[10px] text-muted-foreground">{entry.module}</span>
              <span className="font-mono text-[10px] font-medium text-foreground">
                ${entry.savings.toFixed(3)}
              </span>
              {/* Mini percentage bar */}
              <div className="relative h-1.5 w-10 overflow-hidden rounded-full bg-border/40">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(parseFloat(entry.percent), 100)}%`,
                    background: `linear-gradient(90deg, ${MODULE_COLORS[entry.key]}, ${MODULE_COLORS[entry.key]}99)`,
                    boxShadow: `0 0 4px ${MODULE_COLORS[entry.key]}60`,
                  }}
                />
              </div>
              <span className="font-mono text-[9px] text-muted-foreground/70">
                {entry.percent}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
