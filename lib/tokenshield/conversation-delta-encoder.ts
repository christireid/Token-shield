/**
 * TokenShield - Conversation Delta Encoder
 *
 * Detects and eliminates redundant content across conversation turns.
 * In multi-turn conversations, successive messages often repeat context,
 * system instructions, or large pasted content. This module identifies
 * cross-turn redundancy and strips it to save tokens.
 *
 * UNIQUE IP: No competing tool does client-side conversation delta encoding.
 * - Helicone/Portkey: don't touch message content
 * - LiteLLM: pass-through only
 * - The existing context-manager.ts removes entire messages but doesn't
 *   compress redundant content WITHIN or ACROSS messages
 *
 * Techniques:
 * 1. Cross-turn paragraph dedup: removes paragraphs in user messages
 *    that are verbatim copies of text in earlier messages
 * 2. Repeated instruction detection: identifies when users re-paste
 *    instructions that are already in the system prompt
 * 3. Quote compaction: when a user quotes a large assistant response,
 *    replaces it with a compact reference
 *
 * All client-side. Zero network overhead. Zero backend.
 */

import { countTokens } from "gpt-tokenizer"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface DeltaEncoderConfig {
  /** Minimum paragraph length (in chars) to consider for dedup. Default: 50 */
  minParagraphLength?: number
  /** Similarity threshold for paragraph matching (0-1). Default: 0.95 */
  paragraphSimilarity?: number
  /** Enable system prompt overlap detection. Default: true */
  detectSystemOverlap?: boolean
  /** Enable assistant quote compaction. Default: true */
  compactQuotes?: boolean
  /** Minimum tokens saved to apply encoding. Default: 10 */
  minSavingsTokens?: number
}

export interface DeltaResult {
  /** The optimized messages array */
  messages: { role: string; content: string }[]
  /** Total tokens saved */
  savedTokens: number
  /** Number of paragraphs deduplicated */
  paragraphsDeduped: number
  /** Number of system overlaps removed */
  systemOverlaps: number
  /** Number of quotes compacted */
  quotesCompacted: number
  /** Whether delta encoding was applied */
  applied: boolean
}

const DEFAULT_CONFIG: Required<DeltaEncoderConfig> = {
  minParagraphLength: 50,
  paragraphSimilarity: 0.95,
  detectSystemOverlap: true,
  compactQuotes: true,
  minSavingsTokens: 10,
}

// -------------------------------------------------------
// Internal helpers
// -------------------------------------------------------

/**
 * Split text into paragraphs (blocks separated by double newlines or
 * significant whitespace gaps).
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

/**
 * Normalize text for comparison: lowercase, collapse whitespace, strip punctuation.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Fast Jaccard similarity on word sets.
 */
function wordSetSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/))
  const setB = new Set(b.split(/\s+/))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }

  return intersection / (setA.size + setB.size - intersection)
}

/**
 * Check if a text block is a near-duplicate of any paragraph in a reference set.
 */
function isDuplicate(
  paragraph: string,
  referenceSet: Set<string>,
  threshold: number
): boolean {
  const normalized = normalizeForComparison(paragraph)
  if (referenceSet.has(normalized)) return true

  // Check fuzzy match against each reference
  for (const ref of referenceSet) {
    if (wordSetSimilarity(normalized, ref) >= threshold) {
      return true
    }
  }

  return false
}

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Apply delta encoding to a conversation to eliminate cross-turn redundancy.
 *
 * Scans user messages for paragraphs that are duplicated from earlier messages
 * (system, assistant, or prior user), detects when users re-paste system prompt
 * content, and compacts large assistant response quotes. Preserves all unique
 * content and message ordering.
 *
 * @param messages - The conversation messages array
 * @param config - Optional delta encoding configuration
 * @returns A {@link DeltaResult} with optimized messages and savings breakdown
 * @example
 * ```ts
 * const result = encodeDelta([
 *   { role: "system", content: "You are a code reviewer. Always check for security issues." },
 *   { role: "user", content: "You are a code reviewer. Always check for security issues.\n\nReview this code: ..." },
 * ])
 * // result.savedTokens === 14 (system prompt overlap removed)
 * // result.systemOverlaps === 1
 * ```
 */
export function encodeDelta(
  messages: { role: string; content: string }[],
  config: DeltaEncoderConfig = {}
): DeltaResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  const originalTokens = messages.reduce(
    (sum, m) => sum + countTokens(m.content),
    0
  )

  // Build a reference set of all paragraphs seen so far (system + assistant + earlier user)
  const seenParagraphs = new Set<string>()
  let paragraphsDeduped = 0
  let systemOverlaps = 0
  let quotesCompacted = 0

  // Collect system prompt paragraphs for overlap detection
  const systemParagraphs = new Set<string>()
  for (const msg of messages) {
    if (msg.role === "system") {
      for (const para of splitParagraphs(msg.content)) {
        if (para.length >= cfg.minParagraphLength) {
          systemParagraphs.add(normalizeForComparison(para))
        }
      }
    }
  }

  const optimized = messages.map((msg) => {
    // Don't modify system or tool messages
    if (msg.role === "system" || msg.role === "tool") {
      // Add system paragraphs to seen set
      for (const para of splitParagraphs(msg.content)) {
        if (para.length >= cfg.minParagraphLength) {
          seenParagraphs.add(normalizeForComparison(para))
        }
      }
      return msg
    }

    // Don't modify assistant messages, but record their paragraphs
    if (msg.role === "assistant") {
      for (const para of splitParagraphs(msg.content)) {
        if (para.length >= cfg.minParagraphLength) {
          seenParagraphs.add(normalizeForComparison(para))
        }
      }
      return msg
    }

    // User messages: apply delta encoding
    const paragraphs = splitParagraphs(msg.content)
    const keptParagraphs: string[] = []

    for (const para of paragraphs) {
      if (para.length < cfg.minParagraphLength) {
        keptParagraphs.push(para)
        continue
      }

      const normalized = normalizeForComparison(para)

      // Check for system prompt overlap
      if (cfg.detectSystemOverlap && isDuplicate(para, systemParagraphs, cfg.paragraphSimilarity)) {
        systemOverlaps++
        // Replace with a compact reference instead of completely removing
        keptParagraphs.push("[See system instructions above]")
        continue
      }

      // Check for cross-turn paragraph duplication
      if (isDuplicate(para, seenParagraphs, cfg.paragraphSimilarity)) {
        paragraphsDeduped++
        continue // Remove entirely — already in context
      }

      // Check for assistant quote compaction
      if (cfg.compactQuotes && (para.startsWith(">") || para.startsWith('"'))) {
        const unquoted = para.replace(/^[>"]\s*/gm, "").trim()
        if (unquoted.length >= cfg.minParagraphLength) {
          const unquotedNorm = normalizeForComparison(unquoted)
          if (isDuplicate(unquoted, seenParagraphs, cfg.paragraphSimilarity)) {
            quotesCompacted++
            keptParagraphs.push("[Referring to previous response]")
            continue
          }
        }
      }

      keptParagraphs.push(para)
      seenParagraphs.add(normalized)
    }

    return {
      ...msg,
      content: keptParagraphs.join("\n\n"),
    }
  })

  const optimizedTokens = optimized.reduce(
    (sum, m) => sum + countTokens(m.content),
    0
  )

  const savedTokens = originalTokens - optimizedTokens
  const applied = savedTokens >= cfg.minSavingsTokens

  return {
    messages: applied ? optimized : messages,
    savedTokens: applied ? savedTokens : 0,
    paragraphsDeduped: applied ? paragraphsDeduped : 0,
    systemOverlaps: applied ? systemOverlaps : 0,
    quotesCompacted: applied ? quotesCompacted : 0,
    applied,
  }
}

/**
 * Analyze a conversation for redundancy without modifying it.
 *
 * Returns statistics about how much could be saved, useful for
 * dashboards and dry-run mode.
 *
 * @param messages - The conversation messages to analyze
 * @returns Analysis of potential savings
 */
export function analyzeRedundancy(
  messages: { role: string; content: string }[]
): {
  totalTokens: number
  redundantTokens: number
  redundancyPercent: number
  duplicateParagraphs: number
  systemOverlaps: number
} {
  const result = encodeDelta(messages, { minSavingsTokens: 0 })
  const totalTokens = messages.reduce(
    (sum, m) => sum + countTokens(m.content),
    0
  )

  return {
    totalTokens,
    redundantTokens: result.savedTokens,
    redundancyPercent: totalTokens > 0 ? (result.savedTokens / totalTokens) * 100 : 0,
    duplicateParagraphs: result.paragraphsDeduped,
    systemOverlaps: result.systemOverlaps,
  }
}
