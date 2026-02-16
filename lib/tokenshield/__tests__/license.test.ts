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

    it("pro tier includes caching and routing modules", () => {
      expect(getModuleTier("response-cache")).toBe("pro")
      expect(getModuleTier("model-router")).toBe("pro")
      expect(getModuleTier("prefix-optimizer")).toBe("pro")
      expect(getModuleTier("context-manager")).toBe("pro")
    })

    it("team tier includes budget and monitoring modules", () => {
      expect(getModuleTier("circuit-breaker")).toBe("team")
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
      expect(mods).not.toContain("response-cache")
      expect(mods).not.toContain("circuit-breaker")
      expect(mods).not.toContain("audit-log")
    })

    it("pro tier includes community + pro modules", () => {
      const mods = getModulesForTier("pro")
      expect(mods).toContain("token-counter")
      expect(mods).toContain("response-cache")
      expect(mods).toContain("model-router")
      expect(mods).not.toContain("circuit-breaker")
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
      expect(isModulePermitted("response-cache")).toBe(true) // pro module, pro tier = OK
      expect(isModulePermitted("circuit-breaker")).toBe(false) // team module, pro tier = blocked
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
      expect(isModulePermitted("response-cache")).toBe(true) // pro
      expect(isModulePermitted("circuit-breaker")).toBe(false) // team
      expect(isModulePermitted("audit-log")).toBe(false) // enterprise
    })

    it("team license allows team modules but not enterprise", async () => {
      const key = generateTestKeySync("team", "holder")
      await activateLicense(key)
      expect(isModulePermitted("response-cache")).toBe(true) // pro
      expect(isModulePermitted("circuit-breaker")).toBe(true) // team
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

    it("community license only allows community modules", async () => {
      const key = generateTestKeySync("community", "holder")
      await activateLicense(key)
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(false)
      expect(isModulePermitted("circuit-breaker")).toBe(false)
      expect(isModulePermitted("audit-log")).toBe(false)
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
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("response-cache")).toBe(false)
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

  describe("hmacVerify legacy unprefixed signature path", () => {
    const SECRET = "legacy-secret"

    it("accepts a legacy key with unprefixed djb2 signature", async () => {
      // Manually craft a key whose signature is raw djb2 (no "djb2:" prefix)
      // to exercise the legacy unprefixed fallback in hmacVerify (lines 136-137)
      setLicenseSecret(SECRET)

      const payload = {
        tier: "pro",
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        holder: "legacy-holder",
      }
      // Compute raw djb2 hash (replicating djb2Raw logic)
      const message = JSON.stringify(payload)
      const input = `${SECRET}:${message}`
      let hash = 5381
      for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
      }
      const rawDjb2 = (hash >>> 0).toString(16).padStart(8, "0")

      // Create key with unprefixed signature (no "djb2:" or "sha256:" prefix)
      const legacyKey = btoa(JSON.stringify({ payload, signature: rawDjb2 }))

      const info = await activateLicense(legacyKey)
      expect(info.tier).toBe("pro")
      expect(info.valid).toBe(true)
      expect(info.holder).toBe("legacy-holder")
    })

    it("rejects a legacy unprefixed signature that matches neither algorithm (line 140)", async () => {
      // Exercise the SHA-256 fallback branch on line 139-140 that returns false
      setLicenseSecret(SECRET)

      const payload = {
        tier: "pro",
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        holder: "bad-legacy",
      }
      // Use an unprefixed signature that doesn't match djb2 or sha256
      const bogusKey = btoa(JSON.stringify({ payload, signature: "deadbeef" }))

      const info = await activateLicense(bogusKey)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })
  })

  describe("ecdsaVerify catch block", () => {
    it("returns false when signature contains invalid base64 (line 266-267)", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePublicKey(pair.publicKey)

      const payload = {
        tier: "enterprise",
        expiresAt: Date.now() + 86400000,
        holder: "catch-test",
      }
      // "ecdsa:" prefix followed by characters that will cause atob to throw
      // Using characters not valid in base64 (even with base64url decoding)
      const badSigKey = btoa(
        JSON.stringify({ payload, signature: "ecdsa:!!!invalid-not-base64\x00\x01\x02!!!" }),
      )

      const info = await activateLicense(badSigKey)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })
  })

  describe("activateLicense with unknown tier", () => {
    it("rejects a key with an unrecognized tier value (line 342)", async () => {
      // Craft a key with a tier that is not in TIER_RANK
      const payload = {
        tier: "platinum",
        expiresAt: Date.now() + 86400000,
        holder: "unknown-tier-holder",
      }
      const key = btoa(JSON.stringify(payload))

      const info = await activateLicense(key)
      // The unknown tier triggers throw -> catch -> valid: false
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("rejects a signed key with an unrecognized tier value", async () => {
      const SECRET = "tier-test-secret"
      setLicenseSecret(SECRET)

      const payload = {
        tier: "diamond",
        expiresAt: Date.now() + 86400000,
        holder: "bad-tier",
      }
      const key = btoa(JSON.stringify({ payload, signature: "sha256:fakesig" }))

      const info = await activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })
  })

  describe("generateTestKeySync production guard", () => {
    it("throws in production environment (line 540-541)", () => {
      const originalEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = "production"
        expect(() => generateTestKeySync("pro", "test")).toThrow(
          "generateTestKeySync() is disabled in production",
        )
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })
  })

  describe("generateTestKeySync unsigned path without any secret", () => {
    it("generates unsigned key when no secret param and no _signingSecret (line 558)", () => {
      // resetLicense() already clears _signingSecret, so no secret is configured
      const key = generateTestKeySync("enterprise", "unsigned-holder", 30)
      const decoded = JSON.parse(atob(key))
      // Should be legacy unsigned format (no payload/signature wrapper)
      expect(decoded.tier).toBe("enterprise")
      expect(decoded.holder).toBe("unsigned-holder")
      expect(decoded.expiresAt).toBeDefined()
      expect(decoded.payload).toBeUndefined()
      expect(decoded.signature).toBeUndefined()
    })
  })

  describe("isModulePermitted with invalid license (valid=false, devMode=false)", () => {
    it("permits only community modules when license is invalid (line 437)", async () => {
      // First activate a valid key to disable dev mode
      const validKey = generateTestKeySync("enterprise", "holder")
      await activateLicense(validKey)

      // Now activate a key that will set valid=false
      // Use an expired signed key to get valid=false with devMode already false
      setLicenseSecret("perm-secret")
      const expiredPayload = {
        tier: "enterprise",
        expiresAt: Date.now() - 86400000, // expired
        holder: "expired-holder",
      }
      const expiredKey = btoa(JSON.stringify(expiredPayload))
      // This unsigned key with a secret set will produce valid=false (no signature)
      await activateLicense(expiredKey)

      const info = getLicenseInfo()
      expect(info.valid).toBe(false)

      // Community module should be permitted (TIER_RANK["community"] === 0)
      expect(isModulePermitted("token-counter")).toBe(true)
      expect(isModulePermitted("cost-estimator")).toBe(true)
      expect(isModulePermitted("event-bus")).toBe(true)

      // Non-community modules should be rejected
      expect(isModulePermitted("response-cache")).toBe(false)
      expect(isModulePermitted("circuit-breaker")).toBe(false)
      expect(isModulePermitted("audit-log")).toBe(false)

      // Unknown modules should still be permitted
      expect(isModulePermitted("unknown-module")).toBe(true)
    })
  })

  describe("activateLicense with missing holder field", () => {
    it("defaults holder to empty string on successful activation (line 390)", async () => {
      // Craft a key with no holder field to trigger the ?? "" fallback
      const payload = {
        tier: "pro",
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      }
      const key = btoa(JSON.stringify(payload))

      const info = await activateLicense(key)
      expect(info.tier).toBe("pro")
      expect(info.valid).toBe(true)
      expect(info.holder).toBe("")
    })

    it("defaults holder to empty string on expired key (line 381)", async () => {
      // Craft an expired key with no holder field
      const payload = {
        tier: "enterprise",
        expiresAt: Date.now() - 86400000, // expired
      }
      const key = btoa(JSON.stringify(payload))

      const info = await activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
      expect(info.holder).toBe("")
    })

    it("defaults holder to empty string when signature verification rejects (no sig)", async () => {
      setLicenseSecret("holder-test-secret")
      // Craft unsigned key in signed format but missing holder
      const payload = {
        tier: "pro",
        expiresAt: Date.now() + 86400000,
      }
      const key = btoa(JSON.stringify(payload))

      const info = await activateLicense(key)
      expect(info.valid).toBe(false)
      expect(info.holder).toBe("")
    })
  })

  describe("ECDSA verification edge cases", () => {
    it("fails ECDSA verification when signature is structurally valid but wrong", async () => {
      const pair = await generateLicenseKeyPair()
      await setLicensePublicKey(pair.publicKey)

      const payload = {
        tier: "pro",
        expiresAt: Date.now() + 86400000,
        holder: "ecdsa-wrong-sig",
      }
      // Create a properly formatted base64url string that is valid base64
      // but is not a valid ECDSA signature for this payload
      const fakeSignature = btoa(
        "a]random.bytes.that.look.like.a.signature.but.are.not.valid.for" +
          ".this.payload.at.all.and.are.long.enough",
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "")
      const forgedKey = btoa(JSON.stringify({ payload, signature: "ecdsa:" + fakeSignature }))

      const info = await activateLicense(forgedKey)
      expect(info.valid).toBe(false)
      expect(info.tier).toBe("community")
    })

    it("ECDSA key activates successfully via the ecdsa: signature path (line 358)", async () => {
      // This explicitly tests the ecdsa: prefix branch in activateLicense
      const pair = await generateLicenseKeyPair()
      await setLicensePrivateKey(pair.privateKey)
      await setLicensePublicKey(pair.publicKey)
      // Do NOT set an HMAC secret, so only ECDSA path is possible

      const key = await generateTestKey("team", "ecdsa-path-test", 365)
      const decoded = JSON.parse(atob(key))
      expect(decoded.signature.startsWith("ecdsa:")).toBe(true)

      const info = await activateLicense(key)
      expect(info.tier).toBe("team")
      expect(info.valid).toBe(true)
      expect(info.holder).toBe("ecdsa-path-test")
    })
  })
})
