import { describe, it, expect } from "vitest"
import { promptCompression } from "../compression/compressor"
import { compressMessages } from "../compression/compressor"

describe("promptCompression", () => {
  it("compresses verbose prompts", () => {
    const text = "Please kindly analyze the following text. It is important to note that the text contains several verbose phrases. In order to achieve the best results, you should carefully consider each and every word. Furthermore, it should be noted that the text is quite long and contains a significant amount of redundancy."
    const result = promptCompression(text)
    expect(result.applied).toBe(true)
    expect(result.savedTokens).toBeGreaterThan(0)
    expect(result.compressedTokens).toBeLessThan(result.originalTokens)
  })

  it("preserves code blocks", () => {
    const text = "Please explain this code:\n```typescript\nconst x = 1;\n```\nIt is important to note that the code is simple."
    const result = promptCompression(text)
    expect(result.compressed).toContain("```typescript\nconst x = 1;\n```")
  })

  it("preserves URLs", () => {
    const text = "Please visit https://example.com/path?q=test for more info. It is important to note that this is a test."
    const result = promptCompression(text)
    expect(result.compressed).toContain("https://example.com/path?q=test")
  })

  it("preserves inline code", () => {
    const text = "The variable `myFunction` is certainly very important. Please analyze it."
    const result = promptCompression(text)
    expect(result.compressed).toContain("`myFunction`")
  })

  it("removes stopwords", () => {
    const text = "I would certainly really very much like you to basically just simply analyze this text for me please."
    const result = promptCompression(text)
    if (result.applied) {
      expect(result.compressed).not.toContain(" certainly ")
      expect(result.compressed).not.toContain(" basically ")
    }
  })

  it("contracts verbose patterns", () => {
    const text = "In order to achieve results, due to the fact that we need them, in the event that something happens, at this point in time we should act."
    const result = promptCompression(text)
    if (result.applied) {
      expect(result.compressed).not.toContain("in order to")
      expect(result.compressed).not.toContain("due to the fact that")
    }
  })

  it("deduplicates repeated sentences", () => {
    const text = "The sky is blue. The grass is green. The sky is blue. The sun is bright."
    const result = promptCompression(text)
    if (result.applied) {
      const matches = result.compressed.match(/sky is blue/gi)
      expect(matches?.length ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it("returns original for short prompts below threshold", () => {
    const result = promptCompression("Hello world")
    expect(result.applied).toBe(false)
    expect(result.compressed).toBe("Hello world")
  })

  it("respects disabled techniques", () => {
    const text = "Please kindly analyze the following text."
    const result = promptCompression(text, { stopwords: false, patterns: false })
    // With stopwords disabled, "please" and "kindly" should remain
    expect(result.compressed.toLowerCase()).toContain("please")
  })

  it("returns a valid compression ratio", () => {
    const text = "This is a test sentence that we want to compress. It is important to note that the test should work correctly. In order to verify this, we check the ratio."
    const result = promptCompression(text)
    expect(result.ratio).toBeGreaterThanOrEqual(0)
    expect(result.ratio).toBeLessThanOrEqual(1)
  })
})

describe("compressMessages", () => {
  it("only compresses user messages", () => {
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant. Please be very thorough." },
      { role: "user" as const, content: "Please kindly explain TypeScript in great detail. It is important to note that I am a beginner. Furthermore, I would like you to be thorough." },
      { role: "assistant" as const, content: "TypeScript is..." },
    ]
    const result = compressMessages(messages)
    // System message preserved
    expect(result.messages[0].content).toBe(messages[0].content)
    // Assistant message preserved
    expect(result.messages[2].content).toBe(messages[2].content)
    // User message may be compressed
    expect(result.perMessage[0].applied).toBe(false) // system
    expect(result.perMessage[2].applied).toBe(false) // assistant
  })

  it("reports total saved tokens", () => {
    const messages = [
      { role: "user" as const, content: "Please kindly analyze this. It is important to note that the analysis should be thorough. In order to achieve the best results, please be very detailed. Furthermore, it should be noted that completeness matters." },
    ]
    const result = compressMessages(messages)
    expect(result.totalSavedTokens).toBeGreaterThanOrEqual(0)
    expect(result.perMessage).toHaveLength(1)
  })
})
