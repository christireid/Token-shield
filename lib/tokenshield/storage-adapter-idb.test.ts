/**
 * Storage Adapter Tests - IndexedDB-available branches
 *
 * This test file exercises the branches in storage-adapter.ts that are only
 * reached when IndexedDB is available. Since the source uses `require("idb-keyval")`
 * (a CJS runtime call), vi.mock cannot intercept it. Instead we patch Node's
 * require cache so that require("idb-keyval") resolves to our mock module.
 *
 * We also test:
 *   - isIndexedDBAvailable caching (_idbAvailable)
 *   - isIndexedDBAvailable error path (globalThis.indexedDB getter throws)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Helpers to patch require("idb-keyval") in Node's module system
// ---------------------------------------------------------------------------

const mockIdbGet = vi.fn()
const mockIdbSet = vi.fn()
const mockIdbDel = vi.fn()
const mockIdbKeys = vi.fn()
const mockIdbCreateStore = vi.fn()

const idbMockExports = {
  get: mockIdbGet,
  set: mockIdbSet,
  del: mockIdbDel,
  keys: mockIdbKeys,
  createStore: mockIdbCreateStore,
}

/**
 * Find the resolved filename for "idb-keyval" in Node's require cache,
 * then replace its exports with our mock. Returns the resolved path.
 */
function patchRequireCache(): string {
  // Resolve the real path that require("idb-keyval") would produce
  const resolvedPath = require.resolve("idb-keyval")

  // Ensure the module is loaded so it appears in the cache
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(resolvedPath)

  // Replace its exports
  const cachedModule = require.cache[resolvedPath]
  if (cachedModule) {
    cachedModule.exports = idbMockExports
  }
  return resolvedPath
}

function restoreRequireCache(resolvedPath: string) {
  // Remove from cache so next require loads the real module
  delete require.cache[resolvedPath]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StorageAdapter with IndexedDB available (require cache patched)", () => {
  const savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")
  let idbResolvedPath: string

  beforeEach(() => {
    mockIdbGet.mockReset()
    mockIdbSet.mockReset()
    mockIdbDel.mockReset()
    mockIdbKeys.mockReset()
    mockIdbCreateStore.mockReset()

    // Reset vitest module registry so we get a fresh storage-adapter
    vi.resetModules()

    // Simulate IndexedDB being available
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      writable: true,
      configurable: true,
    })

    // Patch require cache for idb-keyval
    idbResolvedPath = patchRequireCache()
  })

  afterEach(() => {
    // Restore idb-keyval require cache
    restoreRequireCache(idbResolvedPath)

    // Restore globalThis.indexedDB
    if (savedDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", savedDescriptor)
    } else {
      delete (globalThis as Record<string, unknown>).indexedDB
    }
  })

  it("createStore delegates to idb-keyval.createStore when IndexedDB is available", async () => {
    const sentinelStore = { __idbStore: true }
    mockIdbCreateStore.mockReturnValue(sentinelStore)

    const mod = await import("./storage-adapter")
    const store = mod.createStore("my-db", "my-store")

    expect(mockIdbCreateStore).toHaveBeenCalledWith("my-db", "my-store")
    expect(store).toBe(sentinelStore)
  })

  it("isPersistent returns true when IndexedDB is available", async () => {
    const mod = await import("./storage-adapter")
    expect(mod.isPersistent()).toBe(true)
  })

  // --- get() ---

  it("get() delegates to idb-keyval.get with a store handle", async () => {
    mockIdbGet.mockResolvedValue("idb-value")
    const mod = await import("./storage-adapter")
    const fakeStore = { __idbStore: true }
    const result = await mod.get("k", fakeStore)
    expect(mockIdbGet).toHaveBeenCalledWith("k", fakeStore)
    expect(result).toBe("idb-value")
  })

  it("get() delegates to idb-keyval.get without a store handle", async () => {
    mockIdbGet.mockResolvedValue("idb-default")
    const mod = await import("./storage-adapter")
    const result = await mod.get("k")
    expect(mockIdbGet).toHaveBeenCalledWith("k")
    expect(result).toBe("idb-default")
  })

  // --- set() ---

  it("set() delegates to idb-keyval.set with a store handle", async () => {
    mockIdbSet.mockResolvedValue(undefined)
    const mod = await import("./storage-adapter")
    const fakeStore = { __idbStore: true }
    await mod.set("k", "v", fakeStore)
    expect(mockIdbSet).toHaveBeenCalledWith("k", "v", fakeStore)
  })

  it("set() delegates to idb-keyval.set without a store handle", async () => {
    mockIdbSet.mockResolvedValue(undefined)
    const mod = await import("./storage-adapter")
    await mod.set("k", "v")
    expect(mockIdbSet).toHaveBeenCalledWith("k", "v")
  })

  // --- del() ---

  it("del() delegates to idb-keyval.del with a store handle", async () => {
    mockIdbDel.mockResolvedValue(undefined)
    const mod = await import("./storage-adapter")
    const fakeStore = { __idbStore: true }
    await mod.del("k", fakeStore)
    expect(mockIdbDel).toHaveBeenCalledWith("k", fakeStore)
  })

  it("del() delegates to idb-keyval.del without a store handle", async () => {
    mockIdbDel.mockResolvedValue(undefined)
    const mod = await import("./storage-adapter")
    await mod.del("k")
    expect(mockIdbDel).toHaveBeenCalledWith("k")
  })

  // --- keys() ---

  it("keys() delegates to idb-keyval.keys with a store handle", async () => {
    mockIdbKeys.mockResolvedValue(["a", "b"])
    const mod = await import("./storage-adapter")
    const fakeStore = { __idbStore: true }
    const result = await mod.keys(fakeStore)
    expect(mockIdbKeys).toHaveBeenCalledWith(fakeStore)
    expect(result).toEqual(["a", "b"])
  })

  it("keys() delegates to idb-keyval.keys without a store handle", async () => {
    mockIdbKeys.mockResolvedValue(["x"])
    const mod = await import("./storage-adapter")
    const result = await mod.keys()
    expect(mockIdbKeys).toHaveBeenCalledWith()
    expect(result).toEqual(["x"])
  })
})

// ---------------------------------------------------------------------------
// Test the isIndexedDBAvailable caching behavior
// ---------------------------------------------------------------------------

describe("isIndexedDBAvailable caching (_idbAvailable)", () => {
  const savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")
  let idbResolvedPath: string

  afterEach(() => {
    if (idbResolvedPath) {
      delete require.cache[idbResolvedPath]
    }
    if (savedDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", savedDescriptor)
    } else {
      delete (globalThis as Record<string, unknown>).indexedDB
    }
  })

  it("caches the result so subsequent calls do not re-probe globalThis", async () => {
    vi.resetModules()
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      writable: true,
      configurable: true,
    })
    // Patch require cache so require("idb-keyval") returns a mock
    idbResolvedPath = require.resolve("idb-keyval")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(idbResolvedPath)
    const cachedModule = require.cache[idbResolvedPath]
    if (cachedModule) {
      cachedModule.exports = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        keys: vi.fn(),
        createStore: vi.fn(() => ({ __mock: true })),
      }
    }

    const mod = await import("./storage-adapter")

    // First call: probes globalThis.indexedDB and caches true
    expect(mod.isPersistent()).toBe(true)

    // Now remove indexedDB from globalThis
    delete (globalThis as Record<string, unknown>).indexedDB

    // Second call: should still return true (cached)
    expect(mod.isPersistent()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test the try/catch branch in isIndexedDBAvailable
// ---------------------------------------------------------------------------

describe("isIndexedDBAvailable error handling", () => {
  const savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB")

  afterEach(() => {
    if (savedDescriptor) {
      Object.defineProperty(globalThis, "indexedDB", savedDescriptor)
    } else {
      delete (globalThis as Record<string, unknown>).indexedDB
    }
  })

  it("returns false and falls back to MemoryStore when globalThis.indexedDB throws", async () => {
    vi.resetModules()

    // Make accessing globalThis.indexedDB throw an error
    Object.defineProperty(globalThis, "indexedDB", {
      get() {
        throw new Error("SecurityError: access denied")
      },
      configurable: true,
    })

    const mod = await import("./storage-adapter")

    // isIndexedDBAvailable should catch the error and return false
    expect(mod.isPersistent()).toBe(false)

    // Operations should still work via MemoryStore fallback
    await mod.set("err-key", "err-value")
    const result = await mod.get<string>("err-key")
    expect(result).toBe("err-value")
  })
})
