# TokenShield Developer Quickstart

Frontend-only React/TypeScript toolkit for reducing AI/LLM token expenses.
12 modules + AI SDK middleware + React hooks. Zero backend required.

## Installation

```bash
npm install @tokenshield/ai-sdk
```

Peer dependencies: `ai` (Vercel AI SDK), `react` (18+).

## Quick Start (3 minutes)

Drop-in middleware for Vercel AI SDK. Every LLM call is automatically
optimized -- caching, context trimming, prefix optimization, and cost tracking.

```typescript
import { wrapLanguageModel, streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: tokenShieldMiddleware({
    // All default modules enabled: guard, cache, context, prefix, ledger
    // Router is opt-in (requires tier config)
  }),
})

// Use exactly like before -- all optimizations are automatic
const result = await streamText({
  model,
  messages: [{ role: 'user', content: 'What is React?' }],
})
```

That's it. Repeated prompts hit the cache (zero API cost), long conversations
are trimmed to fit token budgets, and every request is tracked in the cost ledger.

## Configuration

Full middleware config with all options:

```typescript
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk'

const middleware = tokenShieldMiddleware({
  // Enable/disable individual modules (all default to true except router)
  modules: {
    guard: true,     // Request guard: debounce, dedup, rate limit, cost gate
    cache: true,     // Response cache: exact + fuzzy match via IndexedDB
    context: true,   // Context manager: trim conversations to fit token budgets
    router: false,   // Model router: opt-in, routes simple prompts to cheaper models
    prefix: true,    // Prefix optimizer: reorder messages for provider cache hits
    ledger: true,    // Cost ledger: track spending and savings per request
  },

  // Request guard -- prevents runaway requests
  guard: {
    debounceMs: 300,            // Min ms between requests (default: 300)
    maxRequestsPerMinute: 60,   // Rate limit (default: 60)
    maxCostPerHour: 10,         // Dollar cap per hour (default: $10)
  },

  // Response cache -- identical/similar prompts return cached responses
  cache: {
    maxEntries: 500,            // Max cached responses before LRU eviction (default: 500)
    ttlMs: 3_600_000,           // Cache entry lifetime in ms (default: 1 hour)
    similarityThreshold: 0.85,  // 0-1, fuzzy match threshold (default: 0.85)
  },

  // Context manager -- trim long conversations to fit model limits
  context: {
    maxInputTokens: 8000,       // Max input tokens (oldest messages evicted first)
    reserveForOutput: 1000,     // Tokens reserved for model response (default: 1000)
  },

  // Model router -- route simple prompts to cheaper models (opt-in)
  router: {
    tiers: [
      { modelId: 'gpt-4.1-nano', maxComplexity: 20 },   // Trivial queries
      { modelId: 'gpt-4.1-mini', maxComplexity: 50 },   // Simple queries
      { modelId: 'gpt-4o', maxComplexity: 100 },         // Complex queries
    ],
    complexityThreshold: 50,  // Score above this keeps the default model (default: 50)
  },

  // Prefix optimizer -- reorder messages for provider prompt cache hits
  prefix: {
    provider: 'auto',  // 'openai' | 'anthropic' | 'google' | 'auto' (default: 'auto')
  },

  // Cost ledger -- track spending and savings
  ledger: {
    persist: true,     // Persist to IndexedDB across sessions (default: false)
    feature: 'chat',   // Tag all entries with a feature name for analytics
  },

  // Circuit breaker -- hard spending limits that halt all API calls
  breaker: {
    limits: {
      perSession: 5,   // $5 per session
      perHour: 2,      // $2 per hour
      perDay: 20,      // $20 per day
      perMonth: 200,   // $200 per month
    },
    action: 'stop',    // 'warn' | 'throttle' | 'stop' (default: 'stop')
  },

  // Per-user budget management (Team tier)
  userBudget: {
    getUserId: () => currentUser.id,  // Return current user's ID
    budgets: {
      users: {
        'user-alice': { daily: 5, monthly: 50, tier: 'premium' },
        'user-bob':   { daily: 1, monthly: 10, tier: 'standard' },
      },
      defaultBudget: { daily: 2, monthly: 20, tier: 'standard' },
      persist: true,   // Persist budget usage to IndexedDB
      tierModels: {
        standard: 'gpt-4.1-mini',   // Budget users get cheaper models
        premium: 'gpt-4o',          // Premium users keep default
        unlimited: 'gpt-4o',        // Unlimited users keep default
      },
    },
    onBudgetExceeded: (userId, event) => {
      console.warn(`${userId} exceeded ${event.limitType} budget`)
    },
    onBudgetWarning: (userId, event) => {
      console.warn(`${userId} at ${event.percentUsed.toFixed(0)}% of ${event.limitType} budget`)
    },
  },

  // Callbacks
  onUsage: (entry) => {
    console.log(`${entry.model}: $${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`)
  },
  onBlocked: (reason) => {
    console.warn('Request blocked:', reason)
  },
})
```

## React Hooks

### Provider Setup

Wrap your app (or the AI-using portion) with `TokenShieldProvider`:

```tsx
import { TokenShieldProvider } from '@tokenshield/ai-sdk'

function App() {
  return (
    <TokenShieldProvider
      defaultModelId="gpt-4o-mini"
      ledgerConfig={{ persist: true }}
    >
      <ChatApp />
    </TokenShieldProvider>
  )
}
```

### useSavings -- Real-Time Savings Display

```tsx
import { useSavings } from '@tokenshield/ai-sdk'

function SavingsBanner() {
  const savings = useSavings()

  return (
    <div>
      <p>Saved ${savings.totalDollarsSaved.toFixed(2)} this session</p>
      <p>{savings.totalTokensSaved.toLocaleString()} tokens saved</p>
      <p>{savings.totalCacheHits} cache hits / {savings.totalRequestsMade} requests</p>
    </div>
  )
}
```

### useTokenCount -- Live Token Counting

```tsx
import { useTokenCount } from '@tokenshield/ai-sdk'

function PromptInput() {
  const [text, setText] = useState('')
  const { tokens, cost } = useTokenCount(text)

  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} />
      <span>{tokens} tokens (${cost.toFixed(4)})</span>
    </div>
  )
}
```

### useBudgetAlert -- Cost Warnings

```tsx
import { useBudgetAlert, CostCircuitBreaker } from '@tokenshield/ai-sdk'

function BudgetWarning({ breaker }: { breaker: CostCircuitBreaker }) {
  const { isOverBudget, percentUsed, limitType } = useBudgetAlert(breaker)

  if (!isOverBudget && percentUsed < 80) return null

  return (
    <div role="alert">
      {isOverBudget
        ? `${limitType} budget exceeded -- requests blocked`
        : `${percentUsed.toFixed(0)}% of ${limitType} budget used`}
    </div>
  )
}
```

### useUserBudget -- Per-User Budget Tracking

```tsx
import { useUserBudget, UserBudgetManager } from '@tokenshield/ai-sdk'

function UserBudgetDisplay({ manager, userId }: {
  manager: UserBudgetManager
  userId: string
}) {
  const status = useUserBudget(manager, userId)

  return (
    <div>
      <p>Daily: ${status.spend.daily.toFixed(2)} / ${status.remaining.daily?.toFixed(2) ?? 'unlimited'}</p>
      <p>Monthly: ${status.spend.monthly.toFixed(2)} / ${status.remaining.monthly?.toFixed(2) ?? 'unlimited'}</p>
      {status.isOverBudget && <p>Budget exceeded</p>}
      <p>Tier: {status.tier}</p>
    </div>
  )
}
```

### useCostLedger -- Analytics

```tsx
import { useCostLedger } from '@tokenshield/ai-sdk'

function CostDashboard() {
  const ledger = useCostLedger()

  return (
    <div>
      <p>Total spent: ${ledger.totalSpent.toFixed(2)}</p>
      <p>Total saved: ${ledger.totalSaved.toFixed(2)}</p>
      <p>Savings rate: {(ledger.savingsRate * 100).toFixed(1)}%</p>
      <p>API calls: {ledger.totalCalls}</p>
    </div>
  )
}

// Per-feature breakdown
function FeatureCost() {
  const chatCost = useCostLedger('chat')
  return <p>Chat feature: ${chatCost.totalSpent.toFixed(2)}</p>
}
```

## Module-by-Module Examples

Use modules standalone without the middleware when you need fine-grained control.

### 1. Token Counter

```typescript
import { countExactTokens, countChatTokens } from '@tokenshield/ai-sdk'

// Count tokens in a string (exact BPE, matches OpenAI's tiktoken)
const count = countExactTokens('Hello, world!')
console.log(count.tokens)     // 4
console.log(count.characters)  // 13
console.log(count.ratio)       // 3.25 chars per token

// Count tokens in a chat conversation (includes per-message overhead)
const chatCount = countChatTokens([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is TypeScript?' },
])
console.log(chatCount.total)     // total tokens including formatting overhead
console.log(chatCount.overhead)  // tokens used by role tags and separators
```

### 2. Cost Estimator

```typescript
import { estimateCost, compareCosts, projectMonthlyCost } from '@tokenshield/ai-sdk'

// Estimate cost for a single request
const cost = estimateCost('gpt-4o', 1000, 500)
console.log(cost.inputCost)   // $0.0025
console.log(cost.outputCost)  // $0.005
console.log(cost.totalCost)   // $0.0075

// Compare costs across models
const comparison = compareCosts(1000, 500)
// Returns costs for every known model, sorted cheapest first

// Project monthly cost from current usage
const monthly = projectMonthlyCost('gpt-4o', 100, 1000, 500)
// 100 requests/day * 30 days at the given token counts
```

### 3. Context Manager

```typescript
import { fitToBudget, type Message, type ContextBudget } from '@tokenshield/ai-sdk'

const messages: Message[] = [
  { role: 'system', content: 'You are a helpful assistant.', pinned: true },
  { role: 'user', content: 'Tell me about React.' },
  { role: 'assistant', content: '...long response...' },
  { role: 'user', content: 'How about Next.js?' },
]

const budget: ContextBudget = {
  maxContextTokens: 4096,
  reservedForOutput: 1000,
}

const result = fitToBudget(messages, budget)
console.log(result.messages)        // Trimmed messages that fit the budget
console.log(result.evictedTokens)   // Tokens removed from oldest messages
console.log(result.budgetRemaining) // Tokens left for more context
```

### 4. Response Cache

```typescript
import { ResponseCache } from '@tokenshield/ai-sdk'

const cache = new ResponseCache({
  maxEntries: 500,
  ttlMs: 3_600_000,
  similarityThreshold: 0.85,
})

// Store a response
await cache.store('What is React?', 'React is a JavaScript library...', 'gpt-4o', 10, 50)

// Exact match lookup
const exact = await cache.lookup('What is React?', 'gpt-4o')
console.log(exact.hit)         // true
console.log(exact.matchType)   // 'exact'

// Fuzzy match (catches rephrased prompts)
const fuzzy = await cache.lookup('what is react', 'gpt-4o')
console.log(fuzzy.hit)         // true
console.log(fuzzy.matchType)   // 'fuzzy'
console.log(fuzzy.similarity)  // 0.92
```

### 5. Model Router

```typescript
import { analyzeComplexity, routeToModel } from '@tokenshield/ai-sdk'

// Analyze prompt complexity (0-100 score)
const complexity = analyzeComplexity('What is the capital of France?')
console.log(complexity.score)  // ~12 (trivial)
console.log(complexity.tier)   // 'trivial'

const hard = analyzeComplexity('Analyze this contract for liability risks under Delaware law')
console.log(hard.score)        // ~72 (complex)
console.log(hard.tier)         // 'complex'

// Get a routing decision with cost comparison
const route = routeToModel('What is 2+2?', 'gpt-4o')
console.log(route.selectedModel.name)   // e.g. 'GPT-4.1 Nano'
console.log(route.savingsVsDefault)     // dollars saved vs default model
```

### 6. Stream Tracker

```typescript
import { StreamTokenTracker } from '@tokenshield/ai-sdk'

const tracker = new StreamTokenTracker({
  modelId: 'gpt-4o',
  onUsageUpdate: (usage) => {
    console.log(`${usage.outputTokens} tokens, $${usage.estimatedCost.toFixed(4)}`)
  },
  onAbort: (usage) => {
    // Still get accurate counts even when user clicks "Stop generating"
    console.log(`Aborted after ${usage.outputTokens} tokens`)
  },
})

tracker.setInputTokens(500)

// Feed stream chunks as they arrive
tracker.addChunk('Hello')
tracker.addChunk(', world!')

// On normal completion
const usage = tracker.finish()

// On abort (user cancelled) -- usage is still accurate
const abortedUsage = tracker.abort()
```

### 7. Circuit Breaker

```typescript
import { CostCircuitBreaker } from '@tokenshield/ai-sdk'

const breaker = new CostCircuitBreaker({
  limits: { perSession: 5, perHour: 2, perDay: 20 },
  action: 'stop',
  onWarning: (event) => console.warn(`${event.limitType}: ${event.percentUsed}% used`),
  onTripped: (event) => console.error(`${event.limitType} limit hit -- blocking requests`),
})

// Check before making an API call
const check = breaker.check('gpt-4o', 1000, 500)
if (!check.allowed) {
  console.error(check.reason)
} else {
  // Make the API call, then record actual cost
  breaker.recordSpend(0.0075, 'gpt-4o')
}

// Get current status
const status = breaker.getStatus()
console.log(status.tripped)            // false
console.log(status.spend.session)      // $0.0075
console.log(status.remaining.session)  // $4.9925
```

### 8. User Budget Manager

```typescript
import { UserBudgetManager } from '@tokenshield/ai-sdk'

const manager = new UserBudgetManager({
  users: {
    'alice': { daily: 5, monthly: 50, tier: 'premium' },
    'bob':   { daily: 1, monthly: 10, tier: 'standard' },
  },
  defaultBudget: { daily: 2, monthly: 20 },
  persist: true,
  tierModels: {
    standard: 'gpt-4.1-mini',
    premium: 'gpt-4o',
  },
  onBudgetExceeded: (userId, event) => {
    console.error(`${userId}: ${event.limitType} budget exceeded`)
  },
})

// Check if a request is allowed
const check = manager.check('alice', 'gpt-4o', 1000, 500)
if (check.allowed) {
  // Make the API call, then record actual cost
  await manager.recordSpend('alice', 0.0075, 'gpt-4o')
}

// Get budget status
const status = manager.getStatus('alice')
console.log(status.spend.daily)        // $0.0075
console.log(status.remaining.daily)    // $4.9925
console.log(status.isOverBudget)       // false
console.log(status.tier)               // 'premium'

// Auto-route user to their tier's model
const model = manager.getModelForUser('bob')  // 'gpt-4.1-mini'
```

## Error Handling

All SDK errors extend `TokenShieldError` for easy catch-all handling.
Each error includes a machine-readable `code` property.

```typescript
import {
  TokenShieldBlockedError,
  TokenShieldBudgetError,
  TokenShieldConfigError,
  TokenShieldError,
  ERROR_CODES,
} from '@tokenshield/ai-sdk'

try {
  const result = await streamText({ model, messages })
} catch (err) {
  if (err instanceof TokenShieldBudgetError) {
    // Per-user budget exceeded
    console.error(`User ${err.userId} hit ${err.limitType} limit`)
    console.error(`Spent $${err.currentSpend.toFixed(2)} / $${err.limit.toFixed(2)}`)
  } else if (err instanceof TokenShieldBlockedError) {
    // Guard, breaker, or rate limit blocked the request
    console.warn('Blocked:', err.message)
    // Use err.code to distinguish: GUARD_RATE_LIMIT, BREAKER_SESSION_LIMIT, etc.
    if (err.code === ERROR_CODES.GUARD_RATE_LIMIT) {
      console.warn('Slow down -- rate limit hit')
    }
  } else if (err instanceof TokenShieldConfigError) {
    // Invalid configuration (caught at middleware creation time)
    console.error(`Bad config at "${err.path}":`, err.message)
  } else if (err instanceof TokenShieldError) {
    // Catch-all for any other SDK error
    console.error(`TokenShield error [${err.code}]:`, err.message)
  }
}
```

## Advanced: Config Validation

Validate configuration objects at build time or before passing to the middleware.
Uses [Valibot](https://valibot.dev) schemas under the hood.

```typescript
import { validateConfig, TokenShieldConfigSchema } from '@tokenshield/ai-sdk'

// Validate and get back a typed, default-filled config
const config = validateConfig({
  guard: { debounceMs: 500 },
  cache: { maxEntries: 1000 },
  breaker: {
    limits: { perDay: 20 },
    action: 'stop',
  },
})

// Throws ValiError with path info on invalid input
try {
  validateConfig({
    cache: { similarityThreshold: 2.0 },  // Invalid: must be 0-1
  })
} catch (err) {
  console.error(err)  // ValiError at "cache.similarityThreshold"
}
```
