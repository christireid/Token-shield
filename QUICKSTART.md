# TokenShield Quickstart

## Installation

> **Not yet published to npm.** Clone and build from source:

```bash
git clone https://github.com/tokenshield/ai-sdk.git
cd ai-sdk && npm install && npm run build
```

## 1. Add Middleware (Vercel AI SDK)

```typescript
import { wrapLanguageModel, streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: tokenShieldMiddleware(),
})

const result = await streamText({
  model,
  messages: [{ role: "user", content: "What is React?" }],
})
```

Repeated prompts hit the cache, long conversations get trimmed, and spending is tracked automatically.

## 2. Configuration Reference

```typescript
tokenShieldMiddleware({
  // Enable/disable modules (all true by default except router)
  modules: {
    guard: true, // Debounce, dedup, rate limit
    cache: true, // Response caching (exact + fuzzy)
    context: true, // Conversation trimming
    router: false, // Model routing (opt-in)
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
    ttlMs: 3_600_000, // 1 hour
    similarityThreshold: 0.85,
  },

  context: {
    maxInputTokens: 8000,
    reserveForOutput: 1000,
  },

  router: {
    tiers: [
      { modelId: "gpt-4.1-nano", maxComplexity: 20 },
      { modelId: "gpt-4.1-mini", maxComplexity: 50 },
      { modelId: "gpt-4o", maxComplexity: 100 },
    ],
  },

  breaker: {
    limits: { perHour: 2, perDay: 20, perMonth: 200 },
    action: "stop", // 'warn' | 'throttle' | 'stop'
  },

  // Dry-run: log what would happen without modifying behavior
  dryRun: false,
  onDryRun: (action) => console.log(`[dry-run] ${action.module}: ${action.description}`),

  onUsage: (entry) => {
    console.log(`$${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`)
  },
})
```

## 3. React Hooks

```tsx
import { TokenShieldProvider, useSavings, useBudgetAlert, useTokenCount } from "@tokenshield/ai-sdk"

function App() {
  return (
    <TokenShieldProvider defaultModelId="gpt-4o">
      <ChatApp />
    </TokenShieldProvider>
  )
}

function SavingsBanner() {
  const { totalDollarsSaved, totalTokensSaved, totalCacheHits } = useSavings()
  return (
    <p>
      Saved ${totalDollarsSaved.toFixed(2)} ({totalCacheHits} cache hits)
    </p>
  )
}

function PromptInput() {
  const [text, setText] = useState("")
  const { tokens, cost } = useTokenCount(text)
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <span>
        {tokens} tokens (${cost.toFixed(4)})
      </span>
    </div>
  )
}
```

## 4. Error Handling

```typescript
import {
  TokenShieldBlockedError,
  TokenShieldBudgetError,
  TokenShieldError,
} from "@tokenshield/ai-sdk"

try {
  const result = await streamText({ model, messages })
} catch (err) {
  if (err instanceof TokenShieldBudgetError) {
    console.error(`User ${err.userId} hit ${err.limitType} limit`)
  } else if (err instanceof TokenShieldBlockedError) {
    console.warn("Request blocked:", err.message)
  } else if (err instanceof TokenShieldError) {
    console.error(`TokenShield [${err.code}]:`, err.message)
  }
}
```

## 5. Standalone Module Usage

Every module can be used independently without the middleware:

```typescript
import {
  countExactTokens,
  estimateCost,
  analyzeComplexity,
  ResponseCache,
} from "@tokenshield/ai-sdk"

// Token counting
const { tokens } = countExactTokens("Hello, world!")

// Cost estimation
const cost = estimateCost("gpt-4o", 1000, 500)

// Complexity analysis
const { score, tier } = analyzeComplexity("What is 2+2?")

// Direct cache usage
const cache = new ResponseCache({ maxEntries: 500, similarityThreshold: 0.85 })
await cache.store("What is React?", "React is...", "gpt-4o", 10, 50)
const result = await cache.lookup("what is react", "gpt-4o") // fuzzy match
```

See the TypeScript types for full API documentation — all exports are fully typed.
