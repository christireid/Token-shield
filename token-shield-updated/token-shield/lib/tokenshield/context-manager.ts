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

import { countTokens, encode, decode } from "gpt-tokenizer"

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
 * Apply a token budget to a conversation. Keeps system messages pinned,
 * then fills from newest to oldest until the budget is exhausted.
 * This is exact - every token is counted.
 */
export function fitToBudget(
  messages: Message[],
  budget: ContextBudget
): ContextResult {
  const inputBudget = budget.maxContextTokens - budget.reservedForOutput

  // Separate pinned (system) messages from the rest
  const pinned = messages.filter(
    (m) => m.pinned || m.role === "system"
  )
  const unpinned = messages.filter(
    (m) => !m.pinned && m.role !== "system"
  )

  // Count pinned tokens first
  let pinnedTokens = 0
  for (const msg of pinned) {
    pinnedTokens += messageTokens(msg)
  }

  // 3 tokens for chat overhead (priming)
  const chatOverhead = 3
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
  const totalTokens = inputBudget - remainingBudget + chatOverhead

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
 * Sliding window: keep only the last N messages (plus system messages).
 * Returns exact token count of what's kept.
 */
export function slidingWindow(
  messages: Message[],
  maxMessages: number
): ContextResult {
  const system = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")
  const kept = maxMessages > 0 ? nonSystem.slice(-maxMessages) : []
  const evicted = maxMessages > 0 ? nonSystem.slice(0, -maxMessages) : nonSystem
  const finalMessages = [...system, ...kept]

  let totalTokens = 3 // chat overhead
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
 * Priority-based context: sort by priority, then fill by budget.
 * System messages are always included. Highest priority first.
 */
export function priorityFit(
  messages: Message[],
  budget: ContextBudget
): ContextResult {
  const inputBudget = budget.maxContextTokens - budget.reservedForOutput
  const system = messages.filter((m) => m.role === "system")
  const nonSystem = messages.filter((m) => m.role !== "system")

  // Sort by priority descending, then by timestamp descending (newest first)
  const sorted = [...nonSystem].sort((a, b) => {
    const pDiff = (b.priority ?? 0) - (a.priority ?? 0)
    if (pDiff !== 0) return pDiff
    return (b.timestamp ?? 0) - (a.timestamp ?? 0)
  })

  let pinnedTokens = 3
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
 * Generate a summary of evicted messages to preserve context.
 * Returns a compact system message that can be injected.
 */
export function createSummaryMessage(
  evictedMessages: Message[]
): Message {
  // Build a condensed representation of the conversation
  const summary = evictedMessages
    .map((m) => {
      // Truncate each message to first 100 chars for the summary
      const short =
        m.content.length > 100
          ? m.content.slice(0, 100) + "..."
          : m.content
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
 * Smart context management: combines budget fitting with automatic
 * summarization of evicted messages.
 */
export function smartFit(
  messages: Message[],
  budget: ContextBudget
): ContextResult {
  const result = fitToBudget(messages, budget)

  if (result.evictedCount > 0) {
    // Get the evicted messages
    const evictedMessages = messages.filter(
      (m) =>
        m.role !== "system" &&
        !m.pinned &&
        !result.messages.includes(m)
    )

    if (evictedMessages.length > 0) {
      const summaryMsg = createSummaryMessage(evictedMessages)
      const summaryTokens = messageTokens(summaryMsg)

      // Only add summary if it fits in the remaining budget
      if (summaryTokens <= result.budgetRemaining) {
        // Insert summary after system messages, before conversation
        const systemMsgs = result.messages.filter(
          (m) => m.role === "system"
        )
        const nonSystemMsgs = result.messages.filter(
          (m) => m.role !== "system"
        )
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
