/**
 * token-shield — Text normalization and similarity.
 *
 * Used internally by the semantic cache for fuzzy matching.
 * These are pure functions with no side effects.
 */

/**
 * Normalize text for comparison: lowercase, collapse whitespace,
 * remove punctuation, trim. Catches near-duplicate prompts like
 * "What is React?" vs "what is react".
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Bigram-based Dice coefficient for string similarity.
 * Returns 0–1 (1 = identical after normalization).
 * Runs in O(n) — suitable for catching rephrased prompts.
 */
export function textSimilarity(a: string, b: string): number {
  const aNorm = normalizeText(a)
  const bNorm = normalizeText(b)

  if (aNorm === bNorm) return 1

  const bigramsA = new Set<string>()
  const bigramsB = new Set<string>()

  for (let i = 0; i < aNorm.length - 1; i++) bigramsA.add(aNorm.slice(i, i + 2))
  for (let i = 0; i < bNorm.length - 1; i++) bigramsB.add(bNorm.slice(i, i + 2))

  if (bigramsA.size === 0 && bigramsB.size === 0) return aNorm.length === bNorm.length ? 1 : 0
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

/**
 * Fast djb2 hash. Includes model in the hash to prevent
 * cross-model cache contamination.
 */
export function hashKey(text: string, model: string): string {
  const normalized = normalizeText(text)
  const input = `${model}|${normalized}`
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return `ts_${(hash >>> 0).toString(36)}`
}
