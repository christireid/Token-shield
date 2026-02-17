# token-shield — Vercel Edge Runtime Example

Shows token-shield running on the Edge runtime with no Node-only APIs.

## How it works

```ts
export const runtime = "edge";

import { withShield, estimateCost } from "token-shield";

const shieldMiddleware = withShield({ cache: true, compression: true });
```

## Runtime compatibility

token-shield uses only standard Web APIs:
- `Map` for in-memory caching
- No `fs`, `path`, `Buffer`, or other Node-only modules
- No IndexedDB or browser-only APIs
- Compatible with Vercel Edge, Cloudflare Workers, Deno Deploy

## Deploy

Copy `handler.ts` into your Vercel Edge Function or `middleware.ts`.
