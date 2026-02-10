# Review of TokenShield SDK

## Overview

TokenShield is a client‑side React/TypeScript SDK intended to reduce large language model (LLM) API costs.  The SDK wraps calls made through the Vercel AI SDK and applies a series of optimizations such as request guarding, response caching, context trimming, model routing, prefix optimization and cost ledgers.  Two specification documents (`SPEC.md` and `EXTENDED_SPEC.md`) outline the product vision, required features, and design goals.  The repository includes a set of demonstration components with “REAL TEST” cases that run against a local API proxy to verify correctness.

In the course of reviewing the codebase, several issues were identified and addressed.  This report indexes the principal modules, highlights discrepancies between the implementation and the specifications, notes bugs found in the existing code, and proposes or implements fixes where appropriate.

## Identified Bugs and Fixes

### 1. Usage field names in `api‑client.ts`

**Problem:**  OpenAI’s usage object names its fields `prompt_tokens` and `completion_tokens`, whereas other providers like Anthropic and Google use `input_tokens` and `output_tokens`.  The original implementation of `callOpenAI` returned only `input_tokens` and `output_tokens`, leaving `prompt_tokens` and `completion_tokens` undefined.  This caused the demonstration tests (for example in `tokenizer-test.tsx`) to access undefined properties on the usage object, resulting in incorrect cost calculations.

**Fix:**  The `LLMResult` type and the provider functions (`callOpenAI`, `callAnthropic`, `callGoogle`) were updated to expose both naming conventions.  When OpenAI’s response contains `prompt_tokens` and `completion_tokens`, these are surfaced directly; otherwise, `input_tokens` and `output_tokens` are mapped to `prompt_tokens` and `completion_tokens` for compatibility.  A `total_tokens` property is always provided, ensuring that both older code and test cases find the expected fields.  The change also updates the type documentation to clarify the intended behaviour.

### 2. Token counting and cost estimation consistency

The SDK uses `gpt-tokenizer` to count tokens.  The functions `countExactTokens` and `countChatTokens` were found to match OpenAI’s documented formula when tested via the demonstration components.  However, the context manager uses an internal helper `messageTokens` that counts per‑message tokens slightly differently (structural overhead of four tokens plus role and content tokens).  Because the context manager deliberately reserves the chat overhead separately (three tokens for priming), it ends up matching `countChatTokens` overall.  No changes were required here, but this behaviour should be kept in mind when comparing counts between modules.

### 3. API mismatch with the specification

The specification describes the request guard configuration using fields such as `maxConcurrent`, `minInputLength`, `maxInputTokens` and `deduplicateWindow`.  The actual `RequestGuard` class exposes a different API (`debounceMs`, `maxRequestsPerMinute`, `maxCostPerHour`, `modelId`, `deduplicateInFlight`).  The demonstration tests are written against the implemented API, so this mismatch does not break the test suite.  Nevertheless, it is important to be aware that the current implementation does **not** enforce a minimum input length or a maximum number of concurrent requests, and it deduplicates only in‑flight requests (not within a time window).  Developers using the library should not assume the specification API is present.

### 4. Deduplication and duplicate suppression

The request guard performs in‑flight deduplication only: if an identical prompt is sent while another request with the same normalized prompt is still in progress, the guard blocks the second request.  The specification’s `deduplicateWindow` feature, which would deduplicate identical prompts within a time window (e.g., 5 seconds), is not implemented.  This means that once a request completes, sending the same prompt again will produce another API call immediately, even if the two calls are identical and arrive within milliseconds of each other.  Implementing `deduplicateWindow` would improve duplicate suppression and align the library more closely with the specification.

### 5. Other specification gaps

Many features outlined in the extended specification have only been partially implemented or are missing entirely.  These include:

| Gap | Status |
| --- | --- |
| **Tool definition token overhead counting** | Implemented in `lib/tokenshield/tool-token-counter.ts` with functions to serialize tool definitions, count the hidden tokens added by providers and optimize definitions.  Usage of this module in the middleware is not yet integrated into the context manager. |
| **Output token budget prediction** | Implemented as `predictOutputTokens` and integrated into the cost estimator.  However, neither the request guard nor the middleware uses this to dynamically set `max_tokens` or warn about runaway outputs. |
| **Streaming token tracking** | Implemented in `lib/tokenshield/stream-tracker.ts` as `StreamTokenTracker`, which can count output tokens in real time even when streaming is aborted.  Integration with the AI SDK middleware remains to be wired up in `middleware.ts`. |
| **Cost circuit breaker** | Implemented in `lib/tokenshield/circuit-breaker.ts`.  It exposes per‑session, hourly, daily and monthly limits with configurable actions.  The middleware does not currently hook into it, so users need to instantiate and manage the breaker manually. |
| **Multi‑provider cost normalization** | Not yet implemented.  All token counting uses `gpt-tokenizer`, which is accurate for OpenAI but can be off by 10–20 % for Anthropic and Google.  Cross‑provider comparisons rely on the OpenAI tokenizer. |
| **Per‑feature cost attribution** | Partially implemented: the cost ledger accepts a `feature` tag, but no React hook or dashboard surfaces these values. |
| **Retry cost tracking** | Not implemented.  The request guard does not track cumulative cost across retries. |
| **Image/vision token counting** | Implemented via `countImageTokens` inside `tool-token-counter.ts`, but not used elsewhere. |
| **Automatic retry budget and circuit breaker hooks** | Not implemented. |

These gaps are not bugs per se, but developers should be aware that many advanced features described in the specification remain aspirational or require manual integration.

## Recommended Improvements

1. **Implement deduplication window:**  Add a `deduplicateWindow` setting to `GuardConfig` and maintain a map of recent prompts with timestamps.  When `check` is called, block any prompt that matches one in the map whose timestamp is within the configured window.  This will prevent back‑to‑back duplicate prompts from being sent even after the original request has completed.  The default window (e.g., 5 seconds) can be made configurable.

2. **Expose minimum input length and maximum token budget checks:**  Extend `GuardConfig` to include `minInputLength` and `maxInputTokens`.  Reject prompts shorter than the minimum length and block any prompt whose estimated token count (using `countTokens`) exceeds the configured maximum.  This aligns the request guard with the specification and provides additional safety for developers.

3. **Integrate the circuit breaker and stream tracker into the middleware:**  The middleware currently does not use the `StreamTokenTracker` or `CostCircuitBreaker`.  Integrating these modules into `middleware.ts` would ensure that streaming responses are accurately tracked and that spending caps are enforced without requiring developers to wire these components manually.

4. **Provider‑specific tokenizers:**  To achieve accurate cross‑provider cost estimation, incorporate Anthropic’s and Google’s tokenizers when counting input and output tokens for those providers.  The open‑source community maintains tokenizers for these models.  The `countChatTokens` function could dispatch to the correct tokenizer based on the model name.

5. **Hooks for per‑feature costs and retry tracking:**  Provide React hooks such as `useFeatureCost` and add fields to the cost ledger for retry counts and costs.  Exposing these metrics in the UI will help users understand where their money is going.

6. **Test coverage for edge cases:**  While the demonstration components cover key workflows, there are no automated unit tests for modules like the circuit breaker, stream tracker, or tool token counter.  Adding such tests would increase confidence in the implementation and catch regressions.

## Conclusion

The TokenShield SDK provides a solid foundation for client‑side cost optimisation of LLM calls.  The core modules (token counting, request guard, context trimming, model routing, prefix optimisation, and cost ledger) work cohesively and are exercised by the example components.  One critical bug in the usage field naming was fixed, enabling the tests to access OpenAI’s `prompt_tokens` and `completion_tokens` correctly.  Several specification‑defined features remain unimplemented or partially implemented, and the request guard’s API diverges from the specification.  By addressing the recommended improvements, TokenShield can move closer to fulfilling the ambitious goals outlined in its specification and deliver even greater value to developers.