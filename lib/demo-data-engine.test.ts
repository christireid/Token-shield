import { describe, it, expect } from "vitest"
import {
  rand,
  randInt,
  pickWeighted,
  makeDelta,
  generateEventMessage,
  generateSeedData,
  computeNextTick,
  createEmptyState,
  cloneInitialUsers,
  preGenerateTickIds,
  generateInitialPipelineMetrics,
  generateInitialProviderHealth,
  generateInitialAnomalies,
  generateInitialAlerts,
  MODELS,
  MODULE_KEYS,
  EVENT_TYPES,
  PIPELINE_STAGES,
  PROVIDERS,
  INITIAL_USERS,
} from "./demo-data-engine"

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

describe("rand", () => {
  it("returns values within the specified range", () => {
    for (let i = 0; i < 100; i++) {
      const val = rand(5, 10)
      expect(val).toBeGreaterThanOrEqual(5)
      expect(val).toBeLessThanOrEqual(10)
    }
  })
})

describe("randInt", () => {
  it("returns integers within the specified range", () => {
    for (let i = 0; i < 100; i++) {
      const val = randInt(0, 5)
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThan(5)
      expect(Number.isInteger(val)).toBe(true)
    }
  })
})

describe("pickWeighted", () => {
  it("always returns an item from the list", () => {
    for (let i = 0; i < 50; i++) {
      const result = pickWeighted(MODELS)
      expect(MODELS.some((m) => m.id === result.id)).toBe(true)
    }
  })

  it("returns the only item when there is one", () => {
    const result = pickWeighted([{ id: "only", weight: 1 }])
    expect(result.id).toBe("only")
  })
})

describe("makeDelta", () => {
  it("returns flat when previous is 0", () => {
    const delta = makeDelta(100, 0)
    expect(delta.direction).toBe("flat")
    expect(delta.percentChange).toBe(0)
  })

  it('returns "up" when current > previous', () => {
    const delta = makeDelta(120, 100)
    expect(delta.direction).toBe("up")
    expect(delta.percentChange).toBeCloseTo(20)
  })

  it('returns "down" when current < previous', () => {
    const delta = makeDelta(80, 100)
    expect(delta.direction).toBe("down")
    expect(delta.percentChange).toBeCloseTo(20)
  })

  it('returns "flat" when change is within 1%', () => {
    const delta = makeDelta(100.5, 100)
    expect(delta.direction).toBe("flat")
  })
})

describe("generateEventMessage", () => {
  it("generates a message for each event type", () => {
    for (const type of EVENT_TYPES) {
      const msg = generateEventMessage(type, "gpt-4o", 0.05)
      expect(msg.length).toBeGreaterThan(0)
    }
  })

  it("includes model name in cache:hit messages", () => {
    const msg = generateEventMessage("cache:hit", "claude-sonnet-4", 0.05)
    expect(msg).toContain("claude-sonnet-4")
  })
})

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

describe("constants", () => {
  it("MODELS weights sum to 1", () => {
    const totalWeight = MODELS.reduce((sum, m) => sum + m.weight, 0)
    expect(totalWeight).toBeCloseTo(1)
  })

  it("MODULE_KEYS has 5 entries", () => {
    expect(MODULE_KEYS).toHaveLength(5)
  })

  it("EVENT_TYPES has 8 entries", () => {
    expect(EVENT_TYPES).toHaveLength(8)
  })

  it("PIPELINE_STAGES has 6 entries", () => {
    expect(PIPELINE_STAGES).toHaveLength(6)
  })

  it("PROVIDERS has 3 entries", () => {
    expect(PROVIDERS).toHaveLength(3)
  })

  it("INITIAL_USERS has 4 entries", () => {
    expect(INITIAL_USERS).toHaveLength(4)
  })
})

/* ------------------------------------------------------------------ */
/*  Initial generators                                                 */
/* ------------------------------------------------------------------ */

describe("generateInitialPipelineMetrics", () => {
  it("generates one metric per pipeline stage", () => {
    const metrics = generateInitialPipelineMetrics()
    expect(metrics).toHaveLength(PIPELINE_STAGES.length)
    for (const m of metrics) {
      expect(PIPELINE_STAGES).toContain(m.stage)
      expect(m.avgDurationMs).toBeGreaterThan(0)
      expect(m.successRate).toBeGreaterThanOrEqual(96)
    }
  })
})

describe("generateInitialProviderHealth", () => {
  it("generates one record per provider", () => {
    const health = generateInitialProviderHealth()
    expect(health).toHaveLength(PROVIDERS.length)
    for (const h of health) {
      expect(h.status).toBe("healthy")
      expect(h.uptimePercent).toBeGreaterThanOrEqual(99.5)
    }
  })
})

describe("generateInitialAnomalies", () => {
  it("generates 3 anomalies with unique IDs", () => {
    let counter = 0
    const anomalies = generateInitialAnomalies(() => ++counter)
    expect(anomalies).toHaveLength(3)
    const ids = anomalies.map((a) => a.id)
    expect(new Set(ids).size).toBe(3)
  })
})

describe("generateInitialAlerts", () => {
  it("generates 1 warning alert", () => {
    let counter = 0
    const alerts = generateInitialAlerts(() => ++counter)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe("warning")
    expect(alerts[0].dismissed).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  cloneInitialUsers                                                  */
/* ------------------------------------------------------------------ */

describe("cloneInitialUsers", () => {
  it("returns deep copies without reference sharing", () => {
    const users = cloneInitialUsers()
    expect(users).toHaveLength(INITIAL_USERS.length)
    // Mutating the clone should not affect the original
    users[0].limits.daily = 999
    expect(INITIAL_USERS[0].limits.daily).toBe(25)
  })
})

/* ------------------------------------------------------------------ */
/*  createEmptyState                                                   */
/* ------------------------------------------------------------------ */

describe("createEmptyState", () => {
  it("returns a valid DashboardData with zero values", () => {
    const state = createEmptyState()
    expect(state.totalSpent).toBe(0)
    expect(state.totalSaved).toBe(0)
    expect(state.timeSeries).toHaveLength(0)
    expect(state.events).toHaveLength(0)
    expect(state.users).toHaveLength(INITIAL_USERS.length)
    expect(state.pipelineMetrics).toHaveLength(PIPELINE_STAGES.length)
    expect(state.providerHealth).toHaveLength(PROVIDERS.length)
  })
})

/* ------------------------------------------------------------------ */
/*  generateSeedData                                                   */
/* ------------------------------------------------------------------ */

describe("generateSeedData", () => {
  it("generates 60 time series points", () => {
    let counter = 0
    const data = generateSeedData(() => ++counter)
    expect(data.timeSeries).toHaveLength(60)
  })

  it("produces positive cumulative values", () => {
    let counter = 0
    const data = generateSeedData(() => ++counter)
    expect(data.totalSpent).toBeGreaterThan(0)
    expect(data.totalSaved).toBeGreaterThan(0)
    expect(data.savingsRate).toBeGreaterThan(0)
  })

  it("generates events with unique IDs", () => {
    let counter = 0
    const data = generateSeedData(() => ++counter)
    const eventIds = data.events.map((e) => e.id)
    expect(new Set(eventIds).size).toBe(eventIds.length)
  })

  it("includes anomalies and alerts", () => {
    let counter = 0
    const data = generateSeedData(() => ++counter)
    expect(data.anomalies.length).toBeGreaterThan(0)
    expect(data.alerts.length).toBeGreaterThan(0)
  })

  it("has sparklines with correct length", () => {
    let counter = 0
    const data = generateSeedData(() => ++counter)
    expect(data.sparklines.saved).toHaveLength(20)
    expect(data.sparklines.spent).toHaveLength(20)
  })
})

/* ------------------------------------------------------------------ */
/*  preGenerateTickIds                                                 */
/* ------------------------------------------------------------------ */

describe("preGenerateTickIds", () => {
  it("always generates an eventId", () => {
    let counter = 0
    const ids = preGenerateTickIds(() => ++counter)
    expect(ids.eventId).toBe(1)
  })

  it("generates anomalyId only when shouldGenerateAnomaly is true", () => {
    let counter = 0
    const ids = preGenerateTickIds(() => ++counter)
    if (ids.shouldGenerateAnomaly) {
      expect(ids.anomalyId).toBeGreaterThan(0)
    } else {
      expect(ids.anomalyId).toBe(0)
    }
  })
})

/* ------------------------------------------------------------------ */
/*  computeNextTick                                                    */
/* ------------------------------------------------------------------ */

describe("computeNextTick", () => {
  it("increments totalRequests by 1", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: false,
      anomalyId: 0,
      shouldGenerateAlert: false,
      alertId: 0,
    }
    const next = computeNextTick(seed, ids)
    expect(next.totalRequests).toBe(seed.totalRequests + 1)
  })

  it("adds a new event", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: false,
      anomalyId: 0,
      shouldGenerateAlert: false,
      alertId: 0,
    }
    const next = computeNextTick(seed, ids)
    expect(next.events.length).toBeGreaterThanOrEqual(seed.events.length)
    expect(next.events[next.events.length - 1].id).toBe(200)
  })

  it("does not mutate the previous state", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const prevRequests = seed.totalRequests
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: false,
      anomalyId: 0,
      shouldGenerateAlert: false,
      alertId: 0,
    }
    computeNextTick(seed, ids)
    expect(seed.totalRequests).toBe(prevRequests)
  })

  it("generates an anomaly when shouldGenerateAnomaly is true", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: true,
      anomalyId: 201,
      shouldGenerateAlert: false,
      alertId: 0,
    }
    const next = computeNextTick(seed, ids)
    expect(next.anomalies.length).toBeGreaterThan(seed.anomalies.length)
  })

  it("generates an alert when shouldGenerateAlert is true", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: false,
      anomalyId: 0,
      shouldGenerateAlert: true,
      alertId: 202,
    }
    const next = computeNextTick(seed, ids)
    expect(next.alerts.length).toBeGreaterThan(seed.alerts.length)
  })

  it("updates sparklines to max 20 entries", () => {
    let counter = 100
    const seed = generateSeedData(() => ++counter)
    const ids = {
      eventId: 200,
      shouldGenerateAnomaly: false,
      anomalyId: 0,
      shouldGenerateAlert: false,
      alertId: 0,
    }
    const next = computeNextTick(seed, ids)
    expect(next.sparklines.saved.length).toBeLessThanOrEqual(20)
  })
})
