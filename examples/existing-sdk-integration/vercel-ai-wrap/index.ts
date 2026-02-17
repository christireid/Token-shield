import { openai } from "@ai-sdk/openai"
import { generateText, wrapLanguageModel } from "ai"
import { shield } from "../../../lib/tokenshield/shield"

// Mock environment
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "mock-key"
}

// 1. Create shield middleware (zero-config)
const middleware = shield()

// 2. Wrap the model
const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware,
})

async function main() {
  console.log("Starting TokenShield Integration Demo (Vercel AI SDK)\n")

  try {
    const start = Date.now()
    const { text } = await generateText({
      model,
      prompt: "Tell me a joke about distributed systems.",
    })

    console.log("Response:", text)
    console.log(`Latency: ${Date.now() - start}ms`)
  } catch (err) {
    console.error("Error executing Vercel AI SDK request:", (err as Error).message)
  }
}

main()
