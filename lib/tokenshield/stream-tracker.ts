/**
 * TokenShield - Streaming Token Tracker
 *
 * Solves the #1 production pain point: when a user aborts a streaming
 * response (clicks "Stop generating" or loses connection), token usage
 * data is lost. The AI SDK's onFinish callback never fires on abort.
 * (vercel/ai#7628 - 6+ thumbs-up, still open)
 *
 * This tracker counts tokens IN REAL TIME as stream chunks arrive,
 * using the exact same BPE tokenizer (gpt-tokenizer) that OpenAI uses.
 * Even when the stream is aborted, you have accurate token counts for
 * billing, analytics, and cost tracking.
 *
 * Usage with AI SDK streamText:
 *   const tracker = new StreamTokenTracker({ modelId: 'gpt-4o-mini' })
 *   const result = await streamText({
 *     model: openai('gpt-4o-mini'),
 *     messages,
 *     onChunk: ({ chunk }) => {
 *       if (chunk.type === 'text-delta') tracker.addChunk(chunk.textDelta)
 *     },
 *     onFinish: ({ usage }) => tracker.finish(usage),
 *   })
 *   // Even if aborted, tracker.getUsage() returns accurate counts
 */

import { countTokens } from "gpt-tokenizer"
import { estimateCost, MODEL_PRICING } from "./cost-estimator"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface StreamUsage {
  /** Input tokens (set once from the known prompt before streaming) */
  inputTokens: number
  /** Output tokens counted so far from stream chunks */
  outputTokens: number
  /** Total tokens */
  totalTokens: number
  /** Whether the stream completed normally */
  completed: boolean
  /** Whether the stream was aborted */
  aborted: boolean
  /** Duration in ms from start to last chunk (or abort) */
  durationMs: number
  /** Tokens per second throughput */
  tokensPerSecond: number
  /** Estimated cost so far */
  estimatedCost: number
  /** Number of chunks received */
  chunksReceived: number
}

export interface StreamTrackerConfig {
  /** Model ID for cost calculation */
  modelId: string
  /** Known input tokens (from prompt, set before streaming starts) */
  inputTokens?: number
  /** Called when usage is updated (every N chunks) */
  onUsageUpdate?: (usage: StreamUsage) => void
  /** Called when the stream is aborted */
  onAbort?: (usage: StreamUsage) => void
  /** Called when the stream completes normally */
  onComplete?: (usage: StreamUsage) => void
  /** How often to fire onUsageUpdate (every N chunks, default 5) */
  updateInterval?: number
  /** Cost threshold that triggers a warning callback */
  costThreshold?: number
  /** Called when cost threshold is exceeded */
  onCostThreshold?: (usage: StreamUsage) => void
}

// -------------------------------------------------------
// Implementation
// -------------------------------------------------------

export class StreamTokenTracker {
  private config: StreamTrackerConfig
  private outputBuffer = ""
  private outputTokenCount = 0
  private startTime = 0
  private lastChunkTime = 0
  private chunkCount = 0
  private isCompleted = false
  private isAborted = false
  private thresholdFired = false

  constructor(config: StreamTrackerConfig) {
    this.config = {
      updateInterval: 5,
      ...config,
    }
    this.startTime = Date.now()
    this.lastChunkTime = this.startTime
  }

  /**
   * Set the input token count. Call this before streaming starts,
   * using countChatTokens() from the token counter module.
   */
  setInputTokens(tokens: number): void {
    this.config.inputTokens = tokens
  }

  /**
   * Feed a text chunk from the stream. Call this from onChunk.
   * Accumulates text and counts tokens using BPE encoding.
   */
  addChunk(text: string): void {
    if (this.isCompleted || this.isAborted) return

    this.outputBuffer += text
    this.chunkCount++
    this.lastChunkTime = Date.now()

    // Count tokens every N chunks for efficiency
    // (BPE encoding is O(n) so we don't want to do it per-chunk)
    if (this.chunkCount % (this.config.updateInterval ?? 5) === 0) {
      this.recountOutput()
      this.config.onUsageUpdate?.(this.getUsage())

      // Check cost threshold
      if (
        this.config.costThreshold &&
        !this.thresholdFired &&
        this.getUsage().estimatedCost >= this.config.costThreshold
      ) {
        this.thresholdFired = true
        this.config.onCostThreshold?.(this.getUsage())
      }
    }
  }

  /**
   * Mark the stream as completed normally.
   * If the provider returns accurate usage, pass it to override our count.
   */
  finish(providerUsage?: { promptTokens?: number; completionTokens?: number }): StreamUsage {
    this.isCompleted = true
    this.recountOutput()

    // If provider gave us exact numbers, use those
    if (providerUsage?.completionTokens) {
      this.outputTokenCount = providerUsage.completionTokens
    }
    if (providerUsage?.promptTokens) {
      this.config.inputTokens = providerUsage.promptTokens
    }

    const usage = this.getUsage()
    this.config.onComplete?.(usage)
    return usage
  }

  /**
   * Mark the stream as aborted. This is the key feature --
   * even on abort, we have accurate token counts from real-time tracking.
   */
  abort(): StreamUsage {
    if (this.isCompleted) return this.getUsage()
    this.isAborted = true
    this.recountOutput()
    const usage = this.getUsage()
    this.config.onAbort?.(usage)
    return usage
  }

  /**
   * Get current usage snapshot. Can be called at any time.
   */
  getUsage(): StreamUsage {
    // Do a final recount if we haven't recently — but skip if stream is
    // already finished/aborted, since finish() may have set provider-accurate
    // counts that we don't want to overwrite with a buffer recount.
    if (
      !this.isCompleted &&
      !this.isAborted &&
      this.chunkCount % (this.config.updateInterval ?? 5) !== 0
    ) {
      this.recountOutput()
    }

    const inputTokens = this.config.inputTokens ?? 0
    const totalTokens = inputTokens + this.outputTokenCount
    const durationMs = Math.max(1, this.lastChunkTime - this.startTime)
    const tokensPerSecond = durationMs > 0 ? (this.outputTokenCount / durationMs) * 1000 : 0

    let estimatedCost = 0
    const pricing = MODEL_PRICING[this.config.modelId]
    if (pricing) {
      estimatedCost = estimateCost(
        this.config.modelId,
        inputTokens,
        this.outputTokenCount,
      ).totalCost
    }

    return {
      inputTokens,
      outputTokens: this.outputTokenCount,
      totalTokens,
      completed: this.isCompleted,
      aborted: this.isAborted,
      durationMs,
      tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
      estimatedCost,
      chunksReceived: this.chunkCount,
    }
  }

  /**
   * Get the accumulated output text so far.
   */
  getText(): string {
    return this.outputBuffer
  }

  /**
   * Reset the tracker for reuse.
   */
  reset(): void {
    this.outputBuffer = ""
    this.outputTokenCount = 0
    this.startTime = Date.now()
    this.lastChunkTime = this.startTime
    this.chunkCount = 0
    this.isCompleted = false
    this.isAborted = false
    this.thresholdFired = false
  }

  private recountOutput(): void {
    if (this.outputBuffer.length > 0) {
      this.outputTokenCount = countTokens(this.outputBuffer)
    }
  }
}
