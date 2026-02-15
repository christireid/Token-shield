/**
 * TokenShield - Pricing Registry
 *
 * Standalone, importable module for LLM model pricing data.
 * Prices are in USD per 1 million tokens.
 * Sources: openai.com/api/pricing, anthropic.com/pricing, ai.google.dev/pricing
 */

/** Pricing and capability metadata for a single LLM model. */
export interface ModelPricingEntry {
  id: string
  provider: "openai" | "anthropic" | "google"
  name: string
  inputPerMillion: number
  outputPerMillion: number
  cachedInputDiscount: number
  contextWindow: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsFunctions: boolean
  deprecated?: boolean
}

/** Mutable registry of all known model pricing entries, keyed by model id. */
export const PRICING_REGISTRY: Record<string, ModelPricingEntry> = {
  // ---------------------------------------------------------------------------
  // OpenAI
  // ---------------------------------------------------------------------------
  "gpt-4o": {
    id: "gpt-4o",
    provider: "openai",
    name: "GPT-4o",
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachedInputDiscount: 0.5,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    provider: "openai",
    name: "GPT-4o Mini",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputDiscount: 0.5,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gpt-4.1": {
    id: "gpt-4.1",
    provider: "openai",
    name: "GPT-4.1",
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cachedInputDiscount: 0.5,
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gpt-4.1-mini": {
    id: "gpt-4.1-mini",
    provider: "openai",
    name: "GPT-4.1 Mini",
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cachedInputDiscount: 0.5,
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gpt-4.1-nano": {
    id: "gpt-4.1-nano",
    provider: "openai",
    name: "GPT-4.1 Nano",
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cachedInputDiscount: 0.5,
    contextWindow: 1_048_576,
    maxOutputTokens: 32_768,
    supportsVision: false,
    supportsFunctions: true,
  },
  "o1": {
    id: "o1",
    provider: "openai",
    name: "o1",
    inputPerMillion: 15.0,
    outputPerMillion: 60.0,
    cachedInputDiscount: 0.5,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: true,
    supportsFunctions: false,
  },
  "o1-mini": {
    id: "o1-mini",
    provider: "openai",
    name: "o1 Mini",
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cachedInputDiscount: 0.5,
    contextWindow: 128_000,
    maxOutputTokens: 65_536,
    supportsVision: false,
    supportsFunctions: false,
  },
  "o3": {
    id: "o3",
    provider: "openai",
    name: "o3",
    inputPerMillion: 2.0,
    outputPerMillion: 8.0,
    cachedInputDiscount: 0.5,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: true,
    supportsFunctions: true,
  },
  "o3-mini": {
    id: "o3-mini",
    provider: "openai",
    name: "o3 Mini",
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cachedInputDiscount: 0.5,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: false,
    supportsFunctions: false,
  },
  "o4-mini": {
    id: "o4-mini",
    provider: "openai",
    name: "o4 Mini",
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cachedInputDiscount: 0.5,
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    provider: "openai",
    name: "GPT-4 Turbo",
    inputPerMillion: 10.0,
    outputPerMillion: 30.0,
    cachedInputDiscount: 0,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsVision: true,
    supportsFunctions: true,
    deprecated: true,
  },
  "gpt-3.5-turbo": {
    id: "gpt-3.5-turbo",
    provider: "openai",
    name: "GPT-3.5 Turbo",
    inputPerMillion: 0.5,
    outputPerMillion: 1.5,
    cachedInputDiscount: 0,
    contextWindow: 16_385,
    maxOutputTokens: 4_096,
    supportsVision: false,
    supportsFunctions: true,
    deprecated: true,
  },

  // ---------------------------------------------------------------------------
  // Anthropic
  // ---------------------------------------------------------------------------
  "claude-opus-4": {
    id: "claude-opus-4",
    provider: "anthropic",
    name: "Claude Opus 4",
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsVision: true,
    supportsFunctions: true,
  },
  "claude-sonnet-4": {
    id: "claude-sonnet-4",
    provider: "anthropic",
    name: "Claude Sonnet 4",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsVision: true,
    supportsFunctions: true,
  },
  "claude-haiku-3.5": {
    id: "claude-haiku-3.5",
    provider: "anthropic",
    name: "Claude Haiku 3.5",
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
  "claude-3-opus": {
    id: "claude-3-opus",
    provider: "anthropic",
    name: "Claude 3 Opus",
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsVision: true,
    supportsFunctions: true,
    deprecated: true,
  },
  "claude-3-sonnet": {
    id: "claude-3-sonnet",
    provider: "anthropic",
    name: "Claude 3 Sonnet",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsVision: true,
    supportsFunctions: true,
    deprecated: true,
  },
  "claude-3-haiku": {
    id: "claude-3-haiku",
    provider: "anthropic",
    name: "Claude 3 Haiku",
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    cachedInputDiscount: 0.9,
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsVision: true,
    supportsFunctions: true,
    deprecated: true,
  },

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    provider: "google",
    name: "Gemini 2.5 Pro",
    inputPerMillion: 1.25,
    outputPerMillion: 10.0,
    cachedInputDiscount: 0.75,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputDiscount: 0.75,
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cachedInputDiscount: 0.75,
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-2.0-flash-lite": {
    id: "gemini-2.0-flash-lite",
    provider: "google",
    name: "Gemini 2.0 Flash Lite",
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    cachedInputDiscount: 0.75,
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-2.0-pro": {
    id: "gemini-2.0-pro",
    provider: "google",
    name: "Gemini 2.0 Pro",
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachedInputDiscount: 0.75,
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-1.5-flash": {
    id: "gemini-1.5-flash",
    provider: "google",
    name: "Gemini 1.5 Flash",
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    cachedInputDiscount: 0.75,
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    provider: "google",
    name: "Gemini 1.5 Pro",
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachedInputDiscount: 0.75,
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsVision: true,
    supportsFunctions: true,
  },
}

/**
 * Register a custom or fine-tuned model in the pricing registry.
 * Overwrites any existing entry with the same id.
 */
export function registerModel(entry: ModelPricingEntry): void {
  PRICING_REGISTRY[entry.id] = entry
}

/**
 * Look up pricing for a model by its id.
 * Falls back to prefix matching when an exact key is not found,
 * returning the entry whose id is the longest prefix of the query.
 */
export function getModelPricing(
  modelId: string
): ModelPricingEntry | undefined {
  if (PRICING_REGISTRY[modelId]) {
    return PRICING_REGISTRY[modelId]
  }

  let bestMatch: ModelPricingEntry | undefined
  let bestLength = 0

  for (const entry of Object.values(PRICING_REGISTRY)) {
    if (
      modelId.startsWith(entry.id) &&
      entry.id.length > bestLength
    ) {
      bestMatch = entry
      bestLength = entry.id.length
    }
  }

  return bestMatch
}

/** Return every model entry that belongs to the given provider. */
export function getModelsByProvider(
  provider: string
): ModelPricingEntry[] {
  return Object.values(PRICING_REGISTRY).filter(
    (entry) => entry.provider === provider
  )
}

// -------------------------------------------------------
// Remote Pricing Fetch
// -------------------------------------------------------

/** Timestamp of the last successful remote pricing fetch */
let lastFetchTimestamp = 0

/** Minimum interval between fetches (1 hour) */
const MIN_FETCH_INTERVAL_MS = 60 * 60 * 1000

/** Allowed hostnames for remote pricing fetch (SSRF prevention) */
const ALLOWED_PRICING_HOSTS = new Set([
  "api.tokenshield.dev",
  "cdn.tokenshield.dev",
  "tokenshield.dev",
])

/**
 * Fetch latest pricing data from a remote URL and merge into the registry.
 *
 * The remote endpoint should return a JSON object where keys are model IDs
 * and values are {@link ModelPricingEntry} objects. New models are added;
 * existing models are updated. Hardcoded entries serve as fallback if the
 * fetch fails.
 *
 * Includes rate limiting (max once per hour) and validation to prevent
 * corrupt data from overwriting the registry.
 *
 * @param url - URL returning JSON-formatted pricing data
 * @param options - Optional fetch configuration
 * @param options.timeoutMs - Fetch timeout in milliseconds (default: 5000)
 * @param options.force - Bypass the rate limit and fetch immediately (default: false)
 * @returns Object with number of models updated/added and any errors
 *
 * @example
 * ```ts
 * const result = await fetchLatestPricing("https://api.tokenshield.dev/pricing")
 * // result.updated === 5
 * // result.added === 2
 * // result.errors === []
 * ```
 */
export async function fetchLatestPricing(
  url: string,
  options: {
    timeoutMs?: number
    force?: boolean
    /** Additional allowed hostnames beyond the built-in allowlist */
    allowedHosts?: string[]
  } = {}
): Promise<{
  updated: number
  added: number
  errors: string[]
  fromCache: boolean
}> {
  const timeoutMs = options.timeoutMs ?? 5000
  const force = options.force ?? false

  // URL validation (SSRF prevention)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return { updated: 0, added: 0, errors: [`Invalid URL: ${url}`], fromCache: false }
  }

  if (parsedUrl.protocol !== "https:") {
    return { updated: 0, added: 0, errors: ["Only HTTPS URLs are allowed"], fromCache: false }
  }

  const allowedHosts = new Set([...ALLOWED_PRICING_HOSTS, ...(options.allowedHosts ?? [])])
  if (!allowedHosts.has(parsedUrl.hostname)) {
    return {
      updated: 0,
      added: 0,
      errors: [`Host "${parsedUrl.hostname}" is not in the allowed list. Use options.allowedHosts to add it.`],
      fromCache: false,
    }
  }

  // Rate limit: skip if we fetched recently (unless forced)
  if (!force && Date.now() - lastFetchTimestamp < MIN_FETCH_INTERVAL_MS) {
    return { updated: 0, added: 0, errors: [], fromCache: true }
  }

  const errors: string[] = []
  let updated = 0
  let added = 0

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      errors.push(`HTTP ${response.status}: ${response.statusText}`)
      return { updated, added, errors, fromCache: false }
    }

    const data = await response.json()

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      errors.push("Invalid response format: expected a JSON object")
      return { updated, added, errors, fromCache: false }
    }

    // Validate and merge each entry
    for (const [id, entry] of Object.entries(data as Record<string, unknown>)) {
      const validated = validatePricingEntry(id, entry)
      if (validated.error) {
        errors.push(`${id}: ${validated.error}`)
        continue
      }
      if (PRICING_REGISTRY[id]) {
        updated++
      } else {
        added++
      }
      PRICING_REGISTRY[id] = validated.entry!
    }

    lastFetchTimestamp = Date.now()
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      errors.push(`Fetch timed out after ${timeoutMs}ms`)
    } else {
      errors.push(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { updated, added, errors, fromCache: false }
}

/** Validate a single pricing entry from remote data */
function validatePricingEntry(
  id: string,
  raw: unknown
): { entry?: ModelPricingEntry; error?: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "Not an object" }
  }

  const e = raw as Record<string, unknown>

  // Required fields
  if (typeof e.provider !== "string" || !["openai", "anthropic", "google"].includes(e.provider)) {
    return { error: `Invalid provider: ${e.provider}` }
  }
  if (typeof e.name !== "string" || e.name.length === 0) {
    return { error: "Missing or empty name" }
  }
  if (typeof e.inputPerMillion !== "number" || e.inputPerMillion < 0) {
    return { error: `Invalid inputPerMillion: ${e.inputPerMillion}` }
  }
  if (typeof e.outputPerMillion !== "number" || e.outputPerMillion < 0) {
    return { error: `Invalid outputPerMillion: ${e.outputPerMillion}` }
  }
  if (typeof e.contextWindow !== "number" || e.contextWindow <= 0) {
    return { error: `Invalid contextWindow: ${e.contextWindow}` }
  }

  // Range validation for optional numeric fields
  const cachedInputDiscount = typeof e.cachedInputDiscount === "number" ? e.cachedInputDiscount : 0
  if (cachedInputDiscount < 0 || cachedInputDiscount > 1) {
    return { error: `cachedInputDiscount must be between 0 and 1, got: ${cachedInputDiscount}` }
  }

  const maxOutputTokens = typeof e.maxOutputTokens === "number" ? e.maxOutputTokens : 4096
  if (maxOutputTokens <= 0) {
    return { error: `maxOutputTokens must be positive, got: ${maxOutputTokens}` }
  }

  return {
    entry: {
      id,
      provider: e.provider as ModelPricingEntry["provider"],
      name: e.name as string,
      inputPerMillion: e.inputPerMillion as number,
      outputPerMillion: e.outputPerMillion as number,
      cachedInputDiscount,
      contextWindow: e.contextWindow as number,
      maxOutputTokens,
      supportsVision: typeof e.supportsVision === "boolean" ? e.supportsVision : false,
      supportsFunctions: typeof e.supportsFunctions === "boolean" ? e.supportsFunctions : false,
      deprecated: typeof e.deprecated === "boolean" ? e.deprecated : undefined,
    },
  }
}

/** Get the timestamp of the last successful pricing fetch (0 = never fetched) */
export function getLastPricingFetchTime(): number {
  return lastFetchTimestamp
}
