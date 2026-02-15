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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-4 pt-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
        {title}
      </span>
      <div className="h-px bg-border/20 flex-1" />
    </div>
  )
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
  return (
    <section
      aria-label={ariaLabel}
      className="transition-all duration-500 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
      }}
    >
      {children}
    </section>
  )
}

export function DashboardShell() {
  return (
    <DashboardProvider>
      <style>{`
        .dashboard-dot-grid {
          background-image: radial-gradient(circle, hsl(215 20% 25% / 0.3) 1px, transparent 1px);
          background-size: 24px 24px;
        }
      `}</style>

      <div className="dashboard-dot-grid flex min-h-screen flex-col bg-background">
        <DashboardHeader />

        <main className="relative flex-1 px-4 py-6 md:px-6">
          {/* Radial gradient glow at the top for depth */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[600px]"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(152 60% 52% / 0.03), transparent)",
            }}
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
              <SavingsTimelineChart />
            </RevealSection>

            {/* --- Cost Analytics --- */}
            <SectionHeader title="Cost Analytics" />

            {/* Two-column: Module breakdown + Model usage */}
            <RevealSection order={3} ariaLabel="Cost analytics breakdown">
              <div className="grid gap-6 lg:grid-cols-2">
                <section aria-label="Module savings breakdown">
                  <ModuleBreakdownChart />
                </section>
                <section aria-label="Model usage distribution">
                  <ModelUsageChart />
                </section>
              </div>
            </RevealSection>

            {/* --- Infrastructure --- */}
            <SectionHeader title="Infrastructure" />

            {/* Two-column: Pipeline metrics + Provider health */}
            <RevealSection order={4} ariaLabel="Infrastructure metrics">
              <div className="grid gap-6 lg:grid-cols-2">
                <section aria-label="Pipeline performance">
                  <PipelineMetrics />
                </section>
                <section aria-label="Provider health">
                  <ProviderHealth />
                </section>
              </div>
            </RevealSection>

            {/* --- Activity & Security --- */}
            <SectionHeader title="Activity & Security" />

            {/* Three-column: Event feed + Anomaly detection + Budget gauge */}
            <RevealSection order={5} ariaLabel="Activity and security overview">
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr_380px]">
                <section aria-label="Live event feed">
                  <EventFeed />
                </section>
                <section aria-label="Anomaly detection">
                  <AnomalyPanel />
                </section>
                <section aria-label="Budget utilization">
                  <BudgetGauge />
                </section>
              </div>
            </RevealSection>

            {/* --- User Management --- */}
            <SectionHeader title="User Management" />

            {/* User budget management - full width */}
            <RevealSection order={6} ariaLabel="User budget management">
              <UserBudgetTable />
            </RevealSection>
          </div>
        </main>
      </div>
    </DashboardProvider>
  )
}
