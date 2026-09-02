/**
 * `artFor(loc)` — the SceneArt adapter for all six locations.
 *
 * Same role as `game/lake.ts`'s `lakeArt(loc)`, generalised: the scene never
 * imports a location's art directly (`world/scene.ts`), it asks this module
 * for a `SceneArt` and gets back whichever location is active. `see` is
 * delegated to the existing `lakeArt` (its scenery lives in `bake/lakeArt.ts`,
 * owned elsewhere); the other five delegate to `bake/boatArt.ts`,
 * `bake/coastArt.ts`, `bake/reefArt.ts`, `bake/deepArt.ts`, `bake/arcticArt.ts`
 * respectively (`riff` reuses `boatArt`'s boat rig — spec §1: "same boat rig
 * as Boot" — only its far/seabed differ, from `reefArt`).
 *
 * === Sky phase: shared with lake.ts, not duplicated =========================
 *
 * `lakeArt.ts`'s `paletteForLight` resolves ambiguous `light` values (0.5
 * happens at both dawn and dusk, with different hues) against a module-level
 * `currentPhase`, fed once a frame via `setSkyPhase(dayTime)`. That state is
 * private to `game/lake.ts` (not exported) and this module must not edit
 * that file — so `setSkyPhase` below keeps its OWN `currentPhase` for the
 * five locations here, but also calls through to `game/lake.ts`'s exported
 * `setSkyPhase`, so a caller only ever needs to call ONE function (this
 * one) to keep every location's day/night colour in sync. Whoever wires up
 * `session.ts`'s per-frame update should call `setSkyPhase` FROM THIS FILE,
 * not from `game/lake.ts` directly.
 */

import type { SceneArt, BakeFn } from '@/world/scene';
import { getPalette, hexToRgb, type Palette } from '@/bake/palette';
import { drawSkyStrip } from '@/bake/lakeArt';
import { baker, Baker } from '@/bake/baker';
import { layout } from '@/engine/layout';
import { Sprite } from 'pixi.js';
import { getLocationById, type Location } from '@/data/locations';

import { lakeArt, setSkyPhase as setLakeSkyPhase } from './lake';

import * as boatArt from '@/bake/boatArt';
import * as coastArt from '@/bake/coastArt';
import * as reefArt from '@/bake/reefArt';
import * as deepArt from '@/bake/deepArt';
import * as arcticArt from '@/bake/arcticArt';

let currentPhase = 0.5;

/** Call once a frame with the current `dayTime` (0..1). Keeps `game/lake.ts` in sync too. */
export function setSkyPhase(dayTime: number): void {
  currentPhase = dayTime;
  setLakeSkyPhase(dayTime);
}

function paletteForLight(light: number, loc: Location): Palette {
  const pal = getPalette(currentPhase, loc);
  return light === pal.light ? pal : { ...pal, light };
}

function rgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

/**
 * Generic sky+water gradient strip, shared by every non-lake, non-deep-sea
 * location — the sky/water split is the same shape everywhere, only the
 * colours (`pal`) differ. Reuses `lakeArt.ts`'s exported `drawSkyStrip`
 * (importing it is fine; only editing that file isn't).
 */
function genericGradient(loc: Location) {
  return (light: number, horizonFrac: number): BakeFn => {
    const pal = paletteForLight(light, loc);
    return (ctx, w, h) => drawSkyStrip(ctx, w, h, pal, horizonFrac);
  };
}

export const LOCATIONS_BY_ID = {
  see: getLocationById('see')!,
  boot: getLocationById('boot')!,
  kueste: getLocationById('kueste')!,
  riff: getLocationById('riff')!,
  tiefsee: getLocationById('tiefsee')!,
  arktis: getLocationById('arktis')!,
};

// ============================================================================
// boot (Ruderboot · Seemitte)
// ============================================================================

function boatSceneArt(loc: Location): SceneArt {
  return {
    id: `boat:${loc.id}`,
    gradient: (light, horizonFrac) => genericGradient(loc)(light, horizonFrac),
    far: (light) => (ctx, w, h) => boatArt.drawFarScenery(ctx, w, h, light),
    seabed: (light) => (ctx, w, h) => boatArt.drawSeabed(ctx, w, h, light),
    waterTop: (light) => rgb01(paletteForLight(light, loc).wTop),
    waterBottom: (light) => rgb01(paletteForLight(light, loc).wBot),
    // Measured (dev/locations.html, union across day/dusk/night): far ink at
    // y 0.29..0.36, seabed at y 0.81..1.00. Padded by ~0.01 for safety.
    bands: {
      far: { y: 0.28, h: 0.09 },
      seabed: { y: 0.80, h: 0.20 },
    },
    deepSea: false,
  };
}

// ============================================================================
// kueste (Küste)
// ============================================================================

function coastSceneArt(loc: Location): SceneArt {
  return {
    id: `coast:${loc.id}`,
    gradient: (light, horizonFrac) => genericGradient(loc)(light, horizonFrac),
    far: (light) => (ctx, w, h) => coastArt.drawFarScenery(ctx, w, h, light),
    seabed: (light) => (ctx, w, h) => coastArt.drawSeabed(ctx, w, h, light),
    waterTop: (light) => rgb01(paletteForLight(light, loc).wTop),
    waterBottom: (light) => rgb01(paletteForLight(light, loc).wBot),
    // Measured: far ink at y 0.22..0.36, seabed at y 0.81..1.00.
    bands: {
      far: { y: 0.21, h: 0.16 },
      seabed: { y: 0.80, h: 0.20 },
    },
    deepSea: false,
  };
}

// ============================================================================
// riff (Korallenriff) — same boat rig as boot
// ============================================================================

function reefSceneArt(loc: Location): SceneArt {
  return {
    id: `reef:${loc.id}`,
    gradient: (light, horizonFrac) => genericGradient(loc)(light, horizonFrac),
    far: (light) => (ctx, w, h) => reefArt.drawFarScenery(ctx, w, h, light),
    seabed: (light) => (ctx, w, h) => reefArt.drawSeabed(ctx, w, h, light),
    waterTop: (light) => rgb01(paletteForLight(light, loc).wTop),
    waterBottom: (light) => rgb01(paletteForLight(light, loc).wBot),
    // Measured: far ink at y 0.33..0.35 (a thin sliver — sand bank + hazy
    // islands, all just below the horizon), seabed at y 0.81..1.00.
    bands: {
      far: { y: 0.32, h: 0.04 },
      seabed: { y: 0.80, h: 0.20 },
    },
    deepSea: false,
  };
}

// ============================================================================
// tiefsee (Tiefsee) — deep sea: no horizon, whole screen is water
// ============================================================================

const DEEPSEA_HORIZON_FRAC = 0.05;

function deepSceneArt(loc: Location): SceneArt {
  return {
    id: `deep:${loc.id}`,
    // The old game fills the WHOLE canvas with one 4-stop gradient here
    // (no sky/water split). `drawSkyStrip` only has a 2-stop sky + 2-stop
    // water shape, but pushing its horizon almost to the top (0.05, matching
    // the old `horizonY = H*0.05`) reproduces the same read: a thin band of
    // `pal.top/bot` right at the top, then `pal.wTop -> pal.wBot` (already
    // darkened toward `loc.water` by `applyLocationTint`, per palette.ts)
    // filling the rest — a documented simplification, not a byte-for-byte
    // copy of the old 4-stop gradient.
    gradient: (light) => {
      const pal = paletteForLight(light, loc);
      return (ctx, w, h) => drawSkyStrip(ctx, w, h, pal, DEEPSEA_HORIZON_FRAC);
    },
    far: (light) => (ctx, w, h) => deepArt.drawFarScenery(ctx, w, h, light),
    seabed: (light) => (ctx, w, h) => deepArt.drawSeabed(ctx, w, h, light),
    waterTop: (light) => rgb01(paletteForLight(light, loc).wTop),
    waterBottom: (light) => rgb01(paletteForLight(light, loc).wBot),
    // Measured: far ink at y 0.37..1.00 (the canyon walls deliberately reach
    // the bottom edge — same ~0.6H region the old game's own `drawDeepFar`
    // bake used, `0, H*0.45, W, H*0.6`), seabed at y 0.73..1.00 (the smoker
    // chimneys reach well above the floor itself).
    bands: {
      far: { y: 0.36, h: 0.64 },
      seabed: { y: 0.72, h: 0.28 },
    },
    deepSea: true,
  };
}

// ============================================================================
// arktis (Eisloch · Arktis)
// ============================================================================

function arcticSceneArt(loc: Location): SceneArt {
  return {
    id: `arctic:${loc.id}`,
    gradient: (light, horizonFrac) => genericGradient(loc)(light, horizonFrac),
    far: (light) => (ctx, w, h) => arcticArt.drawFarScenery(ctx, w, h, light),
    near: (light) => (ctx, w, h) => arcticArt.drawNearScenery(ctx, w, h, light),
    seabed: (light) => (ctx, w, h) => arcticArt.drawSeabed(ctx, w, h, light),
    waterTop: (light) => rgb01(paletteForLight(light, loc).wTop),
    waterBottom: (light) => rgb01(paletteForLight(light, loc).wBot),
    // Measured: far (icebergs) at y 0.27..0.36, near (ice sheet) at y
    // 0.36..0.50, seabed at y 0.50..1.00 (the icicles hang from just under
    // the ice band, well above the floor rocks — one wide band covers both).
    bands: {
      far: { y: 0.26, h: 0.11 },
      near: { y: 0.35, h: 0.16 },
      seabed: { y: 0.49, h: 0.51 },
    },
    deepSea: false,
    // Water effects only start below the ice's physical underside — an open
    // wave line drawn through solid ice was one of the old shader's bugs
    // (docs/spec/03-world-visuals.md §3, "Ice lid"). Same seam `arcticArt`'s
    // `drawNearScenery` bakes its waterline band against.
    lid: (h) => arcticArt.iceBand(h).bot,
    // No open wave line under the ice, so no wave-band tint and no foam.
    fx: { bands: 0, foam: 0 },
  };
}

// ============================================================================
// artFor — the one entry point the scene uses
// ============================================================================

export function artFor(loc: Location): SceneArt {
  switch (loc.id) {
    case 'see': return lakeArt(loc);
    case 'boot': return boatSceneArt(loc);
    case 'kueste': return coastSceneArt(loc);
    case 'riff': return reefSceneArt(loc);
    case 'tiefsee': return deepSceneArt(loc);
    case 'arktis': return arcticSceneArt(loc);
    default: return lakeArt(loc);
  }
}

// ============================================================================
// Own-box props — composed against their own box, never the screen (see
// `game/lake.ts`'s `makeDock` for the pattern and why it exists).
// ============================================================================

/** The boat: 3 layered sprites (underwater hull, topside, front), shared by `boot` and `riff`. */
export const BOAT_W_FRAC = 0.58;
export const BOAT_H = 150;

export interface BoatSprites {
  /** before the water pass */
  underwater: Sprite;
  /** after the water pass, before the angler */
  topside: Sprite;
  /** after the angler */
  front: Sprite;
  /** the box-local y that sits ON the waterline — the scene's live bob/heel
   *  transform should pivot/translate around this point, not (0,0). */
  originY: number;
}

export function makeBoat(horizonY: number, light: number): BoatSprites {
  const step = Baker.lightStep(light);
  const w = Math.round(layout.W * BOAT_W_FRAC);
  const h = BOAT_H;
  const { originY } = boatArt.boatDims(w, h);

  const build = (name: string, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, l: number) => void): Sprite => {
    const key = `boat:${name}:${w}x${h}:l${step}@${layout.dpr}`;
    const e = baker.bakeScenery(key, w, h, (ctx, cw, ch) => draw(ctx, cw, ch, Baker.lightOf(step)));
    const s = new Sprite(e.texture);
    s.setSize(w, h);
    s.x = (layout.W - w) / 2;
    s.y = horizonY - originY;
    return s;
  };

  return {
    underwater: build('uw', boatArt.drawBoatUnderwater),
    topside: build('top', boatArt.drawBoatTopside),
    front: build('front', boatArt.drawBoatFront),
    originY,
  };
}

/** The stone pier deck + bollard + lighthouse, own box. */
export const PIER_H = 260;
export const PIER_W_FRAC = 0.5;

export function makePier(horizonY: number, light: number): Sprite {
  const step = Baker.lightStep(light);
  const w = Math.round(layout.W * PIER_W_FRAC);
  const h = PIER_H;
  const key = `pier:${w}x${h}:l${step}@${layout.dpr}`;
  const e = baker.bakeScenery(key, w, h, (ctx, cw, ch) => coastArt.drawPier(ctx, cw, ch, Baker.lightOf(step)));
  const s = new Sprite(e.texture);
  s.setSize(w, h);
  s.x = layout.W - w;
  // deckY (box-local) is 5/6 of the box height — see coastArt.drawPier. The
  // deck's TOP edge sits 20px above the horizon, same convention `makeDock`
  // (game/lake.ts) uses for its plank line.
  const deckY = (5 / 6) * h;
  s.y = horizonY - 20 - deckY;
  return s;
}

/** World y of the pier deck's BOTTOM edge — where the submerged footing (`makePierUnderwater`) begins. */
export function pierDeckBottom(horizonY: number): number {
  return horizonY - 20 + PIER_H / 6;
}

/** The submerged pier footing, own box — a separate sprite, drawn before the water pass. */
export const PIER_UNDERWATER_H = 100;

export function makePierUnderwater(horizonY: number, light: number): Sprite {
  const w = Math.round(layout.W * PIER_W_FRAC);
  const h = PIER_UNDERWATER_H;
  const key = `pier:uw:${w}x${h}@${layout.dpr}`;
  const e = baker.bakeScenery(key, w, h, (ctx, cw, ch) => coastArt.drawPierUnderwater(ctx, cw, ch, light));
  const s = new Sprite(e.texture);
  s.setSize(w, h);
  s.x = layout.W - w;
  s.y = pierDeckBottom(horizonY);
  return s;
}

/** The stool at the ice hole, own box. */
export const STOOL_W = 46;
export const STOOL_H = 54;

export function makeStool(horizonY: number): Sprite {
  const key = `stool:${STOOL_W}x${STOOL_H}@${layout.dpr}`;
  const e = baker.bakeScenery(key, STOOL_W, STOOL_H, (ctx, w, h) => arcticArt.drawStool(ctx, w, h));
  const s = new Sprite(e.texture);
  s.setSize(STOOL_W, STOOL_H);
  s.x = layout.W * 0.5;
  s.y = horizonY;
  return s;
}

/** The igloo silhouette, own box. */
export const IGLOO_W = 90;
export const IGLOO_H = 46;

export function makeIgloo(horizonY: number): Sprite {
  const key = `igloo:${IGLOO_W}x${IGLOO_H}@${layout.dpr}`;
  const e = baker.bakeScenery(key, IGLOO_W, IGLOO_H, (ctx, w, h) => arcticArt.drawIgloo(ctx, w, h));
  const s = new Sprite(e.texture);
  s.setSize(IGLOO_W, IGLOO_H);
  s.x = layout.W * 0.72;
  s.y = horizonY - IGLOO_H;
  return s;
}
