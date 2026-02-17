/**
 * token-shield — Next.js App Router example
 *
 * This shows how to use withShield as Vercel AI SDK middleware
 * in a Next.js route handler.
 *
 * File: app/api/chat/route.ts (copy this into your Next.js app)
 */

// app/api/chat/route.ts
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { wrapLanguageModel } from "ai"
import { withShield } from "token-shield"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: withShield({
    cache: true,
    compression: true,
  }),
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model,
    messages,
  })

  return result.toDataStreamResponse()
}
