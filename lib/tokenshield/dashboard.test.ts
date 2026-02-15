import { describe, it, expect } from "vitest"
import { TokenShieldDashboard } from "./dashboard"
import type { TokenShieldDashboardProps } from "./dashboard"

describe("TokenShieldDashboard", () => {
  describe("exports", () => {
    it("should export TokenShieldDashboard as a function", () => {
      expect(TokenShieldDashboard).toBeDefined()
      expect(typeof TokenShieldDashboard).toBe("function")
    })

    it("should have the expected function name", () => {
      expect(TokenShieldDashboard.name).toBe("TokenShieldDashboard")
    })
  })

  describe("TokenShieldDashboardProps type", () => {
    it("should allow valid props shape", () => {
      // This test verifies the type exists and can be used
      const validProps: TokenShieldDashboardProps = {
        showLedger: true,
        showEventLog: false,
        showPipeline: true,
        className: "test-class",
        style: { color: "red" },
      }

      expect(validProps).toBeDefined()
    })

    it("should allow all optional props to be omitted", () => {
      // Verify all props are optional
      const emptyProps: TokenShieldDashboardProps = {}
      expect(emptyProps).toBeDefined()
    })

    it("should allow partial props combinations", () => {
      const propsWithBreaker: TokenShieldDashboardProps = {
        breaker: undefined,
      }

      const propsWithBudget: TokenShieldDashboardProps = {
        budgetManager: undefined,
        userId: "test-user",
      }

      const propsWithProvider: TokenShieldDashboardProps = {
        providerAdapter: undefined,
      }

      expect(propsWithBreaker).toBeDefined()
      expect(propsWithBudget).toBeDefined()
      expect(propsWithProvider).toBeDefined()
    })
  })
})
