import { describe, it, expect } from "vitest"
import {
  countExactTokens,
  countChatTokens,
  fitsInBudget,
  encodeText,
  decodeTokens,
  truncateToTokenBudget,
  countModelTokens,
  countFast,
  getTokenizerAccuracy,
} from "./token-counter"

describe("token-counter", () => {
  describe("countExactTokens", () => {
    it("counts tokens for English text", () => {
      const result = countExactTokens("Hello, world!")
      expect(result.tokens).toBeGreaterThan(0)
      expect(result.characters).toBe(13)
      expect(result.ratio).toBeGreaterThan(0)
    })

    it("returns tokens=0 for empty string (ratio clamped to 1)", () => {
      const result = countExactTokens("")
      expect(result.tokens).toBe(0)
      expect(result.characters).toBe(0)
      // ratio uses Math.max(tokens, 1) to avoid division by zero
      expect(result.ratio).toBe(0)
    })
  })

  describe("countChatTokens", () => {
    it("counts tokens for a simple conversation", () => {
      const result = countChatTokens([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" },
      ])
      expect(result.total).toBeGreaterThan(0)
      expect(result.perMessage).toHaveLength(2)
      expect(result.overhead).toBeGreaterThan(0)
    })

    it("includes name overhead when name is present", () => {
      const withoutName = countChatTokens([{ role: "user", content: "Hello!" }])
      const withName = countChatTokens([{ role: "user", content: "Hello!", name: "Alice" }])
      expect(withName.total).toBeGreaterThan(withoutName.total)
    })

    it("truncates long content in perMessage output", () => {
      const longContent = "a".repeat(200)
      const result = countChatTokens([{ role: "user", content: longContent }])
      expect(result.perMessage[0].content.length).toBeLessThan(200)
      expect(result.perMessage[0].content).toContain("...")
    })
  })

  describe("fitsInBudget", () => {
    it("returns fits=true when within budget", () => {
      const result = fitsInBudget("Hello", 100)
      expect(result.fits).toBe(true)
      expect(result.tokenCount).not.toBe(false)
    })

    it("returns fits=false when over budget", () => {
      const longText = "word ".repeat(1000)
      const result = fitsInBudget(longText, 5)
      expect(result.fits).toBe(false)
      expect(result.tokenCount).toBe(false)
    })
  })

  describe("encode/decode roundtrip", () => {
    it("roundtrips text through encode/decode", () => {
      const text = "The quick brown fox"
      const tokens = encodeText(text)
      const decoded = decodeTokens(tokens)
      expect(decoded).toBe(text)
    })
  })

  describe("truncateToTokenBudget", () => {
    it("does not truncate short text", () => {
      const result = truncateToTokenBudget("Hello", 100)
      expect(result.truncated).toBe(false)
      expect(result.text).toBe("Hello")
      expect(result.originalTokens).toBe(result.finalTokens)
    })

    it("truncates long text to budget", () => {
      const longText = "word ".repeat(500)
      const result = truncateToTokenBudget(longText, 10)
      expect(result.truncated).toBe(true)
      expect(result.finalTokens).toBe(10)
      expect(result.originalTokens).toBeGreaterThan(10)
    })
  })

  describe("countModelTokens", () => {
    it("counts tokens for any model ID", () => {
      const count = countModelTokens("gpt-4o-mini", "Hello, world!")
      expect(count).toBeGreaterThan(0)
    })
  })

  describe("countFast", () => {
    it("returns 0 for empty string", () => {
      expect(countFast("")).toBe(0)
    })

    it("returns at least 1 for non-empty text", () => {
      expect(countFast("hi")).toBeGreaterThanOrEqual(1)
    })

    it("estimates higher token count for CJK text per character", () => {
      // CJK uses ~1.5 chars/token vs ~4 chars/token for English
      const cjk = "\u4e00".repeat(100)
      const eng = "a".repeat(100)
      expect(countFast(cjk)).toBeGreaterThan(countFast(eng))
    })
  })

  describe("getTokenizerAccuracy", () => {
    it("returns exact accuracy for OpenAI models", () => {
      const result = getTokenizerAccuracy("gpt-4o-mini")
      expect(result.accuracy).toBe("exact")
      expect(result.provider).toBe("openai")
      expect(result.marginOfError).toBe(0)
    })

    it("returns approximate accuracy for Anthropic models", () => {
      const result = getTokenizerAccuracy("claude-sonnet-4-5-20250514")
      expect(result.accuracy).toBe("approximate")
      expect(result.provider).toBe("anthropic")
      expect(result.marginOfError).toBe(0.35)
    })

    it("returns approximate accuracy for Google models", () => {
      const result = getTokenizerAccuracy("gemini-1.5-pro")
      expect(result.accuracy).toBe("approximate")
      expect(result.provider).toBe("google")
      expect(result.marginOfError).toBe(0.15)
    })

    it("returns approximate accuracy for open-source models (llama)", () => {
      const result = getTokenizerAccuracy("llama-3.1-70b")
      expect(result.accuracy).toBe("approximate")
      expect(result.provider).toBe("open-source")
      expect(result.marginOfError).toBe(0.15)
    })

    it("returns approximate accuracy for Mistral models", () => {
      const result = getTokenizerAccuracy("mistral-large-latest")
      expect(result.accuracy).toBe("approximate")
      expect(result.provider).toBe("open-source")
    })

    it("returns approximate accuracy for Mixtral models", () => {
      const result = getTokenizerAccuracy("mixtral-8x7b")
      expect(result.accuracy).toBe("approximate")
      expect(result.provider).toBe("open-source")
    })

    it("is case-insensitive", () => {
      expect(getTokenizerAccuracy("CLAUDE-3-OPUS").provider).toBe("anthropic")
      expect(getTokenizerAccuracy("GEMINI-PRO").provider).toBe("google")
    })

    it("defaults to exact/openai for unknown models", () => {
      const result = getTokenizerAccuracy("some-unknown-model")
      expect(result.accuracy).toBe("exact")
      expect(result.provider).toBe("openai")
    })
  })
})
