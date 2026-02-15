# TokenShield SDK — Commercial-Grade Specification v3

## Executive Summary

TokenShield is a **client-side React/TypeScript SDK** that reduces LLM API costs by 40-80%. It is a zero-infrastructure middleware layer that intercepts LLM calls **before** they happen and optimizes them. The primary integration point is the Vercel AI SDK `wrapLanguageModel` middleware — developers add 3 lines of code and every call is optimized automatically.

**This specification replaces all previous specs and reports.** It defines the complete path to a commercial-grade npm package, including package architecture, dependency selection, module contracts, integration patterns, testing strategy, and build pipeline.

---

## Table of Contents

1. [Market Position](#1-market-position)
2. [Package Architecture](#2-package-architecture)
3. [Dependency Stack](#3-dependency-stack)
4. [Module Specifications](#4-module-specifications)
5. [Vercel AI SDK Middleware](#5-vercel-ai-sdk-middleware)
6. [React Integration](#6-react-integration)
7. [Configuration & Validation](#7-configuration--validation)
8. [Pricing Registry](#8-pricing-registry)
9. [Testing Strategy](#9-testing-strategy)
10. [Build & Release Pipeline](#10-build--release-pipeline)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Known Bugs & Required Fixes](#12-known-bugs--required-fixes)

---

## 1. Market Position

### The gap we fill

Every competitor (Helicone, Portkey, Langfuse, Braintrust, LiteLLM) is either a **server-side proxy** or an **observability platform**. They add 50-200ms latency, require backend infrastructure changes, and only **observe** costs after money is spent.

| Product         | Client-side?   | AI SDK Middleware? | Prevents costs? | Pricing             |
| --------------- | -------------- | ------------------ | --------------- | ------------------- |
| **TokenShield** | Yes            | Yes (native)       | Yes             | Free + $29/mo       |
| Helicone        | No (proxy)     | No (provider)      | No              | $20/seat/mo         |
| Portkey         | No (gateway)   | No (provider)      | Caching only    | Free + paid         |
| Langfuse        | No (Node OTel) | No                 | No              | Open source + cloud |
| Braintrust      | Partial        | Wrapper fn         | No              | Free + $249/mo      |
| LiteLLM         | No (Python)    | No                 | No              | Open source         |

**No competitor offers client-side middleware that actively prevents costs before the API call is made.** TokenShield runs entirely in the browser. Zero latency added. Zero infrastructure changes.

### Why the Vercel AI SDK is the moat

- 21k+ GitHub stars, THE standard for React AI apps
- GitHub Issue #3932 asked for cost calculation — Vercel closed it as "wontfix"
- `wrapLanguageModel` accepts middleware arrays — TokenShield composes with `extractReasoningMiddleware`, `defaultSettingsMiddleware`, and any other middleware
- Portkey is migrating AWAY from a custom provider pattern toward gateway URLs — validating that the middleware pattern is more future-proof

### Market data

- 85% of companies miss AI cost forecasts by 10%+ (25% miss by 50%+)
- 84% report AI costs reducing gross margins by 6%+
- Enterprise AI spend growing 72% YoY
- Prompt caching alone saves 45-80% on API costs (Stanford/arxiv study)

---

## 2. Package Architecture

Three tree-shakeable npm packages following the Clerk/PostHog/Sentry SDK pattern:

```
@tokenshield/core          — Zero-framework, runs anywhere (browser, Node, edge, Deno)
@tokenshield/react         — React bindings (Provider, hooks, components)
@tokenshield/ai-sdk        — Vercel AI SDK middleware factory
```

### @tokenshield/core

**Peer deps:** None
**Runtime deps:** `gpt-tokenizer` (exact BPE), `idb-keyval` (IndexedDB), `ohash` (cache keys), `mitt` (events), `valibot` (config validation)

Contains all 11 modules:

1. token-counter
2. cost-estimator
3. context-manager
4. response-cache
5. model-router
6. request-guard
7. prefix-optimizer
8. cost-ledger
9. tool-token-counter
10. stream-tracker
11. circuit-breaker

Plus the pricing registry and event bus.

### @tokenshield/react

**Peer deps:** `react >=18.0.0`, `@tokenshield/core`
**Runtime deps:** None

Contains: `TokenShieldProvider`, all hooks (`useSavings`, `useTokenCount`, `useComplexityAnalysis`, `useContextManager`, `useResponseCache`, `useRequestGuard`, `useModelRouter`, `useCostLedger`, `useFeatureCost`, `useBudgetAlert`), pre-built dashboard components.

### @tokenshield/ai-sdk

**Peer deps:** `ai >=4.0.0`, `@tokenshield/core`
**Runtime deps:** None

Contains: `tokenShieldMiddleware()` factory, AI SDK type adapters, streaming wrappers.

### Export structure

Use `package.json` `exports` map with granular entry points — no barrel files:

```json
{
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./token-counter": {
      "types": "./dist/token-counter.d.ts",
      "import": "./dist/token-counter.js"
    },
    "./cost-estimator": {
      "types": "./dist/cost-estimator.d.ts",
      "import": "./dist/cost-estimator.js"
    },
    "./context-manager": {
      "types": "./dist/context-manager.d.ts",
      "import": "./dist/context-manager.js"
    },
    "./response-cache": {
      "types": "./dist/response-cache.d.ts",
      "import": "./dist/response-cache.js"
    },
    "./model-router": { "types": "./dist/model-router.d.ts", "import": "./dist/model-router.js" },
    "./request-guard": {
      "types": "./dist/request-guard.d.ts",
      "import": "./dist/request-guard.js"
    },
    "./prefix-optimizer": {
      "types": "./dist/prefix-optimizer.d.ts",
      "import": "./dist/prefix-optimizer.js"
    },
    "./cost-ledger": { "types": "./dist/cost-ledger.d.ts", "import": "./dist/cost-ledger.js" },
    "./circuit-breaker": {
      "types": "./dist/circuit-breaker.d.ts",
      "import": "./dist/circuit-breaker.js"
    },
    "./pricing": { "types": "./dist/pricing.d.ts", "import": "./dist/pricing.js" }
  }
}
```

---

## 3. Dependency Stack

Every dependency is MIT/ISC/Apache-2.0 licensed, browser-compatible, TypeScript-first, and tree-shakeable.

### Core dependencies (estimated ~5 KB gzip total)

| Package         | Purpose                         | License | Bundle Impact                          | Why chosen                                                              |
| --------------- | ------------------------------- | ------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `gpt-tokenizer` | Exact BPE token counting        | MIT     | ~2-4 KB (single encoding, tree-shaken) | 100% accuracy for OpenAI, fastest pure JS tokenizer, already in project |
| `idb-keyval`    | IndexedDB persistence           | ISC     | ~295 B (get/set only)                  | Jake Archibald's micro-library, tree-shakeable to bytes                 |
| `ohash`         | Deterministic cache key hashing | MIT     | ~1 KB                                  | Synchronous, handles any JS value, UnJS ecosystem (4.6M downloads/wk)   |
| `mitt`          | Internal SDK event bus          | MIT     | ~200 B                                 | Wildcard handler, TypeScript generics, 10.7M downloads/wk               |
| `valibot`       | Config schema validation        | MIT     | ~1-2 KB (tree-shaken)                  | 90% smaller than Zod, Standard Schema support, modular                  |

### Packages evaluated and rejected

| Package                     | Reason for rejection                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `tiktoken` (WASM)           | Bundler config headaches in React/Next.js; gpt-tokenizer is faster and easier |
| `@anthropic-ai/tokenizer`   | Broken for Claude 3+ models, not browser-compatible, stale                    |
| `crypto-js`                 | Deprecated, 50KB+, security concerns; ohash + Web Crypto API are better       |
| `zustand`                   | Overkill for SDK internals; mitt + useSyncExternalStore is lighter            |
| `dexie`                     | 26KB gzip; idb-keyval is sufficient for key-value ledger storage              |
| `localforage`               | Stale (4 years), not tree-shakeable, localStorage fallback is a footgun       |
| `zod`                       | 15-17KB gzip; valibot achieves the same with ~1-2KB                           |
| `eventemitter3`             | 1.5KB, class-based, less tree-shakeable than mitt                             |
| `@huggingface/transformers` | 48MB, overkill for tokenization only                                          |
| `lightweight-charts`        | Apache 2.0 attribution requirement conflicts with white-label SDK             |

### Cross-provider tokenization strategy

There is **no viable client-side tokenizer** for Claude 3+ or Gemini models. Strategy:

| Provider  | Token counting approach                                                                           |
| --------- | ------------------------------------------------------------------------------------------------- |
| OpenAI    | `gpt-tokenizer` — exact (100% accuracy)                                                           |
| Anthropic | `gpt-tokenizer` as approximation (~90% accuracy), recommend `usage` from API response for billing |
| Google    | `gpt-tokenizer` as approximation (~85% accuracy), recommend `usage` from API response for billing |

The Cost Ledger always uses REAL token counts from provider `usage` objects for billing accuracy. Client-side counts are used only for pre-call estimation and UI display.

---

## 4. Module Specifications

### Module 1: Token Counter

**File:** `lib/tokenshield/token-counter.ts`

**Purpose:** Exact BPE token counting matching OpenAI's tiktoken.

**Exports:**

```typescript
countExactTokens(text: string): TokenCount
countChatTokens(messages: ChatMessage[], model?: string): ChatTokenCount
fitsInBudget(text: string, budget: number): boolean
encodeText(text: string): number[]
decodeTokens(tokens: number[]): string
truncateToTokenBudget(text: string, budget: number): string
countModelTokens(text: string, model: string): TokenCount
```

**Enhancement needed:**

- Add `countFast(text: string): number` — use character-based heuristic (~4 chars/token) for real-time UI typing feedback where exact count is too expensive. Uses the `tokenx` algorithm (17KB, MIT) inline — no dependency needed, just the formula: `Math.ceil(text.length / charsPerToken)` with CJK detection.

---

### Module 2: Cost Estimator

**File:** `lib/tokenshield/cost-estimator.ts`

**Purpose:** Real pricing data for all major LLM providers. Calculate costs pre-call and post-call.

**Exports:**

```typescript
estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens?: number): CostEstimate
compareCosts(inputTokens: number, outputTokens: number, models: string[]): CostComparison[]
calculateSavings(originalModel: string, originalTokens: number, optimizedTokens: number, outputTokens: number): SavingsResult
cheapestModelForBudget(budget: number, inputTokens: number, outputTokens: number): string | null
projectMonthlyCost(costPerCall: number, callsPerDay: number): MonthlyCostProjection
```

**Enhancement needed:**

- Extract `MODEL_PRICING` into a standalone `pricing-registry.ts` module (see Section 8)
- Add `cachedTokens` parameter to `estimateCost` to account for provider prompt cache discounts
- Add `estimateCostFromUsage(model: string, usage: AISDKUsage)` that accepts the AI SDK `usage` object directly

---

### Module 3: Context Manager

**File:** `lib/tokenshield/context-manager.ts`

**Purpose:** Token-budget-aware conversation history trimming. The biggest savings module — a 20-message conversation wastes 60-75% of tokens on history that does not affect the response.

**Exports:**

```typescript
fitToBudget(messages: Message[], budget: ContextBudget): ContextResult
slidingWindow(messages: Message[], windowSize: number): Message[]
priorityFit(messages: Message[], budget: ContextBudget): ContextResult
smartFit(messages: Message[], budget: ContextBudget): ContextResult
createSummaryMessage(messages: Message[]): Message
```

**Enhancement needed:**

- Integrate tool token counting: before trimming, calculate `countToolTokens(tools)` and subtract from the available budget. This prevents the context manager from leaving "room" that gets eaten by hidden tool overhead.
- Add `toolDefinitions?: ToolDefinition[]` to `ContextBudget` interface.

---

### Module 4: Response Cache

**File:** `lib/tokenshield/response-cache.ts`

**Purpose:** Client-side response caching with exact (SHA-256) and fuzzy (Bigram Dice) matching. Each cache hit = 100% cost savings for that request.

**Enhancement needed:**

- Replace manual SHA-256 with `ohash` for synchronous, deterministic cache key generation. Current implementation uses Web Crypto API which is async — adds unnecessary Promise overhead on hot path.
- Add `scopeByModel: boolean` config option (default: `true`) to separate cache entries by model ID.
- Add cache stats event emission via `mitt` for real-time dashboard updates.
- Add `maxAge` to individual cache entries for per-query TTL override.

---

### Module 5: Model Router

**File:** `lib/tokenshield/model-router.ts`

**Purpose:** Route requests to the cheapest model that can handle them correctly. 12-dimension complexity scoring, all computed client-side in <1ms.

**12 complexity dimensions:**

1. Token count (longer = higher complexity)
2. Vocabulary diversity (unique words / total words)
3. Average word length (technical jargon indicator)
4. Sentence count and structure
5. Question type (factual vs reasoning vs creative)
6. Code presence (regex detection)
7. Math/logic indicators
8. Multi-step indicators
9. Domain-specific jargon density
10. Negation complexity
11. Comparison indicators
12. Ambiguity level

**Enhancement needed:**

- Add cross-provider routing: the router currently only downgrades within a single provider's model family. Add support for routing across providers (e.g., GPT-4o → Claude Haiku 3.5 for simple queries).
- Ensure the router NEVER upgrades — it only downgrades from expensive to cheaper models. This prevents surprise cost increases.

---

### Module 6: Request Guard

**File:** `lib/tokenshield/request-guard.ts`

**Purpose:** Prevent wasteful API calls (double-clicks, rage-clicks, React StrictMode double-fires, empty prompts).

**Current API:**

```typescript
interface GuardConfig {
  debounceMs: number // default: 300
  maxRequestsPerMinute: number // default: 60
  maxCostPerHour: number // default: 10
  modelId: string
  deduplicateInFlight: boolean // default: true
}
```

**Enhancement needed (spec alignment):**

- Add `deduplicateWindow: number` (default: 5000ms) — maintain a map of recent prompt hashes with timestamps. Block any prompt whose hash matches one completed within the window. Currently only in-flight dedup exists.
- Add `minInputLength: number` (default: 2) — reject prompts shorter than this.
- Add `maxInputTokens: number` — reject prompts over budget before calling API. Uses `countExactTokens` for exact check.
- Emit events via `mitt` when requests are blocked, for dashboard updates.

---

### Module 7: Prefix Optimizer

**File:** `lib/tokenshield/prefix-optimizer.ts`

**Purpose:** Reorder messages to maximize OpenAI/Anthropic server-side prompt cache hits.

**How it works:**

1. System prompt → position 0 (always)
2. Pinned/critical messages → positions 1-N (stable order)
3. For Anthropic → auto-insert `cache_control: { type: "ephemeral" }` breakpoints
4. Calculate prefix token count eligible for caching
5. Report estimated savings

**Enhancement needed:**

- Add Anthropic cache breakpoint injection as a configurable option
- Use `detectProvider()` to automatically determine optimal prefix strategy

---

### Module 8: Cost Ledger

**File:** `lib/tokenshield/cost-ledger.ts`

**Purpose:** Track every dollar spent and saved using REAL numbers from provider `usage` objects.

**Per-request tracking:**

```typescript
interface LedgerEntry {
  id: string
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  actualCost: number
  costWithoutShield: number
  totalSaved: number
  feature?: string
  savings: {
    guard: number
    cache: number
    context: number
    router: number
    prefix: number
  }
}
```

**Enhancement needed:**

- Wire up `mitt` event emission for real-time React hook updates (currently uses custom subscriber pattern — unify on mitt)
- Add `byFeature` querying with proper React hook (`useFeatureCost`)
- Add JSON export for finance teams: `ledger.exportJSON()` and `ledger.exportCSV()`
- Add session boundary tracking (new session when page loads, track across sessions via IndexedDB)

---

### Module 9: Tool Token Counter

**File:** `lib/tokenshield/tool-token-counter.ts`

**Purpose:** Count hidden tokens in tool definitions, image inputs, and predict output length.

**Exports:**

```typescript
countToolTokens(tools: ToolDefinition[]): ToolTokenResult
optimizeToolDefinitions(tools: ToolDefinition[]): { tools: ToolDefinition[]; tokensSaved: number }
countImageTokens(width: number, height: number, detail: 'low' | 'high' | 'auto'): ImageTokenResult
predictOutputTokens(prompt: string, model: string, taskType?: string): OutputPrediction
```

**Enhancement needed:**

- Integrate `countToolTokens` into the context manager's budget calculation
- Use `predictOutputTokens` in the request guard to set smart `max_tokens` per request
- Validate `countImageTokens` against OpenAI's published tile calculation: 85 base + 170 per 512x512 tile

---

### Module 10: Stream Tracker

**File:** `lib/tokenshield/stream-tracker.ts`

**Purpose:** Real-time token counting during streaming responses, with abort survival.

```typescript
class StreamTokenTracker {
  constructor(config: StreamTrackerConfig)
  processChunk(chunk: string): void
  getUsage(): StreamUsage
  abort(): StreamUsage // Returns accurate usage even on abort
  onAbortUsage?: (usage: StreamUsage) => void
}
```

**Enhancement needed:**

- Wire into `wrapStream` in the AI SDK middleware. Currently implemented but not integrated.
- When a stream is aborted, fire `onAbortUsage` with accurate token counts so the cost ledger still tracks the spend.
- This fills Vercel AI SDK Issue #7628 (6+ thumbs-up, still open).

---

### Module 11: Circuit Breaker

**File:** `lib/tokenshield/circuit-breaker.ts`

**Purpose:** Hard spending limits that halt API calls when budgets are exceeded.

```typescript
interface BreakerLimits {
  perSession?: number // $ max per session
  perHour?: number // $ max per hour
  perDay?: number // $ max per day
  perMonth?: number // $ max per month
}

interface BreakerConfig {
  limits: BreakerLimits
  action: "warn" | "throttle" | "stop"
  persist?: boolean // Survive page refresh via IndexedDB
  onBreak?: (event: BreakerEvent) => void
}
```

**Enhancement needed:**

- Wire into middleware (currently requires manual instantiation)
- Add IndexedDB persistence for hourly/daily/monthly tracking that survives page refresh
- Emit events via `mitt` for dashboard alerts

---

## 5. Vercel AI SDK Middleware

**File:** `lib/tokenshield/middleware.ts`

### Target: `LanguageModelV3Middleware`

```typescript
import type { LanguageModelV3Middleware } from "@ai-sdk/provider"

export function tokenShieldMiddleware(
  config?: TokenShieldMiddlewareConfig,
): LanguageModelV3Middleware
```

### Pipeline execution order

```
User sends message
       |
       v
  transformParams:
    [0. CIRCUIT BREAKER] -- check spending limits
    [1. REQUEST GUARD]   -- debounce, dedup, rate limit, min length
    [2. CACHE LOOKUP]    -- check exact + fuzzy cache
    [3. CONTEXT TRIM]    -- trim history to token budget (accounts for tool tokens)
    [4. MODEL ROUTER]    -- route to cheapest capable model
    [5. PREFIX OPTIMIZE] -- reorder for provider cache hits
       |
       v
  wrapGenerate:
    if cache hit → return cached result, record in ledger
    else → call model, store in cache, record in ledger, update circuit breaker
       |
       v
  wrapStream:
    same as wrapGenerate but with StreamTokenTracker for real-time counting
    on abort → fire onAbortUsage, still record in ledger
```

### Integration: 3 lines

```typescript
import { wrapLanguageModel, streamText } from "ai"
import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: tokenShieldMiddleware({
    budget: { maxInputTokens: 2000 },
    cache: { enabled: true, persist: true },
    router: {
      tiers: [
        { modelId: "gpt-4o-mini", maxComplexity: 0.5 },
        { modelId: "gpt-4o", maxComplexity: 1.0 },
      ],
    },
    guard: { debounceMs: 300, deduplicateWindow: 5000 },
    breaker: { limits: { perDay: 50 }, action: "stop" },
  }),
})

const result = await streamText({ model, messages })
```

### Composability

TokenShield stacks with other middlewares — it does not compete:

```typescript
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: [
    tokenShieldMiddleware({ ... }),
    extractReasoningMiddleware({ tagName: 'think' }),
    defaultSettingsMiddleware({ temperature: 0.7 }),
  ],
})
```

### Usage data extraction from AI SDK

The middleware reads these fields from the AI SDK result:

```typescript
result.usage.promptTokens // total input tokens
result.usage.completionTokens // total output tokens
result.response.modelId // actual model that responded
// Provider-specific:
result.providerMetadata?.openai?.cachedPromptTokens
result.providerMetadata?.anthropic?.cacheReadInputTokens
result.providerMetadata?.anthropic?.cacheCreationInputTokens
```

---

## 6. React Integration

**File:** `lib/tokenshield/react.tsx`

### Provider pattern (follows Clerk/PostHog/Sentry patterns)

```tsx
<TokenShieldProvider config={{ defaultModel: "gpt-4o", budget: 4000 }}>
  <App />
</TokenShieldProvider>
```

**Requirements:**

1. **Graceful degradation** — if SDK fails to initialize, children render normally. Never break the user's app.
2. **Two initialization modes** — declarative (config prop) or imperative (pre-initialized instance):

   ```tsx
   // Declarative
   <TokenShieldProvider config={{ ... }}>

   // Imperative (for testing, SSR, etc.)
   <TokenShieldProvider instance={preInitializedShield}>
   ```

3. **Split context** — separate stable refs (config, cache, guard instances) from volatile state (savings, ledger data) to prevent unnecessary re-renders.

### Hooks

```typescript
// Real-time token counting as user types
useTokenCount(text: string, model?: string): { tokens, cost, characters, ratio }

// Fast approximate count for keystroke-level feedback
useTokenEstimate(text: string): { estimatedTokens: number }

// Cumulative session savings (reactive via useSyncExternalStore)
useSavings(): SavingsState

// Prompt complexity analysis with routing recommendation
useComplexityAnalysis(prompt: string, model?: string): RoutingDecision | null

// Context trimming within token budget
useContextManager(messages: Message[], budget: ContextBudget): ContextResult & { savings }

// Cache-wrapped API calls
useResponseCache(): { cachedFetch, stats }

// Request guard check
useRequestGuard(): { checkRequest, startRequest, completeRequest, stats }

// Model routing
useModelRouter(prompt: string, options?): { routing, confirmRouting }

// Cost ledger (full or per-feature)
useCostLedger(featureName?: string): LedgerSummary

// Per-feature cost shorthand
useFeatureCost(featureName: string): FeatureCostData

// Budget alerts (reacts to circuit breaker events)
useBudgetAlert(): { isOverBudget, currentSpend, limit, percentUsed }
```

### Internal state management

Use `useSyncExternalStore` with a lightweight external store pattern (already in place). The savings store and ledger emit change notifications; React hooks subscribe via `useSyncExternalStore`. This is the same pattern React 18+ uses internally and avoids adding any state management library.

For SDK internal events (budget exceeded, cache hit, model routed, etc.), use `mitt` as the event bus. Hooks subscribe in `useEffect` and unsubscribe on cleanup.

---

## 7. Configuration & Validation

Use `valibot` for runtime config validation. All config schemas are defined once and used for both runtime validation and TypeScript type inference.

```typescript
import * as v from "valibot"

const GuardConfigSchema = v.object({
  debounceMs: v.optional(v.pipe(v.number(), v.minValue(0)), 300),
  maxRequestsPerMinute: v.optional(v.pipe(v.number(), v.minValue(1)), 60),
  maxCostPerHour: v.optional(v.pipe(v.number(), v.minValue(0)), 10),
  deduplicateWindow: v.optional(v.pipe(v.number(), v.minValue(0)), 5000),
  minInputLength: v.optional(v.pipe(v.number(), v.minValue(0)), 2),
  maxInputTokens: v.optional(v.pipe(v.number(), v.minValue(1))),
})

const TokenShieldConfigSchema = v.object({
  modules: v.optional(
    v.object({
      guard: v.optional(v.boolean(), true),
      cache: v.optional(v.boolean(), true),
      context: v.optional(v.boolean(), true),
      router: v.optional(v.boolean(), false),
      prefix: v.optional(v.boolean(), true),
      ledger: v.optional(v.boolean(), true),
    }),
  ),
  guard: v.optional(GuardConfigSchema),
  cache: v.optional(CacheConfigSchema),
  context: v.optional(ContextConfigSchema),
  router: v.optional(RouterConfigSchema),
  prefix: v.optional(PrefixConfigSchema),
  ledger: v.optional(LedgerConfigSchema),
  breaker: v.optional(BreakerConfigSchema),
  onBlocked: v.optional(v.function()),
  onUsage: v.optional(v.function()),
})

export type TokenShieldConfig = v.InferOutput<typeof TokenShieldConfigSchema>
```

---

## 8. Pricing Registry

**File:** `lib/tokenshield/pricing-registry.ts`

A standalone, importable module containing pricing data for all supported models.

### Structure

```typescript
export interface ModelPricingEntry {
  id: string
  provider: 'openai' | 'anthropic' | 'google'
  name: string
  inputPerMillion: number
  outputPerMillion: number
  cachedInputDiscount: number   // 0.5 for OpenAI (50% off), 0.9 for Anthropic (90% off)
  contextWindow: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsFunctions: boolean
  deprecated?: boolean
}

export const PRICING_REGISTRY: Record<string, ModelPricingEntry> = { ... }
```

### Models to include (current as of Feb 2026)

**OpenAI:**

- GPT-4o ($2.50 / $10.00)
- GPT-4o-mini ($0.15 / $0.60)
- GPT-4.1 ($2.00 / $8.00)
- GPT-4.1-mini ($0.40 / $1.60)
- GPT-4.1-nano ($0.10 / $0.40)
- o1 ($15.00 / $60.00)
- o1-mini ($3.00 / $12.00)
- o3 ($10.00 / $40.00)
- o3-mini ($1.10 / $4.40)

**Anthropic:**

- Claude Opus 4 ($15.00 / $75.00)
- Claude Sonnet 4 ($3.00 / $15.00)
- Claude Haiku 3.5 ($0.80 / $4.00)

**Google:**

- Gemini 2.0 Flash ($0.10 / $0.40)
- Gemini 2.0 Pro ($1.25 / $5.00)
- Gemini 1.5 Flash ($0.075 / $0.30)
- Gemini 1.5 Pro ($1.25 / $5.00)

### Update strategy

Pricing data is embedded in the npm package as a static JSON object. Users get updated pricing by updating their `@tokenshield/core` version. Provide a `registerModel()` function for custom/fine-tuned models:

```typescript
import { registerModel } from "@tokenshield/core/pricing"

registerModel({
  id: "ft:gpt-4o-mini:my-org:custom:abc123",
  provider: "openai",
  name: "My Fine-tuned Model",
  inputPerMillion: 0.3,
  outputPerMillion: 1.2,
  cachedInputDiscount: 0.5,
  contextWindow: 128000,
  maxOutputTokens: 16384,
  supportsVision: false,
  supportsFunctions: true,
})
```

---

## 9. Testing Strategy

### Unit tests (Vitest + happy-dom)

Every module gets a dedicated test file. Use `vitest` as the runner with `happy-dom` as the DOM environment.

```
lib/tokenshield/__tests__/
  token-counter.test.ts
  cost-estimator.test.ts
  context-manager.test.ts
  response-cache.test.ts
  model-router.test.ts
  request-guard.test.ts
  prefix-optimizer.test.ts
  cost-ledger.test.ts
  tool-token-counter.test.ts
  stream-tracker.test.ts
  circuit-breaker.test.ts
  middleware.test.ts
  pricing-registry.test.ts
```

### React hook tests (@testing-library/react)

```
lib/tokenshield/__tests__/
  react/
    provider.test.tsx
    use-token-count.test.tsx
    use-savings.test.tsx
    use-cost-ledger.test.tsx
    use-response-cache.test.tsx
    use-request-guard.test.tsx
    use-model-router.test.tsx
    use-budget-alert.test.tsx
```

### Integration tests (MSW for API mocking)

Mock LLM provider APIs at the network level using MSW. Test the full middleware pipeline end-to-end without real API calls.

### What to test

| Module           | Key test cases                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| token-counter    | Exact match against known tiktoken output; chat message overhead formula; empty input; unicode/CJK                                          |
| cost-estimator   | Known model pricing; cached token discount; unknown model fallback                                                                          |
| context-manager  | 20-message conversation trimmed to budget; system prompt never trimmed; pinned messages preserved; tool token budget subtraction            |
| response-cache   | Exact hit; fuzzy hit above threshold; fuzzy miss below threshold; TTL expiry; IndexedDB persistence                                         |
| model-router     | Simple prompt → cheapest model; complex prompt → expensive model; never upgrades                                                            |
| request-guard    | Debounce blocks rapid calls; dedup blocks identical in-flight; dedup window blocks recent identical; rate limit fires                       |
| prefix-optimizer | System prompt always first; stable prefix across calls; Anthropic cache breakpoints                                                         |
| cost-ledger      | Records real usage; per-module attribution; per-feature filtering; IndexedDB persistence; export JSON/CSV                                   |
| circuit-breaker  | Session limit triggers stop; hourly limit triggers warn; daily limit persists across refresh                                                |
| stream-tracker   | Counts tokens as chunks arrive; abort returns accurate usage; integrates with ledger                                                        |
| middleware       | Full pipeline: guard → cache → context → router → prefix → ledger; cache hit short-circuits; blocked request throws TokenShieldBlockedError |

---

## 10. Build & Release Pipeline

### Bundling with tsup

Use `tsup` (MIT, zero-config esbuild-based bundler) for ESM + CJS dual output with `.d.ts` generation.

```typescript
// tsup.config.ts
import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "token-counter": "src/token-counter.ts",
    "cost-estimator": "src/cost-estimator.ts",
    // ... each module as a separate entry
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  clean: true,
  external: ["react", "react-dom", "ai"],
  treeshake: true,
})
```

### TypeScript config requirements

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "declaration": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  }
}
```

### CI pipeline

1. `pnpm install`
2. `pnpm lint` (ESLint)
3. `pnpm test` (Vitest)
4. `pnpm build` (tsup)
5. Bundle size check (fail if core > 15KB gzip)

---

## 11. Implementation Roadmap

### Phase 1: Core Module Hardening

Priority: Fix bugs and align modules with this spec.

1. **Add `valibot` dependency** and create config schemas for all modules
2. **Add `ohash` dependency** and replace async SHA-256 in response cache
3. **Add `mitt` dependency** and create unified SDK event bus
4. **Create `pricing-registry.ts`** — extract MODEL_PRICING into standalone module with `registerModel()`
5. **Fix request guard** — add `deduplicateWindow`, `minInputLength`, `maxInputTokens`
6. **Fix context manager** — integrate tool token counting into budget calculation
7. **Add `countFast()`** to token counter for real-time UI estimation

### Phase 2: Middleware Integration

Wire disconnected modules into the middleware pipeline.

8. **Wire stream tracker** into `wrapStream` — count tokens in real-time, handle abort
9. **Wire circuit breaker** into middleware — auto-instantiate from config, persist via IndexedDB
10. **Add `estimateCostFromUsage()`** to cost estimator — accept AI SDK usage objects directly
11. **Add usage field normalization** — handle both `promptTokens`/`completionTokens` and `inputTokens`/`outputTokens` from different AI SDK versions

### Phase 3: React Enhancement

12. **Add `useBudgetAlert` hook** — subscribe to circuit breaker events
13. **Add `useTokenEstimate` hook** — fast approximate count for keystroke feedback
14. **Improve `TokenShieldProvider`** — add graceful degradation, imperative initialization mode
15. **Add ledger export** — `exportJSON()` and `exportCSV()` methods

### Phase 4: Testing & Polish

16. **Add Vitest unit tests** for all 11 modules
17. **Add React hook tests** with @testing-library/react
18. **Add MSW integration tests** for full middleware pipeline
19. **Add tsup build config** and verify tree-shaking

---

## 12. Known Bugs & Required Fixes

### Bug 1: Usage field name normalization (FIXED in previous review)

**Problem:** OpenAI uses `prompt_tokens`/`completion_tokens`, Anthropic/Google use `input_tokens`/`output_tokens`.
**Status:** Fixed in `api-client.ts`. Both naming conventions are now exposed.

### Bug 2: Request guard API mismatch with spec

**Problem:** Spec defined `maxConcurrent`, `minInputLength`, `maxInputTokens`, `deduplicateWindow`. Implementation has `debounceMs`, `maxRequestsPerMinute`, `maxCostPerHour`, `deduplicateInFlight`.
**Fix:** Add the missing config fields to `GuardConfig` and implement the logic.

### Bug 3: Deduplication window not implemented

**Problem:** Only in-flight dedup exists. Once a request completes, identical prompts immediately pass through.
**Fix:** Add a `recentPrompts: Map<string, number>` (hash → timestamp) and block prompts matching within the `deduplicateWindow`.

### Bug 4: Stream tracker not wired into middleware

**Problem:** `StreamTokenTracker` exists but `wrapStream` in middleware does not use it.
**Fix:** Create a `TransformStream` in `wrapStream` that pipes chunks through `StreamTokenTracker.processChunk()` and records usage on completion or abort.

### Bug 5: Circuit breaker requires manual instantiation

**Problem:** Middleware config accepts `breaker` config but the breaker is instantiated inline. No IndexedDB persistence, no event emission.
**Fix:** Wire breaker into middleware lifecycle with optional persistence and mitt events.

### Bug 6: Tool tokens not subtracted from context budget

**Problem:** Context manager does not account for hidden tool definition tokens when calculating available budget.
**Fix:** Accept `toolDefinitions` in `ContextBudget`, call `countToolTokens()`, subtract from available tokens before trimming.

---

## Monetization Strategy

### Open Core Model (PostHog/Supabase pattern)

**Free tier (MIT license):** Everything that SAVES money.

- Token counter, context manager, response cache, model router, request guard, prefix optimizer
- Cost ledger (session-only)
- Vercel AI SDK middleware
- React hooks
- Circuit breaker (session-only)

**Pro tier ($29/month per project):** Everything that gives VISIBILITY.

- Persistent cost ledger (IndexedDB + cloud sync)
- Budget alerts (email/webhook)
- Per-feature cost attribution
- Historical analytics
- JSON/CSV export

**Team tier ($99/month, up to 10 seats):** Everything that enables GOVERNANCE.

- Per-user cost tracking
- Team budget management
- Role-based access
- Slack/Discord notifications
- SSO integration

---

_End of specification. This document is the single source of truth for TokenShield SDK development._
