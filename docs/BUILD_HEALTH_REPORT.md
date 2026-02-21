# BUILD HEALTH REPORT (Pass 2)

> Updated: 2026-02-21

## Build Status

| Check               | Status                 | Details                               |
| ------------------- | ---------------------- | ------------------------------------- |
| `npm test`          | **PASS**               | 68 test files, 1338 tests, 0 failures |
| `npm run typecheck` | **PASS**               | tsc --noEmit clean (0 errors)         |
| `npm run build`     | **NEEDS VERIFICATION** | tsup build (not run in this audit)    |
| `npm run lint`      | **NEEDS VERIFICATION** | eslint on lib/tokenshield/            |

## Dependency Health

### Runtime Dependencies (4)

| Package         | Version | Size   | Risk       | Notes                              |
| --------------- | ------- | ------ | ---------- | ---------------------------------- |
| `gpt-tokenizer` | ^3.4.0  | ~180KB | **LOW**    | Core functionality, no alternative |
| `idb-keyval`    | ^6.2.2  | ~573B  | **LOW**    | Tiny, stable, widely used          |
| `mitt`          | ^3.0.1  | ~200B  | **LOW**    | Tiny event emitter                 |
| `valibot`       | ^1.2.0  | ~6KB   | **MEDIUM** | Config validation, tree-shakeable  |

**Total runtime deps: 4 (lean)**

### Peer Dependencies

| Package     | Required | Optional | Notes                                |
| ----------- | -------- | -------- | ------------------------------------ |
| `ai`        | >=3.0.0  | **No**   | Correctly required (fixed in pass 1) |
| `react`     | >=18.0.0 | Yes      | Correct: only needed for hooks       |
| `react-dom` | >=18.0.0 | Yes      | Correct: only needed for hooks       |

### Resolved Issues

- `ohash` — was an unused dependency. Removed in pass 1.
- `llm-info` — was missing from devDependencies. Added in pass 1.
- `ai` peer dep — was incorrectly optional. Fixed in pass 1.

## Exports Map Verification

| Path              | Source File                     | Verified       |
| ----------------- | ------------------------------- | -------------- |
| `.`               | `index.ts`                      | Source: exists |
| `./advanced`      | `advanced.ts`                   | Source: exists |
| `./react`         | `react.tsx`                     | Source: exists |
| `./license`       | `license.ts`                    | Source: exists |
| `./audit-log`     | `audit-log.ts`                  | Source: exists |
| `./compressor`    | `prompt-compressor.ts`          | Source: exists |
| `./delta-encoder` | `conversation-delta-encoder.ts` | Source: exists |
| `./middleware`    | `middleware.ts`                 | Source: exists |

All 8 export paths have corresponding source files.

## Code Quality Metrics

| Metric                   | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| TypeScript strict mode   | Enabled                                                      |
| `as any` casts           | 2 (event-bus.ts, with eslint-disable)                        |
| eslint-disable comments  | 15 (all justified)                                           |
| TODO/FIXME/HACK comments | 0                                                            |
| Empty catch blocks       | 0 (all have explanatory comments)                            |
| console.log in source    | 14 (benchmark.ts only — intentional)                         |
| console.warn in source   | 4 (crypto-store, storage-adapter, license — all error paths) |
| Skipped tests            | 0                                                            |

## Type System Health

| Issue                                                         | Status                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| Provider type `"openai" \| "anthropic" \| "google"` alignment | **FIXED** — cost-estimator.ts now matches pricing-registry.ts |

## CI Configuration

Location: `.github/workflows/ci.yml`

- Node 18 + 20 matrix
- Steps: install → typecheck → lint → test → coverage → build → bundle size check
- Coverage thresholds: 70% statements/lines, 60% branches/functions
- Bundle size ceiling: 500KB ESM

## Security

| Check                                       | Status |
| ------------------------------------------- | ------ |
| No `eval()` or `new Function()`             | PASS   |
| No network calls from SDK                   | PASS   |
| No `innerHTML` or `dangerouslySetInnerHTML` | PASS   |
| BroadcastChannel validation                 | PASS   |
| CSV injection protection                    | PASS   |
| Zero telemetry                              | PASS   |

## Remaining Risks

| Risk                              | Severity | Mitigation                                                                              |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| Not published to npm              | HIGH     | Requires npm account + CI/CD. Out of scope for code audit.                              |
| `require()` in storage-adapter.ts | LOW      | Works in all current environments. Dynamic import would be cleaner for strict ESM.      |
| No published benchmarks           | MEDIUM   | benchmark.ts exists as runner. Should publish results before making performance claims. |
| No real-API integration tests     | MEDIUM   | API proxy routes exist. Need OPENAI_API_KEY for validation.                             |
