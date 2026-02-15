import { describe, it, expect } from "vitest"
import { CHART_MARGINS, GRID_STROKE, GRID_DASH } from "./chart-theme"

describe("chart-theme", () => {
  it("CHART_MARGINS has expected shape", () => {
    expect(CHART_MARGINS).toEqual({ top: 8, right: 8, bottom: 0, left: 0 })
  })

  it("GRID_STROKE is a valid HSL string", () => {
    expect(GRID_STROKE).toMatch(/^hsl\(/)
  })

  it("GRID_DASH is a valid dasharray", () => {
    expect(GRID_DASH).toBe("3 3")
  })
})
