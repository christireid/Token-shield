# PROJECT MAP — TokenShield SDK

> Generated: 2026-02-21 | Version: 0.1.0-beta.1 | Audit pass: 2

---

## Repository Structure

```
Token-shield/
├── lib/tokenshield/           # SDK source (~48 source files + ~21 test files)
│   ├── index.ts               # Main barrel — ~10 exports (shield, getStats, types)
│   ├── advanced.ts            # Power-user barrel — 70+ exports (all modules)
│   ├── shield.ts              # Zero-config entry point: shield() + getStats()
│   ├── middleware.ts           # Middleware factory: tokenShieldMiddleware()
│   ├── middleware-types.ts     # Config types, safeCost(), extractLastUserText()
│   ├── middleware-transform.ts # transformParams pipeline (649 lines)
│   ├── middleware-wrap.ts      # wrapGenerate/wrapStream (517 lines)
│   ├── middleware-plugin.ts   # Plugin registry
│   ├── response-cache.ts     # Fuzzy+exact cache (bigram Dice, IDB, LRU) (698 lines)
│   ├── request-guard.ts      # Rate limit, debounce, dedup, cost gate
│   ├── cost-ledger.ts        # Per-request cost tracking, CSV/JSON export (539 lines)
│   ├── cost-estimator.ts     # MODEL_PRICING, estimateCost(), compareCosts()
│   ├── pricing-registry.ts   # Auto-generated model pricing (728 lines, generated)
│   ├── circuit-breaker.ts    # Spending limits (warn/throttle/stop)
│   ├── context-manager.ts    # 4 trimming algorithms
│   ├── model-router.ts       # 12-signal complexity scorer, routeToModel()
│   ├── prefix-optimizer.ts   # Provider prompt cache optimization
│   ├── token-counter.ts      # BPE-accurate counting (gpt-tokenizer)
│   ├── stream-tracker.ts     # Real-time output token counting
│   ├── user-budget-manager.ts # Per-user daily/monthly quotas (545 lines)
│   ├── prompt-compressor.ts  # Client-side token compression
│   ├── conversation-delta-encoder.ts # Cross-turn redundancy elimination
│   ├── audit-log.ts          # Tamper-evident hash chain
│   ├── license.ts            # Open-core license gating (HMAC/ECDSA)
│   ├── crypto-store.ts       # AES-GCM encrypted IndexedDB
│   ├── storage-adapter.ts    # IDB + MemoryStore abstraction
│   ├── event-bus.ts          # mitt-based pub/sub
│   ├── logger.ts             # Structured logger with spans
│   ├── errors.ts             # 5 error classes, 15 error codes
│   ├── config.ts             # Valibot schemas
│   ├── adapters.ts           # Framework adapters (OpenAI, Anthropic, Generic)
│   ├── provider-adapter.ts   # Multi-provider health + routing
│   ├── fuzzy-similarity.ts   # FuzzySimilarityEngine
│   ├── semantic-minhash.ts   # MinHash LSH
│   ├── tool-token-counter.ts # Function def + image token estimation
│   ├── output-predictor.ts   # Output token prediction
│   ├── pipeline.ts           # Composable pipeline builder
│   ├── savings-calculator.ts # ROI estimation utility
│   ├── shield-worker.ts      # Web Worker interface
│   ├── benchmark.ts          # Performance benchmark
│   ├── delta-encoder.ts      # Re-export alias
│   ├── create-token-shield.ts # Factory API
│   ├── react.tsx             # 17 React hooks
│   └── data/models.json      # Pricing source of truth
├── app/                       # Next.js demo site
│   ├── layout.tsx, page.tsx   # Landing page
│   ├── dashboard/page.tsx     # Dashboard
│   └── api/{openai,anthropic,google}/route.ts  # API proxies
├── components/                # Demo site components
│   ├── hero.tsx, features.tsx, cost-projection.tsx
│   ├── live-demo.tsx, playground.tsx, code-section.tsx
│   ├── dashboard/, ui/        # Dashboard + shadcn primitives
├── scripts/                   # sync-pricing.ts, validate-pricing.ts
├── examples/                  # interactive-demo, existing-sdk-integration
├── docs/                      # Audit deliverables
├── package.json, tsup.config.ts, tsconfig.json, vitest.config.ts
├── README.md, QUICKSTART.md, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md
└── LICENSE (MIT)
```

## Runtime Dependencies (4)

| Package         | Purpose                     | Size   |
| --------------- | --------------------------- | ------ |
| `gpt-tokenizer` | BPE-accurate token counting | ~180KB |
| `idb-keyval`    | IndexedDB key-value store   | ~573B  |
| `mitt`          | Type-safe event emitter     | ~200B  |
| `valibot`       | Schema validation           | ~6KB   |

## Peer Dependencies (1)

| Package | Purpose                              | Optional |
| ------- | ------------------------------------ | -------- |
| `ai`    | Vercel AI SDK middleware integration | No       |

## Build Entry Points (8)

| Entry           | Source                          | Purpose                         |
| --------------- | ------------------------------- | ------------------------------- |
| `index`         | `index.ts`                      | Main barrel (~10 exports)       |
| `advanced`      | `advanced.ts`                   | Power-user barrel (70+ exports) |
| `react`         | `react.tsx`                     | 17 React hooks                  |
| `license`       | `license.ts`                    | License gating                  |
| `audit-log`     | `audit-log.ts`                  | Audit logging                   |
| `compressor`    | `prompt-compressor.ts`          | Prompt compression              |
| `delta-encoder` | `conversation-delta-encoder.ts` | Delta encoding                  |
| `middleware`    | `middleware.ts`                 | Middleware factory              |

## Test Health

- **68 test files, 1338 tests passing**
- **0 skipped/disabled tests**
- **0 TODO/FIXME/HACK comments in source**
- TypeScript strict mode: clean (0 errors)

## Evidence of Users: **ZERO**

- Not published to npm
- No external GitHub issues
- No testimonials or case studies
- No npm download stats
- No Vercel/Netlify deployment evidence

## Revenue: **$0**

- Open-core licensing code exists but no payment integration
- No pricing page
- No Stripe/Paddle/LemonSqueezy
