import Link from "next/link"
import { Activity, Layers, Wifi, Users } from "lucide-react"

const HIGHLIGHTS = [
  {
    icon: Activity,
    title: "Anomaly Detection",
    description:
      "AI-powered Z-score, EWMA, and percentile-based anomaly detection catches cost spikes before they become runaway bills.",
  },
  {
    icon: Layers,
    title: "Pipeline Metrics",
    description:
      "See per-stage execution times and savings across the 6-stage middleware pipeline in real-time.",
  },
  {
    icon: Wifi,
    title: "Provider Health",
    description:
      "Monitor latency, error rates, and uptime across OpenAI, Anthropic, and Google in one view.",
  },
  {
    icon: Users,
    title: "Per-User Budgets",
    description:
      "Set daily and monthly spending limits per user with real-time tracking, tier management, and inline editing.",
  },
]

export function DashboardShowcase() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          Real-time monitoring built in
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Every TokenShield instance includes a full monitoring dashboard with anomaly detection,
          pipeline metrics, and per-user budget management.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Explore the dashboard &rarr;
          </Link>
        </div>
      </div>
    </section>
  )
}
