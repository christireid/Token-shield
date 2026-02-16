/**
 * TokenShield - License Gating
 *
 * Open-core license system for gating Pro/Team/Enterprise features.
 *
 * Free (MIT):
 *   - Token Counter, Cost Estimator, Request Guard, Cost Ledger (basic)
 *
 * Pro ($29/mo):
 *   - Response Cache (semantic), Model Router, Prefix Optimizer, Context Manager
 *
 * Team ($99/mo):
 *   - Circuit Breaker, User Budget Manager, Anomaly Detector, Data Export
 *
 * Enterprise (Custom):
 *   - Audit Logging, Custom Routing Rules, Priority Support
 *
 * License keys use HMAC-SHA256 signing for tamper resistance.
 * Keys are validated locally (no network call) but cannot be forged
 * without the signing secret.
 *
 * In dev mode or when no key is set, all features are unlocked
 * with a console warning.
 */

export type LicenseTier = "community" | "pro" | "team" | "enterprise"

export interface LicenseInfo {
  tier: LicenseTier
  expiresAt: number | null
  holder: string
  valid: boolean
}

// Module-to-tier mapping
const MODULE_TIERS: Record<string, LicenseTier> = {
  // Community (free)
  "token-counter": "community",
  "cost-estimator": "community",
  "request-guard": "community",
  "cost-ledger": "community",
  "event-bus": "community",
  "logger": "community",

  // Pro
  "response-cache": "pro",
  "model-router": "pro",
  "prefix-optimizer": "pro",
  "context-manager": "pro",
  "neuro-elastic": "pro",

  // Team
  "circuit-breaker": "team",
  "user-budget-manager": "team",
  "anomaly-detector": "team",
  "data-export": "team",
  "stream-tracker": "team",

  // Enterprise
  "audit-log": "enterprise",
  "custom-routing": "enterprise",
  "provider-adapter": "enterprise",
}

const TIER_RANK: Record<LicenseTier, number> = {
  community: 0,
  pro: 1,
  team: 2,
  enterprise: 3,
}

let _currentLicense: LicenseInfo = {
  tier: "community",
  expiresAt: null,
  holder: "",
  valid: true,
}

let _devMode = true
let _warningShown = false
/** Signing secret set via setLicenseSecret(). Null = accept unsigned (dev mode). */
let _signingSecret: string | null = null

// -------------------------------------------------------
// HMAC-SHA256 helpers
// -------------------------------------------------------

/** Algorithm prefix constants for cross-environment signature compatibility. */
const ALG_SHA256 = "sha256:"
const ALG_DJB2 = "djb2:"

/**
 * Compute HMAC-SHA256 hex digest via Web Crypto.
 * Always uses SHA-256 — requires Web Crypto API (Node 18+, all modern browsers).
 * Returns a prefixed string "sha256:..." for algorithm detection during verification.
 */
async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return ALG_SHA256 + hex
}

/**
 * Synchronous HMAC using djb2 — **deprecated**, use async `hmacSign()` instead.
 * Retained only for `generateTestKeySync()` backward compatibility.
 * @deprecated Prefer async `generateTestKey()` which uses HMAC-SHA256.
 */
function hmacSignSync(secret: string, message: string): string {
  return ALG_DJB2 + djb2Raw(secret, message)
}

/**
 * Verify a prefixed signature against a message.
 * Supports both "sha256:..." and "djb2:..." prefixes.
 * Tries both algorithms if no prefix is found (legacy keys).
 */
async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  if (signature.startsWith(ALG_SHA256)) {
    const expected = await hmacSign(secret, message)
    return signature === expected
  }
  if (signature.startsWith(ALG_DJB2)) {
    return signature === ALG_DJB2 + djb2Raw(secret, message)
  }
  // Legacy unprefixed signature — try both algorithms
  const djb2Match = signature === djb2Raw(secret, message)
  if (djb2Match) return true
  // Try SHA-256 (stripping prefix from our own output)
  const sha256Sig = await hmacSign(secret, message)
  return signature === sha256Sig.slice(ALG_SHA256.length)
}

/** Simple keyed hash using djb2 — NOT cryptographically secure. Used only for legacy compat and sync fallback. */
function djb2Raw(secret: string, message: string): string {
  const input = `${secret}:${message}`
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

// -------------------------------------------------------
// Key format: base64({ payload: {...}, signature: "hex" })
// -------------------------------------------------------

interface LicenseKeyPayload {
  tier: string
  expiresAt: number | null
  holder: string
}

interface SignedLicenseKey {
  payload: LicenseKeyPayload
  signature: string
}

// -------------------------------------------------------
// ECDSA P-256 helpers (asymmetric signing)
// -------------------------------------------------------

let _ecPublicKey: CryptoKey | null = null
let _ecPrivateKey: CryptoKey | null = null

function isSubtleAvailable(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto?.subtle?.importKey === "function"
  )
}

/**
 * Generate an ECDSA P-256 key pair for license signing.
 * The server keeps the private key; the client embeds the public key.
 * Returns JWK-formatted keys.
 */
export async function generateLicenseKeyPair(): Promise<{
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}> {
  if (!isSubtleAvailable()) throw new Error("Web Crypto API required for ECDSA key generation")
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )
  const [publicKey, privateKey] = await Promise.all([
    globalThis.crypto.subtle.exportKey("jwk", pair.publicKey),
    globalThis.crypto.subtle.exportKey("jwk", pair.privateKey),
  ])
  return { publicKey, privateKey }
}

/**
 * Set the ECDSA public key for asymmetric license verification.
 * Only the public key is needed on the client — the private key
 * stays on the TokenShield license server.
 */
export async function setLicensePublicKey(jwk: JsonWebKey): Promise<void> {
  if (!isSubtleAvailable()) return // silently no-op in non-crypto environments
  _ecPublicKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
}

/**
 * Set the ECDSA private key for signing license keys (server-side only).
 */
export async function setLicensePrivateKey(jwk: JsonWebKey): Promise<void> {
  if (!isSubtleAvailable()) throw new Error("Web Crypto API required for ECDSA private key")
  _ecPrivateKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
}

/** Sign payload with ECDSA P-256. Returns base64url signature. */
async function ecdsaSign(payload: string): Promise<string> {
  if (!_ecPrivateKey) throw new Error("ECDSA private key not set")
  const enc = new TextEncoder()
  const sig = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    _ecPrivateKey,
    enc.encode(payload),
  )
  // Convert to base64url
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

/** Verify ECDSA P-256 signature. */
async function ecdsaVerify(payload: string, signature: string): Promise<boolean> {
  if (!_ecPublicKey) return false
  try {
    const enc = new TextEncoder()
    // Restore base64url to base64
    const b64 = signature.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
    const binary = atob(b64 + pad)
    const sigBytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) sigBytes[i] = binary.charCodeAt(i)
    return await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      _ecPublicKey,
      sigBytes,
      enc.encode(payload),
    )
  } catch {
    return false
  }
}

/**
 * Convenience wrapper to configure ECDSA license keys in a single call.
 * Reduces the 2-3 step ECDSA setup to one function call.
 *
 * @param opts.publicKey  - JWK public key for verification (required)
 * @param opts.privateKey - JWK private key for signing (optional, server-side only)
 */
export async function configureLicenseKeys(opts: {
  publicKey: JsonWebKey
  privateKey?: JsonWebKey
}): Promise<void> {
  await setLicensePublicKey(opts.publicKey)
  if (opts.privateKey) {
    await setLicensePrivateKey(opts.privateKey)
  }
}

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Set the signing secret used to validate license keys (HMAC mode).
 * Must be called before activateLicense() for signature verification to work.
 * If not set, keys are still decoded but signature is not verified (dev mode).
 *
 * For stronger security, use setLicensePublicKey() with ECDSA instead.
 */
export function setLicenseSecret(secret: string): void {
  _signingSecret = secret
}

/**
 * Activate a license key. Decodes the key, verifies its HMAC-SHA256
 * signature against the configured signing secret, and sets the
 * current tier.
 *
 * If no signing secret is configured (dev mode), the key is decoded
 * but signature verification is skipped with a warning.
 *
 * @example
 * ```ts
 * import { setLicenseSecret, activateLicense } from '@tokenshield/ai-sdk'
 * setLicenseSecret(process.env.TOKENSHIELD_SECRET!)
 * const info = await activateLicense(licenseKey)
 * ```
 */
export async function activateLicense(key: string): Promise<LicenseInfo> {
  try {
    const decoded = atob(key)
    const parsed = JSON.parse(decoded)

    let payload: LicenseKeyPayload
    let signature: string | undefined

    // Support both signed keys ({ payload, signature }) and legacy unsigned keys ({ tier, ... })
    if (parsed.payload && typeof parsed.signature === "string") {
      const signed = parsed as SignedLicenseKey
      payload = signed.payload
      signature = signed.signature
    } else {
      // Legacy unsigned format
      payload = {
        tier: parsed.tier ?? "community",
        expiresAt: parsed.expiresAt ?? null,
        holder: parsed.holder ?? "",
      }
    }

    const tier = (payload.tier ?? "community") as LicenseTier
    if (!TIER_RANK.hasOwnProperty(tier)) {
      throw new Error(`Unknown tier: ${tier}`)
    }

    // Verify signature if a secret or public key is configured
    if (_signingSecret || _ecPublicKey) {
      if (!signature) {
        _currentLicense = {
          tier: "community",
          expiresAt: null,
          holder: payload.holder ?? "",
          valid: false,
        }
        return _currentLicense
      }

      let sigValid = false
      if (signature.startsWith("ecdsa:") && _ecPublicKey) {
        sigValid = await ecdsaVerify(JSON.stringify(payload), signature.slice(6))
      } else if (_signingSecret) {
        sigValid = await hmacVerify(_signingSecret, JSON.stringify(payload), signature)
      }

      if (!sigValid) {
        _currentLicense = {
          tier: "community",
          expiresAt: null,
          holder: payload.holder ?? "",
          valid: false,
        }
        return _currentLicense
      }
    }

    // Check expiry
    const expiresAt = payload.expiresAt ?? null
    if (expiresAt && Date.now() > expiresAt) {
      _currentLicense = {
        tier: "community",
        expiresAt,
        holder: payload.holder ?? "",
        valid: false,
      }
      return _currentLicense
    }

    _currentLicense = {
      tier,
      expiresAt,
      holder: payload.holder ?? "",
      valid: true,
    }
    _devMode = false
    return _currentLicense
  } catch {
    _currentLicense = {
      tier: "community",
      expiresAt: null,
      holder: "",
      valid: false,
    }
    return _currentLicense
  }
}

/**
 * Get the current license information.
 */
export function getLicenseInfo(): LicenseInfo {
  return { ..._currentLicense }
}

/**
 * Check if the current license permits a given module.
 * In dev mode (no license activated), all modules are permitted
 * but a warning is shown.
 */
export function isModulePermitted(moduleName: string): boolean {
  const requiredTier = MODULE_TIERS[moduleName]
  if (!requiredTier) return true // unknown modules are permitted

  if (_devMode) {
    if (!_warningShown && requiredTier !== "community") {
      _warningShown = true
      if (typeof console !== "undefined") {
        console.warn(
          `[TokenShield] Using ${requiredTier}-tier features without a license key. ` +
            `All features are unlocked for development. ` +
            `Visit https://tokenshield.dev/pricing to get a production license.`,
        )
      }
    }
    return true
  }

  if (!_currentLicense.valid) return TIER_RANK[requiredTier] === 0

  return TIER_RANK[_currentLicense.tier] >= TIER_RANK[requiredTier]
}

/**
 * Get the required tier for a module.
 */
export function getModuleTier(moduleName: string): LicenseTier {
  return MODULE_TIERS[moduleName] ?? "community"
}

/**
 * Get all modules available at a given tier.
 */
export function getModulesForTier(tier: LicenseTier): string[] {
  const rank = TIER_RANK[tier]
  return Object.entries(MODULE_TIERS)
    .filter(([, t]) => TIER_RANK[t] <= rank)
    .map(([name]) => name)
}

/**
 * Reset license to community tier (for testing).
 */
export function resetLicense(): void {
  _currentLicense = {
    tier: "community",
    expiresAt: null,
    holder: "",
    valid: true,
  }
  _devMode = true
  _warningShown = false
  _signingSecret = null
  _ecPublicKey = null
  _ecPrivateKey = null
}

/**
 * Generate a signed license key for a given tier.
 * Uses HMAC-SHA256 when a secret is provided, otherwise falls back
 * to a synchronous hash for test environments.
 *
 * @param tier - The license tier
 * @param holder - License holder identifier
 * @param expiresInDays - Days until expiry (default: 365)
 * @param secret - Signing secret. If omitted, uses the module-level secret or generates unsigned.
 */
export async function generateTestKey(
  tier: LicenseTier,
  holder: string = "test",
  expiresInDays: number = 365,
  secret?: string,
  opts?: { signing?: "ecdsa" | "hmac" | "auto" },
): Promise<string> {
  const payload: LicenseKeyPayload = {
    tier,
    expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    holder,
  }

  const signingMode = opts?.signing ?? "auto"

  // ECDSA signing: explicit or auto-detect
  if ((signingMode === "ecdsa" || signingMode === "auto") && _ecPrivateKey) {
    const rawSig = await ecdsaSign(JSON.stringify(payload))
    return btoa(JSON.stringify({ payload, signature: "ecdsa:" + rawSig }))
  }

  // HMAC signing: explicit or auto-detect
  if (signingMode === "ecdsa") {
    throw new Error("ECDSA signing requested but no private key is configured. Call setLicensePrivateKey() first.")
  }

  const signingKey = secret ?? _signingSecret
  if (signingKey) {
    const signature = await hmacSign(signingKey, JSON.stringify(payload))
    return btoa(JSON.stringify({ payload, signature }))
  }

  // Unsigned key (backward compatible with legacy format)
  return btoa(JSON.stringify(payload))
}

/**
 * Generate a signed key synchronously (for tests without async support).
 * Uses djb2-based HMAC which is NOT cryptographically secure.
 * @deprecated Prefer `generateTestKey()` (async) which uses HMAC-SHA256 or ECDSA.
 */
export function generateTestKeySync(
  tier: LicenseTier,
  holder: string = "test",
  expiresInDays: number = 365,
  secret?: string,
): string {
  const payload: LicenseKeyPayload = {
    tier,
    expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    holder,
  }

  const signingKey = secret ?? _signingSecret
  if (signingKey) {
    const signature = hmacSignSync(signingKey, JSON.stringify(payload))
    return btoa(JSON.stringify({ payload, signature }))
  }

  return btoa(JSON.stringify(payload))
}
