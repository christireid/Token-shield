/**
 * Re-export alias for conversation-delta-encoder.
 * Provides the shorter `delta-encoder` name for consistency with
 * other module names (prompt-compressor, model-router, etc.).
 */
export {
  encodeDelta,
  analyzeRedundancy,
  type DeltaEncoderConfig,
  type DeltaResult,
} from "./conversation-delta-encoder"
