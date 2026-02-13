/**
 * API route that proxies requests to OpenAI and returns the REAL usage object.
 * 
 * This is the ground truth. Every token count, every cost calculation
 * we do client-side gets validated against what OpenAI actually reports back.
 * 
 * The response includes:
 * - usage.prompt_tokens: exact input tokens billed
 * - usage.completion_tokens: exact output tokens billed  
 * - usage.total_tokens: sum
 * - The model actually used
 * - The response content
 */

import { NextResponse } from "next/server"

interface OpenAIMessage {
  role: "system" | "user" | "assistant"
  content: string
}

interface RequestBody {
  messages: OpenAIMessage[]
  model: string
  max_tokens?: number
  temperature?: number
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 500 }
    )
  }

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    )
  }

  const { messages, model, max_tokens, temperature } = body

  if (!messages || !model) {
    return NextResponse.json(
      { error: "messages and model are required" },
      { status: 400 }
    )
  }

  const startTime = Date.now()

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: max_tokens ?? 300,
        temperature: temperature ?? 0.7,
      }),
    })

    if (!response.ok) {
      const errorData = await response.text()
      return NextResponse.json(
        { error: `OpenAI API error: ${response.status}`, details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    // Return the REAL usage data from OpenAI
    return NextResponse.json({
      // The actual response text
      content: data.choices?.[0]?.message?.content ?? "",
      // The model OpenAI actually used (may differ from requested)
      model: data.model,
      // THE GROUND TRUTH - OpenAI's own token counts
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
      // Timing
      latencyMs,
      // Raw ID for debugging
      id: data.id,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    )
  }
}
