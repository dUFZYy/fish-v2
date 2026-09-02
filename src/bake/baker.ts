/**
 * Baker — the bridge between the old Canvas-2D art and the GPU.
 *
 * The old game's art is code: `drawFish`, `drawPanel`, `drawIcon` etc. draw
 * with plain Canvas 2D and are deterministic. We keep those functions
 * verbatim and run them ONCE per (motif, size, palette step) into an atlas.
 * Runtime cost per sprite afterwards: one quad in a batch.
 *
 * Three atlases so a single one never fills up and so eviction can differ:
 *   sprites  — fish, creatures, props, angler parts   (animated, small)
 *   ui       — wood panels, buttons, icons, badges     (static, medium)
 *   scenery  — backdrops, seabeds, big soft blobs      (few, large)
 */

import { Atlas, type AtlasEntry } from './atlas';
import { layout } from '@/engine/layout';

export type BakeFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

export class Baker {
  sprites = new Atlas(2048, 'sprites');
  ui = new Atlas(2048, 'ui');
  scenery = new Atlas(2048, 'scenery');

  /** re-bake counter per frame — the number the old project failed to measure */
  rebakesThisFrame = 0;
  private rebakeHistory: number[] = [];

  /**
   * Quantised light step. The old project learned this the hard way: the
   * day/night light is continuous, so putting the raw value in a cache key
   * makes the cache re-bake every frame. 64 steps => 0.9% brightness per
   * step, invisible, and the SAME value must be used for drawing.
   */
  static lightStep(light: number): number {
    return Math.round(Math.max(0, Math.min(1, light)) * 63);
  }
  static lightOf(step: number): number { return step / 63; }

  /**
   * Quantised size. Continuous scaling would also defeat the cache. We bake
   * on a ladder of sizes and let the GPU scale between them (cheap, and with
   * mipmaps clean) — the old project could not do that because Canvas-2D
   * scaled blits are both slow and blurry.
   */
  static sizeStep(px: number): number {
    if (px <= 16) return Math.ceil(px);
    if (px <= 64) return Math.ceil(px / 2) * 2;
    if (px <= 256) return Math.ceil(px / 8) * 8;
    return Math.ceil(px / 32) * 32;
  }

  bakeSprite(key: string, w: number, h: number, draw: BakeFn, scale = layout.dpr): AtlasEntry {
    return this.track(this.sprites, key, w, h, scale, draw);
  }
  bakeUi(key: string, w: number, h: number, draw: BakeFn, scale = layout.dpr): AtlasEntry {
    return this.track(this.ui, key, w, h, scale, draw);
  }
  bakeScenery(key: string, w: number, h: number, draw: BakeFn, scale = layout.dpr): AtlasEntry {
    return this.track(this.scenery, key, w, h, scale, draw);
  }

  private track(atlas: Atlas, key: string, w: number, h: number, scale: number, draw: BakeFn): AtlasEntry {
    const hit = atlas.get(key);
    if (hit) return hit;
    this.rebakesThisFrame++;
    return atlas.bake(key, w, h, scale, draw);
  }

  /** call once per frame, after the scene has requested its sprites */
  flush(): void {
    this.sprites.flush();
    this.ui.flush();
    this.scenery.flush();
    this.rebakeHistory.push(this.rebakesThisFrame);
    if (this.rebakeHistory.length > 120) this.rebakeHistory.shift();
    this.rebakesThisFrame = 0;
  }

  /** re-bakes per frame, averaged over the last 120 frames. Must be ~0. */
  get rebakesPerFrame(): number {
    if (!this.rebakeHistory.length) return 0;
    const sum = this.rebakeHistory.reduce((a, b) => a + b, 0);
    return Math.round((sum / this.rebakeHistory.length) * 100) / 100;
  }

  report(): string {
    const s = this.sprites.report(), u = this.ui.report(), c = this.scenery.report();
    return `atlas spr ${s.count}/${s.pct}%  ui ${u.count}/${u.pct}%  scn ${c.count}/${c.pct}%  back/f ${this.rebakesPerFrame}`;
  }

  /** quality tier changed → everything must be re-baked at the new density */
  invalidateAll(): void {
    this.sprites.clear();
    this.ui.clear();
    this.scenery.clear();
  }
}

export const baker = new Baker();

/** deterministic pseudo-random, verbatim from the old game (backdrop.js:7) */
export function prnd(i: number, salt = 0): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}
