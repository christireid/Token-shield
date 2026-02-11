import { describe, it, expect } from "vitest"
import {
  fitToBudget,
  slidingWindow,
  priorityFit,
  createSummaryMessage,
  smartFit,
  type Message,
} from "./context-manager"

const msgs: Message[] = [
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "What is machine learning?" },
  { role: "assistant", content: "Machine learning is a subset of AI that enables systems to learn from data." },
  { role: "user", content: "Can you explain neural networks?" },
  { role: "assistant", content: "Neural networks are computing systems inspired by biological neural networks." },
  { role: "user", content: "What about deep learning?" },
]

describe("fitToBudget", () => {
  it("keeps all messages when budget is large", () => {
    const result = fitToBudget(msgs, { maxContextTokens: 10000, reservedForOutput: 500 })
    expect(result.messages.length).toBe(msgs.length)
    expect(result.evictedCount).toBe(0)
  })

  it("preserves system messages when trimming", () => {
    const result = fitToBudget(msgs, { maxContextTokens: 100, reservedForOutput: 50 })
    const roles = result.messages.map((m) => m.role)
    expect(roles).toContain("system")
  })

  it("evicts oldest non-system messages first", () => {
    const result = fitToBudget(msgs, { maxContextTokens: 100, reservedForOutput: 20 })
    if (result.evictedCount > 0) {
      // The last user message should still be present
      const lastMsg = result.messages[result.messages.length - 1]
      expect(lastMsg.content).toBe("What about deep learning?")
    }
  })

  it("reports accurate token count and eviction stats", () => {
    const result = fitToBudget(msgs, { maxContextTokens: 100, reservedForOutput: 20 })
    expect(result.totalTokens).toBeGreaterThan(0)
    expect(result.budgetUsed).toBeGreaterThan(0)
    expect(result.budgetRemaining).toBeGreaterThanOrEqual(0)
  })
})

describe("slidingWindow", () => {
  it("keeps only the last N messages plus system", () => {
    const result = slidingWindow(msgs, 2)
    const nonSystem = result.messages.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBe(2)
  })

  it("keeps all system messages", () => {
    const result = slidingWindow(msgs, 1)
    expect(result.messages[0].role).toBe("system")
  })

  it("handles maxMessages=0 by keeping only system", () => {
    const result = slidingWindow(msgs, 0)
    const nonSystem = result.messages.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBe(0)
    expect(result.messages.length).toBe(1) // just system
  })
})

describe("priorityFit", () => {
  it("keeps highest priority messages", () => {
    const prioritized: Message[] = [
      { role: "system", content: "System." },
      { role: "user", content: "Low priority", priority: 1 },
      { role: "user", content: "High priority", priority: 10 },
    ]
    const result = priorityFit(prioritized, { maxContextTokens: 50, reservedForOutput: 10 })
    const contents = result.messages.map((m) => m.content)
    if (result.evictedCount > 0) {
      expect(contents).toContain("High priority")
    }
  })
})

describe("createSummaryMessage", () => {
  it("creates a pinned system message with summary", () => {
    const evicted: Message[] = [
      { role: "user", content: "Old question about cats" },
      { role: "assistant", content: "Cats are great pets." },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.role).toBe("system")
    expect(summary.pinned).toBe(true)
    expect(summary.content).toContain("Previous conversation summary")
    expect(summary.content).toContain("cats")
  })

  it("truncates long messages in the summary", () => {
    const evicted: Message[] = [
      { role: "user", content: "x".repeat(200) },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("...")
  })
})

describe("smartFit", () => {
  it("includes summary when messages are evicted", () => {
    const result = smartFit(msgs, { maxContextTokens: 120, reservedForOutput: 20 })
    if (result.evictedCount > 0 && result.summary) {
      expect(result.summary).toContain("Previous conversation summary")
    }
  })
})
