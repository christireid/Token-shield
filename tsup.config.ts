import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "lib/tokenshield/index.ts",
    react: "lib/tokenshield/react.tsx",
    license: "lib/tokenshield/license.ts",
    "audit-log": "lib/tokenshield/audit-log.ts",
    compressor: "lib/tokenshield/prompt-compressor.ts",
    "delta-encoder": "lib/tokenshield/conversation-delta-encoder.ts",
    middleware: "lib/tokenshield/middleware.ts",
  },
  format: ["cjs", "esm"],
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
    }
  },
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: ["react", "react-dom", "ai"],
  treeshake: true,
  minify: false,
  keepNames: true,
  esbuildOptions(options) {
    options.banner = {
      js: "/* @tokenshield/ai-sdk - MIT License */",
    }
  },
})
