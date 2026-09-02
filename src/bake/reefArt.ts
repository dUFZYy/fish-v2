/**
 * Reef ("Korallenriff") scenery bakes — ported from the old game's
 * `backdrop.js` (`drawPalmIsland`/`_palmIsland`, `drawSeaBed`) and
 * `locations.js` (`drawAnemones`, `drawCorals`, `drawSunShafts` in
 * `visuals.js`).
 *
 * Same shape of file as `lakeArt.ts`. Mode is `boat` (spec §1: "same boat
 * rig as Boot") — the platform itself is `boatArt.ts`'s `drawBoatUnderwater`/
 * `drawBoatTopside`/`drawBoatFront`, reused verbatim; only the far/seabed
 * art below is reef-specific.
 *
 * === What got baked, and what didn't ===
 *
 * `drawFarScenery` bakes the static half of `_palmIsland`: two hazy distant
 * islands and the sand bank. NOT baked — the WHOLE palm tree hangs off one
 * `sway` term (the old comment says so explicitly: "die ganze Palme haengt
 * am sway"), so nothing about a palm can be baked without freezing its sway
 * mid-motion:
 *   surf line: ellipse(ix2, hy+1, w*0.155, 6, rot=0, PI..0),
 *              color rgba(255,255,255, 0.35+0.15*sin(time*1.6))
 *   palm i (3): x = ix2 - w*0.07 + i*w*0.07, th = 32+prnd(i,31)*18,
 *               sway = sin(time*0.8+i)*3.5, topX = x+sway*2, topY = hy-th
 *               — curved trunk (5 segment ticks) + 6 fronds (alternating
 *               #2f8a55/#3fa066) + 2 coconuts, all anchored off `sway`
 *   (ix2 = w*0.17, same island x as the baked sand bank)
 *
 * `drawSeabed` bakes ONLY the sand floor (`drawSeaBed`, no static rocks —
 * the old game adds none here). NOT baked, and NOT merely dropped for a
 * cheap simplification but genuinely reclassified in
 * docs/spec/03-world-visuals.md §1's summary table as "animated": corals,
 * anemones and the light shafts —
 *   anemone i (7): x = prnd(i,61)*w, base = floor-prnd(i,62)*20,
 *                  9 tentacle strokes per anemone, each
 *                  sway = sin(time*1.6+i+t*0.5)*3, colors round-robin
 *                  ["#ff8fbf","#ffd166","#8fe3ff","#c792ff"]
 *   coral i (14): x = (i*137%1000)/1000*w, h = 30+(i*53%60),
 *                 sway = sin(time*1.2+i)*4, 3 shapes round-robin
 *                 (branching / bubble-cluster / blade), colors round-robin
 *                 ["#ff6b6b","#ff9f43","#f368e0","#feca57","#1dd1a1"], a=0.65
 *   seagrass i (10): x = (i*211%1000)/1000*w, h = 40+(i*37%50),
 *                    2 independent sway terms, color rgba(40,160,110,0.6)
 *   sun shafts (4, only when light>=0.45): x = w*(0.12+i*0.26)+sin(time*0.25+i)*18,
 *              soft cyan additive column rgba(190,255,250,0.09*light) fading out
 *
 * All of the above are the caller's job to draw live, every frame — baking
 * any of them would freeze mid-sway (palms), mid-pulse (nothing pulses here,
 * but the sway is the whole shape) or silently drop the light-gated shafts
 * from the cache signature.
 */

import { prnd } from './baker';
import { shadeColor } from './palette';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dim(color: string, light: number): string {
  const lf = clamp(light, 0.2, 1);
  return shadeColor(color, -(1 - lf) * 0.5);
}

const HORIZON_FRAC = 0.35;

/**
 * Far scenery: the static half of `_palmIsland` (backdrop.js:721-738) — two
 * hazy distant islands and the sand bank. Full screen (`w x h`). NOT drawn
 * here: the surf line and 3 whole-tree-sways palms (see file header).
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const hy = h * HORIZON_FRAC;
  const lf = clamp(light, 0.2, 1);

  // Two further islands in the haze.
  ctx.fillStyle = `rgba(150,190,185,${0.25 * lf})`;
  ctx.beginPath();
  ctx.ellipse(w * 0.72, hy, w * 0.16, 13, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w * 0.92, hy, w * 0.1, 9, 0, Math.PI, 0);
  ctx.fill();

  // Sand bank, gradient with a bright surf edge.
  const ix = w * 0.17;
  const sandG = ctx.createLinearGradient(0, hy - 20, 0, hy + 4);
  sandG.addColorStop(0, dim('#f2e2bd', light));
  sandG.addColorStop(1, dim('#cfae7c', light));
  ctx.fillStyle = sandG;
  ctx.beginPath();
  ctx.ellipse(ix, hy, w * 0.15, 19, 0, Math.PI, 0);
  ctx.fill();
}

/**
 * Sand sea bed (`drawSeaBed`, backdrop.js:501), full screen (`w x h`). No
 * static rocks at this location. NOT drawn here: corals, anemones, seagrass,
 * sun shafts (see file header — all reclassified as animated).
 */
export function drawSeabed(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  void light;
  const floor = h * 0.86;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, floor);
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * w;
    const y = floor - 4 + Math.sin(i * 0.9 + 1.3) * 5 + prnd(i, 91) * 7;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, floor - 10, 0, h);
  g.addColorStop(0, 'rgba(214,196,150,0.9)');
  g.addColorStop(0.45, 'rgba(214,196,150,0.9)');
  g.addColorStop(1, 'rgba(120,110,84,0.95)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(214,196,150,0)');
  veil.addColorStop(1, 'rgba(214,196,150,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();
}
