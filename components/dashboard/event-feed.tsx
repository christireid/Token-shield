"use client"

import * as React from "react"
import { useDashboard, type DashboardEvent } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import {
  formatRelativeTime,
  formatEventType,
  EVENT_DOT_COLORS,
  EVENT_BADGE_COLORS,
} from "@/lib/dashboard-utils"

const EventRow = React.memo(function EventRow({
  event: ev,
  isLast,
}: {
  event: DashboardEvent
  isLast: boolean
}) {
  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-secondary/30",
        ev.type === "breaker:warning" && "bg-[hsl(25,95%,53%)]/5",
      )}
    >
      {/* Timeline connector line */}
      {!isLast && <div className="absolute left-[11px] top-5 h-full w-px bg-border/20" />}

      {/* Dot */}
      <div className="flex h-5 items-center">
        <div
          className={cn(
            "relative z-10 h-2 w-2 rounded-full ring-2 ring-background",
            EVENT_DOT_COLORS[ev.type],
          )}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 rounded px-1.5 py-0 text-[10px] font-medium",
              EVENT_BADGE_COLORS[ev.type],
            )}
          >
            {formatEventType(ev.type)}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">{ev.message}</span>
        </div>
      </div>

      {/* Timestamp */}
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
        {formatRelativeTime(ev.timestamp)}
      </span>
    </div>
  )
})

export function EventFeed() {
  const { data } = useDashboard()
  const reducedMotion = useReducedMotion()
  const [paused, setPaused] = React.useState(false)
  const [frozenEvents, setFrozenEvents] = React.useState<DashboardEvent[]>([])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const latestEventsRef = React.useRef(data.events)
  latestEventsRef.current = data.events
  const togglePause = React.useCallback(() => setPaused((p) => !p), [])

  const events = paused ? frozenEvents : data.events
  const displayEvents = React.useMemo(() => [...events].reverse(), [events])

  React.useEffect(() => {
    if (paused) {
      setFrozenEvents(latestEventsRef.current)
    }
  }, [paused])

  React.useEffect(() => {
    if (!paused && scrollRef.current) {
      const viewport = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]")
      if (viewport) {
        viewport.scrollTop = 0
      } else if (process.env.NODE_ENV === "development") {
        console.warn("EventFeed: Could not find scroll area viewport element")
      }
    }
  }, [data.events.length, paused])

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium text-foreground">Live Event Feed</CardTitle>
          {!paused && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-emerald-500",
                  !reducedMotion && "animate-pulse",
                )}
              />
              LIVE
            </span>
          )}
          <Badge
            variant="outline"
            className="rounded-full border-border/30 bg-secondary/30 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
          >
            {displayEvents.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePause}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[350px] px-4 pb-4" ref={scrollRef}>
          <div
            className="flex flex-col gap-1"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {displayEvents.map((ev, index) => (
              <EventRow key={ev.id} event={ev} isLast={index === displayEvents.length - 1} />
            ))}
            {displayEvents.length === 0 && (
              <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/30">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full bg-muted-foreground/20",
                    !reducedMotion && "animate-pulse",
                  )}
                />
                <span className="text-xs text-muted-foreground">Waiting for events...</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
