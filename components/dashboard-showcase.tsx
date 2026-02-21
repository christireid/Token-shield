import Link from "next/link"
import { Activity, Layers, Wifi, Users, ArrowRight } from "lucide-react"

const HIGHLIGHTS = [
  {
    icon: Activity,
    title: "Anomaly Detection",
    description:
      "AI-powered Z-score, EWMA, and percentile-based anomaly detection catches cost spikes before they become runaway bills.",
    stat: "3 anomalies detected this session",
    color: "hsl(38, 92%, 50%)",
  },
  {
    icon: Layers,
    title: "Pipeline Metrics",
    description:
      "See per-stage execution times and savings across the 6-stage middleware pipeline in real-time.",
    stat: "~12ms average pipeline latency",
    color: "hsl(270, 60%, 60%)",
  },
  {
    icon: Wifi,
    title: "Provider Health",
    description:
      "Monitor latency, error rates, and uptime across OpenAI, Anthropic, and Google in one view.",
    stat: "99.9% uptime across all providers",
    color: "hsl(190, 70%, 50%)",
  },
  {
    icon: Users,
    title: "Per-User Budgets",
    description:
      "Set daily and monthly spending limits per user with real-time tracking, tier management, and inline editing.",
    stat: "Set limits from $0.01 to unlimited",
    color: "hsl(152, 60%, 52%)",
  },
]

export function DashboardShowcase() {
  return (
    <section className="border-b-0 bg-gradient-to-b from-background via-card/30 to-background">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold sm:text-3xl">
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Real-time monitoring
          </span>{" "}
          <span className="text-primary">built in</span>
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">
          Every TokenShield instance includes a full monitoring dashboard with anomaly detection,
          pipeline metrics, and per-user budget management.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-border bg-card p-4 transition-all duration-300 hover:translate-y-[-2px]"
              style={{
                borderTopWidth: "2px",
                borderTopColor: item.color,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = `0 0 20px ${item.color}1a`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none"
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${item.color}1a` }}
                >
                  <item.icon className="h-4 w-4" style={{ color: item.color }} />
                </div>
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {item.description}
              </p>
              <p className="mt-3 text-xs font-medium" style={{ color: item.color }}>
                {item.stat}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-5 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/10 hover:shadow-[0_0_20px_hsl(152,60%,52%,0.15)]"
          >
            Explore the dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Gradient separator */}
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </section>
  )
}
