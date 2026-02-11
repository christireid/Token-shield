/**
 * TokenShield - Worker Communication Layer
 *
 * Typed message protocol and promise-based API for offloading
 * NeuroElasticEngine operations to a Web Worker thread.
 * Falls back to inline (main-thread) execution when Workers
 * are unavailable (SSR, Node.js, test environments).
 */

import { NeuroElasticEngine, type NeuroElasticConfig, type FindResult } from "./neuro-elastic"

// --- Message Protocol ---

export type WorkerCommand =
  | { type: "INIT"; id: string; payload: NeuroElasticConfig }
  | { type: "FIND"; id: string; payload: { prompt: string; model?: string } }
  | { type: "LEARN"; id: string; payload: { prompt: string; response: string; model: string; inputTokens: number; outputTokens: number } }
  | { type: "CLEAR"; id: string }
  | { type: "STATS"; id: string }

export type WorkerResponse =
  | { type: "INIT_SUCCESS"; id: string }
  | { type: "FIND_RESULT"; id: string; payload: FindResult | null }
  | { type: "LEARN_DONE"; id: string }
  | { type: "CLEAR_DONE"; id: string }
  | { type: "STATS_RESULT"; id: string; payload: { entries: number; totalHits: number; avgScore: number } }
  | { type: "ERROR"; id: string; payload: string }

// --- Unique ID generator ---

let idCounter = 0
function nextId(): string {
  return `shield_${++idCounter}_${Date.now().toString(36)}`
}

// --- ShieldWorker class ---

/**
 * Promise-based wrapper around NeuroElasticEngine.
 *
 * In environments without Web Workers (SSR, Node.js, tests), all operations
 * execute synchronously on the main thread via an inline engine instance.
 *
 * When a Worker is available, operations are posted to the worker thread
 * and results are returned via promises.
 */
export class ShieldWorker {
  private engine: NeuroElasticEngine | null = null
  private worker: Worker | null = null
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  private ready = false
  private mode: "worker" | "inline" = "inline"

  /**
   * Initialize the engine.
   * @param config - NeuroElasticEngine configuration
   * @param workerUrl - Optional URL to the worker script. If provided and Workers are available, uses worker mode.
   */
  async init(config: NeuroElasticConfig = {}, workerUrl?: string | URL): Promise<void> {
    // Try worker mode first
    if (workerUrl && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(workerUrl, { type: "module" })
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data)
        this.worker.onerror = () => {
          // Worker failed to load — fall back to inline
          this.worker?.terminate()
          this.worker = null
          this.initInline(config)
        }
        this.mode = "worker"
        await this.post<void>({ type: "INIT", id: nextId(), payload: config })
        this.ready = true
        return
      } catch {
        // Fall through to inline
      }
    }

    // Inline mode (no worker)
    await this.initInline(config)
  }

  private async initInline(config: NeuroElasticConfig): Promise<void> {
    this.mode = "inline"
    this.engine = new NeuroElasticEngine(config)
    if (config.persist) {
      await this.engine.hydrate()
    }
    this.ready = true
  }

  /** Find a matching memory. */
  async find(prompt: string, model?: string): Promise<FindResult | null> {
    if (!this.ready) return null
    if (this.mode === "inline") {
      return this.engine!.find(prompt, model)
    }
    return this.post<FindResult | null>({ type: "FIND", id: nextId(), payload: { prompt, model } })
  }

  /** Learn a new prompt→response pair. */
  async learn(prompt: string, response: string, model: string, inputTokens: number, outputTokens: number): Promise<void> {
    if (!this.ready) return
    if (this.mode === "inline") {
      return this.engine!.learn(prompt, response, model, inputTokens, outputTokens)
    }
    return this.post<void>({ type: "LEARN", id: nextId(), payload: { prompt, response, model, inputTokens, outputTokens } })
  }

  /** Clear all memories. */
  async clear(): Promise<void> {
    if (!this.ready) return
    if (this.mode === "inline") {
      return this.engine!.clear()
    }
    return this.post<void>({ type: "CLEAR", id: nextId() })
  }

  /** Get stats. */
  async stats(): Promise<{ entries: number; totalHits: number; avgScore: number }> {
    if (!this.ready) return { entries: 0, totalHits: 0, avgScore: 0 }
    if (this.mode === "inline") {
      return this.engine!.stats()
    }
    return this.post<{ entries: number; totalHits: number; avgScore: number }>({ type: "STATS", id: nextId() })
  }

  /** Check if the engine is ready. */
  get isReady(): boolean {
    return this.ready
  }

  /** Get current execution mode. */
  get executionMode(): "worker" | "inline" {
    return this.mode
  }

  /** Terminate the worker (if using worker mode). */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    // Reject all pending promises
    for (const [, { reject }] of this.pending) {
      reject(new Error("ShieldWorker terminated"))
    }
    this.pending.clear()
    this.ready = false
  }

  // --- Private ---

  private post<T>(command: WorkerCommand): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = command.id
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker!.postMessage(command)
      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`ShieldWorker timeout for ${command.type}`))
        }
      }, 10_000)
    })
  }

  private handleMessage(msg: WorkerResponse): void {
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)

    if (msg.type === "ERROR") {
      pending.reject(new Error(msg.payload))
    } else if (msg.type === "FIND_RESULT") {
      pending.resolve(msg.payload)
    } else if (msg.type === "STATS_RESULT") {
      pending.resolve(msg.payload)
    } else {
      // INIT_SUCCESS, LEARN_DONE, CLEAR_DONE
      pending.resolve(undefined)
    }
  }
}

/** Create a ShieldWorker instance. */
export function createShieldWorker(): ShieldWorker {
  return new ShieldWorker()
}
