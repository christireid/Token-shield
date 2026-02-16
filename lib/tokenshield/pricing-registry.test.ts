/**
 * Pricing Registry Tests
 *
 * Tests for PRICING_REGISTRY data, registerModel, getModelPricing,
 * getModelsByProvider, fetchLatestPricing, validatePricingEntry (via
 * fetchLatestPricing), and getLastPricingFetchTime.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import {
  PRICING_REGISTRY,
  registerModel,
  getModelPricing,
  getModelsByProvider,
  fetchLatestPricing,
  getLastPricingFetchTime,
  type ModelPricingEntry,
} from "./pricing-registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid pricing entry factory for use in fetch response mocks. */
function makeValidEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: "openai",
    name: "Test Model",
    inputPerMillion: 1.0,
    outputPerMillion: 3.0,
    cachedInputDiscount: 0.5,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsVision: false,
    supportsFunctions: true,
    ...overrides,
  }
}

/** Create a mock Response-like object for stubbing global.fetch. */
function mockFetchResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    clone: () => mockFetchResponse(body, status, statusText),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(body),
    bytes: async () => new Uint8Array(),
  } as Response
}

const VALID_URL = "https://api.tokenshield.dev/pricing"

// ---------------------------------------------------------------------------
// PRICING_REGISTRY static data
// ---------------------------------------------------------------------------

describe("PRICING_REGISTRY", () => {
  it("contains entries for all 3 providers", () => {
    const providers = new Set(Object.values(PRICING_REGISTRY).map((e) => e.provider))
    expect(providers.has("openai")).toBe(true)
    expect(providers.has("anthropic")).toBe(true)
    expect(providers.has("google")).toBe(true)
  })

  it("has at least 25 models", () => {
    expect(Object.keys(PRICING_REGISTRY).length).toBeGreaterThanOrEqual(25)
  })

  it("all entries have positive pricing", () => {
    for (const entry of Object.values(PRICING_REGISTRY)) {
      expect(entry.inputPerMillion).toBeGreaterThanOrEqual(0)
      expect(entry.outputPerMillion).toBeGreaterThan(0)
    }
  })

  it("all entries have positive context windows", () => {
    for (const entry of Object.values(PRICING_REGISTRY)) {
      expect(entry.contextWindow).toBeGreaterThan(0)
      expect(entry.maxOutputTokens).toBeGreaterThan(0)
    }
  })

  it("entry id matches its key", () => {
    for (const [key, entry] of Object.entries(PRICING_REGISTRY)) {
      expect(entry.id).toBe(key)
    }
  })

  it("cachedInputDiscount is between 0 and 1", () => {
    for (const entry of Object.values(PRICING_REGISTRY)) {
      expect(entry.cachedInputDiscount).toBeGreaterThanOrEqual(0)
      expect(entry.cachedInputDiscount).toBeLessThanOrEqual(1)
    }
  })
})

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe("getModelPricing", () => {
  it("returns exact match for known model", () => {
    const entry = getModelPricing("gpt-4o")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("gpt-4o")
    expect(entry!.provider).toBe("openai")
  })

  it("returns exact match for Anthropic model", () => {
    const entry = getModelPricing("claude-sonnet-4")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("claude-sonnet-4")
    expect(entry!.provider).toBe("anthropic")
  })

  it("returns exact match for Google model", () => {
    const entry = getModelPricing("gemini-2.0-flash")
    expect(entry).toBeDefined()
    expect(entry!.provider).toBe("google")
  })

  it("falls back to prefix matching for versioned models", () => {
    const entry = getModelPricing("gpt-4o-2024-11-20")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("gpt-4o")
  })

  it("returns longest prefix match", () => {
    const entry = getModelPricing("gpt-4o-mini-2024-07-18")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("gpt-4o-mini")
  })

  it("matches Anthropic versioned models", () => {
    const entry = getModelPricing("claude-sonnet-4-20250514")
    expect(entry).toBeDefined()
    expect(entry!.id).toBe("claude-sonnet-4")
  })

  it("returns undefined for completely unknown model", () => {
    const entry = getModelPricing("totally-unknown-model-xyz")
    expect(entry).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getModelsByProvider
// ---------------------------------------------------------------------------

describe("getModelsByProvider", () => {
  it("returns only OpenAI models for openai provider", () => {
    const models = getModelsByProvider("openai")
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.provider === "openai")).toBe(true)
  })

  it("returns only Anthropic models for anthropic provider", () => {
    const models = getModelsByProvider("anthropic")
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.provider === "anthropic")).toBe(true)
  })

  it("returns only Google models for google provider", () => {
    const models = getModelsByProvider("google")
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.provider === "google")).toBe(true)
  })

  it("returns empty array for unknown provider", () => {
    const models = getModelsByProvider("azure")
    expect(models).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// registerModel
// ---------------------------------------------------------------------------

describe("registerModel", () => {
  afterEach(() => {
    delete PRICING_REGISTRY["test-custom-model"]
  })

  it("adds a new model to the registry", () => {
    const entry: ModelPricingEntry = {
      id: "test-custom-model",
      provider: "openai",
      name: "Test Custom",
      inputPerMillion: 1.0,
      outputPerMillion: 3.0,
      cachedInputDiscount: 0.5,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctions: true,
    }

    registerModel(entry)

    expect(PRICING_REGISTRY["test-custom-model"]).toBe(entry)
    expect(getModelPricing("test-custom-model")).toBe(entry)
  })

  it("overwrites existing entry with same id", () => {
    const entry1: ModelPricingEntry = {
      id: "test-custom-model",
      provider: "openai",
      name: "V1",
      inputPerMillion: 1.0,
      outputPerMillion: 3.0,
      cachedInputDiscount: 0.5,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctions: true,
    }
    const entry2: ModelPricingEntry = {
      ...entry1,
      name: "V2",
      inputPerMillion: 0.5,
    }

    registerModel(entry1)
    registerModel(entry2)

    expect(PRICING_REGISTRY["test-custom-model"].name).toBe("V2")
    expect(PRICING_REGISTRY["test-custom-model"].inputPerMillion).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// getLastPricingFetchTime
// ---------------------------------------------------------------------------

describe("getLastPricingFetchTime", () => {
  it("returns a number (0 before any fetch in a fresh module)", () => {
    const t = getLastPricingFetchTime()
    expect(typeof t).toBe("number")
    // The module may have been fetched already by prior tests in the same run,
    // so we simply assert it is a non-negative number.
    expect(t).toBeGreaterThanOrEqual(0)
  })

  it("returns a value greater than 0 after a successful fetch", async () => {
    const body: Record<string, unknown> = {
      "__test-fetch-time-model__": makeValidEntry({ name: "FetchTimeTest" }),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    try {
      await fetchLatestPricing(VALID_URL, { force: true })
      const t = getLastPricingFetchTime()
      expect(t).toBeGreaterThan(0)
      // Should be recent (within the last 5 seconds)
      expect(Date.now() - t).toBeLessThan(5000)
    } finally {
      vi.unstubAllGlobals()
      delete PRICING_REGISTRY["__test-fetch-time-model__"]
    }
  })
})

// ---------------------------------------------------------------------------
// fetchLatestPricing
// ---------------------------------------------------------------------------

describe("fetchLatestPricing", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    // Clean up any test models that may have been added to the registry
    for (const key of Object.keys(PRICING_REGISTRY)) {
      if (key.startsWith("__test-")) {
        delete PRICING_REGISTRY[key]
      }
    }
  })

  // ---- URL validation (existing tests) ----

  it("rejects invalid URLs", async () => {
    const result = await fetchLatestPricing("not-a-url")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("Invalid URL")
  })

  it("rejects non-HTTPS URLs", async () => {
    const result = await fetchLatestPricing("http://api.tokenshield.dev/pricing")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("HTTPS")
  })

  it("rejects disallowed hostnames (SSRF prevention)", async () => {
    const result = await fetchLatestPricing("https://evil.example.com/pricing")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("not in the allowed list")
  })

  it("rejects localhost URLs", async () => {
    const result = await fetchLatestPricing("https://localhost/pricing")
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain("not in the allowed list")
  })

  it("allows custom hosts via allowedHosts option", async () => {
    // This will fail at fetch time (no server), but should pass URL validation
    const result = await fetchLatestPricing("https://my-custom-api.example.com/pricing", {
      allowedHosts: ["my-custom-api.example.com"],
      timeoutMs: 100,
      force: true,
    })
    // Should not have URL validation errors; may have fetch errors
    const urlErrors = result.errors.filter(
      (e) =>
        e.includes("not in the allowed list") || e.includes("Invalid URL") || e.includes("HTTPS"),
    )
    expect(urlErrors.length).toBe(0)
  })

  it("accepts allowed tokenshield.dev hosts", async () => {
    // Will fail at fetch time but should pass URL validation
    const result = await fetchLatestPricing("https://api.tokenshield.dev/pricing", {
      timeoutMs: 100,
      force: true,
    })
    // Should not have URL validation errors
    const urlErrors = result.errors.filter(
      (e) =>
        e.includes("not in the allowed list") || e.includes("Invalid URL") || e.includes("HTTPS"),
    )
    expect(urlErrors.length).toBe(0)
  })

  // ---- Rate limiting ----

  it("returns fromCache: true on second call without force (rate limiting)", async () => {
    const body: Record<string, unknown> = {
      "__test-rate-limit__": makeValidEntry({ name: "RateLimitTest" }),
    }

    const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(body))
    vi.stubGlobal("fetch", mockFetch)

    // First call should succeed and actually fetch
    const first = await fetchLatestPricing(VALID_URL, { force: true })
    expect(first.fromCache).toBe(false)
    expect(first.errors).toHaveLength(0)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call without force should be rate-limited
    const second = await fetchLatestPricing(VALID_URL)
    expect(second.fromCache).toBe(true)
    expect(second.updated).toBe(0)
    expect(second.added).toBe(0)
    expect(second.errors).toHaveLength(0)
    // fetch should NOT have been called again
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("bypasses rate limit when force: true is set", async () => {
    const body: Record<string, unknown> = {
      "__test-force-bypass__": makeValidEntry({ name: "ForceBypass" }),
    }

    const mockFetch = vi.fn().mockResolvedValue(mockFetchResponse(body))
    vi.stubGlobal("fetch", mockFetch)

    // First call
    await fetchLatestPricing(VALID_URL, { force: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call with force: true should bypass rate limit
    const second = await fetchLatestPricing(VALID_URL, { force: true })
    expect(second.fromCache).toBe(false)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // ---- Successful fetch ----

  it("successfully fetches and adds new models to the registry", async () => {
    const body: Record<string, unknown> = {
      "__test-new-model-alpha__": makeValidEntry({ name: "Alpha Model" }),
      "__test-new-model-beta__": makeValidEntry({
        provider: "anthropic",
        name: "Beta Model",
        inputPerMillion: 5.0,
        outputPerMillion: 15.0,
      }),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(0)
    expect(result.added).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.fromCache).toBe(false)

    // Verify models were actually added
    expect(PRICING_REGISTRY["__test-new-model-alpha__"]).toBeDefined()
    expect(PRICING_REGISTRY["__test-new-model-alpha__"].name).toBe("Alpha Model")
    expect(PRICING_REGISTRY["__test-new-model-beta__"]).toBeDefined()
    expect(PRICING_REGISTRY["__test-new-model-beta__"].provider).toBe("anthropic")
  })

  it("updates existing models and reports correct counts", async () => {
    // First, register a model that will be "updated"
    PRICING_REGISTRY["__test-existing__"] = {
      id: "__test-existing__",
      provider: "openai",
      name: "Original Name",
      inputPerMillion: 1.0,
      outputPerMillion: 3.0,
      cachedInputDiscount: 0.5,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctions: true,
    }

    const body: Record<string, unknown> = {
      // This one exists - should be updated
      "__test-existing__": makeValidEntry({ name: "Updated Name", inputPerMillion: 2.0 }),
      // This one is new - should be added
      "__test-brand-new__": makeValidEntry({ name: "Brand New", provider: "google" }),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.updated).toBe(1)
    expect(result.added).toBe(1)
    expect(result.errors).toHaveLength(0)
    expect(result.fromCache).toBe(false)

    // Verify the existing model was updated
    expect(PRICING_REGISTRY["__test-existing__"].name).toBe("Updated Name")
    expect(PRICING_REGISTRY["__test-existing__"].inputPerMillion).toBe(2.0)
    // Verify the new model was added
    expect(PRICING_REGISTRY["__test-brand-new__"]).toBeDefined()
    expect(PRICING_REGISTRY["__test-brand-new__"].provider).toBe("google")

    // Cleanup extra key
    delete PRICING_REGISTRY["__test-brand-new__"]
  })

  // ---- Non-200 status ----

  it("reports error for non-200 HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockFetchResponse(null, 500, "Internal Server Error")),
    )

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("HTTP 500")
    expect(result.errors[0]).toContain("Internal Server Error")
    expect(result.updated).toBe(0)
    expect(result.added).toBe(0)
    expect(result.fromCache).toBe(false)
  })

  it("reports error for 404 Not Found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(null, 404, "Not Found")))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("HTTP 404")
    expect(result.updated).toBe(0)
    expect(result.added).toBe(0)
  })

  // ---- Invalid JSON shapes ----

  it("reports error when response is an array instead of an object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse([1, 2, 3])))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid response format")
    expect(result.updated).toBe(0)
    expect(result.added).toBe(0)
  })

  it("reports error when response is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(null)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid response format")
  })

  it("reports error when response is a primitive string", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse("just a string")))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid response format")
  })

  // ---- Fetch timeout (AbortError) ----

  it("reports timeout error when fetch is aborted", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError))

    const result = await fetchLatestPricing(VALID_URL, { force: true, timeoutMs: 100 })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("timed out")
    expect(result.updated).toBe(0)
    expect(result.added).toBe(0)
    expect(result.fromCache).toBe(false)
  })

  // ---- Generic fetch error ----

  it("reports error when fetch throws a generic Error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Fetch failed")
    expect(result.errors[0]).toContain("Network failure")
    expect(result.fromCache).toBe(false)
  })

  it("reports error when fetch throws a non-Error value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("string rejection"))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Fetch failed")
    expect(result.errors[0]).toContain("string rejection")
  })

  // ---- Partial valid/invalid data ----

  it("handles mix of valid and invalid entries in response", async () => {
    const body: Record<string, unknown> = {
      "__test-valid-one__": makeValidEntry({ name: "Valid One" }),
      "__test-invalid-provider__": makeValidEntry({ provider: "azure" }), // invalid provider
      "__test-valid-two__": makeValidEntry({ name: "Valid Two", provider: "google" }),
      "__test-missing-name__": makeValidEntry({ name: "" }), // empty name
      "__test-not-object__": "just a string", // not an object
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    // 2 valid entries added, 3 invalid entries generate errors
    expect(result.added).toBe(2)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(3)
    expect(result.fromCache).toBe(false)

    // Verify valid entries were added
    expect(PRICING_REGISTRY["__test-valid-one__"]).toBeDefined()
    expect(PRICING_REGISTRY["__test-valid-two__"]).toBeDefined()

    // Verify invalid entries were NOT added
    expect(PRICING_REGISTRY["__test-invalid-provider__"]).toBeUndefined()
    expect(PRICING_REGISTRY["__test-missing-name__"]).toBeUndefined()
    expect(PRICING_REGISTRY["__test-not-object__"]).toBeUndefined()
  })

  // ---- Empty response object ----

  it("handles empty object response gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse({})))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.added).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(result.fromCache).toBe(false)
  })

  // ---- Entries with optional fields defaulting ----

  it("applies defaults for optional fields (cachedInputDiscount, maxOutputTokens, booleans)", async () => {
    const body: Record<string, unknown> = {
      "__test-defaults__": {
        provider: "openai",
        name: "Minimal Model",
        inputPerMillion: 1.0,
        outputPerMillion: 2.0,
        contextWindow: 64_000,
        // cachedInputDiscount, maxOutputTokens, supportsVision, supportsFunctions omitted
      },
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.added).toBe(1)
    expect(result.errors).toHaveLength(0)

    const entry = PRICING_REGISTRY["__test-defaults__"]
    expect(entry).toBeDefined()
    expect(entry.cachedInputDiscount).toBe(0) // default
    expect(entry.maxOutputTokens).toBe(4096) // default
    expect(entry.supportsVision).toBe(false) // default
    expect(entry.supportsFunctions).toBe(false) // default
    expect(entry.deprecated).toBeUndefined() // default
  })

  // ---- Fetch sets the id from the key ----

  it("sets the entry id from the object key, not from the entry body", async () => {
    const body: Record<string, unknown> = {
      "__test-id-from-key__": makeValidEntry({ name: "IdFromKey" }),
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))

    const result = await fetchLatestPricing(VALID_URL, { force: true })

    expect(result.added).toBe(1)
    expect(PRICING_REGISTRY["__test-id-from-key__"]).toBeDefined()
    expect(PRICING_REGISTRY["__test-id-from-key__"].id).toBe("__test-id-from-key__")
  })
})

// ---------------------------------------------------------------------------
// validatePricingEntry (exercised through fetchLatestPricing)
// ---------------------------------------------------------------------------

describe("validatePricingEntry (via fetchLatestPricing)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of Object.keys(PRICING_REGISTRY)) {
      if (key.startsWith("__test-")) {
        delete PRICING_REGISTRY[key]
      }
    }
  })

  /** Helper: fetch with a single entry and return the result. */
  async function fetchWithEntry(
    id: string,
    entry: unknown,
  ): Promise<{ updated: number; added: number; errors: string[]; fromCache: boolean }> {
    const body: Record<string, unknown> = { [id]: entry }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockFetchResponse(body)))
    const result = await fetchLatestPricing(VALID_URL, { force: true })
    vi.unstubAllGlobals()
    return result
  }

  it("rejects entry that is not an object (null)", async () => {
    const result = await fetchWithEntry("__test-null__", null)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Not an object")
    expect(result.added).toBe(0)
  })

  it("rejects entry that is not an object (number)", async () => {
    const result = await fetchWithEntry("__test-number__", 42)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Not an object")
    expect(result.added).toBe(0)
  })

  it("rejects entry with missing provider", async () => {
    const result = await fetchWithEntry(
      "__test-no-provider__",
      makeValidEntry({ provider: undefined }),
    )
    // When provider is undefined, it becomes "Invalid provider: undefined"
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid provider")
    expect(result.added).toBe(0)
  })

  it("rejects entry with invalid provider string", async () => {
    const result = await fetchWithEntry(
      "__test-bad-provider__",
      makeValidEntry({ provider: "azure" }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid provider")
    expect(result.errors[0]).toContain("azure")
    expect(result.added).toBe(0)
  })

  it("rejects entry with provider as non-string", async () => {
    const result = await fetchWithEntry("__test-provider-num__", makeValidEntry({ provider: 123 }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid provider")
    expect(result.added).toBe(0)
  })

  it("rejects entry with empty name", async () => {
    const result = await fetchWithEntry("__test-empty-name__", makeValidEntry({ name: "" }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Missing or empty name")
    expect(result.added).toBe(0)
  })

  it("rejects entry with non-string name", async () => {
    const result = await fetchWithEntry("__test-name-num__", makeValidEntry({ name: 999 }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Missing or empty name")
    expect(result.added).toBe(0)
  })

  it("rejects entry with negative inputPerMillion", async () => {
    const result = await fetchWithEntry(
      "__test-neg-input__",
      makeValidEntry({ inputPerMillion: -1 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid inputPerMillion")
    expect(result.added).toBe(0)
  })

  it("rejects entry with non-number inputPerMillion", async () => {
    const result = await fetchWithEntry(
      "__test-str-input__",
      makeValidEntry({ inputPerMillion: "five" }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid inputPerMillion")
    expect(result.added).toBe(0)
  })

  it("rejects entry with negative outputPerMillion", async () => {
    const result = await fetchWithEntry(
      "__test-neg-output__",
      makeValidEntry({ outputPerMillion: -5 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid outputPerMillion")
    expect(result.added).toBe(0)
  })

  it("rejects entry with non-number outputPerMillion", async () => {
    const result = await fetchWithEntry(
      "__test-str-output__",
      makeValidEntry({ outputPerMillion: "ten" }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid outputPerMillion")
    expect(result.added).toBe(0)
  })

  it("rejects entry with zero contextWindow", async () => {
    const result = await fetchWithEntry("__test-zero-ctx__", makeValidEntry({ contextWindow: 0 }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid contextWindow")
    expect(result.added).toBe(0)
  })

  it("rejects entry with negative contextWindow", async () => {
    const result = await fetchWithEntry("__test-neg-ctx__", makeValidEntry({ contextWindow: -100 }))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid contextWindow")
    expect(result.added).toBe(0)
  })

  it("rejects entry with non-number contextWindow", async () => {
    const result = await fetchWithEntry(
      "__test-str-ctx__",
      makeValidEntry({ contextWindow: "large" }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Invalid contextWindow")
    expect(result.added).toBe(0)
  })

  it("rejects entry with cachedInputDiscount > 1", async () => {
    const result = await fetchWithEntry(
      "__test-high-discount__",
      makeValidEntry({ cachedInputDiscount: 1.5 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("cachedInputDiscount must be between 0 and 1")
    expect(result.added).toBe(0)
  })

  it("rejects entry with cachedInputDiscount < 0", async () => {
    const result = await fetchWithEntry(
      "__test-neg-discount__",
      makeValidEntry({ cachedInputDiscount: -0.1 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("cachedInputDiscount must be between 0 and 1")
    expect(result.added).toBe(0)
  })

  it("rejects entry with negative maxOutputTokens", async () => {
    const result = await fetchWithEntry(
      "__test-neg-max-output__",
      makeValidEntry({ maxOutputTokens: -100 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("maxOutputTokens must be positive")
    expect(result.added).toBe(0)
  })

  it("rejects entry with zero maxOutputTokens", async () => {
    const result = await fetchWithEntry(
      "__test-zero-max-output__",
      makeValidEntry({ maxOutputTokens: 0 }),
    )
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("maxOutputTokens must be positive")
    expect(result.added).toBe(0)
  })

  it("accepts entry with inputPerMillion = 0 (free input)", async () => {
    const result = await fetchWithEntry(
      "__test-free-input__",
      makeValidEntry({ inputPerMillion: 0 }),
    )
    expect(result.errors).toHaveLength(0)
    expect(result.added).toBe(1)
    expect(PRICING_REGISTRY["__test-free-input__"].inputPerMillion).toBe(0)
  })

  it("accepts entry with outputPerMillion = 0 (free output)", async () => {
    const result = await fetchWithEntry(
      "__test-free-output__",
      makeValidEntry({ outputPerMillion: 0 }),
    )
    expect(result.errors).toHaveLength(0)
    expect(result.added).toBe(1)
    expect(PRICING_REGISTRY["__test-free-output__"].outputPerMillion).toBe(0)
  })

  it("accepts entry with cachedInputDiscount at boundary values (0 and 1)", async () => {
    const result0 = await fetchWithEntry(
      "__test-discount-0__",
      makeValidEntry({ cachedInputDiscount: 0 }),
    )
    expect(result0.errors).toHaveLength(0)
    expect(result0.added).toBe(1)

    const result1 = await fetchWithEntry(
      "__test-discount-1__",
      makeValidEntry({ cachedInputDiscount: 1 }),
    )
    expect(result1.errors).toHaveLength(0)
    expect(result1.added).toBe(1)
  })

  it("accepts entry with deprecated: true", async () => {
    const result = await fetchWithEntry("__test-deprecated__", makeValidEntry({ deprecated: true }))
    expect(result.errors).toHaveLength(0)
    expect(result.added).toBe(1)
    expect(PRICING_REGISTRY["__test-deprecated__"].deprecated).toBe(true)
  })

  it("handles entry that is a boolean (not an object)", async () => {
    const result = await fetchWithEntry("__test-bool__", true)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("Not an object")
    expect(result.added).toBe(0)
  })

  it("handles entry that is an empty object (missing all fields)", async () => {
    const result = await fetchWithEntry("__test-empty-obj__", {})
    expect(result.errors).toHaveLength(1)
    // Should fail at provider validation (first check)
    expect(result.errors[0]).toContain("Invalid provider")
    expect(result.added).toBe(0)
  })
})
