/**
 * TokenShield - Context Manager
 *
 * Manages conversation history within a token budget. Uses exact token
 * counting (gpt-tokenizer) to fit the maximum useful context into
 * every request without exceeding limits.
 *
 * Strategies:
 * - Sliding window: keep N most recent messages
 * - Token budget: fill from newest to oldest until budget is full
 * - Priority pinning: system messages are always preserved
 * - Summarization hook: replace old messages with a summary
 */

import { countTokens } from "gpt-tokenizer"

/** OpenAI chat completion priming overhead (see tiktoken cookbook) */
const CHAT_OVERHEAD_TOKENS = 3

export interface Message {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  /** Optional priority: higher = more likely to be kept */
  priority?: number
  /** Timestamp for ordering */
  timestamp?: number
  /** Whether this message should never be evicted */
  pinned?: boolean
}

export interface ContextBudget {
  /** Max tokens for the entire context (prompt + response) */
  maxContextTokens: number
  /** Reserved tokens for the model's response */
  reservedForOutput: number
  /** Reserved tokens for system prompt (auto-calculated if not set) */
  reservedForSystem?: number
}

export interface ContextResult {
  messages: Message[]
  totalTokens: number
  evictedCount: number
  evictedTokens: number
  budgetUsed: number
  budgetRemaining: number
  summary?: string
}

/**
 * Count the exact tokens in a single message, including the per-message
 * overhead that OpenAI charges.
 *
 * OpenAI's formula: 4 (structural tokens) + role tokens + content tokens
 * Source: tiktoken cookbook
 */
function messageTokens(msg: Message): number {
  const structuralOverhead = 4
  const roleTokens = countTokens(msg.role)
  const contentTokens = countTokens(msg.content)
  return structuralOverhead + roleTokens + contentTokens
}

/**
 * Apply a token budget to a conversation, keeping as many recent messages as possible.
 *
 * System and pinned messages are always retained. Remaining messages are
 * added from newest to oldest until the token budget is exhausted. Uses
 * exact BPE token counting for every message.
 *
 * @param messages - The full array of conversation messages
 * @param budget - The token budget configuration (max context tokens, reserved output tokens)
 * @returns A {@link ContextResult} with the trimmed messages, token counts, and eviction stats
 * @example
 * ```ts
 * const result = fitToBudget(messages, {
 *   maxContextTokens: 4096,
 *   reservedForOutput: 1024,
 * })
 * // result.messages — messages that fit within the budget
 * // result.evictedCount — number of messages dropped
 * ```
 */
export function fitToBudget(messages: Message[], budget: ContextBudget): ContextResult {
  const inputBudget = budget.maxContextTokens - budget.reservedForOutput

  // Separate pinned (system) messages from the rest
  const pinned = messages.filter((m) => m.pinned || m.role === "system")
  const unpinned = messages.filter((m) => !m.pinned && m.role !== "system")

  // Count pinned tokens first
  let pinnedTokens = 0
  for (const msg of pinned) {
    pinnedTokens += messageTokens(msg)
  }

  const chatOverhead = CHAT_OVERHEAD_TOKENS
  let remainingBudget = inputBudget - pinnedTokens - chatOverhead

  // Fill from newest to oldest
  const kept: Message[] = []
  let evictedCount = 0
  let evictedTokens = 0

  // Iterate from the end (newest) to the start (oldest)
  for (let i = unpinned.length - 1; i >= 0; i--) {
    const msg = unpinned[i]
    const tokens = messageTokens(msg)
    if (tokens <= remainingBudget) {
      kept.unshift(msg) // prepend to maintain order
      remainingBudget -= tokens
    } else {
      evictedCount++
      evictedTokens += tokens
    }
  }

  const finalMessages = [...pinned, ...kept]
  // remainingBudget already has chatOverhead subtracted from its initial value,
  // so (inputBudget - remainingBudget) = pinnedTokens + chatOverhead + keptTokens
  const totalTokens = inputBudget - remainingBudget

  return {
    messages: finalMessages,
    totalTokens,
    evictedCount,
    evictedTokens,
    budgetUsed: totalTokens,
    budgetRemaining: remainingBudget,
  }
}

/**
 * Keep only the last N non-system messages plus all system messages.
 *
 * A simple sliding-window strategy that always retains system messages
 * and keeps the most recent `maxMessages` conversation turns. Returns
 * exact token counts for both kept and evicted messages.
 *
 * @param messages - The full array of conversation messages
 * @param maxMessages - Maximum number of non-system messages to retain
 * @returns A {@link ContextResult} with the windowed messages and eviction stats
 * @example
 * ```ts
 * const result = slidingWindow(messages, 10)
 * // result.messages — system msgs + last 10 conversation messages
 * // result.evictedCount — messages dropped from the front
 * ```
 */
export function slidingWindow(messages: Message[], maxMessages: number): ContextResult {
  const safeMax = Math.max(0, Math.floor(maxMessages))
  const system = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")
  const kept = safeMax > 0 ? nonSystem.slice(-safeMax) : []
  const evicted = safeMax > 0 ? nonSystem.slice(0, -safeMax) : nonSystem
  const finalMessages = [...system, ...kept]

  let totalTokens = CHAT_OVERHEAD_TOKENS
  for (const msg of finalMessages) {
    totalTokens += messageTokens(msg)
  }

  let evictedTokens = 0
  for (const msg of evicted) {
    evictedTokens += messageTokens(msg)
  }

  return {
    messages: finalMessages,
    totalTokens,
    evictedCount: evicted.length,
    evictedTokens,
    budgetUsed: totalTokens,
    budgetRemaining: 0,
  }
}

/**
 * Fill the token budget by message priority, keeping the highest-priority messages first.
 *
 * System messages are always included. Non-system messages are sorted by
 * descending priority (then by newest timestamp) and greedily packed into
 * the remaining budget. Kept messages are re-sorted into chronological
 * order before being returned.
 *
 * @param messages - The full array of conversation messages (with optional `priority` and `timestamp` fields)
 * @param budget - The token budget configuration (max context tokens, reserved output tokens)
 * @returns A {@link ContextResult} with priority-selected messages and eviction stats
 * @example
 * ```ts
 * const result = priorityFit(messages, {
 *   maxContextTokens: 4096,
 *   reservedForOutput: 1024,
 * })
 * // High-priority messages are kept even if older
 * ```
 */
export function priorityFit(messages: Message[], budget: ContextBudget): ContextResult {
  const inputBudget = budget.maxContextTokens - budget.reservedForOutput
  const system = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")

  // Sort by priority descending, then by timestamp descending (newest first)
  const sorted = [...nonSystem].sort((a, b) => {
    const pDiff = (b.priority ?? 0) - (a.priority ?? 0)
    if (pDiff !== 0) return pDiff
    return (b.timestamp ?? 0) - (a.timestamp ?? 0)
  })

  let pinnedTokens = CHAT_OVERHEAD_TOKENS
  for (const msg of system) {
    pinnedTokens += messageTokens(msg)
  }

  let remaining = inputBudget - pinnedTokens
  const kept: Message[] = []
  let evictedCount = 0
  let evictedTokens = 0

  for (const msg of sorted) {
    const tokens = messageTokens(msg)
    if (tokens <= remaining) {
      kept.push(msg)
      remaining -= tokens
    } else {
      evictedCount++
      evictedTokens += tokens
    }
  }

  // Restore chronological order for the kept messages
  kept.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))

  const finalMessages = [...system, ...kept]
  const totalTokens = inputBudget - remaining

  return {
    messages: finalMessages,
    totalTokens,
    evictedCount,
    evictedTokens,
    budgetUsed: totalTokens,
    budgetRemaining: remaining,
  }
}

/**
 * Generate a pinned system message summarizing evicted messages.
 *
 * Builds a compact text representation of each evicted message (role + first
 * 100 characters) and wraps it in a system message. The result can be injected
 * into the conversation to preserve context that was dropped by budget fitting.
 *
 * @param evictedMessages - Array of messages that were evicted from the context
 * @returns A pinned system {@link Message} containing the summary text
 * @example
 * ```ts
 * const summary = createSummaryMessage(evictedMsgs)
 * // summary.role === "system"
 * // summary.content starts with "Previous conversation summary:\n"
 * ```
 */
export function createSummaryMessage(evictedMessages: Message[]): Message {
  // Build a condensed representation of the conversation
  const summary = evictedMessages
    .map((m) => {
      // Truncate each message to first 100 chars for the summary
      const short = m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content
      return `[${m.role}]: ${short}`
    })
    .join("\n")

  return {
    role: "system",
    content: `Previous conversation summary:\n${summary}`,
    pinned: true,
    priority: 5,
  }
}

/**
 * Fit messages to a token budget and automatically summarize evicted messages.
 *
 * Combines {@link fitToBudget} with {@link createSummaryMessage}. After
 * trimming messages to fit the budget, any evicted messages are condensed
 * into a summary system message that is inserted after the system prompt
 * (if it fits in the remaining budget).
 *
 * @param messages - The full array of conversation messages
 * @param budget - The token budget configuration (max context tokens, reserved output tokens)
 * @returns A {@link ContextResult} with trimmed messages, eviction stats, and an optional `summary` field
 * @example
 * ```ts
 * const result = smartFit(messages, {
 *   maxContextTokens: 4096,
 *   reservedForOutput: 1024,
 * })
 * if (result.summary) {
 *   console.log("Evicted context summarized:", result.summary)
 * }
 * ```
 */
export function smartFit(messages: Message[], budget: ContextBudget): ContextResult {
  const result = fitToBudget(messages, budget)

  if (result.evictedCount > 0) {
    // Get the evicted messages
    const evictedMessages = messages.filter(
      (m) => m.role !== "system" && !m.pinned && !result.messages.includes(m),
    )

    if (evictedMessages.length > 0) {
      const summaryMsg = createSummaryMessage(evictedMessages)
      const summaryTokens = messageTokens(summaryMsg)

      // Only add summary if it fits in the remaining budget
      if (summaryTokens <= result.budgetRemaining) {
        // Insert summary after system messages, before conversation
        const systemMsgs = result.messages.filter((m) => m.role === "system")
        const nonSystemMsgs = result.messages.filter((m) => m.role !== "system")
        result.messages = [...systemMsgs, summaryMsg, ...nonSystemMsgs]
        result.totalTokens += summaryTokens
        result.budgetUsed += summaryTokens
        result.budgetRemaining -= summaryTokens
        result.summary = summaryMsg.content
      }
    }
  }

  return result
}
