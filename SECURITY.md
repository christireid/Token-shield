# Security & Trust Model

TokenShield is a client-side React/TypeScript SDK that reduces LLM token costs through caching, budget tracking, model routing, and prompt optimization. This document describes its trust model, what it does and does not protect against, and how to integrate it safely into a production system.

---

## 1. Trust Model

TokenShield runs **entirely in the browser**. It optimizes prompts, caches responses, tracks spending, and enforces budget thresholds -- but all of this happens on the client. None of it constitutes a server-side security boundary.

Client-side budget enforcement is a **UX feature**, not an access control mechanism. A determined user can open DevTools, modify IndexedDB entries, patch runtime objects, or bypass the SDK entirely. TokenShield cannot prevent this, and it does not claim to.

A useful mental model: TokenShield is a **fuel gauge**, not an ignition lock. It tells you how much you have spent, warns when you are running low, and prevents accidental overspend. It does not prevent someone from hotwiring the car.

**Key principle:** Never rely on client-side logic alone to enforce hard spending limits in a multi-tenant or adversarial environment. TokenShield is one layer in a defense-in-depth strategy; your backend is the enforcement layer.

---

## 2. What TokenShield Protects Against

| Threat                                | How TokenShield Helps                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accidental overspend**              | Per-user and global budget tracking with configurable warning and hard-stop thresholds. Prevents runaway loops and unintentional batch requests from silently burning through budget. |
| **Wasteful requests**                 | Semantic and exact-match caching eliminates duplicate and redundant prompts. Prompt optimization reduces unnecessarily long context windows.                                          |
| **Expensive models for simple tasks** | Complexity-based model routing sends simple prompts to cheaper models automatically. Budget-tier routing downgrades models as spend increases.                                        |
| **Unmonitored team spending**         | Per-user budget ledgers and the event bus (`userBudget:warning`, `userBudget:exceeded`, `userBudget:spend`) give visibility into who is spending what.                                |
| **Cold-start latency**                | Cached responses are served instantly from IndexedDB, reducing both latency and cost.                                                                                                 |

---

## 3. What TokenShield Does NOT Protect Against

| Threat                                           | Why Not                                                                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Malicious users bypassing client-side limits** | All SDK state lives in the browser. A user with DevTools access can modify budgets, clear ledgers, or call your API directly.                                                                                          |
| **API key theft**                                | TokenShield never handles API keys. Keys should live on your backend and never be exposed to the client. If your architecture sends keys to the browser, that is a separate vulnerability outside TokenShield's scope. |
| **Server-side cost enforcement**                 | TokenShield has no server component. Hard budget enforcement must happen in your backend before the request reaches the LLM provider.                                                                                  |
| **DDoS or abuse of your LLM endpoints**          | Rate limiting and abuse prevention require server-side infrastructure (API gateways, rate limiters, auth checks). TokenShield operates after the user has already been authenticated and authorized.                   |

---

## 4. Data Storage & Privacy

TokenShield stores all persistent data in **IndexedDB** within the user's browser. Nothing is sent to external servers.

| Data                | Storage Location | Notes                                                            |
| ------------------- | ---------------- | ---------------------------------------------------------------- |
| Cost ledger entries | IndexedDB        | Per-user spend records with timestamps, model, and token counts. |
| Cached responses    | IndexedDB        | Prompt-response pairs used for cache hits.                       |
| User budget state   | IndexedDB        | Current spend, limits, and rolling-window metadata.              |

**Zero telemetry.** TokenShield does not phone home, collect analytics, or transmit any data to Anthropic, OpenAI, or any third party. There are no tracking pixels, no beacon endpoints, and no opt-out-required telemetry. The SDK is fully offline-capable.

**Optional encryption at rest.** The `EncryptedStore` module provides AES-GCM encryption via the Web Crypto API. When enabled, all IndexedDB entries (cached responses, ledger data, budget state) are encrypted with a key you provide. This protects sensitive prompt/response data if the user's device is compromised or if browser storage is inspected. Note that the encryption key must still be managed securely by your application -- TokenShield does not handle key storage or rotation.

---

## 5. Recommended Backend Integration Pattern

The correct architecture places TokenShield on the client as an optimization and visibility layer, with your backend as the enforcement layer.

```
                         Trust Boundary
                              |
  [Browser / Client]          |        [Your Infrastructure]
                              |
  User types prompt           |
        |                     |
  TokenShield estimates       |
  cost, checks client         |
  budget, warns user          |
        |                     |
  If over budget:             |
    block request (UX)        |
  If under budget:            |
        |                     |
        +------ request ----->|---> Your Backend Proxy
                              |          |
                              |    Validate session/auth
                              |    Check server-side budget DB
                              |    If over limit: reject (403)
                              |    If ok: call OpenAI/Anthropic
                              |          |
        <----- response ------|----- Return response
        |                     |
  TokenShield records         |
  actual usage in ledger,     |
  updates dashboard           |
```

### Code Sketch

```typescript
// --- Client (React component using TokenShield) ---

import { useTokenShield, useUserBudget } from "@tokenshield/react"

function ChatInput({ userId }: { userId: string }) {
  const shield = useTokenShield()
  const budget = useUserBudget(userId)

  async function handleSend(prompt: string) {
    // 1. Client-side estimation and budget check (UX layer)
    const estimate = shield.estimateCost(prompt, "gpt-4o")

    if (budget.remaining !== null && estimate.totalCost > budget.remaining) {
      showWarning("This request may exceed your remaining budget.")
      return // Block on the client as a courtesy
    }

    // 2. Send to YOUR backend — never directly to the LLM provider
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, model: estimate.model }),
      credentials: "include", // Send session cookie
    })

    if (response.status === 403) {
      showError("Server rejected: budget exceeded.")
      return
    }

    const data = await response.json()

    // 4. Record actual usage for dashboard/reporting
    shield.recordUsage({
      userId,
      model: data.model,
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      cost: data.usage.total_cost,
    })
  }
}
```

```typescript
// --- Server (e.g., Next.js API route or Express handler) ---

import { OpenAI } from "openai"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) // Key lives here, never on the client

export async function POST(req: Request) {
  const session = await getSession(req) // Your auth
  if (!session) return new Response("Unauthorized", { status: 401 })

  const { prompt, model } = await req.json()

  // 3. Server-side budget enforcement (the real security boundary)
  const budget = await db.getUserBudget(session.userId)
  if (budget.spent >= budget.limit) {
    return new Response("Budget exceeded", { status: 403 })
  }

  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  })

  const usage = completion.usage
  const cost = calculateCost(model, usage.prompt_tokens, usage.completion_tokens)

  // Update server-side ledger (source of truth)
  await db.recordSpend(session.userId, cost)

  return Response.json({
    message: completion.choices[0].message.content,
    model,
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_cost: cost,
    },
  })
}
```

The critical point: the server checks `budget.spent >= budget.limit` **before** making the OpenAI call. This is the enforcement that cannot be bypassed from the client. TokenShield's client-side check is a fast, responsive UX optimization that prevents most overspend without a round trip, but the server is the authority.

---

## 6. Reporting Vulnerabilities

If you discover a security vulnerability in TokenShield, please report it responsibly:

1. **Do not open a public GitHub issue** for security-sensitive reports.
2. Instead, email the maintainers directly or use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on the TokenShield repository.
3. Include a clear description of the vulnerability, steps to reproduce, and the potential impact.
4. We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

For bugs that are **not** security-sensitive (e.g., incorrect cost calculations, caching inconsistencies), please open a standard [GitHub issue](../../issues).

---

## Summary

| Layer                                      | Role                                                                       | Trust Level                                           |
| ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| **TokenShield (client)**                   | Cost estimation, caching, budget warnings, model routing, usage dashboards | Advisory / UX. Assume it can be bypassed.             |
| **Your backend proxy**                     | Auth, server-side budget enforcement, API key management, rate limiting    | Enforcement. This is the security boundary.           |
| **LLM provider (OpenAI, Anthropic, etc.)** | Model inference, billing                                                   | External dependency. Protected by your backend proxy. |

TokenShield reduces costs and gives your users visibility into their spending. Your backend enforces the rules. Design accordingly.
