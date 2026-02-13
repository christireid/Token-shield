# TokenShield AI SDK - Project Index

> **Package:** `@tokenshield/ai-sdk` v0.2.0
> **License:** MIT
> **Runtime Size:** ~5 KB gzip (tree-shakeable)
> **Build:** tsup (esbuild) -> CJS + ESM + .d.ts
> **Tests:** Vitest (75% line/function coverage, 60% branch)

## Overview

TokenShield is a developer-first, client-side React/TypeScript SDK that reduces LLM API costs 30-60% without vendor lock-in. It runs entirely in the browser as middleware - zero infrastructure, zero latency added (<5ms), zero privacy risk (data never leaves the client).

---

## Directory Structure

```
Token-shield/
├── lib/tokenshield/           # SDK source (all core code lives here)
│   ├── index.ts               # Main barrel export (60+ named exports)
│   ├── react.tsx              # React barrel export (hooks, provider, dashboard)
│   ├── *.ts / *.tsx           # Source modules (see Module Index below)
│   └── *.test.ts              # Co-located test files (41 test suites)
├── lib/utils.ts               # Shared utility (cn helper)
├── examples/                  # Integration examples
│   ├── existing-sdk-integration/
│   │   ├── openai-wrap/       # OpenAI SDK integration
│   │   ├── anthropic-wrap/    # Anthropic SDK integration
│   │   └── vercel-ai-wrap/    # Vercel AI SDK integration
│   └── interactive-demo/      # Full Next.js demo app
├── app/                       # Next.js app directory (demo site)
├── webapp/                    # Additional web app demo
├── components/                # Shadcn/ui component library
├── hooks/                     # Shared React hooks (toast, mobile)
├── styles/                    # CSS / Tailwind styles
├── scripts/                   # Build and utility scripts
├── docs/                      # Developer documentation
├── marketing/                 # Marketing materials
├── public/                    # Static assets
├── .github/workflows/         # CI/CD (ci.yml, publish.yml)
└── dist/                      # Build output (gitignored)
```

---

## Module Index

### Core Modules (12 + 1)

| # | Module | File | Purpose |
|---|--------|------|---------|
| 1 | Token Counter | `token-counter.ts` | Exact BPE token counting (matches OpenAI tiktoken) |
| 2 | Cost Estimator | `cost-estimator.ts` | Real pricing data for OpenAI, Anthropic, Google |
| 3 | Context Manager | `context-manager.ts` | Token-budget-aware conversation trimming |
| 4 | Response Cache | `response-cache.ts` | Client-side exact + fuzzy caching (IndexedDB) |
| 5 | Model Router | `model-router.ts` | Complexity-based routing to cheapest capable model |
| 6 | Request Guard | `request-guard.ts` | Debounce, dedup, rate limit, cost gate |
| 7 | Prefix Optimizer | `prefix-optimizer.ts` | Message reordering for provider prompt cache hits |
| 8 | Cost Ledger | `cost-ledger.ts` | Real usage tracking with per-module attribution |
| 9 | Tool Token Counter | `tool-token-counter.ts` | Tool/function definition + image token overhead |
| 10 | Stream Tracker | `stream-tracker.ts` | Real-time output token counting during streaming |
| 11 | Circuit Breaker | `circuit-breaker.ts` | Session/hourly/daily spending limits |
| 12 | User Budget Manager | `user-budget-manager.ts` | Per-user daily/monthly budget tracking |
| 13 | Anomaly Detector | `anomaly-detector.ts` | Statistical outlier detection for cost spikes |

### Middleware & Integration

| Module | File | Purpose |
|--------|------|---------|
| Middleware Factory | `middleware.ts` | Main `tokenShieldMiddleware()` factory |
| Middleware Types | `middleware-types.ts` | Shared types and constants |
| Middleware Transform | `middleware-transform.ts` | `transformParams` pipeline stage |
| Middleware Wrap | `middleware-wrap.ts` | `wrapGenerate` / `wrapStream` pipeline stage |
| Framework Adapters | `adapters.ts` | OpenAI, Anthropic, generic adapters |
| Provider Adapter | `provider-adapter.ts` | Multi-provider routing with retries |
| Composable Pipeline | `pipeline.ts` | Pick-and-choose stages with hooks |

### React Integration

| Module | File | Purpose |
|--------|------|---------|
| React Barrel | `react.tsx` | Re-export of all React APIs |
| Context & Provider | `react-context.tsx` | `TokenShieldProvider`, `useSavings()` |
| Core Hooks | `react-hooks-core.ts` | `useTokenCount()`, `useComplexityAnalysis()`, `useShieldedCall()` |
| Budget Hooks | `react-hooks-budget.ts` | `useCostLedger()`, `useBudgetAlert()`, `useUserBudget()` |
| Pipeline Hooks | `react-hooks-pipeline.ts` | `useResponseCache()`, `useRequestGuard()`, `useEventLog()` |
| Dashboard | `dashboard.tsx` | Pre-built `TokenShieldDashboard` component |
| Dashboard Sections | `dashboard-sections.tsx` | Modular section components |

### Infrastructure

| Module | File | Purpose |
|--------|------|---------|
| Event Bus | `event-bus.ts` | Typed event system for observability |
| Logger | `logger.ts` | Structured logging with OTel-style spans |
| Error Hierarchy | `errors.ts` | Typed errors with machine-readable codes |
| Config Schemas | `config-schemas.ts` | Valibot validation for all configs |
| Pricing Registry | `pricing-registry.ts` | Dynamic model pricing registry |
| Storage Adapter | `storage-adapter.ts` | IndexedDB abstraction (idb-keyval) |
| Crypto Store | `crypto-store.ts` | Optional AES-GCM encryption at rest |
| Quick-Start Factory | `create-token-shield.ts` | `createTokenShield()` convenience function |

### Additional Modules

| Module | File | Purpose |
|--------|------|---------|
| NeuroElastic Engine | `neuro-elastic.ts` | Holographic encoding for cache similarity |
| Shield Worker | `shield-worker.ts` | Web Worker communication layer |
| API Client | `api-client.ts` | Multi-provider API call helpers |
| Output Predictor | `output-predictor.ts` | Estimate completion tokens before API call |
| Benchmarks | `benchmark.ts` | Performance hot-path benchmarking |
| Benchmark Scenarios | `benchmark-scenarios.ts` | Real-world benchmark cases |
| Savings Calculator | `savings-calculator.tsx` | Savings projection React component |

---

## Entry Points & Exports

### Main Entry (`@tokenshield/ai-sdk`)
- **Source:** `lib/tokenshield/index.ts`
- **Build output:** `dist/index.js` (CJS), `dist/index.mjs` (ESM), `dist/index.d.ts`
- **Exports:** 60+ named exports covering all modules

### React Entry (`@tokenshield/ai-sdk/react`)
- **Source:** `lib/tokenshield/react.tsx`
- **Build output:** `dist/react.js` (CJS), `dist/react.mjs` (ESM), `dist/react.d.ts`
- **Exports:** Provider, 18+ hooks, dashboard components

---

## Dependencies

### Runtime
| Package | Purpose |
|---------|---------|
| `gpt-tokenizer` ^3.4.0 | BPE token counting (matches OpenAI tiktoken) |
| `idb-keyval` ^6.2.2 | IndexedDB persistence (~295 B) |
| `mitt` ^3.0.1 | Internal event bus (~200 B) |
| `ohash` ^2.0.11 | Deterministic hashing for cache keys |
| `openai` ^6.21.0 | OpenAI SDK (for adapters) |
| `valibot` ^1.2.0 | Config schema validation (90% smaller than Zod) |

### Peer Dependencies (all optional)
- `react` >= 18.0.0 (React integration)
- `react-dom` >= 18.0.0 (React integration)
- `ai` >= 3.0.0 (Vercel AI SDK middleware)

---

## Scripts

| Command | Action |
|---------|--------|
| `npm test` | Run Vitest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate coverage report |
| `npm run build` | Build with tsup to `dist/` |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run lint` | ESLint on `lib/tokenshield/` |
| `npm run dev` | Start Next.js dev server (demo) |
| `npm run prepublishOnly` | typecheck + test + build |

---

## Test Suites (41 files)

All tests are co-located with source in `lib/tokenshield/`:

| Test File | Covers |
|-----------|--------|
| `token-counter.test.ts` | BPE accuracy, overhead calculation |
| `cost-estimator.test.ts` | Pricing lookups, cost projections |
| `context-manager.test.ts` | Conversation trimming strategies |
| `response-cache.test.ts` | Exact/fuzzy cache matching |
| `model-router.test.ts` | Complexity analysis, model selection |
| `request-guard.test.ts` | Debounce, dedup, rate limits |
| `prefix-optimizer.test.ts` | Message reordering, savings projection |
| `cost-ledger.test.ts` | Usage tracking, export/import |
| `tool-token-counter.test.ts` | Tool definitions, image tokens |
| `stream-tracker.test.ts` | Streaming token counting |
| `circuit-breaker.test.ts` | Spending limit enforcement |
| `user-budget-manager.test.ts` | Per-user budget tracking |
| `anomaly-detector.test.ts` | Outlier detection |
| `middleware.test.ts` | Middleware factory, config |
| `middleware-transform.test.ts` | Request transformation |
| `middleware-wrap.test.ts` | Response wrapping |
| `adapters.test.ts` | OpenAI/Anthropic/generic adapters |
| `provider-adapter.test.ts` | Multi-provider routing |
| `pipeline.test.ts` | Composable pipeline stages |
| `react-context.test.ts` | React provider setup |
| `react-hooks-core.test.ts` | Core React hooks |
| `react-hooks-budget.test.ts` | Budget React hooks |
| `react-hooks-pipeline.test.ts` | Pipeline React hooks |
| `dashboard.test.ts` | Dashboard component |
| `event-bus.test.ts` | Event system |
| `logger.test.ts` | Structured logging |
| `errors.test.ts` | Error hierarchy |
| `config-schemas.test.ts` | Config validation |
| `pricing-registry.test.ts` | Pricing registry |
| `storage-adapter.test.ts` | IndexedDB abstraction |
| `crypto-store.test.ts` | Encrypted storage |
| `create-token-shield.test.ts` | Quick-start factory |
| `neuro-elastic.test.ts` | Holographic encoding |
| `shield-worker.test.ts` | Worker communication |
| `api-client.test.ts` | Multi-provider API calls |
| `output-predictor.test.ts` | Output prediction |
| `benchmark.test.ts` | Benchmarking utilities |
| `savings-calculator.test.ts` | Savings projections |
| `integration.test.ts` | Full middleware pipeline |
| `e2e.test.ts` | End-to-end scenarios |
| `budget-battle.test.ts` | Multi-user budget scenarios |

---

## CI/CD

### CI (`ci.yml`)
- **Triggers:** Push to `main` or `claude/**`, PRs to `main`
- **Jobs:** Test (vitest + typecheck) -> Lint (eslint) -> Build (tsup, uploads dist artifact)

### Publish (`publish.yml`)
- **Triggers:** Tags matching `v*`
- **Jobs:** Test -> Build -> npm publish with provenance -> GitHub Release

---

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | npm metadata, scripts, dependencies |
| `tsconfig.json` | TypeScript strict mode, DOM/ESNext libs |
| `tsup.config.ts` | Build config (CJS + ESM, .d.ts, tree-shaking) |
| `vitest.config.ts` | Test runner (Node env, 75% coverage threshold) |
| `eslint.config.mjs` | Linting rules |
| `tailwind.config.ts` | Tailwind CSS theme |
| `postcss.config.mjs` | PostCSS plugins |
| `next.config.mjs` | Next.js app config |
| `components.json` | Shadcn/ui config |
| `.npmignore` | npm publish exclusions |

---

## Architecture

- **Middleware Pipeline:** Vercel AI SDK `wrapLanguageModel()` compatible. Stages: guard -> cache -> context -> router -> prefix
- **Module Independence:** Each module is independently usable and testable; no circular dependencies
- **React Integration:** Context Provider + custom hooks + event-driven updates
- **Storage:** IndexedDB via idb-keyval, optional AES-GCM encryption, BroadcastChannel cross-tab sync
- **Error Handling:** Typed hierarchy (`TokenShieldError` -> `BlockedError` / `ConfigError` / `BudgetError` / `CryptoError`)
