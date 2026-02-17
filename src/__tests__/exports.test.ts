/**
 * Export surface test — fails if the public API changes unexpectedly.
 * This is the primary guard against export creep.
 */
import { describe, it, expect } from "vitest"
import * as tokenShield from "../index"

const ALLOWED_EXPORTS = [
  "shield",
  "createShield",
  "semanticCache",
  "promptCompression",
  "costTracker",
  "estimateCost",
  "withShield",
] as const

describe("Export surface", () => {
  it("exports exactly the allowed list of value exports", () => {
    const actual = Object.keys(tokenShield).sort()
    const expected = [...ALLOWED_EXPORTS].sort()
    expect(actual).toEqual(expected)
  })

  it("has no more than 9 total exports (values + types)", () => {
    // Types are erased at runtime, so we can only check value exports here.
    // The 2 type exports (ShieldOptions, ShieldStats) are verified by TS compilation.
    expect(Object.keys(tokenShield).length).toBeLessThanOrEqual(9)
  })

  it("shield is an alias for createShield", () => {
    expect(tokenShield.shield).toBe(tokenShield.createShield)
  })

  it("all exports are functions", () => {
    for (const key of ALLOWED_EXPORTS) {
      expect(typeof tokenShield[key]).toBe("function")
    }
  })
})
