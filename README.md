# TokenShield AI SDK

**Companies using LLM APIs waste 30-60% of their spend on redundant calls, expensive models for simple queries, and missed caching opportunities.** TokenShield recovers that money with 3 lines of code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@tokenshield/ai-sdk.svg)](https://www.npmjs.com/package/@tokenshield/ai-sdk)
[![Tests](https://img.shields.io/badge/tests-822%20passed-brightgreen)](./lib/tokenshield)

---

## How Much Are You Wasting?

| Monthly LLM Spend | Estimated Waste | TokenShield Savings | ROI at $29/mo |
| :--- | :--- | :--- | :--- |
| $5,000 | $1,500 - $3,000 | $1,200 - $2,400/mo | **41x - 83x** |
| $25,000 | $7,500 - $15,000 | $6,000 - $12,000/mo | **207x - 414x** |
| $100,000 | $30,000 - $60,000 | $24,000 - $48,000/mo | **828x - 1,655x** |

*Based on measured savings from response caching (10-15%), model routing (20-30%), prefix optimization (15-25%), context trimming (10-15%), and request deduplication (3-5%).*

---

## 3-Line Integration

TokenShield runs **inside your application** as middleware. No proxy servers, no URL changes, no vendor lock-in.

### With Vercel AI SDK

```typescript
import { openai } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: tokenShieldMiddleware(), // All optimizations active
});
```

### With OpenAI SDK

```typescript
import OpenAI from "openai";
import { tokenShieldMiddleware, createOpenAIAdapter } from "@tokenshield/ai-sdk";

const shield = tokenShieldMiddleware();
const client = createOpenAIAdapter(shield, (p) => new OpenAI().chat.completions.create(p as any));

const response = await client({
  messages: [{ role: "user", content: "Hello world" }],
  model: "gpt-4o",
});
```

### With Anthropic SDK

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { tokenShieldMiddleware, createAnthropicAdapter } from "@tokenshield/ai-sdk";

const shield = tokenShieldMiddleware();
const client = createAnthropicAdapter(shield, (p) => new Anthropic().messages.create(p as any));
```

---

## What It Does (and How Much Each Module Saves)

| Module | What It Does | Savings |
| :--- | :--- | :--- |
| **Response Cache** | Semantic similarity matching catches rephrased duplicates. No API call = no cost. | 10-15% |
| **Model Router** | Routes "What is 2+2?" to GPT-4.1-Nano instead of GPT-4o. Same answer, 25x cheaper. | 20-30% |
| **Prefix Optimizer** | Reorders messages so providers cache your system prompt automatically. | 15-25% |
| **Context Manager** | Trims conversations to fit token budgets without losing critical context. | 10-15% |
| **Request Guard** | Blocks duplicate requests, rate limits, and cost-gates before API calls. | 3-5% |
| **Cost Ledger** | Tracks every dollar spent vs. saved with per-module attribution. Export to JSON/CSV. | Visibility |
| **Circuit Breaker** | Hard spending limits (per-hour, per-day, per-month) to prevent bill shock. | Protection |
| **User Budget Manager** | Per-user daily/monthly quotas for SaaS applications. | Governance |
| **Anomaly Detector** | Statistical outlier detection for cost and token spikes. | Early warning |

---

## Why Not a Gateway?

Most LLM cost tools (Helicone, Portkey, Edgee) are **API gateways**: you change your base URL to route traffic through their servers.

| | TokenShield SDK | Gateway (Helicone, Edgee, etc.) |
| :--- | :--- | :--- |
| **Architecture** | In-process middleware | Network proxy |
| **Latency** | **< 5ms** | 50-200ms per request |
| **Vendor Lock-In** | **None** (delete 3 lines to remove) | High (infrastructure dependency) |
| **Data Privacy** | **Your infra only** | Data flows through 3rd party |
| **Per-User Budgets** | **Built-in** | Limited or unavailable |
| **Prefix Optimization** | **Automatic** | Not available |
| **Pricing** | **MIT core / $29 Pro** | $20-800/mo |
| **Remove It** | Delete import | Redeploy infrastructure |

[Full competitive analysis vs. Edgee](docs/tokenshield-vs-edgee.md)

---

## Configuration

```typescript
tokenShieldMiddleware({
  modules: {
    guard: true,      // Rate limiting, dedup, cost gate
    cache: true,      // Semantic response caching
    context: true,    // Conversation trimming
    router: true,     // Complexity-based model routing
    prefix: true,     // Provider cache optimization
    ledger: true,     // Cost tracking
  },
  guard: {
    debounceMs: 300,
    maxRequestsPerMinute: 60,
    maxCostPerHour: 10,
    deduplicateWindow: 5000, // 5s window for identical prompts
  },
  cache: {
    maxEntries: 500,
    ttlMs: 3_600_000,
    similarityThreshold: 0.85,
    encodingStrategy: "holographic", // Better paraphrase detection
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
  onUsage: (entry) => console.log(`$${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`),
});
```

See [QUICKSTART.md](QUICKSTART.md) for the full configuration reference.

---

## React Integration

17 hooks for real-time cost visibility:

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

## Pricing

| Tier | Price | Includes |
| :--- | :--- | :--- |
| **Community** | Free (MIT) | Token Counter, Cost Estimator, Request Guard, Cost Ledger |
| **Pro** | $29/mo | + Response Cache, Model Router, Prefix Optimizer, Context Manager |
| **Team** | $99/mo | + Circuit Breaker, User Budgets, Anomaly Detection, Data Export |
| **Enterprise** | Custom | + Audit Logging, Custom Routing, Priority Support, SLA |

All features are unlocked in development. License keys are required for production use of Pro/Team/Enterprise features.

```typescript
import { activateLicense } from "@tokenshield/ai-sdk";
activateLicense("your-license-key");
```

---

## Security

TokenShield is a **client-side SDK**. Your API keys and data never leave your infrastructure. No telemetry, no phone-home, no third-party data sharing.

See [SECURITY.md](SECURITY.md) for the full trust model.

---

## Installation

```bash
npm install @tokenshield/ai-sdk
```

**Peer dependencies** (optional):
- `ai >= 3.0.0` — For Vercel AI SDK middleware
- `react >= 18.0.0` — For React hooks and dashboard

---

## Documentation

- [Quick Start Guide](QUICKSTART.md) — Full configuration reference
- [Security & Trust Model](SECURITY.md) — How data flows
- [Competitive Analysis](docs/tokenshield-vs-edgee.md) — vs. Edgee, Helicone, Portkey
- [Technical Specification](SPEC.md) — Architecture deep-dive
- [Changelog](CHANGELOG.md) — Version history
- [Contributing](CONTRIBUTING.md) — How to contribute

---

## License

MIT &copy; 2026 Code&Clarity. See [LICENSE](LICENSE) for details.
