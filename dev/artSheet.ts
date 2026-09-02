/**
 * Dev art sheet — draws every bake function in `src/bake/lakeArt.ts` and
 * `src/bake/anglerArt.ts` into a labelled grid of plain 2D canvases, at three
 * light levels (day/dusk/night), so the art can be eyeballed without booting
 * the game or the GPU pipeline. Served by Vite at `/dev/art-sheet.html`.
 *
 * This deliberately does NOT go through `Atlas`/`Baker`/`StandaloneBakes` —
 * those exist to feed PixiJS textures, and this page just wants to see the
 * raw Canvas-2D pixels each bake function produces.
 */

import { getPalette } from '@/bake/palette';
import {
  drawSkyStrip,
  drawFarScenery,
  drawNearScenery,
  drawDock,
  drawSeabed,
  drawSun,
  drawMoon,
  drawStar,
  drawCloud,
} from '@/bake/lakeArt';
import {
  drawAnglerBody,
  drawAnglerHead,
  drawArm,
  drawHat,
  drawRod,
  drawBobber,
  drawHook,
  type AnglerMood,
} from '@/bake/anglerArt';
import { getLocationById } from '@/data/locations';
import { OUTFITS, HATS, RODSKINS, BOBBERS } from '@/data/items';

const LOC = getLocationById('see')!;

/** Three light levels for the scenery bakes (light-only signature, per CLAUDE.md's 64-step rule). */
const LIGHT_LEVELS: readonly { label: string; light: number }[] = [
  { label: 'day', light: 1.0 },
  { label: 'dusk', light: 0.5 },
  { label: 'night', light: 0.12 },
];

/** dayTime samples chosen to land close to the light levels above, for the full-palette sky strip. */
const DAYTIME_SAMPLES: readonly { label: string; dayTime: number }[] = [
  { label: 'day', dayTime: 0.4 },
  { label: 'dusk', dayTime: 0.83 },
  { label: 'night', dayTime: 0.97 },
];

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

/** Creates a labelled canvas cell, draws into it, and appends it to `grid`. Checkerboard backdrop so alpha is visible. */
function cell(grid: HTMLElement, label: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
  const fig = el('figure');
  const canvas = el('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  fig.appendChild(canvas);
  const cap = el('figcaption');
  cap.textContent = label;
  fig.appendChild(cap);
  grid.appendChild(fig);
}

function build(): void {
  // --- Sky + water gradient strip -------------------------------------------------
  {
    const grid = section('drawSkyStrip', 'Full Palette (top/bot/wTop/wBot), not a bare light scalar — see lakeArt.ts header.');
    for (const d of DAYTIME_SAMPLES) {
      const pal = getPalette(d.dayTime, LOC);
      cell(grid, `${d.label} (dayTime ${d.dayTime}, light ${pal.light.toFixed(2)})`, 60, 320, (ctx, w, h) => drawSkyStrip(ctx, w, h, pal));
    }
  }

  // --- Far / near scenery, dock, seabed --------------------------------------------
  {
    const grid = section('drawFarScenery');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 300, 150, (ctx, w, h) => drawFarScenery(ctx, w, h, l.light));
  }
  {
    const grid = section('drawNearScenery', 'Grass tufts, cattail reeds and seaweed are intentionally NOT baked here — they sway continuously and must be drawn live by the caller (see file header for their exact placement formulas).');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 300, 150, (ctx, w, h) => drawNearScenery(ctx, w, h, l.light));
  }
  {
    const grid = section('drawDock');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 140, 90, (ctx, w, h) => drawDock(ctx, w, h, l.light));
  }
  {
    const grid = section('drawSeabed');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 300, 130, (ctx, w, h) => drawSeabed(ctx, w, h, l.light));
  }

  // --- Celestials -------------------------------------------------------------------
  {
    const grid = section('drawSun', 'Baked on a dark ground here only so the glow is visible — in-game it sits on the sky gradient.');
    for (const l of LIGHT_LEVELS) {
      cell(grid, l.label, 160, 160, (ctx, w, h) => {
        ctx.fillStyle = '#0a1830';
        ctx.fillRect(0, 0, w, h);
        drawSun(ctx, w, h, l.light);
      });
    }
  }
  {
    const grid = section('drawMoon');
    for (const l of LIGHT_LEVELS) {
      cell(grid, l.label, 110, 110, (ctx, w, h) => {
        ctx.fillStyle = '#0a1020';
        ctx.fillRect(0, 0, w, h);
        drawMoon(ctx, w, h, l.light);
      });
    }
  }
  {
    const grid = section('drawStar', 'No light param — position/twinkle-alpha are applied live by the caller on this one shape.');
    cell(grid, 'star (1x)', 24, 24, (ctx, w, h) => {
      ctx.fillStyle = '#0a1020';
      ctx.fillRect(0, 0, w, h);
      drawStar(ctx, w, h);
    });
  }
  {
    const grid = section('drawCloud', 'seed 0..5 — shape variety only, no light param (alpha/tint applied live, see file header).');
    for (let seed = 0; seed < 6; seed++) {
      cell(grid, `seed ${seed}`, 140, 70, (ctx, w, h) => {
        ctx.fillStyle = '#3a6fa0';
        ctx.fillRect(0, 0, w, h);
        drawCloud(ctx, w, h, seed);
      });
    }
  }

  // --- Angler pieces ------------------------------------------------------------
  const klassisch = OUTFITS.find((o) => o.id === 'klassisch')!;
  {
    const grid = section('drawAnglerBody', 'outfit: klassisch. "breathe" idle offset is intentionally NOT baked — the caller animates it live.');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 170, 260, (ctx, w, h) => drawAnglerBody(ctx, w, h, l.light, klassisch));
  }
  {
    const grid = section('drawAnglerBody — outfits', 'light: day. All 8 OUTFITS.');
    for (const o of OUTFITS) cell(grid, o.id, 170, 260, (ctx, w, h) => drawAnglerBody(ctx, w, h, 1.0, o));
  }
  {
    const grid = section('drawAnglerHead', 'All 4 moods x 3 light levels.');
    const moods: AnglerMood[] = ['surprised', 'focused', 'grin', 'pout'];
    for (const l of LIGHT_LEVELS) {
      for (const m of moods) cell(grid, `${m} / ${l.label}`, 140, 180, (ctx, w, h) => drawAnglerHead(ctx, w, h, l.light, m));
    }
  }
  {
    const grid = section('drawArm', 'outfit: klassisch, the rod-holding arm (baked bend, see file header).');
    for (const l of LIGHT_LEVELS) cell(grid, l.label, 130, 210, (ctx, w, h) => drawArm(ctx, w, h, l.light, klassisch));
  }
  {
    const grid = section('drawHat', 'All 16 HATS ids x 3 light levels.');
    for (const l of LIGHT_LEVELS) {
      for (const hat of HATS) cell(grid, `${hat.id} / ${l.label}`, 120, 160, (ctx, w, h) => drawHat(ctx, w, h, hat.id, l.light));
    }
  }
  {
    const grid = section('drawRod', 'All RODSKINS. Light-independent (see file note), shown once each. `rainbow`/gamma/fade/case/marble are shown at their static reference frame — the real renderer redraws continuously-animated skins live per the never-bake list.');
    for (const skin of RODSKINS) cell(grid, skin.id, 220, 70, (ctx, w, h) => drawRod(ctx, w, h, skin, 1.0));
  }
  {
    const grid = section('drawBobber', 'All BOBBERS. `rainbow`/`disco` shown at a static reference frame (see file note).');
    for (const skin of BOBBERS) {
      cell(grid, skin.id, 70, 70, (ctx, w, h) => {
        ctx.fillStyle = '#123';
        ctx.fillRect(0, 0, w, h);
        drawBobber(ctx, w, h, skin);
      });
    }
  }
  {
    const grid = section('drawHook');
    cell(grid, 'hook', 50, 60, (ctx, w, h) => {
      ctx.fillStyle = '#123';
      ctx.fillRect(0, 0, w, h);
      drawHook(ctx, w, h);
    });
  }
}

build();
