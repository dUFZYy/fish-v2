/**
 * bite.ts — species selection, lure radius, attraction rate, nibble/bite,
 * and every multiplier from spec section 3 (docs/spec/01-core-loop.md),
 * sourced from `fish.js` (`pickSpecies`, `updateFishes`) and `shop.js`
 * (`BAITS`).
 *
 * Every multiplier from the table in spec 3.6 is its own named, exported
 * function so each one is separately unit-testable and stacking is just
 * function composition (see `attractRate`).
 */

import { talentMult } from './util';
import { BITE_WINDOW } from './state';
import type { FishSpecies, RarityId } from './state';

// ---------------------------------------------------------------------------
// Rarity table (fish.js RARITY)
// ---------------------------------------------------------------------------

export interface RaritySpec {
  idx: number;
  weight: number;
}

/** fish.js RARITY — 5 rarity tiers, spawn weight and 0-based index. */
export const RARITY: Record<RarityId, RaritySpec> = {
  common: { idx: 0, weight: 50 },
  uncommon: { idx: 1, weight: 24 },
  rare: { idx: 2, weight: 10 },
  epic: { idx: 3, weight: 3.5 },
  legendary: { idx: 4, weight: 1 },
};

// ---------------------------------------------------------------------------
// Bait table (shop.js BAITS)
// ---------------------------------------------------------------------------

export interface Bait {
  id: string;
  /** Bite-rate multiplier (spec 3.3 `bait.rate`). */
  rate: number;
  /** Rare-weight multiplier (spec 3.1 `bait.rareMult`). */
  rareMult: number;
}

/** shop.js BAITS — id order and values verbatim from spec 3.3. */
export const BAITS: readonly Bait[] = [
  { id: 'wurm', rate: 1.0, rareMult: 1.0 }, // Wurm
  { id: 'brotkugel', rate: 1.4, rareMult: 1.2 }, // Brotkugel
  { id: 'mais', rate: 1.3, rareMult: 1.6 }, // Mais
  { id: 'koederfisch', rate: 1.5, rareMult: 2.6 }, // Köderfisch
  { id: 'garnele', rate: 1.6, rareMult: 3.4 }, // Garnele
  { id: 'glitzerkoeder', rate: 1.8, rareMult: 4.5 }, // Glitzerköder
];

// ---------------------------------------------------------------------------
// Species selection weight (fish.js pickSpecies, spec 3.1)
// ---------------------------------------------------------------------------

/** fish.js pickSpecies: golden-hour weight bonus for rarityIdx>=2. */
export const GOLDEN_HOUR_RARITY_WEIGHT_MULT = 2;
/** fish.js pickSpecies: `magnet` totem weight bonus for rarityIdx>=2. */
export const MAGNET_TOTEM_RARITY_WEIGHT_MULT = 2;
/** talents.js talentMult("glueck", per): rarity-weight bonus per rank. */
export const TALENT_GLUECK_WEIGHT_PER_RANK = 0.08;
/** fish.js pickSpecies: legendary weight damping factor (`sqrt(w)*0.8`). */
export const LEGENDARY_WEIGHT_DAMPING = 0.8;
/** fish.js pickSpecies: uncommon's share of the bait's rareMult bonus (`1+(rareMult-1)*0.4`). */
export const UNCOMMON_BAIT_WEIGHT_SHARE = 0.4;
/** fish.js pickSpecies: night species weight multiplier (only spawnable when night). */
export const NIGHT_SPECIES_WEIGHT_MULT = 2.2;
/** fish.js daylight() night threshold: `daylight() < 0.45`. */
export const NIGHT_LIGHT_THRESHOLD = 0.45;
/** fish.js pickSpecies: boss spawn roll chance per spawn cycle, when unlocked and none present. */
export const BOSS_SPAWN_CHANCE = 0.5;

/** fish.js pickSpecies: junk species get a fixed weight by id instead of the rarity table. */
export const JUNK_WEIGHT_BY_ID: Record<string, number> = {
  stiefel: 5,
  schatzkiste: 1.2,
  pinguin: 0.8,
};
/** fish.js pickSpecies: junk weight fallback for any id not in JUNK_WEIGHT_BY_ID. */
export const JUNK_WEIGHT_DEFAULT = 3;

export interface SpeciesWeightContext {
  bait: Bait;
  goldenHour: boolean;
  magnetTotemActive: boolean;
  glueckTalentRank: number;
}

/** fish.js pickSpecies: per-species spawn weight, verbatim from spec 3.1. */
export function speciesWeight(sp: FishSpecies, ctx: SpeciesWeightContext): number {
  const rarityIdx = RARITY[sp.rarity].idx;
  let w = RARITY[sp.rarity].weight;
  if (rarityIdx >= 2) {
    w *=
      ctx.bait.rareMult *
      (ctx.goldenHour ? GOLDEN_HOUR_RARITY_WEIGHT_MULT : 1) *
      (ctx.magnetTotemActive ? MAGNET_TOTEM_RARITY_WEIGHT_MULT : 1) *
      talentMult(ctx.glueckTalentRank, TALENT_GLUECK_WEIGHT_PER_RANK);
  }
  if (rarityIdx === 4) w = Math.sqrt(w) * LEGENDARY_WEIGHT_DAMPING;
  if (rarityIdx === 1) w *= 1 + (ctx.bait.rareMult - 1) * UNCOMMON_BAIT_WEIGHT_SHARE;
  if (sp.night) w *= NIGHT_SPECIES_WEIGHT_MULT;
  if (sp.junk) w = JUNK_WEIGHT_BY_ID[sp.id] ?? JUNK_WEIGHT_DEFAULT;
  return w;
}

/** fish.js daylight(): whether it currently counts as "night" for species pooling. */
export function isNightFor(daylightLevel: number): boolean {
  return daylightLevel < NIGHT_LIGHT_THRESHOLD;
}

/**
 * fish.js pickSpecies: filters the location's non-boss pool to species
 * eligible right now (night species excluded unless it's night).
 */
export function eligibleSpeciesPool(allSpecies: readonly FishSpecies[], locationId: string, night: boolean): FishSpecies[] {
  return allSpecies.filter((s) => !s.boss && s.loc.includes(locationId) && (!s.night || night));
}

function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: () => number): T | null {
  let total = 0;
  for (const w of weights) if (w > 0) total += w;
  if (total <= 0 || items.length === 0) return null;
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    if (roll < weights[i]) return items[i];
    roll -= weights[i];
  }
  for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
  return null;
}

/** fish.js pickSpecies: weighted random selection over the eligible pool. */
export function pickSpecies(pool: readonly FishSpecies[], ctx: SpeciesWeightContext, rng: () => number): FishSpecies | null {
  const weights = pool.map((sp) => speciesWeight(sp, ctx));
  return weightedPick(pool, weights, rng);
}

/**
 * fish.js pickSpecies: `if (bossOk && bossSp && !fishes.some(f=>f.species.boss)
 * && Math.random()<0.5) return bossSp;` — checked before the normal weighted pool.
 */
export function maybePickBoss(bossSpecies: FishSpecies | null, bossUnlocked: boolean, bossAlreadyInWater: boolean, rng: () => number): FishSpecies | null {
  if (bossUnlocked && bossSpecies && !bossAlreadyInWater && rng() < BOSS_SPAWN_CHANCE) return bossSpecies;
  return null;
}

// ---------------------------------------------------------------------------
// Lure radius (spec 3.2)
// ---------------------------------------------------------------------------

/** talents.js talentMult("auge", per): lure-radius bonus per rank. */
export const TALENT_AUGE_RADIUS_PER_RANK = 0.08;
/** fish.js attractRadius: boss fish get a bigger lure radius. */
export const BOSS_ATTRACT_RADIUS_MULT = 1.6;

/**
 * fish.js `attractRadius`: `Math.max(canvas.width, canvas.height*0.85) *
 * rod.radius * talentMult("auge",0.08)`, times a boss bonus.
 */
export function attractRadius(canvasWidth: number, canvasHeight: number, rodRadius: number, augeTalentRank: number, isBoss: boolean): number {
  const base = Math.max(canvasWidth, canvasHeight * 0.85) * rodRadius * talentMult(augeTalentRank, TALENT_AUGE_RADIUS_PER_RANK);
  return base * (isBoss ? BOSS_ATTRACT_RADIUS_MULT : 1);
}

// ---------------------------------------------------------------------------
// Attraction rate (roam -> attracted), spec 3.3 — every multiplier named
// ---------------------------------------------------------------------------

/** fish.js updateFishes: attraction rate base coefficient. */
export const ATTRACT_RATE_BASE = 0.55;
/** fish.js updateFishes: onboarding attraction multiplier while `save.stats.catches < 2`. */
export const ONBOARD_ATTRACT_CATCHES_THRESHOLD = 2;
/** fish.js updateFishes: onboarding attraction multiplier value. */
export const ONBOARD_ATTRACT_MULT = 5;
/** fish.js updateFishes: `1 + waitTime/6` wait-time attraction ramp divisor. */
export const WAIT_TIME_ATTRACT_DIVISOR = 6;
/** fish.js updateFishes: rain attraction multiplier. */
export const RAIN_ATTRACT_MULT = 1.6;
/** fish.js updateFishes: golden-hour attraction multiplier. */
export const GOLDEN_HOUR_ATTRACT_MULT = 1.3;
/** gems.js totemActive("lockruf"): attraction multiplier while the lockruf totem is active (180s). */
export const LOCKRUF_TOTEM_ATTRACT_MULT = 2;
/** talents.js talentMult("geduld", per): attraction-rate bonus per rank. */
export const TALENT_GEDULD_ATTRACT_PER_RANK = 0.1;
/** fish.js updateFishes: boss fish rarity penalty (rarer than any normal tier). */
export const BOSS_ATTRACT_PENALTY = 1.5;
/** fish.js updateFishes: `[1,0.7,0.45,0.3,0.2]` rarity attraction penalty, indexed by RARITY[].idx. */
export const RARITY_ATTRACT_PENALTY: readonly number[] = [1, 0.7, 0.45, 0.3, 0.2];

export function onboardingAttractMult(catches: number): number {
  return catches < ONBOARD_ATTRACT_CATCHES_THRESHOLD ? ONBOARD_ATTRACT_MULT : 1;
}

export function waitTimeAttractMult(waitTime: number): number {
  return 1 + waitTime / WAIT_TIME_ATTRACT_DIVISOR;
}

export function rainAttractMult(raining: boolean): number {
  return raining ? RAIN_ATTRACT_MULT : 1;
}

export function goldenHourAttractMult(goldenHour: boolean): number {
  return goldenHour ? GOLDEN_HOUR_ATTRACT_MULT : 1;
}

export function lockrufTotemAttractMult(active: boolean): number {
  return active ? LOCKRUF_TOTEM_ATTRACT_MULT : 1;
}

export function geduldTalentAttractMult(rank: number): number {
  return talentMult(rank, TALENT_GEDULD_ATTRACT_PER_RANK);
}

export function rarityAttractPenalty(isBoss: boolean, rarityIdx: number): number {
  return isBoss ? BOSS_ATTRACT_PENALTY : RARITY_ATTRACT_PENALTY[rarityIdx];
}

export interface AttractRateContext {
  catches: number;
  waitTime: number;
  raining: boolean;
  goldenHour: boolean;
  lockrufTotemActive: boolean;
  geduldTalentRank: number;
  bait: Bait;
  isBoss: boolean;
  rarityIdx: number;
}

/**
 * fish.js updateFishes: `rate = 0.55 * rarityPenalty * bait.rate * waitBoost *
 * talentMult("geduld",0.10)`, where `waitBoost` stacks the five multipliers
 * above. Returns the per-second attraction probability rate (multiply by dt
 * and roll against `rng()` — see `rollAttracted`).
 */
export function attractRate(ctx: AttractRateContext): number {
  const waitBoost =
    waitTimeAttractMult(ctx.waitTime) *
    rainAttractMult(ctx.raining) *
    goldenHourAttractMult(ctx.goldenHour) *
    onboardingAttractMult(ctx.catches) *
    lockrufTotemAttractMult(ctx.lockrufTotemActive);
  const rarityPenalty = rarityAttractPenalty(ctx.isBoss, ctx.rarityIdx);
  return ATTRACT_RATE_BASE * rarityPenalty * ctx.bait.rate * waitBoost * geduldTalentAttractMult(ctx.geduldTalentRank);
}

/** fish.js updateFishes: `if (Math.random() < rate*dt) f.state = "attracted";` */
export function rollAttracted(rate: number, dt: number, rng: () => number): boolean {
  return rng() < rate * dt;
}

/**
 * fish.js updateFishes: "solange ein Boss im Wasser ist ... können normale
 * Fische nicht anbeißen" — boss fish always may attract; normal fish only
 * when no (non-fleeing) boss is present.
 */
export function canAttract(isBoss: boolean, bossPresentInWater: boolean): boolean {
  return isBoss || !bossPresentInWater;
}

// ---------------------------------------------------------------------------
// Approach, nibble, bite (spec 3.4)
// ---------------------------------------------------------------------------

/** fish.js updateFishes: `sp.speed*70*uiScale()` swim-speed scale. */
export const ATTRACTED_SPEED_SCALE = 70;
/** fish.js updateFishes: velocity lerp rate toward the bobber while attracted (`dt*3`). */
export const ATTRACTED_TURN_RATE = 3;
/** fish.js updateFishes: distance under which a nibble can trigger. */
export const NIBBLE_DISTANCE = 70;
/** fish.js updateFishes: nibble roll probability per second (`dt*2.5`). */
export const NIBBLE_PROB_PER_SEC = 2.5;
/** fish.js updateFishes: nibble pose duration in seconds. */
export const NIBBLE_POSE_DURATION = 0.35;
/** fish.js updateFishes: distance under which the fish actually bites (startBite). */
export const BITE_DISTANCE = 14;

/** fish.js updateFishes: attracted-fish velocity toward the bobber, lerped each frame. */
export function attractedVelocity(dx: number, dy: number, dist: number, vx: number, vy: number, speciesSpeed: number, uiScale: number, dt: number): { vx: number; vy: number } {
  if (dist <= 0) return { vx, vy };
  const sp2 = speciesSpeed * ATTRACTED_SPEED_SCALE * uiScale;
  const targetVx = (dx / dist) * sp2;
  const targetVy = (dy / dist) * sp2;
  const t = dt * ATTRACTED_TURN_RATE;
  return { vx: vx + (targetVx - vx) * t, vy: vy + (targetVy - vy) * t };
}

/** fish.js updateFishes: `dist < 70*uiScale() && Math.random() < dt*2.5` triggers a nibble pose. */
export function rollNibble(dist: number, uiScale: number, dt: number, rng: () => number): boolean {
  return dist < NIBBLE_DISTANCE * uiScale && rng() < dt * NIBBLE_PROB_PER_SEC;
}

/** fish.js updateFishes: `dist < 14*uiScale()` triggers startBite(f). */
export function shouldStartBite(dist: number, uiScale: number): boolean {
  return dist < BITE_DISTANCE * uiScale;
}

// ---------------------------------------------------------------------------
// Bite window ring (spec 3.5) — BITE_WINDOW itself lives in state.ts
// ---------------------------------------------------------------------------

/** script.js drawBiteAlert: ring color switches from yellow to red below this fraction. */
export const BITE_RING_WARN_THRESHOLD = 0.35;

export function biteWindowFraction(biteTimer: number): number {
  return Math.max(0, Math.min(1, biteTimer / BITE_WINDOW));
}

export type BiteRingColor = 'yellow' | 'red';

export function biteRingColor(frac: number): BiteRingColor {
  return frac > BITE_RING_WARN_THRESHOLD ? 'yellow' : 'red';
}

// ---------------------------------------------------------------------------
// Onboarding rare-fish guarantee (spec 2.3)
// ---------------------------------------------------------------------------

/** script.js: onboarding rare guarantee triggers on exactly the 2nd cast. */
export const ONBOARD_RARE_CATCHES = 1;

/**
 * script.js: "2. Wurf, save.stats.catches===1 && !save.onboardRare: garantiert
 * ein Fisch der Seltenheit idx===2 (rare), nicht night, nicht junk, wird
 * direkt in Attraktions-Reichweite gesetzt." Only ever once per save.
 */
export function shouldGuaranteeOnboardingRare(catches: number, onboardRareUsed: boolean): boolean {
  return catches === ONBOARD_RARE_CATCHES && !onboardRareUsed;
}
