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
