/**
 * The shape of the drill ("Halten & Loslassen", drill v3) state.
 *
 * Split out from drill.ts so the state machine (state.ts) can compile against the final
 * shape without importing drill.ts's formulas directly. Fields and units follow
 * docs/spec/01-core-loop.md section 4 ("startReeling" / "updateReel" / "reelTap").
 *
 * REVISED by the drill.ts/catch.ts/events.ts/boss.ts port pass: the placeholder shape this
 * file previously held (`fight`, `holding`, `fleeing`, `warning`, `nextFeint`, `elapsed`,
 * `bossDir`) did not match the spec's actual `reel` object field-for-field, so it has been
 * replaced with a shape that mirrors script.js's `startReeling()` object literal (spec 4.1)
 * exactly, one field per original field, camelCased. See drill.ts for the full doc trail.
 */

/** script.js `reel.burst` — an active flee ("ZIEHT!") in progress. Spec 4.2. */
export interface ReelBurst {
  /** seconds elapsed since this burst started. */
  t: number;
  /** total duration of this burst. */
  dur: number;
  /** which way the anchor jumped for this burst. */
  dir: -1 | 1;
  /** boss variant only (dead path, spec 4.7): true once correctly countered. */
  countered: boolean;
}

export interface ReelState {
  /**
   * script.js `reel.boss` — always `false` on every ReelState this port produces:
   * bosses are intercepted in state.ts's `STRIKE` transition BEFORE `initReel()` is ever
   * called (they go to `startBossFight()` / boss.ts instead, per spec 4.1's own note).
   * Kept only so the dead `reelTap` counter-tap path (spec 4.7, drill.ts
   * `reelTap_DEAD_BOSS_PATH`) type-checks against the same shape the original had.
   */
  boss: boolean;
  /** seconds elapsed since `startReeling()`. */
  t: number;
  /** 0..1, how far the fish has been reeled in; 1 = `catchFish()`. */
  progress: number;
  /** 0..1, line tension; reaching 1 snaps the line. */
  tension: number;
  /** highest `progress` ever reached this drill — used for the "So knapp!" near-miss text. */
  maxProgress: number;
  /** highest `tension` ever reached this drill (tracked for parity; not read by any given formula). */
  maxTension: number;
  /** true until `tension` ever exceeds 0.75 (spec 4.5); `perfect && !sp.junk` at catch time. */
  perfect: boolean;

  reelRate: number;
  tensionHold: number;
  tensionBurst: number;
  tensionRelease: number;
  drainRelease: number;

  burst: ReelBurst | null;
  /** seconds until the next flee/feint may trigger (counts down while `!burst`). */
  nextBurst: number;
  /** base interval between flees, fight/onboarding-scaled at init (spec 4.1). */
  burstEvery: number;
  /** seconds of warning ramp before a flee starts (spec 4.2 `r.warn`). */
  warnDur: number;
  /** probability, per flee-timer expiry, that it's a feint instead of a real flee. */
  fakeChance: number;
  /** 0..1 warning ramp toward the next flee (0 while a burst is active). */
  warn: number;
  /** scratch flag for the current flee-decision roll (spec 4.2); null between decisions. */
  fake: boolean | null;

  /**
   * script.js sets `feedbackT: 0, lastResult: null` on the initial reel object but no
   * formula in the given spec text ever reads or updates them again — kept for
   * round-trip fidelity with the original object literal, not driven by any logic here.
   */
  feedbackT: number;
  lastResult: 'good' | 'bad' | null;

  /** x the fish is currently pulling bobberX toward (spec 4.2/4.8). */
  anchorX: number;
  /** hookY at drill start — the fish's rise target lerps from here (spec 4.8). */
  depthY: number;
  /** phase accumulator driving the fish's side-to-side pull motion (spec 4.8). */
  fightPhase: number;
  /** seconds until the next cosmetic jump may trigger (spec 4.8; see drill.ts's ambiguity note). */
  jumpTimer: number;
  /** 0 / 0.4 (feint) / 1 (real flee) — urgency multiplier on the fish-pull amplitude (spec 4.8). */
  dash: number;
  /** seconds since the player last held (spec 4.4 fail condition). */
  idle: number;
  /** script.js `rodBend` — lerped from tension each tick (spec 4.6). Visual, but a pure number. */
  rodBend: number;
}
