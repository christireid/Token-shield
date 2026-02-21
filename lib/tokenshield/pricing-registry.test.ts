/**
 * Pricing Registry Tests
 *
 * Tests for PRICING_REGISTRY data, registerModel, getModelPricing,
 * and getModelsByProvider.
 */

import { describe, it, expect, afterEach } from "vitest"
import {
  PRICING_REGISTRY,
  registerModel,
  getModelPricing,
  getModelsByProvider,
  fetchLatestPricing,
  type ModelPricingEntry,
} from "./pricing-registry"

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

describe("fetchLatestPricing", () => {
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
})
