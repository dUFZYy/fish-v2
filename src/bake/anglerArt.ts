/**
 * Angler + tackle bakes — ported from the old game's `draw.js` (`_drawAngler`,
 * `drawHat`, `_drawRod`, `drawBobberSkin`, `drawHook`) and the rod-bend/line-sag
 * maths (`drawRod`/`drawLine`, draw.js:558-718).
 *
 * The old game drew one fused figure every frame from live globals
 * (`rodBaseX`, `bobberX`, `gameState`, ...). Here the figure is split into
 * independently-baked PIECES — body, head (×4 moods), arm, hat (×16 ids), rod
 * shaft, bobber (×11 skins), hook — each a plain `(ctx, w, h, ...) => void`
 * function that draws into its own local box, plus small `*Attach()` helper
 * functions that report where (in that same box's pixel space) the piece's
 * joints sit, so a scene assembler can position/rotate pieces independently
 * (rod bend, arm reaching for a moving rod tip, hat swapped without
 * re-baking the head, etc.) instead of re-rastering the whole angler.
 *
 * === Bake-once vs must-animate-live (docs/spec/03-world-visuals.md §4/§10) ===
 *  - `drawAnglerBody`/`drawAnglerHead`/`drawArm` are baked AT REST on a fixed
 *    platform (dock/pier/ice) — matching the spec's explicit rule. The idle
 *    "breathe" offset (`sin(time*1.6)*s*0.03` in the original) is deliberately
 *    NOT baked into these pixels (baking continuous motion is exactly the
 *    failure CLAUDE.md rule 1 and the old game's "Runde 8" post-mortem
 *    describe — 474 re-bakes in 706 frames once sub-pixel position entered the
 *    cache key). The caller applies that offset live as a translate on the
 *    torso+head container. The spec also says the angler must be drawn LIVE
 *    (not from these bakes) whenever in a boat — these functions remain usable
 *    there too, just called every frame instead of cached.
 *  - `drawRod` bakes a STRAIGHT shaft at `bend=0`. Actual bending is a runtime
 *    mesh deformation along `rodBendCurve()` below, sampling this texture by
 *    its length (u = 0..1, grip -> tip) — never a re-bake per bend amount.
 *    Per the never-bake list, a rod using a `rainbow`/`glow`/`gamma` skin, or
 *    one that is actively bending/reeling-fast/in-boat, must be re-invoked
 *    live every frame instead of cached in an atlas; this same function is
 *    fine to call either way, only the CALLER's cache-vs-live choice differs.
 *  - `drawBobber` bakes a static reference frame for every skin, including the
 *    two that are continuously animated in the original (`rainbow`: hue-cycle,
 *    `disco`: rotating mirror facets). Both are baked at their t=0 look; if a
 *    live shimmer is wanted, re-invoke live (bobbers are tiny, cheap either way)
 *    or apply a runtime hue-rotate filter over the baked "rainbow" sprite.
 *  - `drawHook` has no state at all (the old game only draws it when NOT
 *    reeling — the bake is unconditionally safe).
 */

import { shadeColor } from './palette';
import type { OutfitItem, RodSkinItem, BobberItem } from '@/data/items';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Pt {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Body + legs (draw.js:334-511, minus head/arms/hat — those are their own
// sprites below). Torso top (collar) is `body-origin.y - 2.35*s`; feet sit at
// `body-origin.y + ~1.3*s`. `anglerBodyAttach` reports where (in a `w x h` box)
// that origin sits, plus the joints other pieces need to line up with it, all
// as a fraction of the box so it's independent of how big the caller bakes it.
// ---------------------------------------------------------------------------

function bodyFit(w: number, h: number): { x: number; y: number; s: number } {
  return { x: w * 0.66, y: h * 0.94, s: h / 4.3 };
}

export interface AnglerBodyAttach {
  /** shoulder joint, where `drawArm`'s own shoulder anchor should be placed */
  shoulder: Pt;
  /** resting hand of the idle (non-rod) arm, baked as part of the body itself */
  idleHand: Pt;
  /** head/neck attach point — place `drawAnglerHead`'s own `center` here */
  headCenter: Pt;
  headRadius: number;
}

export function anglerBodyAttach(w: number, h: number): AnglerBodyAttach {
  const { x, y, s } = bodyFit(w, h);
  return {
    shoulder: { x: x - 0.5 * s, y: y - 1.83 * s },
    idleHand: { x: x - 0.98 * s, y: y - 0.42 * s },
    headCenter: { x: x - 0.3 * s, y: y - 2.95 * s },
    headRadius: 0.58 * s,
  };
}

/** Torso + legs + collar + the idle (non-rod) arm. No head, no rod-holding arm, no hat. */
export function drawAnglerBody(ctx: CanvasRenderingContext2D, w: number, h: number, light: number, outfit: OutfitItem): void {
  const { x, y, s } = bodyFit(w, h);
  const dl = clamp(light, 0, 1);
  const dark = (c: string) => shadeColor(c, -(0.24 + 0.1 * (1 - dl)));
  const lightC = (c: string) => shadeColor(c, 0.12 + 0.14 * dl);
  const ty = y - s * 2.35; // torso top; no `breathe` term — see file header.

  // Contact shadow.
  const sh = ctx.createRadialGradient(x - s * 0.2, y + s * 0.05, s * 0.1, x - s * 0.2, y + s * 0.05, s * 1.4);
  sh.addColorStop(0, `rgba(0,0,0,${0.16 + 0.12 * dl})`);
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(x - s * 0.2, y + s * 0.05, s * 1.4, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // One continuous leg path hip->knee->shin->boot, called twice (back darker, front lit).
  const leg = (ox: number, oy: number, tone: string) => {
    const hx0 = x + ox * s, hy0 = y - s * 0.5 + oy * s;
    const kx = hx0 - s * 0.62, ky = y - s * 0.34 + oy * s;
    const ax = kx + s * 0.08, ay = y + s * 1.18 + oy * s;
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.moveTo(hx0 + s * 0.3, hy0 - s * 0.16);
    ctx.quadraticCurveTo(kx + s * 0.1, ky - s * 0.34, kx - s * 0.22, ky - s * 0.1);
    ctx.quadraticCurveTo(kx - s * 0.3, ky + s * 0.15, ax - s * 0.2, ay - s * 0.05);
    ctx.lineTo(ax + s * 0.2, ay);
    ctx.quadraticCurveTo(kx + s * 0.16, ky + s * 0.42, hx0 + s * 0.16, hy0 + s * 0.42);
    ctx.quadraticCurveTo(hx0 + s * 0.42, hy0 + s * 0.3, hx0 + s * 0.3, hy0 - s * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = dark(tone);
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(kx - s * 0.16, ky + s * 0.05);
    ctx.quadraticCurveTo(kx, ky + s * 0.16, kx + s * 0.1, ky + s * 0.34);
    ctx.stroke();
    ctx.strokeStyle = lightC(tone);
    ctx.lineWidth = Math.max(1, s * 0.055);
    ctx.beginPath();
    ctx.moveTo(kx - s * 0.24, ky - s * 0.02);
    ctx.quadraticCurveTo(kx - s * 0.28, ky + s * 0.5, ax - s * 0.18, ay - s * 0.1);
    ctx.stroke();
    ctx.fillStyle = tone === outfit.pants ? '#2a2a2e' : '#232327';
    ctx.beginPath();
    ctx.moveTo(ax - s * 0.22, ay - s * 0.1);
    ctx.lineTo(ax + s * 0.22, ay - s * 0.06);
    ctx.quadraticCurveTo(ax + s * 0.3, ay + s * 0.22, ax + s * 0.14, ay + s * 0.28);
    ctx.lineTo(ax - s * 0.52, ay + s * 0.28);
    ctx.quadraticCurveTo(ax - s * 0.6, ay + s * 0.1, ax - s * 0.26, ay + s * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3b2a';
    ctx.fillRect(ax - s * 0.56, ay + s * 0.24, s * 0.76, s * 0.09);
  };
  leg(-0.42, 0.12, dark(outfit.pants));
  leg(-0.62, 0, outfit.pants);

  // Torso silhouette.
  const torso = () => {
    ctx.beginPath();
    ctx.moveTo(x + s * 0.52, y + s * 0.05);
    ctx.quadraticCurveTo(x + s * 0.72, y - s * 1.2, x + s * 0.32, ty + s * 0.42);
    ctx.quadraticCurveTo(x + s * 0.22, ty + s * 0.05, x - s * 0.18, ty);
    ctx.quadraticCurveTo(x - s * 0.75, ty + s * 0.12, x - s * 0.82, ty + s * 0.85);
    ctx.quadraticCurveTo(x - s * 0.88, y - s * 1.05, x - s * 1.02, y - s * 0.52);
    ctx.quadraticCurveTo(x - s * 0.6, y - s * 0.14, x - s * 0.2, y - s * 0.08);
    ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.12, x + s * 0.52, y + s * 0.05);
    ctx.closePath();
  };
  const jg = ctx.createLinearGradient(x - s * 1.0, 0, x + s * 0.7, 0);
  jg.addColorStop(0, lightC(outfit.body));
  jg.addColorStop(0.5, outfit.body);
  jg.addColorStop(1, dark(outfit.body));
  ctx.fillStyle = jg;
  torso();
  ctx.fill();

  ctx.save();
  torso();
  ctx.clip();
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = Math.max(1, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.52, ty + s * 0.28);
  ctx.quadraticCurveTo(x - s * 0.72, y - s * 1.4, x - s * 0.72, y - s * 0.3);
  ctx.stroke();
  ctx.strokeStyle = `rgba(0,0,0,${0.14 + 0.06 * dl})`;
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y - s * 0.75);
  ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.55, x + s * 0.32, y - s * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y - s * 1.25);
  ctx.quadraticCurveTo(x, y - s * 1.1, x + s * 0.35, y - s * 1.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, ty + s * 0.75);
  ctx.quadraticCurveTo(x, ty + s * 0.9, x + s * 0.25, ty + s * 0.8);
  ctx.stroke();
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.roundRect(x - s * 0.62, y - s * 1.05, s * 0.42, s * 0.36, s * 0.06);
  ctx.stroke();
  if (outfit.stripe) {
    ctx.fillStyle = outfit.stripe;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.78, y - s * 1.55);
    ctx.quadraticCurveTo(x - s * 0.1, y - s * 1.35, x + s * 0.5, y - s * 1.5);
    ctx.lineTo(x + s * 0.5, y - s * 1.34);
    ctx.quadraticCurveTo(x - s * 0.1, y - s * 1.19, x - s * 0.8, y - s * 1.39);
    ctx.closePath();
    ctx.fill();
    for (const k of [0.75, 1.15, 1.85]) {
      ctx.beginPath();
      ctx.arc(x - s * 0.6, ty + s * k, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (outfit.pattern === 'flowers') {
    ctx.fillStyle = '#ffe066';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(x - s * 0.6 + (i % 3) * s * 0.45, ty + s * 0.6 + Math.floor(i / 3) * s * 0.7 + (i % 2) * s * 0.15, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = `rgba(255,246,220,${0.12 + 0.22 * dl})`;
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y - s * 0.15);
  ctx.quadraticCurveTo(x + s * 0.68, y - s * 1.2, x + s * 0.28, ty + s * 0.42);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.32, ty + s * 0.22, s * 0.42, s * 0.2, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (outfit.fur) {
    ctx.fillStyle = '#f7f3ee';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.2, ty + s * 0.1, s * 0.62, s * 0.26, -0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = lightC(outfit.body);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.58, ty + s * 0.14);
  ctx.quadraticCurveTo(x - s * 0.3, ty + s * 0.42, x + s * 0.05, ty + s * 0.16);
  ctx.lineTo(x + 0, ty - s * 0.02);
  ctx.quadraticCurveTo(x - s * 0.3, ty + s * 0.2, x - s * 0.56, ty - 0);
  ctx.closePath();
  ctx.fill();

  // Idle (non-rod) arm: a simple stroke from torso to a resting hand on the knee.
  ctx.strokeStyle = shadeColor(outfit.body, -0.12);
  ctx.lineWidth = s * 0.28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y - s * 0.85);
  ctx.quadraticCurveTo(x - s * 0.6, y - s * 0.55, x - s * 0.9, y - s * 0.48);
  ctx.stroke();
  ctx.fillStyle = outfit.skin;
  ctx.beginPath();
  ctx.ellipse(x - s * 0.98, y - s * 0.42, s * 0.18, s * 0.14, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Head (draw.js:437-470). 4 moods; the old game's 5th ("calm", used whenever
// none of the other 4 apply) is folded into "grin" here at the caller's
// discretion — the scene maps `GamePhase` to one of exactly these 4.
// ---------------------------------------------------------------------------

export type AnglerMood = 'surprised' | 'focused' | 'grin' | 'pout';

function headFit(w: number, h: number): { hx: number; hy: number; hr: number } {
  const hr = h / 3.6;
  return { hx: w / 2, hy: h * 0.583, hr };
}

export interface AnglerHeadAttach {
  center: Pt;
  radius: number;
}
export function anglerHeadAttach(w: number, h: number): AnglerHeadAttach {
  const { hx, hy, hr } = headFit(w, h);
  return { center: { x: hx, y: hy }, radius: hr };
}

/** Neck stub + skull + ear/nose/hair + mood-driven face. No hat (see `drawHat`). */
export function drawAnglerHead(ctx: CanvasRenderingContext2D, w: number, h: number, light: number, mood: AnglerMood, skin = '#e9c3a0'): void {
  const { hx, hy, hr } = headFit(w, h);
  const dl = clamp(light, 0, 1);
  const dark = (c: string) => shadeColor(c, -(0.24 + 0.1 * (1 - dl)));
  const lightC = (c: string) => shadeColor(c, 0.12 + 0.14 * dl);

  // Neck: a trapezoid growing from the collar line, widening toward the shoulders.
  const neckTop = hy + hr * 0.55;
  const neckBottom = neckTop + hr * 0.86;
  ctx.fillStyle = dark(skin);
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.4, neckTop);
  ctx.lineTo(hx + hr * 0.4, neckTop);
  ctx.lineTo(hx + hr * 0.52, neckBottom);
  ctx.lineTo(hx - hr * 0.52, neckBottom);
  ctx.closePath();
  ctx.fill();

  // Skull.
  const sg = ctx.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, hr * 0.2, hx, hy, hr);
  sg.addColorStop(0, lightC(skin));
  sg.addColorStop(1, dark(skin));
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(hx + hr * 0.95, hy + hr * 0.05, hr * 0.2, 0, Math.PI * 2);
  ctx.fill(); // ear
  ctx.fillStyle = dark(skin);
  ctx.beginPath();
  ctx.arc(hx - hr * 0.98, hy + hr * 0.15, hr * 0.13, 0, Math.PI * 2);
  ctx.fill(); // nose

  // Hair + sideburn + eyebrow.
  ctx.fillStyle = '#4a3222';
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 0.98, Math.PI * 1.08, Math.PI * 1.92);
  ctx.lineTo(hx + hr * 0.75, hy - hr * 0.45);
  ctx.lineTo(hx - hr * 0.75, hy - hr * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(hx + hr * 0.85, hy - hr * 0.2, hr * 0.18, hr * 0.4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a3222';
  ctx.lineWidth = Math.max(1, hr * 0.1);
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.6, hy - hr * 0.38);
  ctx.lineTo(hx - hr * 0.15, hy - hr * 0.42);
  ctx.stroke();

  // Face.
  const ex = hx - hr * 0.35, ey = hy - hr * 0.1;
  ctx.fillStyle = '#2b2f3a';
  if (mood === 'surprised') {
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.08, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === 'focused') {
    ctx.fillRect(ex - hr * 0.16, ey - hr * 0.03, hr * 0.32, hr * 0.09);
  } else {
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#8a5a48';
  ctx.lineWidth = Math.max(1, hr * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'grin') ctx.arc(hx - hr * 0.25, hy + hr * 0.25, hr * 0.28, 0.15, Math.PI - 0.4);
  else if (mood === 'pout') ctx.arc(hx - hr * 0.25, hy + hr * 0.6, hr * 0.25, Math.PI + 0.4, Math.PI * 2 - 0.15);
  else if (mood === 'surprised') ctx.arc(hx - hr * 0.3, hy + hr * 0.4, hr * 0.12, 0, Math.PI * 2);
  else {
    ctx.moveTo(hx - hr * 0.5, hy + hr * 0.4);
    ctx.lineTo(hx - hr * 0.1, hy + hr * 0.42);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Rod-holding arm (draw.js:471-506, minus the shadow it casts onto the
// jacket — that decal has no jacket to land on once the arm is its own
// sprite; the body's own rim-light/collar-shadow pass already sells the
// contact). Static bent pose: at this location the hand always lands on the
// same rod-grip point relative to the body, so a fixed bend needs no runtime
// IK — see the file header's "bake once" note.
// ---------------------------------------------------------------------------

function armFit(w: number, h: number): { shoulder: Pt; s: number } {
  return { shoulder: { x: w * 0.78, y: h * 0.12 }, s: h / 2.1 };
}

export interface ArmAttach {
  shoulder: Pt;
  elbow: Pt;
  hand: Pt;
}
export function armAttach(w: number, h: number): ArmAttach {
  const { shoulder, s } = armFit(w, h);
  return {
    shoulder,
    elbow: { x: shoulder.x - 0.48 * s, y: shoulder.y + 1.1 * s },
    hand: { x: shoulder.x - 0.54 * s, y: shoulder.y + 1.29 * s },
  };
}

export function drawArm(ctx: CanvasRenderingContext2D, w: number, h: number, light: number, outfit: OutfitItem): void {
  const { shoulder, s } = armFit(w, h);
  const { elbow, hand } = armAttach(w, h);
  const shX = shoulder.x, shY = shoulder.y, elX = elbow.x, elY = elbow.y, haX = hand.x, haY = hand.y;
  const dark = (c: string) => shadeColor(c, -(0.24 + 0.1 * (1 - clamp(light, 0, 1))));

  ctx.lineCap = 'round';
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = s * 0.4;
  ctx.beginPath();
  ctx.moveTo(shX, shY);
  ctx.quadraticCurveTo(shX - s * 0.28, shY + s * 0.55, elX, elY);
  ctx.stroke();
  ctx.strokeStyle = shadeColor(outfit.body, 0.12 + 0.14 * clamp(light, 0, 1));
  ctx.lineWidth = s * 0.3;
  ctx.beginPath();
  ctx.moveTo(shX, shY);
  ctx.quadraticCurveTo(shX - s * 0.26, shY + s * 0.55, elX, elY);
  ctx.stroke();
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = s * 0.32;
  ctx.beginPath();
  ctx.moveTo(elX, elY);
  ctx.quadraticCurveTo((elX + haX) / 2, elY + s * 0.12, haX, haY);
  ctx.stroke();
  ctx.strokeStyle = shadeColor(outfit.body, 0.05);
  ctx.lineWidth = s * 0.24;
  ctx.beginPath();
  ctx.moveTo(elX, elY);
  ctx.quadraticCurveTo((elX + haX) / 2, elY + s * 0.1, haX, haY);
  ctx.stroke();
  ctx.fillStyle = shadeColor(outfit.body, 0.12 + 0.14 * clamp(light, 0, 1));
  ctx.beginPath();
  ctx.arc(shX, shY, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shadeColor(outfit.body, -0.04);
  ctx.beginPath();
  ctx.arc(elX, elY, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.arc(elX, elY, s * 0.13, -0.6, 1.2);
  ctx.stroke();
  ctx.strokeStyle = dark(outfit.body);
  ctx.lineWidth = s * 0.3;
  ctx.beginPath();
  ctx.moveTo(haX - s * 0.16, haY - s * 0.02);
  ctx.lineTo(haX - s * 0.06, haY);
  ctx.stroke();
  ctx.fillStyle = outfit.skin;
  ctx.beginPath();
  ctx.ellipse(haX, haY + s * 0.02, s * 0.19, s * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shadeColor(outfit.skin, -0.18);
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(haX - s * 0.1, haY - s * 0.1);
  ctx.quadraticCurveTo(haX + s * 0.07, haY - s * 0.18, haX + s * 0.15, haY - s * 0.04);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Hats (draw.js:798-931, all 16 `HATS` ids ported 1:1 — geometry expressed in
// multiples of `hr` = head radius, same convention as the original's `s`).
// ---------------------------------------------------------------------------

function hatFit(w: number, h: number): { hx: number; hy: number; hr: number } {
  const hr = h / 3.4;
  return { hx: w / 2, hy: h - hr * 1.1, hr };
}

export interface HatAttach {
  /** where the head's own `center` (from `anglerHeadAttach`) should land */
  center: Pt;
  radius: number;
}
export function hatAttach(w: number, h: number): HatAttach {
  const { hx, hy, hr } = hatFit(w, h);
  return { center: { x: hx, y: hy }, radius: hr };
}

export function drawHat(ctx: CanvasRenderingContext2D, w: number, h: number, id: string, light: number): void {
  const { hx: x, hy: y, hr: s } = hatFit(w, h);
  const dl = clamp(light, 0, 1);
  const hv = (col: string, y0: number, y1: number) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, shadeColor(col, 0.16 + 0.12 * dl));
    g.addColorStop(0.55, col);
    g.addColorStop(1, shadeColor(col, -0.24));
    return g;
  };
  ctx.fillStyle = 'rgba(15,10,5,0.16)';
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.3, s * 0.95, s * 0.32, 0, 0, Math.PI);
  ctx.fill();

  switch (id) {
    case 'cap':
      ctx.fillStyle = hv('#c0392b', y - s * 1.3, y - s * 0.05);
      ctx.beginPath();
      ctx.arc(x, y - s * 0.2, s * 1.05, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - s * 1.05, y - s * 0.35, s * 2.1, s * 0.3);
      ctx.fillStyle = shadeColor('#c0392b', -0.28);
      ctx.beginPath();
      ctx.ellipse(x - s * 1.4, y - s * 0.2, s * 0.9, s * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.25);
      ctx.quadraticCurveTo(x + s * 0.1, y - s * 0.8, x, y - s * 0.35);
      ctx.stroke();
      ctx.fillStyle = shadeColor('#c0392b', 0.2);
      ctx.beginPath();
      ctx.arc(x, y - s * 1.22, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'stroh':
      ctx.fillStyle = shadeColor('#e6c96b', -0.18);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.5, s * 2.1, s * 0.38, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = hv('#e6c96b', y - s * 1.0, y - s * 0.2);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.55, s * 2.1, s * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hv('#e6c96b', y - s * 1.6, y - s * 0.5);
      ctx.fillRect(x - s * 0.95, y - s * 1.5, s * 1.9, s * 1.0);
      ctx.strokeStyle = 'rgba(120,85,30,0.3)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(x, y - s * 0.55, s * (1.3 + i * 0.35), s * (0.26 + i * 0.06), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#b5462c';
      ctx.fillRect(x - s * 0.95, y - s * 0.95, s * 1.9, s * 0.22);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x - s * 0.95, y - s * 1.5, s * 1.9, s * 0.14);
      break;
    case 'muetze':
      ctx.fillStyle = hv('#d62828', y - s * 2.4, y - s * 0.4);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.05, y - s * 0.5);
      ctx.quadraticCurveTo(x - s * 0.2, y - s * 2.6, x + s * 1.6, y - s * 2.0);
      ctx.lineTo(x + s * 1.05, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(x - s * 1.15, y - s * 0.85, s * 2.3, s * 0.45, s * 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 1.6, y - s * 2.0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'kapitaen':
      ctx.fillStyle = hv('#f4f6f8', y - s * 1.5, y - s * 0.6);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 1.0, s * 1.35, s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(x - s * 1.05, y - s * 0.95, s * 2.1, s * 0.5);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(x - s * 0.1, y - s * 0.45, s * 1.15, s * 0.22, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.75, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'pirat':
      ctx.fillStyle = hv('#26262c', y - s * 2.2, y - s * 0.3);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.9, y - s * 0.4);
      ctx.quadraticCurveTo(x - s * 1.2, y - s * 2.2, x, y - s * 1.3);
      ctx.quadraticCurveTo(x + s * 1.2, y - s * 2.2, x + s * 1.9, y - s * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(212,175,55,0.55)';
      ctx.lineWidth = Math.max(1, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.82, y - s * 0.45);
      ctx.quadraticCurveTo(x - s * 1.15, y - s * 2.1, x, y - s * 1.33);
      ctx.quadraticCurveTo(x + s * 1.15, y - s * 2.1, x + s * 1.82, y - s * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y - s * 1.0, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(x - s * 0.08, y - s * 1.08, s * 0.06, s * 0.06);
      ctx.fillRect(x + s * 0.02, y - s * 1.08, s * 0.06, s * 0.06);
      break;
    case 'zylinder': {
      ctx.fillStyle = '#141414';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.55, s * 1.5, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      const zg = ctx.createLinearGradient(x - s * 0.95, 0, x + s * 0.95, 0);
      zg.addColorStop(0, '#2e2e33');
      zg.addColorStop(0.3, '#454550');
      zg.addColorStop(0.5, '#1c1c20');
      zg.addColorStop(1, '#101014');
      ctx.fillStyle = zg;
      ctx.fillRect(x - s * 0.95, y - s * 2.4, s * 1.9, s * 1.9);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 2.4, s * 0.95, s * 0.16, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#8a1c2b';
      ctx.fillRect(x - s * 0.95, y - s * 0.95, s * 1.9, s * 0.25);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x - s * 0.95, y - s * 0.95, s * 1.9, s * 0.06);
      break;
    }
    case 'kranz':
    case 'blumenkranz': {
      const leaf = id === 'kranz' ? '#4f8a3a' : '#2fa35a';
      const dots = id === 'kranz' ? ['#7fb35a', '#3f6f2a'] : ['#ff6b9d', '#ffd23a', '#ff8c42', '#ffffff'];
      ctx.strokeStyle = leaf;
      ctx.lineWidth = s * 0.35;
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.55, s * 1.05, s * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const a = (i * Math.PI * 2) / 9;
        ctx.fillStyle = dots[i % dots.length]!;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * s * 1.05, y - s * 0.55 + Math.sin(a) * s * 0.32, s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'nessiemuetze':
      ctx.fillStyle = '#2d6b4f';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.35, s * 1.05, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#2d6b4f';
      ctx.lineWidth = s * 0.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.6, y - s * 1.2);
      ctx.quadraticCurveTo(x + s * 1.3, y - s * 2.4, x + s * 0.9, y - s * 2.6);
      ctx.stroke();
      ctx.fillStyle = '#2d6b4f';
      ctx.beginPath();
      ctx.ellipse(x + s * 0.8, y - s * 2.65, s * 0.35, s * 0.22, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + s * 0.9, y - s * 2.75, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'moewenhut':
      ctx.fillStyle = '#e6c96b';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.55, s * 1.6, s * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - s * 0.8, y - s * 1.3, s * 1.6, s * 0.8);
      ctx.fillStyle = '#e9edf2';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 1.55, s * 0.5, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 0.45, y - s * 1.75, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f5a623';
      ctx.beginPath();
      ctx.moveTo(x + s * 0.62, y - s * 1.75);
      ctx.lineTo(x + s * 0.9, y - s * 1.7);
      ctx.lineTo(x + s * 0.62, y - s * 1.65);
      ctx.fill();
      break;
    case 'leuchthelm':
      ctx.fillStyle = hv('#3a3f55', y - s * 1.4, y - s * 0.1);
      ctx.beginPath();
      ctx.arc(x, y - s * 0.3, s * 1.1, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - s * 1.1, y - s * 0.35, s * 2.2, s * 0.3);
      ctx.save();
      ctx.shadowColor = '#9fffe0';
      ctx.shadowBlur = s * 1.2;
      ctx.fillStyle = '#c8fff0';
      ctx.beginPath();
      ctx.arc(x, y - s * 1.0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    case 'eiskrone':
      ctx.fillStyle = hv('#bfe9ff', y - s * 2.2, y - s * 0.4);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.0, y - s * 0.5);
      ctx.lineTo(x - s * 1.0, y - s * 1.9);
      ctx.lineTo(x - s * 0.5, y - s * 1.1);
      ctx.lineTo(x, y - s * 2.2);
      ctx.lineTo(x + s * 0.5, y - s * 1.1);
      ctx.lineTo(x + s * 1.0, y - s * 1.9);
      ctx.lineTo(x + s * 1.0, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x - s * 0.9, y - s * 0.8, s * 0.25, s * 0.3);
      ctx.fillRect(x + s * 0.2, y - s * 1.3, s * 0.2, s * 0.5);
      break;
    case 'perlenkrone':
      ctx.fillStyle = hv('#e8d8c0', y - s * 1.8, y - s * 0.4);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.0, y - s * 0.5);
      ctx.lineTo(x - s * 1.0, y - s * 1.6);
      ctx.lineTo(x - s * 0.5, y - s * 1.1);
      ctx.lineTo(x, y - s * 1.8);
      ctx.lineTo(x + s * 0.5, y - s * 1.1);
      ctx.lineTo(x + s * 1.0, y - s * 1.6);
      ctx.lineTo(x + s * 1.0, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.fillStyle = '#fff8e7';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = s * 0.5;
      for (const px of [-1.0, -0.5, 0, 0.5, 1.0]) {
        ctx.beginPath();
        ctx.arc(x + s * px, y - s * (px === 0 ? 1.8 : Math.abs(px) === 0.5 ? 1.1 : 1.6), s * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    case 'krone':
      ctx.fillStyle = hv('#ffd700', y - s * 1.9, y - s * 0.4);
      ctx.beginPath();
      ctx.moveTo(x - s * 1.0, y - s * 0.5);
      ctx.lineTo(x - s * 1.0, y - s * 1.7);
      ctx.lineTo(x - s * 0.5, y - s * 1.1);
      ctx.lineTo(x, y - s * 1.9);
      ctx.lineTo(x + s * 0.5, y - s * 1.1);
      ctx.lineTo(x + s * 1.0, y - s * 1.7);
      ctx.lineTo(x + s * 1.0, y - s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.85, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4aa3ff';
      ctx.beginPath();
      ctx.arc(x - s * 0.55, y - s * 0.85, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 0.55, y - s * 0.85, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: // "angler" (default) and "sommerhut" (pass-exclusive, same silhouette)
      ctx.fillStyle = shadeColor('#3f7a4a', -0.2);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.55, s * 1.75, s * 0.38, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = hv('#3f7a4a', y - s * 1.0, y - s * 0.25);
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.6, s * 1.75, s * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hv('#3f7a4a', y - s * 1.6, y - s * 0.55);
      ctx.fillRect(x - s * 0.85, y - s * 1.55, s * 1.7, s * 1.0);
      ctx.fillStyle = 'rgba(24,40,26,0.55)';
      ctx.fillRect(x - s * 0.85, y - s * 0.92, s * 1.7, s * 0.24);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x - s * 0.85, y - s * 1.55, s * 1.7, s * 0.12);
  }
}

// ---------------------------------------------------------------------------
// Rod shaft (draw.js:595-693). Baked STRAIGHT and HORIZONTAL (grip at x=0,
// tip at x=w) rather than along the original's curved/diagonal rest pose —
// see the file header: the renderer bends this via a mesh sampling the
// texture by length by feeding `rodBendCurve()` below to a rope/strip mesh,
// so the bake's own orientation just needs to be a consistent u-axis, and
// horizontal is the simplest one to build that mesh from.
// ---------------------------------------------------------------------------

export interface RodAttach {
  grip: Pt;
  tip: Pt;
  reel: Pt;
  reelRadius: number;
}
export function rodAttach(w: number, h: number): RodAttach {
  const gripLen = w * 0.12;
  const w0 = h * 0.4;
  return {
    grip: { x: gripLen, y: h / 2 },
    tip: { x: w, y: h / 2 },
    reel: { x: gripLen * 0.5, y: h / 2 + w0 * 1.1 },
    reelRadius: w0 * 0.5,
  };
}

/** `t` in 0..1 along the visible shaft (grip..tip) — same fractions as the original's ring positions. */
const ROD_RING_TS = [0.3, 0.5, 0.68, 0.84, 0.97];

export function drawRod(ctx: CanvasRenderingContext2D, w: number, h: number, skin: RodSkinItem, light: number): void {
  void light; // the rod's shaft colors don't respond to daylight in the original either — kept for API symmetry with the other tackle bakes.
  const gripLen = w * 0.12;
  const w0 = h * 0.4, w1 = h * 0.125;
  const midY = h / 2;
  const color = skin.rainbow ? 'hsl(0,90%,55%)' : (skin.color ?? '#4a3018');
  const accent = skin.accent;

  // Shaft: tapered horizontal strip, grip (x=gripLen) -> tip (x=w).
  ctx.save();
  if (skin.glow) {
    ctx.shadowColor = skin.accent;
    ctx.shadowBlur = 12;
  }
  let shaftFill: string | CanvasGradient = color;
  if (skin.fx === 'gamma' || skin.fx === 'fade' || skin.fx === 'case' || skin.fx === 'marble') {
    const g = ctx.createLinearGradient(gripLen, 0, w, 0);
    if (skin.fx === 'gamma') {
      g.addColorStop(0, '#0b6b3a');
      g.addColorStop(0.5, '#2ee6a6');
      g.addColorStop(1, '#083d5a');
    } else if (skin.fx === 'fade') {
      g.addColorStop(0, '#ffd23a');
      g.addColorStop(0.5, '#ff5c8a');
      g.addColorStop(1, '#7a3cff');
    } else if (skin.fx === 'case') {
      for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, [i * 7 % 3 === 0 ? '#c9a227' : '#2a6fd6', '#1f4fa8', '#c9a227'][i % 3]!);
    } else {
      g.addColorStop(0, '#ffd23a');
      g.addColorStop(0.35, '#ff3b30');
      g.addColorStop(0.6, '#7a1c8a');
      g.addColorStop(1, '#1e88e5');
    }
    shaftFill = g;
  }
  ctx.beginPath();
  ctx.moveTo(gripLen, midY - w0 / 2);
  ctx.lineTo(w, midY - w1 / 2);
  ctx.lineTo(w, midY + w1 / 2);
  ctx.lineTo(gripLen, midY + w0 / 2);
  ctx.closePath();
  ctx.fillStyle = shaftFill;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Light edge along the top of the shaft.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(0.8, w0 * 0.18);
  ctx.beginPath();
  ctx.moveTo(gripLen, midY - w0 * 0.22);
  ctx.lineTo(w, midY - w1 * 0.22);
  ctx.stroke();

  // Pattern overlays (tiger/web/slaughter), straight-line equivalent of `drawRodPattern`.
  if (skin.fx === 'tiger' || skin.fx === 'web' || skin.fx === 'slaughter') {
    const pt = (t: number): Pt => ({ x: lerp(gripLen, w, t), y: midY });
    ctx.save();
    ctx.lineCap = 'round';
    if (skin.fx === 'tiger') {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5;
      for (let t = 0.08; t < 1; t += 0.12) {
        const a = pt(t), b = pt(Math.min(1, t + 0.035));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else if (skin.fx === 'web') {
      ctx.strokeStyle = 'rgba(20,5,8,0.9)';
      ctx.lineWidth = 1;
      for (let t = 0.1; t < 1; t += 0.1) {
        const a = pt(t);
        for (let k = 0; k < 3; k++) {
          const ang = k * 2.1 + t * 7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + Math.cos(ang) * 5, a.y + Math.sin(ang) * 5);
          ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      for (let t = 0.05; t < 1; t += 0.15) {
        const a = pt(t), b = pt(Math.min(1, t + 0.07));
        ctx.beginPath();
        ctx.moveTo(a.x - 2, a.y + 1);
        ctx.quadraticCurveTo((a.x + b.x) / 2 + 2, (a.y + b.y) / 2 - 2, b.x + 1, b.y - 1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Rings on a short standoff below the shaft.
  ctx.strokeStyle = accent;
  ctx.lineCap = 'round';
  for (const t of ROD_RING_TS) {
    const x = lerp(gripLen, w, t);
    const shaftW = lerp(w0, w1, t);
    const r = Math.max(1.2, w0 * 0.11 * (1 - t * 0.6));
    const standoff = Math.max(1.5, w0 * 0.08);
    ctx.lineWidth = Math.max(1, w0 * 0.045);
    ctx.beginPath();
    ctx.moveTo(x, midY + shaftW * 0.1);
    ctx.lineTo(x, midY + standoff + r);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, w0 * 0.055);
    ctx.beginPath();
    ctx.arc(x, midY + standoff + r, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, w0 * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, midY - shaftW / 2);
    ctx.lineTo(x, midY + shaftW / 2);
    ctx.stroke();
  }
  ctx.restore();

  // Cork grip behind the visible shaft start, with a dashed wrap and an end cap.
  ctx.strokeStyle = '#b98a5a';
  ctx.lineWidth = w0 * 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(gripLen, midY);
  ctx.lineTo(0, midY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,35,18,0.4)';
  ctx.lineWidth = w0 * 0.9;
  ctx.setLineDash([Math.max(1, w0 * 0.12), Math.max(2, w0 * 0.3)]);
  ctx.beginPath();
  ctx.moveTo(gripLen, midY);
  ctx.lineTo(0, midY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#2b2b30';
  ctx.lineWidth = w0;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(-gripLen * 0.12, midY);
  ctx.stroke();

  // Reel: housing + accent-colored spool, below the grip. No crank — see file header.
  const { reel, reelRadius } = rodAttach(w, h);
  ctx.strokeStyle = '#3a3f47';
  ctx.lineWidth = Math.max(1.5, w0 * 0.2);
  ctx.beginPath();
  ctx.moveTo(gripLen * 0.5, midY);
  ctx.lineTo(reel.x, reel.y);
  ctx.stroke();
  const rg = ctx.createRadialGradient(reel.x - reelRadius * 0.3, reel.y - reelRadius * 0.3, reelRadius * 0.2, reel.x, reel.y, reelRadius);
  rg.addColorStop(0, '#5a616b');
  rg.addColorStop(1, '#23262c');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.arc(reel.x, reel.y, reelRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(reel.x, reel.y, reelRadius * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Bobber skins (draw.js:731-795, all 11 `BOBBERS` skins ported 1:1).
// ---------------------------------------------------------------------------

export function drawBobber(ctx: CanvasRenderingContext2D, w: number, h: number, skin: BobberItem): void {
  const x = w / 2, y = h / 2;
  const r = Math.min(w, h) / 2.4;
  ctx.save();
  if (skin.duck) {
    ctx.fillStyle = '#ffd42a';
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.5, r * 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.9, y - r * 1.1, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8c1a';
    ctx.beginPath();
    ctx.moveTo(x + r * 1.6, y - r * 1.1);
    ctx.lineTo(x + r * 2.4, y - r * 0.9);
    ctx.lineTo(x + r * 1.6, y - r * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x + r * 1.1, y - r * 1.25, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin.shape === 'heart') {
    ctx.fillStyle = '#ff3b7a';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 1.1);
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.9, y - r * 1.4, x, y - r * 0.5);
    ctx.bezierCurveTo(x + r * 0.9, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 1.1);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x - r * 0.5, y - r * 0.5, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin.shape === 'strawberry') {
    ctx.fillStyle = '#e8334a';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 1.2);
    ctx.quadraticCurveTo(x - r * 1.5, y - r * 0.2, x - r * 0.7, y - r * 0.7);
    ctx.lineTo(x + r * 0.7, y - r * 0.7);
    ctx.quadraticCurveTo(x + r * 1.5, y - r * 0.2, x, y + r * 1.2);
    ctx.fill();
    ctx.fillStyle = '#3fa34d';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(x + i * r * 0.45, y - r * 0.8, r * 0.3, r * 0.5, i * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe8a0';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(x + Math.sin(i * 2.4) * r * 0.5, y + (i % 3) * r * 0.35 - r * 0.2, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (skin.shape === 'ball') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin.shape === 'skull') {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.15, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r * 0.55, y + r * 0.4, r * 1.1, r * 0.5);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x - r * 0.38, y - r * 0.2, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + r * 0.38, y - r * 0.2, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - r * 0.08, y + r * 0.15, r * 0.16, r * 0.25);
    for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * r * 0.3 - r * 0.04, y + r * 0.55, r * 0.08, r * 0.3);
  } else if (skin.shape === 'disco') {
    // Static reference frame (t=0) — see file header re: continuous rotation.
    ctx.fillStyle = '#b8c4d0';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const a = i * 0.52;
      const rr = r * (0.3 + (i % 3) * 0.25);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x + Math.cos(a) * rr - r * 0.12, y + Math.sin(a) * rr - r * 0.12, r * 0.24, r * 0.24);
    }
  } else {
    // Classic / neon / gold / rainbow: stick + two-tone dome.
    const main = skin.rainbow ? 'hsl(0,100%,55%)' : (skin.main ?? '#e63946');
    const top = skin.rainbow ? '#ffffff' : (skin.top ?? '#ffffff');
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2.2);
    ctx.lineTo(x, y + r);
    ctx.stroke();
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hook (draw.js:935-944, shape only — no bait icon, no leader line: both are
// drawn live by the scene, the icon because it's an emoji glyph and the
// leader because its curve depends on `lineBow`/reeling state every frame).
// ---------------------------------------------------------------------------

export function drawHook(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const x = w / 2, y = h * 0.15;
  const r = Math.min(w, h) * 0.35;
  ctx.strokeStyle = '#cfd6dd';
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + r * 1.4);
  ctx.arc(x, y + r * 1.4, r, Math.PI * 0.5, Math.PI * 1.5, true);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Rod-bend / line-sag maths (draw.js:558-710) — pure, renderer-agnostic. The
// scene draws these as live strips/meshes every frame rather than baking them
// (their whole point is that they change continuously).
// ---------------------------------------------------------------------------

export interface RodBendPoint {
  x: number;
  y: number;
  /** unit normal, perpendicular to the curve direction at this point */
  nx: number;
  ny: number;
  /** shaft half-width at this point (taper from grip to tip) */
  width: number;
  /** 0 at grip, 1 at tip */
  t: number;
}

export interface RodBendParams {
  gripX: number;
  gripY: number;
  rodTipX: number;
  rodTipY: number;
  bobberX: number;
  /** 0 (straight) .. 1 (fully bent toward the bobber) */
  bend: number;
  /** shaft half-width at the grip; defaults matching draw.js's `w0`/`w1` given a scale `s` */
  s?: number;
  segments?: number;
}

/**
 * The rod's visible curve (draw.js:562-565 for the tip lerp, :600-613 for the
 * bezier + width taper). Returns `segments+1` points from grip to tip; feed
 * these to a mesh/rope that maps `drawRod`'s straight texture along `t`.
 */
export function rodBendCurve(p: RodBendParams): RodBendPoint[] {
  const { gripX: bx, gripY: by, rodTipX, rodTipY, bobberX, bend } = p;
  const s = p.s ?? 20;
  const segments = p.segments ?? 10;
  const cx = lerp((bx + rodTipX) / 2, bobberX, bend * 0.35);
  const cy = lerp((by + rodTipY) / 2, rodTipY + 40, bend * 0.6);
  const tipX = lerp(rodTipX, rodTipX + (bobberX - rodTipX) * 0.25, bend);
  const tipY = lerp(rodTipY, rodTipY + 60 * bend, bend);
  const w0 = Math.max(2.6, s * 0.16);
  const w1 = Math.max(0.9, s * 0.05);

  const P = (t: number): Pt => ({
    x: (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * tipX,
    y: (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy + t * t * tipY,
  });
  const N = (t: number): Pt => {
    const dx = 2 * (1 - t) * (cx - bx) + 2 * t * (tipX - cx);
    const dy = 2 * (1 - t) * (cy - by) + 2 * t * (tipY - cy);
    const l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };

  const out: RodBendPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pt = P(t);
    const n = N(t);
    out.push({ x: pt.x, y: pt.y, nx: n.x, ny: n.y, width: lerp(w0, w1, t), t });
  }
  return out;
}

export interface LineSagParams {
  tipX: number;
  tipY: number;
  bobberX: number;
  bobberY: number;
  reeling: boolean;
  casting: boolean;
  /** eased whip response to bobber velocity, `lineBow` in the original (see below) */
  lineBow: number;
  time: number;
  segments?: number;
}

/**
 * The fishing line's sag/bow curve (draw.js:701-706). A single quadratic
 * bezier from the rod tip to the bobber; returns `segments+1` points to draw
 * as a thin live strip/polyline (never baked — it changes every frame).
 */
export function lineSagCurve(p: LineSagParams): Pt[] {
  const segments = p.segments ?? 12;
  const sag = p.reeling ? 14 + Math.abs(p.lineBow) * 0.35 : p.casting ? 0 : 25;
  const bow = p.reeling ? p.lineBow + Math.sin(p.time * 27) * 3 : 0;
  const mx = (p.tipX + p.bobberX) / 2 + bow;
  const my = (p.tipY + p.bobberY) / 2 + sag;
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    out.push({
      x: (1 - t) * (1 - t) * p.tipX + 2 * (1 - t) * t * mx + t * t * p.bobberX,
      y: (1 - t) * (1 - t) * p.tipY + 2 * (1 - t) * t * my + t * t * p.bobberY,
    });
  }
  return out;
}

/**
 * `lineBow`'s own per-frame update (draw.js:709-710) — a lag/whip response to
 * bobber horizontal velocity. Not a "curve", but included here since
 * `lineSagCurve` needs its output and nothing else in the codebase owns it.
 */
export function updateLineBow(prevLineBow: number, bobberX: number, prevBobberX: number, dt: number): number {
  return lerp(prevLineBow, clamp((bobberX - prevBobberX) * 9, -70, 70), Math.min(1, dt * 7));
}
