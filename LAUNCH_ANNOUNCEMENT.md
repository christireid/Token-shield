# Show HN: TokenShield – Open-source LLM cost optimization (Edgee alternative, no lock-in)

**URL:** https://github.com/tokenshield/ai-sdk

**Pitch:** Add caching, rate-limiting, and cost tracking to your existing OpenAI/Anthropic SDK in 3 lines of code. No API endpoint changes. No vendor lock-in.

---

Hey HN,

We built **TokenShield** because we were tired of "AI Gateways" (like Edgee, Helicone, Portkey) requiring us to route all our traffic through their servers. It introduces latency, a single point of failure, and vendor lock-in.

TokenShield is different. It's a **Typescript Middleware** SDK that runs _inside_ your application.

### Why this approach?

1.  **Zero Latency:** Caching and logic happen in-memory (< 5ms overhead) vs. 50-200ms network hop for gateways.
2.  **No Lock-In:** It wraps your existing SDK. If you don't like it, delete 3 lines of code and you're back to raw direct-to-provider calls.
3.  **Privacy:** Your data never leaves your infrastructure (AWS/Vercel/etc).

### Features (v0.2)

- **🛡️ Request Guard:** Rate limiting, deduplication, and "max cost per hour" circuit breakers.
- **💾 Neuro-Elastic Cache:** Semantic caching (exact + fuzzy) stored in Redis/IndexedDB.
- **💰 Cost Ledger:** Real-time accounting of every token spent vs. saved.
- **📉 Model Router:** Automatically downgrades simple prompts ("What is 2+2?") to cheaper models (e.g., GPT-4o-mini) based on complexity scoring.
- **👤 Per-User Budgets:** Enforce limits on _your_ customers (e.g., "Tenant A gets $5/mo").

### Quick Start

```bash
npm install @tokenshield/ai-sdk
```

```typescript
// Wrap your existing client
const client = createOpenAIAdapter(tokenShieldMiddleware({ modules: { cache: true } }), (p) =>
  new OpenAI().chat.completions.create(p),
)
```

We are MIT licensed. We make money by offering a managed dashboard for teams (optional) and enterprise SLA. The core library is free forever.

Would love your feedback on the "middleware vs. gateway" architectural choice!
