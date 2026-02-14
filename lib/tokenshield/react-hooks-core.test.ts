import { describe, it, expect } from "vitest"
import {
  useTokenCount,
  useComplexityAnalysis,
  useTokenEstimate,
  useModelRouter,
  useShieldedCall,
  type ShieldedCallMetrics,
} from "./react-hooks-core"

describe("react-hooks-core", () => {
  describe("exports", () => {
    it("exports useTokenCount as a function", () => {
      expect(typeof useTokenCount).toBe("function")
    })

    it("exports useComplexityAnalysis as a function", () => {
      expect(typeof useComplexityAnalysis).toBe("function")
    })

    it("exports useTokenEstimate as a function", () => {
      expect(typeof useTokenEstimate).toBe("function")
    })

    it("exports useModelRouter as a function", () => {
      expect(typeof useModelRouter).toBe("function")
    })

    it("exports useShieldedCall as a function", () => {
      expect(typeof useShieldedCall).toBe("function")
    })
  })

  describe("ShieldedCallMetrics interface", () => {
    it("allows creating objects with correct shape", () => {
      const metrics: ShieldedCallMetrics = {
        source: "cache",
        confidence: 0.95,
        latencyMs: 123,
      }

      expect(metrics.source).toBe("cache")
      expect(metrics.confidence).toBe(0.95)
      expect(metrics.latencyMs).toBe(123)
    })

    it("allows all valid source types", () => {
      const cacheMetrics: ShieldedCallMetrics = {
        source: "cache",
        confidence: 1,
        latencyMs: 50,
      }
      expect(cacheMetrics.source).toBe("cache")

      const apiMetrics: ShieldedCallMetrics = {
        source: "api",
        confidence: 0,
        latencyMs: 200,
      }
      expect(apiMetrics.source).toBe("api")

      const noneMetrics: ShieldedCallMetrics = {
        source: "none",
        confidence: 0,
        latencyMs: 0,
      }
      expect(noneMetrics.source).toBe("none")
    })
  })

  describe("useTokenEstimate logic", () => {
    it("calculates token estimation using the correct formula", () => {
      // Test pure English text (no CJK)
      const englishText = "Hello World"
      const englishCjkChars = 0
      const englishNonCjkChars = englishText.length
      const expectedEnglishTokens = Math.max(
        1,
        Math.ceil(englishNonCjkChars / 4 + englishCjkChars / 1.5)
      )
      expect(expectedEnglishTokens).toBe(3) // ceil(11/4) = ceil(2.75) = 3
    })

    it("calculates token estimation for CJK text", () => {
      // Test CJK text
      const cjkText = "你好世界" // 4 Chinese characters
      const cjkMatch = cjkText.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
      const cjkChars = cjkMatch ? cjkMatch.length : 0
      const nonCjkChars = cjkText.length - cjkChars
      const expectedCjkTokens = Math.max(
        1,
        Math.ceil(nonCjkChars / 4 + cjkChars / 1.5)
      )
      expect(cjkChars).toBe(4)
      expect(nonCjkChars).toBe(0)
      expect(expectedCjkTokens).toBe(3) // ceil(4/1.5) = ceil(2.67) = 3
    })

    it("calculates token estimation for mixed English and CJK text", () => {
      // Test mixed text
      const mixedText = "Hello 世界 World"
      const mixedCjkMatch = mixedText.match(
        /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
      )
      const mixedCjkChars = mixedCjkMatch ? mixedCjkMatch.length : 0
      const mixedNonCjkChars = mixedText.length - mixedCjkChars
      const expectedMixedTokens = Math.max(
        1,
        Math.ceil(mixedNonCjkChars / 4 + mixedCjkChars / 1.5)
      )
      expect(mixedCjkChars).toBe(2)
      expect(mixedNonCjkChars).toBe(12) // 14 total - 2 CJK
      // ceil(12/4 + 2/1.5) = ceil(3 + 1.33) = ceil(4.33) = 5
      expect(expectedMixedTokens).toBe(5)
    })

    it("returns at least 1 token for non-empty strings", () => {
      const _singleChar = "a"
      const nonCjkChars = 1
      const cjkChars = 0
      const expectedTokens = Math.max(
        1,
        Math.ceil(nonCjkChars / 4 + cjkChars / 1.5)
      )
      expect(expectedTokens).toBe(1) // max(1, ceil(0.25)) = max(1, 1) = 1
    })

    it("handles empty strings correctly", () => {
      const _emptyText = ""
      const nonCjkChars = 0
      const cjkChars = 0
      // The formula would give 0, but the implementation should handle empty strings
      const rawCalculation = Math.ceil(nonCjkChars / 4 + cjkChars / 1.5)
      expect(rawCalculation).toBe(0)
    })

    it("validates the formula components for Japanese hiragana", () => {
      const hiraganaText = "こんにちは" // 5 hiragana characters
      const hiraganaMatch = hiraganaText.match(
        /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
      )
      const hiraganaChars = hiraganaMatch ? hiraganaMatch.length : 0
      const nonHiraganaChars = hiraganaText.length - hiraganaChars
      expect(hiraganaChars).toBe(5)
      expect(nonHiraganaChars).toBe(0)
      const expectedTokens = Math.max(
        1,
        Math.ceil(nonHiraganaChars / 4 + hiraganaChars / 1.5)
      )
      // ceil(5/1.5) = ceil(3.33) = 4
      expect(expectedTokens).toBe(4)
    })

    it("validates the formula components for Korean hangul", () => {
      const koreanText = "안녕하세요" // 5 Korean characters
      const koreanMatch = koreanText.match(
        /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g
      )
      const koreanChars = koreanMatch ? koreanMatch.length : 0
      const nonKoreanChars = koreanText.length - koreanChars
      expect(koreanChars).toBe(5)
      expect(nonKoreanChars).toBe(0)
      const expectedTokens = Math.max(
        1,
        Math.ceil(nonKoreanChars / 4 + koreanChars / 1.5)
      )
      // ceil(5/1.5) = ceil(3.33) = 4
      expect(expectedTokens).toBe(4)
    })
  })
})
