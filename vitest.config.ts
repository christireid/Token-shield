import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["lib/tokenshield/**/*.{ts,tsx}"],
      exclude: [
        "lib/tokenshield/**/*.test.ts",
        "lib/tokenshield/benchmark.ts",
        "lib/tokenshield/benchmark-scenarios.ts",
        // Barrel re-exports (no logic to test)
        "lib/tokenshield/index.ts",
        "lib/tokenshield/react.tsx",
        // React UI components require jsdom environment
        "lib/tokenshield/dashboard.tsx",
        "lib/tokenshield/dashboard-sections.tsx",
        "lib/tokenshield/license-activation.tsx",
        "lib/tokenshield/savings-calculator.tsx",
        "lib/tokenshield/react-context.tsx",
        // React hooks require DOM + rendering context
        "lib/tokenshield/react-hooks-core.ts",
        "lib/tokenshield/react-hooks-budget.ts",
        "lib/tokenshield/react-hooks-pipeline.ts",
      ],
      reporter: ["text", "text-summary", "lcov"],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 60,
      },
    },
  },
})
