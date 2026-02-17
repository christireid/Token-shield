import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vercel: "src/middleware/vercel.ts",
  },
  format: ["cjs", "esm"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" }
  },
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  external: ["ai"],
  treeshake: true,
  minify: false,
  keepNames: true,
  esbuildOptions(options) {
    options.banner = { js: "/* token-shield - MIT License */" }
  },
})
