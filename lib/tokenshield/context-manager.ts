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
  /**
   * Token overhead from tool/function definitions. When tools are attached to
   * a request, their JSON schemas consume hidden tokens that must be subtracted
   * from the available input budget. Use `countToolTokens(tools).totalTokens`
   * from the tool-token-counter module to calculate this value.
   */
  toolTokenOverhead?: number
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
  const inputBudget =
    budget.maxContextTokens - budget.reservedForOutput - (budget.toolTokenOverhead ?? 0)

  // Separate pinned (system) messages from the rest
  const pinned = messages.filter((m) => m.pinned || m.role === "system")
  const unpinned = messages.filter((m) => !m.pinned && m.role !== "system")

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
  const inputBudget =
    budget.maxContextTokens - budget.reservedForOutput - (budget.toolTokenOverhead ?? 0)
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
 * Generate a pinned system message summarizing evicted messages.
 *
 * Uses extractive summarization to produce a compact, useful summary:
 * 1. Groups messages into conversational turns (user question + assistant answer)
 * 2. Extracts the key topic from each turn using the first sentence or question
 * 3. Identifies entities, decisions, and action items mentioned
 * 4. Produces a bullet-point summary that preserves essential context
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
  if (evictedMessages.length === 0) {
    return {
      role: "system",
      content: "Previous conversation summary:\n(No prior context)",
      pinned: true,
      priority: 5,
    }
  }

  // --- Step 1: Group into conversational turns ---
  const turns: { topic: string; keyPoints: string[] }[] = []
  let currentTurn: { topic: string; keyPoints: string[] } | null = null

  for (const msg of evictedMessages) {
    const content = msg.content.trim()
    if (!content) continue

    if (msg.role === "user") {
      // Start a new turn with the user's question/request as the topic
      if (currentTurn) turns.push(currentTurn)
      currentTurn = {
        topic: extractTopic(content),
        keyPoints: [],
      }
    } else if (msg.role === "assistant" && currentTurn) {
      // Extract key points from the assistant's response
      const points = extractKeyPoints(content)
      currentTurn.keyPoints.push(...points)
    } else if (msg.role === "assistant" && !currentTurn) {
      // Orphan assistant message — create a turn for it
      currentTurn = {
        topic: "Assistant provided information",
        keyPoints: extractKeyPoints(content),
      }
    } else if (msg.role === "tool") {
      // Tool results — note them briefly
      if (currentTurn) {
        currentTurn.keyPoints.push(
          `Tool result: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`,
        )
      }
    }
  }
  if (currentTurn) turns.push(currentTurn)

  // --- Step 2: Extract entities and decisions across all messages ---
  const allContent = evictedMessages.map((m) => m.content).join(" ")
  const entities = extractEntities(allContent)
  const decisions = extractDecisions(allContent)

  // --- Step 3: Build the summary ---
  const lines: string[] = []

  // Topics discussed (bullet points)
  if (turns.length > 0) {
    lines.push("Topics discussed:")
    for (const turn of turns) {
      lines.push(`- ${turn.topic}`)
      // Include up to 2 key points per turn to keep it compact
      for (const point of turn.keyPoints.slice(0, 2)) {
        lines.push(`  * ${point}`)
      }
    }
  }

  // Key entities mentioned
  if (entities.length > 0) {
    lines.push(`Key entities: ${entities.join(", ")}`)
  }

  // Decisions or conclusions reached
  if (decisions.length > 0) {
    lines.push("Decisions/conclusions:")
    for (const d of decisions.slice(0, 3)) {
      lines.push(`- ${d}`)
    }
  }

  // Fallback: if extraction produced nothing useful, use a compact per-message format
  if (lines.length === 0) {
    for (const m of evictedMessages) {
      const short = m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content
      lines.push(`[${m.role}]: ${short}`)
    }
  }

  return {
    role: "system",
    content: `Previous conversation summary:\n${lines.join("\n")}`,
    pinned: true,
    priority: 5,
  }
}

/**
 * Extract a short topic description from a user message.
 * Uses the first sentence or the first 80 characters, whichever is shorter.
 */
function extractTopic(content: string): string {
  // Try to get the first sentence (ends with . ? or !)
  const firstSentenceMatch = content.match(/^[^.!?\n]+[.!?]/)
  if (firstSentenceMatch && firstSentenceMatch[0].length <= 120) {
    return firstSentenceMatch[0].trim()
  }
  // Fall back to first 80 chars
  if (content.length <= 80) return content
  // Try to break at a word boundary
  const truncated = content.slice(0, 80)
  const lastSpace = truncated.lastIndexOf(" ")
  return (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated) + "..."
}

/**
 * Extract key points from an assistant response.
 * Focuses on: first sentence, any listed items, and conclusions.
 */
function extractKeyPoints(content: string): string[] {
  const points: string[] = []
  const sentences = content.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)

  if (sentences.length === 0) return points

  // First sentence is usually the direct answer
  const firstSentence = sentences[0].trim()
  if (firstSentence.length <= 150) {
    points.push(firstSentence)
  } else {
    points.push(firstSentence.slice(0, 150) + "...")
  }

  // Look for bullet/numbered list items (they're usually key points)
  const listItems = content.match(/^\s*[-*•]\s+.+$/gm) ?? content.match(/^\s*\d+[.)]\s+.+$/gm) ?? []
  for (const item of listItems.slice(0, 3)) {
    const cleaned = item.replace(/^\s*[-*•\d.)]+\s+/, "").trim()
    if (cleaned.length > 0 && cleaned.length <= 100) {
      points.push(cleaned)
    }
  }

  // Look for conclusion-like sentences
  for (const s of sentences.slice(1)) {
    const lower = s.toLowerCase()
    if (
      lower.startsWith("in summary") ||
      lower.startsWith("in conclusion") ||
      lower.startsWith("therefore") ||
      lower.startsWith("the key") ||
      lower.startsWith("the answer") ||
      lower.startsWith("to summarize") ||
      lower.startsWith("overall")
    ) {
      if (s.length <= 150) points.push(s.trim())
      break
    }
  }

  // Deduplicate and limit
  return [...new Set(points)].slice(0, 4)
}

/**
 * Extract notable entities (proper nouns, technical terms) from text.
 * Uses capitalization patterns and common technical term markers.
 */
function extractEntities(text: string): string[] {
  // Cap input to prevent slow regex on very large conversations
  const capped = text.length > 10_000 ? text.slice(0, 10_000) : text
  const entities = new Set<string>()

  // Match capitalized multi-word names (e.g., "Machine Learning", "React Native")
  const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g
  const matches = capped.match(capitalizedPattern) ?? []
  for (const m of matches) {
    // Skip common sentence starters
    if (
      !["The", "This", "That", "These", "Those", "What", "How", "Why", "When", "Where"].some((w) =>
        m.startsWith(w + " "),
      )
    ) {
      entities.add(m)
    }
  }

  // Match technical terms in backticks
  const backtickPattern = /`([^`]+)`/g
  let match
  while ((match = backtickPattern.exec(capped)) !== null) {
    if (match[1].length <= 40) entities.add(match[1])
  }

  // Limit to 8 most-mentioned entities
  return [...entities].slice(0, 8)
}

/**
 * Extract decisions, conclusions, or action items from text.
 */
function extractDecisions(text: string): string[] {
  // Cap input to prevent slow processing on very large conversations
  const capped = text.length > 10_000 ? text.slice(0, 10_000) : text
  const decisions: string[] = []
  const sentences = capped.split(/(?<=[.!?])\s+/)

  const decisionPatterns = [
    /\b(?:we (?:should|decided|agreed|chose|will)|the (?:solution|answer|best (?:approach|option|way))|i (?:recommend|suggest))\b/i,
    /\b(?:in conclusion|therefore|as a result|the decision|final (?:answer|solution))\b/i,
    /\b(?:action item|next step|todo|to-do|follow[- ]up)\b/i,
  ]

  for (const s of sentences) {
    if (s.length < 10 || s.length > 200) continue
    for (const pattern of decisionPatterns) {
      if (pattern.test(s)) {
        decisions.push(s.trim())
        break
      }
    }
  }

  return [...new Set(decisions)].slice(0, 3)
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
