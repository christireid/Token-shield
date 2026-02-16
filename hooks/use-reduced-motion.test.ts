// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useReducedMotion } from "./use-reduced-motion"

function createMockMatchMedia(matches: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = []
  return {
    mock: Object.assign(
      vi.fn().mockReturnValue({
        matches,
        addEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
          listeners.push(handler)
        },
        removeEventListener: (_event: string, handler: (e: { matches: boolean }) => void) => {
          const idx = listeners.indexOf(handler)
          if (idx > -1) listeners.splice(idx, 1)
        },
      }),
      { _listeners: listeners },
    ),
    trigger(newMatches: boolean) {
      listeners.forEach((fn) => fn({ matches: newMatches }))
    },
  }
}

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns false initially (SSR safe)", () => {
    const { mock } = createMockMatchMedia(false)
    vi.stubGlobal("matchMedia", mock)

    const { result } = renderHook(() => useReducedMotion())
    // After the effect runs, it should sync with matchMedia
    expect(result.current).toBe(false)
  })

  it("returns true when user prefers reduced motion", () => {
    const { mock } = createMockMatchMedia(true)
    vi.stubGlobal("matchMedia", mock)

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(true)
  })

  it("updates when the media query changes", () => {
    const { mock, trigger } = createMockMatchMedia(false)
    vi.stubGlobal("matchMedia", mock)

    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => {
      trigger(true)
    })
    expect(result.current).toBe(true)

    act(() => {
      trigger(false)
    })
    expect(result.current).toBe(false)
  })

  it("cleans up event listener on unmount", () => {
    const removeListener = vi.fn()
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: removeListener,
      }),
    )

    const { unmount } = renderHook(() => useReducedMotion())
    unmount()
    expect(removeListener).toHaveBeenCalledWith("change", expect.any(Function))
  })
})
