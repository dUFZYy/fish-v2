import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initReel,
  updateReel,
  reelTap_DEAD_BOSS_PATH,
  rodFactor,
  ROD_ZONE_MIN,
  ONBOARDING_DRILL_CATCHES_THRESHOLD,
  PERFECT_TENSION_THRESHOLD,
  SHAKEN_OFF_TIME_THRESHOLD,
  IDLE_FAIL_THRESHOLD,
  NEAR_MISS_PROGRESS_THRESHOLD,
} from '../drill.ts';
import type { DrillContext } from '../drill.ts';

/** Deterministic mulberry32 PRNG so every test is reproducible. */
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

const CTX: DrillContext = { canvasWidth: 800, uiScale: 1 };

function initTestReel(overrides: Partial<Parameters<typeof initReel>[0]> = {}, seed = 1) {
  return initReel(
    {
      fight: 1,
      junk: false,
      rodZone: 0.3,
      catches: 20, // past onboarding by default so tests aren't accidentally onboarding-boosted
      armeTalentRank: 0,
      handTalentRank: 0,
      bobberX: 400,
      hookY: 200,
      ...overrides,
    },
    mulberry32(seed),
  );
}

// ---------------------------------------------------------------------------
// Tension reaching snap
// ---------------------------------------------------------------------------

test('tension reaching 1 snaps the line (lineSnapped)', () => {
  let state = initTestReel({ fight: 4 }); // high fight -> big tensionBurst/tensionHold
  const rng = mulberry32(2);
  let result;
  let ticks = 0;
  do {
    result = updateReel(state, 1 / 30, true, CTX, rng); // hold continuously — tension only rises
    state = result.state;
    ticks++;
  } while (result.failed === null && !result.completed && ticks < 2000);
  assert.equal(result.failed, 'lineSnapped');
  assert.ok(state.tension >= 1);
});

test('a line snap after high progress is reported as a near miss', () => {
  // Craft a state sitting right at the fail boundary with high maxProgress already recorded.
  let state = initTestReel();
  state = { ...state, maxProgress: 0.9, tension: 0.99 };
  const rng = mulberry32(3);
  const result = updateReel(state, 1, true, CTX, rng); // one big hold tick pushes tension over 1
  assert.equal(result.failed, 'lineSnapped');
  assert.equal(result.nearMiss, true);
  assert.ok(state.maxProgress >= NEAR_MISS_PROGRESS_THRESHOLD);
});

test('a line snap with low maxProgress is NOT a near miss', () => {
  let state = initTestReel();
  state = { ...state, maxProgress: 0.1, tension: 0.99 };
  const rng = mulberry32(4);
  const result = updateReel(state, 1, true, CTX, rng);
  assert.equal(result.failed, 'lineSnapped');
  assert.equal(result.nearMiss, false);
});

// ---------------------------------------------------------------------------
// A successful drill
// ---------------------------------------------------------------------------

test('holding with a weak, non-fleeing fish eventually completes the drill', () => {
  // fight=0.1 keeps tensionHold small and reelRate high; junk fish never flees at all
  // (burst/feint rolls still run, but with fight this low tensionBurst stays modest too).
  let state = initTestReel({ fight: 0.1, junk: true, catches: 0 });
  const rng = mulberry32(5);
  let result;
  let ticks = 0;
  do {
    result = updateReel(state, 1 / 30, true, CTX, rng);
    state = result.state;
    ticks++;
    assert.ok(state.tension <= 1, `tension exceeded 1 at tick ${ticks}`);
  } while (!result.completed && result.failed === null && ticks < 5000);
  assert.equal(result.completed, true);
  assert.equal(result.failed, null);
  assert.ok(state.progress >= 1);
});

// ---------------------------------------------------------------------------
// Flee warning / burst / feint timing
// ---------------------------------------------------------------------------

test('warn ramps 0..1 over warnDur as nextBurst counts down toward a flee', () => {
  let state = initTestReel({ fight: 3 }); // fight>=2 -> warnDur = 0.25 (short, easy to observe)
  state = { ...state, nextBurst: state.warnDur, fakeChance: 0 }; // force a real flee, not a feint
  const rng = mulberry32(6);
  const dt = state.warnDur / 10;
  let sawRisingWarn = false;
  for (let i = 0; i < 20; i++) {
    const before = state.warn;
    const result = updateReel(state, dt, false, CTX, rng);
    state = result.state;
    if (state.burst) break; // flee triggered
    if (state.warn > before) sawRisingWarn = true;
    assert.ok(state.warn >= 0 && state.warn <= 1);
  }
  assert.ok(sawRisingWarn, 'warn should ramp upward while counting down to a flee');
  assert.ok(state.burst !== null, 'a real flee (burst) should have started once nextBurst hit 0');
});

test('a feint (fake flee) shifts the anchor by less than a real flee and never sets burst', () => {
  let state = initTestReel({ fight: 3 });
  state = { ...state, nextBurst: 0, fakeChance: 1 }; // force the feint branch deterministically
  const rng = mulberry32(7);
  const anchorBefore = state.anchorX;
  const result = updateReel(state, 0.001, false, CTX, rng);
  state = result.state;
  assert.equal(state.burst, null, 'a feint must not start a real burst');
  assert.equal(state.dash, 0.4, 'a feint sets dash to the feint value (0.4), not the real-flee value (1)');
  assert.notEqual(state.anchorX, anchorBefore, 'a feint still nudges the anchor');
});

test('a real flee ends after its duration and schedules the next one', () => {
  let state = initTestReel({ fight: 3 });
  state = { ...state, nextBurst: 0, fakeChance: 0 };
  const rng = mulberry32(8);
  let result = updateReel(state, 0.001, false, CTX, rng);
  state = result.state;
  assert.ok(state.burst !== null);
  const dur = state.burst!.dur;
  // run past the burst's duration
  result = updateReel(state, dur + 0.01, false, CTX, rng);
  state = result.state;
  assert.equal(state.burst, null, 'burst should clear once its duration elapses');
  assert.ok(state.nextBurst > 0, 'a fresh nextBurst timer should be scheduled after the flee ends');
});

// ---------------------------------------------------------------------------
// Rod / talent influence
// ---------------------------------------------------------------------------

test('a better rod (higher rodZone) increases reelRate and tensionRelease', () => {
  const worseRod = initTestReel({ rodZone: ROD_ZONE_MIN, fight: 1.5 });
  const betterRod = initTestReel({ rodZone: 0.48, fight: 1.5 });
  assert.ok(betterRod.reelRate > worseRod.reelRate);
  assert.ok(betterRod.tensionRelease > worseRod.tensionRelease);
});

test('rodFactor is 0 at the worst rod and 1 at (or past) the best rod', () => {
  assert.equal(rodFactor(ROD_ZONE_MIN), 0);
  assert.ok(Math.abs(rodFactor(0.48) - 1) < 1e-9);
  assert.equal(rodFactor(0.1), 0); // clamped
  assert.equal(rodFactor(1), 1); // clamped
});

test('the "arme" talent scales reelRate; the "hand" talent scales tensionRelease', () => {
  const base = initTestReel({ armeTalentRank: 0, handTalentRank: 0 });
  const armeBoosted = initTestReel({ armeTalentRank: 5, handTalentRank: 0 });
  const handBoosted = initTestReel({ armeTalentRank: 0, handTalentRank: 5 });
  assert.ok(armeBoosted.reelRate > base.reelRate);
  assert.equal(armeBoosted.tensionRelease, base.tensionRelease);
  assert.ok(handBoosted.tensionRelease > base.tensionRelease);
  assert.equal(handBoosted.reelRate, base.reelRate);
});

test('onboarding (catches < 10) gives a reelRate bonus over a non-onboarding drill', () => {
  const onboarding = initTestReel({ catches: 0, fight: 1 });
  const normal = initTestReel({ catches: ONBOARDING_DRILL_CATCHES_THRESHOLD, fight: 1 });
  assert.ok(onboarding.reelRate > normal.reelRate);
});

// ---------------------------------------------------------------------------
// Fail on doing nothing (idle) / no progress
// ---------------------------------------------------------------------------

test('never holding fails as shakenOff once idle exceeds the threshold', () => {
  let state = initTestReel({ fight: 0.1 }); // low fight so tension release alone won't snap first
  const rng = mulberry32(9);
  let result;
  let elapsed = 0;
  const dt = 1 / 30;
  do {
    result = updateReel(state, dt, false, CTX, rng);
    state = result.state;
    elapsed += dt;
  } while (result.failed === null && elapsed < IDLE_FAIL_THRESHOLD + 1);
  assert.equal(result.failed, 'shakenOff');
  assert.ok(state.idle > IDLE_FAIL_THRESHOLD || (state.progress <= 0 && state.t > SHAKEN_OFF_TIME_THRESHOLD));
});

// ---------------------------------------------------------------------------
// Perfect-drill tracking
// ---------------------------------------------------------------------------

test('perfect starts true and flips to false once tension exceeds 0.75', () => {
  let state = initTestReel();
  assert.equal(state.perfect, true);
  state = { ...state, tension: PERFECT_TENSION_THRESHOLD }; // exactly at the threshold: still perfect
  let result = updateReel(state, 0, true, CTX, mulberry32(10));
  assert.equal(result.state.perfect, true);

  state = { ...state, tension: PERFECT_TENSION_THRESHOLD + 0.01 };
  result = updateReel(state, 0, true, CTX, mulberry32(10));
  assert.equal(result.state.perfect, false);
});

test('perfect stays false for the rest of the drill once broken', () => {
  let state = initTestReel();
  state = { ...state, tension: 0.9, perfect: false };
  const result = updateReel(state, 0.01, false, CTX, mulberry32(11));
  assert.equal(result.state.perfect, false);
});

// ---------------------------------------------------------------------------
// Dead boss counter-tap path (spec 4.7) — ported but unreachable
// ---------------------------------------------------------------------------

test('reelTap_DEAD_BOSS_PATH is a no-op on every real ReelState (state.boss is always false)', () => {
  let state = initTestReel();
  state = { ...state, nextBurst: 0, fakeChance: 0 };
  const result = updateReel(state, 0.001, false, CTX, mulberry32(12));
  state = result.state;
  assert.ok(state.burst !== null);
  assert.equal(state.boss, false);

  const tapped = reelTap_DEAD_BOSS_PATH(state, 0, CTX.canvasWidth);
  assert.deepEqual(tapped, state, 'the boss-tap path must not mutate a non-boss ReelState');
});

test('reelTap_DEAD_BOSS_PATH, if artificially reactivated, resolves a correctly-countered burst', () => {
  let state = initTestReel();
  state = { ...state, boss: true, burst: { t: 0, dur: 1, dir: 1, countered: false }, tension: 0.5, progress: 0.5 };
  // burst.dir === 1 -> correct counter-tap is on the LEFT half of the screen (side === -dir)
  const tapped = reelTap_DEAD_BOSS_PATH(state, 10, CTX.canvasWidth);
  assert.equal(tapped.burst!.countered, true);
  assert.ok(tapped.tension < state.tension);
  assert.ok(tapped.progress > state.progress);
});

test('reelTap_DEAD_BOSS_PATH, if artificially reactivated, punishes a wrong-side tap', () => {
  let state = initTestReel();
  state = { ...state, boss: true, burst: { t: 0, dur: 1, dir: 1, countered: false }, tension: 0.5 };
  // tapping the RIGHT half while dir===1 is the wrong side (side === dir, not -dir)
  const tapped = reelTap_DEAD_BOSS_PATH(state, CTX.canvasWidth - 10, CTX.canvasWidth);
  assert.equal(tapped.burst!.countered, false);
  assert.ok(tapped.tension > state.tension);
  assert.equal(tapped.perfect, false);
});
