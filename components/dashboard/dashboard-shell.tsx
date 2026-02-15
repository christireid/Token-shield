"use client"

import { DashboardProvider } from "./dashboard-provider"
import { DashboardHeader } from "./dashboard-header"
import { KpiCards } from "./kpi-cards"
import { SavingsTimelineChart } from "./savings-timeline-chart"
import { ModuleBreakdownChart } from "./module-breakdown-chart"
import { ModelUsageChart } from "./model-usage-chart"
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

            {/* Two-column: Event feed + Budget gauge */}
            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
              <section aria-label="Live event feed">
                <EventFeed />
              </section>
              <section aria-label="Budget utilization">
                <BudgetGauge />
              </section>
            </div>

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
