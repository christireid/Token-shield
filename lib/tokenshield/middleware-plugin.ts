/**
 * TokenShield - Middleware Plugin Registry
 *
 * Provides a plugin pattern for middleware modules. Instead of hardcoding
 * every module into middleware.ts, modules can register themselves via
 * plugins. This decouples module registration from the orchestrator,
 * enables third-party plugins, and makes adding new modules a single-file
 * change.
 *
 * Built-in modules are still loaded by default — the registry just provides
 * an extensibility point for additional modules.
 */

import { subscribeToAnyEvent } from "./event-bus"
import type { EventBus, TokenShieldEvents } from "./event-bus"
import type { AuditLog } from "./audit-log"
import type { TokenShieldLogger } from "./logger"

// -------------------------------------------------------
// Plugin Types
// -------------------------------------------------------

export interface PluginContext {
  /** Per-instance event bus */
  events: EventBus
  /** Logger (may be null if not configured) */
  log: TokenShieldLogger | null
  /** Audit log (may be null if not configured) */
  auditLog: AuditLog | null
  /** Full middleware config */
  config: Record<string, unknown>
}

export interface MiddlewarePlugin {
  /** Unique plugin name */
  name: string
  /** Plugin version (semver) */
  version: string
  /**
   * Called during middleware initialization. The plugin receives the context
   * and should return a cleanup function (called on dispose).
   */
  init(ctx: PluginContext): PluginCleanup | void
  /**
   * Optional: event subscriptions to wire automatically.
   * Each key is an event name, the value is the handler.
   */
  events?: Partial<{
    [K in keyof TokenShieldEvents]: (data: TokenShieldEvents[K]) => void
  }>
}

export type PluginCleanup = () => void

// -------------------------------------------------------
// Registry
// -------------------------------------------------------

const _plugins: Map<string, MiddlewarePlugin> = new Map()

/**
 * Register a plugin to be loaded by all new middleware instances.
 * Plugins are loaded in registration order during `tokenShieldMiddleware()`.
 *
 * @example
 * ```ts
 * registerPlugin({
 *   name: "my-custom-logger",
 *   version: "1.0.0",
 *   init(ctx) {
 *     const cleanup = subscribeToEvent(ctx.events, "ledger:entry", (data) => {
 *       console.log(`Cost: $${data.cost}`)
 *     })
 *     return cleanup
 *   },
 * })
 * ```
 */
export function registerPlugin(plugin: MiddlewarePlugin): void {
  if (_plugins.has(plugin.name)) {
    throw new Error(
      `[TokenShield] Plugin "${plugin.name}" is already registered. ` +
        `Use unregisterPlugin("${plugin.name}") first to replace it.`,
    )
  }
  _plugins.set(plugin.name, plugin)
}

/**
 * Unregister a previously registered plugin by name.
 * Returns true if the plugin was found and removed.
 */
export function unregisterPlugin(name: string): boolean {
  return _plugins.delete(name)
}

/**
 * Get all registered plugins (read-only snapshot).
 */
export function getRegisteredPlugins(): ReadonlyArray<MiddlewarePlugin> {
  return Array.from(_plugins.values())
}

/**
 * Initialize all registered plugins with the given context.
 * Returns an array of cleanup functions to call on dispose.
 * @internal — called by middleware.ts during init.
 */
export function initializePlugins(ctx: PluginContext): PluginCleanup[] {
  const cleanups: PluginCleanup[] = []
  for (const plugin of _plugins.values()) {
    try {
      const cleanup = plugin.init(ctx)
      if (cleanup) cleanups.push(cleanup)

      // Auto-wire event subscriptions using the type-safe subscribeToAnyEvent helper
      if (plugin.events) {
        for (const [eventName, handler] of Object.entries(plugin.events)) {
          if (typeof handler === "function") {
            const unsub = subscribeToAnyEvent(
              ctx.events,
              eventName as keyof TokenShieldEvents,
              handler as (data: unknown) => void,
            )
            cleanups.push(unsub)
          }
        }
      }
    } catch (err) {
      ctx.log?.warn("plugin", `Plugin "${plugin.name}" failed to initialize`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return cleanups
}

/**
 * Clear all registered plugins (for testing).
 */
export function clearPlugins(): void {
  _plugins.clear()
}
