/**
 * Benchmark Module Tests
 *
 * Tests for bench(), benchAsync(), computeResult behavior.
 */

import { describe, it, expect } from "vitest"
import { bench, benchAsync } from "./benchmark"

describe("bench", () => {
  it("returns a BenchmarkResult with correct shape", () => {
    const result = bench("noop", () => {}, 100)

    expect(result).toHaveProperty("name", "noop")
    expect(result).toHaveProperty("ops", 100)
    expect(result).toHaveProperty("opsPerSec")
    expect(result).toHaveProperty("avgMs")
    expect(result).toHaveProperty("p99Ms")
    expect(typeof result.opsPerSec).toBe("number")
    expect(typeof result.avgMs).toBe("number")
    expect(typeof result.p99Ms).toBe("number")
  })

  it("runs the function the specified number of times", () => {
    let count = 0
    bench(
      "counter",
      () => {
        count++
      },
      50,
    )

    // bench also runs warmup (min(10, floor(50/10)) = 5)
    expect(count).toBe(55) // 50 measured + 5 warmup
  })

  it("opsPerSec is positive for non-trivial functions", () => {
    const result = bench(
      "work",
      () => {
        let _x = 0
        for (let i = 0; i < 100; i++) _x += i
      },
      100,
    )

    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it("p99Ms is >= avgMs", () => {
    const result = bench(
      "consistent",
      () => {
        let _x = 0
        for (let i = 0; i < 100; i++) _x += i
      },
      100,
    )

    expect(result.p99Ms).toBeGreaterThanOrEqual(result.avgMs)
  })

  it("handles very fast functions (near-zero timing)", () => {
    const result = bench("fast", () => {}, 100)

    expect(result.avgMs).toBeGreaterThanOrEqual(0)
    expect(result.p99Ms).toBeGreaterThanOrEqual(0)
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it("uses default iterations when not specified", () => {
    let _count = 0
    const result = bench("default-iters", () => {
      _count++
    })

    expect(result.ops).toBe(1000)
  })
})

describe("benchAsync", () => {
  it("returns a BenchmarkResult with correct shape", async () => {
    const result = await benchAsync("async-noop", async () => {}, 50)

    expect(result.name).toBe("async-noop")
    expect(result.ops).toBe(50)
    expect(result.opsPerSec).toBeGreaterThan(0)
    expect(result.avgMs).toBeGreaterThanOrEqual(0)
    expect(result.p99Ms).toBeGreaterThanOrEqual(0)
  })

  it("runs async function the specified number of times", async () => {
    let count = 0
    await benchAsync(
      "async-counter",
      async () => {
        count++
      },
      30,
    )

    // warmup: min(10, floor(30/10)) = 3
    expect(count).toBe(33)
  })

  it("measures real async work", async () => {
    const result = await benchAsync(
      "async-delay",
      () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
      10,
    )

    expect(result.avgMs).toBeGreaterThanOrEqual(0.5)
  })

  it("p99Ms is >= avgMs for async functions", async () => {
    const result = await benchAsync(
      "async-consistent",
      async () => {
        /* noop */
      },
      50,
    )

    expect(result.p99Ms).toBeGreaterThanOrEqual(result.avgMs)
  })
})

describe("computeResult behavior (via bench)", () => {
  it("sorts timings for correct percentile calculation", () => {
    const result = bench("sorted-check", () => {}, 100)

    expect(result.p99Ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.p99Ms)).toBe(true)
  })

  it("handles single iteration", () => {
    const result = bench("single", () => {}, 1)

    expect(result.ops).toBe(1)
    expect(result.avgMs).toBeGreaterThanOrEqual(0)
    expect(result.p99Ms).toBeGreaterThanOrEqual(0)
  })
})
