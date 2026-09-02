/**
 * state.ts — the main fishing-spot state machine.
 *
 * Source: `script.js` (`gameState`, the transition table in section 1.3 of
 * docs/spec/01-core-loop.md) plus `dive.js` for the `shooting` state and
 * `bossfight.js` only insofar as the OUTER transitions into/out of
 * `bossfight` are concerned (the internal boss-move minigame of section 8 is
 * out of scope for this port pass — see the note on `BossFightStub` below).
 *
 * This module owns:
 *  - the `GamePhase` union (identical to the original `gameState` strings)
 *  - the `GameState` record (every field the original kept as loose globals,
 *    collected into one object; every timer is a named field with the
 *    spec's literal starting value)
 *  - `createInitialState()`
 *  - `transition(state, event)` — one explicit, exhaustive function for the
 *    discrete transitions of the diagram in spec section 1.3.
 *
 * Per-frame continuous physics (cast parabola, wave, float sink, reel
 * tension/progress, harpoon flight) live in cast.ts / drill.ts and are
 * called by whatever composes this module into a game loop; they are NOT
 * duplicated here so each formula has exactly one home.
 *
 * A note on "aiming": the spec's `gameState` union
 * (`"ready"|"casting"|"waiting"|"biting"|"reeling"|"caught"|"retrieving"|
 * "bossfight"|"shooting"`) has no `"aiming"` phase. Charging the harpoon
 * (`startCharge`/`aimCharge`) happens entirely while `gameState` stays
 * `"ready"` (section 9.2) — only the release transitions to `"shooting"`.
 * So "aiming" is represented here as `harpoonCharge !== null` while
 * `phase === 'ready'`, not as a separate phase, to stay faithful to the
 * original's literal state values.
 */

// TODO(E1): drill.ts is not ported yet. The structural type it will export is
// declared here so the state machine already compiles against the final shape.
import type { ReelState } from './drillTypes';
import type { HarpoonState, HarpoonCharge } from './cast';

// ---------------------------------------------------------------------------
// Fish / species shapes — the minimal fields the game/ formulas need. The
// full species database (src/data) is out of scope here; these are the
// structural types bite.ts / drill.ts / catch.ts operate on.
// ---------------------------------------------------------------------------

export type RarityId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface FishSpecies {
  id: string;
  rarity: RarityId;
  value: number;
  kg: readonly [number, number];
  depth: readonly [number, number];
  fight: number;
  speed: number;
  /** fish.js SPECIES[].len — used by the predator/prey bonus catch (catch.ts). */
  len?: number;
  loc: readonly string[];
  night?: boolean;
  junk?: boolean;
  boss?: boolean;
}

export type FishBehaviorState = 'roam' | 'attracted' | 'biting' | 'hooked' | 'fleeing' | 'caught';

export interface FishInstance {
  id: number;
  species: FishSpecies;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** fish.js: `f.scale = rand(0.8, 1.3)`, fixed at spawn. */
  scale: number;
  state: FishBehaviorState;
  shiny?: boolean;
}

// ---------------------------------------------------------------------------
// Timers & other named constants (spec section 1.3 table + scattered refs)
// ---------------------------------------------------------------------------

/** script.js BITE_WINDOW — seconds to strike after a bite starts (1.3, 3.5). */
export const BITE_WINDOW = 1.8;

/** script.js DAY_LENGTH — seconds for one full day/night cycle (1.3, 6.3). */
export const DAY_LENGTH = 300;

/** script.js castAnim: `castAnim.t += dt/0.75` — cast flight duration (2.2). */
export const CAST_FLIGHT_TIME = 0.75;

/** script.js retrieveAnim: `retrieveAnim.t += dt/0.4` — retrieve anim duration (1.3). */
export const RETRIEVE_ANIM_TIME = 0.4;

/** script.js SONAR_CD — echo-sounder cooldown, boat mode only (1.3). */
export const SONAR_CD = 14;

/** script.js SONAR_DUR — echo-sounder active duration, boat mode only (1.3). */
export const SONAR_DUR = 3.6;

/** cutscene.js CUTSCENE_DUR — boss arrival cutscene duration (1.3, 8.11). */
export const CUTSCENE_DUR = 4.2;

/** ads.js Ads.rescue.dur — window to accept the streak-rescue offer (1.3, 5.10). */
export const AD_RESCUE_WINDOW = 4.5;

/** script.js: ice hole freeze rate per second, only while gameState==="ready" (1.3). */
export const ICE_FREEZE_RATE = -0.018;

/** script.js: ice hole chop gain per tap, via chopIceHole() (1.3). */
export const ICE_CHOP_GAIN = 0.26;

/** script.js ICE_MIN — freeze level that blocks casting until chopped free (1.3). */
export const ICE_MIN = 0.42;

/** script.js reef snag: taps required to free the hook (1.3, `need: 5`). */
export const REEF_SNAG_TAPS = 5;

/** script.js: harpoon charge-to-full-power time, dive.js section 9.2. */
export const HARPOON_CHARGE_TIME = 0.85;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type GamePhase =
  | 'ready'
  | 'casting'
  | 'waiting'
  | 'biting'
  | 'reeling'
  | 'caught'
  | 'retrieving'
  | 'bossfight'
  | 'shooting';

export interface CastAnim {
  t: number;
  x0: number;
  y0: number;
  x1: number;
  depth: number;
}

export interface RetrieveAnim {
  t: number;
}

export interface SnagState {
  need: number;
  progress: number;
}

/**
 * The internal boss-move minigame (bossfight.js, spec section 8) is not
 * ported by these six files — only the outer entry/exit transitions
 * (biting -> bossfight -> caught/retrieving) are. This stub carries just
 * enough state for `transition()` to model those outer edges; a full port
 * of moves/tells/damage tables would live in its own module.
 */
export interface BossFightStub {
  fish: FishInstance;
  stamina: number;
  line: number;
  flawless: boolean;
}

export interface GameState {
  phase: GamePhase;

  /** World time (script.js `time`) — stands still while worldPaused(). */
  time: number;
  /** Surface/UI time (script.js `uiTime`) — always runs. */
  uiTime: number;
  /** 0..1 fraction of the day/night cycle (script.js `dayTime`). */
  dayTime: number;

  waitTime: number;
  biteTimer: number;

  castAnim: CastAnim | null;
  retrieveAnim: RetrieveAnim | null;

  bobberX: number;
  bobberY: number;
  hookX: number;
  hookY: number;
  hookInWater: boolean;
  hookTargetY: number;

  bitingFish: FishInstance | null;
  hookedFish: FishInstance | null;
  reel: ReelState | null;
  bossFight: BossFightStub | null;

  harpoonCharge: HarpoonCharge | null;
  harpoon: HarpoonState | null;

  snag: SnagState | null;
  iceFreeze: number;

  streak: number;
  isHolding: boolean;
}

export function createInitialState(): GameState {
  return {
    phase: 'ready',
    time: 0,
    uiTime: 0,
    dayTime: 0,
    waitTime: 0,
    biteTimer: 0,
    castAnim: null,
    retrieveAnim: null,
    bobberX: 0,
    bobberY: 0,
    hookX: 0,
    hookY: 0,
    hookInWater: false,
    hookTargetY: 0,
    bitingFish: null,
    hookedFish: null,
    reel: null,
    bossFight: null,
    harpoonCharge: null,
    harpoon: null,
    snag: null,
    iceFreeze: 0,
    streak: 0,
    isHolding: false,
  };
}

// ---------------------------------------------------------------------------
// Explicit transitions (spec section 1.3 table)
// ---------------------------------------------------------------------------

export type GameEvent =
  /** ready -> casting: castTo() (2.2). Caller has already computed the CastAnim (cast.ts castTo()). */
  | { type: 'CAST'; anim: CastAnim }
  /** casting -> waiting: castAnim.t >= 1, landBobber() (2.3). Caller supplies the landed bobber/hook fields (cast.ts landBobber()). */
  | { type: 'LAND_BOBBER'; bobberX: number; bobberY: number; hookX: number; hookY: number; hookTargetY: number }
  /** waiting -> biting: fish reaches the hook, startBite(f) (3.4). */
  | { type: 'FISH_REACHES_HOOK'; fish: FishInstance }
  /** waiting -> retrieving: another tap into the water (1.3 table). */
  | { type: 'RETRIEVE_TAP' }
  /** biting -> reeling | bossfight: tap/space within BITE_WINDOW (1.3, 4.1). */
  | { type: 'STRIKE'; reel?: ReelState }
  /** biting -> retrieving: biteTimer <= 0, fishEscapes("Entwischt!") (3.5). */
  | { type: 'BITE_TIMEOUT' }
  /** reeling -> caught: reel.progress >= 1, catchFish() (4.4). */
  | { type: 'REEL_COMPLETE' }
  /** reeling -> retrieving: reel.tension >= 1 (line snaps) or shaken off (4.4). */
  | { type: 'REEL_FAILED'; reason: 'lineSnapped' | 'shakenOff' }
  /** bossfight -> caught: stamina <= 0, winBossFight() (8.8). */
  | { type: 'BOSS_WON' }
  /** bossfight -> retrieving: line <= 0, loseBossFight() (8.8). */
  | { type: 'BOSS_LOST' }
  /** caught -> retrieving: tap/space, catchInfo.t >= 0.4s, finishCatch() (1.3). */
  | { type: 'FINISH_CATCH' }
  /** retrieving -> ready: retrieveAnim.t >= 1, automatic (1.3). */
  | { type: 'RETRIEVE_ANIM_DONE' }
  /** ready -> shooting: pointerup after startCharge(), releaseCharge()->shootHarpoon() (9.2). */
  | { type: 'SHOOT_HARPOON'; harpoon: HarpoonState }
  /** shooting -> biting (then immediately reeling): harpoon hits a fish, harpoonHit() (9.5). biteTimer is forced to 99 ("practically unlimited"). */
  | { type: 'HARPOON_HIT'; fish: FishInstance }
  /** shooting -> ready: harpoon missed and fully retracted (dist<=0) (9.4). */
  | { type: 'HARPOON_RETURNED' };

/** harpoonHit() sets `biteTimer = 99` — "practically unbounded" (9.5). */
export const HARPOON_HIT_BITE_TIMER = 99;

/**
 * transition() — the single explicit state-machine function.
 *
 * It is intentionally narrow: it only moves `phase` and the small set of
 * fields the transition itself defines (per the table in spec 1.3). Continuous
 * per-frame updates (waitTime += dt, biteTimer -= dt, castAnim/reel physics)
 * are NOT applied here — they are the job of cast.ts's / drill.ts's own
 * update functions, called by the composing game loop each frame; this
 * function only reacts to the discrete events those updates produce.
 *
 * Unhandled event/phase combinations return `state` unchanged (mirrors the
 * original's guard clauses, e.g. `if (gameState !== "ready") return;`).
 */
export function transition(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'CAST':
      if (state.phase !== 'ready') return state;
      return { ...state, phase: 'casting', castAnim: event.anim, hookInWater: false };

    case 'LAND_BOBBER':
      if (state.phase !== 'casting') return state;
      return {
        ...state,
        phase: 'waiting',
        castAnim: null,
        waitTime: 0,
        bobberX: event.bobberX,
        bobberY: event.bobberY,
        hookX: event.hookX,
        hookY: event.hookY,
        hookInWater: true,
        hookTargetY: event.hookTargetY,
      };

    case 'FISH_REACHES_HOOK':
      if (state.phase !== 'waiting') return state;
      return {
        ...state,
        phase: 'biting',
        bitingFish: event.fish,
        biteTimer: BITE_WINDOW,
      };

    case 'RETRIEVE_TAP':
      if (state.phase !== 'waiting') return state;
      return { ...state, phase: 'retrieving', retrieveAnim: { t: 0 } };

    case 'STRIKE': {
      if (state.phase !== 'biting' || !state.bitingFish) return state;
      const isBoss = !!state.bitingFish.species.boss;
      if (isBoss) {
        // sp.boss === true: startBossFight(bitingFish) instead of the normal drill (4.1).
        return {
          ...state,
          phase: 'bossfight',
          hookedFish: state.bitingFish,
          bitingFish: null,
          bossFight: { fish: state.bitingFish, stamina: 1, line: 1, flawless: true },
          isHolding: false,
        };
      }
      return {
        ...state,
        phase: 'reeling',
        hookedFish: { ...state.bitingFish, state: 'hooked' },
        bitingFish: null,
        reel: event.reel ?? state.reel,
        isHolding: false,
      };
    }

    case 'BITE_TIMEOUT':
      if (state.phase !== 'biting') return state;
      return resetToRetrieving(state);

    case 'REEL_COMPLETE':
      if (state.phase !== 'reeling') return state;
      return { ...state, phase: 'caught', reel: state.reel };

    case 'REEL_FAILED':
      if (state.phase !== 'reeling') return state;
      return resetToRetrieving(state);

    case 'BOSS_WON':
      if (state.phase !== 'bossfight') return state;
      return { ...state, phase: 'caught' };

    case 'BOSS_LOST':
      if (state.phase !== 'bossfight') return state;
      return resetToRetrieving(state);

    case 'FINISH_CATCH':
      if (state.phase !== 'caught') return state;
      return { ...state, phase: 'retrieving', retrieveAnim: { t: 0 } };

    case 'RETRIEVE_ANIM_DONE':
      if (state.phase !== 'retrieving') return state;
      return {
        ...state,
        phase: 'ready',
        retrieveAnim: null,
        hookedFish: null,
        bitingFish: null,
        reel: null,
        bossFight: null,
      };

    case 'SHOOT_HARPOON':
      if (state.phase !== 'ready') return state;
      return { ...state, phase: 'shooting', harpoon: event.harpoon, harpoonCharge: null };

    case 'HARPOON_HIT':
      if (state.phase !== 'shooting') return state;
      // harpoonHit(): bobber/hook snap to the fish, biteTimer=99, then startReeling()
      // is called immediately (9.5) — modelled here as landing directly in 'biting'
      // with the forced timer; the caller follows up with a STRIKE event using the
      // same rng-free path startReeling() would take (drill.ts initReel, or the
      // bossfight branch above if the harpooned fish is a boss).
      return {
        ...state,
        phase: 'biting',
        bitingFish: event.fish,
        biteTimer: HARPOON_HIT_BITE_TIMER,
        harpoon: null,
        bobberX: event.fish.x,
        hookX: event.fish.x,
        hookY: event.fish.y,
      };

    case 'HARPOON_RETURNED':
      if (state.phase !== 'shooting') return state;
      return { ...state, phase: 'ready', harpoon: null };

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function resetToRetrieving(state: GameState): GameState {
  return {
    ...state,
    phase: 'retrieving',
    retrieveAnim: { t: 0 },
    bitingFish: null,
    hookedFish: null,
    reel: null,
    bossFight: null,
    isHolding: false,
  };
}
