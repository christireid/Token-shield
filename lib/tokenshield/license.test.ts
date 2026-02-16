import { describe, it, expect, beforeEach } from "vitest"
import {
  activateLicense,
  getLicenseInfo,
  isModulePermitted,
  getModuleTier,
  getModulesForTier,
  resetLicense,
  generateTestKey,
} from "./license"

describe("License Gating", () => {
  beforeEach(() => {
    resetLicense()
  })

  describe("activateLicense", () => {
    it("activates a valid pro license key", () => {
      const key = generateTestKey("pro", "test-user")
      const info = activateLicense(key)
      expect(info.tier).toBe("pro")
      expect(info.holder).toBe("test-user")
      expect(info.valid).toBe(true)
    })

    it("activates a valid enterprise license key", () => {
      const key = generateTestKey("enterprise", "corp-user", 30)
      const info = activateLicense(key)
      expect(info.tier).toBe("enterprise")
      expect(info.holder).toBe("corp-user")
      expect(info.valid).toBe(true)
      expect(info.expiresAt).not.toBeNull()
    })

    it("rejects an expired license key", () => {
      // Generate a key that expired yesterday
      const payload = {
        tier: "pro",
        expiresAt: Date.now() - 86_400_000,
        holder: "expired-user",
      }
      const key = btoa(JSON.stringify(payload))
      const info = activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("falls back to community on invalid key", () => {
      const info = activateLicense("not-valid-base64-json!@#")
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("falls back to community on unknown tier", () => {
      const payload = { tier: "platinum", holder: "test" }
      const key = btoa(JSON.stringify(payload))
      const info = activateLicense(key)
      // Unknown tier should cause parse failure, falling to community
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(false)
    })

    it("defaults to community tier when tier not specified in key", () => {
      const payload = { holder: "minimal" }
      const key = btoa(JSON.stringify(payload))
      const info = activateLicense(key)
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(true)
    })
  })

  describe("getLicenseInfo", () => {
    it("returns community info by default", () => {
      const info = getLicenseInfo()
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(true)
    })

    it("returns a copy (not a reference)", () => {
      const info1 = getLicenseInfo()
      const info2 = getLicenseInfo()
      expect(info1).toEqual(info2)
      expect(info1).not.toBe(info2)
    })
  })

  describe("isModulePermitted", () => {
    it("permits community modules without license", () => {
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("cost-estimator")).toBe(true)
      expect(isModulePermitted("request-guard")).toBe(true)
    })

    it("permits all modules in dev mode (no license activated)", () => {
      // Dev mode is default when no license is activated
      expect(isModulePermitted("response-cache")).toBe(true) // pro
      expect(isModulePermitted("circuit-breaker")).toBe(true) // team
      expect(isModulePermitted("audit-log")).toBe(true) // enterprise
    })

    it("gates pro modules when community license is active", () => {
      const payload = { tier: "community", holder: "test" }
      activateLicense(btoa(JSON.stringify(payload)))
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(false)
    })

    it("permits pro modules with pro license", () => {
      activateLicense(generateTestKey("pro"))
      expect(isModulePermitted("response-cache")).toBe(true)
      expect(isModulePermitted("model-router")).toBe(true)
      expect(isModulePermitted("circuit-breaker")).toBe(false) // team
    })

    it("permits team modules with team license", () => {
      activateLicense(generateTestKey("team"))
      expect(isModulePermitted("response-cache")).toBe(true) // pro
      expect(isModulePermitted("circuit-breaker")).toBe(true) // team
      expect(isModulePermitted("audit-log")).toBe(false) // enterprise
    })

    it("permits all modules with enterprise license", () => {
      activateLicense(generateTestKey("enterprise"))
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(true)
      expect(isModulePermitted("circuit-breaker")).toBe(true)
      expect(isModulePermitted("audit-log")).toBe(true)
    })

    it("permits unknown modules by default", () => {
      activateLicense(generateTestKey("community"))
      expect(isModulePermitted("some-unknown-module")).toBe(true)
    })

    it("denies pro modules when license is invalid (expired)", () => {
      const payload = {
        tier: "pro",
        expiresAt: Date.now() - 86_400_000,
        holder: "expired",
      }
      activateLicense(btoa(JSON.stringify(payload)))
      expect(isModulePermitted("response-cache")).toBe(false)
      expect(isModulePermitted("token-counter")).toBe(true) // community always allowed
    })
  })

  describe("getModuleTier", () => {
    it("returns correct tier for known modules", () => {
      expect(getModuleTier("token-counter")).toBe("community")
      expect(getModuleTier("response-cache")).toBe("pro")
      expect(getModuleTier("circuit-breaker")).toBe("team")
      expect(getModuleTier("audit-log")).toBe("enterprise")
    })

    it("returns community for unknown modules", () => {
      expect(getModuleTier("unknown")).toBe("community")
    })
  })

  describe("getModulesForTier", () => {
    it("returns community modules for community tier", () => {
      const modules = getModulesForTier("community")
      expect(modules).toContain("token-counter")
      expect(modules).toContain("cost-estimator")
      expect(modules).not.toContain("response-cache")
    })

    it("returns community + pro modules for pro tier", () => {
      const modules = getModulesForTier("pro")
      expect(modules).toContain("token-counter")
      expect(modules).toContain("response-cache")
      expect(modules).not.toContain("circuit-breaker")
    })

    it("returns all modules for enterprise tier", () => {
      const modules = getModulesForTier("enterprise")
      expect(modules).toContain("token-counter")
      expect(modules).toContain("response-cache")
      expect(modules).toContain("circuit-breaker")
      expect(modules).toContain("audit-log")
    })
  })

  describe("resetLicense", () => {
    it("resets to community dev mode", () => {
      activateLicense(generateTestKey("enterprise"))
      resetLicense()
      const info = getLicenseInfo()
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(true)
      // Dev mode: all modules permitted again
      expect(isModulePermitted("audit-log")).toBe(true)
    })
  })

  describe("generateTestKey", () => {
    it("generates a decodable key", () => {
      const key = generateTestKey("team", "test-holder", 7)
      const decoded = JSON.parse(atob(key))
      expect(decoded.tier).toBe("team")
      expect(decoded.holder).toBe("test-holder")
      expect(decoded.expiresAt).toBeGreaterThan(Date.now())
    })

    it("uses default holder and expiry", () => {
      const key = generateTestKey("pro")
      const decoded = JSON.parse(atob(key))
      expect(decoded.holder).toBe("test")
      expect(decoded.expiresAt).toBeGreaterThan(Date.now())
    })
  })
})
