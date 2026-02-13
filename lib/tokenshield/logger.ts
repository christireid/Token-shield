import type { TokenShieldEvents } from "./event-bus"

// --- Types ---

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  level: LogLevel
  module: string
  message: string
  timestamp: number
  data?: Record<string, unknown>
  spanId?: string
  traceId?: string
  durationMs?: number
}

export interface LoggerConfig {
  /** Minimum log level to emit (default: 'info') */
  level?: LogLevel
  /** Custom log handler — receives structured entries */
  handler?: (entry: LogEntry) => void
  /** Enable OpenTelemetry-compatible span creation (default: false) */
  enableSpans?: boolean
  /** Include timestamps in log entries (default: true) */
  timestamps?: boolean
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

export interface Span {
  spanId: string
  traceId: string
  name: string
  startTime: number
  attributes: Record<string, unknown>
  end: (attributes?: Record<string, unknown>) => void
  addEvent: (name: string, attributes?: Record<string, unknown>) => void
}

export type CompletedSpan = Span & { endTime?: number; events: SpanEvent[] }

// --- Helpers ---

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function generateId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // Fallback for environments without crypto.randomUUID
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  }
}

function defaultHandler(entry: LogEntry): void {
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : ''
  const msg = `[TokenShield] [${entry.level}] [${entry.module}] ${entry.message}${dataStr}`
  const method = entry.level === 'debug' ? 'debug' : entry.level === 'warn' ? 'warn' : entry.level === 'error' ? 'error' : 'info'
  console[method](msg)
}

// Map event types to appropriate log levels
const EVENT_LOG_LEVELS: Record<keyof TokenShieldEvents, LogLevel> = {
  'request:blocked': 'warn',
  'request:allowed': 'debug',
  'cache:hit': 'info',
  'cache:miss': 'debug',
  'cache:store': 'debug',
  'context:trimmed': 'info',
  'router:downgraded': 'info',
  'router:holdback': 'debug',
  'ledger:entry': 'debug',
  'breaker:warning': 'warn',
  'breaker:tripped': 'error',
  'userBudget:warning': 'warn',
  'userBudget:exceeded': 'error',
  'userBudget:spend': 'debug',
  'stream:chunk': 'debug',
  'stream:abort': 'warn',
  'stream:complete': 'info',
  'anomaly:detected': 'warn',
}

// --- Logger class ---

/** Maximum spans retained before FIFO eviction */
const MAX_SPANS = 1000

export class TokenShieldLogger {
  private config: Required<Pick<LoggerConfig, 'level' | 'timestamps'>> & Pick<LoggerConfig, 'handler' | 'enableSpans'>
  private spans: CompletedSpan[] = []
  /** Guard against double-connecting to the event bus */
  private eventBusConnected = false

  constructor(config?: LoggerConfig) {
    this.config = {
      level: config?.level ?? 'info',
      handler: config?.handler,
      enableSpans: config?.enableSpans ?? false,
      timestamps: config?.timestamps ?? true,
    }
  }

  private emit(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.config.level]) return
    const entry: LogEntry = {
      level,
      module,
      message,
      timestamp: this.config.timestamps ? Date.now() : 0,
      ...(data != null && { data }),
    }
    ;(this.config.handler ?? defaultHandler)(entry)
  }

  debug(module: string, message: string, data?: Record<string, unknown>): void {
    this.emit('debug', module, message, data)
  }

  info(module: string, message: string, data?: Record<string, unknown>): void {
    this.emit('info', module, message, data)
  }

  warn(module: string, message: string, data?: Record<string, unknown>): void {
    this.emit('warn', module, message, data)
  }

  error(module: string, message: string, data?: Record<string, unknown>): void {
    this.emit('error', module, message, data)
  }

  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const spanId = generateId()
    const traceId = generateId()
    const startTime = Date.now()
    const events: SpanEvent[] = []

    const span: CompletedSpan = {
      spanId,
      traceId,
      name,
      startTime,
      attributes: { ...attributes },
      events,
      end: (endAttributes?: Record<string, unknown>) => {
        span.endTime = Date.now()
        if (endAttributes) Object.assign(span.attributes, endAttributes)
        if (this.config.enableSpans) {
          this.emit('info', 'span', `${name} completed`, {
            spanId,
            traceId,
            durationMs: span.endTime - startTime,
            ...span.attributes,
          })
        }
      },
      addEvent: (eventName: string, eventAttributes?: Record<string, unknown>) => {
        events.push({ name: eventName, timestamp: Date.now(), ...(eventAttributes != null && { attributes: eventAttributes }) })
      },
    }

    this.spans.push(span)
    // FIFO eviction to prevent unbounded growth
    if (this.spans.length > MAX_SPANS) {
      this.spans = this.spans.slice(-MAX_SPANS)
    }
    if (this.config.enableSpans) {
      this.emit('debug', 'span', `${name} started`, { spanId, traceId, ...span.attributes })
    }
    return span
  }

  getSpans(): ReadonlyArray<CompletedSpan> {
    return this.spans
  }

  clearSpans(): void {
    this.spans = []
  }

  connectEventBus(events: { on: <K extends keyof TokenShieldEvents>(type: K, handler: (event: TokenShieldEvents[K]) => void) => void; off: <K extends keyof TokenShieldEvents>(type: K, handler: (event: TokenShieldEvents[K]) => void) => void }): () => void {
    // Prevent double-connecting which would accumulate duplicate handlers
    if (this.eventBusConnected) {
      return () => {} // no-op cleanup
    }
    this.eventBusConnected = true
    const handlers: Array<() => void> = []

    for (const key of Object.keys(EVENT_LOG_LEVELS) as Array<keyof TokenShieldEvents>) {
      const level = EVENT_LOG_LEVELS[key]
      const handler = (data: TokenShieldEvents[typeof key]) => {
        this.emit(level, key, `Event: ${key}`, data as Record<string, unknown>)
      }
      events.on(key, handler)
      handlers.push(() => events.off(key, handler))
    }

    return () => {
      handlers.forEach((unsub) => unsub())
      this.eventBusConnected = false
    }
  }
}

// --- Exports ---

/** Singleton logger instance */
export const logger: TokenShieldLogger = /* @__PURE__ */ new TokenShieldLogger()

/** Factory to create a configured logger */
export function createLogger(config?: LoggerConfig): TokenShieldLogger {
  return new TokenShieldLogger(config)
}
