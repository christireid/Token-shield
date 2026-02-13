"use client"

import { useState, useMemo } from "react"

interface TestResult {
  module: string
  label: string
  without: { tokens: number; cost: number; calls: number }
  with: { tokens: number; cost: number; calls: number }
  saved: { tokens: number; cost: number; calls: number }
  proof: string
  raw?: Record<string, unknown>
}

function formatCost(n: number) {
  return n < 0.0001 && n > 0 ? `<$0.0001` : `$${n.toFixed(6)}`
}

export function SavingsDashboard({ results }: { results: TestResult[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const totals = useMemo(() => {
    const t = { costWithout: 0, costWith: 0, tokensSaved: 0, callsSaved: 0 }
    for (const r of results) {
      t.costWithout += r.without.cost
      t.costWith += r.with.cost
      t.tokensSaved += r.saved.tokens
      t.callsSaved += r.saved.calls
    }
    return {
      ...t,
      costSaved: t.costWithout - t.costWith,
      pctSaved: t.costWithout > 0 ? ((t.costWithout - t.costWith) / t.costWithout) * 100 : 0,
    }
  }, [results])

  if (results.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Summary bar */}
      <div className="border-b border-border p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">Total savings across all tests</p>
        <p className="mt-1 font-mono text-2xl font-bold text-primary">
          {formatCost(totals.costSaved)}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {totals.pctSaved.toFixed(1)}% reduction
          {" / "}
          {totals.tokensSaved.toLocaleString()} tokens saved
          {" / "}
          {totals.callsSaved} call{totals.callsSaved !== 1 ? "s" : ""} avoided
        </p>
      </div>

      {/* Per-test results */}
      <div className="divide-y divide-border">
        {results.map((r, i) => {
          const isOpen = expandedIdx === i
          return (
            <div key={`${r.module}-${i}`}>
              <button
                type="button"
                className="flex w-full min-h-[48px] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40 sm:px-5 sm:items-center"
                onClick={() => setExpandedIdx(isOpen ? null : i)}
                aria-expanded={isOpen}
              >
                <span className="mt-0.5 shrink-0 rounded bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground sm:mt-0">
                  {r.module}
                </span>
                <span className="flex-1 text-sm text-foreground leading-snug">{r.label}</span>
                <span className="shrink-0 flex items-center gap-2 sm:gap-3">
                  <span className="hidden font-mono text-xs text-muted-foreground line-through sm:inline">
                    {formatCost(r.without.cost)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-primary">
                    {formatCost(r.with.cost)}
                  </span>
                  <svg
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-border bg-background px-4 py-3 sm:px-5">
                  <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{r.proof}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-md bg-secondary p-2.5">
                      <p className="text-xs text-muted-foreground">Without Shield</p>
                      <p className="mt-0.5 font-mono text-sm text-foreground">
                        {r.without.tokens.toLocaleString()} tok
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{formatCost(r.without.cost)}</p>
                    </div>
                    <div className="rounded-md bg-secondary p-2.5">
                      <p className="text-xs text-muted-foreground">With Shield</p>
                      <p className="mt-0.5 font-mono text-sm text-primary">
                        {r.with.tokens.toLocaleString()} tok
                      </p>
                      <p className="font-mono text-xs text-primary">{formatCost(r.with.cost)}</p>
                    </div>
                    <div className="rounded-md bg-primary/10 p-2.5">
                      <p className="text-xs text-primary/80">Saved</p>
                      <p className="mt-0.5 font-mono text-sm font-semibold text-primary">
                        {r.saved.tokens.toLocaleString()} tok
                      </p>
                      <p className="font-mono text-xs font-semibold text-primary">{formatCost(r.saved.cost)}</p>
                    </div>
                  </div>
                  {r.raw && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Raw API response data
                      </summary>
                      <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-secondary p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                        {JSON.stringify(r.raw, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
