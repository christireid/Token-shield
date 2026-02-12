/**
 * TokenShield - Benchmark Scenarios & Test Data
 *
 * Contains prompt generators, expected results, and scenario definitions
 * used by the benchmark runner in benchmark.ts.
 */

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
import { bench, benchAsync, type BenchmarkResult } from "./benchmark"

// -------------------------------------------------------
// Text generators for benchmarks
// -------------------------------------------------------

export function generateWords(count: number): string {
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

export function generateChatMessages(count: number): ChatMessage[] {
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

export function generateContextMessages(count: number): Message[] {
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
