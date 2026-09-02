/**
 * colorUtil — colour helpers the old game's drawing code (`fish.js`, `draw.js`,
 * `creatures.js`) read as free-standing globals. Ported here as pure functions:
 * every input the old code closed over is now a parameter, nothing is read
 * from `window`/canvas state, nothing is mutated.
 */

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Old `hexToRgb` (`draw.js:16-20`). Reads `"#rrggbb"` hex OR a `"rgb(...)"` /
 * `"rgba(...)"` string (used verbatim for the two jellyfish species, whose
 * `sp.color`/`sp.fin` are `rgba()` strings, not hex).
 */
export function hexToRgb(h: string): RGB {
  if (h[0] !== '#') {
    const m = h.match(/[\d.]+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
  }
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Same parse as `hexToRgb`, but also recovers alpha for an `rgba()` input (defaults to 1). */
export function parseColor(col: string): RGBA {
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = col.match(/[\d.]+/g) || ['0', '0', '0'];
  const a = m[3] != null ? +m[3] : 1;
  return [+m[0], +m[1], +m[2], a];
}

/**
 * Old `shadeColor` (`fish.js:60-66`). Lightens (`amt > 0`) or darkens
 * (`amt < 0`) a colour, `amt` in -1..1. Understands `#hex` and `rgb()`/`rgba()`
 * (alpha is preserved, not shaded). Used everywhere a fish needs a darker
 * outline/shadow or a lighter highlight derived from its own body colour.
 */
export function shadeColor(col: string, amt: number): string {
  const [r, g, b, a] = parseColor(col);
  const f = (v: number) => Math.round(clamp(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt, 0, 255));
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

/**
 * Old `lerpColor` (`draw.js:22-25`). Linearly interpolates two colours
 * (`#hex` or `rgb()`/`rgba()`), `t` in 0..1.
 */
export function lerpColor(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${lerp(A[0], B[0])},${lerp(A[1], B[1])},${lerp(A[2], B[2])})`;
}

// ---------------------------------------------------------------------------
// Shiny hue transform (spec `02-fish.md` §4)
//
// The old game recolors a shiny fish with one live CSS canvas filter,
// applied to the whole draw (`fish.js:476-479`):
//   if ("filter" in c) c.filter = "hue-rotate(150deg) saturate(1.7) brightness(1.15)";
//   c.shadowColor = "#ffe680"; c.shadowBlur = L * 0.9;
// `fishArt.ts` ports that filter line verbatim (with the same `"filter" in ctx`
// feature check and the same graceful no-op fallback) because a bake happens
// once per sprite, so depending on `CanvasRenderingContext2D.filter` support
// costs nothing at runtime and reproduces the old pixels exactly.
//
// The functions below are a from-scratch, dependency-free re-implementation
// of that SAME filter chain as plain colour math (the exact matrices from the
// CSS Filter Effects spec, https://www.w3.org/TR/filter-effects-1/#funcdef-filter-hue-rotate
// and #funcdef-filter-saturate), for anywhere a colour needs the shiny look
// without a canvas context to set `.filter` on — a DOM/UI dex badge, for
// instance. Not used by the canvas bake path itself.

function hueRotateMatrix(deg: number): readonly number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

function saturateMatrix(sat: number): readonly number[] {
  return [
    0.213 + 0.787 * sat, 0.715 - 0.715 * sat, 0.072 - 0.072 * sat,
    0.213 - 0.213 * sat, 0.715 + 0.285 * sat, 0.072 - 0.072 * sat,
    0.213 - 0.213 * sat, 0.715 - 0.715 * sat, 0.072 + 0.928 * sat,
  ];
}

function applyMatrix(rgb: RGB, m: readonly number[]): RGB {
  const [r, g, b] = rgb;
  return [
    clamp(Math.round(r * m[0] + g * m[1] + b * m[2]), 0, 255),
    clamp(Math.round(r * m[3] + g * m[4] + b * m[5]), 0, 255),
    clamp(Math.round(r * m[6] + g * m[7] + b * m[8]), 0, 255),
  ];
}

/**
 * `hue-rotate(deg) saturate(sat) brightness(bright)`, applied in that order
 * (a CSS filter chain runs left to right on the previous step's output) —
 * the exact matrices the browser uses for `ctx.filter`, run here as plain
 * numbers instead.
 */
export function hueRotate(col: string, deg: number, sat = 1, bright = 1): string {
  const [r, g, b, a] = parseColor(col);
  let rgb: RGB = [r, g, b];
  rgb = applyMatrix(rgb, hueRotateMatrix(deg));
  rgb = applyMatrix(rgb, saturateMatrix(sat));
  const f = (v: number) => clamp(Math.round(v * bright), 0, 255);
  return `rgba(${f(rgb[0])},${f(rgb[1])},${f(rgb[2])},${a})`;
}

/** The old game's exact shiny transform (`fish.js:477`) as pure colour math. */
export function shinyColor(col: string): string {
  return hueRotate(col, 150, 1.7, 1.15);
}

// ---------------------------------------------------------------------------
// Night tint
//
// The old game darkens the ENTIRE canvas at night with one full-screen
// `rgba(5,10,40, alpha)` rectangle drawn over everything (`drawNightTint`,
// `draw.js:2565-2571`) — precisely the second full-screen layer CLAUDE.md
// forbids (`Kein zweites Vollbild im Compositor`). Since fish are baked once
// per quantised light step (`Baker.lightStep`, 64 steps) rather than redrawn
// live, the equivalent tint is baked INTO each sprite instead: `fishArt.ts`
// composites this colour with `globalCompositeOperation = "source-atop"` so
// it only darkens the fish's own already-opaque pixels, never a full frame.
// Formula is the old one with its `dark` (location-darkness) term dropped —
// that is a per-location, not per-species, input and does not belong in a
// species bake key.
export function nightTintColor(light: number): string {
  const alpha = Math.min(0.75, (1 - clamp(light, 0, 1)) * 0.35);
  return `rgba(5,10,40,${alpha})`;
}
