/**
 * Seeded randomness for the world generator. Independent of src/core on purpose.
 *
 * A Rng is a function that returns the next uniform number in [0, 1).
 * Same seed, same sequence, on every machine (pure 32-bit integer maths).
 */
export type Rng = () => number;

/** sfc32 seeded through splitmix32, so nearby seeds give unrelated streams. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const split = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const next: Rng = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

/** A child stream, so adding draws in one place does not shift another. */
export function fork(rng: Rng, label: string): Rng {
  let h = Math.floor(rng() * 4294967296) >>> 0;
  for (let i = 0; i < label.length; i += 1) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  return makeRng(h);
}

export function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** Standard normal via Box-Muller. */
export function normal(rng: Rng, mean = 0, sd = 1): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Normal clipped to [lo, hi]. */
export function clippedNormal(rng: Rng, mean: number, sd: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, normal(rng, mean, sd)));
}

/** Lognormal with the given median and log-space spread sigma. */
export function lognormal(rng: Rng, median: number, sigma: number): number {
  return median * Math.exp(normal(rng, 0, sigma));
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** A UUID-shaped id (uppercase, like RoomPlan's identifiers). Deterministic from the stream. */
export function uuid(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16).toUpperCase()).join("");
  const v4 = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${"89AB"[Math.floor(rng() * 4)]}${hex.slice(17)}`;
  return `${v4.slice(0, 8)}-${v4.slice(8, 12)}-${v4.slice(12, 16)}-${v4.slice(16, 20)}-${v4.slice(20, 32)}`;
}
