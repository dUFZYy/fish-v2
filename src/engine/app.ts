import { Application, Container, Ticker } from 'pixi.js';
import { layout, measureLayout, notifyLayout } from './layout';
import { Perf } from './perf';

/**
 * Engine boot: ONE WebGL canvas, opaque, nothing composited on top except
 * small DOM UI elements. Resolution policy is explicit and measurable.
 *
 * Quality tiers (device pixels per CSS px):
 *   sharp    = min(DPR, 3)
 *   balanced = min(DPR, 2)
 *   perf     = min(DPR, 1.5)
 * `auto` starts at sharp and steps down when p95 stays above budget.
 */
export type Quality = 'auto' | 'sharp' | 'balanced' | 'perf';

export interface EngineOptions {
  quality?: Quality;
  onResize?: () => void;
}

export class Engine {
  app!: Application;
  /** root for world (scene) content — scaled in logical px */
  world = new Container();
  /** root for in-canvas HUD (things that must blend with the scene) */
  hud = new Container();
  perf = new Perf();
  quality: Quality = 'auto';
  private tier: 'sharp' | 'balanced' | 'perf' = 'sharp';
  private updateFns: Array<(dt: number, t: number) => void> = [];
  private time = 0;
  private autoAcc = 0;

  async init(opts: EngineOptions = {}): Promise<void> {
    this.quality = opts.quality ?? 'auto';
    measureLayout();
    const res = this.resolutionFor(this.tier);
    layout.dpr = res;

    this.app = new Application();
    await this.app.init({
      background: '#1c4f6b',
      backgroundAlpha: 1,
      antialias: false,           // we bake vector art to textures; MSAA was a hidden cost in the old game
      resolution: res,
      autoDensity: true,
      width: layout.W,
      height: layout.H,
      powerPreference: 'high-performance',
      preference: 'webgl',        // WebGPU later, once measured on devices
      clearBeforeRender: true,
      hello: false,
    });
    const host = document.getElementById('game')!;
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world, this.hud);
    this.app.stage.eventMode = 'static';

    // Resize handling: visualViewport fires on iOS toolbar changes too.
    const onResize = () => {
      measureLayout();
      this.app.renderer.resize(layout.W, layout.H);
      notifyLayout();
      opts.onResize?.();
    };
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 50));

    // Coming back from the background always starts with a huge frame gap
    // and often a burst of catch-up frames. Neither says anything about how
    // fast this device is, so the statistics start fresh.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.perf.reset();
    });

    // Main loop. Pixi's ticker drives rendering; we run variable-dt updates
    // clamped to 100 ms so a backgrounded tab does not explode the sim.
    this.app.ticker.maxFPS = 0; // uncapped → follows display refresh (120 Hz on ProMotion)
    this.app.ticker.add((ticker: Ticker) => {
      const now = performance.now();
      this.perf.tick(now);
      const dt = Math.min(ticker.deltaMS, 100) / 1000;
      this.time += dt;
      for (const fn of this.updateFns) fn(dt, this.time);
      if (this.quality === 'auto') this.autoQuality(dt);
    });
  }

  onUpdate(fn: (dt: number, t: number) => void): void { this.updateFns.push(fn); }

  get W(): number { return layout.W; }
  get H(): number { return layout.H; }

  private resolutionFor(tier: 'sharp' | 'balanced' | 'perf'): number {
    const dpr = window.devicePixelRatio || 1;
    const cap = tier === 'sharp' ? 3 : tier === 'balanced' ? 2 : 1.5;
    return Math.min(dpr, cap);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    if (q !== 'auto') this.applyTier(q);
  }

  private applyTier(tier: 'sharp' | 'balanced' | 'perf'): void {
    if (tier === this.tier) return;
    this.tier = tier;
    const res = this.resolutionFor(tier);
    layout.dpr = res;
    this.app.renderer.resolution = res;
    this.app.renderer.resize(layout.W, layout.H);
    this.perf.reset();
    notifyLayout();
  }

  /**
   * Auto quality: after 4 s of samples, if p95 > 1.6× the display frame
   * time, step down one tier. Never steps back up within a session (avoids
   * oscillation; a warm phone only gets slower).
   */
  private autoQuality(dt: number): void {
    this.autoAcc += dt;
    if (this.autoAcc < 4) return;
    this.autoAcc = 0;
    const s = this.perf.compute();
    if (s.frames < 120) return;

    // Throttling is not slowness.
    //
    // A backgrounded tab, a locked phone or a browser that has decided to
    // save power all report enormous frame intervals, and an unguarded
    // auto-tier reads that as "this device cannot cope" and permanently
    // degrades the game. It happened here during development: the page sat
    // in the background at 1 fps and quietly dropped itself from 3x to 2x.
    //
    // No display runs slower than about 20 fps, so anything past 50 ms per
    // frame is the environment, not the renderer. Throw the samples away and
    // start measuring again rather than drawing a conclusion from them.
    if (document.hidden || s.median > 50) {
      this.perf.reset();
      return;
    }

    // Estimate display period from the fastest 5% of frames.
    const budget = Math.max(8.3, Math.min(16.7, s.median));
    if (s.p95 > budget * 1.6) {
      if (this.tier === 'sharp') this.applyTier('balanced');
      else if (this.tier === 'balanced') this.applyTier('perf');
    }
  }

  /**
   * Effect tier for the shaders: 2 = full, 1 = cheap. Tied to the resolution
   * tier, because a device that cannot afford the pixels cannot afford the
   * per-pixel work over them either.
   */
  get qualityTier(): number { return this.tier === 'perf' ? 1 : 2; }

  get currentTier(): string { return `${this.tier} ${layout.dpr.toFixed(2)}x ${this.app.renderer.width}x${this.app.renderer.height}`; }
}

export const engine = new Engine();
