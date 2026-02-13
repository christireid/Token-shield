"use client"

import { useDashboard } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts"

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

export function SavingsTimelineChart() {
  const { data } = useDashboard()

  const chartData = data.timeSeries.map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cumulativeSaved: Number(p.cumulativeSaved.toFixed(4)),
    cumulativeSpent: Number(p.cumulativeSpent.toFixed(4)),
    wouldHaveSpent: Number((p.cumulativeSpent + p.cumulativeSaved).toFixed(4)),
  }))

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Savings Over Time</CardTitle>
        <CardDescription className="text-xs">
          Cumulative spend vs. what you would have spent without TokenShield
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full md:h-[320px]">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradSaved" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(152, 60%, 52%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(152, 60%, 52%)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradSpent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(215, 15%, 45%)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="hsl(215, 15%, 45%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 12%)" />
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
                    const label = name === "wouldHaveSpent" ? "Without Shield" : name === "cumulativeSpent" ? "Actually Spent" : "Saved"
                    return (
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium text-foreground">${Number(value).toFixed(4)}</span>
                      </span>
                    )
                  }}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="wouldHaveSpent"
              stroke="hsl(215, 15%, 35%)"
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="cumulativeSpent"
              stroke="hsl(215, 15%, 45%)"
              strokeWidth={1.5}
              fill="url(#gradSpent)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="cumulativeSaved"
              stroke="hsl(152, 60%, 52%)"
              strokeWidth={2}
              fill="url(#gradSaved)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
