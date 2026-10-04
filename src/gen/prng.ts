// A small deterministic random source. Everything seeded from the same
// string produces the same sequence on every machine and every start, which
// is what keeps record 42 the same record 42 forever.

export class Rng {
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed: string | number) {
    const h = typeof seed === 'number' ? seed >>> 0 : hash53(seed)
    // splitmix-style expansion of one seed into four words
    let s = (h ^ 0x9e3779b9) >>> 0
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0
      let z = s
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
      return (z ^ (z >>> 16)) >>> 0
    }
    this.a = next()
    this.b = next()
    this.c = next()
    this.d = next()
  }

  /** xoshiro128** — a float in [0, 1). */
  next(): number {
    const t = this.b << 9
    let r = Math.imul(this.b, 5)
    r = (((r << 7) | (r >>> 25)) * 9) >>> 0
    this.c ^= this.a
    this.d ^= this.b
    this.b ^= this.c
    this.a ^= this.d
    this.c ^= t
    this.d = (this.d << 11) | (this.d >>> 21)
    return r / 4294967296
  }

  /** Integer in [lo, hi], both ends included. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }

  float(lo: number, hi: number, decimals = 2): number {
    const v = lo + this.next() * (hi - lo)
    const m = Math.pow(10, decimals)
    return Math.round(v * m) / m
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** Pick with weights: weighted([['a', 3], ['b', 1]]) gives 'a' three times in four. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    let total = 0
    for (const [, w] of pairs) total += w
    let x = this.next() * total
    for (const [v, w] of pairs) {
      if (x < w) return v
      x -= w
    }
    return pairs[pairs.length - 1][0]
  }

  /** n distinct picks from arr (n capped at arr.length). */
  some<T>(arr: readonly T[], n: number): T[] {
    const copy = arr.slice()
    const out: T[] = []
    const k = Math.min(n, copy.length)
    for (let i = 0; i < k; i++) {
      const j = Math.floor(this.next() * copy.length)
      out.push(copy[j])
      copy.splice(j, 1)
    }
    return out
  }

  /** A lowercase base-32 token of n characters. */
  token(n: number): string {
    const abc = 'abcdefghijklmnopqrstuvwxyz234567'
    let s = ''
    for (let i = 0; i < n; i++) s += abc[this.int(0, 31)]
    return s
  }

  /** Uppercase letters + digits, for order numbers and the like. */
  code(n: number, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'): string {
    let s = ''
    for (let i = 0; i < n; i++) s += alphabet[this.int(0, alphabet.length - 1)]
    return s
  }

  digits(n: number): string {
    let s = ''
    for (let i = 0; i < n; i++) s += this.int(i === 0 ? 1 : 0, 9)
    return s
  }

  /** A normally-ish distributed value (sum of three uniforms), clamped. */
  normal(mean: number, spread: number, lo: number, hi: number, decimals = 2): number {
    const u = (this.next() + this.next() + this.next()) / 3 // 0..1, peaked at 0.5
    const v = mean + (u - 0.5) * 2 * spread
    const m = Math.pow(10, decimals)
    return Math.min(hi, Math.max(lo, Math.round(v * m) / m))
  }
}

/** cyrb53 — a 53-bit string hash, good enough to seed from. */
export function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0
}

// Dates. The seed world is anchored so the data never drifts between builds:
// "now" for the generators is a fixed instant, and records spread back from it.
export const WORLD_NOW = Date.UTC(2026, 8, 1, 12, 0, 0) // 2026-09-01T12:00:00Z
const DAY = 86400000

export function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** A moment between daysAgoMax and daysAgoMin days before WORLD_NOW. */
export function pastMs(r: Rng, daysAgoMax: number, daysAgoMin = 0): number {
  const span = (daysAgoMax - daysAgoMin) * DAY
  return WORLD_NOW - daysAgoMin * DAY - Math.floor(r.next() * span)
}

export function futureMs(r: Rng, daysAheadMax: number, daysAheadMin = 0): number {
  const span = (daysAheadMax - daysAheadMin) * DAY
  return WORLD_NOW + daysAheadMin * DAY + Math.floor(r.next() * span)
}

export function addMs(ms: number, minutes: number): number {
  return ms + minutes * 60000
}
