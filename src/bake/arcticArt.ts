/**
 * Arctic ("Eisloch · Arktis") scenery bakes — ported from the old game's
 * `backdrop.js` (`drawIcebergs`/`_icebergs`, `_polarlicht`, `drawSeaBed`,
 * `drawBedStones`, `drawIceUnderside`) and `locations.js` (`drawIce`).
 *
 * Same shape of file as `lakeArt.ts`.
 *
 * === Far scenery: NOT split into a static/animated half ====================
 *
 * Every other location's far layer uses `Blech.zweiteilig` (static base +
 * live top). Arctic can't: the old code's own comment says why — the aurora
 * (`_polarlicht`) is animated AND sits BEHIND the snowfield/icebergs, and
 * `zweiteilig` always draws its live half ON TOP of the baked half. So the
 * old game draws the aurora by hand first, then bakes the icebergs whole
 * (`Blech.bild`, no live half at all — nothing in `_icebergs` reads `time`).
 *
 * `drawFarScenery` below is exactly that whole-icebergs bake. The aurora is
 * NOT included — it must be drawn BEHIND it, which `SceneArt`'s current
 * layer stack (far → mid → seabed → …) has no slot for below `far`. Flagged
 * for whoever owns `world/scene.ts`: either a new slot under `far`, or the
 * aurora becomes part of the sky gradient strip. Formula, only when
 * `light < 0.55`:
 *   band i (3): x = w*(0.15+i*0.3), color i===1 ? "120,255,190" : "140,200,255",
 *     wobble = sin(time*0.4+i)*22, vertical gradient 0 -> a -> 0 where
 *     a = 0.13*(1-light) + 0.04*sin(time*0.5+i), band from y=hy*0.1 to hy*0.85,
 *     shape splays outward at the bottom by ±wobble
 *
 * === What else got baked, and what didn't ===
 *
 * `drawNearScenery` bakes the ice sheet itself (gradient, wavy top edge,
 * waterline band, crack hatching) — full width, ABOVE the water pass and so
 * never veiled (it's the physical ice, not something seen through water).
 * Deliberately does NOT include the hole: `iceHoleX()` tracks the rod tip
 * (a live gameplay value) and its radius shrinks via `iceHole` (0..1, closes
 * over time per mechanics.js) — neither can be part of a bake keyed only on
 * `light`. Draw the hole live, on top, each frame:
 *   holeX = rodTipX (world x), holeY = topOfBox + boxHeight*0.6*(deck band),
 *   holeRX = max(dockWidthUnit*0.12, w*0.07) * open, holeRY = deckUnit*0.5*open
 *   (fill `#0a2a3a`; when `open<0.99` also draw a widening frozen rim + 5
 *   jagged ice-chunk triangles at the rim, see `drawIce`, locations.js:437-452)
 * The stool and igloo are separate own-box props below (`drawStool`,
 * `drawIgloo`) — like the dock's bucket, they compose against their own
 * small box, not the ice sheet's full width.
 *
 * `drawSeabed` bakes the sea floor + 5 resting stones + the hanging icicles
 * (`drawIceUnderside` — genuinely static, no `time` term in the old code
 * either). NOT baked: drift particles —
 *   particle i (30): x = ((prnd(i,41)*w + time*(4+prnd(i,42)*10)) % (w+20)) - 10,
 *                    y = horizonY + prnd(i,43)*(h-horizonY) + sin(time*0.6+i)*6,
 *                    r = 1+prnd(i,45)*1.6, a = 0.3+0.4*prnd(i,44), color "225,245,255"
 *
 * Snow (`updateSnow`/`drawSnow`, locations.js:503) is this location's stand-
 * in weather precipitation, not scenery — out of scope here (owned by
 * whatever runs the weather/particle system), noted for completeness only.
 */

import { prnd } from './baker';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const HORIZON_FRAC = 0.35;

/**
 * Far scenery: the whole `_icebergs` bake (backdrop.js:845-886) — snowfield
 * silhouette + 4 icebergs (sunlit facet, shadow flank, turquoise waterline
 * edge, reflection). Full screen (`w x h`). The aurora is NOT here (see file
 * header — it belongs behind this layer).
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const hy = h * HORIZON_FRAC;
  const lf = clamp(light, 0, 1);

  ctx.fillStyle = `rgba(206,228,240,${0.4 * lf + 0.25})`;
  ctx.beginPath();
  ctx.moveTo(0, hy + 2);
  for (let i = 0; i <= 12; i++) ctx.lineTo((i / 12) * w, hy - 10 - prnd(i, 76) * 18);
  ctx.lineTo(w, hy + 2);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 4; i++) {
    const x = prnd(i, 71) * w;
    const bw = 30 + prnd(i, 72) * 55;
    const bh = 26 + prnd(i, 73) * 48;
    const peakX = x + bw * 0.1;
    const peakY = hy - bh;
    const g = ctx.createLinearGradient(x - bw, peakY, x + bw, hy);
    g.addColorStop(0, `rgba(250,253,255,${0.85 * lf + 0.15})`);
    g.addColorStop(0.5, `rgba(222,239,248,${0.8 * lf + 0.15})`);
    g.addColorStop(1, `rgba(150,186,208,${0.8 * lf + 0.15})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - bw, hy + 2);
    ctx.lineTo(x - bw * 0.55, hy - bh * 0.45);
    ctx.lineTo(x - bw * 0.3, hy - bh * 0.72);
    ctx.lineTo(peakX, peakY);
    ctx.lineTo(x + bw * 0.5, hy - bh * 0.45);
    ctx.lineTo(x + bw * 0.75, hy - bh * 0.6);
    ctx.lineTo(x + bw, hy + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `rgba(120,160,190,${0.32 * lf + 0.1})`;
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(x + bw * 0.5, hy - bh * 0.45);
    ctx.lineTo(x + bw, hy + 2);
    ctx.lineTo(x + bw * 0.2, hy + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = `rgba(120,220,235,${0.3 * lf + 0.12})`;
    ctx.fillRect(x - bw, hy - 4, bw * 2, 6);

    ctx.save();
    ctx.globalAlpha = 0.16 * lf;
    ctx.translate(0, hy * 2);
    ctx.scale(1, -1);
    ctx.fillStyle = '#cfe6f2';
    ctx.beginPath();
    ctx.moveTo(x - bw, -hy - 2);
    ctx.lineTo(peakX, -hy + bh * 0.5);
    ctx.lineTo(x + bw, -hy - 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Thickness of the baked ice band, and its top/bottom in FULL-SCREEN
 * coordinates (matching the convention every far/seabed function in this
 * file group uses — `h` is always the whole canvas height, never a band's
 * own height). The ice sits right where a dock/pier would, straddling the
 * horizon line. Exported so `game/locationsArt.ts` can position the live
 * hole overlay and the water shader's `lid` at the same seam.
 */
export function iceBand(h: number): { top: number; bot: number } {
  const top = h * HORIZON_FRAC - h * 0.01;
  return { top, bot: top + h * 0.16 };
}

/**
 * The ice sheet itself (`drawIce`, locations.js:406, minus the hole — see
 * file header), full screen (`w x h`), drawn ABOVE the water pass so it is
 * never veiled. Gradient, a gently wavy top edge, the waterline band where
 * it meets the water, and faint crack hatching.
 */
export function drawNearScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  void light;
  const { top: iceTop, bot: iceBot } = iceBand(h);
  const bandH = iceBot - iceTop;
  const g = ctx.createLinearGradient(0, iceTop, 0, iceBot);
  g.addColorStop(0, '#f2f9fd');
  g.addColorStop(0.55, '#e3f0f8');
  g.addColorStop(1, '#c3dbe8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, iceTop + bandH * 0.25);
  for (let x = 0; x <= w; x += w / 12) {
    ctx.lineTo(x, iceTop + bandH * (0.25 + 0.12 * Math.sin(x * 0.021)));
  }
  ctx.lineTo(w, iceBot);
  ctx.lineTo(0, iceBot);
  ctx.closePath();
  ctx.fill();

  // Waterline band at the ice's underside.
  ctx.fillStyle = 'rgba(150,195,215,0.75)';
  ctx.fillRect(0, iceBot - bandH * 0.3, w, bandH * 0.3);

  // Crack hatching.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    const sx = ((i * 137) % 100) / 100 * w;
    const sy = iceTop + bandH * (0.45 + ((i * 53) % 40) / 100);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 10 + (i % 3) * 7, sy + 1.5);
    ctx.stroke();
  }
}

/**
 * Sea bed + 5 resting stones + hanging icicles (`drawSeaBed` +
 * `drawBedStones(5,"96,116,128")` + `drawIceUnderside`, backdrop.js:501/42/
 * 888), full screen (`w x h`). Static, never bakes in the old game either.
 * NOT drawn here: drift particles (see file header).
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
  g.addColorStop(0, 'rgba(58,78,90,0.85)');
  g.addColorStop(0.45, 'rgba(58,78,90,0.85)');
  g.addColorStop(1, 'rgba(16,30,40,0.95)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(58,78,90,0)');
  veil.addColorStop(1, 'rgba(58,78,90,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();

  for (let i = 0; i < 5; i++) {
    const x = prnd(i, 96) * w;
    const r = 9 + prnd(i, 97) * 18;
    const base = floor - 2 + Math.sin(i * 0.9 + 1.3) * 5 + prnd(i, 91) * 7;
    const g2 = ctx.createLinearGradient(x - r, base - r * 0.7, x + r, base);
    g2.addColorStop(0, 'rgba(96,116,128,0.7)');
    g2.addColorStop(1, 'rgba(96,116,128,0.35)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(x, base, r, r * 0.6, prnd(i, 98) * 0.4 - 0.2, Math.PI, 0);
    ctx.fill();
  }

  // Icicles hanging from the ice ceiling, just under the ice band (see
  // `iceBand` / `drawNearScenery` above — same seam the water `lid` uses).
  const y0 = iceBand(h).bot;
  ctx.fillStyle = 'rgba(190,224,240,0.5)';
  for (let i = 0; i < 16; i++) {
    const x = prnd(i, 81) * w;
    const len = 8 + prnd(i, 82) * 26;
    const wdt = 4 + prnd(i, 83) * 6;
    ctx.beginPath();
    ctx.moveTo(x - wdt, y0);
    ctx.lineTo(x, y0 + len);
    ctx.lineTo(x + wdt, y0);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The stool (`drawIce`'s `#3a3a44` blocks, locations.js:455), own box — a
 * small platform-adjacent prop, sized independently of the ice sheet's full
 * width for the same reason `makeDock` exists.
 */
export function drawStool(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, w, h * 0.25);
  ctx.fillRect(w * 0.1, h * 0.25, w * 0.2, h * 0.75);
  ctx.fillRect(w * 0.7, h * 0.25, w * 0.2, h * 0.75);
}

/**
 * The igloo silhouette (`drawIce`'s dome, locations.js:458), own box.
 */
export function drawIgloo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#f4fafd';
  ctx.beginPath();
  ctx.arc(w * 0.5, h, w * 0.5, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#2a4a5a';
  ctx.beginPath();
  ctx.arc(w * 0.32, h, w * 0.16, Math.PI, 0);
  ctx.fill();
}
