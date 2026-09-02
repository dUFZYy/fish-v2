import { Graphics } from 'pixi.js';
import { engine } from '@/engine/app';
import { Baker, baker, prnd } from '@/bake/baker';
import { FishBatch, type FishInstance } from '@/world/fishBatch';
import { layout } from '@/engine/layout';

/**
 * Smoke test for the render architecture, not the game.
 *
 * It answers exactly one question before any content is ported: does
 * "bake once, then one instanced draw call with GPU wobble and per-instance
 * veil" hold up on a phone? Open with ?perf=1 to read the numbers, ?fish=N
 * to change the load.
 *
 * The fish art here is a placeholder in the right SHAPE and SIZE range; the
 * real species art is ported into the baker afterwards and changes nothing
 * about the cost model, because a baked sprite costs the same whatever it
 * depicts.
 */

interface Swimmer {
  inst: FishInstance;
  vx: number;
  vy: number;
  speed: number;
  bandTop: number;
  bandBot: number;
}

function placeholderFish(seed: number) {
  const hue = Math.floor(prnd(seed, 3) * 360);
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cx = w * 0.5, cy = h * 0.5;
    const bodyW = w * 0.62, bodyH = h * 0.52;

    // tail
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.5, cy);
    ctx.lineTo(cx - w * 0.5, cy - h * 0.38);
    ctx.lineTo(cx - w * 0.42, cy);
    ctx.lineTo(cx - w * 0.5, cy + h * 0.38);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 55% 38%)`;
    ctx.fill();

    // dorsal fin
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.15, cy - bodyH * 0.42);
    ctx.quadraticCurveTo(cx, cy - h * 0.5, cx + bodyW * 0.2, cy - bodyH * 0.35);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 50% 32%)`;
    ctx.fill();

    // body
    const g = ctx.createLinearGradient(0, cy - bodyH * 0.5, 0, cy + bodyH * 0.5);
    g.addColorStop(0, `hsl(${hue} 62% 62%)`);
    g.addColorStop(0.55, `hsl(${hue} 58% 46%)`);
    g.addColorStop(1, `hsl(${hue} 45% 30%)`);
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyW * 0.5, bodyH * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.strokeStyle = `hsl(${hue} 45% 22%)`;
    ctx.stroke();

    // lateral line
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.35, cy);
    ctx.quadraticCurveTo(cx, cy + bodyH * 0.06, cx + bodyW * 0.38, cy - bodyH * 0.04);
    ctx.lineWidth = Math.max(1, h * 0.03);
    ctx.strokeStyle = `hsla(${hue} 70% 78% / 0.5)`;
    ctx.stroke();

    // shine
    ctx.beginPath();
    ctx.ellipse(cx - bodyW * 0.05, cy - bodyH * 0.24, bodyW * 0.26, bodyH * 0.1, -0.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();

    // eye
    const ex = cx + bodyW * 0.32, ey = cy - bodyH * 0.1, er = h * 0.075;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + er * 0.2, ey, er * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#12202b'; ctx.fill();
  };
}

export async function startGame(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const wanted = Math.max(1, Math.min(120, parseInt(params.get('fish') || '40', 10)));

  const horizon = () => engine.H * 0.35;

  // --- background: sky + water, as ONE opaque graphics fill (no layers) ---
  const bg = new Graphics();
  engine.world.addChild(bg);
  const drawBg = () => {
    const hy = horizon();
    bg.clear();
    bg.rect(0, 0, engine.W, hy).fill({
      // vertical gradient via two-stop fill is not available on Graphics;
      // the real scene uses a baked sky strip. Flat fill is enough here.
      color: 0x4a90d9,
    });
    bg.rect(0, hy, engine.W, engine.H - hy).fill({ color: 0x2b6f8f });
  };
  drawBg();

  // --- bake a handful of species once, at a quantised size ladder ---
  const SPECIES = 12;
  const frames: Array<{ fx: number; fy: number; fw: number; fh: number; w: number; h: number }> = [];
  for (let s = 0; s < SPECIES; s++) {
    const logicalW = 40 + Math.round(prnd(s, 1) * 60);      // 40..100 px
    const bw = Baker.sizeStep(logicalW);
    const bh = Math.round(bw * 0.5);
    const e = baker.bakeSprite(`fish:${s}:${bw}x${bh}@${layout.dpr}`, bw, bh, placeholderFish(s));
    const frame = e.texture.frame;
    frames.push({ fx: frame.x, fy: frame.y, fw: frame.width, fh: frame.height, w: bw, h: bh });
  }
  baker.flush();

  const batch = new FishBatch(baker.sprites.textureSource, engine.W, engine.H);
  engine.world.addChild(batch.mesh);

  const swimmers: Swimmer[] = [];
  for (let i = 0; i < wanted; i++) {
    const f = frames[i % SPECIES];
    const bandTop = horizon() + 20 + prnd(i, 7) * (engine.H - horizon() - 120);
    const scale = 0.55 + prnd(i, 11) * 0.75;
    swimmers.push({
      inst: {
        x: prnd(i, 13) * engine.W,
        y: bandTop,
        w: f.w * scale,
        h: f.h * scale,
        flip: prnd(i, 17) > 0.5 ? 1 : -1,
        rot: 0,
        phase: prnd(i, 19) * Math.PI * 2,
        wobble: 0.09 + prnd(i, 23) * 0.07,
        veilR: 0.17, veilG: 0.43, veilB: 0.56, veil: 0,
        alpha: 1,
        fx: f.fx, fy: f.fy, fw: f.fw, fh: f.fh,
      },
      vx: 0, vy: 0,
      speed: 18 + prnd(i, 29) * 34,
      bandTop: bandTop - 30,
      bandBot: bandTop + 30,
    });
  }

  engine.onUpdate((dt) => {
    const hy = horizon();
    const deepest = engine.H;
    batch.begin();
    for (const s of swimmers) {
      const f = s.inst;
      f.x += s.speed * f.flip * dt;
      if (f.x < -f.w) { f.x = engine.W + f.w; }
      if (f.x > engine.W + f.w) { f.x = -f.w; }
      f.y += Math.sin(engine.perf.stats.frames * 0 + f.phase * 0.7) * 2 * dt;
      f.phase += dt * (2.4 + s.speed * 0.045);

      // Depth veil: linear-in-depth mix toward the water colour. In the old
      // game this exact look needed a helper canvas per fish per frame.
      const depth = Math.max(0, Math.min(1, (f.y - hy) / (deepest - hy)));
      f.veil = depth * 0.62;
      batch.push(f);
    }
    batch.end();
    baker.flush();
  });

  const onResize = () => { drawBg(); batch.resize(engine.W, engine.H); };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  // expose for the perf HUD and for automated checks
  (window as any).__smoke = { batch, swimmers, baker };
}
