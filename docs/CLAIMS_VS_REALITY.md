# CLAIMS vs REALITY

> Forensic verification of every claim in README.md and QUICKSTART.md against actual code.

## Verdict Summary

| Claim                                                       | Status              | Evidence                                                                                  |
| ----------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| "Drop-in middleware"                                        | **TRUE**            | shield() returns LanguageModelV3Middleware-compatible object                              |
| "without changing your prompts"                             | **TRUE**            | transformParams handles all optimization transparently                                    |
| "Works with Vercel AI SDK, OpenAI, and Anthropic"           | **TRUE**            | adapters.ts has createOpenAIAdapter, createAnthropicAdapter, createGenericAdapter         |
| "TypeScript-first"                                          | **TRUE**            | Strict TypeScript, full type exports, Valibot validation                                  |
| "v0.1.0-beta.1 (pre-release)"                               | **TRUE**            | package.json version matches                                                              |
| "Not yet published to npm"                                  | **TRUE**            | Honest, correct                                                                           |
| "Caching, compression, and cost tracking are on by default" | **TRUE**            | shield.ts defaults: cache=true, compression=true, trackCosts=true                         |
| "Semantic caching"                                          | **PARTIALLY TRUE**  | Uses bigram Dice coefficient, not semantic embeddings. "Near-duplicate" is more accurate. |
| "Prompt compression — removes redundancy"                   | **TRUE**            | prompt-compressor.ts implements 5 techniques                                              |
| "< 5ms overhead"                                            | **UNVERIFIED**      | No benchmark results in repo. Plausible for in-memory path but IDB reads may exceed this. |
| "Delete 3 lines to remove"                                  | **TRUE**            | import + wrapLanguageModel + shield() = 3 lines                                           |
| "Data stays in your infra"                                  | **TRUE**            | SECURITY.md confirms client-side only, zero telemetry                                     |
| "Model routing"                                             | **TRUE but opt-in** | router: false by default, with appropriate warnings                                       |
| "15-40% token savings" (compressor)                         | **UNVERIFIED**      | No production benchmarks. Tests show compression works but savings vary wildly by input.  |
| "MIT. Core optimization modules are free forever."          | **TRUE**            | LICENSE file is MIT. license.ts gates only team/enterprise features.                      |
| "All features are unlocked in development mode"             | **TRUE**            | license.ts checks NODE_ENV                                                                |
| repository URL in package.json                              | **WRONG**           | Points to `tokenshield/ai-sdk` but actual repo is `christireid/Token-shield`              |

## Detailed Findings

### 1. README Quick Start Code — VERIFIED WORKING

```typescript
import { wrapLanguageModel } from "ai"
import { openai } from "@ai-sdk/openai"
import { shield } from "@tokenshield/ai-sdk"
const model = wrapLanguageModel({ model: openai("gpt-4o"), middleware: shield() })
```

- `shield()` → returns TokenShieldMiddleware (middleware.ts:78)
- Has `transformParams`, `wrapGenerate`, `wrapStream` → compatible with AI SDK
- Imports are correct if package is installed/linked

### 2. Configuration Options — VERIFIED

All options in the shield() example exist in ShieldConfig interface:

- `cache: boolean` ✅ (default: true)
- `compression: boolean` ✅ (default: true)
- `monthlyBudget: number` ✅ (creates BreakerConfig)
- `dailyBudget: number` ✅ (creates BreakerConfig)
- `onUsage: callback` ✅ (forwarded to tokenShieldMiddleware)
- `similarityThreshold: number` ✅ (default: 0.85)
- `storage: StorageBackend` ✅ (passed to cache.backend)

### 3. Framework Adapters — VERIFIED

```typescript
// OpenAI adapter
const chat = createOpenAIAdapter(mw, (p) => openai.chat.completions.create(p))
// Anthropic adapter
const chat = createAnthropicAdapter(mw, (p) => anthropic.messages.create(p))
```

- Both exist in adapters.ts ✅
- Both properly run through transformParams → wrapGenerate pipeline ✅

### 4. getStats() — VERIFIED

```typescript
const stats = getStats(middleware)
// { totalSaved, totalSpent, savingsRate, cacheHitRate }
```

- getStats() exists in shield.ts:165 ✅
- Returns ShieldStats interface with all documented fields ✅
- `breakerTripped` field also returned (not shown in example but harmless) ✅

### 5. React Integration — NEEDS VERIFICATION

```typescript
import { TokenShieldProvider, useSavings, useBudgetAlert } from "@tokenshield/ai-sdk/react"
```

- React hooks exist in react-hooks-core.ts, react-hooks-budget.ts ✅
- TokenShieldProvider exists ✅
- `useSavings` returns `{ totalDollarsSaved, totalCacheHits }` — fields match README ✅

### 6. Advanced Imports — VERIFIED

```typescript
import { ResponseCache, CostLedger, RequestGuard } from "@tokenshield/ai-sdk/advanced"
```

- All three exported from advanced.ts ✅
- Standalone usage examples in QUICKSTART.md verified against actual APIs ✅

### 7. Runtime Compatibility Table — ACCURATE WITH CAVEAT

| Environment        | Claimed Behavior         | Reality                                    |
| ------------------ | ------------------------ | ------------------------------------------ |
| Browser            | IndexedDB persistent     | ✅ Uses idb-keyval                         |
| Node.js            | In-memory per-process    | ✅ storage-adapter.ts MemoryStore fallback |
| Vercel Edge        | In-memory per-invocation | ✅ isIndexedDBAvailable() returns false    |
| Cloudflare Workers | In-memory per-invocation | ✅ Same mechanism                          |

**Caveat**: README correctly warns about serverless cold starts.

### 8. CLAIMS THAT ARE WRONG OR MISLEADING

1. **package.json `repository.url`**: Points to `https://github.com/tokenshield/ai-sdk.git` — should be `https://github.com/christireid/Token-shield.git`

2. **package.json `homepage`**: Points to `https://github.com/tokenshield/ai-sdk#readme` — wrong repo

3. **package.json `bugs.url`**: Points to `https://github.com/tokenshield/ai-sdk/issues` — wrong repo

4. **"Semantic caching"**: The bigram Dice coefficient is lexical similarity, not semantic. "Near-duplicate caching" or "fuzzy caching" would be more honest. The trigram encoding is closer to semantic but still not embedding-based.

5. **"20-40% token savings" from compressor**: This is plausible for verbose prompts but the range is not validated against real traffic. Should be "up to 40% on verbose prompts" with caveat.

6. **`ai` peer dependency is marked optional**: This is the primary integration target. Making it optional is technically correct (adapters don't need it) but confusing since the primary example requires it.

### 9. DOCUMENTATION GAPS

1. **No API reference docs** — only JSDoc in source files
2. **No migration guide** — CHANGELOG mentions breaking changes but no migration path
3. **No real-world benchmark results** — all performance claims are theoretical
4. **No troubleshooting section** — common issues (IDB quota, CORS, SSR) not documented
5. **No deployment guide** — serverless caveats mentioned but no specific guides for Vercel/Cloudflare
