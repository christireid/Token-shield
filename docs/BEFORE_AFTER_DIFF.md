# BEFORE → AFTER DIFF

> Summary of all changes across both audit passes.

## Pass 1 Changes (Previous Session)

| Area                         | Before                                                                                  | After                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| package.json repository URLs | Pointed to `tokenshield/ai-sdk` (doesn't exist)                                         | Points to `christireid/Token-shield` (correct)    |
| `ai` peer dependency         | `optional: true`                                                                        | `optional: false`                                 |
| `llm-info` devDependency     | Missing                                                                                 | Added to devDependencies                          |
| "Semantic caching" claim     | Used throughout (README, QUICKSTART, hero, layout, demo, examples)                      | Changed to "fuzzy caching" everywhere             |
| Dead code files              | 3 dead files: adaptive-output-optimizer.ts, prompt-template-pool.ts, token-optimizer.ts | Deleted                                           |
| CSV export headers           | Unquoted                                                                                | Quoted (RFC 4180 compliant)                       |
| estimateCost error message   | Dumped all 40+ model IDs                                                                | Shows count + actionable suggestion               |
| Year regex for TTL           | `/\b(20\d{2})\b/i` (matches "2000")                                                     | `/\b(202\d\|203\d)\b/i` (2020-2039 only)          |
| Architecture latency claim   | "50-200ms per request" (unsourced)                                                      | "Additional network hop per request" (disclaimed) |
| ResponseCache API            | No listing or invalidation                                                              | Added `entries()` and `invalidate()`              |
| Site metadata title          | "Save 80% on AI Token Costs"                                                            | "Reduce AI Token Costs"                           |
| `ohash` dependency           | Unused runtime dependency                                                               | Removed                                           |
| `complexityCache` test leak  | Module-level Map leaks across suites                                                    | `resetComplexityCache()` exported                 |
| `ResponseCache.clear()`      | Deletes IDB keys one by one                                                             | Uses bulk `clear()` via storage adapter           |

## Pass 2 Changes (This Session)

| Area                                       | Before                                                   | After                                                         |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------- |
| GitHub link (hero.tsx:105)                 | `href="https://github.com"` (broken)                     | `href="https://github.com/christireid/Token-shield"`          |
| Dependency count (hero.tsx:92)             | "2 deps: gpt-tokenizer + idb-keyval" (FALSE)             | "4 deps: gpt-tokenizer, idb-keyval, mitt, valibot"            |
| Dependency count (cost-projection.tsx:260) | "2 dependencies" (FALSE)                                 | "4 dependencies"                                              |
| SECURITY.md line 24                        | "Semantic and exact-match caching" (STALE)               | "Fuzzy and exact-match caching"                               |
| features.tsx model pricing claim           | "Updated automatically" (MISLEADING)                     | "Updated with each release"                                   |
| features.tsx Stream Tracker                | "solves vercel/ai#7628" (UNVERIFIABLE)                   | "Survives abort for accurate billing"                         |
| features.tsx Circuit Breaker               | "$847-to-$34K runaway scenario" (UNVERIFIABLE)           | "Prevents runaway LLM spending"                               |
| features.tsx model count                   | "20+ more models"                                        | "40+ more models"                                             |
| cost-estimator.ts provider type            | `"openai" \| "anthropic" \| "google" \| "xai" \| "meta"` | `"openai" \| "anthropic" \| "google"` (aligned with registry) |
| README cache docs                          | No entries()/invalidate() documentation                  | Added Cache Inspection & Invalidation section                 |

## Files Modified (Pass 2)

1. `components/hero.tsx` — Fixed GitHub link, dependency count
2. `components/cost-projection.tsx` — Fixed dependency count
3. `components/features.tsx` — Fixed "Updated automatically", unverifiable claims, model count
4. `SECURITY.md` — Fixed "semantic" → "fuzzy"
5. `lib/tokenshield/cost-estimator.ts` — Removed phantom provider types
6. `README.md` — Added cache API documentation
7. `docs/PROJECT_MAP.md` — Updated for pass 2
8. `docs/CLAIMS_VS_REALITY.md` — Updated for pass 2
9. `docs/MASTER_AUDIT.md` — Full rewrite with 9-perspective critique
10. `docs/BEFORE_AFTER_DIFF.md` — This file

## Test Results (Final)

- **68 test files, 1338 tests passing**
- **TypeScript strict mode: 0 errors**
- **All audit items: RESOLVED**
