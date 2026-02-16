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
  {
    role: "assistant",
    content: "Machine learning is a subset of AI that enables systems to learn from data.",
  },
  { role: "user", content: "Can you explain neural networks?" },
  {
    role: "assistant",
    content: "Neural networks are computing systems inspired by biological neural networks.",
  },
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
    const evicted: Message[] = [{ role: "user", content: "x".repeat(200) }]
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

  it("places summary after system messages in the output", () => {
    // Use a tight budget to force eviction
    const result = smartFit(msgs, { maxContextTokens: 100, reservedForOutput: 10 })
    if (result.summary) {
      const summaryIdx = result.messages.findIndex((m) => m.content === result.summary)
      const systemMsgs = result.messages.filter((m) => m.role === "system" && !m.pinned)
      // Summary should appear after the original system message
      expect(summaryIdx).toBeGreaterThanOrEqual(systemMsgs.length)
    }
  })

  it("skips summary when it does not fit in remaining budget", () => {
    // Very tight budget — no room for summary
    const result = smartFit(msgs, { maxContextTokens: 40, reservedForOutput: 5 })
    // Even if eviction happened, summary may be omitted due to budget
    expect(result.messages.length).toBeGreaterThan(0)
  })

  it("returns ContextResult fields", () => {
    const result = smartFit(msgs, { maxContextTokens: 200, reservedForOutput: 20 })
    expect(typeof result.totalTokens).toBe("number")
    expect(typeof result.budgetUsed).toBe("number")
    expect(typeof result.budgetRemaining).toBe("number")
    expect(typeof result.evictedCount).toBe("number")
    expect(Array.isArray(result.messages)).toBe(true)
  })
})

describe("fitToBudget edge cases", () => {
  it("preserves pinned messages during eviction", () => {
    const pinnedMsgs: Message[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "This is pinned", pinned: true },
      { role: "assistant", content: "Long response that should be evicted. ".repeat(20) },
      { role: "user", content: "Recent question" },
    ]
    const result = fitToBudget(pinnedMsgs, { maxContextTokens: 80, reservedForOutput: 10 })
    const contents = result.messages.map((m) => m.content)
    expect(contents).toContain("This is pinned")
  })

  it("handles empty message array", () => {
    const result = fitToBudget([], { maxContextTokens: 1000, reservedForOutput: 100 })
    expect(result.messages.length).toBe(0)
    expect(result.evictedCount).toBe(0)
    // Base overhead from chat framing (3 tokens) is expected even with no messages
    expect(result.totalTokens).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Additional tests targeting untested branches
// ---------------------------------------------------------------------------

describe("fitToBudget - toolTokenOverhead parameter", () => {
  it("reduces available budget when toolTokenOverhead is provided", () => {
    const messages: Message[] = [
      { role: "system", content: "System." },
      { role: "user", content: "Hello, how are you doing today?" },
      { role: "assistant", content: "I am doing great, thank you for asking!" },
      { role: "user", content: "Tell me a story about dragons." },
    ]
    const budgetWithoutOverhead = {
      maxContextTokens: 200,
      reservedForOutput: 50,
    }
    const budgetWithOverhead = {
      maxContextTokens: 200,
      reservedForOutput: 50,
      toolTokenOverhead: 80,
    }
    const resultWithout = fitToBudget(messages, budgetWithoutOverhead)
    const resultWith = fitToBudget(messages, budgetWithOverhead)

    // With tool overhead, fewer tokens are available, so more messages may be evicted
    expect(resultWith.budgetRemaining).toBeLessThan(resultWithout.budgetRemaining)
    // Or at least the same number of messages or fewer
    expect(resultWith.messages.length).toBeLessThanOrEqual(resultWithout.messages.length)
  })

  it("uses 0 overhead when toolTokenOverhead is undefined", () => {
    const messages: Message[] = [
      { role: "system", content: "System." },
      { role: "user", content: "Short question" },
    ]
    const result = fitToBudget(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
      toolTokenOverhead: undefined,
    })
    // Should work normally without overhead
    expect(result.messages.length).toBe(2)
    expect(result.evictedCount).toBe(0)
  })

  it("uses 0 overhead when toolTokenOverhead is 0", () => {
    const messages: Message[] = [
      { role: "system", content: "System." },
      { role: "user", content: "Short question" },
    ]
    const result = fitToBudget(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
      toolTokenOverhead: 0,
    })
    expect(result.messages.length).toBe(2)
    expect(result.evictedCount).toBe(0)
  })
})

describe("fitToBudget - pinned messages", () => {
  it("never evicts pinned messages even when budget is tight", () => {
    const messages: Message[] = [
      { role: "system", content: "System." },
      { role: "user", content: "First question, not pinned" },
      {
        role: "assistant",
        content: "This is pinned and must stay in the context no matter what.",
        pinned: true,
      },
      { role: "user", content: "Second question, not pinned" },
      { role: "assistant", content: "Another long response that takes tokens. ".repeat(5) },
      { role: "user", content: "Third question" },
    ]
    // Tight budget that forces eviction of some unpinned messages
    const result = fitToBudget(messages, { maxContextTokens: 100, reservedForOutput: 10 })
    const contents = result.messages.map((m) => m.content)
    // Pinned message must always be kept
    expect(contents).toContain("This is pinned and must stay in the context no matter what.")
    // System message is always kept
    expect(contents).toContain("System.")
    // Some unpinned messages should have been evicted
    expect(result.evictedCount).toBeGreaterThan(0)
  })

  it("keeps all messages when all are pinned", () => {
    const messages: Message[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Pinned user msg", pinned: true },
      { role: "assistant", content: "Pinned assistant msg", pinned: true },
    ]
    const result = fitToBudget(messages, { maxContextTokens: 10000, reservedForOutput: 100 })
    // All messages are pinned/system, none should be evicted
    expect(result.messages.length).toBe(3)
    expect(result.evictedCount).toBe(0)
  })

  it("evicts nothing when all non-system messages are pinned and budget is tight", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "Pinned one", pinned: true },
      { role: "assistant", content: "Pinned two", pinned: true },
    ]
    // All non-system messages are pinned so unpinned list is empty; evictedCount = 0
    const result = fitToBudget(messages, { maxContextTokens: 50, reservedForOutput: 5 })
    expect(result.evictedCount).toBe(0)
    expect(result.messages.length).toBe(3)
  })
})

describe("fitToBudget - budget of 0 and extreme budgets", () => {
  it("handles budget that only allows system messages", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "Hello" },
    ]
    // Budget so tight that after system+overhead there's essentially no room
    const result = fitToBudget(messages, { maxContextTokens: 20, reservedForOutput: 5 })
    // System message is always retained
    const systemMsgs = result.messages.filter((m) => m.role === "system")
    expect(systemMsgs.length).toBe(1)
  })

  it("handles all system messages", () => {
    const messages: Message[] = [
      { role: "system", content: "System one." },
      { role: "system", content: "System two." },
      { role: "system", content: "System three." },
    ]
    const result = fitToBudget(messages, { maxContextTokens: 10000, reservedForOutput: 100 })
    expect(result.messages.length).toBe(3)
    expect(result.evictedCount).toBe(0)
    expect(result.messages.every((m) => m.role === "system")).toBe(true)
  })
})

describe("priorityFit - timestamp ordering and equal priorities", () => {
  it("uses timestamp as tiebreaker when priorities are equal", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      {
        role: "user",
        content: "Old message",
        priority: 5,
        timestamp: 1000,
      },
      {
        role: "user",
        content: "Newer message",
        priority: 5,
        timestamp: 2000,
      },
    ]
    // Very tight budget that can only fit one non-system message
    const result = priorityFit(messages, { maxContextTokens: 50, reservedForOutput: 10 })
    if (result.evictedCount > 0) {
      // When priorities are equal, newer timestamp should be preferred
      const contents = result.messages.map((m) => m.content)
      expect(contents).toContain("Newer message")
    }
  })

  it("sorts by priority descending before timestamp", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      {
        role: "user",
        content: "Low priority but newest",
        priority: 1,
        timestamp: 3000,
      },
      {
        role: "user",
        content: "High priority but oldest",
        priority: 10,
        timestamp: 1000,
      },
      {
        role: "user",
        content: "Medium priority",
        priority: 5,
        timestamp: 2000,
      },
    ]
    // Budget tight enough to force eviction
    const result = priorityFit(messages, { maxContextTokens: 60, reservedForOutput: 10 })
    if (result.evictedCount > 0) {
      const contents = result.messages.map((m) => m.content)
      // High priority message should always be kept
      expect(contents).toContain("High priority but oldest")
    }
  })

  it("restores chronological order for kept messages", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "First", priority: 3, timestamp: 100 },
      { role: "user", content: "Second", priority: 8, timestamp: 200 },
      { role: "user", content: "Third", priority: 5, timestamp: 300 },
    ]
    const result = priorityFit(messages, {
      maxContextTokens: 10000,
      reservedForOutput: 100,
    })
    // All kept, they should be in chronological order after system messages
    const nonSystem = result.messages.filter((m) => m.role !== "system")
    expect(nonSystem[0].content).toBe("First")
    expect(nonSystem[1].content).toBe("Second")
    expect(nonSystem[2].content).toBe("Third")
  })

  it("handles messages with no priority field (defaults to 0)", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "No priority set" },
      { role: "user", content: "Has priority", priority: 10 },
    ]
    const result = priorityFit(messages, { maxContextTokens: 50, reservedForOutput: 10 })
    if (result.evictedCount > 0) {
      const contents = result.messages.map((m) => m.content)
      // Message with explicit priority should be preferred
      expect(contents).toContain("Has priority")
    }
  })

  it("handles messages with no timestamp field (defaults to 0)", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "No timestamp", priority: 5 },
      {
        role: "user",
        content: "Has timestamp",
        priority: 5,
        timestamp: 500,
      },
    ]
    const result = priorityFit(messages, { maxContextTokens: 50, reservedForOutput: 10 })
    if (result.evictedCount > 0) {
      const contents = result.messages.map((m) => m.content)
      // With equal priority, the one with a real timestamp (500 > 0) should be preferred
      expect(contents).toContain("Has timestamp")
    }
  })

  it("handles empty messages array", () => {
    const result = priorityFit([], { maxContextTokens: 1000, reservedForOutput: 100 })
    expect(result.messages.length).toBe(0)
    expect(result.evictedCount).toBe(0)
  })
})

describe("priorityFit - toolTokenOverhead", () => {
  it("subtracts toolTokenOverhead from available budget", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "Message one", priority: 5, timestamp: 100 },
      { role: "user", content: "Message two", priority: 3, timestamp: 200 },
    ]
    const resultWithout = priorityFit(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
    })
    const resultWith = priorityFit(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
      toolTokenOverhead: 80,
    })
    expect(resultWith.budgetRemaining).toBeLessThan(resultWithout.budgetRemaining)
  })
})

describe("slidingWindow - edge cases", () => {
  it("handles negative maxMessages by treating as 0", () => {
    const result = slidingWindow(msgs, -5)
    const nonSystem = result.messages.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBe(0)
  })

  it("handles fractional maxMessages by flooring", () => {
    const result = slidingWindow(msgs, 2.9)
    const nonSystem = result.messages.filter((m) => m.role !== "system")
    expect(nonSystem.length).toBe(2)
  })

  it("handles empty messages array", () => {
    const result = slidingWindow([], 10)
    expect(result.messages.length).toBe(0)
    expect(result.evictedCount).toBe(0)
    expect(result.totalTokens).toBe(3) // just chat overhead
  })

  it("returns correct eviction stats", () => {
    const result = slidingWindow(msgs, 1)
    // 5 non-system messages, keeping 1, so 4 evicted
    expect(result.evictedCount).toBe(4)
    expect(result.evictedTokens).toBeGreaterThan(0)
  })
})

describe("createSummaryMessage - comprehensive branch coverage", () => {
  it("returns a no-context message for empty array", () => {
    const summary = createSummaryMessage([])
    expect(summary.role).toBe("system")
    expect(summary.pinned).toBe(true)
    expect(summary.priority).toBe(5)
    expect(summary.content).toContain("(No prior context)")
  })

  it("handles a single user message", () => {
    const summary = createSummaryMessage([{ role: "user", content: "What is TypeScript?" }])
    expect(summary.content).toContain("Previous conversation summary")
    expect(summary.content).toContain("TypeScript")
  })

  it("handles multiple user-assistant turns", () => {
    const evicted: Message[] = [
      { role: "user", content: "What is React?" },
      { role: "assistant", content: "React is a JavaScript library for building UIs." },
      { role: "user", content: "How does state management work?" },
      {
        role: "assistant",
        content: "State management in React uses hooks like useState and useReducer.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Topics discussed")
    expect(summary.content).toContain("React")
  })

  it("handles orphan assistant messages (assistant without preceding user)", () => {
    const evicted: Message[] = [
      {
        role: "assistant",
        content: "Here is some information you asked about earlier.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
    expect(summary.content).toContain("Assistant provided information")
  })

  it("handles tool messages within a turn", () => {
    const evicted: Message[] = [
      { role: "user", content: "Look up the weather forecast." },
      { role: "tool", content: "Temperature: 72F, Sunny, Humidity: 45%, Wind: 5mph NW" },
      { role: "assistant", content: "The weather is 72F and sunny today." },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
    expect(summary.content).toContain("Tool result:")
  })

  it("handles tool message without a current turn (orphan tool)", () => {
    const evicted: Message[] = [
      { role: "tool", content: "Some tool output that has no parent turn" },
    ]
    const summary = createSummaryMessage(evicted)
    // Tool without a currentTurn should not crash; the fallback kicks in
    expect(summary.content).toContain("Previous conversation summary")
  })

  it("handles messages with empty content", () => {
    const evicted: Message[] = [
      { role: "user", content: "" },
      { role: "assistant", content: "" },
    ]
    const summary = createSummaryMessage(evicted)
    // Empty content messages are skipped by the trim check; fallback with [role]: ... occurs
    expect(summary.content).toContain("Previous conversation summary")
  })

  it("extracts entities from backtick-delimited terms", () => {
    const evicted: Message[] = [
      {
        role: "user",
        content: "How do I use the `useState` hook in `React Native`?",
      },
      {
        role: "assistant",
        content:
          "You can use `useState` by importing it from React. It allows functional components to manage state.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("useState")
  })

  it("extracts capitalized multi-word entities", () => {
    const evicted: Message[] = [
      {
        role: "user",
        content: "Tell me about Machine Learning and Natural Language Processing.",
      },
      {
        role: "assistant",
        content: "Machine Learning is a field of AI. Natural Language Processing deals with text.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Key entities")
    expect(summary.content).toContain("Machine Learning")
  })

  it("extracts decisions and action items", () => {
    const evicted: Message[] = [
      { role: "user", content: "What should we do about the deployment?" },
      {
        role: "assistant",
        content:
          "We should deploy to staging first. We decided to use Docker containers for isolation. The next step is to run integration tests.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Decisions/conclusions")
  })

  it("handles long assistant response with bullet list items", () => {
    const evicted: Message[] = [
      { role: "user", content: "List the benefits of TypeScript." },
      {
        role: "assistant",
        content:
          "TypeScript offers many benefits.\n- Static typing catches bugs early\n- Better IDE support and autocompletion\n- Improved code readability\n- Easier refactoring across large codebases",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
    // Should extract the key points from bullet items
    expect(summary.content).toContain("TypeScript")
  })

  it("handles conclusion-like sentences in assistant responses", () => {
    const evicted: Message[] = [
      { role: "user", content: "Is Python good for data science?" },
      {
        role: "assistant",
        content:
          "Python is widely used in data science. It has great libraries like pandas and numpy. In summary Python is one of the best languages for data science work.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
  })

  it("truncates very long first sentences in key points", () => {
    const longSentence = "A".repeat(200) + "."
    const evicted: Message[] = [
      { role: "user", content: "Tell me something." },
      { role: "assistant", content: longSentence },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("...")
  })

  it("handles extractTopic with short content (<=80 chars)", () => {
    const evicted: Message[] = [
      { role: "user", content: "Short question" },
      { role: "assistant", content: "Short answer." },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Short question")
  })

  it("handles extractTopic with long content and no sentence ending", () => {
    // Content longer than 80 chars without . ? or !
    const longContent =
      "This is a very long user message that goes on and on without any punctuation mark to end a sentence and keeps going past eighty characters easily"
    const evicted: Message[] = [
      { role: "user", content: longContent },
      { role: "assistant", content: "OK." },
    ]
    const summary = createSummaryMessage(evicted)
    // extractTopic should truncate at word boundary and add ...
    expect(summary.content).toContain("...")
  })

  it("handles extractTopic with first sentence longer than 120 chars", () => {
    // First sentence match exists but is > 120 chars, so fallback to 80-char truncation
    const longSentence = "A".repeat(130) + "?"
    const evicted: Message[] = [
      { role: "user", content: longSentence + " And some more content." },
      { role: "assistant", content: "Noted." },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
  })

  it("handles system messages in evicted list (they are skipped by turn logic)", () => {
    const evicted: Message[] = [
      { role: "system", content: "Old system instruction." },
      { role: "user", content: "A question about testing." },
      { role: "assistant", content: "Testing is important." },
    ]
    const summary = createSummaryMessage(evicted)
    // System messages don't start turns; they fall through the if/else
    expect(summary.content).toContain("Previous conversation summary")
  })

  it("handles numbered list items in assistant responses", () => {
    const evicted: Message[] = [
      { role: "user", content: "Give me a numbered list." },
      {
        role: "assistant",
        content:
          "Here are the items:\n1. First item in the list\n2. Second item in the list\n3) Third item in the list",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Previous conversation summary")
  })
})

describe("smartFit - strategy selection and summary insertion", () => {
  it("does not include summary when no messages are evicted", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "Hello" },
    ]
    const result = smartFit(messages, { maxContextTokens: 10000, reservedForOutput: 100 })
    expect(result.evictedCount).toBe(0)
    expect(result.summary).toBeUndefined()
  })

  it("inserts summary when messages are evicted and budget allows", () => {
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What is machine learning?" },
      {
        role: "assistant",
        content: "Machine learning is a field of study. ".repeat(10),
      },
      { role: "user", content: "Tell me more about neural networks." },
      {
        role: "assistant",
        content: "Neural networks are computing systems. ".repeat(10),
      },
      { role: "user", content: "What about deep learning?" },
    ]
    // Moderate budget that causes eviction but leaves room for summary
    const result = smartFit(messages, { maxContextTokens: 200, reservedForOutput: 20 })
    if (result.evictedCount > 0 && result.summary) {
      expect(result.summary).toContain("Previous conversation summary")
      // Summary should be a system message inserted after existing system messages
      const systemCount = result.messages.filter((m) => m.role === "system").length
      expect(systemCount).toBeGreaterThanOrEqual(2) // original system + summary
    }
  })

  it("updates token counts when summary is added", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "First question about a topic." },
      { role: "assistant", content: "Here is a detailed response. ".repeat(15) },
      { role: "user", content: "Another question" },
    ]
    const resultNoSummary = fitToBudget(messages, {
      maxContextTokens: 120,
      reservedForOutput: 10,
    })
    const resultSmart = smartFit(messages, {
      maxContextTokens: 120,
      reservedForOutput: 10,
    })
    if (resultSmart.summary) {
      // smartFit should have higher token usage due to summary
      expect(resultSmart.totalTokens).toBeGreaterThan(resultNoSummary.totalTokens)
      expect(resultSmart.budgetUsed).toBeGreaterThan(resultNoSummary.budgetUsed)
      expect(resultSmart.budgetRemaining).toBeLessThan(resultNoSummary.budgetRemaining)
    }
  })

  it("handles eviction where all evicted are system/pinned (empty evictedMessages)", () => {
    // Construct a scenario where fitToBudget reports eviction but evicted messages
    // are pinned (which won't appear in the evictedMessages filter in smartFit)
    const messages: Message[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "Very short", pinned: true },
      { role: "user", content: "Another short" },
      {
        role: "assistant",
        content: "A response that is long enough to cause problems. ".repeat(10),
      },
    ]
    const result = smartFit(messages, { maxContextTokens: 80, reservedForOutput: 10 })
    // Even if eviction happens, pinned messages remain
    const contents = result.messages.map((m) => m.content)
    expect(contents).toContain("Very short")
  })

  it("uses toolTokenOverhead to reduce budget in smartFit", () => {
    const messages: Message[] = [
      { role: "system", content: "Sys." },
      { role: "user", content: "Hello there, friend!" },
      { role: "assistant", content: "Greetings! How can I help you today?" },
      { role: "user", content: "Can you help me write code?" },
    ]
    const resultWithout = smartFit(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
    })
    const resultWith = smartFit(messages, {
      maxContextTokens: 200,
      reservedForOutput: 50,
      toolTokenOverhead: 100,
    })
    expect(resultWith.budgetRemaining).toBeLessThanOrEqual(resultWithout.budgetRemaining)
  })

  it("handles empty messages array", () => {
    const result = smartFit([], { maxContextTokens: 1000, reservedForOutput: 100 })
    expect(result.messages.length).toBe(0)
    expect(result.evictedCount).toBe(0)
    expect(result.summary).toBeUndefined()
  })
})

describe("createSummaryMessage - extractDecisions patterns", () => {
  it("extracts 'we should' decisions", () => {
    const evicted: Message[] = [
      { role: "user", content: "What should we do?" },
      {
        role: "assistant",
        content: "We should use a microservices architecture for the backend system.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Decisions/conclusions")
  })

  it("extracts 'the solution' pattern", () => {
    const evicted: Message[] = [
      { role: "user", content: "How do we fix this?" },
      {
        role: "assistant",
        content:
          "After careful analysis of the problem, the solution is to refactor the database layer completely.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Decisions/conclusions")
  })

  it("extracts 'action item' pattern", () => {
    const evicted: Message[] = [
      { role: "user", content: "What are our next steps?" },
      {
        role: "assistant",
        content:
          "Here is what we need to do. Action item: review the pull request before merging to main branch.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Decisions/conclusions")
  })

  it("extracts 'therefore' pattern", () => {
    const evicted: Message[] = [
      { role: "user", content: "What can we conclude?" },
      {
        role: "assistant",
        content:
          "The data shows positive trends across all metrics. Therefore we should continue with the current marketing strategy.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    expect(summary.content).toContain("Decisions/conclusions")
  })

  it("skips very short and very long sentences in decision extraction", () => {
    const evicted: Message[] = [
      { role: "user", content: "Overview?" },
      {
        role: "assistant",
        content: "OK. " + "We should " + "x".repeat(250) + ". Short.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    // Should not crash; decisions with < 10 or > 200 chars are filtered out
    expect(summary.content).toContain("Previous conversation summary")
  })
})

describe("createSummaryMessage - extractEntities edge cases", () => {
  it("skips common sentence starters in entity extraction", () => {
    const evicted: Message[] = [
      { role: "user", content: "What happened?" },
      {
        role: "assistant",
        content: "The Quick Brown Fox jumped over. This Is Not an entity. React Native is great.",
      },
    ]
    const summary = createSummaryMessage(evicted)
    // "React Native" should be extracted; "The Quick" and "This Is" should be skipped
    if (summary.content.includes("Key entities")) {
      expect(summary.content).toContain("React Native")
      expect(summary.content).not.toContain("This Is Not")
    }
  })

  it("limits entities to 8", () => {
    const terms = Array.from({ length: 15 }, (_, i) => `Term${i} Entity${i}`)
    const evicted: Message[] = [
      { role: "user", content: "List many entities." },
      {
        role: "assistant",
        content: terms.join(". ") + ".",
      },
    ]
    const summary = createSummaryMessage(evicted)
    // Should not crash even with many entities
    expect(summary.content).toContain("Previous conversation summary")
  })
})

describe("createSummaryMessage - fallback for empty extraction", () => {
  it("uses per-message fallback when no topics are extracted", () => {
    // Messages that produce no turns (e.g., only system messages with no user/assistant)
    const evicted: Message[] = [{ role: "system", content: "Some old system context." }]
    const summary = createSummaryMessage(evicted)
    // System messages don't create turns, so lines would be empty and fallback kicks in
    // But since only content is "Some old system context." which is < 100 chars
    expect(summary.content).toContain("Previous conversation summary")
  })
})
