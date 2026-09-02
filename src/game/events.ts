/**
 * events.ts — spec section 6 of docs/spec/01-core-loop.md: weather (`events.js`
 * `updateWeather`), the day/night cycle (`script.js` `dayTime`), golden hour, all 33
 * achievements (`events.js` `ACHIEVEMENTS`), and the toast queue.
 *
 * Ownership note (seagull): the spec places the ENTIRE seagull mechanic under section 5.9
 * ("Catch-Berechnung") and section 6.4 ("Möwe") is a one-line cross-reference back to it
 * with no content of its own ("Siehe Abschnitt 5.9 (vollständig)"). So the seagull is
 * implemented in catch.ts, not here — see that file's header for the full reasoning.
 * "Streak handling" in this file's remit is the "serie5" achievement predicate only; the
 * streak MULTIPLIER formula (spec 5.2) lives in catch.ts, which owns coins/xp.
 *
 * Same conventions as the rest of src/game: pure functions, no `Math.random()` (every roll
 * takes an injected `rng`), no DOM.
 */

import { clamp, lerp, randRange } from './util';
import { getWave } from './cast';
import { DAY_LENGTH } from './state';

// ---------------------------------------------------------------------------
// Weather (spec 6.1; events.js `updateWeather`)
// ---------------------------------------------------------------------------

export type WeatherType = 'clear' | 'rain';

export interface RainDrop {
  x: number;
  y: number;
  v: number;
}

export interface WeatherState {
  type: WeatherType;
  /** seconds until the next clear<->rain transition. */
  timer: number;
  /** 0 (clear) .. 1 (rain) — purely visual (palette), never affects bite logic or the clock. */
  gloom: number;
  /** 0..1, decays every tick; a lightning strike resets it to 1. */
  flash: number;
  drops: RainDrop[];
}

export const WEATHER_INITIAL_TIMER = 40;
export const RAIN_DURATION_MIN = 30;
export const RAIN_DURATION_MAX = 50;
export const CLEAR_DURATION_MIN = 70;
export const CLEAR_DURATION_MAX = 140;
export const WEATHER_GLOOM_LERP_RATE = 0.45;
export const LIGHTNING_PROB_PER_SEC = 0.05;
export const LIGHTNING_FLASH_DECAY_PER_SEC = 3;
export const RAINDROPS_PER_FRAME = 6;
export const RAINDROP_X_SPAWN_MARGIN = 50;
export const RAINDROP_SPEED_MIN = 600;
export const RAINDROP_SPEED_MAX = 900;
export const RAINDROP_DRIFT_PER_SEC = 60;
export const RAIN_RIPPLE_PROB_PER_SEC = 25;

/** events.js `const weather = {type:"clear", timer:40, drops:[], gloom:0}`. */
export function createInitialWeather(): WeatherState {
  return { type: 'clear', timer: WEATHER_INITIAL_TIMER, gloom: 0, flash: 0, drops: [] };
}

export interface WeatherTickContext {
  canvasWidth: number;
  /** world time (`time`), needed by `getWave()` for the raindrop-hits-water despawn check. */
  time: number;
  horizonY: number;
}

export interface WeatherTickResult {
  state: WeatherState;
  /** the clear->rain / rain->clear transition that happened this tick, or null. */
  transition: 'toRain' | 'toClear' | null;
  /** true if this tick's lightning roll fired (caller schedules the delayed thunder sound). */
  lightningRolled: boolean;
  /** true if this tick's ripple roll fired (caller spawns a ripple particle). */
  rippleRolled: boolean;
}

/** events.js `updateWeather(dt)` (spec 6.1), verbatim. */
export function tickWeather(state: WeatherState, dt: number, ctx: WeatherTickContext, rng: () => number): WeatherTickResult {
  const gloom = lerp(state.gloom, state.type === 'rain' ? 1 : 0, Math.min(1, dt * WEATHER_GLOOM_LERP_RATE));

  let timer = state.timer - dt;
  let type = state.type;
  let transition: WeatherTickResult['transition'] = null;
  if (timer <= 0) {
    if (type === 'clear') {
      type = 'rain';
      timer = randRange(RAIN_DURATION_MIN, RAIN_DURATION_MAX, rng);
      transition = 'toRain';
    } else {
      type = 'clear';
      timer = randRange(CLEAR_DURATION_MIN, CLEAR_DURATION_MAX, rng);
      transition = 'toClear';
    }
  }

  let flash = Math.max(0, state.flash - dt * LIGHTNING_FLASH_DECAY_PER_SEC);
  let lightningRolled = false;
  let rippleRolled = false;
  let drops = state.drops;

  if (type === 'rain') {
    lightningRolled = rng() < dt * LIGHTNING_PROB_PER_SEC;
    if (lightningRolled) flash = 1;
    const spawned: RainDrop[] = [];
    for (let i = 0; i < RAINDROPS_PER_FRAME; i++) {
      spawned.push({
        x: randRange(-RAINDROP_X_SPAWN_MARGIN, ctx.canvasWidth + RAINDROP_X_SPAWN_MARGIN, rng),
        y: -20,
        v: randRange(RAINDROP_SPEED_MIN, RAINDROP_SPEED_MAX, rng),
      });
    }
    drops = [...drops, ...spawned];
    rippleRolled = rng() < dt * RAIN_RIPPLE_PROB_PER_SEC;
  }

  const nextDrops: RainDrop[] = [];
  for (const d of drops) {
    const nx = d.x + RAINDROP_DRIFT_PER_SEC * dt;
    const ny = d.y + d.v * dt;
    if (ny <= getWave(nx, ctx.time, ctx.horizonY)) nextDrops.push({ x: nx, y: ny, v: d.v });
  }

  return { state: { type, timer, gloom, flash, drops: nextDrops }, transition, lightningRolled, rippleRolled };
}

// ---------------------------------------------------------------------------
// Golden hour (spec 6.2; events.js `isGoldenHour`)
// ---------------------------------------------------------------------------

export const GOLDEN_HOUR_MIN_LIGHT = 0.4;
export const GOLDEN_HOUR_MAX_LIGHT = 0.85;

/** events.js `isGoldenHour()`. `daylightLevel` is `getPalette(dayTime).light` — the
 *  palette lookup itself is renderer/data-bound (draw.js `SKY_KEYS`), so it's a parameter. */
export function isGoldenHour(daylightLevel: number): boolean {
  return daylightLevel > GOLDEN_HOUR_MIN_LIGHT && daylightLevel < GOLDEN_HOUR_MAX_LIGHT;
}

/** fish.js `daylight() < 0.45` night threshold — re-exported here for symmetry with
 *  `isGoldenHour`; bite.ts's `isNightFor`/`NIGHT_LIGHT_THRESHOLD` is the canonical source
 *  (spec 3.1), imported rather than duplicated where the two must agree. */
export { isNightFor, NIGHT_LIGHT_THRESHOLD } from './bite';

// ---------------------------------------------------------------------------
// Day/night cycle (spec 6.3; script.js `dayTime = (dayTime + dt/DAY_LENGTH) % 1`)
// ---------------------------------------------------------------------------

/** script.js's day/night advance. `DAY_LENGTH` (300s) is state.ts's constant — imported,
 *  not duplicated, since both must agree on one full cycle's length. */
export function tickDayTime(dayTime: number, dt: number): number {
  return ((dayTime + dt / DAY_LENGTH) % 1 + 1) % 1;
}

// ---------------------------------------------------------------------------
// Achievements (spec 6.5; events.js `ACHIEVEMENTS`, 33 entries)
// ---------------------------------------------------------------------------

export type AchievementId =
  | 'erster'
  | 'zehn'
  | 'fuenfzig'
  | 'stiefel'
  | 'post'
  | 'schatz'
  | 'nacht'
  | 'legendaer'
  | 'schwer'
  | 'sammler'
  | 'komplett'
  | 'serie5'
  | 'perfekt'
  | 'regen'
  | 'moewe'
  | 'reich'
  | 'reisender'
  | 'weltenbummler'
  | 'biologe'
  | 'hundert'
  | 'nessie'
  | 'pinguin'
  | 'acht-arme'
  | 'fischinfisch'
  | 'boss'
  | 'allebosse'
  | 'level10'
  | 'level25'
  | 'woche'
  | 'dexort'
  | 'teiler'
  | 'fleissig'
  | 'jackpot'
  | 'zocker'
  | 'shiny'
  | 'shiny10'
  | 'tiefsee';

/**
 * Everything an achievement predicate needs, decoupled from `SaveData`/`src/data` (neither
 * is owned by these six files). `dex` only needs truthy-per-id lookups (`!!ctx.dex[id]`),
 * matching the original's `!!save.dex.xyz`; species/location catalogs are passed in as
 * plain id lists so this module never imports src/data.
 */
export interface AchievementContext {
  catches: number;
  /** species id -> truthy if caught (`save.dex[id]`). Only presence is checked. */
  dex: Readonly<Record<string, unknown>>;
  /** `SPECIES.length` — total species count, for "komplett". */
  totalSpeciesCount: number;
  biggestKg: number;
  /** the runtime `streak` counter (NOT `save.stats` — the original's "serie5" reads the
   *  live global, so a streak that later resets to 0 does not un-earn this achievement,
   *  same as here: the CALLER decides when to check, typically right after a catch). */
  streak: number;
  perfects: number;
  rainCatches: number;
  totalCoins: number;
  unlockedLocationsCount: number;
  /** `LOCATIONS.length`. */
  totalLocationsCount: number;
  level: number;
  /** keys of `save.dexRewards` — "dexort" checks for any key ending in `:100`. */
  dexRewardKeys: readonly string[];
  questsCompleted: number;
  gachasOpened: number;
  shinies: number;
  /** all 6 boss species ids, for "allebosse". */
  bossSpeciesIds: readonly string[];
  /** species ids exclusive to "tiefsee" (`loc.length===1 && loc.includes("tiefsee")`), for "tiefsee". */
  tiefseeExclusiveSpeciesIds: readonly string[];
}

export interface AchievementDef {
  id: AchievementId;
  /** `null` = programmatic-only in the original (`check: () => false`) — unlocked by a
   *  direct call elsewhere (e.g. `unlockAchievement("moewe")` from the seagull tap
   *  handler), never by this predicate. */
  check: ((ctx: AchievementContext) => boolean) | null;
}

/** events.js `ACHIEVEMENTS` (spec 6.5), in the original's order. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'erster', check: (c) => c.catches >= 1 },
  { id: 'zehn', check: (c) => c.catches >= 10 },
  { id: 'fuenfzig', check: (c) => c.catches >= 50 },
  { id: 'stiefel', check: (c) => !!c.dex.stiefel },
  { id: 'post', check: (c) => !!c.dex.flaschenpost },
  { id: 'schatz', check: (c) => !!c.dex.schatzkiste },
  { id: 'nacht', check: (c) => !!c.dex.aal || !!c.dex.mondfisch },
  { id: 'legendaer', check: (c) => !!c.dex.mondfisch },
  { id: 'schwer', check: (c) => c.biggestKg >= 20 },
  { id: 'sammler', check: (c) => Object.keys(c.dex).length >= 6 },
  { id: 'komplett', check: (c) => Object.keys(c.dex).length >= c.totalSpeciesCount },
  { id: 'serie5', check: (c) => c.streak >= 5 },
  { id: 'perfekt', check: (c) => c.perfects >= 1 },
  { id: 'regen', check: (c) => c.rainCatches >= 1 },
  { id: 'moewe', check: null },
  { id: 'reich', check: (c) => c.totalCoins >= 1000 },
  { id: 'reisender', check: (c) => c.unlockedLocationsCount >= 1 },
  { id: 'weltenbummler', check: (c) => c.unlockedLocationsCount >= c.totalLocationsCount - 1 },
  { id: 'biologe', check: (c) => Object.keys(c.dex).length >= 50 },
  { id: 'hundert', check: (c) => Object.keys(c.dex).length >= 100 },
  { id: 'nessie', check: (c) => !!c.dex.nessie },
  { id: 'pinguin', check: (c) => !!c.dex.pinguin },
  { id: 'acht-arme', check: (c) => !!c.dex.oktopus || !!c.dex.blauring },
  { id: 'fischinfisch', check: null },
  { id: 'boss', check: null },
  { id: 'allebosse', check: (c) => c.bossSpeciesIds.length > 0 && c.bossSpeciesIds.every((id) => !!c.dex[id]) },
  { id: 'level10', check: (c) => c.level >= 10 },
  { id: 'level25', check: (c) => c.level >= 25 },
  { id: 'woche', check: null },
  { id: 'dexort', check: (c) => c.dexRewardKeys.some((k) => k.endsWith(':100')) },
  { id: 'teiler', check: null },
  { id: 'fleissig', check: (c) => c.questsCompleted >= 10 },
  { id: 'jackpot', check: null },
  { id: 'zocker', check: (c) => c.gachasOpened >= 20 },
  { id: 'shiny', check: (c) => c.shinies >= 1 },
  { id: 'shiny10', check: (c) => c.shinies >= 10 },
  { id: 'tiefsee', check: (c) => c.tiefseeExclusiveSpeciesIds.some((id) => !!c.dex[id]) },
];

/** events.js `unlockAchievement()`'s fixed reward — 1 gem per achievement, every time. */
export const ACHIEVEMENT_GEM_REWARD = 1;
/** events.js `toasts.push({..., life: 3.2, achievement:true})`. */
export const ACHIEVEMENT_TOAST_LIFE = 3.2;

/**
 * events.js's "check every achievement, unlock the ones that newly pass" loop — the part
 * of `unlockAchievement()`/its call sites that is a pure predicate scan. Skips
 * programmatic-only entries (`check: null`) and anything already unlocked. Returns ids in
 * `ACHIEVEMENTS` order (the original's toast queue is FIFO in check order too).
 */
export function checkAchievements(ctx: AchievementContext, alreadyUnlocked: ReadonlySet<AchievementId> | readonly AchievementId[]): AchievementId[] {
  const unlocked = alreadyUnlocked instanceof Set ? alreadyUnlocked : new Set(alreadyUnlocked);
  const newly: AchievementId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.check || unlocked.has(a.id)) continue;
    if (a.check(ctx)) newly.push(a.id);
  }
  return newly;
}

// ---------------------------------------------------------------------------
// Toast queue (spec 6.6; events.js `updateToasts`/`drawToasts`)
// ---------------------------------------------------------------------------

export interface Toast {
  age: number;
  life: number;
}

export const TOAST_FADE_IN_DURATION = 0.3;
export const TOAST_FADE_OUT_DURATION = 0.4;

/** events.js `updateToasts(dt)`: only `toasts[0]` ages; once it outlives its `life`, it's
 *  dequeued. Generic over `T extends Toast` so callers can carry extra fields (achievement
 *  id, catch info, ...) through the same queue, matching the original's mixed toast shapes. */
export function tickToastQueue<T extends Toast>(queue: readonly T[], dt: number): readonly T[] {
  if (queue.length === 0) return queue;
  const head = queue[0]!;
  const aged: T = { ...head, age: head.age + dt };
  return aged.age > aged.life ? queue.slice(1) : [aged, ...queue.slice(1)];
}

/** events.js `drawToasts()`'s alpha curve: fade in over the first 0.3s, fade out over the
 *  last 0.4s, `alpha = min(fadeIn, fadeOut)`. */
export function toastAlpha(toast: Toast): number {
  const fadeIn = Math.min(1, toast.age / TOAST_FADE_IN_DURATION);
  const fadeOut = clamp((toast.life - toast.age) / TOAST_FADE_OUT_DURATION, 0, 1);
  return Math.min(fadeIn, fadeOut);
}
