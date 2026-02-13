import Anthropic from "@anthropic-ai/sdk";
import { tokenShieldMiddleware } from "../../../lib/tokenshield/middleware";
import { createAnthropicAdapter } from "../../../lib/tokenshield/adapters";

// Mock environment
if (!process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = "mock-key";
}

// 1. Initialize existing client
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 2. Initialize TokenShield
const shield = tokenShieldMiddleware({
  modules: { cache: true, guard: true }
});

// 3. Wrap the create function
const shieldedMessages = createAnthropicAdapter(
  shield,
  (params) => client.messages.create(params as any),
  { defaultModel: "claude-3-opus-20240229" }
);

async function main() {
  console.log("🚀 Starting TokenShield Integration Demo (Anthropic)\n");

  try {
    const start = Date.now();
    const message = await shieldedMessages({
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello, Claude" }],
      model: "claude-3-opus-20240229",
    });
    
    console.log("Response:", (message.content[0] as any).text);
    console.log(`Latency: ${Date.now() - start}ms`);
  } catch (err) {
    console.error("Error executing Anthropic request:", (err as Error).message);
  }
}

if (require.main === module) {
  main();
}
