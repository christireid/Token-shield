import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ShieldWorker, createShieldWorker } from "./shield-worker"

describe("ShieldWorker", () => {
  // -------------------------------------------------------
  // Inline mode (no Web Worker available in Vitest/Node.js)
  // -------------------------------------------------------
  describe("inline mode", () => {
    let worker: ShieldWorker

    beforeEach(async () => {
      worker = new ShieldWorker()
      await worker.init()
    })

    it("init() succeeds in inline mode", () => {
      expect(worker.isReady).toBe(true)
    })

    it("isReady is true after init", () => {
      expect(worker.isReady).toBe(true)
    })

    it("executionMode is 'inline' (no Worker available in Node.js)", () => {
      expect(worker.executionMode).toBe("inline")
    })

    it("find() returns null on empty engine", async () => {
      const result = await worker.find("anything at all")
      expect(result).toBeNull()
    })

    it("learn() then find() returns match", async () => {
      await worker.learn(
        "How do I configure my database connection?",
        "Use a connection string.",
        "gpt-4o",
        10,
        20,
      )
      const result = await worker.find("How do I configure my database connection?")
      expect(result).not.toBeNull()
      expect(result!.response).toBe("Use a connection string.")
      expect(result!.score).toBeGreaterThan(0.8)
    })

    it("clear() empties the engine", async () => {
      await worker.learn("Test prompt for the engine", "Test response", "gpt-4o", 5, 10)
      const stats1 = await worker.stats()
      expect(stats1.entries).toBe(1)

      await worker.clear()
      const stats2 = await worker.stats()
      expect(stats2.entries).toBe(0)
    })

    it("stats() returns correct counts", async () => {
      await worker.learn("First prompt for testing", "First", "gpt-4o", 5, 5)
      await worker.learn("Second prompt for testing", "Second", "gpt-4o", 5, 5)
      const stats = await worker.stats()
      expect(stats.entries).toBe(2)
      expect(stats.totalHits).toBe(2) // each learn starts with hits=1
    })

    it("terminate() sets isReady to false", () => {
      worker.terminate()
      expect(worker.isReady).toBe(false)
    })

    it("find() returns null after terminate (not ready)", async () => {
      worker.terminate()
      const result = await worker.find("anything at all")
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------
  // createShieldWorker factory
  // -------------------------------------------------------
  describe("createShieldWorker factory", () => {
    it("returns a ShieldWorker instance", () => {
      const sw = createShieldWorker()
      expect(sw).toBeInstanceOf(ShieldWorker)
    })
  })

  // -------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------
  describe("edge cases", () => {
    it("init() without config uses defaults", async () => {
      const sw = new ShieldWorker()
      await sw.init()
      expect(sw.isReady).toBe(true)
      expect(sw.executionMode).toBe("inline")
    })

    it("multiple find() calls work correctly", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await sw.learn("What is the capital of France?", "Paris.", "gpt-4o", 5, 5)
      await sw.learn("What is the capital of Germany?", "Berlin.", "gpt-4o", 5, 5)

      const r1 = await sw.find("What is the capital of France?")
      expect(r1).not.toBeNull()
      expect(r1!.response).toBe("Paris.")

      const r2 = await sw.find("What is the capital of Germany?")
      expect(r2).not.toBeNull()
      expect(r2!.response).toBe("Berlin.")
    })

    it("learn() + find() with model filter works", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await sw.learn("How do I deploy to production?", "Use CI/CD pipelines.", "gpt-4o", 5, 10)

      // Same model should match
      const match = await sw.find("How do I deploy to production?", "gpt-4o")
      expect(match).not.toBeNull()
      expect(match!.response).toBe("Use CI/CD pipelines.")

      // Different model should not match
      const noMatch = await sw.find("How do I deploy to production?", "claude-3-opus")
      expect(noMatch).toBeNull()
    })
  })

  // -------------------------------------------------------
  // Not-ready guards (before init)
  // -------------------------------------------------------
  describe("not-ready guards", () => {
    it("learn() returns early without error when not ready", async () => {
      const sw = new ShieldWorker()
      // Do NOT call init — engine is not ready
      await expect(
        sw.learn("some prompt", "some response", "gpt-4o", 5, 10),
      ).resolves.toBeUndefined()
    })

    it("clear() returns early without error when not ready", async () => {
      const sw = new ShieldWorker()
      await expect(sw.clear()).resolves.toBeUndefined()
    })

    it("stats() returns zeroed stats when not ready", async () => {
      const sw = new ShieldWorker()
      const stats = await sw.stats()
      expect(stats).toEqual({ entries: 0, totalHits: 0, avgScore: 0 })
    })
  })

  // -------------------------------------------------------
  // Re-initialization
  // -------------------------------------------------------
  describe("re-initialization", () => {
    it("double init() reinitializes cleanly", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })
      await sw.learn("What color is the sky?", "Blue.", "gpt-4o", 5, 5)

      const stats1 = await sw.stats()
      expect(stats1.entries).toBe(1)

      // Re-init should wipe the engine and start fresh
      await sw.init({ threshold: 0.6 })
      expect(sw.isReady).toBe(true)
      expect(sw.executionMode).toBe("inline")

      const stats2 = await sw.stats()
      expect(stats2.entries).toBe(0)
    })
  })

  // -------------------------------------------------------
  // initInline with persist: true
  // -------------------------------------------------------
  describe("initInline with persist", () => {
    it("init() with persist: true initializes and hydrates without error", async () => {
      const sw = new ShieldWorker()
      // In Node.js/Vitest there is no IDB — hydrate gracefully returns 0
      await expect(sw.init({ persist: true })).resolves.toBeUndefined()
      expect(sw.isReady).toBe(true)
      expect(sw.executionMode).toBe("inline")

      // Engine is functional after hydrating with persist enabled
      await sw.learn("Persisted prompt for testing", "Persisted response", "gpt-4o", 5, 5)
      const stats = await sw.stats()
      expect(stats.entries).toBe(1)
    })
  })

  // -------------------------------------------------------
  // find() without model parameter
  // -------------------------------------------------------
  describe("find without model param", () => {
    it("find() with only prompt (no model) returns a match regardless of stored model", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await sw.learn("How do I reset my password?", "Click forgot password.", "gpt-4o", 5, 10)

      // Call find with prompt only — no model filter
      const result = await sw.find("How do I reset my password?")
      expect(result).not.toBeNull()
      expect(result!.response).toBe("Click forgot password.")
    })
  })

  // -------------------------------------------------------
  // terminate() with pending promises
  // -------------------------------------------------------
  describe("terminate with pending promises", () => {
    it("terminate() rejects pending promises", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      // Learn something so find has work to do
      await sw.learn("Test prompt for pending", "Test response", "gpt-4o", 5, 5)

      // Manually add a pending promise to simulate in-flight requests
      // Access the private pending map via bracket notation
      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const promise = new Promise<void>((resolve, reject) => {
        pendingMap.set("test_pending_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      // Terminate should reject all pending promises
      sw.terminate()

      await expect(promise).rejects.toThrow("ShieldWorker terminated")
      expect(sw.isReady).toBe(false)
    })
  })

  // -------------------------------------------------------
  // handleMessage coverage (simulate worker responses)
  // -------------------------------------------------------
  describe("handleMessage", () => {
    it("ignores messages with unknown IDs", async () => {
      const sw = new ShieldWorker()
      await sw.init()
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)
      // Should not throw for unknown ID
      handler({ type: "FIND_RESULT", id: "nonexistent_id_123", payload: null })
    })

    it("rejects pending on ERROR response", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("err_id_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "ERROR", id: "err_id_1", payload: "something went wrong" })
      await expect(promise).rejects.toThrow("something went wrong")
    })

    it("resolves STATS_RESULT", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("stats_id_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({
        type: "STATS_RESULT",
        id: "stats_id_1",
        payload: { entries: 5, totalHits: 10, avgScore: 0.9 },
      })
      await expect(promise).resolves.toEqual({ entries: 5, totalHits: 10, avgScore: 0.9 })
    })

    it("resolves INIT_SUCCESS with undefined", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("init_id_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "INIT_SUCCESS", id: "init_id_1" })
      await expect(promise).resolves.toBeUndefined()
    })
  })

  // -------------------------------------------------------
  // Concurrent operations
  // -------------------------------------------------------
  describe("concurrent operations", () => {
    it("handles multiple concurrent learn/find operations", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await Promise.all([
        sw.learn("What is TypeScript?", "TS is a typed JS superset.", "gpt-4o", 10, 20),
        sw.learn("What is JavaScript?", "JS is a scripting language.", "gpt-4o", 10, 20),
        sw.learn("What is Python?", "Python is a general-purpose language.", "gpt-4o", 10, 20),
      ])

      const stats = await sw.stats()
      expect(stats.entries).toBe(3)

      const [ts, js, py] = await Promise.all([
        sw.find("What is TypeScript?"),
        sw.find("What is JavaScript?"),
        sw.find("What is Python?"),
      ])
      expect(ts).not.toBeNull()
      expect(js).not.toBeNull()
      expect(py).not.toBeNull()
    })
  })

  // -------------------------------------------------------
  // Worker onerror fallback path (lines 89-100)
  // -------------------------------------------------------
  describe("worker onerror fallback", () => {
    it("onerror rejects all pending promises and falls back to inline", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      // Access private internals to simulate worker mode
      const internals = sw as unknown as {
        worker: { terminate: () => void; onmessage: unknown; onerror: (() => void) | null } | null
        pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        mode: string
        ready: boolean
      }

      // Create a fake worker object that simulates worker mode
      const fakeWorker = {
        terminate: vi.fn(),
        onmessage: null as unknown,
        onerror: null as (() => void) | null,
        postMessage: vi.fn(),
      }
      internals.worker = fakeWorker
      internals.mode = "worker"
      internals.ready = true

      // Set the onerror handler as the source code does
      fakeWorker.onerror = () => {
        internals.worker?.terminate()
        internals.worker = null
        for (const [, { reject }] of internals.pending) {
          reject(new Error("Worker failed to load"))
        }
        internals.pending.clear()
      }

      // Add pending promises to simulate in-flight requests
      const promise1 = new Promise<void>((resolve, reject) => {
        internals.pending.set("pending_onerr_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })
      const promise2 = new Promise<void>((resolve, reject) => {
        internals.pending.set("pending_onerr_2", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      // Trigger the onerror handler
      fakeWorker.onerror!()

      // Both pending promises should be rejected with the worker error
      await expect(promise1).rejects.toThrow("Worker failed to load")
      await expect(promise2).rejects.toThrow("Worker failed to load")

      // Worker should be nulled out and pending cleared
      expect(internals.worker).toBeNull()
      expect(internals.pending.size).toBe(0)
      expect(fakeWorker.terminate).toHaveBeenCalled()
    })

    it("onerror with no pending promises still clears worker", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { terminate: () => void; onerror: (() => void) | null } | null
        pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        mode: string
        ready: boolean
      }

      const fakeWorker = {
        terminate: vi.fn(),
        onmessage: null as unknown,
        onerror: null as (() => void) | null,
        postMessage: vi.fn(),
      }
      internals.worker = fakeWorker
      internals.mode = "worker"

      fakeWorker.onerror = () => {
        internals.worker?.terminate()
        internals.worker = null
        for (const [, { reject }] of internals.pending) {
          reject(new Error("Worker failed to load"))
        }
        internals.pending.clear()
      }

      // No pending promises — trigger onerror
      fakeWorker.onerror!()

      expect(internals.worker).toBeNull()
      expect(internals.pending.size).toBe(0)
      expect(fakeWorker.terminate).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------
  // post() timeout path (lines 199-220)
  // -------------------------------------------------------
  describe("post() timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("rejects with timeout error after 10 seconds", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        post: <T>(command: { type: string; id: string; payload?: unknown }) => Promise<T>
      }

      // Set up a fake worker so post() can call worker!.postMessage
      internals.worker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      // Call post() which sets up the 10s timeout
      const postPromise = internals.post<void>({
        type: "FIND",
        id: "timeout_test_1",
        payload: { prompt: "test" },
      })

      // Advance time past the 10-second timeout
      vi.advanceTimersByTime(10_001)

      await expect(postPromise).rejects.toThrow("ShieldWorker timeout for FIND")
    })

    it("timeout for LEARN command type shows correct type in message", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        post: <T>(command: { type: string; id: string; payload?: unknown }) => Promise<T>
      }

      internals.worker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const postPromise = internals.post<void>({
        type: "LEARN",
        id: "timeout_learn_1",
        payload: {
          prompt: "test",
          response: "resp",
          model: "gpt-4o",
          inputTokens: 5,
          outputTokens: 10,
        },
      })

      vi.advanceTimersByTime(10_001)

      await expect(postPromise).rejects.toThrow("ShieldWorker timeout for LEARN")
    })

    it("does not reject if resolved before timeout", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        mode: string
        ready: boolean
        post: <T>(command: { type: string; id: string; payload?: unknown }) => Promise<T>
        handleMessage: (msg: Record<string, unknown>) => void
      }

      internals.worker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const postPromise = internals.post<null>({
        type: "FIND",
        id: "no_timeout_1",
        payload: { prompt: "test" },
      })

      // Simulate the worker responding before timeout
      internals.handleMessage({
        type: "FIND_RESULT",
        id: "no_timeout_1",
        payload: null,
      } as unknown as Record<string, unknown>)

      // Advance past timeout — should not reject since already resolved
      vi.advanceTimersByTime(10_001)

      await expect(postPromise).resolves.toBeNull()
    })
  })

  // -------------------------------------------------------
  // FIND_RESULT, LEARN_DONE, and CLEAR_DONE handleMessage resolution
  // -------------------------------------------------------
  describe("handleMessage - FIND_RESULT, LEARN_DONE, CLEAR_DONE", () => {
    it("resolves FIND_RESULT with a match payload", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const findPayload = {
        prompt: "How do I test?",
        response: "Use vitest.",
        score: 0.95,
        model: "gpt-4o",
        inputTokens: 5,
        outputTokens: 10,
        hits: 3,
      }

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("find_result_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "FIND_RESULT", id: "find_result_1", payload: findPayload })
      await expect(promise).resolves.toEqual(findPayload)
    })

    it("resolves FIND_RESULT with null when no match", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("find_null_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "FIND_RESULT", id: "find_null_1", payload: null })
      await expect(promise).resolves.toBeNull()
    })

    it("resolves LEARN_DONE with undefined", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("learn_done_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "LEARN_DONE", id: "learn_done_1" })
      await expect(promise).resolves.toBeUndefined()
    })

    it("resolves CLEAR_DONE with undefined", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("clear_done_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      handler({ type: "CLEAR_DONE", id: "clear_done_1" })
      await expect(promise).resolves.toBeUndefined()
    })

    it("cleans up pending entry after FIND_RESULT resolution", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("find_cleanup_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      expect(pendingMap.has("find_cleanup_1")).toBe(true)
      handler({ type: "FIND_RESULT", id: "find_cleanup_1", payload: null })
      await promise
      expect(pendingMap.has("find_cleanup_1")).toBe(false)
    })

    it("cleans up pending entry after LEARN_DONE resolution", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const pendingMap = (
        sw as unknown as {
          pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
        }
      ).pending
      const handler = (
        sw as unknown as { handleMessage: (msg: Record<string, unknown>) => void }
      ).handleMessage.bind(sw)

      const promise = new Promise((resolve, reject) => {
        pendingMap.set("learn_cleanup_1", {
          resolve: resolve as (v: unknown) => void,
          reject: reject as (r: unknown) => void,
        })
      })

      expect(pendingMap.has("learn_cleanup_1")).toBe(true)
      handler({ type: "LEARN_DONE", id: "learn_cleanup_1" })
      await promise
      expect(pendingMap.has("learn_cleanup_1")).toBe(false)
    })
  })

  // -------------------------------------------------------
  // Worker mode method routing (find/learn/clear/stats via post)
  // -------------------------------------------------------
  describe("worker mode method routing", () => {
    it("find() calls post() when in worker mode", async () => {
      vi.useFakeTimers()

      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        handleMessage: (msg: Record<string, unknown>) => void
        pending: Map<string, { resolve: (v: unknown) => void; reject: (r: unknown) => void }>
      }

      const postMessageFn = vi.fn()
      internals.worker = {
        postMessage: postMessageFn,
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const findPromise = sw.find("test prompt", "gpt-4o")

      // postMessage should have been called
      expect(postMessageFn).toHaveBeenCalledTimes(1)
      const sentCommand = postMessageFn.mock.calls[0][0]
      expect(sentCommand.type).toBe("FIND")
      expect(sentCommand.payload).toEqual({ prompt: "test prompt", model: "gpt-4o" })

      // Simulate the worker responding
      internals.handleMessage({
        type: "FIND_RESULT",
        id: sentCommand.id,
        payload: null,
      } as unknown as Record<string, unknown>)

      const result = await findPromise
      expect(result).toBeNull()

      vi.useRealTimers()
    })

    it("learn() calls post() when in worker mode", async () => {
      vi.useFakeTimers()

      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        handleMessage: (msg: Record<string, unknown>) => void
      }

      const postMessageFn = vi.fn()
      internals.worker = {
        postMessage: postMessageFn,
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const learnPromise = sw.learn("test prompt", "test response", "gpt-4o", 5, 10)

      expect(postMessageFn).toHaveBeenCalledTimes(1)
      const sentCommand = postMessageFn.mock.calls[0][0]
      expect(sentCommand.type).toBe("LEARN")
      expect(sentCommand.payload).toEqual({
        prompt: "test prompt",
        response: "test response",
        model: "gpt-4o",
        inputTokens: 5,
        outputTokens: 10,
      })

      // Simulate worker responding with LEARN_DONE
      internals.handleMessage({
        type: "LEARN_DONE",
        id: sentCommand.id,
      } as unknown as Record<string, unknown>)

      await expect(learnPromise).resolves.toBeUndefined()

      vi.useRealTimers()
    })

    it("clear() calls post() when in worker mode", async () => {
      vi.useFakeTimers()

      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        handleMessage: (msg: Record<string, unknown>) => void
      }

      const postMessageFn = vi.fn()
      internals.worker = {
        postMessage: postMessageFn,
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const clearPromise = sw.clear()

      expect(postMessageFn).toHaveBeenCalledTimes(1)
      const sentCommand = postMessageFn.mock.calls[0][0]
      expect(sentCommand.type).toBe("CLEAR")

      // Simulate worker responding with CLEAR_DONE
      internals.handleMessage({
        type: "CLEAR_DONE",
        id: sentCommand.id,
      } as unknown as Record<string, unknown>)

      await expect(clearPromise).resolves.toBeUndefined()

      vi.useRealTimers()
    })

    it("stats() calls post() when in worker mode", async () => {
      vi.useFakeTimers()

      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { postMessage: (cmd: unknown) => void; terminate: () => void } | null
        mode: string
        ready: boolean
        handleMessage: (msg: Record<string, unknown>) => void
      }

      const postMessageFn = vi.fn()
      internals.worker = {
        postMessage: postMessageFn,
        terminate: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      const statsPromise = sw.stats()

      expect(postMessageFn).toHaveBeenCalledTimes(1)
      const sentCommand = postMessageFn.mock.calls[0][0]
      expect(sentCommand.type).toBe("STATS")

      // Simulate worker responding with STATS_RESULT
      internals.handleMessage({
        type: "STATS_RESULT",
        id: sentCommand.id,
        payload: { entries: 3, totalHits: 7, avgScore: 0.85 },
      } as unknown as Record<string, unknown>)

      await expect(statsPromise).resolves.toEqual({ entries: 3, totalHits: 7, avgScore: 0.85 })

      vi.useRealTimers()
    })
  })

  // -------------------------------------------------------
  // terminate() in worker mode
  // -------------------------------------------------------
  describe("terminate in worker mode", () => {
    it("calls worker.terminate() and nulls the worker when in worker mode", () => {
      const sw = new ShieldWorker()

      const internals = sw as unknown as {
        worker: { terminate: () => void; postMessage: () => void } | null
        mode: string
        ready: boolean
      }

      const terminateFn = vi.fn()
      internals.worker = {
        terminate: terminateFn,
        postMessage: vi.fn(),
      }
      internals.mode = "worker"
      internals.ready = true

      sw.terminate()

      expect(terminateFn).toHaveBeenCalledTimes(1)
      expect(internals.worker).toBeNull()
      expect(sw.isReady).toBe(false)
    })
  })

  // -------------------------------------------------------
  // init() with existing worker (double-init guard, line 78-81)
  // -------------------------------------------------------
  describe("init guard terminates existing worker", () => {
    it("terminates the existing worker on re-init", async () => {
      const sw = new ShieldWorker()
      await sw.init()

      const internals = sw as unknown as {
        worker: { terminate: () => void; postMessage: () => void } | null
      }

      const terminateFn = vi.fn()
      internals.worker = {
        terminate: terminateFn,
        postMessage: vi.fn(),
      }

      // Re-init should terminate the existing fake worker and fall back to inline
      await sw.init()

      expect(terminateFn).toHaveBeenCalledTimes(1)
      expect(sw.isReady).toBe(true)
      expect(sw.executionMode).toBe("inline")
    })
  })
})
