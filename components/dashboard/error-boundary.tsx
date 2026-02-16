"use client"

import React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface Props {
  children: React.ReactNode
  name: string
}

interface State {
  hasError: boolean
  retryCount: number
}

const MAX_AUTO_RETRIES = 3

export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, retryCount: 0 }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[DashboardErrorBoundary] ${this.props.name} crashed:`,
      error,
      info.componentStack,
    )
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      if (this.state.retryCount < MAX_AUTO_RETRIES) {
        this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }))
      }
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, retryCount: 0 })
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
                An error occurred rendering this section.
              </span>
            </div>
            <button
              onClick={this.handleRetry}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-secondary/50 px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </CardContent>
        </Card>
      )
    }
    return this.props.children
  }
}
