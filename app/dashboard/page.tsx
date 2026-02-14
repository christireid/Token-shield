import type { Metadata } from "next"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"

export const metadata: Metadata = {
  title: "Dashboard | TokenShield SDK",
  description:
    "Real-time cost savings observability dashboard for TokenShield SDK. Monitor spending, savings, cache performance, model usage, and per-user budgets.",
}

export default function DashboardPage() {
  return <DashboardShell />
}
