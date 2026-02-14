import js from "@eslint/js"
import tseslint from "typescript-eslint"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Prettier — disables ESLint rules that conflict with Prettier formatting
  prettier,

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

  // Only lint the SDK source — ignore everything else
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".next/**",
      "out/**",
      "*.config.*",
      "app/**",
      "components/**",
      "hooks/**",
      "styles/**",
      "public/**",
      "examples/**",
      "scripts/**",
      "docs/**",
      "marketing/**",
    ],
  },
)
