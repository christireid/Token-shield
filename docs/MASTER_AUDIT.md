# MASTER AUDIT — Multi-Perspective Critique + Remediation Plan

## Phase 1: 9-Perspective Critique (Synthesized)

### 1. CEO Perspective — "Is this investable?"

- **GOOD**: Clear value prop, honest limitations, MIT license, zero telemetry
- **BAD**: No production users. No benchmarks. Repository URLs in package.json point to wrong repo. No npm publish. Bus factor of 1.
- **FIX**: Fix package.json URLs. Remove dead code. Prepare for npm publish.

### 2. CTO Perspective — "Would I approve this for prod?"

- **GOOD**: Clean architecture, typed errors, Valibot validation, BroadcastChannel protection, 1382 tests
- **BAD**: 3 dead-code files (adaptive-output-optimizer.ts, prompt-template-pool.ts, token-optimizer.ts). `ai` peer dep marked optional. `llm-info` not in dependencies but referenced in scripts. React export path has no barrel file.
- **FIX**: Remove dead code. Fix peer deps. Add react barrel. Fix script deps.

### 3. First-Time User Perspective — "Can I get started in 5 minutes?"

- **GOOD**: 5-line quick start. shield() works zero-config.
- **BAD**: Install requires git clone + build. No npm package. No working demo. StackBlitz link removed.
- **FIX**: Not much we can do without npm publish. Examples README could be improved.

### 4. Power User Perspective — "Are there edge cases?"

- **GOOD**: Extensive config, dry-run mode, error hierarchy, event bus
- **BAD**: `similarityThreshold` risk documented well but "semantic" caching claim is misleading. No way to list cached entries. No cache invalidation API. dispose() doesn't clear IDB data.
- **FIX**: Add cache listing and invalidation methods.

### 5. Security Reviewer — "Can this be exploited?"

- **GOOD**: SECURITY.md is excellent. No eval. BroadcastChannel validated. CSV injection handled.
- **BAD**: djb2 hash is not cryptographic (documented, mitigated by normalizedKey check). EncryptedStore key management is user's responsibility (documented).
- **FIX**: Already well-handled.

### 6. Marketing Perspective — "Does positioning hold up?"

- **GOOD**: Honest about limitations. "Fuel gauge not ignition lock" is great.
- **BAD**: "Semantic caching" is misleading (it's lexical). Architecture comparison table needs source for "50-200ms per request" claim.
- **FIX**: Change "semantic caching" to "fuzzy caching" or "near-duplicate caching".

### 7. Code Quality Reviewer — "Is this maintainable?"

- **GOOD**: Single responsibility modules. Clean middleware pipeline. Event-driven architecture.
- **BAD**: Some large files (middleware-transform.ts: 649 lines). Several `/* non-fatal */` catch blocks that could lose useful debugging info. `estimateCost` error message dumps ALL model IDs.
- **FIX**: Improve error messages. Consider logging non-fatal errors.

### 8. DevOps/Infra Perspective — "Can I deploy and monitor this?"

- **GOOD**: Event bus for observability. Logger with spans. Health check API.
- **BAD**: No OpenTelemetry integration. No Prometheus metrics export. storage:error events are fire-and-forget.
- **FIX**: Document observability patterns.

### 9. Cranky Engineer Perspective — "What's actually broken?"

- **FOUND ISSUES**:
  1. package.json repository/homepage/bugs URLs are wrong
  2. 3 dead code files with no exports or imports
  3. `llm-info` referenced in scripts but not in devDependencies
  4. `ai` peer dep is optional but needed for primary use case
  5. "Semantic caching" claim is inaccurate
  6. `estimateCost()` error dumps all model IDs (noisy for small models)
  7. No react barrel file for `./react` export path
  8. `classifyContentType` year regex `/\b(20\d{2})\b/i` matches all years including "2000" which isn't time-sensitive
  9. `hashKey` uses djb2 with 32-bit — collision risk increases at scale (mitigated by normalizedKey check)
  10. `complexityCache` is module-level (leaks across test suites)
  11. ResponseCache `clear()` iterates all IDB keys one by one (could use IDB clear)
  12. Ledger `exportCSV` doesn't quote the header row

---

## Phase 2: MASTER PROBLEM INDEX (Prioritized)

### CRITICAL (must fix before any publish) — ALL RESOLVED

| #   | Problem                                     | File                                                                      | Impact                        | Status  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------- | ------- |
| C1  | package.json URLs point to wrong repository | package.json                                                              | npm listing will link to 404s | FIXED   |
| C2  | "Semantic caching" claim is inaccurate      | README.md, QUICKSTART.md                                                  | Misleading marketing          | FIXED   |
| C3  | 3 dead code files bloat bundle              | adaptive-output-optimizer.ts, prompt-template-pool.ts, token-optimizer.ts | Bundle size, confusion        | DELETED |

### HIGH (should fix) — ALL RESOLVED

| #   | Problem                                | File              | Impact                                               | Status                  |
| --- | -------------------------------------- | ----------------- | ---------------------------------------------------- | ----------------------- |
| H1  | `ai` peer dep marked optional          | package.json      | Confusing DX on install                              | FIXED                   |
| H2  | `llm-info` not in devDependencies      | package.json      | validate-pricing script fails on clean install       | FIXED                   |
| H3  | No react barrel file                   | Missing react.ts  | ./react export may not build                         | N/A (react.tsx existed) |
| H4  | CSV header row not quoted              | cost-ledger.ts    | Inconsistent with data rows                          | FIXED                   |
| H5  | estimateCost error dumps all model IDs | cost-estimator.ts | Noisy error for users with custom models             | FIXED                   |
| H6  | Year regex too broad                   | response-cache.ts | "year 2000" incorrectly classified as time-sensitive | FIXED                   |

### MEDIUM (improve quality) — ALL RESOLVED

| #   | Problem                                                | File              | Impact                          | Status |
| --- | ------------------------------------------------------ | ----------------- | ------------------------------- | ------ |
| M1  | Module-level complexityCache leaks across tests        | model-router.ts   | Test isolation                  | FIXED  |
| M2  | ResponseCache clear() deletes keys one by one          | response-cache.ts | Performance on large caches     | FIXED  |
| M3  | No cache listing/invalidation API                      | response-cache.ts | Power users can't inspect cache | FIXED  |
| M4  | Architecture comparison lacks source for latency claim | README.md         | Credibility                     | FIXED  |

---

## Phase 3-6: REMEDIATION PLAN (Implementation Order)

1. **Fix package.json URLs** (C1)
2. **Fix "semantic caching" → "fuzzy caching"** (C2) in README, QUICKSTART
3. **Delete 3 dead code files** (C3)
4. **Fix `ai` peer dep** (H1) — make non-optional
5. **Add `llm-info` to devDependencies** (H2)
6. **Create react barrel file** (H3)
7. **Quote CSV header row** (H4)
8. **Improve estimateCost error** (H5)
9. **Fix year regex** (H6)
10. **Add cache listing API** (M3) — expose entries() method
11. **Add source for latency claim** (M4)
12. **Run tests, verify, commit**
