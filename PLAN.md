# Token Shield: Implementation Plan to Increase Review Scores

**Goal**: Address every actionable finding from the 6-perspective review (avg 23.5/30) to push scores toward 28+/30. Reset version to pre-release.

---

## Phase 1: Version Reset + Repo Hygiene (LOW effort, HIGH trust signal)

**Targets**: Troll Dev (+1), Reddit (+1), VC (+0.5)

### 1.1 Reset version to pre-release

- `package.json`: `"version": "0.1.0-beta.1"`
- `CHANGELOG.md`: rename `[1.0.0]` header to `[0.1.0-beta.1]`
- `README.md`: update version badge to `v0.1.0-beta.1 (pre-release)`
- Signals honesty: "we know we're not v1 yet"

### 1.2 Clean repo artifacts

- Add `benchmark-results.txt` to `.gitignore` and `git rm` the file
- Move `MULTI-PERSPECTIVE-REVIEW.md` to `docs/` directory

---

## Phase 2: Honest Claims (HIGH effort, CRITICAL for credibility)

**Targets**: PM (+2), CEO (+2), Reddit (+2), VC (+1)

### 2.1 Downgrade hero savings claim

- `components/hero.tsx`: Change "60-80%" to "up to 40%" or remove the percentage entirely
- Replace with: "Cut your LLM costs. No backend required."
- The number should come from real benchmarks, not estimates. Until we have one, don't claim one.

### 2.2 Rework cost projection calculator

- `components/cost-projection.tsx`: Replace hardcoded `0.6` (60%) with a computed weighted estimate
- Use the actual savings calculator logic from `savings-calculator.tsx`:
  - Cache: `spend * duplicateRate` (user-configurable, default 15%)
  - Router: `spend * simpleRequestRate * 0.6` (default 25%)
  - Prefix: `spend * 0.4 * discountRate * 0.8 * 0.5`
  - Context: `spend * min((avgMsgs-8) * 0.015, 0.15)`
  - Guard: `spend * 0.03`
- Add a toggle: "Conservative (25%)" / "Typical (35%)" / "High-cache workloads (50%)"
- Show module-by-module breakdown with each assumption visible
- Add footnote: "Actual savings depend on your workload. These projections assume [stated assumptions]."

### 2.3 Add savings methodology section to README

- After the "Limitations" section, add "## How We Estimate Savings"
- Document each module's contribution with the formula and default assumptions
- State clearly: "We have not yet validated these estimates against production deployments."

---

## Phase 3: Cache Quality & Safety (HIGH effort, addresses CTO's biggest concern)

**Targets**: CTO (+2), Reddit (+1)

### 3.1 Document cache similarity thresholds per use case

- Add extensive JSDoc to `CacheConfig.similarityThreshold` in `response-cache.ts`:
  ```
  0.95+ — High-stakes: legal, medical, financial (few false positives, fewer cache hits)
  0.85-0.95 — General: support bots, FAQ, content generation (good balance)
  0.75-0.85 — Aggressive: e-commerce, marketing copy (more hits, risk of wrong answers)
  Below 0.75 — Not recommended: high false-positive rate
  ```
- Add JSDoc to `encodingStrategy` and `semanticSeeds` with usage examples

### 3.2 Add cache quality warning to shield() JSDoc

- In `shield.ts`, add a `@warning` note to `similarityThreshold`:
  ```
  A threshold of 0.85 means prompts that are 15% different may match.
  For safety-critical applications, use 0.95+. Test on your workload
  before production. Monitor cache hit quality via getStats().
  ```

### 3.3 Add cache quality test cases

- In `shield.test.ts` or a new `cache-quality.test.ts`, add adversarial similarity tests:
  - "What causes cancer?" vs "What cures cancer?" — should NOT match at 0.85
  - "What is the capital of France?" vs "What's the capital of France?" — SHOULD match
  - "Explain React hooks" vs "Explain React context" — borderline, document behavior

---

## Phase 4: Pluggable Cache Storage (MEDIUM effort, addresses serverless gap)

**Targets**: CTO (+2), PM (+1), Reddit (+1), VC (+1)

### 4.1 Define a StorageBackend interface

- In `storage-adapter.ts`, add:
  ```typescript
  export interface StorageBackend {
    get(key: string): Promise<unknown | undefined>
    set(key: string, value: unknown): Promise<void>
    del(key: string): Promise<void>
    clear(): Promise<void>
  }
  ```

### 4.2 Add storage backend option to CacheConfig

- In `response-cache.ts`, add `backend?: StorageBackend` to `CacheConfig`
- If `backend` is provided, use it instead of the default idb-keyval/Map fallback
- Backward compatible: omitting `backend` uses existing behavior

### 4.3 Add storage backend option to ShieldConfig

- In `shield.ts`, add `storage?: StorageBackend` to `ShieldConfig`
- Pass through to the cache config

### 4.4 Document the adapter pattern

- In README, add example:

  ```typescript
  import { shield } from "@tokenshield/ai-sdk"
  import { createClient } from "@vercel/kv"

  const kv = createClient({ url: process.env.KV_URL, token: process.env.KV_TOKEN })

  const middleware = shield({
    storage: {
      get: (key) => kv.get(key),
      set: (key, val) => kv.set(key, val),
      del: (key) => kv.del(key),
      clear: () => kv.flushdb(),
    },
  })
  ```

- This immediately unblocks: Vercel KV, Upstash Redis, Cloudflare KV, any key-value store

### 4.5 Update serverless documentation

- README runtime compatibility table: add "Vercel KV / Redis" row showing persistent caching
- Serverless caveat paragraph: change from "caching resets on cold start" to "use the `storage` option to persist cache across invocations"

---

## Phase 5: Interactive Demo Overhaul (MEDIUM effort, addresses Troll Dev's concern)

**Targets**: Troll Dev (+2), PM (+1)

### 5.1 Replace Math.random() with actual cache

- In `examples/interactive-demo/app/page.tsx`:
  - Import `ResponseCache` from the SDK
  - On first request for a prompt: cache miss, show API call simulation
  - On second request for same/similar prompt: cache hit, show instant response
  - Display actual similarity score from the cache lookup
- This lets users SEE semantic matching in action: type "What is React?" then "What's React?" and watch it match

### 5.2 Add similarity score display

- Show the actual similarity score on cache hits: "Cache HIT (similarity: 0.92)"
- Show the threshold: "Threshold: 0.85"
- This demonstrates the core technology instead of a coin flip

---

## Phase 6: Model Router Disclaimers (LOW effort, addresses CTO concern)

**Targets**: CTO (+1)

### 6.1 Add JSDoc warnings to router functions

- `model-router.ts`: Add `@warning` to `analyzeComplexity()` and `routeToModel()`:
  ```
  Complexity scoring uses heuristic analysis (vocabulary diversity,
  code detection, reasoning keywords), not ML. Results may not match
  human judgment. Always validate routing decisions on representative
  traffic before production use. Use dryRun mode to compare.
  ```

### 6.2 Add router disclaimer to QUICKSTART.md

- In the configuration section where `router: false` is shown, add a note:
  "Model routing is opt-in and uses heuristic scoring. Enable it with `shield({ router: true })` only after testing on your workload."

---

## Phase 7: Advanced Exports Trim (LOW effort, polish)

**Targets**: Troll Dev (+1)

### 7.1 Remove implementation-detail exports from advanced.ts

- Remove from `advanced.ts` (keep in internal modules):
  - `normalizeText` (cache internal)
  - `textSimilarity` (cache internal)
  - `classifyContentType` (cache internal)
  - `isPersistent` (storage internal)
  - `validateConfig` (config internal — nobody validates config manually)
  - `TokenShieldConfigSchema` (valibot schema — internal validation)
- This reduces advanced exports from 99 to ~90 while keeping everything users actually need

### 7.2 Update integration test

- Remove the trimmed exports from the expected exports list in `integration.test.ts`

---

## Phase 8: safeCost() Improvement (LOW effort, addresses CTO concern)

**Targets**: CTO (+1)

### 8.1 Log unknown model warnings more prominently

- In `middleware-types.ts`, change `console.warn` to emit a `shield:warning` event via the event bus
- This makes unknown model fallbacks observable via `onUsage` callback and event log

### 8.2 Document the fallback behavior in shield.ts JSDoc

- Add to ShieldConfig: "Budget enforcement uses model pricing data. For new/unknown models, fallback pricing ($0.15/M input, $0.60/M output) is used. Update model pricing data regularly for accurate tracking."

---

## Summary: Expected Score Impact

| Perspective      | Current     | Target      | Key Changes                                                       |
| :--------------- | :---------- | :---------- | :---------------------------------------------------------------- |
| Product Manager  | 22/30       | 26/30       | Honest claims, serverless fix, demo overhaul                      |
| CEO / Founder    | 23/30       | 26/30       | Honest claims, savings methodology, storage adapter               |
| CTO              | 25/30       | 28/30       | Cache quality docs, storage adapter, router disclaimers, safeCost |
| Troll Developer  | 24/30       | 27/30       | Real demo, exports trim, repo cleanup, version honesty            |
| Reddit           | 23/30       | 26/30       | Honest claims, serverless fix, methodology transparency           |
| VC Due Diligence | 24/30       | 26/30       | Version honesty, honest claims, storage adapter                   |
| **Average**      | **23.5/30** | **26.5/30** |                                                                   |

## Execution Order

1. Phase 1 (Version + Hygiene) — 15 min
2. Phase 2 (Honest Claims) — 1-2 hours
3. Phase 3 (Cache Quality) — 1-2 hours
4. Phase 4 (Storage Adapter) — 2-3 hours
5. Phase 5 (Demo Overhaul) — 1-2 hours
6. Phase 6 (Router Disclaimers) — 30 min
7. Phase 7 (Exports Trim) — 30 min
8. Phase 8 (safeCost) — 30 min

Run tests after each phase. Commit after each phase. Push at the end.
