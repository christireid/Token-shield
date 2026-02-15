import { describe, it, expect } from "vitest"
import { CHART_MARGINS, GRID_STROKE, GRID_DASH, AXIS_STYLE, glowFilterDef } from "./chart-theme"

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

  it("AXIS_STYLE disables tick and axis lines", () => {
    expect(AXIS_STYLE.tickLine).toBe(false)
    expect(AXIS_STYLE.axisLine).toBe(false)
    expect(AXIS_STYLE.tick).toEqual({ fontSize: 10 })
  })

  it("glowFilterDef returns correct structure", () => {
    const def = glowFilterDef("test-glow")
    expect(def.id).toBe("test-glow")
    expect(def.stdDeviation).toBe(3)
    expect(def.x).toBe("-20%")
    expect(def.width).toBe("140%")
  })

  it("glowFilterDef supports custom stdDeviation", () => {
    const def = glowFilterDef("custom", 5)
    expect(def.stdDeviation).toBe(5)
  })
})
