/**
 * token-shield
 *
 * Drop-in TypeScript middleware that reduces AI API costs
 * without requiring prompt rewrites.
 *
 * Public API: 9 exports (7 values + 2 types).
 */

// Core
export { shield, createShield } from "./core/shield"

// Cache
export { semanticCache } from "./cache/semantic-cache"

// Compression
export { promptCompression } from "./compression/compressor"

// Cost
export { costTracker, estimateCost } from "./cost/tracker"

// Middleware
export { withShield } from "./middleware/vercel"

// Types (primary)
export type { ShieldOptions, ShieldStats } from "./types"

// Types (return types — useful for explicit type annotations)
export type {
  Message,
  ProcessResult,
  CostEstimate,
  CompressionResult,
  CostTrackerStats,
  CacheOptions,
  CompressionOptions,
} from "./types"
