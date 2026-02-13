/**
 * React Context Tests
 *
 * Tests for the createSavingsStore() pure factory function.
 * Does NOT test React components/hooks (requires React Testing Library).
 */

import { describe, it, expect } from "vitest"
import { createSavingsStore, type SavingsEvent } from "./react-context"

function makeEvent(overrides: Partial<SavingsEvent> = {}): SavingsEvent {
  return {
    timestamp: Date.now(),
    type: "cache_hit",
    tokensSaved: 100,
    dollarsSaved: 0.05,
    details: "test event",
    ...overrides,
  }
}

describe("createSavingsStore", () => {
  it("returns an object with the expected API", () => {
    const store = createSavingsStore()

    expect(typeof store.getState).toBe("function")
    expect(typeof store.subscribe).toBe("function")
    expect(typeof store.addEvent).toBe("function")
    expect(typeof store.incrementRequests).toBe("function")
    expect(typeof store.reset).toBe("function")
  })

  it("starts with empty state", () => {
    const store = createSavingsStore()
    const state = store.getState()

    expect(state.events).toEqual([])
    expect(state.totalTokensSaved).toBe(0)
    expect(state.totalDollarsSaved).toBe(0)
    expect(state.totalRequestsMade).toBe(0)
    expect(state.totalRequestsBlocked).toBe(0)
    expect(state.totalCacheHits).toBe(0)
  })

  it("addEvent increments totals", () => {
    const store = createSavingsStore()

    store.addEvent(makeEvent({ tokensSaved: 200, dollarsSaved: 0.10 }))

    const state = store.getState()
    expect(state.events).toHaveLength(1)
    expect(state.totalTokensSaved).toBe(200)
    expect(state.totalDollarsSaved).toBe(0.10)
  })

  it("addEvent counts cache_hit events", () => {
    const store = createSavingsStore()

    store.addEvent(makeEvent({ type: "cache_hit" }))
    store.addEvent(makeEvent({ type: "context_trim" }))
    store.addEvent(makeEvent({ type: "cache_hit" }))

    expect(store.getState().totalCacheHits).toBe(2)
  })

  it("addEvent counts request_blocked events", () => {
    const store = createSavingsStore()

    store.addEvent(makeEvent({ type: "request_blocked" }))
    store.addEvent(makeEvent({ type: "cache_hit" }))
    store.addEvent(makeEvent({ type: "request_blocked" }))

    expect(store.getState().totalRequestsBlocked).toBe(2)
  })

  it("addEvent caps events at 500", () => {
    const store = createSavingsStore()

    for (let i = 0; i < 550; i++) {
      store.addEvent(makeEvent({ tokensSaved: 1, dollarsSaved: 0.001 }))
    }

    const state = store.getState()
    expect(state.events).toHaveLength(500)
    expect(state.totalTokensSaved).toBe(550)
  })

  it("incrementRequests increases totalRequestsMade", () => {
    const store = createSavingsStore()

    store.incrementRequests()
    store.incrementRequests()
    store.incrementRequests()

    expect(store.getState().totalRequestsMade).toBe(3)
  })

  it("reset clears all state", () => {
    const store = createSavingsStore()

    store.addEvent(makeEvent())
    store.addEvent(makeEvent())
    store.incrementRequests()

    store.reset()

    const state = store.getState()
    expect(state.events).toEqual([])
    expect(state.totalTokensSaved).toBe(0)
    expect(state.totalDollarsSaved).toBe(0)
    expect(state.totalRequestsMade).toBe(0)
    expect(state.totalRequestsBlocked).toBe(0)
    expect(state.totalCacheHits).toBe(0)
  })

  it("subscribe notifies on addEvent", () => {
    const store = createSavingsStore()
    let callCount = 0
    store.subscribe(() => { callCount++ })

    store.addEvent(makeEvent())
    expect(callCount).toBe(1)

    store.addEvent(makeEvent())
    expect(callCount).toBe(2)
  })

  it("subscribe notifies on incrementRequests", () => {
    const store = createSavingsStore()
    let callCount = 0
    store.subscribe(() => { callCount++ })

    store.incrementRequests()
    expect(callCount).toBe(1)
  })

  it("subscribe notifies on reset", () => {
    const store = createSavingsStore()
    let callCount = 0
    store.subscribe(() => { callCount++ })

    store.reset()
    expect(callCount).toBe(1)
  })

  it("unsubscribe stops notifications", () => {
    const store = createSavingsStore()
    let callCount = 0
    const unsub = store.subscribe(() => { callCount++ })

    store.addEvent(makeEvent())
    expect(callCount).toBe(1)

    unsub()
    store.addEvent(makeEvent())
    expect(callCount).toBe(1)
  })

  it("multiple subscribers are independent", () => {
    const store = createSavingsStore()
    let count1 = 0
    let count2 = 0

    const unsub1 = store.subscribe(() => { count1++ })
    store.subscribe(() => { count2++ })

    store.addEvent(makeEvent())
    expect(count1).toBe(1)
    expect(count2).toBe(1)

    unsub1()
    store.addEvent(makeEvent())
    expect(count1).toBe(1)
    expect(count2).toBe(2)
  })

  it("accumulates tokens and dollars across multiple events", () => {
    const store = createSavingsStore()

    store.addEvent(makeEvent({ tokensSaved: 100, dollarsSaved: 0.05 }))
    store.addEvent(makeEvent({ tokensSaved: 200, dollarsSaved: 0.10 }))
    store.addEvent(makeEvent({ tokensSaved: 50, dollarsSaved: 0.02 }))

    const state = store.getState()
    expect(state.totalTokensSaved).toBe(350)
    expect(state.totalDollarsSaved).toBeCloseTo(0.17)
  })
})
