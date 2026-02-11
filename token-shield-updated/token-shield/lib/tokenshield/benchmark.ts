/**
 * TokenShield - Performance Benchmark Suite
 *
 * Benchmarks the real-world hot paths of the TokenShield SDK.
 * Runnable as a standalone script (tsx/ts-node) or importable as a module.
 *
 * Usage:
 *   npx tsx lib/tokenshield/benchmark.ts
 *
 * Or import and run selectively:
 *   import { bench, benchAsync, runAllBenchmarks, formatResults } from './benchmark'
 *   const results = await runAllBenchmarks()
 *   formatResults(results)
 */

import { performance } from "perf_hooks"
import { countExactTokens, countChatTokens, type ChatMessage } from "./token-counter"
import { estimateCost, compareCosts } from "./cost-estimator"
import { fitToBudget, smartFit, type Message, type ContextBudget } from "./context-manager"
import { ResponseCache } from "./response-cache"
import { analyzeComplexity, routeToModel } from "./model-router"
import { RequestGuard } from "./request-guard"
import { optimizePrefix } from "./prefix-optimizer"
import { tokenShieldMiddleware } from "./middleware"
import { CostCircuitBreaker } from "./circuit-breaker"
import { UserBudgetManager } from "./user-budget-manager"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface BenchmarkResult {
  /** Human-readable name of the benchmark */
  name: string
  /** Total number of operations executed */
  ops: number
  /** Operations per second */
  opsPerSec: number
  /** Average milliseconds per operation */
  avgMs: number
  /** 99th percentile milliseconds */
  p99Ms: number
}

// -------------------------------------------------------
// Benchmark runners
// -------------------------------------------------------

const DEFAULT_ITERATIONS = 1000

/**
 * Run a synchronous function N times and measure performance.
 * Uses performance.now() for sub-millisecond precision.
 */
export function bench(
  name: string,
  fn: () => void,
  iterations: number = DEFAULT_ITERATIONS
): BenchmarkResult {
  const timings: number[] = new Array(iterations)

  // Warmup: run a few times to let the JIT compile hot paths
  const warmupCount = Math.min(10, Math.floor(iterations / 10))
  for (let i = 0; i < warmupCount; i++) {
    fn()
  }

  // Measured run
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    timings[i] = performance.now() - start
  }

  return computeResult(name, timings, iterations)
}

/**
 * Run an async function N times and measure performance.
 * Each iteration awaits the result before starting the next.
 */
export async function benchAsync(
  name: string,
  fn: () => Promise<void>,
  iterations: number = DEFAULT_ITERATIONS
): Promise<BenchmarkResult> {
  const timings: number[] = new Array(iterations)

  // Warmup
  const warmupCount = Math.min(10, Math.floor(iterations / 10))
  for (let i = 0; i < warmupCount; i++) {
    await fn()
  }

  // Measured run
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    timings[i] = performance.now() - start
  }

  return computeResult(name, timings, iterations)
}

/**
 * Compute statistics from an array of timings.
 */
function computeResult(
  name: string,
  timings: number[],
  ops: number
): BenchmarkResult {
  // Sort for percentile calculation
  const sorted = timings.slice().sort((a, b) => a - b)
  const totalMs = sorted.reduce((sum, t) => sum + t, 0)
  const avgMs = totalMs / ops
  const p99Index = Math.min(Math.floor(ops * 0.99), ops - 1)
  const p99Ms = sorted[p99Index]
  const opsPerSec = avgMs > 0 ? 1000 / avgMs : Infinity

  return { name, ops, opsPerSec, avgMs, p99Ms }
}

// -------------------------------------------------------
// Text generators for benchmarks
// -------------------------------------------------------

function generateWords(count: number): string {
  const vocabulary = [
    "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
    "a", "simple", "test", "of", "token", "counting", "performance",
    "with", "various", "words", "that", "simulate", "real", "prompts",
    "for", "language", "model", "API", "calls", "including", "some",
    "technical", "vocabulary", "like", "transformer", "attention",
    "mechanism", "gradient", "descent", "backpropagation", "neural",
    "network", "embedding", "vector", "representation", "semantic",
    "analysis", "natural", "language", "processing", "inference",
  ]
  const words: string[] = []
  for (let i = 0; i < count; i++) {
    words.push(vocabulary[i % vocabulary.length])
  }
  return words.join(" ")
}

function generateChatMessages(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a helpful assistant that answers questions accurately." },
  ]
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant"
    messages.push({
      role,
      content: `This is message number ${i + 1} in the conversation. ${generateWords(20)}`,
    })
  }
  return messages
}

function generateContextMessages(count: number): Message[] {
  const messages: Message[] = [
    { role: "system", content: "You are a helpful assistant." },
  ]
  for (let i = 0; i < count; i++) {
    const role: Message["role"] = i % 2 === 0 ? "user" : "assistant"
    messages.push({
      role,
      content: `Turn ${i + 1}: ${generateWords(15)}`,
    })
  }
  return messages
}

// -------------------------------------------------------
// Main benchmark suite
// -------------------------------------------------------

/**
 * Run all benchmarks across the key hot paths of the TokenShield SDK.
 * Returns an array of BenchmarkResult objects.
 */
export async function runAllBenchmarks(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  // Pre-generate test data to avoid measuring allocation overhead
  const text10 = generateWords(10)
  const text100 = generateWords(100)
  const text1000 = generateWords(1000)
  const chatMessages5 = generateChatMessages(5)
  const chatMessages20 = generateChatMessages(20)
  const contextMessages10 = generateContextMessages(10)
  const contextMessages50 = generateContextMessages(50)
  const contextMessages100 = generateContextMessages(100)

  const simplePrompt = "What is the capital of France?"
  const complexPrompt =
    "Analyze the following contract for liability risks, compare the indemnification " +
    "clauses to Delaware corporate law precedent, evaluate the force majeure provisions " +
    "in light of recent case law, and provide a structured JSON output with risk scores " +
    "for each section. You must be precise and never omit relevant details."

  const budget: ContextBudget = {
    maxContextTokens: 4096,
    reservedForOutput: 1024,
  }

  const tightBudget: ContextBudget = {
    maxContextTokens: 1024,
    reservedForOutput: 256,
  }

  // ==========================================================
  // 1. Token Counting
  // ==========================================================

  results.push(
    bench("countExactTokens (10 words)", () => {
      countExactTokens(text10)
    })
  )

  results.push(
    bench("countExactTokens (100 words)", () => {
      countExactTokens(text100)
    })
  )

  results.push(
    bench("countExactTokens (1000 words)", () => {
      countExactTokens(text1000)
    })
  )

  results.push(
    bench("countChatTokens (5 messages)", () => {
      countChatTokens(chatMessages5)
    })
  )

  results.push(
    bench("countChatTokens (20 messages)", () => {
      countChatTokens(chatMessages20)
    })
  )

  // ==========================================================
  // 2. Cost Estimation
  // ==========================================================

  results.push(
    bench("estimateCost (gpt-4o)", () => {
      estimateCost("gpt-4o", 1000, 500)
    })
  )

  results.push(
    bench("estimateCost (claude-sonnet-4.5)", () => {
      estimateCost("claude-sonnet-4.5", 1000, 500)
    })
  )

  results.push(
    bench("compareCosts (all models)", () => {
      compareCosts(1000, 500)
    })
  )

  // ==========================================================
  // 3. Complexity Analysis
  // ==========================================================

  results.push(
    bench("analyzeComplexity (simple)", () => {
      analyzeComplexity(simplePrompt)
    })
  )

  results.push(
    bench("analyzeComplexity (complex)", () => {
      analyzeComplexity(complexPrompt)
    })
  )

  results.push(
    bench("routeToModel (simple prompt)", () => {
      routeToModel(simplePrompt, "gpt-4o")
    })
  )

  results.push(
    bench("routeToModel (complex prompt)", () => {
      routeToModel(complexPrompt, "gpt-4o")
    })
  )

  // ==========================================================
  // 4. Cache Operations (async - memory-only in Node.js)
  // ==========================================================

  const cache = new ResponseCache({
    maxEntries: 500,
    ttlMs: 3600000,
    similarityThreshold: 0.85,
  })

  // Pre-populate the cache with entries for lookup benchmarks
  for (let i = 0; i < 100; i++) {
    await cache.store(
      `cached prompt number ${i}: ${generateWords(10)}`,
      `This is the cached response for prompt ${i}.`,
      "gpt-4o",
      50,
      30
    )
  }

  results.push(
    await benchAsync("cache store", async () => {
      await cache.store(
        "benchmark prompt for store test",
        "benchmark response",
        "gpt-4o",
        100,
        50
      )
    })
  )

  results.push(
    await benchAsync("cache lookup (exact hit)", async () => {
      await cache.lookup("cached prompt number 42: " + generateWords(10), "gpt-4o")
    })
  )

  results.push(
    await benchAsync("cache lookup (miss)", async () => {
      await cache.lookup("this prompt is definitely not cached anywhere at all", "gpt-4o")
    })
  )

  results.push(
    await benchAsync("cache store + lookup cycle", async () => {
      const prompt = "round-trip cache benchmark prompt"
      await cache.store(prompt, "round-trip response", "gpt-4o", 80, 40)
      await cache.lookup(prompt, "gpt-4o")
    })
  )

  // ==========================================================
  // 5. Context Fitting
  // ==========================================================

  results.push(
    bench("fitToBudget (10 messages)", () => {
      fitToBudget(contextMessages10, budget)
    })
  )

  results.push(
    bench("fitToBudget (50 messages)", () => {
      fitToBudget(contextMessages50, budget)
    })
  )

  results.push(
    bench("fitToBudget (100 messages, tight)", () => {
      fitToBudget(contextMessages100, tightBudget)
    })
  )

  results.push(
    bench("smartFit (50 messages)", () => {
      smartFit(contextMessages50, budget)
    })
  )

  // ==========================================================
  // 6. Prefix Optimizer
  // ==========================================================

  const prefixMessages: ChatMessage[] = [
    { role: "system", content: "You are a helpful coding assistant. " + generateWords(200) },
    { role: "user", content: "How do I sort an array in JavaScript?" },
    { role: "assistant", content: "You can use Array.prototype.sort(). " + generateWords(50) },
    { role: "user", content: "Can you show me an example with numbers?" },
  ]

  results.push(
    bench("optimizePrefix (4 messages, openai)", () => {
      optimizePrefix(prefixMessages, "gpt-4o", 2.5)
    })
  )

  results.push(
    bench("optimizePrefix (4 messages, anthropic)", () => {
      optimizePrefix(prefixMessages, "claude-sonnet-4.5", 3.0, { provider: "anthropic" })
    })
  )

  // ==========================================================
  // 7. Request Guard
  // ==========================================================

  results.push(
    bench("RequestGuard.check", () => {
      // Create a fresh guard each time to avoid debounce/rate-limit blocking
      const guard = new RequestGuard({
        debounceMs: 0,
        maxRequestsPerMinute: 100000,
        maxCostPerHour: 100000,
        modelId: "gpt-4o-mini",
        deduplicateInFlight: false,
      })
      guard.check("What is the capital of France?", 500)
    })
  )

  // ==========================================================
  // 8. Circuit Breaker
  // ==========================================================

  const breaker = new CostCircuitBreaker({
    limits: { perSession: 100, perHour: 50, perDay: 200 },
    action: "stop",
    persist: false,
  })

  results.push(
    bench("CostCircuitBreaker.check", () => {
      breaker.check("gpt-4o", 1000, 500)
    })
  )

  results.push(
    bench("CostCircuitBreaker.recordSpend", () => {
      breaker.recordSpend(0.001, "gpt-4o")
    })
  )

  // ==========================================================
  // 9. User Budget Manager
  // ==========================================================

  const budgetManager = new UserBudgetManager({
    users: {
      "bench-user": { daily: 50, monthly: 500, tier: "standard" },
    },
    defaultBudget: { daily: 10, monthly: 100 },
    persist: false,
  })

  results.push(
    bench("UserBudgetManager.check", () => {
      budgetManager.check("bench-user", "gpt-4o", 1000, 500)
    })
  )

  results.push(
    bench("UserBudgetManager.getStatus", () => {
      budgetManager.getStatus("bench-user")
    })
  )

  // ==========================================================
  // 10. Middleware Pipeline (transformParams + wrapGenerate)
  // ==========================================================

  const mw = tokenShieldMiddleware({
    modules: {
      guard: false,    // Skip guard to avoid debounce blocking in tight loop
      cache: false,    // Skip cache to measure raw pipeline overhead
      context: true,
      router: false,
      prefix: true,
      ledger: false,
    },
    context: {
      maxInputTokens: 4096,
      reserveForOutput: 1024,
    },
  })

  const aiSdkParams = {
    modelId: "gpt-4o",
    prompt: [
      {
        role: "system",
        content: [{ type: "text", text: "You are a helpful assistant." }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "Explain quantum computing in simple terms." }],
      },
    ],
  }

  results.push(
    await benchAsync("middleware transformParams", async () => {
      await mw.transformParams({ params: { ...aiSdkParams } })
    })
  )

  const transformedParams = await mw.transformParams({ params: { ...aiSdkParams } })

  results.push(
    await benchAsync("middleware wrapGenerate", async () => {
      await mw.wrapGenerate({
        params: transformedParams,
        doGenerate: async () => ({
          text: "Quantum computing uses qubits instead of classical bits.",
          usage: { promptTokens: 25, completionTokens: 10 },
          finishReason: "stop",
        }),
      })
    })
  )

  results.push(
    await benchAsync("middleware full pipeline", async () => {
      const params = await mw.transformParams({ params: { ...aiSdkParams } })
      await mw.wrapGenerate({
        params,
        doGenerate: async () => ({
          text: "A short response.",
          usage: { promptTokens: 20, completionTokens: 5 },
          finishReason: "stop",
        }),
      })
    })
  )

  return results
}

// -------------------------------------------------------
// Result formatting
// -------------------------------------------------------

/**
 * Print a formatted table of benchmark results to stdout.
 */
export function formatResults(results: BenchmarkResult[]): void {
  // Compute column widths
  const nameWidth = Math.max(
    "Benchmark".length,
    ...results.map((r) => r.name.length)
  )
  const opsWidth = 8
  const opsSecWidth = 14
  const avgWidth = 12
  const p99Width = 12

  const pad = (s: string, w: number, align: "left" | "right" = "left") => {
    if (align === "right") return s.padStart(w)
    return s.padEnd(w)
  }

  const separator = "-".repeat(nameWidth + opsWidth + opsSecWidth + avgWidth + p99Width + 16)

  console.log("")
  console.log("TokenShield Performance Benchmark")
  console.log(separator)
  console.log(
    `${pad("Benchmark", nameWidth)}  ${pad("Ops", opsWidth, "right")}  ${pad("Ops/sec", opsSecWidth, "right")}  ${pad("Avg (ms)", avgWidth, "right")}  ${pad("P99 (ms)", p99Width, "right")}`
  )
  console.log(separator)

  let currentSection = ""

  for (const r of results) {
    // Detect section changes by checking for known prefixes
    const section = detectSection(r.name)
    if (section !== currentSection) {
      currentSection = section
      if (currentSection) {
        console.log("")
        console.log(`  ${currentSection}`)
        console.log(`  ${"-".repeat(currentSection.length)}`)
      }
    }

    const opsStr = r.ops.toLocaleString()
    const opsSecStr = r.opsPerSec === Infinity ? "Infinity" : formatNumber(r.opsPerSec)
    const avgStr = r.avgMs < 0.001 ? "<0.001" : r.avgMs.toFixed(4)
    const p99Str = r.p99Ms < 0.001 ? "<0.001" : r.p99Ms.toFixed(4)

    console.log(
      `${pad(r.name, nameWidth)}  ${pad(opsStr, opsWidth, "right")}  ${pad(opsSecStr, opsSecWidth, "right")}  ${pad(avgStr, avgWidth, "right")}  ${pad(p99Str, p99Width, "right")}`
    )
  }

  console.log(separator)
  console.log(`  Total benchmarks: ${results.length}`)
  console.log("")
}

function detectSection(name: string): string {
  if (name.startsWith("countExactTokens") || name.startsWith("countChatTokens")) return "Token Counting"
  if (name.startsWith("estimateCost") || name.startsWith("compareCosts")) return "Cost Estimation"
  if (name.startsWith("analyzeComplexity") || name.startsWith("routeToModel")) return "Complexity Analysis & Routing"
  if (name.startsWith("cache")) return "Response Cache"
  if (name.startsWith("fitToBudget") || name.startsWith("smartFit")) return "Context Fitting"
  if (name.startsWith("optimizePrefix")) return "Prefix Optimizer"
  if (name.startsWith("RequestGuard")) return "Request Guard"
  if (name.startsWith("CostCircuitBreaker")) return "Circuit Breaker"
  if (name.startsWith("UserBudgetManager")) return "User Budget Manager"
  if (name.startsWith("middleware")) return "Middleware Pipeline"
  return ""
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}

// -------------------------------------------------------
// Standalone execution
// -------------------------------------------------------

const isMainModule =
  typeof require !== "undefined" && require.main === module ||
  typeof process !== "undefined" && process.argv[1] && (
    process.argv[1].endsWith("benchmark.ts") ||
    process.argv[1].endsWith("benchmark.js")
  )

if (isMainModule) {
  runAllBenchmarks()
    .then((results) => {
      formatResults(results)
    })
    .catch((err) => {
      console.error("Benchmark failed:", err)
      process.exit(1)
    })
}
