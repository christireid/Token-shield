# Changelog

All notable changes to Token Shield will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.1] - 2026-02-15

### Added

- **Audit log convenience methods**: New `logBudgetWarning()`, `logBreakerReset()`, `logLicenseActivated()`, and `logExportRequested()` methods on `AuditLog` covering all 14 audit event types.
- **`subscribeToAnyEvent` export**: Dynamic event subscription helper now exported from the main entry point for plugin and integration use.
- **`SavingsAttributionSection` export**: Dashboard attribution component now exported from the main entry point.
- **Error observability callbacks**: New `onPersistError` on `AuditLogConfig`, `onStorageError` on `CacheConfig`, and `onStorageError` on `EncryptedStoreConfig` surface IndexedDB/crypto failures instead of silently swallowing them.
- **Middleware `userBudget:warning` wiring**: Budget warning events now flow to the audit log via `logBudgetWarning()`.
- **Dashboard sections tests**: 20 tests covering `formatDollars`, `formatPercent`, and all `summarizeEventData` branches including `anomaly:detected` and `router:holdback`.
- **Compressor/delta event emission tests**: 6 tests verifying audit chain integrity, event payloads, dispose cleanup, and external listener support.
- **Delta encoder re-export tests**: 4 tests verifying identity and functional correctness of the `delta-encoder.ts` alias.
- **License activation module tests**: Export validation and type-level tests for the `LicenseActivation` component.

### Changed

- **Adapter type safety**: `createOpenAIAdapter` and `createAnthropicAdapter` now use `AdapterMessage[]` instead of `any[]` in generic constraints.
- **Adapter param hygiene**: Generic and stream adapters now strip the internal AI-SDK `prompt` field before passing params to user callbacks.
- **Plugin event wiring**: `middleware-plugin.ts` uses the type-safe `subscribeToAnyEvent` helper instead of raw `as any` casts.
- **Persist timer cleanup**: `AuditLog.clear()` now cancels pending debounced persist timers to avoid redundant IDB writes.

### Fixed

- **`useEventLog` missing subscriptions**: Added `anomaly:detected` and `router:holdback` to the event type list in `useEventLog`.
- **`summarizeEventData` missing cases**: Added `anomaly:detected` and `router:holdback` branches to the dashboard event summarizer.
- **`EVENT_COLORS` missing entries**: Added `anomaly:detected` and `router:holdback` to the dashboard color map.

### Documentation

- **API client JSDoc**: Added `@throws` documentation to `callOpenAI`, `callAnthropic`, `callGoogle`, and `callLLM`.

## [0.4.0] - 2026-02-15

### Added

- **Middleware plugin registry**: New `registerPlugin()`, `unregisterPlugin()`, and `getRegisteredPlugins()` APIs enable third-party plugins that auto-wire event handlers and lifecycle hooks. Plugins are initialized during middleware creation and cleaned up on dispose.
- **Subpath exports for tree-shaking**: New package.json exports map enables granular imports: `@tokenshield/ai-sdk/license`, `@tokenshield/ai-sdk/audit-log`, `@tokenshield/ai-sdk/compressor`, `@tokenshield/ai-sdk/delta-encoder`, `@tokenshield/ai-sdk/middleware`. Each subpath produces a separate chunk for minimal bundle sizes.
- **Compressor/delta event bus emissions**: New `compressor:applied` and `delta:applied` events are emitted to the event bus when savings > 0, enabling telemetry subscribers and audit log recording. Both events include `savedTokens`, `originalTokens`, and compressed/encoded token counts.
- **ECDSA convenience wrapper**: New `configureLicenseKeys({ publicKey, privateKey? })` function reduces ECDSA setup from 2-3 separate calls to a single function call.
- **Savings attribution dashboard**: New `SavingsAttributionSection` component with stacked bar visualization and per-module breakdown (cache, compressor, delta, router, context, prefix). New `savingsAttribution` prop on `TokenShieldDashboard`.
- **License activation component**: New `LicenseActivation` React component for self-serve key input, validation feedback, tier display, and feature unlock confirmation. Includes real-time module list.
- **Delta encoder re-export alias**: New `delta-encoder.ts` provides the shorter import path `./delta-encoder` for naming consistency with other modules.
- **Coverage threshold enforcement**: CI now enforces minimum coverage thresholds (70% statements/lines, 60% branches/functions) on Node 20 to prevent coverage regression.
- **Negative ECDSA tests**: New tests for corrupted signatures, empty signature after prefix, and `configureLicenseKeys` convenience wrapper.
- **Plugin registry tests**: 10 tests covering registration, deduplication, cleanup, event auto-wiring, and graceful error handling.
- **generateTestKey signing option**: New `opts.signing` parameter (`"ecdsa" | "hmac" | "auto"`) for explicit algorithm selection. Throws if ECDSA requested without private key.

### Changed

- **HMAC signing always uses SHA-256**: `hmacSign()` no longer falls back to djb2 — requires Web Crypto API (Node 18+, all modern browsers). The djb2 path is retained only for backward-compatible signature verification and deprecated `generateTestKeySync()`.
- **generateTestKeySync deprecated**: Marked as `@deprecated` in JSDoc. Prefer async `generateTestKey()` which uses HMAC-SHA256 or ECDSA.
- **verifyIntegrity() caching**: Integrity results are now cached and only recomputed when new entries are added, eliminating O(n) overhead on dashboard re-renders.
- **Version bump**: 0.3.0 → 0.4.0

## [0.3.0] - 2026-02-15

### Added

- **Open-core license gating**: New `activateLicense()`, `isModulePermitted()`, and `getModuleTier()` functions for tiered feature access (Community/Pro/Team/Enterprise). All features unlocked in development; license keys required for production.
- **Enterprise audit logging**: New `AuditLog` class with tamper-evident hash chaining, structured event recording, integrity verification, and JSON/CSV export for compliance reporting.
- **HMAC-SHA256 license key signing**: License keys are now signed with HMAC-SHA256 (Web Crypto) or djb2 fallback. New `setLicenseSecret()` enables signature verification. Algorithm-prefixed signatures (`sha256:`, `djb2:`) ensure cross-environment compatibility between sync and async key generation.
- **ECDSA P-256 asymmetric license signing**: New `generateLicenseKeyPair()`, `setLicensePublicKey()`, and `setLicensePrivateKey()` functions enable asymmetric key signing where only the server can generate valid keys. Zero shared secrets on the client.
- **Audit log IndexedDB persistence**: New `persist` and `storageKey` options on AuditLogConfig. Entries are automatically persisted with debounced writes. New `hydrate()` method for startup recovery.
- **Audit log middleware wiring**: Middleware event bus automatically forwards 7 event types to the audit log: `ledger:entry`, `cache:hit`, `request:blocked`, `breaker:tripped`, `userBudget:exceeded`, `anomaly:detected`, `router:downgraded`.
- **License enforcement in middleware**: Middleware init checks `isModulePermitted()` for each enabled module and warns when license tier is insufficient.
- **Auto-hydration**: Middleware automatically hydrates the audit log from IndexedDB on startup when `persist: true`.
- **Prompt compressor middleware integration**: New `compressor` config option applies client-side prompt compression (stopword elision, verbose pattern contraction, redundancy elimination) to all user messages. 15-40% token savings. Enabled by default.
- **Delta encoder middleware integration**: New `delta` config option eliminates cross-turn paragraph duplication, system prompt overlap, and quoted response redundancy. Enabled by default.
- **Dashboard audit log panel**: New `auditLog` prop on `TokenShieldDashboard` renders a filterable, severity-colored audit event feed with JSON/CSV export buttons.
- **Content-type-aware cache TTL**: ResponseCache now classifies prompts as factual (7d TTL), general (24h), or time-sensitive (5min) using pattern matching. Configurable via `ttlByContentType` option.
- **Pricing validation script**: New `npm run validate-pricing` cross-references `models.json` against the `llm-info` npm package to detect stale or incorrect pricing data.
- **Single source of truth pricing sync**: New `models.json` data file and `npm run sync-pricing` codegen script generates pricing data in 3 target files from a single JSON source. Runs as prebuild hook.
- **CI bundle size validation**: CI workflow now validates package contents with `npm pack --dry-run` and enforces a 500KB ESM bundle ceiling.
- **Unit tests**: 42 license tests (tier hierarchy, HMAC/ECDSA signing, key forgery detection, expiry, permission enforcement), 41 audit-log tests (recording, hash chain, filtering, export, pruned chain verification), 12 middleware audit integration tests, 5 E2E compliance lifecycle tests.

### Changed

- **BREAKING: `activateLicense()` is now async**: Returns `Promise<LicenseInfo>` instead of `LicenseInfo`. Callers must `await` the result. This change was necessary to support Web Crypto API HMAC-SHA256 signature verification.
  ```ts
  // Before (v0.2.0)
  const info = activateLicense(key)
  // After (v0.3.0)
  const info = await activateLicense(key)
  ```
- **BREAKING: `generateTestKey()` is now async**: Returns `Promise<string>`. Use `generateTestKeySync()` for synchronous key generation in tests.
- **Pricing consolidation**: `cost-estimator.ts` now derives `MODEL_PRICING` from `PRICING_REGISTRY` (single source of truth), eliminating ~230 lines of duplicate pricing data.
- **Audit log hash chain**: SHA-256 (Web Crypto) replaces djb2 for hash chain integrity. Fallback hashes are prefixed with `djb2_` to clearly identify non-cryptographic hashes.
- **Audit log pruning**: `verifyIntegrity()` now correctly handles pruned chains, returning `{ valid: true, pruned: true, verifiedFrom: seq }` instead of a false integrity failure.
- **Model pricing updates**: Added 15+ models (GPT-5 family, Claude 4.5/4.6, Gemini 3, o3-pro, o4-mini). Fixed GPT-4.1 family cached input discount (0.5 → 0.75), Gemini 2.5 Flash pricing, GPT-5.2 context window (128K → 400K).
- **Token counter accuracy**: Updated Anthropic correction factor (1.10 → 1.35) and Google correction factor (1.15 → 1.12) based on empirical measurement against provider APIs.
- **CacheConfig schema**: Added `ttlByContentType` field to Valibot validation schema.
- **Version bump**: 0.2.0 → 0.3.0

## [0.2.0] - 2026-02-12

### Fixed

- **ResponseCache model scoping**: Cache keys now include model ID, preventing cross-model contamination where a response cached for one model (e.g. gpt-4o) could be incorrectly served for a different model (e.g. gpt-4o-mini)
- **ResponseCache shared mutable state**: Cache lookups now use copy-on-read semantics instead of directly mutating shared cache entries, preventing race conditions in concurrent access scenarios
- **safeCost() silent failure**: Unknown models now use fallback pricing (based on GPT-4o-mini rates) instead of returning $0, which was silently bypassing budget enforcement and circuit breaker limits
- **Stream usage recording**: The `usageRecorded` flag is now only set after successful recording, allowing retries if the initial write fails (e.g. due to IndexedDB quota)

### Added

- **MIT LICENSE file**: Clear open-source licensing for adoption by engineering teams
- **README.md**: Value-proposition-focused documentation with architecture overview
- **CHANGELOG.md**: This file, for tracking changes across releases
- **Deduplication window in middleware config**: The `guard.deduplicateWindow` option is now exposed through `tokenShieldMiddleware()` config, enabling time-based deduplication of identical prompts
- **Tool token overhead in context budget**: Middleware now subtracts tool/function definition token overhead from context budgets before trimming, preventing over-allocation that leads to 400 errors
- **Dry-run mode**: New `dryRun` config option simulates the full middleware pipeline without modifying behavior, emitting descriptions of each optimization via `onDryRun` callback for pre-production evaluation
- **Per-request router override**: New `routerOverride` config function lets callers force a specific model for individual requests, bypassing complexity-based routing
- **Tool definitions in stable prefix**: Prefix optimizer now classifies tool/function messages as stable content, improving provider prompt cache hit rates for tool-heavy applications
- **Model-specific tokenizer accuracy**: New `getTokenizerAccuracy()` function reports whether token counts are exact (OpenAI cl100k_base) or approximate (Anthropic, Google) with margin-of-error estimates
- **Savings calculator**: New `estimateSavings()` utility and `SavingsCalculator` React component for estimating per-module ROI on landing pages and onboarding flows
- **Trigram cache encoding**: New `cache.encodingStrategy: "trigram"` option for trigram-based semantic similarity matching that catches paraphrased prompts better than bigram Dice coefficient
- **A/B test holdback for router**: New `router.abTestHoldback` config (0-1) skips routing for a random fraction of requests, enabling quality comparison between routed and unrouted calls
- **Edge Runtime compatibility**: New storage adapter layer auto-detects IndexedDB availability and falls back to in-memory `Map` storage for Vercel Edge Runtime, Cloudflare Workers, and other environments without IndexedDB. New `isPersistent()` export indicates whether data survives page reload
- **`router:holdback` event**: Event bus emits `router:holdback` when A/B test holdback skips routing

## [0.1.0] - 2026-01-01

### Added

- Initial release with 12 core modules
- Vercel AI SDK middleware integration (`wrapLanguageModel`)
- Token Counter (BPE-accurate via gpt-tokenizer)
- Response Cache (exact + fuzzy matching, IndexedDB persistence)
- Context Manager (4 trimming algorithms)
- Model Router (12-dimension complexity scoring)
- Request Guard (debounce, rate limit, dedup, cost gate)
- Prefix Optimizer (OpenAI, Anthropic, Google cache optimization)
- Cost Ledger (per-request tracking with savings attribution)
- Circuit Breaker (spending limits with warn/throttle/stop)
- Stream Tracker (real-time output token counting)
- Tool Token Counter (function definition + image token estimation)
- User Budget Manager (per-user daily/monthly quotas)
- 17 React hooks for real-time cost visibility
- Framework adapters (OpenAI, Anthropic, Generic, Stream)
- Valibot config validation
- Event bus (mitt-based pub/sub)
- Structured logger with span support
- 14 test suites (unit, integration, e2e)
