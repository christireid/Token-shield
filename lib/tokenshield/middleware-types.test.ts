/**
 * Middleware Types & Helpers Tests
 *
 * Direct unit tests for the shared helper functions:
 * extractLastUserText() and safeCost()
 */

import { describe, it, expect } from "vitest"
import {
  extractLastUserText,
  safeCost,
  SHIELD_META,
  MSG_OVERHEAD_TOKENS,
  FALLBACK_INPUT_PER_MILLION,
  FALLBACK_OUTPUT_PER_MILLION,
} from "./middleware-types"

describe("extractLastUserText", () => {
  it("extracts text from the last user message", () => {
    const params = {
      prompt: [
        { role: "system", content: [{ type: "text", text: "You are helpful." }] },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi!" }] },
        { role: "user", content: [{ type: "text", text: "How are you?" }] },
      ],
    }
    expect(extractLastUserText(params)).toBe("How are you?")
  })

  it("joins multiple text parts in the same message", () => {
    const params = {
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Part 1. " },
            { type: "text", text: "Part 2." },
          ],
        },
      ],
    }
    expect(extractLastUserText(params)).toBe("Part 1. Part 2.")
  })

  it("filters out non-text parts (e.g. images)", () => {
    const params = {
      prompt: [
        {
          role: "user",
          content: [
            { type: "image", url: "https://example.com/img.png" },
            { type: "text", text: "Describe this image" },
          ],
        },
      ],
    }
    expect(extractLastUserText(params)).toBe("Describe this image")
  })

  it("returns empty string when no prompt", () => {
    expect(extractLastUserText({})).toBe("")
  })

  it("returns empty string when prompt is not an array", () => {
    expect(extractLastUserText({ prompt: "just a string" })).toBe("")
  })

  it("returns empty string when no user messages", () => {
    const params = {
      prompt: [{ role: "system", content: [{ type: "text", text: "System message" }] }],
    }
    expect(extractLastUserText(params)).toBe("")
  })

  it("handles user message with no content", () => {
    const params = {
      prompt: [{ role: "user", content: [] }],
    }
    expect(extractLastUserText(params)).toBe("")
  })

  it("handles text parts with undefined text field", () => {
    const params = {
      prompt: [{ role: "user", content: [{ type: "text" }] }],
    }
    expect(extractLastUserText(params)).toBe("")
  })
})

describe("safeCost", () => {
  it("returns real cost for known models", () => {
    const cost = safeCost("gpt-4o-mini", 1000, 500)
    expect(cost).toBeGreaterThan(0)
  })

  it("returns fallback cost for unknown models", () => {
    const cost = safeCost("totally-unknown-model-xyz", 1_000_000, 1_000_000)
    // Fallback: $0.15/M input + $0.60/M output = $0.75
    const expected = FALLBACK_INPUT_PER_MILLION + FALLBACK_OUTPUT_PER_MILLION
    expect(cost).toBeCloseTo(expected, 2)
  })

  it("never returns 0 for nonzero token counts (even unknown models)", () => {
    const cost = safeCost("unknown-model", 100, 100)
    expect(cost).toBeGreaterThan(0)
  })

  it("returns 0 for zero tokens", () => {
    const cost = safeCost("gpt-4o-mini", 0, 0)
    expect(cost).toBe(0)
  })

  it("fallback uses conservative pricing", () => {
    // Verify fallback rates are reasonable (not absurdly high or low)
    expect(FALLBACK_INPUT_PER_MILLION).toBeGreaterThan(0.01)
    expect(FALLBACK_INPUT_PER_MILLION).toBeLessThan(50)
    expect(FALLBACK_OUTPUT_PER_MILLION).toBeGreaterThan(0.01)
    expect(FALLBACK_OUTPUT_PER_MILLION).toBeLessThan(200)
  })
})

describe("constants", () => {
  it("SHIELD_META is a unique symbol", () => {
    expect(typeof SHIELD_META).toBe("symbol")
    expect(SHIELD_META.toString()).toContain("tokenshield")
  })

  it("MSG_OVERHEAD_TOKENS is a positive integer", () => {
    expect(MSG_OVERHEAD_TOKENS).toBeGreaterThan(0)
    expect(Number.isInteger(MSG_OVERHEAD_TOKENS)).toBe(true)
  })

  it("SHIELD_META cannot collide with string keys", () => {
    const obj: Record<string | symbol, unknown> = {}
    obj[SHIELD_META] = "via symbol"
    obj["SHIELD_META"] = "via string"
    // Both coexist without collision
    expect(obj[SHIELD_META]).toBe("via symbol")
    expect(obj["SHIELD_META"]).toBe("via string")
  })
})
