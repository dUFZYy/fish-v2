/**
 * Scene — layer order, parallax, and the shake, for one fishing spot.
 *
 * This is the seam. The batches (fish, particles), the water pass and the
 * baked art all arrive from different places; this file is the only one that
 * knows in what order they go on screen and how they move relative to each
 * other. Keeping that in one place is what stops the render order drifting
 * as content is added — in the old game the draw order lived spread across
 * `draw.js`, `backdrop.js`, `locations.js` and `visuals.js`, and the depth
 * bug #48 came out of exactly that.
 *
 * Layer order, back to front:
 *
 *    0  sky + water gradient          one stretched strip, one quad
 *    1  far scenery                   baked, parallax 0.15
 *    2  mid scenery                   baked, parallax 0.35
 *    3  distant silhouette fish       the fish batch, pushed first, veiled
 *    4  seabed                        baked
 *    5  underwater props              baked sprites (weed, chest)
 *    6  fish                          the fish batch
 *    7  hook, line, bobber            thin strips
 *    8  reflections                   mirrored sprites, clipped to water
 *    9  WATER PASS                    all water effects, one quad
 *   10  near scenery                  dock, reeds — above water, unveiled
 *   11  angler, rod                   assembled sprites
 *   12  particles (normal)            one quad batch
 *   13  particles (additive)          one quad batch
 *
 * Everything above the water pass gets the water's veil and caustics over
 * it; everything below stays clear. That single split is what the old
 * shader's per-pixel branch did, and here it is just layer order.
 */

import { Container, Sprite, type TextureSource } from 'pixi.js';
import { FishBatch, type FishInstance } from './fishBatch';
import { WaterOverlay, DEFAULT_FX, type WaterFx, type WaterParams } from './water';
import { ParticleBatch, Particles, Shake, bakeStamps, type ParticleHooks } from './particles';
import { baker } from '@/bake/baker';
import { standalone } from '@/bake/standalone';
import { layout } from '@/engine/layout';

export type BakeFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * What the scene needs drawn, without knowing who draws it. A location
 * module supplies these; the scene bakes and places them.
 */
/**
 * Vertical extent of a layer, as fractions of screen height.
 *
 * Scenery functions draw in full-screen coordinates, but most of them only
 * put ink in a narrow band — a treeline, a bank, a seabed. Declaring the
 * band lets the bake keep only that strip instead of a screen-sized texture
 * that is 85 % transparent.
 */
export interface Band { y: number; h: number }

export interface SceneArt {
  /** id, for cache keys — must change when the art changes */
  id: string;
  /** sky above, water below, as a function of y only */
  gradient(light: number, horizonFrac: number): BakeFn;
  far?(light: number): BakeFn;
  mid?(light: number): BakeFn;
  seabed?(light: number): BakeFn;
  /** drawn above the water pass, so it is never veiled */
  near?(light: number): BakeFn;
  /** where each layer actually has ink; omit for full screen */
  bands?: { far?: Band; mid?: Band; near?: Band; seabed?: Band };
  /** water colours for the pass, 0..1 rgb */
  waterTop(light: number): [number, number, number];
  waterBottom(light: number): [number, number, number];
  /** 1 = the whole screen is water (deep sea) */
  deepSea?: boolean;
  /** ice lid: water effects start below this y in logical px */
  lid?(h: number): number;
  fx?: Partial<WaterFx>;
}

export interface SceneParams {
  /** 0..1 day/night, continuous — quantised internally for the cache */
  light: number;
  /** seconds, drives waves and effects */
  time: number;
  /** sun/moon x, y, radius, strength */
  sun: [number, number, number, number];
  /** parallax look offset in logical px, -1..1 scaled by the caller */
  lookX: number;
  lookY: number;
  /** 2 = full effects, 1 = cheap */
  tier: number;
}

/** water line as a fraction of screen height — the old game's horizonY */
export const HORIZON_FRAC = 0.35;
/** wave numbers from getWave(): amplitude, 1/length, speed */
export const WAVE_A: [number, number, number] = [10, 1 / 25, 2];
export const WAVE_B: [number, number, number] = [4, 1 / 90, -0.7];
/** highest possible crest above the horizon, plus a margin */
const CREST = WAVE_A[0] + WAVE_B[0] + 6;

const PARALLAX_FAR = 0.15;
const PARALLAX_MID = 0.35;
const PARALLAX_NEAR = 0.55;

export class Scene {
  readonly root = new Container();
  private layers: Record<string, Container> = {};
  private bgSprite = new Sprite();
  private farSprite = new Sprite();
  private midSprite = new Sprite();
  private seabedSprite = new Sprite();
  private nearSprite = new Sprite();

  fish!: FishBatch;
  water!: WaterOverlay;
  particles!: Particles;
  shake = new Shake();

  private normalFx!: ParticleBatch;
  private additiveFx!: ParticleBatch;
  /** the four baked shapes every particle system in the game draws from */
  readonly stamps: ReturnType<typeof bakeStamps>;
  private art: SceneArt | null = null;
  private W = 0;
  private H = 0;

  /** underwater props and other per-location sprites live here */
  readonly propsLayer = new Container();
  /** hook, line and bobber */
  readonly tackleLayer = new Container();
  /** mirrored copies of the dock, boat and angler */
  readonly reflectionLayer = new Container();
  /** the angler figure, assembled from poseable pieces */
  readonly anglerLayer = new Container();
  /**
   * Props that belong to the NEAR parallax group and are placed, not baked
   * full-screen: the dock, the boat, a bucket. These have their own size and
   * position, so baking them into a screen-sized layer would stretch them —
   * which is exactly how the dock's planks ended up 206 px thick and its
   * bucket became a slab across the sky.
   */
  readonly nearProps = new Container();

  constructor(atlas: TextureSource, w: number, h: number, hooks: ParticleHooks = {}) {
    this.W = w;
    this.H = h;

    this.fish = new FishBatch(atlas, w, h);
    this.water = new WaterOverlay(w, h);
    this.normalFx = new ParticleBatch(atlas, w, h, false);
    this.additiveFx = new ParticleBatch(atlas, w, h, true);
    this.stamps = bakeStamps(baker);
    this.particles = new Particles(
      this.normalFx,
      this.additiveFx,
      this.stamps,
      { waveAt: (x) => this.waveAt(x, 0), ...hooks },
    );

    // Parallax groups. Only these three containers move, so a look-around
    // costs three transform updates rather than repositioning every sprite.
    const far = new Container();
    const mid = new Container();
    const near = new Container();
    far.addChild(this.farSprite);
    mid.addChild(this.midSprite);
    near.addChild(this.nearSprite, this.nearProps);
    this.layers = { far, mid, near };

    this.root.addChild(
      this.bgSprite,          // 0
      far,                    // 1
      mid,                    // 2
      this.seabedSprite,      // 4
      this.propsLayer,        // 5
      this.fish.mesh,         // 3 + 6 (distant fish are pushed first)
      this.tackleLayer,       // 7
      this.reflectionLayer,   // 8
      this.water.mesh,        // 9
      near,                   // 10
      this.anglerLayer,       // 11
      this.normalFx.mesh,     // 12
      this.additiveFx.mesh,   // 13
    );
  }

  /** the wave line, identical in shape to the game logic's getWave */
  waveAt(x: number, phase: number): number {
    const horizon = this.H * HORIZON_FRAC;
    return horizon
      + Math.sin(x * WAVE_A[1] + this.lastTime * WAVE_A[2] + phase) * WAVE_A[0]
      + Math.sin(x * WAVE_B[1] + this.lastTime * WAVE_B[2] + phase) * WAVE_B[0];
  }

  private lastTime = 0;

  get horizonY(): number { return Math.round(this.H * HORIZON_FRAC); }

  /**
   * Swaps the location. Bakes what is missing; a location already visited
   * this session is free, because the bakes are keyed and kept.
   */
  setArt(art: SceneArt, light: number): void {
    this.art = art;
    this.rebake(light);
  }

  private lastLightStep = -1;
  private lastLight = 1;
  /**
   * Keys baked for the CURRENT light step. When the light moves on, these
   * are dropped — without that the day clock silently accumulates a
   * screen-sized texture set per light step, and the scenery budget went
   * from 50 MB to 100 MB in under a minute of play.
   */
  private liveKeys: string[] = [];

  private rebake(light: number): void {
    const art = this.art;
    if (!art) return;
    // 64 steps: the day/night light is continuous, and putting the raw value
    // in a cache key is what turned the old project's cache into an
    // anti-cache. The SAME quantised value is handed to the draw functions,
    // or the baked hills would be lit differently from the live grass.
    const step = Math.round(Math.max(0, Math.min(1, light)) * 63);
    if (step === this.lastLightStep) return;
    this.lastLightStep = step;
    const q = step / 63;
    const id = art.id;
    const dpr = layout.dpr;
    const previous = this.liveKeys;
    this.liveKeys = [];

    const gradKey = `${id}:grad:h${this.H}:l${step}@${dpr}`;
    this.bgSprite.texture = standalone.strip(gradKey, this.H, art.gradient(q, HORIZON_FRAC));
    this.bgSprite.setSize(this.W, this.H);
    this.liveKeys.push(gradKey);

    const place = (
      sprite: Sprite,
      fn: ((l: number) => BakeFn) | undefined,
      name: string,
      overscan: number,
      band: Band | undefined,
    ) => {
      if (!fn) { sprite.visible = false; return; }
      sprite.visible = true;
      // Parallax layers are drawn wider than the screen so sliding them does
      // not expose an edge.
      const w = Math.ceil(this.W * (1 + overscan * 2));
      const bandY = band ? Math.floor(band.y * this.H) : 0;
      const bandH = band ? Math.ceil(band.h * this.H) : this.H;
      const key = `${id}:${name}:${w}x${bandH}+${bandY}:l${step}@${dpr}`;
      sprite.texture = standalone.band(key, w, this.H, bandY, bandH, fn(q));
      sprite.setSize(w, bandH);
      sprite.x = -this.W * overscan;
      sprite.y = bandY;
      this.liveKeys.push(key);
    };
    const bands = art.bands ?? {};
    place(this.farSprite, art.far, 'far', PARALLAX_FAR, bands.far);
    place(this.midSprite, art.mid, 'mid', PARALLAX_MID, bands.mid);
    place(this.nearSprite, art.near, 'near', PARALLAX_NEAR, bands.near);
    place(this.seabedSprite, art.seabed, 'bed', 0, bands.seabed);

    // Only now drop what the previous step used: a key that is still needed
    // was re-requested above and is a cache hit, so it never appears here.
    for (const k of previous) {
      if (!this.liveKeys.includes(k)) standalone.drop(k);
    }
  }

  /** call once per frame, after the game has pushed its fish */
  update(dt: number, p: SceneParams): void {
    this.lastTime = p.time;
    this.lastLight = p.light;
    const art = this.art;
    this.rebake(p.light);

    // parallax: three container offsets, nothing else moves
    const px = p.lookX;
    const py = p.lookY;
    this.layers.far.x = -px * PARALLAX_FAR;
    this.layers.far.y = -py * PARALLAX_FAR;
    this.layers.mid.x = -px * PARALLAX_MID;
    this.layers.mid.y = -py * PARALLAX_MID;
    this.layers.near.x = -px * PARALLAX_NEAR;
    this.layers.near.y = -py * PARALLAX_NEAR;

    // water
    if (art) {
      const region = art.deepSea
        ? { y: 0, h: this.H }
        : { y: this.horizonY - CREST, h: this.H - (this.horizonY - CREST) };
      this.water.setRegion(0, region.y, this.W, region.h);
      const params: WaterParams = {
        horizon: this.horizonY,
        waveA: WAVE_A,
        waveB: WAVE_B,
        light: p.light,
        wTop: art.waterTop(p.light),
        wBot: art.waterBottom(p.light),
        sun: p.sun,
        lid: art.lid ? art.lid(this.H) : 0,
        deepSea: !!art.deepSea,
        fx: { ...DEFAULT_FX, ...art.fx },
        tier: p.tier,
      };
      this.water.update(p.time, params);
      // The shoal is distorted by the SAME surface the water pass draws, so
      // the fish and the wave bands move together instead of arguing.
      this.fish.setWater(p.time, this.horizonY, WAVE_A, WAVE_B, art.deepSea ? 0.55 : 1);
    }

    this.particles.update(dt);
    this.particles.submit();

    // Screen shake moves the whole world once, instead of translating the
    // canvas before every draw call as the old renderer did.
    this.shake.update(dt);
    this.root.x = this.shake.offsetX;
    this.root.y = this.shake.offsetY;

    baker.flush();
  }

  /** the depth veil for a fish at depth y — the old helper-canvas tint */
  veilFor(y: number, wBot: [number, number, number], strength = 0.5): {
    veilR: number; veilG: number; veilB: number; veil: number;
  } {
    const hy = this.horizonY;
    const d = Math.max(0, Math.min(1, (y - hy) / Math.max(1, this.H - hy)));
    return { veilR: wBot[0], veilG: wBot[1], veilB: wBot[2], veil: d * strength };
  }

  pushFish(f: FishInstance): void { this.fish.push(f); }
  beginFish(): void { this.fish.begin(); }
  endFish(): void { this.fish.end(); }

  resize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.fish.resize(w, h);
    this.water.resize(w, h);
    this.normalFx.resize(w, h);
    this.additiveFx.resize(w, h);
    this.lastLightStep = -1;      // sizes are in the keys, so everything re-bakes
    this.rebake(this.lastLight);
  }

  /** draw-call and load figures for the perf HUD */
  report(): string {
    return `fish ${this.fish.instanceCount}  fx ${this.normalFx.instanceCount}+${this.additiveFx.instanceCount}  live ${this.particles.live}`;
  }

  destroy(): void {
    this.fish.destroy();
    this.water.destroy();
    this.normalFx.destroy();
    this.additiveFx.destroy();
    this.root.destroy({ children: true });
  }
}
