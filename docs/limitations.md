# token-shield — Limitations

Honest documentation of where token-shield helps and where it doesn't.

## Where it helps

- **Repetitive workloads:** FAQ bots, support chatbots, RAG with repeated queries. Cache hits eliminate 100% of tokens for duplicated prompts.
- **Verbose prompts:** User messages with filler words, redundant phrases, and conversational padding. Compression typically saves 15–35%.
- **Cost visibility:** Even without savings, cost tracking shows exactly what you're spending per model.

## Where it doesn't help

- **Unique prompts:** Creative writing, one-off questions, novel content. Cache hit rate will be near zero.
- **Concise prompts:** Already-optimized prompts have little to compress. The compressor correctly skips these.
- **Output-heavy workloads:** Token-shield optimizes input tokens. If your costs are dominated by output tokens (e.g., code generation), savings will be proportionally smaller.
- **Streaming responses:** Cache hits return the full response immediately. If your UX depends on streaming, cached responses will feel different.

## Runtime limitations

- **Node.js 18+** and **Vercel Edge** are supported runtimes for v1.
- No browser support (no IndexedDB, no DOM dependencies, but also not tested in browsers).
- Cache is in-memory. Restarting the process clears all cached entries.
- No persistent storage in v1. Cache does not survive deploys or cold starts.

## Accuracy limitations

- **Token counting** uses `gpt-tokenizer` (OpenAI's BPE encoding). This is exact for OpenAI models but approximate for Anthropic (~35% divergence) and Google (~12% divergence).
- **Cost estimation** uses published per-million-token pricing. Actual bills may differ due to cached input discounts, batched API pricing, or enterprise agreements.
- **Unknown models** return `known: false` with zero cost. No fabricated estimates.

## Compression limitations

- Compression is English-focused. Non-English prompts may see reduced savings from stopword elision and pattern contraction.
- Code blocks, inline code, and URLs are preserved but the rest of the prompt is subject to compression.
- Very aggressive compression (ratio < 0.6) is rejected to prevent meaning loss.
- Compression is applied only to `user` role messages. System and assistant messages are never modified.

## Cache limitations

- In-memory only. No persistence across process restarts.
- Fuzzy matching scans all entries — O(n) per lookup. Performance degrades with very large caches (>10K entries).
- Similarity threshold (default 0.85) may produce false positives or false negatives depending on your prompt distribution.
- Cache keys include model ID. A gpt-4o response will never be returned for a claude-sonnet-4 request.

## What we don't do

- No prompt rewriting or semantic transformation
- No model selection or routing
- No rate limiting or budget enforcement
- No streaming interception
- No multi-turn conversation state management
- No observability/telemetry export (v1)

These may be considered for future versions based on user demand.
