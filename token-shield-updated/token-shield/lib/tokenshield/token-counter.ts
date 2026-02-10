/**
 * TokenShield - Token Counter
 *
 * Uses `gpt-tokenizer` for EXACT BPE token counts matching OpenAI's tiktoken.
 * This is not an approximation. It uses the real cl100k_base / o200k_base
 * encoding used by GPT-4o, GPT-4.1, GPT-5, etc.
 *
 * npm dependency: gpt-tokenizer (works in browser, no WASM needed)
 */

import {
  encode,
  decode,
  countTokens,
  isWithinTokenLimit,
} from "gpt-tokenizer"

/**
 * Per-message overhead for chat completions.
 * OpenAI documents this in their tiktoken cookbook:
 * - Every message costs 4 tokens: <|start|>{role/name}\n{content}<|end|>\n
 * - Every reply is primed with 3 tokens: <|start|>assistant<|message|>
 *
 * These values are identical for gpt-4o, gpt-4.1, gpt-3.5-turbo, etc.
 * Source: https://cookbook.openai.com/examples/how_to_count_tokens_with_tiktoken
 */
const TOKENS_PER_MESSAGE = 4
const TOKENS_REPLY_PRIMING = 3

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  name?: string
}

export interface TokenCount {
  tokens: number
  characters: number
  ratio: number // chars-per-token for this text
}

export interface ChatTokenCount {
  total: number
  perMessage: { role: string; tokens: number; content: string }[]
  overhead: number // tokens used by chat formatting (role tags, separators)
}

/**
 * Count exact tokens in a string using BPE encoding.
 * Uses the same tokenizer OpenAI uses server-side.
 */
export function countExactTokens(text: string): TokenCount {
  const tokens = countTokens(text)
  return {
    tokens,
    characters: text.length,
    ratio: text.length / Math.max(tokens, 1),
  }
}

/**
 * Count tokens for an entire chat message array, including the per-message
 * overhead that OpenAI charges for (role tags, separators, priming).
 *
 * Uses the OpenAI-published formula from the tiktoken cookbook:
 * total = sum(TOKENS_PER_MESSAGE + countTokens(role) + countTokens(content)
 *             + countTokens(name) if name is present)
 *       + TOKENS_REPLY_PRIMING
 *
 * This matches the `prompt_tokens` value in OpenAI's usage response exactly.
 */
export function countChatTokens(messages: ChatMessage[]): ChatTokenCount {
  let totalTokens = 0

  const perMessage = messages.map((msg) => {
    const contentTokens = countTokens(msg.content)
    const roleTokens = countTokens(msg.role)
    const nameTokens = msg.name ? countTokens(msg.name) + 1 : 0 // +1 for name field overhead
    const messageTotal = TOKENS_PER_MESSAGE + roleTokens + contentTokens + nameTokens

    totalTokens += messageTotal

    return {
      role: msg.role,
      tokens: contentTokens,
      content:
        msg.content.length > 80
          ? msg.content.slice(0, 80) + "..."
          : msg.content,
    }
  })

  // Every conversation is primed with assistant reply tokens
  totalTokens += TOKENS_REPLY_PRIMING

  const contentTokens = perMessage.reduce((sum, m) => sum + m.tokens, 0)

  return {
    total: totalTokens,
    perMessage,
    overhead: totalTokens - contentTokens,
  }
}

/**
 * Check if text fits within a token budget WITHOUT encoding the full string.
 * This is an O(budget) operation - it stops encoding once the limit is hit,
 * making it much faster for large texts with small budgets.
 */
export function fitsInBudget(
  text: string,
  maxTokens: number
): { fits: boolean; tokenCount: number | false } {
  const result = isWithinTokenLimit(text, maxTokens)
  return {
    fits: result !== false,
    tokenCount: result,
  }
}

/**
 * Encode text to token IDs (useful for manual truncation).
 */
export function encodeText(text: string): number[] {
  return encode(text)
}

/**
 * Decode token IDs back to text.
 */
export function decodeTokens(tokens: number[]): string {
  return decode(tokens)
}

/**
 * Truncate text to fit within a specific token budget.
 * Returns the truncated text and how many tokens were cut.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number
): { text: string; originalTokens: number; finalTokens: number; truncated: boolean } {
  const tokens = encode(text)
  if (tokens.length <= maxTokens) {
    return {
      text,
      originalTokens: tokens.length,
      finalTokens: tokens.length,
      truncated: false,
    }
  }
  const truncatedTokens = tokens.slice(0, maxTokens)
  return {
    text: decode(truncatedTokens),
    originalTokens: tokens.length,
    finalTokens: maxTokens,
    truncated: true,
  }
}

/**
 * Count tokens for a specific model. This is a placeholder for
 * provider-specific tokenization. Currently, it simply counts tokens
 * using the OpenAI-compatible tokenizer (cl100k_base) for all models.
 * In future releases, this can dispatch to Anthropic or Google tokenizers.
 */
export function countModelTokens(modelId: string, text: string): number {
  // Normalize model identifier for case‑insensitive matching
  const id = modelId?.toLowerCase() ?? ""

  // Try Anthropic tokenizers for Claude models
  if (id.includes("claude") || id.includes("anthropic")) {
    // First try ai-tokenizer's Claude encoding (approximate but high accuracy)
    try {
      // Dynamically require to avoid bundling errors when dependency is absent
      const aiTok = require("ai-tokenizer")
      // ai-tokenizer exposes encodings under the "encoding" key
      const encoding = (aiTok?.encoding as any)?.claude
      const Tokenizer = aiTok?.default || aiTok.Tokenizer
      if (Tokenizer && encoding) {
        const tokenizer = new Tokenizer(encoding)
        return tokenizer.count(text)
      }
    } catch (err) {
      // ignore and fall back to other options
    }
    // Next try the official Anthropic tokenizer (may be outdated for Claude 3)
    try {
      const anthropicTokenizer = require("@anthropic-ai/tokenizer")
      if (typeof anthropicTokenizer.countTokens === "function") {
        return anthropicTokenizer.countTokens(text)
      }
    } catch (err) {
      // ignore and fall back
    }
    // Fallback to p50k_base via ai-tokenizer if available (approximation)
    try {
      const aiTok = require("ai-tokenizer")
      const encoding = (aiTok?.encoding as any)?.p50k_base
      const Tokenizer = aiTok?.default || aiTok.Tokenizer
      if (Tokenizer && encoding) {
        const tokenizer = new Tokenizer(encoding)
        return tokenizer.count(text)
      }
    } catch (err) {
      // ignore
    }
    // As a last resort, fall back to gpt-tokenizer
    return countTokens(text)
  }

  // Try Google Gemini/Gemma tokenizers
  if (id.includes("gemini") || id.includes("gemma") || id.includes("google")) {
    // Try gemini-token-estimator for quick estimation
    try {
      const geminiEstimator = require("gemini-token-estimator")
      if (typeof geminiEstimator.getTokenCount === "function") {
        return geminiEstimator.getTokenCount(text)
      }
    } catch (err) {
      // ignore and fall back
    }
    // Try ai-tokenizer with a Gemini encoding (if available)
    try {
      const aiTok = require("ai-tokenizer")
      // Some Gemini models share Gemma2 encoding; use gemma2 or gemini if present
      const encoding = (aiTok?.encoding as any)?.gemma2 || (aiTok?.encoding as any)?.gemini
      const Tokenizer = aiTok?.default || aiTok.Tokenizer
      if (Tokenizer && encoding) {
        const tokenizer = new Tokenizer(encoding)
        return tokenizer.count(text)
      }
    } catch (err) {
      // ignore
    }
    // Fallback to gpt-tokenizer
    return countTokens(text)
  }

  // Default: use OpenAI‑compatible tokenizer for other models
  return countTokens(text)
}
