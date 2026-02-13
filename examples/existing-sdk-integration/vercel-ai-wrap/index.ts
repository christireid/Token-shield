import { openai } from "@ai-sdk/openai";
import { generateText, wrapLanguageModel } from "ai";
import { tokenShieldMiddleware } from "../../../lib/tokenshield/middleware";

// Mock environment
if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "mock-key";
}

// 1. Initialize TokenShield
const shield = tokenShieldMiddleware({
  modules: { cache: true, guard: true }
});

// 2. Wrap the model (The integration step)
const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: shield // TokenShield implements the Vercel AI SDK Middleware interface directly
});

async function main() {
  console.log("🚀 Starting TokenShield Integration Demo (Vercel AI SDK)\n");

  try {
    const start = Date.now();
    const { text } = await generateText({
      model,
      prompt: "Tell me a joke about distributed systems.",
    });

    console.log("Response:", text);
    console.log(`Latency: ${Date.now() - start}ms`);
  } catch (err) {
    console.error("Error executing Vercel AI SDK request:", (err as Error).message);
  }
}

if (require.main === module) {
  main();
}
