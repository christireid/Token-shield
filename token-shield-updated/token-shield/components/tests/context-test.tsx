"use client"

/**
 * REAL TEST: Context Manager
 *
 * Sends a long conversation (20 messages) to OpenAI in two ways:
 * A) Raw: all 20 messages sent as-is
 * B) Trimmed: TokenShield fitToBudget trims to a budget
 *
 * We compare OpenAI's usage.prompt_tokens from both responses.
 * The difference is real money saved.
 */

import { useState } from "react"
import { fitToBudget, type Message } from "@/lib/tokenshield/context-manager"
import { countChatTokens, type ChatMessage } from "@/lib/tokenshield/token-counter"
import { callOpenAI, calculateRealCost } from "@/lib/tokenshield/api-client"
import { Button } from "@/components/ui/button"

// Generate a realistic 20-message conversation
function generateConversation(): Message[] {
  const msgs: Message[] = [
    {
      role: "system",
      content:
        "You are a helpful assistant that specializes in web development, React, TypeScript, and modern frontend architecture. Always provide concise, practical advice.",
    },
    { role: "user", content: "I'm building a React app with TypeScript. Should I use Vite or Next.js for my project?" },
    { role: "assistant", content: "It depends on your needs. If you need server-side rendering, API routes, file-based routing, and optimized production builds, Next.js is the better choice. If you want a pure SPA with fast HMR and minimal configuration, Vite is excellent. For most production apps, I'd recommend Next.js because of its built-in optimizations and deployment story." },
    { role: "user", content: "I went with Next.js. Now I need to set up authentication. What are my options?" },
    { role: "assistant", content: "For Next.js authentication, your main options are: 1) NextAuth.js (now Auth.js) - the most popular, supports many providers, handles sessions. 2) Clerk - fully managed auth with beautiful UI components. 3) Supabase Auth - if you're using Supabase for your database. 4) Custom JWT implementation with middleware. For most projects, I'd start with Auth.js because it's free, flexible, and well-documented." },
    { role: "user", content: "What about state management? Redux seems heavy for my project." },
    { role: "assistant", content: "Redux is indeed heavy for most modern React apps. Better alternatives: 1) Zustand - minimal API, tiny bundle (1KB), works great with TypeScript. 2) Jotai - atomic state management, bottom-up approach. 3) React Query/TanStack Query - for server state (API data caching). 4) Just React Context + useReducer for simple global state. My recommendation: use TanStack Query for server state and Zustand for client state." },
    { role: "user", content: "How do I handle form validation in React?" },
    { role: "assistant", content: "Use React Hook Form with Zod for schema validation. React Hook Form is performant because it minimizes re-renders using uncontrolled components. Zod gives you TypeScript-first schema validation with great error messages. Together they're the gold standard. Install: npm i react-hook-form @hookform/resolvers zod. Define your schema with z.object(), then use useForm with zodResolver." },
    { role: "user", content: "I need to implement a data table with sorting, filtering, and pagination. What should I use?" },
    { role: "assistant", content: "TanStack Table (formerly React Table) v8 is the standard. It's headless (you control the UI), supports sorting, filtering, pagination, column resizing, and virtual scrolling. Pair it with shadcn/ui's Table component for styling. For simpler cases, shadcn/ui has a DataTable example that wraps TanStack Table with a nice API." },
    { role: "user", content: "What's the best way to handle API calls in Next.js?" },
    { role: "assistant", content: "In Next.js App Router: 1) Server Components - fetch directly in the component, data fetches on the server. 2) Route Handlers (app/api/) - for mutations and external API proxying. 3) Server Actions - for form submissions and mutations, call server code from client. For client-side data fetching, use SWR or TanStack Query. Avoid fetching in useEffect. The pattern is: server components for initial data, server actions for mutations, SWR for real-time client updates." },
    { role: "user", content: "How do I optimize images in my Next.js app?" },
    { role: "assistant", content: "Use the next/image component. It automatically: 1) Lazy loads images, 2) Serves WebP/AVIF formats, 3) Resizes to the correct dimensions, 4) Adds blur placeholders. For external images, add the domains to next.config.js images.remotePatterns. For large hero images, use priority prop to preload them. Use the fill prop for responsive images in containers. Avoid width/height guessing - use actual image dimensions." },
    { role: "user", content: "I need to add dark mode to my app. What's the cleanest approach?" },
    { role: "assistant", content: "Use next-themes with Tailwind CSS. Install: npm i next-themes. Wrap your app with ThemeProvider in layout.tsx. Use the 'class' strategy in tailwind.config (darkMode: 'class'). Then use dark: prefix in your Tailwind classes. For system preference detection, next-themes handles it automatically. Use the useTheme hook to toggle. Store preference in localStorage (next-themes does this too)." },
    { role: "user", content: "One more thing - should I deploy to Vercel or can I self-host Next.js?" },
    { role: "assistant", content: "Vercel is the path of least resistance for Next.js - zero config, automatic preview deployments, edge functions, analytics. For self-hosting: you can use Docker with 'next start', deploy to AWS with SST, or use Coolify for a self-hosted Vercel-like experience. Self-hosting means you manage caching, CDN, and serverless functions yourself. For most teams, Vercel saves enough engineering time to justify the cost." },
    { role: "user", content: "Based on everything we discussed, give me a quick summary of the tech stack you'd recommend for my project." },
  ]
  return msgs
}

interface TestResult {
  label: string
  messagesCount: number
  openaiPromptTokens: number
  openaiCompletionTokens: number
  openaiTotalTokens: number
  realCost: { inputCost: number; outputCost: number; totalCost: number }
  latencyMs: number
  response: string
  clientTokenEstimate: number
  model: string
}

export function ContextManagerTest() {
  const [running, setRunning] = useState(false)
  const [rawResult, setRawResult] = useState<TestResult | null>(null)
  const [trimmedResult, setTrimmedResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runTest() {
    setRunning(true)
    setError(null)
    setRawResult(null)
    setTrimmedResult(null)

    const conversation = generateConversation()
    const model = "gpt-4o-mini"

    try {
      // A) RAW: Send all 20 messages as-is
      const rawMessages = conversation.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }))

      const rawClientTokens = countChatTokens(rawMessages as ChatMessage[])

      const rawResponse = await callOpenAI(rawMessages, model, { max_tokens: 300 })
      const rawCost = calculateRealCost(model, rawResponse.usage.prompt_tokens, rawResponse.usage.completion_tokens)

      setRawResult({
        label: "Raw (no optimization)",
        messagesCount: rawMessages.length,
        openaiPromptTokens: rawResponse.usage.prompt_tokens,
        openaiCompletionTokens: rawResponse.usage.completion_tokens,
        openaiTotalTokens: rawResponse.usage.total_tokens,
        realCost: rawCost,
        latencyMs: rawResponse.latencyMs,
        response: rawResponse.content,
        clientTokenEstimate: rawClientTokens.total,
        model: rawResponse.model,
      })

      // B) TRIMMED: Use fitToBudget to limit to ~600 input tokens
      const trimResult = fitToBudget(conversation, {
        maxContextTokens: 900,
        reservedForOutput: 300,
      })

      const trimmedMessages = trimResult.messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }))

      const trimmedClientTokens = countChatTokens(trimmedMessages as ChatMessage[])

      const trimmedResponse = await callOpenAI(trimmedMessages, model, { max_tokens: 300 })
      const trimmedCost = calculateRealCost(model, trimmedResponse.usage.prompt_tokens, trimmedResponse.usage.completion_tokens)

      setTrimmedResult({
        label: `TokenShield (budget: 600 input tokens)`,
        messagesCount: trimmedMessages.length,
        openaiPromptTokens: trimmedResponse.usage.prompt_tokens,
        openaiCompletionTokens: trimmedResponse.usage.completion_tokens,
        openaiTotalTokens: trimmedResponse.usage.total_tokens,
        realCost: trimmedCost,
        latencyMs: trimmedResponse.latencyMs,
        response: trimmedResponse.content,
        clientTokenEstimate: trimmedClientTokens.total,
        model: trimmedResponse.model,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  const savings = rawResult && trimmedResult
    ? {
        tokensSaved: rawResult.openaiPromptTokens - trimmedResult.openaiPromptTokens,
        costSaved: rawResult.realCost.totalCost - trimmedResult.realCost.totalCost,
        percentSaved: ((rawResult.realCost.totalCost - trimmedResult.realCost.totalCost) / rawResult.realCost.totalCost * 100),
        tokenAccuracy: rawResult.clientTokenEstimate > 0
          ? ((1 - Math.abs(rawResult.clientTokenEstimate - rawResult.openaiPromptTokens) / rawResult.openaiPromptTokens) * 100)
          : 0,
      }
    : null

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Context Manager Test</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sends a 20-message dev conversation to GPT-4o-mini twice: once raw, once trimmed by TokenShield to a 600-token input budget. Compares OpenAI{"'"}s real usage.prompt_tokens.
        </p>
      </div>

      <Button
        onClick={runTest}
        disabled={running}
        className="min-h-[44px] w-full sm:w-auto"
      >
        {running ? "Running real API calls..." : "Run Test (2 API calls)"}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {(rawResult || trimmedResult) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[rawResult, trimmedResult].map(
            (result) =>
              result && (
                <div
                  key={result.label}
                  className="rounded-lg border border-border bg-card p-4 space-y-3"
                >
                  <div className="font-mono text-xs font-bold text-primary">
                    {result.label}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <Row label="Messages sent" value={result.messagesCount.toString()} />
                    <Row
                      label="Client estimate (gpt-tokenizer)"
                      value={`${result.clientTokenEstimate.toLocaleString()} tokens`}
                    />
                    <div className="my-2 border-t border-border" />
                    <Row
                      label="OpenAI prompt_tokens"
                      value={`${result.openaiPromptTokens.toLocaleString()} tokens`}
                      highlight
                    />
                    <Row
                      label="OpenAI completion_tokens"
                      value={`${result.openaiCompletionTokens.toLocaleString()} tokens`}
                    />
                    <Row
                      label="Real cost"
                      value={`$${result.realCost.totalCost.toFixed(6)}`}
                      highlight
                    />
                    <Row label="Latency" value={`${result.latencyMs}ms`} />
                    <Row label="Model" value={result.model} />
                  </div>
                  <div className="mt-2 rounded border border-border bg-secondary/50 p-2">
                    <div className="text-xs font-medium text-muted-foreground">Response:</div>
                    <div className="mt-1 text-xs text-foreground leading-relaxed line-clamp-4">
                      {result.response}
                    </div>
                  </div>
                </div>
              )
          )}
        </div>
      )}

      {savings && (
        <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4 space-y-2">
          <div className="font-mono text-sm font-bold text-primary">Proven Savings</div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">Tokens saved</div>
              <div className="font-mono font-bold text-foreground">
                {savings.tokensSaved.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Cost saved</div>
              <div className="font-mono font-bold text-foreground">
                ${savings.costSaved.toFixed(6)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">% saved</div>
              <div className="font-mono font-bold text-foreground">
                {savings.percentSaved.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Token count accuracy</div>
              <div className="font-mono font-bold text-foreground">
                {savings.tokenAccuracy.toFixed(1)}%
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            All numbers from OpenAI{"'"}s usage object. Cost calculated from openai.com/api/pricing. gpt-4o-mini: $0.15/M input, $0.60/M output.
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${highlight ? "font-bold text-primary" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  )
}
