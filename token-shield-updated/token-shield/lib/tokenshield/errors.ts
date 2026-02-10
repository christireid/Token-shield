/**
 * TokenShield - Typed Error Hierarchy
 *
 * Provides structured, catchable error types with machine-readable codes.
 * All errors extend TokenShieldError for easy catch-all handling.
 */

// Error code constants for programmatic handling
export const ERROR_CODES = {
  // Guard errors
  GUARD_MIN_LENGTH: "GUARD_MIN_LENGTH",
  GUARD_RATE_LIMIT: "GUARD_RATE_LIMIT",
  GUARD_COST_LIMIT: "GUARD_COST_LIMIT",
  GUARD_DUPLICATE: "GUARD_DUPLICATE",
  GUARD_MAX_TOKENS: "GUARD_MAX_TOKENS",

  // Breaker errors
  BREAKER_SESSION_LIMIT: "BREAKER_SESSION_LIMIT",
  BREAKER_HOUR_LIMIT: "BREAKER_HOUR_LIMIT",
  BREAKER_DAY_LIMIT: "BREAKER_DAY_LIMIT",
  BREAKER_MONTH_LIMIT: "BREAKER_MONTH_LIMIT",

  // Budget errors
  BUDGET_DAILY_EXCEEDED: "BUDGET_DAILY_EXCEEDED",
  BUDGET_MONTHLY_EXCEEDED: "BUDGET_MONTHLY_EXCEEDED",
  BUDGET_USER_ID_INVALID: "BUDGET_USER_ID_INVALID",

  // Config errors
  CONFIG_INVALID: "CONFIG_INVALID",

  // Crypto errors
  CRYPTO_KEY_DERIVATION_FAILED: "CRYPTO_KEY_DERIVATION_FAILED",
  CRYPTO_ENCRYPTION_FAILED: "CRYPTO_ENCRYPTION_FAILED",
  CRYPTO_DECRYPTION_FAILED: "CRYPTO_DECRYPTION_FAILED",
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

/** Base error for all TokenShield errors. Catch this to handle any SDK error. */
export class TokenShieldError extends Error {
  readonly code: ErrorCode

  constructor(message: string, code: ErrorCode) {
    super(message)
    this.name = "TokenShieldError"
    this.code = code
  }
}

/** Thrown when a request is blocked by the guard, breaker, or budget. */
export class TokenShieldBlockedError extends TokenShieldError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.GUARD_MIN_LENGTH) {
    super(message, code)
    this.name = "TokenShieldBlockedError"
  }
}

/** Thrown when SDK configuration is invalid. */
export class TokenShieldConfigError extends TokenShieldError {
  readonly path?: string

  constructor(message: string, path?: string) {
    super(message, ERROR_CODES.CONFIG_INVALID)
    this.name = "TokenShieldConfigError"
    this.path = path
  }
}

/** Thrown when per-user budget is exceeded. */
export class TokenShieldBudgetError extends TokenShieldBlockedError {
  readonly userId: string
  readonly limitType: "daily" | "monthly"
  readonly currentSpend: number
  readonly limit: number

  constructor(userId: string, limitType: "daily" | "monthly", currentSpend: number, limit: number) {
    const code = limitType === "daily" ? ERROR_CODES.BUDGET_DAILY_EXCEEDED : ERROR_CODES.BUDGET_MONTHLY_EXCEEDED
    super(`User ${userId} ${limitType} budget exceeded ($${currentSpend.toFixed(4)} / $${limit.toFixed(2)})`, code)
    this.name = "TokenShieldBudgetError"
    this.userId = userId
    this.limitType = limitType
    this.currentSpend = currentSpend
    this.limit = limit
  }
}

/** Thrown when crypto operations fail. */
export class TokenShieldCryptoError extends TokenShieldError {
  constructor(message: string, code: ErrorCode = ERROR_CODES.CRYPTO_ENCRYPTION_FAILED) {
    super(message, code)
    this.name = "TokenShieldCryptoError"
  }
}
