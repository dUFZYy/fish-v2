/**
 * fishArt — the old game's fish/creature drawing code, ported to bake
 * functions for the GPU atlas (see `docs/spec/02-fish.md` §2 for the full
 * anatomy spec this follows, and `Baker`/`Atlas` in this folder for how a
 * bake call is used).
 *
 * Sources (old project, `C:\Users\duf73\Desktop\claude projekte\fishing-game`, read-only):
 *  - `fish.js`      — `drawFishShape` (generic fish body, ~lines 444-741), `drawMaw` (744-805),
 *                      `drawBottle`/`drawChest`/`drawBoot` (807-855).
 *  - `creatures.js` — `cGrad`/`cOutline`/`cEye`/`cGloss` shared helpers (1-41),
 *                      the 14-entry `CREATURE_DRAW` table (43-792), `drawFrozenOverlay` (795-808).
 *
 * What did NOT come along, and why:
 *  - `dir`/turn-squash (`c.scale(dsc, 1)`) — a fish always faces LEFT-TO-RIGHT here;
 *    facing left is a horizontal flip of the baked sprite, done by the renderer
 *    (`src/world/fishBatch.ts`), not baked twice.
 *  - `opts.haze`/`opts.hazeColor`/`opts.silhouette` (depth fog) and `opts.caustic`
 *    (the live water-caustic net on the body) — both read live scene/world state
 *    (camera depth, world time+position) that a pre-baked texture cannot see.
 *    CLAUDE.md rule 1 puts exactly this kind of thing in a vertex attribute /
 *    live shader pass instead, not a baked pixel.
 *  - `opts.halo`/`opts.deepSheen` (`drawFishGlowBehind`) — a soft ambient light
 *    disc up to 3.4x the fish's own half-length, additive-blended. Baking that
 *    into every sprite would blow up every glowing species' box by ~7x for a
 *    few translucent pixels; it belongs in the world layer as a small separate
 *    point-light/glow decal, not inside a tightly packed atlas sprite.
 *  - the per-frame animation phase (`tail`) — every body-type function below
 *    still TAKES a `tail` parameter and still computes `sin(tail * k + ...)`
 *    exactly as before (so the code path and the per-species formulas from
 *    spec §2.2 are untouched); `drawSpecies` just always calls with `tail = 0`
 *    (a fixed resting pose). The one term that keeps moving after baking is the
 *    tail-fin wobble, re-added per-frame as a vertex-shader term in
 *    `src/world/fishBatch.ts` — everything else (fin rotation, tentacle sway,
 *    jellyfish pulse, whisker curl, ...) is static in this rebuild.
 *
 * What DID come along even though it isn't in `opts` here: the self-glow
 * shadow (`isGlowing(sp)` -> `shadowColor/shadowBlur`) and the shiny hue
 * filter — both are pure functions of the species (+ the `shiny` bake flag),
 * never of live scene state, so unlike the halo they bake in cleanly.
 */

import type { Species } from '@/data/species';
import { shadeColor, nightTintColor } from './colorUtil';

export interface DrawOpts {
  /** hue-rotate(150deg) saturate(1.7) brightness(1.15) + gold shadow, verbatim `fish.js:476-479`. */
  shiny?: boolean;
  /** 0 (night) .. 1 (day). Baked in as a same-shape darken pass, see `colorUtil.nightTintColor`. */
  light?: number;
}

interface Col {
  body: string;
  belly: string;
  fin: string;
}

/** Old `isGlowing` (`fish.js:67`). */
function isGlowing(sp: Species): boolean {
  return !!sp.glow || sp.pattern === 'glow' || sp.pattern === 'moon' || sp.pattern === 'lure';
}

// ---------------------------------------------------------------------------
// Bake-box sizing
//
// Not present in the old game (it drew straight to a live, arbitrarily large
// canvas). Every body-type function below is built from literal offsets in
// units of L (half body length) and Hh (half body height, `= L * sp.h * 0.5`
// for the generic fish rig, or the plain `L`/`Hh` a creature function was
// given). `fishAspect`/`drawSpecies` share this table so a caller can size a
// bake box (`fishAspect`) that the same geometry then actually fills without
// clipping (`drawSpecies`) — both derived from the same worst-case reading of
// each function's own coordinates (fin tips, spikes, tentacle sway amplitude
// at full extent, ...), padded a little for safety, never tight-cropped.
interface Bounds { xMin: number; xMax: number; yMin: number; yMax: number; }

function bodyBounds(sp: Species): Bounds {
  const hh = sp.h * 0.5; // Hh = L * hh
  let b: Bounds;
  switch (sp.bodyType) {
    case 'boot':
      // Widened from the old shape's bounds: the redrawn boot has a proper
      // sole and heel below (soleY + 0.28) and algae hanging off the back
      // edge and the toe, all of which sat outside the original box and got
      // clipped by the bake.
      b = { xMin: -0.82, xMax: 1.1, yMin: -1.02, yMax: 1.06 };
      break;
    case 'bottle':
      // rotated ~0.9 rad in place; bounded generously rather than rotating the box.
      b = { xMin: -1.1, xMax: 1.1, yMin: -1.1, yMax: 1.1 };
      break;
    case 'chest':
      b = { xMin: -1.0, xMax: 1.0, yMin: -0.85, yMax: 0.75 };
      break;
    case 'creature':
      switch (sp.pattern) {
        case 'octopus': b = { xMin: -1.4, xMax: 1.4, yMin: -1.3 * hh, yMax: 2.0 * hh }; break;
        case 'squid': b = { xMin: -1.45, xMax: 1.75, yMin: -1.3 * hh, yMax: 1.3 * hh }; break;
        case 'jelly': b = { xMin: -1.0, xMax: 1.0, yMin: -2.0 * hh, yMax: 1.8 * hh }; break;
        case 'crab': b = { xMin: -1.5, xMax: 1.5, yMin: -1.4 * hh, yMax: 1.45 * hh }; break;
        case 'ray': b = { xMin: -2.05, xMax: 1.0, yMin: -2.1 * hh, yMax: 2.1 * hh }; break;
        case 'turtle': b = { xMin: -1.1, xMax: 1.45, yMin: -1.2 * hh, yMax: 1.2 * hh }; break;
        case 'flat': b = { xMin: -1.55, xMax: 1.15, yMin: -1.3 * hh, yMax: 1.3 * hh }; break;
        case 'seahorse': b = { xMin: -1.05, xMax: 1.25, yMin: -2.15 * hh, yMax: 1.85 * hh }; break;
        // star draws its radius from L directly (both axes), ignoring Hh/sp.h.
        case 'star': b = { xMin: -1.05, xMax: 1.05, yMin: -1.05, yMax: 1.05 }; break;
        case 'shell': b = { xMin: -1.1, xMax: 1.1, yMin: -1.3 * hh, yMax: 1.0 * hh }; break;
        // rotated ~1 rad in place; bounded generously rather than rotating the box.
        case 'penguin': b = { xMin: -1.5, xMax: 1.5, yMin: -1.8 * hh, yMax: 1.8 * hh }; break;
        case 'serpent': b = { xMin: -2.45, xMax: 1.9, yMin: -2.9 * hh, yMax: 0.9 * hh }; break;
        // The weed is rooted: its base must sit on the BOTTOM edge of the box,
        // because world/motion.ts gives it the anchored bend mode and the
        // shader holds the bottom row still.
        case 'weed': b = { xMin: -1.35, xMax: 1.35, yMin: -2.45 * hh, yMax: 1.35 * hh }; break;
        case 'blob': b = { xMin: -1.45, xMax: 1.35, yMin: -1.05 * hh, yMax: 1.2 * hh }; break;
        default: b = { xMin: -1.2, xMax: 1.2, yMin: -1.2 * hh, yMax: 1.2 * hh };
      }
      break;
    default: {
      // Generic fish body (fish.js) — one shared box for every surface pattern:
      // tail fin tip -1.4L, whiskers snout-lines to +1.5L, shark dorsal spike
      // to -2.2Hh, puffer spikes to ±1.22L/±1.22Hh, anal fin to +1.15Hh.
      let yMax = 1.35;
      if (sp.pattern === 'frozen') yMax = 1.55; // drawFrozenOverlay's rounded rect reaches +1.5Hh
      b = { xMin: -1.45, xMax: 1.6, yMin: -2.35 * hh, yMax: yMax * hh };
    }
  }
  // The self-glow shadow blur (`shadowBlur = L * 0.8`) bleeds past the fill/stroke
  // path it's attached to; give glowing species extra room so the atlas clip
  // doesn't cut the blur short.
  if (isGlowing(sp)) {
    const m = 0.85;
    b = { xMin: b.xMin - m, xMax: b.xMax + m, yMin: b.yMin - m, yMax: b.yMax + m };
  }
  return b;
}

/** height / width of the bake box this species needs — size the box, then call `drawSpecies` into it. */
export function fishAspect(sp: Species): number {
  const b = bodyBounds(sp);
  return (b.yMax - b.yMin) / (b.xMax - b.xMin);
}

// ---------------------------------------------------------------------------
// Generic fish body path (`fishBodyPath`, fish.js:351-360)
function fishBodyPath(c: CanvasRenderingContext2D, L: number, Hh: number): void {
  c.beginPath();
  c.moveTo(L, 0);
  c.bezierCurveTo(L * 0.88, -Hh * 0.68, L * 0.34, -Hh, -L * 0.1, -Hh * 0.94);
  c.bezierCurveTo(-L * 0.52, -Hh * 0.86, -L * 0.76, -Hh * 0.48, -L * 0.9, -Hh * 0.26);
  c.quadraticCurveTo(-L * 0.99, 0, -L * 0.9, Hh * 0.26);
  c.bezierCurveTo(-L * 0.76, Hh * 0.5, -L * 0.48, Hh * 0.88, -L * 0.02, Hh * 0.95);
  c.bezierCurveTo(L * 0.42, Hh, L * 0.86, Hh * 0.62, L, 0);
  c.closePath();
}

/** The predator maw (`drawMaw`, fish.js:749-805) for patterns `shark`/`teeth`/`lure`. */
function drawMaw(c: CanvasRenderingContext2D, col: Col, art: 'shark' | 'teeth' | 'lure', L: number, Hh: number, fine: boolean): void {
  const mx1 = L * 0.94, my1 = Hh * 0.04;
  const mx0 = L * (art === 'teeth' ? 0.52 : 0.4);
  const my0 = Hh * 0.3;
  const gape = Hh * (art === 'lure' ? 0.42 : art === 'shark' ? 0.32 : 0.24);
  const cU: [number, number] = [(mx0 + mx1) / 2, my0 - gape * 0.6];
  const maw = () => {
    c.beginPath();
    c.moveTo(mx1, my1);
    c.quadraticCurveTo(cU[0], cU[1], mx0, my0);
    c.quadraticCurveTo((mx0 + mx1) / 2 + L * 0.06, my0 + gape * 0.8, mx1 - L * 0.02, my1 + gape * 0.45);
    c.closePath();
  };
  const rg = c.createLinearGradient(mx1, 0, mx0, 0);
  rg.addColorStop(0, '#47161c'); rg.addColorStop(1, '#160709');
  c.fillStyle = rg; maw(); c.fill();
  if (fine) {
    c.save(); maw(); c.clip();
    const qU = (t: number): [number, number] => [
      (1 - t) * (1 - t) * mx1 + 2 * (1 - t) * t * cU[0] + t * t * mx0,
      (1 - t) * (1 - t) * my1 + 2 * (1 - t) * t * cU[1] + t * t * my0,
    ];
    const zLen = gape * (art === 'lure' ? 0.85 : 0.55);
    const zW = L * (art === 'lure' ? 0.02 : 0.035);
    const n = art === 'shark' ? 6 : art === 'lure' ? 5 : 4;
    c.fillStyle = '#f2f4ee';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.7) / (n + 0.8);
      const [tx, ty] = qU(t);
      const len = zLen * (i % 2 ? 0.65 : 1);
      c.beginPath();
      c.moveTo(tx - zW, ty - Hh * 0.04);
      c.lineTo(tx + zW, ty - Hh * 0.04);
      c.lineTo(tx + zW * 0.15, ty + len);
      c.closePath(); c.fill();
    }
    for (let i = 0; i < n - 1; i++) {
      const t = (i + 1.2) / (n + 0.8);
      const [tx] = qU(t);
      const by = my1 + gape * 0.45 + (my0 + gape * 0.8 - (my1 + gape * 0.45)) * t * 0.6;
      const len = zLen * 0.55 * (i % 2 ? 1 : 0.7);
      c.beginPath();
      c.moveTo(tx - zW * 0.9 + L * 0.03, by + Hh * 0.04);
      c.lineTo(tx + zW * 0.9 + L * 0.03, by + Hh * 0.04);
      c.lineTo(tx + L * 0.03, by - len);
      c.closePath(); c.fill();
    }
    c.restore();
  }
  c.strokeStyle = shadeColor(col.body, -0.38); c.lineWidth = Math.max(1, L * 0.05); c.lineCap = 'round';
  c.beginPath(); c.moveTo(mx1, my1); c.quadraticCurveTo(cU[0], cU[1], mx0, my0); c.stroke();
  c.strokeStyle = shadeColor(col.belly, -0.12); c.lineWidth = Math.max(1, L * 0.045);
  c.beginPath(); c.moveTo(mx0, my0); c.quadraticCurveTo((mx0 + mx1) / 2 + L * 0.06, my0 + gape * 0.8, mx1 - L * 0.02, my1 + gape * 0.45); c.stroke();
}

/** Ice-block overlay for `pattern === "frozen"` (`drawFrozenOverlay`, creatures.js:795-808). */
function drawFrozenOverlay(c: CanvasRenderingContext2D, L: number, Hh: number): void {
  const g = c.createLinearGradient(-L * 1.45, -Hh * 1.5, L * 1.45, Hh * 1.5);
  g.addColorStop(0, 'rgba(200,236,255,0.55)');
  g.addColorStop(0.5, 'rgba(170,215,240,0.4)');
  g.addColorStop(1, 'rgba(210,240,255,0.55)');
  c.fillStyle = g;
  c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.5;
  c.beginPath(); c.roundRect(-L * 1.45, -Hh * 1.5, L * 2.9, Hh * 3, L * 0.15); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(-L * 1.2, -Hh * 1.2); c.lineTo(-L * 0.6, -Hh * 0.2); c.stroke();
  c.beginPath(); c.moveTo(L * 0.9, -Hh * 1.3); c.lineTo(L * 0.4, -Hh * 0.4); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.beginPath(); c.moveTo(-L * 1.4, -Hh * 1.45); c.lineTo(-L * 0.7, -Hh * 1.45); c.lineTo(-L * 1.4, -Hh * 0.5); c.closePath(); c.fill();
}

// ---------------------------------------------------------------------------
// Generic fish body — verbatim port of `drawFishShape`'s body (fish.js:494-741),
// minus the turn-squash / silhouette / haze / caustic / halo material listed
// in the file header above. `tail` is kept as a real parameter (see header);
// `drawSpecies` calls this with `tail = 0`.
function drawGenericFish(c: CanvasRenderingContext2D, sp: Species, col: Col, L: number, Hh: number, tail: number): void {
  const { body, belly, fin } = col;
  const pattern = sp.pattern;
  const fine = L >= 9; // detail threshold (gills/fin-rays/eye-highlight), verbatim fish.js:498

  if (isGlowing(sp)) { c.shadowColor = body; c.shadowBlur = L * 0.8; } // self-glow, fish.js:494

  // --- tail fin: forked, ANIMATED per-frame via `tw` in the old game (fish.js:501);
  // the GPU vertex shader (`src/world/fishBatch.ts`) re-adds this wobble at
  // runtime, so it is fixed at tw=0 (tail=0) here.
  const tw = Math.sin(tail) * Hh * 0.45;
  {
    const tr = shadeColor(fin, -0.3);
    const [tr0, tr1, tr2] = tr.match(/[\d.]+/g)!.map(Number);
    const fg = c.createLinearGradient(-L * 0.8, 0, -L * 1.45, 0);
    fg.addColorStop(0, fin);
    fg.addColorStop(0.6, `rgba(${tr0},${tr1},${tr2},0.9)`);
    fg.addColorStop(1, `rgba(${tr0},${tr1},${tr2},0.5)`);
    c.fillStyle = fg;
  }
  c.beginPath();
  c.moveTo(-L * 0.8, -Hh * 0.28);
  c.quadraticCurveTo(-L * 1.12, -Hh * 0.55 + tw * 0.5, -L * 1.4, -Hh * 0.9 + tw);
  c.quadraticCurveTo(-L * 1.16, -Hh * 0.28 + tw * 0.7, -L * 1.14, tw * 0.5);
  c.quadraticCurveTo(-L * 1.16, Hh * 0.28 + tw * 0.7, -L * 1.4, Hh * 0.9 + tw);
  c.quadraticCurveTo(-L * 1.12, Hh * 0.55 + tw * 0.5, -L * 0.8, Hh * 0.28);
  c.closePath(); c.fill();
  if (fine) {
    c.strokeStyle = shadeColor(fin, -0.35); c.globalAlpha *= 0.5; c.lineWidth = Math.max(0.6, L * 0.025);
    for (const k of [-0.55, 0, 0.55]) {
      c.beginPath(); c.moveTo(-L * 0.84, Hh * 0.14 * Math.sign(k || 1) * Math.abs(k) * 2);
      c.quadraticCurveTo(-L * 1.1, Hh * k * 0.8 + tw * 0.6, -L * 1.32, Hh * k * 1.5 + tw * 0.85); c.stroke();
    }
    c.globalAlpha /= 0.5;
  }

  // dorsal fin (fixed, no animation)
  c.fillStyle = fin;
  c.beginPath();
  c.moveTo(-L * 0.5, -Hh * 0.7);
  c.quadraticCurveTo(-L * 0.28, -Hh * 1.55, L * 0.02, -Hh * 1.45);
  c.quadraticCurveTo(L * 0.05, -Hh * 1.05, L * 0.32, -Hh * 0.68);
  c.closePath(); c.fill();
  // anal fin (fixed)
  c.beginPath();
  c.moveTo(-L * 0.62, Hh * 0.55);
  c.quadraticCurveTo(-L * 0.5, Hh * 1.15, -L * 0.18, Hh * 0.82);
  c.closePath(); c.fill();

  // far pectoral fin — ANIMATED (`sin(tail*0.9+2.6)`, fish.js:545) via rocking rotation, fixed at 0 here
  {
    c.save();
    c.translate(L * 0.02, Hh * 0.34);
    c.rotate(0.9 + Math.sin(tail * 0.9 + 2.6) * 0.22);
    c.fillStyle = shadeColor(fin, -0.4); c.globalAlpha *= 0.75;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-L * 0.26, Hh * 0.14, -L * 0.32, Hh * 0.48);
    c.quadraticCurveTo(-L * 0.12, Hh * 0.4, 0, 0);
    c.closePath(); c.fill();
    c.restore();
  }

  // body: gradient fill into the shared silhouette path
  {
    const g = c.createLinearGradient(0, -Hh, 0, Hh);
    g.addColorStop(0, shadeColor(body, -0.14)); g.addColorStop(0.42, body); g.addColorStop(0.78, belly); g.addColorStop(1, shadeColor(belly, -0.05));
    c.fillStyle = g;
  }
  fishBodyPath(c, L, Hh); c.fill();
  c.shadowBlur = 0;
  c.save();
  fishBodyPath(c, L, Hh); c.clip();
  // volume: core shadow, bounce light, and a gloss highlight — the gloss's
  // centre (`gx0`) is the one ANIMATED term here (`sin(tail*0.55)`, fish.js:583:
  // "the glint that runs along the back as the fish undulates"), fixed at 0.
  {
    const core = c.createLinearGradient(0, -Hh, 0, Hh);
    core.addColorStop(0, 'rgba(0,0,0,0)');
    core.addColorStop(0.55, 'rgba(0,0,0,0)');
    core.addColorStop(0.8, 'rgba(8,14,24,0.15)');
    core.addColorStop(0.92, 'rgba(8,14,24,0.06)');
    core.addColorStop(1, 'rgba(8,14,24,0)');
    c.fillStyle = core; c.fillRect(-L * 1.05, -Hh * 1.05, L * 2.1, Hh * 2.1);
  }
  {
    const bounce = c.createLinearGradient(0, Hh * 0.55, 0, Hh * 1.02);
    bounce.addColorStop(0, 'rgba(165,215,235,0)');
    bounce.addColorStop(1, 'rgba(165,215,235,0.24)');
    c.fillStyle = bounce; c.fillRect(-L * 1.05, 0, L * 2.1, Hh * 1.1);
  }
  {
    const gx0 = L * 0.1 + Math.sin(tail * 0.55) * L * 0.24;
    const gloss = c.createRadialGradient(gx0, -Hh * 0.5, 0, gx0, -Hh * 0.38, L * 0.9);
    gloss.addColorStop(0, 'rgba(255,255,255,0.30)');
    gloss.addColorStop(0.4, 'rgba(255,255,255,0.10)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gloss; c.fillRect(-L * 1.05, -Hh * 1.05, L * 2.1, Hh * 1.6);
  }
  c.strokeStyle = 'rgba(0,0,0,0.14)'; c.lineWidth = Math.max(0.8, L * 0.03);
  c.beginPath(); c.moveTo(-L * 0.85, -Hh * 0.05); c.quadraticCurveTo(0, Hh * 0.18, L * 0.8, -Hh * 0.05); c.stroke();
  // (no live water-caustic pass here — see file header)
  if (fine) {
    c.fillStyle = 'rgba(0,10,20,0.08)';
    c.beginPath(); c.ellipse(L * 0.33, 0, L * 0.09, Hh * 0.62, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = shadeColor(body, -0.3); c.globalAlpha *= 0.55; c.lineWidth = Math.max(0.8, L * 0.045);
    c.beginPath(); c.moveTo(L * 0.46, -Hh * 0.62); c.quadraticCurveTo(L * 0.24, 0, L * 0.46, Hh * 0.6); c.stroke();
    c.globalAlpha /= 0.55;
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = Math.max(0.6, L * 0.02);
    c.beginPath(); c.moveTo(L * 0.42, -Hh * 0.55); c.quadraticCurveTo(L * 0.21, 0, L * 0.42, Hh * 0.54); c.stroke();
  }
  c.restore();
  c.strokeStyle = shadeColor(body, -0.3); c.globalAlpha *= 0.5; c.lineWidth = Math.max(0.8, L * 0.04);
  fishBodyPath(c, L, Hh); c.stroke(); c.globalAlpha /= 0.5;

  // pattern overlay, clipped to the body
  if (pattern !== 'none') {
    c.save();
    fishBodyPath(c, L, Hh); c.clip();
    c.fillStyle = 'rgba(0,0,0,0.22)';
    if (pattern === 'stripes') {
      for (let i = -2; i <= 2; i++) c.fillRect(i * L * 0.32 - L * 0.07, -Hh, L * 0.14, Hh * 1.4);
    } else if (pattern === 'spots') {
      c.fillStyle = 'rgba(220,90,90,0.55)';
      for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(-L * 0.7 + i * L * 0.23, Math.sin(i * 2.1) * Hh * 0.4, Hh * 0.12, 0, Math.PI * 2); c.fill(); }
    } else if (pattern === 'dashes') {
      c.fillStyle = 'rgba(230,230,160,0.4)';
      for (let i = 0; i < 6; i++) c.fillRect(-L * 0.8 + i * L * 0.28, -Hh * 0.2 + Math.sin(i) * Hh * 0.3, L * 0.14, Hh * 0.18);
    } else if (pattern === 'scales') {
      c.strokeStyle = 'rgba(0,0,0,0.15)'; c.lineWidth = 1;
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
        c.beginPath(); c.arc(-L * 0.7 + i * L * 0.25 + (r % 2) * L * 0.12, -Hh * 0.6 + r * Hh * 0.4, L * 0.12, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      }
    } else if (pattern === 'moon') {
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.beginPath(); c.arc(-L * 0.2, -Hh * 0.1, Hh * 0.35, 0, Math.PI * 2); c.fill();
      c.fillStyle = body;
      c.beginPath(); c.arc(-L * 0.08, -Hh * 0.2, Hh * 0.3, 0, Math.PI * 2); c.fill();
    } else if (pattern === 'koi') {
      c.fillStyle = fin;
      c.beginPath(); c.ellipse(-L * 0.45, -Hh * 0.3, L * 0.28, Hh * 0.45, 0.3, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(L * 0.25, Hh * 0.15, L * 0.22, Hh * 0.4, -0.4, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#222'; c.beginPath(); c.arc(-L * 0.05, -Hh * 0.55, Hh * 0.15, 0, Math.PI * 2); c.fill();
    } else if (pattern === 'puffer') {
      c.fillStyle = 'rgba(90,70,20,0.35)';
      for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(-L * 0.6 + (i % 3) * L * 0.5, -Hh * 0.5 + Math.floor(i / 3) * Hh * 0.5, Hh * 0.1, 0, Math.PI * 2); c.fill(); }
    } else if (pattern === 'shark') {
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(L * 0.35 - i * L * 0.08, 0, Hh * 0.45, -0.6, 0.6); c.stroke(); }
    } else if (pattern === 'teeth' || pattern === 'lure') {
      c.fillStyle = 'rgba(0,0,0,0.1)';
      c.fillRect(-L, -Hh, L * 2, Hh * 0.35);
    }
    c.restore();
  }

  // extras outside the body outline
  if (pattern === 'puffer') {
    c.strokeStyle = fin; c.lineWidth = Math.max(1, L * 0.06);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
      const px = Math.cos(a) * L, py = Math.sin(a) * Hh;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px * 1.22, py * 1.22); c.stroke();
    }
  }
  if (pattern === 'shark') {
    c.fillStyle = fin;
    c.beginPath(); c.moveTo(-L * 0.35, -Hh * 0.7); c.lineTo(-L * 0.05, -Hh * 2.2); c.lineTo(L * 0.3, -Hh * 0.7); c.closePath(); c.fill();
  }
  if (pattern === 'shark' || pattern === 'teeth' || pattern === 'lure') {
    drawMaw(c, col, pattern, L, Hh, fine);
  }
  if (pattern === 'lure') {
    c.strokeStyle = fin; c.lineWidth = Math.max(1, L * 0.05);
    c.beginPath(); c.moveTo(L * 0.4, -Hh * 0.9); c.quadraticCurveTo(L * 0.7, -Hh * 2.2, L * 1.15, -Hh * 1.5); c.stroke();
    c.shadowColor = '#9fffe0'; c.shadowBlur = L * 0.6;
    c.fillStyle = '#c8fff0'; c.beginPath(); c.arc(L * 1.15, -Hh * 1.5, Hh * 0.22, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
  }

  // near pectoral fin — ANIMATED (`sin(tail*0.9+1.2)`, fish.js:687), fixed at 0 here.
  const finRot = 0.35 + Math.sin(tail * 0.9 + 1.2) * 0.3;
  {
    c.save();
    fishBodyPath(c, L, Hh); c.clip();
    c.translate(L * 0.19, Hh * 0.38);
    c.rotate(finRot);
    c.fillStyle = 'rgba(0,12,22,0.22)';
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-L * 0.34, Hh * 0.18, -L * 0.42, Hh * 0.62);
    c.quadraticCurveTo(-L * 0.16, Hh * 0.5, 0, 0);
    c.closePath(); c.fill();
    c.restore();
  }
  c.save();
  c.translate(L * 0.16, Hh * 0.3);
  c.rotate(finRot);
  {
    const fr = shadeColor(fin, -0.08);
    const [fr0, fr1, fr2] = fr.match(/[\d.]+/g)!.map(Number);
    const fg2 = c.createLinearGradient(0, 0, -L * 0.42, Hh * 0.62);
    fg2.addColorStop(0, `rgba(${fr0},${fr1},${fr2},1)`);
    fg2.addColorStop(1, `rgba(${fr0},${fr1},${fr2},0.5)`);
    c.fillStyle = fg2;
  }
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(-L * 0.34, Hh * 0.18, -L * 0.42, Hh * 0.62);
  c.quadraticCurveTo(-L * 0.16, Hh * 0.5, 0, 0);
  c.closePath(); c.fill();
  c.restore();

  // whiskers — ANIMATED on the longer one (`sin(tail)`, fish.js:722), fixed at 0.
  if (pattern === 'whiskers') {
    c.strokeStyle = fin; c.lineWidth = Math.max(1, L * 0.04);
    c.beginPath(); c.moveTo(L * 0.9, Hh * 0.1); c.quadraticCurveTo(L * 1.4, Hh * 0.2 + Math.sin(tail) * 3, L * 1.5, Hh * 0.8); c.stroke();
    c.beginPath(); c.moveTo(L * 0.9, Hh * 0.25); c.quadraticCurveTo(L * 1.3, Hh * 0.7, L * 1.25, Hh * 1.3); c.stroke();
  }

  // eye + standard mouth
  {
    const er = Math.max(1.5, Hh * 0.27), exx = L * 0.58, eyy = -Hh * 0.25;
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.arc(exx, eyy + er * 0.15, er * 1.08, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f4f6f2'; c.beginPath(); c.arc(exx, eyy, er, 0, Math.PI * 2); c.fill();
    if (fine) { c.fillStyle = shadeColor(fin, -0.15); c.beginPath(); c.arc(exx + er * 0.22, eyy, er * 0.62, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#14161c'; c.beginPath(); c.arc(exx + er * 0.26, eyy, er * 0.42, 0, Math.PI * 2); c.fill();
    if (fine) { c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.arc(exx + er * 0.1, eyy - er * 0.3, er * 0.16, 0, Math.PI * 2); c.fill(); }
    if (pattern !== 'shark' && pattern !== 'teeth' && pattern !== 'lure') {
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(1, L * 0.03); c.lineCap = 'round';
      c.beginPath(); c.moveTo(L * 0.8, Hh * 0.22); c.quadraticCurveTo(L * 0.9, Hh * 0.26, L * 0.99, Hh * 0.12); c.stroke();
    }
  }
  if (pattern === 'frozen') drawFrozenOverlay(c, L, Hh);
}

// ---------------------------------------------------------------------------
// Junk / bycatch shapes (`drawBoot`/`drawBottle`/`drawChest`, fish.js:807-855)
/**
 * The old boot — redrawn.
 *
 * The original was a six-point polygon, a rectangle for the sole and three
 * straight lines for laces. Flat, cornered, and the weakest art in the game
 * — which matters because bycatch is common and the catch card shows it at
 * full size. Dustin's standing rule for the rebuild is "must not look worse,
 * at most better", and this was the clearest place to be better.
 *
 * What it has now: a curved shaft with a folded-over cuff, a rounded toe, a
 * proper sole with a heel and tread notches, eyelets with a criss-cross
 * lace, worn leather shading, two scuffs, and a strand of algae — it has
 * been in a lake, after all. All deterministic, so it bakes once.
 *
 * Faces right, like every other sprite, so the batch can flip it.
 */
function drawBoot(c: CanvasRenderingContext2D, L: number, col: Col): void {
  const leather = col.body;
  const dark = shadeColor(leather, -0.42);
  const mid = shadeColor(leather, -0.18);
  const light = shadeColor(leather, 0.2);

  // --- sole, drawn first so the upper overlaps it ---
  const soleY = L * 0.74;
  c.fillStyle = shadeColor(leather, -0.62);
  c.beginPath();
  c.moveTo(-L * 0.46, soleY);
  c.lineTo(L * 0.92, soleY);
  c.quadraticCurveTo(L * 1.02, soleY + L * 0.06, L * 0.9, soleY + L * 0.13);
  c.lineTo(-L * 0.3, soleY + L * 0.13);
  c.quadraticCurveTo(-L * 0.5, soleY + L * 0.13, -L * 0.46, soleY);
  c.closePath();
  c.fill();
  // heel block
  c.fillStyle = shadeColor(leather, -0.7);
  c.beginPath();
  c.moveTo(-L * 0.44, soleY + L * 0.1);
  c.lineTo(-L * 0.12, soleY + L * 0.1);
  c.lineTo(-L * 0.16, soleY + L * 0.28);
  c.lineTo(-L * 0.44, soleY + L * 0.28);
  c.closePath();
  c.fill();
  // tread notches
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = Math.max(1, L * 0.022);
  for (let i = 0; i < 5; i++) {
    const x = L * (0.08 + i * 0.17);
    c.beginPath();
    c.moveTo(x, soleY + L * 0.03);
    c.lineTo(x, soleY + L * 0.12);
    c.stroke();
  }

  // --- upper: shaft leaning back, instep, rounded toe ---
  const g = c.createLinearGradient(0, -L * 0.95, 0, soleY);
  g.addColorStop(0, mid);
  g.addColorStop(0.45, leather);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-L * 0.44, -L * 0.86);                                   // cuff, back
  c.quadraticCurveTo(-L * 0.5, -L * 0.1, -L * 0.42, soleY);         // heel line
  c.lineTo(L * 0.14, soleY);                                        // arch
  c.quadraticCurveTo(L * 0.72, soleY + L * 0.02, L * 0.9, soleY - L * 0.12);  // toe underside
  c.quadraticCurveTo(L * 1.0, soleY - L * 0.3, L * 0.72, soleY - L * 0.42);   // toe cap
  c.quadraticCurveTo(L * 0.34, soleY - L * 0.56, L * 0.1, -L * 0.02);         // instep
  c.quadraticCurveTo(L * 0.04, -L * 0.5, L * 0.06, -L * 0.84);      // tongue front
  c.closePath();
  c.fill();

  // --- folded cuff ---
  c.fillStyle = light;
  c.beginPath();
  c.moveTo(-L * 0.46, -L * 0.86);
  c.quadraticCurveTo(-L * 0.2, -L * 0.99, L * 0.08, -L * 0.84);
  c.quadraticCurveTo(-L * 0.18, -L * 0.72, -L * 0.46, -L * 0.86);
  c.closePath();
  c.fill();
  // the dark opening, so it reads as hollow
  c.fillStyle = 'rgba(12,10,8,0.72)';
  c.beginPath();
  c.ellipse(-L * 0.19, -L * 0.85, L * 0.26, L * 0.07, -0.06, 0, Math.PI * 2);
  c.fill();

  // --- worn highlight along the shaft ---
  c.strokeStyle = 'rgba(255,238,205,0.16)';
  c.lineWidth = Math.max(1.2, L * 0.05);
  c.beginPath();
  c.moveTo(-L * 0.3, -L * 0.72);
  c.quadraticCurveTo(-L * 0.36, -L * 0.2, -L * 0.29, L * 0.5);
  c.stroke();

  // --- eyelets and lace ---
  const eyeX0 = -L * 0.03, eyeX1 = L * 0.11;
  const ROWS = 4;
  const rowY = (i: number) => -L * 0.66 + i * L * 0.22;
  // Thin, warm, and slightly translucent. The first pass used a bright
  // near-white at three times this width and the crosses read as sticking
  // plasters rather than a lace.
  c.strokeStyle = 'rgba(214,196,158,0.72)';
  c.lineWidth = Math.max(0.8, L * 0.016);
  c.lineCap = 'round';
  for (let i = 0; i < ROWS - 1; i++) {
    const y0 = rowY(i), y1 = rowY(i + 1);
    c.beginPath(); c.moveTo(eyeX0, y0); c.lineTo(eyeX1, y1); c.stroke();
    c.beginPath(); c.moveTo(eyeX1, y0); c.lineTo(eyeX0, y1); c.stroke();
  }
  c.lineCap = 'butt';
  c.fillStyle = shadeColor(leather, -0.72);
  for (let i = 0; i < ROWS; i++) {
    for (const x of [eyeX0, eyeX1]) {
      c.beginPath();
      c.arc(x, rowY(i), Math.max(0.8, L * 0.022), 0, Math.PI * 2);
      c.fill();
    }
  }

  // --- two scuffs, fixed positions so the bake stays deterministic ---
  c.fillStyle = 'rgba(0,0,0,0.16)';
  c.beginPath();
  c.ellipse(L * 0.48, soleY - L * 0.3, L * 0.13, L * 0.07, 0.3, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(-L * 0.34, L * 0.18, L * 0.07, L * 0.13, -0.2, 0, Math.PI * 2);
  c.fill();

  // --- algae: it came out of a lake, not out of a shop ---
  //
  // Drawn hanging OFF the outer edge, not across the shaft. The first pass
  // ran them down the middle of the leather, inside the silhouette, and they
  // read as a second set of green laces.
  c.strokeStyle = 'rgba(78,138,80,0.85)';
  c.lineCap = 'round';
  const strands: Array<[number, number, number, number, number, number]> = [
    // startX, startY, ctrlX, ctrlY, endX, endY — all outside the upper
    [-L * 0.45, -L * 0.7, -L * 0.72, -L * 0.42, -L * 0.6, -L * 0.05],
    [-L * 0.47, -L * 0.4, -L * 0.78, -L * 0.1, -L * 0.66, L * 0.3],
    [L * 0.86, soleY - L * 0.36, L * 1.06, soleY - L * 0.2, L * 0.96, soleY + L * 0.04],
  ];
  for (let i = 0; i < strands.length; i++) {
    const [sx, sy, cx1, cy1, ex, ey] = strands[i];
    c.lineWidth = Math.max(1, L * (0.05 - i * 0.008));
    c.beginPath();
    c.moveTo(sx, sy);
    c.quadraticCurveTo(cx1, cy1, ex, ey);
    c.stroke();
    // a small blade at the tip so it is weed and not wire
    c.fillStyle = 'rgba(96,160,98,0.85)';
    c.beginPath();
    c.ellipse(ex, ey, L * 0.075, L * 0.028, i === 2 ? 0.5 : 1.1, 0, Math.PI * 2);
    c.fill();
  }
  c.lineCap = 'butt';
}

/** `tail` kept for parity with the old signature; the bottle rocks with it (`sin(tail*0.3)`). Called with `tail=0`. */
function drawBottle(c: CanvasRenderingContext2D, L: number, tail: number): void {
  c.rotate(Math.sin(tail * 0.3) * 0.25 + 0.9);
  c.fillStyle = 'rgba(140,210,190,0.85)';
  c.beginPath(); c.roundRect(-L * 0.35, -L * 0.7, L * 0.7, L * 1.5, L * 0.18); c.fill();
  c.fillRect(-L * 0.15, -L * 1.1, L * 0.3, L * 0.45);
  c.fillStyle = '#8a5a2b'; c.fillRect(-L * 0.17, -L * 1.25, L * 0.34, L * 0.2);
  c.fillStyle = '#f4e9c8'; c.fillRect(-L * 0.22, -L * 0.4, L * 0.44, L * 0.9);
  c.strokeStyle = '#8a7a5a'; c.lineWidth = 1;
  for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-L * 0.14, -L * 0.2 + i * L * 0.25); c.lineTo(L * 0.14, -L * 0.2 + i * L * 0.25); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(-L * 0.3, -L * 0.6, L * 0.08, L * 1.2);
}

function drawChest(c: CanvasRenderingContext2D, L: number): void {
  const wood = '#8a5a2b', gold = '#d4a017';
  c.fillStyle = wood;
  c.beginPath(); c.roundRect(-L, -L * 0.3, L * 2, L * 1.0, L * 0.1); c.fill();
  c.beginPath(); c.roundRect(-L, -L * 0.8, L * 2, L * 0.55, L * 0.3); c.fill();
  c.fillStyle = gold;
  c.fillRect(-L, -L * 0.32, L * 2, L * 0.1);
  c.fillRect(-L * 0.6, -L * 0.8, L * 0.12, L * 1.5); c.fillRect(L * 0.48, -L * 0.8, L * 0.12, L * 1.5);
  c.beginPath(); c.roundRect(-L * 0.18, -L * 0.4, L * 0.36, L * 0.4, L * 0.06); c.fill();
  c.fillStyle = '#3a2510'; c.beginPath(); c.arc(0, -L * 0.22, L * 0.07, 0, Math.PI * 2); c.fill();
  c.shadowColor = gold; c.shadowBlur = L * 0.6; c.fillStyle = 'rgba(255,220,100,0.25)';
  c.fillRect(-L * 0.9, -L * 0.3, L * 1.8, L * 0.05); c.shadowBlur = 0;
}

// ---------------------------------------------------------------------------
// Creature shared helpers (`creatures.js:9-41`)
function cGrad(c: CanvasRenderingContext2D, col: Col, y0: number, y1: number): string | CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shadeColor(col.body, -0.2));
  g.addColorStop(0.45, col.body);
  g.addColorStop(0.85, col.belly || shadeColor(col.body, 0.18));
  g.addColorStop(1, shadeColor(col.belly || col.body, -0.08));
  return g;
}
function cOutline(c: CanvasRenderingContext2D, col: Col, L: number, a = 0.55): void {
  c.save(); c.globalAlpha *= a;
  c.strokeStyle = shadeColor(col.body, -0.4);
  c.lineWidth = Math.max(0.8, L * 0.04);
  c.stroke(); c.restore();
}
function cEye(c: CanvasRenderingContext2D, x: number, y: number, r: number, pupil = '#14171c'): void {
  c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = Math.max(0.6, r * 0.18);
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  c.fillStyle = pupil; c.beginPath(); c.arc(x + r * 0.18, y, r * 0.52, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.95)';
  c.beginPath(); c.arc(x + r * 0.4, y - r * 0.42, r * 0.24, 0, Math.PI * 2); c.fill();
}
function cGloss(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.2): void {
  c.fillStyle = `rgba(255,255,255,${a})`;
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
}

type CreatureDrawFn = (c: CanvasRenderingContext2D, L: number, Hh: number, tail: number, col: Col) => void;

/** The 14 non-fish body types (`CREATURE_DRAW`, creatures.js:43-792), verbatim minus `col.sil`. */
const CREATURE_DRAW: Record<string, CreatureDrawFn> = {
  // ===== Octopus: tapering arm bands + domed mantle. Arms sway independently, ANIMATED per-arm (`sin(tail*1.4+i*0.8)`). =====
  octopus(c, L, Hh, tail, col) {
    const armFill = shadeColor(col.body, -0.1);
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const bx = -L * 0.62 + t * L * 1.24;
      const sway = Math.sin(tail * 1.4 + i * 0.8) * L * 0.3;
      const len = Hh * (1.35 + Math.sin(i * 1.7) * 0.25);
      const w0 = L * 0.14, x1 = bx + sway * 1.5 + (i - 3.5) * L * 0.07, y1 = Hh * 0.2 + len;
      const cx = bx + sway, cy = Hh * 0.2 + len * 0.55;
      c.fillStyle = armFill;
      c.beginPath();
      c.moveTo(bx - w0, Hh * 0.1);
      c.quadraticCurveTo(cx - w0 * 0.5, cy, x1, y1);
      c.quadraticCurveTo(cx + w0 * 0.6, cy, bx + w0, Hh * 0.1);
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.28)';
      for (let s2 = 1; s2 <= 4; s2++) {
        const q = s2 / 5;
        const px = bx + (cx - bx) * q * 1.4 + (x1 - bx) * q * q * 0.35;
        const py = Hh * 0.1 + (y1 - Hh * 0.1) * q;
        c.beginPath(); c.arc(px, py, L * 0.035 * (1 - q * 0.5), 0, Math.PI * 2); c.fill();
      }
    }
    c.fillStyle = cGrad(c, col, -Hh * 1.15, Hh * 0.5);
    c.beginPath(); c.ellipse(0, -Hh * 0.32, L * 0.72, Hh * 0.85, 0, 0, Math.PI * 2);
    c.fill(); cOutline(c, col, L);
    c.save();
    c.beginPath(); c.ellipse(0, -Hh * 0.32, L * 0.72, Hh * 0.85, 0, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(0,0,0,0.13)';
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.arc(-L * 0.45 + (i % 4) * L * 0.28, -Hh * (0.85 - Math.floor(i / 4) * 0.45) + Math.sin(i) * Hh * 0.1, L * 0.06, 0, Math.PI * 2);
      c.fill();
    }
    cGloss(c, -L * 0.15, -Hh * 0.85, L * 0.4, Hh * 0.16, 0.22);
    c.restore();
    for (const ex of [L * 0.3, -L * 0.2]) {
      c.fillStyle = '#f6efd8';
      c.beginPath(); c.ellipse(ex, -Hh * 0.38, Hh * 0.26, Hh * 0.22, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = Math.max(0.7, Hh * 0.04);
      c.beginPath(); c.ellipse(ex, -Hh * 0.38, Hh * 0.26, Hh * 0.22, 0, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#14171c';
      c.beginPath(); c.ellipse(ex + Hh * 0.03, -Hh * 0.38, Hh * 0.18, Hh * 0.06, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.beginPath(); c.arc(ex + Hh * 0.12, -Hh * 0.46, Hh * 0.05, 0, Math.PI * 2); c.fill();
    }
  },

  // ===== Squid: rear fins + pointed mantle + forward tentacles. Fins/tentacles ANIMATED (`sin(tail)`/`sin(tail*2+i)`). =====
  squid(c, L, Hh, tail, col) {
    c.fillStyle = shadeColor(col.fin, -0.05);
    const fl = Math.sin(tail) * Hh * 0.22;
    c.beginPath(); c.moveTo(-L * 0.55, -Hh * 0.35);
    c.quadraticCurveTo(-L * 1.15, -Hh * 1.0 - fl, -L * 1.35, -Hh * 0.05);
    c.quadraticCurveTo(-L * 1.15, Hh * 1.0 - fl, -L * 0.55, Hh * 0.35);
    c.closePath(); c.fill(); cOutline(c, col, L, 0.35);
    c.fillStyle = cGrad(c, col, -Hh * 0.8, Hh * 0.8);
    c.beginPath();
    c.moveTo(L * 0.55, -Hh * 0.45);
    c.quadraticCurveTo(L * 0.1, -Hh * 0.72, -L * 1.25, 0);
    c.quadraticCurveTo(L * 0.1, Hh * 0.72, L * 0.55, Hh * 0.45);
    c.quadraticCurveTo(L * 0.8, 0, L * 0.55, -Hh * 0.45);
    c.closePath(); c.fill(); cOutline(c, col, L);
    c.save();
    c.beginPath();
    c.moveTo(L * 0.55, -Hh * 0.45); c.quadraticCurveTo(L * 0.1, -Hh * 0.72, -L * 1.25, 0);
    c.quadraticCurveTo(L * 0.1, Hh * 0.72, L * 0.55, Hh * 0.45); c.closePath(); c.clip();
    cGloss(c, -L * 0.2, -Hh * 0.42, L * 0.65, Hh * 0.12, 0.25);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(-L * 0.9 + i * L * 0.3, Hh * 0.15, L * 0.05, 0, Math.PI * 2); c.fill(); }
    c.restore();
    c.strokeStyle = shadeColor(col.body, -0.12);
    c.lineWidth = Math.max(1.5, L * 0.08); c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y0 = -Hh * 0.42 + i * Hh * 0.14, w = Math.sin(tail * 2 + i) * L * 0.18;
      c.beginPath(); c.moveTo(L * 0.6, y0);
      c.quadraticCurveTo(L * 1.05, y0 + w, L * 1.45 + (i % 2) * L * 0.2, y0 * 1.7 + w);
      c.stroke();
    }
    cEye(c, L * 0.46, -Hh * 0.16, Hh * 0.24);
  },

  // ===== Jellyfish: translucent bell + tentacle ribbons + edge fringes. Bell shape ANIMATED (`pulse = sin(tail*0.8)`). =====
  jelly(c, L, Hh, tail, col) {
    const pulse = Math.sin(tail * 0.8);
    const R = L * 0.82 * (1 + pulse * 0.09);
    const bellH = Hh * (1.05 - pulse * 0.12);
    const cy = -Hh * 0.3;
    const bellPath = () => {
      c.beginPath();
      c.moveTo(-R, cy);
      c.bezierCurveTo(-R, cy - bellH * 1.35, R, cy - bellH * 1.35, R, cy);
      c.bezierCurveTo(R * 0.75, cy + Hh * 0.42, -R * 0.75, cy + Hh * 0.42, -R, cy);
      c.closePath();
    };
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const bx = -R * 0.62 + t * R * 1.24;
      const sway = Math.sin(tail * 1.1 + i * 0.9) * L * 0.26;
      const len = Hh * (1.5 + Math.sin(i * 2.1) * 0.4);
      const w0 = L * 0.055 * (1 - Math.abs(t - 0.5) * 0.6);
      const g = c.createLinearGradient(bx, cy, bx + sway, cy + len);
      g.addColorStop(0, shadeColor(col.fin, 0.1)); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(bx - w0, cy);
      c.quadraticCurveTo(bx + sway - w0 * 0.4, cy + len * 0.6, bx + sway * 1.5, cy + len);
      c.quadraticCurveTo(bx + sway + w0 * 0.5, cy + len * 0.6, bx + w0, cy);
      c.closePath(); c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = Math.max(0.8, L * 0.025); c.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const a = Math.PI + (i / 11) * Math.PI;
      const ex = Math.cos(a) * R * 0.96, ey = cy - Math.sin(a) * Hh * 0.1;
      c.beginPath(); c.moveTo(ex, ey);
      c.lineTo(ex + Math.sin(tail * 2 + i) * L * 0.05, ey + Hh * 0.3);
      c.stroke();
    }
    {
      const g = c.createRadialGradient(-R * 0.28, cy - bellH * 0.55, R * 0.08, 0, cy - bellH * 0.15, R * 1.15);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.35, shadeColor(col.body, 0.15));
      g.addColorStop(0.78, col.body);
      g.addColorStop(1, shadeColor(col.body, -0.28));
      c.fillStyle = g; c.globalAlpha *= 0.82;
    }
    bellPath(); c.fill();
    c.globalAlpha /= 0.82;
    c.save();
    bellPath(); c.clip();
    {
      const sh = c.createLinearGradient(0, cy - Hh * 0.1, 0, cy + Hh * 0.45);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,20,40,0.28)');
      c.fillStyle = sh; c.fillRect(-R, cy - Hh * 0.1, R * 2, Hh * 0.6);
    }
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = Math.max(1, L * 0.035);
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(i * R * 0.2, cy - bellH * 0.9);
      c.quadraticCurveTo(i * R * 0.3, cy - bellH * 0.2, i * R * 0.36, cy + Hh * 0.2);
      c.stroke();
    }
    c.restore();
    c.save();
    c.lineWidth = Math.max(1.2, L * 0.05);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.beginPath();
    c.moveTo(-R * 0.98, cy - Hh * 0.05);
    c.bezierCurveTo(-R * 0.98, cy - bellH * 1.3, R * 0.98, cy - bellH * 1.3, R * 0.98, cy - Hh * 0.05);
    c.stroke();
    c.restore();
    cGloss(c, -R * 0.34, cy - bellH * 0.72, R * 0.22, Hh * 0.16, 0.55);
    cGloss(c, R * 0.42, cy - bellH * 0.5, R * 0.08, Hh * 0.09, 0.3);
  },

  // ===== Crab: 6 jointed legs, domed carapace, claws, stalked eyes. Legs/claws ANIMATED (`sin(tail*3+..)`/`sin(tail*2+..)`). =====
  crab(c, L, Hh, tail, col) {
    const leg = shadeColor(col.body, -0.15);
    c.strokeStyle = leg; c.lineWidth = Math.max(1.5, L * 0.09); c.lineCap = 'round'; c.lineJoin = 'round';
    for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 3; i++) {
      const bx = s * L * 0.55, by = -Hh * 0.15 + i * Hh * 0.32, k = Math.sin(tail * 3 + i + (s > 0 ? 0 : 1.5)) * L * 0.09;
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx + s * L * 0.45 + k, by + Hh * 0.18);
      c.lineTo(bx + s * L * 0.72 + k, by + Hh * 0.85);
      c.stroke();
    }
    c.fillStyle = cGrad(c, col, -Hh * 0.9, Hh * 0.7);
    c.beginPath();
    c.moveTo(-L * 0.85, Hh * 0.1);
    c.quadraticCurveTo(-L * 0.7, -Hh * 0.85, 0, -Hh * 0.78);
    c.quadraticCurveTo(L * 0.7, -Hh * 0.85, L * 0.85, Hh * 0.1);
    c.quadraticCurveTo(0, Hh * 0.95, -L * 0.85, Hh * 0.1);
    c.closePath(); c.fill(); cOutline(c, col, L);
    c.save();
    c.beginPath();
    c.moveTo(-L * 0.85, Hh * 0.1); c.quadraticCurveTo(-L * 0.7, -Hh * 0.85, 0, -Hh * 0.78);
    c.quadraticCurveTo(L * 0.7, -Hh * 0.85, L * 0.85, Hh * 0.1);
    c.quadraticCurveTo(0, Hh * 0.95, -L * 0.85, Hh * 0.1); c.closePath(); c.clip();
    cGloss(c, -L * 0.1, -Hh * 0.55, L * 0.5, Hh * 0.14, 0.25);
    c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = Math.max(0.8, L * 0.03);
    c.beginPath(); c.moveTo(-L * 0.5, Hh * 0.25); c.quadraticCurveTo(0, Hh * 0.05, L * 0.5, Hh * 0.25); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(-L * 0.45 + i * L * 0.3, -Hh * 0.3, L * 0.06, 0, Math.PI * 2); c.fill(); }
    c.restore();
    for (let s = -1; s <= 1; s += 2) {
      const o = Math.sin(tail * 2 + (s > 0 ? 0 : 1)) * 0.18;
      c.fillStyle = cGrad(c, col, -Hh * 1.2, -Hh * 0.2);
      c.beginPath(); c.ellipse(s * L * 1.02, -Hh * 0.5, L * 0.3, Hh * 0.32, s * 0.3, 0, Math.PI * 2);
      c.fill(); cOutline(c, col, L, 0.4);
      c.fillStyle = shadeColor(col.body, 0.1);
      c.beginPath();
      c.moveTo(s * L * 0.98, -Hh * 0.72);
      c.lineTo(s * L * 1.42, -Hh * (1.15 + o));
      c.lineTo(s * L * 1.2, -Hh * 0.52);
      c.closePath(); c.fill();
    }
    c.strokeStyle = leg; c.lineWidth = Math.max(1.2, L * 0.05);
    for (const ex of [-L * 0.26, L * 0.26]) {
      c.beginPath(); c.moveTo(ex, -Hh * 0.6); c.lineTo(ex, -Hh * 0.95); c.stroke();
    }
    cEye(c, -L * 0.26, -Hh * 1.05, Hh * 0.17);
    cEye(c, L * 0.26, -Hh * 1.05, Hh * 0.17);
  },

  // ===== Ray: wide diamond wings + whip tail. Wings/tail ANIMATED (`flap = sin(tail)`, tail whip two independent sines). =====
  ray(c, L, Hh, tail, col) {
    const flap = Math.sin(tail) * Hh * 0.35;
    c.fillStyle = cGrad(c, col, -Hh * 1.6, Hh * 1.6);
    c.beginPath();
    c.moveTo(L * 0.92, 0);
    c.quadraticCurveTo(L * 0.2, -Hh * 1.65 - flap, -L * 0.85, -Hh * 0.22);
    c.quadraticCurveTo(-L * 0.45, 0, -L * 0.85, Hh * 0.22);
    c.quadraticCurveTo(L * 0.2, Hh * 1.65 + flap, L * 0.92, 0);
    c.closePath(); c.fill(); cOutline(c, col, L);
    c.strokeStyle = shadeColor(col.body, -0.15);
    c.lineWidth = Math.max(1.5, L * 0.07); c.lineCap = 'round';
    c.beginPath(); c.moveTo(-L * 0.72, 0);
    c.quadraticCurveTo(-L * 1.35, Math.sin(tail * 1.5) * Hh * 0.4, -L * 1.95, Math.sin(tail) * Hh * 0.65);
    c.stroke();
    c.save();
    c.beginPath();
    c.moveTo(L * 0.92, 0);
    c.quadraticCurveTo(L * 0.2, -Hh * 1.65 - flap, -L * 0.85, -Hh * 0.22);
    c.quadraticCurveTo(-L * 0.45, 0, -L * 0.85, Hh * 0.22);
    c.quadraticCurveTo(L * 0.2, Hh * 1.65 + flap, L * 0.92, 0);
    c.closePath(); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 8; i++) {
      const a = i * 1.9;
      c.beginPath(); c.ellipse(Math.cos(a) * L * 0.4, Math.sin(a) * Hh * 0.75, L * 0.11, Hh * 0.13, 0, 0, Math.PI * 2); c.fill();
    }
    cGloss(c, L * 0.15, -Hh * 0.5, L * 0.4, Hh * 0.18, 0.16);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = Math.max(0.8, L * 0.025);
    for (let i = 0; i < 3; i++) {
      c.beginPath(); c.moveTo(L * 0.25 - i * L * 0.14, Hh * 0.28); c.lineTo(L * 0.2 - i * L * 0.14, Hh * 0.55); c.stroke();
    }
    cEye(c, L * 0.55, -Hh * 0.24, Hh * 0.13);
  },

  // ===== Sea turtle: 4 flippers, domed shell with scute outlines. Flippers ANIMATED (`sin(tail)`, front/rear opposing phase). =====
  turtle(c, L, Hh, tail, col) {
    const k = Math.sin(tail) * L * 0.16;
    const flipper = shadeColor(col.fin, -0.05);
    c.fillStyle = flipper;
    c.beginPath(); c.ellipse(L * 0.32 + k, -Hh * 0.92, L * 0.48, Hh * 0.23, -0.55, 0, Math.PI * 2); c.fill(); cOutline(c, col, L, 0.3);
    c.beginPath(); c.ellipse(L * 0.32 - k, Hh * 0.92, L * 0.48, Hh * 0.23, 0.55, 0, Math.PI * 2); c.fill(); cOutline(c, col, L, 0.3);
    c.beginPath(); c.ellipse(-L * 0.72, -Hh * 0.7, L * 0.3, Hh * 0.18, 0.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(-L * 0.72, Hh * 0.7, L * 0.3, Hh * 0.18, -0.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = shadeColor(col.fin, 0.08);
    c.beginPath(); c.ellipse(L * 1.06, 0, L * 0.32, Hh * 0.37, 0, 0, Math.PI * 2); c.fill(); cOutline(c, col, L, 0.3);
    c.fillStyle = cGrad(c, col, -Hh * 0.85, Hh * 0.8);
    c.beginPath(); c.ellipse(0, 0, L * 0.92, Hh * 0.78, 0, 0, Math.PI * 2); c.fill(); cOutline(c, col, L);
    c.save();
    c.beginPath(); c.ellipse(0, 0, L * 0.92, Hh * 0.78, 0, 0, Math.PI * 2); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = Math.max(0.9, L * 0.03);
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.ellipse(i * L * 0.42, 0, L * 0.23, Hh * 0.36, 0, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath(); c.moveTo(-L, -Hh * 0.42); c.lineTo(L, -Hh * 0.42); c.stroke();
    c.beginPath(); c.moveTo(-L, Hh * 0.42); c.lineTo(L, Hh * 0.42); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.14)';
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.ellipse(i * L * 0.42, -Hh * 0.1, L * 0.14, Hh * 0.16, 0, 0, Math.PI * 2); c.fill(); }
    cGloss(c, -L * 0.1, -Hh * 0.55, L * 0.5, Hh * 0.12, 0.22);
    c.restore();
    cEye(c, L * 1.16, -Hh * 0.1, Hh * 0.12);
  },

  // ===== Flatfish (top-down): fin fringe halo, both eyes on one side. Body ANIMATED (`w = sin(tail)`, shared by body/tail/spots). =====
  flat(c, L, Hh, tail, col) {
    const w = Math.sin(tail) * Hh * 0.16;
    c.fillStyle = shadeColor(col.fin, -0.05);
    c.beginPath(); c.ellipse(0, 0, L * 1.08, Hh * 1.18, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = cGrad(c, col, -Hh, Hh);
    c.beginPath(); c.ellipse(0, w * 0.3, L * 0.95, Hh * 0.92, 0, 0, Math.PI * 2); c.fill(); cOutline(c, col, L);
    c.fillStyle = shadeColor(col.fin, -0.1);
    c.beginPath(); c.moveTo(-L * 0.9, 0); c.lineTo(-L * 1.45, -Hh * 0.5 + w); c.lineTo(-L * 1.3, w * 0.4); c.lineTo(-L * 1.45, Hh * 0.5 + w); c.closePath(); c.fill();
    c.save();
    c.beginPath(); c.ellipse(0, w * 0.3, L * 0.95, Hh * 0.92, 0, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.ellipse(-L * 0.7 + i * L * 0.2, Math.sin(i * 2.5) * Hh * 0.5, Hh * 0.13, Hh * 0.1, i, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(-L * 0.5 + i * L * 0.26, Math.cos(i * 2) * Hh * 0.4, Hh * 0.07, 0, Math.PI * 2); c.fill(); }
    c.restore();
    cEye(c, L * 0.52, -Hh * 0.28, Hh * 0.16);
    cEye(c, L * 0.56, Hh * 0.1, Hh * 0.16);
  },

  // ===== Seahorse: S-curve body, dorsal crest, curled tail. Tail curl/crest ANIMATED (`sin(tail)`/`sin(tail*3)`). =====
  seahorse(c, L, Hh, tail, col) {
    const curl = Math.sin(tail) * Hh * 0.22;
    c.strokeStyle = cGrad(c, col, -Hh * 1.6, Hh * 1.6);
    c.lineCap = 'round'; c.lineWidth = Math.max(2, Hh * 0.95);
    c.beginPath();
    c.moveTo(L * 0.3, -Hh * 1.35);
    c.quadraticCurveTo(-L * 0.5, -Hh * 0.55, L * 0.12, Hh * 0.22);
    c.quadraticCurveTo(L * 0.55, Hh * 0.95, -L * 0.3, Hh * 1.5 + curl);
    c.stroke();
    c.fillStyle = shadeColor(col.fin, 0.05);
    c.beginPath();
    c.moveTo(-L * 0.32, -Hh * 0.65);
    c.quadraticCurveTo(-L * 0.95, -Hh * 0.2 + Math.sin(tail * 3) * Hh * 0.15, -L * 0.28, Hh * 0.25);
    c.closePath(); c.fill();
    c.fillStyle = cGrad(c, col, -Hh * 1.8, -Hh * 1.0);
    c.beginPath(); c.ellipse(L * 0.36, -Hh * 1.4, L * 0.36, Hh * 0.46, 0.2, 0, Math.PI * 2); c.fill(); cOutline(c, col, L, 0.4);
    c.strokeStyle = cGrad(c, col, -Hh * 1.6, -Hh * 1.2);
    c.lineWidth = Math.max(1.5, Hh * 0.3);
    c.beginPath(); c.moveTo(L * 0.6, -Hh * 1.38); c.lineTo(L * 1.15, -Hh * 1.28); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(0.8, L * 0.03);
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      const px = L * 0.2 + (L * 0.05 - L * 0.2) * t, py = -Hh * 0.9 + (Hh * 1.1 - -Hh * 0.9) * t;
      c.beginPath(); c.moveTo(px - Hh * 0.4, py); c.lineTo(px + Hh * 0.4, py); c.stroke();
    }
    c.fillStyle = shadeColor(col.fin, 0.1);
    c.beginPath();
    c.moveTo(L * 0.2, -Hh * 1.75); c.lineTo(L * 0.3, -Hh * 2.05); c.lineTo(L * 0.42, -Hh * 1.72);
    c.closePath(); c.fill();
    cEye(c, L * 0.44, -Hh * 1.46, Hh * 0.14);
  },

  // ===== Starfish: 5-armed radial-gradient body. Whole shape ANIMATED via slow rotation (`rot = tail*0.1`). =====
  star(c, L, Hh, tail, col) {
    void Hh; // starfish radius is drawn from L on both axes, ignoring body height (matches old code)
    const rot = tail * 0.1;
    {
      const g = c.createRadialGradient(-L * 0.2, -L * 0.2, L * 0.1, 0, 0, L);
      g.addColorStop(0, shadeColor(col.body, 0.3));
      g.addColorStop(1, shadeColor(col.body, -0.2));
      c.fillStyle = g;
    }
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 - Math.PI / 2 + rot;
      const a2 = a + Math.PI / 5;
      const tipX = Math.cos(a) * L, tipY = Math.sin(a) * L;
      const vX = Math.cos(a2) * L * 0.4, vY = Math.sin(a2) * L * 0.4;
      if (i === 0) c.moveTo(tipX, tipY);
      else c.lineTo(tipX, tipY);
      c.quadraticCurveTo(vX * 1.15, vY * 1.15, Math.cos(a2 + Math.PI / 5) * L, Math.sin(a2 + Math.PI / 5) * L);
    }
    c.closePath(); c.fill(); cOutline(c, col, L);
    c.save();
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 - Math.PI / 2 + rot;
      const a2 = a + Math.PI / 5;
      if (i === 0) c.moveTo(Math.cos(a) * L, Math.sin(a) * L); else c.lineTo(Math.cos(a) * L, Math.sin(a) * L);
      c.quadraticCurveTo(Math.cos(a2) * L * 0.46, Math.sin(a2) * L * 0.46, Math.cos(a2 + Math.PI / 5) * L, Math.sin(a2 + Math.PI / 5) * L);
    }
    c.closePath(); c.clip();
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 - Math.PI / 2 + rot;
      const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
      const gg = c.createLinearGradient(nx * -L * 0.2, ny * -L * 0.2, nx * L * 0.2, ny * L * 0.2);
      gg.addColorStop(0, 'rgba(0,0,0,0.16)');
      gg.addColorStop(0.5, 'rgba(255,255,255,0.30)');
      gg.addColorStop(1, 'rgba(0,0,0,0.16)');
      c.strokeStyle = gg; c.lineWidth = L * 0.3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(Math.cos(a) * L * 0.12, Math.sin(a) * L * 0.12);
      c.lineTo(Math.cos(a) * L * 0.94, Math.sin(a) * L * 0.94); c.stroke();
    }
    {
      const mg = c.createRadialGradient(-L * 0.08, -L * 0.08, L * 0.02, 0, 0, L * 0.34);
      mg.addColorStop(0, 'rgba(255,255,255,0.35)'); mg.addColorStop(1, 'rgba(0,0,0,0.18)');
      c.fillStyle = mg; c.beginPath(); c.arc(0, 0, L * 0.34, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5 - Math.PI / 2 + rot;
      for (let j = 1; j <= 3; j++) {
        const r = L * (0.28 + j * 0.2);
        c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, L * 0.05, 0, Math.PI * 2); c.fill();
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath(); c.arc(0, 0, L * 0.1, 0, Math.PI * 2); c.fill();
  },

  // ===== Pearl oyster: hinged shell halves + radial-gradient pearl. Opening angle ANIMATED (`sin(tail*0.5)`). =====
  shell(c, L, Hh, tail, col) {
    const open = 0.25 + Math.max(0, Math.sin(tail * 0.5)) * 0.35;
    c.fillStyle = cGrad(c, col, 0, Hh);
    c.beginPath(); c.ellipse(0, Hh * 0.3, L, Hh * 0.62, 0, 0, Math.PI); c.fill(); cOutline(c, col, L, 0.4);
    {
      const pg = c.createRadialGradient(-Hh * 0.1, Hh * 0.02, Hh * 0.04, 0, Hh * 0.1, Hh * 0.3);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.6, '#f3e9d6'); pg.addColorStop(1, '#cbb89a');
      c.fillStyle = pg; c.shadowColor = 'rgba(255,255,255,0.8)'; c.shadowBlur = L * 0.4;
      c.beginPath(); c.arc(0, Hh * 0.1, Hh * 0.3, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
    }
    c.save(); c.translate(-L, Hh * 0.3); c.rotate(-open); c.translate(L, -Hh * 0.3);
    c.fillStyle = cGrad(c, col, -Hh * 0.5, Hh * 0.35);
    c.beginPath(); c.ellipse(0, Hh * 0.3, L, Hh * 0.62, 0, Math.PI, 0); c.fill(); cOutline(c, col, L, 0.4);
    c.save();
    c.beginPath(); c.ellipse(0, Hh * 0.3, L, Hh * 0.62, 0, Math.PI, 0); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = Math.max(0.8, L * 0.03);
    for (let i = -3; i <= 3; i++) {
      c.beginPath(); c.moveTo(-L * 0.02, Hh * 0.3); c.lineTo(i * L * 0.33, -Hh * 0.45); c.stroke();
    }
    cGloss(c, -L * 0.25, Hh * 0.02, L * 0.3, Hh * 0.1, 0.3);
    c.restore();
    c.restore();
  },

  // ===== Lost penguin (bycatch): tilted body, white belly, flippers. Whole tilt ANIMATED (`sin(tail*0.5)`), flippers `sin(tail*3)`. =====
  penguin(c, L, Hh, tail, col) {
    c.rotate(0.9 + Math.sin(tail * 0.5) * 0.1);
    const dark = '#1c2233';
    c.fillStyle = '#161b29';
    c.beginPath(); c.ellipse(L * 0.72, 0, L * 0.24, Hh * 0.72, 0.35 - Math.sin(tail * 3) * 0.22, 0, Math.PI * 2); c.fill();
    {
      const g = c.createLinearGradient(-L * 0.6, 0, L * 0.6, 0);
      g.addColorStop(0, '#2b3448'); g.addColorStop(0.6, dark); g.addColorStop(1, '#0f131d');
      c.fillStyle = g;
    }
    c.beginPath(); c.ellipse(0, 0, L * 0.72, Hh * 1.22, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(0, -Hh * 1.1, L * 0.52, 0, Math.PI * 2); c.fill();
    {
      const bg = c.createLinearGradient(-L * 0.4, 0, L * 0.4, 0);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#dfe6ef');
      c.fillStyle = bg;
    }
    c.beginPath(); c.ellipse(-L * 0.06, Hh * 0.12, L * 0.46, Hh * 0.92, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(-L * 0.06, -Hh * 1.06, L * 0.3, Hh * 0.32, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ff9f1c';
    c.beginPath(); c.moveTo(-L * 0.2, -Hh * 1.04); c.lineTo(-L * 0.52, -Hh * 0.94); c.lineTo(-L * 0.2, -Hh * 0.82); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(-L * 0.3, Hh * 1.28, L * 0.32, Hh * 0.13, 0.2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(L * 0.3, Hh * 1.26, L * 0.32, Hh * 0.13, -0.2, 0, Math.PI * 2); c.fill();
    cEye(c, -L * 0.16, -Hh * 1.2, Hh * 0.14);
    cEye(c, L * 0.2, -Hh * 1.2, Hh * 0.12);
    c.fillStyle = '#232b3d';
    c.beginPath(); c.ellipse(-L * 0.7, 0, L * 0.26, Hh * 0.74, -0.35 + Math.sin(tail * 3) * 0.22, 0, Math.PI * 2); c.fill();
  },

  // ===== Serpent (Nessie/Leviathan): 3 humps, tapering neck, horned head. Humps/neck/tail all bob independently (`sin` per-index). =====
  serpent(c, L, Hh, tail, col) {
    const humps = [
      { x: -L * 1.35, s: 0.72 },
      { x: -L * 0.6, s: 1.0 },
      { x: L * 0.15, s: 0.86 },
    ];
    const waterY = Hh * 0.62;

    c.fillStyle = cGrad(c, col, -Hh * 0.6, waterY);
    c.beginPath();
    c.moveTo(-L * 1.75, waterY);
    c.quadraticCurveTo(-L * 2.15, waterY - Hh * 0.5, -L * 2.35, waterY - Hh * 1.25 + Math.sin(tail) * Hh * 0.3);
    c.quadraticCurveTo(-L * 2.1, waterY - Hh * 0.35, -L * 1.5, waterY);
    c.closePath(); c.fill(); cOutline(c, col, L, 0.4);

    for (let i = 0; i < humps.length; i++) {
      const hp = humps[i];
      const by = Math.sin(tail * 0.9 + i * 1.2) * Hh * 0.12;
      const r = Hh * hp.s;
      c.fillStyle = cGrad(c, col, waterY - r * 1.1, waterY);
      c.beginPath();
      c.moveTo(hp.x - r * 0.95, waterY + by);
      c.bezierCurveTo(hp.x - r * 0.9, waterY + by - r * 1.7, hp.x + r * 0.9, waterY + by - r * 1.7, hp.x + r * 0.95, waterY + by);
      c.closePath(); c.fill(); cOutline(c, col, L, 0.45);
      const B0 = { x: hp.x - r * 0.95, y: waterY + by };
      const B1 = { x: hp.x - r * 0.9, y: waterY + by - r * 1.7 };
      const B2 = { x: hp.x + r * 0.9, y: waterY + by - r * 1.7 };
      const B3 = { x: hp.x + r * 0.95, y: waterY + by };
      const cPt = (t: number) => {
        const u = 1 - t;
        return {
          x: u * u * u * B0.x + 3 * u * u * t * B1.x + 3 * u * t * t * B2.x + t * t * t * B3.x,
          y: u * u * u * B0.y + 3 * u * u * t * B1.y + 3 * u * t * t * B2.y + t * t * t * B3.y,
        };
      };
      const cDir = (t: number) => {
        const u = 1 - t;
        const dx = 3 * u * u * (B1.x - B0.x) + 6 * u * t * (B2.x - B1.x) + 3 * t * t * (B3.x - B2.x);
        const dy = 3 * u * u * (B1.y - B0.y) + 6 * u * t * (B2.y - B1.y) + 3 * t * t * (B3.y - B2.y);
        const m = Math.hypot(dx, dy) || 1;
        return { x: dx / m, y: dy / m };
      };
      c.fillStyle = shadeColor(col.fin, 0.05);
      for (const t of [0.3, 0.5, 0.7]) {
        const p = cPt(t), d = cDir(t);
        const nx = d.y, ny = -d.x;
        const base = r * 0.13, len = r * 0.4;
        c.beginPath();
        c.moveTo(p.x - d.x * base, p.y - d.y * base);
        c.quadraticCurveTo(p.x + nx * len * 0.6, p.y + ny * len * 0.6, p.x + nx * len, p.y + ny * len);
        c.quadraticCurveTo(p.x + nx * len * 0.6, p.y + ny * len * 0.6, p.x + d.x * base, p.y + d.y * base);
        c.closePath(); c.fill();
      }
      cGloss(c, hp.x - r * 0.22, waterY + by - r * 0.95, r * 0.42, r * 0.11, 0.24);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(1, L * 0.03);
      c.beginPath(); c.ellipse(hp.x, waterY + by, r * 1.1, r * 0.16, 0, 0, Math.PI * 2); c.stroke();
    }

    const neckBase = { x: L * 0.9, y: waterY };
    const neckTop = { x: L * 1.15, y: -Hh * 1.75 + Math.sin(tail * 0.7) * Hh * 0.12 };
    const nw0 = Hh * 0.42, nw1 = Hh * 0.22;
    c.fillStyle = cGrad(c, col, neckTop.y, neckBase.y);
    c.beginPath();
    c.moveTo(neckBase.x - nw0, neckBase.y);
    c.quadraticCurveTo(L * 1.55 - nw1, -Hh * 0.5, neckTop.x - nw1, neckTop.y);
    c.lineTo(neckTop.x + nw1, neckTop.y);
    c.quadraticCurveTo(L * 1.55 + nw0 * 0.6, -Hh * 0.5, neckBase.x + nw0, neckBase.y);
    c.closePath(); c.fill(); cOutline(c, col, L, 0.45);
    c.save();
    c.beginPath();
    c.moveTo(neckBase.x - nw0, neckBase.y);
    c.quadraticCurveTo(L * 1.55 - nw1, -Hh * 0.5, neckTop.x - nw1, neckTop.y);
    c.lineTo(neckTop.x + nw1, neckTop.y);
    c.quadraticCurveTo(L * 1.55 + nw0 * 0.6, -Hh * 0.5, neckBase.x + nw0, neckBase.y);
    c.closePath(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = Math.max(0.8, L * 0.03);
    {
      const S0 = { x: neckBase.x + nw0, y: neckBase.y };
      const S1 = { x: L * 1.55 + nw0 * 0.6, y: -Hh * 0.5 };
      const S2 = { x: neckTop.x + nw1, y: neckTop.y };
      for (let i = 1; i <= 6; i++) {
        const t = i / 7, u = 1 - t;
        const px = u * u * S0.x + 2 * u * t * S1.x + t * t * S2.x;
        const py = u * u * S0.y + 2 * u * t * S1.y + t * t * S2.y;
        const dx = 2 * u * (S1.x - S0.x) + 2 * t * (S2.x - S1.x);
        const dy = 2 * u * (S1.y - S0.y) + 2 * t * (S2.y - S1.y);
        const ang = Math.atan2(dy, dx);
        c.beginPath(); c.arc(px - Math.cos(ang + Math.PI / 2) * Hh * 0.12, py - Math.sin(ang + Math.PI / 2) * Hh * 0.12,
          Hh * 0.2, ang + Math.PI * 0.15, ang + Math.PI * 0.85); c.stroke();
      }
    }
    c.restore();
    {
      const P0 = { x: neckBase.x - nw0, y: neckBase.y };
      const P1 = { x: L * 1.55 - nw1, y: -Hh * 0.5 };
      const P2 = { x: neckTop.x - nw1, y: neckTop.y };
      const bez = (t: number) => ({
        x: (1 - t) * (1 - t) * P0.x + 2 * (1 - t) * t * P1.x + t * t * P2.x,
        y: (1 - t) * (1 - t) * P0.y + 2 * (1 - t) * t * P1.y + t * t * P2.y,
      });
      const bezDir = (t: number) => {
        const dx = 2 * (1 - t) * (P1.x - P0.x) + 2 * t * (P2.x - P1.x);
        const dy = 2 * (1 - t) * (P1.y - P0.y) + 2 * t * (P2.y - P1.y);
        const m = Math.hypot(dx, dy) || 1;
        return { x: dx / m, y: dy / m };
      };
      c.fillStyle = shadeColor(col.fin, 0.05);
      for (let i = 1; i <= 5; i++) {
        const t = i / 6;
        const p = bez(t), d = bezDir(t);
        const nx = d.y, ny = -d.x;
        const base = Hh * 0.16, len = Hh * 0.34;
        c.beginPath();
        c.moveTo(p.x - d.x * base, p.y - d.y * base);
        c.lineTo(p.x + nx * len, p.y + ny * len);
        c.lineTo(p.x + d.x * base, p.y + d.y * base);
        c.closePath(); c.fill();
      }
    }

    const hx = neckTop.x + Hh * 0.28, hy = neckTop.y - Hh * 0.18;
    c.fillStyle = cGrad(c, col, hy - Hh * 0.5, hy + Hh * 0.35);
    c.beginPath(); c.ellipse(hx, hy, L * 0.42, Hh * 0.34, 0.12, 0, Math.PI * 2); c.fill(); cOutline(c, col, L, 0.5);
    c.beginPath(); c.ellipse(hx + L * 0.34, hy + Hh * 0.06, L * 0.16, Hh * 0.2, 0.1, 0, Math.PI * 2); c.fill();
    c.fillStyle = shadeColor(col.fin, -0.1);
    for (const ox of [-L * 0.12, L * 0.02]) {
      c.beginPath();
      c.moveTo(hx + ox, hy - Hh * 0.25);
      c.lineTo(hx + ox - L * 0.04, hy - Hh * 0.72);
      c.lineTo(hx + ox + L * 0.08, hy - Hh * 0.28);
      c.closePath(); c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath(); c.ellipse(hx + L * 0.42, hy - Hh * 0.02, L * 0.03, Hh * 0.05, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(0.8, L * 0.025);
    c.beginPath(); c.moveTo(hx + L * 0.12, hy + Hh * 0.16); c.quadraticCurveTo(hx + L * 0.3, hy + Hh * 0.2, hx + L * 0.44, hy + Hh * 0.1); c.stroke();
    cGloss(c, hx - L * 0.05, hy - Hh * 0.2, L * 0.22, Hh * 0.07, 0.25);
    c.fillStyle = '#f7e08a';
    c.beginPath(); c.arc(hx + L * 0.12, hy - Hh * 0.06, Hh * 0.16, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = Math.max(0.6, Hh * 0.03);
    c.beginPath(); c.arc(hx + L * 0.12, hy - Hh * 0.06, Hh * 0.16, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#14171c';
    c.beginPath(); c.ellipse(hx + L * 0.13, hy - Hh * 0.06, Hh * 0.05, Hh * 0.13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath(); c.arc(hx + L * 0.17, hy - Hh * 0.13, Hh * 0.05, 0, Math.PI * 2); c.fill();
  },

  // ===== Seaweed — redrawn.
  //
  // The old version was five thin strokes with two ellipse blobs each, and
  // it read as a handful of random sticks rather than a plant: the strands
  // started at five separate x positions with no common root, and the blobs
  // sat beside the stem instead of on it.
  //
  // Now: one root clump, seven fronds fanning out from it, each a TAPERING
  // RIBBON (two curves closed into a shape, not a stroke) with paired
  // leaflets along its length. Darker at the base, lighter at the tip, with
  // a per-frond hue shift so the clump has depth.
  //
  // The sway is no longer drawn in. Seaweed is rooted, so it gets the
  // anchored bend mode in the vertex shader (see world/motion.ts): the base
  // stays put and the tips move. Drawing the sway into the sprite as well
  // would double it.
  weed(c, L, Hh, tail, col) {
    void col;
    const FRONDS = 7;
    const baseY = Hh * 1.2;
    const rootW = L * 0.5;

    // root clump first, so the fronds grow out of it
    c.fillStyle = '#24512f';
    c.beginPath();
    c.ellipse(0, baseY, rootW, Hh * 0.13, 0, 0, Math.PI * 2);
    c.fill();

    for (let i = 0; i < FRONDS; i++) {
      // deterministic fan: middle fronds tall and upright, outer ones
      // shorter and leaning away
      const t = i / (FRONDS - 1) - 0.5;   // -0.5 .. 0.5, fan across the clump
      const lean = t * L * 1.05;
      const height = (1 - Math.abs(t) * 0.62) * Hh * 2.3;
      const bx = t * rootW * 0.75;
      const tipX = bx + lean;
      const tipY = baseY - height;
      const midX = bx + lean * 0.35;
      const midY = baseY - height * 0.55;
      const wBase = L * 0.175 * (1 - Math.abs(t) * 0.3);

      const g = c.createLinearGradient(bx, baseY, tipX, tipY);
      g.addColorStop(0, '#1f4a2a');
      g.addColorStop(0.45, i % 2 ? '#357a44' : '#2d6b3c');
      g.addColorStop(1, i % 2 ? '#7fcf87' : '#68bd74');
      c.fillStyle = g;

      // the ribbon: up one side of the curve, back down the other, tapering
      c.beginPath();
      c.moveTo(bx - wBase, baseY);
      c.quadraticCurveTo(midX - wBase * 0.55, midY, tipX, tipY);
      c.quadraticCurveTo(midX + wBase * 0.55, midY, bx + wBase, baseY);
      c.closePath();
      c.fill();

      // a lighter spine, so the ribbon does not read as a flat cutout
      c.strokeStyle = 'rgba(190,240,190,0.16)';
      c.lineWidth = Math.max(1, wBase * 0.3);
      c.beginPath();
      c.moveTo(bx, baseY);
      c.quadraticCurveTo(midX, midY, tipX, tipY);
      c.stroke();

      // leaflets, alternating sides, ON the stem rather than beside it
      c.fillStyle = i % 2 ? '#4e9c5b' : '#448a50';
      for (let b = 1; b <= 3; b++) {
        const u = b / 4;
        // point on the quadratic at u
        const px = (1 - u) * (1 - u) * bx + 2 * (1 - u) * u * midX + u * u * tipX;
        const py = (1 - u) * (1 - u) * baseY + 2 * (1 - u) * u * midY + u * u * tipY;
        const side = b % 2 ? 1 : -1;
        const lw = L * 0.19 * (1 - u * 0.4);
        // Blades, not berries: long and thin, angled up along the frond. The
        // first pass used near-circular ellipses and the clump read as
        // lollipops on sticks.
        c.beginPath();
        c.ellipse(px + side * lw * 0.55, py - Hh * 0.05, lw, Hh * 0.055 * (1 - u * 0.3),
          side * 0.42 - 0.25, 0, Math.PI * 2);
        c.fill();
      }
    }
    void tail;   // the sway is the shader's job now — see the comment above
  },

  // ===== Blobfish: droopy gelatinous body, hanging nose, frown. Body sags (`sin(tail*0.7)`), applied to the belly curve. =====
  blob(c, L, Hh, tail, col) {
    const sag = Math.sin(tail * 0.7) * 0.06;
    c.fillStyle = shadeColor(col.fin, -0.05);
    c.beginPath(); c.moveTo(-L * 0.75, 0); c.lineTo(-L * 1.35, -Hh * 0.55); c.lineTo(-L * 1.2, 0); c.lineTo(-L * 1.35, Hh * 0.55); c.closePath(); c.fill();
    {
      const g = c.createRadialGradient(-L * 0.15, -Hh * 0.3, L * 0.1, 0, Hh * 0.1, L);
      g.addColorStop(0, shadeColor(col.body, 0.28));
      g.addColorStop(0.65, col.body);
      g.addColorStop(1, shadeColor(col.body, -0.2));
      c.fillStyle = g;
    }
    c.beginPath();
    c.moveTo(-L * 0.85, -Hh * 0.15);
    c.quadraticCurveTo(-L * 0.5, -Hh * 0.95, L * 0.25, -Hh * 0.8);
    c.quadraticCurveTo(L * 0.95, -Hh * 0.6, L * 0.92, Hh * 0.15);
    c.quadraticCurveTo(L * 0.85, Hh * (1.0 + sag), 0, Hh * (1.05 + sag));
    c.quadraticCurveTo(-L * 0.8, Hh * (0.95 + sag), -L * 0.85, -Hh * 0.15);
    c.closePath(); c.fill(); cOutline(c, col, L, 0.45);
    c.fillStyle = shadeColor(col.body, 0.08);
    c.beginPath(); c.ellipse(L * 0.62, Hh * 0.3, L * 0.32, Hh * 0.3, 0.25, 0, Math.PI * 2); c.fill();
    cGloss(c, -L * 0.1, -Hh * 0.6, L * 0.45, Hh * 0.14, 0.25);
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = Math.max(1.2, L * 0.045); c.lineCap = 'round';
    c.beginPath(); c.moveTo(L * 0.05, -Hh * 0.55); c.lineTo(L * 0.4, -Hh * 0.42); c.stroke();
    cEye(c, L * 0.26, -Hh * 0.24, Hh * 0.2);
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = Math.max(1.2, L * 0.05);
    c.beginPath(); c.arc(L * 0.28, Hh * 0.72, Hh * 0.34, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  },
};

// ---------------------------------------------------------------------------
// Main entry point

/**
 * Bakes one species into the given `w`x`h` box: centred, facing right, small
 * margin (see `bodyBounds` above for how the margin is sized per body type).
 * Draws a RESTING pose — every per-frame animation term is still computed
 * with the old formula, just at `tail = 0` (see the file header for what
 * keeps moving afterwards, and what doesn't, on the GPU).
 */
export function drawSpecies(ctx: CanvasRenderingContext2D, w: number, h: number, sp: Species, opts: DrawOpts = {}): void {
  const col: Col = { body: sp.colors.body, belly: sp.colors.belly, fin: sp.colors.fin };
  const bounds = bodyBounds(sp);
  const marginFrac = 0.94; // "small margin", matches the atlas's own transparent gutter in spirit

  const widthUnits = bounds.xMax - bounds.xMin;
  const heightUnits = bounds.yMax - bounds.yMin;
  const Lw = (w * marginFrac) / widthUnits;
  const Lh = (h * marginFrac) / heightUnits;
  const L = Math.max(1, Math.min(Lw, Lh));

  const originX = w / 2 - ((bounds.xMin + bounds.xMax) / 2) * L;
  const originY = h / 2 - ((bounds.yMin + bounds.yMax) / 2) * L;

  ctx.save();
  ctx.translate(originX, originY);

  // Shiny: verbatim `fish.js:476-479` — a live CSS filter set once per bake
  // (see colorUtil.ts header for why this stays a canvas filter rather than
  // pre-transformed colours: it recolors literal/derived colours alike, exactly
  // like the old game, and a bake pays the feature-detection cost once, not
  // per frame).
  if (opts.shiny) {
    if ('filter' in ctx) (ctx as CanvasRenderingContext2D & { filter: string }).filter = 'hue-rotate(150deg) saturate(1.7) brightness(1.15)';
    ctx.shadowColor = '#ffe680';
    ctx.shadowBlur = L * 0.9;
  }

  switch (sp.bodyType) {
    case 'boot':
      drawBoot(ctx, L, col);
      break;
    case 'bottle':
      drawBottle(ctx, L, 0);
      break;
    case 'chest':
      drawChest(ctx, L);
      break;
    case 'creature': {
      const Hh = L * sp.h * 0.5;
      const fn = CREATURE_DRAW[sp.pattern];
      if (isGlowing(sp)) { ctx.shadowColor = col.fin; ctx.shadowBlur = L * 0.8; } // fish.js:485
      if (fn) fn(ctx, L, Hh, 0, col);
      break;
    }
    default: {
      const Hh = L * sp.h * 0.5;
      drawGenericFish(ctx, sp, col, L, Hh, 0);
    }
  }

  if ('filter' in ctx) (ctx as CanvasRenderingContext2D & { filter: string }).filter = 'none';
  ctx.restore();

  // Night tint — baked-in equivalent of the old full-screen `drawNightTint`,
  // see colorUtil.ts. Applied last, in the untranslated w/h frame, so it only
  // darkens the pixels the fish itself just drew.
  const light = opts.light == null ? 1 : opts.light;
  if (light < 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = nightTintColor(light);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
