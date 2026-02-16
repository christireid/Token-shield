import { describe, it, expect, beforeEach } from "vitest"
import {
  activateLicense,
  getLicenseInfo,
  isModulePermitted,
  getModuleTier,
  getModulesForTier,
  resetLicense,
  generateTestKey,
  generateTestKeySync,
  setLicenseSecret,
  setLicensePublicKey,
  setLicensePrivateKey,
  generateLicenseKeyPair,
  configureLicenseKeys,
} from "../license"

describe("license", () => {
  beforeEach(() => {
    resetLicense()
  })

  describe("tier hierarchy", () => {
    it("community tier includes basic modules", () => {
      expect(getModuleTier("token-counter")).toBe("community")
      expect(getModuleTier("cost-estimator")).toBe("community")
      expect(getModuleTier("request-guard")).toBe("community")
      expect(getModuleTier("cost-ledger")).toBe("community")
    })

    it("community tier includes caching and routing modules", () => {
      expect(getModuleTier("response-cache")).toBe("community")
      expect(getModuleTier("model-router")).toBe("community")
      expect(getModuleTier("prefix-optimizer")).toBe("community")
      expect(getModuleTier("context-manager")).toBe("community")
    })

    it("team tier includes budget and monitoring modules", () => {
      expect(getModuleTier("circuit-breaker")).toBe("community")
      expect(getModuleTier("user-budget-manager")).toBe("team")
      expect(getModuleTier("anomaly-detector")).toBe("team")
    })

    it("enterprise tier includes audit and advanced modules", () => {
      expect(getModuleTier("audit-log")).toBe("enterprise")
      expect(getModuleTier("provider-adapter")).toBe("enterprise")
    })

    it("returns community for unknown modules", () => {
      expect(getModuleTier("nonexistent-module")).toBe("community")
    })
  })

  describe("getModulesForTier", () => {
    it("community tier returns only community modules", () => {
      const mods = getModulesForTier("community")
      expect(mods).toContain("token-counter")
      expect(mods).toContain("cost-estimator")
      expect(mods).toContain("response-cache")
      expect(mods).toContain("model-router")
      expect(mods).toContain("prefix-optimizer")
      expect(mods).toContain("context-manager")
      expect(mods).toContain("fuzzy-similarity")
      expect(mods).toContain("circuit-breaker")
      expect(mods).toContain("stream-tracker")
      expect(mods).not.toContain("user-budget-manager")
      expect(mods).not.toContain("audit-log")
    })

    it("pro tier includes community + pro modules", () => {
      const mods = getModulesForTier("pro")
      expect(mods).toContain("token-counter")
      expect(mods).toContain("response-cache")
      expect(mods).toContain("model-router")
      expect(mods).toContain("circuit-breaker")
      expect(mods).not.toContain("user-budget-manager")
      expect(mods).not.toContain("audit-log")
    })

    it("team tier includes community + pro + team modules", () => {
      const mods = getModulesForTier("team")
      expect(mods).toContain("token-counter")
      expect(mods).toContain("response-cache")
      expect(mods).toContain("circuit-breaker")
      expect(mods).toContain("user-budget-manager")
      expect(mods).not.toContain("audit-log")
    })

    it("enterprise tier includes all modules", () => {
      const mods = getModulesForTier("enterprise")
      expect(mods).toContain("token-counter")
      expect(mods).toContain("response-cache")
      expect(mods).toContain("circuit-breaker")
      expect(mods).toContain("audit-log")
      expect(mods).toContain("provider-adapter")
    })
  })

  describe("getLicenseInfo", () => {
    it("returns community tier by default", () => {
      const info = getLicenseInfo()
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(true)
      expect(info.holder).toBe("")
    })

    it("returns a copy (not a reference to internal state)", () => {
      const info1 = getLicenseInfo()
      const info2 = getLicenseInfo()
      expect(info1).not.toBe(info2)
      expect(info1).toEqual(info2)
    })
  })

  describe("isModulePermitted", () => {
    it("permits all modules in dev mode (no license activated)", () => {
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(true)
      expect(isModulePermitted("circuit-breaker")).toBe(true)
      expect(isModulePermitted("audit-log")).toBe(true)
    })

    it("permits unknown modules", () => {
      expect(isModulePermitted("totally-new-module")).toBe(true)
    })
  })

  describe("generateTestKeySync", () => {
    it("generates a valid base64 key", () => {
      const key = generateTestKeySync("pro", "test-user")
      expect(() => atob(key)).not.toThrow()
      const decoded = JSON.parse(atob(key))
      expect(decoded.tier || decoded.payload?.tier).toBe("pro")
    })

    it("generates unsigned key when no secret is set", () => {
      const key = generateTestKeySync("pro", "test-user")
      const decoded = JSON.parse(atob(key))
      // Without a secret, it generates legacy unsigned format
      expect(decoded.tier).toBe("pro")
      expect(decoded.holder).toBe("test-user")
      expect(decoded.expiresAt).toBeGreaterThan(Date.now())
    })

    it("generates signed key when secret is provided", () => {
      const key = generateTestKeySync("team", "holder", 365, "my-secret")
      const decoded = JSON.parse(atob(key))
      expect(decoded.payload).toBeDefined()
      expect(decoded.signature).toBeDefined()
      expect(decoded.payload.tier).toBe("team")
      expect(decoded.payload.holder).toBe("holder")
      expect(typeof decoded.signature).toBe("string")
      expect(decoded.signature.length).toBeGreaterThan(0)
      // Sync keygen always uses djb2 prefix
      expect(decoded.signature).toMatch(/^djb2:/)
    })

    it("async keygen signature has algorithm prefix", async () => {
      const key = await generateTestKey("pro", "holder", 365, "secret")
      const decoded = JSON.parse(atob(key))
      // Should have either sha256: or djb2: prefix
      expect(decoded.signature).toMatch(/^(sha256:|djb2:)/)
    })

    it("uses module-level secret when set", () => {
      setLicenseSecret("module-secret")
      const key = generateTestKeySync("pro", "holder")
      const decoded = JSON.parse(atob(key))
      expect(decoded.payload).toBeDefined()
      expect(decoded.signature).toBeDefined()
    })

    it("respects expiresInDays parameter", () => {
      const key = generateTestKeySync("pro", "test", 30)
      const decoded = JSON.parse(atob(key))
      const expiresAt = decoded.expiresAt ?? decoded.payload?.expiresAt
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      const expectedMin = Date.now() + thirtyDaysMs - 5000
      const expectedMax = Date.now() + thirtyDaysMs + 5000
      expect(expiresAt).toBeGreaterThan(expectedMin)
      expect(expiresAt).toBeLessThan(expectedMax)
    })
  })

  describe("generateTestKey (async)", () => {
    it("generates a valid base64 key", async () => {
      const key = await generateTestKey("enterprise", "async-test")
      expect(() => atob(key)).not.toThrow()
    })

    it("generates signed key when secret is provided", async () => {
      const key = await generateTestKey("pro", "holder", 365, "async-secret")
      const decoded = JSON.parse(atob(key))
      expect(decoded.payload).toBeDefined()
      expect(decoded.signature).toBeDefined()
      expect(decoded.payload.tier).toBe("pro")
    })

    it("generates unsigned key without secret", async () => {
      const key = await generateTestKey("community", "holder")
      const decoded = JSON.parse(atob(key))
      expect(decoded.tier).toBe("community")
    })
  })

  describe("activateLicense", () => {
    it("activates a valid unsigned key", async () => {
      const key = generateTestKeySync("pro", "test-holder")
      const info = await activateLicense(key)
      expect(info.tier).toBe("pro")
      expect(info.holder).toBe("test-holder")
      expect(info.valid).toBe(true)
    })

    it("activates enterprise tier", async () => {
      const key = generateTestKeySync("enterprise", "corp-holder")
      const info = await activateLicense(key)
      expect(info.tier).toBe("enterprise")
      expect(info.valid).toBe(true)
    })

    it("updates getLicenseInfo after activation", async () => {
      const key = generateTestKeySync("team", "team-holder")
      await activateLicense(key)
      const info = getLicenseInfo()
      expect(info.tier).toBe("team")
      expect(info.holder).toBe("team-holder")
    })

    it("rejects expired keys", async () => {
      const key = generateTestKeySync("pro", "test", -1) // expired yesterday
      const info = await activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("falls back to community on invalid base64", async () => {
      const info = await activateLicense("not-valid-base64!!!")
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(false)
    })

    it("falls back to community on invalid JSON", async () => {
      const info = await activateLicense(btoa("this is not json"))
      expect(info.tier).toBe("community")
      expect(info.valid).toBe(false)
    })

    describe("HMAC signature verification", () => {
      const SECRET = "test-signing-secret-123"

      it("accepts correctly signed key (async keygen)", async () => {
        setLicenseSecret(SECRET)
        // Use async generateTestKey to match the async HMAC in activateLicense
        const key = await generateTestKey("pro", "signed-holder", 365, SECRET)
        const info = await activateLicense(key)
        expect(info.tier).toBe("pro")
        expect(info.valid).toBe(true)
        expect(info.holder).toBe("signed-holder")
      })

      it("accepts sync-generated key with secret (cross-algorithm compat)", async () => {
        // generateTestKeySync uses djb2, activateLicense detects the "djb2:" prefix
        // and verifies using the same algorithm — ensuring cross-env compatibility.
        setLicenseSecret(SECRET)
        const key = generateTestKeySync("pro", "signed-holder", 365, SECRET)
        const info = await activateLicense(key)
        expect(info.tier).toBe("pro")
        expect(info.valid).toBe(true)
        expect(info.holder).toBe("signed-holder")
      })

      it("rejects unsigned key when secret is configured", async () => {
        setLicenseSecret(SECRET)
        // Generate unsigned key (no secret param)
        resetLicense()
        const unsignedKey = btoa(
          JSON.stringify({
            tier: "enterprise",
            expiresAt: Date.now() + 86400000,
            holder: "attacker",
          }),
        )
        setLicenseSecret(SECRET) // Re-set secret after reset
        const info = await activateLicense(unsignedKey)
        expect(info.valid).toBe(false)
        expect(info.tier).toBe("community")
      })

      it("rejects key signed with wrong secret", async () => {
        setLicenseSecret(SECRET)
        // Generate with different secret
        const key = generateTestKeySync("enterprise", "forger", 365, "wrong-secret")
        const info = await activateLicense(key)
        expect(info.valid).toBe(false)
        expect(info.tier).toBe("community")
      })

      it("rejects key with tampered payload", async () => {
        setLicenseSecret(SECRET)
        const key = generateTestKeySync("community", "legit", 365, SECRET)
        const decoded = JSON.parse(atob(key))
        // Tamper: change tier from community to enterprise
        decoded.payload.tier = "enterprise"
        const tampered = btoa(JSON.stringify(decoded))
        const info = await activateLicense(tampered)
        expect(info.valid).toBe(false)
        expect(info.tier).toBe("community")
      })
    })

    it("disables dev mode after activation", async () => {
      const key = generateTestKeySync("pro", "holder")
      await activateLicense(key)
      // After activation, isModulePermitted should check tier
      expect(isModulePermitted("response-cache")).toBe(true) // community module, pro tier = OK
      expect(isModulePermitted("user-budget-manager")).toBe(false) // team module, pro tier = blocked
    })
  })

  describe("resetLicense", () => {
    it("resets to community tier", async () => {
      const key = generateTestKeySync("enterprise", "holder")
      await activateLicense(key)
      expect(getLicenseInfo().tier).toBe("enterprise")
      resetLicense()
      expect(getLicenseInfo().tier).toBe("community")
      expect(getLicenseInfo().valid).toBe(true)
    })

    it("re-enables dev mode", async () => {
      const key = generateTestKeySync("pro", "holder")
      await activateLicense(key)
      expect(isModulePermitted("audit-log")).toBe(false) // pro can't use enterprise
      resetLicense()
      expect(isModulePermitted("audit-log")).toBe(true) // dev mode: all unlocked
    })

    it("clears signing secret", async () => {
      setLicenseSecret("my-secret")
      resetLicense()
      // After reset, unsigned keys should work again (no secret = no verification)
      const key = generateTestKeySync("pro")
      const info = await activateLicense(key)
      expect(info.tier).toBe("pro")
      expect(info.valid).toBe(true)
    })
  })

  describe("setLicenseSecret", () => {
    it("enables signature verification", async () => {
      setLicenseSecret("secret-123")
      // Unsigned key should be rejected
      const unsignedKey = btoa(
        JSON.stringify({
          tier: "pro",
          expiresAt: Date.now() + 86400000,
          holder: "test",
        }),
      )
      const info = await activateLicense(unsignedKey)
      expect(info.valid).toBe(false)
    })
  })

  describe("tier-based permission enforcement", () => {
    it("pro license allows pro modules but not team/enterprise", async () => {
      const key = generateTestKeySync("pro", "holder")
      await activateLicense(key)
      expect(isModulePermitted("token-counter")).toBe(true) // community
      expect(isModulePermitted("response-cache")).toBe(true) // community
      expect(isModulePermitted("circuit-breaker")).toBe(true) // community
      expect(isModulePermitted("user-budget-manager")).toBe(false) // team
      expect(isModulePermitted("audit-log")).toBe(false) // enterprise
    })

    it("team license allows team modules but not enterprise", async () => {
      const key = generateTestKeySync("team", "holder")
      await activateLicense(key)
      expect(isModulePermitted("response-cache")).toBe(true) // community
      expect(isModulePermitted("circuit-breaker")).toBe(true) // community
      expect(isModulePermitted("user-budget-manager")).toBe(true) // team
      expect(isModulePermitted("audit-log")).toBe(false) // enterprise
    })

    it("enterprise license allows all modules", async () => {
      const key = generateTestKeySync("enterprise", "holder")
      await activateLicense(key)
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(true)
      expect(isModulePermitted("circuit-breaker")).toBe(true)
      expect(isModulePermitted("audit-log")).toBe(true)
    })

    it("community license allows all core optimization modules", async () => {
      const key = generateTestKeySync("community", "holder")
      await activateLicense(key)
      expect(isModulePermitted("token-counter")).toBe(true) // community
      expect(isModulePermitted("response-cache")).toBe(true) // community
      expect(isModulePermitted("circuit-breaker")).toBe(true) // community
      expect(isModulePermitted("user-budget-manager")).toBe(false) // team
      expect(isModulePermitted("audit-log")).toBe(false) // enterprise
    })

    it("invalid license falls back to community with invalid flag", async () => {
      // A garbage key triggers the catch block, which sets valid=false but
      // doesn't disable dev mode (devMode remains true from reset).
      // To test non-dev-mode behavior with invalid license, first activate
      // a valid key (which sets devMode=false), then activate garbage.
      const validKey = generateTestKeySync("pro", "holder")
      await activateLicense(validKey) // devMode = false now
      await activateLicense("garbage-key")
      const info = getLicenseInfo()
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
      // With devMode=false and valid=false, only community modules allowed
      expect(isModulePermitted("token-counter")).toBe(true) // community
      expect(isModulePermitted("response-cache")).toBe(true) // community
      expect(isModulePermitted("user-budget-manager")).toBe(false) // team
    })
  })

  describe("ECDSA asymmetric signing", () => {
    it("generates a key pair", async () => {
      const pair = await generateLicenseKeyPair()
      expect(pair.publicKey).toBeDefined()
      expect(pair.privateKey).toBeDefined()
      expect(pair.publicKey.kty).toBe("EC")
      expect(pair.publicKey.crv).toBe("P-256")
    })

    it("signs and verifies a key with ECDSA", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePrivateKey(pair.privateKey)
      await setLicensePublicKey(pair.publicKey)

      const key = await generateTestKey("enterprise", "ECDSA Corp", 365)
      const decoded = JSON.parse(atob(key))
      expect(decoded.signature).toMatch(/^ecdsa:/)

      const info = await activateLicense(key)
      expect(info.tier).toBe("enterprise")
      expect(info.valid).toBe(true)
      expect(info.holder).toBe("ECDSA Corp")
    })

    it("rejects ECDSA key signed with different private key", async () => {
      // Generate two key pairs
      const pair1 = await generateLicenseKeyPair()
      const pair2 = await generateLicenseKeyPair()

      // Sign with pair1's private key
      await setLicensePrivateKey(pair1.privateKey)
      const key = await generateTestKey("enterprise", "Forger", 365)

      // Verify with pair2's public key — should fail
      resetLicense()
      await setLicensePublicKey(pair2.publicKey)
      const info = await activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("ECDSA takes priority over HMAC when both configured", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePrivateKey(pair.privateKey)
      await setLicensePublicKey(pair.publicKey)
      setLicenseSecret("hmac-secret")

      const key = await generateTestKey("pro", "Priority Test", 365)
      const decoded = JSON.parse(atob(key))
      // ECDSA should be preferred for signing
      expect(decoded.signature).toMatch(/^ecdsa:/)

      const info = await activateLicense(key)
      expect(info.tier).toBe("pro")
      expect(info.valid).toBe(true)
    })

    it("rejects ECDSA key with corrupted signature", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePrivateKey(pair.privateKey)
      await setLicensePublicKey(pair.publicKey)

      const key = await generateTestKey("enterprise", "holder", 365)
      const decoded = JSON.parse(atob(key))
      // Corrupt the signature by flipping characters
      decoded.signature = decoded.signature.slice(0, -4) + "XXXX"
      const corrupted = btoa(JSON.stringify(decoded))

      const info = await activateLicense(corrupted)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("rejects ECDSA key with empty signature after prefix", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePublicKey(pair.publicKey)

      const payload = { tier: "enterprise", expiresAt: Date.now() + 86400000, holder: "test" }
      const forged = btoa(JSON.stringify({ payload, signature: "ecdsa:" }))

      const info = await activateLicense(forged)
      expect(info.valid).toBe(false)
    })

    it("configureLicenseKeys convenience wrapper works", async () => {
      const pair = await generateLicenseKeyPair()
      await configureLicenseKeys({ publicKey: pair.publicKey, privateKey: pair.privateKey })

      const key = await generateTestKey("team", "convenience", 365)
      const info = await activateLicense(key)
      expect(info.tier).toBe("team")
      expect(info.valid).toBe(true)
    })

    it("configureLicenseKeys works with public key only", async () => {
      const pair = await generateLicenseKeyPair()
      await configureLicenseKeys({ publicKey: pair.publicKey })

      // Without private key, generateTestKey falls back to HMAC/unsigned
      // but setLicensePublicKey is set for verification
      const unsigned = btoa(
        JSON.stringify({ tier: "pro", expiresAt: Date.now() + 86400000, holder: "test" }),
      )
      const info = await activateLicense(unsigned)
      // Should fail because public key is set but key has no signature
      expect(info.valid).toBe(false)
    })
  })

  describe("generateTestKey signing option", () => {
    it("explicit ecdsa signing throws without private key", async () => {
      await expect(
        generateTestKey("pro", "test", 365, undefined, { signing: "ecdsa" }),
      ).rejects.toThrow("ECDSA signing requested")
    })

    it("explicit hmac signing uses HMAC even when ECDSA is available", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePrivateKey(pair.privateKey)
      setLicenseSecret("hmac-test")

      const key = await generateTestKey("pro", "test", 365, undefined, { signing: "hmac" })
      const decoded = JSON.parse(atob(key))
      expect(decoded.signature).toMatch(/^sha256:/)
    })
  })
})
