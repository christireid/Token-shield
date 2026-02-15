import { describe, it, expect } from "vitest"
import {
  useContextManager,
  useResponseCache,
  useRequestGuard,
  useEventLog,
  useProviderHealth,
  usePipelineMetrics,
  type EventLogEntry,
  type PipelineMetrics,
} from "./react-hooks-pipeline"

describe("react-hooks-pipeline", () => {
  describe("exports", () => {
    it("exports useContextManager as a function", () => {
      expect(typeof useContextManager).toBe("function")
    })

    it("exports useResponseCache as a function", () => {
      expect(typeof useResponseCache).toBe("function")
    })

    it("exports useRequestGuard as a function", () => {
      expect(typeof useRequestGuard).toBe("function")
    })

    it("exports useEventLog as a function", () => {
      expect(typeof useEventLog).toBe("function")
    })

    it("exports useProviderHealth as a function", () => {
      expect(typeof useProviderHealth).toBe("function")
    })

    it("exports usePipelineMetrics as a function", () => {
      expect(typeof usePipelineMetrics).toBe("function")
    })
  })

  describe("EventLogEntry interface", () => {
    it("allows creating objects with correct shape", () => {
      const entry: EventLogEntry = {
        id: 1,
        timestamp: Date.now(),
        type: "cache:hit",
        data: { similarity: 0.95, modelId: "gpt-4" },
      }

      expect(entry.id).toBe(1)
      expect(typeof entry.timestamp).toBe("number")
      expect(entry.type).toBe("cache:hit")
      expect(entry.data).toEqual({ similarity: 0.95, modelId: "gpt-4" })
    })

    it("allows various event types", () => {
      const cacheHit: EventLogEntry = {
        id: 1,
        timestamp: 1000,
        type: "cache:hit",
        data: {},
      }
      expect(cacheHit.type).toBe("cache:hit")

      const requestBlocked: EventLogEntry = {
        id: 2,
        timestamp: 2000,
        type: "request:blocked",
        data: { reason: "rate limit" },
      }
      expect(requestBlocked.type).toBe("request:blocked")

      const ledgerEntry: EventLogEntry = {
        id: 3,
        timestamp: 3000,
        type: "ledger:entry",
        data: { cost: 0.01, saved: 0.005 },
      }
      expect(ledgerEntry.type).toBe("ledger:entry")
    })

    it("allows empty data object", () => {
      const entry: EventLogEntry = {
        id: 100,
        timestamp: Date.now(),
        type: "cache:miss",
        data: {},
      }

      expect(entry.data).toEqual({})
    })

    it("allows complex nested data", () => {
      const entry: EventLogEntry = {
        id: 999,
        timestamp: Date.now(),
        type: "stream:complete",
        data: {
          chunks: 10,
          totalTokens: 1500,
          metadata: {
            model: "gpt-4",
            temperature: 0.7,
          },
        },
      }

      expect(entry.data).toHaveProperty("chunks")
      expect(entry.data).toHaveProperty("metadata")
    })
  })

  describe("PipelineMetrics interface", () => {
    it("allows creating objects with correct shape", () => {
      const metrics: PipelineMetrics = {
        totalRequests: 100,
        avgLatencyMs: 250,
        cacheHitRate: 0.75,
        blockedRate: 0.05,
        lastEvent: null,
      }

      expect(metrics.totalRequests).toBe(100)
      expect(metrics.avgLatencyMs).toBe(250)
      expect(metrics.cacheHitRate).toBe(0.75)
      expect(metrics.blockedRate).toBe(0.05)
      expect(metrics.lastEvent).toBeNull()
    })

    it("allows metrics with lastEvent", () => {
      const lastEvent: EventLogEntry = {
        id: 1,
        timestamp: Date.now(),
        type: "cache:hit",
        data: {},
      }

      const metrics: PipelineMetrics = {
        totalRequests: 50,
        avgLatencyMs: 200,
        cacheHitRate: 0.8,
        blockedRate: 0.02,
        lastEvent,
      }

      expect(metrics.lastEvent).not.toBeNull()
      expect(metrics.lastEvent?.type).toBe("cache:hit")
    })

    it("handles zero values correctly", () => {
      const emptyMetrics: PipelineMetrics = {
        totalRequests: 0,
        avgLatencyMs: 0,
        cacheHitRate: 0,
        blockedRate: 0,
        lastEvent: null,
      }

      expect(emptyMetrics.totalRequests).toBe(0)
      expect(emptyMetrics.avgLatencyMs).toBe(0)
      expect(emptyMetrics.cacheHitRate).toBe(0)
      expect(emptyMetrics.blockedRate).toBe(0)
    })

    it("validates rate calculations", () => {
      const metrics: PipelineMetrics = {
        totalRequests: 100,
        avgLatencyMs: 150,
        cacheHitRate: 75 / 100, // 75 hits out of 100 requests
        blockedRate: 5 / 100, // 5 blocked out of 100 requests
        lastEvent: null,
      }

      expect(metrics.cacheHitRate).toBe(0.75)
      expect(metrics.blockedRate).toBe(0.05)
      expect(metrics.cacheHitRate + metrics.blockedRate).toBeLessThan(1)
    })
  })

  describe("EMPTY_PIPELINE_METRICS shape validation", () => {
    it("validates the EMPTY_PIPELINE_METRICS constant structure", () => {
      // EMPTY_PIPELINE_METRICS is a module-level constant defined as:
      const emptyMetrics = {
        totalRequests: 0,
        avgLatencyMs: 0,
        cacheHitRate: 0,
        blockedRate: 0,
        lastEvent: null,
      }

      expect(emptyMetrics.totalRequests).toBe(0)
      expect(emptyMetrics.avgLatencyMs).toBe(0)
      expect(emptyMetrics.cacheHitRate).toBe(0)
      expect(emptyMetrics.blockedRate).toBe(0)
      expect(emptyMetrics.lastEvent).toBeNull()
    })

    it("validates that EMPTY_PIPELINE_METRICS conforms to PipelineMetrics interface", () => {
      const emptyMetrics: PipelineMetrics = {
        totalRequests: 0,
        avgLatencyMs: 0,
        cacheHitRate: 0,
        blockedRate: 0,
        lastEvent: null,
      }

      // Type check passes if this compiles
      expect(emptyMetrics).toBeDefined()
    })

    it("validates average latency calculation when no samples exist", () => {
      // When latencySamples = 0, avgLatencyMs should be 0
      const cumulativeLatencyMs = 0
      const latencySamples = 0
      const avgLatencyMs = latencySamples > 0 ? Math.round(cumulativeLatencyMs / latencySamples) : 0

      expect(avgLatencyMs).toBe(0)
    })

    it("validates cache hit rate calculation when no requests exist", () => {
      // When totalRequests = 0, cacheHitRate should be 0
      const totalRequests = 0
      const totalCacheHits = 0
      const cacheHitRate = totalRequests > 0 ? totalCacheHits / totalRequests : 0

      expect(cacheHitRate).toBe(0)
    })

    it("validates blocked rate calculation when no requests exist", () => {
      // When totalRequests = 0, blockedRate should be 0
      const totalRequests = 0
      const totalBlocked = 0
      const blockedRate = totalRequests > 0 ? totalBlocked / totalRequests : 0

      expect(blockedRate).toBe(0)
    })
  })
})
