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

const ESTIMATE_MODES = [
  { label: "Conservative", duplicateRate: 0.1, simpleRate: 0.15, prefixDiscount: 0.5 },
  { label: "Typical", duplicateRate: 0.2, simpleRate: 0.25, prefixDiscount: 0.7 },
  { label: "High-cache", duplicateRate: 0.35, simpleRate: 0.3, prefixDiscount: 0.9 },
] as const

export function CostProjection() {
  const [tierIdx, setTierIdx] = useState(1)
  const [modeIdx, setModeIdx] = useState(0)
  const tier = TIERS[tierIdx]
  const mode = ESTIMATE_MODES[modeIdx]

  const projection = useMemo(() => {
    const inputCost = (tier.avgInput / 1_000_000) * tier.inputPrice
    const outputCost = (tier.avgOutput / 1_000_000) * tier.outputPrice
    const costPerRequest = inputCost + outputCost
    const monthlyCost = costPerRequest * tier.requests

    // Module-by-module estimate with stated assumptions
    const cacheSavings = monthlyCost * mode.duplicateRate // % of requests are near-duplicates
    const routerSavings = monthlyCost * mode.simpleRate * 0.6 // simple queries routed to cheap models
    const prefixSavings = monthlyCost * 0.4 * mode.prefixDiscount * 0.8 * 0.5 // stable prefix * discount * hit rate * input share
    const guardSavings = monthlyCost * 0.03 // duplicate/spam request prevention

    const monthlySaved = cacheSavings + routerSavings + prefixSavings + guardSavings
    const savedPercent = Math.min(monthlySaved / monthlyCost, 0.7) // cap at 70%
    const actualSaved = monthlyCost * savedPercent
    const monthlyWithShield = monthlyCost - actualSaved
    const yearlySaved = actualSaved * 12

    return {
      costPerRequest,
      monthlyCost,
      monthlySaved: actualSaved,
      monthlyWithShield,
      yearlySaved,
      savedPercent,
      breakdown: {
        cache: cacheSavings,
        router: routerSavings,
        prefix: prefixSavings,
        guard: guardSavings,
      },
    }
  }, [tier, mode])

  return (
    <section className="bg-gradient-to-b from-background via-card/20 to-background">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          Your projected savings
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Estimates based on real model pricing. Actual savings depend on your workload — duplicate
          rate, query complexity, and conversation length all affect results.
        </p>

        {/* Estimate mode selector */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">Estimate:</span>
          <div className="inline-flex rounded-lg border border-border/50 bg-secondary/30 p-0.5">
            {ESTIMATE_MODES.map((m, i) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setModeIdx(i)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  modeIdx === i
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground/60">
            {(mode.duplicateRate * 100).toFixed(0)}% cache-eligible,{" "}
            {(mode.simpleRate * 100).toFixed(0)}% simple queries
          </span>
        </div>

        {/* Tier selector — segmented control */}
        <div className="mt-4 inline-flex rounded-xl border border-border/50 bg-secondary/30 p-1">
          {TIERS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              onClick={() => setTierIdx(i)}
              className={`min-h-[44px] rounded-lg px-5 py-2 text-sm font-medium transition-all ${
                tierIdx === i
                  ? "bg-primary text-primary-foreground shadow-[0_0_15px_hsl(152,60%,52%,0.2)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="block">{t.label}</span>
              <span
                className={`block text-[10px] ${tierIdx === i ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}
              >
                {t.model}
              </span>
            </button>
          ))}
        </div>

        {/* Numbers */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Without Shield */}
          <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Monthly cost without TokenShield</p>
            <p className="mt-1 font-mono text-2xl font-bold text-foreground line-through opacity-60">
              ${projection.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tier.requests.toLocaleString()} req/mo on {tier.model}
            </p>
          </div>

          {/* With Shield — hero card */}
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 shadow-[0_0_30px_hsl(152,60%,52%,0.15)] sm:p-5">
            <p className="text-xs text-primary/80">Monthly cost with TokenShield</p>
            <p className="mt-1 font-mono text-3xl font-black text-primary">
              $
              {projection.monthlyWithShield.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-primary/70">
              {(projection.savedPercent * 100).toFixed(0)}% reduction
            </p>
          </div>

          {/* Annual savings */}
          <div className="rounded-lg border border-border bg-gradient-to-br from-primary/5 via-card to-card p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Annual savings</p>
            <p className="mt-1 flex items-center gap-1.5 font-mono text-3xl font-black text-primary">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5 shrink-0 text-primary/70"
              >
                <path
                  fillRule="evenodd"
                  d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z"
                  clipRule="evenodd"
                />
              </svg>
              ${projection.yearlySaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ${projection.monthlySaved.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo
              saved
            </p>
          </div>
        </div>

        {/* Savings bar */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-primary">
              {(projection.savedPercent * 100).toFixed(0)}% saved
            </span>
            <span className="text-[11px] text-muted-foreground">
              of ${projection.monthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              /mo
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-secondary/50">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${projection.savedPercent * 100}%` }}
            />
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
                className="flex items-start gap-2 rounded-md border-l-2 border-l-primary/30 bg-background p-2.5 transition-colors hover:bg-secondary/20"
              >
                <span className="mt-0.5 shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
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
        <div className="mt-12">
          {/* Gradient separator */}
          <div className="h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <p className="text-sm font-medium text-foreground">Get started in 30 seconds</p>
            <code className="rounded-lg border border-border/50 border-l-2 border-l-primary/40 bg-card px-5 py-3 font-mono text-sm text-muted-foreground">
              npm install @tokenshield/ai-sdk
            </code>
            <p className="text-xs text-muted-foreground">
              MIT license. 2 dependencies. Works with Next.js, Vite, and any TypeScript project.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
