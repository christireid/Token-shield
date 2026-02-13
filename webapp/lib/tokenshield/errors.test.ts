import { describe, it, expect } from "vitest"
import {
  ERROR_CODES,
  TokenShieldError,
  TokenShieldBlockedError,
  TokenShieldConfigError,
  TokenShieldBudgetError,
  TokenShieldCryptoError,
} from "./errors"

describe("errors", () => {
  describe("ERROR_CODES", () => {
    it("has all expected guard codes", () => {
      expect(ERROR_CODES.GUARD_MIN_LENGTH).toBe("GUARD_MIN_LENGTH")
      expect(ERROR_CODES.GUARD_RATE_LIMIT).toBe("GUARD_RATE_LIMIT")
      expect(ERROR_CODES.GUARD_COST_LIMIT).toBe("GUARD_COST_LIMIT")
      expect(ERROR_CODES.GUARD_DUPLICATE).toBe("GUARD_DUPLICATE")
      expect(ERROR_CODES.GUARD_MAX_TOKENS).toBe("GUARD_MAX_TOKENS")
    })

    it("has all expected breaker codes", () => {
      expect(ERROR_CODES.BREAKER_SESSION_LIMIT).toBe("BREAKER_SESSION_LIMIT")
      expect(ERROR_CODES.BREAKER_HOUR_LIMIT).toBe("BREAKER_HOUR_LIMIT")
      expect(ERROR_CODES.BREAKER_DAY_LIMIT).toBe("BREAKER_DAY_LIMIT")
      expect(ERROR_CODES.BREAKER_MONTH_LIMIT).toBe("BREAKER_MONTH_LIMIT")
    })

    it("has all expected budget codes", () => {
      expect(ERROR_CODES.BUDGET_DAILY_EXCEEDED).toBe("BUDGET_DAILY_EXCEEDED")
      expect(ERROR_CODES.BUDGET_MONTHLY_EXCEEDED).toBe("BUDGET_MONTHLY_EXCEEDED")
      expect(ERROR_CODES.BUDGET_USER_ID_INVALID).toBe("BUDGET_USER_ID_INVALID")
    })

    it("has config and crypto codes", () => {
      expect(ERROR_CODES.CONFIG_INVALID).toBe("CONFIG_INVALID")
      expect(ERROR_CODES.CRYPTO_KEY_DERIVATION_FAILED).toBe("CRYPTO_KEY_DERIVATION_FAILED")
      expect(ERROR_CODES.CRYPTO_ENCRYPTION_FAILED).toBe("CRYPTO_ENCRYPTION_FAILED")
      expect(ERROR_CODES.CRYPTO_DECRYPTION_FAILED).toBe("CRYPTO_DECRYPTION_FAILED")
    })

    it("is immutable (as const prevents mutation at type level)", () => {
      const keys = Object.keys(ERROR_CODES)
      expect(keys.length).toBe(16)
      // Each value matches its key
      for (const key of keys) {
        expect(ERROR_CODES[key as keyof typeof ERROR_CODES]).toBe(key)
      }
    })
  })

  describe("TokenShieldError", () => {
    it("has correct name and code", () => {
      const err = new TokenShieldError("test message", ERROR_CODES.GUARD_MIN_LENGTH)
      expect(err.name).toBe("TokenShieldError")
      expect(err.code).toBe("GUARD_MIN_LENGTH")
      expect(err.message).toBe("test message")
    })

    it("is instanceof Error", () => {
      const err = new TokenShieldError("test", ERROR_CODES.CONFIG_INVALID)
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(TokenShieldError)
    })
  })

  describe("TokenShieldBlockedError", () => {
    it("is instanceof both TokenShieldBlockedError and TokenShieldError and Error", () => {
      const err = new TokenShieldBlockedError("blocked", ERROR_CODES.GUARD_RATE_LIMIT)
      expect(err).toBeInstanceOf(TokenShieldBlockedError)
      expect(err).toBeInstanceOf(TokenShieldError)
      expect(err).toBeInstanceOf(Error)
    })

    it("has correct name and code", () => {
      const err = new TokenShieldBlockedError("blocked", ERROR_CODES.GUARD_RATE_LIMIT)
      expect(err.name).toBe("TokenShieldBlockedError")
      expect(err.code).toBe("GUARD_RATE_LIMIT")
    })

    it("defaults code to GUARD_MIN_LENGTH", () => {
      const err = new TokenShieldBlockedError("blocked")
      expect(err.code).toBe("GUARD_MIN_LENGTH")
    })
  })

  describe("TokenShieldConfigError", () => {
    it("has path property when provided", () => {
      const err = new TokenShieldConfigError("bad config", "guard.minLength")
      expect(err.name).toBe("TokenShieldConfigError")
      expect(err.code).toBe("CONFIG_INVALID")
      expect(err.path).toBe("guard.minLength")
      expect(err.message).toBe("bad config")
    })

    it("has undefined path when not provided", () => {
      const err = new TokenShieldConfigError("bad config")
      expect(err.path).toBeUndefined()
    })

    it("is instanceof TokenShieldError", () => {
      const err = new TokenShieldConfigError("bad config")
      expect(err).toBeInstanceOf(TokenShieldConfigError)
      expect(err).toBeInstanceOf(TokenShieldError)
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe("TokenShieldBudgetError", () => {
    it("has userId, limitType, currentSpend, limit for daily", () => {
      const err = new TokenShieldBudgetError("user-123", "daily", 5.1234, 5.0)
      expect(err.name).toBe("TokenShieldBudgetError")
      expect(err.code).toBe("BUDGET_DAILY_EXCEEDED")
      expect(err.userId).toBe("user-123")
      expect(err.limitType).toBe("daily")
      expect(err.currentSpend).toBe(5.1234)
      expect(err.limit).toBe(5.0)
      expect(err.message).toBe("User user-123 daily budget exceeded ($5.1234 / $5.00)")
    })

    it("has correct code for monthly limit", () => {
      const err = new TokenShieldBudgetError("user-456", "monthly", 100.5, 100.0)
      expect(err.code).toBe("BUDGET_MONTHLY_EXCEEDED")
      expect(err.limitType).toBe("monthly")
    })

    it("is instanceof TokenShieldBlockedError, TokenShieldError, and Error", () => {
      const err = new TokenShieldBudgetError("u1", "daily", 1, 1)
      expect(err).toBeInstanceOf(TokenShieldBudgetError)
      expect(err).toBeInstanceOf(TokenShieldBlockedError)
      expect(err).toBeInstanceOf(TokenShieldError)
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe("TokenShieldCryptoError", () => {
    it("has correct code when specified", () => {
      const err = new TokenShieldCryptoError("key failed", ERROR_CODES.CRYPTO_KEY_DERIVATION_FAILED)
      expect(err.name).toBe("TokenShieldCryptoError")
      expect(err.code).toBe("CRYPTO_KEY_DERIVATION_FAILED")
      expect(err.message).toBe("key failed")
    })

    it("defaults code to CRYPTO_ENCRYPTION_FAILED", () => {
      const err = new TokenShieldCryptoError("encrypt failed")
      expect(err.code).toBe("CRYPTO_ENCRYPTION_FAILED")
    })

    it("is instanceof TokenShieldError and Error", () => {
      const err = new TokenShieldCryptoError("fail")
      expect(err).toBeInstanceOf(TokenShieldCryptoError)
      expect(err).toBeInstanceOf(TokenShieldError)
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe("catch-all handling", () => {
    it("all error types can be caught by catching TokenShieldError", () => {
      const errors = [
        new TokenShieldError("base", ERROR_CODES.GUARD_MIN_LENGTH),
        new TokenShieldBlockedError("blocked", ERROR_CODES.GUARD_RATE_LIMIT),
        new TokenShieldConfigError("config", "path"),
        new TokenShieldBudgetError("u1", "daily", 1, 1),
        new TokenShieldCryptoError("crypto"),
      ]

      for (const err of errors) {
        let caught = false
        try {
          throw err
        } catch (e) {
          if (e instanceof TokenShieldError) {
            caught = true
            expect(e.code).toBeDefined()
            expect(e.message).toBeDefined()
            expect(e.name).toBeDefined()
          }
        }
        expect(caught).toBe(true)
      }
    })

    it("can narrow to specific subtypes after catching TokenShieldError", () => {
      const err = new TokenShieldBudgetError("u1", "monthly", 50, 50)
      try {
        throw err
      } catch (e) {
        expect(e).toBeInstanceOf(TokenShieldError)
        if (e instanceof TokenShieldBudgetError) {
          expect(e.userId).toBe("u1")
          expect(e.limitType).toBe("monthly")
        } else {
          // Should not reach here
          expect.unreachable("Expected TokenShieldBudgetError")
        }
      }
    })
  })
})
