/**
 * Deep sea ("Tiefsee") scenery bakes — ported from the old game's
 * `backdrop.js` (`drawDeepFar`/`_deepFar`, `drawDeepNear`, `drawSeaBed`) and
 * `locations.js` (`drawDeepSpecks`).
 *
 * Same shape of file as `lakeArt.ts`. Mode is `dive`: there is no sky/water
 * split (`horizonY = H*0.05`, near the very top) and `deepSea: true` in the
 * `SceneArt` this feeds — the water shader's deep-sea branch replaces the
 * whole above/below-water pipeline, so `far`/`seabed` here just describe two
 * bands of one continuous water column, not "sky vs. water".
 *
 * === What got baked, and what didn't ===
 *
 * `drawFarScenery` bakes the static canyon-wall silhouettes (2 layers, no
 * `time` term at all in the old code — genuinely static, unlike every other
 * location's far layer). NOT baked: 4 drifting bioluminescent cloud blobs —
 *   cloud i (4): x = (prnd(i,3)*1.2-0.1)*w, y = h*(0.25+prnd(i,4)*0.5) + sin(time*0.15+i)*14,
 *                r = h*(0.10+prnd(i,5)*0.09), color round-robin
 *                ["120,220,255","140,255,200","170,150,255"],
 *                a0 = 0.07+0.03*sin(time*0.5+i), radial gradient a0 -> 0
 *
 * `drawSeabed` bakes the sea floor gradient + the 2 black-smoker chimney
 * silhouettes (their triangular shape never moves — only what comes OUT of
 * them does). NOT baked, all continuously time-varying:
 *   smoker plume i (7 per vent, 2 vents): t = (time*0.22+p/7+i*0.3)%1,
 *     py = floor-h*0.13 - t*h*0.26, px = ventX + sin(t*6+p)*16*t,
 *     r = 4+t*12, color rgba(120,140,165, 0.22*(1-t))
 *   60 deep specks (`drawDeepSpecks`, locations.js:491): drift + pulse, see
 *     that function for the exact formula (called separately by the scene,
 *     not part of this bake)
 *
 * Corals, jellyfish and plankton are reclassified in
 * docs/spec/03-world-visuals.md §1 as "animated (position/shape), halo
 * baked" — i.e. the SHARP shape (branches, tentacles) must be redrawn live
 * every frame (it sways/pulses), but the soft glow around it is a pure
 * multiply of a fixed blurred shape and so is baked ONCE and reused, exactly
 * like `lakeArt.ts`'s `drawSun`/`drawMoon`/`drawStar`/`drawCloud` motifs.
 * `drawCoralGlow`/`drawJellyGlow` below are that halo; `drawCoralBranches`/
 * `drawJellyBody` are the sharp live shape, exported as plain draw helpers
 * (NOT `BakeFn`s — they draw directly at a world position, not into a
 * `(0,0)..(w,h)` box, because the caller places one instance per coral/
 * jellyfish at a live-computed position) for whoever owns the live particle
 * loop to call every frame.
 *
 *   coral i (11): x = prnd(i,11)*w, color round-robin
 *     ["#37e0d8","#7b6bff","#ff5ea8","#5ad4ff","#a8ff6b"],
 *     hgt = h*(0.05+prnd(i,12)*0.07), sway = sin(time*0.8+i)*3,
 *     pulse = 0.5+0.5*sin(time*1.4+i*1.3) — glow tint alpha
 *     `alpha = 0.55+pulse*0.3`; glow radius `hgt*1.9` light-pool additionally
 *     drawn straight into the scene (not a stamp — see backdrop.js's own
 *     comment on why: it's up to 384px wide, cheaper as a plain gradient
 *     fill than as an atlas entry)
 *   plankton i (55): x = ((prnd(i,22)*w+time*sp*18) % (w+40))-20 where
 *     sp = 0.06+prnd(i,21)*0.16, y = prnd(i,23)*h*0.95 + sin(time*0.5+i)*9,
 *     pulse = 0.35+0.65*|sin(time*(0.5+prnd(i,24))+i)|^2, color round-robin
 *     "170,255,220"(1/7) / "180,170,255"(1/5) / else "150,225,255"
 *   jellyfish i (3): x = ((prnd(i,31)*w+time*6)%(w+80))-40,
 *     y = h*(0.2+prnd(i,32)*0.5) + sin(time*0.7+i*2)*18,
 *     r = 11+prnd(i,33)*7, pulse = 0.5+0.5*sin(time*1.6+i)
 */

import { prnd } from './baker';

/**
 * Far scenery: 2 layered canyon-wall silhouettes (`_deepFar`'s static half,
 * backdrop.js:64-82), full screen (`w x h`). `light` is accepted for API
 * symmetry only — the old code never dims these (deep sea is already dark
 * via the location's `dark: 0.6`). NOT drawn here: 4 bioluminescent cloud
 * blobs (see file header).
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  void light;
  for (let layer = 0; layer < 2; layer++) {
    const base = h * (0.55 + layer * 0.18);
    ctx.fillStyle = layer === 0 ? 'rgba(8,18,32,0.75)' : 'rgba(4,10,20,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, base);
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * w;
      const y = base - prnd(i, layer) * h * 0.16 - Math.sin(i * 1.7 + layer) * h * 0.03;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Sea bed + 2 black-smoker chimney silhouettes (`drawSeaBed` +
 * `drawDeepNear`'s static vent shape, backdrop.js:501/156-162), full screen
 * (`w x h`). NOT drawn here: rising plume particles, corals, plankton,
 * jellyfish (see file header).
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
  g.addColorStop(0, 'rgba(16,26,38,0.9)');
  g.addColorStop(0.45, 'rgba(16,26,38,0.9)');
  g.addColorStop(1, 'rgba(2,6,12,0.98)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(16,26,38,0)');
  veil.addColorStop(1, 'rgba(16,26,38,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();

  for (let i = 0; i < 2; i++) {
    const x = w * (0.14 + i * 0.66);
    const bw = 16 + i * 6;
    ctx.fillStyle = 'rgba(10,16,26,0.95)';
    ctx.beginPath();
    ctx.moveTo(x - bw, floor);
    ctx.lineTo(x - bw * 0.35, floor - h * 0.13);
    ctx.lineTo(x + bw * 0.35, floor - h * 0.13);
    ctx.lineTo(x + bw, floor);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Coral glow halo (`_koralleZweige` blurred via `Blech.stempel`, per the
 * `_haloAn`/`_haloAus` device-offset trick in backdrop.js — unnecessary here
 * since we bake straight to an offscreen canvas: `ctx.filter` does the blur
 * directly). Baked ONCE per `(color, budR)` at box-center; the caller scales/
 * positions/alpha-blends the resulting sprite live per coral instance and
 * per pulse phase (old code bakes exactly 2 variants per coral: pulse-min
 * and pulse-max, cross-faded — same idea applies to a Pixi sprite pair).
 */
export function drawCoralGlow(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, blur: number, budR: number): void {
  const cx = w / 2;
  const cy = h * 0.82;
  const hgt = h * 0.62;
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  drawCoralBranches(ctx, cx, cy, 0, hgt, budR);
  ctx.restore();
}

/**
 * The sharp coral branches + bud dots (`_koralleZweige`, backdrop.js:102) —
 * shared by the live sharp draw and the halo bake above. Direct draw at a
 * WORLD position `(cx, cy)` (`cy` = the sea floor at that coral's x), not a
 * boxed `BakeFn` — the caller sets `strokeStyle`/`fillStyle`/`lineWidth`
 * first (see `drawCoralGlow` above for the pattern).
 */
export function drawCoralBranches(ctx: CanvasRenderingContext2D, cx: number, cy: number, sway: number, hgt: number, budR: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + sway, cy - hgt * 0.6, cx + sway * 1.6, cy - hgt);
  ctx.moveTo(cx, cy - hgt * 0.35);
  ctx.quadraticCurveTo(cx - 12 + sway, cy - hgt * 0.6, cx - 16 + sway, cy - hgt * 0.85);
  ctx.moveTo(cx, cy - hgt * 0.5);
  ctx.quadraticCurveTo(cx + 14 + sway, cy - hgt * 0.7, cx + 19 + sway, cy - hgt * 0.9);
  ctx.stroke();
  for (const [bx, by] of [
    [cx + sway * 1.6, cy - hgt],
    [cx - 16 + sway, cy - hgt * 0.85],
    [cx + 19 + sway, cy - hgt * 0.9],
  ] as const) {
    ctx.beginPath();
    ctx.arc(bx, by, budR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Jellyfish glow halo (`_qualleForm` blurred, backdrop.js:296-300), baked
 * once at a fixed mid-pulse reference pose (per the old comment: within an
 * 18px blur the tentacle phase isn't distinguishable from the live pose
 * anyway). The caller positions/tints/alpha-blends it live.
 */
export function drawJellyGlow(ctx: CanvasRenderingContext2D, w: number, h: number, blur = 18): void {
  const cx = w / 2;
  const cy = h * 0.62;
  const r = Math.min(w, h) * 0.32;
  ctx.save();
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = 'rgba(150,200,255,0.55)';
  ctx.strokeStyle = 'rgba(180,220,255,0.5)';
  ctx.lineWidth = 1.4;
  drawJellyBody(ctx, cx, cy, r, r * 0.96, 0);
  ctx.restore();
}

/**
 * The sharp jellyfish dome + 5 tentacles (`_qualleForm`, backdrop.js:118) —
 * shared by the live sharp draw and the halo bake above. Direct draw at a
 * WORLD position `(cx, cy)`; `ph` is the tentacle sway phase (`time*2`).
 */
export function drawJellyBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, domeR: number, ph: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, domeR, Math.PI, 0);
  ctx.fill();
  for (let t = 0; t < 5; t++) {
    const tx = cx - r * 0.7 + t * r * 0.35;
    ctx.beginPath();
    ctx.moveTo(tx, cy);
    ctx.quadraticCurveTo(tx + Math.sin(ph + t) * 5, cy + r * 1.1, tx + Math.sin(ph + t) * 9, cy + r * 2);
    ctx.stroke();
  }
}

/**
 * Plankton dot motif (`Blech.stempel("plankton:...")`, backdrop.js:263) — a
 * single radial-gradient dot at reference size/color, baked once; the
 * caller positions/tints/alpha-pulses it live per point (55 of them, 3
 * colors round-robin — see file header for the exact formula).
 */
export function drawPlanktonDot(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${color},0.75)`);
  g.addColorStop(0.35, `rgba(${color},0.25)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}
