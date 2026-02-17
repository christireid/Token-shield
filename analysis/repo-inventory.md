# Repo Inventory (Pre-Reboot)

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Source files (TS/TSX) | 95+ | 8 |
| Public exports | 445+ | 9 (7 values + 2 types) |
| Test files | 70+ | 6 |
| Runtime dependencies | 6 | 1 |
| Dev dependencies | 60+ | 4 |
| npm install packages | 525 | 94 |
| Build entry points | 7 | 2 |
| Package exports map | 7 entries | 2 entries |
| Bundle (ESM, gzipped) | Unknown (build failed) | ~6.8KB |

## Pre-reboot structure

```
lib/tokenshield/ (95 files)
  - 18 core modules (token-counter, cost-estimator, context-manager, etc.)
  - Plugin system (middleware-plugin.ts)
  - Multi-engine orchestration (pipeline.ts, provider-adapter.ts)
  - Holographic encoding engine (neuro-elastic.ts)
  - Enterprise licensing (license.ts, audit-log.ts)
  - React integration (18 hooks, dashboard, provider)
  - Worker communication (shield-worker.ts)
  - Encrypted storage (crypto-store.ts)

app/ — Next.js application (API routes, dashboard)
components/ — 50+ React UI components (shadcn/ui)
hooks/ — Custom React hooks
marketing/ — Marketing assets
scripts/ — Build scripts
styles/ — Global styles
```

## Pre-reboot export categories (42 categories, 445+ exports)

1. Token Counting (11 exports)
2. Cost Estimation (9 exports)
3. Context Management (8 exports)
4. Response Cache (7 exports)
5. Model Router (6 exports)
6. Request Guard (3 exports)
7. Prefix Optimizer (7 exports)
8. Cost Ledger (4 exports)
9. Tool/Image Token Counter (11 exports)
10. Stream Tracker (3 exports)
11. Circuit Breaker (6 exports)
12. User Budget Manager (7 exports)
13. Anomaly Detector (3 exports)
14. Middleware (4 exports)
15. Plugin Registry (6 exports)
16. Quick-Start Factory (1 export)
17. React Integration (22 exports)
18. Dashboard (3 exports)
19. License Activation (2 exports)
20. Pricing Registry (7 exports)
21. Event Bus (6 exports)
22. Error Hierarchy (8 exports)
23. Config Schemas (10 exports)
24. Encrypted Storage (3 exports)
25. Storage Adapter (1 export)
26. Composable Pipeline (11 exports)
27. Logger/Observability (8 exports)
28. Multi-Provider Adapter (8 exports)
29. Framework Adapters (7 exports)
30. NeuroElastic Engine (5 exports)
31. Worker Communication (4 exports)
32. LLM API Client (8 exports)
33. Savings Calculator (5 exports)
34. Benchmarks (5 exports)
35. Prompt Compressor (4 exports)
36. Adaptive Output Optimizer (4 exports)
37. Delta Encoder (4 exports)
38. Semantic MinHash (4 exports)
39. Template Pool (4 exports)
40. Token Optimizer (4 exports)
41. License Gating (13 exports)
42. Audit Logging (5 exports)

## Pre-reboot issues

- Build fails (`tsx` prebuild script)
- 445+ exports — impossible to comprehend
- Sci-fi naming ("neuro-elastic", "holographic encoding")
- License tiering with HMAC-SHA256 in a free library
- Plugin architecture nobody asked for
- Multi-engine orchestration for one use case
- React dashboard embedded in an npm library
- 60+ dev dependencies including full Next.js stack
