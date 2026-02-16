"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  useDashboardData,
  useDashboardSettings,
  type TimeRange,
  type DemoScenarioId,
} from "./dashboard-provider"
import { DEMO_SCENARIOS } from "@/lib/demo-data-engine"
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
import { ArrowLeft, Bell, Download, Pause, Play, Shield, TrendingUp } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ALERT_SEVERITY_CONFIG } from "@/lib/dashboard-utils"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { useToast } from "@/hooks/use-toast"

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1 Hour" },
  { value: "6h", label: "6 Hours" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
]

export function DashboardHeader() {
  const data = useDashboardData()
  const { mode, setMode, timeRange, setTimeRange, isPaused, setIsPaused, scenario, setScenario } =
    useDashboardSettings()
  const reducedMotion = useReducedMotion()
  const { toast } = useToast()

  // Consolidated: compute active alerts once, derive badge + count from it
  const { notificationBadge, activeAlertCount } = useMemo(() => {
    const activeAlerts = data.alerts.filter((a) => !a.dismissed)
    const unacknowledgedAnomalies = data.anomalies.filter((a) => !a.acknowledged)
    const count = activeAlerts.length + unacknowledgedAnomalies.length
    const alertCount = activeAlerts.length

    if (count === 0) return { notificationBadge: null, activeAlertCount: alertCount }

    const hasCritical = activeAlerts.some((a) => a.severity === "critical")
    const hasWarning =
      activeAlerts.some((a) => a.severity === "warning") ||
      unacknowledgedAnomalies.some((a) => a.severity === "high")

    const bgColor = hasCritical
      ? "bg-[hsl(0,72%,51%)]"
      : hasWarning
        ? "bg-[hsl(38,92%,50%)]"
        : "bg-blue-500"

    const borderColor = hasCritical
      ? "border-[hsl(0,72%,51%)]/30"
      : hasWarning
        ? "border-[hsl(38,92%,50%)]/30"
        : "border-blue-500/30"

    return {
      notificationBadge: { count, bgColor, borderColor },
      activeAlertCount: alertCount,
    }
  }, [data.alerts, data.anomalies])

  const savingsRateColor = useMemo(() => {
    if (data.savingsRate >= 30) return "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
    if (data.savingsRate >= 15) return "text-amber-500 border-amber-500/30 bg-amber-500/10"
    return "text-muted-foreground border-border/30 bg-secondary/30"
  }, [data.savingsRate])

  const dataRef = useRef(data)
  dataRef.current = data
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    return () => clearTimeout(revokeTimerRef.current)
  }, [])

  const handleExport = useCallback(
    (format: "json" | "csv") => {
      if (typeof document === "undefined") return
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-")
      let content: string
      let mimeType: string
      let extension: string

      if (format === "json") {
        content = JSON.stringify(dataRef.current, null, 2)
        mimeType = "application/json"
        extension = "json"
      } else {
        const rows = dataRef.current.timeSeries.map((p) =>
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
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      clearTimeout(revokeTimerRef.current)
      revokeTimerRef.current = setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast({
        title: "Export complete",
        description: `${format.toUpperCase()} file downloaded successfully.`,
      })
    },
    [toast],
  )

  const togglePause = useCallback(() => {
    setIsPaused((prev: boolean) => !prev)
  }, [setIsPaused])

  return (
    <header className="relative sticky top-0 z-50 flex flex-col gap-4 border-b border-border/50 bg-background/80 px-4 py-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between md:px-6">
      {/* Gradient accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/60 via-[hsl(190,70%,50%)]/40 to-[hsl(270,60%,60%)]/30" />

      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="group flex h-9 w-9 items-center justify-center rounded-lg border border-border/50 text-muted-foreground transition-all hover:border-primary/30 hover:bg-secondary hover:text-foreground hover:shadow-[0_0_8px_-2px_hsl(var(--primary)/0.3)]"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            <span className="text-primary">Token</span>Shield Dashboard
          </h1>
          {notificationBadge && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none text-white",
                !reducedMotion && "animate-pulse",
                notificationBadge.bgColor,
                notificationBadge.borderColor,
              )}
              role="status"
              aria-label={`${notificationBadge.count} active alert${notificationBadge.count !== 1 ? "s" : ""} and anomalies`}
            >
              <Bell className="h-2.5 w-2.5" />
              {notificationBadge.count > 99 ? "99+" : notificationBadge.count}
            </span>
          )}
        </div>
        <div className="hidden h-5 w-px bg-border/50 md:block" />

        {/* Status bar stat pills */}
        <div className="hidden items-center gap-2 md:inline-flex">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${savingsRateColor}`}
          >
            <TrendingUp className="h-2.5 w-2.5" />
            {data.savingsRate.toFixed(1)}% saved
          </span>
          {activeAlertCount > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                ALERT_SEVERITY_CONFIG.warning.badgeClass,
              )}
            >
              <Bell className="h-2.5 w-2.5" />
              {activeAlertCount} alert{activeAlertCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {data.totalRequests.toLocaleString()} requests
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isPaused
                  ? "bg-muted-foreground/40"
                  : cn("bg-emerald-500", !reducedMotion && "animate-pulse"),
              )}
            />
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Pause/Play */}
        <Button
          variant="outline"
          size="sm"
          onClick={togglePause}
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

        {/* Scenario preset */}
        {mode === "demo" && (
          <Select value={scenario} onValueChange={(v) => setScenario(v as DemoScenarioId)}>
            <SelectTrigger className="h-8 w-[160px] border-border/50 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEMO_SCENARIOS).map(([id, cfg]) => (
                <SelectItem key={id} value={id}>
                  <div className="flex flex-col">
                    <span>{cfg.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
