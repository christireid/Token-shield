"use client"

import * as React from "react"
import { useDashboard, type DashboardEvent } from "./dashboard-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"

const EVENT_COLORS: Record<DashboardEvent["type"], string> = {
  "cache:hit": "bg-[hsl(190,70%,50%)]",
  "cache:miss": "bg-[hsl(215,15%,45%)]",
  "request:blocked": "bg-[hsl(0,72%,51%)]",
  "router:downgraded": "bg-[hsl(270,60%,60%)]",
  "context:trimmed": "bg-[hsl(38,92%,50%)]",
  "prefix:optimized": "bg-[hsl(152,60%,52%)]",
  "ledger:entry": "bg-[hsl(152,60%,52%)]",
  "breaker:warning": "bg-[hsl(25,95%,53%)]",
}

const EVENT_BADGE_COLORS: Record<DashboardEvent["type"], string> = {
  "cache:hit": "border-[hsl(190,70%,50%)]/30 bg-[hsl(190,70%,50%)]/10 text-[hsl(190,70%,65%)]",
  "cache:miss": "border-border/30 bg-secondary/30 text-muted-foreground",
  "request:blocked": "border-[hsl(0,72%,51%)]/30 bg-[hsl(0,72%,51%)]/10 text-[hsl(0,72%,65%)]",
  "router:downgraded":
    "border-[hsl(270,60%,60%)]/30 bg-[hsl(270,60%,60%)]/10 text-[hsl(270,60%,75%)]",
  "context:trimmed": "border-[hsl(38,92%,50%)]/30 bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,65%)]",
  "prefix:optimized":
    "border-[hsl(152,60%,52%)]/30 bg-[hsl(152,60%,52%)]/10 text-[hsl(152,60%,65%)]",
  "ledger:entry": "border-[hsl(152,60%,52%)]/30 bg-[hsl(152,60%,52%)]/10 text-[hsl(152,60%,65%)]",
  "breaker:warning": "border-[hsl(25,95%,53%)]/30 bg-[hsl(25,95%,53%)]/10 text-[hsl(25,95%,65%)]",
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5) return "just now"
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function formatType(type: string): string {
  return type.replace(":", " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function EventFeed() {
  const { data } = useDashboard()
  const [paused, setPaused] = React.useState(false)
  const [frozenEvents, setFrozenEvents] = React.useState<DashboardEvent[]>([])
  const scrollRef = React.useRef<HTMLDivElement>(null)

  const events = paused ? frozenEvents : data.events
  const displayEvents = [...events].reverse()

  React.useEffect(() => {
    if (paused) {
      setFrozenEvents(data.events)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  React.useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [data.events.length, paused])

  return (
    <Card className="border-border/40 bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Live Event Feed</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPaused(!paused)}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[350px] px-4 pb-4" ref={scrollRef}>
          <div className="flex flex-col gap-1">
            {displayEvents.map((ev) => (
              <div
                key={ev.id}
                className={cn(
                  "flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-secondary/30",
                  ev.type === "breaker:warning" && "bg-[hsl(25,95%,53%)]/5",
                )}
              >
                {/* Dot */}
                <div className="flex h-5 items-center">
                  <div className={cn("h-2 w-2 rounded-full", EVENT_COLORS[ev.type])} />
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
                      {formatType(ev.type)}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">{ev.message}</span>
                  </div>
                </div>

                {/* Timestamp */}
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                  {formatRelativeTime(ev.timestamp)}
                </span>
              </div>
            ))}
            {displayEvents.length === 0 && (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                Waiting for events...
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
