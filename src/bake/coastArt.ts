/**
 * Coast ("Küste") scenery bakes — ported from the old game's `backdrop.js`
 * (`drawCliffs`/`_cliffs`, `drawSeaBed`, `drawSeaRocks`, `drawDriftParticles`)
 * and `locations.js` (`drawPier`, `drawPierUnderwater`).
 *
 * Same shape of file as `lakeArt.ts` — every function draws into the logical
 * `(0,0)..(w,h)` box the caller bakes it at.
 *
 * === What got baked, and what didn't ===
 *
 * `drawFarScenery` bakes the static half of `_cliffs`: the hazy far
 * headland, the chalk cliff with its rock strata and grass cap. NOT baked:
 * surf spray at the cliff foot and 3 sailboats —
 *   spray i (7): x = w*(0.26+i*0.012) + sin(time*2+i)*3,
 *                y = horizonY+3 + sin(time*3+i)*2, rx = 9-i, ry = 4,
 *                color rgba(255,255,255, 0.25+0.12*sin(time*1.8))
 *   sailboat i (3): x = w*(0.44+i*0.16) + sin(time*0.12+i*2)*8, sc = 1-i*0.18,
 *                   bob = sin(time*0.9+i)*1.5 — hull+sail shape at that x/sc/bob
 *
 * `drawSeabed` bakes the sea floor + 6 jagged rock silhouettes (never-moving).
 * NOT baked: drift particles —
 *   particle i (20): x = ((prnd(i,41)*w + time*(4+prnd(i,42)*10)) % (w+20)) - 10,
 *                    y = horizonY + prnd(i,43)*(h-horizonY) + sin(time*0.6+i)*6,
 *                    r = 1+prnd(i,45)*1.6, a = 0.3+0.4*prnd(i,44), color "200,230,245"
 *
 * === The pier: an own-box platform, like `makeDock` ========================
 *
 * `drawPier` composes against its OWN box (unit `s = h/6`, matching the old
 * game's `dockHeight` — deck occupies the bottom sixth, the lighthouse rises
 * 5 units above it) — NOT the screen, for the exact reason `makeDock` in
 * `game/lake.ts` exists: handed the whole screen, a lighthouse sized in
 * `dockHeight` units would stretch into a smear.
 *
 * NOT baked: the rotating lighthouse beam — `beam = 0.4+0.6*|sin(time*1.5)|`,
 * alpha `beam*(1-light)`, a soft circle at `(w*0.86+s*0.65, deckY-s*4.75)`,
 * radius `s*0.4`, color `rgba(255,240,150,a)`. Both `time`- and `light`-
 * driven, so it can't share this bake's per-light-step cache key — draw it
 * live on top, same box-local origin.
 *
 * `drawPierUnderwater` is a SEPARATE own-box prop for the submerged footing
 * blocks (10 stone blocks + 5 staggered footing blocks) — it belongs to a
 * different scene layer (drawn BEFORE the water pass, whereas the deck is
 * drawn after, unveiled) so it cannot be the same sprite as `drawPier`.
 * Its own box: width matches the pier deck's width, height is the full
 * submerged depth (old code sized these off `canvas.height`, i.e. relative
 * to the SCREEN, not `dockHeight` — kept as a fraction of this box's own
 * height instead, same proportions).
 */

import { prnd } from './baker';
import { shadeColor } from './palette';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dim(color: string, light: number): string {
  const lf = clamp(light, 0.18, 1);
  return shadeColor(color, -(1 - lf) * 0.55);
}

const HORIZON_FRAC = 0.35;

/**
 * Far scenery: the static half of `_cliffs` (backdrop.js:631-672) — hazy
 * headland at the right, chalk cliff at the left with 5 rock strata and a
 * grass cap. Full screen (`w x h`). NOT drawn here: surf spray + sailboats
 * (see file header).
 */
export function drawFarScenery(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const hy = h * HORIZON_FRAC;
  const lf = clamp(light, 0.18, 1);

  // Hazy far headland.
  ctx.fillStyle = `rgba(120,140,155,${0.35 * lf + 0.1})`;
  ctx.beginPath();
  ctx.moveTo(w * 0.55, hy);
  ctx.lineTo(w * 0.66, hy - 26);
  ctx.lineTo(w * 0.78, hy - 16);
  ctx.lineTo(w * 0.92, hy - 30);
  ctx.lineTo(w, hy - 22);
  ctx.lineTo(w, hy);
  ctx.closePath();
  ctx.fill();

  // Chalk cliff, left side: layered rock with a sunlit/shadow gradient.
  const cliffG = ctx.createLinearGradient(0, hy - 110, w * 0.32, hy);
  cliffG.addColorStop(0, dim('#b9b2a6', light));
  cliffG.addColorStop(0.5, dim('#8d8578', light));
  cliffG.addColorStop(1, dim('#5d5850', light));
  const cliffPath = () => {
    ctx.beginPath();
    ctx.moveTo(0, hy + 8);
    ctx.lineTo(0, hy - 96);
    ctx.lineTo(w * 0.07, hy - 112);
    ctx.lineTo(w * 0.13, hy - 96);
    ctx.lineTo(w * 0.18, hy - 66);
    ctx.lineTo(w * 0.23, hy - 74);
    ctx.lineTo(w * 0.28, hy - 34);
    ctx.lineTo(w * 0.32, hy + 8);
    ctx.closePath();
  };
  ctx.fillStyle = cliffG;
  cliffPath();
  ctx.fill();

  // Rock strata, clipped to the cliff so they never hang in the air.
  ctx.save();
  cliffPath();
  ctx.clip();
  ctx.strokeStyle = `rgba(60,55,48,${0.28 * lf + 0.08})`;
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 6; i++) {
    const ly = hy - 96 + i * 18;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.quadraticCurveTo(w * 0.14, ly - 5 + prnd(i, 61) * 6, w * 0.34, ly + 6);
    ctx.stroke();
  }
  ctx.restore();

  // Grass cap on the cliff edge.
  ctx.fillStyle = dim('#4c7048', light);
  ctx.beginPath();
  ctx.moveTo(0, hy - 96);
  ctx.lineTo(w * 0.07, hy - 112);
  ctx.lineTo(w * 0.13, hy - 96);
  ctx.lineTo(w * 0.1, hy - 88);
  ctx.lineTo(w * 0.06, hy - 100);
  ctx.lineTo(0, hy - 86);
  ctx.closePath();
  ctx.fill();
}

/**
 * Sea bed + 6 jagged rock silhouettes (`drawSeaBed` + `drawSeaRocks`,
 * backdrop.js:501/701), full screen (`w x h`). Static, never bakes in the old
 * game either. NOT drawn here: drift particles (see file header).
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
  g.addColorStop(0, 'rgba(96,96,86,0.85)');
  g.addColorStop(0.45, 'rgba(96,96,86,0.85)');
  g.addColorStop(1, 'rgba(34,40,44,0.95)');
  ctx.fillStyle = g;
  ctx.fill();
  const veil = ctx.createLinearGradient(0, floor - 46, 0, floor + 10);
  veil.addColorStop(0, 'rgba(96,96,86,0)');
  veil.addColorStop(1, 'rgba(96,96,86,0.55)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, floor - 46, w, 56);
  ctx.restore();

  for (let i = 0; i < 6; i++) {
    const x = prnd(i, 51) * w;
    const rw = 20 + prnd(i, 52) * 40;
    const rh = 14 + prnd(i, 53) * 26;
    ctx.fillStyle = `rgba(46,58,64,${0.4 + prnd(i, 54) * 0.25})`;
    ctx.beginPath();
    ctx.moveTo(x - rw, floor);
    ctx.lineTo(x - rw * 0.5, floor - rh);
    ctx.lineTo(x + rw * 0.2, floor - rh * 0.7);
    ctx.lineTo(x + rw * 0.7, floor - rh * 1.1);
    ctx.lineTo(x + rw, floor);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * The stone pier deck + bollard + lighthouse (`drawPier`, locations.js:387),
 * own box. Unit `s = h/6`: the deck fills the bottom `s`, the lighthouse cap
 * sits at the very top of the box (`5s` above the deck) — see file header.
 */
export function drawPier(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  const s = h / 6;
  const deckY = 5 * s;

  ctx.fillStyle = dim('#6f7378', light);
  ctx.fillRect(0, deckY, w, s);

  // Bollard.
  ctx.fillStyle = dim('#2a2a30', light);
  roundRectPath(ctx, w * 0.7, deckY - s * 1.2, s * 0.6, s * 1.2, Math.min(4, s * 0.1));
  ctx.fill();

  // Lighthouse.
  //
  // Moved in from w*0.86 to w*0.78: at the old position its cap overhung the
  // sprite's right edge and was clipped by the bake, so it read as a striped
  // pole floating at the screen edge. It also has a base now — a tower that
  // starts in mid-air is the thing the eye notices first.
  const lx = w * 0.78;
  const lw = s * 1.25;
  const top = deckY - s * 4.6;

  // splayed base
  ctx.fillStyle = dim('#dcdcdc', light);
  ctx.beginPath();
  ctx.moveTo(lx - lw * 0.22, deckY);
  ctx.lineTo(lx + lw * 1.22, deckY);
  ctx.lineTo(lx + lw * 0.98, deckY - s * 0.5);
  ctx.lineTo(lx + lw * 0.02, deckY - s * 0.5);
  ctx.closePath();
  ctx.fill();

  // shaft, tapering, with a soft shaded side so it is a cylinder
  const sg = ctx.createLinearGradient(lx, 0, lx + lw, 0);
  sg.addColorStop(0, dim('#cfcfcf', light));
  sg.addColorStop(0.35, dim('#f6f6f6', light));
  sg.addColorStop(1, dim('#b9bcc0', light));
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(lx + lw * 0.02, deckY - s * 0.5);
  ctx.lineTo(lx + lw * 0.98, deckY - s * 0.5);
  ctx.lineTo(lx + lw * 0.86, top);
  ctx.lineTo(lx + lw * 0.14, top);
  ctx.closePath();
  ctx.fill();

  // red band
  ctx.fillStyle = dim('#e63946', light);
  ctx.beginPath();
  ctx.moveTo(lx + lw * 0.07, deckY - s * 2.1);
  ctx.lineTo(lx + lw * 0.93, deckY - s * 2.1);
  ctx.lineTo(lx + lw * 0.90, deckY - s * 3.0);
  ctx.lineTo(lx + lw * 0.10, deckY - s * 3.0);
  ctx.closePath();
  ctx.fill();

  // lamp room and cap
  ctx.fillStyle = dim('#2a2a30', light);
  ctx.fillRect(lx + lw * 0.04, top - s * 0.62, lw * 0.92, s * 0.62);
  ctx.fillStyle = dim('#ffe9a8', light);
  ctx.fillRect(lx + lw * 0.16, top - s * 0.52, lw * 0.68, s * 0.34);
  ctx.fillStyle = dim('#1d1d22', light);
  ctx.beginPath();
  ctx.moveTo(lx - lw * 0.06, top - s * 0.62);
  ctx.lineTo(lx + lw * 1.06, top - s * 0.62);
  ctx.lineTo(lx + lw * 0.5, top - s * 1.05);
  ctx.closePath();
  ctx.fill();
}

/** The lighthouse lamp's box-local position/radius, for the caller's live beam overlay (see file header). */
export function lighthouseLamp(w: number, h: number): { x: number; y: number; r: number } {
  const s = h / 6;
  const deckY = 5 * s;
  return { x: w * 0.78 + s * 0.625, y: deckY - s * 4.95, r: s * 0.4 };
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Submerged pier footing (`drawPierUnderwater`, locations.js:379) — 10 stone
 * blocks in back + 5 wider, staggered footing blocks in front. Own box:
 * `w` matches the pier deck's width, `h` is the full depth this prop should
 * occupy (the scene places it directly below the deck sprite).
 */
export function drawPierUnderwater(ctx: CanvasRenderingContext2D, w: number, h: number, light: number): void {
  void light;
  // A stone mole is a WALL. The first port drew ten free-standing columns
  // with gaps between them, which read as a fence lying in the water rather
  // than as masonry — the same mistake the lake's dock made with its deck.
  // So: a solid face with courses and staggered joints, darkening with
  // depth, and a slightly proud lower course where it meets the bed.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#666b70');
  g.addColorStop(0.55, '#565b60');
  g.addColorStop(1, '#3f4348');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const courses = 6;
  const ch = h / courses;
  ctx.lineWidth = Math.max(1, w * 0.004);
  for (let r = 0; r < courses; r++) {
    const y = r * ch;
    // horizontal bed joint
    ctx.strokeStyle = 'rgba(20,24,28,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    // staggered vertical joints, so the courses read as separate stones
    const blocks = 5;
    const bw = w / blocks;
    const offset = (r % 2) * bw * 0.5;
    for (let i = 0; i <= blocks; i++) {
      const x = offset + i * bw;
      if (x <= 1 || x >= w - 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + ch);
      ctx.stroke();
    }
    // a highlight along the top of each course
    ctx.strokeStyle = 'rgba(230,240,245,0.06)';
    ctx.beginPath();
    ctx.moveTo(0, y + 1);
    ctx.lineTo(w, y + 1);
    ctx.stroke();
  }

  // weed and barnacles at the waterline end, because it has stood here
  ctx.fillStyle = 'rgba(58,96,62,0.45)';
  for (let i = 0; i < 9; i++) {
    const x = (i + 0.5) * (w / 9);
    const hh = ch * (0.25 + ((i * 7) % 5) * 0.09);
    ctx.beginPath();
    ctx.ellipse(x, hh * 0.5, w * 0.055, hh, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
