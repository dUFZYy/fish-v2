/**
 * "Steg am See" as SceneArt.
 *
 * The adapter between the ported drawing code (bake/lakeArt.ts, which is the
 * old `drawLakeShore` and friends) and the renderer's SceneArt contract. It
 * exists so the scene never imports a location's art directly: adding the
 * other five spots means adding five more of these, and nothing in
 * world/scene.ts changes.
 */

import type { SceneArt, BakeFn } from '@/world/scene';
import { getPalette, hexToRgb, type Palette } from '@/bake/palette';
import {
  drawSkyStrip, drawFarScenery, drawNearScenery, drawDock, drawSeabed,
} from '@/bake/lakeArt';
import { baker, Baker } from '@/bake/baker';
import { layout } from '@/engine/layout';
import { Sprite } from 'pixi.js';
import { getLocationById, type Location } from '@/data/locations';

/**
 * The old game's day clock. `dayTime` runs 0..1 over 300 seconds of play and
 * drives the palette; `light` is the 0..1 brightness that comes out of it.
 * Both are needed: the palette needs the phase (dawn is not just "dim"),
 * the bakes and the water pass need the brightness.
 */
export const DAY_SECONDS = 300;

export interface SkyState {
  /** 0..1 through the day */
  dayTime: number;
  palette: Palette;
  /** 0..1 brightness, from the palette */
  light: number;
  /** sun/moon x, y, radius, strength — fed to the water pass */
  sun: [number, number, number, number];
}

/**
 * Sun and moon share one arc. The old game put the sun up between 0.22 and
 * 0.78 of the day and the moon on the rest of the circle; the water pass
 * only cares where the light is and how strong, so both resolve to one
 * position and one strength.
 */
export function skyStateFor(dayTime: number, W: number, H: number, loc: Location): SkyState {
  const palette = getPalette(dayTime, loc, currentGloom);
  const light = palette.light;

  const dayUp = dayTime > 0.22 && dayTime < 0.78;
  const t = dayUp ? (dayTime - 0.22) / 0.56 : ((dayTime + 0.22) % 1) / 0.44;
  const x = W * (0.12 + t * 0.76);
  // a flattened arc, so the sun does not climb out of the visible sky
  const y = H * (0.30 - Math.sin(t * Math.PI) * 0.22);
  const radius = dayUp ? W * 0.105 : W * 0.075;
  // The moon lights the water enough to glitter but never enough to cast
  // shafts — that distinction is in the water shader.
  const strength = dayUp ? light : light * 0.55;

  return { dayTime, palette, light, sun: [x, y, radius, strength] };
}

function rgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

/**
 * Builds the SceneArt for the lake at a given sky state.
 *
 * The palette is passed in rather than recomputed here, because the scene
 * quantises the light to 64 steps for the cache and the DRAWING has to use
 * the same quantised value — otherwise the baked hills are lit differently
 * from the live grass in front of them, and the seam is visible exactly at
 * that edge. So this takes the light it is given and never invents its own.
 */
export function lakeArt(loc: Location): SceneArt {
  return {
    id: `lake:${loc.id}`,

    gradient(light: number, horizonFrac: number): BakeFn {
      // The gradient needs hue, not just brightness, so the palette is
      // resolved from the light by walking the day curve back to a phase.
      // Day and dusk differ at the same brightness, so we keep the phase the
      // caller last set — see `setPhase` below.
      const pal = paletteForLight(light, loc);
      return (ctx, w, h) => drawSkyStrip(ctx, w, h, pal, horizonFrac);
    },

    far(light: number): BakeFn {
      return (ctx, w, h) => drawFarScenery(ctx, w, h, light);
    },

    near(light: number): BakeFn {
      // Bank and reeds only — full-screen art, so a screen-sized bake is
      // right for them. The DOCK is not here: it has its own size and
      // position (see dockBake below), and drawing it into a screen-sized
      // box stretches its internals.
      return (ctx, w, h) => drawNearScenery(ctx, w, h, light);
    },

    seabed(light: number): BakeFn {
      return (ctx, w, h) => drawSeabed(ctx, w, h, light);
    },

    waterTop(light: number): [number, number, number] {
      return rgb01(paletteForLight(light, loc).wTop);
    },

    waterBottom(light: number): [number, number, number] {
      return rgb01(paletteForLight(light, loc).wBot);
    },

    // Measured, not guessed: each scenery function was drawn at 390x844 and
    // its ink extent read back. The far layer only occupies y 189..296 of
    // 844, so a screen-sized bake threw away 85 % of an 18 MB texture.
    bands: {
      far: { y: 0.20, h: 0.17 },
      near: { y: 0.34, h: 0.09 },
      seabed: { y: 0.78, h: 0.22 },
    },

    deepSea: false,
  };
}

/**
 * Light alone is ambiguous — 0.5 happens twice a day, once going up and once
 * coming down, with different colours. The scene only hands the bake a
 * light, so the current phase is kept here and combined with it.
 *
 * This is deliberately a module-level value rather than a parameter: it must
 * be part of what the cache key already covers (the light step), and dawn
 * and dusk never occur in the same frame.
 */
let currentPhase = 0.5;
/**
 * Rain gloom, 0..1. It greys the sky and the water without touching `light`
 * — a rainy day must not make night fish appear, which is why the old game
 * kept the two separate.
 */
let currentGloom = 0;

export function setSkyPhase(dayTime: number): void {
  currentPhase = dayTime;
}

export function setSkyGloom(gloom: number): void {
  // Quantised to the same 64 steps as the light: the gloom ramps
  // continuously, and an unquantised value in a cache key re-bakes the
  // scenery every frame.
  currentGloom = Math.round(Math.max(0, Math.min(1, gloom)) * 63) / 63;
}

export function skyGloomStep(): number { return Math.round(currentGloom * 63); }

function paletteForLight(light: number, loc: Location): Palette {
  const pal = getPalette(currentPhase, loc, currentGloom);
  // If the caller quantised the light, respect the quantised value: the
  // drawing and the cache key must agree to the last decimal.
  return light === pal.light ? pal : { ...pal, light };
}

export const LAKE = getLocationById('see')!;

/**
 * The dock, as a placed sprite.
 *
 * `drawDock` composes against ITS OWN box (`s = h / 4.1` sets the plank
 * thickness, the legs run to the bottom edge, the bucket is sized from the
 * plank height). Handed the whole screen it produced 206 px planks and a
 * bucket 226 px tall floating in the sky. So it gets a box the size of a
 * dock, and the scene places it.
 *
 * Geometry: the deck sits just above the water line with the posts running
 * down into it, anchored to the right, matching the old game's composition.
 */
export const DOCK_H = 110;
export const DOCK_W_FRAC = 0.62;

export function makeDock(horizonY: number, light: number): Sprite {
  const step = Baker.lightStep(light);
  const w = Math.round(layout.W * DOCK_W_FRAC);
  const key = `dock:${w}x${DOCK_H}:l${step}@${layout.dpr}`;
  const e = baker.bakeScenery(key, w, DOCK_H, (ctx, cw, ch) => {
    drawDock(ctx, cw, ch, Baker.lightOf(step));
  });
  const s = new Sprite(e.texture);
  s.setSize(w, DOCK_H);
  s.x = layout.W - w;
  // plankY inside the bake is 1.1 * (h / 4.1); put the deck's top edge
  // 20 px above the water line.
  const plankY = 1.1 * (DOCK_H / 4.1);
  s.y = horizonY - 20 - plankY;
  return s;
}
