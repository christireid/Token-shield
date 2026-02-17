# token-shield — API Specification

## Public API (7 value exports + 2 type exports)

### `createShield(options?: ShieldOptions): Shield`

Creates a Shield instance that combines semantic caching, prompt compression, and cost tracking.

**Alias:** `shield` (identical function)

```ts
import { createShield } from "token-shield";

const s = createShield({
  cache: true,          // or { maxEntries: 200, ttlMs: 1800000 }
  compression: true,    // or { stopwords: true, patterns: true }
  costTracking: true,
});
```

**Shield instance methods:**

| Method | Description |
|--------|-------------|
| `process({ model, messages })` | Check cache, apply compression. Returns `ProcessResult`. |
| `record({ model, prompt, response, inputTokens, outputTokens })` | Store response in cache, track cost. |
| `stats` | Current `ShieldStats` (read-only). |
| `reset()` | Clear cache, stats, and cost tracking data. |

---

### `semanticCache(config?: CacheOptions): SemanticCache`

Creates a standalone semantic cache with exact + fuzzy matching.

```ts
import { semanticCache } from "token-shield";

const cache = semanticCache({ maxEntries: 200, similarityThreshold: 0.85 });
cache.store("What is TS?", "TypeScript is...", "gpt-4o", 10, 50);
const result = cache.lookup("what is typescript", "gpt-4o");
// result.hit === true
```

Cache keys are namespaced by model — different models never share cache entries.

**Methods:** `lookup(prompt, model)`, `store(prompt, response, model, inputTokens, outputTokens)`, `stats()`, `clear()`

---

### `promptCompression(text: string, options?: CompressionOptions): CompressionResult`

Compresses a prompt to reduce token count. Zero network overhead — purely algorithmic.

```ts
import { promptCompression } from "token-shield";

const result = promptCompression("Please kindly explain TypeScript...");
// result.savedTokens, result.ratio, result.techniques
```

Preserves code blocks, inline code, and URLs verbatim.

---

### `costTracker(): CostTracker`

Creates a cost accumulator for tracking spend over time.

```ts
import { costTracker } from "token-shield";

const tracker = costTracker();
tracker.record("gpt-4o", 1000, 500);
console.log(tracker.stats); // { requests: 1, totalCost: 0.0075, ... }
```

---

### `estimateCost(model: string, inputTokens: number, outputTokens: number): CostEstimate`

One-shot cost calculation.

```ts
import { estimateCost } from "token-shield";

const cost = estimateCost("gpt-4o", 1000, 500);
// cost.totalCost === 0.0075, cost.known === true

const unknown = estimateCost("my-model", 1000, 500);
// unknown.known === false, unknown.totalCost === 0
```

**Unknown models return `known: false` with zeroed costs. No silent fallback.**

---

### `withShield(options?: ShieldOptions): ShieldMiddleware`

Creates Vercel AI SDK-compatible middleware.

Available from both import paths:
```ts
import { withShield } from "token-shield";
// or
import { withShield } from "token-shield/vercel";
```

Usage with `wrapLanguageModel`:
```ts
import { withShield } from "token-shield";
import { wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: withShield({ cache: true, compression: true }),
});
```

---

### Types

All types are importable via `import type { ... } from "token-shield"`:

- `ShieldOptions` — Configuration for `createShield` / `withShield`
- `ShieldStats` — Cumulative statistics
- `Message` — Chat message (`{ role, content }`)
- `ProcessResult` — Return type of `shield.process()`
- `CostEstimate` — Return type of `estimateCost()`
- `CompressionResult` — Return type of `promptCompression()`
- `CostTrackerStats` — Return type of `costTracker().stats`
- `CacheOptions` — Cache configuration
- `CompressionOptions` — Compression configuration

#### `ShieldOptions`

```ts
interface ShieldOptions {
  cache?: boolean | CacheOptions;
  compression?: boolean | CompressionOptions;
  costTracking?: boolean;
  model?: string;
}
```

#### `ShieldStats`

```ts
interface ShieldStats {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  compressionTokensSaved: number;
  cacheTokensSaved: number;
  totalTokensSaved: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  estimatedCostSaved: number;
}
```

## Edge cases

- **Empty messages:** `process()` returns unchanged messages with no compression.
- **Very short prompts:** Compression skips if savings < `minSavingsTokens` (default 5).
- **Unknown models:** `estimateCost` returns `known: false`, cost = 0. No exception.
- **Cache key collisions:** djb2 hash collisions are guarded by normalized-text verification.
- **Cross-model contamination:** Cache keys include model ID. Different models never share entries.

## Supported models (built-in pricing)

OpenAI: gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano, o3, o3-mini, o4-mini, gpt-5
Anthropic: claude-opus-4, claude-sonnet-4, claude-sonnet-4.5, claude-haiku-3.5, claude-haiku-4.5
Google: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash

Prefix matching: `gpt-4o-2024-08-06` resolves to `gpt-4o` pricing.
