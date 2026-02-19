"use client"

import React, { useState, useRef, useCallback } from "react"
import { ResponseCache, textSimilarity } from "@tokenshield/ai-sdk/advanced"

const SIMULATED_API_COST = 0.01
const SIMULATED_API_LATENCY_MS = 450

export default function TokenShieldDemo() {
  const [logs, setLogs] = useState<string[]>([])
  const [cost, setCost] = useState(0)
  const [saved, setSaved] = useState(0)
  const [input, setInput] = useState("What is the capital of France?")
  const [loading, setLoading] = useState(false)
  const cacheRef = useRef(new ResponseCache({ maxEntries: 100, similarityThreshold: 0.85 }))

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [msg, ...prev].slice(0, 15))
  }, [])

  const simulateRequest = async () => {
    setLoading(true)
    const prompt = input.trim()
    addLog(`> "${prompt}"`)

    const cache = cacheRef.current
    const start = performance.now()
    const result = await cache.lookup(prompt, "gpt-4o-mini")

    if (result.hit) {
      const elapsed = (performance.now() - start).toFixed(1)
      addLog(
        `  CACHE HIT (${result.matchType}, similarity: ${result.similarity.toFixed(2)}) in ${elapsed}ms. Cost: $0.00`,
      )
      setSaved((s) => s + SIMULATED_API_COST)
    } else {
      // Simulate API latency, then store in cache
      await new Promise((r) => setTimeout(r, SIMULATED_API_LATENCY_MS))
      const simulatedResponse = `[Simulated response for: "${prompt}"]`
      await cache.store(prompt, simulatedResponse, "gpt-4o-mini", 50, 30)
      const elapsed = (performance.now() - start).toFixed(0)
      addLog(`  API CALL in ${elapsed}ms. Cost: $${SIMULATED_API_COST.toFixed(2)}`)
      setCost((c) => c + SIMULATED_API_COST)
    }

    setLoading(false)
  }

  const handleSimilarityCheck = () => {
    const examples = [
      ["What is the capital of France?", "What's the capital of France?"],
      ["Explain React hooks", "Explain quantum computing"],
      ["How do I sort an array?", "How to sort an array in JavaScript?"],
    ]
    for (const [a, b] of examples) {
      const score = textSimilarity(a, b)
      addLog(`  "${a}" vs "${b}" = ${score.toFixed(3)}`)
    }
    addLog("> Similarity examples (threshold: 0.85):")
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans text-gray-900">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="text-center">
          <h1 className="text-3xl font-bold text-blue-600">Token Shield Interactive Demo</h1>
          <p className="text-gray-600 mt-2">
            Real fuzzy caching via{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">ResponseCache</code>. Try
            rephrasing a prompt to see fuzzy matching in action.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Controls */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">Simulator</h2>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full p-3 border rounded-lg mb-4 h-24"
              placeholder="Type a prompt..."
            />
            <div className="flex gap-2">
              <button
                onClick={simulateRequest}
                disabled={loading}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {loading ? "Processing..." : "Send Request"}
              </button>
              <button
                onClick={handleSimilarityCheck}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
                title="Show similarity examples"
              >
                Compare
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">
              First request caches. Rephrase the same question to see a fuzzy cache hit.
            </p>
          </div>

          {/* Stats */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">Real-Time Savings</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-sm text-red-600">Total Cost</div>
                <div className="text-2xl font-bold text-red-700">${cost.toFixed(2)}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-green-600">Total Saved</div>
                <div className="text-2xl font-bold text-green-700">${saved.toFixed(2)}</div>
              </div>
            </div>

            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-sm h-48 overflow-y-auto">
              {logs.length === 0 ? (
                <span className="opacity-50">System ready... try sending a request.</span>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className="mb-1">
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-white rounded-lg border text-center">
            <h3 className="font-bold">Zero Latency</h3>
            <p className="text-sm text-gray-600">Cache lookup in &lt; 2ms</p>
          </div>
          <div className="p-4 bg-white rounded-lg border text-center">
            <h3 className="font-bold">Fuzzy Matching</h3>
            <p className="text-sm text-gray-600">Rephrased prompts hit cache</p>
          </div>
          <div className="p-4 bg-white rounded-lg border text-center">
            <h3 className="font-bold">Client-Side</h3>
            <p className="text-sm text-gray-600">No data leaves your browser</p>
          </div>
        </div>
      </div>
    </div>
  )
}
