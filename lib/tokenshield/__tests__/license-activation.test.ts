import { describe, it, expect } from "vitest"
import { LicenseActivation, type LicenseActivationProps } from "../license-activation"

/**
 * Module-level tests for the LicenseActivation component.
 * Full rendering tests would require jsdom + @testing-library/react.
 * These tests verify exports, types, and that the component is a valid function.
 */
describe("LicenseActivation module", () => {
  it("exports LicenseActivation as a function component", () => {
    expect(typeof LicenseActivation).toBe("function")
    expect(LicenseActivation.name).toBe("LicenseActivation")
  })

  it("LicenseActivationProps type is importable", () => {
    // Type-level check: this compiles successfully
    const props: LicenseActivationProps = {
      onActivated: () => {},
      onError: () => {},
      secret: "test",
      placeholder: "Enter key",
      className: "test",
      style: { maxWidth: 300 },
    }
    expect(props.secret).toBe("test")
    expect(props.placeholder).toBe("Enter key")
  })

  it("LicenseActivationProps all fields are optional", () => {
    const props: LicenseActivationProps = {}
    expect(props).toBeDefined()
  })

  it("is not re-exported from index.ts", async () => {
    const index = await import("../index")
    expect((index as Record<string, unknown>).LicenseActivation).toBeUndefined()
  })
})
