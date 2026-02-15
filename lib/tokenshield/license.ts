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

/**
 * Compute HMAC-SHA256 hex digest using Web Crypto API.
 * Falls back to a synchronous djb2-based HMAC for environments
 * without Web Crypto (e.g., older Node.js test runners).
 */
async function hmacSha256(secret: string, message: string): Promise<string> {
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis.crypto?.subtle?.importKey === "function"
  ) {
    const enc = new TextEncoder()
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message))
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
  // Fallback: keyed djb2 (not cryptographically strong, but better than nothing)
  return djb2Hmac(secret, message)
}

/** Synchronous HMAC for test environments without Web Crypto. */
function hmacSha256Sync(secret: string, message: string): string {
  return djb2Hmac(secret, message)
}

/** Simple keyed hash using djb2 — used as fallback only. */
function djb2Hmac(secret: string, message: string): string {
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

/**
 * Set the signing secret used to validate license keys.
 * Must be called before activateLicense() for signature verification to work.
 * If not set, keys are still decoded but signature is not verified (dev mode).
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

    // Verify signature if a secret is configured
    if (_signingSecret) {
      if (!signature) {
        _currentLicense = {
          tier: "community",
          expiresAt: null,
          holder: payload.holder ?? "",
          valid: false,
        }
        return _currentLicense
      }
      const expectedSig = await hmacSha256(_signingSecret, JSON.stringify(payload))
      if (signature !== expectedSig) {
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
): Promise<string> {
  const payload: LicenseKeyPayload = {
    tier,
    expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    holder,
  }

  const signingKey = secret ?? _signingSecret
  if (signingKey) {
    const signature = await hmacSha256(signingKey, JSON.stringify(payload))
    return btoa(JSON.stringify({ payload, signature }))
  }

  // Unsigned key (backward compatible with legacy format)
  return btoa(JSON.stringify(payload))
}

/**
 * Generate a signed key synchronously (for tests without async support).
 * Uses djb2-based HMAC as fallback.
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
    const signature = hmacSha256Sync(signingKey, JSON.stringify(payload))
    return btoa(JSON.stringify({ payload, signature }))
  }

  return btoa(JSON.stringify(payload))
}
