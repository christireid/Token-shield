# Add TokenShield to Your Existing SDK

**Time Estimate:** 5 minutes  
**Prerequisites:** An existing Node.js application using OpenAI, Anthropic, or Vercel AI SDK.

---

## Why this guide?

Unlike gateway solutions (like Edgee) that require you to change your API endpoints, DNS settings, and environment variables, **TokenShield is just a library**.

You import it, wrap your existing client, and you're done. If you don't like it, you delete the wrapper and you're back to standard direct-to-provider calls.

| Method                | Integration Effort                           | Vendor Lock-In                   |
| :-------------------- | :------------------------------------------- | :------------------------------- |
| **Edgee (Gateway)**   | High (Change base URL, potential DNS config) | High (Infrastructure dependency) |
| **TokenShield (SDK)** | **Low (3 lines of code)**                    | **None (Pure middleware)**       |

---

## Option 1: Adding to OpenAI SDK

If you use the official `openai` npm package.

### 1. Install TokenShield

```bash
npm install @tokenshield/ai-sdk
```

### 2. Wrap your client

```typescript
import OpenAI from "openai"
import { tokenShieldMiddleware, createOpenAIAdapter } from "@tokenshield/ai-sdk"

// 1. Initialize your existing client as usual
const rawClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 2. Configure TokenShield (3 lines)
const shield = tokenShieldMiddleware({
  modules: { cache: true, guard: true }, // Enable Caching + Rate Limiting
})

// 3. Create the shielded client (3 lines)
const openai = createOpenAIAdapter(shield, (p) => rawClient.chat.completions.create(p as any), {
  defaultModel: "gpt-4o",
})

// usage is identical to standard SDK
const response = await openai({
  messages: [{ role: "user", content: "Hello world" }],
})
```

[View Full Example Code](../examples/existing-sdk-integration/openai-wrap/index.ts)

---

## Option 2: Adding to Anthropic SDK

If you use the official `@anthropic-ai/sdk` package.

### 1. Install TokenShield

```bash
npm install @tokenshield/ai-sdk
```

### 2. Wrap your client

```typescript
import Anthropic from "@anthropic-ai/sdk"
import { tokenShieldMiddleware, createAnthropicAdapter } from "@tokenshield/ai-sdk"

// 1. Initialize your existing client
const rawClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 2. Configure TokenShield
const shield = tokenShieldMiddleware({
  modules: { cache: true, guard: true },
})

// 3. Create the shielded client
const anthropic = createAnthropicAdapter(shield, (p) => rawClient.messages.create(p as any), {
  defaultModel: "claude-3-opus-20240229",
})

// usage is identical
const msg = await anthropic({
  messages: [{ role: "user", content: "Hello Claude" }],
  max_tokens: 1024,
})
```

[View Full Example Code](../examples/existing-sdk-integration/anthropic-wrap/index.ts)

---

## Option 3: Adding to Vercel AI SDK

TokenShield implements the Vercel AI SDK Middleware interface natively.

### 1. Install TokenShield

```bash
npm install @tokenshield/ai-sdk
```

### 2. Wrap your model

```typescript
import { openai } from "@ai-sdk/openai"
import { wrapLanguageModel } from "ai"
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

// 1. Configure TokenShield
const shield = tokenShieldMiddleware({
  modules: { cache: true, guard: true },
})

// 2. Wrap the model
const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: shield, // <-- Just pass it here!
})

// 3. Use 'model' everywhere in your app
```

[View Full Example Code](../examples/existing-sdk-integration/vercel-ai-wrap/index.ts)

---

## Verification: Did it work?

Once integrated, your console will show no changes, but your **TokenShield Ledger** will start accumulating savings.

To see immediate proof, run the same request twice.

1. **First Request:** ~800ms (Live API Call)
2. **Second Request:** ~2ms (Served from TokenShield Cache)

**You just saved money without changing your infrastructure.**
