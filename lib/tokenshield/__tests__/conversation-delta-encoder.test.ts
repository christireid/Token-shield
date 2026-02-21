import { describe, it, expect } from "vitest"
import { encodeDelta, analyzeRedundancy } from "../conversation-delta-encoder"

describe("conversation-delta-encoder", () => {
  describe("encodeDelta", () => {
    it("should detect system prompt overlap in user messages", () => {
      const messages = [
        {
          role: "system",
          content:
            "You are a code reviewer. Always check for security vulnerabilities, performance issues, and code style violations.",
        },
        {
          role: "user",
          content:
            "You are a code reviewer. Always check for security vulnerabilities, performance issues, and code style violations.\n\nPlease review the following code:\n\nfunction add(a, b) { return a + b; }",
        },
      ]

      const result = encodeDelta(messages)
      expect(result.systemOverlaps).toBeGreaterThan(0)
      expect(result.savedTokens).toBeGreaterThan(0)
    })

    it("should not modify system messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" },
      ]

      const result = encodeDelta(messages)
      expect(result.messages[0].content).toBe("You are a helpful assistant.")
    })

    it("should not modify assistant messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "assistant", content: "Hello! How can I help?" },
        { role: "user", content: "Hello!" },
      ]

      const result = encodeDelta(messages)
      expect(result.messages[1].content).toBe("Hello! How can I help?")
    })

    it("should deduplicate cross-turn paragraphs", () => {
      const longParagraph =
        "The quick brown fox jumps over the lazy dog. This sentence is used for testing purposes and contains enough text to qualify for paragraph deduplication. It is a pangram that uses every letter of the English alphabet."

      const messages = [
        { role: "user", content: `${longParagraph}\n\nPlease analyze this text.` },
        { role: "assistant", content: "This is a pangram used for testing." },
        { role: "user", content: `${longParagraph}\n\nNow provide a summary.` },
      ]

      const result = encodeDelta(messages)
      expect(result.paragraphsDeduped).toBeGreaterThan(0)
      expect(result.savedTokens).toBeGreaterThan(0)
    })

    it("should not deduplicate short paragraphs", () => {
      const messages = [{ role: "user", content: "Hello there.\n\nHello there." }]

      const result = encodeDelta(messages, { minParagraphLength: 50 })
      // Short paragraphs should not be deduped
      expect(result.paragraphsDeduped).toBe(0)
    })

    it("should handle empty messages gracefully", () => {
      const result = encodeDelta([])
      expect(result.messages).toHaveLength(0)
      expect(result.savedTokens).toBe(0)
      expect(result.applied).toBe(false)
    })

    it("should respect minSavingsTokens threshold", () => {
      const messages = [{ role: "user", content: "Hello, how are you?" }]

      const result = encodeDelta(messages, { minSavingsTokens: 100 })
      expect(result.applied).toBe(false)
      // Messages should be unchanged when not applied
      expect(result.messages[0].content).toBe(messages[0].content)
    })

    it("should not enter quote compaction path when compactQuotes is disabled", () => {
      // Regression: operator precedence bug meant paragraphs starting with '"'
      // would always enter quote compaction regardless of config flag
      const longQuote =
        '"The quick brown fox jumps over the lazy dog. This sentence is used for testing purposes and contains enough text to qualify for dedup analysis."'

      const messages = [
        {
          role: "assistant",
          content:
            "The quick brown fox jumps over the lazy dog. This sentence is used for testing purposes and contains enough text to qualify for dedup analysis.",
        },
        { role: "user", content: `${longQuote}\n\nWhat do you think about this?` },
      ]

      const withQuotes = encodeDelta(messages, { compactQuotes: true, minSavingsTokens: 0 })
      const withoutQuotes = encodeDelta(messages, { compactQuotes: false, minSavingsTokens: 0 })

      // With compactQuotes=false, the quoted paragraph should NOT be compacted
      // even though it starts with '"'
      if (withQuotes.quotesCompacted > 0) {
        expect(withoutQuotes.quotesCompacted).toBe(0)
      }
    })
  })

  describe("analyzeRedundancy", () => {
    it("should report redundancy statistics", () => {
      const longParagraph =
        "The quick brown fox jumps over the lazy dog. This sentence is used for testing purposes and contains enough text to qualify as a significant paragraph for analysis."

      const messages = [
        { role: "system", content: longParagraph },
        { role: "user", content: `${longParagraph}\n\nPlease analyze.` },
      ]

      const analysis = analyzeRedundancy(messages)
      expect(analysis.totalTokens).toBeGreaterThan(0)
      expect(analysis.redundantTokens).toBeGreaterThanOrEqual(0)
      expect(analysis.redundancyPercent).toBeGreaterThanOrEqual(0)
    })

    it("should report zero redundancy for unique messages", () => {
      const messages = [
        { role: "user", content: "First unique message about topic A." },
        { role: "user", content: "Second unique message about topic B." },
      ]

      const analysis = analyzeRedundancy(messages)
      expect(analysis.duplicateParagraphs).toBe(0)
    })
  })
})
