# Deletion Plan

## Principle

> If it doesn't reduce tokens or improve DX, delete it.

## Deleted: ~90% of codebase

### Entire directories removed

| Directory | Rationale |
|-----------|-----------|
| `lib/tokenshield/` (95 files) | Replaced by `src/` (8 files) |
| `app/` | Next.js app — not part of an npm library |
| `components/` (50+ files) | React UI components — separate concern |
| `hooks/` | React hooks — separate concern |
| `marketing/` | Marketing assets — not code |
| `public/` | Static assets — not part of library |
| `scripts/` | Old build scripts — replaced |
| `styles/` | CSS — not part of library |
| `.husky/` | Git hooks — unnecessary for v1 |

### Modules deleted

| Module | Rationale |
|--------|-----------|
| `neuro-elastic.ts` | "Holographic encoding" — sci-fi naming, premature abstraction |
| `pipeline.ts` | Composable middleware stages — over-engineered |
| `provider-adapter.ts` | Multi-provider orchestration — not needed for middleware |
| `shield-worker.ts` | Worker communication — premature |
| `crypto-store.ts` | Encrypted storage — enterprise feature, not v1 |
| `license.ts` | Open-core licensing with HMAC — not for a free library |
| `audit-log.ts` | Enterprise audit logging — not v1 |
| `middleware-plugin.ts` | Plugin registry — nobody asked for this |
| `circuit-breaker.ts` | Budget enforcement — separate concern for v1 |
| `user-budget-manager.ts` | Per-user budgets — enterprise feature |
| `anomaly-detector.ts` | Statistical outlier detection — premature |
| `model-router.ts` | Complexity-based routing — separate concern |
| `context-manager.ts` | Conversation history management — separate concern |
| `prefix-optimizer.ts` | Provider cache optimization — too specialized for v1 |
| `request-guard.ts` | Rate limiting — separate concern |
| `stream-tracker.ts` | Stream token counting — not needed for cache+compress |
| `tool-token-counter.ts` | Tool overhead counting — too specialized |
| `adaptive-output-optimizer.ts` | Output length prediction — premature |
| `conversation-delta-encoder.ts` | Cross-turn compression — premature |
| `semantic-minhash.ts` | LSH-based lookup — premature optimization |
| `prompt-template-pool.ts` | Template interning — premature |
| `token-optimizer.ts` | Unified facade — over-abstraction |
| `savings-calculator.tsx` | React component — not library code |
| `react.tsx`, `react-context.tsx`, `react-hooks-*.ts` | React integration — separate package |
| `dashboard.tsx`, `dashboard-sections.tsx` | Dashboard UI — separate package |
| `license-activation.tsx` | License UI — not for free library |
| `api-client.ts` | Direct LLM API calls — not our job |
| `config-schemas.ts` | Valibot validation — overkill for 9 exports |
| `event-bus.ts` | Event system — not needed for minimal API |
| `logger.ts` | Structured logging — not needed for v1 |
| `errors.ts` | Error hierarchy — simplified |
| `benchmark.ts`, `benchmark-scenarios.ts` | In-library benchmarks — moved to `benchmarks/` |

### Root files deleted

| File | Rationale |
|------|-----------|
| `QUICKSTART.md`, `SPEC.md`, `CHANGELOG.md` | Docs for unshipped product |
| `CONTRIBUTING.md`, `SECURITY.md` | Premature for v1 |
| `INDEX.md`, `LAUNCH_ANNOUNCEMENT.md` | Marketing docs |
| `COMMERCIAL-READINESS-REVIEW.md` | Enterprise review for free library |
| `COMPLETION_REPORT.md`, `CLEANUP_SUMMARY.md` | Meta-docs |
| `components.json`, `tailwind.config.ts` | UI config |
| `next.config.mjs`, `postcss.config.mjs` | Next.js config |
| `eslint.config.mjs` | Linting config (can re-add later) |
| `tsconfig.build.json` | Replaced by updated `tsconfig.json` |
| `.prettierrc.json`, `.editorconfig`, etc. | Formatting config (can re-add later) |

### Dependencies removed

**Runtime (6 → 1):**
- `idb-keyval` — browser-only IndexedDB (not needed for Node/Edge)
- `mitt` — event bus (not needed)
- `ohash` — hashing (replaced with built-in djb2)
- `openai` — direct API calls (not our job)
- `valibot` — config validation (overkill)

**Kept:** `gpt-tokenizer` (token counting — core to compression and cost)

**Dev (60+ → 4):**
Removed all React/Next.js/Radix/Tailwind/shadcn dependencies.
Kept: `tsup`, `typescript`, `vitest`, `@vitest/coverage-v8`

## New structure

```
src/
  index.ts          — 9 exports
  core/shield.ts    — createShield, shield
  cache/
    normalize.ts    — text normalization, similarity
    semantic-cache.ts — SemanticCache
  compression/
    compressor.ts   — promptCompression
  cost/
    pricing.ts      — model pricing data
    tracker.ts      — costTracker, estimateCost
  middleware/
    vercel.ts       — withShield
  types/
    index.ts        — ShieldOptions, ShieldStats
```
