# token-shield — Next.js Example

Shows how to use `withShield` as Vercel AI SDK middleware in a Next.js route handler.

## Setup

1. Copy `page.tsx` to `app/api/chat/route.ts` in your Next.js app
2. Install dependencies: `npm install token-shield ai @ai-sdk/openai`
3. Set `OPENAI_API_KEY` in your environment
4. Start your Next.js app: `npm run dev`

## How it works

```ts
import { withShield } from "token-shield";
import { wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";

const model = wrapLanguageModel({
  model: openai("gpt-4o"),
  middleware: withShield({ cache: true, compression: true }),
});
```

Token Shield automatically:
- Caches repeated/similar prompts (exact + fuzzy matching)
- Compresses verbose user messages (stopwords, patterns, dedup)
- Tracks costs per request
