import { describe, it, expect } from "vitest"
import { compressPrompt } from "../prompt-compressor"

describe("prompt compressor - ratio guard regression", () => {
  it("should not block legitimate stopword removal on short prompts", () => {
    // Regression: maxCompressionRatio guard (0.6) rejected stopword removal on short
    // prompts where removing filler words pushed ratio below the floor
    const text =
      "Please kindly explain basically what really happens very simply when you actually use forEach in order to iterate over arrays."
    const r = compressPrompt(text, {
      structural: false,
      stopwords: true,
      dedup: false,
      patterns: false,
      references: false,
      minSavingsTokens: 0,
    })
    // The text is full of stopwords — compression should be applied
    expect(r.applied).toBe(true)
    expect(r.savedTokens).toBeGreaterThan(0)
    expect(r.compressed).not.toContain("kindly")
    expect(r.compressed).not.toContain("basically")
  })
})
