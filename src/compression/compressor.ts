/**
 * token-shield — Prompt compression.
 *
 * Client-side compression that reduces token count without losing
 * semantic meaning. No API calls, no backend, no WASM.
 *
 * Techniques (applied in order):
 * 1. Structural: collapse whitespace, remove markdown noise
 * 2. Verbose patterns: shorten common verbose phrases
 * 3. Stopwords: remove filler words
 * 4. Dedup: deduplicate repeated sentences
 * 5. References: abbreviate repeated entity mentions
 */

import { countTokens } from "gpt-tokenizer"
import type { CompressionOptions, CompressionResult, Message } from "../types"

const DEFAULTS: Required<Omit<CompressionOptions, "preservePatterns">> & { preservePatterns: RegExp[] } = {
  structural: true,
  stopwords: true,
  dedup: true,
  patterns: true,
  references: true,
  minSavingsTokens: 5,
  preservePatterns: [],
}

// ---------------------------------------------------------------------------
// Stopwords (prompt-specific, not general NLP)
// ---------------------------------------------------------------------------

const SINGLE_WORD_STOPS = new Set([
  "please", "kindly", "just", "simply", "basically",
  "actually", "really", "very", "quite", "rather",
  "perhaps", "maybe", "possibly", "certainly", "definitely",
  "honestly", "frankly", "literally", "essentially", "fundamentally",
  "obviously", "clearly", "evidently", "apparently", "seemingly",
  "furthermore", "moreover", "additionally", "also",
  "however", "nevertheless", "nonetheless", "regardless",
  "therefore", "thus", "hence", "consequently", "accordingly",
])

const MULTI_WORD_STOPS = [
  "in order to", "for the purpose of", "with the aim of",
  "it is important to note that", "it should be noted that",
  "as a matter of fact", "in point of fact",
  "i would like you to", "i want you to", "i need you to",
  "could you please", "would you please", "can you please",
  "make sure to", "be sure to", "ensure that you",
].sort((a, b) => b.length - a.length)

// ---------------------------------------------------------------------------
// Verbose contractions
// ---------------------------------------------------------------------------

const VERBOSE_CONTRACTIONS: [RegExp, string][] = [
  [/\bin the event that\b/gi, "if"],
  [/\bat this point in time\b/gi, "now"],
  [/\bin the near future\b/gi, "soon"],
  [/\bfor the purpose of\b/gi, "to"],
  [/\bin order to\b/gi, "to"],
  [/\bwith regard to\b/gi, "about"],
  [/\bwith respect to\b/gi, "about"],
  [/\bin relation to\b/gi, "about"],
  [/\bin terms of\b/gi, "in"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bowing to the fact that\b/gi, "because"],
  [/\bas a result of\b/gi, "from"],
  [/\bin spite of the fact that\b/gi, "although"],
  [/\bdespite the fact that\b/gi, "although"],
  [/\bit is important to note that\b/gi, "note:"],
  [/\bit should be noted that\b/gi, "note:"],
  [/\bplease note that\b/gi, "note:"],
  [/\bthere is no doubt that\b/gi, ""],
  [/\bit goes without saying that\b/gi, ""],
  [/\bneedless to say\b/gi, ""],
  [/\ba large number of\b/gi, "many"],
  [/\ba significant amount of\b/gi, "much"],
  [/\bthe vast majority of\b/gi, "most"],
  [/\bat the present time\b/gi, "now"],
  [/\bfirst and foremost\b/gi, "first"],
  [/\beach and every\b/gi, "every"],
  [/\bany and all\b/gi, "all"],
]

// ---------------------------------------------------------------------------
// Preservation
// ---------------------------------------------------------------------------

interface PreservedBlock { placeholder: string; original: string }

function extractPreserved(text: string, extraPatterns: RegExp[]): { text: string; blocks: PreservedBlock[] } {
  const blocks: PreservedBlock[] = []
  let result = text

  // Fenced code blocks
  result = result.replace(/```[\s\S]*?```/g, (m) => {
    const ph = `__PRESERVE_${blocks.length}__`
    blocks.push({ placeholder: ph, original: m })
    return ph
  })
  // Inline code
  result = result.replace(/`[^`]+`/g, (m) => {
    const ph = `__PRESERVE_${blocks.length}__`
    blocks.push({ placeholder: ph, original: m })
    return ph
  })
  // URLs
  result = result.replace(/https?:\/\/[^\s)]+/g, (m) => {
    const ph = `__PRESERVE_${blocks.length}__`
    blocks.push({ placeholder: ph, original: m })
    return ph
  })
  // User patterns
  for (const pat of extraPatterns) {
    result = result.replace(pat, (m) => {
      const ph = `__PRESERVE_${blocks.length}__`
      blocks.push({ placeholder: ph, original: m })
      return ph
    })
  }

  return { text: result, blocks }
}

function restorePreserved(text: string, blocks: PreservedBlock[]): string {
  let result = text
  for (let i = blocks.length - 1; i >= 0; i--) {
    result = result.split(blocks[i].placeholder).join(blocks[i].original)
  }
  return result
}

// ---------------------------------------------------------------------------
// Techniques
// ---------------------------------------------------------------------------

function compressStructural(text: string): string {
  let r = text
  r = r.replace(/\n{3,}/g, "\n\n")
  r = r.replace(/[ \t]{2,}/g, " ")
  r = r.replace(/[ \t]+$/gm, "")
  r = r.replace(/^[ \t]+(?=[A-Z])/gm, "")
  r = r.replace(/\*\*(\S(?:[^*]{0,40}\S)?)\*\*(?=:)/g, "$1")
  r = r.replace(/^[-*_]{3,}\s*$/gm, "")
  return r.trim()
}

function compressPatterns(text: string): string {
  let r = text
  for (const [pat, rep] of VERBOSE_CONTRACTIONS) r = r.replace(pat, rep)
  return r.replace(/ {2,}/g, " ")
}

function compressStopwords(text: string): string {
  let r = text
  for (const phrase of MULTI_WORD_STOPS) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    r = r.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "")
  }
  const words = r.split(/(\s+)/)
  const filtered: string[] = []
  let lastNonSpace = ""
  for (const word of words) {
    if (/^\s+$/.test(word)) { filtered.push(word); continue }
    const lower = word.toLowerCase().replace(/[^a-z]/g, "")
    const isFirst = !lastNonSpace || /[.!?]$/.test(lastNonSpace)
    if (!isFirst && SINGLE_WORD_STOPS.has(lower)) continue
    filtered.push(word)
    lastNonSpace = word
  }
  return filtered.join("").replace(/ {2,}/g, " ")
}

function compressRedundancy(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const s of sentences) {
    const norm = s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim()
    if (norm.length < 5) { unique.push(s); continue }
    if (!seen.has(norm)) { seen.add(norm); unique.push(s) }
  }
  return unique.join(" ")
}

function compressReferences(text: string): string {
  const pat = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
  const counts = new Map<string, number>()
  let m
  while ((m = pat.exec(text)) !== null) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)

  let result = text
  for (const [entity, count] of counts) {
    if (count < 3 || entity.length < 10) continue
    const abbrev = entity.split(/\s+/).map(w => w[0]).join("").toUpperCase()
    let first = false
    result = result.replace(
      new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
      (matched) => { if (!first) { first = true; return `${matched} (${abbrev})` } return abbrev },
    )
  }
  return result
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compress a prompt to reduce token count while preserving semantic meaning.
 *
 * This is a zero-network-overhead operation — purely algorithmic.
 * Code blocks, inline code, and URLs are preserved verbatim.
 *
 * @param text - The prompt text to compress
 * @param options - Optional configuration
 * @returns Compression result with token savings breakdown
 *
 * @example
 * ```ts
 * const result = promptCompression(
 *   "Please kindly analyze the following text. It is important to note that..."
 * );
 * // result.savedTokens > 0
 * // result.compressed — shorter version
 * ```
 */
export function promptCompression(text: string, options?: CompressionOptions): CompressionResult {
  const cfg = { ...DEFAULTS, ...options }
  const originalTokens = countTokens(text)
  const techniques: CompressionResult["techniques"] = []

  const { text: working, blocks } = extractPreserved(text, cfg.preservePatterns ?? [])
  let compressed = working
  let lastTokens = countTokens(compressed)

  const apply = (name: string, fn: (s: string) => string, enabled: boolean) => {
    if (!enabled) return
    compressed = fn(compressed)
    const newTokens = countTokens(compressed)
    if (lastTokens - newTokens > 0) techniques.push({ name, tokensSaved: lastTokens - newTokens })
    lastTokens = newTokens
  }

  apply("structural", compressStructural, cfg.structural!)
  apply("patterns", compressPatterns, cfg.patterns!)
  apply("stopwords", compressStopwords, cfg.stopwords!)
  apply("dedup", compressRedundancy, cfg.dedup!)
  apply("references", compressReferences, cfg.references!)

  compressed = restorePreserved(compressed, blocks)
  const compressedTokens = countTokens(compressed)
  const savedTokens = originalTokens - compressedTokens
  const ratio = originalTokens > 0 ? compressedTokens / originalTokens : 1
  const applied = savedTokens >= (cfg.minSavingsTokens ?? 5)

  // Too aggressive — return original
  const floor = originalTokens < 50 ? 0.3 : 0.6
  if (ratio < floor) {
    return { compressed: text, originalTokens, compressedTokens: originalTokens, savedTokens: 0, ratio: 1, techniques: [], applied: false }
  }

  return {
    compressed: applied ? compressed : text,
    originalTokens,
    compressedTokens: applied ? compressedTokens : originalTokens,
    savedTokens: applied ? savedTokens : 0,
    ratio: applied ? ratio : 1,
    techniques: applied ? techniques : [],
    applied,
  }
}

/**
 * Compress an array of chat messages.
 * Only user messages are compressed — system and assistant messages are preserved.
 */
export function compressMessages(
  messages: Message[],
  options?: CompressionOptions,
): { messages: Message[]; totalSavedTokens: number; perMessage: CompressionResult[] } {
  const results: CompressionResult[] = []
  let totalSaved = 0

  const compressed = messages.map((msg) => {
    if (msg.role !== "user") {
      const tokens = countTokens(msg.content)
      results.push({ compressed: msg.content, originalTokens: tokens, compressedTokens: tokens, savedTokens: 0, ratio: 1, techniques: [], applied: false })
      return msg
    }
    const result = promptCompression(msg.content, options)
    results.push(result)
    totalSaved += result.savedTokens
    return { ...msg, content: result.compressed }
  })

  return { messages: compressed, totalSavedTokens: totalSaved, perMessage: results }
}
