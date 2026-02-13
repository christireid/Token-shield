import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'lib/tokenshield/index.ts',
    react: 'lib/tokenshield/react.tsx',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'ai'],
  treeshake: true,
})
