import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Web Crypto API for Node environment
const mockKey = { type: "secret", algorithm: { name: "AES-GCM" } } as CryptoKey

const mockSubtle = {
  generateKey: vi.fn().mockResolvedValue(mockKey),
  importKey: vi.fn().mockResolvedValue(mockKey),
  deriveKey: vi.fn().mockResolvedValue(mockKey),
  deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
  encrypt: vi.fn().mockImplementation(async (_alg: unknown, _key: unknown, data: ArrayBuffer) => {
    // Simulate AES-GCM: prepend 12-byte IV to data
    const iv = new Uint8Array(12)
    const result = new Uint8Array(iv.length + new Uint8Array(data).length)
    result.set(iv)
    result.set(new Uint8Array(data), iv.length)
    return result.buffer
  }),
  decrypt: vi.fn().mockImplementation(async (_alg: unknown, _key: unknown, data: ArrayBuffer) => {
    // Simulate: strip 12-byte IV, return remaining data
    return new Uint8Array(data).slice(12).buffer
  }),
  exportKey: vi.fn().mockResolvedValue({ kty: "oct", k: "test-key" }),
}

// Set up globals before importing the module
Object.defineProperty(globalThis, "crypto", {
  value: {
    subtle: mockSubtle,
    getRandomValues: (arr: Uint8Array) => {
      arr.fill(42)
      return arr
    },
  },
  writable: true,
  configurable: true,
})

// Mock localStorage and sessionStorage for passphrase/session key derivation
const localStorageMap = new Map<string, string>()
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => localStorageMap.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageMap.set(key, value),
    removeItem: (key: string) => localStorageMap.delete(key),
  },
  writable: true,
  configurable: true,
})

const sessionStorageMap = new Map<string, string>()
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (key: string) => sessionStorageMap.get(key) ?? null,
    setItem: (key: string, value: string) => sessionStorageMap.set(key, value),
    removeItem: (key: string) => sessionStorageMap.delete(key),
  },
  writable: true,
  configurable: true,
})

// Mock IndexedDB with a simple in-memory store
const idbStore = new Map<string, unknown>()
vi.mock("idb-keyval", () => ({
  get: vi.fn((key: string) => Promise.resolve(idbStore.get(key))),
  set: vi.fn((key: string, value: unknown) => {
    idbStore.set(key, value)
    return Promise.resolve()
  }),
  del: vi.fn((key: string) => {
    idbStore.delete(key)
    return Promise.resolve()
  }),
  keys: vi.fn(() => Promise.resolve([...idbStore.keys()])),
  createStore: vi.fn(),
}))

import { EncryptedStore, createEncryptedStore } from "./crypto-store"

describe("EncryptedStore", () => {
  beforeEach(() => {
    idbStore.clear()
    localStorageMap.clear()
    sessionStorageMap.clear()
    vi.clearAllMocks()
  })

  it("constructs with BYO key mode", () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    expect(store).toBeInstanceOf(EncryptedStore)
  })

  it("constructs with passphrase mode", () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "passphrase", passphrase: "secret123" },
    })
    expect(store).toBeInstanceOf(EncryptedStore)
  })

  it("setItem and getItem roundtrip with BYO key", async () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("greeting", { hello: "world" })
    const result = await store.getItem<{ hello: string }>("greeting")
    expect(result).toEqual({ hello: "world" })
  })

  it("getItem returns undefined for missing key", async () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    const result = await store.getItem("nonexistent")
    expect(result).toBeUndefined()
  })

  it("deleteItem removes the entry", async () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("temp", "data")
    await store.deleteItem("temp")
    const result = await store.getItem("temp")
    expect(result).toBeUndefined()
  })

  it("getAllKeys returns stored keys", async () => {
    const store = new EncryptedStore({
      dbName: "test-db",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("a", 1)
    await store.setItem("b", 2)
    const keys = await store.getAllKeys()
    expect(keys).toContain("a")
    expect(keys).toContain("b")
  })

  it("createEncryptedStore returns null in non-browser environment", () => {
    // typeof window === "undefined" in Node — returns null
    const store = createEncryptedStore({
      dbName: "factory-db",
      storeName: "factory-test",
      encryption: { mode: "key", key: mockKey },
    })
    expect(store).toBeNull()
  })

  // -------------------------------------------------------
  // Unencrypted mode ("none")
  // -------------------------------------------------------

  it("setItem and getItem roundtrip with mode: none (unencrypted)", async () => {
    const store = new EncryptedStore({
      dbName: "test-db-none",
      storeName: "test",
      encryption: { mode: "none" },
    })
    await store.setItem("plain-key", { data: "no encryption" })
    const result = await store.getItem<{ data: string }>("plain-key")
    expect(result).toEqual({ data: "no encryption" })
  })

  it("getItem returns undefined for missing key in unencrypted mode", async () => {
    const store = new EncryptedStore({
      dbName: "test-db-none-miss",
      storeName: "test",
      encryption: { mode: "none" },
    })
    const result = await store.getItem("nonexistent")
    expect(result).toBeUndefined()
  })

  // -------------------------------------------------------
  // Session mode
  // -------------------------------------------------------

  it("constructs with session mode", () => {
    const store = new EncryptedStore({
      dbName: "test-db-session",
      storeName: "test",
      encryption: { mode: "session" },
    })
    expect(store).toBeInstanceOf(EncryptedStore)
  })

  it("setItem and getItem roundtrip with session mode", async () => {
    const store = new EncryptedStore({
      dbName: "test-db-session-rt",
      storeName: "test",
      encryption: { mode: "session" },
    })
    await store.setItem("session-data", { value: 42 })
    const result = await store.getItem<{ value: number }>("session-data")
    expect(result).toEqual({ value: 42 })
  })

  // -------------------------------------------------------
  // Passphrase mode - salt reuse
  // -------------------------------------------------------

  it("passphrase mode reuses existing salt from localStorage", async () => {
    localStorageMap.set("tokenshield-crypto-salt", "0102030405060708090a0b0c0d0e0f10")

    const store = new EncryptedStore({
      dbName: "test-db-salt",
      storeName: "test",
      encryption: { mode: "passphrase", passphrase: "reuse-salt" },
    })
    await store.setItem("salted", "data")
    const result = await store.getItem<string>("salted")
    expect(result).toBe("data")

    expect(localStorageMap.get("tokenshield-crypto-salt")).toBe("0102030405060708090a0b0c0d0e0f10")
  })

  // -------------------------------------------------------
  // Decryption failure returns undefined
  // -------------------------------------------------------

  it("getItem returns undefined when decryption fails", async () => {
    mockSubtle.decrypt.mockRejectedValueOnce(new Error("Decryption failed"))

    const store = new EncryptedStore({
      dbName: "test-db-decrypt-fail",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("corrupt", "data")
    const result = await store.getItem("corrupt")
    expect(result).toBeUndefined()
  })

  // -------------------------------------------------------
  // getAllKeys and deleteItem with encryption enabled
  // -------------------------------------------------------

  it("getAllKeys returns keys from encrypted store", async () => {
    const store = new EncryptedStore({
      dbName: "test-db-keys-enc",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("key-a", 1)
    await store.setItem("key-b", 2)
    const allKeys = await store.getAllKeys()
    expect(allKeys).toContain("key-a")
    expect(allKeys).toContain("key-b")
  })

  it("deleteItem removes encrypted entry", async () => {
    const store = new EncryptedStore({
      dbName: "test-db-del-enc",
      storeName: "test",
      encryption: { mode: "key", key: mockKey },
    })
    await store.setItem("to-remove", "secret")
    await store.deleteItem("to-remove")
    const result = await store.getItem("to-remove")
    expect(result).toBeUndefined()
  })
})
