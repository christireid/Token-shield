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
 * License keys are validated locally (no network call). The key encodes
 * the tier and expiry. In dev mode or when no key is set, all features
 * are unlocked with a console warning.
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
  logger: "community",

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

/**
 * Activate a license key. In a real implementation, this would decode
 * and validate a signed JWT or similar token. For now it uses a simple
 * base64-encoded JSON payload for development purposes.
 *
 * Key format: base64({ tier, expiresAt, holder })
 *
 * @example
 * ```ts
 * import { activateLicense } from '@tokenshield/ai-sdk'
 * activateLicense('eyJ0aWVyIjoicHJvIiwiZXhw...') // Pro tier
 * ```
 */
export function activateLicense(key: string): LicenseInfo {
  try {
    const decoded = atob(key)
    const payload = JSON.parse(decoded) as {
      tier?: string
      expiresAt?: number
      holder?: string
    }

    const tier = (payload.tier ?? "community") as LicenseTier
    if (!(tier in TIER_RANK)) {
      throw new Error(`Unknown tier: ${tier}`)
    }

    // Any explicit license activation exits dev mode, even if the key is expired
    _devMode = false

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
        // eslint-disable-next-line no-console
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
}

/**
 * Generate a license key for a given tier (for testing and internal use only).
 * In production, keys would be generated server-side with cryptographic signing.
 */
export function generateTestKey(
  tier: LicenseTier,
  holder: string = "test",
  expiresInDays: number = 365,
): string {
  const payload = {
    tier,
    expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    holder,
  }
  return btoa(JSON.stringify(payload))
}
