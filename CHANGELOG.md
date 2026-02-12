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
