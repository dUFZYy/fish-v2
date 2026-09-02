/**
 * catch.ts — catch-calculation math: spec section 5 of docs/spec/01-core-loop.md
 * (`script.js` `catchFish()`, `fish.js` weight/shiny, `events.js` `maybeSpawnSeagull`).
 *
 * Every function here is pure and returns a plain result object — nothing here mutates a
 * `SaveData`/reads `localStorage`/reads a global `save`/`coins`/`streak`. The composing game
 * loop is responsible for folding the returned numbers into its own save/session state
 * (the same boundary progress.ts's `addXP`/`addGems`-style functions already use).
 *
 * Ownership note (seagull, spec 5.9 vs. 6.4): the spec places the ENTIRE seagull mechanic
 * under section 5 ("Catch-Berechnung") and section 6.4 ("Möwe") is a one-line
 * cross-reference back to 5.9 with no independent content of its own. So the seagull lives
 * here in full (spawn roll, attack flight curve, hit-test radius, theft amount, flee
 * reward) rather than being split against events.ts, which owns section 6's actual content
 * (weather, golden hour, day/night, achievements, toasts).
 */

import { clamp, round2, talentMult } from './util';
import { RARITY } from './bite';
import { xpForCatch } from './progress';
import type { FishSpecies } from './state';

// ---------------------------------------------------------------------------
// Weight (spec 5.1)
// ---------------------------------------------------------------------------

/** fish.js `f.scale = rand(0.8, 1.3)` reference value the weight formula divides by. */
export const WEIGHT_SCALE_REFERENCE = 1.3;
/** script.js catchFish: `Math.pow(Math.random(), 1.6)` — skews weight toward the low end. */
export const WEIGHT_DISTRIBUTION_POWER = 1.6;

/** script.js `catchFish()` weight formula, verbatim (spec 5.1). `rng()` drives ONLY the
 *  weight roll — every other random input this module needs is passed in as a separate
 *  `rng` argument to keep each roll's call-site obvious and independently testable. */
export function rollWeight(species: Pick<FishSpecies, 'kg'>, scale: number, rng: () => number): number {
  const [kgMin, kgMax] = species.kg;
  return round2(kgMin + Math.pow(rng(), WEIGHT_DISTRIBUTION_POWER) * (kgMax - kgMin) * (scale / WEIGHT_SCALE_REFERENCE));
}

// ---------------------------------------------------------------------------
// Streak & multiplier (spec 5.2)
// ---------------------------------------------------------------------------

export const STREAK_MULT_STEP = 0.25;
/** `min(max(streak-1,0),4)` — the multiplier caps out at streak 5 (×2.00). */
export const STREAK_MULT_CAP = 4;
export const PERFECT_COIN_MULT = 1.5;

/** script.js `streakMultiplier()` (spec 5.2): 1.00 / 1.25 / 1.50 / 1.75 / 2.00 (capped). */
export function streakMultiplier(streak: number): number {
  return 1 + STREAK_MULT_STEP * clamp(streak - 1, 0, STREAK_MULT_CAP);
}

/** script.js `streak = sp.junk ? streak : streak + 1;` — junk neither breaks nor grows the streak. */
export function nextStreak(streak: number, junk: boolean): number {
  return junk ? streak : streak + 1;
}

// ---------------------------------------------------------------------------
// Coins (spec 5.3)
// ---------------------------------------------------------------------------

/** tools/econ-sim.js `COIN_SCALE` — global coin economy scale. */
export const COIN_SCALE = 0.85;
/** weight-percentile coin factor: 0.75x .. 1.25x of the species' base value. */
export const COIN_WEIGHT_BASE_FRAC = 0.75;
export const COIN_WEIGHT_RANGE_FRAC = 0.5;
export const SHINY_COIN_MULT = 5;
export const TALENT_FEILSCH_PER_RANK = 0.05;

export interface CoinsParams {
  value: number;
  kg: readonly [number, number];
  weightKg: number;
  junk: boolean;
  shiny: boolean;
  multiplier: number;
  feilschTalentRank: number;
}

/** script.js `catchFish()` coin formula, verbatim (spec 5.3). */
export function rollCoins(p: CoinsParams): number {
  const [kgMin, kgMax] = p.kg;
  const weightFrac = (p.weightKg - kgMin) / (kgMax - kgMin);
  const base = Math.max(1, Math.round(p.value * COIN_SCALE * (COIN_WEIGHT_BASE_FRAC + COIN_WEIGHT_RANGE_FRAC * weightFrac)));
  if (p.junk) return base;
  return Math.round(base * p.multiplier * (p.shiny ? SHINY_COIN_MULT : 1) * talentMult(p.feilschTalentRank, TALENT_FEILSCH_PER_RANK));
}

// ---------------------------------------------------------------------------
// Shiny (spec 5.5)
// ---------------------------------------------------------------------------

/** fish.js `f.shiny` roll: base 1/80 chance. */
export const SHINY_BASE_DIVISOR = 80;
/** gems.js `totemActive("glueck")` — 5-minute totem, ×4 shiny chance while active. */
export const SHINY_TOTEM_MULT = 4;
export const TALENT_GLUECK_SHINY_PER_RANK = 0.25;

/**
 * fish.js `createFish()`'s shiny roll (spec 5.5). In the original this is rolled once, at
 * spawn time, not at catch time — that call site (`createFish`) is out of scope for these
 * six files. The formula is independent per-fish either way, so this is exposed here (the
 * catch-economy module) as the natural home for the pure probability function; whichever
 * module creates FishInstances should call it once and store the result on `shiny`.
 */
export function rollShiny(species: Pick<FishSpecies, 'junk' | 'boss'>, glueckTotemActive: boolean, glueckTalentRank: number, rng: () => number): boolean {
  if (species.junk || species.boss) return false;
  const chance = ((glueckTotemActive ? SHINY_TOTEM_MULT : 1) * talentMult(glueckTalentRank, TALENT_GLUECK_SHINY_PER_RANK)) / SHINY_BASE_DIVISOR;
  return rng() < chance;
}

// ---------------------------------------------------------------------------
// XP (spec 5.4) — reuses progress.ts's `xpForCatch` (same formula, already ported/tested
// there) and applies the "lehre" talent multiplier on top, per `addXP(Math.round(
// xpForCatch(...) * talentMult("lehre",0.06)))`.
// ---------------------------------------------------------------------------

export const TALENT_LEHRE_XP_PER_RANK = 0.06;

export function rollXp(rarityIdx: number, junk: boolean, perfect: boolean, shiny: boolean, lehreTalentRank: number): number {
  return Math.round(xpForCatch({ rarityIdx, junk, perfect, shiny }) * talentMult(lehreTalentRank, TALENT_LEHRE_XP_PER_RANK));
}

// ---------------------------------------------------------------------------
// computeCatch — the whole-catch entry point (spec 5.1-5.6)
// ---------------------------------------------------------------------------

export interface CatchParams {
  species: FishSpecies;
  /** `f.scale` (0.8..1.3), fixed at the fish's spawn. */
  scale: number;
  /** `reel.perfect` from drill.ts's ReelState, BEFORE the junk exclusion (applied here). */
  reelPerfect: boolean;
  /** `f.shiny`, already rolled at spawn — see `rollShiny()`. */
  shiny: boolean;
  streakBefore: number;
  feilschTalentRank: number;
  lehreTalentRank: number;
  /** drives ONLY the weight roll (`rollWeight`). */
  rng: () => number;
}

export interface CatchResult {
  kg: number;
  /** `reel.perfect && !sp.junk` (spec 4.5/5.6). */
  perfect: boolean;
  streakAfter: number;
  multiplier: number;
  coins: number;
  xp: number;
}

/** script.js `catchFish()`, the non-boss-fight-specific parts (spec 5.1-5.6). Boss wins
 *  also funnel through this — see boss.ts `winBossFightResult()` for the `reelPerfect`
 *  (`flawless`) it feeds in. */
export function computeCatch(p: CatchParams): CatchResult {
  const kg = rollWeight(p.species, p.scale, p.rng);
  const perfect = p.reelPerfect && !p.species.junk;
  const streakAfter = nextStreak(p.streakBefore, !!p.species.junk);
  const multiplier = streakMultiplier(streakAfter) * (perfect ? PERFECT_COIN_MULT : 1);
  const coins = rollCoins({
    value: p.species.value,
    kg: p.species.kg,
    weightKg: kg,
    junk: !!p.species.junk,
    shiny: p.shiny,
    multiplier,
    feilschTalentRank: p.feilschTalentRank,
  });
  const rarityIdx = RARITY[p.species.rarity].idx;
  const xp = rollXp(rarityIdx, !!p.species.junk, perfect, p.shiny, p.lehreTalentRank);
  return { kg, perfect, streakAfter, multiplier, coins, xp };
}

// ---------------------------------------------------------------------------
// "So knapp!" — near-miss message on a snapped line (spec 5.7)
// ---------------------------------------------------------------------------

/** Shared with drill.ts's `NEAR_MISS_PROGRESS_THRESHOLD` (same spec value, 0.8) — repeated
 *  here as its own constant since catch.ts must not import drill.ts's internals for a
 *  single number; drill.ts's `updateReel` already returns its own `nearMiss` boolean using
 *  the identical threshold, so callers usually won't need to call this again. */
export const NEAR_MISS_PROGRESS_THRESHOLD = 0.8;

export interface LineSnappedMessage {
  message: string;
  nearMiss: boolean;
  floatingText: string | null;
}

/** script.js `fishEscapes(...)` message choice on a snapped line (spec 4.4/5.7). */
export function lineSnappedMessage(maxProgress: number): LineSnappedMessage {
  const nearMiss = maxProgress >= NEAR_MISS_PROGRESS_THRESHOLD;
  return {
    nearMiss,
    message: nearMiss ? `Schnur gerissen – bei ${Math.round(maxProgress * 100)} %!` : 'Schnur gerissen!',
    floatingText: nearMiss ? 'So knapp!' : null,
  };
}

// ---------------------------------------------------------------------------
// Predator / prey bonus catch — "Fisch-im-Fisch" (spec 5.8)
// ---------------------------------------------------------------------------

/** fish.js/locations.js: species ids that can trigger a bonus prey catch. */
export const PREDATORS: readonly string[] = [
  'hecht',
  'zander',
  'wels',
  'urhecht',
  'riesenwels',
  'barrakuda',
  'thunfisch',
  'seeteufel',
  'hai',
  'riffhai',
  'muraene',
  'seewolf',
  'rapfen',
  'wolfsbarsch',
  'piranha',
];

export const PREDATOR_BONUS_CATCH_CHANCE = 0.18;
export const PREDATOR_BONUS_MAX_LEN_FRAC = 0.7;
export const PREDATOR_BONUS_MAX_RARITY_IDX = 1;
export const PREDATOR_BONUS_WEIGHT_FRAC = 0.4;
export const PREDATOR_BONUS_VALUE_FRAC = 0.8;

export function isPredatorSpecies(id: string): boolean {
  return PREDATORS.includes(id);
}

/** script.js: `if (PREDATORS.includes(sp.id) && Math.random() < 0.18)`. */
export function rollPredatorBonusCatch(isPredator: boolean, rng: () => number): boolean {
  return isPredator && rng() < PREDATOR_BONUS_CATCH_CHANCE;
}

/** script.js's inline prey filter: same location, `!junk && !boss`, `rarityIdx<=1`,
 *  `len < sp.len*0.7` (spec 5.8). `predator.len` defaults to 1 if absent, matching how the
 *  original never guards a missing `len` (every real species has one). */
export function eligiblePreySpecies(pool: readonly FishSpecies[], predator: Pick<FishSpecies, 'len' | 'loc'>, locationId: string): FishSpecies[] {
  const predatorLen = predator.len ?? 1;
  return pool.filter(
    (p) =>
      p.loc.includes(locationId) &&
      !p.junk &&
      !p.boss &&
      RARITY[p.rarity].idx <= PREDATOR_BONUS_MAX_RARITY_IDX &&
      (p.len ?? 1) < predatorLen * PREDATOR_BONUS_MAX_LEN_FRAC,
  );
}

/** script.js's uniform-random pick among the eligible prey pool. */
export function pickPreySpecies<T>(candidates: readonly T[], rng: () => number): T | null {
  if (candidates.length === 0) return null;
  const idx = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[idx] ?? null;
}

export interface BonusCatchResult {
  kg: number;
  coins: number;
}

/** script.js's bonus-catch weight/coin formula (spec 5.8): `pkg = p.kg[0] + rng()*(p.kg[1]
 *  -p.kg[0])*0.4`, `bonus = max(1, round(p.value*COIN_SCALE*0.8))`. */
export function computeBonusCatch(prey: Pick<FishSpecies, 'kg' | 'value'>, rng: () => number): BonusCatchResult {
  const [kgMin, kgMax] = prey.kg;
  const kg = round2(kgMin + rng() * (kgMax - kgMin) * PREDATOR_BONUS_WEIGHT_FRAC);
  const coins = Math.max(1, Math.round(prey.value * COIN_SCALE * PREDATOR_BONUS_VALUE_FRAC));
  return { kg, coins };
}

// ---------------------------------------------------------------------------
// Seagull theft (spec 5.9 — see the ownership note at the top of this file)
// ---------------------------------------------------------------------------

export const SEAGULL_SPAWN_CHANCE = 0.22;
export const SEAGULL_ATTACK_DURATION = 3.2;
/** flight-curve blend: `e = k*0.7 + k*k*0.3` — mostly linear approach, a touch of dive-bomb. */
export const SEAGULL_ATTACK_LINEAR_WEIGHT = 0.7;
export const SEAGULL_ATTACK_QUADRATIC_WEIGHT = 0.3;
export const SEAGULL_TAP_HIT_RADIUS = 55;
export const SEAGULL_FLEE_REWARD = 10;

/** script.js `maybeSpawnSeagull()`: called ~500ms after a non-junk catch (the delay is the
 *  composing loop's timer, not this module's). */
export function rollSeagullSpawn(rng: () => number): boolean {
  return rng() < SEAGULL_SPAWN_CHANCE;
}

/** script.js `maybeSpawnSeagull()`'s attack-flight easing: `k=clamp(t/3.2,0,1)`, returns
 *  the 0..1 blend used to lerp the seagull from its entry point to the catch. */
export function seagullAttackProgress(t: number): number {
  const k = clamp(t / SEAGULL_ATTACK_DURATION, 0, 1);
  return k * SEAGULL_ATTACK_LINEAR_WEIGHT + k * k * SEAGULL_ATTACK_QUADRATIC_WEIGHT;
}

/** script.js `tapSeagull()`'s hit test — `hypot(x-g.x, y-g.y) <= 55*uiScale()`. */
export function seagullTapHit(dx: number, dy: number, uiScale: number): boolean {
  return Math.hypot(dx, dy) <= SEAGULL_TAP_HIT_RADIUS * uiScale;
}

/** script.js `maybeSpawnSeagull()`'s theft-on-timeout amount: `floor(catchInfo.coins/2)`. */
export function seagullTheftAmount(catchCoins: number): number {
  return Math.floor(catchCoins / 2);
}

// ---------------------------------------------------------------------------
// Streak-rescue offer (spec 5.10)
// ---------------------------------------------------------------------------

export const STREAK_RESCUE_MIN_STREAK = 5;
/** ads.js `Ads.rescue.dur` — window to accept the offer. Same value as state.ts's
 *  `AD_RESCUE_WINDOW`; not imported from there to avoid a state.ts dependency in this
 *  module's public surface — both cite the same spec constant (4.5s). */
export const STREAK_RESCUE_WINDOW = 4.5;

/** ads.js `Ads.offerRescue(streak)`'s three guard conditions (spec 5.10), as a pure
 *  predicate. `otherAdActive` covers both `this.current` and `this.gate`; `contactAllowed`
 *  is `this.contactAllowed()` (ad-network/consent state, out of scope here). */
export function canOfferStreakRescue(streak: number, otherAdActive: boolean, contactAllowed: boolean): boolean {
  return streak >= STREAK_RESCUE_MIN_STREAK && !otherAdActive && contactAllowed;
}
