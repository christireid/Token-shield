# Token Shield Quickstart

## Installation

> **Not yet published to npm.** Clone and build from source:

```bash
git clone https://github.com/christireid/Token-shield.git
cd Token-shield && npm install && npm run build
```

## 1. Add Middleware (Vercel AI SDK)

```typescript
import { wrapLanguageModel, streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { shield } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: shield(),
})

const result = await streamText({
  model,
  messages: [{ role: "user", content: "What is React?" }],
})
```

Caching, compression, and cost tracking are on by default. Repeated prompts hit the cache, long conversations get trimmed, and spending is tracked automatically.

## 2. Configuration

```typescript
import { shield } from "@tokenshield/ai-sdk"

// Zero-config (recommended)
const middleware = shield()

// With budget enforcement
const middleware = shield({
  cache: true, // Semantic response caching (default: true)
  compression: true, // Prompt compression (default: true)
  trackCosts: true, // Cost ledger (default: true)
  guard: true, // Rate limiting, dedup (default: true)
  monthlyBudget: 500, // Circuit breaker: $500/month
  dailyBudget: 25, // Circuit breaker: $25/day
  similarityThreshold: 0.85, // Cache match threshold (default: 0.85)
  onUsage: (entry) => {
    console.log(`$${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`)
  },
})
```

For full module-level control, use `tokenShieldMiddleware()`:

```typescript
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

const middleware = tokenShieldMiddleware({
  modules: {
    guard: true,
    cache: true,
    context: true,
    router: false, // Opt-in: complexity-based model routing
    prefix: true,
    ledger: true,
  },
  cache: { maxEntries: 500, ttlMs: 3_600_000, similarityThreshold: 0.85 },
  breaker: { limits: { perDay: 20, perMonth: 200 }, action: "stop" },
  dryRun: false,
  onDryRun: (action) => console.log(`[dry-run] ${action.module}: ${action.description}`),
})
```

## 3. Stats

```typescript
import { shield, getStats } from "@tokenshield/ai-sdk"

const middleware = shield()
// ... after some requests ...
const stats = getStats(middleware)
// { totalSaved: 0.43, totalSpent: 1.82, savingsRate: 0.19, cacheHitRate: 0.34 }
```

## 4. React Hooks

```tsx
import { TokenShieldProvider, useSavings, useBudgetAlert } from "@tokenshield/ai-sdk/react"

function App() {
  return (
    <TokenShieldProvider defaultModelId="gpt-4o">
      <Dashboard />
    </TokenShieldProvider>
  )
}

function Dashboard() {
  const { totalDollarsSaved, totalCacheHits } = useSavings()
  const { isOverBudget } = useBudgetAlert(10) // $10 alert
  return (
    <div>
      <p>
        Saved ${totalDollarsSaved.toFixed(2)} ({totalCacheHits} cache hits)
      </p>
      {isOverBudget && <p>Budget exceeded!</p>}
    </div>
  )
}
```

Primary hooks: `useSavings`, `useBudgetAlert`, `useShieldedCall`. All 15 hooks are available from `@tokenshield/ai-sdk/react`.

## 5. Error Handling

```typescript
import {
  TokenShieldBlockedError,
  TokenShieldBudgetError,
  TokenShieldError,
} from "@tokenshield/ai-sdk/advanced"

try {
  const result = await streamText({ model, messages })
} catch (err) {
  if (err instanceof TokenShieldBudgetError) {
    console.error(`Budget limit hit: ${err.limitType}`)
  } else if (err instanceof TokenShieldBlockedError) {
    console.warn("Request blocked:", err.message)
  } else if (err instanceof TokenShieldError) {
    console.error(`TokenShield [${err.code}]:`, err.message)
  }
}
```

## 6. Standalone Modules

Every module can be used independently via the `/advanced` subpath:

```typescript
import {
  countExactTokens,
  estimateCost,
  analyzeComplexity,
  ResponseCache,
} from "@tokenshield/ai-sdk/advanced"

const { tokens } = countExactTokens("Hello, world!")
const cost = estimateCost("gpt-4o", 1000, 500)
const { score, tier } = analyzeComplexity("What is 2+2?")

const cache = new ResponseCache({ maxEntries: 500, similarityThreshold: 0.85 })
await cache.store("What is React?", "React is...", "gpt-4o", 10, 50)
const result = await cache.lookup("what is react", "gpt-4o") // fuzzy match
```
