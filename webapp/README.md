# TokenShield SDK

## Overview

TokenShield is a comprehensive client-side React/TypeScript SDK that reduces LLM API costs by 40-80% through intelligent middleware integration with the Vercel AI SDK.

## Features

- **Token Counter**: Accurate token counting with fast heuristic support
- **Cost Estimator**: Real-time cost estimation and budgeting
- **Context Manager**: Smart context trimming and optimization
- **Response Cache**: Intelligent caching with deduplication
- **Model Router**: Cross-provider routing for cost optimization
- **Request Guard**: Request validation and rate limiting
- **Prefix Optimizer**: Smart prefix optimization
- **Cost Ledger**: Comprehensive cost tracking and reporting
- **Tool Token Counter**: Tool usage tracking
- **Stream Tracker**: Real-time stream monitoring
- **Circuit Breaker**: Fault tolerance and protection

## Installation

```bash
npm install @tokenshield/core @tokenshield/react @tokenshield/ai-sdk
```

## Quick Start

```typescript
import { wrapLanguageModel } from 'ai';
import { tokenShieldMiddleware } from '@tokenshield/ai-sdk';

const model = wrapLanguageModel({
  model: openai('gpt-4'),
  middleware: tokenShieldMiddleware({
    apiKey: 'your-api-key',
  }),
});
```

## Enterprise Features

- Multi-agent cost control
- Hierarchical budget management
- Real-time analytics
- Predictive cost forecasting
- Advanced circuit breakers

## Testing

All tests pass with 779 individual tests across 41 test files.

## Build

Optimized build with tree-shaking enabled. Bundle size approximately 177KB.

## Documentation

See SPEC.md and QUICKSTART.md for detailed documentation.
