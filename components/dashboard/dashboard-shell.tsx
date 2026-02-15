"use client"

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
            <section aria-label="Key performance indicators">
              <KpiCards />
            </section>

            {/* --- Performance --- */}
            <SectionHeader title="Performance" />

            {/* Savings timeline - full width */}
            <section aria-label="Savings over time">
              <SavingsTimelineChart />
            </section>

            {/* --- Cost Analytics --- */}
            <SectionHeader title="Cost Analytics" />

            {/* Two-column: Module breakdown + Model usage */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-label="Module savings breakdown">
                <ModuleBreakdownChart />
              </section>
              <section aria-label="Model usage distribution">
                <ModelUsageChart />
              </section>
            </div>

            {/* --- Infrastructure --- */}
            <SectionHeader title="Infrastructure" />

            {/* Two-column: Pipeline metrics + Provider health */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-label="Pipeline performance">
                <PipelineMetrics />
              </section>
              <section aria-label="Provider health">
                <ProviderHealth />
              </section>
            </div>

            {/* --- Activity & Security --- */}
            <SectionHeader title="Activity & Security" />

            {/* Three-column: Event feed + Anomaly detection + Budget gauge */}
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

            {/* --- User Management --- */}
            <SectionHeader title="User Management" />

            {/* User budget management - full width */}
            <section aria-label="User budget management">
              <UserBudgetTable />
            </section>
          </div>
        </main>
      </div>
    </DashboardProvider>
  )
}
