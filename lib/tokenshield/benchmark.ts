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
import {
  generateWords,
  generateChatMessages,
  generateContextMessages,
  runAllBenchmarks,
} from "./benchmark-scenarios"

// Re-export everything from benchmark-scenarios so that existing
// import paths (`from "./benchmark"`) continue to work unchanged.
export {
  generateWords,
  generateChatMessages,
  generateContextMessages,
  runAllBenchmarks,
}

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
