/**
 * Lake ("Steg am See") scenery bakes — ported from the old game's `backdrop.js`
 * (`drawLakeShore`, `drawSeaBed`, `drawLakeRocks`, `drawLilyPads`) and `draw.js`
 * (`drawBackground`, `drawStars`/`drawSunBody`/`drawMoon`/`drawClouds`) plus the
 * dock geometry from `draw.js` (`drawDock`/`drawDockLegs`).
 *
 * Every function here has the shape `(ctx, w, h, ...) => void` and draws into the
 * logical `(0,0)..(w,h)` box the caller bakes it at (see `src/bake/atlas.ts` /
 * `src/bake/standalone.ts`) — it never reads `canvas.width`/`time`/globals. That's
 * the whole point: the old code's `_lakeShore()` etc. read `canvas.width`, `time`,
 * `horizonY` off the window every call; here every one of those becomes an
 * explicit parameter (or is simply not a parameter, because the caller bakes a
 * fixed-size box and never needs to know the real screen size).
 *
 * === What got baked, and what got split out as animated (per CLAUDE.md rule 1:
 * "was einmal gerastert ist, wird nur noch kopiert" + the never-bake list in
 * docs/spec/03-world-visuals.md §6) ===
 *
 * `drawFarScenery` bakes exactly the `Blech.ruhig()` (static) half of the old
 * `_lakeShore()`: mountain range + snow caps + haze, forested ridge, both pine
 * layers, the grass-bank color gradient. NOT baked, because they sway on `time`
 * every frame and would either (a) force a re-bake per frame — the exact "write
 * and read a canvas in the same frame" failure CLAUDE.md rule 1 names — or (b)
 * freeze mid-sway if baked once:
 *   - 60 grass tufts on the bank edge (`sin(time*1.4+i)*1.2` sway)
 *   - 12 cattail reeds + seed heads on the left 22% of the shore (`sin(time*1.1+i)*3`)
 * These are the caller's job to draw live, every frame, as their own small strokes
 * (deterministic via `prnd(i, salt)` exactly as the old game placed them — the
 * placement formulas are documented next to each bake function below so the
 * live counterpart can reuse the same `x`/base coordinates).
 *
 * `drawNearScenery` bakes the lily pads (their ~2px vertical wave-bob is below
 * the just-noticeable threshold at rest and is dropped — a documented
 * simplification, not an oversight) and the reed-bed's rooted silt patch. The
 * seaweed strands that grow from the lake bed (`drawWeeds`, locations.js:521,
 * `sin(time*0.9..1.1+i)` sway) are NOT baked for the same continuous-motion
 * reason as the grass/reeds above, and are also the caller's job to animate live.
 *
 * `drawDock`/`drawSeabed` have no continuously-moving parts at this location
 * (the dock is a fixed platform, the lake bed doesn't drift) — the old game
 * didn't even bother baking them (cheap, few draws) but there is no harm baking
 * them here since nothing about them ever changes at a fixed light step.
 *
 * `drawSun`/`drawMoon`/`drawStar`/`drawCloud` bake ONE reusable motif each, at
 * full/reference brightness. Position, twinkle-alpha (stars), glow-visibility-
 * alpha (moon) and rain-tinting (clouds) in the old game are all pure multiplies
 * of a fixed shape/color — so instead of re-baking per light step, the caller
 * applies alpha/tint live on top of one baked sprite. Same reasoning as the old
 * `Blech.stempel("mond", …)`, which bakes the disc+halo+craters once and applies
 * only position + `globalAlpha` live.
 */

import { prnd } from './baker';
import { shadeColor } from './palette';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** This location's horizon line (spec §7: `horizonY = canvas.height * 0.35` for every non-dive mode). */
const HORIZON_FRAC = 0.35;

/**
 * Sky gradient (top->bottom) + water gradient (top->bottom), stacked as one vertical strip —
 * meant for `standalone.strip(key, logicalH, (ctx,w,h)=>drawSkyStrip(ctx,w,h,pal,horizonFrac), 8)`.
 *
 * Ported from `drawBackground` (draw.js:79-99). Takes the resolved `Palette` (see `palette.ts`)
 * rather than a bare light scalar: unlike the scenery bakes below, the sky/water hue genuinely
 * depends on WHERE in the day/night cycle we are (dawn is pink, dusk is purple, both can share
 * the same `light` scalar) — collapsing that to one number would visibly regress dawn/dusk color,
 * which CLAUDE.md's acceptance rule ("darf nicht schlechter aussehen") forbids. The caller still
 * quantises what it passes in (e.g. re-baking only every N `dayTime` steps), this function just
 * doesn't need to know that policy.
 */
export function drawSkyStrip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pal: { top: string; bot: string; wTop: string; wBot: string },
  horizonFrac = HORIZON_FRAC,
): void {
  const horizonY = h * horizonFrac;
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, pal.top);
  sky.addColorStop(1, pal.bot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizonY + 20);

  const water = ctx.createLinearGradient(0, horizonY, 0, h);
  water.addColorStop(0, pal.wTop);
  water.addColorStop(1, pal.wBot);
  ctx.fillStyle = water;
  ctx.fillRect(0, horizonY - 12, w, h - horizonY + 12);
}

/** `dim()` from `_lakeShore`/`kulissenLicht()`: darken a base color by how far `light` is below 1. */
function dim(color: string, light: number): string {
  const lf = clamp(light, 0.18, 1);
  return shadeColor(color, -(1 - lf) * 0.55);
}

/**
 * One pine tree (backdrop.js:315 `drawPine`, verbatim geometry) — a 3-tier conifer with a
 * sunlit-left/shaded-right gradient per tier, jagged tier edges instead of plain triangles.
 */
function drawPine(ctx: CanvasRenderingContext2D, x: number, baseY: number, hgt: number, tint: string): void {
  const trunkW = Math.max(1.5, hgt * 0.05);
  ctx.fillStyle = '#3b2a1a';
  ctx.fillRect(x - trunkW / 2, baseY - hgt * 0.14, trunkW, hgt * 0.16);
  const tiers = 3;
  for (let i = tiers - 1; i >= 0; i--) {
    const t = i / tiers;
    const cy = baseY - hgt * (0.12 + t * 0.58);
    const tw = hgt * 0.3 * (1 - t * 0.42);
    const th = hgt * 0.4;
    const g = ctx.createLinearGradient(x - tw, cy - th, x + tw, cy);
    g.addColorStop(0, shadeColor(tint, 0.3));
    g.addColorStop(0.45, tint);
    g.addColorStop(1, shadeColor(tint, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, cy - th);
    ctx.lineTo(x - tw * 0.55, cy - th * 0.35);
    ctx.lineTo(x - tw * 0.42, cy - th * 0.42);
    ctx.lineTo(x - tw, cy);
    ctx.lineTo(x - tw * 0.5, cy - th * 0.08);
    ctx.lineTo(x, cy + th * 0.03);
    ctx.lineTo(x + tw * 0.5, cy - th * 0.08);
    ctx.lineTo(x + tw, cy);
    ctx.lineTo(x + tw * 0.42, cy - th * 0.42);
    ctx.lineTo(x + tw * 0.55, cy - th * 0.35);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Far scenery: the STATIC half of `_lakeShore` (backdrop.js:396-462) — distant mountain range
 * with snow caps and haze, the darker forested ridge, both pine layers, and the grass-bank color
 * gradient. Full screen (`w x h`); `light` should be the Baker-quantised daylight (see
 * `Baker.lightStep`/`lightOf` in `baker.ts`) so the bake signature and the drawn pixels agree.
 *
 * NOT drawn here (see file header): 60 swaying grass tufts + 12 cattail reeds — draw those live,
 * on top, every frame; their placement formulas (for the caller to mirror):
 *   grass tuft i:  x = prnd(i,7)*w,  h = 3+prnd(i,8)*5,           sway = sin(time*1.4+i)*1.2
 *   reed i (12):   x = w*0.01 + prnd(i,9)*w*0.22, rh = 20+prnd(i,10)*26, sway = sin(time*1.1+i)*3
 *                  (every 3rd reed also gets a brown seed head ellipse at the tip)
 * both rooted at `shore = h*HORIZON_FRAC - 6`.
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const shore = h * HORIZON_FRAC - 6;

  // 1) Distant mountain range: gradient fill, snow caps, haze band in front.
  const mTop = shore - 118;
  const mG = ctx.createLinearGradient(0, mTop, 0, shore);
  mG.addColorStop(0, dim('#7c93a6', light));
  mG.addColorStop(1, dim('#4c6274', light));
  ctx.fillStyle = mG;
  ctx.beginPath();
  ctx.moveTo(0, shore);
  const peaks: [number, number][] = [];
  for (let i = 0; i <= 7; i++) {
    const px = (i / 7) * w;
    const py = shore - 46 - prnd(i, 1) * 66;
    peaks.push([px, py]);
    if (i === 0) ctx.lineTo(px, py);
    else {
      const [ppx, ppy] = peaks[i - 1]!;
      ctx.lineTo((ppx + px) / 2, Math.max(ppy, py) + 14);
      ctx.lineTo(px, py);
    }
  }
  ctx.lineTo(w, shore);
  ctx.closePath();
  ctx.fill();

  const lf = clamp(light, 0.18, 1);
  ctx.fillStyle = `rgba(244,250,255,${0.55 * lf + 0.2})`;
  for (const [px, py] of peaks) {
    if (py > shore - 78) continue;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - 13, py + 17);
    ctx.lineTo(px - 5, py + 12);
    ctx.lineTo(px + 3, py + 18);
    ctx.lineTo(px + 11, py + 12);
    ctx.lineTo(px + 15, py + 17);
    ctx.closePath();
    ctx.fill();
  }

  const haze = ctx.createLinearGradient(0, shore - 70, 0, shore);
  haze.addColorStop(0, 'rgba(180,205,225,0)');
  haze.addColorStop(1, `rgba(180,205,225,${0.32 * lf})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, shore - 70, w, 70);

  // 2) Forested ridge behind the pines: dark, jagged silhouette.
  ctx.fillStyle = dim('#2f5a44', light);
  ctx.beginPath();
  ctx.moveTo(0, shore);
  for (let i = 0; i <= 26; i++) {
    const px = (i / 26) * w;
    const base = shore - 26 - Math.sin(i * 0.42) * 12 - prnd(i, 2) * 10;
    ctx.lineTo(px, base);
    ctx.lineTo(px + w / 52, base + 6);
  }
  ctx.lineTo(w, shore);
  ctx.closePath();
  ctx.fill();

  // 3) Two pine layers: small/pale behind, large/bold in front.
  for (const layer of [
    { n: 12, s: 0.55, tint: '#2b5240', a: 0.75, yo: 4 },
    { n: 8, s: 1, tint: '#37694f', a: 1, yo: 0 },
  ]) {
    ctx.globalAlpha = layer.a;
    for (let i = 0; i < layer.n; i++) {
      const x = prnd(i, layer.s * 10 + 3) * w * 0.62;
      const hgt = (30 + prnd(i, layer.s * 10 + 4) * 34) * layer.s;
      drawPine(ctx, x, shore + layer.yo, hgt, dim(layer.tint, light));
    }
    ctx.globalAlpha = 1;
  }

  // 4) Grass-on-dirt bank edge.
  const bankG = ctx.createLinearGradient(0, shore - 5, 0, shore + 7);
  bankG.addColorStop(0, dim('#5c7a4a', light));
  bankG.addColorStop(0.5, dim('#40573a', light));
  bankG.addColorStop(1, dim('#2f4030', light));
  ctx.fillStyle = bankG;
  ctx.fillRect(0, shore - 5, w, 12);
}

/**
 * Near scenery: lily pads (backdrop.js:486 `drawLilyPads`, static — the ~2px sin bob is dropped,
 * see file header) resting just below the shore, full screen (`w x h`).
 *
 * NOT drawn here: 9 swaying seaweed strands rooted in the lake bed (`drawWeeds`, locations.js:521,
 * continuous `sin(time*0.9..1.1+i)` sway) — same never-bake reasoning, caller draws them live:
 *   strand i (9): x = (i*263 % 1000)/1000 * w,  h = 30 + (i*41 % 45),  base = bottom of the box
 *                 alpha = 0.35 + (i%3)*0.12, color "rgba(50,120,70,0.8)"
 */
export function drawNearScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  void light; // lily pads aren't light-tinted in the original either — kept for API symmetry.
  const hy = h * HORIZON_FRAC;
  for (let i = 0; i < 5; i++) {
    const x = prnd(i, 6) * w;
    const y = hy + 16 + prnd(i, 7) * 26;
    const r = 12 + prnd(i, 8) * 12;
    ctx.fillStyle = 'rgba(46,96,58,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,50,30,0.5)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + r * 0.75, y - r * 0.16);
    ctx.lineTo(x + r * 0.75, y + r * 0.16);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The jetty: planks (`drawDock`, draw.js:303) + support legs (`drawDockLegs`, draw.js:288) + the
 * bait bucket, fused into one static box. Unlike the original (flat colors, no daylight response)
 * this dims with `light` for consistency with the rest of the baked scenery — a deliberate, small
 * "may look better" deviation (CLAUDE.md's acceptance bar explicitly allows that direction).
 *
 * Layout inside the box (top-left origin), in units of `s = h / 4.1`:
 *   bucket:      top-left area,          y in [0, 1.1s]
 *   deck planks: full width,             y in [1.1s, 2.1s]
 *   legs (x2):   at 10% and 75% width,   y in [2.1s, h]
 */
export function drawDock(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const s = h / 4.1;
  const plankY = s * 1.1;
  const plankH = s;
  const legY = plankY + plankH;
  const legW = w * 0.08;
  const legH = h - legY;

  // Legs first (behind the deck).
  ctx.fillStyle = dim('#6b4423', light);
  for (const fx of [0.1, 0.75]) {
    const x = w * fx;
    ctx.fillRect(x, legY, legW, legH);
    ctx.fillStyle = 'rgba(40,25,10,0.35)';
    ctx.fillRect(x, legY + legH * 0.55, legW, legH * 0.45);
    ctx.fillStyle = dim('#6b4423', light);
  }

  // Deck: alternating planks.
  const plankCount = 14;
  const plank = w / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = dim(i % 2 === 0 ? '#a0683a' : '#8b5a2b', light);
    ctx.fillRect(i * plank, plankY, plank - 2, plankH);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, plankY + plankH - 3, w, 3);

  // Bucket, sitting on the deck near the right side.
  const bx = w * 0.62;
  const bw = plankH * 0.9;
  const bh = plankH * 1.1;
  ctx.fillStyle = dim('#4a6fa5', light);
  ctx.fillRect(bx, plankY - bh, bw, bh);
  ctx.strokeStyle = dim('#2d4a75', light);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx + bw * 0.5, plankY - bh, bw * 0.5, Math.PI, 0);
  ctx.stroke();
}

/**
 * Lake bed + rocks (`drawLakeRocks`, backdrop.js:525, which itself calls `drawSeaBed`), full
 * screen (`w x h`). The wavy top edge and 9 resting stones are baked static — the old game never
 * bakes this either (cheap, few draws, and its own `sin(time*0.2)` ripple on the top edge is tiny
 * enough to drop for a static bake, same call as the lily pads above).
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
  g.addColorStop(0, 'rgba(52,66,58,0.85)');
  g.addColorStop(0.45, 'rgba(52,66,58,0.85)');
  g.addColorStop(1, 'rgba(22,34,34,0.95)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(52,66,58,0)');
  veil.addColorStop(1, 'rgba(52,66,58,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();

  for (let i = 0; i < 9; i++) {
    const x = prnd(i, 9) * w;
    const r = 8 + prnd(i, 10) * 20;
    const base = floor - 2 + Math.sin(i * 0.9 + 1.3) * 5 + prnd(i, 91) * 7;
    const rg = ctx.createLinearGradient(x - r, base - r * 0.7, x + r, base);
    rg.addColorStop(0, 'rgba(96,108,102,0.75)');
    rg.addColorStop(0.55, 'rgba(62,74,70,0.75)');
    rg.addColorStop(1, 'rgba(34,44,42,0.8)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(x, base, r, r * 0.62, prnd(i, 12) * 0.5 - 0.25, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,180,175,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, base, r * 0.75, r * 0.45, 0, Math.PI * 1.15, Math.PI * 1.75);
    ctx.stroke();
  }
}

/**
 * Sun disc motif (`drawSunBody`, draw.js:132-160), baked once, small (bounding box should be about
 * `r*7 x r*7` so the outer glow ring fits). `light` stands in for the old "low" (horizon-proximity)
 * factor via `low = 1 - light`: the sun is only ever near the horizon exactly when daylight is low
 * (dawn/dusk), so this reconstructs the same warm/enlarged look from the one scalar this module's
 * bake functions are keyed on, without needing a second parameter.
 */
export function drawSun(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 7.6;
  const low = clamp(1 - light, 0, 1);
  const rr = r * (1 + low * 0.3);
  const core = lerpColorRgb('#fff6c9', '#ffe9b0', low);
  const mid = lerpColorRgb('#ffe066', '#ff9d4d', low);
  const rim = lerpColorRgb('#ffc94d', '#ff7a30', low);

  const glow2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 3.4);
  glow2.addColorStop(0, `rgba(255,220,150,${0.22 + low * 0.1})`);
  glow2.addColorStop(0.5, `rgba(255,200,130,${0.08 + low * 0.06})`);
  glow2.addColorStop(1, 'rgba(255,200,130,0)');
  ctx.fillStyle = glow2;
  ctx.beginPath();
  ctx.arc(cx, cy, rr * 3.4, 0, Math.PI * 2);
  ctx.fill();

  const glow1 = ctx.createRadialGradient(cx, cy, rr * 0.5, cx, cy, rr * 1.7);
  glow1.addColorStop(0, 'rgba(255,240,170,0.35)');
  glow1.addColorStop(1, 'rgba(255,240,170,0)');
  ctx.fillStyle = glow1;
  ctx.beginPath();
  ctx.arc(cx, cy, rr * 1.7, 0, Math.PI * 2);
  ctx.fill();

  const disc = ctx.createRadialGradient(cx - rr * 0.3, cy - rr * 0.3, rr * 0.1, cx, cy, rr);
  disc.addColorStop(0, core);
  disc.addColorStop(0.6, mid);
  disc.addColorStop(1, rim);
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.fill();
}

function lerpColorRgb(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  const ar = (A >> 16) & 255, ag = (A >> 8) & 255, ab = A & 255;
  const br = (B >> 16) & 255, bg = (B >> 8) & 255, bb = B & 255;
  return `rgb(${Math.round(lerp(ar, br, t))},${Math.round(lerp(ag, bg, t))},${Math.round(lerp(ab, bb, t))})`;
}

/**
 * Moon disc motif (`Blech.stempel("mond", ...)`, draw.js:174-183) — disc + soft halo + 3 craters,
 * baked once at a fixed neutral appearance. The old game only ever varies POSITION and
 * `globalAlpha` on this stamp at runtime (visibility fades in at `light<0.75`), never the pixels —
 * so `light` here only nudges the halo a touch warmer/stronger at night, purely cosmetic, and the
 * caller still does the actual visibility fade via sprite alpha.
 */
export function drawMoon(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2.6;
  const haloStrength = 1 + (1 - clamp(light, 0, 1)) * 0.25;
  ctx.save();
  ctx.shadowColor = 'rgba(200,210,255,0.6)';
  ctx.shadowBlur = r * haloStrength;
  ctx.fillStyle = '#e9edff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(160,170,210,0.35)';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.2, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 0.35, cy + r * 0.3, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 0.1, cy - r * 0.5, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * One star motif (draw.js:101-117 `drawStars`, per-star shape only). The old game already applies
 * position (`prnd`-derived) and twinkle-alpha (`sin(time*2+i)`) live per instance on a plain white
 * dot — both are pure multiplies/translates of this one shape, so a single baked dot (scaled 1.1px
 * vs 1.8px by the caller for the "every 5th star is bigger" rule) covers every star.
 */
export function drawStar(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * One cloud motif (`drawClouds`, draw.js:187-218, shape only). `seed` jitters the four puff
 * ellipses' offsets/sizes (deterministic via `prnd`) so a handful of baked variants don't look
 * identical when scattered across the sky — the old game's clouds are literally interchangeable
 * (only x/y/scale differ per instance), so this is a cosmetic upgrade, not a regression.
 *
 * Baked at full opacity/white; the caller applies the old formula's `light`/rain-gloom-driven
 * alpha and grey-tint live via sprite alpha/tint (both are affine in `light`, so no separate bake
 * per light step is needed — same reasoning as the sun/moon/star motifs above).
 */
export function drawCloud(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h) / 3.6;
  const j = (salt: number, spread: number) => (prnd(seed, salt) * 2 - 1) * spread;

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, s * (1.6 + j(1, 0.15)), s * (0.55 + j(2, 0.08)), 0, 0, Math.PI * 2);
  ctx.ellipse(cx - s * 0.7, cy + s * 0.1, s * (0.9 + j(3, 0.12)), s * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + s * 0.7, cy + s * 0.05, s * (1 + j(4, 0.12)), s * 0.5, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + s * 0.1, cy - s * 0.3, s * (0.9 + j(5, 0.1)), s * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(90,105,120,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.3, s * 1.4, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}
