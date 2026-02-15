import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "lib/tokenshield/index.ts",
    react: "lib/tokenshield/react.tsx",
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
