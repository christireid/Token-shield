# token-shield — Node.js Basic Example

Demonstrates the core `createShield` workflow with caching, compression, and cost tracking.

## Run

```bash
npm install
npm start
```

## What it does

1. Creates a shield instance with caching + compression enabled
2. Processes several prompts (including a duplicate)
3. Shows cache hits, compression savings, and cost tracking
4. Prints cumulative stats

## Expected output

```
[CACHE MISS] "What is TypeScript and why should I ..."
[CACHE MISS] "Please kindly explain the benefits of..."
  Compression saved N tokens
[CACHE HIT] "What is TypeScript and why should I ..." → exact match

--- Shield Stats ---
Requests: 3
Cache hits: 1
Cache hit rate: 33.3%
...
```
