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
        init: () => { calls.push("p1") },
      })
      registerPlugin({
        name: "p2",
        version: "1.0.0",
        init: () => { calls.push("p2") },
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
        init: () => () => { cleanupCalled.push("cleaned") },
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
          "cache:hit": (data) => { received.push(data) },
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
        init: () => { throw new Error("init failed") },
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
})
