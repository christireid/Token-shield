# Token Shield

Drop-in middleware that reduces AI API costs without changing your prompts.

Works with Vercel AI SDK, OpenAI, and Anthropic. TypeScript-first.

> **v1.0.0** — Not yet published to npm. Install from source.

---

## Install

```bash
git clone https://github.com/christireid/Token-shield.git
cd Token-shield
npm install && npm run build
```

---

## Quick Start

```typescript
import { wrapLanguageModel } from "ai"
import { openai } from "@ai-sdk/openai"
import { shield } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: shield(),
})
```

That's it. Caching, compression, and cost tracking are on by default.

---

## What It Does

Token Shield reduces costs using three safe techniques:

- **Semantic caching** — near-identical prompts return cached responses
- **Prompt compression** — removes redundancy from conversations
- **Cost tracking** — real-time spend and savings attribution

No prompt rewrites. No lock-in. Delete 3 lines to remove.

---

## Configuration

```typescript
import { shield } from "@tokenshield/ai-sdk"

// Zero-config (recommended)
const middleware = shield()

// With budget enforcement
const middleware = shield({
  cache: true,
  compression: true,
  monthlyBudget: 500,
  dailyBudget: 25,
  onUsage: (e) => console.log(`$${e.cost.toFixed(4)} spent`),
})
```

For full control, use `tokenShieldMiddleware()` with explicit module configuration.
See [QUICKSTART.md](QUICKSTART.md) for the complete reference.

---

## Framework Adapters

### Vercel AI SDK (primary)

```typescript
import { shield } from "@tokenshield/ai-sdk"
const middleware = shield()
// Use with wrapLanguageModel()
```

### OpenAI SDK

```typescript
import { shield, createOpenAIAdapter } from "@tokenshield/ai-sdk"

const mw = shield()
const chat = createOpenAIAdapter(mw, (p) => openai.chat.completions.create(p))
```

### Anthropic SDK

```typescript
import { shield, createAnthropicAdapter } from "@tokenshield/ai-sdk"

const mw = shield()
const chat = createAnthropicAdapter(mw, (p) => anthropic.messages.create(p))
```

---

## Stats

```typescript
import { shield, getStats } from "@tokenshield/ai-sdk"

const middleware = shield()
// ... after some requests ...
const stats = getStats(middleware)
console.log(stats)
// { totalSaved: 0.43, totalSpent: 1.82, savingsRate: 0.19, cacheHitRate: 0.34 }
```

---

## React Integration

```typescript
import { TokenShieldProvider, useSavings, useBudgetAlert } from "@tokenshield/ai-sdk/react"

function App() {
  return (
    <TokenShieldProvider defaultModelId="gpt-4o">
      <CostDisplay />
    </TokenShieldProvider>
  )
}

function CostDisplay() {
  const { totalDollarsSaved, totalCacheHits } = useSavings()
  return <p>Saved ${totalDollarsSaved.toFixed(2)} ({totalCacheHits} cache hits)</p>
}
```

Primary hooks: `useSavings`, `useBudgetAlert`, `useShieldedCall`.
See [QUICKSTART.md](QUICKSTART.md) for the full hook reference.

---

## Advanced Usage

For direct access to individual modules (cache, router, guard, etc.):

```typescript
import { ResponseCache, CostLedger, RequestGuard } from "@tokenshield/ai-sdk/advanced"
```

The main `@tokenshield/ai-sdk` barrel exports ~10 things. Everything else lives in `/advanced`.

---

## Runtime Compatibility

| Environment            | Caching                    | Notes                                       |
| :--------------------- | :------------------------- | :------------------------------------------ |
| **Browser**            | IndexedDB (persistent)     | Full support                                |
| **Node.js**            | In-memory (per-process)    | Cache resets on restart                     |
| **Vercel Edge**        | In-memory (per-invocation) | Cache only helps within a single invocation |
| **Cloudflare Workers** | In-memory (per-invocation) | Same as Edge                                |

**Serverless caveat:** In serverless/edge environments, every cold start is a cache miss. Caching is most effective in long-running processes (Node.js servers, browsers) where prompts repeat across requests. For serverless, the guard, compression, and cost tracking modules still provide value.

---

## Architecture: Middleware vs. Gateway

|                  | Token Shield             | Gateway (Helicone, etc.)     |
| :--------------- | :----------------------- | :--------------------------- |
| **Architecture** | In-process middleware    | Network proxy                |
| **Latency**      | < 5ms overhead           | 50-200ms per request         |
| **Lock-in**      | Delete 3 lines to remove | Redeploy infrastructure      |
| **Data privacy** | Data stays in your infra | Data flows through 3rd party |

**What gateways do better:** Team-wide dashboards, centralized logging, managed infrastructure, cross-service cache sharing. Token Shield is client-side — it can't replace server-side observability.

---

## Limitations

- **Not yet on npm** — install from source until published
- **Client-side only** — no centralized team dashboards or shared caching
- **In-memory cache in serverless** — cache resets on every cold start
- **Model routing quality is unvalidated** — use `dryRun` mode to compare before relying on it
- **Single maintainer** — bus factor of 1

---

## License

MIT. Core optimization modules are free forever.

Team features (user budgets, anomaly detection) and enterprise features (audit logging, custom routing) require a license key. All features are unlocked in development mode.

---

## Links

- [Quick Start & Config Reference](QUICKSTART.md)
- [Security & Trust Model](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
