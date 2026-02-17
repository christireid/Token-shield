/**
 * token-shield — Node.js basic example
 *
 * Demonstrates the core shield workflow: process, call LLM, record, check stats.
 *
 * Run: npx tsx index.ts
 */

import { createShield, estimateCost } from "token-shield"

const shield = createShield({
  cache: true,
  compression: true,
  costTracking: true,
})

// Simulate a few LLM requests
const prompts = [
  "What is TypeScript and why should I use it?",
  "Please kindly explain the benefits of TypeScript. It is important to note that I am a beginner. In order to understand, you should explain it simply.",
  "What is TypeScript and why should I use it?", // duplicate — should hit cache
]

for (const prompt of prompts) {
  const result = shield.process({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  })

  if (result.cached) {
    console.log(`[CACHE HIT] "${prompt.slice(0, 40)}..." → ${result.cached.matchType} match`)
  } else {
    console.log(`[CACHE MISS] "${prompt.slice(0, 40)}..."`)
    if (result.compressed) {
      console.log(`  Compression saved ${result.tokensSaved} tokens`)
    }

    // Simulate LLM response
    const response = `This is a simulated response for: ${prompt.slice(0, 30)}`
    shield.record({
      model: "gpt-4o",
      prompt,
      response,
      inputTokens: result.processedTokens || 20,
      outputTokens: 50,
    })
  }
}

// Print stats
console.log("\n--- Shield Stats ---")
const stats = shield.stats
console.log(`Requests: ${stats.requests}`)
console.log(`Cache hits: ${stats.cacheHits}`)
console.log(`Cache hit rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`)
console.log(`Compression tokens saved: ${stats.compressionTokensSaved}`)
console.log(`Total tokens saved: ${stats.totalTokensSaved}`)
console.log(`Estimated cost: $${stats.totalEstimatedCost.toFixed(6)}`)

// One-shot cost estimation
console.log("\n--- Cost Estimation ---")
const cost = estimateCost("gpt-4o", 1000, 500)
console.log(`gpt-4o: 1000 input + 500 output = $${cost.totalCost.toFixed(6)}`)

const unknown = estimateCost("my-custom-model", 1000, 500)
console.log(`Unknown model: known=${unknown.known}, cost=$${unknown.totalCost}`)
