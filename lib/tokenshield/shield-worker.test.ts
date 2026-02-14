import { describe, it, expect, beforeEach } from "vitest"
import { ShieldWorker, createShieldWorker } from "./shield-worker"

describe("ShieldWorker", () => {
  // -------------------------------------------------------
  // Inline mode (no Web Worker available in Vitest/Node.js)
  // -------------------------------------------------------
  describe("inline mode", () => {
    let worker: ShieldWorker

    beforeEach(async () => {
      worker = new ShieldWorker()
      await worker.init()
    })

    it("init() succeeds in inline mode", () => {
      expect(worker.isReady).toBe(true)
    })

    it("isReady is true after init", () => {
      expect(worker.isReady).toBe(true)
    })

    it("executionMode is 'inline' (no Worker available in Node.js)", () => {
      expect(worker.executionMode).toBe("inline")
    })

    it("find() returns null on empty engine", async () => {
      const result = await worker.find("anything at all")
      expect(result).toBeNull()
    })

    it("learn() then find() returns match", async () => {
      await worker.learn(
        "How do I configure my database connection?",
        "Use a connection string.",
        "gpt-4o",
        10,
        20,
      )
      const result = await worker.find("How do I configure my database connection?")
      expect(result).not.toBeNull()
      expect(result!.response).toBe("Use a connection string.")
      expect(result!.score).toBeGreaterThan(0.8)
    })

    it("clear() empties the engine", async () => {
      await worker.learn("Test prompt for the engine", "Test response", "gpt-4o", 5, 10)
      const stats1 = await worker.stats()
      expect(stats1.entries).toBe(1)

      await worker.clear()
      const stats2 = await worker.stats()
      expect(stats2.entries).toBe(0)
    })

    it("stats() returns correct counts", async () => {
      await worker.learn("First prompt for testing", "First", "gpt-4o", 5, 5)
      await worker.learn("Second prompt for testing", "Second", "gpt-4o", 5, 5)
      const stats = await worker.stats()
      expect(stats.entries).toBe(2)
      expect(stats.totalHits).toBe(2) // each learn starts with hits=1
    })

    it("terminate() sets isReady to false", () => {
      worker.terminate()
      expect(worker.isReady).toBe(false)
    })

    it("find() returns null after terminate (not ready)", async () => {
      worker.terminate()
      const result = await worker.find("anything at all")
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------
  // createShieldWorker factory
  // -------------------------------------------------------
  describe("createShieldWorker factory", () => {
    it("returns a ShieldWorker instance", () => {
      const sw = createShieldWorker()
      expect(sw).toBeInstanceOf(ShieldWorker)
    })
  })

  // -------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------
  describe("edge cases", () => {
    it("init() without config uses defaults", async () => {
      const sw = new ShieldWorker()
      await sw.init()
      expect(sw.isReady).toBe(true)
      expect(sw.executionMode).toBe("inline")
    })

    it("multiple find() calls work correctly", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await sw.learn("What is the capital of France?", "Paris.", "gpt-4o", 5, 5)
      await sw.learn("What is the capital of Germany?", "Berlin.", "gpt-4o", 5, 5)

      const r1 = await sw.find("What is the capital of France?")
      expect(r1).not.toBeNull()
      expect(r1!.response).toBe("Paris.")

      const r2 = await sw.find("What is the capital of Germany?")
      expect(r2).not.toBeNull()
      expect(r2!.response).toBe("Berlin.")
    })

    it("learn() + find() with model filter works", async () => {
      const sw = new ShieldWorker()
      await sw.init({ threshold: 0.5 })

      await sw.learn("How do I deploy to production?", "Use CI/CD pipelines.", "gpt-4o", 5, 10)

      // Same model should match
      const match = await sw.find("How do I deploy to production?", "gpt-4o")
      expect(match).not.toBeNull()
      expect(match!.response).toBe("Use CI/CD pipelines.")

      // Different model should not match
      const noMatch = await sw.find("How do I deploy to production?", "claude-3-opus")
      expect(noMatch).toBeNull()
    })
  })
})
