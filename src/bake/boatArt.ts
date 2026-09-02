/**
 * Boat ("Ruderboot · Seemitte") scenery bakes — ported from the old game's
 * `backdrop.js` (`drawOpenWater`/`_openWater`, `drawSeaBed`, `drawBedStones`,
 * `drawDriftParticles`) and `locations.js` (`boatGeom`, `boatHullPath`,
 * `drawBoatUnderwater`, `drawBoat`, `drawBoatFront`).
 *
 * Same shape of file as `lakeArt.ts`: every function draws into the logical
 * `(0,0)..(w,h)` box the caller bakes it at, nothing reads a global.
 *
 * `Korallenriff` ("riff") uses the SAME boat rig (spec §1: "mode boat (same
 * boat rig as Boot)") — the three `drawBoat*` functions below are shared by
 * both locations; only the far/seabed art differs (see `reefArt.ts`).
 *
 * === What got baked, and what didn't (per CLAUDE.md rule 1 + the never-bake
 * list in docs/spec/03-world-visuals.md §6) ===
 *
 * `drawFarScenery` bakes the static half of `_openWater`: the hazy far
 * shoreline and the forested rock island (with its reflection). NOT baked:
 * 3 sailboats drifting/bobbing continuously —
 *   boat i (3): x = w*(0.55+i*0.16) + sin(time*0.1+i*2)*7, sc = 1-i*0.2,
 *               bob = sin(time*0.8+i)*1.4, hull/sail fixed shape at that x/sc/bob
 *
 * `drawSeabed` bakes the sea floor + 6 resting stones (never-moving, like the
 * lake's). NOT baked: drift particles (they scroll horizontally forever) —
 *   particle i (26): x = ((prnd(i,41)*w + time*(4+prnd(i,42)*10)) % (w+20)) - 10,
 *                    y = horizonY + prnd(i,43)*(h-horizonY) + sin(time*0.6+i)*6,
 *                    r = 1+prnd(i,45)*1.6, a = 0.3+0.4*prnd(i,44), color "190,225,245"
 *
 * === The boat itself: an OWN-BOX prop, never baked to a fixed pose =========
 *
 * The old game's Runde-8 lesson (see locations.js's own long comment above
 * `boatGeom`): the hull bobs (`boatY = getWave(boatX)`, continuous) and heels
 * (`heel = sin(time*1.3)*0.018`, continuous) every frame. Baking a canvas
 * PER POSE is exactly the failure CLAUDE.md rule 1 names — it re-bakes ~479
 * of 706 frames.
 *
 * The new renderer doesn't have that problem: position and rotation are
 * free GPU-transform properties of a Pixi `Sprite`, not pixels. So the boat's
 * APPEARANCE (which only depends on `light`, not on heel/bob) is baked ONCE
 * per light step, at rest (heel=0, centered) — and the caller (the scene)
 * sets `.rotation`/`.y` on the sprite every frame instead of redrawing it.
 * That is the fix, not "don't bake the boat" — it's "don't bake the POSE".
 *
 * Three separate boxes, matching the old draw order (each a separate sprite
 * so they can sit in the right place in the layer stack — see scene.ts):
 *   `drawBoatUnderwater` — before the water pass (its silhouette is clipped
 *                          to the draft, i.e. below the waterline already)
 *   `drawBoatTopside`    — hull top + interior + thwarts, before the angler
 *   `drawBoatFront`      — front bulwark + oar, AFTER the angler (he sits
 *                          IN the boat, not on it)
 * NOT baked (both continuously time-varying, draw live on top of the front
 * sprite, at the SAME box-local origin `boatOrigin(w,h)` used below):
 *   3 water rings: rw = L*(0.42+i*0.13), rh = 3+i*2,
 *                  a = 0.4-i*0.11 + sin(time*1.6+i)*0.06, white stroke 1.6px,
 *                  center (originX, originY+3+i*1.5)
 *   hull shadow ellipse on the water (`drawBoat`'s "Spiegelung unter dem
 *   Rumpf") — position depends on the boat's WORLD y, not just its own box,
 *   so it belongs to the scene's reflection layer, not this bake.
 */

import { prnd } from './baker';
import { shadeColor } from './palette';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** `dim()` from `_openWater`/`kulissenLicht()`: darken a base color by how far `light` is below 1. */
function dim(color: string, light: number): string {
  const lf = clamp(light, 0.18, 1);
  return shadeColor(color, -(1 - lf) * 0.55);
}

/** One pine tree, verbatim geometry from `backdrop.js:315` (same as lakeArt's private copy —
 * deliberately not shared cross-file, see palette.ts's header for the same call). */
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

/** This location's horizon line — same fraction every non-dive location uses (spec §7). */
const HORIZON_FRAC = 0.35;

/**
 * Far scenery: the static half of `_openWater` (backdrop.js:552-592) — hazy
 * far shoreline mountains and a forested rock island with its reflection.
 * Full screen (`w x h`). NOT drawn here: 3 sailboats (see file header).
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const hy = h * HORIZON_FRAC;
  const lf = clamp(light, 0.18, 1);

  // Hazy far shoreline, strongly in the haze — a single translucent silhouette.
  ctx.fillStyle = `rgba(126,148,168,${0.3 * lf + 0.1})`;
  ctx.beginPath();
  ctx.moveTo(0, hy);
  for (let i = 0; i <= 9; i++) {
    const px = (i / 9) * w;
    ctx.lineTo(px, hy - 18 - prnd(i, 21) * 30);
  }
  ctx.lineTo(w, hy);
  ctx.closePath();
  ctx.fill();

  // Forested rock island with a rock ridge, not a grey blob.
  const ix = w * 0.17;
  const iw = w * 0.15;
  const rockG = ctx.createLinearGradient(ix - iw, hy - 46, ix + iw, hy);
  rockG.addColorStop(0, dim('#6e7a72', light));
  rockG.addColorStop(1, dim('#3c4a46', light));
  ctx.fillStyle = rockG;
  ctx.beginPath();
  ctx.moveTo(ix - iw, hy + 1);
  ctx.lineTo(ix - iw * 0.55, hy - 26);
  ctx.lineTo(ix - iw * 0.15, hy - 44);
  ctx.lineTo(ix + iw * 0.25, hy - 30);
  ctx.lineTo(ix + iw * 0.7, hy - 36);
  ctx.lineTo(ix + iw, hy + 1);
  ctx.closePath();
  ctx.fill();

  // Trees on the island.
  for (let i = 0; i < 6; i++) {
    const tx = ix - iw * 0.6 + prnd(i, 22) * iw * 1.5;
    const ty = hy - 22 - prnd(i, 23) * 16;
    drawPine(ctx, tx, ty + 6, 16 + prnd(i, 24) * 12, dim('#2c5240', light));
  }

  // Reflection of the island in the water.
  ctx.save();
  ctx.globalAlpha = 0.18 * lf;
  ctx.translate(0, hy * 2);
  ctx.scale(1, -1);
  ctx.fillStyle = dim('#3c4a46', light);
  ctx.beginPath();
  ctx.moveTo(ix - iw, -hy - 1);
  ctx.lineTo(ix - iw * 0.15, -hy + 34);
  ctx.lineTo(ix + iw, -hy - 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Sea bed + 6 resting stones (`drawSeaBed`+`drawBedStones(6,"70,88,92")`,
 * backdrop.js:501/42), full screen (`w x h`). Static: the old game never
 * bakes this either (cheap, few draws). NOT drawn here: drift particles
 * (see file header).
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
  g.addColorStop(0, 'rgba(38,62,66,0.85)');
  g.addColorStop(0.45, 'rgba(38,62,66,0.85)');
  g.addColorStop(1, 'rgba(14,28,36,0.95)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(38,62,66,0)');
  veil.addColorStop(1, 'rgba(38,62,66,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();

  for (let i = 0; i < 6; i++) {
    const x = prnd(i, 96) * w;
    const r = 9 + prnd(i, 97) * 18;
    const base = floor - 2 + Math.sin(i * 0.9 + 1.3) * 5 + prnd(i, 91) * 7;
    const g2 = ctx.createLinearGradient(x - r, base - r * 0.7, x + r, base);
    g2.addColorStop(0, 'rgba(70,88,92,0.7)');
    g2.addColorStop(1, 'rgba(70,88,92,0.35)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(x, base, r, r * 0.6, prnd(i, 98) * 0.4 - 0.2, Math.PI, 0);
    ctx.fill();
  }
}

/**
 * The boat's own box dimensions, derived from a target `w x h` bounding box
 * rather than the old game's `dockWidth`/`dockHeight` globals. Ratio
 * `fb:d = 1.15:1.3` is the old game's constant (both were multiples of the
 * dock's height at that location) — kept so the hull's proportions match.
 *
 * Old hull spans x in [-0.5L, +0.44L] (width 0.94L) and y in [-1.5fb, +0.55d]
 * (height 1.5fb+0.55d) around the boat's world position. This box's origin
 * (0,0)..(w,h) is that same rectangle, just shifted so the top-left corner
 * is (0,0): translate by (+0.5L, +1.5fb) before drawing with the old
 * boat-centered coordinates.
 */
export interface BoatDims { L: number; fb: number; d: number; originX: number; originY: number }

export function boatDims(w: number, h: number): BoatDims {
  const k = 1.15 / 1.3;
  const d = h / (1.5 * k + 0.55);
  const fb = k * d;
  const L = w / 0.94;
  return { L, fb, d, originX: 0.5 * L, originY: 1.5 * fb };
}

/** Hull outline (`boatHullPath`, locations.js:219), boat-centered coordinates. */
function boatHullPath(ctx: CanvasRenderingContext2D, L: number, fb: number, d: number): void {
  ctx.beginPath();
  ctx.moveTo(-L * 0.5, -fb * 1.5);
  ctx.quadraticCurveTo(-L * 0.12, -fb * 0.82, L * 0.42, -fb * 1.12);
  ctx.lineTo(L * 0.44, -fb * 1.12);
  ctx.lineTo(L * 0.44, d * 0.55);
  ctx.quadraticCurveTo(L * 0.05, d * 1.05, -L * 0.3, d * 0.45);
  ctx.quadraticCurveTo(-L * 0.44, d * 0.1, -L * 0.5, -fb * 1.5);
  ctx.closePath();
}

/**
 * Underwater hull (`drawBoatUnderwater`, locations.js:236) — the part of the
 * hull silhouette below the waterline (clipped to `y in [0, 2d]`), drawn
 * BEFORE the water pass. Own box, at rest (no heel/bob baked in — see file
 * header): the caller positions/rotates the resulting sprite live.
 */
export function drawBoatUnderwater(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const { L, fb, d, originX, originY } = boatDims(w, h);
  ctx.save();
  ctx.translate(originX, originY);
  ctx.beginPath();
  ctx.rect(-L, 0, L * 2, d * 2);
  ctx.clip();
  boatHullPath(ctx, L, fb, d);
  const uw = ctx.createLinearGradient(0, 0, 0, d);
  uw.addColorStop(0, dim('#5c3a19', light));
  uw.addColorStop(1, dim('#3a2410', light));
  ctx.fillStyle = uw;
  ctx.fill();
  ctx.restore();
}

/**
 * Topside hull, interior and thwarts (`drawBoat`, locations.js:248, renamed
 * to distinguish it from the module) — drawn AFTER the water pass but
 * BEFORE the angler, so he appears seated inside. Own box, at rest.
 */
export function drawBoatTopside(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const { L, fb, d, originX, originY } = boatDims(w, h);
  ctx.save();
  ctx.translate(originX, originY);

  // --- everything above the waterline ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(-L, -fb * 3, L * 2, fb * 3);
  ctx.clip();
  boatHullPath(ctx, L, fb, d);
  const hull = ctx.createLinearGradient(0, -fb * 1.5, 0, 0);
  hull.addColorStop(0, dim('#c08a4c', light));
  hull.addColorStop(0.55, dim('#96632f', light));
  hull.addColorStop(1, dim('#6e4520', light));
  ctx.fillStyle = hull;
  ctx.fill();
  // Plank seams follow the sheer line.
  ctx.strokeStyle = 'rgba(60,34,14,0.32)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    const off = i * fb * 0.4;
    ctx.beginPath();
    ctx.moveTo(-L * 0.48, -fb * 1.5 + off);
    ctx.quadraticCurveTo(-L * 0.12, -fb * 0.82 + off, L * 0.43, -fb * 1.12 + off);
    ctx.stroke();
  }
  ctx.restore();

  // Interior (dark — the angler sits in front of it).
  ctx.fillStyle = dim('#3a2310', light);
  ctx.beginPath();
  ctx.moveTo(-L * 0.4, -fb * 1.16);
  ctx.quadraticCurveTo(-L * 0.1, -fb * 0.72, L * 0.36, -fb * 0.96);
  ctx.lineTo(L * 0.36, -fb * 1.05);
  ctx.quadraticCurveTo(-L * 0.1, -fb * 0.82, -L * 0.4, -fb * 1.26);
  ctx.closePath();
  ctx.fill();

  // Thwarts (seat benches).
  ctx.fillStyle = dim('#7a5228', light);
  ctx.fillRect(-L * 0.34, -fb * 1.08, L * 0.16, fb * 0.16);
  ctx.fillRect(-L * 0.1, -fb * 0.95, L * 0.3, fb * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(-L * 0.1, -fb * 0.95, L * 0.3, fb * 0.05);
  ctx.restore();
}

/**
 * Front bulwark, oar and scuff rail (`drawBoatFront`, locations.js:295) —
 * drawn AFTER the angler, so the wall hides his legs and he reads as seated
 * IN the boat rather than on top of it. Own box, at rest. NOT drawn here:
 * the 3 pulsing water rings (see file header — live, same box-local origin).
 */
export function drawBoatFront(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const { L, fb, d, originX, originY } = boatDims(w, h);
  ctx.save();
  ctx.translate(originX, originY);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-L * 0.5, -fb * 1.5);
  ctx.quadraticCurveTo(-L * 0.12, -fb * 0.82, L * 0.44, -fb * 1.12);
  ctx.lineTo(L * 0.44, d * 0.55);
  ctx.quadraticCurveTo(L * 0.05, d * 1.05, -L * 0.3, d * 0.45);
  ctx.quadraticCurveTo(-L * 0.44, d * 0.1, -L * 0.5, -fb * 1.5);
  ctx.closePath();
  ctx.clip();
  const front = ctx.createLinearGradient(0, -fb * 1.6, 0, d * 0.8);
  front.addColorStop(0, dim('#b8834a', light));
  front.addColorStop(0.45, dim('#8a5a2a', light));
  front.addColorStop(1, dim('#5c3a18', light));
  ctx.fillStyle = front;
  ctx.fillRect(-L, -fb * 3, L * 2, fb * 6);
  ctx.strokeStyle = 'rgba(60,34,14,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const off = -fb * 0.55 + i * fb * 0.45;
    ctx.beginPath();
    ctx.moveTo(-L * 0.5, off - fb * 0.6);
    ctx.quadraticCurveTo(-L * 0.12, off + fb * 0.08, L * 0.44, off - fb * 0.25);
    ctx.stroke();
  }
  ctx.restore();

  // Inside face just under the sheer line (depth cue).
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-L * 0.5, -fb * 1.5);
  ctx.quadraticCurveTo(-L * 0.12, -fb * 0.82, L * 0.44, -fb * 1.12);
  ctx.lineTo(L * 0.44, d);
  ctx.lineTo(-L * 0.5, d);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(50,28,10,0.5)';
  ctx.lineWidth = Math.max(3, fb * 0.3);
  ctx.beginPath();
  ctx.moveTo(-L * 0.5, -fb * 1.42);
  ctx.quadraticCurveTo(-L * 0.12, -fb * 0.74, L * 0.44, -fb * 1.04);
  ctx.stroke();
  ctx.restore();

  // Scuff rail on the sheer line.
  ctx.strokeStyle = dim('#d9a463', light);
  ctx.lineWidth = Math.max(2.5, fb * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-L * 0.48, -fb * 1.48);
  ctx.quadraticCurveTo(-L * 0.12, -fb * 0.82, L * 0.43, -fb * 1.12);
  ctx.stroke();

  // Oar, blade dipping into the water.
  ctx.strokeStyle = dim('#7a5228', light);
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(L * 0.18, -fb * 1.25);
  ctx.lineTo(L * 0.52, d * 0.3);
  ctx.stroke();
  ctx.save();
  ctx.translate(L * 0.55, d * 0.45);
  ctx.rotate(0.5);
  ctx.fillStyle = dim('#6b451f', light);
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.5, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = dim('#4a3018', light);
  ctx.beginPath();
  ctx.arc(L * 0.2, -fb * 1.1, 2.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
