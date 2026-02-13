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
  Object.entries(MODULE_LABELS).map(([key, label]) => [
    key,
    { label, color: MODULE_COLORS[key] },
  ])
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
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full md:h-[320px]">
          <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            <Bar dataKey="savings" radius={[0, 4, 4, 0]} maxBarSize={28}>
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={MODULE_COLORS[entry.key] || "hsl(215, 15%, 45%)"} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        {/* Legend pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          {chartData.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center gap-1.5 rounded-md border border-border/30 bg-secondary/30 px-2 py-1"
            >
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: MODULE_COLORS[entry.key] }}
              />
              <span className="text-[10px] text-muted-foreground">{entry.module}</span>
              <span className="font-mono text-[10px] font-medium text-foreground">
                ${entry.savings.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
