"use client"

import React from "react"
import { DashboardProvider } from "./dashboard-provider"
import { DashboardHeader } from "./dashboard-header"
import { AlertBanner } from "./alert-banner"
import { KpiCards } from "./kpi-cards"
import { SavingsTimelineChart } from "./savings-timeline-chart"
import { ModuleBreakdownChart } from "./module-breakdown-chart"
import { ModelUsageChart } from "./model-usage-chart"
import { PipelineMetrics } from "./pipeline-metrics"
import { AnomalyPanel } from "./anomaly-panel"
import { ProviderHealth } from "./provider-health"
import { EventFeed } from "./event-feed"
import { BudgetGauge } from "./budget-gauge"
import { UserBudgetTable } from "./user-budget-table"
import { useStaggeredReveal } from "@/hooks/use-staggered-reveal"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { DashboardErrorBoundary } from "./error-boundary"

const SectionHeader = React.memo(function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 pt-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
        {title}
      </span>
      <div className="h-px bg-border/20 flex-1" />
    </div>
  )
})

const HIDDEN_STYLE: React.CSSProperties = {
  opacity: 0,
  transform: "translateY(12px)",
  willChange: "transform, opacity",
}
const VISIBLE_STYLE: React.CSSProperties = {
  opacity: 1,
  transform: "translateY(0)",
  willChange: "auto",
}

function RevealSection({
  order,
  children,
  ariaLabel,
}: {
  order: number
  children: React.ReactNode
  ariaLabel?: string
}) {
  const visible = useStaggeredReveal(order)
  const reducedMotion = useReducedMotion()
  return (
    <section
      aria-label={ariaLabel}
      className={reducedMotion ? undefined : "transition-all duration-500 ease-out"}
      style={reducedMotion || visible ? VISIBLE_STYLE : HIDDEN_STYLE}
    >
      {children}
    </section>
  )
}

const RADIAL_BG_STYLE: React.CSSProperties = {
  background: "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(152 60% 52% / 0.03), transparent)",
}

export function DashboardShell() {
  return (
    <DashboardProvider>
      <style>{`
        .dashboard-dot-grid {
          background-image: radial-gradient(circle, hsl(215 20% 25% / 0.3) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        @media (prefers-reduced-motion: reduce) {
          .dashboard-dot-grid *,
          .dashboard-dot-grid *::before,
          .dashboard-dot-grid *::after {
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div className="dashboard-dot-grid flex min-h-screen flex-col bg-background">
        <DashboardHeader />

        <main className="relative flex-1 px-4 py-6 md:px-6">
          {/* Radial gradient glow at the top for depth */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
            style={RADIAL_BG_STYLE}
          />

          <div className="relative mx-auto flex max-w-[1400px] flex-col gap-6">
            {/* Alert banner - only renders when there are active alerts */}
            <AlertBanner />

            {/* KPI row */}
            <RevealSection order={1} ariaLabel="Key performance indicators">
              <KpiCards />
            </RevealSection>

            {/* --- Performance --- */}
            <SectionHeader title="Performance" />

            {/* Savings timeline - full width */}
            <RevealSection order={2} ariaLabel="Savings over time">
              <DashboardErrorBoundary name="Savings Timeline">
                <SavingsTimelineChart />
              </DashboardErrorBoundary>
            </RevealSection>

            {/* --- Cost Analytics --- */}
            <SectionHeader title="Cost Analytics" />

            {/* Two-column: Module breakdown + Model usage */}
            <RevealSection order={3} ariaLabel="Cost analytics breakdown">
              <div className="grid gap-6 lg:grid-cols-2">
                <DashboardErrorBoundary name="Module Breakdown">
                  <section aria-label="Module savings breakdown">
                    <ModuleBreakdownChart />
                  </section>
                </DashboardErrorBoundary>
                <DashboardErrorBoundary name="Model Usage">
                  <section aria-label="Model usage distribution">
                    <ModelUsageChart />
                  </section>
                </DashboardErrorBoundary>
              </div>
            </RevealSection>

            {/* --- Infrastructure --- */}
            <SectionHeader title="Infrastructure" />

            {/* Two-column: Pipeline metrics + Provider health */}
            <RevealSection order={4} ariaLabel="Infrastructure metrics">
              <div className="grid gap-6 lg:grid-cols-2">
                <DashboardErrorBoundary name="Pipeline Metrics">
                  <section aria-label="Pipeline performance">
                    <PipelineMetrics />
                  </section>
                </DashboardErrorBoundary>
                <DashboardErrorBoundary name="Provider Health">
                  <section aria-label="Provider health">
                    <ProviderHealth />
                  </section>
                </DashboardErrorBoundary>
              </div>
            </RevealSection>

            {/* --- Activity & Security --- */}
            <SectionHeader title="Activity & Security" />

            {/* Three-column: Event feed + Anomaly detection + Budget gauge */}
            <RevealSection order={5} ariaLabel="Activity and security overview">
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr_380px]">
                <DashboardErrorBoundary name="Event Feed">
                  <section aria-label="Live event feed">
                    <EventFeed />
                  </section>
                </DashboardErrorBoundary>
                <DashboardErrorBoundary name="Anomaly Detection">
                  <section aria-label="Anomaly detection">
                    <AnomalyPanel />
                  </section>
                </DashboardErrorBoundary>
                <DashboardErrorBoundary name="Budget Gauge">
                  <section aria-label="Budget utilization">
                    <BudgetGauge />
                  </section>
                </DashboardErrorBoundary>
              </div>
            </RevealSection>

            {/* --- User Management --- */}
            <SectionHeader title="User Management" />

            {/* User budget management - full width */}
            <RevealSection order={6} ariaLabel="User budget management">
              <DashboardErrorBoundary name="User Budget Table">
                <UserBudgetTable />
              </DashboardErrorBoundary>
            </RevealSection>
          </div>
        </main>
      </div>
    </DashboardProvider>
  )
}
