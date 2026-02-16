/**
 * TokenShield — Composable Pipeline Example
 *
 * Demonstrates the pick-and-choose Pipeline API where you compose only the
 * stages you need, in the order you want, with lifecycle hooks for observability.
 *
 * The Pipeline API is an alternative to the full tokenShieldMiddleware() when
 * you want fine-grained control over which stages run and in what order.
 *
 * Run: npx tsx examples/composable-pipeline/index.ts
 */

import {
  createPipeline,
  createBreakerStage,
  createGuardStage,
  createCacheStage,
  createContextStage,
  createRouterStage,
  createPrefixStage,
  type PipelineContext,
} from "../../lib/tokenshield/pipeline"
import { CostCircuitBreaker } from "../../lib/tokenshield/circuit-breaker"
import { RequestGuard } from "../../lib/tokenshield/request-guard"
import { ResponseCache } from "../../lib/tokenshield/response-cache"

// -------------------------------------------------------
// 1. Initialize the modules you need
// -------------------------------------------------------

const breaker = new CostCircuitBreaker({
  hourlyLimit: 5, // $5/hour hard cap
  sessionLimit: 20, // $20/session
})

const guard = new RequestGuard({
  debounceMs: 200,
  maxRequestsPerMinute: 30,
  maxCostPerHour: 5,
  modelId: "gpt-4o-mini",
})

const cache = new ResponseCache({
  maxEntries: 200,
  ttlMs: 60 * 60 * 1000, // 1 hour
  similarityThreshold: 0.85,
})

// -------------------------------------------------------
// 2. Compose the pipeline — pick stages, set order
// -------------------------------------------------------

const pipeline = createPipeline(
  // Stage 1: Hard spending limit (breaker trips = instant block)
  createBreakerStage(breaker, { reserveForOutput: 500 }),
  // Stage 2: Rate limiting + dedup + cost gate
  createGuardStage(guard),
  // Stage 3: Semantic cache lookup (cache hit = skip model call)
  createCacheStage(cache),
  // Stage 4: Trim conversation to fit token budget
  createContextStage({ maxInputTokens: 4000, reserveForOutput: 1000 }),
  // Stage 5: Route to cheapest capable model
  createRouterStage([
    { modelId: "gpt-4o-mini", maxComplexity: 40 },
    { modelId: "gpt-4o", maxComplexity: 70 },
    { modelId: "claude-sonnet-4-5-20250929", maxComplexity: 100 },
  ]),
  // Stage 6: Reorder messages for provider prompt cache hits
  createPrefixStage("openai"),
)

// -------------------------------------------------------
// 3. Add lifecycle hooks for observability
// -------------------------------------------------------

pipeline.addHook({
  beforeStage(name, ctx) {
    if (ctx.aborted) return
    process.stdout.write(`  [${name}] running...`)
  },
  afterStage(name, ctx, ms) {
    console.log(` done (${ms}ms)`)
    // Log stage-specific metadata
    if (name === "cache" && ctx.meta.cacheHit) {
      console.log(`    -> CACHE HIT — skipping model call`)
    }
    if (name === "context" && ctx.meta.contextSaved) {
      console.log(`    -> trimmed ${ctx.meta.contextSaved} tokens`)
    }
    if (name === "router" && ctx.meta.originalModel) {
      console.log(`    -> routed: ${ctx.meta.originalModel} -> ${ctx.modelId}`)
    }
    if (name === "prefix" && ctx.meta.prefixSaved) {
      console.log(`    -> prefix savings: ${ctx.meta.prefixSaved} tokens`)
    }
  },
  onError(name, error) {
    console.error(`  [${name}] ERROR: ${error.message}`)
  },
})

// -------------------------------------------------------
// 4. Execute the pipeline
// -------------------------------------------------------

async function simulateRequest(prompt: string, label: string) {
  console.log(`\n--- ${label} ---`)
  console.log(`Prompt: "${prompt.substring(0, 60)}${prompt.length > 60 ? "..." : ""}"`)

  const ctx: PipelineContext = {
    params: {},
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: prompt },
    ],
    lastUserText: prompt,
    modelId: "gpt-4o",
    meta: {},
    aborted: false,
  }

  const result = await pipeline.execute(ctx)

  if (result.aborted) {
    if (result.abortReason === "cache-hit") {
      const hit = result.meta.cacheHit as { response: string }
      console.log(`Result: CACHE HIT -> "${hit.response.substring(0, 40)}..."`)
    } else {
      console.log(`Result: BLOCKED -> ${result.abortReason}`)
    }
  } else {
    console.log(`Result: PASS -> model=${result.modelId}`)
    console.log(`  Messages: ${result.messages.length}, Meta: ${JSON.stringify(result.meta)}`)
  }
}

async function main() {
  console.log("=== TokenShield Composable Pipeline Demo ===")
  console.log(`Stages: ${pipeline.getStageNames().join(" -> ")}`)

  // Request 1: Simple question — should route to gpt-4o-mini
  await simulateRequest("What is the capital of France?", "Request 1: Simple question")

  // Seed the cache for the next request
  await cache.store(
    "What is the capital of France?",
    "The capital of France is Paris.",
    "gpt-4o-mini",
    12,
    8,
  )

  // Request 2: Same question — should hit cache
  await simulateRequest("What is the capital of France?", "Request 2: Cache hit")

  // Request 3: Complex question — should stay on gpt-4o
  await simulateRequest(
    "Analyze the geopolitical implications of NATO expansion, considering historical precedents from the Cold War era and modern economic interdependencies.",
    "Request 3: Complex question",
  )

  // Show pipeline can be modified at runtime
  console.log("\n--- Dynamic Stage Removal ---")
  pipeline.removeStage("router")
  console.log(`Stages after removing router: ${pipeline.getStageNames().join(" -> ")}`)

  // Request 4: Without router, model stays as-is
  await simulateRequest("Tell me a joke.", "Request 4: No router (removed)")

  // Cleanup
  guard.dispose()
  await cache.clear()

  console.log("\n=== Demo Complete ===")
}

main().catch(console.error)
