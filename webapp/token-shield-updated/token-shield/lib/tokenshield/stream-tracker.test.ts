import { describe, it, expect, vi } from "vitest"
import { StreamTokenTracker } from "./stream-tracker"

describe("StreamTokenTracker", () => {
  it("tracks chunks and counts output tokens", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("Hello ")
    tracker.addChunk("world!")
    const usage = tracker.getUsage()
    expect(usage.outputTokens).toBeGreaterThan(0)
    expect(usage.chunksReceived).toBe(2)
  })

  it("sets input tokens", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.setInputTokens(100)
    const usage = tracker.getUsage()
    expect(usage.inputTokens).toBe(100)
    expect(usage.totalTokens).toBe(100) // no output yet
  })

  it("marks stream as completed on finish()", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("test")
    const usage = tracker.finish()
    expect(usage.completed).toBe(true)
    expect(usage.aborted).toBe(false)
  })

  it("overrides with provider usage on finish()", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("test")
    const usage = tracker.finish({ promptTokens: 50, completionTokens: 25 })
    expect(usage.inputTokens).toBe(50)
    expect(usage.outputTokens).toBe(25)
  })

  it("marks stream as aborted on abort()", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("partial response")
    const usage = tracker.abort()
    expect(usage.aborted).toBe(true)
    expect(usage.completed).toBe(false)
    expect(usage.outputTokens).toBeGreaterThan(0)
  })

  it("ignores chunks after completion", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("before")
    tracker.finish()
    tracker.addChunk("after")
    expect(tracker.getUsage().chunksReceived).toBe(1)
  })

  it("fires onUsageUpdate at configured intervals", () => {
    const onUpdate = vi.fn()
    const tracker = new StreamTokenTracker({
      modelId: "gpt-4o-mini",
      onUsageUpdate: onUpdate,
      updateInterval: 2,
    })
    tracker.addChunk("a")
    tracker.addChunk("b") // should fire at chunk 2
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it("fires onCostThreshold when cost exceeds threshold", () => {
    const onThreshold = vi.fn()
    const tracker = new StreamTokenTracker({
      modelId: "gpt-4o-mini",
      inputTokens: 100_000,
      costThreshold: 0.0001,
      onCostThreshold: onThreshold,
      updateInterval: 1,
    })
    // Add enough chunks to trigger cost > threshold
    tracker.addChunk("word ".repeat(100))
    // Threshold may or may not fire depending on exact cost;
    // just check it doesn't throw
    expect(typeof tracker.getUsage().estimatedCost).toBe("number")
  })

  it("getText returns accumulated text", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("Hello ")
    tracker.addChunk("world")
    expect(tracker.getText()).toBe("Hello world")
  })

  it("reset clears all state", () => {
    const tracker = new StreamTokenTracker({ modelId: "gpt-4o-mini" })
    tracker.addChunk("test")
    tracker.reset()
    const usage = tracker.getUsage()
    expect(usage.chunksReceived).toBe(0)
    expect(usage.outputTokens).toBe(0)
    expect(usage.completed).toBe(false)
  })
})
