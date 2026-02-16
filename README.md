# TokenShield AI SDK

Client-side TypeScript middleware that reduces LLM API costs through caching, model routing, and budget enforcement. Works with Vercel AI SDK, OpenAI, and Anthropic.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Status: v0.5.0 (pre-release)** — API may change before v1.0. Not yet published to npm.

---

## What It Does

TokenShield runs **inside your application** as middleware — not as a proxy or gateway. It intercepts LLM calls and applies cost optimizations before they reach the provider.

| Module               | What It Does                                                                                      | Typical Impact                                                  |
| :------------------- | :------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------- |
| **Response Cache**   | Caches responses by prompt similarity. Identical or near-identical prompts skip the API entirely. | High for repetitive workloads, near-zero for unique prompts     |
| **Model Router**     | Routes simple prompts to cheaper models based on complexity scoring.                              | Depends on prompt mix — helps most when many prompts are simple |
| **Prefix Optimizer** | Reorders messages to maximize provider-side prompt cache hits (OpenAI, Anthropic).                | Varies by provider and conversation structure                   |
| **Context Manager**  | Trims conversation history to fit token budgets.                                                  | Prevents over-budget calls on long conversations                |
| **Request Guard**    | Debounces, deduplicates, and rate-limits requests.                                                | Prevents accidental duplicate API calls                         |
| **Cost Ledger**      | Tracks every dollar spent vs. saved with per-module attribution.                                  | Visibility (no direct savings)                                  |
| **Circuit Breaker**  | Hard spending limits (per-hour, per-day, per-month).                                              | Bill shock prevention                                           |

**Honest expectations:** Actual savings depend entirely on your workload. Cache-heavy applications (customer support, FAQ bots) may see 20-40% savings. Applications with mostly unique prompts (creative writing, code generation) will see minimal cache benefit. Model routing helps only if a significant portion of your prompts are simple enough for cheaper models.

We don't publish ROI projections because they're impossible to predict without knowing your specific usage patterns. Install it, enable the cost ledger, and measure your own savings.

---

## 3-Line Integration

### With Vercel AI SDK

```typescript
import { openai } from "@ai-sdk/openai"
import { wrapLanguageModel } from "ai"
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: tokenShieldMiddleware(),
})
```

### With OpenAI SDK

```typescript
import OpenAI from "openai"
import { tokenShieldMiddleware, createOpenAIAdapter } from "@tokenshield/ai-sdk"

const shield = tokenShieldMiddleware()
const client = createOpenAIAdapter(shield, (p) => new OpenAI().chat.completions.create(p as any))
```

### With Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk"
import { tokenShieldMiddleware, createAnthropicAdapter } from "@tokenshield/ai-sdk"

const shield = tokenShieldMiddleware()
const client = createAnthropicAdapter(shield, (p) => new Anthropic().messages.create(p as any))
```

---

## Why Middleware Instead of a Gateway?

Most LLM cost tools (Helicone, Portkey) are API gateways — you route traffic through their servers.

|                  | TokenShield              | Gateway (Helicone, etc.)     |
| :--------------- | :----------------------- | :--------------------------- |
| **Architecture** | In-process middleware    | Network proxy                |
| **Latency**      | < 5ms overhead           | 50-200ms per request         |
| **Lock-In**      | Delete 3 lines to remove | Redeploy infrastructure      |
| **Data Privacy** | Data stays in your infra | Data flows through 3rd party |

**What gateways do better:** Server-side observability, team dashboards, managed infrastructure. TokenShield is client-side only — it can't provide centralized logging or dashboards across a team without additional infrastructure.

---

## Configuration

```typescript
tokenShieldMiddleware({
  modules: {
    guard: true, // Rate limiting, dedup, cost gate
    cache: true, // Semantic response caching
    context: true, // Conversation trimming
    router: true, // Complexity-based model routing
    prefix: true, // Provider cache optimization
    ledger: true, // Cost tracking
  },
  guard: {
    debounceMs: 300,
    maxRequestsPerMinute: 60,
    maxCostPerHour: 10,
  },
  cache: {
    maxEntries: 500,
    ttlMs: 3_600_000,
    similarityThreshold: 0.85,
  },
  router: {
    tiers: [
      { modelId: "gpt-4.1-nano", maxComplexity: 20 },
      { modelId: "gpt-4.1-mini", maxComplexity: 50 },
      { modelId: "gpt-4o", maxComplexity: 100 },
    ],
  },
  breaker: {
    limits: { perHour: 5, perDay: 50, perMonth: 500 },
    action: "stop",
  },
  // Dry-run mode: see what TokenShield would do without affecting behavior
  dryRun: false,
  onDryRun: (action) => console.log(`[dry-run] ${action.module}: ${action.description}`),
  onUsage: (entry) =>
    console.log(`$${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`),
})
```

See [QUICKSTART.md](QUICKSTART.md) for the full configuration reference.

---

## React Integration

```typescript
import { TokenShieldProvider, useSavings, useBudgetAlert } from "@tokenshield/ai-sdk";

function App() {
  return (
    <TokenShieldProvider defaultModelId="gpt-4o">
      <Dashboard />
    </TokenShieldProvider>
  );
}

function Dashboard() {
  const { totalSaved, savingsRate } = useSavings();
  const { isOverBudget } = useBudgetAlert(10); // $10 alert

  return (
    <div>
      <p>Saved: ${totalSaved.toFixed(2)} ({(savingsRate * 100).toFixed(0)}%)</p>
      {isOverBudget && <p>Budget exceeded!</p>}
    </div>
  );
}
```

---

## Runtime Compatibility

| Environment            | Caching                    | All Features                 |
| :--------------------- | :------------------------- | :--------------------------- |
| **Browser**            | IndexedDB (persistent)     | Full support                 |
| **Node.js**            | In-memory (per-process)    | Full support                 |
| **Vercel Edge**        | In-memory (per-invocation) | Full support, no persistence |
| **Cloudflare Workers** | In-memory (per-invocation) | Full support, no persistence |

TokenShield automatically falls back to in-memory storage when IndexedDB is unavailable. No configuration needed.

---

## Known Limitations

- **Not yet on npm** — install from source or git until published
- **Client-side only** — no centralized team dashboards or cross-instance cache sharing
- **Model routing quality is unvalidated** — complexity scoring uses heuristics, not ML. Use the `dryRun` mode or `abTestHoldback` option to compare routed vs. unrouted quality before relying on it
- **Cache only helps with repetitive prompts** — unique prompts get no cache benefit
- **Single maintainer** — bus factor of 1

---

## Security

TokenShield is a client-side SDK. Your API keys and data never leave your infrastructure. No telemetry, no phone-home, no third-party data sharing.

See [SECURITY.md](SECURITY.md) for the full trust model.

---

## Installation

> **Note:** Not yet published to npm. Clone the repo and build from source.

```bash
git clone https://github.com/tokenshield/ai-sdk.git
cd ai-sdk
npm install && npm run build
```

**Peer dependencies** (optional):

- `ai >= 3.0.0` — For Vercel AI SDK middleware
- `react >= 18.0.0` — For React hooks and dashboard

---

## Documentation

- [Quick Start Guide](QUICKSTART.md) — Full configuration reference
- [Security & Trust Model](SECURITY.md) — How data flows
- [Changelog](CHANGELOG.md) — Version history

---

## License

MIT &copy; 2026 Code&Clarity. See [LICENSE](LICENSE) for details.
