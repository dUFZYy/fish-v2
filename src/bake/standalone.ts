/**
 * Standalone bakes — for art that is too big for an atlas.
 *
 * An atlas is right for many small motifs. A backdrop that fills the screen
 * is neither small nor numerous, and at 3× it is 1170×2532 device pixels,
 * which does not fit a 2048 atlas at all. Two shapes cover everything the
 * game needs:
 *
 *   strip  — art that only varies along ONE axis (sky gradient, water
 *            gradient, depth fog). Baked as a narrow column and stretched
 *            across the screen. 8×2532 instead of 1170×2532: 145× less
 *            memory and bandwidth for a pixel-identical result.
 *   full   — art that genuinely varies in both axes (a location's scenery).
 *            Its own texture, one per motif, baked at screen size.
 *
 * Both are cached by key like the atlas, and both count as re-bakes so the
 * per-frame re-bake number stays honest.
 */

import { CanvasSource, Texture } from 'pixi.js';
import { layout } from '@/engine/layout';

export type BakeFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

interface Entry { texture: Texture; source: CanvasSource; w: number; h: number; scale: number }

function makeCanvas(dw: number, dh: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(dw, dh);
    return { canvas: c, ctx: c.getContext('2d', { alpha: true }) as unknown as CanvasRenderingContext2D };
  }
  const c = document.createElement('canvas');
  c.width = dw; c.height = dh;
  return { canvas: c, ctx: c.getContext('2d', { alpha: true })! };
}

export class StandaloneBakes {
  private entries = new Map<string, Entry>();
  rebakes = 0;

  /** hard cap so a tall phone at 3× never asks for a texture the GPU refuses */
  maxSize = 4096;

  /**
   * Bakes a column of `stripW` logical px and full logical height, meant to
   * be stretched horizontally. The draw function still receives the LOGICAL
   * width it should assume, so gradients and stops are written once.
   */
  strip(key: string, logicalH: number, draw: BakeFn, stripW = 8, scale = layout.dpr): Texture {
    const hit = this.entries.get(key);
    if (hit) return hit.texture;
    return this.make(key, stripW, logicalH, scale, draw);
  }

  /** Bakes art that varies in both axes, at its own full size. */
  full(key: string, logicalW: number, logicalH: number, draw: BakeFn, scale = layout.dpr): Texture {
    const hit = this.entries.get(key);
    if (hit) return hit.texture;
    // If the requested texture would exceed the cap, bake at a lower density
    // rather than failing. A backdrop is smooth art; half density is invisible
    // behind the water, and a hard failure is not.
    let s = scale;
    while ((logicalW * s > this.maxSize || logicalH * s > this.maxSize) && s > 0.5) s /= 2;
    return this.make(key, logicalW, logicalH, s, draw);
  }

  private make(key: string, w: number, h: number, scale: number, draw: BakeFn): Texture {
    const dw = Math.max(1, Math.ceil(w * scale));
    const dh = Math.max(1, Math.ceil(h * scale));
    const { canvas, ctx } = makeCanvas(dw, dh);
    ctx.save();
    ctx.scale(scale, scale);
    draw(ctx, w, h);
    ctx.restore();

    const source = new CanvasSource({
      resource: canvas as unknown as HTMLCanvasElement,
      width: dw,
      height: dh,
      scaleMode: 'linear',
      // A stretched gradient must not sample outside its column, or the edge
      // pixel bleeds and shows as a seam.
      addressMode: 'clamp-to-edge',
      alphaMode: 'premultiply-alpha-on-upload',
      autoGenerateMipmaps: false,
      label: key,
    });
    const texture = new Texture({ source, label: key });
    this.entries.set(key, { texture, source, w, h, scale });
    this.rebakes++;
    return texture;
  }

  /** total device pixels held, for the perf HUD */
  report(): { count: number; mb: number } {
    let px = 0;
    for (const e of this.entries.values()) px += Math.ceil(e.w * e.scale) * Math.ceil(e.h * e.scale);
    return { count: this.entries.size, mb: Math.round((px * 4) / 1048576 * 10) / 10 };
  }

  /** drop a single motif (a location left behind, a palette step gone stale) */
  drop(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.texture.destroy(false);
    e.source.destroy();
    this.entries.delete(key);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.drop(key);
  }
}

export const standalone = new StandaloneBakes();
