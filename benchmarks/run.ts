/**
 * token-shield — Benchmark suite
 *
 * Run: npx tsx benchmarks/run.ts
 * Output: benchmarks/results.json
 *
 * All benchmarks use synthetic data. No API calls are made.
 * Results vary by hardware — run on your target environment.
 */

import { createShield, semanticCache, promptCompression, estimateCost } from "../src/index"
import { writeFileSync } from "node:fs"

interface BenchmarkResult {
  name: string
  ops: number
  msPerOp: number
  runs: number
}

function bench(name: string, fn: () => void, runs = 10_000): BenchmarkResult {
  // Warmup
  for (let i = 0; i < 100; i++) fn()

  const start = performance.now()
  for (let i = 0; i < runs; i++) fn()
  const elapsed = performance.now() - start

  return {
    name,
    ops: Math.round(runs / (elapsed / 1000)),
    msPerOp: elapsed / runs,
    runs,
  }
}

function main() {
  const results: BenchmarkResult[] = []

  // 1. Cache lookup (hit)
  const cache = semanticCache({ maxEntries: 1000 })
  cache.store("What is TypeScript?", "TS is a typed superset of JS.", "gpt-4o", 10, 20)
  results.push(bench("cache.lookup (exact hit)", () => {
    cache.lookup("What is TypeScript?", "gpt-4o")
  }))

  // 2. Cache lookup (miss)
  results.push(bench("cache.lookup (miss)", () => {
    cache.lookup("How to cook pasta al dente?", "gpt-4o")
  }))

  // 3. Cache lookup (fuzzy hit)
  for (let i = 0; i < 50; i++) {
    cache.store(`Explain concept number ${i} in detail`, `Response ${i}`, "gpt-4o", 15, 25)
  }
  results.push(bench("cache.lookup (fuzzy, 50 entries)", () => {
    cache.lookup("Explain concept number 25 in details", "gpt-4o")
  }))

  // 4. Prompt compression (short)
  results.push(bench("promptCompression (short text)", () => {
    promptCompression("Please kindly explain TypeScript to me.")
  }))

  // 5. Prompt compression (verbose)
  const verbosePrompt = "Please kindly analyze the following text. It is important to note that the text contains several verbose phrases. In order to achieve the best results, you should carefully consider each and every word. Furthermore, it should be noted that the text is quite long and contains a significant amount of redundancy. Due to the fact that we need thorough analysis, please be very detailed."
  results.push(bench("promptCompression (verbose ~80 tokens)", () => {
    promptCompression(verbosePrompt)
  }))

  // 6. Cost estimation (known model)
  results.push(bench("estimateCost (known model)", () => {
    estimateCost("gpt-4o", 1000, 500)
  }))

  // 7. Cost estimation (unknown model)
  results.push(bench("estimateCost (unknown model)", () => {
    estimateCost("my-custom-model", 1000, 500)
  }))

  // 8. Full shield.process (cache miss + compression)
  const shield = createShield({ cache: true, compression: true })
  results.push(bench("shield.process (miss + compress)", () => {
    shield.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: verbosePrompt }],
    })
  }, 1_000))

  // 9. Full shield.process (cache hit)
  shield.record({
    model: "gpt-4o",
    prompt: "What is TypeScript?",
    response: "TS is...",
    inputTokens: 10,
    outputTokens: 20,
  })
  results.push(bench("shield.process (cache hit)", () => {
    shield.process({
      model: "gpt-4o",
      messages: [{ role: "user", content: "What is TypeScript?" }],
    })
  }))

  // Print results
  console.log("\n=== token-shield Benchmark Results ===\n")
  console.log(
    "Name".padEnd(45) +
    "ops/sec".padStart(12) +
    "ms/op".padStart(12)
  )
  console.log("-".repeat(69))

  for (const r of results) {
    console.log(
      r.name.padEnd(45) +
      r.ops.toLocaleString().padStart(12) +
      r.msPerOp.toFixed(4).padStart(12)
    )
  }

  // Write results.json
  const output = {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    results,
  }

  writeFileSync("benchmarks/results.json", JSON.stringify(output, null, 2))
  console.log("\nResults written to benchmarks/results.json")
}

main()
