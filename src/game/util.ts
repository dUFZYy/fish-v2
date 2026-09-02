/**
 * util.ts — tiny renderer-free math helpers shared by the game/ modules.
 *
 * Not part of the six files asked for in the port brief, but every one of
 * them needs `clamp`/`lerp`/a seeded `rand(min,max)` and the original game
 * used those (plus `Math.random()`) everywhere without ever naming them as
 * constants. Centralising them here avoids six slightly different copies.
 *
 * IMPORTANT: nothing in src/game may call `Math.random()` directly (see
 * CLAUDE.md / the port brief). Every function that needs randomness takes an
 * `rng: () => number` parameter instead, so callers can inject a seeded PRNG
 * for deterministic tests.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** script.js `rand(a,b)` — uniform float in [a,b), driven by an injected rng. */
export function randRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

/** `+(n.toFixed(2))` — used throughout the original for weight/kg values. */
export function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Weighted random pick, used by `pickSpecies` (fish.js) and anywhere else a
 * list of items needs a weight-proportional random choice. Returns `null`
 * for an empty list or when every weight is <= 0.
 */
export function pickWeighted<T>(items: readonly T[], weights: readonly number[], rng: () => number): T | null {
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (total <= 0 || items.length === 0) return null;
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    const w = weights[i];
    if (w <= 0) continue;
    if (roll < w) return items[i];
    roll -= w;
  }
  // floating point fallback: return the last positively-weighted item
  for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
  return null;
}

/** talents.js `talentMult(id, per)` — generic rank-based multiplier: 1 + rank*per. */
export function talentMult(rank: number, per: number): number {
  return 1 + rank * per;
}
