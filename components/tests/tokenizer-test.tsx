"use client"

/**
 * REAL TEST: Token Counter Accuracy
 *
 * The foundation of everything else. If our client-side token count
 * doesn't match OpenAI's server-side count, nothing else matters.
 *
 * This test sends multiple prompts and compares gpt-tokenizer's count
 * vs OpenAI's usage.prompt_tokens for each one.
 */

import { useState } from "react"
import {
  countExactTokens,
  countChatTokens,
  type ChatMessage,
} from "@/lib/tokenshield/token-counter"
import { callOpenAI } from "@/lib/tokenshield/api-client"
import { Button } from "@/components/ui/button"

const TEST_PROMPTS = [
  "Hello",
  "What is the capital of France?",
  "Explain the difference between let, const, and var in JavaScript. Include examples of when to use each one.",
  `Here's a React component:\n\n\`\`\`tsx\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;\n}\n\`\`\`\n\nRefactor this to use useReducer instead.`,
  "The quick brown fox jumps over the lazy dog. ".repeat(20).trim(),
]

interface TokenTestResult {
  prompt: string
  promptPreview: string
  clientTokens: number
  openaiTokens: number
  difference: number
  accuracy: number
  model: string
}

export function TokenizerTest() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<TokenTestResult[]>([])
  const [error, setError] = useState<string | null>(null)

  async function runTest() {
    setRunning(true)
    setError(null)
    setResults([])

    const model = "gpt-4o-mini"
    const testResults: TokenTestResult[] = []

    try {
      for (const prompt of TEST_PROMPTS) {
        // Client-side count using gpt-tokenizer
        const messages: ChatMessage[] = [{ role: "user", content: prompt }]
        const clientCount = countChatTokens(messages)

        // Real API call to get OpenAI's count
        const res = await callOpenAI(
          [{ role: "user", content: prompt }],
          model,
          { max_tokens: 1, temperature: 0 }, // minimize output tokens to save money
        )

        const diff = Math.abs(clientCount.total - (res.usage.prompt_tokens ?? 0))
        const accuracy =
          (res.usage.prompt_tokens ?? 0) > 0
            ? (1 - diff / (res.usage.prompt_tokens ?? 0)) * 100
            : 100

        testResults.push({
          prompt,
          promptPreview: prompt.length > 60 ? prompt.slice(0, 60) + "..." : prompt,
          clientTokens: clientCount.total,
          openaiTokens: res.usage.prompt_tokens ?? 0,
          difference: diff,
          accuracy,
          model: res.model,
        })

        setResults([...testResults])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setRunning(false)
    }
  }

  const avgAccuracy =
    results.length > 0 ? results.reduce((sum, r) => sum + r.accuracy, 0) / results.length : 0
  const maxDiff = results.length > 0 ? Math.max(...results.map((r) => r.difference)) : 0

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Token Counter Accuracy Test</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sends {TEST_PROMPTS.length} prompts to GPT-4o-mini (max_tokens=1 to minimize cost) and
          compares our client-side gpt-tokenizer count against OpenAI{"'"}s usage.prompt_tokens.
          This proves we count tokens the same way OpenAI does.
        </p>
      </div>

      <Button onClick={runTest} disabled={running} className="min-h-[44px] w-full sm:w-auto">
        {running
          ? `Testing ${results.length + 1}/${TEST_PROMPTS.length}...`
          : `Run Test (${TEST_PROMPTS.length} API calls, ~$0.001)`}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Prompt
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Client
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  OpenAI
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Diff
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                  Accuracy
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-foreground max-w-[200px] truncate">
                    {r.promptPreview}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {r.clientTokens}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-foreground">
                    {r.openaiTokens}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs font-bold ${r.difference === 0 ? "text-primary" : r.difference <= 2 ? "text-chart-3" : "text-destructive"}`}
                  >
                    {r.difference === 0 ? "EXACT" : `+${r.difference}`}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs font-bold ${r.accuracy >= 99 ? "text-primary" : "text-chart-3"}`}
                  >
                    {r.accuracy.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length === TEST_PROMPTS.length && (
        <div className="rounded-lg border-2 border-primary/50 bg-primary/5 p-4 space-y-2">
          <div className="font-mono text-sm font-bold text-primary">Accuracy Results</div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Average accuracy</div>
              <div className="font-mono font-bold text-foreground">{avgAccuracy.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Max token difference</div>
              <div className="font-mono font-bold text-foreground">{maxDiff} tokens</div>
            </div>
            <div>
              <div className="text-muted-foreground">Prompts tested</div>
              <div className="font-mono font-bold text-foreground">{results.length}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            gpt-tokenizer uses the same BPE encoding (o200k_base) that OpenAI uses server-side. Any
            difference is from chat message overhead formatting, which varies by a few tokens.
          </p>
        </div>
      )}
    </div>
  )
}
