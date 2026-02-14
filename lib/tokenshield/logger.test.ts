import { describe, it, expect, vi } from "vitest"
import mitt from "mitt"
import { TokenShieldLogger, createLogger, logger, type LogEntry } from "./logger"
import type { TokenShieldEvents } from "./event-bus"

// ---------------------------------------------------------------------------
// Constructor defaults
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - Constructor defaults", () => {
  it("default level is info", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    // debug should be filtered out at info level
    log.debug("mod", "debug msg")
    expect(handler).not.toHaveBeenCalled()
    // info should pass
    log.info("mod", "info msg")
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("default timestamps is true (timestamp > 0)", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.info("mod", "hello")
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.timestamp).toBeGreaterThan(0)
  })

  it("timestamps: false sets timestamp to 0", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, timestamps: false })
    log.info("mod", "hello")
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.timestamp).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Log level filtering
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - Log level filtering", () => {
  it("debug messages are filtered at info level", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "info" })
    log.debug("mod", "hidden")
    expect(handler).not.toHaveBeenCalled()
  })

  it("error always passes regardless of level", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "error" })
    log.debug("mod", "no")
    log.info("mod", "no")
    log.warn("mod", "no")
    log.error("mod", "yes")
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].level).toBe("error")
  })

  it("debug level lets all messages through", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    log.debug("mod", "d")
    log.info("mod", "i")
    log.warn("mod", "w")
    log.error("mod", "e")
    expect(handler).toHaveBeenCalledTimes(4)
  })

  it("warn level filters debug and info", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "warn" })
    log.debug("mod", "no")
    log.info("mod", "no")
    log.warn("mod", "yes")
    log.error("mod", "yes")
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Custom handler
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - Custom handler", () => {
  it("receives LogEntry with correct fields", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.info("myModule", "test message", { key: "value" })
    expect(handler).toHaveBeenCalledTimes(1)
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.level).toBe("info")
    expect(entry.module).toBe("myModule")
    expect(entry.message).toBe("test message")
    expect(entry.timestamp).toBeGreaterThan(0)
    expect(entry.data).toEqual({ key: "value" })
  })

  it("data field is omitted when not provided", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.info("mod", "no data")
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.data).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// debug / info / warn / error methods
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - debug/info/warn/error", () => {
  it("debug emits level debug", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    log.debug("m", "msg")
    expect(handler.mock.calls[0][0].level).toBe("debug")
  })

  it("info emits level info", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.info("m", "msg")
    expect(handler.mock.calls[0][0].level).toBe("info")
  })

  it("warn emits level warn", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.warn("m", "msg")
    expect(handler.mock.calls[0][0].level).toBe("warn")
  })

  it("error emits level error", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler })
    log.error("m", "msg")
    expect(handler.mock.calls[0][0].level).toBe("error")
  })
})

// ---------------------------------------------------------------------------
// startSpan
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - startSpan", () => {
  it("creates span with spanId, traceId, and name", () => {
    const log = new TokenShieldLogger()
    const span = log.startSpan("test-span")
    expect(span.spanId).toBeDefined()
    expect(typeof span.spanId).toBe("string")
    expect(span.traceId).toBeDefined()
    expect(typeof span.traceId).toBe("string")
    expect(span.name).toBe("test-span")
    expect(span.startTime).toBeGreaterThan(0)
  })

  it("end() sets endTime on the span", () => {
    const log = new TokenShieldLogger()
    const span = log.startSpan("s1")
    span.end()
    const completed = log.getSpans()[0]
    expect(completed.endTime).toBeGreaterThan(0)
    expect(completed.endTime).toBeGreaterThanOrEqual(completed.startTime)
  })

  it("end() merges additional attributes", () => {
    const log = new TokenShieldLogger()
    const span = log.startSpan("s1", { a: 1 })
    span.end({ b: 2 })
    const completed = log.getSpans()[0]
    expect(completed.attributes).toEqual({ a: 1, b: 2 })
  })

  it("addEvent() adds events to the span", () => {
    const log = new TokenShieldLogger()
    const span = log.startSpan("s1")
    span.addEvent("checkpoint", { step: 1 })
    span.addEvent("done")
    const completed = log.getSpans()[0]
    expect(completed.events).toHaveLength(2)
    expect(completed.events[0].name).toBe("checkpoint")
    expect(completed.events[0].attributes).toEqual({ step: 1 })
    expect(completed.events[1].name).toBe("done")
    expect(completed.events[1].timestamp).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// getSpans / clearSpans
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - getSpans / clearSpans", () => {
  it("getSpans returns all created spans", () => {
    const log = new TokenShieldLogger()
    log.startSpan("s1")
    log.startSpan("s2")
    log.startSpan("s3")
    expect(log.getSpans()).toHaveLength(3)
  })

  it("clearSpans empties the array", () => {
    const log = new TokenShieldLogger()
    log.startSpan("s1")
    log.startSpan("s2")
    expect(log.getSpans()).toHaveLength(2)
    log.clearSpans()
    expect(log.getSpans()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// connectEventBus
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - connectEventBus", () => {
  it("subscribes to event bus events and logs them", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    const bus = mitt<TokenShieldEvents>()
    log.connectEventBus(bus)

    bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0.05 })
    // cache:hit maps to level 'info', which passes at level 'debug'
    expect(handler).toHaveBeenCalled()
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.module).toBe("cache:hit")
    expect(entry.message).toBe("Event: cache:hit")
  })

  it("returns unsubscribe function that cleans up", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    const bus = mitt<TokenShieldEvents>()
    const unsub = log.connectEventBus(bus)

    // Should receive events before unsubscribe
    bus.emit("cache:miss", { prompt: "test" })
    expect(handler).toHaveBeenCalledTimes(1)

    handler.mockClear()
    unsub()

    // Should NOT receive events after unsubscribe
    bus.emit("cache:miss", { prompt: "test2" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("maps event types to correct log levels", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    const bus = mitt<TokenShieldEvents>()
    log.connectEventBus(bus)

    // breaker:tripped should be 'error'
    bus.emit("breaker:tripped", { limitType: "session", currentSpend: 5, limit: 5, action: "stop" })
    const errorEntry: LogEntry = handler.mock.calls[handler.mock.calls.length - 1][0]
    expect(errorEntry.level).toBe("error")

    // breaker:warning should be 'warn'
    bus.emit("breaker:warning", {
      limitType: "session",
      currentSpend: 4,
      limit: 5,
      percentUsed: 80,
    })
    const warnEntry: LogEntry = handler.mock.calls[handler.mock.calls.length - 1][0]
    expect(warnEntry.level).toBe("warn")

    // request:allowed should be 'debug'
    bus.emit("request:allowed", { prompt: "hi", model: "gpt-4o-mini" })
    const debugEntry: LogEntry = handler.mock.calls[handler.mock.calls.length - 1][0]
    expect(debugEntry.level).toBe("debug")
  })
})

// ---------------------------------------------------------------------------
// enableSpans
// ---------------------------------------------------------------------------

describe("TokenShieldLogger - enableSpans", () => {
  it("when true, span start emits debug log entry", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug", enableSpans: true })
    log.startSpan("my-span")
    expect(handler).toHaveBeenCalledTimes(1)
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.level).toBe("debug")
    expect(entry.message).toContain("my-span started")
  })

  it("when true, span end emits info log entry", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug", enableSpans: true })
    const span = log.startSpan("my-span")
    handler.mockClear()
    span.end()
    expect(handler).toHaveBeenCalledTimes(1)
    const entry: LogEntry = handler.mock.calls[0][0]
    expect(entry.level).toBe("info")
    expect(entry.message).toContain("my-span completed")
  })

  it("when false (default), no span logs are emitted", () => {
    const handler = vi.fn()
    const log = new TokenShieldLogger({ handler, level: "debug" })
    const span = log.startSpan("my-span")
    span.end()
    // No log entries should be emitted for span lifecycle
    expect(handler).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// createLogger factory + singleton
// ---------------------------------------------------------------------------

describe("createLogger / logger singleton", () => {
  it("createLogger returns a configured TokenShieldLogger instance", () => {
    const log = createLogger({ level: "error" })
    expect(log).toBeInstanceOf(TokenShieldLogger)
    // Verify it's configured at error level
    const handler = vi.fn()
    const log2 = createLogger({ level: "error", handler })
    log2.info("mod", "should be filtered")
    expect(handler).not.toHaveBeenCalled()
    log2.error("mod", "should pass")
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("exported logger singleton exists and is a TokenShieldLogger", () => {
    expect(logger).toBeDefined()
    expect(logger).toBeInstanceOf(TokenShieldLogger)
    expect(typeof logger.info).toBe("function")
    expect(typeof logger.error).toBe("function")
    expect(typeof logger.startSpan).toBe("function")
  })
})
