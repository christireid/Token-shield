# Changelog

All notable changes to Token Shield will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-02-12

### Fixed

- **ResponseCache model scoping**: Cache keys now include model ID, preventing cross-model contamination where a response cached for one model (e.g. gpt-4o) could be incorrectly served for a different model (e.g. gpt-4o-mini)
- **ResponseCache shared mutable state**: Cache lookups now use copy-on-read semantics instead of directly mutating shared cache entries, preventing race conditions in concurrent access scenarios
- **safeCost() silent failure**: Unknown models now use fallback pricing (based on GPT-4o-mini rates) instead of returning $0, which was silently bypassing budget enforcement and circuit breaker limits
- **Stream usage recording**: The `usageRecorded` flag is now only set after successful recording, allowing retries if the initial write fails (e.g. due to IndexedDB quota)

### Added

- **MIT LICENSE file**: Clear open-source licensing for adoption by engineering teams
- **README.md**: Value-proposition-focused documentation with ROI calculator, competitive comparison, and architecture overview
- **CHANGELOG.md**: This file, for tracking changes across releases
- **COMMERCIAL-READINESS-REVIEW.md**: Comprehensive 5-persona stakeholder analysis
- **Deduplication window in middleware config**: The `guard.deduplicateWindow` option is now exposed through `tokenShieldMiddleware()` config, enabling time-based deduplication of identical prompts
- **Tool token overhead in context budget**: Middleware now subtracts tool/function definition token overhead from context budgets before trimming, preventing over-allocation that leads to 400 errors
- **Dry-run mode**: New `dryRun` config option simulates the full middleware pipeline without modifying behavior, emitting descriptions of each optimization via `onDryRun` callback for pre-production evaluation
- **Per-request router override**: New `routerOverride` config function lets callers force a specific model for individual requests, bypassing complexity-based routing
- **Tool definitions in stable prefix**: Prefix optimizer now classifies tool/function messages as stable content, improving provider prompt cache hit rates for tool-heavy applications
- **Model-specific tokenizer accuracy**: New `getTokenizerAccuracy()` function reports whether token counts are exact (OpenAI cl100k_base) or approximate (Anthropic, Google) with margin-of-error estimates
- **Savings calculator**: New `estimateSavings()` utility and `SavingsCalculator` React component for estimating per-module ROI on landing pages and onboarding flows
- **Holographic cache encoding**: New `cache.encodingStrategy: "holographic"` option for trigram-based semantic similarity matching that catches paraphrased prompts better than bigram Dice coefficient
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
