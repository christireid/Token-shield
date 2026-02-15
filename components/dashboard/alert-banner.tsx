"use client"

import { useDashboard, type DashboardAlert } from "./dashboard-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Info, AlertTriangle, AlertOctagon, X } from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Severity configuration                                             */
/* ------------------------------------------------------------------ */

const SEVERITY_CONFIG: Record<
  DashboardAlert["severity"],
  {
    icon: React.ReactNode
    containerClass: string
    iconClass: string
    titleClass: string
    badgeClass: string
  }
> = {
  info: {
    icon: <Info className="h-3.5 w-3.5" />,
    containerClass: "bg-blue-500/5 border-blue-500/20",
    iconClass: "text-blue-400",
    titleClass: "text-blue-300",
    badgeClass:
      "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    containerClass: "bg-[hsl(38,92%,50%)]/5 border-[hsl(38,92%,50%)]/20",
    iconClass: "text-[hsl(38,92%,60%)]",
    titleClass: "text-[hsl(38,92%,65%)]",
    badgeClass:
      "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  },
  critical: {
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    containerClass: "bg-[hsl(0,72%,51%)]/5 border-[hsl(0,72%,51%)]/20",
    iconClass: "text-[hsl(0,72%,60%)]",
    titleClass: "text-[hsl(0,72%,65%)]",
    badgeClass:
      "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
  },
}

/* ------------------------------------------------------------------ */
/*  Relative time helper                                               */
/* ------------------------------------------------------------------ */

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

/* ------------------------------------------------------------------ */
/*  Single alert row                                                   */
/* ------------------------------------------------------------------ */

function AlertRow({
  alert,
  onDismiss,
}: {
  alert: DashboardAlert
  onDismiss: (id: number) => void
}) {
  const config = SEVERITY_CONFIG[alert.severity]

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2",
        config.containerClass,
        alert.severity === "critical" && "animate-pulse",
      )}
    >
      {/* Severity icon */}
      <div className={cn("shrink-0", config.iconClass)}>{config.icon}</div>

      {/* Title + message */}
      <div className="min-w-0 flex-1 flex items-center gap-2 overflow-x-auto">
        <span
          className={cn(
            "shrink-0 text-xs font-bold",
            config.titleClass,
          )}
        >
          {alert.title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {alert.message}
        </span>
      </div>

      {/* Source badge */}
      <Badge
        variant="outline"
        className={cn(
          "shrink-0 rounded px-1.5 py-0 text-[10px] font-medium",
          config.badgeClass,
        )}
      >
        {alert.source}
      </Badge>

      {/* Timestamp */}
      <span className="shrink-0 text-[10px] text-muted-foreground/50">
        {formatRelativeTime(alert.timestamp)}
      </span>

      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDismiss(alert.id)}
        className="h-5 w-5 shrink-0 p-0 text-muted-foreground/60 hover:text-foreground"
      >
        <X className="h-3 w-3" />
        <span className="sr-only">Dismiss alert</span>
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AlertBanner                                                        */
/* ------------------------------------------------------------------ */

export function AlertBanner() {
  const { data, dismissAlert } = useDashboard()

  const activeAlerts = data.alerts.filter((a) => !a.dismissed)

  if (activeAlerts.length === 0) return null

  return (
    <section aria-label="Active alerts" className="flex flex-col gap-1.5 animate-in fade-in-0 slide-in-from-top-2 duration-300">
      {/* Count indicator when more than 2 alerts */}
      {activeAlerts.length > 2 && (
        <div className="flex items-center gap-1.5 px-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[hsl(38,92%,50%)] animate-pulse" />
          <span className="text-[10px] font-medium text-muted-foreground">
            {activeAlerts.length} active alerts
          </span>
        </div>
      )}

      {/* Alert rows stacked vertically */}
      {activeAlerts.map((alert) => (
        <AlertRow key={alert.id} alert={alert} onDismiss={dismissAlert} />
      ))}
    </section>
  )
}
