import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialWeather,
  tickWeather,
  WEATHER_INITIAL_TIMER,
  RAIN_DURATION_MIN,
  RAIN_DURATION_MAX,
  CLEAR_DURATION_MIN,
  CLEAR_DURATION_MAX,
  isGoldenHour,
  tickDayTime,
  checkAchievements,
  ACHIEVEMENTS,
  tickToastQueue,
  toastAlpha,
  TOAST_FADE_IN_DURATION,
  TOAST_FADE_OUT_DURATION,
} from '../events.ts';
import type { AchievementContext, WeatherState } from '../events.ts';
import { DAY_LENGTH } from '../state.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CTX = { canvasWidth: 800, time: 0, horizonY: 200 };

// ---------------------------------------------------------------------------
// Weather state machine (spec 6.1)
// ---------------------------------------------------------------------------

test('createInitialWeather starts clear with the spec-literal 40s startup timer', () => {
  const w = createInitialWeather();
  assert.equal(w.type, 'clear');
  assert.equal(w.timer, WEATHER_INITIAL_TIMER);
  assert.equal(w.gloom, 0);
  assert.deepEqual(w.drops, []);
});

test('clear transitions to rain once the timer runs out, with a rand(30,50)s rain timer', () => {
  let w: WeatherState = { ...createInitialWeather(), timer: 0.001 };
  const rng = mulberry32(1);
  const result = tickWeather(w, 0.01, CTX, rng);
  assert.equal(result.transition, 'toRain');
  assert.equal(result.state.type, 'rain');
  assert.ok(result.state.timer >= RAIN_DURATION_MIN && result.state.timer <= RAIN_DURATION_MAX);
});

test('rain transitions back to clear once its timer runs out, with a rand(70,140)s clear timer', () => {
  let w: WeatherState = { ...createInitialWeather(), type: 'rain', timer: 0.001 };
  const rng = mulberry32(2);
  const result = tickWeather(w, 0.01, CTX, rng);
  assert.equal(result.transition, 'toClear');
  assert.equal(result.state.type, 'clear');
  assert.ok(result.state.timer >= CLEAR_DURATION_MIN && result.state.timer <= CLEAR_DURATION_MAX);
});

test('no transition while the timer has not yet elapsed', () => {
  const w = createInitialWeather();
  const result = tickWeather(w, 1, CTX, mulberry32(3));
  assert.equal(result.transition, null);
  assert.equal(result.state.type, 'clear');
  assert.equal(result.state.timer, WEATHER_INITIAL_TIMER - 1);
});

test('gloom eases toward 1 during rain and toward 0 during clear, never jumping instantly', () => {
  let w: WeatherState = { ...createInitialWeather(), type: 'rain', gloom: 0 };
  const result = tickWeather(w, 0.1, CTX, mulberry32(4));
  assert.ok(result.state.gloom > 0 && result.state.gloom < 1);
});

test('rain spawns drops every tick and they eventually despawn once they reach the wave line', () => {
  let w: WeatherState = { ...createInitialWeather(), type: 'rain' };
  const rng = mulberry32(5);
  let result = tickWeather(w, 1 / 30, CTX, rng);
  assert.ok(result.state.drops.length > 0, 'rain should spawn raindrops');
  // Run long enough that every drop should have fallen past the (flat, horizonY) wave line.
  for (let i = 0; i < 300; i++) result = tickWeather(result.state, 1 / 30, CTX, rng);
  for (const d of result.state.drops) assert.ok(d.y <= CTX.horizonY + 20, 'a surviving drop must still be above the water line');
});

test('clear weather never spawns drops', () => {
  const w = createInitialWeather();
  const result = tickWeather(w, 1 / 30, CTX, mulberry32(6));
  assert.equal(result.state.drops.length, 0);
});

// ---------------------------------------------------------------------------
// Golden hour (spec 6.2)
// ---------------------------------------------------------------------------

test('isGoldenHour is true strictly between 0.4 and 0.85 light, false at the boundaries', () => {
  assert.equal(isGoldenHour(0.4), false);
  assert.equal(isGoldenHour(0.41), true);
  assert.equal(isGoldenHour(0.85), false);
  assert.equal(isGoldenHour(0.84), true);
  assert.equal(isGoldenHour(0.12), false); // night
  assert.equal(isGoldenHour(1.0), false); // full day
});

// ---------------------------------------------------------------------------
// Day/night cycle (spec 6.3)
// ---------------------------------------------------------------------------

test('tickDayTime advances by dt/DAY_LENGTH and wraps at 1 back to 0', () => {
  assert.ok(Math.abs(tickDayTime(0, 1) - 1 / DAY_LENGTH) < 1e-12);
  const justBelowWrap = tickDayTime(1 - 1e-9, 1e-9 * DAY_LENGTH * 2);
  assert.ok(justBelowWrap < 1e-6, `expected a wrap near 0, got ${justBelowWrap}`);
});

test('tickDayTime completes exactly one full cycle after DAY_LENGTH seconds', () => {
  let t = 0;
  const dt = 1; // 1-second steps
  for (let i = 0; i < DAY_LENGTH; i++) t = tickDayTime(t, dt);
  assert.ok(Math.abs(t - 0) < 1e-9, `expected to be back at 0 after a full day, got ${t}`);
});

// ---------------------------------------------------------------------------
// Achievements (spec 6.5) — all 33 entries present, predicates behave
// ---------------------------------------------------------------------------

function baseCtx(overrides: Partial<AchievementContext> = {}): AchievementContext {
  return {
    catches: 0,
    dex: {},
    totalSpeciesCount: 111,
    biggestKg: 0,
    streak: 0,
    perfects: 0,
    rainCatches: 0,
    totalCoins: 0,
    unlockedLocationsCount: 0,
    totalLocationsCount: 6,
    level: 1,
    dexRewardKeys: [],
    questsCompleted: 0,
    gachasOpened: 0,
    shinies: 0,
    bossSpeciesIds: ['alterkarl', 'nessie', 'kraken', 'megalodon', 'leviathan', 'eiskoenig'],
    tiefseeExclusiveSpeciesIds: ['leviathan-fisch'],
    ...overrides,
  };
}

test('ACHIEVEMENTS has exactly 37 entries, matching the actual spec 6.5 table (and events.js)', () => {
  // The spec doc's section-6.5 heading says "33 Einträge" but its own table — and the old
  // game's `events.js` ACHIEVEMENTS array — both literally list 37 rows. Ported the full,
  // literal table (37), not the stale header count; see the report for this call.
  assert.equal(ACHIEVEMENTS.length, 37);
});

test('6 achievements are programmatic-only (check===null): moewe, fischinfisch, boss, woche, teiler, jackpot', () => {
  const programmaticIds = ACHIEVEMENTS.filter((a) => a.check === null).map((a) => a.id).sort();
  assert.deepEqual(programmaticIds, ['boss', 'fischinfisch', 'jackpot', 'moewe', 'teiler', 'woche'].sort());
});

test('checkAchievements: a fresh context only unlocks catch-count/level-1 achievements it actually meets', () => {
  const ctx = baseCtx({ catches: 1 });
  const newly = checkAchievements(ctx, []);
  assert.ok(newly.includes('erster'));
  assert.ok(!newly.includes('zehn'));
});

test('checkAchievements: never re-reports an already-unlocked achievement', () => {
  const ctx = baseCtx({ catches: 50 });
  const newly = checkAchievements(ctx, ['erster', 'zehn']);
  assert.ok(!newly.includes('erster'));
  assert.ok(!newly.includes('zehn'));
  assert.ok(newly.includes('fuenfzig'));
});

test('komplett requires the dex to cover every species', () => {
  const partial = baseCtx({ dex: { a: true, b: true }, totalSpeciesCount: 3 });
  assert.ok(!checkAchievements(partial, []).includes('komplett'));
  const full = baseCtx({ dex: { a: true, b: true, c: true }, totalSpeciesCount: 3 });
  assert.ok(checkAchievements(full, []).includes('komplett'));
});

test('allebosse requires every boss species id present in the dex', () => {
  const ctx = baseCtx({ dex: { alterkarl: true, nessie: true }, bossSpeciesIds: ['alterkarl', 'nessie', 'kraken'] });
  assert.ok(!checkAchievements(ctx, []).includes('allebosse'));
  const ctx2 = baseCtx({ dex: { alterkarl: true, nessie: true, kraken: true }, bossSpeciesIds: ['alterkarl', 'nessie', 'kraken'] });
  assert.ok(checkAchievements(ctx2, []).includes('allebosse'));
});

test('weltenbummler needs all-but-one location unlocked', () => {
  const ctx = baseCtx({ unlockedLocationsCount: 4, totalLocationsCount: 6 });
  assert.ok(!checkAchievements(ctx, []).includes('weltenbummler'));
  const ctx2 = baseCtx({ unlockedLocationsCount: 5, totalLocationsCount: 6 });
  assert.ok(checkAchievements(ctx2, []).includes('weltenbummler'));
});

test('dexort fires once any dexRewards key ends with ":100"', () => {
  const ctx = baseCtx({ dexRewardKeys: ['see:50'] });
  assert.ok(!checkAchievements(ctx, []).includes('dexort'));
  const ctx2 = baseCtx({ dexRewardKeys: ['see:50', 'see:100'] });
  assert.ok(checkAchievements(ctx2, []).includes('dexort'));
});

test('nacht fires for either aal or mondfisch in the dex', () => {
  assert.ok(checkAchievements(baseCtx({ dex: { aal: true } }), []).includes('nacht'));
  assert.ok(checkAchievements(baseCtx({ dex: { mondfisch: true } }), []).includes('nacht'));
  assert.ok(!checkAchievements(baseCtx({ dex: {} }), []).includes('nacht'));
});

// ---------------------------------------------------------------------------
// Toast queue (spec 6.6)
// ---------------------------------------------------------------------------

test('tickToastQueue only ages the head toast, and dequeues it once life is exceeded', () => {
  const queue = [
    { age: 0, life: 1, id: 'a' },
    { age: 0, life: 1, id: 'b' },
  ];
  let q = tickToastQueue(queue, 0.5);
  assert.equal(q.length, 2);
  assert.equal(q[0]!.age, 0.5);
  assert.equal(q[1]!.age, 0); // untouched while it's not at the head

  q = tickToastQueue(q, 0.6); // 0.5+0.6=1.1 > life 1 -> dequeue
  assert.equal(q.length, 1);
  assert.equal(q[0]!.id, 'b');
});

test('tickToastQueue on an empty queue is a no-op', () => {
  const q = tickToastQueue([], 1);
  assert.equal(q.length, 0);
});

test('toastAlpha fades in over the first 0.3s and out over the last 0.4s', () => {
  const life = 3.2;
  assert.equal(toastAlpha({ age: 0, life }), 0);
  assert.ok(toastAlpha({ age: TOAST_FADE_IN_DURATION / 2, life }) < 1);
  assert.equal(toastAlpha({ age: TOAST_FADE_IN_DURATION, life }), 1);
  assert.equal(toastAlpha({ age: life - TOAST_FADE_OUT_DURATION / 2, life }) < 1, true);
  assert.equal(toastAlpha({ age: life, life }), 0);
});
