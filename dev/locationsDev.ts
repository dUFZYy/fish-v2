/**
 * Dev locations page — renders all six locations (day/dusk/night, at the
 * logical 390×844 portrait box) as plain Canvas 2D composites, and measures
 * each non-lake location's far/near/seabed ink bands by rendering into a
 * throwaway canvas and reading back the alpha extent (CLAUDE.md's "measure,
 * don't guess"). Served by Vite at `/dev/locations.html`.
 *
 * Deliberately does NOT go through `Atlas`/`Baker`/`StandaloneBakes`/PixiJS —
 * this page wants the raw Canvas-2D pixels each bake function produces, and
 * a plain composite of gradient + far + near + seabed + platform prop drawn
 * directly, the same way `dev/art-sheet.html` does for the lake.
 *
 * The "own box" props (boat, pier+lighthouse, ice stool/igloo) are placed
 * here with the SAME box-sizing math `game/locationsArt.ts`'s `make*`
 * functions use, just drawn straight to a 2D context instead of baked to a
 * Pixi texture — so this page also doubles as a check that those functions
 * don't stretch when composed against their own box.
 */

import { getPalette } from '@/bake/palette';
import { drawSkyStrip, drawFarScenery as lakeFar, drawNearScenery as lakeNear, drawSeabed as lakeSeabed, drawDock } from '@/bake/lakeArt';
import * as boatArt from '@/bake/boatArt';
import * as coastArt from '@/bake/coastArt';
import * as reefArt from '@/bake/reefArt';
import * as deepArt from '@/bake/deepArt';
import * as arcticArt from '@/bake/arcticArt';
import { getLocationById, type Location } from '@/data/locations';

const W = 390;
const H = 844;
const HORIZON_FRAC = 0.35;
const HORIZON = H * HORIZON_FRAC;

const LIGHT_LEVELS: readonly { label: string; dayTime: number }[] = [
  { label: 'day', dayTime: 0.4 },
  { label: 'dusk', dayTime: 0.83 },
  { label: 'night', dayTime: 0.97 },
];

// ---------------------------------------------------------------------------
// Measurement: render a layer alone, read back its alpha extent.
// ---------------------------------------------------------------------------

interface Band { y: number; h: number }

function measure(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Band {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  draw(ctx, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  let minY = H;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4 + 3]! > 4) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  if (maxY < minY) return { y: 0, h: 0 };
  return { y: minY / H, h: (maxY - minY + 1) / H };
}

/** Union of a layer's ink band across all three light levels — the band must fit every light step. */
function measureAcrossLight(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, light: number) => void): Band {
  let minY = 1;
  let maxY = 0;
  for (const l of LIGHT_LEVELS) {
    const pal = getPalette(l.dayTime);
    const b = measure((ctx, w, h) => draw(ctx, w, h, pal.light));
    if (b.h === 0) continue;
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (maxY <= minY) return { y: 0, h: 0 };
  return { y: minY, h: maxY - minY };
}

function fmt(b: Band): string {
  return `{ y: ${b.y.toFixed(2)}, h: ${b.h.toFixed(2)} }`;
}

// ---------------------------------------------------------------------------
// Own-box prop placement — same math as `game/locationsArt.ts`'s `make*`.
// ---------------------------------------------------------------------------

const BOAT_W = Math.round(W * 0.58);
const BOAT_H = 150;
const PIER_W = Math.round(W * 0.5);
const PIER_H = 260;
const PIER_UW_H = 100;
const DOCK_W = Math.round(W * 0.62);
const DOCK_H = 110;
const STOOL_W = 46;
const STOOL_H = 54;
const IGLOO_W = 90;
const IGLOO_H = 46;

function drawBoxProp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw(ctx, w, h);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Per-location composite renderers.
// ---------------------------------------------------------------------------

type Composer = (ctx: CanvasRenderingContext2D, dayTime: number) => void;

function makeComposer(loc: Location, parts: {
  gradient: (ctx: CanvasRenderingContext2D, w: number, h: number, light: number, dayTime: number) => void;
  far?: (ctx: CanvasRenderingContext2D, w: number, h: number, light: number) => void;
  near?: (ctx: CanvasRenderingContext2D, w: number, h: number, light: number) => void;
  seabed?: (ctx: CanvasRenderingContext2D, w: number, h: number, light: number) => void;
  platform?: (ctx: CanvasRenderingContext2D, light: number) => void;
}): Composer {
  return (ctx, dayTime) => {
    const pal = getPalette(dayTime, loc);
    parts.gradient(ctx, W, H, pal.light, dayTime);
    if (parts.far) parts.far(ctx, W, H, pal.light);
    if (parts.seabed) parts.seabed(ctx, W, H, pal.light);
    if (parts.near) parts.near(ctx, W, H, pal.light);
    if (parts.platform) parts.platform(ctx, pal.light);
  };
}

const LOC = {
  see: getLocationById('see')!,
  boot: getLocationById('boot')!,
  kueste: getLocationById('kueste')!,
  riff: getLocationById('riff')!,
  tiefsee: getLocationById('tiefsee')!,
  arktis: getLocationById('arktis')!,
};

const composers: Record<string, Composer> = {
  see: makeComposer(LOC.see, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.see), HORIZON_FRAC),
    far: lakeFar,
    near: lakeNear,
    seabed: lakeSeabed,
    platform: (ctx, l) => {
      const x = W - DOCK_W;
      const plankY = 1.1 * (DOCK_H / 4.1);
      const y = HORIZON - 20 - plankY;
      drawBoxProp(ctx, x, y, DOCK_W, DOCK_H, (c, w, h) => drawDock(c, w, h, l));
    },
  }),

  boot: makeComposer(LOC.boot, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.boot), HORIZON_FRAC),
    far: boatArt.drawFarScenery,
    seabed: boatArt.drawSeabed,
    platform: (ctx, l) => {
      const { originY } = boatArt.boatDims(BOAT_W, BOAT_H);
      const x = (W - BOAT_W) / 2;
      const y = HORIZON - originY;
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatUnderwater(c, w, h, l));
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatTopside(c, w, h, l));
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatFront(c, w, h, l));
    },
  }),

  kueste: makeComposer(LOC.kueste, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.kueste), HORIZON_FRAC),
    far: coastArt.drawFarScenery,
    seabed: coastArt.drawSeabed,
    platform: (ctx, l) => {
      const x = W - PIER_W;
      const deckY = (5 / 6) * PIER_H;
      const y = HORIZON - 20 - deckY;
      const deckBottom = HORIZON - 20 + PIER_H / 6;
      drawBoxProp(ctx, x, deckBottom, PIER_W, PIER_UW_H, (c, w, h) => coastArt.drawPierUnderwater(c, w, h, l));
      drawBoxProp(ctx, x, y, PIER_W, PIER_H, (c, w, h) => coastArt.drawPier(c, w, h, l));
    },
  }),

  riff: makeComposer(LOC.riff, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.riff), HORIZON_FRAC),
    far: reefArt.drawFarScenery,
    seabed: reefArt.drawSeabed,
    platform: (ctx, l) => {
      const { originY } = boatArt.boatDims(BOAT_W, BOAT_H);
      const x = (W - BOAT_W) / 2;
      const y = HORIZON - originY;
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatUnderwater(c, w, h, l));
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatTopside(c, w, h, l));
      drawBoxProp(ctx, x, y, BOAT_W, BOAT_H, (c, w, h) => boatArt.drawBoatFront(c, w, h, l));
    },
  }),

  tiefsee: makeComposer(LOC.tiefsee, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.tiefsee), 0.05),
    far: deepArt.drawFarScenery,
    seabed: deepArt.drawSeabed,
  }),

  arktis: makeComposer(LOC.arktis, {
    gradient: (ctx, w, h, l, dayTime) => drawSkyStrip(ctx, w, h, getPalette(dayTime, LOC.arktis), HORIZON_FRAC),
    far: arcticArt.drawFarScenery,
    seabed: arcticArt.drawSeabed,
    near: arcticArt.drawNearScenery,
    platform: (ctx) => {
      drawBoxProp(ctx, W * 0.5, HORIZON, STOOL_W, STOOL_H, (c, w, h) => arcticArt.drawStool(c, w, h));
      drawBoxProp(ctx, W * 0.72, HORIZON - IGLOO_H, IGLOO_W, IGLOO_H, (c, w, h) => arcticArt.drawIgloo(c, w, h));
    },
  }),
};

// ---------------------------------------------------------------------------
// DOM plumbing (same shape as dev/artSheet.ts).
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function section(title: string, note?: string): HTMLElement {
  const root = document.getElementById('app')!;
  const s = el('section');
  const h = el('h2');
  h.textContent = title;
  s.appendChild(h);
  if (note) {
    const p = el('p', 'note');
    p.textContent = note;
    s.appendChild(p);
  }
  const grid = el('div', 'grid');
  s.appendChild(grid);
  root.appendChild(s);
  return grid;
}

function cell(grid: HTMLElement, label: string, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const fig = el('figure');
  const canvas = el('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  fig.appendChild(canvas);
  const cap = el('figcaption');
  cap.textContent = label;
  fig.appendChild(cap);
  grid.appendChild(fig);
}

function build(): void {
  // --- Measured bands, printed first (also logged to console). ---
  const bandsOut: string[] = [];
  bandsOut.push('Measured ink bands (union across day/dusk/night, fractions of H=844):\n');

  const report = (name: string, fn: ((ctx: CanvasRenderingContext2D, w: number, h: number, light: number) => void) | undefined) => {
    if (!fn) return;
    const b = measureAcrossLight(fn);
    bandsOut.push(`  ${name.padEnd(16)} ${fmt(b)}`);
    // eslint-disable-next-line no-console
    console.log(`[locations] ${name}`, b);
  };

  report('boot.far', boatArt.drawFarScenery);
  report('boot.seabed', boatArt.drawSeabed);
  bandsOut.push('');
  report('kueste.far', coastArt.drawFarScenery);
  report('kueste.seabed', coastArt.drawSeabed);
  bandsOut.push('');
  report('riff.far', reefArt.drawFarScenery);
  report('riff.seabed', reefArt.drawSeabed);
  bandsOut.push('');
  report('tiefsee.far', deepArt.drawFarScenery);
  report('tiefsee.seabed', deepArt.drawSeabed);
  bandsOut.push('');
  report('arktis.far', arcticArt.drawFarScenery);
  report('arktis.near', arcticArt.drawNearScenery);
  report('arktis.seabed', arcticArt.drawSeabed);

  document.getElementById('bands')!.textContent = bandsOut.join('\n');

  // --- Composites, one section per location. ---
  for (const [id, composer] of Object.entries(composers)) {
    const grid = section(id);
    for (const l of LIGHT_LEVELS) {
      cell(grid, `${l.label} (dayTime ${l.dayTime})`, (ctx) => composer(ctx, l.dayTime));
    }
  }
}

build();
