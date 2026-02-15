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

  // API errors
  API_REQUEST_FAILED: "API_REQUEST_FAILED",
  API_INVALID_RESPONSE: "API_INVALID_RESPONSE",
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Base error for all TokenShield errors. Catch this to handle any SDK error. */
export class TokenShieldError extends Error {
  readonly code: ErrorCode

  constructor(message: string, code: ErrorCode, options?: { cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined)
    this.name = "TokenShieldError"
    this.code = code
    // Fix instanceof in ES5 transpilation (TypeScript's downlevelIteration)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when a request is blocked by the guard, breaker, or budget. */
export class TokenShieldBlockedError extends TokenShieldError {
  /** Actionable suggestion for how to resolve the block */
  readonly suggestion?: string
  /** Structured details about what triggered the block */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.GUARD_MIN_LENGTH,
    options?: { suggestion?: string; details?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message, code, options?.cause ? { cause: options.cause } : undefined)
    this.name = "TokenShieldBlockedError"
    this.suggestion = options?.suggestion
    this.details = options?.details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when SDK configuration is invalid. */
export class TokenShieldConfigError extends TokenShieldError {
  readonly path?: string

  constructor(message: string, path?: string, options?: { cause?: unknown }) {
    super(message, ERROR_CODES.CONFIG_INVALID, options)
    this.name = "TokenShieldConfigError"
    this.path = path
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when per-user budget is exceeded. */
export class TokenShieldBudgetError extends TokenShieldBlockedError {
  readonly userId: string
  readonly limitType: "daily" | "monthly"
  readonly currentSpend: number
  readonly limit: number

  constructor(userId: string, limitType: "daily" | "monthly", currentSpend: number, limit: number) {
    const code =
      limitType === "daily"
        ? ERROR_CODES.BUDGET_DAILY_EXCEEDED
        : ERROR_CODES.BUDGET_MONTHLY_EXCEEDED
    const remaining = Math.max(0, limit - currentSpend)
    const pct = limit > 0 ? ((currentSpend / limit) * 100).toFixed(0) : "100"
    super(
      `User "${userId}" ${limitType} budget exceeded: spent $${currentSpend.toFixed(4)} of $${limit.toFixed(2)} limit (${pct}% used)`,
      code,
      {
        suggestion:
          remaining > 0
            ? `Wait for the ${limitType} window to reset, or increase the ${limitType} limit via userBudget config.`
            : `The ${limitType} budget is fully exhausted. Increase the limit via config.userBudget.defaultBudget.${limitType} or config.userBudget.userOverrides.`,
        details: { userId, limitType, currentSpend, limit, remaining, percentUsed: Number(pct) },
      },
    )
    this.name = "TokenShieldBudgetError"
    this.userId = userId
    this.limitType = limitType
    this.currentSpend = currentSpend
    this.limit = limit
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when crypto operations fail. */
export class TokenShieldCryptoError extends TokenShieldError {
  constructor(
    message: string,
    code: ErrorCode = ERROR_CODES.CRYPTO_ENCRYPTION_FAILED,
    options?: { cause?: unknown },
  ) {
    super(message, code, options)
    this.name = "TokenShieldCryptoError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Thrown when an API call to a provider fails. */
export class TokenShieldAPIError extends TokenShieldError {
  readonly provider: string
  readonly statusCode?: number

  constructor(
    message: string,
    provider: string,
    statusCode?: number,
    code: ErrorCode = ERROR_CODES.API_REQUEST_FAILED,
    options?: { cause?: unknown },
  ) {
    super(message, code, options)
    this.name = "TokenShieldAPIError"
    this.provider = provider
    this.statusCode = statusCode
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
