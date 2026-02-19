# BUILD HEALTH REPORT

> Forensic build, dependency, and CI health analysis.

## Build Status

| Check               | Status                 | Details                               |
| ------------------- | ---------------------- | ------------------------------------- |
| `npm test`          | **PASS**               | 68 test files, 1338 tests, 0 failures |
| `npm run typecheck` | **PASS**               | tsc --noEmit clean                    |
| `npm run build`     | **NEEDS VERIFICATION** | tsup build (not run in this audit)    |
| `npm run lint`      | **NEEDS VERIFICATION** | eslint on lib/tokenshield/            |

## Dependency Health

### Runtime Dependencies (5)

| Package         | Version | Size   | Risk       | Notes                              |
| --------------- | ------- | ------ | ---------- | ---------------------------------- |
| `gpt-tokenizer` | ^3.4.0  | ~180KB | **LOW**    | Core functionality, no alternative |
| `idb-keyval`    | ^6.2.2  | ~573B  | **LOW**    | Tiny, stable, widely used          |
| `mitt`          | ^3.0.1  | ~200B  | **LOW**    | Tiny event emitter                 |
| `valibot`       | ^1.2.0  | ~6KB   | **MEDIUM** | Config validation, tree-shakeable  |

**Total runtime deps: 4 (lean)**

> Note: `ohash` was originally listed as a dependency but was never imported anywhere. It has been removed.

### Dev Dependencies (16)

All standard: vitest, typescript, eslint, prettier, tsup, husky, lint-staged, testing-library, jsdom, npm-run-all2.

### Missing/Phantom Dependencies

1. **`llm-info`** — Referenced in `scripts/validate-pricing.ts` and CONTRIBUTING.md but NOT in package.json. Scripts that use it will fail on clean install.

### Peer Dependencies

| Package     | Required | Optional           | Notes                                              |
| ----------- | -------- | ------------------ | -------------------------------------------------- |
| `ai`        | >=3.0.0  | **Yes** (optional) | Should NOT be optional — primary use case needs it |
| `react`     | >=18.0.0 | Yes                | Correct: only needed for hooks                     |
| `react-dom` | >=18.0.0 | Yes                | Correct: only needed for hooks                     |

**Issue**: `ai` marked as optional peer dep is misleading. The primary API (`shield()` → `wrapLanguageModel()`) requires it. Only adapter-only users can skip it.

## Package.json Issues

1. **Wrong `repository.url`**: `https://github.com/tokenshield/ai-sdk.git` should be `https://github.com/christireid/Token-shield.git`
2. **Wrong `homepage`**: Same issue
3. **Wrong `bugs.url`**: Same issue
4. **`sideEffects: false`** is correct — no module-level side effects
5. **`engines.node >= 18.0.0`** is correct — Web Crypto API requires Node 18+

## Exports Map Verification

| Path              | Types                       | ESM                       | CJS                        | File Exists?           |
| ----------------- | --------------------------- | ------------------------- | -------------------------- | ---------------------- |
| `.`               | `./dist/index.d.ts`         | `./dist/index.js`         | `./dist/index.cjs`         | Source: ✅             |
| `./advanced`      | `./dist/advanced.d.ts`      | `./dist/advanced.js`      | `./dist/advanced.cjs`      | Source: ✅             |
| `./react`         | `./dist/react.d.ts`         | `./dist/react.js`         | `./dist/react.cjs`         | Source: ✅ (react.tsx) |
| `./license`       | `./dist/license.d.ts`       | `./dist/license.js`       | `./dist/license.cjs`       | Source: ✅             |
| `./audit-log`     | `./dist/audit-log.d.ts`     | `./dist/audit-log.js`     | `./dist/audit-log.cjs`     | Source: ✅             |
| `./compressor`    | `./dist/compressor.d.ts`    | `./dist/compressor.js`    | `./dist/compressor.cjs`    | Source: ✅             |
| `./delta-encoder` | `./dist/delta-encoder.d.ts` | `./dist/delta-encoder.js` | `./dist/delta-encoder.cjs` | Source: ✅             |
| `./middleware`    | `./dist/middleware.d.ts`    | `./dist/middleware.js`    | `./dist/middleware.cjs`    | Source: ✅             |

All export paths verified. `./react` uses `react.tsx` as its barrel file, configured in `tsup.config.ts`.

## TypeScript Configuration

- **Strict mode**: Enabled ✅
- **Target**: ES2022
- **Include**: `lib/tokenshield/` only (correct scoping)
- **No `any`**: Enforced by eslint (with pragmatic exceptions)

## CI Configuration

Location: `.github/workflows/ci.yml`

- Runs on push/PR to main
- Node 18 + Node 20 matrix
- Steps: install → typecheck → lint → test → coverage → build → bundle size check
- Coverage thresholds enforced on Node 20 (70% statements/lines, 60% branches/functions)
- Bundle size ceiling: 500KB ESM

## Potential Circular Dependencies

Based on import analysis:

- `middleware-types.ts` imports from `cost-estimator.ts` and `event-bus.ts`
- `cost-estimator.ts` imports from `pricing-registry.ts` (one-way, clean)
- `middleware.ts` imports from `middleware-types.ts`, `middleware-transform.ts`, `middleware-wrap.ts` (tree, no cycles)
- `cost-ledger.ts` imports from `cost-estimator.ts` and `middleware-types.ts`

**No circular dependencies detected in core pipeline.**

## Files Not Exported (but tested internally)

| File                     | Exported? | Tested?                     | Notes                                       |
| ------------------------ | --------- | --------------------------- | ------------------------------------------- |
| `shield-worker.ts`       | No        | Yes (shield-worker.test.ts) | Web Worker wrapper, tested but not exported |
| `benchmark.ts`           | No        | Yes                         | Internal utility                            |
| `benchmark-scenarios.ts` | No        | Yes                         | Internal utility                            |

> Dead code files (`adaptive-output-optimizer.ts`, `prompt-template-pool.ts`, `token-optimizer.ts`) were identified and deleted during the audit remediation.

## Security Considerations

1. **No `eval()` or `new Function()`** anywhere in codebase ✅
2. **No network calls** from SDK code ✅ (zero telemetry confirmed)
3. **BroadcastChannel validation** present for cross-tab sync ✅
4. **CSV injection protection** via always-quoting ✅
5. **djb2 hash collision** guarded by normalizedKey verification ✅
6. **IndexedDB same-origin** documented in SECURITY.md ✅
