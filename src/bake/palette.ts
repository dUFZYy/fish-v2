/**
 * Day/night palette — ported verbatim from the old game's `draw.js`
 * (`SKY_KEYS`, `getPalette`) plus the location-water-tint and rain-gloom
 * post-processing steps that used to live inline in the same function.
 *
 * Pure functions only, no globals: the old game read `dayTime`, `getLocation()`
 * and `weatherGloom()` off the window; here every input is an explicit
 * parameter. See docs/spec/03-world-visuals.md §2 for the annotated version.
 *
 * Colour helpers below (`hexToRgb`, `lerpColor`, `shadeColor`) are this
 * file's OWN copies — deliberately not shared with `src/bake/colorUtil.ts`
 * (owned by the fish-art port) to avoid cross-agent file contention. `shadeColor`
 * is exported because `lakeArt.ts`/`anglerArt.ts` in this same module group need
 * the exact old-game lighten/darken formula too.
 */

import type { Location } from '@/data/locations';

/** One SKY_KEYS keyframe (draw.js `SKY_KEYS` row). */
export interface SkyKey {
  /** dayTime fraction, 0..1 */
  readonly t: number;
  readonly top: string;
  readonly bot: string;
  readonly wTop: string;
  readonly wBot: string;
  readonly light: number;
}

/** A resolved palette at some instant: sky gradient, default water gradient, daylight scalar. */
export interface Palette {
  readonly top: string;
  readonly bot: string;
  readonly wTop: string;
  readonly wBot: string;
  /** 0..1 daylight scalar — drives nearly everything else (stars, moon, angler shading, fish). */
  readonly light: number;
}

/** Ported verbatim from draw.js:6-14. Interpolated per-channel between the two bracketing keys. */
export const SKY_KEYS: readonly SkyKey[] = [
  { t: 0.0, top: '#070b1e', bot: '#141c3a', wTop: '#12283d', wBot: '#03101c', light: 0.12 },
  { t: 0.16, top: '#1a2350', bot: '#d07a6a', wTop: '#3c5d7d', wBot: '#0b2436', light: 0.45 },
  { t: 0.3, top: '#4a90d9', bot: '#bfe3f5', wTop: '#5fa8c9', wBot: '#1c4f6b', light: 1.0 },
  { t: 0.66, top: '#4a90d9', bot: '#bfe3f5', wTop: '#5fa8c9', wBot: '#1c4f6b', light: 1.0 },
  { t: 0.8, top: '#3d4f8a', bot: '#ff9a5c', wTop: '#5b7fa0', wBot: '#1a3a55', light: 0.7 },
  { t: 0.9, top: '#141a3d', bot: '#5a3a6a', wTop: '#243b58', wBot: '#08192a', light: 0.28 },
  { t: 1.0, top: '#070b1e', bot: '#141c3a', wTop: '#12283d', wBot: '#03101c', light: 0.12 },
] as const;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** draw.js:16-21, verbatim. Accepts `#rrggbb` or `rgb(a)(...)` strings. */
export function hexToRgb(h: string): [number, number, number] {
  if (h[0] !== '#') {
    const m = h.match(/[\d.]+/g);
    return m ? [+m[0]!, +m[1]!, +m[2]!] : [0, 0, 0];
  }
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** draw.js:22-25, verbatim (per-channel lerp, rounded, returned as `rgb(...)`). */
export function lerpColor(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}

/**
 * fish.js:60-66, verbatim. `amt<0` darkens toward 0, `amt>=0` lightens toward 255.
 * Accepts `#rrggbb` or `rgba(...)`/`rgb(...)`; always returns `rgba(r,g,b,a)`.
 */
export function shadeColor(col: string, amt: number): string {
  let r: number, g: number, b: number, a = 1;
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = col.match(/[\d.]+/g) ?? ['0', '0', '0'];
    r = +m[0]!;
    g = +m[1]!;
    b = +m[2]!;
    if (m[3] != null) a = +m[3];
  }
  const f = (v: number) => Math.round(clamp(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt, 0, 255));
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

/**
 * The raw sky/water/light interpolation (draw.js `getPalette(t, raw=true)`).
 * No location tint, no rain gloom — used where the old game read `getPalette(dayTime,true).light`
 * to check star/moon visibility independent of location darkening.
 */
export function skyPaletteAt(dayTime: number): Palette {
  let pal: Palette = { top: SKY_KEYS[0]!.top, bot: SKY_KEYS[0]!.bot, wTop: SKY_KEYS[0]!.wTop, wBot: SKY_KEYS[0]!.wBot, light: SKY_KEYS[0]!.light };
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i]!;
    const b = SKY_KEYS[i + 1]!;
    if (dayTime >= a.t && dayTime <= b.t) {
      const k = (dayTime - a.t) / (b.t - a.t);
      pal = {
        top: lerpColor(a.top, b.top, k),
        bot: lerpColor(a.bot, b.bot, k),
        wTop: lerpColor(a.wTop, b.wTop, k),
        wBot: lerpColor(a.wBot, b.wBot, k),
        light: lerp(a.light, b.light, k),
      };
      break;
    }
  }
  return pal;
}

/**
 * Location water tint (draw.js:38-47, first half). If the location isn't the free lake, or it
 * has a `dark` factor, its own `water[top,bottom]` hex pair replaces the palette's default water
 * gradient and is progressively blackened at night; `light` is scaled down by `loc.dark`, and a
 * `dark`-only location also pulls sky `top`/`bot` toward a near-black blue.
 */
export function applyLocationTint(pal: Palette, loc: Location): Palette {
  if (loc.id !== 'see' || loc.dark) {
    const night = 1 - pal.light;
    let next: Palette = {
      ...pal,
      wTop: lerpColor(loc.water[0], '#06141f', night * 0.85),
      wBot: lerpColor(loc.water[1], '#020810', night * 0.85),
      light: pal.light * (1 - loc.dark),
    };
    if (loc.dark) {
      next = { ...next, top: lerpColor(next.top, '#0a0f1e', loc.dark), bot: lerpColor(next.bot, '#1a2438', loc.dark) };
    }
    return next;
  }
  return pal;
}

/**
 * Rain-weather gloom (draw.js:48-58). Pulls sky/water colors toward grey. Deliberately never
 * touches `light` — the old comment: "sonst kämen Nachtfische am Regentag" (night-fish logic must
 * stay pure of weather). `gloom` is `weatherGloom()` — 0 (clear) .. 1 (raining) — and is skipped
 * entirely for `dark` locations (Tiefsee has its own gloom-free darkness).
 */
export function applyRainGloom(pal: Palette, loc: Location, gloom: number): Palette {
  if (gloom > 0.01 && !loc.dark) {
    return {
      ...pal,
      top: lerpColor(pal.top, '#5a6673', gloom * 0.55),
      bot: lerpColor(pal.bot, '#7d8894', gloom * 0.5),
      wTop: lerpColor(pal.wTop, '#4a5a66', gloom * 0.35),
      wBot: lerpColor(pal.wBot, '#26313a', gloom * 0.3),
    };
  }
  return pal;
}

/**
 * The full palette (draw.js `getPalette(dayTime)`), composed from the three pure steps above.
 *
 * @param dayTime 0..1 fraction of the day/night cycle.
 * @param loc     current location; omit (or pass `raw: true`) to get the bare sky/water/light
 *                curve with no location tint or weather, matching the old `getPalette(t, true)`.
 * @param gloom   `weatherGloom()`, 0..1. Ignored when `loc` is omitted or `raw` is true.
 * @param raw     skip location tint + rain gloom even if `loc`/`gloom` are given.
 */
export function getPalette(dayTime: number, loc?: Location, gloom = 0, raw = false): Palette {
  let pal = skyPaletteAt(dayTime);
  if (raw || !loc) return pal;
  pal = applyLocationTint(pal, loc);
  pal = applyRainGloom(pal, loc, gloom);
  return pal;
}
