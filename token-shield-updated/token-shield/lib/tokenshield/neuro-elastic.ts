/**
 * NeuroElasticEngine — Holographic encoding engine for fuzzy similarity matching.
 * Encodes prompts into 2048-bit holographic vectors using trigram FNV-1a hashing,
 * applies IDF-like contrastive inhibition to filter common noise bits, and uses
 * Jaccard resonance with dynamic thresholding for robust approximate matching.
 */

import { get, set } from "idb-keyval"

/** Encoding dimensions: 64 × 32 = 2048-bit hologram */
const DIMENSIONS = 64

/** IDB key for persisted memories */
const DB_KEY = "shield_memory_v2"

// --- Types ---

export interface NeuroElasticConfig {
  /** Base similarity threshold (0-1). Default: 0.88 */
  threshold?: number
  /** Domain-specific vocabulary seeds. Keys are terms, values are seed angles.
   * Terms sharing similar seed values will be encoded closer together.
   * Example: { cost: 10, price: 10, billing: 10, budget: 10 } */
  seeds?: Record<string, number>
  /** Max stored memories before LRU eviction. Default: 500 */
  maxMemories?: number
  /** Enable contrastive inhibition (noise filtering). Default: true */
  enableInhibition?: boolean
  /** Persist memories to IndexedDB. Default: false */
  persist?: boolean
}

export interface MemorySlot {
  /** Holographic encoding as number array (serializable) */
  hologram: number[]
  /** The cached response text */
  response: string
  /** Cache hit counter (for reinforcement) */
  hits: number
  /** Last access timestamp */
  timestamp: number
  /** The original prompt text (for debugging) */
  prompt: string
  /** Model used for this response */
  model: string
  /** Token counts */
  inputTokens: number
  outputTokens: number
}

export interface FindResult {
  response: string
  score: number
  prompt: string
  model: string
  inputTokens: number
  outputTokens: number
  hits: number
}

export class NeuroElasticEngine {
  private memory: MemorySlot[] = []
  private config: Required<Pick<NeuroElasticConfig, 'threshold' | 'maxMemories' | 'enableInhibition' | 'persist'>> & Pick<NeuroElasticConfig, 'seeds'>
  private isHydrated = false
  /** Global noise vector — bits active in >50% of memories (IDF inhibition) */
  private noiseVector: Uint32Array = new Uint32Array(DIMENSIONS)
  /** Dirty flag for noise vector recalculation */
  private noiseDirty = true

  constructor(config?: NeuroElasticConfig) {
    this.config = {
      threshold: config?.threshold ?? 0.88,
      seeds: config?.seeds,
      maxMemories: config?.maxMemories ?? 500,
      enableInhibition: config?.enableInhibition ?? true,
      persist: config?.persist ?? false,
    }
  }

  /** Hydrate from IndexedDB. Call once on startup. */
  async hydrate(): Promise<number> {
    if (!this.config.persist) return 0
    try {
      const stored = await get<MemorySlot[]>(DB_KEY)
      if (stored && Array.isArray(stored)) {
        this.memory = stored
        this.noiseDirty = true
        this.isHydrated = true
        return stored.length
      }
    } catch { /* IDB not available */ }
    this.isHydrated = true
    return 0
  }

  /** Find the best matching memory for a prompt. Returns null if no match above threshold. */
  find(prompt: string, model?: string): FindResult | null {
    const inputHolo = this.encode(prompt)
    let bestScore = 0
    let bestMatch: MemorySlot | null = null

    // Rebuild noise vector if needed
    if (this.config.enableInhibition && this.noiseDirty) {
      this.rebuildNoiseVector()
    }

    for (const entry of this.memory) {
      // Model filter
      if (model && entry.model !== model) continue

      const cachedHolo = new Uint32Array(entry.hologram)
      const score = this.calculateResonance(inputHolo, cachedHolo)

      if (score > bestScore) {
        bestScore = score
        bestMatch = entry
      }
    }

    // Dynamic thresholding: stricter for short prompts (< 10 chars get +0.05)
    const effectiveThreshold = this.config.threshold + (prompt.length < 10 ? 0.05 : 0)

    if (bestScore >= effectiveThreshold && bestMatch) {
      // Reinforce the matched memory (update hits + timestamp)
      bestMatch.hits++
      bestMatch.timestamp = Date.now()
      if (this.config.persist) {
        this.persistAsync()
      }
      return {
        response: bestMatch.response,
        score: bestScore,
        prompt: bestMatch.prompt,
        model: bestMatch.model,
        inputTokens: bestMatch.inputTokens,
        outputTokens: bestMatch.outputTokens,
        hits: bestMatch.hits,
      }
    }
    return null
  }

  /** Learn a new prompt->response pair. */
  async learn(prompt: string, response: string, model: string, inputTokens: number, outputTokens: number): Promise<void> {
    const hologram = this.encode(prompt)

    // LRU eviction if at capacity
    if (this.memory.length >= this.config.maxMemories) {
      // Sort by timestamp descending, remove oldest
      this.memory.sort((a, b) => b.timestamp - a.timestamp)
      this.memory.pop()
    }

    this.memory.push({
      hologram: Array.from(hologram),
      response,
      hits: 1,
      timestamp: Date.now(),
      prompt,
      model,
      inputTokens,
      outputTokens,
    })

    this.noiseDirty = true

    if (this.config.persist) {
      await this.persistAsync()
    }
  }

  /** Get the number of stored memories. */
  get size(): number {
    return this.memory.length
  }

  /** Check if hydrated from storage. */
  get hydrated(): boolean {
    return this.isHydrated
  }

  /** Clear all memories. */
  async clear(): Promise<void> {
    this.memory = []
    this.noiseDirty = true
    if (this.config.persist) {
      try { await set(DB_KEY, []) } catch { /* IDB not available */ }
    }
  }

  /** Get memory stats. */
  stats(): { entries: number; totalHits: number; avgScore: number } {
    let totalHits = 0
    for (const m of this.memory) totalHits += m.hits
    return {
      entries: this.memory.length,
      totalHits,
      avgScore: this.memory.length > 0 ? totalHits / this.memory.length : 0,
    }
  }

  // -------------------------------------------------------
  // Private: Encoding kernel
  // -------------------------------------------------------

  /** Encode text into a holographic bit vector (Uint32Array). */
  private encode(input: string): Uint32Array {
    const vec = new Uint32Array(DIMENSIONS)
    const normalized = input.toLowerCase().replace(/[^\w\s]/g, "").trim()
    const tokens = normalized.split(/\s+/).filter(t => t.length > 0)

    for (const token of tokens) {
      if (token.length < 3) continue

      // 1. Morphological encoding: extract all trigrams
      for (let i = 0; i <= token.length - 3; i++) {
        this.superimpose(vec, token.substring(i, i + 3))
      }

      // 2. Semantic seeding: inject domain vocabulary angles
      if (this.config.seeds && this.config.seeds[token] != null) {
        const seed = this.config.seeds[token]
        vec[seed % DIMENSIONS] |= (1 << (seed % 32))
      }

      // 3. Temporal encoding: rotate vector to encode word order
      this.rotate(vec)
    }

    return vec
  }

  /** Superimpose a trigram onto the hologram using FNV-1a hash. */
  private superimpose(vec: Uint32Array, key: string): void {
    // FNV-1a hash
    let h = 0x811c9dc5
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
    }
    // Set 3 bits (sparsity = 3) for each trigram
    for (let i = 0; i < 3; i++) {
      h = (h * 1664525 + 1013904223) >>> 0
      vec[h % DIMENSIONS] |= (1 << ((h >> 6) % 32))
    }
  }

  /** Circular bit rotation for temporal/order encoding. */
  private rotate(vec: Uint32Array): void {
    const carry = vec[DIMENSIONS - 1] >>> 31
    for (let i = DIMENSIONS - 1; i > 0; i--) {
      vec[i] = (vec[i] << 1) | (vec[i - 1] >>> 31)
    }
    vec[0] = (vec[0] << 1) | carry
  }

  /**
   * Calculate resonance (similarity) between two holograms.
   * Uses Jaccard similarity on bit populations, with optional contrastive inhibition.
   */
  private calculateResonance(a: Uint32Array, b: Uint32Array): number {
    let intersection = 0
    let union = 0

    for (let i = 0; i < DIMENSIONS; i++) {
      let aBits = a[i]
      let bBits = b[i]

      // Contrastive inhibition: mask out noisy bits
      if (this.config.enableInhibition) {
        const inhibit = this.noiseVector[i]
        aBits = aBits & ~inhibit
        bBits = bBits & ~inhibit
      }

      // Popcount for intersection (AND)
      let x = aBits & bBits
      while (x) { intersection++; x &= x - 1 }

      // Popcount for union (OR)
      let y = aBits | bBits
      while (y) { union++; y &= y - 1 }
    }

    return union === 0 ? 0 : intersection / union
  }

  /**
   * Rebuild the global noise vector.
   * A bit is "noisy" if it's active in >50% of all memories.
   * This implements IDF-like inhibition without explicit term frequencies.
   */
  private rebuildNoiseVector(): void {
    const counts = new Uint32Array(DIMENSIONS * 32) // bit-level counts
    const threshold = Math.floor(this.memory.length * 0.5)

    for (const entry of this.memory) {
      const holo = new Uint32Array(entry.hologram)
      for (let i = 0; i < DIMENSIONS; i++) {
        for (let bit = 0; bit < 32; bit++) {
          if (holo[i] & (1 << bit)) {
            counts[i * 32 + bit]++
          }
        }
      }
    }

    // Build noise mask: set bits that appear in >50% of memories
    this.noiseVector = new Uint32Array(DIMENSIONS)
    if (threshold > 0) {
      for (let i = 0; i < DIMENSIONS; i++) {
        for (let bit = 0; bit < 32; bit++) {
          if (counts[i * 32 + bit] > threshold) {
            this.noiseVector[i] |= (1 << bit)
          }
        }
      }
    }

    this.noiseDirty = false
  }

  /** Fire-and-forget persist to IDB. */
  private persistAsync(): void {
    set(DB_KEY, this.memory).catch(() => { /* IDB not available */ })
  }
}

// --- Exports ---

/** Create a configured NeuroElasticEngine instance. */
export function createNeuroElasticEngine(config?: NeuroElasticConfig): NeuroElasticEngine {
  return new NeuroElasticEngine(config)
}
