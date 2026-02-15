# TokenShield AI SDK

**The Developer-First Alternative to AI Gateways.**  
Cut LLM costs 30-60% with a lightweight SDK. No API endpoint changes. No vendor lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@tokenshield/ai-sdk.svg)](https://www.npmjs.com/package/@tokenshield/ai-sdk)

---

## Why TokenShield?

Most cost optimization tools (like **Edgee** or **Helicone**) act as a **Gateway**: you have to change your API base URL to point to their servers. This introduces:

- ❌ **Vendor Lock-In:** If they go down, you go down. To leave, you must redeploy code.
- ❌ **Latency:** An extra network hop for every request (50-200ms).
- ❌ **Privacy Risk:** Your customer data flows through a third party.

**TokenShield is different.** It is a **Middleware SDK** that runs _inside_ your application.

- ✅ **Zero Lock-In:** Remove it by deleting 3 lines of code.
- ✅ **Zero Latency:** Caching and logic happen in-memory (<5ms).
- ✅ **Zero Privacy Risk:** Data never leaves your infrastructure.

### Comparison

| Feature            | TokenShield SDK            | Gateway (e.g., Edgee)       |
| :----------------- | :------------------------- | :-------------------------- |
| **Integration**    | `npm install` (Middleware) | Change API Base URL (Proxy) |
| **Latency**        | **< 5ms** (In-process)     | **50-200ms** (Network hop)  |
| **Vendor Lock-In** | **None** (It's just code)  | **High** (It's infra)       |
| **Budgeting**      | **Per-User / Tenant**      | Team / Workspace            |
| **Pricing**        | **Free (MIT)**             | Markup / Platform Fee       |

[Read the full competitive analysis →](docs/tokenshield-vs-edgee.md)

---

## Installation

```bash
npm install @tokenshield/ai-sdk
```

## Usage: 3 Lines of Code

TokenShield wraps your existing SDK. You don't need to learn a new API.

### Option 1: With OpenAI SDK

```typescript
import OpenAI from "openai"
import { tokenShieldMiddleware, createOpenAIAdapter } from "@tokenshield/ai-sdk"

// 1. Setup Middleware
const shield = tokenShieldMiddleware({ modules: { cache: true, guard: true } })

// 2. Wrap Client
const client = createOpenAIAdapter(shield, (p) => new OpenAI().chat.completions.create(p as any))

// 3. Use as normal (now with caching & cost control!)
const response = await client({
  messages: [{ role: "user", content: "Hello world" }],
  model: "gpt-4o",
})
```

### Option 2: With Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk"
import { tokenShieldMiddleware, createAnthropicAdapter } from "@tokenshield/ai-sdk"

const shield = tokenShieldMiddleware()
const client = createAnthropicAdapter(shield, (p) => new Anthropic().messages.create(p as any))

const msg = await client({
  messages: [{ role: "user", content: "Hello Claude" }],
  max_tokens: 1024,
})
```

### Option 3: With Vercel AI SDK

```typescript
import { openai } from "@ai-sdk/openai"
import { wrapLanguageModel } from "ai"
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: tokenShieldMiddleware(), // <-- Drop-in compatible
})
```

---

## Features

- **🛡️ Request Guard:** Rate limiting, deduplication, and cost velocity checks.
- **💾 Neuro-Elastic Cache:** Caches responses based on semantic similarity (Client-side, IndexedDB/Redis).
- **💰 Cost Ledger:** Real-time accounting of every token spent vs. saved.
- **⚡ Circuit Breaker:** Hard limits on hourly/daily spend to prevent bill shock.
- **👤 User Budget Manager:** Enforce limits on _your_ customers (e.g., "User A gets $5/mo").
- **📉 Model Router:** (Coming Soon) Automatically downgrade simple queries to cheaper models.

## Roadmap vs. Edgee

- [x] **Phase 1: Foundation (Now)** - No-lock-in middleware, caching, budgeting.
- [ ] **Phase 2: Observability** - Self-hosted dashboard components (React).
- [ ] **Phase 3: Enterprise** - Centralized policy server (optional, self-hostable).

## License

MIT © 2026 TokenShield AI.
