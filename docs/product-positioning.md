# token-shield — Product Positioning

## What it is

token-shield is a TypeScript middleware library that reduces AI API costs through semantic caching, prompt compression, and cost tracking. It works as a drop-in addition to existing code — no prompt rewrites required.

## What it is not

- Not a platform
- Not a proxy service
- Not an observability tool
- Not a prompt engineering framework
- Not a model router or orchestrator

## Target users (v1)

1. **TypeScript / Next.js developers** building AI features
2. **Vercel AI SDK users** who want cost reduction without architectural changes
3. **Teams running chat apps or RAG assistants** with repetitive queries
4. **Individual developers** who want to understand and reduce their LLM spend

## Narrow on purpose

v1 intentionally does four things:

1. Semantic caching (exact + fuzzy match)
2. Prompt compression (client-side, zero API calls)
3. Cost tracking (per-model, per-request)
4. Vercel AI SDK middleware integration

We don't generalize to LangChain, LlamaIndex, polyglot support, or "platform" positioning in v1.

## How it compares

| Feature | token-shield | Helicone | Portkey | LiteLLM |
|---------|-------------|----------|---------|---------|
| Client-side compression | Yes | No | No | No |
| Semantic caching | Yes (in-memory) | Yes (server) | Yes (server) | Yes (server) |
| Cost tracking | Yes (local) | Yes (hosted) | Yes (hosted) | Yes (local) |
| Vercel AI SDK middleware | Yes | No | Partial | No |
| Self-hosted / no network | Yes | No | No | Yes |
| Price | Free (MIT) | Freemium | Freemium | Free |

**Key differentiator:** token-shield runs entirely in your process. No proxy, no hosted service, no data leaving your infrastructure.

## Wedge strategy

token-shield is a wedge product. It provides immediate, measurable value (cost reduction) with zero infrastructure overhead. This positions it to expand into adjacent areas over time:

- v1: Cache + compress + track (free, MIT)
- Future: Optional dashboard/analytics, team features, shared cache, alerting

## Anti-platform stance

We are not building a platform. We are building a library that does a few things well. The bar for adding a new feature is: "does this reduce tokens or improve DX?" If not, it doesn't ship.
