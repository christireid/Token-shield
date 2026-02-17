/**
 * token-shield — Vercel Edge Runtime example
 *
 * This shows token-shield running on the Edge runtime.
 * No Node-only APIs are used — fully Edge-compatible.
 *
 * Deploy as a Vercel Edge Function or use in middleware.ts.
 */

import { withShield, estimateCost } from "token-shield"

export const runtime = "edge"

// Create middleware once (persists across invocations in the same isolate)
const shieldMiddleware = withShield({
  cache: true,
  compression: true,
})

export default async function handler(req: Request): Promise<Response> {
  const { prompt } = await req.json() as { prompt: string }

  // Show cost estimation (works without any LLM call)
  const cost = estimateCost("gpt-4o", 1000, 500)

  // Transform params through shield
  const params = shieldMiddleware.transformParams!({
    params: { prompt, modelId: "gpt-4o" },
  })

  return new Response(
    JSON.stringify({
      message: "Edge handler with token-shield",
      costEstimate: cost,
      processedParams: params,
    }),
    { headers: { "Content-Type": "application/json" } },
  )
}
