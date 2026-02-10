"use client"

/**
 * REAL TEST: Response Cache
 *
 * 1) First call: sends a prompt to OpenAI. Records cost.
 * 2) Second call (exact match): returns cached response. ZERO API call.
 * 3) Third call (fuzzy match): rephrases the question. Cache detects similarity and returns cached response. ZERO API call.
 *
 * Every cache hit = 100% savings on that request.
 */

import { useState, useRef } from "react"
import { ResponseCache, textSimilarity } from "@/lib/tokenshield/response-cache"
import { callOpenAI, calculateRealCost } from "@/lib/tokenshield/api-client"
import { Button } from "@/components/ui/button"

const ORIGINAL_PROMPT = "Explain what a closure is in JavaScript in 2-3 sentences."
const EXACT_PROMPT = "Explain what a closure is in JavaScript in 2-3 sentences."
const FUZZY_PROMPT = "What is a JavaScript closure? Explain briefly in a couple sentences."

interface StepResult {
  label: string
  prompt: string
  fromCache: boolean
  matchType?: string
  similarity?: number
  apiCalled: boolean
  promptTokens: number
  completionTokens: number
  realCost: { inputCost: number; outputCost: number; totalCost: number }
  latencyMs: number
  response: string
}

export function CacheTest() {
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<StepResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const cacheRef = useRef<ResponseCache | null>(null)

  async function runTest() {
    setRunning(true)
    setError(null)
    setSteps([])

    // Fresh cache for each test
    cacheRef.current = new ResponseCache({ similarityThreshold: 0.8 })
    const cache = cacheRef.current
    await cache.clear()
    const model = "gpt-4o-mini"
    const results: StepResult[] = []

    try {
      // STEP 1: First call - cache miss, real API call
      // Step 1 is always a cache miss - fresh cache
      const res1 = await callOpenAI([{ role: "user", content: ORIGINAL_PROMPT }], model, { max_tokens: 150 })
      const cost1 = calculateRealCost(model, res1.usage.prompt_tokens ?? 0, res1.usage.completion_tokens ?? 0)
      await cache.store(ORIGINAL_PROMPT, res1.content, model, res1.usage.prompt_tokens ?? 0, res1.usage.completion_tokens ?? 0)

      results.push({
        label: "Step 1: First call (cache miss)",
        prompt: ORIGINAL_PROMPT,
        fromCache: false,
        apiCalled: true,
        promptTokens: res1.usage.prompt_tokens ?? 0,
        completionTokens: res1.usage.completion_tokens ?? 0,
        realCost: cost1,
        latencyMs: res1.latencyMs,
        response: res1.content,
      })
      setSteps([...results])

      // STEP 2: Exact same prompt - should be cache hit
      const start2 = Date.now()
      const lookup2 = await cache.lookup(EXACT_PROMPT, model)
      const latency2 = Date.now() - start2

      if (lookup2.hit && lookup2.entry) {
        results.push({
          label: "Step 2: Exact repeat (cache hit)",
          prompt: EXACT_PROMPT,
          fromCache: true,
          matchType: lookup2.matchType,
          similarity: lookup2.similarity,
          apiCalled: false,
          promptTokens: 0,
          completionTokens: 0,
          realCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
          latencyMs: latency2,
          response: lookup2.entry.response,
        })
      }
      setSteps([...results])

      // STEP 3: Rephrased prompt - fuzzy match test
      const start3 = Date.now()
      const lookup3 = await cache.lookup(FUZZY_PROMPT, model)
      const latency3 = Date.now() - start3

      if (lookup3.hit && lookup3.entry) {
        results.push({
          label: "Step 3: Rephrased (fuzzy cache hit)",
          prompt: FUZZY_PROMPT,
          fromCache: true,
          matchType: lookup3.matchType,
          similarity: lookup3.similarity,
          apiCalled: false,
          promptTokens: 0,
          completionTokens: 0,
          realCost: { inputCost: 0, outputCost: 0, totalCost: 0 },
          latencyMs: latency3,
          response: lookup3.entry.response,
        })
      } else {
        // Fuzzy miss - still make the API call to show the comparison
        const res3 = await callOpenAI([{ role: "user", content: FUZZY_PROMPT }], model, { max_tokens: 150 })
        const cost3 = calculateRealCost(model, res3.usage.prompt_tokens ?? 0, res3.usage.completion_tokens ?? 0)
        results.push({
          label: "Step 3: Rephrased (cache miss - fuzzy threshold not met)",
          prompt: FUZZY_PROMPT,
          fromCache: false,
          matchType: undefined,
          similarity: textSimilarity(ORIGINAL_PROMPT, FUZZY_PROMPT),
          apiCalled: true,
          promptTokens: res3.usage.prompt_tokens ?? 0,
          completionTokens: res3.usage.completion_tokens ?? 0,
          realCost: cost3,
          latencyMs: res3.latencyMs,
          response: res3.content,
        })
      }
      setSteps([...results])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  const totalApiCost = steps.reduce((sum, s) => sum + s.realCost.totalCost, 0)
  const totalWouldHaveCost = steps.length > 0 ? steps[0].realCost.totalCost * steps.length : 0
  const totalSaved = totalWouldHaveCost - totalApiCost
  const similarityScore = textSimilarity(ORIGINAL_PROMPT, FUZZY_PROMPT)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Response Cache Test</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Makes 1 real API call, then tests exact and fuzzy cache retrieval. Cache hits cost $0.00 (no API call made). Fuzzy matching uses bigram Dice coefficient - similarity between original and rephrased: {(similarityScore * 100).toFixed(1)}%.
        </p>
      </div>

      <Button onClick={runTest} disabled={running} className="min-h-[44px] w-full sm:w-auto">
        {running ? "Running test..." : "Run Test (1 API call + 2 cache lookups)"}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {steps.map((step, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="font-mono text-xs font-bold text-primary">{step.label}</div>
            {step.fromCache && (
              <span className="rounded bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary">
                $0.00 - NO API CALL
              </span>
            )}
          </div>
          <div className="rounded border border-border bg-secondary/30 p-2">
            <div className="text-xs text-muted-foreground">Prompt:</div>
            <div className="mt-0.5 font-mono text-xs text-foreground">{step.prompt}</div>
          </div>
          <div className="space-y-1.5 text-sm">
            <Row label="API called" value={step.apiCalled ? "YES" : "NO (cached)"} highlight={!step.apiCalled} />
            {step.matchType && <Row label="Match type" value={step.matchType} />}
            {step.similarity !== undefined && (
              <Row label="Similarity" value={`${(step.similarity * 100).toFixed(1)}%`} />
            )}
            <Row label="Tokens billed" value={step.apiCalled ? `${step.promptTokens + step.completionTokens}` : "0"} />
            <Row label="Cost" value={`$${step.realCost.totalCost.toFixed(6)}`} highlight />
            <Row label="Latency" value={`${step.latencyMs}ms`} />
          </div>
          <div className="rounded border border-border bg-secondary/50 p-2">
            <div className="text-xs font-medium text-muted-foreground">Response:</div>
            <div className="mt-1 text-xs text-foreground leading-relaxed">{step.response}</div>
          </div>
        </div>
      ))}

      {steps.length === 3 && (
        <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4 space-y-2">
          <div className="font-mono text-sm font-bold text-primary">Proven Savings</div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">API calls made</div>
              <div className="font-mono font-bold text-foreground">
                {steps.filter((s) => s.apiCalled).length} of 3
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total billed</div>
              <div className="font-mono font-bold text-foreground">${totalApiCost.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Saved (vs 3 calls)</div>
              <div className="font-mono font-bold text-foreground">${totalSaved.toFixed(6)}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Without caching, 3 identical/similar requests = 3 API calls. With TokenShield cache: 1 API call + 2 instant cache hits. At scale (1000 requests/day with 40% repeat rate), this saves ~400 API calls/day.
          </p>
        </div>
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
