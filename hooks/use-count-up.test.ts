// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCountUp } from "./use-count-up"

describe("useCountUp", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns target immediately when skip is true", () => {
    const { result } = renderHook(() => useCountUp(100, 800, true))
    expect(result.current).toBe(100)
  })

  it("starts at the initial target value", () => {
    const { result } = renderHook(() => useCountUp(0, 800, true))
    expect(result.current).toBe(0)
  })

  it("returns the target immediately when skip changes to true", () => {
    const { result, rerender } = renderHook(({ target, skip }) => useCountUp(target, 800, skip), {
      initialProps: { target: 100, skip: true },
    })
    expect(result.current).toBe(100)

    rerender({ target: 200, skip: true })
    expect(result.current).toBe(200)
  })

  it("does not animate when from equals to", () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 800, false), {
      initialProps: { target: 50 },
    })
    // Initial render sets current to target
    expect(result.current).toBe(50)

    // Re-render with same target — no animation needed
    rerender({ target: 50 })
    expect(result.current).toBe(50)
  })

  it("eventually reaches the target value via animation", async () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 100, false), {
      initialProps: { target: 0 },
    })

    // Trigger animation to new target
    rerender({ target: 100 })

    // Advance time well past the animation duration
    await act(async () => {
      // Simulate multiple animation frames
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(50)
        await Promise.resolve()
      }
    })

    // The value should have reached or be very close to the target
    expect(result.current).toBeCloseTo(100, 0)
  })
})
