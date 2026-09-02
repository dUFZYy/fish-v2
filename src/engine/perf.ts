/**
 * Perf — the one number that does not lie: the interval between two frames.
 *
 * Lessons carried over from the old project (docs/LEISTUNG-BASIS.md):
 *  - measure frame interval via rAF timestamps, nothing else
 *  - report median fps, p95 and hitches/s (frames > 1.5×median AND >= 20 ms)
 *  - measure the device ceiling first (idle) so 60 on a 120 Hz phone is
 *    recognised as half rate
 *  - never read back a canvas to "force" rasterisation
 */

export interface PerfStats {
  fps: number;      // 1000 / median interval
  median: number;   // ms
  p95: number;      // ms
  hitches: number;  // per second
  frames: number;
}

const WINDOW = 240; // frames kept for statistics (~2–4 s)

export class Perf {
  private intervals: number[] = [];
  private last = 0;
  private hitchCount = 0;
  private windowStart = 0;
  stats: PerfStats = { fps: 0, median: 0, p95: 0, hitches: 0, frames: 0 };

  /** call once per rendered frame with the rAF timestamp */
  tick(now: number): void {
    if (this.last) {
      const dt = now - this.last;
      this.intervals.push(dt);
      if (this.intervals.length > WINDOW) this.intervals.shift();
    } else {
      this.windowStart = now;
    }
    this.last = now;
  }

  /** recompute stats (cheap enough to call every ~500 ms) */
  compute(): PerfStats {
    const n = this.intervals.length;
    if (n < 10) return this.stats;
    const sorted = this.intervals.slice().sort((a, b) => a - b);
    const median = sorted[n >> 1];
    const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    const thresh = Math.max(median * 1.5, 20);
    let hitches = 0;
    let total = 0;
    for (const dt of this.intervals) { total += dt; if (dt > thresh) hitches++; }
    this.hitchCount = hitches;
    this.stats = {
      fps: Math.round(1000 / median * 10) / 10,
      median: Math.round(median * 10) / 10,
      p95: Math.round(p95 * 10) / 10,
      hitches: Math.round(hitches / (total / 1000) * 100) / 100,
      frames: n,
    };
    return this.stats;
  }

  reset(): void {
    this.intervals.length = 0;
    this.last = 0;
    this.hitchCount = 0;
  }
}

/** Small on-screen HUD for the device (no DevTools needed). */
export class PerfHud {
  private el: HTMLDivElement;
  private acc = 0;
  constructor(private perf: Perf, private extra: () => string = () => '') {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:4px;top:calc(env(safe-area-inset-top,0px) + 4px);z-index:9999;' +
      'font:11px/1.3 monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 6px;' +
      'border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
  }
  update(dtMs: number): void {
    this.acc += dtMs;
    if (this.acc < 500) return;
    this.acc = 0;
    const s = this.perf.compute();
    this.el.textContent =
      `${s.fps} fps  med ${s.median}  p95 ${s.p95}  hak/s ${s.hitches}\n${this.extra()}`;
  }
  destroy(): void { this.el.remove(); }
}
