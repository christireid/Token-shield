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

export function DashboardShell() {
  return (
    <DashboardProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <DashboardHeader />

        <main className="flex-1 px-4 py-6 md:px-6">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
            {/* Alert banner - only renders when there are active alerts */}
            <AlertBanner />

            {/* KPI row */}
            <section aria-label="Key performance indicators">
              <KpiCards />
            </section>

            {/* Savings timeline - full width */}
            <section aria-label="Savings over time">
              <SavingsTimelineChart />
            </section>

            {/* Two-column: Module breakdown + Model usage */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-label="Module savings breakdown">
                <ModuleBreakdownChart />
              </section>
              <section aria-label="Model usage distribution">
                <ModelUsageChart />
              </section>
            </div>

            {/* Two-column: Pipeline metrics + Provider health */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section aria-label="Pipeline performance">
                <PipelineMetrics />
              </section>
              <section aria-label="Provider health">
                <ProviderHealth />
              </section>
            </div>

            {/* Two-column: Event feed + Budget gauge */}
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <section aria-label="Live event feed">
                <EventFeed />
              </section>
              <section aria-label="Budget utilization">
                <BudgetGauge />
              </section>
            </div>

            {/* Two-column: Anomaly detection + User budget management */}
            <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
              <section aria-label="Anomaly detection">
                <AnomalyPanel />
              </section>
              <section aria-label="User budget management">
                <UserBudgetTable />
              </section>
            </div>
          </div>
        </main>
      </div>
    </DashboardProvider>
  )
}
