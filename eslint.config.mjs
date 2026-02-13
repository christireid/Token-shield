import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Project-wide overrides
  {
    rules: {
      // Enforce: no console.log left in production code
      "no-console": "error",

      // Allow unused vars when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow empty catch blocks (used for graceful degradation throughout the SDK)
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // Ignore non-SDK files and build artifacts
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "*.config.*",
      "components/**",
      "app/**",
      "hooks/**",
    ],
  }
)
