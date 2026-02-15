"use client"

import { useMemo } from "react"
import { useDashboard, type TimeRange } from "./dashboard-provider"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowLeft, Bell, Download, Pause, Play, Shield } from "lucide-react"
import Link from "next/link"

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 Hour" },
  { value: "6h", label: "6 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
]

export function DashboardHeader() {
  const { mode, setMode, timeRange, setTimeRange, data, isPaused, setIsPaused } = useDashboard()

  const notificationBadge = useMemo(() => {
    const activeAlerts = data.alerts.filter((a) => !a.dismissed)
    const unacknowledgedAnomalies = data.anomalies.filter((a) => !a.acknowledged)
    const count = activeAlerts.length + unacknowledgedAnomalies.length

    if (count === 0) return null

    const hasCritical = activeAlerts.some((a) => a.severity === "critical")
    const hasWarning =
      activeAlerts.some((a) => a.severity === "warning") ||
      unacknowledgedAnomalies.some((a) => a.severity === "high")

    const bgColor = hasCritical
      ? "bg-[hsl(0,72%,51%)]"
      : hasWarning
        ? "bg-[hsl(38,92%,50%)]"
        : "bg-blue-500"

    return { count, bgColor }
  }, [data.alerts, data.anomalies])

  const handleExport = (format: "json" | "csv") => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")
    let content: string
    let mimeType: string
    let extension: string

    if (format === "json") {
      content = JSON.stringify(data, null, 2)
      mimeType = "application/json"
      extension = "json"
    } else {
      const rows = data.timeSeries.map((p) =>
        [
          new Date(p.timestamp).toISOString(),
          p.spent.toFixed(6),
          p.saved.toFixed(6),
          p.cumulativeSpent.toFixed(6),
          p.cumulativeSaved.toFixed(6),
        ].join(","),
      )
      content = ["timestamp,spent,saved,cumulative_spent,cumulative_saved", ...rows].join("\n")
      mimeType = "text/csv"
      extension = "csv"
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `tokenshield-export-${timestamp}.${extension}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <header className="sticky top-0 z-50 flex flex-col gap-4 border-b border-border/50 bg-background/80 px-4 py-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between md:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            TokenShield Dashboard
          </h1>
          {notificationBadge && (
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white ${notificationBadge.bgColor}`}
              title={`${notificationBadge.count} active alert(s) / anomalies`}
            >
              {notificationBadge.count > 99 ? "99+" : notificationBadge.count}
            </span>
          )}
        </div>
        <div className="hidden h-5 w-px bg-border/50 md:block" />
        <span className="hidden text-xs text-muted-foreground md:inline">
          {data.totalRequests.toLocaleString()} requests tracked
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Pause/Play */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsPaused(!isPaused)}
          className="h-8 gap-1.5 border-border/50 text-xs"
        >
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          <span className="sr-only md:not-sr-only">{isPaused ? "Resume" : "Pause"}</span>
        </Button>

        {/* Demo / Live toggle */}
        <div className="flex items-center gap-2">
          <Label htmlFor="mode-toggle" className="text-xs text-muted-foreground">
            Demo
          </Label>
          <Switch
            id="mode-toggle"
            checked={mode === "live"}
            onCheckedChange={(checked) => setMode(checked ? "live" : "demo")}
            className="data-[state=checked]:bg-primary"
          />
          <Label htmlFor="mode-toggle" className="text-xs text-muted-foreground">
            Live
          </Label>
        </div>

        {/* Time range */}
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="h-8 w-[100px] border-border/50 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 border-border/50 text-xs">
              <Download className="h-3.5 w-3.5" />
              <span className="sr-only md:not-sr-only">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("json")}>Export JSON</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("csv")}>Export CSV</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
