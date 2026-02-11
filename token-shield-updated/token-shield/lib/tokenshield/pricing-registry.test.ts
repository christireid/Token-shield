import { describe, it, expect, beforeEach } from "vitest";
import {
  PRICING_REGISTRY,
  registerModel,
  getModelPricing,
  getModelsByProvider,
  type ModelPricingEntry,
} from "./pricing-registry";

describe("PRICING_REGISTRY", () => {
  // -----------------------------------------------------------------------
  // 1. Registry has entries for openai, anthropic, google
  // -----------------------------------------------------------------------
  it("contains entries from openai, anthropic, and google providers", () => {
    const providers = new Set(
      Object.values(PRICING_REGISTRY).map((e) => e.provider)
    );
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("google")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 10. All entries have required fields
  // -----------------------------------------------------------------------
  it("has all required fields on every entry", () => {
    for (const [key, entry] of Object.entries(PRICING_REGISTRY)) {
      expect(entry.id).toBe(key);
      expect(typeof entry.provider).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.inputPerMillion).toBe("number");
      expect(typeof entry.outputPerMillion).toBe("number");
      expect(typeof entry.cachedInputDiscount).toBe("number");
      expect(typeof entry.contextWindow).toBe("number");
      expect(typeof entry.maxOutputTokens).toBe("number");
      expect(typeof entry.supportsVision).toBe("boolean");
      expect(typeof entry.supportsFunctions).toBe("boolean");
      expect(entry.inputPerMillion).toBeGreaterThanOrEqual(0);
      expect(entry.outputPerMillion).toBeGreaterThanOrEqual(0);
      expect(entry.cachedInputDiscount).toBeGreaterThanOrEqual(0);
      expect(entry.cachedInputDiscount).toBeLessThanOrEqual(1);
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.maxOutputTokens).toBeGreaterThan(0);
    }
  });

  it("has a known set of specific models", () => {
    expect(PRICING_REGISTRY["gpt-4o"]).toBeDefined();
    expect(PRICING_REGISTRY["claude-sonnet-4"]).toBeDefined();
    expect(PRICING_REGISTRY["gemini-2.0-flash"]).toBeDefined();
    expect(PRICING_REGISTRY["gpt-4o-mini"]).toBeDefined();
    expect(PRICING_REGISTRY["claude-haiku-3.5"]).toBeDefined();
  });
});

describe("getModelPricing", () => {
  // -----------------------------------------------------------------------
  // 2. Exact match returns correct entry
  // -----------------------------------------------------------------------
  it("returns the correct entry for an exact match", () => {
    const entry = getModelPricing("gpt-4o");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("gpt-4o");
    expect(entry!.provider).toBe("openai");
    expect(entry!.inputPerMillion).toBe(2.5);
    expect(entry!.outputPerMillion).toBe(10.0);
  });

  it("returns the correct entry for claude-sonnet-4", () => {
    const entry = getModelPricing("claude-sonnet-4");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("claude-sonnet-4");
    expect(entry!.provider).toBe("anthropic");
    expect(entry!.inputPerMillion).toBe(3.0);
  });

  // -----------------------------------------------------------------------
  // 3. Prefix match: "gpt-4o-2024-11-20" matches "gpt-4o"
  // -----------------------------------------------------------------------
  it("falls back to prefix matching for versioned model IDs", () => {
    const entry = getModelPricing("gpt-4o-2024-11-20");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("gpt-4o");
  });

  it("prefix matches claude-sonnet-4-20250514", () => {
    const entry = getModelPricing("claude-sonnet-4-20250514");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("claude-sonnet-4");
  });

  // -----------------------------------------------------------------------
  // 4. Returns undefined for unknown model
  // -----------------------------------------------------------------------
  it("returns undefined for a completely unknown model", () => {
    const entry = getModelPricing("totally-unknown-model-xyz");
    expect(entry).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    const entry = getModelPricing("");
    expect(entry).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 5. Picks the longest prefix match
  // -----------------------------------------------------------------------
  it("picks the longest prefix match when multiple entries match", () => {
    // "gpt-4o-mini-2024-07-18" should match "gpt-4o-mini" (longer prefix)
    // rather than "gpt-4o" (shorter prefix), since both are prefixes.
    const entry = getModelPricing("gpt-4o-mini-2024-07-18");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("gpt-4o-mini");
  });

  it("picks gpt-4.1-mini over gpt-4.1 for gpt-4.1-mini-2025-04-14", () => {
    const entry = getModelPricing("gpt-4.1-mini-2025-04-14");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("gpt-4.1-mini");
  });
});

describe("registerModel", () => {
  const customModel: ModelPricingEntry = {
    id: "custom-model-v1",
    provider: "openai",
    name: "Custom Model V1",
    inputPerMillion: 1.0,
    outputPerMillion: 3.0,
    cachedInputDiscount: 0.5,
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsVision: false,
    supportsFunctions: true,
  };

  // Clean up after tests that modify the registry
  const registeredKeys: string[] = [];

  // Helper to register and track for cleanup
  function registerAndTrack(entry: ModelPricingEntry) {
    registerModel(entry);
    registeredKeys.push(entry.id);
  }

  // We cannot use afterEach from vitest without import, so we clean inline
  // Actually, let's ensure we don't permanently pollute the registry:

  // -----------------------------------------------------------------------
  // 6. registerModel adds new entry
  // -----------------------------------------------------------------------
  it("adds a new model entry to the registry", () => {
    registerAndTrack(customModel);

    const entry = PRICING_REGISTRY["custom-model-v1"];
    expect(entry).toBeDefined();
    expect(entry.id).toBe("custom-model-v1");
    expect(entry.name).toBe("Custom Model V1");
    expect(entry.inputPerMillion).toBe(1.0);

    // Also findable via getModelPricing
    const found = getModelPricing("custom-model-v1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("custom-model-v1");

    // Clean up
    delete PRICING_REGISTRY["custom-model-v1"];
  });

  // -----------------------------------------------------------------------
  // 7. registerModel overwrites existing entry
  // -----------------------------------------------------------------------
  it("overwrites an existing entry with the same id", () => {
    const originalEntry = { ...PRICING_REGISTRY["gpt-4o"] };

    const updatedEntry: ModelPricingEntry = {
      ...originalEntry,
      inputPerMillion: 99.99,
      name: "GPT-4o Updated",
    };

    registerModel(updatedEntry);

    expect(PRICING_REGISTRY["gpt-4o"].inputPerMillion).toBe(99.99);
    expect(PRICING_REGISTRY["gpt-4o"].name).toBe("GPT-4o Updated");

    // Restore original
    registerModel(originalEntry);
    expect(PRICING_REGISTRY["gpt-4o"].inputPerMillion).toBe(
      originalEntry.inputPerMillion
    );
  });

  it("makes newly registered models available via prefix matching", () => {
    registerAndTrack({
      id: "my-fine-tune",
      provider: "openai",
      name: "My Fine-Tune",
      inputPerMillion: 5.0,
      outputPerMillion: 15.0,
      cachedInputDiscount: 0.5,
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctions: true,
    });

    const entry = getModelPricing("my-fine-tune-v2-snapshot");
    expect(entry).toBeDefined();
    expect(entry!.id).toBe("my-fine-tune");

    // Clean up
    delete PRICING_REGISTRY["my-fine-tune"];
  });
});

describe("getModelsByProvider", () => {
  // -----------------------------------------------------------------------
  // 8. getModelsByProvider returns only matching provider models
  // -----------------------------------------------------------------------
  it('returns only openai models for provider "openai"', () => {
    const models = getModelsByProvider("openai");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.provider).toBe("openai");
    }
  });

  it('returns only anthropic models for provider "anthropic"', () => {
    const models = getModelsByProvider("anthropic");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.provider).toBe("anthropic");
    }
  });

  it('returns only google models for provider "google"', () => {
    const models = getModelsByProvider("google");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.provider).toBe("google");
    }
  });

  // -----------------------------------------------------------------------
  // 9. getModelsByProvider returns empty array for unknown provider
  // -----------------------------------------------------------------------
  it("returns an empty array for an unknown provider", () => {
    const models = getModelsByProvider("unknown");
    expect(models).toEqual([]);
  });

  it("returns an empty array for an empty string provider", () => {
    const models = getModelsByProvider("");
    expect(models).toEqual([]);
  });

  it("contains known models in the correct provider group", () => {
    const openai = getModelsByProvider("openai");
    const openaiIds = openai.map((m) => m.id);
    expect(openaiIds).toContain("gpt-4o");
    expect(openaiIds).toContain("gpt-4o-mini");

    const anthropic = getModelsByProvider("anthropic");
    const anthropicIds = anthropic.map((m) => m.id);
    expect(anthropicIds).toContain("claude-sonnet-4");
    expect(anthropicIds).toContain("claude-haiku-3.5");

    const google = getModelsByProvider("google");
    const googleIds = google.map((m) => m.id);
    expect(googleIds).toContain("gemini-2.0-flash");
    expect(googleIds).toContain("gemini-1.5-pro");
  });
});
