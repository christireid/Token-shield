/**
 * TokenShield - Composable Pipeline
 *
 * Provides a way to compose middleware stages into a pipeline, allowing
 * developers to pick and choose which stages to run and in what order.
 * Wraps the existing module implementations without refactoring them.
 *
 * Usage:
 *   import { createPipeline, createBreakerStage, createGuardStage } from '@tokenshield/ai-sdk'
 *
 *   const pipeline = createPipeline(
 *     createBreakerStage(breaker, { reserveForOutput: 500 }),
 *     createGuardStage(guard),
 *   )
 *   pipeline.addHook({ afterStage: (name, ctx, ms) => console.log(`${name}: ${ms}ms`) })
 *
 *   const result = await pipeline.execute({ params: {}, messages: [], ... })
 */

import { countTokens } from "gpt-tokenizer"
import { fitToBudget, type Message } from "./context-manager"
import { ResponseCache } from "./response-cache"
import { analyzeComplexity } from "./model-router"
import { RequestGuard } from "./request-guard"
import { optimizePrefix } from "./prefix-optimizer"
import { MODEL_PRICING, estimateCost } from "./cost-estimator"
import { CostCircuitBreaker } from "./circuit-breaker"
import { UserBudgetManager } from "./user-budget-manager"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface PipelineContext {
  params: Record<string, unknown>
  messages: Array<{ role: string; content: string }>
  lastUserText: string
  modelId: string
  meta: Record<string, unknown>
  aborted: boolean
  abortReason?: string
}

export type PipelineStage = {
  name: string
  execute: (ctx: PipelineContext) => Promise<PipelineContext> | PipelineContext
}

export type PipelineHook = {
  beforeStage?: (stageName: string, ctx: PipelineContext) => void
  afterStage?: (stageName: string, ctx: PipelineContext, durationMs: number) => void
  onError?: (stageName: string, error: Error, ctx: PipelineContext) => void
}

// -------------------------------------------------------
// Pre-built stages
// -------------------------------------------------------

/** Stage 1: Circuit breaker -- blocks when session/time spending limits are exceeded. */
export function createBreakerStage(
  breaker: CostCircuitBreaker,
  config: { reserveForOutput: number }
): PipelineStage {
  return {
    name: "breaker",
    execute(ctx) {
      if (ctx.aborted) return ctx
      if (!ctx.lastUserText) return ctx
      const estimatedInput = countTokens(ctx.lastUserText)
      const check = breaker.check(ctx.modelId, estimatedInput, config.reserveForOutput)
      if (!check.allowed) {
        ctx.aborted = true
        ctx.abortReason = check.reason ?? "Budget exceeded (circuit breaker)"
      }
      return ctx
    },
  }
}

/** Stage 2: Per-user budget -- blocks when a user exceeds their daily/monthly dollar limits. */
export function createBudgetStage(
  manager: UserBudgetManager,
  getUserId: () => string,
  config: { reserveForOutput: number }
): PipelineStage {
  return {
    name: "budget",
    execute(ctx) {
      if (ctx.aborted) return ctx
      let userId: string
      try {
        userId = getUserId()
      } catch {
        ctx.aborted = true
        ctx.abortReason = "Failed to resolve user ID"
        return ctx
      }
      if (!userId || typeof userId !== "string") {
        ctx.aborted = true
        ctx.abortReason = "getUserId() must return a non-empty string"
        return ctx
      }
      ctx.meta.userId = userId
      const estimatedInput = ctx.lastUserText ? countTokens(ctx.lastUserText) : 0
      const budgetCheck = manager.check(userId, ctx.modelId, estimatedInput, config.reserveForOutput)
      if (!budgetCheck.allowed) {
        ctx.aborted = true
        ctx.abortReason = budgetCheck.reason ?? "User budget exceeded"
        return ctx
      }
      // Store estimated inflight cost
      try {
        ctx.meta.userBudgetInflight = estimateCost(ctx.modelId, estimatedInput, config.reserveForOutput).totalCost
      } catch {
        ctx.meta.userBudgetInflight = 0
      }
      // Apply model tier routing if configured
      const tierModel = manager.getModelForUser(userId)
      if (tierModel && tierModel !== ctx.modelId) {
        ctx.meta.originalModel = ctx.modelId
        ctx.modelId = tierModel
        ctx.meta.tierRouted = true
      }
      return ctx
    },
  }
}

/** Stage 3: Request guard -- debounce, dedup, rate limit, cost gate. */
export function createGuardStage(guard: RequestGuard): PipelineStage {
  return {
    name: "guard",
    execute(ctx) {
      if (ctx.aborted) return ctx
      if (!ctx.lastUserText) return ctx
      const check = guard.check(ctx.lastUserText, undefined, ctx.modelId || undefined)
      if (!check.allowed) {
        ctx.aborted = true
        ctx.abortReason = check.reason ?? "Request blocked by guard"
      }
      return ctx
    },
  }
}

/** Stage 4: Response cache -- returns a cached response for matching prompts. */
export function createCacheStage(cache: ResponseCache): PipelineStage {
  return {
    name: "cache",
    async execute(ctx) {
      if (ctx.aborted) return ctx
      if (!ctx.lastUserText) return ctx
      const lookup = await cache.lookup(ctx.lastUserText, ctx.modelId)
      if (lookup.hit && lookup.entry) {
        ctx.meta.cacheHit = {
          response: lookup.entry.response,
          inputTokens: lookup.entry.inputTokens,
          outputTokens: lookup.entry.outputTokens,
        }
        // Signal that downstream stages can be skipped (caller decides)
        ctx.aborted = true
        ctx.abortReason = "cache-hit"
      }
      return ctx
    },
  }
}

/** Stage 5: Context trim -- fits conversation history within a token budget. */
export function createContextStage(config: { maxInputTokens: number; reserveForOutput: number }): PipelineStage {
  return {
    name: "context",
    execute(ctx) {
      if (ctx.aborted) return ctx
      const budget = {
        maxContextTokens: config.maxInputTokens + config.reserveForOutput,
        reservedForOutput: config.reserveForOutput,
      }
      const trimResult = fitToBudget(
        ctx.messages.map((m) => ({ ...m } as Message)),
        budget
      )
      if (trimResult.evictedTokens > 0) {
        ctx.meta.contextSaved = trimResult.evictedTokens
        ctx.messages = trimResult.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
      }
      return ctx
    },
  }
}

/** Stage 6: Model router -- routes to the cheapest model that handles the task's complexity. */
export function createRouterStage(
  tiers: Array<{ modelId: string; maxComplexity: number }>
): PipelineStage {
  return {
    name: "router",
    execute(ctx) {
      if (ctx.aborted) return ctx
      if (!ctx.lastUserText) return ctx
      // Skip if budget tier routing already selected a model
      if (ctx.meta.tierRouted) return ctx
      if (tiers.length === 0) return ctx

      const complexity = analyzeComplexity(ctx.lastUserText)
      ctx.meta.complexity = complexity

      const cheapestTier = tiers
        .filter((t) => complexity.score <= t.maxComplexity)
        .sort((a, b) => {
          const pa = MODEL_PRICING[a.modelId]
          const pb = MODEL_PRICING[b.modelId]
          if (!pa || !pb) return 0
          return pa.inputPerMillion - pb.inputPerMillion
        })[0]

      if (cheapestTier && cheapestTier.modelId !== ctx.modelId) {
        if (!ctx.meta.originalModel) ctx.meta.originalModel = ctx.modelId
        ctx.modelId = cheapestTier.modelId
      }
      return ctx
    },
  }
}

/** Stage 7: Prefix optimizer -- reorders messages for provider prompt cache hits. */
export function createPrefixStage(provider: string): PipelineStage {
  return {
    name: "prefix",
    execute(ctx) {
      if (ctx.aborted) return ctx
      const pricing = MODEL_PRICING[ctx.modelId]
      if (!pricing) return ctx
      const optimized = optimizePrefix(
        ctx.messages.map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
        ctx.modelId,
        pricing.inputPerMillion,
        { provider: provider as "openai" | "anthropic" | "google" | "auto" }
      )
      if (optimized.estimatedPrefixSavings > 0) {
        ctx.meta.prefixSaved = optimized.estimatedPrefixSavings
        ctx.messages = optimized.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
      }
      return ctx
    },
  }
}

// -------------------------------------------------------
// Pipeline
// -------------------------------------------------------

export class Pipeline {
  private stages: PipelineStage[] = []
  private hooks: PipelineHook[] = []

  /** Append a stage to the end of the pipeline. */
  addStage(stage: PipelineStage): this {
    this.stages.push(stage)
    return this
  }

  /** Register a lifecycle hook (before/after each stage, on error). */
  addHook(hook: PipelineHook): this {
    this.hooks.push(hook)
    return this
  }

  /** Remove a stage by name. Returns `this` for chaining. */
  removeStage(name: string): this {
    this.stages = this.stages.filter((s) => s.name !== name)
    return this
  }

  /** Return the ordered list of stage names. */
  getStageNames(): string[] {
    return this.stages.map((s) => s.name)
  }

  /** Execute all stages in order, respecting abort and calling hooks. */
  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    for (const stage of this.stages) {
      if (ctx.aborted) break

      for (const hook of this.hooks) {
        try { hook.beforeStage?.(stage.name, ctx) } catch { /* hook errors are swallowed */ }
      }

      const start = Date.now()
      try {
        ctx = await stage.execute(ctx)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        for (const hook of this.hooks) {
          try { hook.onError?.(stage.name, error, ctx) } catch { /* swallow */ }
        }
        // Stage errors abort the pipeline
        ctx.aborted = true
        ctx.abortReason = `Stage "${stage.name}" threw: ${error.message}`
        break
      }
      const durationMs = Date.now() - start

      for (const hook of this.hooks) {
        try { hook.afterStage?.(stage.name, ctx, durationMs) } catch { /* swallow */ }
      }
    }
    return ctx
  }
}

// -------------------------------------------------------
// Factory
// -------------------------------------------------------

/** Create a pipeline pre-loaded with the given stages. */
export function createPipeline(...stages: PipelineStage[]): Pipeline {
  const pipeline = new Pipeline()
  for (const stage of stages) {
    pipeline.addStage(stage)
  }
  return pipeline
}
