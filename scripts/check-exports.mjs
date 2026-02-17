/**
 * Build-time check: fail if the public API exports change unexpectedly.
 * Run with: node scripts/check-exports.mjs
 */

const ALLOWED_EXPORTS = [
  "shield",
  "createShield",
  "semanticCache",
  "promptCompression",
  "costTracker",
  "estimateCost",
  "withShield",
]

async function main() {
  const mod = await import("../dist/index.js")
  const actual = Object.keys(mod).sort()
  const expected = [...ALLOWED_EXPORTS].sort()

  const extra = actual.filter((k) => !expected.includes(k))
  const missing = expected.filter((k) => !actual.includes(k))

  let failed = false

  if (extra.length > 0) {
    console.error(`ERROR: Unexpected exports found: ${extra.join(", ")}`)
    failed = true
  }

  if (missing.length > 0) {
    console.error(`ERROR: Missing expected exports: ${missing.join(", ")}`)
    failed = true
  }

  if (actual.length > 9) {
    console.error(`ERROR: Too many exports (${actual.length}). Maximum is 9.`)
    failed = true
  }

  if (failed) {
    console.error(`\nActual exports: ${actual.join(", ")}`)
    process.exit(1)
  }

  console.log(`✓ Export surface check passed (${actual.length} exports)`)
}

main().catch((err) => {
  console.error("Export check failed:", err.message)
  process.exit(1)
})
