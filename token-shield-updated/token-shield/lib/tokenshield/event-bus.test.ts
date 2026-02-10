import { describe, it, expect, vi } from "vitest"
import { shieldEvents, createEventBus } from "./event-bus"

describe("event-bus", () => {
  it("shieldEvents is a mitt emitter", () => {
    expect(typeof shieldEvents.on).toBe("function")
    expect(typeof shieldEvents.emit).toBe("function")
    expect(typeof shieldEvents.off).toBe("function")
  })

  it("createEventBus returns independent emitter", () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on("request:blocked", handler)
    bus.emit("request:blocked", { reason: "test", estimatedCost: 0.01 })
    expect(handler).toHaveBeenCalledWith({ reason: "test", estimatedCost: 0.01 })
  })

  it("events do not leak between buses", () => {
    const bus1 = createEventBus()
    const bus2 = createEventBus()
    const handler = vi.fn()
    bus1.on("cache:hit", handler)
    bus2.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0 })
    expect(handler).not.toHaveBeenCalled()
  })

  it("off removes handler", () => {
    const bus = createEventBus()
    const handler = vi.fn()
    bus.on("cache:miss", handler)
    bus.off("cache:miss", handler)
    bus.emit("cache:miss", { prompt: "test" })
    expect(handler).not.toHaveBeenCalled()
  })
})
