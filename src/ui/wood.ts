/**
 * Wood — the rustic wood-panel UI look, ported from the old game's `wood.js`.
 *
 * The old game drew every plank/nail/panel with Canvas 2D commands every
 * frame it was visible. `#ui` in this game is DOM, not canvas, so instead we
 * bake each distinct panel/button/badge/tab ONCE into a small offscreen
 * canvas and hand the DOM a `data:` URL. Reasoning for the data-URL choice
 * (over an ImageBitmap-backed <canvas> element per panel):
 *
 *   - A CSS `background-image`/`border-image` is a normal, cacheable,
 *     compositor-friendly image — the browser decodes it once and reuses
 *     it exactly like any other background, no extra element in the tree,
 *     no per-panel <canvas> to keep alive or resize.
 *   - `border-image` gives us nine-slice for free: one baked panel dresses
 *     any element size the DOM layout produces, without re-baking per size
 *     (`CLAUDE.md` rule 3 — "what is rastered once is only copied").
 *   - A live <canvas> per panel would need its own resize/redraw wiring and
 *     would NOT be free of the "read a canvas back same frame" trap the
 *     project's rule 1 warns about — a data URL is written once and never
 *     read back.
 *   - Determinism (`prnd(seed, salt)`) means the same options always
 *     produce the same PNG, so a `Map` keyed by a signature string is a
 *     complete, correct cache — exactly like `Baker`'s atlas cache, just
 *     for the DOM instead of the GPU.
 */

import { prnd } from '@/bake/baker';

// ---------------------------------------------------------------------------
// Colours (verbatim from wood.js §2.1 / §2.2)
// ---------------------------------------------------------------------------

export const TONES = ['#7a5230', '#6d4726', '#82593a', '#5e3f22', '#7c4a2e', '#6e5a42', '#755130'];
export const DARK = '#2a180b';
export const INK = '#3a2a14';
export const PAPER = '#efe2bd';
export const ROPE = '#a5814e';
export const RAW = '#6d4726';

export const PAINT = {
  buy: '#e0791c',
  reward: '#3f9d52',
  gold: '#d9a92b',
  info: '#3c86b4',
  danger: '#c34432',
  worn: '#6b6154',
} as const;
export type PaintKind = keyof typeof PAINT;

// ---------------------------------------------------------------------------
// Colour helpers (verbatim arithmetic from wood.js)
// ---------------------------------------------------------------------------

function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }

function rgbOf(col: string): [number, number, number, number] {
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = col.match(/[\d.]+/g) || ['0', '0', '0'];
  return [+m[0], +m[1], +m[2], m[3] != null ? +m[3] : 1];
}

/** Lighten/darken a colour (amt -1..1); understands #hex and rgb()/rgba(). */
export function shadeColor(col: string, amt: number): string {
  const [r, g, b, a] = rgbOf(col);
  const f = (v: number) => Math.round(clamp(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt, 0, 255));
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

function mixColor(a: string, b: string, t: number): string {
  const A = rgbOf(a), B = rgbOf(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

export function seedOf(x: number, w: number, h: number, salt = 0): number {
  return ((Math.round(x) * 31 + Math.round(w) * 7 + Math.round(h) * 13 + salt * 101) % 8191 + 8191) % 8191;
}

/** Classify a colour into one of the 6 paint buckets by hue (wood.js `_nearestPaint`). */
export function nearestPaint(r: number, g: number, b: number): string {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 26) return PAINT.worn;
  let hue: number;
  if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
  else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
  else hue = 60 * ((r - g) / (mx - mn) + 4);
  if (hue < 0) hue += 360;
  if (hue < 16 || hue >= 342) return PAINT.danger;
  if (hue < 44) return PAINT.buy;
  if (hue < 68) return PAINT.gold;
  if (hue < 170) return PAINT.reward;
  return PAINT.info;
}

export type PaintIntent =
  | { kind: 'ghost' }
  | { kind: 'paint'; color: string; worn: boolean }
  | { kind: 'wood' };

const intentCache = new Map<string, PaintIntent>();
/** Legacy-compat bridge (wood.js `paintIntent`): classify an old CSS colour request. */
export function paintIntent(fill: string | undefined): PaintIntent {
  if (!fill) return { kind: 'wood' };
  const hit = intentCache.get(fill);
  if (hit) return hit;
  const [r, g, b, a] = rgbOf(fill);
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  let it: PaintIntent;
  if (a < 0.05) it = { kind: 'ghost' };
  else if (sat > 28) it = { kind: 'paint', color: nearestPaint(r, g, b), worn: a < 0.45 };
  else if (a < 0.12) it = { kind: 'paint', color: PAINT.worn, worn: true };
  else it = { kind: 'wood' };
  intentCache.set(fill, it);
  return it;
}

/** "Worn" = mixed 52% toward dark brown, never made transparent. */
export function coatColor(col: string, worn: boolean): string { return worn ? mixColor(col, '#3d2c1a', 0.52) : col; }

export function lumOf(col: string): number {
  const [r, g, b] = rgbOf(col);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const inkCache = new Map<string, string>();
const DARK_INK = '#2c1a05';
const CHALK = '#f8efdb';
/** Which ink/chalk colour reads on a given coat (wood.js `inkOn`). */
export function inkOn(coat: string, worn: boolean, wanted?: string): string {
  const key = coat + '|' + (worn ? 1 : 0) + '|' + (wanted || '');
  const hit = inkCache.get(key);
  if (hit) return hit;
  const lb = lumOf(coatColor(coat, worn));
  let v = ((lb + 0.05) / (lumOf(DARK_INK) + 0.05)) >= ((lumOf(CHALK) + 0.05) / (lb + 0.05)) ? DARK_INK : CHALK;
  if (wanted) {
    const m = /rgba\([^)]*,\s*([\d.]+)\s*\)\s*$/.exec(wanted);
    const faded = m ? +m[1] < 0.7 : false;
    const lw = lumOf(wanted);
    const ratio = (Math.max(lw, lb) + 0.05) / (Math.min(lw, lb) + 0.05);
    if (!faded && ratio >= 4) v = wanted;
  }
  inkCache.set(key, v);
  return v;
}

export function isLight(col: string | undefined): boolean {
  if (!col) return true;
  const [r, g, b] = rgbOf(col);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 140;
}

// ---------------------------------------------------------------------------
// Drawing primitives — verbatim geometry/formulas from wood.js, operating on
// whatever ctx is handed in (always a fresh bake canvas here, never the
// live scene canvas — rule 1: never write and read the same canvas/frame).
// ---------------------------------------------------------------------------

export interface PlankOpts { tone?: string; j?: number; skew?: number }

/** One board: jittered quad, grain, an occasional knot/crack/chipped corner. */
export function drawPlank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, o: PlankOpts = {}): void {
  const p = (k: number) => prnd(seed, k);
  const tone = o.tone || TONES[Math.floor(p(1) * TONES.length)];
  const j = o.j != null ? o.j : clamp(h * 0.08, 1, 3.2);
  const skew = o.skew != null ? o.skew : (p(2) - 0.5) * clamp(h * 0.14, 1.5, 4.5);
  const x0 = x + (p(3) - 0.5) * j, x1 = x + w + (p(4) - 0.5) * j;
  const t0 = y + (p(5) - 0.5) * j - skew / 2, t1 = y + (p(6) - 0.5) * j + skew / 2;
  const b0 = y + h + (p(7) - 0.5) * j - skew / 2, b1 = y + h + (p(8) - 0.5) * j + skew / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, t0); ctx.lineTo(x1, t1); ctx.lineTo(x1, b1); ctx.lineTo(x0, b0); ctx.closePath();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shadeColor(tone, 0.05 + p(9) * 0.05));
  g.addColorStop(0.55, tone);
  g.addColorStop(1, shadeColor(tone, -0.13));
  ctx.fillStyle = g; ctx.fill();
  ctx.clip();
  const lines = clamp(Math.round(h / 10), 2, 6);
  for (let i = 0; i < lines; i++) {
    const ly = y + h * (0.14 + 0.78 * ((i + p(10 + i) * 0.8) / lines));
    const amp = 1 + p(20 + i) * 2.2;
    ctx.strokeStyle = p(30 + i) < 0.75 ? 'rgba(30,16,6,0.16)' : 'rgba(255,225,180,0.10)';
    ctx.lineWidth = 0.8 + p(40 + i) * 0.8;
    ctx.beginPath(); ctx.moveTo(x0 - 2, ly);
    ctx.bezierCurveTo(x + w * (0.2 + p(50 + i) * 0.2), ly + amp, x + w * (0.55 + p(60 + i) * 0.2), ly - amp, x1 + 2, ly + (p(70 + i) - 0.5) * 3);
    ctx.stroke();
  }
  if (p(11) < 0.34 && w > 46 && h > 14) {
    const kx = x + w * (0.18 + p(12) * 0.64), ky = y + h * (0.3 + p(13) * 0.4), kr = clamp(h * 0.16, 2, 4.5);
    ctx.strokeStyle = 'rgba(34,18,7,0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(kx, ky, kr * 1.5, kr, (p(14) - 0.5) * 0.8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(28,14,5,0.55)';
    ctx.beginPath(); ctx.ellipse(kx, ky, kr * 0.7, kr * 0.45, (p(14) - 0.5) * 0.8, 0, Math.PI * 2); ctx.fill();
  }
  if (p(15) < 0.2 && w > 70) {
    const fromLeft = p(16) < 0.5;
    let cx0 = fromLeft ? x0 : x1, cy0 = y + h * (0.25 + p(17) * 0.5);
    ctx.strokeStyle = 'rgba(20,10,4,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, cy0);
    for (let sgm = 1; sgm <= 3; sgm++) {
      cx0 += (fromLeft ? 1 : -1) * (5 + p(18 + sgm) * 9);
      cy0 += (p(28 + sgm) - 0.5) * 5;
      ctx.lineTo(cx0, cy0);
    }
    ctx.stroke();
  }
  if (p(19) < 0.22 && h > 20) {
    const corner = Math.floor(p(21) * 4);
    const ccx = corner % 2 ? x1 : x0, ccy = corner < 2 ? Math.min(t0, t1) : Math.max(b0, b1);
    const cw = 4 + p(22) * 6, chh = 3 + p(23) * 4;
    ctx.fillStyle = 'rgba(22,12,5,0.65)';
    ctx.beginPath(); ctx.moveTo(ccx, ccy);
    ctx.lineTo(ccx + (corner % 2 ? -cw : cw), ccy);
    ctx.lineTo(ccx, ccy + (corner < 2 ? chh : -chh)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, t0); ctx.lineTo(x1, t1); ctx.lineTo(x1, b1); ctx.lineTo(x0, b0); ctx.closePath();
  ctx.strokeStyle = 'rgba(26,13,5,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,228,186,0.16)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0 + 2, t0 + 1.2); ctx.lineTo(x1 - 2, t1 + 1.2); ctx.stroke();
  ctx.restore();
}

/** Nail head: some rusty, some crooked. */
export function drawNail(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, r = 2.6): void {
  const p = (k: number) => prnd(seed, k);
  const dx = (p(1) - 0.5) * 2, dy = (p(2) - 0.5) * 2;
  x += dx; y += dy;
  ctx.save();
  ctx.fillStyle = 'rgba(15,8,3,0.5)';
  ctx.beginPath(); ctx.ellipse(x + 0.9, y + 1.2, r * 1.05, r * 0.85, 0.4, 0, Math.PI * 2); ctx.fill();
  if (p(6) < 0.09) {
    ctx.strokeStyle = '#6d6156'; ctx.lineWidth = r * 0.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (p(7) - 0.5) * 5, y - r * 1.1); ctx.stroke();
  }
  const rusty = p(3) < 0.3;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  if (rusty) { g.addColorStop(0, '#c99a6a'); g.addColorStop(0.6, '#8a5a34'); g.addColorStop(1, '#5c3a20'); }
  else { g.addColorStop(0, '#e8e2d6'); g.addColorStop(0.6, '#a8a094'); g.addColorStop(1, '#6d6156'); }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,10,0.55)'; ctx.lineWidth = 0.9;
  const a = p(4) * Math.PI;
  ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * r * 0.6, y - Math.sin(a) * r * 0.6);
  ctx.lineTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); ctx.stroke();
  ctx.restore();
}

export interface PanelOpts {
  seed?: number;
  accent?: string;
  paint?: string;
  battens?: boolean;
  plankH?: number;
}

/** The main panel primitive: shadow+backing, plank rows, stains, vignette, paint, accent. */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, o: PanelOpts = {}): void {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, 8, w * 0.4, h * 0.4);
  const seed = o.seed != null ? o.seed : seedOf(x, w, h, Math.round(y / 64));
  const p = (k: number) => prnd(seed, k);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
  ctx.fillStyle = DARK;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  const n = Math.max(1, Math.round(h / (o.plankH || 62)));
  let yy = y - 2;
  for (let i = 0; i < n; i++) {
    const rest = y + h + 2 - yy;
    let ph = i === n - 1 ? rest : (h / n) * (0.82 + p(100 + i) * 0.36);
    ph = Math.min(ph, rest);
    const short = n > 2 && prnd(seed, 200 + i) < 0.22;
    const cut = short ? 8 + prnd(seed, 210 + i) * 22 : 0;
    const fromLeft = prnd(seed, 220 + i) < 0.5;
    drawPlank(ctx, x - 3 + (fromLeft ? cut : 0), yy, w + 6 - cut, ph + 1.5, seed * 3 + i * 17);
    if (w > 92 && ph > 18) {
      const ny = yy + ph * (0.35 + prnd(seed, 230 + i) * 0.3);
      drawNail(ctx, x + 9 + (fromLeft ? cut : 0), ny, seed + i * 7 + 1, clamp(ph * 0.11, 1.8, 2.8));
      drawNail(ctx, x + w - 9 - (fromLeft ? 0 : cut), ny + (prnd(seed, 240 + i) - 0.5) * 4, seed + i * 7 + 2, clamp(ph * 0.11, 1.8, 2.8));
    }
    yy += ph;
  }
  if (o.battens && h > 200) {
    for (const side of [0, 1]) {
      const bx = side ? x + w - 17 : x + 5;
      drawPlank(ctx, bx + (p(60 + side) - 0.5) * 2, y + 4, 12, h - 8, seed * 5 + side * 31, { j: 1.5, skew: (p(62 + side) - 0.5) * 3 });
      drawNail(ctx, bx + 6, y + 16 + p(64 + side) * 8, seed + 50 + side, 2.2);
      drawNail(ctx, bx + 6, y + h - 18 - p(66 + side) * 8, seed + 52 + side, 2.2);
    }
  }
  for (let i = 0; i < 2; i++) {
    if (prnd(seed, 300 + i) < 0.7) {
      ctx.fillStyle = i ? 'rgba(18,9,3,0.10)' : 'rgba(255,235,200,0.05)';
      ctx.beginPath();
      ctx.ellipse(x + w * (0.15 + prnd(seed, 310 + i) * 0.7), y + h * (0.2 + prnd(seed, 320 + i) * 0.6),
        14 + prnd(seed, 330 + i) * w * 0.12, 8 + prnd(seed, 340 + i) * 14, prnd(seed, 350 + i) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, 'rgba(255,235,200,0.07)'); v.addColorStop(0.2, 'rgba(255,235,200,0)');
  v.addColorStop(0.8, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = v; ctx.fillRect(x, y, w, h);
  if (o.paint) {
    ctx.globalAlpha = 0.62; ctx.fillStyle = o.paint;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.28; ctx.fillStyle = o.paint;
    ctx.fillRect(x, y, w, h * 0.5);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(42,24,11,0.5)';
    for (let i = 0; i < 3; i++) {
      if (prnd(seed, 400 + i) < 0.6) {
        const ex = x + prnd(seed, 410 + i) * w, ey = prnd(seed, 420 + i) < 0.5 ? y + 1 + prnd(seed, 430 + i) * 3 : y + h - 2 - prnd(seed, 430 + i) * 3;
        ctx.beginPath(); ctx.ellipse(ex, ey, 3 + prnd(seed, 440 + i) * 5, 1.4 + prnd(seed, 450 + i) * 1.6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
  if (o.accent) {
    ctx.save();
    ctx.strokeStyle = o.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
    ctx.setLineDash([26 + p(70) * 30, 3 + p(71) * 5, 44 + p(72) * 40, 2 + p(73) * 4]);
    ctx.lineDashOffset = p(74) * 60;
    ctx.beginPath(); ctx.roundRect(x + 4.5, y + 4.5, w - 9, h - 9, Math.max(3, r - 4)); ctx.stroke();
    ctx.restore();
  }
}

export interface InsetOpts { tint?: string; accent?: string }

/** A carved-out hollow (list rows, tiles) — radius capped at 5px, chipped not rounded. */
export function drawInset(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, o: InsetOpts = {}): void {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, 5, w * 0.4, h * 0.4);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  ctx.fillStyle = 'rgba(20,10,4,0.34)'; ctx.fillRect(x, y, w, h);
  if (o.tint) { ctx.globalAlpha = 0.16; ctx.fillStyle = o.tint; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
  const g = ctx.createLinearGradient(0, y, 0, y + 7);
  g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, 7);
  ctx.fillStyle = 'rgba(255,225,180,0.09)'; ctx.fillRect(x + 2, y + h - 1.5, w - 4, 1.5);
  ctx.restore();
  if (o.accent) {
    ctx.save();
    ctx.strokeStyle = o.accent; ctx.globalAlpha = 0.8; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r); ctx.stroke();
    ctx.restore();
  }
}

export interface PaperOpts { seed?: number; rot?: number; pin?: boolean; pinColor?: string; pinX?: number; light?: boolean }

/** Parchment note, rarely hangs straight; returns the rotation used. */
export function drawPaper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: PaperOpts = {}): number {
  const seed = o.seed != null ? o.seed : seedOf(x, w, h, 5);
  const p = (k: number) => prnd(seed, k);
  const rot = o.rot != null ? o.rot : (p(1) - 0.5) * 0.05;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(rot); ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.beginPath();
  const step = 48, jt = 2.2;
  const edge = (fx: number, fy: number, k: number) => ({ px: fx + (p(k) - 0.5) * jt, py: fy + (p(k + 1) - 0.5) * jt });
  let k0 = 10;
  ctx.moveTo(x + (p(8) - 0.5) * jt, y + (p(9) - 0.5) * jt);
  for (let ex = x + step; ex < x + w; ex += step) { const e = edge(ex, y, k0); ctx.lineTo(e.px, e.py); k0 += 2; }
  ctx.lineTo(x + w + (p(k0) - 0.5) * jt, y + (p(k0 + 1) - 0.5) * jt); k0 += 2;
  for (let ey = y + step; ey < y + h; ey += step) { const e = edge(x + w, ey, k0); ctx.lineTo(e.px, e.py); k0 += 2; }
  ctx.lineTo(x + w + (p(k0) - 0.5) * jt, y + h + (p(k0 + 1) - 0.5) * jt); k0 += 2;
  for (let ex = x + w - step; ex > x; ex -= step) { const e = edge(ex, y + h, k0); ctx.lineTo(e.px, e.py); k0 += 2; }
  ctx.lineTo(x + (p(k0) - 0.5) * jt, y + h + (p(k0 + 1) - 0.5) * jt); k0 += 2;
  for (let ey = y + h - step; ey > y; ey -= step) { const e = edge(x, ey, k0); ctx.lineTo(e.px, e.py); k0 += 2; }
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + h);
  g.addColorStop(0, o.light ? '#f7edcf' : PAPER); g.addColorStop(1, '#ddc99c');
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(120,90,50,0.4)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.save(); ctx.clip();
  for (let i = 0; i < 2; i++) {
    if (p(80 + i) < 0.75) {
      ctx.fillStyle = 'rgba(150,110,60,0.07)';
      ctx.beginPath(); ctx.ellipse(x + w * p(82 + i), y + h * p(84 + i), 10 + p(86 + i) * w * 0.14, 6 + p(88 + i) * 12, p(89 + i) * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(140,100,55,0.14)'; ctx.lineWidth = 5;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.restore();
  if (o.pin) {
    const px = o.pinX != null ? o.pinX : x + w / 2 + (p(90) - 0.5) * w * 0.3, py = y + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(px + 1, py + 2, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    const pg = ctx.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 4.5);
    const pc = o.pinColor || '#d84343';
    pg.addColorStop(0, shadeColor(pc, 0.55)); pg.addColorStop(0.6, pc); pg.addColorStop(1, shadeColor(pc, -0.35));
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  return rot;
}

export interface RopeOpts { sag?: number; color?: string; w?: number }

/** Rope/cord between two points, with sag and a "twist" texture. */
export function drawRope(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, o: RopeOpts = {}): void {
  const sag = o.sag != null ? o.sag : 10;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + sag;
  ctx.save();
  ctx.strokeStyle = o.color || ROPE; ctx.lineWidth = o.w || 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
  ctx.strokeStyle = 'rgba(60,40,18,0.55)'; ctx.lineWidth = 1;
  const nT = Math.max(4, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 7));
  for (let i = 1; i < nT; i++) {
    const t = i / nT;
    const qx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mx + t * t * x2;
    const qy = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * my + t * t * y2;
    ctx.beginPath(); ctx.moveTo(qx - 1.5, qy - 1.5); ctx.lineTo(qx + 1.5, qy + 1.5); ctx.stroke();
  }
  ctx.restore();
}

/** Full opaque-paint recipe used by `drawSign` (chip-outs, in-paint grain, brush strokes). */
export function drawCoat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, seed: number, worn: boolean): void {
  const p = (k: number) => prnd(seed, k);
  const base = coatColor(col, worn);
  const chips: number[][][] = [];
  const nChips = (worn ? 5 : 3) + Math.floor(p(60) * 3);
  for (let i = 0; i < nChips; i++) {
    const edge = Math.floor(p(61 + i * 7) * 4);
    const along = 0.06 + p(62 + i * 7) * 0.88;
    const len = (worn ? 8 : 5) + p(63 + i * 7) * (worn ? 22 : 14);
    const deep = (worn ? 3 : 2) + p(64 + i * 7) * (worn ? 7 : 5);
    const pts: number[][] = [];
    const steps = 3 + Math.floor(p(65 + i * 7) * 2);
    for (let sIdx = 0; sIdx <= steps; sIdx++) {
      const t = sIdx / steps;
      const d = sIdx === 0 || sIdx === steps ? 0 : deep * (0.35 + p(66 + i * 7 + sIdx) * 0.9);
      if (edge === 0) pts.push([x + along * w + (t - 0.5) * len, y - 1 + d]);
      else if (edge === 2) pts.push([x + along * w + (t - 0.5) * len, y + h + 1 - d]);
      else if (edge === 3) pts.push([x - 1 + d, y + along * h + (t - 0.5) * len]);
      else pts.push([x + w + 1 - d, y + along * h + (t - 0.5) * len]);
    }
    chips.push(pts);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 4, y - 4, w + 8, h + 8);
  for (const pts of chips) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  ctx.clip('evenodd');
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shadeColor(base, 0.15));
  g.addColorStop(0.52, base);
  g.addColorStop(1, shadeColor(base, -0.18));
  ctx.fillStyle = g; ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  const lines = clamp(Math.round(h / 9), 3, 7);
  for (let i = 0; i < lines; i++) {
    const ly = y + h * (0.1 + 0.8 * ((i + p(80 + i) * 0.7) / lines));
    ctx.strokeStyle = p(90 + i) < 0.58 ? shadeColor(base, -0.17) : shadeColor(base, 0.17);
    ctx.globalAlpha = 0.35 + p(100 + i) * 0.35;
    ctx.lineWidth = 0.7 + p(110 + i) * 1.5;
    ctx.beginPath(); ctx.moveTo(x - 4, ly);
    ctx.bezierCurveTo(x + w * 0.32, ly + (p(120 + i) - 0.5) * 3.4, x + w * 0.7, ly - (p(130 + i) - 0.5) * 3.4, x + w + 4, ly + (p(140 + i) - 0.5) * 2.6);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.12 + p(150 + i) * 0.1;
    ctx.strokeStyle = shadeColor(base, 0.28);
    ctx.lineWidth = 2 + p(155 + i) * 3;
    const by = y + h * (0.18 + p(160 + i) * 0.66);
    ctx.beginPath(); ctx.moveTo(x - 2, by); ctx.lineTo(x + w + 2, by + (p(165 + i) - 0.5) * 4); ctx.stroke();
  }
  if (h > 26 && p(170) < 0.55) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = shadeColor(base, -0.16);
    const dx = x + w * (0.15 + p(171) * 0.7);
    ctx.beginPath(); ctx.ellipse(dx, y + h - 2, 2.2 + p(172) * 2.4, 4 + p(173) * 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = shadeColor(base, -0.3); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.rect(x + 1.5, y + 1.5, w - 3, h - 3); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 1;
  for (const pts of chips) {
    ctx.strokeStyle = shadeColor(base, -0.38);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.restore();
}

export interface SignOpts { seed?: number; tilt?: number; paint?: string; worn?: boolean; nails?: number }

/** Wood plaque/header board (e.g. a "Cast" button): 1-2 planks, paint coat, nails. Returns tilt used. */
export function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: SignOpts = {}): number {
  const seed = o.seed != null ? o.seed : seedOf(x, w, h, 9);
  const p = (k: number) => prnd(seed, k);
  const tilt = o.tilt != null ? o.tilt : (p(1) - 0.5) * 0.02;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2); ctx.rotate(tilt); ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
  ctx.fillStyle = DARK;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip();
  if (h > 52) {
    const cutY = y + h * (0.44 + p(2) * 0.14);
    drawPlank(ctx, x - 3, y - 2, w + 6, cutY - y + 2, seed * 3 + 1);
    drawPlank(ctx, x - 3, cutY, w + 6, y + h - cutY + 2, seed * 3 + 2);
  } else {
    drawPlank(ctx, x - 3, y - 2, w + 6, h + 4, seed * 3 + 1);
  }
  if (o.paint) drawCoat(ctx, x, y, w, h, o.paint, seed, !!o.worn);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, 'rgba(255,235,200,0.09)'); v.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = v; ctx.fillRect(x, y, w, h);
  ctx.restore();
  const nails = o.nails != null ? o.nails : (w > 150 && h > 40 ? 4 : 2);
  const nr = clamp(h * 0.09, 2, 3.2);
  if (nails >= 4) {
    drawNail(ctx, x + 10, y + 9, seed + 1, nr); drawNail(ctx, x + w - 10, y + 9, seed + 2, nr);
    drawNail(ctx, x + 10, y + h - 9, seed + 3, nr); drawNail(ctx, x + w - 10, y + h - 9, seed + 4, nr);
  } else {
    drawNail(ctx, x + 9, y + h / 2 + (p(5) - 0.5) * 5, seed + 1, nr);
    drawNail(ctx, x + w - 9, y + h / 2 + (p(6) - 0.5) * 5, seed + 2, nr);
  }
  ctx.restore();
  return tilt;
}

// ---------------------------------------------------------------------------
// Baking — turn the primitives above into cached `data:` URLs for CSS.
// ---------------------------------------------------------------------------

export interface BakedNineSlice {
  /** `data:image/png;base64,...` */
  url: string;
  /** CSS-px slice size to use for `border-image-width` (same on all 4 sides). */
  sliceCss: number;
  /** raw-pixel slice size to use for `border-image-slice` (accounts for device scale). */
  sliceSource: number;
}

function bakeScale(): number { return Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, 3); }

function makeBakeCanvas(wCss: number, hCss: number, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wCss * scale));
  canvas.height = Math.max(1, Math.round(hCss * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

const panelCache = new Map<string, BakedNineSlice>();

export interface BakePanelOpts {
  /** reference size the panel is baked at (CSS px) — nine-slice stretches to any element size from this. */
  w?: number;
  h?: number;
  r?: number;
  seed?: number;
  accent?: string;
  paint?: string;
  battens?: boolean;
  plankH?: number;
  /** CSS-px width of the nine-slice corner/edge region. Must be < w/2 and < h/2. */
  slice?: number;
}

/**
 * Bakes one `Wood.panel` at a reference size and returns nine-slice CSS
 * metadata so it can dress any element size via `border-image` — no
 * per-instance re-bake (`Baker.rebakesPerFrame` stays the same principle,
 * just for the DOM: bake once, `border-image` copies forever after).
 */
export function bakePanel(o: BakePanelOpts = {}): BakedNineSlice {
  const w = o.w ?? 160, h = o.h ?? 160, r = o.r ?? 8, slice = o.slice ?? 28;
  const key = JSON.stringify([w, h, r, slice, o.seed ?? '', o.accent ?? '', o.paint ?? '', !!o.battens, o.plankH ?? '']);
  const hit = panelCache.get(key);
  if (hit) return hit;
  const scale = bakeScale();
  const { canvas, ctx } = makeBakeCanvas(w, h, scale);
  drawPanel(ctx, 0, 0, w, h, r, o);
  const tex: BakedNineSlice = { url: canvas.toDataURL('image/png'), sliceCss: slice, sliceSource: Math.round(slice * scale) };
  panelCache.set(key, tex);
  return tex;
}

const buttonCache = new Map<string, BakedNineSlice>();

export interface BakeButtonOpts {
  w?: number;
  h?: number;
  seed?: number;
  paint?: string;
  worn?: boolean;
  nails?: number;
  slice?: number;
}

/** Bakes one `Wood.sign` (plaque/button board) as a nine-slice texture. */
export function bakeButton(o: BakeButtonOpts = {}): BakedNineSlice {
  const w = o.w ?? 96, h = o.h ?? 44, slice = o.slice ?? 16;
  const key = JSON.stringify(['btn', w, h, slice, o.seed ?? '', o.paint ?? '', !!o.worn, o.nails ?? '']);
  const hit = buttonCache.get(key);
  if (hit) return hit;
  const scale = bakeScale();
  const { canvas, ctx } = makeBakeCanvas(w, h, scale);
  drawSign(ctx, 0, 0, w, h, { seed: o.seed, tilt: 0, paint: o.paint, worn: o.worn, nails: o.nails });
  const tex: BakedNineSlice = { url: canvas.toDataURL('image/png'), sliceCss: slice, sliceSource: Math.round(slice * scale) };
  buttonCache.set(key, tex);
  return tex;
}

const tabCache = new Map<string, BakedNineSlice>();

/** Bakes a flat plank tile for tab-rail / segmented-control chips (no nails, shallow). */
export function bakeTab(o: { w?: number; h?: number; seed?: number; paint?: string; worn?: boolean; slice?: number } = {}): BakedNineSlice {
  const w = o.w ?? 64, h = o.h ?? 34, slice = o.slice ?? 12;
  const key = JSON.stringify(['tab', w, h, slice, o.seed ?? '', o.paint ?? '', !!o.worn]);
  const hit = tabCache.get(key);
  if (hit) return hit;
  const scale = bakeScale();
  const { canvas, ctx } = makeBakeCanvas(w, h, scale);
  const seed = o.seed ?? seedOf(0, w, h, 3);
  drawPanel(ctx, 0, 0, w, h, 6, { seed, paint: o.paint, plankH: h + 4 });
  const tex: BakedNineSlice = { url: canvas.toDataURL('image/png'), sliceCss: slice, sliceSource: Math.round(slice * scale) };
  tabCache.set(key, tex);
  return tex;
}

const badgeCache = new Map<string, string>();

/** Bakes a small flat count-badge stud (red = unseen, green = claimable — never wood-painted). */
export function bakeBadge(color: '#e0483c' | '#3ad46a' | string = '#e0483c', diameterCss = 18): string {
  const key = color + ':' + diameterCss;
  const hit = badgeCache.get(key);
  if (hit) return hit;
  const scale = bakeScale();
  const { canvas, ctx } = makeBakeCanvas(diameterCss, diameterCss, scale);
  const r = diameterCss / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  const g = ctx.createRadialGradient(r - r * 0.35, r - r * 0.35, r * 0.15, r, r, r);
  g.addColorStop(0, shadeColor(color, 0.45));
  g.addColorStop(0.6, color);
  g.addColorStop(1, shadeColor(color, -0.35));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(r, r, r - 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = 'rgba(12,22,34,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(r, r, r - 1.2, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  const url = canvas.toDataURL('image/png');
  badgeCache.set(key, url);
  return url;
}

/**
 * Nine-slice helper: dresses `el` with a baked panel/button/tab texture via
 * CSS `border-image`, so the same PNG serves any element size the DOM
 * layout produces. `fill` keeps the middle region visible (a background,
 * not just a border frame).
 */
export function applyNineSlice(el: HTMLElement, tex: BakedNineSlice): void {
  el.style.borderStyle = 'solid';
  el.style.borderWidth = `${tex.sliceCss}px`;
  el.style.borderImageSource = `url(${tex.url})`;
  el.style.borderImageSlice = `${tex.sliceSource} fill`;
  el.style.borderImageWidth = `${tex.sliceCss}px`;
  el.style.borderImageRepeat = 'stretch';
  el.style.boxSizing = 'border-box';
}
