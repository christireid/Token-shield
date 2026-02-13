# @tokenshield/ai-sdk

Cut LLM API costs 30-60% with 3 lines of code. TypeScript middleware for caching, routing, budget enforcement, and token optimization.

## Features

- **Response Cache** - Client-side exact + fuzzy matching eliminates duplicate API calls
- **Model Router** - Complexity-based routing sends simple requests to cheaper models
- **Context Manager** - Token-budget-aware conversation trimming
- **Prefix Optimizer** - Message ordering for provider prompt cache hits (50-90% input discount)
- **Request Guard** - Debounce, dedup, rate limiting, and cost gating
- **Cost Ledger** - Real-time usage tracking with per-module savings attribution
- **Circuit Breaker** - Session/hourly/daily spend limits with hard-stop protection
- **User Budget Manager** - Per-user daily/monthly token budgets
- **Stream Tracker** - Real-time output token counting during streaming
- **Exact Token Counting** - BPE tokenization matching OpenAI's tiktoken

## Installation

```bash
npm install @tokenshield/ai-sdk
```

Optional peer dependencies:
```bash
npm install ai react    # For Vercel AI SDK middleware and React hooks
```

## Quick Start

### With Vercel AI SDK (3 lines)

```typescript
import { wrapLanguageModel, streamText } from 'ai'
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'

const shield = tokenShieldMiddleware()

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: shield,
})

const { text } = await streamText({ model, prompt: 'Hello' })
```

### With createTokenShield Factory

```typescript
import { createTokenShield } from '@tokenshield/ai-sdk'

const shield = createTokenShield({
  preset: 'chatApp',
  monthlyBudget: 100,
})

// Use with wrapLanguageModel as above
```

### Framework-Agnostic

```typescript
import { ResponseCache, estimateCost, analyzeComplexity } from '@tokenshield/ai-sdk'

const cache = new ResponseCache({ maxEntries: 500 })

// Check cache before calling LLM
const cached = await cache.lookup(prompt, 'gpt-4o')
if (cached) return cached.response

// Estimate cost before calling
const cost = estimateCost('gpt-4o', inputTokens, outputTokens)

// Route to cheaper model for simple requests
const { score } = analyzeComplexity(prompt)
const model = score < 30 ? 'gpt-4o-mini' : 'gpt-4o'
```

### React Integration

```tsx
import { TokenShieldProvider, useSavings, TokenShieldDashboard } from '@tokenshield/ai-sdk/react'

function App() {
  return (
    <TokenShieldProvider>
      <Chat />
      <TokenShieldDashboard />
    </TokenShieldProvider>
  )
}

function CostDisplay() {
  const savings = useSavings()
  return <p>Saved ${savings.totalDollarsSaved.toFixed(2)}</p>
}
```

## Modules

| Module | Description |
|--------|-------------|
| `tokenShieldMiddleware()` | Drop-in Vercel AI SDK middleware |
| `createTokenShield()` | Quick-start factory with presets |
| `ResponseCache` | Client-side response caching (IndexedDB) |
| `analyzeComplexity()` / `routeToModel()` | Complexity-based model routing |
| `fitToBudget()` / `smartFit()` | Token-budget conversation trimming |
| `optimizePrefix()` | Provider prompt cache optimization |
| `RequestGuard` | Request dedup, debounce, rate limiting |
| `CostLedger` | Usage tracking with module attribution |
| `CostCircuitBreaker` | Spending limit enforcement |
| `UserBudgetManager` | Per-user budget assignment |
| `countExactTokens()` | BPE token counting |
| `estimateCost()` | Real provider pricing (30+ models) |
| `StreamTokenTracker` | Real-time streaming token counter |

## Pricing Data

Built-in pricing for 30+ models across OpenAI, Anthropic, and Google. Register custom models:

```typescript
import { registerModel } from '@tokenshield/ai-sdk'

registerModel({
  id: 'my-fine-tuned-model',
  provider: 'openai',
  name: 'My Model',
  inputPerMillion: 3.0,
  outputPerMillion: 12.0,
  cachedInputDiscount: 0.5,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsVision: false,
  supportsFunctions: true,
})
```

## Runtime Dependencies

Only 5 production dependencies:
- `gpt-tokenizer` - BPE tokenization
- `idb-keyval` - IndexedDB persistence
- `mitt` - Event bus
- `ohash` - Hashing
- `valibot` - Config validation

## License

MIT
