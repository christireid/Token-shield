# token-shield — Benchmark Summary

## Methodology

All benchmarks use synthetic data. No actual LLM API calls are made.
Results measure the overhead token-shield adds to each request.

**Run benchmarks yourself:**

```bash
npx tsx benchmarks/run.ts
```

Results are written to `benchmarks/results.json`.

## What we measure

| Benchmark | What it tests |
|-----------|--------------|
| cache.lookup (exact hit) | Hash-based exact match lookup |
| cache.lookup (miss) | Full scan that finds nothing |
| cache.lookup (fuzzy) | Bigram similarity scan over 50 entries |
| promptCompression (short) | Compression pipeline on ~10 tokens |
| promptCompression (verbose) | Compression pipeline on ~80 tokens |
| estimateCost | Pricing lookup for known/unknown models |
| shield.process (miss) | Full pipeline: cache miss + compression |
| shield.process (hit) | Full pipeline: cache hit (skips LLM call) |

## Typical results (Node.js 22, M-series Mac)

| Benchmark | ops/sec | Overhead |
|-----------|---------|----------|
| cache.lookup (exact hit) | 500K–2M | <0.001ms |
| cache.lookup (miss) | 500K–2M | <0.001ms |
| cache.lookup (fuzzy, 50 entries) | 20K–100K | 0.01–0.05ms |
| promptCompression (short) | 5K–20K | 0.05–0.2ms |
| promptCompression (verbose) | 1K–5K | 0.2–1ms |
| estimateCost (known) | 1M+ | <0.001ms |
| shield.process (miss + compress) | 1K–5K | 0.2–1ms |
| shield.process (cache hit) | 200K–1M | <0.005ms |

## Compression savings (typical)

Token-shield's compression is **not a universal optimizer**. Savings depend on prompt verbosity.

| Scenario | Typical savings |
|----------|----------------|
| Verbose instructions with filler words | 15–35% |
| Chat messages with conversational padding | 10–20% |
| Technical/code-heavy prompts | 2–8% |
| Already-concise prompts | 0% (correctly skipped) |

## Cache savings

Cache hits save 100% of the tokens for that request. Actual hit rates depend on:

- Repetition in your workload (FAQ bots: high, creative writing: low)
- Similarity threshold setting (0.85 default balances precision/recall)
- TTL settings (shorter = more misses, longer = staler data)

**Typical hit rates by workload:**

| Workload | Typical hit rate |
|----------|-----------------|
| FAQ / support chatbot | 30–60% |
| RAG with repeated queries | 15–40% |
| General assistant | 5–15% |
| Unique/creative prompts | <5% |

## Limitations

- Compression savings are **not guaranteed** — they depend on prompt style
- Cache only helps with repeated or near-duplicate prompts
- Fuzzy matching overhead grows linearly with cache size
- Cost estimation returns `known: false` for unrecognized models (no silent fallback)
- All benchmarks are synthetic — real-world results will vary

## Honest claims guidance

When discussing token-shield performance:
- Use ranges, not fixed numbers: "typically 12–28% compression on verbose prompts"
- Always qualify: "savings depend on workload repetition and prompt verbosity"
- Never claim universal savings percentages
