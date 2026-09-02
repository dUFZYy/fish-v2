/**
 * cast.ts — cast parabola, wave/float physics, and (dive mode) harpoon
 * projectile physics. Source: `script.js` sections 2.2–2.4 and `dive.js`
 * section 9 of docs/spec/01-core-loop.md.
 *
 * All layout numbers the original read off `canvas.width/height`/`horizonY`/
 * `rod.radius`/`uiScale()` are passed in explicitly here instead of being
 * read from a global — this file never touches `window`/`document`/canvas.
 */

import { clamp, lerp } from './util';
import { CAST_FLIGHT_TIME } from './state';
import type { CastAnim } from './state';

// ---------------------------------------------------------------------------
// Wave function (script.js getWave, spec 2.4 / 11.2)
// ---------------------------------------------------------------------------

/** script.js getWave: primary wave amplitude in px. */
export const WAVE_HEIGHT = 10;
/** script.js getWave: primary wave length in px. */
export const WAVE_LENGTH = 25;
/** script.js getWave: primary wave time coefficient (`time*2`). */
export const WAVE_TIME_COEF = 2;
/** script.js getWave: secondary wave amplitude in px. */
export const WAVE2_AMPLITUDE = 4;
/** script.js getWave: secondary wave length in px. */
export const WAVE2_LENGTH = 90;
/** script.js getWave: secondary wave time coefficient (`time*0.7`, subtracted). */
export const WAVE2_TIME_COEF = 0.7;

/**
 * script.js `getWave(x, phase=0)` — verbatim formula. Takes `time` and
 * `horizonY` as explicit parameters instead of reading module-level globals.
 */
export function getWave(x: number, time: number, horizonY: number, phase = 0): number {
  return (
    horizonY +
    Math.sin(x / WAVE_LENGTH + time * WAVE_TIME_COEF + phase) * WAVE_HEIGHT +
    Math.sin(x / WAVE2_LENGTH - time * WAVE2_TIME_COEF + phase) * WAVE2_AMPLITUDE
  );
}

// ---------------------------------------------------------------------------
// Cast parabola (script.js castTo/updateWorld/landBobber, spec 2.2/2.3)
// ---------------------------------------------------------------------------

/** script.js castTo: clamp margin for a non-ice cast target (`clamp(x,20,W-20)`). */
export const CAST_MIN_X = 20;
/** script.js castTo: minimum depth below the horizon a cast can target. */
export const CAST_DEPTH_MIN_OFFSET = 40;
/** script.js castTo: bottom margin a cast depth is clamped above. */
export const CAST_DEPTH_MAX_MARGIN = 20;
/** script.js castTo (ice mode): fraction of the ice hole's radius the cast x is clamped within. */
export const ICE_HOLE_CAST_CLAMP = 0.55;
/** script.js updateWorld: cast arc height as a fraction of canvas height. */
export const CAST_ARC_HEIGHT_FRAC = 0.22;
/** script.js updateWorld: weight of the eased term in the x blend (`easeOut(t)*0.7`). */
export const CAST_EASE_WEIGHT = 0.7;
/** script.js updateWorld: weight of the linear term in the x blend (`t*0.3`). */
export const CAST_LINEAR_WEIGHT = 0.3;
/** script.js landBobber: vertical offset of the hook below the landed bobber. */
export const HOOK_LAND_OFFSET_Y = 10;
/** script.js: hook sink-to-target-depth lerp rate (`lerp(hookY, hookTargetY, dt*2.5)`). */
export const HOOK_SINK_LERP_RATE = 2.5;

/** script.js `easeOut(t) = 1 - (1-t)^3`. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface CastBounds {
  horizonY: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface IceHoleTarget {
  x: number;
  rx: number;
}

/**
 * script.js `castTo(x, y)` — builds the CastAnim. Does not check
 * `gameState === "ready"` (that guard lives in state.ts's `transition`).
 */
export function castTo(
  rodTipX: number,
  rodTipY: number,
  targetX: number,
  targetY: number,
  bounds: CastBounds,
  iceHole?: IceHoleTarget,
): CastAnim {
  const tx = iceHole
    ? clamp(targetX, iceHole.x - iceHole.rx * ICE_HOLE_CAST_CLAMP, iceHole.x + iceHole.rx * ICE_HOLE_CAST_CLAMP)
    : clamp(targetX, CAST_MIN_X, bounds.canvasWidth - CAST_MIN_X);
  const depth = clamp(targetY, bounds.horizonY + CAST_DEPTH_MIN_OFFSET, bounds.canvasHeight - CAST_DEPTH_MAX_MARGIN);
  return { t: 0, x0: rodTipX, y0: rodTipY, x1: tx, depth };
}

export interface CastAnimTickResult {
  anim: CastAnim;
  bobberX: number;
  bobberY: number;
  landed: boolean;
}

/**
 * script.js updateWorld's per-frame cast-anim update. `t >= 1` signals the
 * caller should follow up with `landBobber()` and a `LAND_BOBBER` event.
 */
export function tickCastAnim(anim: CastAnim, dt: number, time: number, horizonY: number, canvasHeight: number): CastAnimTickResult {
  const t = clamp(anim.t + dt / CAST_FLIGHT_TIME, 0, 1);
  const nextAnim: CastAnim = { ...anim, t };
  const blend = easeOutCubic(t) * CAST_EASE_WEIGHT + t * CAST_LINEAR_WEIGHT;
  const bobberX = lerp(anim.x0, anim.x1, blend);
  const targetY = getWave(anim.x1, time, horizonY);
  const bobberY = lerp(anim.y0, targetY, t) - Math.sin(t * Math.PI) * canvasHeight * CAST_ARC_HEIGHT_FRAC;
  return { anim: nextAnim, bobberX, bobberY, landed: t >= 1 };
}

export interface LandedBobber {
  bobberX: number;
  bobberY: number;
  hookX: number;
  hookY: number;
  hookTargetY: number;
}

/** script.js `landBobber()` — snaps the bobber to its resting spot on the wave. */
export function landBobber(anim: CastAnim, time: number, horizonY: number): LandedBobber {
  const bobberX = anim.x1;
  const bobberY = getWave(bobberX, time, horizonY);
  return {
    bobberX,
    bobberY,
    hookX: bobberX,
    hookY: bobberY + HOOK_LAND_OFFSET_Y,
    hookTargetY: anim.depth,
  };
}

export interface FloatTick {
  bobberY: number;
  hookX: number;
  hookY: number;
}

/**
 * script.js per-frame float physics during `waiting`/`biting` (NOT
 * `reeling`, where the fish overrides bobber/hook position — see drill.ts).
 */
export function tickFloat(bobberX: number, hookY: number, hookTargetY: number, time: number, horizonY: number, dt: number): FloatTick {
  return {
    bobberY: getWave(bobberX, time, horizonY),
    hookX: bobberX,
    hookY: lerp(hookY, hookTargetY, dt * HOOK_SINK_LERP_RATE),
  };
}

// ---------------------------------------------------------------------------
// Fish flee-on-land (script.js landBobber effects, spec 2.3)
// ---------------------------------------------------------------------------

/** script.js landBobber: distance under which a roaming fish flees the landing splash. */
export const FLEE_ON_LAND_RADIUS = 70;
/** script.js landBobber: horizontal-only flee distance when the fish is shallower than the target depth. */
export const FLEE_ON_LAND_DX = 40;

/**
 * script.js: "jeder Fisch im Zustand roam, dessen Distanz zum Landepunkt <
 * 70*uiScale() ist, ODER |dx|<40*uiScale() && f.y<hookTargetY, wechselt zu
 * fleeing". Landing directly ON a fish does NOT catch it — it scares it off.
 */
export function fishFleesOnLand(
  fishX: number,
  fishY: number,
  landX: number,
  landY: number,
  hookTargetY: number,
  uiScale: number,
): boolean {
  const dist = Math.hypot(fishX - landX, fishY - landY);
  const dx = Math.abs(fishX - landX);
  return dist < FLEE_ON_LAND_RADIUS * uiScale || (dx < FLEE_ON_LAND_DX * uiScale && fishY < hookTargetY);
}

// ---------------------------------------------------------------------------
// Dive mode: harpoon charge, range, flight, hit test (dive.js, spec 9)
// ---------------------------------------------------------------------------

/** dive.js: minimum charge fraction even for an instant tap-release (`clamp(t/0.85, 0.25, 1)`). */
/** seconds of holding until the harpoon is fully charged (dive.js: clamp(c.t / 0.85, ...)) */
export const HARPOON_CHARGE_TIME = 0.85;

export const HARPOON_CHARGE_MIN = 0.25;
/** dive.js harpoonRange: base reach factor. */
export const HARPOON_RANGE_BASE_FACTOR = 0.55;
/** dive.js harpoonRange: additional reach per point of `rod.radius`. */
export const HARPOON_RANGE_ROD_FACTOR = 0.5;
/** dive.js harpoonRange: minimum reach fraction at zero charge. */
export const HARPOON_RANGE_CHARGE_BASE = 0.6;
/** dive.js harpoonRange: additional reach fraction from full charge. */
export const HARPOON_RANGE_CHARGE_FACTOR = 0.4;
/** dive.js updateHarpoon: base flight speed factor (of max(canvasWidth,canvasHeight)). */
export const HARPOON_SPEED_BASE_FACTOR = 0.85;
/** dive.js updateHarpoon: additional flight speed factor from charge. */
export const HARPOON_SPEED_CHARGE_FACTOR = 0.95;
/** dive.js updateHarpoon: retract speed multiplier relative to flight speed. */
export const HARPOON_RETRACT_SPEED_MULT = 1.6;
/** dive.js updateHarpoon hit test: fraction of the fish's on-screen unit size counted as a hit. */
export const HARPOON_HIT_FISH_FACTOR = 0.55;
/** dive.js updateHarpoon hit test: flat px bonus added to the hit radius. */
export const HARPOON_HIT_RADIUS_BONUS = 6;

export interface HarpoonCharge {
  t: number;
  x: number;
  y: number;
}

export interface HarpoonState {
  dx: number;
  dy: number;
  dist: number;
  max: number;
  charge: number;
  x: number;
  y: number;
  angle: number;
  t: number;
  state: 'fly' | 'back';
}

/** dive.js `releaseCharge()`'s charge-fraction computation. */
export function chargeFraction(chargeTime: number): number {
  return clamp(chargeTime / HARPOON_CHARGE_TIME, HARPOON_CHARGE_MIN, 1);
}

/** dive.js `harpoonRange(charge)`. `bottomBarY` is the HUD bottom edge (11.4). */
export function harpoonRange(canvasWidth: number, horizonY: number, bottomBarY: number, rodRadius: number, charge: number): number {
  const reach = Math.hypot(canvasWidth, bottomBarY - horizonY);
  return reach * (HARPOON_RANGE_BASE_FACTOR + rodRadius * HARPOON_RANGE_ROD_FACTOR) * (HARPOON_RANGE_CHARGE_BASE + HARPOON_RANGE_CHARGE_FACTOR * clamp(charge, 0, 1));
}

/** dive.js `shootHarpoon(tx,ty,charge)` — builds the flying HarpoonState. */
export function shootHarpoon(hx: number, hy: number, tx: number, ty: number, charge: number, range: number): HarpoonState {
  const rawDx = tx - hx;
  const rawDy = ty - hy;
  const d = Math.hypot(rawDx, rawDy) || 1;
  const dx = rawDx / d;
  const dy = rawDy / d;
  return { dx, dy, dist: 0, max: range, charge, x: hx, y: hy, angle: Math.atan2(rawDy, rawDx), t: 0, state: 'fly' };
}

function harpoonSpeed(canvasWidth: number, canvasHeight: number, charge: number): number {
  return Math.max(canvasWidth, canvasHeight) * (HARPOON_SPEED_BASE_FACTOR + HARPOON_SPEED_CHARGE_FACTOR * charge);
}

export interface HarpoonTick {
  harpoon: HarpoonState;
  /** true once the harpoon has fully retracted (dist<=0) after a miss — HARPOON_RETURNED. */
  returned: boolean;
}

/** dive.js `updateHarpoon(dt)`, minus the fish hit test (see `harpoonHitTest`). */
export function tickHarpoon(h: HarpoonState, dt: number, hx: number, hy: number, canvasWidth: number, canvasHeight: number, horizonY: number): HarpoonTick {
  const speed = harpoonSpeed(canvasWidth, canvasHeight, h.charge);
  if (h.state === 'fly') {
    const dist = h.dist + speed * dt;
    const x = hx + h.dx * dist;
    const y = hy + h.dy * dist;
    if (dist >= h.max || y > canvasHeight || y < horizonY) {
      return { harpoon: { ...h, dist, x, y, state: 'back' }, returned: false };
    }
    return { harpoon: { ...h, dist, x, y }, returned: false };
  }
  const dist = Math.max(0, h.dist - speed * HARPOON_RETRACT_SPEED_MULT * dt);
  const x = hx + h.dx * dist;
  const y = hy + h.dy * dist;
  return { harpoon: { ...h, dist, x, y }, returned: dist <= 0 };
}

/** dive.js updateHarpoon hit test: "erster Fisch auf der Bahn (nicht fleeing/caught)". */
export function harpoonHitTest(h: HarpoonState, fishX: number, fishY: number, fishUnit: number): boolean {
  return Math.hypot(fishX - h.x, fishY - h.y) < fishUnit * HARPOON_HIT_FISH_FACTOR + HARPOON_HIT_RADIUS_BONUS;
}
