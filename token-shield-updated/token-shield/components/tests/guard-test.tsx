"use client"

/**
 * REAL TEST: Request Guard
 *
 * Simulates rapid-fire button mashing. Without the guard, each click
 * would be a real API call. With the guard, only the last one goes through.
 *
 * This test actually fires the requests (or blocks them) and shows
 * exactly how many API calls were made vs blocked.
 */

import { useState, useRef } from "react"
import { RequestGuard } from "@/lib/tokenshield/request-guard"
import { callOpenAI, calculateRealCost } from "@/lib/tokenshield/api-client"

import { Button } from "@/components/ui/button"

interface ClickLog {
  index: number
  timestamp: number
  allowed: boolean
  reason?: string
  estimatedCost: number
}

interface GuardTestResult {
  withoutGuard: {
    apiCallsMade: number
    totalCost: number
    totalTokens: number
  }
  withGuard: {
    apiCallsMade: number
    totalCost: number
    blocked: number
    blockedCost: number
    clickLog: ClickLog[]
  }
}

const TEST_PROMPT = "What is 2 + 2? Answer in one word."

export function GuardTest() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<GuardTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runTest() {
    setRunning(true)
    setError(null)
    setResult(null)

    const model = "gpt-4o-mini"

    try {
      // PART A: Without guard - simulate 5 rapid clicks = 5 real API calls
      const unguardedCalls = await Promise.all(
        Array.from({ length: 5 }, () =>
          callOpenAI([{ role: "user", content: TEST_PROMPT }], model, { max_tokens: 10 })
        )
      )

      let totalUnguardedCost = 0
      let totalUnguardedTokens = 0
      for (const res of unguardedCalls) {
        const cost = calculateRealCost(model, res.usage.prompt_tokens, res.usage.completion_tokens)
        totalUnguardedCost += cost.totalCost
        totalUnguardedTokens += res.usage.total_tokens
      }

      // PART B: With guard - simulate 5 rapid clicks with debounce
      const guard = new RequestGuard({
        debounceMs: 200,
        maxRequestsPerMinute: 30,
        maxCostPerHour: 5.0,
        modelId: model,
        deduplicateInFlight: true,
      })

      const clickLog: ClickLog[] = []
      let guardedCallsMade = 0
      let guardedTotalCost = 0
      let blockedCost = 0

      // Simulate 5 clicks 50ms apart (faster than 200ms debounce)
      for (let i = 0; i < 5; i++) {
        const check = guard.check(TEST_PROMPT)
        clickLog.push({
          index: i + 1,
          timestamp: Date.now(),
          allowed: check.allowed,
          reason: check.reason,
          estimatedCost: check.estimatedCost,
        })

        if (check.allowed) {
          const res = await callOpenAI([{ role: "user", content: TEST_PROMPT }], model, { max_tokens: 10 })
          const cost = calculateRealCost(model, res.usage.prompt_tokens, res.usage.completion_tokens)
          guardedTotalCost += cost.totalCost
          guardedCallsMade++
          guard.completeRequest(TEST_PROMPT, res.usage.prompt_tokens, res.usage.completion_tokens)
        } else {
          blockedCost += check.estimatedCost
        }

        // Simulate rapid clicking - 50ms gap (under the 200ms debounce)
        if (i < 4) {
          await new Promise((r) => setTimeout(r, 50))
        }
      }

      setResult({
        withoutGuard: {
          apiCallsMade: 5,
          totalCost: totalUnguardedCost,
          totalTokens: totalUnguardedTokens,
        },
        withGuard: {
          apiCallsMade: guardedCallsMade,
          totalCost: guardedTotalCost,
          blocked: 5 - guardedCallsMade,
          blockedCost,
          clickLog,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  const savings = result
    ? {
        callsSaved: result.withoutGuard.apiCallsMade - result.withGuard.apiCallsMade,
        costSaved: result.withoutGuard.totalCost - result.withGuard.totalCost,
        percentSaved: result.withoutGuard.totalCost > 0
          ? ((result.withoutGuard.totalCost - result.withGuard.totalCost) / result.withoutGuard.totalCost * 100)
          : 0,
      }
    : null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Request Guard Test</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Simulates 5 rapid clicks (50ms apart). Without the guard: 5 real API calls billed. With the guard (200ms debounce): only the first goes through, the rest are blocked. Shows exact cost difference from OpenAI{"'"}s usage data.
        </p>
      </div>

      <Button onClick={runTest} disabled={running} className="min-h-[44px] w-full sm:w-auto">
        {running ? "Running test (5 + guarded calls)..." : "Run Test (5 unguarded + guarded calls)"}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {result && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="font-mono text-xs font-bold text-destructive">Without Guard (5 clicks = 5 API calls)</div>
              <div className="space-y-1.5 text-sm">
                <Row label="API calls made" value="5" />
                <Row label="Total tokens billed" value={result.withoutGuard.totalTokens.toLocaleString()} />
                <Row label="Total cost" value={`$${result.withoutGuard.totalCost.toFixed(6)}`} highlight />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div className="font-mono text-xs font-bold text-primary">With Guard (5 clicks, debounced)</div>
              <div className="space-y-1.5 text-sm">
                <Row label="API calls made" value={result.withGuard.apiCallsMade.toString()} />
                <Row label="Requests blocked" value={result.withGuard.blocked.toString()} />
                <Row label="Total cost" value={`$${result.withGuard.totalCost.toFixed(6)}`} highlight />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="font-mono text-xs font-bold text-muted-foreground">Click-by-click log</div>
            <div className="space-y-1">
              {result.withGuard.clickLog.map((click) => (
                <div
                  key={click.index}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-mono ${click.allowed ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}
                >
                  <span>Click {click.index}:</span>
                  <span className="font-bold">{click.allowed ? "ALLOWED" : "BLOCKED"}</span>
                  {click.reason && (
                    <span className="text-muted-foreground">- {click.reason}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {savings && (
            <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4 space-y-2">
              <div className="font-mono text-sm font-bold text-primary">Proven Savings</div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-muted-foreground">API calls saved</div>
                  <div className="font-mono font-bold text-foreground">{savings.callsSaved} of 5</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Cost saved</div>
                  <div className="font-mono font-bold text-foreground">${savings.costSaved.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">% saved</div>
                  <div className="font-mono font-bold text-foreground">{savings.percentSaved.toFixed(1)}%</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                In production with impatient users double-clicking, auto-submit on keystroke, or retry loops, this compounds fast. 80% block rate on a 10k requests/day app = 8000 free requests.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${highlight ? "font-bold text-primary" : "text-foreground"}`}>{value}</span>
    </div>
  )
}
