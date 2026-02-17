# token-shield

TypeScript middleware that reduces AI API costs via semantic caching, prompt compression, and cost tracking. Drop-in — no prompt rewrites required.

```
npm install token-shield
```

## Quick start

```ts
import { createShield } from "token-shield";

const shield = createShield({ cache: true, compression: true });

// Before each LLM call
const result = shield.process({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What is TypeScript?" }],
});

if (result.cached) {
  // Cache hit — skip the API call entirely
  console.log(result.cached.response);
} else {
  // Call your LLM with (possibly compressed) messages
  const response = await callYourLLM(result.messages);

  // Record for caching + cost tracking
  shield.record({
    model: "gpt-4o",
    prompt: "What is TypeScript?",
    response: response.text,
    inputTokens: response.usage.promptTokens,
    outputTokens: response.usage.completionTokens,
  });
}

console.log(shield.stats);
```

## Vercel AI SDK

```ts
import { withShield } from "token-shield";
import { wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: withShield({ cache: true, compression: true }),
});
```

## What it does

- **Semantic caching** — Exact and fuzzy match. Cache hits eliminate 100% of tokens for that request. Keys are model-scoped to prevent cross-model contamination.
- **Prompt compression** — Client-side, zero API calls. Removes filler words, contracts verbose patterns, deduplicates sentences. Typically 15–35% savings on verbose prompts.
- **Cost tracking** — Per-model, per-request cost estimation with 18 built-in model prices (OpenAI, Anthropic, Google). Unknown models explicitly return `known: false`.

## Stats output

```ts
{
  requests: 150,
  cacheHits: 47,
  cacheHitRate: 0.31,
  compressionTokensSaved: 12400,
  cacheTokensSaved: 94000,
  totalTokensSaved: 106400,
  totalEstimatedCost: 1.23,
  estimatedCostSaved: 0.85,
}
```

## Benchmarks

Benchmarks use synthetic data. No API calls. Run them yourself:

```bash
npx tsx benchmarks/run.ts
```

| Operation | Typical overhead |
|-----------|-----------------|
| Cache lookup (exact hit) | <0.002ms |
| Cache lookup (fuzzy, 50 entries) | ~0.2ms |
| Prompt compression (~80 tokens) | ~0.09ms |
| Cost estimation | <0.001ms |
| Full shield.process (cache hit) | <0.002ms |

Compression savings depend on prompt verbosity:
- Verbose instructions: 15–35%
- Conversational messages: 10–20%
- Technical/code prompts: 2–8%
- Already-concise prompts: 0% (correctly skipped)

See [benchmarks/summary.md](benchmarks/summary.md) for methodology and honest claims guidance.

## Runtime support

| Runtime | Status |
|---------|--------|
| Node.js 18+ | Supported |
| Vercel Edge | Supported |
| Cloudflare Workers | Untested (likely works) |
| Browser | Not supported in v1 |

No Node-only APIs. Cache is in-memory (no IndexedDB, no filesystem).

## API

| Export | Type | Description |
|--------|------|-------------|
| `createShield` | function | Create a shield instance |
| `shield` | function | Alias for `createShield` |
| `semanticCache` | function | Standalone semantic cache |
| `promptCompression` | function | Compress a prompt |
| `costTracker` | function | Create a cost accumulator |
| `estimateCost` | function | One-shot cost calculation |
| `withShield` | function | Vercel AI SDK middleware |
| `ShieldOptions` | type | Configuration type |
| `ShieldStats` | type | Stats output type |

Full API documentation: [docs/api-spec.md](docs/api-spec.md)

## Limitations

- Cache is in-memory only. Does not persist across process restarts.
- Compression is English-focused. Non-English prompts may see reduced savings.
- Token counting uses OpenAI's BPE encoding. Approximate for Anthropic (~35% divergence) and Google (~12%).
- Unknown models return `known: false` with zero cost — no fabricated estimates.
- Fuzzy matching is O(n) per lookup. Performance degrades above ~10K cache entries.

Full limitations: [docs/limitations.md](docs/limitations.md)

## Roadmap

- [ ] Persistent cache (Redis, SQLite)
- [ ] Multi-language compression
- [ ] Request deduplication
- [ ] Cost alerting / budget limits
- [ ] Dashboard / analytics (optional)

## License

MIT
