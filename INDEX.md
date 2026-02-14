# TokenShield AI SDK - Project Index

> **Package:** `@tokenshield/ai-sdk` v0.2.0
> **License:** MIT
> **Node:** >= 18.0.0
> **Module System:** ESM-first (`"type": "module"`) with CJS fallback
> **Build:** tsup (esbuild) -> ESM (.js) + CJS (.cjs) + .d.ts
> **Tests:** Vitest — 41 suites, 779 tests (75% line/function coverage, 60% branch)

## Overview

TokenShield is a developer-first, client-side React/TypeScript SDK that reduces LLM API costs 30-60% without vendor lock-in. It runs entirely in the browser as middleware — zero infrastructure, zero latency added (<5ms), zero privacy risk (data never leaves the client).

---

## Directory Structure

```
Token-shield/
├── lib/tokenshield/               # SDK source (all core code)
│   ├── index.ts                   # Main barrel export (60+ named exports)
│   ├── react.tsx                  # React barrel export (hooks, provider, dashboard)
│   ├── *.ts / *.tsx               # Source modules (see Module Index below)
│   └── *.test.ts                  # Co-located test files (41 test suites)
├── lib/utils.ts                   # Shared utility (cn helper)
├── app/                           # Next.js app directory (demo site)
│   └── dashboard/page.tsx         # Advanced dashboard route
├── components/                    # UI component library
│   ├── ui/                        # Shadcn/ui primitives
│   ├── dashboard/                 # Advanced dashboard (10 components)
│   ├── tests/                     # Interactive test components
│   ├── playground.tsx             # SDK playground
│   └── savings-dashboard.tsx      # Savings visualization
├── hooks/                         # Shared React hooks (toast, mobile)
├── examples/                      # Integration examples
│   ├── existing-sdk-integration/
│   │   ├── openai-wrap/           # OpenAI SDK integration
│   │   ├── anthropic-wrap/        # Anthropic SDK integration
│   │   └── vercel-ai-wrap/        # Vercel AI SDK integration
│   └── interactive-demo/          # Full Next.js demo app
├── docs/                          # Developer documentation
├── scripts/                       # Utility scripts
├── styles/                        # CSS / Tailwind styles
├── public/                        # Static assets
├── marketing/                     # Marketing materials
├── .github/workflows/             # CI/CD (ci.yml, publish.yml)
├── dist/                          # Build output (gitignored)
├── package.json                   # ESM-first package config
├── tsconfig.json                  # TypeScript (strict, ES2020, bundler resolution)
├── tsconfig.build.json            # Build-only TypeScript config (SDK-scoped)
├── tsup.config.ts                 # Build config (ESM + CJS + DTS)
├── vitest.config.ts               # Test runner config
├── eslint.config.mjs              # Linting (SDK-scoped)
├── .nvmrc                         # Node version (20)
├── .npmignore                     # npm publish exclusions
└── .gitignore                     # Git exclusions
```

---

## Module Index

### Core Modules (12 + 1)

| #   | Module              | File                     | Purpose                                            |
| --- | ------------------- | ------------------------ | -------------------------------------------------- |
| 1   | Token Counter       | `token-counter.ts`       | Exact BPE token counting (matches OpenAI tiktoken) |
| 2   | Cost Estimator      | `cost-estimator.ts`      | Real pricing data for OpenAI, Anthropic, Google    |
| 3   | Context Manager     | `context-manager.ts`     | Token-budget-aware conversation trimming           |
| 4   | Response Cache      | `response-cache.ts`      | Client-side exact + fuzzy caching (IndexedDB)      |
| 5   | Model Router        | `model-router.ts`        | Complexity-based routing to cheapest capable model |
| 6   | Request Guard       | `request-guard.ts`       | Debounce, dedup, rate limit, cost gate             |
| 7   | Prefix Optimizer    | `prefix-optimizer.ts`    | Message reordering for provider prompt cache hits  |
| 8   | Cost Ledger         | `cost-ledger.ts`         | Real usage tracking with per-module attribution    |
| 9   | Tool Token Counter  | `tool-token-counter.ts`  | Tool/function definition + image token overhead    |
| 10  | Stream Tracker      | `stream-tracker.ts`      | Real-time output token counting during streaming   |
| 11  | Circuit Breaker     | `circuit-breaker.ts`     | Session/hourly/daily spending limits               |
| 12  | User Budget Manager | `user-budget-manager.ts` | Per-user daily/monthly budget tracking             |
| 13  | Anomaly Detector    | `anomaly-detector.ts`    | Statistical outlier detection for cost spikes      |

### Middleware & Integration

| Module               | File                      | Purpose                                      |
| -------------------- | ------------------------- | -------------------------------------------- |
| Middleware Factory   | `middleware.ts`           | Main `tokenShieldMiddleware()` factory       |
| Middleware Types     | `middleware-types.ts`     | Shared types and constants                   |
| Middleware Transform | `middleware-transform.ts` | `transformParams` pipeline stage             |
| Middleware Wrap      | `middleware-wrap.ts`      | `wrapGenerate` / `wrapStream` pipeline stage |
| Framework Adapters   | `adapters.ts`             | OpenAI, Anthropic, generic adapters          |
| Provider Adapter     | `provider-adapter.ts`     | Multi-provider routing with retries          |
| Composable Pipeline  | `pipeline.ts`             | Pick-and-choose stages with hooks            |

### React Integration

| Module             | File                      | Purpose                                                           |
| ------------------ | ------------------------- | ----------------------------------------------------------------- |
| React Barrel       | `react.tsx`               | Re-export of all React APIs                                       |
| Context & Provider | `react-context.tsx`       | `TokenShieldProvider`, `useSavings()`                             |
| Core Hooks         | `react-hooks-core.ts`     | `useTokenCount()`, `useComplexityAnalysis()`, `useShieldedCall()` |
| Budget Hooks       | `react-hooks-budget.ts`   | `useCostLedger()`, `useBudgetAlert()`, `useUserBudget()`          |
| Pipeline Hooks     | `react-hooks-pipeline.ts` | `useResponseCache()`, `useRequestGuard()`, `useEventLog()`        |
| Dashboard          | `dashboard.tsx`           | Pre-built `TokenShieldDashboard` component                        |
| Dashboard Sections | `dashboard-sections.tsx`  | Modular section components                                        |

### Infrastructure

| Module              | File                     | Purpose                                    |
| ------------------- | ------------------------ | ------------------------------------------ |
| Event Bus           | `event-bus.ts`           | Typed event system for observability       |
| Logger              | `logger.ts`              | Structured logging with OTel-style spans   |
| Error Hierarchy     | `errors.ts`              | Typed errors with machine-readable codes   |
| Config Schemas      | `config-schemas.ts`      | Valibot validation for all configs         |
| Pricing Registry    | `pricing-registry.ts`    | Dynamic model pricing registry             |
| Storage Adapter     | `storage-adapter.ts`     | IndexedDB abstraction (idb-keyval)         |
| Crypto Store        | `crypto-store.ts`        | Optional AES-GCM encryption at rest        |
| Quick-Start Factory | `create-token-shield.ts` | `createTokenShield()` convenience function |

### Additional Modules

| Module              | File                     | Purpose                                    |
| ------------------- | ------------------------ | ------------------------------------------ |
| NeuroElastic Engine | `neuro-elastic.ts`       | Holographic encoding for cache similarity  |
| Shield Worker       | `shield-worker.ts`       | Web Worker communication layer             |
| API Client          | `api-client.ts`          | Multi-provider API call helpers            |
| Output Predictor    | `output-predictor.ts`    | Estimate completion tokens before API call |
| Benchmarks          | `benchmark.ts`           | Performance hot-path benchmarking          |
| Benchmark Scenarios | `benchmark-scenarios.ts` | Real-world benchmark cases                 |
| Savings Calculator  | `savings-calculator.tsx` | Savings projection React component         |

### Advanced Dashboard (`components/dashboard/`)

| Component          | File                         | Purpose                                        |
| ------------------ | ---------------------------- | ---------------------------------------------- |
| Dashboard Shell    | `dashboard-shell.tsx`        | Layout wrapper with all sections               |
| Dashboard Provider | `dashboard-provider.tsx`     | Data layer with demo/live mode                 |
| Dashboard Header   | `dashboard-header.tsx`       | Controls: pause, demo/live, time range, export |
| KPI Cards          | `kpi-cards.tsx`              | 6 KPI cards with sparkline charts              |
| Savings Timeline   | `savings-timeline-chart.tsx` | Area chart of cumulative savings               |
| Module Breakdown   | `module-breakdown-chart.tsx` | Bar chart of savings by module                 |
| Model Usage        | `model-usage-chart.tsx`      | Donut chart + sortable table                   |
| Event Feed         | `event-feed.tsx`             | Live scrollable event stream                   |
| Budget Gauge       | `budget-gauge.tsx`           | SVG arc gauge with tier bars                   |
| User Budget Table  | `user-budget-table.tsx`      | CRUD table for per-user budgets                |

---

## Entry Points & Exports

### Main Entry (`@tokenshield/ai-sdk`)

- **Source:** `lib/tokenshield/index.ts`
- **Build:** `dist/index.js` (ESM), `dist/index.cjs` (CJS), `dist/index.d.ts` (types)
- **Exports:** 60+ named exports covering all modules

### React Entry (`@tokenshield/ai-sdk/react`)

- **Source:** `lib/tokenshield/react.tsx`
- **Build:** `dist/react.js` (ESM), `dist/react.cjs` (CJS), `dist/react.d.ts` (types)
- **Exports:** Provider, 18+ hooks, dashboard components

### Package Exports Map

```json
{
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
  "./react": {
    "types": "./dist/react.d.ts",
    "import": "./dist/react.js",
    "require": "./dist/react.cjs"
  },
  "./package.json": "./package.json"
}
```

---

## Build & Packaging

| Feature          | Value                                     |
| ---------------- | ----------------------------------------- |
| Module system    | `"type": "module"` (ESM-first)            |
| ESM output       | `.js` files                               |
| CJS output       | `.cjs` files                              |
| Type definitions | `.d.ts` + `.d.cts`                        |
| Source maps      | Enabled                                   |
| Tree-shaking     | Enabled                                   |
| Target           | ES2020                                    |
| Code splitting   | Enabled                                   |
| External         | `react`, `react-dom`, `ai`                |
| Minification     | Disabled (readable output)                |
| Banner           | `/* @tokenshield/ai-sdk - MIT License */` |

---

## Dependencies

### Runtime

| Package                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `gpt-tokenizer` ^3.4.0 | BPE token counting (matches OpenAI tiktoken)    |
| `idb-keyval` ^6.2.2    | IndexedDB persistence (~295 B)                  |
| `mitt` ^3.0.1          | Internal event bus (~200 B)                     |
| `ohash` ^2.0.11        | Deterministic hashing for cache keys            |
| `openai` ^6.21.0       | OpenAI SDK (for adapters)                       |
| `valibot` ^1.2.0       | Config schema validation (90% smaller than Zod) |

### Peer Dependencies (all optional)

- `react` >= 18.0.0 (React integration)
- `react-dom` >= 18.0.0 (React integration)
- `ai` >= 3.0.0 (Vercel AI SDK middleware)

---

## Scripts

| Command                  | Action                                       |
| ------------------------ | -------------------------------------------- |
| `npm test`               | Run Vitest test suite (41 suites, 779 tests) |
| `npm run test:watch`     | Run tests in watch mode                      |
| `npm run test:coverage`  | Generate coverage report                     |
| `npm run build`          | Build with tsup to `dist/`                   |
| `npm run typecheck`      | TypeScript type checking (`tsc --noEmit`)    |
| `npm run lint`           | ESLint on `lib/tokenshield/`                 |
| `npm run clean`          | Remove `dist/` and `.next/`                  |
| `npm run dev`            | Start Next.js dev server (demo)              |
| `npm run prepublishOnly` | typecheck + test + build                     |

---

## CI/CD

### CI (`ci.yml`)

- **Triggers:** Push to `main` or `claude/**`, PRs to `main`
- **Test matrix:** Node 18, 20, 22
- **Jobs:** Test (vitest + typecheck) -> Lint (eslint) -> Build (tsup, uploads dist artifact)

### Publish (`publish.yml`)

- **Triggers:** Tags matching `v*`
- **Jobs:** Test -> Build -> npm publish with provenance -> GitHub Release

---

## Configuration Files

| File                  | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `package.json`        | ESM-first npm package config with conditional exports |
| `tsconfig.json`       | TypeScript strict mode, ES2020, bundler resolution    |
| `tsconfig.build.json` | Build-only config (SDK-scoped, excludes tests)        |
| `tsup.config.ts`      | Build config (ESM + CJS + DTS, tree-shaking, ES2020)  |
| `vitest.config.ts`    | Test runner (Node env, 75% coverage thresholds)       |
| `eslint.config.mjs`   | Flat config, SDK-scoped linting                       |
| `tailwind.config.ts`  | Tailwind CSS theme (demo app)                         |
| `postcss.config.mjs`  | PostCSS plugins (demo app)                            |
| `next.config.mjs`     | Next.js app config (demo app)                         |
| `components.json`     | Shadcn/ui config                                      |
| `.nvmrc`              | Node version pin (20)                                 |
| `.npmignore`          | npm publish exclusions                                |
| `.gitignore`          | Git exclusions                                        |

---

## Architecture

- **Middleware Pipeline:** Vercel AI SDK `wrapLanguageModel()` compatible. Stages: guard -> cache -> context -> router -> prefix
- **Module Independence:** Each module is independently usable and testable; no circular dependencies
- **React Integration:** Context Provider + custom hooks + event-driven updates
- **Storage:** IndexedDB via idb-keyval, optional AES-GCM encryption, BroadcastChannel cross-tab sync
- **Error Handling:** Typed hierarchy (`TokenShieldError` -> `BlockedError` / `ConfigError` / `BudgetError` / `CryptoError`)
- **Build:** ESM-first with CJS fallback, conditional exports, tree-shakeable, ES2020 target
