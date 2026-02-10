# TokenShield SDK - Extended Specification v2

## Research Summary

Deep analysis of GitHub issues (openai/openai-python#2075, vercel/ai#7628,
langchain-ai/langsmith-sdk#1375, microsoft/graphrag#1917), forum threads
(community.openai.com, Reddit r/ChatGPT, r/LocalLLaMA), production war stories
(toolstac.com enterprise TCO analysis, glukhov.org cost guide), and competitor
SDKs (LiteLLM, Helicone, Langfuse, AgentOps/tokencost) identified the
following gaps and pain points that our current SDK does NOT address.

---

## GAP 1: Tool/Function Definition Token Overhead Counting

**Pain point:** OpenAI and Anthropic inject tool/function JSON schemas into the
prompt as hidden tokens. A single tool definition with a JSON schema can add
200-800 tokens to every request. Developers with 10+ tools defined are paying
for 3,000-8,000 hidden tokens per call and have no idea.

**Evidence:** community.openai.com thread "Correct token counting when calling
with JSON schema" - developers report 15-20% token count mismatch between their
estimates and the OpenAI usage object, all attributable to tool definitions.

**What we need:**
- `countToolDefinitionTokens(tools: ToolDefinition[])` - count exact tokens
  that OpenAI/Anthropic inject for tool schemas
- Include this in the context manager's budget calculations
- Surface this in the cost estimator so users can see "your 12 tool definitions
  cost $X per request"
- Provide `optimizeToolDefinitions(tools)` to minimize description lengths

**Current gap in our SDK:** Our `countChatTokens` only counts message content.
It completely ignores tools/functions. Our context manager doesn't account for
tool overhead when fitting to budget.

---

## GAP 2: Output Token Budget Prediction

**Pain point:** Output tokens cost 2-5x more than input tokens across all
providers. Developers set `max_tokens: 4096` as a safety net, but most responses
use 50-500 tokens. The real problem: there's no way to predict output length
before the call. This means:
- Cost estimates are wildly inaccurate pre-call
- The request guard's cost gate can't properly budget for output
- No mechanism to detect and prevent "runaway outputs" (model generates 4K
  tokens of repetitive content)

**Evidence:** ACL 2025 paper on output length prediction; glukhov.org guide
highlighting output tokens as "outsized impact on costs"; multiple GitHub issues
about max_tokens waste.

**What we need:**
- `predictOutputTokens(prompt, model, options)` - heuristic output length
  predictor based on prompt type (Q&A, summarization, code generation, etc.)
- Smart `max_tokens` setter that adapts per-request instead of fixed values
- Streaming output monitor that detects repetition loops and can abort early
- Integration into the cost estimator for more accurate pre-call estimates

**Current gap:** Our cost estimator and request guard both take
`expectedOutputTokens` as a static parameter. No intelligence around output
prediction exists.

---

## GAP 3: Streaming Token Tracking on Abort

**Pain point:** When a user stops a streaming response (clicks "Stop generating"
or loses connection), the `onFinish` callback never fires. Token usage data is
lost. This breaks billing, quota tracking, and cost analytics in production.
vercel/ai#7628 has 6+ thumbs-up and remains open.

**Evidence:** Direct from vercel/ai#7628 - "Currently really difficult to track
token usage of any partial responses without using tokenizer/estimation
libraries." The AI SDK maintainer confirmed: "AI providers typically do not
report token usage information when the stream is aborted."

**What we need:**
- `StreamTokenTracker` class that counts tokens in real-time as chunks arrive
  using our exact BPE tokenizer
- Tracks both input (known before stream starts) and output (counted as chunks
  arrive)
- Fires a `onAbortUsage` callback with accurate token counts even when the
  stream is interrupted
- Integrates with the cost ledger so no spend goes untracked
- Works with AI SDK's `streamText` and `useChat`

**Current gap:** We have zero streaming support. All our tests use
non-streaming `callOpenAI`. The response cache, cost ledger, and token counter
have no streaming awareness.

---

## GAP 4: Multi-Provider Cost Normalization

**Pain point:** Different providers use different tokenizers. The same text
produces different token counts on OpenAI vs Anthropic vs Google. Enterprise
teams using multiple providers (common strategy per the TCO analysis: "Gemini
Flash for bulk, Claude Sonnet for customer-facing, OpenAI for prototypes")
cannot compare costs accurately.

**Evidence:** toolstac.com: "Token counting bugs cost us $15,238 over two
months. Different providers count tokens differently." Langfuse and Helicone
both offer provider-specific cost inference as a key feature.

**What we need:**
- Provider-aware token counting that uses the correct tokenizer per model
  (cl100k_base for OpenAI, Claude's tokenizer for Anthropic, Gemini's for Google)
- Cross-provider cost comparison: "This prompt costs $X on GPT-4o, $Y on
  Claude Sonnet, $Z on Gemini Pro"
- Cost normalization to a common unit for apples-to-apples comparison
- The model router should compare across providers, not just within one

**Current gap:** We use gpt-tokenizer (cl100k_base) for everything. This is
accurate for OpenAI models but can be 10-20% off for Anthropic and Google.
Our model router and cost estimator don't differentiate tokenizers.

---

## GAP 5: Per-Feature Cost Attribution

**Pain point:** Teams need to know which feature of their app costs the most.
"Chat costs us $2K/mo but document analysis costs $12K/mo." Without attribution,
optimization is blind.

**Evidence:** openai/openai-python#2075 requests "client-specific token tracking
and cost estimation." Langfuse's per-trace cost tagging is one of their most
popular features. The enterprise TCO article mentions spending $3K/month on
Langfuse just for cost attribution.

**What we need:**
- Our cost ledger already has a `feature` tag but it's optional and buried
- Need a prominent `useFeatureCost(featureName)` hook that tracks everything
  within a feature boundary
- Dashboard component showing per-feature cost breakdown
- Support for nested features (e.g., "chat > document-upload > OCR")
- Export per-feature cost reports for finance teams

**Current gap:** The `feature` field exists in the ledger but there's no React
hook or UI for it. The playground doesn't demonstrate it. It's invisible.

---

## GAP 6: Automatic Retry Cost Tracking

**Pain point:** When structured output validation fails, the SDK retries. Each
retry is a full API call. Rate limit 429 errors trigger exponential backoff
retries. These retry costs are often invisible - not tracked, not budgeted.

**Evidence:** Research paper on fault-tolerant GenAI pipelines; toolstac.com:
"Error retries that consume tokens" as a key reason dev costs are 3-5x lower
than production; michaeljordanconsulting.com on 429 retry strategies.

**What we need:**
- Retry-aware request guard: track retry attempts and their cumulative cost
- `maxRetryBudget` config: "don't spend more than $X retrying this request"
- Retry cost attribution in the ledger (separate from primary request cost)
- Exponential backoff with cost awareness (not just time awareness)

**Current gap:** Our request guard handles debouncing and rate limiting but has
no concept of retries. If a user's code retries 5 times, our guard sees 5
independent requests.

---

## GAP 7: Runaway Cost Circuit Breaker

**Pain point:** The #1 fear in production: an autonomous agent loop or a bug
causes thousands of API calls overnight. One company went from $847/month to
$34,127 in 3 months. Hard spending caps that halt all API calls are critical.

**Evidence:** Every single enterprise resource mentions this. toolstac.com: "Set
hard monthly limits that pause APIs instead of auto-charging your credit card
into oblivion." OpenAI's own documentation recommends usage limits.

**What we need:**
- Session-level circuit breaker: "stop all calls after $X spent this session"
- Time-window circuit breaker: "$X per hour, $Y per day, $Z per month"
- Configurable actions: warn, throttle, or hard-stop
- Alert callbacks for integration with monitoring systems
- Persistent state (survives page refresh) via the existing IDB integration

**Current gap:** Our request guard has `maxCostPerHour` but it's in-memory only,
resets on page refresh, and only covers a 1-hour window. No daily/monthly caps.
No persistence. No alert system.

---

## GAP 8: Image/Vision Token Cost Estimation

**Pain point:** GPT-4o, Claude, and Gemini all accept images. Image token costs
are calculated differently (OpenAI uses tile-based counting: 85 tokens base +
170 per 512x512 tile). Developers sending images have no idea what they cost.

**Evidence:** OpenAI's vision pricing documentation; community.openai.com
threads about unexpected costs from image inputs; the cost estimator article
explicitly mentioning vision costs as a hidden expense.

**What we need:**
- `countImageTokens(width, height, detail, provider)` - exact token count for
  an image input based on provider-specific rules
- Integration with cost estimator for vision model pricing
- Warning when image resolution is unnecessarily high (e.g., "resize from
  4000x3000 to 1024x1024 to save 2,340 tokens")

**Current gap:** Our entire SDK assumes text-only messages. Zero support for
multi-modal token counting or cost estimation.

---

## IMPLEMENTATION PRIORITY (for the playground demo)

### Phase 1 - Critical (demonstrate in playground)
1. **Tool Definition Token Counting** - adds a new test showing hidden costs
2. **Output Token Prediction** - improves accuracy of all cost estimates
3. **Streaming Token Tracker** - fills the biggest gap (vercel/ai#7628)
4. **Circuit Breaker** - the most-requested safety feature

### Phase 2 - High Value (SDK modules, no playground test needed yet)
5. **Per-Feature Cost Attribution** - surface the existing ledger feature field
6. **Retry Cost Tracking** - wrap the request guard with retry awareness
7. **Image Token Counting** - vision model support

### Phase 3 - Differentiation
8. **Multi-Provider Normalization** - cross-provider comparison

---

## REVIEW NOTES

Before implementing, verify:
- [ ] Tool definition token counting uses OpenAI's documented formula
      (their format differs from raw JSON - they inject special tokens)
- [ ] Output prediction heuristics are based on published research, not guesses
- [ ] Streaming tracker works with AI SDK 6's streamText API shape
- [ ] Circuit breaker persistence doesn't conflict with existing IDB stores
- [ ] Image token formula matches OpenAI's published tile calculation exactly
