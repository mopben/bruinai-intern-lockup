/**
 * Small seeded pseudo-random numbers. mulberry32 is fast, 32-bit, and good
 * enough for bootstrap resampling. Streams are derived by hashing (seed, ...keys)
 * so each replication and purpose gets its own independent, repeatable stream.
 */

export type Rng = () => number;

/** Returns a function giving uniform numbers in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes integers into one 32-bit seed (murmur3-style finaliser per key). */
export function mixSeed(...keys: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const k of keys) {
    let x = (k | 0) ^ h;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    h = (x ^ (x >>> 16)) >>> 0;
  }
  return h >>> 0;
}

/** A stream for (seed, ...keys). */
export function streamFor(seed: number, ...keys: readonly number[]): Rng {
  return mulberry32(mixSeed(seed, ...keys));
}
