/**
 * drill.ts — the "Halten & Loslassen" (hold & release) drill v3.
 *
 * Source: `script.js` (`startReeling`, `updateReel`, `reelTap`), spec section 4 of
 * docs/spec/01-core-loop.md. Every constant below cites the spec formula it came from;
 * field names mirror `ReelState` (drillTypes.ts) which mirrors the original `reel` object
 * one field at a time.
 *
 * Convention (matches bite.ts/cast.ts): no `Math.random()` — every roll takes an injected
 * `rng: () => number`. No DOM/pixi. All layout numbers (canvasWidth, uiScale) are explicit
 * parameters, never read from a global.
 */

import { clamp, lerp, randRange, talentMult } from './util';
import type { ReelState, ReelBurst } from './drillTypes';

// ---------------------------------------------------------------------------
// Rod factor (spec 4.1: `rodF = clamp((rod.zone-0.26)/0.22, 0, 1)`)
// ---------------------------------------------------------------------------

/** shop.js RODS: `zone` ranges from 0.26 (Holzrute) to 0.48 (Das erste Projekt). */
export const ROD_ZONE_MIN = 0.26;
/** 0.48 - 0.26 — the full span `rod.zone` can cover. */
export const ROD_ZONE_RANGE = 0.22;

/** script.js `rodF` — 0 = worst rod, 1 = best rod. Reused by boss.ts's maxLineSegments(). */
export function rodFactor(rodZone: number): number {
  return clamp((rodZone - ROD_ZONE_MIN) / ROD_ZONE_RANGE, 0, 1);
}

// ---------------------------------------------------------------------------
// Init constants (spec 4.1)
// ---------------------------------------------------------------------------

export const REEL_INITIAL_TENSION = 0.15;

/** script.js `save.stats.catches < 10` — the drill's own onboarding window (distinct from
 *  bite.ts's `catches < 2` attraction-rate onboarding — two different thresholds in the
 *  original, kept separate here). */
export const ONBOARDING_DRILL_CATCHES_THRESHOLD = 10;

export const REEL_RATE_JUNK = 0.6;
export const REEL_RATE_BASE = 0.25;
/** subtracted: `- fight*0.035`. */
export const REEL_RATE_FIGHT_COEF = 0.035;
export const REEL_RATE_ROD_COEF = 0.14;
export const REEL_RATE_ONBOARD_BONUS = 0.04;
export const REEL_RATE_MIN = 0.08;
export const REEL_RATE_MAX = 0.45;
export const TALENT_ARME_REELRATE_PER_RANK = 0.06;

export const TENSION_HOLD_BASE = 0.1;
export const TENSION_HOLD_FIGHT_COEF = 0.04;
/** subtracted: `- rodF*0.03`. */
export const TENSION_HOLD_ROD_COEF = 0.03;

export const TENSION_BURST_BASE = 1.0;
export const TENSION_BURST_FIGHT_COEF = 0.3;

export const TENSION_RELEASE_BASE = 0.45;
export const TENSION_RELEASE_ROD_COEF = 0.45;
export const TALENT_HAND_RELEASE_PER_RANK = 0.08;

export const DRAIN_RELEASE_BASE = 0.05;
export const DRAIN_RELEASE_FIGHT_COEF = 0.02;

export const NEXT_BURST_MIN = 1.0;
export const NEXT_BURST_MAX = 1.8;
/** onboarding: `nextBurst *= 1.4` (fleeing starts later while learning). */
export const ONBOARD_NEXT_BURST_MULT = 1.4;

/** `[rand(1.3,2.2), rand(0.9,1.5), rand(0.65,1.1)]`, indexed by fight tier. */
export const BURST_EVERY_LOW: readonly [number, number] = [1.3, 2.2];
export const BURST_EVERY_MID: readonly [number, number] = [0.9, 1.5];
export const BURST_EVERY_HIGH: readonly [number, number] = [0.65, 1.1];
export const BURST_EVERY_FIGHT_LOW_MAX = 1.5;
export const BURST_EVERY_FIGHT_MID_MAX = 2.6;
/** onboarding: `burstEvery *= 1.3` (fewer/later flees while learning). */
export const ONBOARD_BURST_EVERY_MULT = 1.3;

export const WARN_DUR_HIGH_FIGHT = 0.25;
export const WARN_DUR_LOW_FIGHT = 0.4;
export const WARN_DUR_FIGHT_THRESHOLD = 2;

export const FAKE_CHANCE_FIGHT_THRESHOLD = 1.8;
export const FAKE_CHANCE_VALUE = 0.3;

// ---------------------------------------------------------------------------
// Flee / feint constants (spec 4.2)
// ---------------------------------------------------------------------------

export const BURST_DUR_MIN = 0.5;
export const BURST_DUR_MAX = 0.85;
/** `+ (r.boss ? 0.3 : 0)` — dead in the reachable path (`state.boss` is always false), kept
 *  for formula fidelity: a reactivated boss variant would get longer flees. */
export const BURST_DUR_BOSS_BONUS = 0.3;

export const BURST_ANCHOR_SHIFT_MIN = 90;
export const BURST_ANCHOR_SHIFT_MAX = 170;
export const FEINT_ANCHOR_SHIFT_MIN = 30;
export const FEINT_ANCHOR_SHIFT_MAX = 60;
export const FEINT_DASH = 0.4;
export const BURST_DASH = 1;
export const ANCHOR_CLAMP_MARGIN = 40;

export const FEINT_NEXT_BURST_FRAC_MIN = 0.5;
export const FEINT_NEXT_BURST_FRAC_MAX = 0.9;
export const POST_BURST_NEXT_FRAC_MIN = 0.8;
export const POST_BURST_NEXT_FRAC_MAX = 1.25;

// ---------------------------------------------------------------------------
// Fail / perfect constants (spec 4.4 / 4.5)
// ---------------------------------------------------------------------------

export const SHAKEN_OFF_TIME_THRESHOLD = 2.5;
export const IDLE_FAIL_THRESHOLD = 4;
export const TENSION_SNAP = 1;
export const NEAR_MISS_PROGRESS_THRESHOLD = 0.8;
export const PERFECT_TENSION_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Rod bend / ambient feedback constants (spec 4.6)
// ---------------------------------------------------------------------------

export const ROD_BEND_BASE = 0.3;
export const ROD_BEND_TENSION_COEF = 0.9;
export const ROD_BEND_LERP_RATE = 8;
export const REEL_CLICK_TENSION_THRESHOLD = 0.85;
export const REEL_CLICK_PROB_PER_SEC = 8;
export const HOLD_SPLASH_PROB_PER_SEC = 4;

// ---------------------------------------------------------------------------
// Jump timer constants (spec 4.8). AMBIGUITY: the spec gives only the timer's random
// range ("jumpTimer rand(1.5,3)/rand(2,4)") and its gating conditions
// (progress>0.4, hookY near-surface, not on ice) — it never states what the jump DOES
// (duration, visual arc) beyond "the fish jumps" being cosmetic. Those gating conditions
// depend on world/render state (hookY vs. horizonY, ice mode) this module does not own,
// so they are accepted as a caller-supplied `canJump` boolean rather than re-derived here.
// This module only owns the countdown and reports a one-shot `jumped` pulse; any visual
// arc/duration is the composing/world module's decision, not invented here.
// ---------------------------------------------------------------------------

export const JUMP_TIMER_INITIAL_MIN = 1.5;
export const JUMP_TIMER_INITIAL_MAX = 3;
export const JUMP_TIMER_RESET_MIN = 2;
export const JUMP_TIMER_RESET_MAX = 4;
export const JUMP_MIN_PROGRESS = 0.4;

// ---------------------------------------------------------------------------
// Fish-pull-during-drill physics (spec 4.8) — NOT called by updateReel. `bobberX` is owned
// by state.ts/cast.ts, not ReelState, so the composing loop (world) reads `fightPhase`/
// `dash`/`anchorX` from ReelState, calls this each tick, writes the result back into
// `reel.fightPhase` and lerps its own `bobberX` toward `anchorX + pull`. Exposed here only
// so that module doesn't have to re-derive the exact formula.
// ---------------------------------------------------------------------------

export const FISH_PULL_PHASE_BASE = 1.1;
export const FISH_PULL_PHASE_FIGHT_COEF = 0.5;
export const FISH_PULL_AMP_BASE = 50;
export const FISH_PULL_AMP_FIGHT_COEF = 20;
export const FISH_PULL_DASH_COEF = 1.5;
export const FISH_PULL_SECONDARY_FREQ = 2.7;
export const FISH_PULL_SECONDARY_AMP_FRAC = 0.25;

export interface FishPullTick {
  fightPhase: number;
  pull: number;
}

/** script.js updateWorld's fish-pull term during `reeling` (spec 4.8). */
export function tickFishPull(fightPhase: number, dt: number, speciesFight: number, dash: number, uiScale: number): FishPullTick {
  const nextPhase = fightPhase + dt * (FISH_PULL_PHASE_BASE + speciesFight * FISH_PULL_PHASE_FIGHT_COEF);
  const amp = (FISH_PULL_AMP_BASE + speciesFight * FISH_PULL_AMP_FIGHT_COEF) * uiScale * (1 + dash * FISH_PULL_DASH_COEF);
  const pull = Math.sin(nextPhase) * amp + Math.sin(nextPhase * FISH_PULL_SECONDARY_FREQ) * amp * FISH_PULL_SECONDARY_AMP_FRAC;
  return { fightPhase: nextPhase, pull };
}

// ---------------------------------------------------------------------------
// initReel (spec 4.1)
// ---------------------------------------------------------------------------

export interface InitReelParams {
  /** `sp.fight` — the hooked species' fight stat. */
  fight: number;
  /** `sp.junk` — bycatch reels in at a flat rate, ignoring fight/rod. */
  junk: boolean;
  /** `rod.zone` — current rod's drill-zone stat (shop.js RODS). */
  rodZone: number;
  /** `save.stats.catches` — drives the onboarding bonuses below `ONBOARDING_DRILL_CATCHES_THRESHOLD`. */
  catches: number;
  armeTalentRank: number;
  handTalentRank: number;
  /** `bobberX` at the moment of the strike — becomes `reel.anchorX`. */
  bobberX: number;
  /** `hookY` at the moment of the strike — becomes `reel.depthY`. */
  hookY: number;
}

/** script.js `startReeling()` (minus the boss branch, which never reaches this — see
 *  state.ts's `STRIKE` transition). Builds the initial `ReelState`. */
export function initReel(p: InitReelParams, rng: () => number): ReelState {
  const onboarding = p.catches < ONBOARDING_DRILL_CATCHES_THRESHOLD;
  const rodF = rodFactor(p.rodZone);

  const reelRate =
    (p.junk
      ? REEL_RATE_JUNK
      : clamp(
          REEL_RATE_BASE - p.fight * REEL_RATE_FIGHT_COEF + rodF * REEL_RATE_ROD_COEF + (onboarding ? REEL_RATE_ONBOARD_BONUS : 0),
          REEL_RATE_MIN,
          REEL_RATE_MAX,
        )) * talentMult(p.armeTalentRank, TALENT_ARME_REELRATE_PER_RANK);

  const burstEveryRange: readonly [number, number] =
    p.fight < BURST_EVERY_FIGHT_LOW_MAX ? BURST_EVERY_LOW : p.fight < BURST_EVERY_FIGHT_MID_MAX ? BURST_EVERY_MID : BURST_EVERY_HIGH;

  return {
    boss: false, // sp.boss is always false here; bosses never reach initReel (spec 4.1 note)
    t: 0,
    progress: 0,
    tension: REEL_INITIAL_TENSION,
    maxProgress: 0,
    maxTension: REEL_INITIAL_TENSION,
    perfect: true,
    reelRate,
    tensionHold: TENSION_HOLD_BASE + p.fight * TENSION_HOLD_FIGHT_COEF - rodF * TENSION_HOLD_ROD_COEF,
    tensionBurst: TENSION_BURST_BASE + p.fight * TENSION_BURST_FIGHT_COEF,
    tensionRelease: (TENSION_RELEASE_BASE + rodF * TENSION_RELEASE_ROD_COEF) * talentMult(p.handTalentRank, TALENT_HAND_RELEASE_PER_RANK),
    drainRelease: DRAIN_RELEASE_BASE + p.fight * DRAIN_RELEASE_FIGHT_COEF,
    burst: null,
    nextBurst: randRange(NEXT_BURST_MIN, NEXT_BURST_MAX, rng) * (onboarding ? ONBOARD_NEXT_BURST_MULT : 1),
    burstEvery: randRange(burstEveryRange[0], burstEveryRange[1], rng) * (onboarding ? ONBOARD_BURST_EVERY_MULT : 1),
    warnDur: p.fight >= WARN_DUR_FIGHT_THRESHOLD ? WARN_DUR_HIGH_FIGHT : WARN_DUR_LOW_FIGHT,
    fakeChance: p.fight >= FAKE_CHANCE_FIGHT_THRESHOLD && !onboarding ? FAKE_CHANCE_VALUE : 0,
    warn: 0,
    fake: null,
    feedbackT: 0,
    lastResult: null,
    anchorX: p.bobberX,
    depthY: p.hookY,
    fightPhase: 0,
    jumpTimer: randRange(JUMP_TIMER_INITIAL_MIN, JUMP_TIMER_INITIAL_MAX, rng),
    dash: 0,
    idle: 0,
    rodBend: ROD_BEND_BASE,
  };
}

// ---------------------------------------------------------------------------
// updateReel (spec 4.2-4.6)
// ---------------------------------------------------------------------------

export interface DrillContext {
  canvasWidth: number;
  uiScale: number;
  /** spec 4.8's gating for the cosmetic jump: `progress>0.4 && hookY near-surface && !ice`.
   *  The surface/ice half of that gate lives outside this module (world/layout); pass the
   *  combined result in. Optional — omit to disable jump pulses entirely. */
  canJump?: boolean;
}

export type ReelFailReason = 'lineSnapped' | 'shakenOff';

export interface ReelTickResult {
  state: ReelState;
  /** true once `progress` reached 1 this tick — caller fires the `REEL_COMPLETE` event. */
  completed: boolean;
  /** set once a fail condition triggers this tick — caller fires `REEL_FAILED`. */
  failed: ReelFailReason | null;
  /** only meaningful when `failed === 'lineSnapped'` — spec 5.7 "So knapp!". */
  nearMiss: boolean;
  /** ambient rng-rolled feedback flags (spec 4.6) — dispatching sound/particles is the caller's job. */
  reelClickRolled: boolean;
  holdSplashRolled: boolean;
  /** one-shot cosmetic jump pulse (spec 4.8) — see the ambiguity note above `JUMP_TIMER_INITIAL_MIN`. */
  jumped: boolean;
}

/**
 * script.js `updateReel(dt)` (spec 4.2-4.6), plus the jump timer (4.8, ambiguous scope —
 * see the note above). Does NOT include the fish-pull-during-drill positional math
 * (`tickFishPull`, above) — that needs `bobberX`, which is not part of `ReelState`.
 *
 * Priority when multiple end conditions land on the same tick (not specified by the
 * source, which runs these as sequential `if`s with no early return — see report):
 * `progress>=1` (catch) is checked first, then the idle/shaken-off fail, then the tension
 * snap. In practice at most one of these should ever be true on a given tick.
 */
export function updateReel(state: ReelState, dt: number, holding: boolean, ctx: DrillContext, rng: () => number): ReelTickResult {
  let r: ReelState = { ...state };
  r.t += dt;

  // --- 4.2: flee warning / burst / feint ---
  if (!r.burst) {
    r.nextBurst -= dt;
    r.warn = clamp(1 - r.nextBurst / r.warnDur, 0, 1);
    if (r.nextBurst <= 0) {
      if (r.fake == null) r.fake = rng() < r.fakeChance;
      if (r.fake) {
        r.fake = null;
        r.nextBurst = r.burstEvery * randRange(FEINT_NEXT_BURST_FRAC_MIN, FEINT_NEXT_BURST_FRAC_MAX, rng);
        const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;
        r.anchorX = clamp(
          r.anchorX + dir * randRange(FEINT_ANCHOR_SHIFT_MIN, FEINT_ANCHOR_SHIFT_MAX, rng) * ctx.uiScale,
          ANCHOR_CLAMP_MARGIN,
          ctx.canvasWidth - ANCHOR_CLAMP_MARGIN,
        );
        r.dash = FEINT_DASH;
      } else {
        r.fake = null;
        const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;
        const burst: ReelBurst = {
          t: 0,
          dur: randRange(BURST_DUR_MIN, BURST_DUR_MAX, rng) + (r.boss ? BURST_DUR_BOSS_BONUS : 0),
          dir,
          countered: false,
        };
        r.burst = burst;
        r.anchorX = clamp(
          r.anchorX + dir * randRange(BURST_ANCHOR_SHIFT_MIN, BURST_ANCHOR_SHIFT_MAX, rng) * ctx.uiScale,
          ANCHOR_CLAMP_MARGIN,
          ctx.canvasWidth - ANCHOR_CLAMP_MARGIN,
        );
        r.dash = BURST_DASH;
      }
    }
  } else {
    r.burst = { ...r.burst, t: r.burst.t + dt };
    r.warn = 0;
    if (r.burst.t >= r.burst.dur) {
      r.burst = null;
      r.nextBurst = r.burstEvery * randRange(POST_BURST_NEXT_FRAC_MIN, POST_BURST_NEXT_FRAC_MAX, rng);
    }
  }

  // --- 4.3: tension & progress ---
  const inBurst = !!r.burst && !r.burst.countered;
  if (holding) {
    r.tension += (inBurst ? r.tensionBurst : r.tensionHold) * dt;
    r.progress += r.reelRate * dt * (inBurst ? 0.4 : 1);
  } else {
    r.tension -= r.tensionRelease * dt;
    r.progress -= r.drainRelease * dt;
  }
  r.tension = clamp(r.tension, 0, 1);
  r.progress = clamp(r.progress, 0, 1);
  r.maxProgress = Math.max(r.maxProgress, r.progress);
  r.maxTension = Math.max(r.maxTension, r.tension);

  // --- 4.5: perfect drill ---
  if (r.tension > PERFECT_TENSION_THRESHOLD) r.perfect = false;

  // --- 4.6: rod bend & ambient feedback ---
  r.rodBend = lerp(r.rodBend, ROD_BEND_BASE + r.tension * ROD_BEND_TENSION_COEF, dt * ROD_BEND_LERP_RATE);
  const reelClickRolled = r.tension > REEL_CLICK_TENSION_THRESHOLD && rng() < dt * REEL_CLICK_PROB_PER_SEC;
  const holdSplashRolled = holding && rng() < dt * HOLD_SPLASH_PROB_PER_SEC;

  // --- 4.8 (partial): jump timer countdown ---
  r.jumpTimer -= dt;
  let jumped = false;
  if (r.jumpTimer <= 0) {
    const eligible = r.progress > JUMP_MIN_PROGRESS && (ctx.canJump ?? false);
    if (eligible) jumped = true;
    r.jumpTimer = randRange(JUMP_TIMER_RESET_MIN, JUMP_TIMER_RESET_MAX, rng);
  }

  // --- 4.4: fail conditions (checked in this order; success takes priority — see doc above) ---
  r.idle = holding ? 0 : r.idle + dt;

  if (r.progress >= 1) {
    return { state: r, completed: true, failed: null, nearMiss: false, reelClickRolled, holdSplashRolled, jumped };
  }
  if ((r.progress <= 0 && r.t > SHAKEN_OFF_TIME_THRESHOLD) || r.idle > IDLE_FAIL_THRESHOLD) {
    return { state: r, completed: false, failed: 'shakenOff', nearMiss: false, reelClickRolled, holdSplashRolled, jumped };
  }
  if (r.tension >= TENSION_SNAP) {
    const nearMiss = r.maxProgress >= NEAR_MISS_PROGRESS_THRESHOLD;
    return { state: r, completed: false, failed: 'lineSnapped', nearMiss, reelClickRolled, holdSplashRolled, jumped };
  }
  return { state: r, completed: false, failed: null, nearMiss: false, reelClickRolled, holdSplashRolled, jumped };
}

// ---------------------------------------------------------------------------
// Dead code, ported for fidelity (spec 4.7)
// ---------------------------------------------------------------------------

export const REEL_TAP_TENSION_RELIEF = 0.3;
export const REEL_TAP_PROGRESS_GAIN = 0.06;
export const REEL_TAP_FAIL_TENSION_GAIN = 0.18;

/**
 * script.js `reelTap(x)` — the boss counter-tap variant of the drill (spec 4.7).
 *
 * **UNREACHABLE in the normal game flow.** Bosses are intercepted in state.ts's `STRIKE`
 * transition BEFORE `initReel()` is ever called (`startBossFight()` runs instead — see
 * boss.ts), so `state.boss` is always `false` on every `ReelState` this module produces,
 * and this function's `!state.boss` guard makes it a no-op for every real ReelState.
 * Ported verbatim for fidelity / potential future reactivation, per the spec's explicit
 * instruction ("entweder als totes Feature weglassen, oder bewusst reaktivieren"). NOT
 * called by `updateReel` and NOT wired into any state.ts transition.
 */
export function reelTap_DEAD_BOSS_PATH(state: ReelState, x: number, canvasWidth: number): ReelState {
  if (!state.boss || !state.burst || state.burst.countered) return state;
  const side = x < canvasWidth / 2 ? -1 : 1;
  if (side === -state.burst.dir) {
    return {
      ...state,
      burst: { ...state.burst, countered: true },
      tension: Math.max(0, state.tension - REEL_TAP_TENSION_RELIEF),
      progress: Math.min(1, state.progress + REEL_TAP_PROGRESS_GAIN),
    };
  }
  return {
    ...state,
    tension: Math.min(1, state.tension + REEL_TAP_FAIL_TENSION_GAIN),
    perfect: false,
  };
}
