/**
 * TokenShield Middleware - Wrap Generate & Stream
 *
 * Builds the wrapGenerate and wrapStream functions that run AROUND
 * the actual model call. Handles cache returns, ledger recording,
 * budget tracking, and stream monitoring.
 */

import { MODEL_PRICING } from "./cost-estimator"
import { StreamTokenTracker } from "./stream-tracker"
import {
  extractLastUserText,
  safeCost,
  getShieldMeta,
  type MiddlewareContext,
  type ShieldMeta,
} from "./middleware-types"

/**
 * Shared post-request recording logic used by both wrapGenerate and wrapStream.
 * Computes savings, records in ledger, emits events, completes guard tracking,
 * records in breaker/budget, and checks for anomalies.
 */
async function recordPostRequestUsage(
  ctx: MiddlewareContext,
  opts: {
    modelId: string
    inputTokens: number
    outputTokens: number
    latencyMs: number
    meta: ShieldMeta | undefined
    params: Record<string, unknown>
  },
): Promise<void> {
  const { config, guard, ledger, breaker, userBudgetManager, anomalyDetector, instanceEvents } = ctx
  const { modelId, inputTokens, outputTokens, latencyMs, meta, params } = opts

  // Compute per-request savings
  const contextSavedDollars = meta?.contextSaved
    ? (meta.contextSaved / 1_000_000) * (MODEL_PRICING[modelId]?.inputPerMillion ?? 2.5)
    : 0
  const routerSavedDollars = meta?.routerSaved ?? 0
  const prefixSavedDollars = meta?.prefixSaved ?? 0

  // Record in ledger
  if (ledger) {
    await ledger.record({
      model: modelId,
      inputTokens,
      outputTokens,
      savings: {
        context: contextSavedDollars,
        router: routerSavedDollars,
        prefix: prefixSavedDollars,
      },
      originalInputTokens: meta?.originalInputTokens,
      originalModel: meta?.originalModel,
      feature: config.ledger?.feature,
      latencyMs,
    })
  }

  const perRequestCost = safeCost(modelId, inputTokens, outputTokens)
  const perRequestSaved = contextSavedDollars + routerSavedDollars + prefixSavedDollars

  try {
    instanceEvents.emit("ledger:entry", {
      model: modelId,
      inputTokens,
      outputTokens,
      cost: perRequestCost,
      saved: perRequestSaved,
    })
  } catch {
    /* non-fatal */
  }

  config.onUsage?.({
    model: modelId,
    inputTokens,
    outputTokens,
    cost: perRequestCost,
    saved: perRequestSaved,
  })

  // Complete the guard request tracking
  if (guard) {
    const guardUserText = meta?.lastUserText ?? extractLastUserText(params)
    if (guardUserText) {
      guard.completeRequest(guardUserText, inputTokens, outputTokens, modelId)
    }
  }

  // Record spending in circuit breaker
  if (breaker && perRequestCost > 0) {
    breaker.recordSpend(perRequestCost, modelId)
  }

  // Record spending in per-user budget manager
  if (userBudgetManager && meta?.userId) {
    await userBudgetManager
      .recordSpend(meta.userId, perRequestCost, modelId, meta.userBudgetInflight)
      .catch(() => {
        /* IDB write failed — inflight already released synchronously */
      })
  }

  // Detect anomalies
  if (anomalyDetector) {
    const anomaly = anomalyDetector.check(perRequestCost, inputTokens + outputTokens)
    if (anomaly) {
      try {
        instanceEvents.emit("anomaly:detected", anomaly)
      } catch {
        /* non-fatal */
      }
      config.anomaly?.onAnomalyDetected?.(anomaly)
    }
  }
}

/**
 * Build the wrapGenerate function for the middleware pipeline.
 * If cache hit, returns cached result. Otherwise calls the model
 * and records usage in the ledger.
 */
export function buildWrapGenerate(ctx: MiddlewareContext) {
  const { config, cache, ledger, userBudgetManager, adapter, log } = ctx

  return async ({
    doGenerate,
    params,
  }: {
    doGenerate: () => Promise<Record<string, unknown>>
    params: Record<string, unknown>
  }) => {
    const meta = getShieldMeta(params)

    // Cache hit: return cached response without calling the model
    if (meta?.cacheHit) {
      const modelId = String(params.modelId ?? "")

      // Release in-flight reservation — no API call will happen
      if (userBudgetManager && meta.userId && meta.userBudgetInflight) {
        userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
      }

      if (ledger) {
        await ledger.recordCacheHit({
          model: modelId,
          savedInputTokens: meta.cacheHit.inputTokens,
          savedOutputTokens: meta.cacheHit.outputTokens,
          feature: config.ledger?.feature,
        })
      }

      const cacheHitSavedDollars = safeCost(
        modelId,
        meta.cacheHit.inputTokens,
        meta.cacheHit.outputTokens,
      )

      config.onUsage?.({
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        saved: cacheHitSavedDollars,
      })

      return {
        text: meta.cacheHit.response,
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop",
      }
    }

    // Call the real model
    const modelId = String(params.modelId ?? "")
    const startTime = Date.now()
    let result: Record<string, unknown>
    try {
      result = await doGenerate()
    } catch (err) {
      // Release in-flight budget reservation on API failure
      if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
        userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
      }
      // Record failure in provider adapter
      if (adapter) {
        const provider = adapter.getProviderForModel(modelId)
        if (provider) {
          try {
            adapter.recordFailure(provider, err instanceof Error ? err.message : String(err))
          } catch {
            /* non-fatal */
          }
        }
      }
      throw err
    }
    const latencyMs = Date.now() - startTime

    // Record success in provider adapter
    if (adapter) {
      const provider = adapter.getProviderForModel(modelId)
      if (provider) {
        try {
          adapter.recordSuccess(provider, latencyMs)
        } catch {
          /* non-fatal */
        }
      }
    }

    // Extract usage from result
    const usage = result.usage as { promptTokens?: number; completionTokens?: number } | undefined
    const inputTokens = usage?.promptTokens ?? 0
    const outputTokens = usage?.completionTokens ?? 0
    const responseText = String(result.text ?? "")

    // Store in cache for future requests (fire-and-forget)
    if (cache && responseText) {
      const cachedUserText = meta?.lastUserText ?? extractLastUserText(params)
      if (cachedUserText) {
        cache
          .store(cachedUserText, responseText, modelId, inputTokens, outputTokens)
          .catch((err) => {
            log?.debug("cache", "Failed to store response", {
              error: err instanceof Error ? err.message : String(err),
            })
          })
      }
    }

    // Record usage, savings, and emit events
    await recordPostRequestUsage(ctx, {
      modelId,
      inputTokens,
      outputTokens,
      latencyMs,
      meta,
      params,
    })

    return result
  }
}

/**
 * Build the wrapStream function for the middleware pipeline.
 * If cache hit, returns a simulated stream. Otherwise calls the model,
 * pipes chunks through a StreamTokenTracker, and records usage when done.
 */
export function buildWrapStream(ctx: MiddlewareContext) {
  const { config, cache, ledger, userBudgetManager, instanceEvents, adapter, log } = ctx

  return async ({
    doStream,
    params,
  }: {
    doStream: () => Promise<Record<string, unknown>>
    params: Record<string, unknown>
  }) => {
    const meta = getShieldMeta(params)

    // Cache hit: return a simulated stream without calling the model
    if (meta?.cacheHit) {
      const modelId = String(params.modelId ?? "")

      if (userBudgetManager && meta.userId && meta.userBudgetInflight) {
        userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
      }

      if (ledger) {
        await ledger.recordCacheHit({
          model: modelId,
          savedInputTokens: meta.cacheHit.inputTokens,
          savedOutputTokens: meta.cacheHit.outputTokens,
          feature: config.ledger?.feature,
        })
      }

      const streamCacheHitSavedDollars = safeCost(
        modelId,
        meta.cacheHit.inputTokens,
        meta.cacheHit.outputTokens,
      )

      config.onUsage?.({
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        saved: streamCacheHitSavedDollars,
      })

      const cachedText = meta.cacheHit.response
      const simulatedStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: cachedText })
          controller.close()
        },
      })

      return {
        stream: simulatedStream,
        usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
        finishReason: Promise.resolve("stop"),
      }
    }

    // Call the real model's stream
    const modelId = String(params.modelId ?? "")
    const startTime = Date.now()
    let result: Record<string, unknown>
    try {
      result = await doStream()
    } catch (err) {
      if (userBudgetManager && meta?.userId && meta.userBudgetInflight) {
        userBudgetManager.releaseInflight(meta.userId, meta.userBudgetInflight)
      }
      if (adapter) {
        const provider = adapter.getProviderForModel(modelId)
        if (provider) {
          try {
            adapter.recordFailure(provider, err instanceof Error ? err.message : String(err))
          } catch {
            /* non-fatal */
          }
        }
      }
      throw err
    }
    const streamLatencyMs = Date.now() - startTime

    if (adapter) {
      const provider = adapter.getProviderForModel(modelId)
      if (provider) {
        try {
          adapter.recordSuccess(provider, streamLatencyMs)
        } catch {
          /* non-fatal */
        }
      }
    }

    const tracker = new StreamTokenTracker({ modelId })

    if (meta?.originalInputTokens) {
      tracker.setInputTokens(meta.originalInputTokens)
    }

    const originalStream = result.stream as ReadableStream

    // Helper to record usage in ledger and breaker after streaming ends
    const recordStreamUsage = (usage: { inputTokens: number; outputTokens: number }) => {
      const latencyMs = Date.now() - startTime

      // Store in cache (fire-and-forget)
      if (cache) {
        const cachedUserText = meta?.lastUserText ?? extractLastUserText(params)
        const responseText = tracker.getText()
        if (cachedUserText && responseText) {
          cache
            .store(cachedUserText, responseText, modelId, usage.inputTokens, usage.outputTokens)
            .catch((err) => {
              log?.debug("cache", "Failed to store streamed response", {
                error: err instanceof Error ? err.message : String(err),
              })
            })
        }
      }

      // Record usage, savings, and emit events (fire-and-forget for streams)
      recordPostRequestUsage(ctx, {
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        meta,
        params,
      }).catch((err) => {
        log?.debug("ledger", "Failed to record stream usage", {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }

    // Guard flag to prevent double-recording
    let usageRecorded = false
    const recordStreamUsageOnce = (usage: { inputTokens: number; outputTokens: number }) => {
      if (usageRecorded) return
      try {
        recordStreamUsage(usage)
        usageRecorded = true
      } catch {
        // recordStreamUsage threw — leave usageRecorded false so retry is possible
      }
    }

    const reader = originalStream.getReader()
    let streamCancelled = false
    const monitoredStream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done || streamCancelled) {
            const usage = tracker.finish()
            recordStreamUsageOnce(usage)

            try {
              instanceEvents.emit("stream:complete", {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
              })
            } catch {
              /* non-fatal */
            }

            try {
              controller.close()
            } catch {
              /* already closed by cancel */
            }
            return
          }

          const c = value as Record<string, unknown>
          if (c && c.type === "text-delta" && typeof c.textDelta === "string") {
            tracker.addChunk(c.textDelta)

            try {
              const chunkUsage = tracker.getUsage()
              instanceEvents.emit("stream:chunk", {
                outputTokens: chunkUsage.outputTokens,
                estimatedCost: chunkUsage.estimatedCost,
              })
            } catch {
              /* non-fatal */
            }
          }

          try {
            controller.enqueue(value)
          } catch {
            /* stream cancelled mid-read */
          }
        } catch (err) {
          const usage = tracker.abort()
          recordStreamUsageOnce(usage)

          try {
            instanceEvents.emit("stream:abort", {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              estimatedCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
            })
          } catch {
            /* non-fatal */
          }

          try {
            controller.error(err)
          } catch {
            /* already closed/errored */
          }
        }
      },
      cancel() {
        streamCancelled = true
        reader.cancel()
        const usage = tracker.abort()
        recordStreamUsageOnce(usage)

        try {
          instanceEvents.emit("stream:abort", {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCost: safeCost(modelId, usage.inputTokens, usage.outputTokens),
          })
        } catch {
          /* non-fatal */
        }
      },
    })

    return { ...result, stream: monitoredStream }
  }
}
