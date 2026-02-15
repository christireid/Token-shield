"use client"

import React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"

interface Props {
  children: React.ReactNode
  name: string
}

interface State {
  hasError: boolean
}

export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[DashboardErrorBoundary] ${this.props.name} crashed:`,
      error,
      info.componentStack,
    )
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-border/40 bg-card/50">
          <CardContent className="flex items-center gap-3 py-8">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[hsl(38,92%,65%)]" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-foreground">
                {this.props.name} failed to load
              </span>
              <span className="text-[10px] text-muted-foreground">
                An error occurred rendering this section. Refresh the page to try again.
              </span>
            </div>
          </CardContent>
        </Card>
      )
    }
    return this.props.children
  }
}
