# Token Shield

**Cut your LLM API costs 30-60% with 3 lines of code.**

Token Shield is a client-side cost optimization middleware for the [Vercel AI SDK](https://sdk.vercel.ai). It intercepts every LLM call and applies a pipeline of optimizations — caching, intelligent routing, context trimming, prefix optimization, and spend controls — before the request reaches the provider.

Zero latency added. Zero infrastructure to manage. Zero API key exposure to third parties.

```typescript
import { wrapLanguageModel } from 'ai'
import { openai } from '@ai-sdk/openai'
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'

// Wrap your model — all optimizations are automatic
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: tokenShieldMiddleware(),
})
```

Your existing `streamText` and `generateText` calls work exactly as before, just cheaper.

## Why Token Shield?

| Problem | Token Shield Solution |
|---------|----------------------|
| Identical prompts hitting the API repeatedly | **Response Cache** — exact + fuzzy match, zero-cost cache hits |
| Simple questions routed to expensive models | **Model Router** — 12-dimension complexity scoring, auto-routes to cheapest capable model |
| Long conversations burning tokens | **Context Manager** — trims history to fit token budgets, preserves important context |
| Missing provider prompt cache discounts | **Prefix Optimizer** — structures messages for OpenAI/Anthropic/Google cache hits (50-90% discount) |
| No visibility into LLM spending | **Cost Ledger** — real-time per-request cost tracking with savings attribution |
| Accidental request spam | **Request Guard** — debouncing, deduplication, rate limiting |
| Runaway costs | **Circuit Breaker** — hard spending limits per session, hour, day, or month |

## How It Compares

| Feature | Token Shield | Helicone | Portkey | LiteLLM |
|---------|-------------|----------|---------|---------|
| Deployment | Client-side SDK | Server proxy | Server gateway | Python proxy |
| Latency added | ~0ms | 25-200ms | 25-200ms | 25-200ms |
| Infrastructure needed | None | Proxy server | Gateway | Docker + Redis + Postgres |
| API keys exposed to third party | No | Yes | Yes | Yes (self-host avoids) |
| Pre-call cost prevention | Yes (7 modules) | Caching only | Caching only | No |
| Prefix cache optimization | Yes (unique) | No | No | No |
| Vercel AI SDK native | Yes (middleware) | Partial | Partial | No |
| React hooks included | Yes (17 hooks) | No | No | No |

## Quick Start

### Install

```bash
npm install @tokenshield/ai-sdk
```

Peer dependencies: `ai` (Vercel AI SDK >=3.0.0), `react` (>=18.0.0)

### Basic Setup (defaults: guard + cache + context + prefix + ledger)

```typescript
import { wrapLanguageModel, streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: tokenShieldMiddleware(),
})

// Use exactly like before
const result = await streamText({
  model,
  messages: [{ role: 'user', content: 'What is React?' }],
})
```

### Full Configuration

```typescript
const middleware = tokenShieldMiddleware({
  modules: {
    guard: true,     // Request guard: debounce, dedup, rate limit
    cache: true,     // Response cache: exact + fuzzy match
    context: true,   // Context manager: trim conversations to budget
    router: true,    // Model router: route simple prompts to cheaper models
    prefix: true,    // Prefix optimizer: maximize provider cache hits
    ledger: true,    // Cost ledger: track spending and savings
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

  context: {
    maxInputTokens: 8000,
    reserveForOutput: 1000,
  },

  router: {
    tiers: [
      { modelId: 'gpt-4.1-nano', maxComplexity: 20 },
      { modelId: 'gpt-4.1-mini', maxComplexity: 50 },
      { modelId: 'gpt-4o', maxComplexity: 100 },
    ],
  },

  prefix: { provider: 'auto' },

  ledger: { persist: true, feature: 'chat' },

  breaker: {
    limits: { perSession: 5, perHour: 20, perDay: 50 },
    action: 'stop',
  },
})
```

### React Integration

```typescript
import { TokenShieldProvider, useSavings, useTokenCount } from '@tokenshield/ai-sdk/react'

function App() {
  return (
    <TokenShieldProvider middleware={shield}>
      <ChatUI />
      <SavingsDashboard />
    </TokenShieldProvider>
  )
}

function SavingsDashboard() {
  const { totalTokensSaved, totalDollarsSaved, entries } = useSavings()
  return (
    <div>
      <p>Tokens saved: {totalTokensSaved.toLocaleString()}</p>
      <p>Money saved: ${totalDollarsSaved.toFixed(2)}</p>
    </div>
  )
}
```

17 React hooks available: `useSavings`, `useTokenCount`, `useBudgetAlert`, `useTokenEstimate`, `useComplexityAnalysis`, `useContextManager`, `useResponseCache`, `useRequestGuard`, `useModelRouter`, `useCostLedger`, `useFeatureCost`, `useUserBudget`, `useEventLog`, `useProviderHealth`, `usePipelineMetrics`, `useShieldedCall`, `useTokenEstimate`.

## The Prefix Optimizer: Our Secret Weapon

Every major LLM provider offers prompt caching — but you only get the discount if your message prefix is stable across requests. Most apps dump messages in inconsistent order and miss these free savings.

Token Shield's Prefix Optimizer automatically structures your messages so the stable prefix (system prompt, pinned context, summaries) comes first, followed by volatile messages (recent conversation). This maximizes cache hits:

| Provider | Cache Discount | How It Works |
|----------|---------------|-------------|
| OpenAI | 50% off cached tokens | Automatic prefix matching (>1024 tokens) |
| Anthropic | 90% off cached tokens | Explicit `cache_control` breakpoints (auto-inserted) |
| Google | 75% off cached tokens | Context caching API |

No other tool does this. Everyone else either proxies your traffic (adding latency) or just counts tokens after the fact.

## Modules

| Module | What It Does | Default |
|--------|-------------|---------|
| Token Counter | BPE-accurate client-side token counting | Always on |
| Response Cache | Semantic similarity caching with configurable TTL | On |
| Context Manager | Conversation history trimming (4 algorithms) | On |
| Model Router | 12-dimension complexity scoring for model selection | Opt-in |
| Request Guard | Debouncing, rate limiting, deduplication, cost gating | On |
| Prefix Optimizer | Provider-specific prompt cache hit maximization | On |
| Cost Ledger | Real-time cost tracking with counterfactual savings | On |
| Circuit Breaker | Spending limits with warn/throttle/hard-stop actions | Opt-in |
| Stream Tracker | Real-time output token counting during streaming | Automatic |
| Tool Token Counter | Token estimation for tool/function call definitions | Available |
| Output Prediction | Pre-request output token estimation | Available |
| User Budget Manager | Per-user daily/monthly token budgets | Opt-in |

## ROI Calculator

| Your Monthly LLM Spend | Conservative Savings (25%) | Realistic Savings (45%) | Token Shield Cost |
|------------------------|---------------------------|------------------------|-------------------|
| $1,000/mo | $250/mo | $450/mo | $29/mo |
| $5,000/mo | $1,250/mo | $2,250/mo | $29/mo |
| $10,000/mo | $2,500/mo | $4,500/mo | $99/mo |
| $50,000/mo | $12,500/mo | $22,500/mo | $99/mo |
| $100,000/mo | $25,000/mo | $45,000/mo | Custom |

## Architecture

```
Your App (streamText / generateText)
  |
  v
wrapLanguageModel({ middleware: tokenShieldMiddleware() })
  |
  v
[Circuit Breaker] --block if over budget-->
  |
  v
[Request Guard] --block if spam/duplicate-->
  |
  v
[Response Cache] --return cached if hit-->
  |
  v
[Context Manager] --trim to token budget-->
  |
  v
[Model Router] --route to cheapest capable model-->
  |
  v
[Prefix Optimizer] --reorder for provider cache hits-->
  |
  v
LLM Provider API (OpenAI / Anthropic / Google)
  |
  v
[Cost Ledger] --record usage + savings-->
  |
  v
Response returned to your app
```

## Works With

- Vercel AI SDK (native `wrapLanguageModel` middleware)
- OpenAI SDK (via `createOpenAIAdapter`)
- Anthropic SDK (via `createAnthropicAdapter`)
- Any framework (via `createGenericAdapter`)
- Next.js App Router
- React 18+
- TypeScript 5+

## License

MIT - see [LICENSE](./LICENSE)

## Contributing

Contributions welcome. Please open an issue first to discuss proposed changes.
