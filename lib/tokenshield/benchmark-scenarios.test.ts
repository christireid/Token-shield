/**
 * Benchmark Scenarios Tests
 *
 * Tests for the data generators: generateWords, generateChatMessages,
 * generateContextMessages.
 */

import { describe, it, expect } from "vitest"
import {
  generateWords,
  generateChatMessages,
  generateContextMessages,
} from "./benchmark-scenarios"

describe("generateWords", () => {
  it("generates the requested number of words", () => {
    const result = generateWords(10)
    expect(result.split(" ")).toHaveLength(10)
  })

  it("generates 0 words for count=0", () => {
    const result = generateWords(0)
    expect(result).toBe("")
  })

  it("generates 1 word for count=1", () => {
    const result = generateWords(1)
    expect(result.split(" ")).toHaveLength(1)
    expect(result.length).toBeGreaterThan(0)
  })

  it("returns a string (not empty for count>0)", () => {
    const result = generateWords(50)
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  it("wraps vocabulary when count exceeds vocabulary size", () => {
    const result = generateWords(100)
    const words = result.split(" ")
    expect(words).toHaveLength(100)
    // The vocabulary is finite, so with 100 words there must be repeats
    const unique = new Set(words)
    expect(unique.size).toBeLessThan(100)
  })

  it("is deterministic for the same count", () => {
    const a = generateWords(20)
    const b = generateWords(20)
    expect(a).toBe(b)
  })
})

describe("generateChatMessages", () => {
  it("includes a system message as first element", () => {
    const messages = generateChatMessages(4)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toBeTruthy()
  })

  it("generates count+1 messages (1 system + count turns)", () => {
    const messages = generateChatMessages(6)
    expect(messages).toHaveLength(7) // 1 system + 6 turns
  })

  it("alternates user and assistant roles", () => {
    const messages = generateChatMessages(4)
    // messages[0] is system, messages[1] is user, [2] assistant, [3] user, [4] assistant
    expect(messages[1].role).toBe("user")
    expect(messages[2].role).toBe("assistant")
    expect(messages[3].role).toBe("user")
    expect(messages[4].role).toBe("assistant")
  })

  it("generates 0 turns correctly (just system message)", () => {
    const messages = generateChatMessages(0)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe("system")
  })

  it("includes message number in content", () => {
    const messages = generateChatMessages(3)
    expect(messages[1].content).toContain("message number 1")
    expect(messages[2].content).toContain("message number 2")
    expect(messages[3].content).toContain("message number 3")
  })

  it("all messages have non-empty content", () => {
    const messages = generateChatMessages(10)
    for (const m of messages) {
      expect(m.content.length).toBeGreaterThan(0)
    }
  })
})

describe("generateContextMessages", () => {
  it("includes a system message as first element", () => {
    const messages = generateContextMessages(4)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toBe("You are a helpful assistant.")
  })

  it("generates count+1 messages (1 system + count turns)", () => {
    const messages = generateContextMessages(8)
    expect(messages).toHaveLength(9) // 1 system + 8 turns
  })

  it("alternates user and assistant roles", () => {
    const messages = generateContextMessages(4)
    expect(messages[1].role).toBe("user")
    expect(messages[2].role).toBe("assistant")
    expect(messages[3].role).toBe("user")
    expect(messages[4].role).toBe("assistant")
  })

  it("includes turn number in content", () => {
    const messages = generateContextMessages(3)
    expect(messages[1].content).toContain("Turn 1:")
    expect(messages[2].content).toContain("Turn 2:")
    expect(messages[3].content).toContain("Turn 3:")
  })

  it("generates 0 turns correctly", () => {
    const messages = generateContextMessages(0)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe("system")
  })
})
