/**
 * API route that proxies requests to Google Gemini and returns the REAL usage object.
 *
 * Google's Gemini API returns:
 * - usageMetadata.promptTokenCount: exact input tokens billed
 * - usageMetadata.candidatesTokenCount: exact output tokens billed
 * - The model info
 * - The response content
 */

import { NextResponse } from "next/server"

interface GoogleMessage {
  role: "user" | "model"
  parts: { text: string }[]
}

interface RequestBody {
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  model: string
  max_tokens?: number
  temperature?: number
}

export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_GENERATIVE_AI_API_KEY not configured" },
      { status: 500 },
    )
  }

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { messages, model, max_tokens, temperature } = body

  if (!messages || !model) {
    return NextResponse.json({ error: "messages and model are required" }, { status: 400 })
  }

  // Convert OpenAI-style messages to Gemini format
  // System messages become systemInstruction, user/assistant map to user/model
  const systemMessages = messages.filter((m) => m.role === "system")
  const chatMessages = messages.filter((m) => m.role !== "system")

  const geminiContents: GoogleMessage[] = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }))

  const startTime = Date.now()

  try {
    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
      generationConfig: {
        maxOutputTokens: max_tokens ?? 300,
        temperature: temperature ?? 0.7,
      },
    }

    if (systemMessages.length > 0) {
      requestBody.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join("\n") }],
      }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
    )

    if (!response.ok) {
      const errorData = await response.text()
      return NextResponse.json(
        { error: `Google API error: ${response.status}`, details: errorData },
        { status: response.status },
      )
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    // Extract text content from Gemini's response format
    const content =
      data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
      ""

    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0

    return NextResponse.json({
      content,
      model,
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      latencyMs,
      id: `google-${Date.now()}`,
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
