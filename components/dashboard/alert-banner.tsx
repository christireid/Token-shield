"use client"

import * as React from "react"
import { useDashboardData, useDashboardActions, type DashboardAlert } from "./dashboard-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatRelativeTime, ALERT_SEVERITY_CONFIG } from "@/lib/dashboard-utils"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
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
    ...ALERT_SEVERITY_CONFIG.info,
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    ...ALERT_SEVERITY_CONFIG.warning,
  },
  critical: {
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    ...ALERT_SEVERITY_CONFIG.critical,
  },
}

/* ------------------------------------------------------------------ */
/*  Single alert row                                                   */
/* ------------------------------------------------------------------ */

const AlertRow = React.memo(function AlertRow({
  alert,
  onDismiss,
  reducedMotion,
}: {
  alert: DashboardAlert
  onDismiss: (id: number) => void
  reducedMotion: boolean
}) {
  const config = SEVERITY_CONFIG[alert.severity]
  const isCritical = alert.severity === "critical"

  return (
    <div
      role={isCritical ? "alert" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2",
        config.containerClass,
        isCritical && !reducedMotion && "animate-pulse",
      )}
    >
      {/* Severity icon */}
      <div className={cn("shrink-0", config.iconClass)}>{config.icon}</div>

      {/* Title + message */}
      <div className="min-w-0 flex-1 flex items-center gap-2 overflow-x-auto">
        <span className={cn("shrink-0 text-xs font-bold", config.titleClass)}>{alert.title}</span>
        <span className="truncate text-xs text-muted-foreground">{alert.message}</span>
      </div>

      {/* Source badge */}
      <Badge
        variant="outline"
        className={cn("shrink-0 rounded px-1.5 py-0 text-[10px] font-medium", config.badgeClass)}
      >
        {alert.source}
      </Badge>

      {/* Timestamp */}
      <span
        className="shrink-0 text-[10px] text-muted-foreground/50"
        title={new Date(alert.timestamp).toLocaleString()}
      >
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
})

/* ------------------------------------------------------------------ */
/*  AlertBanner                                                        */
/* ------------------------------------------------------------------ */

export function AlertBanner() {
  const data = useDashboardData()
  const { dismissAlert } = useDashboardActions()
  const reducedMotion = useReducedMotion()

  const activeAlerts = React.useMemo(() => data.alerts.filter((a) => !a.dismissed), [data.alerts])

  if (activeAlerts.length === 0) return null

  return (
    <section
      aria-label="Active alerts"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-1.5",
        !reducedMotion && "animate-in fade-in-0 slide-in-from-top-2 duration-300",
      )}
    >
      {/* Count indicator when more than 2 alerts */}
      {activeAlerts.length > 2 && (
        <div className="flex items-center gap-1.5 px-1">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-[hsl(38,92%,50%)]",
              !reducedMotion && "animate-pulse",
            )}
          />
          <span className="text-[10px] font-medium text-muted-foreground">
            {activeAlerts.length} active alerts
          </span>
        </div>
      )}

      {/* Alert rows stacked vertically */}
      {activeAlerts.map((alert) => (
        <AlertRow
          key={alert.id}
          alert={alert}
          onDismiss={dismissAlert}
          reducedMotion={reducedMotion}
        />
      ))}
    </section>
  )
}
