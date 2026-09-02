import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rollWeight,
  streakMultiplier,
  nextStreak,
  rollCoins,
  COIN_SCALE,
  rollShiny,
  SHINY_BASE_DIVISOR,
  computeCatch,
  lineSnappedMessage,
  NEAR_MISS_PROGRESS_THRESHOLD,
  isPredatorSpecies,
  rollPredatorBonusCatch,
  eligiblePreySpecies,
  computeBonusCatch,
  rollSeagullSpawn,
  seagullAttackProgress,
  seagullTapHit,
  seagullTheftAmount,
  canOfferStreakRescue,
  PREDATOR_BONUS_CATCH_CHANCE,
} from '../catch.ts';
import type { FishSpecies } from '../state.ts';

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

/** Fixed rng that always returns the same value — useful for pinning the weight roll. */
function fixedRng(value: number): () => number {
  return () => value;
}

function makeSpecies(overrides: Partial<FishSpecies> = {}): FishSpecies {
  return {
    id: 'hecht',
    rarity: 'uncommon',
    value: 60,
    kg: [2, 15],
    depth: [0.2, 0.8],
    fight: 2,
    speed: 1,
    len: 1.6,
    loc: ['see'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Weight distribution (spec 5.1)
// ---------------------------------------------------------------------------

test('rollWeight: rng()=0 gives exactly kg[0] (scaled by the fish scale)', () => {
  const sp = makeSpecies({ kg: [2, 15] });
  const kg = rollWeight(sp, 1.3, fixedRng(0)); // scale === reference -> the (scale/1.3) factor is 1
  assert.equal(kg, 2);
});

test('rollWeight: rng()=1 gives exactly kg[1] when scale === the 1.3 reference', () => {
  const sp = makeSpecies({ kg: [2, 15] });
  const kg = rollWeight(sp, 1.3, fixedRng(1));
  assert.equal(kg, 15);
});

test('rollWeight: the pow(rng,1.6) distortion skews most rolls toward the low end', () => {
  const sp = makeSpecies({ kg: [0, 10] });
  const rng = mulberry32(42);
  let sum = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) sum += rollWeight(sp, 1.3, rng);
  const mean = sum / n;
  // A uniform draw would average 5; the 1.6-power skew must pull the mean well below that.
  assert.ok(mean < 4, `expected a low-skewed mean, got ${mean}`);
});

test('rollWeight: a smaller/larger fish scale shrinks/grows the roll proportionally', () => {
  const sp = makeSpecies({ kg: [0, 10] });
  const small = rollWeight(sp, 0.8, fixedRng(1));
  const large = rollWeight(sp, 1.3, fixedRng(1));
  const larger = rollWeight(sp, 1.3 * 1.5, fixedRng(1));
  assert.ok(small < large);
  assert.ok(larger > large);
});

// ---------------------------------------------------------------------------
// Streak multiplier (spec 5.2)
// ---------------------------------------------------------------------------

test('streakMultiplier: 1 -> x1.00, 2 -> x1.25, 3 -> x1.50, 4 -> x1.75, 5+ -> x2.00 (capped)', () => {
  assert.equal(streakMultiplier(1), 1);
  assert.equal(streakMultiplier(2), 1.25);
  assert.equal(streakMultiplier(3), 1.5);
  assert.equal(streakMultiplier(4), 1.75);
  assert.equal(streakMultiplier(5), 2);
  assert.equal(streakMultiplier(6), 2); // caps at streak 5
  assert.equal(streakMultiplier(100), 2);
});

test('streakMultiplier: streak 0 (or negative) does not go below x1.00', () => {
  assert.equal(streakMultiplier(0), 1);
  assert.equal(streakMultiplier(-3), 1);
});

test('nextStreak: junk neither breaks nor grows the streak; normal catches grow it', () => {
  assert.equal(nextStreak(4, false), 5);
  assert.equal(nextStreak(4, true), 4);
});

// ---------------------------------------------------------------------------
// Coins (spec 5.3)
// ---------------------------------------------------------------------------

test('rollCoins: base value scales with COIN_SCALE and the weight percentile (0.75x..1.25x)', () => {
  const value = 100;
  const kg: readonly [number, number] = [0, 10];
  const atMinWeight = rollCoins({ value, kg, weightKg: 0, junk: false, shiny: false, multiplier: 1, feilschTalentRank: 0 });
  const atMaxWeight = rollCoins({ value, kg, weightKg: 10, junk: false, shiny: false, multiplier: 1, feilschTalentRank: 0 });
  assert.equal(atMinWeight, Math.round(value * COIN_SCALE * 0.75));
  assert.equal(atMaxWeight, Math.round(value * COIN_SCALE * 1.25));
  assert.ok(atMaxWeight > atMinWeight);
});

test('rollCoins: junk ignores multiplier/shiny/talent entirely and pays the flat base', () => {
  const params = { value: 5, kg: [0, 1] as [number, number], weightKg: 1, junk: true, shiny: true, multiplier: 3, feilschTalentRank: 5 };
  const coinsJunk = rollCoins(params);
  const coinsNonJunk = rollCoins({ ...params, junk: false });
  assert.equal(coinsJunk, Math.max(1, Math.round(5 * COIN_SCALE * 1.25)));
  assert.ok(coinsNonJunk > coinsJunk, 'a non-junk catch with the same inputs should pay more (multiplier/shiny/talent all apply)');
});

test('rollCoins: shiny multiplies coins by 5x; the feilsch talent adds up to +25%', () => {
  const base = { value: 100, kg: [0, 10] as [number, number], weightKg: 5, junk: false, multiplier: 1, feilschTalentRank: 0 };
  const plain = rollCoins({ ...base, shiny: false });
  const shiny = rollCoins({ ...base, shiny: true });
  assert.equal(shiny, plain * 5);
  const talented = rollCoins({ ...base, shiny: false, feilschTalentRank: 5 });
  assert.equal(talented, Math.round(plain * 1.25));
});

test('rollCoins: coins never round down to 0 even for a worthless species', () => {
  const coins = rollCoins({ value: 0, kg: [0, 1], weightKg: 0, junk: true, shiny: false, multiplier: 1, feilschTalentRank: 0 });
  assert.equal(coins, 1);
});

// ---------------------------------------------------------------------------
// Shiny probability (spec 5.5) — statistical, over many seeded rolls
// ---------------------------------------------------------------------------

test('rollShiny: base rate converges to ~1/80 over many rolls', () => {
  const sp = { junk: false, boss: false };
  const rng = mulberry32(7);
  const n = 200000;
  let hits = 0;
  for (let i = 0; i < n; i++) if (rollShiny(sp, false, 0, rng)) hits++;
  const rate = hits / n;
  const expected = 1 / SHINY_BASE_DIVISOR;
  assert.ok(Math.abs(rate - expected) < expected * 0.15, `expected ~${expected}, got ${rate}`);
});

test('rollShiny: the glueck totem quadruples the rate', () => {
  const sp = { junk: false, boss: false };
  const rng = mulberry32(8);
  const n = 100000;
  let hits = 0;
  for (let i = 0; i < n; i++) if (rollShiny(sp, true, 0, rng)) hits++;
  const rate = hits / n;
  const expected = (4 * 1) / SHINY_BASE_DIVISOR;
  assert.ok(Math.abs(rate - expected) < expected * 0.15, `expected ~${expected}, got ${rate}`);
});

test('rollShiny: junk and boss species can never be shiny, regardless of the roll', () => {
  const alwaysHit = () => 0; // rng()=0 is always < any positive chance
  assert.equal(rollShiny({ junk: true, boss: false }, true, 5, alwaysHit), false);
  assert.equal(rollShiny({ junk: false, boss: true }, true, 5, alwaysHit), false);
});

// ---------------------------------------------------------------------------
// computeCatch — the whole-catch entry point
// ---------------------------------------------------------------------------

test('computeCatch: perfect excludes junk even if reelPerfect was true', () => {
  const sp = makeSpecies({ junk: true });
  const result = computeCatch({ species: sp, scale: 1.3, reelPerfect: true, shiny: false, streakBefore: 0, feilschTalentRank: 0, lehreTalentRank: 0, rng: fixedRng(0.5) });
  assert.equal(result.perfect, false);
});

test('computeCatch: a perfect, high-streak, shiny catch pays out more than a plain one', () => {
  const sp = makeSpecies();
  const plain = computeCatch({ species: sp, scale: 1.3, reelPerfect: false, shiny: false, streakBefore: 0, feilschTalentRank: 0, lehreTalentRank: 0, rng: fixedRng(0.5) });
  const loaded = computeCatch({ species: sp, scale: 1.3, reelPerfect: true, shiny: true, streakBefore: 10, feilschTalentRank: 0, lehreTalentRank: 0, rng: fixedRng(0.5) });
  assert.ok(loaded.coins > plain.coins);
  assert.ok(loaded.xp > plain.xp);
  assert.equal(loaded.perfect, true);
});

test('computeCatch: junk species never break or extend the streak', () => {
  const sp = makeSpecies({ junk: true });
  const result = computeCatch({ species: sp, scale: 1.3, reelPerfect: false, shiny: false, streakBefore: 3, feilschTalentRank: 0, lehreTalentRank: 0, rng: fixedRng(0.5) });
  assert.equal(result.streakAfter, 3);
});

// ---------------------------------------------------------------------------
// "So knapp!" near-miss message (spec 5.7)
// ---------------------------------------------------------------------------

test('lineSnappedMessage: below the near-miss threshold gives the plain message', () => {
  const msg = lineSnappedMessage(0.5);
  assert.equal(msg.nearMiss, false);
  assert.equal(msg.message, 'Schnur gerissen!');
  assert.equal(msg.floatingText, null);
});

test('lineSnappedMessage: at/above the near-miss threshold names the percentage', () => {
  const msg = lineSnappedMessage(NEAR_MISS_PROGRESS_THRESHOLD);
  assert.equal(msg.nearMiss, true);
  assert.equal(msg.message, 'Schnur gerissen – bei 80 %!');
  assert.equal(msg.floatingText, 'So knapp!');

  const msg2 = lineSnappedMessage(0.93);
  assert.equal(msg2.message, 'Schnur gerissen – bei 93 %!');
});

// ---------------------------------------------------------------------------
// Predator / prey bonus catch (spec 5.8)
// ---------------------------------------------------------------------------

test('isPredatorSpecies / rollPredatorBonusCatch', () => {
  assert.equal(isPredatorSpecies('hecht'), true);
  assert.equal(isPredatorSpecies('rotauge'), false);
  assert.equal(rollPredatorBonusCatch(false, () => 0), false);
  const rng = mulberry32(1);
  let hits = 0;
  const n = 50000;
  for (let i = 0; i < n; i++) if (rollPredatorBonusCatch(true, rng)) hits++;
  const rate = hits / n;
  assert.ok(Math.abs(rate - PREDATOR_BONUS_CATCH_CHANCE) < 0.02);
});

test('eligiblePreySpecies filters by location, junk/boss, rarity, and size', () => {
  const predator = makeSpecies({ id: 'hecht', len: 1.6, loc: ['see'] });
  const pool: FishSpecies[] = [
    makeSpecies({ id: 'rotauge', rarity: 'common', len: 0.8, loc: ['see'] }), // eligible
    makeSpecies({ id: 'zander', rarity: 'rare', len: 0.8, loc: ['see'] }), // rarityIdx too high
    makeSpecies({ id: 'stiefel', rarity: 'common', len: 0.9, loc: ['see'], junk: true }), // junk excluded
    makeSpecies({ id: 'nessie', rarity: 'legendary', len: 1.0, loc: ['see'], boss: true }), // boss excluded
    makeSpecies({ id: 'karpfen', rarity: 'common', len: 1.5, loc: ['see'] }), // too big (not < 1.6*0.7=1.12)
    makeSpecies({ id: 'ukelei', rarity: 'common', len: 0.5, loc: ['boot'] }), // wrong location
  ];
  const eligible = eligiblePreySpecies(pool, predator, 'see').map((s) => s.id);
  assert.deepEqual(eligible, ['rotauge']);
});

test('computeBonusCatch: weight is within [kg0, kg0 + 0.4*range]; coins use the 0.8 value fraction', () => {
  const prey = { kg: [1, 11] as [number, number], value: 100 };
  const low = computeBonusCatch(prey, fixedRng(0));
  const high = computeBonusCatch(prey, fixedRng(1));
  assert.equal(low.kg, 1);
  assert.equal(high.kg, 1 + (11 - 1) * 0.4);
  assert.equal(low.coins, Math.max(1, Math.round(100 * COIN_SCALE * 0.8)));
  assert.equal(high.coins, low.coins);
});

// ---------------------------------------------------------------------------
// Seagull theft (spec 5.9)
// ---------------------------------------------------------------------------

test('rollSeagullSpawn converges to ~22%', () => {
  const rng = mulberry32(3);
  const n = 50000;
  let hits = 0;
  for (let i = 0; i < n; i++) if (rollSeagullSpawn(rng)) hits++;
  assert.ok(Math.abs(hits / n - 0.22) < 0.02);
});

test('seagullAttackProgress runs from 0 to 1 over the attack duration and clamps after', () => {
  assert.equal(seagullAttackProgress(0), 0);
  assert.equal(seagullAttackProgress(3.2), 1);
  assert.equal(seagullAttackProgress(10), 1); // clamped past the duration
  const mid = seagullAttackProgress(1.6);
  assert.ok(mid > 0 && mid < 1);
});

test('seagullTapHit: within/outside the 55*uiScale radius', () => {
  assert.equal(seagullTapHit(30, 30, 1), true); // hypot ~42.4 < 55
  assert.equal(seagullTapHit(60, 0, 1), false);
  assert.equal(seagullTapHit(60, 0, 2), true); // radius scales with uiScale
});

test('seagullTheftAmount halves and floors the catch coins', () => {
  assert.equal(seagullTheftAmount(101), 50);
  assert.equal(seagullTheftAmount(100), 50);
  assert.equal(seagullTheftAmount(1), 0);
});

// ---------------------------------------------------------------------------
// Streak-rescue offer (spec 5.10)
// ---------------------------------------------------------------------------

test('canOfferStreakRescue requires streak>=5, no other ad active, and contact allowed', () => {
  assert.equal(canOfferStreakRescue(5, false, true), true);
  assert.equal(canOfferStreakRescue(4, false, true), false);
  assert.equal(canOfferStreakRescue(5, true, true), false);
  assert.equal(canOfferStreakRescue(5, false, false), false);
});
