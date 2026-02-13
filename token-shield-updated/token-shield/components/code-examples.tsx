"use client"

import { useState } from "react"
import { Highlight, themes } from "prism-react-renderer"

const EXAMPLES = [
  {
    id: "middleware",
    label: "AI SDK Middleware",
    description: "Drop-in middleware for Vercel AI SDK. Every optimization runs automatically.",
    code: `import { wrapLanguageModel, streamText } from 'ai'
import { tokenShieldMiddleware } from 'tokenshield'

const shielded = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: tokenShieldMiddleware({
    context:  { maxInputTokens: 4000 },
    cache:    { enabled: true, similarityThreshold: 0.85 },
    guard:    { debounceMs: 300, maxCostPerHour: 5.0 },
    prefix:   { provider: 'auto' },
    ledger:   { persist: true },
  }),
})

// Use exactly like before -- savings are automatic
const result = await streamText({ model: shielded, messages })`,
  },
  {
    id: "counter",
    label: "Token Counter",
    description: "Exact BPE token counts matching OpenAI's tiktoken. Works in the browser.",
    code: `import { countExactTokens, countChatTokens, fitsInBudget } from 'tokenshield'

// Count content tokens
const { tokens, characters, ratio } = countExactTokens(userInput)
console.log(\`\${tokens} tokens, \${ratio.toFixed(1)} chars/token\`)

// Count full chat with per-message overhead
const chat = countChatTokens([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: userInput },
])
console.log(\`\${chat.total} total (includes \${chat.overhead} overhead)\`)

// Fast budget check -- stops encoding early if over limit
const { fits } = fitsInBudget(longDocument, 2000)`,
  },
  {
    id: "context",
    label: "Context Manager",
    description: "Trim conversation history to fit a token budget. System messages always preserved.",
    code: `import { fitToBudget, smartFit } from 'tokenshield'

// Basic: keep newest messages within budget
const result = fitToBudget(messages, {
  maxContextTokens: 4000,
  reservedForOutput: 1000,
})
console.log(\`Kept \${result.messages.length}, evicted \${result.evictedCount}\`)

// Smart: auto-summarizes evicted messages so context isn't lost
const smart = smartFit(messages, {
  maxContextTokens: 4000,
  reservedForOutput: 1000,
})
// smart.summary = "Previous conversation summary: [user asked about...]"
sendToAPI(smart.messages)`,
  },
  {
    id: "cache",
    label: "Response Cache",
    description: "Exact + fuzzy matching. Rephrased prompts hit cache. Zero API calls.",
    code: `import { ResponseCache, textSimilarity } from 'tokenshield'

const cache = new ResponseCache({
  maxEntries: 500,
  ttlMs: 3600000,          // 1 hour
  similarityThreshold: 0.82 // fuzzy match threshold
})

// Check cache before API call
const hit = await cache.lookup(userPrompt, 'gpt-4o-mini')
if (hit.hit) {
  return hit.entry.response  // instant, $0
}

// Cache miss -- call API, then store
const response = await callAPI(userPrompt)
await cache.store(userPrompt, response, 'gpt-4o-mini', 150, 80)

// "What is a closure?" and "what is a closure in js?"
// Similarity: 0.89 -- hits cache, saves the API call
textSimilarity("What is a closure?", "what is a closure in js?") // 0.89`,
  },
  {
    id: "router",
    label: "Model Router",
    description: "Route simple queries to cheap models. Send complex ones to flagship.",
    code: `import { analyzeComplexity, routeToModel } from 'tokenshield'

// Analyze prompt complexity (deterministic, no AI needed)
const score = analyzeComplexity("What is the capital of France?")
// { score: 8, tier: "trivial", recommendedTier: "budget" }

const complex = analyzeComplexity("Analyze contract liability risks...")
// { score: 72, tier: "complex", recommendedTier: "premium" }

// Auto-route to cheapest model that can handle the task
const routing = routeToModel(userPrompt, 'gpt-4o', {
  allowedProviders: ['openai'],
})
console.log(\`Use \${routing.selectedModel.name}, save $\${routing.savingsVsDefault}\`)`,
  },
  {
    id: "tools",
    label: "Tool Token Counter",
    description: "Measure the hidden tokens that tool/function definitions inject into every request.",
    code: `import { countToolTokens, optimizeToolDefinitions } from 'tokenshield'

const tools = [
  { type: 'function', function: { name: 'search_web', description: '...', parameters: { ... } } },
  { type: 'function', function: { name: 'get_weather', description: '...', parameters: { ... } } },
  // ... 5 more tools
]

// Count hidden overhead -- these tokens are in EVERY request
const result = countToolTokens(tools, 0.15)  // $0.15/M input price
console.log(\`\${result.totalTokens} hidden tokens per request\`)
console.log(\`$\${result.costOverRequests(10000).toFixed(2)} over 10K requests\`)

// Auto-optimize: shorten descriptions, remove redundant docs
const optimized = optimizeToolDefinitions(tools)
console.log(\`Saved \${optimized.savedTokens} tokens per request\`)`,
  },
  {
    id: "vision",
    label: "Image Token Counter",
    description: "Calculate exact vision model token costs. Recommend optimal resize dimensions.",
    code: `import { countImageTokens } from 'tokenshield'

// OpenAI's tile formula: 85 base + 170 per 512x512 tile
const photo = countImageTokens(4000, 3000, 'high')
// { tokens: 765, tiles: 4, resized: true }

const thumb = countImageTokens(512, 512, 'high')
// { tokens: 255, tiles: 1, resized: false }

// Low detail = fixed 85 tokens regardless of size
const low = countImageTokens(4000, 3000, 'low')
// { tokens: 85, tiles: 0 }

// Auto-recommendation for oversized images
const screen = countImageTokens(1920, 1080, 'high')
// screen.recommendation = { suggestedWidth: 1024, suggestedHeight: 1024, savedTokens: 340 }`,
  },
  {
    id: "stream",
    label: "Stream Tracker",
    description: "Count output tokens in real-time. Even on abort, usage data is never lost.",
    code: `import { StreamTokenTracker } from 'tokenshield'

const tracker = new StreamTokenTracker({
  modelId: 'gpt-4o-mini',
  inputTokens: 150,
  onCostThreshold: (usage) => {
    console.warn(\`Cost threshold hit: $\${usage.estimatedCost}\`)
  },
})

// Wire into AI SDK streaming
const result = await streamText({
  model, messages,
  onChunk: ({ chunk }) => {
    if (chunk.type === 'text-delta') tracker.addChunk(chunk.textDelta)
  },
  onFinish: ({ usage }) => tracker.finish(usage),
})

// User clicks "Stop" -- onFinish never fires, but we still have data
const usage = tracker.abort()
console.log(\`\${usage.outputTokens} tokens, $\${usage.estimatedCost}\`)`,
  },
  {
    id: "breaker",
    label: "Circuit Breaker",
    description: "Hard spending limits. Prevent the $847 to $34,127 runaway cost scenario.",
    code: `import { CostCircuitBreaker } from 'tokenshield'

const breaker = new CostCircuitBreaker({
  limits: {
    perHour: 5.0,
    perDay: 50.0,
    perMonth: 500.0,
  },
  action: 'stop',       // 'warn' | 'throttle' | 'stop'
  persist: true,          // survives page refresh
  onTripped: (event) => {
    alert(\`Budget exceeded: \${event.limitType} limit ($\${event.limit})\`)
  },
  onWarning: (event) => {
    console.warn(\`80% of \${event.limitType} budget used\`)
  },
})

// Check before every API call
const check = breaker.check('gpt-4o', 1000, 500)
if (!check.allowed) throw new Error(check.reason)

// Record actual spend after response
breaker.recordSpend(0.015, 'gpt-4o')`,
  },
  {
    id: "output",
    label: "Output Predictor",
    description: "Predict output length by task type. Set smart max_tokens instead of blanket 4096.",
    code: `import { predictOutputTokens } from 'tokenshield'

// Detects task type and predicts output length
const qa = predictOutputTokens("What is the capital of France?")
// { taskType: "factual-qa", predictedTokens: 30, suggestedMaxTokens: 50 }

const code = predictOutputTokens("Write a React component for...")
// { taskType: "code-generation", predictedTokens: 400, suggestedMaxTokens: 600 }

// Use smart max_tokens instead of wasting budget with 4096
const result = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages,
  max_tokens: prediction.suggestedMaxTokens,  // 50 instead of 4096
})`,
  },
  {
    id: "react",
    label: "React Hooks",
    description: "Provider, hooks, and real-time savings tracking for React/Next.js apps.",
    code: `import {
  TokenShieldProvider,
  useTokenCount,
  useSavings,
  useResponseCache,
  useRequestGuard,
  useModelRouter
} from 'tokenshield/react'

// Wrap your app
<TokenShieldProvider defaultModelId="gpt-4o-mini">
  <App />
</TokenShieldProvider>

// Inside any component:
function ChatInput({ value }) {
  const { tokens, cost } = useTokenCount(value)
  const savings = useSavings()
  const { cachedFetch } = useResponseCache()
  const { checkRequest } = useRequestGuard()
  const { routing } = useModelRouter(value)

  return (
    <div>
      <span>{tokens} tokens (\${cost.toFixed(6)})</span>
      <span>Session savings: \${savings.totalDollarsSaved.toFixed(4)}</span>
    </div>
  )
}`,
  },
]

export function CodeExamples() {
  const [activeId, setActiveId] = useState(EXAMPLES[0].id)
  const active = EXAMPLES.find((e) => e.id === activeId) ?? EXAMPLES[0]

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-border">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            onClick={() => setActiveId(ex.id)}
            className={`shrink-0 min-h-[44px] px-3 py-2 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
              activeId === ex.id
                ? "border-b-2 border-primary bg-secondary/50 text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
            }`}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5">
        <p className="mb-3 text-sm text-muted-foreground">{active.description}</p>
        <Highlight
          theme={themes.vsDark}
          code={active.code}
          language="typescript"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed sm:p-4 sm:text-sm sm:leading-relaxed ${className}`}
              style={style}
            >
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  )
}
