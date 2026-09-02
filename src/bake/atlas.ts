/**
 * Atlas — shelf packer + one GPU texture for many baked sprites.
 *
 * Why this exists: the old game drew every fish, icon and plank with Canvas 2D
 * commands EVERY frame. All of that art is deterministic (see `prnd`), so it
 * can be rastered once and then only copied. On the GPU "copied" means: a quad
 * from an atlas, batched with all the others into a single draw call.
 *
 * Rules taken from the old project's hard-won lessons:
 *  1. Bake in DEVICE pixels, at the size the sprite is actually shown.
 *  2. Never read back a canvas in the same frame you wrote it — we bake into
 *     an OffscreenCanvas and hand it to the GPU once, never read it again.
 *  3. A cache that needs a per-use detour is not a cache. A hit here is a
 *     quad in a batch: no tinting through a helper canvas, no re-render.
 */

import { CanvasSource, Texture, Rectangle, type TextureSource } from 'pixi.js';

export interface AtlasEntry {
  texture: Texture;
  /** device-pixel size of the baked image */
  dw: number;
  dh: number;
  /** logical (CSS px) size it was baked for */
  w: number;
  h: number;
  /** device pixels per logical px at bake time */
  scale: number;
}

const PAD = 2; // transparent gutter, prevents bleeding when scaled/mipmapped

export class Atlas {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private source: CanvasSource;
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private dirty = false;
  readonly entries = new Map<string, AtlasEntry>();

  constructor(readonly size = 2048, readonly label = 'atlas') {
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    if (useOffscreen) {
      this.canvas = new OffscreenCanvas(size, size);
      this.ctx = this.canvas.getContext('2d', { alpha: true })!;
    } else {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      this.canvas = c;
      this.ctx = c.getContext('2d', { alpha: true })!;
    }
    // CanvasSource, not the generic TextureSource: only this one has an
    // uploader for a (Offscreen)Canvas. With the generic class the texture
    // stays empty, every fragment gets alpha 0 and the batch draws nothing
    // — silently, with no GL error.
    this.source = new CanvasSource({
      resource: this.canvas as any,
      width: size,
      height: size,
      // Bilinear + mipmaps: a fish baked once at its largest on-screen size
      // stays clean when the camera or quality tier shrinks it.
      scaleMode: 'linear',
      autoGenerateMipmaps: true,
      alphaMode: 'premultiply-alpha-on-upload',
      label,
    });
  }

  get textureSource(): TextureSource { return this.source; }

  has(key: string): boolean { return this.entries.has(key); }
  get(key: string): AtlasEntry | undefined { return this.entries.get(key); }

  /**
   * Bakes `draw` into the atlas and returns its entry.
   *
   * @param key    cache key. MUST contain everything the drawing depends on
   *               (size, colours, light step, seed). Key and signature must
   *               quantise the SAME way — mismatched rounding is what turned
   *               the old game's cache into an anti-cache.
   * @param w,h    logical size in CSS px
   * @param scale  device pixels per CSS px (usually layout.dpr)
   * @param draw   receives a context already scaled so that (0,0)..(w,h) is
   *               the logical drawing area — the old draw code works unchanged.
   */
  bake(
    key: string,
    w: number,
    h: number,
    scale: number,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): AtlasEntry {
    const existing = this.entries.get(key);
    if (existing) return existing;

    const dw = Math.max(1, Math.ceil(w * scale));
    const dh = Math.max(1, Math.ceil(h * scale));
    if (dw + PAD * 2 > this.size || dh + PAD * 2 > this.size) {
      throw new Error(`Atlas ${this.label}: sprite ${key} (${dw}x${dh}) exceeds ${this.size}`);
    }

    // shelf packing: fill a row, then start a new one
    if (this.shelfX + dw + PAD * 2 > this.size) {
      this.shelfX = 0;
      this.shelfY += this.shelfH + PAD * 2;
      this.shelfH = 0;
    }
    if (this.shelfY + dh + PAD * 2 > this.size) {
      throw new Error(`Atlas ${this.label} full (needed ${dw}x${dh})`);
    }

    const x = this.shelfX + PAD;
    const y = this.shelfY + PAD;
    this.shelfX += dw + PAD * 2;
    this.shelfH = Math.max(this.shelfH, dh);

    const ctx = this.ctx as CanvasRenderingContext2D;
    ctx.save();
    ctx.clearRect(x - PAD, y - PAD, dw + PAD * 2, dh + PAD * 2);
    ctx.beginPath();
    ctx.rect(x, y, dw, dh);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    draw(ctx, w, h);
    ctx.restore();
    this.dirty = true;

    const texture = new Texture({
      source: this.source,
      frame: new Rectangle(x, y, dw, dh),
      label: key,
    });
    const entry: AtlasEntry = { texture, dw, dh, w, h, scale };
    this.entries.set(key, entry);
    return entry;
  }

  /** Upload pending changes. Call once per frame at most, before rendering. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.source.update();
  }

  /** device pixels used, for the perf HUD */
  report(): { used: number; pct: number; count: number } {
    let used = 0;
    for (const e of this.entries.values()) used += e.dw * e.dh;
    return {
      used,
      pct: Math.round((used / (this.size * this.size)) * 100),
      count: this.entries.size,
    };
  }

  clear(): void {
    (this.ctx as CanvasRenderingContext2D).clearRect(0, 0, this.size, this.size);
    this.entries.clear();
    this.shelfX = this.shelfY = this.shelfH = 0;
    this.dirty = true;
  }
}
