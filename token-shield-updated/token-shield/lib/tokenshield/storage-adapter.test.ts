/**
 * Storage Adapter Tests
 *
 * Tests the in-memory fallback behavior of the storage adapter.
 * In the test environment, IndexedDB is unavailable, so all operations
 * use the MemoryStore fallback.
 */

import { describe, it, expect } from "vitest"
import { createStore, get, set, del, keys, isPersistent } from "./storage-adapter"

describe("StorageAdapter", () => {
  describe("createStore", () => {
    it("creates a store handle without throwing", () => {
      const store = createStore("test-db", "test-store")
      expect(store).toBeDefined()
    })

    it("returns the same store for the same db/store name", () => {
      const store1 = createStore("same-db", "same-store")
      const store2 = createStore("same-db", "same-store")
      expect(store1).toBe(store2)
    })

    it("returns different stores for different names", () => {
      const store1 = createStore("db-a", "store-a")
      const store2 = createStore("db-b", "store-b")
      expect(store1).not.toBe(store2)
    })
  })

  describe("get/set/del operations", () => {
    it("stores and retrieves a value", async () => {
      const store = createStore("test-crud", "values")
      await set("key1", "hello", store)
      const result = await get<string>("key1", store)
      expect(result).toBe("hello")
    })

    it("returns undefined for missing keys", async () => {
      const store = createStore("test-miss", "values")
      const result = await get<string>("nonexistent", store)
      expect(result).toBeUndefined()
    })

    it("stores complex objects", async () => {
      const store = createStore("test-complex", "values")
      const obj = { nested: { array: [1, 2, 3] }, flag: true }
      await set("complex", obj, store)
      const result = await get<typeof obj>("complex", store)
      expect(result).toEqual(obj)
    })

    it("overwrites existing values", async () => {
      const store = createStore("test-overwrite", "values")
      await set("key", "first", store)
      await set("key", "second", store)
      const result = await get<string>("key", store)
      expect(result).toBe("second")
    })

    it("deletes a value", async () => {
      const store = createStore("test-del", "values")
      await set("to-delete", "value", store)
      await del("to-delete", store)
      const result = await get<string>("to-delete", store)
      expect(result).toBeUndefined()
    })

    it("deleting a nonexistent key does not throw", async () => {
      const store = createStore("test-del-safe", "values")
      await expect(del("nonexistent", store)).resolves.toBeUndefined()
    })
  })

  describe("keys", () => {
    it("returns all keys in the store", async () => {
      const store = createStore("test-keys", "values")
      await set("a", 1, store)
      await set("b", 2, store)
      await set("c", 3, store)
      const allKeys = await keys(store)
      expect(allKeys).toContain("a")
      expect(allKeys).toContain("b")
      expect(allKeys).toContain("c")
      expect(allKeys).toHaveLength(3)
    })

    it("returns empty array for empty store", async () => {
      const store = createStore("test-keys-empty", "values")
      const allKeys = await keys(store)
      expect(allKeys).toEqual([])
    })
  })

  describe("isPersistent", () => {
    it("returns false in test environment (no IndexedDB)", () => {
      // In Node.js/vitest, IndexedDB is not available
      expect(isPersistent()).toBe(false)
    })
  })

  describe("operations without explicit store", () => {
    it("get/set/del work with default store when no store passed", async () => {
      await set("default-key", "default-value")
      const result = await get<string>("default-key")
      expect(result).toBe("default-value")
      await del("default-key")
      const after = await get<string>("default-key")
      expect(after).toBeUndefined()
    })

    it("keys works with default store", async () => {
      await set("dk1", 1)
      await set("dk2", 2)
      const allKeys = await keys()
      expect(allKeys).toContain("dk1")
      expect(allKeys).toContain("dk2")
    })
  })
})
