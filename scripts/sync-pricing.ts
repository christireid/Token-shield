/**
 * sync-pricing — Generate pricing data in source files from models.json
 *
 * Reads lib/tokenshield/data/models.json (single source of truth) and updates
 * the generated sections in:
 *   - pricing-registry.ts  (PRICING_REGISTRY)
 *   - cost-estimator.ts    (MODEL_PRICING)
 *   - output-predictor.ts  (MODEL_OUTPUT_MULTIPLIERS)
 *
 * Usage: npx tsx scripts/sync-pricing.ts
 * Or via npm: npm run sync-pricing
 *
 * Runs in <100ms, no network calls. Safe to run as a prebuild step.
 */

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const DATA_PATH = path.join(ROOT, "lib/tokenshield/data/models.json")
const REGISTRY_PATH = path.join(ROOT, "lib/tokenshield/pricing-registry.ts")
const ESTIMATOR_PATH = path.join(ROOT, "lib/tokenshield/cost-estimator.ts")
const PREDICTOR_PATH = path.join(ROOT, "lib/tokenshield/output-predictor.ts")

const START_MARKER = "// @generated:start"
const END_MARKER = "// @generated:end"

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelEntry {
  provider: "openai" | "anthropic" | "google"
  name: string
  inputPerMillion: number
  outputPerMillion: number
  cachedInputDiscount: number
  contextWindow: number
  maxOutputTokens: number
  supportsVision: boolean
  supportsFunctions: boolean
  tier?: "budget" | "standard" | "premium" | "flagship"
  outputMultiplier?: number
  deprecated?: boolean
}

interface ModelsFile {
  lastUpdated: string
  models: Record<string, ModelEntry>
}

// ── Helpers ────────────────────────────────────────────────────────────────

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

/** Format a number for TypeScript source — use underscores for large integers */
function fmtNum(n: number): string {
  if (Number.isInteger(n) && n >= 10_000) {
    // e.g. 1048576 → 1_048_576
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "_")
  }
  return String(n)
}

/** Replace the content between @generated:start and @generated:end markers */
function replaceGenerated(filePath: string, newContent: string): void {
  const source = fs.readFileSync(filePath, "utf-8")
  const startIdx = source.indexOf(START_MARKER)
  const endIdx = source.indexOf(END_MARKER)

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Missing marker comments in ${path.basename(filePath)}. ` +
        `Expected "${START_MARKER}" and "${END_MARKER}".`,
    )
  }

  // Find end of start marker line
  const startLineEnd = source.indexOf("\n", startIdx)
  if (startLineEnd === -1) throw new Error("Malformed start marker")

  const updated = source.slice(0, startLineEnd + 1) + newContent + "\n  " + source.slice(endIdx)

  fs.writeFileSync(filePath, updated, "utf-8")
}

// ── Generators ─────────────────────────────────────────────────────────────

function generatePricingRegistry(models: Record<string, ModelEntry>): string {
  const providers = ["openai", "anthropic", "google"] as const
  const lines: string[] = []

  for (const provider of providers) {
    const entries = Object.entries(models).filter(([, m]) => m.provider === provider)
    if (entries.length === 0) continue

    lines.push(`  // ---------------------------------------------------------------------------`)
    lines.push(`  // ${provider.charAt(0).toUpperCase() + provider.slice(1)}`)
    lines.push(`  // ---------------------------------------------------------------------------`)

    for (const [id, m] of entries) {
      lines.push(`  "${id}": {`)
      lines.push(`    id: "${id}",`)
      lines.push(`    provider: "${m.provider}",`)
      lines.push(`    name: "${m.name}",`)
      lines.push(`    inputPerMillion: ${m.inputPerMillion},`)
      lines.push(`    outputPerMillion: ${m.outputPerMillion},`)
      lines.push(`    cachedInputDiscount: ${m.cachedInputDiscount},`)
      lines.push(`    contextWindow: ${fmtNum(m.contextWindow)},`)
      lines.push(`    maxOutputTokens: ${fmtNum(m.maxOutputTokens)},`)
      lines.push(`    supportsVision: ${m.supportsVision},`)
      lines.push(`    supportsFunctions: ${m.supportsFunctions},`)
      if (m.deprecated) {
        lines.push(`    deprecated: true,`)
      }
      lines.push(`  },`)
    }
  }

  return lines.join("\n")
}

function generateCostEstimator(models: Record<string, ModelEntry>): string {
  // Only include models with a tier (active, non-deprecated models for cost comparison)
  const entries = Object.entries(models).filter(([, m]) => m.tier && !m.deprecated)
  const providers = ["openai", "anthropic", "google"] as const
  const lines: string[] = []

  for (const provider of providers) {
    const providerEntries = entries.filter(([, m]) => m.provider === provider)
    if (providerEntries.length === 0) continue

    lines.push(`  // ${provider.charAt(0).toUpperCase() + provider.slice(1)}`)

    for (const [id, m] of providerEntries) {
      const cachedInputPerMillion =
        m.cachedInputDiscount > 0
          ? round(m.inputPerMillion * (1 - m.cachedInputDiscount), 6)
          : undefined

      lines.push(`  "${id}": {`)
      lines.push(`    id: "${id}",`)
      lines.push(`    provider: "${m.provider}",`)
      lines.push(`    name: "${m.name}",`)
      lines.push(`    inputPerMillion: ${m.inputPerMillion},`)
      lines.push(`    outputPerMillion: ${m.outputPerMillion},`)
      if (cachedInputPerMillion !== undefined) {
        lines.push(`    cachedInputPerMillion: ${cachedInputPerMillion},`)
      }
      lines.push(`    contextWindow: ${m.contextWindow},`)
      lines.push(`    tier: "${m.tier}",`)
      lines.push(`  },`)
    }
  }

  return lines.join("\n")
}

function generateOutputMultipliers(models: Record<string, ModelEntry>): string {
  const entries = Object.entries(models).filter(([, m]) => m.outputMultiplier !== undefined)
  const providers = ["openai", "anthropic", "google"] as const
  const lines: string[] = []

  for (const provider of providers) {
    const providerEntries = entries.filter(([, m]) => m.provider === provider)
    if (providerEntries.length === 0) continue

    // Add provider comment
    if (provider === "openai") {
      lines.push(`  // OpenAI`)
    } else if (provider === "anthropic") {
      lines.push(`  // Anthropic`)
    } else {
      lines.push(`  // Google`)
    }

    for (const [id, m] of providerEntries) {
      lines.push(`  "${id}": ${m.outputMultiplier},`)
    }
  }

  return lines.join("\n")
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(data: ModelsFile): string[] {
  const errors: string[] = []

  for (const [id, m] of Object.entries(data.models)) {
    if (m.inputPerMillion < 0) errors.push(`${id}: inputPerMillion < 0`)
    if (m.outputPerMillion < 0) errors.push(`${id}: outputPerMillion < 0`)
    if (m.cachedInputDiscount < 0 || m.cachedInputDiscount > 1) {
      errors.push(`${id}: cachedInputDiscount must be 0-1, got ${m.cachedInputDiscount}`)
    }
    if (m.contextWindow <= 0) errors.push(`${id}: contextWindow must be > 0`)
    if (m.maxOutputTokens <= 0) errors.push(`${id}: maxOutputTokens must be > 0`)
    if (!["openai", "anthropic", "google"].includes(m.provider)) {
      errors.push(`${id}: unknown provider "${m.provider}"`)
    }
    if (m.tier && !["budget", "standard", "premium", "flagship"].includes(m.tier)) {
      errors.push(`${id}: unknown tier "${m.tier}"`)
    }
    if (m.outputMultiplier !== undefined && (m.outputMultiplier <= 0 || m.outputMultiplier > 5)) {
      errors.push(`${id}: outputMultiplier out of range (0, 5], got ${m.outputMultiplier}`)
    }
  }

  return errors
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const start = Date.now()

  // 1. Read and parse models.json
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`)
    process.exit(1)
  }

  const data: ModelsFile = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"))

  // 2. Validate
  const errors = validate(data)
  if (errors.length > 0) {
    console.error("Validation errors in models.json:")
    for (const err of errors) console.error(`  - ${err}`)
    process.exit(1)
  }

  const modelCount = Object.keys(data.models).length
  const tieredCount = Object.values(data.models).filter((m) => m.tier).length
  const multiplierCount = Object.values(data.models).filter(
    (m) => m.outputMultiplier !== undefined,
  ).length

  // 3. Generate and write
  replaceGenerated(REGISTRY_PATH, generatePricingRegistry(data.models))
  replaceGenerated(ESTIMATOR_PATH, generateCostEstimator(data.models))
  replaceGenerated(PREDICTOR_PATH, generateOutputMultipliers(data.models))

  const elapsed = Date.now() - start
  console.log(
    `sync-pricing: Updated 3 files from ${modelCount} models ` +
      `(${tieredCount} in cost-estimator, ${multiplierCount} with output multipliers) ` +
      `in ${elapsed}ms`,
  )
}

main()
