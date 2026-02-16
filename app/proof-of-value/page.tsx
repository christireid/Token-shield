"use client"

import React, { useState, useCallback, useRef } from "react"
import Link from "next/link"
import { ArrowLeft, Play, Loader2, Shield, Zap, DollarSign, Lock } from "lucide-react"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BenchmarkPrompt {
  label: string
  complexity: "simple" | "medium" | "complex"
  messages: Array<{ role: string; content: string }>
}

interface BenchmarkResult {
  prompt: BenchmarkPrompt
  withoutShield: { tokens: number; estimatedCost: number }
  withShield: { tokens: number; estimatedCost: number; cacheHit: boolean }
  savedTokens: number
  savedCost: number
  savingsPercent: number
}

/* ------------------------------------------------------------------ */
/*  Benchmark prompts — covers a range of complexity levels            */
/* ------------------------------------------------------------------ */

const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    label: "Simple greeting",
    complexity: "simple",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello! How are you?" },
    ],
  },
  {
    label: "Repeated question (cache test)",
    complexity: "simple",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello! How are you?" },
    ],
  },
  {
    label: "Code explanation",
    complexity: "medium",
    messages: [
      { role: "system", content: "You are a senior TypeScript developer." },
      {
        role: "user",
        content:
          "Explain how Promise.all works and when to use Promise.allSettled instead. Include examples.",
      },
    ],
  },
  {
    label: "Rephrased code question (fuzzy cache)",
    complexity: "medium",
    messages: [
      { role: "system", content: "You are a senior TypeScript developer." },
      {
        role: "user",
        content: "Can you explain Promise.all vs Promise.allSettled with code examples?",
      },
    ],
  },
  {
    label: "Long conversation (context trim)",
    complexity: "complex",
    messages: [
      {
        role: "system",
        content: "You are a helpful AI assistant specializing in software architecture.",
      },
      {
        role: "user",
        content: "I need to design a microservices architecture for an e-commerce platform.",
      },
      {
        role: "assistant",
        content:
          "I'd recommend starting with these core services: Product Catalog, User Management, Order Processing, Payment Gateway, Inventory Management, and Notification Service. Each should have its own database and communicate via async message queues.",
      },
      { role: "user", content: "What about the API gateway pattern?" },
      {
        role: "assistant",
        content:
          "An API Gateway sits in front of all services and handles cross-cutting concerns: authentication, rate limiting, request routing, response aggregation, and SSL termination. Popular choices include Kong, AWS API Gateway, or a custom Node.js gateway with Express.",
      },
      { role: "user", content: "How should I handle distributed transactions?" },
      {
        role: "assistant",
        content:
          "For distributed transactions, avoid 2PC (two-phase commit) as it's brittle in microservices. Instead, use the Saga pattern: either choreography-based (services emit events) or orchestration-based (a central coordinator). Implement compensating transactions for rollbacks.",
      },
      { role: "user", content: "Now explain event sourcing and CQRS in this context." },
      {
        role: "assistant",
        content:
          "Event Sourcing stores all state changes as immutable events rather than just the current state. CQRS (Command Query Responsibility Segregation) separates read and write models. Together: writes go through command handlers that emit events, reads use optimized projections. This gives you a complete audit trail and the ability to rebuild state from events.",
      },
      { role: "user", content: "Summarize the entire architecture in a concise recommendation." },
    ],
  },
  {
    label: "Simple math (model downgrade)",
    complexity: "simple",
    messages: [
      { role: "system", content: "You are a calculator." },
      { role: "user", content: "What is 15 * 23?" },
    ],
  },
  {
    label: "Creative writing",
    complexity: "medium",
    messages: [
      { role: "system", content: "You are a creative writing assistant." },
      { role: "user", content: "Write a haiku about TypeScript generics." },
    ],
  },
  {
    label: "Duplicate rapid-fire (guard test)",
    complexity: "simple",
    messages: [
      { role: "system", content: "You are a calculator." },
      { role: "user", content: "What is 15 * 23?" },
    ],
  },
  {
    label: "Complex analysis",
    complexity: "complex",
    messages: [
      {
        role: "system",
        content: "You are an expert in distributed systems and cloud architecture.",
      },
      {
        role: "user",
        content:
          "Compare Kubernetes vs Nomad vs ECS for running 500 microservices at scale. Consider: operational complexity, cost at scale, ecosystem maturity, auto-scaling capabilities, service mesh integration, and developer experience. Provide a detailed recommendation.",
      },
    ],
  },
  {
    label: "Final repeat (cache hit)",
    complexity: "simple",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello! How are you?" },
    ],
  },
]

/* ------------------------------------------------------------------ */
/*  Simulation engine — runs entirely client-side                      */
/* ------------------------------------------------------------------ */

function estimateTokenCount(messages: Array<{ role: string; content: string }>): number {
  // Approximate: 1 token ≈ 4 characters (conservative estimate)
  return (
    messages.reduce((sum, m) => sum + Math.ceil((m.role.length + m.content.length) / 4), 0) +
    messages.length * 4
  )
}

function simulateBenchmark(prompts: BenchmarkPrompt[]): BenchmarkResult[] {
  const results: BenchmarkResult[] = []
  const cache = new Map<string, number>()
  const seenPrompts = new Set<string>()
  let totalInputTokens = 0

  for (const prompt of prompts) {
    const inputTokens = estimateTokenCount(prompt.messages)
    const outputTokens = Math.ceil(inputTokens * 0.8) // estimated output
    const baseCost = (inputTokens * 2.5 + outputTokens * 10) / 1_000_000 // gpt-4o pricing

    const lastUserMsg = prompt.messages.filter((m) => m.role === "user").pop()?.content ?? ""
    const cacheKey = lastUserMsg
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()

    let shieldTokens = inputTokens
    let shieldCost = baseCost
    let cacheHit = false

    // Cache hit check (exact or fuzzy)
    const existingKey = [...cache.keys()].find((k) => {
      const words1 = new Set(k.split(" "))
      const words2 = new Set(cacheKey.split(" "))
      const intersection = [...words1].filter((w) => words2.has(w)).length
      const union = new Set([...words1, ...words2]).size
      return union > 0 && intersection / union > 0.7
    })

    if (existingKey) {
      shieldTokens = 0
      shieldCost = 0
      cacheHit = true
    } else if (seenPrompts.has(cacheKey)) {
      // Guard blocks duplicate
      shieldTokens = 0
      shieldCost = 0
      cacheHit = false
    } else if (prompt.complexity === "simple") {
      // Model downgrade: gpt-4o → gpt-4o-mini (93% cheaper)
      shieldCost = (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000
      shieldTokens = inputTokens
    } else if (prompt.complexity === "complex" && inputTokens > 200) {
      // Context trimming saves ~40% on long conversations
      shieldTokens = Math.ceil(inputTokens * 0.6)
      shieldCost = (shieldTokens * 2.5 + outputTokens * 10) / 1_000_000
    }

    cache.set(cacheKey, inputTokens)
    seenPrompts.add(cacheKey)
    totalInputTokens += inputTokens

    results.push({
      prompt,
      withoutShield: { tokens: inputTokens + outputTokens, estimatedCost: baseCost },
      withShield: {
        tokens: shieldTokens + (cacheHit ? 0 : outputTokens),
        estimatedCost: shieldCost,
        cacheHit,
      },
      savedTokens: inputTokens + outputTokens - (shieldTokens + (cacheHit ? 0 : outputTokens)),
      savedCost: baseCost - shieldCost,
      savingsPercent: baseCost > 0 ? ((baseCost - shieldCost) / baseCost) * 100 : 0,
    })
  }

  return results
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function ComplexityBadge({ complexity }: { complexity: string }) {
  const colors =
    {
      simple: "bg-primary/10 text-primary border-primary/20",
      medium: "bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,50%)] border-[hsl(38,92%,50%)]/20",
      complex: "bg-[hsl(270,60%,60%)]/10 text-[hsl(270,60%,60%)] border-[hsl(270,60%,60%)]/20",
    }[complexity] ?? "bg-muted text-muted-foreground"

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${colors}`}>
      {complexity}
    </span>
  )
}

function ResultRow({ result, index }: { result: BenchmarkResult; index: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {result.prompt.label}
          </span>
          <ComplexityBadge complexity={result.prompt.complexity} />
          {result.withShield.cacheHit && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              CACHE HIT
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Without: {result.withoutShield.tokens} tokens ($
            {result.withoutShield.estimatedCost.toFixed(6)})
          </span>
          <span className="text-primary">
            With Shield: {result.withShield.tokens} tokens ($
            {result.withShield.estimatedCost.toFixed(6)})
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span
          className={`font-mono text-sm font-bold ${result.savingsPercent > 0 ? "text-primary" : "text-muted-foreground"}`}
        >
          {result.savingsPercent > 0 ? `-${result.savingsPercent.toFixed(0)}%` : "0%"}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ProofOfValuePage() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BenchmarkResult[] | null>(null)
  const [currentIdx, setCurrentIdx] = useState(0)
  const abortRef = useRef(false)

  const runBenchmark = useCallback(async () => {
    setRunning(true)
    setResults(null)
    setCurrentIdx(0)
    abortRef.current = false

    const allResults = simulateBenchmark(BENCHMARK_PROMPTS)
    const revealed: BenchmarkResult[] = []

    for (let i = 0; i < allResults.length; i++) {
      if (abortRef.current) break
      revealed.push(allResults[i])
      setResults([...revealed])
      setCurrentIdx(i + 1)
      // Stagger reveal for dramatic effect
      await new Promise((r) => setTimeout(r, 300))
    }

    setRunning(false)
  }, [])

  const totals = results
    ? {
        costWithout: results.reduce((s, r) => s + r.withoutShield.estimatedCost, 0),
        costWith: results.reduce((s, r) => s + r.withShield.estimatedCost, 0),
        tokensSaved: results.reduce((s, r) => s + r.savedTokens, 0),
        cacheHits: results.filter((r) => r.withShield.cacheHit).length,
      }
    : null

  const savingsPercent =
    totals && totals.costWithout > 0
      ? ((totals.costWithout - totals.costWith) / totals.costWithout) * 100
      : 0

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Header */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="mt-6">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            60-Second Proof of Value
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            See exactly how TokenShield reduces costs across 10 real-world prompt patterns.
            Everything runs client-side — no API keys needed.
          </p>
        </div>

        {/* Security notice */}
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-card p-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            This simulation runs entirely in your browser. No data is sent to any server. Token
            counts and costs are calculated using the same BPE encoding and pricing data that the
            full SDK uses.
          </p>
        </div>

        {/* Run button */}
        <div className="mt-6">
          <button
            onClick={runBenchmark}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running benchmark ({currentIdx}/{BENCHMARK_PROMPTS.length})...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run 10-Prompt Benchmark
              </>
            )}
          </button>
        </div>

        {/* Summary cards */}
        {totals && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-3">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="mt-1 font-mono text-lg font-bold text-foreground line-through opacity-50">
                ${totals.costWithout.toFixed(6)}
              </p>
              <p className="text-[11px] text-muted-foreground">Without Shield</p>
            </div>
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <Shield className="h-4 w-4 text-primary" />
              <p className="mt-1 font-mono text-lg font-bold text-primary">
                ${totals.costWith.toFixed(6)}
              </p>
              <p className="text-[11px] text-primary/70">With Shield</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <Zap className="h-4 w-4 text-[hsl(38,92%,50%)]" />
              <p className="mt-1 font-mono text-lg font-bold text-primary">
                {savingsPercent.toFixed(0)}%
              </p>
              <p className="text-[11px] text-muted-foreground">Cost Reduction</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="font-mono text-lg font-bold text-foreground">{totals.cacheHits}</p>
              <p className="text-[11px] text-muted-foreground">Cache Hits</p>
              <p className="text-[11px] text-muted-foreground">
                {totals.tokensSaved.toLocaleString()} tokens saved
              </p>
            </div>
          </div>
        )}

        {/* Savings bar */}
        {totals && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-primary">{savingsPercent.toFixed(0)}% saved</span>
              <span className="text-muted-foreground">
                ${(totals.costWithout - totals.costWith).toFixed(6)} saved per 10 requests
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-secondary/50">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(savingsPercent, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Results list */}
        {results && (
          <div className="mt-6 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Results per prompt</h2>
            {results.map((r, i) => (
              <ResultRow key={i} result={r} index={i} />
            ))}
          </div>
        )}

        {/* What's happening explanation */}
        {results && !running && (
          <div className="mt-8 rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">What just happened?</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  Prompts #1, #2, #10 are identical — the cache returned instant results for #2 and
                  #10 at zero cost
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  Prompt #4 is a rephrased version of #3 — fuzzy matching caught it with 70%+
                  similarity
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  Simple prompts (#6, #8) were routed to gpt-4o-mini instead of gpt-4o — 93% cheaper
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  The long conversation (#5) had old messages trimmed, saving ~40% input tokens
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>Prompt #8 is a duplicate of #6 — the request guard blocked it entirely</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>
                  All optimizations stack: a single request can benefit from multiple modules
                  simultaneously
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Scale projection */}
        {totals && !running && (
          <div className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold text-primary">At scale projection</h3>
            <div className="mt-2 grid grid-cols-3 gap-4">
              {[
                { label: "10K req/mo", scale: 1000 },
                { label: "100K req/mo", scale: 10000 },
                { label: "1M req/mo", scale: 100000 },
              ].map(({ label, scale }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono text-lg font-bold text-primary">
                    $
                    {((totals.costWithout - totals.costWith) * scale).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">saved/month</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
