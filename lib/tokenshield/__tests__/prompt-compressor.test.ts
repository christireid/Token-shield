import { describe, it, expect } from "vitest"
import { compressPrompt, compressMessages } from "../prompt-compressor"

describe("prompt-compressor", () => {
  describe("compressPrompt", () => {
    it("should compress verbose prompts with stopwords", () => {
      const verbose =
        "Please kindly analyze the following text and basically provide a very detailed summary of it. I would like you to ensure that you cover all the key points."
      const result = compressPrompt(verbose)
      expect(result.savedTokens).toBeGreaterThan(0)
      expect(result.compressedTokens).toBeLessThan(result.originalTokens)
      expect(result.applied).toBe(true)
    })

    it("should compress verbose pattern phrases", () => {
      const verbose =
        "In order to accomplish the task, due to the fact that the requirements are complex, it is important to note that we need a large number of test cases. Furthermore, in the event that something goes wrong, we should have a backup plan prepared."
      const result = compressPrompt(verbose)
      // Check that at least some verbose patterns were contracted
      expect(result.savedTokens).toBeGreaterThan(0)
      expect(result.compressedTokens).toBeLessThan(result.originalTokens)
    })

    it("should preserve code blocks verbatim", () => {
      const prompt = 'Here is some code:\n\n```javascript\nconst x = "please kindly";\nconsole.log(x);\n```\n\nPlease kindly explain it.'
      const result = compressPrompt(prompt)
      expect(result.compressed).toContain('const x = "please kindly"')
      expect(result.compressed).toContain("console.log(x)")
    })

    it("should preserve URLs verbatim", () => {
      const prompt =
        "Please kindly visit https://example.com/path?q=test and analyze the content."
      const result = compressPrompt(prompt)
      expect(result.compressed).toContain("https://example.com/path?q=test")
    })

    it("should preserve inline code verbatim", () => {
      const prompt =
        "Please kindly explain the `forEach` method and how it basically works."
      const result = compressPrompt(prompt)
      expect(result.compressed).toContain("`forEach`")
    })

    it("should remove duplicate sentences", () => {
      const prompt =
        "The system should be secure. The system should be fast. The system should be secure. Please analyze."
      const result = compressPrompt(prompt)
      // The second "The system should be secure" should be removed
      const matches = result.compressed.match(/system should be secure/gi)
      expect(matches?.length ?? 0).toBeLessThanOrEqual(1)
    })

    it("should not compress already-concise prompts below threshold", () => {
      const concise = "What is 2+2?"
      const result = compressPrompt(concise)
      // Should not apply compression if savings < minSavingsTokens
      expect(result.compressed).toBe(concise)
    })

    it("should respect maxCompressionRatio", () => {
      const prompt = "Please. Please. Please. Please. Please."
      const result = compressPrompt(prompt, { maxCompressionRatio: 0.9 })
      // If compression would remove too much, it returns original
      if (result.ratio < 0.9) {
        expect(result.applied).toBe(false)
        expect(result.compressed).toBe(prompt)
      }
    })

    it("should collapse structural whitespace", () => {
      const prompt = "First point about something important.\n\n\n\n\nSecond point about another important thing.\n\n\n\nThird point about yet another topic that is relevant to our discussion.\n\n\n\n\nFourth point about the final considerations."
      const result = compressPrompt(prompt, { minSavingsTokens: 1 })
      if (result.applied) {
        expect(result.compressed).not.toContain("\n\n\n")
      }
    })

    it("should allow disabling individual techniques", () => {
      const prompt =
        "Please kindly analyze in order to understand the implications."
      const noStopwords = compressPrompt(prompt, { stopwords: false })
      const withStopwords = compressPrompt(prompt, { stopwords: true })
      // With stopwords enabled should save more
      expect(withStopwords.savedTokens).toBeGreaterThanOrEqual(
        noStopwords.savedTokens
      )
    })

    it("should return correct ratio", () => {
      const prompt =
        "Please kindly ensure that you basically analyze this very important text for the purpose of understanding it."
      const result = compressPrompt(prompt)
      if (result.applied) {
        expect(result.ratio).toBeLessThan(1)
        expect(result.ratio).toBeGreaterThan(0)
        expect(result.ratio).toBeCloseTo(
          result.compressedTokens / result.originalTokens,
          2
        )
      }
    })

    it("should preserve intentional markdown emphasis in longer text", () => {
      const prompt =
        "You must follow these rules *exactly* as written. The **critical** requirement is that all outputs must be in JSON format. Furthermore the system should be very robust."
      const result = compressPrompt(prompt, { minSavingsTokens: 1 })
      // Longer bold/italic emphasis should be preserved — only short label-like **X**: patterns are stripped
      if (result.applied) {
        expect(result.compressed).toContain("*exactly*")
      }
    })

    it("should use split/join for placeholder restoration to handle edge cases", () => {
      // The restorePreserved function should replace ALL occurrences of a placeholder,
      // not just the first (which string.replace() does)
      const prompt = "Check `code1` and also `code2` and explain them clearly."
      const result = compressPrompt(prompt, { minSavingsTokens: 0 })
      expect(result.compressed).toContain("`code1`")
      expect(result.compressed).toContain("`code2`")
    })
  })

  describe("compressMessages", () => {
    it("should only compress user messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant. Please kindly help with the task at hand." },
        { role: "user", content: "Please kindly explain what basically happens when you use forEach in order to iterate over arrays. I would like you to ensure that you cover all the important details and it is important to note that the explanation should be very thorough and comprehensive." },
        { role: "assistant", content: "forEach iterates over array elements." },
      ]
      const result = compressMessages(messages, { minSavingsTokens: 1 })
      // System message should be unchanged
      expect(result.messages[0].content).toBe(messages[0].content)
      // Assistant message should be unchanged
      expect(result.messages[2].content).toBe(messages[2].content)
      // User message may be compressed
      expect(result.perMessage[1].originalTokens).toBeGreaterThan(0)
    })

    it("should track per-message results", () => {
      const messages = [
        { role: "user", content: "Please kindly analyze this basically very important text." },
        { role: "user", content: "What is 2+2?" },
      ]
      const result = compressMessages(messages)
      expect(result.perMessage).toHaveLength(2)
      expect(result.perMessage[0].originalTokens).toBeGreaterThan(0)
    })
  })
})
