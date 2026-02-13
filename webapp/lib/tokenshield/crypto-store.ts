/**
 * TokenShield - Encrypted Storage Layer
 *
 * Wraps idb-keyval with AES-GCM encryption using the Web Crypto API.
 * Zero external dependencies — uses SubtleCrypto (built into all modern browsers).
 *
 * When encryption is enabled, all data stored in IndexedDB is encrypted
 * at rest, making it unreadable in DevTools. This matters for enterprise
 * customers who store cost data, user IDs, and budget records.
 *
 * Key management options:
 * 1. Passphrase → PBKDF2 key derivation (user-provided, survives sessions)
 * 2. Auto-generated key stored in sessionStorage (per-tab, auto-expires)
 * 3. Bring your own CryptoKey (for advanced integrations)
 */

import { get, set, del, keys, createStore, type UseStore } from "./storage-adapter"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface EncryptedStoreConfig {
  /** IndexedDB database name */
  dbName: string
  /** IndexedDB store name */
  storeName: string
  /** Encryption mode */
  encryption:
    | { mode: "passphrase"; passphrase: string }
    | { mode: "session" }
    | { mode: "key"; key: CryptoKey }
    | { mode: "none" }
}

// -------------------------------------------------------
// Crypto Helpers
// -------------------------------------------------------

const SALT_KEY = "tokenshield-crypto-salt"
const SESSION_KEY_NAME = "tokenshield-session-key"
const ALGORITHM = "AES-GCM"
const IV_LENGTH = 12

/**
 * Derive a CryptoKey from a passphrase using PBKDF2.
 * Uses a stable salt persisted in localStorage so the same
 * passphrase always produces the same key (required to decrypt).
 */
async function deriveKeyFromPassphrase(passphrase: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()

  // Retrieve or generate a stable salt
  let saltHex = localStorage.getItem(SALT_KEY)
  if (!saltHex) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("")
    localStorage.setItem(SALT_KEY, saltHex)
  }
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))

  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

/**
 * Get or create a session-scoped CryptoKey stored in sessionStorage.
 * The key is generated once per tab and is lost when the tab closes.
 */
async function getSessionKey(): Promise<CryptoKey> {
  const stored = sessionStorage.getItem(SESSION_KEY_NAME)
  if (stored) {
    const jwk = JSON.parse(stored)
    return crypto.subtle.importKey("jwk", jwk, { name: ALGORITHM }, true, ["encrypt", "decrypt"])
  }

  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: 256 }, true, ["encrypt", "decrypt"])
  const jwk = await crypto.subtle.exportKey("jwk", key)
  sessionStorage.setItem(SESSION_KEY_NAME, JSON.stringify(jwk))
  return key
}

/**
 * Encrypt a string using AES-GCM.
 * Returns a Uint8Array with the IV prepended to the ciphertext.
 */
async function encrypt(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  )
  // Prepend IV to ciphertext for storage
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(ciphertext), IV_LENGTH)
  return result
}

/**
 * Decrypt a Uint8Array (IV + ciphertext) using AES-GCM.
 */
async function decrypt(data: Uint8Array, key: CryptoKey): Promise<string> {
  const iv = data.slice(0, IV_LENGTH)
  const ciphertext = data.slice(IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(plaintext)
}

// -------------------------------------------------------
// Encrypted Store
// -------------------------------------------------------

export class EncryptedStore {
  private idbStore: UseStore
  private cryptoKey: CryptoKey | null = null
  private keyPromise: Promise<CryptoKey> | null = null
  private encryptionEnabled: boolean

  constructor(private config: EncryptedStoreConfig) {
    this.idbStore = createStore(config.dbName, config.storeName)
    this.encryptionEnabled = config.encryption.mode !== "none"

    if (config.encryption.mode === "key") {
      this.cryptoKey = config.encryption.key
    } else if (config.encryption.mode === "passphrase") {
      this.keyPromise = deriveKeyFromPassphrase(config.encryption.passphrase)
      this.keyPromise.then((k) => { this.cryptoKey = k }).catch(() => {})
    } else if (config.encryption.mode === "session") {
      this.keyPromise = getSessionKey()
      this.keyPromise.then((k) => { this.cryptoKey = k }).catch(() => {})
    }
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.cryptoKey) return this.cryptoKey
    if (this.keyPromise) {
      this.cryptoKey = await this.keyPromise
      return this.cryptoKey
    }
    throw new Error("EncryptedStore: no encryption key available")
  }

  /**
   * Store a value. Encrypts automatically if encryption is enabled.
   */
  async setItem<T>(key: string, value: T): Promise<void> {
    if (!this.encryptionEnabled) {
      await set(key, value, this.idbStore)
      return
    }
    const cryptoKey = await this.getKey()
    const json = JSON.stringify(value)
    const encrypted = await encrypt(json, cryptoKey)
    await set(key, encrypted, this.idbStore)
  }

  /**
   * Retrieve a value. Decrypts automatically if encryption is enabled.
   */
  async getItem<T>(key: string): Promise<T | undefined> {
    if (!this.encryptionEnabled) {
      return get<T>(key, this.idbStore)
    }
    const cryptoKey = await this.getKey()
    const encrypted = await get<Uint8Array>(key, this.idbStore)
    if (!encrypted) return undefined
    try {
      const json = await decrypt(encrypted, cryptoKey)
      return JSON.parse(json) as T
    } catch {
      // Decryption failed (wrong key, corrupted data) — return undefined
      return undefined
    }
  }

  /**
   * Delete a value.
   */
  async deleteItem(key: string): Promise<void> {
    await del(key, this.idbStore)
  }

  /**
   * Get all keys in the store.
   */
  async getAllKeys(): Promise<string[]> {
    return (await keys(this.idbStore)) as string[]
  }
}

/**
 * Create an encrypted store with the specified configuration.
 * Falls back to unencrypted storage in SSR or when crypto is unavailable.
 */
export function createEncryptedStore(config: EncryptedStoreConfig): EncryptedStore | null {
  if (typeof window === "undefined") return null
  try {
    return new EncryptedStore(config)
  } catch {
    return null
  }
}
