# CLAIMS vs REALITY — Forensic Audit (Pass 2)

> Updated: 2026-02-21 | Auditor: Multi-perspective strike team

---

## README.md Claims

| #   | Claim                                               | Verdict        | Evidence                                                                            |
| --- | --------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| 1   | "Drop-in middleware"                                | **TRUE**       | `shield()` returns LanguageModelV3Middleware-compatible object                      |
| 2   | "without changing your prompts"                     | **TRUE**       | `transformParams` handles optimization transparently                                |
| 3   | "Works with Vercel AI SDK, OpenAI, and Anthropic"   | **TRUE**       | `adapters.ts` has all three adapter factories                                       |
| 4   | "TypeScript-first"                                  | **TRUE**       | Strict mode, full type exports, Valibot validation                                  |
| 5   | "v0.1.0-beta.1 (pre-release)"                       | **TRUE**       | package.json matches                                                                |
| 6   | "Not yet published to npm"                          | **TRUE**       | Honest disclosure                                                                   |
| 7   | "Caching, compression, cost tracking on by default" | **TRUE**       | `shield.ts` defaults confirm                                                        |
| 8   | "Fuzzy caching"                                     | **TRUE**       | Bigram Dice coefficient — correctly described as fuzzy, not semantic                |
| 9   | "Prompt compression — removes redundancy"           | **TRUE**       | `prompt-compressor.ts` implements 5 techniques                                      |
| 10  | "< 5ms overhead"                                    | **UNVERIFIED** | No benchmark results in repo. Plausible for in-memory but IDB reads may exceed this |
| 11  | "Delete 3 lines to remove"                          | **TRUE**       | import + wrapLanguageModel + shield() = 3 lines                                     |
| 12  | "Data stays in your infra"                          | **TRUE**       | SECURITY.md: client-side only, zero telemetry                                       |
| 13  | "4 runtime dependencies"                            | **TRUE**       | gpt-tokenizer, idb-keyval, mitt, valibot (verified in package.json)                 |

## Website (hero.tsx + cost-projection.tsx) Claims

| #   | Claim                                                       | Verdict        | Evidence                                        |
| --- | ----------------------------------------------------------- | -------------- | ----------------------------------------------- |
| 14  | "2 deps: gpt-tokenizer + idb-keyval" (hero.tsx:92)          | **FALSE**      | 4 deps. `mitt` and `valibot` are unlisted.      |
| 15  | "2 dependencies" (cost-projection.tsx:260)                  | **FALSE**      | Same as #14                                     |
| 16  | GitHub link `href="https://github.com"` (hero.tsx:105)      | **BROKEN**     | Points to github.com homepage, not the repo     |
| 17  | `npm install @tokenshield/ai-sdk` (hero.tsx:78)             | **MISLEADING** | Package not published to npm. Command will fail |
| 18  | `npm install @tokenshield/ai-sdk` (cost-projection.tsx:257) | **MISLEADING** | Same as #17                                     |
| 19  | "3 Lines to add" (hero.tsx:118)                             | **TRUE**       | Matches README code example                     |
| 20  | "0 Config required" (hero.tsx:119)                          | **TRUE**       | `shield()` works with no arguments              |
| 21  | "<5ms Middleware overhead" (hero.tsx:121)                   | **UNVERIFIED** | No benchmark data                               |
| 22  | "3 SDKs supported" (hero.tsx:122)                           | **TRUE**       | Vercel AI SDK + OpenAI + Anthropic adapters     |

## features.tsx Claims

| #   | Claim                                         | Verdict              | Evidence                                                     |
| --- | --------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| 23  | "Matches usage.prompt_tokens within 2 tokens" | **UNVERIFIED**       | No automated accuracy test against real API                  |
| 24  | "20+ more models. Updated automatically."     | **MISLEADING**       | 40+ models but update is a manual script, not automatic      |
| 25  | "Auto-summarizes evicted messages"            | **TRUE**             | `context-manager.ts` has summarization                       |
| 26  | "Saves 80-95%" Model Router                   | **TRUE (per-query)** | Per-hit max when routing to budget model. Disclaimed on page |
| 27  | "Saves 100%" Response Cache                   | **TRUE (per-hit)**   | Cache hit avoids API call entirely. Disclaimed on page       |
| 28  | "solves vercel/ai#7628"                       | **UNVERIFIABLE**     | No link, no evidence this issue exists or was tested         |
| 29  | "$847-to-$34K runaway scenario"               | **UNVERIFIABLE**     | Specific numbers with no citation                            |

## live-demo.tsx Claims

| #   | Claim                                                | Verdict        | Evidence                                                      |
| --- | ---------------------------------------------------- | -------------- | ------------------------------------------------------------- |
| 30  | "API tests hit OpenAI and return real usage objects" | **MISLEADING** | Requires OPENAI_API_KEY env var. Won't work for most visitors |

## SECURITY.md Claims

| #   | Claim                                               | Verdict   | Evidence                                                     |
| --- | --------------------------------------------------- | --------- | ------------------------------------------------------------ |
| 31  | "Semantic and exact-match caching" (line 24)        | **STALE** | Was renamed to "fuzzy" in previous audit. SECURITY.md missed |
| 32  | "Zero telemetry"                                    | **TRUE**  | Verified: no network calls, no beacons                       |
| 33  | "EncryptedStore module provides AES-GCM encryption" | **TRUE**  | `crypto-store.ts` implements it                              |

## Missing from Docs

| Feature                               | Status                                      |
| ------------------------------------- | ------------------------------------------- |
| `entries()` cache inspection API      | Implemented, not documented                 |
| `invalidate()` cache removal API      | Implemented, not documented                 |
| `resetComplexityCache()` test utility | Implemented, not documented (test-only, OK) |
| Prompt Compressor standalone usage    | In `advanced.ts` exports, minimal docs      |
| Delta Encoder standalone usage        | In `advanced.ts` exports, minimal docs      |
| Pipeline builder API                  | Exists but undocumented                     |
| Web Worker interface                  | `shield-worker.ts` exists, undocumented     |

---

## Summary

- **13 TRUE** claims (honest, verified)
- **4 FALSE/BROKEN** claims (dependency count, GitHub link)
- **5 UNVERIFIED** claims (no benchmark data, no external validation)
- **3 MISLEADING** claims (npm install, "updated automatically", live demo)
- **1 STALE** claim (SECURITY.md "semantic" reference)
