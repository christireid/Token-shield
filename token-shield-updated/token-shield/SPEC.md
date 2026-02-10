# TokenShield SDK - Technical Product Specification v2

## Executive Summary

TokenShield is a client-side React/TypeScript SDK that reduces LLM API costs by 40-80%.
It is NOT a proxy. It is NOT an observability dashboard. It is a middleware layer that
intercepts LLM calls BEFORE they happen and optimizes them.

The #1 distribution vector is the Vercel AI SDK `wrapLanguageModel` middleware.
Developers add 3 lines of code. Every call through the AI SDK runs through TokenShield.
Zero refactoring.

---

## Why This Product Wins

### Gap 1: No client-side solution exists

Every competitor (Helicone, Portkey, LangSmith, Lunary, OpenRouter) is a server-side
proxy that requires routing ALL your API traffic through a third-party server. They:
- Add 50-200ms latency per request
- Require backend infrastructure changes
- Create vendor lock-in (your traffic flows through them)
- Only OBSERVE costs after money is already spent

TokenShield runs entirely in the browser/edge. Zero latency added. Zero infrastructure
changes. It PREVENTS costs before the API call is made.

### Gap 2: The Vercel AI SDK explicitly refuses to add cost tracking

GitHub issue #3932 (16+ upvotes) asked for cost calculation in the AI SDK.
Vercel closed it as "wontfix". That's 21k+ stars worth of developers with no
built-in cost management. We fill that gap with a native middleware.

### Gap 3: Provider prompt caching is free money that nobody helps you capture

OpenAI gives a 50% discount on cached input tokens (prompts >1024 tokens with
matching prefixes). Anthropic gives up to 90% discount. The catch: your message
array must have a STABLE prefix for the cache to hit. Nobody builds frontend
tooling that structures messages to maximize these cache hits. We do.

### Market data

- 85% of companies miss AI cost forecasts by 10%+ (25% miss by 50%+)
- 84% report AI costs reducing gross margins by 6%+
- Enterprise AI spend growing 72% YoY
- Prompt caching alone can save 45-80% on API costs (Stanford/arxiv study)

---

## Architecture: The Middleware Stack

TokenShield is a pipeline of 6 modules that execute in order before every LLM call.
Each module is independent and can be enabled/disabled individually.

```
User sends message
       |
       v
  [1. REQUEST GUARD] ---- blocks duplicates, rate limits, minimum length
       |
       v
  [2. RESPONSE CACHE] --- returns cached response if similar query exists (100% savings)
       |
       v
  [3. CONTEXT MANAGER] -- trims conversation history to token budget (40-60% savings)
       |
       v
  [4. MODEL ROUTER] ----- routes to cheapest capable model (up to 16x savings)
       |
       v
  [5. PREFIX OPTIMIZER] -- orders messages to maximize provider prompt cache hits (50% savings)
       |
       v
  [6. COST LEDGER] ------- records usage from response, tracks savings
       |
       v
  API call goes out (or doesn't, if guard/cache blocked it)
```

---

## Module Specifications

### Module 1: Request Guard

**Purpose:** Prevent wasteful API calls from ever being made.

**What it blocks (with proof):**
- Double-clicks: User clicks "Send" twice in 100ms. Without guard: 2 API calls.
  With guard: 1 call, second silently deduplicated.
- Rapid retries: User rage-clicks 5 times. Without: 5 calls. With: 1 call.
- React StrictMode: `useEffect` fires twice in dev. Without: 2 calls. With: 1 call.
- Empty/trivial prompts: "hi" or "" rejected before any API cost.

**API:**
```ts
interface RequestGuardConfig {
  debounceMs: number          // min ms between calls (default: 300)
  maxConcurrent: number       // max in-flight requests (default: 3)
  minInputLength: number      // reject prompts shorter than this (default: 2)
  maxInputTokens: number      // reject prompts over budget before calling API
  deduplicateWindow: number   // ms window to dedup identical requests (default: 5000)
}

interface GuardResult {
  allowed: boolean
  reason?: 'debounced' | 'rate_limited' | 'too_short' | 'over_budget' | 'duplicate' | 'aborted'
  requestId: string
}
```

**Vercel AI SDK middleware hook:** `transformParams` -- checks guard before params
reach the model. If blocked, throws a specific `TokenShieldBlockedError` that the
caller can catch and handle gracefully.

**Real test:** Fire 5 parallel calls without guard (5 billed). Fire 5 rapid calls
with guard (1 billed). Savings = exact dollar difference from `usage` objects.

---

### Module 2: Response Cache

**Purpose:** Return cached responses for identical or semantically similar queries
without making an API call. Each cache hit = 100% cost savings for that request.

**Two cache tiers:**
1. **Exact match** -- SHA-256 hash of `JSON.stringify(messages)`. O(1) lookup.
   Catches: identical retries, page refreshes, component re-mounts.
2. **Fuzzy match** -- Bigram Dice coefficient on the last user message text.
   Catches: rephrasings ("What's the weather?" vs "Tell me the weather"),
   typo corrections, word order changes.

**Why NOT vector embeddings:**
Embedding models (gte-small, all-MiniLM) require loading a 30-130MB ONNX model
into the browser and add 100-500ms per query. The bigram Dice coefficient:
- Runs in <1ms
- Zero download overhead
- Catches the 80% of duplicates that matter (rephrasings, typos)
- Is deterministic and explainable (you can see WHY it matched)

For the 20% of cases where semantic similarity matters (e.g., "How do I cook pasta?"
vs "What's a good recipe for spaghetti?"), exact-match misses are fine because
the API call is still optimized by context trimming, routing, and prefix caching.

**API:**
```ts
interface CacheConfig {
  maxSize: number              // max entries (default: 200)
  ttlMs: number                // time to live (default: 3600000 = 1 hour)
  similarityThreshold: number  // 0-1 for fuzzy match (default: 0.85)
  persist: boolean             // IndexedDB persistence (default: true)
  scopeByModel: boolean        // separate caches per model (default: true)
}

interface CacheLookupResult {
  hit: boolean
  matchType?: 'exact' | 'fuzzy'
  similarity?: number          // 0-1 similarity score
  entry?: { response: string, inputTokens: number, outputTokens: number, model: string }
  savedCost?: number           // dollar amount saved if hit
}
```

**Vercel AI SDK middleware hook:** `wrapGenerate` -- checks cache before calling
`doGenerate`. If hit, returns cached result with zero API call. Records savings
in the cost ledger. For streaming: `wrapStream` returns a simulated stream from
cached content.

**Real test:** Send query A. Send query A again (exact hit, $0 cost). Send query A
rephrased (fuzzy hit if similarity >= 0.85, $0 cost). All savings verified by
counting actual API calls made.

**Persistence:** `idb-keyval` for IndexedDB. Survives page refreshes. ~1.4KB
added to bundle. Paid tier adds export and cross-session analytics.

---

### Module 3: Context Manager

**Purpose:** Trim conversation history to fit a token budget while preserving
coherence. This is where the biggest savings live -- a 20-message conversation
can waste 60-75% of tokens on history that doesn't affect the response.

**The problem in numbers:**
- 20-message conversation: ~3,000-5,000 tokens
- System prompt + last 3-5 messages: ~800-1,500 tokens
- Difference: 2,000-3,500 tokens WASTED on every single API call
- At GPT-4o pricing ($2.50/M input): $0.005-0.009 wasted per call
- At 10,000 calls/day: $50-90/day = $1,500-2,700/month wasted

**Strategy: Priority-based sliding window with stable prefix**

```
[ALWAYS KEEP] System prompt (pinned, never trimmed)
[ALWAYS KEEP] Critical context messages (marked by developer)
[SLIDING WINDOW] Last N messages (configurable, default: 6)
[SUMMARIZE OR DROP] Everything between critical and window
```

**The prefix optimization insight:**
OpenAI prompt caching activates on prompts >1024 tokens and caches the LONGEST
matching prefix across requests. If our context manager always outputs messages
in a stable order:

```
1. System prompt (identical every time)           -- CACHED
2. Pinned/critical messages (same order each time) -- CACHED
3. Summary of old messages (stable-ish)            -- PARTIALLY CACHED
4. Recent sliding window (changes each turn)       -- NOT CACHED
```

Items 1-3 form a stable prefix. OpenAI automatically caches this and charges 50%
for those tokens. Anthropic gives up to 90% with explicit cache_control breakpoints.

**No other frontend tool does this.** Everyone sends messages in random order
or dumps the full history. We structure them for maximum provider-side cache hits.

**API:**
```ts
interface ContextManagerConfig {
  maxInputTokens: number       // total budget for input tokens
  reserveForOutput: number     // tokens to reserve for the response (default: 1000)
  keepSystemPrompt: boolean    // always include system messages (default: true)
  keepLastN: number            // always keep last N messages (default: 6)
  pinnedMessageIds?: string[]  // messages that must never be trimmed
  summaryModel?: string        // model to use for summarization (default: cheapest available)
  stablePrefix: boolean        // order messages for provider cache hits (default: true)
}

interface TrimResult {
  messages: ChatMessage[]      // the trimmed message array
  originalTokens: number       // tokens before trimming
  trimmedTokens: number        // tokens after trimming
  savedTokens: number          // difference
  savedCost: number            // dollar amount saved
  droppedCount: number         // messages removed
  summarized: boolean          // whether a summary was generated
  prefixTokens: number         // tokens in the stable prefix (eligible for provider cache)
}
```

**Vercel AI SDK middleware hook:** `transformParams` -- rewrites `params.prompt`
(the message array) to the trimmed version before it reaches the model.

**Real test:** Send 20-message conversation raw to GPT-4o-mini (record `prompt_tokens`
from usage). Run through context manager with 600-token budget. Send trimmed version
(record `prompt_tokens`). Savings = difference * model price. Both calls return
coherent responses.

---

### Module 4: Model Router

**Purpose:** Route each request to the cheapest model that can handle it correctly.
Most queries don't need the most expensive model.

**The pricing reality:**
| Model              | Input $/M  | Output $/M  | Relative cost |
|--------------------|-----------|-------------|---------------|
| GPT-4o             | $2.50     | $10.00      | 16.7x         |
| GPT-4o-mini        | $0.15     | $0.60       | 1x (baseline) |
| GPT-4.1            | $2.00     | $8.00       | 13.3x         |
| GPT-4.1-mini       | $0.40     | $1.60       | 2.7x          |
| GPT-4.1-nano       | $0.10     | $0.40       | 0.67x         |
| Claude Sonnet 4    | $3.00     | $15.00      | 20x           |
| Claude Haiku 3.5   | $0.80     | $4.00       | 5.3x          |

"What's the capital of France?" costs the same to answer correctly on GPT-4o ($2.50/M)
and GPT-4.1-nano ($0.10/M). That's a 25x cost difference for identical output quality.

**Complexity scoring (12 dimensions, all computed client-side in <1ms):**

1. Token count (longer prompts = higher complexity)
2. Vocabulary diversity (unique words / total words)
3. Average word length (longer words = more technical)
4. Sentence count and structure
5. Question type (factual lookup vs reasoning vs creative)
6. Code presence (regex detection of code patterns)
7. Math/logic indicators ("calculate", "prove", "if...then")
8. Multi-step indicators ("first...then", "step 1", numbered lists)
9. Domain-specific jargon density
10. Negation complexity ("not", "except", "unless")
11. Comparison indicators ("vs", "compare", "difference between")
12. Ambiguity level (pronouns without clear antecedents)

Each dimension scores 0-1. Weighted sum produces a complexity score 0-1.
Thresholds map to model tiers.

**API:**
```ts
interface RouterConfig {
  tiers: ModelTier[]           // ordered cheapest to most expensive
  complexityThreshold: number  // score above which to upgrade (default: 0.6)
  forceModel?: string          // override for specific use cases
  trackAccuracy: boolean       // track if cheap model was sufficient (default: true)
}

interface ModelTier {
  modelId: string
  maxComplexity: number        // route here if complexity <= this value
  inputPricePerMillion: number
  outputPricePerMillion: number
}

interface RouteDecision {
  selectedModel: string
  originalModel: string
  complexityScore: number
  dimensions: Record<string, number>  // individual dimension scores
  savedCostEstimate: number    // estimated savings vs original model
  confidence: number           // 0-1 how confident we are in the routing
  reason: string               // human-readable explanation
}
```

**Vercel AI SDK middleware hook:** `transformParams` -- changes `params.modelId`
to the routed model before the call is made. The `wrapGenerate` post-hook records
which model actually responded for accuracy tracking.

**Real test:** Send "What is the capital of France?" to GPT-4o (expensive) and
through the router (routes to GPT-4o-mini). Compare: same correct answer,
16x cheaper. Both `usage` objects prove the token counts and model used.

**Important constraint:** The router NEVER upgrades a model. If the user specifies
GPT-4o-mini, the router can only keep it at GPT-4o-mini. It only DOWNGRADES
from expensive models when the query doesn't need them. This prevents surprise
cost increases.

---

### Module 5: Prefix Optimizer (NEW -- not in v1)

**Purpose:** Reorder and structure the message array to maximize OpenAI/Anthropic
server-side prompt cache hits.

**How provider caching works:**
- OpenAI: Automatic. Caches the longest matching PREFIX of prompts >1024 tokens.
  Cached tokens cost 50% of normal. Cache lives ~5-10 minutes.
- Anthropic: Explicit. Developer places `cache_control` breakpoints in messages.
  Cached tokens cost 10% of normal (90% discount). Cache lives ~5 minutes.

**What the optimizer does:**
1. Moves system prompt to position 0 (always)
2. Moves pinned/critical messages to positions 1-N (stable order)
3. For Anthropic: automatically inserts `cache_control: { type: "ephemeral" }`
   breakpoints at optimal positions
4. Calculates the exact prefix token count eligible for caching
5. Reports estimated cache savings based on provider's discount rate

**API:**
```ts
interface PrefixOptimizerConfig {
  provider: 'openai' | 'anthropic' | 'auto'  // auto-detect from model name
  enableAnthropicCacheControl: boolean         // insert cache_control breakpoints
}

interface PrefixResult {
  messages: ChatMessage[]
  prefixTokens: number         // tokens in stable prefix
  estimatedCacheDiscount: number  // 0.5 for OpenAI, 0.9 for Anthropic
  estimatedSavings: number     // dollar amount if prefix is cached
}
```

**Vercel AI SDK middleware hook:** `transformParams` -- runs after context manager,
reorders the already-trimmed messages for optimal prefix stability.

---

### Module 6: Cost Ledger

**Purpose:** Track every dollar spent and every dollar saved, using REAL numbers
from the provider's `usage` response. Not estimates.

**Data sources:**
- `usage.prompt_tokens` from OpenAI/Anthropic response
- `usage.completion_tokens` from response
- `usage.cached_tokens` from OpenAI (when prompt cache hits)
- Model name from response (to look up real pricing)
- Module attribution (which module saved how much)

**What it tracks per request:**
```ts
interface LedgerEntry {
  id: string
  timestamp: number
  model: string
  inputTokens: number          // from usage.prompt_tokens
  outputTokens: number         // from usage.completion_tokens
  cachedTokens: number         // from usage.cached_tokens (if available)
  actualCost: number           // real dollars spent
  costWithoutShield: number    // what it would have cost without TokenShield
  totalSaved: number           // difference

  // Per-module attribution
  savings: {
    guard: number              // $ saved by blocking duplicate/wasteful calls
    cache: number              // $ saved by cache hits
    context: number            // $ saved by trimming history
    router: number             // $ saved by model downgrading
    prefix: number             // $ saved by provider cache hits
  }
}
```

**What it tracks cumulatively:**
```ts
interface LedgerSummary {
  totalSpent: number
  totalSaved: number
  totalCalls: number
  callsBlocked: number         // guard blocked
  cacheHits: number            // cache returned
  cacheHitRate: number         // percentage
  avgCostPerCall: number
  avgSavingsPerCall: number
  savingsRate: number          // totalSaved / (totalSpent + totalSaved)
  byModule: Record<string, number>  // savings breakdown
  byModel: Record<string, { calls: number, cost: number }>  // per-model breakdown
}
```

**Vercel AI SDK middleware hook:** `wrapGenerate` post-hook -- reads the `usage`
object from the result and records it. `wrapStream` post-hook -- accumulates
usage from stream completion.

**Free tier:** Session-only tracking (resets on page refresh). React hooks for
real-time display.

**Paid tier:** IndexedDB persistence, cross-session history, JSON export, webhook
notifications when budget thresholds are crossed, per-feature attribution.

---

## Vercel AI SDK Integration (The Distribution Moat)

### 3-line integration

```tsx
import { wrapLanguageModel, streamText } from 'ai'
import { tokenShield } from '@tokenshield/ai-sdk'

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: tokenShield({
    budget: { maxInputTokens: 2000 },
    cache: { enabled: true, persist: true },
    router: {
      tiers: [
        { modelId: 'gpt-4o-mini', maxComplexity: 0.5, inputPrice: 0.15, outputPrice: 0.60 },
        { modelId: 'gpt-4o', maxComplexity: 1.0, inputPrice: 2.50, outputPrice: 10.00 },
      ]
    },
    guard: { debounceMs: 300 },
  }),
})

// Use exactly like before -- ALL optimizations are automatic
const result = await streamText({ model, messages })
```

### Technical implementation

The middleware implements `LanguageModelV3Middleware` from `@ai-sdk/provider`:

```ts
import type { LanguageModelV3Middleware } from '@ai-sdk/provider'

export function tokenShield(config: TokenShieldConfig): LanguageModelV3Middleware {
  return {
    transformParams: async ({ params }) => {
      // 1. Guard check
      // 2. Cache lookup (if hit, short-circuit)
      // 3. Context trimming (rewrite params.prompt)
      // 4. Model routing (rewrite params.modelId)
      // 5. Prefix optimization (reorder params.prompt)
      return modifiedParams
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      // If cache hit was flagged in transformParams, return cached result
      // Otherwise, call doGenerate() and record usage in cost ledger
      const result = await doGenerate()
      ledger.record(result.usage, params)
      return result
    },

    wrapStream: async ({ doStream, params }) => {
      // Same as wrapGenerate but for streaming
      // Accumulate usage from stream, record in ledger on completion
      const { stream, ...rest } = await doStream()
      const monitoredStream = stream.pipeThrough(createUsageMonitor())
      return { stream: monitoredStream, ...rest }
    },
  }
}
```

### Why this is defensible

1. **Network effect with the AI SDK ecosystem.** The AI SDK has 21k+ stars and
   is THE standard for React AI apps. Being a first-class middleware means
   every AI SDK user is a potential TokenShield user.

2. **Middleware composability.** TokenShield stacks with other middlewares
   (extractReasoningMiddleware, guardrails, RAG). It doesn't compete with them.

3. **Zero-config win.** The default config saves money immediately without any
   tuning. Developers see savings on their FIRST deploy.

---

## React Hooks API (for granular control)

For developers who want UI integration beyond the middleware:

```tsx
import {
  TokenShieldProvider,
  useTokenBudget,
  useCostLedger,
  useModelRouter,
  useResponseCache,
  useRequestGuard,
} from '@tokenshield/react'

// Provider wraps your app
<TokenShieldProvider config={{ defaultModel: 'gpt-4o', budget: 4000 }}>
  <App />
</TokenShieldProvider>

// Live token counting as user types
const { tokens, cost, withinBudget, breakdown } = useTokenBudget(messages)

// Real-time savings dashboard
const { totalSpent, totalSaved, savingsRate, breakdown } = useCostLedger()

// Manual routing control
const { route, decision } = useModelRouter()
const { model, reason, confidence } = decision

// Cache management
const { lookup, store, hitRate, clear } = useResponseCache()

// Guard status
const { check, isBlocked, reason } = useRequestGuard()
```

---

## Monetization Strategy

### Open Core Model (PostHog/Supabase pattern)

Research shows open-core achieves 40% faster community growth and stronger customer
retention than pure SaaS. PostHog reached $1.4B valuation with this model.

**Free tier (MIT license, npm package):**
Everything that SAVES money is free. This drives adoption.

- Token counter (exact BPE)
- Context manager (sliding window + priority trimming)
- Response cache (in-memory + IndexedDB)
- Model router (complexity scoring + routing)
- Request guard (debounce + dedup + rate limit)
- Prefix optimizer (message ordering for provider cache hits)
- Cost ledger (session-only, resets on refresh)
- Vercel AI SDK middleware
- React hooks

**Pro tier ($29/month per project):**
Everything that gives VISIBILITY is paid. This is what companies need.

- Persistent cost ledger (survives refresh, IndexedDB + cloud sync)
- Budget alerts (email/webhook when spend exceeds threshold)
- Cost attribution per feature (tag requests with feature names, see cost per feature)
- Historical analytics (trends, forecasts, anomaly detection)
- Export to JSON/CSV for finance teams
- Priority support

**Team tier ($99/month, up to 10 seats):**
Everything that enables GOVERNANCE is paid at the team level.

- Per-user cost tracking
- Team budget management (set per-developer or per-team limits)
- Role-based access (who can override router decisions)
- Slack/Discord notifications for budget alerts
- SSO integration
- Custom model tier configurations

### Why this pricing works

1. **Free tier is genuinely valuable.** It actually saves money. This isn't a
   crippled trial -- it's a production-grade tool. Developers adopt it because
   it works, not because of marketing.

2. **The upgrade trigger is organizational, not technical.** Individual devs
   don't need persistence or alerts. Companies do when the CFO asks
   "how much are we spending on AI?" The free tier has no answer. Pro does.

3. **$29/month is a trivial line item for a project spending $500+/month on AI.**
   If TokenShield saves 40-60% of that, the ROI is 7-10x the subscription cost.

4. **We never hold savings hostage.** If a dev wants to stay free forever and
   save money, they can. The paid tier sells convenience, not the savings themselves.

---

## NPM Package Architecture

Three packages, all tree-shakeable:

### @tokenshield/core
Zero-dependency except `gpt-tokenizer` (~600KB tree-shaken for single encoding).
Contains: token counter, cost estimator, context manager, response cache, model
router, request guard, prefix optimizer, cost ledger.

Works in any JS/TS environment (Node, browser, edge, Deno).

### @tokenshield/react
Peer deps: `react`, `@tokenshield/core`.
Contains: TokenShieldProvider, all hooks, React-specific state management.

### @tokenshield/ai-sdk
Peer deps: `ai` (>=6.0), `@tokenshield/core`.
Contains: `tokenShield()` middleware factory, AI SDK-specific types and utilities.

---

## Success Metrics

### Adoption
- npm weekly downloads (target: 1,000 in month 1, 10,000 in month 3)
- GitHub stars (target: 500 in month 1, 2,000 in month 3)
- AI SDK middleware ecosystem listing

### Proof of value
- Average savings rate across all users (target: 40%+)
- Token counter accuracy vs provider usage object (target: 99%+ match rate)
- Cache hit rate in production apps (target: 15-25%)
- Correct model routing rate (cheap model gives equivalent answer, target: 85%+)

### Revenue
- Free-to-paid conversion rate (target: 5-8% of active projects)
- Monthly recurring revenue (target: $5k MRR at month 6)
- Net revenue retention (target: 120%+ -- teams upgrade, not just pay)
