/**
 * TokenShield - Storage Adapter
 *
 * Thin abstraction over idb-keyval that falls back to an in-memory Map
 * when IndexedDB is unavailable (e.g. Vercel Edge Runtime, Cloudflare Workers,
 * Node.js without polyfills, or restrictive browser contexts).
 *
 * All modules that persist data should import from this module instead of
 * directly from "idb-keyval" to guarantee Edge Runtime compatibility.
 */

/**
 * Pluggable storage backend interface.
 * Implement this to use a custom client-side storage solution instead of
 * the default IndexedDB/in-memory fallback.
 *
 * Useful for: React Native (AsyncStorage), custom sync-to-server persistence,
 * or alternative browser storage mechanisms.
 *
 * @example localStorage adapter
 * ```ts
 * const storage: StorageBackend = {
 *   get: async (key) => {
 *     const val = localStorage.getItem(key)
 *     return val ? JSON.parse(val) : undefined
 *   },
 *   set: async (key, val) => localStorage.setItem(key, JSON.stringify(val)),
 *   del: async (key) => localStorage.removeItem(key),
 *   clear: async () => localStorage.clear(),
 * }
 * ```
 */
export interface StorageBackend {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  clear(): Promise<void>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreHandle = any

let _idbAvailable: boolean | null = null

function isIndexedDBAvailable(): boolean {
  if (_idbAvailable !== null) return _idbAvailable
  try {
    // Edge Runtime and Workers lack indexedDB on globalThis
    _idbAvailable =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as Record<string, unknown>).indexedDB !== "undefined" &&
      (globalThis as Record<string, unknown>).indexedDB !== null
  } catch {
    _idbAvailable = false
  }
  return _idbAvailable
}

// -------------------------------------------------------
// In-memory fallback store (Map-based)
// -------------------------------------------------------

class MemoryStore {
  private data = new Map<string, unknown>()

  get(key: string): unknown | undefined {
    return this.data.get(key)
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  del(key: string): void {
    this.data.delete(key)
  }

  keys(): string[] {
    return Array.from(this.data.keys())
  }
}

// Singleton fallback stores keyed by "dbName:storeName"
const memoryStores = new Map<string, MemoryStore>()
/** Track whether we've already warned about in-memory fallback (once per session) */
let _memoryFallbackWarned = false

function getMemoryStore(dbName: string, storeName: string): MemoryStore {
  const key = `${dbName}:${storeName}`
  let store = memoryStores.get(key)
  if (!store) {
    store = new MemoryStore()
    memoryStores.set(key, store)
    // Warn once so operators know data won't survive page reloads
    if (!_memoryFallbackWarned) {
      _memoryFallbackWarned = true
      // eslint-disable-next-line no-console
      console.warn(
        `[TokenShield] IndexedDB unavailable — using in-memory storage. Cache, ledger, and budget data will not persist across page reloads. Use the \`storage\` option to provide a custom StorageBackend.`,
      )
    }
  }
  return store
}

// -------------------------------------------------------
// Public API (mirrors idb-keyval)
// -------------------------------------------------------

/**
 * Create a store handle. Uses idb-keyval's createStore when IndexedDB is available,
 * otherwise returns an in-memory fallback.
 */
export function createStore(dbName: string, storeName: string): StoreHandle {
  if (isIndexedDBAvailable()) {
    // Lazy-import idb-keyval only when IndexedDB exists
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idb = require("idb-keyval")
    return idb.createStore(dbName, storeName)
  }
  return getMemoryStore(dbName, storeName)
}

export async function get<T>(key: string, store?: StoreHandle): Promise<T | undefined> {
  if (store && typeof store.getItem === "function") {
    return store.getItem(key) as Promise<T | undefined>
  }
  if (store instanceof MemoryStore) {
    return store.get(key) as T | undefined
  }
  if (isIndexedDBAvailable()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idb = require("idb-keyval")
    return store ? idb.get(key, store) : idb.get(key)
  }
  // Fallback: no store passed and no IndexedDB
  return getMemoryStore("default", "default").get(key) as T | undefined
}

export async function set(key: string, value: unknown, store?: StoreHandle): Promise<void> {
  if (store && typeof store.setItem === "function") {
    await store.setItem(key, value)
    return
  }
  if (store instanceof MemoryStore) {
    store.set(key, value)
    return
  }
  if (isIndexedDBAvailable()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idb = require("idb-keyval")
    return store ? idb.set(key, value, store) : idb.set(key, value)
  }
  getMemoryStore("default", "default").set(key, value)
}

export async function del(key: string, store?: StoreHandle): Promise<void> {
  if (store && typeof store.delItem === "function") {
    await store.delItem(key)
    return
  }
  if (store instanceof MemoryStore) {
    store.del(key)
    return
  }
  if (isIndexedDBAvailable()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idb = require("idb-keyval")
    return store ? idb.del(key, store) : idb.del(key)
  }
  getMemoryStore("default", "default").del(key)
}

export async function keys(store?: StoreHandle): Promise<string[]> {
  if (store instanceof MemoryStore) {
    return store.keys()
  }
  if (isIndexedDBAvailable()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const idb = require("idb-keyval")
    return store ? idb.keys(store) : idb.keys()
  }
  return getMemoryStore("default", "default").keys()
}

/** Re-export UseStore type for compatibility */
export type UseStore = StoreHandle

/**
 * Returns true if IndexedDB persistence is available.
 * Useful for UI hints ("data will not survive page reload").
 */
export function isPersistent(): boolean {
  return isIndexedDBAvailable()
}
