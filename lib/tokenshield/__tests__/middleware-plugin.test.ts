import { describe, it, expect, beforeEach } from "vitest"
import {
  registerPlugin,
  unregisterPlugin,
  getRegisteredPlugins,
  clearPlugins,
  initializePlugins,
  type MiddlewarePlugin,
  type PluginContext,
} from "../middleware-plugin"
import { createEventBus } from "../event-bus"

describe("middleware-plugin", () => {
  beforeEach(() => {
    clearPlugins()
  })

  describe("registerPlugin", () => {
    it("registers a plugin", () => {
      const plugin: MiddlewarePlugin = {
        name: "test-plugin",
        version: "1.0.0",
        init: () => {},
      }
      registerPlugin(plugin)
      expect(getRegisteredPlugins()).toHaveLength(1)
      expect(getRegisteredPlugins()[0].name).toBe("test-plugin")
    })

    it("throws on duplicate registration", () => {
      const plugin: MiddlewarePlugin = {
        name: "dupe",
        version: "1.0.0",
        init: () => {},
      }
      registerPlugin(plugin)
      expect(() => registerPlugin(plugin)).toThrow('Plugin "dupe" is already registered')
    })

    it("allows re-registration after unregister", () => {
      const plugin: MiddlewarePlugin = {
        name: "re-reg",
        version: "1.0.0",
        init: () => {},
      }
      registerPlugin(plugin)
      unregisterPlugin("re-reg")
      expect(() => registerPlugin(plugin)).not.toThrow()
    })
  })

  describe("unregisterPlugin", () => {
    it("returns true when plugin exists", () => {
      registerPlugin({ name: "x", version: "1.0.0", init: () => {} })
      expect(unregisterPlugin("x")).toBe(true)
    })

    it("returns false when plugin does not exist", () => {
      expect(unregisterPlugin("nonexistent")).toBe(false)
    })
  })

  describe("clearPlugins", () => {
    it("removes all plugins", () => {
      registerPlugin({ name: "a", version: "1.0.0", init: () => {} })
      registerPlugin({ name: "b", version: "1.0.0", init: () => {} })
      expect(getRegisteredPlugins()).toHaveLength(2)
      clearPlugins()
      expect(getRegisteredPlugins()).toHaveLength(0)
    })
  })

  describe("initializePlugins", () => {
    it("calls init on all registered plugins", () => {
      const calls: string[] = []
      registerPlugin({
        name: "p1",
        version: "1.0.0",
        init: () => {
          calls.push("p1")
        },
      })
      registerPlugin({
        name: "p2",
        version: "1.0.0",
        init: () => {
          calls.push("p2")
        },
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        log: null,
        auditLog: null,
        config: {},
      }
      initializePlugins(ctx)
      expect(calls).toEqual(["p1", "p2"])
    })

    it("collects cleanup functions", () => {
      const cleanupCalled: string[] = []
      registerPlugin({
        name: "with-cleanup",
        version: "1.0.0",
        init: () => () => {
          cleanupCalled.push("cleaned")
        },
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        log: null,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)
      expect(cleanups).toHaveLength(1)
      cleanups[0]()
      expect(cleanupCalled).toEqual(["cleaned"])
    })

    it("auto-wires event subscriptions", () => {
      const received: unknown[] = []
      registerPlugin({
        name: "event-wired",
        version: "1.0.0",
        init: () => {},
        events: {
          "cache:hit": (data) => {
            received.push(data)
          },
        },
      })

      const bus = createEventBus()
      const ctx: PluginContext = {
        events: bus,
        log: null,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0.01 })
      expect(received).toHaveLength(1)
      expect((received[0] as Record<string, unknown>).savedCost).toBe(0.01)

      // Cleanup should unsubscribe
      for (const c of cleanups) c()
      bus.emit("cache:hit", { matchType: "fuzzy", similarity: 0.9, savedCost: 0.02 })
      expect(received).toHaveLength(1) // no new events after cleanup
    })

    it("handles plugin init failure gracefully", () => {
      registerPlugin({
        name: "bad-plugin",
        version: "1.0.0",
        init: () => {
          throw new Error("init failed")
        },
      })
      registerPlugin({
        name: "good-plugin",
        version: "1.0.0",
        init: () => {},
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        log: null,
        auditLog: null,
        config: {},
      }
      // Should not throw, just skip the bad plugin
      expect(() => initializePlugins(ctx)).not.toThrow()
    })
  })

  describe("initializePlugins — event auto-wiring branches", () => {
    it("skips non-function values in plugin.events", () => {
      const received: unknown[] = []
      registerPlugin({
        name: "mixed-events",
        version: "1.0.0",
        init: () => {},
        events: {
          "cache:hit": (data) => {
            received.push(data)
          },
          // Force a non-function value into the events map to exercise the
          // `typeof handler === "function"` === false branch (line 119).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "cache:miss": "not-a-function" as any,
        },
      })

      const bus = createEventBus()
      const ctx: PluginContext = {
        events: bus,
        log: null,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      // The valid handler should still be wired up
      bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0.05 })
      expect(received).toHaveLength(1)

      // Only the init return (none) + valid handler unsubscribe should be in cleanups.
      // The non-function entry must NOT produce a cleanup entry.
      expect(cleanups).toHaveLength(1) // one unsub for "cache:hit"
    })

    it("returns unsub cleanups for every function handler in plugin.events", () => {
      const hits: string[] = []
      registerPlugin({
        name: "multi-events",
        version: "1.0.0",
        init: () => {},
        events: {
          "cache:hit": () => {
            hits.push("cache:hit")
          },
          "cache:miss": () => {
            hits.push("cache:miss")
          },
        },
      })

      const bus = createEventBus()
      const ctx: PluginContext = {
        events: bus,
        log: null,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      // Both handlers wired
      bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0 })
      bus.emit("cache:miss", { similarity: 0 })
      expect(hits).toEqual(["cache:hit", "cache:miss"])

      // Two unsub cleanups (one per handler)
      expect(cleanups).toHaveLength(2)

      // After cleanup, events should no longer fire
      for (const c of cleanups) c()
      bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0 })
      bus.emit("cache:miss", { similarity: 0 })
      expect(hits).toEqual(["cache:hit", "cache:miss"]) // unchanged
    })
  })

  describe("initializePlugins — init failure branches", () => {
    it("logs a warning via ctx.log when init() throws an Error", () => {
      const warnCalls: Array<{ module: string; message: string; data?: Record<string, unknown> }> =
        []
      const mockLogger = {
        warn: (module: string, message: string, data?: Record<string, unknown>) => {
          warnCalls.push({ module, message, data })
        },
      }

      registerPlugin({
        name: "failing-plugin",
        version: "1.0.0",
        init: () => {
          throw new Error("kaboom")
        },
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        log: mockLogger as any,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      expect(cleanups).toHaveLength(0)
      expect(warnCalls).toHaveLength(1)
      expect(warnCalls[0].module).toBe("plugin")
      expect(warnCalls[0].message).toContain('Plugin "failing-plugin" failed to initialize')
      expect(warnCalls[0].data).toEqual({ error: "kaboom" })
    })

    it("stringifies non-Error throw values in the warning", () => {
      const warnCalls: Array<{ module: string; message: string; data?: Record<string, unknown> }> =
        []
      const mockLogger = {
        warn: (module: string, message: string, data?: Record<string, unknown>) => {
          warnCalls.push({ module, message, data })
        },
      }

      registerPlugin({
        name: "string-thrower",
        version: "1.0.0",
        init: () => {
           
          throw "raw string error"
        },
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        log: mockLogger as any,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      expect(cleanups).toHaveLength(0)
      expect(warnCalls).toHaveLength(1)
      expect(warnCalls[0].data).toEqual({ error: "raw string error" })
    })

    it("does not throw when ctx.log is null and init() throws", () => {
      registerPlugin({
        name: "null-log-plugin",
        version: "1.0.0",
        init: () => {
          throw new Error("should be silently caught")
        },
      })

      const ctx: PluginContext = {
        events: createEventBus(),
        log: null,
        auditLog: null,
        config: {},
      }

      // The optional chaining ctx.log?.warn should no-op without throwing
      expect(() => initializePlugins(ctx)).not.toThrow()
    })

    it("continues initializing subsequent plugins after one fails", () => {
      const calls: string[] = []

      registerPlugin({
        name: "first-bad",
        version: "1.0.0",
        init: () => {
          throw new Error("first fails")
        },
      })
      registerPlugin({
        name: "second-good",
        version: "1.0.0",
        init: () => {
          calls.push("second-good")
        },
      })
      registerPlugin({
        name: "third-good",
        version: "1.0.0",
        init: () => {
          calls.push("third-good")
        },
        events: {
          "cache:hit": () => {
            calls.push("third-event")
          },
        },
      })

      const bus = createEventBus()
      const ctx: PluginContext = {
        events: bus,
        log: null,
        auditLog: null,
        config: {},
      }
      const cleanups = initializePlugins(ctx)

      // Both good plugins initialized
      expect(calls).toEqual(["second-good", "third-good"])

      // Third plugin's event handler is wired
      bus.emit("cache:hit", { matchType: "exact", similarity: 1, savedCost: 0 })
      expect(calls).toContain("third-event")

      // Cleanups from the good plugins only (1 unsub for third's cache:hit)
      expect(cleanups).toHaveLength(1)
    })
  })
})
