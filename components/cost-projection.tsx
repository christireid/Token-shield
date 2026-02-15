"use client"

import { useMemo, useState } from "react"

const TIERS = [
  {
    label: "Startup",
    requests: 10000,
    avgInput: 500,
    avgOutput: 200,
    model: "gpt-4o-mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
  },
  {
    label: "Growth",
    requests: 100000,
    avgInput: 800,
    avgOutput: 300,
    model: "gpt-4o",
    inputPrice: 2.5,
    outputPrice: 10.0,
  },
  {
    label: "Enterprise",
    requests: 1000000,
    avgInput: 1200,
    avgOutput: 500,
    model: "gpt-4o",
    inputPrice: 2.5,
    outputPrice: 10.0,
  },
]

export function CostProjection() {
  const [tierIdx, setTierIdx] = useState(1)
  const tier = TIERS[tierIdx]

  const projection = useMemo(() => {
    const inputCost = (tier.avgInput / 1_000_000) * tier.inputPrice
    const outputCost = (tier.avgOutput / 1_000_000) * tier.outputPrice
    const costPerRequest = inputCost + outputCost
    const monthlyCost = costPerRequest * tier.requests

    // Conservative estimate: 60% savings across all modules
    const savedPercent = 0.6
    const monthlySaved = monthlyCost * savedPercent
    const monthlyWithShield = monthlyCost - monthlySaved
    const yearlySaved = monthlySaved * 12

    return {
      costPerRequest,
      monthlyCost,
      monthlySaved,
      monthlyWithShield,
      yearlySaved,
      savedPercent,
    }
  }, [tier])

  return (
    <section>
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          Your projected savings
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Based on real pricing data and conservative 60% optimization across modules.
        </p>

        {/* Tier selector */}
        <div className="mt-6 flex gap-2">
          {TIERS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setTierIdx(i)}
              className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                tierIdx === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Numbers */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Monthly cost without TokenShield</p>
            <p className="mt-1 font-mono text-2xl font-bold text-foreground">
              ${projection.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tier.requests.toLocaleString()} req/mo on {tier.model}
            </p>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
            <p className="text-xs text-primary/80">Monthly cost with TokenShield</p>
            <p className="mt-1 font-mono text-2xl font-bold text-primary">
              $
              {projection.monthlyWithShield.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-primary/70">
              {(projection.savedPercent * 100).toFixed(0)}% reduction
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Annual savings</p>
            <p className="mt-1 font-mono text-2xl font-bold text-foreground">
              ${projection.yearlySaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ${projection.monthlySaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
              saved
            </p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-foreground">Where the savings come from</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                module: "Context Manager",
                pct: "40-70%",
                desc: "Trim old messages, keep what matters",
              },
              { module: "Response Cache", pct: "100%", desc: "Repeated/rephrased queries cost $0" },
              { module: "Model Router", pct: "80-95%", desc: "Simple queries on cheap models" },
              { module: "Request Guard", pct: "100%", desc: "Block duplicate rapid-fire calls" },
              {
                module: "Prefix Optimizer",
                pct: "50-90%",
                desc: "Provider-side prompt cache hits",
              },
              {
                module: "Circuit Breaker",
                pct: "caps cost",
                desc: "Hard limits prevent runaway bills",
              },
            ].map((item) => (
              <div
                key={item.module}
                className="flex items-start gap-2 rounded-md bg-background p-2.5"
              >
                <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                  {item.pct}
                </span>
                <div>
                  <p className="text-xs font-medium text-foreground">{item.module}</p>
                  <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <code className="rounded-lg bg-card px-5 py-3 font-mono text-sm text-muted-foreground">
            npm install tokenshield
          </code>
          <p className="text-xs text-muted-foreground">
            MIT license. 2 dependencies. Works with Next.js, Vite, and any TypeScript project.
          </p>
        </div>
      </div>
    </section>
  )
}
