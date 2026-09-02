import { Sprite } from 'pixi.js';
import { engine } from '@/engine/app';
import { Baker, baker, prnd } from '@/bake/baker';
import { FishBatch, type FishInstance } from '@/world/fishBatch';
import { WaterOverlay, DEFAULT_FX, type WaterParams } from '@/world/water';
import { standalone } from '@/bake/standalone';
import { layout } from '@/engine/layout';

/**
 * Smoke test for the render architecture, not the game.
 *
 * It answers one question before any content is ported: does
 * "bake once → one instanced draw call with GPU wobble and per-instance
 * veil, plus one water overlay that never reads the scene" hold up on a
 * phone? Open with ?perf=1 for the numbers, ?fish=N for the load,
 * ?water=0 to switch the overlay off as a counter-check.
 */

interface Swimmer {
  inst: FishInstance;
  speed: number;
  bobPhase: number;
  baseY: number;
}

function placeholderFish(seed: number) {
  const hue = Math.floor(prnd(seed, 3) * 360);
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const cx = w * 0.5, cy = h * 0.5;
    const bodyW = w * 0.62, bodyH = h * 0.52;

    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.5, cy);
    ctx.lineTo(cx - w * 0.5, cy - h * 0.38);
    ctx.lineTo(cx - w * 0.42, cy);
    ctx.lineTo(cx - w * 0.5, cy + h * 0.38);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 55% 38%)`;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.15, cy - bodyH * 0.42);
    ctx.quadraticCurveTo(cx, cy - h * 0.5, cx + bodyW * 0.2, cy - bodyH * 0.35);
    ctx.closePath();
    ctx.fillStyle = `hsl(${hue} 50% 32%)`;
    ctx.fill();

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

    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.35, cy);
    ctx.quadraticCurveTo(cx, cy + bodyH * 0.06, cx + bodyW * 0.38, cy - bodyH * 0.04);
    ctx.lineWidth = Math.max(1, h * 0.03);
    ctx.strokeStyle = `hsla(${hue} 70% 78% / 0.5)`;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx - bodyW * 0.05, cy - bodyH * 0.24, bodyW * 0.26, bodyH * 0.1, -0.15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();

    const ex = cx + bodyW * 0.32, ey = cy - bodyH * 0.1, er = h * 0.075;
    ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + er * 0.2, ey, er * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#12202b'; ctx.fill();
  };
}

/**
 * Sky and water as ONE baked sprite. Two vertical gradients and a horizon —
 * nothing here changes between frames except the day/night light, which is
 * quantised to 64 steps and so lives in the cache key.
 */
function skyAndWater(lightStep: number, horizonFrac: number) {
  const light = Baker.lightOf(lightStep);
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const hy = Math.round(h * horizonFrac);
    const dim = (hex: string) => hex; // placeholder art keeps the day palette
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, dim('#4a90d9'));
    sky.addColorStop(1, dim('#bfe3f5'));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hy);

    const water = ctx.createLinearGradient(0, hy, 0, h);
    water.addColorStop(0, '#5fa8c9');
    water.addColorStop(1, '#1c4f6b');
    ctx.fillStyle = water;
    ctx.fillRect(0, hy, w, h - hy);

    ctx.globalAlpha = 1 - light;
    ctx.fillStyle = '#0a1830';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  };
}

export async function startGame(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const wanted = Math.max(1, Math.min(128, parseInt(params.get('fish') || '40', 10)));
  const waterOn = params.get('water') !== '0';

  const HORIZON_FRAC = 0.35;
  const horizon = () => Math.round(engine.H * HORIZON_FRAC);

  // --- background: one baked sprite, one quad ---
  const bg = new Sprite();
  engine.world.addChild(bg);
  const drawBg = () => {
    // Sky and water only vary along y, so an 8 px column stretched across the
    // screen is pixel-identical to a full-screen bake and 145x smaller.
    // A full-screen bake would also not fit the 2048 atlas at 3x at all.
    const step = Baker.lightStep(1);
    const key = `bg:h${engine.H}:l${step}@${layout.dpr}`;
    bg.texture = standalone.strip(key, engine.H, skyAndWater(step, HORIZON_FRAC));
    bg.setSize(engine.W, engine.H);
  };
  drawBg();

  // --- bake a handful of species once, at a quantised size ladder ---
  const SPECIES = 12;
  const frames: Array<{ fx: number; fy: number; fw: number; fh: number; w: number; h: number }> = [];
  for (let s = 0; s < SPECIES; s++) {
    const bw = Baker.sizeStep(40 + Math.round(prnd(s, 1) * 60));
    const bh = Math.round(bw * 0.5);
    const e = baker.bakeSprite(`fish:${s}:${bw}x${bh}@${layout.dpr}`, bw, bh, placeholderFish(s));
    const fr = e.texture.frame;
    frames.push({ fx: fr.x, fy: fr.y, fw: fr.width, fh: fr.height, w: bw, h: bh });
  }

  const batch = new FishBatch(baker.sprites.textureSource, engine.W, engine.H);
  engine.world.addChild(batch.mesh);

  // --- water: one quad from just above the highest crest to the bottom ---
  const water = new WaterOverlay(engine.W, engine.H);
  if (waterOn) engine.world.addChild(water.mesh);
  const CREST = 20;   // max wave amplitude of waveA+waveB, plus a margin
  const setWaterRegion = () => {
    const y = horizon() - CREST;
    water.setRegion(0, y, engine.W, engine.H - y);
  };
  setWaterRegion();

  const waterParams: WaterParams = {
    horizon: horizon(),
    waveA: [10, 1 / 25, 2],       // same numbers as getWave() in the old game
    waveB: [4, 1 / 90, -0.7],
    light: 1,
    wTop: [0x5f / 255, 0xa8 / 255, 0xc9 / 255],
    wBot: [0x1c / 255, 0x4f / 255, 0x6b / 255],
    sun: [engine.W * 0.3, engine.H * 0.12, 40, 1],
    lid: 0,
    deepSea: false,
    fx: { ...DEFAULT_FX },
    tier: 2,
  };

  const swimmers: Swimmer[] = [];
  for (let i = 0; i < wanted; i++) {
    const f = frames[i % SPECIES];
    const baseY = horizon() + 25 + prnd(i, 7) * (engine.H - horizon() - 90);
    const scale = 0.5 + prnd(i, 11) * 0.7;
    swimmers.push({
      inst: {
        x: prnd(i, 13) * engine.W,
        y: baseY,
        w: f.w * scale,
        h: f.h * scale,
        flip: prnd(i, 17) > 0.5 ? 1 : -1,
        rot: 0,
        phase: prnd(i, 19) * Math.PI * 2,
        wobble: 0.08 + prnd(i, 23) * 0.06,
        veilR: waterParams.wBot[0], veilG: waterParams.wBot[1], veilB: waterParams.wBot[2],
        veil: 0,
        alpha: 1,
        fx: f.fx, fy: f.fy, fw: f.fw, fh: f.fh,
      },
      speed: 16 + prnd(i, 29) * 32,
      bobPhase: prnd(i, 31) * Math.PI * 2,
      baseY,
    });
  }

  engine.onUpdate((dt, t) => {
    const hy = horizon();
    batch.begin();
    for (const s of swimmers) {
      const f = s.inst;
      f.x += s.speed * f.flip * dt;
      if (f.x < -f.w) f.x = engine.W + f.w;
      if (f.x > engine.W + f.w) f.x = -f.w;
      f.y = s.baseY + Math.sin(t * 0.6 + s.bobPhase) * 6;
      f.phase += dt * (2.4 + s.speed * 0.045);

      // Depth veil: in the old game this exact look needed a helper canvas
      // per fish per frame and cost 11 of 16.7 ms. Here it is an attribute.
      const depth = Math.max(0, Math.min(1, (f.y - hy) / (engine.H - hy)));
      f.veil = depth * 0.5;
      batch.push(f);
    }
    batch.end();

    waterParams.horizon = hy;
    water.update(t, waterParams);
    baker.flush();
  });

  const onResize = () => {
    drawBg();
    batch.resize(engine.W, engine.H);
    water.resize(engine.W, engine.H);
    setWaterRegion();
    for (const s of swimmers) s.baseY = Math.min(s.baseY, engine.H - 40);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  (window as any).__smoke = { batch, water, swimmers, baker, engine };
}
