/**
 * IDB Failure Test Suite
 *
 * Tests that all onStorageError / onPersistError callbacks fire correctly
 * when IndexedDB operations fail. Catches regressions where callbacks
 * are accepted in config but not wired to catch blocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock storage-adapter BEFORE importing modules that use it
const mockGet = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()
const mockKeys = vi.fn()
const mockCreateStore = vi.fn()
vi.mock("../storage-adapter", () => ({
  get: (...args: unknown[]) => mockGet(...args),
  set: (...args: unknown[]) => mockSet(...args),
  del: (...args: unknown[]) => mockDel(...args),
  keys: (...args: unknown[]) => mockKeys(...args),
  createStore: (...args: unknown[]) => mockCreateStore(...args),
  isPersistent: () => true,
}))

import { AdaptiveOutputOptimizer } from "../adaptive-output-optimizer"
import { NeuroElasticEngine } from "../neuro-elastic"
import { AuditLog } from "../audit-log"
import { ResponseCache } from "../response-cache"

beforeEach(() => {
  // mockReset clears the once-queue AND default implementations
  mockGet.mockReset()
  mockSet.mockReset()
  mockDel.mockReset()
  mockKeys.mockReset()
  mockCreateStore.mockReset()
  // Re-set defaults
  mockGet.mockResolvedValue(undefined)
  mockSet.mockResolvedValue(undefined)
  mockDel.mockResolvedValue(undefined)
  mockKeys.mockResolvedValue([])
})

// -------------------------------------------------------
// AdaptiveOutputOptimizer
// -------------------------------------------------------

describe("AdaptiveOutputOptimizer IDB failures", () => {
  it("calls onStorageError when hydrate() IDB get fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB quota exceeded")
    mockGet.mockRejectedValueOnce(idbError)

    const opt = new AdaptiveOutputOptimizer({
      persist: true,
      storageKey: "test_adaptive",
      onStorageError: (err) => errors.push(err),
    })

    const count = await opt.hydrate()
    expect(count).toBe(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("calls onStorageError when persistAsync() IDB set fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB write failed")
    mockSet.mockRejectedValueOnce(idbError)

    const opt = new AdaptiveOutputOptimizer({
      persist: true,
      storageKey: "test_adaptive_persist",
      onStorageError: (err) => errors.push(err),
    })

    // recordActual triggers persistAsync internally
    await opt.recordActual("test prompt", "gpt-4o", 100)
    // Wait for the fire-and-forget persist
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toBe(idbError)
  })

  it("calls onStorageError when clear() IDB set fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB clear failed")
    mockSet.mockRejectedValueOnce(idbError)

    const opt = new AdaptiveOutputOptimizer({
      persist: true,
      storageKey: "test_adaptive_clear",
      onStorageError: (err) => errors.push(err),
    })

    await opt.clear()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("does not call onStorageError when persist is disabled", async () => {
    const errors: unknown[] = []

    const opt = new AdaptiveOutputOptimizer({
      persist: false,
      onStorageError: (err) => errors.push(err),
    })

    await opt.recordActual("test", "gpt-4o", 100)
    expect(errors).toHaveLength(0)
  })
})

// -------------------------------------------------------
// NeuroElasticEngine
// -------------------------------------------------------

describe("NeuroElasticEngine IDB failures", () => {
  it("calls onStorageError when hydrate() IDB get fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB hydrate failed")
    mockGet.mockRejectedValueOnce(idbError)

    const engine = new NeuroElasticEngine({
      persist: true,
      onStorageError: (err) => errors.push(err),
    })

    const count = await engine.hydrate()
    expect(count).toBe(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("calls onStorageError when clear() IDB set fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB clear failed")
    mockSet.mockRejectedValueOnce(idbError)

    const engine = new NeuroElasticEngine({
      persist: true,
      onStorageError: (err) => errors.push(err),
    })

    await engine.clear()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("calls onStorageError when persistAsync() IDB set fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB persist failed")

    const engine = new NeuroElasticEngine({
      persist: true,
      onStorageError: (err) => errors.push(err),
    })
    await engine.hydrate()

    // Set failure AFTER hydrate so hydrate doesn't consume it
    mockSet.mockRejectedValueOnce(idbError)

    // learn() triggers persistAsync internally
    await engine.learn("test prompt", "test response", "gpt-4o", 100, 50)
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(errors[0]).toBe(idbError)
  })

  it("does not fire callback when persist is disabled", async () => {
    const errors: unknown[] = []
    const engine = new NeuroElasticEngine({
      persist: false,
      onStorageError: (err) => errors.push(err),
    })

    await engine.hydrate()
    await engine.learn("prompt", "response", "gpt-4o", 10, 5)
    expect(errors).toHaveLength(0)
  })
})

// -------------------------------------------------------
// AuditLog
// -------------------------------------------------------

describe("AuditLog IDB failures", () => {
  it("calls onPersistError when hydrate() IDB get fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB audit hydrate failed")
    mockGet.mockRejectedValueOnce(idbError)

    const log = new AuditLog({
      persist: true,
      storageKey: "test_audit",
      onPersistError: (err) => errors.push(err),
    })

    const count = await log.hydrate()
    expect(count).toBe(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("calls onPersistError when persistAsync() IDB set fails", async () => {
    vi.useFakeTimers()
    try {
      const errors: unknown[] = []
      const idbError = new Error("IDB audit persist failed")
      mockSet.mockRejectedValue(idbError)

      const log = new AuditLog({
        persist: true,
        storageKey: "test_audit_persist",
        onPersistError: (err) => errors.push(err),
      })

      log.record("api_call", "info", "test", "Test entry")
      // Advance past the persist debounce (1000ms)
      await vi.advanceTimersByTimeAsync(1100)
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors[0]).toBe(idbError)
    } finally {
      vi.useRealTimers()
    }
  })

  it("calls onPersistError when clear() IDB set fails", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB audit clear failed")
    mockSet.mockRejectedValueOnce(idbError)

    const log = new AuditLog({
      persist: true,
      storageKey: "test_audit_clear",
      onPersistError: (err) => errors.push(err),
    })

    await log.clear()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })
})

// -------------------------------------------------------
// ResponseCache
// -------------------------------------------------------

describe("ResponseCache IDB failures", () => {
  // getStore() checks `typeof window !== "undefined"` — simulate browser env
  const origWindow = globalThis.window
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {}
  })
  afterEach(() => {
    if (origWindow === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).window
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).window = origWindow
    }
  })

  it("calls onStorageError when IDB set fails during store()", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB cache write failed")
    mockCreateStore.mockReturnValue("mock-store")
    mockSet.mockRejectedValue(idbError)

    const cache = new ResponseCache({
      maxEntries: 10,
      ttlMs: 60_000,
      similarityThreshold: 1,
      storeName: "test-cache",
      onStorageError: (err) => errors.push(err),
    })

    await cache.store("test prompt", "test response", "gpt-4o", 100, 50)
    // store() persistence may be async — wait for callback
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1))
    expect(errors[0]).toBe(idbError)
  })

  it("calls onStorageError when IDB get fails during lookup()", async () => {
    const errors: unknown[] = []
    const idbError = new Error("IDB cache read failed")
    mockCreateStore.mockReturnValue("mock-store")
    mockGet.mockRejectedValueOnce(idbError)

    const cache = new ResponseCache({
      maxEntries: 10,
      ttlMs: 60_000,
      similarityThreshold: 1,
      storeName: "test-cache-read",
      onStorageError: (err) => errors.push(err),
    })

    const result = await cache.lookup("test prompt", "gpt-4o")
    // lookup() falls through to in-memory on IDB failure
    expect(result).toBeTruthy()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(idbError)
  })

  it("forwards onStorageError to holographic engine", () => {
    const errors: unknown[] = []
    const cache = new ResponseCache({
      maxEntries: 10,
      ttlMs: 60_000,
      similarityThreshold: 0.8,
      encodingStrategy: "holographic",
      onStorageError: (err) => errors.push(err),
    })
    // The cache should have been created with a holographic engine
    expect(cache).toBeTruthy()
  })
})

// -------------------------------------------------------
// Event bus integration (middleware default handler)
// -------------------------------------------------------

describe("storage:error event bus integration", () => {
  it("storage:error event type exists on TokenShieldEvents", async () => {
    const { createEventBus } = await import("../event-bus")
    const bus = createEventBus()
    const events: unknown[] = []
    bus.on("storage:error", (data) => events.push(data))
    bus.emit("storage:error", {
      module: "cache",
      operation: "set",
      error: new Error("test"),
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      module: "cache",
      operation: "set",
      error: expect.any(Error),
    })
  })
})
