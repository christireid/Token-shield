// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useStaggeredReveal } from "./use-staggered-reveal"

// Mock useReducedMotion
vi.mock("./use-reduced-motion", () => ({
  useReducedMotion: vi.fn(() => false),
}))

import { useReducedMotion } from "./use-reduced-motion"
const mockUseReducedMotion = vi.mocked(useReducedMotion)

describe("useStaggeredReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockUseReducedMotion.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("starts as not visible", () => {
    const { result } = renderHook(() => useStaggeredReveal(1, 120))
    expect(result.current).toBe(false)
  })

  it("becomes visible after the staggered delay", () => {
    const { result } = renderHook(() => useStaggeredReveal(2, 100))
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(200) // order=2 * 100ms = 200ms
    })
    expect(result.current).toBe(true)
  })

  it("respects the order parameter for timing", () => {
    const { result: result1 } = renderHook(() => useStaggeredReveal(1, 100))
    const { result: result3 } = renderHook(() => useStaggeredReveal(3, 100))

    act(() => {
      vi.advanceTimersByTime(100) // Only order=1 should be visible
    })
    expect(result1.current).toBe(true)
    expect(result3.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(200) // Now order=3 should also be visible
    })
    expect(result3.current).toBe(true)
  })

  it("becomes visible immediately when reduced motion is preferred", () => {
    mockUseReducedMotion.mockReturnValue(true)
    const { result } = renderHook(() => useStaggeredReveal(5, 120))
    expect(result.current).toBe(true)
  })

  it("cleans up the timeout on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
    const { unmount } = renderHook(() => useStaggeredReveal(1, 100))
    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})
