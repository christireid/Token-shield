/**
 * API route that proxies requests to Anthropic and returns the REAL usage object.
 *
 * Anthropic's Messages API returns:
 * - usage.input_tokens: exact input tokens billed
 * - usage.output_tokens: exact output tokens billed
 * - The model actually used
 * - The response content
 */

import { NextResponse } from "next/server"

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string
}

interface RequestBody {
  messages: AnthropicMessage[]
  model: string
  system?: string
  max_tokens?: number
  temperature?: number
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { messages, model, system, max_tokens, temperature } = body

  if (!messages || !model) {
    return NextResponse.json({ error: "messages and model are required" }, { status: 400 })
  }

  // Anthropic requires system message to be separate from messages array
  // and messages must alternate user/assistant starting with user
  const filteredMessages = messages.filter((m) => m.role === "user" || m.role === "assistant")

  const startTime = Date.now()

  try {
    const requestBody: Record<string, unknown> = {
      model,
      messages: filteredMessages,
      max_tokens: max_tokens ?? 300,
    }

    if (system) {
      requestBody.system = system
    }

    if (temperature !== undefined) {
      requestBody.temperature = temperature
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.text()
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status}`, details: errorData },
        { status: response.status },
      )
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    // Extract text content from Anthropic's content array format
    const content =
      data.content
        ?.filter((block: { type: string }) => block.type === "text")
        .map((block: { text: string }) => block.text)
        .join("") ?? ""

    return NextResponse.json({
      content,
      model: data.model,
      usage: {
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      latencyMs,
      id: data.id,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 },
    )
  }
}
