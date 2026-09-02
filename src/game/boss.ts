/**
 * boss.ts — the boss fight minigame. Spec section 8 of docs/spec/01-core-loop.md, cross-
 * checked line-for-line against `bossfight.js` (the read-only old game) because the spec
 * doc's section 8 table omits several numbers `bossfight.js` actually uses (the special
 * moves' exact durations, the crank's per-tap damage, the extra "settle" delays after a
 * resolved special move) — the task brief names `bossfight.js` as a source for this file
 * specifically, unlike drill.ts/catch.ts where the spec text is complete and exclusive.
 * Every constant below cites its `bossfight.js` line.
 *
 * Pure logic only: cutscene/toast triggers are returned as plain events (`BossTickResult`,
 * `onBossCaught()`'s return value), never called directly — no Sound/haptic/spawn calls,
 * no DOM, no `Math.random()` (every roll takes an injected `rng`).
 */

import { clamp, randRange, talentMult } from './util';
import { rodFactor } from './drill';

// ---------------------------------------------------------------------------
// Move keys, boss ids, per-boss profile (spec 8.2-8.4; bossfight.js:10-38)
// ---------------------------------------------------------------------------

export type BossMoveKey = 'pull' | 'crank' | 'jump' | 'dive' | 'mud' | 'side' | 'grab' | 'ram' | 'lights' | 'freeze';

export type BossId = 'alterkarl' | 'nessie' | 'kraken' | 'megalodon' | 'leviathan' | 'eiskoenig';

export interface BossProfile {
  moves: readonly BossMoveKey[];
  special: BossMoveKey;
  /** the special fires guaranteed every Nth move (spec 8.4 "every"). */
  every: number;
  speed: number;
}

/** bossfight.js `BOSS_PROFILE` (spec 8.4), verbatim. */
export const BOSS_PROFILE: Record<BossId, BossProfile> = {
  alterkarl: { moves: ['pull', 'crank', 'dive'], special: 'mud', every: 3, speed: 0.95 },
  nessie: { moves: ['pull', 'jump', 'dive'], special: 'side', every: 3, speed: 1.05 },
  kraken: { moves: ['pull', 'crank', 'dive'], special: 'grab', every: 2, speed: 1.0 },
  megalodon: { moves: ['crank', 'jump', 'pull'], special: 'ram', every: 3, speed: 1.15 },
  leviathan: { moves: ['dive', 'pull', 'crank'], special: 'lights', every: 3, speed: 0.9 },
  eiskoenig: { moves: ['pull', 'crank', 'jump', 'dive'], special: 'freeze', every: 3, speed: 1.1 },
};

/** locations.js / fish.js boss table (spec 8.10): location id -> boss species id + value. */
export const LOCATION_BOSS: Record<string, { id: BossId; value: number }> = {
  see: { id: 'alterkarl', value: 3000 },
  boot: { id: 'nessie', value: 5000 },
  kueste: { id: 'kraken', value: 8000 },
  riff: { id: 'megalodon', value: 12000 },
  tiefsee: { id: 'leviathan', value: 20000 },
  arktis: { id: 'eiskoenig', value: 30000 },
};

// ---------------------------------------------------------------------------
// Phase / speed / tell (spec 8.5; bossfight.js:41, 77-80)
// ---------------------------------------------------------------------------

export const PHASE2_STAMINA_THRESHOLD = 0.66;
export const PHASE3_STAMINA_THRESHOLD = 0.33;

/** bossfight.js `bossPhase(f)`. */
export function bossPhase(stamina: number): 1 | 2 | 3 {
  return stamina > PHASE2_STAMINA_THRESHOLD ? 1 : stamina > PHASE3_STAMINA_THRESHOLD ? 2 : 3;
}

export const PHASE_SPEED_MULT: Readonly<Record<1 | 2 | 3, number>> = { 1: 1, 2: 1.15, 3: 1.35 };
export const TELL_DURATION: Readonly<Record<1 | 2 | 3, number>> = { 1: 0.8, 2: 0.62, 3: 0.5 };
export const REST_DURATION_DEFAULT = 0.55;
export const REST_DURATION_PHASE3 = 0.35;
export const INTRO_DURATION = 1.1;

export function moveSpeed(phase: 1 | 2 | 3, profileSpeed: number): number {
  return PHASE_SPEED_MULT[phase] * profileSpeed;
}

// ---------------------------------------------------------------------------
// Per-move duration formulas (bossfight.js:81-92 — NOT fully given in the spec table,
// which only lists the 4 base moves' timing; the 6 special moves' durations are read from
// bossfight.js directly, see the file header note above).
// ---------------------------------------------------------------------------

export const PULL_DUR_MIN = 1.3;
export const PULL_DUR_MAX = 1.9;
export const CRANK_DUR_MIN = 1.9;
export const CRANK_DUR_MAX = 2.4;
export const JUMP_DUR_BASE = 1.35;
export const DIVE_DUR_MIN = 1.3;
export const DIVE_DUR_MAX = 1.8;
export const MUD_DUR_MIN = 2.0;
export const MUD_DUR_MAX = 2.6;
export const SIDE_DUR_BASE = 1.6;
export const GRAB_DUR = 2.4;
export const RAM_DUR_BASE = 1.5;
export const LIGHTS_DUR = 3.2;
export const FREEZE_DUR = 2.2;

/** bossfight.js `nextBossMove()`'s `dur` table. Only pull/jump/side/ram scale by `speed`
 *  (matches the source literally — crank/dive/mud/grab/lights/freeze do not). */
export function moveDuration(key: BossMoveKey, speed: number, rng: () => number): number {
  switch (key) {
    case 'pull':
      return randRange(PULL_DUR_MIN, PULL_DUR_MAX, rng) / speed;
    case 'crank':
      return randRange(CRANK_DUR_MIN, CRANK_DUR_MAX, rng);
    case 'jump':
      return JUMP_DUR_BASE / speed;
    case 'dive':
      return randRange(DIVE_DUR_MIN, DIVE_DUR_MAX, rng);
    case 'mud':
      return randRange(MUD_DUR_MIN, MUD_DUR_MAX, rng);
    case 'side':
      return SIDE_DUR_BASE / speed;
    case 'grab':
      return GRAB_DUR;
    case 'ram':
      return RAM_DUR_BASE / speed;
    case 'lights':
      return LIGHTS_DUR;
    case 'freeze':
      return FREEZE_DUR;
  }
}

// ---------------------------------------------------------------------------
// Init (spec 8.6; bossfight.js:43-63)
// ---------------------------------------------------------------------------

export const BASE_MAX_LINE = 4;
export const MAX_LINE_ROD_BONUS_THRESHOLD = 0.5;
export const MAX_LINE_HAND_TALENT_THRESHOLD = 4;

export interface MaxLineParams {
  rodZone: number;
  handTalentRank: number;
}

/** bossfight.js `startBossFight()`: `4 + (rodF>0.5?1:0) + (talentRank("hand")>=4?1:0)`. */
export function maxLineSegments(p: MaxLineParams): number {
  const rodF = rodFactor(p.rodZone);
  return BASE_MAX_LINE + (rodF > MAX_LINE_ROD_BONUS_THRESHOLD ? 1 : 0) + (p.handTalentRank >= MAX_LINE_HAND_TALENT_THRESHOLD ? 1 : 0);
}

export interface BossArm {
  x: number;
  y: number;
  hit: boolean;
}

/** bossfight.js `nextBossMove()`'s per-move scratch state, folded into one instance shape
 *  (unused fields for a given `key` are simply left at their defaults). */
export interface BossMoveInstance {
  key: BossMoveKey;
  tell: number;
  dur: number;
  /** jump: 0..1+ timing ring. */
  ring: number;
  /** dive: 0..1 hold-fill bar. */
  holdFill: number;
  /** crank: taps so far. */
  cranks: number;
  /** freeze: 0..1 thaw meter. */
  thaw: number;
  /** side: which side the boss surfaces on. 0 = not a `side` move. */
  sideDir: -1 | 0 | 1;
  /** grab: the 4 tentacles. Empty for every other move. */
  arms: readonly BossArm[];
  /** lights: the 3-zone sequence to repeat. Empty for every other move. */
  seq: readonly number[];
  seqStep: number;
  /** lights: 0..1 preview-playback progress; only >=1 (playback done) accepts input. */
  seqShow: number;
}

export interface BossFightState {
  bossId: BossId;
  stamina: number;
  line: number;
  maxLine: number;
  phase: 1 | 2 | 3;
  moveCount: number;
  move: BossMoveInstance | null;
  state: 'intro' | 'tell' | 'act' | 'rest';
  t: number;
  stateT: number;
  resolved: boolean;
  /** false forever once ANY line damage lands, or a crank/dive window is missed (spec 8.7). */
  flawless: boolean;
  hits: number;
}

/** bossfight.js `startBossFight(fish)` (spec 8.6), minus the fish/scene bookkeeping (that's
 *  state.ts's `BossFightStub`/world's job — this only owns the minigame's own state). */
export function initBossFight(bossId: BossId, rodZone: number, handTalentRank: number): BossFightState {
  return {
    bossId,
    stamina: 1,
    line: maxLineSegments({ rodZone, handTalentRank }),
    maxLine: maxLineSegments({ rodZone, handTalentRank }),
    phase: 1,
    moveCount: 0,
    move: null,
    state: 'intro',
    t: 0,
    stateT: 0,
    resolved: false,
    flawless: true,
    hits: 0,
  };
}

// ---------------------------------------------------------------------------
// Move selection (spec 8.4; bossfight.js:67-110)
// ---------------------------------------------------------------------------

export const GRAB_ARM_COUNT = 4;
export const GRAB_ARM_X_BASE = 0.16;
export const GRAB_ARM_X_STEP = 0.22;
export const GRAB_ARM_X_JITTER = 0.04;
export const GRAB_ARM_Y_MIN = 0.34;
export const GRAB_ARM_Y_MAX = 0.6;
/** bossfight.js:154 `Math.hypot(...) < 46*uiScale()`. */
export const GRAB_ARM_HIT_RADIUS = 46;

function initGrabArms(canvasWidth: number, canvasHeight: number, rng: () => number): BossArm[] {
  const arms: BossArm[] = [];
  for (let i = 0; i < GRAB_ARM_COUNT; i++) {
    arms.push({
      x: canvasWidth * (GRAB_ARM_X_BASE + i * GRAB_ARM_X_STEP + randRange(-GRAB_ARM_X_JITTER, GRAB_ARM_X_JITTER, rng)),
      y: canvasHeight * randRange(GRAB_ARM_Y_MIN, GRAB_ARM_Y_MAX, rng),
      hit: false,
    });
  }
  return arms;
}

/**
 * bossfight.js `f.seq = [0,1,2].sort(() => Math.random()-0.5)`. Reimplemented as a proper
 * Fisher-Yates shuffle driven by `rng` instead of replicating the original's
 * comparator-based shuffle: both produce a uniformly-random permutation of [0,1,2] for
 * gameplay purposes, but `Array.prototype.sort`'s behavior on a non-transitive comparator
 * is engine-defined, so there is no single "verbatim" formula to port bit-for-bit here —
 * a deliberate, noted deviation, not a guess.
 */
function shuffleThreeZones(rng: () => number): number[] {
  const arr = [0, 1, 2];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export interface RollNextMoveResult {
  move: BossMoveInstance;
  moveCount: number;
}

/** bossfight.js `nextBossMove(f)` (spec 8.4/8.5). `prevKey` is the move just finished (or
 *  `null` for the very first move of the fight — nothing gets filtered out). */
export function rollNextMove(
  bossId: BossId,
  prevKey: BossMoveKey | null,
  moveCount: number,
  stamina: number,
  canvasWidth: number,
  canvasHeight: number,
  rng: () => number,
): RollNextMoveResult {
  const profile = BOSS_PROFILE[bossId];
  const nextCount = moveCount + 1;
  let pick: BossMoveKey;
  if (nextCount % profile.every === 0) {
    pick = profile.special;
  } else {
    const pool = profile.moves.filter((k) => k !== prevKey);
    pick = pool.length > 0 ? pool[Math.floor(rng() * pool.length)]! : profile.moves[0]!;
  }
  const phase = bossPhase(stamina);
  const speed = moveSpeed(phase, profile.speed);
  const move: BossMoveInstance = {
    key: pick,
    tell: TELL_DURATION[phase],
    dur: moveDuration(pick, speed, rng),
    ring: 0,
    holdFill: 0,
    cranks: 0,
    thaw: 0,
    sideDir: pick === 'side' ? (rng() < 0.5 ? -1 : 1) : 0,
    arms: pick === 'grab' ? initGrabArms(canvasWidth, canvasHeight, rng) : [],
    seq: pick === 'lights' ? shuffleThreeZones(rng) : [],
    seqStep: 0,
    seqShow: 0,
  };
  return { move, moveCount: nextCount };
}

// ---------------------------------------------------------------------------
// Damage reducers (spec 8.7; bossfight.js:112-127)
// ---------------------------------------------------------------------------

export function applyBossDamage(state: BossFightState, amount: number): BossFightState {
  return { ...state, stamina: clamp(state.stamina - amount, 0, 1), hits: state.hits + 1 };
}

/** bossfight.js `bossLineDamage()`: ALWAYS breaks `flawless`, unconditionally. */
export function applyBossLineDamage(state: BossFightState, amount: number): BossFightState {
  return { ...state, line: Math.max(0, state.line - amount), flawless: false };
}

// ---------------------------------------------------------------------------
// Per-move damage constants (spec 8.7 table; bossfight.js per-move `bossDamage(...)` calls)
// ---------------------------------------------------------------------------

export const PULL_SUCCESS_DAMAGE = 0.05;
export const MUD_SUCCESS_DAMAGE = 0.07;

export const CRANK_SUCCESS_TAPS = 5;
/** bossfight.js:203 — applied PER TAP, immediately (not deferred to duration-end). */
export const CRANK_TAP_DAMAGE = 0.028;
export const TALENT_ARME_CRANK_PER_RANK = 0.06;
/** bossfight.js:325 — regen on a missed crank window (cranks<5 at duration end). */
export const CRANK_FAIL_REGEN = 0.03;

export const JUMP_HIT_WINDOW = 0.8;
export const JUMP_PERFECT_WINDOW = 0.92;
export const JUMP_HIT_DAMAGE = 0.11;
export const JUMP_PERFECT_DAMAGE = 0.17;
export const TALENT_ARME_JUMP_PER_RANK = 0.06;
/** bossfight.js:331 — extra display window after `ring>=1`/a resolved tap, before `rest`. */
export const JUMP_REST_DELAY = 0.3;

export const DIVE_SUCCESS_DAMAGE = 0.12;
export const TALENT_ARME_DIVE_PER_RANK = 0.06;
export const DIVE_DRAIN_PER_SEC = 0.8;
/** bossfight.js:344 — grace window past `dur` before the miss is resolved. */
export const DIVE_FAIL_GRACE = 1.4;
export const DIVE_FAIL_REGEN = 0.05;

export const SIDE_SUCCESS_DAMAGE = 0.13;
export const TALENT_AUGE_SIDE_PER_RANK = 0.05;
/** bossfight.js:276 — extra display window after an auto-fail, before `rest`. */
export const SIDE_REST_DELAY = 0.3;

export const GRAB_SUCCESS_DAMAGE = 0.14;
export const TALENT_ARME_GRAB_PER_RANK = 0.06;
export const GRAB_FAIL_MAX_LINE_DAMAGE = 2;

export const RAM_SUCCESS_DAMAGE = 0.15;
export const TALENT_HAND_RAM_PER_RANK = 0.05;
/** bossfight.js:290 — the impact point, as a fraction of the move's duration. */
export const RAM_IMPACT_FRACTION = 0.72;
/** bossfight.js:296 — extra display window after impact, before `rest`. */
export const RAM_REST_DELAY = 0.4;

export const LIGHTS_SUCCESS_DAMAGE = 0.16;
export const TALENT_LEHRE_LIGHTS_PER_RANK = 0.05;
/** bossfight.js:301 — the "watch the pattern" preview phase, in seconds. */
export const LIGHTS_PREVIEW_DURATION = 1.4;

export const FREEZE_SUCCESS_DAMAGE = 0.11;
export const TALENT_HAND_FREEZE_PER_RANK = 0.06;
/** bossfight.js:190 per tap; :310 per second (continuous, even without input). */
export const FREEZE_TAP_GAIN = 0.09;
export const FREEZE_DECAY_PER_SEC = 0.45;

// ---------------------------------------------------------------------------
// tickBossFight — the per-frame update (spec 8.5-8.7; bossfight.js:222-354)
// ---------------------------------------------------------------------------

export interface BossTickInput {
  /** `isHolding` (continuous, read every tick). */
  holding: boolean;
  /** a discrete tap THIS tick, or `null`. Zone/side math is done inside this module (needs
   *  `canvasWidth`) — see `ctx.canvasWidth` below. */
  tap: { x: number; y: number } | null;
}

export interface BossTickContext {
  canvasWidth: number;
  canvasHeight: number;
  uiScale: number;
}

export interface BossTalentRanks {
  arme: number;
  auge: number;
  hand: number;
  lehre: number;
}

export interface BossBanner {
  text: string;
  kind: 'damage' | 'lineDamage' | 'regen';
}

export interface BossTickResult {
  state: BossFightState;
  /** `stamina<=0` -> 'win' (caller runs `winBossFightResult`+catch.ts's `computeCatch`);
   *  `line<=0` -> 'lose' (caller runs `loseBossFightMessage`). Checked once, at the end of
   *  this tick, exactly like bossfight.js's final two lines. */
  outcome: 'win' | 'lose' | null;
  /** the hit/miss banner text this tick produced, if any (spec 8.7's per-move `text`). */
  banner: BossBanner | null;
  /** set the tick the boss crosses into phase 2 or 3 (spec 8.5's "Er wird wütend!"/"Letzte Kraft!"). */
  phaseAnnounce: 2 | 3 | null;
}

/**
 * bossfight.js `updateBossFight(dt)` + `bossFightTap(tx,ty)`, merged into one per-tick
 * entry point: the original called these from two separate DOM handlers (rAF vs.
 * pointerdown), but since neither owns any state the other doesn't also read, folding a
 * same-frame tap into the regular tick is behavior-preserving and gives this module a
 * single call site per frame instead of two racing ones.
 */
export function tickBossFight(state: BossFightState, dt: number, input: BossTickInput, ctx: BossTickContext, talents: BossTalentRanks, rng: () => number): BossTickResult {
  let s: BossFightState = { ...state, t: state.t + dt, stateT: state.stateT + dt };
  let banner: BossBanner | null = null;
  let phaseAnnounce: 2 | 3 | null = null;

  const newPhase = bossPhase(s.stamina);
  if (newPhase !== s.phase) {
    phaseAnnounce = newPhase === 2 ? 2 : 3;
    s = { ...s, phase: newPhase };
  }

  const damage = (amount: number, text: string) => {
    s = applyBossDamage(s, amount);
    banner = { text, kind: 'damage' };
  };
  const lineDamage = (amount: number, text: string) => {
    s = applyBossLineDamage(s, amount);
    banner = { text, kind: 'lineDamage' };
  };

  if (s.state === 'intro') {
    if (s.stateT > INTRO_DURATION) {
      const rolled = rollNextMove(s.bossId, null, s.moveCount, s.stamina, ctx.canvasWidth, ctx.canvasHeight, rng);
      s = { ...s, move: rolled.move, moveCount: rolled.moveCount, state: 'tell', stateT: 0, resolved: false };
    }
    return { state: s, outcome: null, banner: null, phaseAnnounce };
  }

  if (s.state === 'tell') {
    if (s.stateT >= s.move!.tell) s = { ...s, state: 'act', stateT: 0 };
    return { state: s, outcome: null, banner: null, phaseAnnounce };
  }

  if (s.state === 'rest') {
    const restDur = s.phase === 3 ? REST_DURATION_PHASE3 : REST_DURATION_DEFAULT;
    if (s.stateT > restDur) {
      const rolled = rollNextMove(s.bossId, s.move?.key ?? null, s.moveCount, s.stamina, ctx.canvasWidth, ctx.canvasHeight, rng);
      s = { ...s, move: rolled.move, moveCount: rolled.moveCount, state: 'tell', stateT: 0, resolved: false };
    }
    return { state: s, outcome: null, banner: null, phaseAnnounce };
  }

  // --- state === 'act' ---
  const m: BossMoveInstance = { ...s.move! };
  let resolved = s.resolved;

  switch (m.key) {
    case 'mud': {
      if (input.holding && !resolved) {
        resolved = true;
        lineDamage(1, 'Nicht zerren!');
      }
      if (s.stateT >= m.dur) {
        if (!resolved) damage(MUD_SUCCESS_DAMAGE, 'Ruhig geblieben');
        s = { ...s, state: 'rest', stateT: 0 };
      }
      break;
    }
    case 'side': {
      if (input.tap && !resolved) {
        resolved = true;
        const side = tapSide(input.tap.x, ctx.canvasWidth);
        if (side === m.sideDir) damage(SIDE_SUCCESS_DAMAGE * talentMult(talents.auge, TALENT_AUGE_SIDE_PER_RANK), 'Erwischt!');
        else lineDamage(1, 'Falsche Seite!');
      }
      if (s.stateT >= m.dur && !resolved) {
        resolved = true;
        lineDamage(1, 'Sie war weg!');
      }
      if (s.stateT >= m.dur + SIDE_REST_DELAY) s = { ...s, state: 'rest', stateT: 0 };
      break;
    }
    case 'grab': {
      if (input.tap) {
        const tap = input.tap;
        const idx = m.arms.findIndex((a) => !a.hit && Math.hypot(tap.x - a.x, tap.y - a.y) < GRAB_ARM_HIT_RADIUS * ctx.uiScale);
        if (idx >= 0) {
          const arms = m.arms.map((a, i) => (i === idx ? { ...a, hit: true } : a));
          m.arms = arms;
          if (arms.every((a) => a.hit) && !resolved) {
            resolved = true;
            damage(GRAB_SUCCESS_DAMAGE * talentMult(talents.arme, TALENT_ARME_GRAB_PER_RANK), 'Alle abgewehrt!');
            s = { ...s, state: 'rest', stateT: 0 };
          }
        }
      }
      if (s.stateT >= m.dur && !resolved) {
        resolved = true;
        const left = m.arms.filter((a) => !a.hit).length;
        lineDamage(Math.min(GRAB_FAIL_MAX_LINE_DAMAGE, left), left > 1 ? 'Sie haben die Schnur!' : 'Einer hat gepackt!');
        s = { ...s, state: 'rest', stateT: 0 };
      }
      break;
    }
    case 'ram': {
      const p = s.stateT / m.dur;
      if (p >= RAM_IMPACT_FRACTION && !resolved) {
        resolved = true;
        if (input.holding) lineDamage(1, 'Voll getroffen!');
        else damage(RAM_SUCCESS_DAMAGE * talentMult(talents.hand, TALENT_HAND_RAM_PER_RANK), 'Ausgewichen!');
      }
      if (s.stateT >= m.dur + RAM_REST_DELAY) s = { ...s, state: 'rest', stateT: 0 };
      break;
    }
    case 'lights': {
      if (m.seqShow < 1) {
        m.seqShow = m.seqShow + dt / LIGHTS_PREVIEW_DURATION;
      } else {
        if (input.tap && !resolved) {
          const zone = clamp(Math.floor((input.tap.x / ctx.canvasWidth) * 3), 0, 2);
          if (zone === m.seq[m.seqStep]) {
            m.seqStep += 1;
            if (m.seqStep >= m.seq.length) {
              resolved = true;
              damage(LIGHTS_SUCCESS_DAMAGE * talentMult(talents.lehre, TALENT_LEHRE_LIGHTS_PER_RANK), 'Muster erkannt!');
              s = { ...s, state: 'rest', stateT: 0 };
            }
          } else {
            resolved = true;
            lineDamage(1, 'Falsches Licht!');
          }
        }
        if (s.stateT >= m.dur && !resolved) {
          resolved = true;
          lineDamage(1, 'Zu langsam!');
          s = { ...s, state: 'rest', stateT: 0 };
        }
      }
      break;
    }
    case 'freeze': {
      m.thaw = Math.max(0, m.thaw - dt * FREEZE_DECAY_PER_SEC);
      if (input.tap) {
        m.thaw = m.thaw + FREEZE_TAP_GAIN;
        if (m.thaw >= 1 && !resolved) {
          resolved = true;
          damage(FREEZE_SUCCESS_DAMAGE * talentMult(talents.hand, TALENT_HAND_FREEZE_PER_RANK), 'Aufgetaut!');
          s = { ...s, state: 'rest', stateT: 0 };
        }
      }
      if (s.stateT >= m.dur && !resolved) {
        resolved = true;
        lineDamage(1, 'Eingefroren!');
        s = { ...s, state: 'rest', stateT: 0 };
      }
      break;
    }
    case 'pull': {
      if (input.holding && !resolved) {
        resolved = true;
        lineDamage(1, 'Nicht ziehen!');
      }
      if (s.stateT >= m.dur) {
        if (!resolved) damage(PULL_SUCCESS_DAMAGE, 'Standgehalten');
        s = { ...s, state: 'rest', stateT: 0 };
      }
      break;
    }
    case 'crank': {
      if (input.tap) {
        m.cranks += 1;
        s = { ...s, stamina: clamp(s.stamina - CRANK_TAP_DAMAGE * talentMult(talents.arme, TALENT_ARME_CRANK_PER_RANK), 0, 1) };
      }
      if (s.stateT >= m.dur) {
        if (m.cranks < CRANK_SUCCESS_TAPS) {
          s = { ...s, flawless: false, stamina: clamp(s.stamina + CRANK_FAIL_REGEN, 0, 1) };
        }
        s = { ...s, state: 'rest', stateT: 0 };
      }
      break;
    }
    case 'jump': {
      m.ring = clamp(s.stateT / m.dur, 0, 1);
      if (input.tap && !resolved) {
        resolved = true;
        if (m.ring >= JUMP_HIT_WINDOW) {
          const perfect = m.ring >= JUMP_PERFECT_WINDOW;
          damage((perfect ? JUMP_PERFECT_DAMAGE : JUMP_HIT_DAMAGE) * talentMult(talents.arme, TALENT_ARME_JUMP_PER_RANK), perfect ? 'PERFEKT!' : 'Getroffen!');
        } else {
          lineDamage(1, 'Zu früh!');
        }
      }
      if (m.ring >= 1 && !resolved) {
        resolved = true;
        lineDamage(1, 'Verpasst!');
      }
      if (s.stateT >= m.dur + JUMP_REST_DELAY) s = { ...s, state: 'rest', stateT: 0 };
      break;
    }
    case 'dive': {
      if (input.holding) {
        m.holdFill = clamp(m.holdFill + dt / m.dur, 0, 1);
        if (m.holdFill >= 1 && !resolved) {
          resolved = true;
          damage(DIVE_SUCCESS_DAMAGE * talentMult(talents.arme, TALENT_ARME_DIVE_PER_RANK), 'Hochgezogen!');
          s = { ...s, state: 'rest', stateT: 0 };
        }
      } else {
        m.holdFill = Math.max(0, m.holdFill - dt * DIVE_DRAIN_PER_SEC);
      }
      if (s.stateT >= m.dur + DIVE_FAIL_GRACE && !resolved) {
        resolved = true;
        s = { ...s, flawless: false, stamina: clamp(s.stamina + DIVE_FAIL_REGEN, 0, 1), state: 'rest', stateT: 0 };
      }
      break;
    }
  }

  s = { ...s, move: m, resolved };

  if (s.stamina <= 0) return { state: s, outcome: 'win', banner, phaseAnnounce };
  if (s.line <= 0) return { state: s, outcome: 'lose', banner, phaseAnnounce };
  return { state: s, outcome: null, banner, phaseAnnounce };
}

/** bossfight.js:143 — the "which side" direction-tap mechanic used by Nessie's `side`
 *  move. Exported on its own: it's the one FUNCTIONING direction-tap mechanic in the game
 *  (drill.ts's `reelTap_DEAD_BOSS_PATH` is the same idea but unreachable). */
export function tapSide(tapX: number, canvasWidth: number): -1 | 1 {
  return tapX < canvasWidth / 2 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Win / lose / location unlock (spec 8.8-8.9; bossfight.js:356-374)
// ---------------------------------------------------------------------------

export interface WinBossFightResult {
  /** feeds `catch.ts`'s `computeCatch({ reelPerfect: ... })` — boss catches route through
   *  the normal catch economy (spec 8.8: "läuft danach durch die NORMALE catchFish()"). */
  perfect: boolean;
}

/** bossfight.js `winBossFight()`: `reel = { perfect: f.flawless }; catchFish();` — the
 *  `catchFish()` call itself is catch.ts's `computeCatch`, not repeated here. */
export function winBossFightResult(state: BossFightState): WinBossFightResult {
  return { perfect: state.flawless };
}

export const LOSE_NEAR_MISS_THRESHOLD = 70;

/** bossfight.js `loseBossFight()`: `left = round((1-stamina)*100)`. */
export function loseBossFightPercent(state: BossFightState): number {
  return Math.round((1 - state.stamina) * 100);
}

/** bossfight.js `loseBossFight()`'s message choice. */
export function loseBossFightMessage(state: BossFightState): string {
  const pct = loseBossFightPercent(state);
  return pct >= LOSE_NEAR_MISS_THRESHOLD ? `Schnur gerissen – er war bei ${pct} %!` : 'Er war zu stark. Nächstes Mal.';
}

export const BOSS_GEM_REWARD = 5;

export interface OnBossCaughtResult {
  gems: number;
  /** the next location's id, IF it isn't owned yet — granted for free. `null` otherwise
   *  (already owned, or this was the last location). */
  unlockLocationId: string | null;
}

/** locations.js `onBossCaught(sp)` (spec 8.9), pure: takes the location order and current
 *  ownership instead of touching `LOCATIONS`/`save` directly. */
export function onBossCaught(locationId: string, locationsInOrder: readonly string[], ownedLocationIds: readonly string[]): OnBossCaughtResult {
  const idx = locationsInOrder.indexOf(locationId);
  const next = idx >= 0 ? locationsInOrder[idx + 1] : undefined;
  const unlockLocationId = next && !ownedLocationIds.includes(next) ? next : null;
  return { gems: BOSS_GEM_REWARD, unlockLocationId };
}
