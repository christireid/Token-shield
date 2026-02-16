import { describe, it, expect } from "vitest"
import {
  encodeDelta,
  analyzeRedundancy,
  type DeltaEncoderConfig,
  type DeltaResult,
} from "../delta-encoder"
import {
  encodeDelta as originalEncodeDelta,
  analyzeRedundancy as originalAnalyzeRedundancy,
} from "../conversation-delta-encoder"

describe("delta-encoder re-export", () => {
  it("re-exports encodeDelta from conversation-delta-encoder", () => {
    expect(encodeDelta).toBe(originalEncodeDelta)
  })

  it("re-exports analyzeRedundancy from conversation-delta-encoder", () => {
    expect(analyzeRedundancy).toBe(originalAnalyzeRedundancy)
  })

  it("encodeDelta works via the re-export alias", () => {
    const messages = [
      { role: "user", content: "What is the capital of France?" },
      { role: "assistant", content: "The capital of France is Paris." },
      { role: "user", content: "What is the capital of France? Tell me more about it." },
    ]
    const result: DeltaResult = encodeDelta(messages)
    expect(result).toHaveProperty("messages")
    expect(result).toHaveProperty("savedTokens")
    expect(result).toHaveProperty("applied")
  })

  it("analyzeRedundancy works via the re-export alias", () => {
    const messages = [
      { role: "user", content: "Hello world" },
      { role: "assistant", content: "Hello world repeated" },
      { role: "user", content: "Hello world again" },
    ]
    const analysis = analyzeRedundancy(messages)
    expect(analysis).toHaveProperty("redundancyPercent")
    expect(typeof analysis.redundancyPercent).toBe("number")
  })
})
