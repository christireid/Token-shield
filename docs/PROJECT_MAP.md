# PROJECT MAP

> Auto-generated forensic index of every file, module, and dependency in TokenShield.

## Repository Structure

```
Token-shield/
├── lib/tokenshield/          # Core SDK (51 source files + 47 test files)
│   ├── index.ts              # Public barrel — ~15 exports (shield, getStats, adapters, estimateCost, StorageBackend)
│   ├── advanced.ts           # Power-user barrel — ~80 exports (all standalone modules)
│   ├── shield.ts             # Zero-config entry point: shield() + getStats()
│   ├── middleware.ts          # Main middleware factory: tokenShieldMiddleware()
│   ├── middleware-types.ts    # Config interfaces, SHIELD_META, safeCost(), extractLastUserText()
│   ├── middleware-transform.ts# transformParams pipeline (breaker→budget→guard→cache→compress→delta→context→route→prefix)
│   ├── middleware-wrap.ts     # wrapGenerate + wrapStream (cache return, ledger, budget recording)
│   ├── middleware-plugin.ts   # Plugin registry (registerPlugin/unregisterPlugin)
│   ├── response-cache.ts     # Semantic + exact cache (bigram Dice, trigram, IndexedDB, LRU eviction)
│   ├── request-guard.ts      # Rate limit, debounce, dedup, cost gate
│   ├── cost-ledger.ts        # Per-request cost tracking, BroadcastChannel cross-tab sync, CSV/JSON export
│   ├── cost-estimator.ts     # MODEL_PRICING from pricing-registry, estimateCost(), compareCosts()
│   ├── pricing-registry.ts   # Single source of truth: 40+ model pricing entries
│   ├── circuit-breaker.ts    # Spending limits (per-hour/day/month), warn/throttle/stop
│   ├── context-manager.ts    # 4 trimming algorithms: fitToBudget, slidingWindow, priorityFit, smartFit
│   ├── model-router.ts       # Heuristic complexity scorer (12 signals), routeToModel()
│   ├── prefix-optimizer.ts   # Provider prompt cache optimization (OpenAI, Anthropic, Google)
│   ├── token-counter.ts      # BPE-accurate counting via gpt-tokenizer
│   ├── stream-tracker.ts     # Real-time output token counting during streaming
│   ├── user-budget-manager.ts # Per-user daily/monthly quotas with tier routing
│   ├── anomaly-detector.ts   # Z-score based cost/token anomaly detection
│   ├── prompt-compressor.ts  # 5-technique client-side compression (stopword, dedup, patterns)
│   ├── conversation-delta-encoder.ts # Cross-turn redundancy elimination
│   ├── audit-log.ts          # Tamper-evident hash chain, IndexedDB persistence, JSON/CSV export
│   ├── license.ts            # Open-core tier gating (community/team/enterprise)
│   ├── crypto-store.ts       # AES-GCM encrypted IndexedDB (EncryptedStore)
│   ├── storage-adapter.ts    # IDB abstraction with in-memory fallback, StorageBackend interface
│   ├── event-bus.ts          # mitt-based pub/sub with typed events
│   ├── logger.ts             # Structured logger with span support
│   ├── errors.ts             # Typed error hierarchy (5 classes, 15 error codes)
│   ├── config-schemas.ts     # Valibot config validation schemas
│   ├── adapters.ts           # Framework adapters (Generic, OpenAI, Anthropic, Stream)
│   ├── provider-adapter.ts   # Multi-provider health tracking, routing, retries
│   ├── fuzzy-similarity.ts   # Trigram-based FuzzySimilarityEngine
│   ├── semantic-minhash.ts   # MinHash locality-sensitive hashing
│   ├── tool-token-counter.ts # Function definition + image token estimation
│   ├── output-predictor.ts   # Output length prediction by prompt type
│   ├── pipeline.ts           # Composable pipeline builder
│   ├── savings-calculator.ts # estimateSavings() for landing pages (SavingsCalculator React component not in core)
│   ├── benchmark.ts          # Performance benchmark utilities
│   ├── benchmark-scenarios.ts# Test scenarios for benchmark
│   ├── shield-worker.ts      # Web Worker wrapper for background processing
│   ├── create-token-shield.ts# Factory for fully configured instances
│   ├── delta-encoder.ts      # Re-export alias for conversation-delta-encoder
│   ├── adaptive-output-optimizer.ts # Adaptive output token optimization
│   ├── prompt-template-pool.ts     # Template pooling for common prompts
│   ├── token-optimizer.ts          # Token-level optimization strategies
│   ├── user-budget-types.ts        # Budget manager type helpers
│   ├── react-hooks-core.ts         # Core React hooks (useSavings, useBudgetAlert, etc.)
│   ├── react-hooks-budget.ts       # Budget-specific React hooks
│   ├── react-hooks-pipeline.ts     # Pipeline monitoring hooks
│   ├── react-context.test.ts       # React context tests
│   ├── data/models.json            # Single source of truth for model pricing
│   └── __tests__/                  # Additional test files
│       ├── dashboard-sections.test.ts
│       └── debug-compressor.test.ts
├── components/               # Demo/landing page React components
│   ├── features.tsx
│   ├── pricing-table.tsx
│   └── ...
├── hooks/                    # Demo app React hooks
│   ├── use-count-up.test.ts
│   ├── use-staggered-reveal.test.ts
│   └── use-reduced-motion.test.ts
├── examples/                 # Usage examples
│   └── README.md
├── scripts/                  # Build/dev scripts
│   ├── sync-pricing.ts       # Codegen: models.json → TypeScript
│   └── validate-pricing.ts   # Cross-reference pricing against llm-info
├── .github/
│   ├── workflows/ci.yml      # CI pipeline
│   ├── ISSUE_TEMPLATE/       # Bug report + feature request templates
│   └── pull_request_template.md
├── README.md                 # Primary docs
├── QUICKSTART.md            # Config reference
├── SECURITY.md              # Trust model & integration patterns
├── CONTRIBUTING.md          # Contributor guide
├── CHANGELOG.md             # Version history
├── LICENSE                  # MIT
├── package.json             # @tokenshield/ai-sdk v0.1.0-beta.1
├── tsconfig.json            # TypeScript strict config
├── tsup.config.ts           # Build config (tsup)
├── vitest.config.ts         # Test config
└── eslint.config.mjs        # ESLint config
```

## Module Dependency Graph (Core Pipeline)

```
shield.ts → middleware.ts → middleware-transform.ts → [response-cache, request-guard, context-manager, model-router, prefix-optimizer, prompt-compressor, conversation-delta-encoder]
                          → middleware-wrap.ts → [response-cache, stream-tracker, cost-ledger, user-budget-manager, anomaly-detector]
                          → [circuit-breaker, event-bus, logger, provider-adapter, audit-log, license, config-schemas]
```

## Package Exports Map

| Export Path       | Entry File             | Purpose                              |
| ----------------- | ---------------------- | ------------------------------------ |
| `.`               | `index.ts`             | Primary API (~15 exports)            |
| `./advanced`      | `advanced.ts`          | All standalone modules (~80 exports) |
| `./react`         | React hooks            | 15+ hooks for UI integration         |
| `./license`       | `license.ts`           | License management                   |
| `./audit-log`     | `audit-log.ts`         | Enterprise audit logging             |
| `./compressor`    | `prompt-compressor.ts` | Standalone compression               |
| `./delta-encoder` | `delta-encoder.ts`     | Standalone delta encoding            |
| `./middleware`    | `middleware.ts`        | Direct middleware access             |

## Dependencies (4 runtime)

| Package         | Size   | Purpose               |
| --------------- | ------ | --------------------- |
| `gpt-tokenizer` | ~180KB | BPE token counting    |
| `idb-keyval`    | ~573B  | IndexedDB persistence |
| `mitt`          | ~200B  | Event bus             |
| `valibot`       | ~6KB   | Config validation     |

## Test Coverage

- **68 test files, 1338 tests passing**
- Major test suites: middleware (47), response-cache (25), cost-ledger (18), model-router (20), shield (12), adapters (15), circuit-breaker (14), user-budget (28)

## Key Metrics

- Source files: 51 TypeScript files in lib/tokenshield/
- Test files: 47 test files
- Test/source ratio: 0.92 (excellent)
- Public API surface: ~15 exports (main) + ~80 exports (advanced)
- Runtime dependencies: 5
- Dev dependencies: 16
- Bundle target: < 500KB ESM
