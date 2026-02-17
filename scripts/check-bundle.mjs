/**
 * Build-time check: fail if bundle exceeds 25KB gzipped.
 * Run with: node scripts/check-bundle.mjs
 */

import { readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { globSync } from "node:fs"

const MAX_GZIP_KB = 25

async function main() {
  const { readdirSync, statSync } = await import("node:fs")

  // Find all JS files in dist/
  const distFiles = readdirSync("dist").filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))

  let totalSize = 0
  let totalGzip = 0

  for (const file of distFiles) {
    const content = readFileSync(`dist/${file}`)
    const gzipped = gzipSync(content)
    totalSize += content.length
    totalGzip += gzipped.length

    const sizeKb = (content.length / 1024).toFixed(1)
    const gzipKb = (gzipped.length / 1024).toFixed(1)
    console.log(`  ${file}: ${sizeKb}KB (${gzipKb}KB gzip)`)
  }

  const totalGzipKb = totalGzip / 1024
  console.log(`\nTotal: ${(totalSize / 1024).toFixed(1)}KB (${totalGzipKb.toFixed(1)}KB gzip)`)

  if (totalGzipKb > MAX_GZIP_KB) {
    console.error(`\nERROR: Bundle exceeds ${MAX_GZIP_KB}KB gzipped (${totalGzipKb.toFixed(1)}KB)`)
    process.exit(1)
  }

  console.log(`✓ Bundle size check passed (${totalGzipKb.toFixed(1)}KB < ${MAX_GZIP_KB}KB gzip)`)
}

main().catch((err) => {
  console.error("Bundle check failed:", err.message)
  process.exit(1)
})
