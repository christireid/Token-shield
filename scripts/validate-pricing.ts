/**
 * validate-pricing — Cross-reference models.json against llm-info package
 *
 * Compares our pricing data (single source of truth in models.json) against
 * the community-maintained `llm-info` package to catch stale or incorrect prices.
 *
 * Usage: npx tsx scripts/validate-pricing.ts
 * Or via npm: npm run validate-pricing
 *
 * Exit code 0 = all matched or only minor drifts
 * Exit code 1 = significant pricing discrepancies found
 */

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { getAllModelsWithIds, type ModelInfo } from "llm-info"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const DATA_PATH = path.join(ROOT, "lib/tokenshield/data/models.json")

// ── Types ──────────────────────────────────────────────────────────────────

interface ModelEntry {
  provider: string
  name: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
  maxOutputTokens: number
  [key: string]: unknown
}

interface ModelsFile {
  lastUpdated: string
  models: Record<string, ModelEntry>
}

// ── ID Mapping ─────────────────────────────────────────────────────────────

/**
 * Map our model IDs to llm-info model IDs.
 * llm-info uses dated suffixes for Anthropic models and preview suffixes
 * for some Google models, while we use short canonical IDs.
 */
const OUR_ID_TO_LLM_INFO: Record<string, string> = {
  // OpenAI — mostly 1:1
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4.1": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4.1-nano": "gpt-4.1-nano",
  "gpt-5": "gpt-5",
  "gpt-5-mini": "gpt-5-mini",
  "gpt-5-nano": "gpt-5-nano",
  "gpt-5.2": "gpt-5.2",
  o1: "o1",
  "o1-mini": "o1-mini",
  o3: "o3",
  "o3-mini": "o3-mini",
  "o4-mini": "o4-mini",
  "gpt-4-turbo": "gpt-4-turbo",
  // Anthropic — llm-info uses dated IDs
  "claude-opus-4": "claude-opus-4-20250514",
  "claude-opus-4.5": "claude-opus-4-5-20251101",
  "claude-sonnet-4.5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "claude-haiku-3.5": "claude-3-5-haiku-20241022",
  // Google — mostly 1:1
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-3-pro": "gemini-3-pro-preview",
}

// ── Comparison logic ───────────────────────────────────────────────────────

interface PricingDiff {
  ourId: string
  llmInfoId: string
  field: string
  ours: number
  theirs: number
  driftPercent: number
}

/** Percentage above which a drift is considered a warning */
const WARN_THRESHOLD = 5
/** Percentage above which a drift is considered an error */
const ERROR_THRESHOLD = 25

function comparePricing(
  ourModels: Record<string, ModelEntry>,
  llmInfoModels: ModelInfo[],
): { matched: number; skipped: number; diffs: PricingDiff[] } {
  const llmInfoMap = new Map<string, ModelInfo>()
  for (const m of llmInfoModels) {
    llmInfoMap.set(m.id, m)
  }

  let matched = 0
  let skipped = 0
  const diffs: PricingDiff[] = []

  for (const [ourId, ourModel] of Object.entries(ourModels)) {
    const llmInfoId = OUR_ID_TO_LLM_INFO[ourId]
    if (!llmInfoId) {
      skipped++
      continue
    }

    const ref = llmInfoMap.get(llmInfoId)
    if (!ref) {
      skipped++
      continue
    }

    matched++

    // Compare input pricing
    if (ref.pricePerMillionInputTokens != null) {
      const drift = pctDiff(ourModel.inputPerMillion, ref.pricePerMillionInputTokens)
      if (drift > WARN_THRESHOLD) {
        diffs.push({
          ourId,
          llmInfoId,
          field: "inputPerMillion",
          ours: ourModel.inputPerMillion,
          theirs: ref.pricePerMillionInputTokens,
          driftPercent: drift,
        })
      }
    }

    // Compare output pricing
    if (ref.pricePerMillionOutputTokens != null) {
      const drift = pctDiff(ourModel.outputPerMillion, ref.pricePerMillionOutputTokens)
      if (drift > WARN_THRESHOLD) {
        diffs.push({
          ourId,
          llmInfoId,
          field: "outputPerMillion",
          ours: ourModel.outputPerMillion,
          theirs: ref.pricePerMillionOutputTokens,
          driftPercent: drift,
        })
      }
    }

    // Compare context window
    if (ref.contextWindowTokenLimit != null) {
      const drift = pctDiff(ourModel.contextWindow, ref.contextWindowTokenLimit)
      if (drift > WARN_THRESHOLD) {
        diffs.push({
          ourId,
          llmInfoId,
          field: "contextWindow",
          ours: ourModel.contextWindow,
          theirs: ref.contextWindowTokenLimit,
          driftPercent: drift,
        })
      }
    }
  }

  return { matched, skipped, diffs }
}

function pctDiff(a: number, b: number): number {
  if (a === b) return 0
  if (a === 0 && b === 0) return 0
  const max = Math.max(Math.abs(a), Math.abs(b))
  return (Math.abs(a - b) / max) * 100
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  // 1. Load our models.json
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Error: ${DATA_PATH} not found`)
    process.exit(1)
  }

  const data: ModelsFile = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"))
  const ourCount = Object.keys(data.models).length

  // 2. Load llm-info models
  const llmInfoModels = getAllModelsWithIds()
  console.log(
    `\nvalidate-pricing: Comparing ${ourCount} models against llm-info (${llmInfoModels.length} models)\n`,
  )

  // 3. Compare
  const { matched, skipped, diffs } = comparePricing(data.models, llmInfoModels)

  console.log(`  Matched:  ${matched} models cross-referenced`)
  console.log(`  Skipped:  ${skipped} models (no llm-info equivalent)\n`)

  if (diffs.length === 0) {
    console.log("  All matched models have consistent pricing data.\n")
    return
  }

  // 4. Report diffs
  let hasErrors = false

  for (const d of diffs) {
    const severity = d.driftPercent >= ERROR_THRESHOLD ? "ERROR" : "WARN"
    if (severity === "ERROR") hasErrors = true

    const icon = severity === "ERROR" ? "x" : "!"
    console.log(
      `  [${icon}] ${severity}: ${d.ourId} → ${d.field}: ` +
        `ours=${d.ours}, llm-info=${d.theirs} (${d.driftPercent.toFixed(1)}% drift)`,
    )
  }

  console.log(`\n  ${diffs.length} discrepanc${diffs.length === 1 ? "y" : "ies"} found.`)
  console.log(
    `  Review https://openai.com/api/pricing, https://anthropic.com/pricing, ` +
      `https://ai.google.dev/pricing to determine which is correct.\n`,
  )

  if (hasErrors) {
    console.log("  Significant pricing errors detected — exiting with code 1.\n")
    process.exit(1)
  }
}

main()
