# Baseline Build Notes

Captured before any changes were made to the repository.

## Environment

- Node.js: v22.22.0
- npm: 10.9.4
- Platform: Linux 4.4.0

## npm install

```
npm install → 525 packages, 0 vulnerabilities
```

## npm test

```
npm test → 70 test files, 1352 tests, all passing
Duration: ~4s
```

Tests used `vitest` with test files co-located in `lib/tokenshield/` and `hooks/`.

## npm run build

```
npm run build → FAILED

> @tokenshield/ai-sdk@0.5.0 prebuild
> tsx scripts/sync-pricing.ts

sh: 1: tsx: not found
```

**Root cause:** The `prebuild` script uses `tsx` which is not listed as a dependency. The `tsx` package was likely installed globally on the original developer's machine but not declared in `package.json`.

**Impact:** Fresh installs cannot build the package. The `tsup` build itself would likely work if the prebuild was skipped — the actual TypeScript compilation has no known issues.

## npm run typecheck

```
npm run typecheck → PASSED (tsc --noEmit)
```

TypeScript compilation succeeds despite the build failure (the prebuild is only in the `build` script).

## Key observations

1. **Build is broken for fresh installs** — `tsx` not in dependencies
2. **Tests pass** — existing functionality works
3. **Package name:** `@tokenshield/ai-sdk` (scoped)
4. **445+ public exports** — massive API surface
5. **6 runtime dependencies:** gpt-tokenizer, idb-keyval, mitt, ohash, openai, valibot
6. **60+ devDependencies** including full Next.js/React/Radix/Tailwind stack
7. **7 entry points** in tsup.config.ts (index, react, license, audit-log, compressor, delta-encoder, middleware)
