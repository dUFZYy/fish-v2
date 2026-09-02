/**
 * Particles — every effect of the old game in two draw calls.
 *
 * `effects.js` kept six global arrays (drops, ripples, coins, confetti,
 * bubbles, floating text) and drew each element with its own Canvas 2D
 * commands: an arc per drop, an ellipse stroke per ripple, a rotated rect
 * per confetto. The physics was fine — plain numbers, fully portable — and
 * it is ported here verbatim from docs/spec/01-core-loop.md section 7.
 * What changes is the drawing: everything becomes a quad in an instanced
 * batch, split only by blend mode.
 *
 *   normal batch    drops, confetti, bubbles, coins
 *   additive batch  ripples, sparks, glow, the hype flash
 *
 * Two draw calls for the lot, whether there are four particles or four
 * hundred. The old renderer's cost grew with every single one.
 *
 * Shapes come from a tiny set of baked stamps (a soft disc, a ring, a
 * rectangle), so a drop and a confetto are the same quad with different UVs,
 * size and tint — see `bakeStamps`.
 */

import { Buffer, BufferUsage, Geometry, Mesh, Rectangle, Shader, type TextureSource } from 'pixi.js';
import type { Baker } from '@/bake/baker';

const CAPACITY = 1024;
/** floats per instance: x,y,w,h | rot,_,_,_ | r,g,b,a | fx,fy,fw,fh */
const STRIDE = 16;

// ---------------------------------------------------------------------------
// the batch renderer

const vertex = /* glsl */ `#version 300 es
precision highp float;

in vec2 aCorner;      // -0.5..0.5
in vec4 aXYWH;
in vec4 aRot;         // rot, unused, unused, unused
in vec4 aTint;        // rgba, straight (not premultiplied)
in vec4 aFrame;       // atlas frame in texture px

uniform vec2 uScreen;
uniform vec2 uAtlas;

out vec2 vUV;
out vec4 vTint;

void main() {
  float c = cos(aRot.x), s = sin(aRot.x);
  vec2 l = aCorner * aXYWH.zw;
  vec2 world = aXYWH.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  gl_Position = vec4(world.x / uScreen.x * 2.0 - 1.0, 1.0 - world.y / uScreen.y * 2.0, 0.0, 1.0);
  vUV = (aFrame.xy + (aCorner + 0.5) * aFrame.zw) / uAtlas;
  vTint = aTint;
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
in vec4 vTint;
uniform sampler2D uAtlasTex;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uAtlasTex, vUV);   // premultiplied
  if (tex.a < 0.004) discard;
  // tint multiplies the stamp; output stays premultiplied
  fragColor = vec4(tex.rgb * vTint.rgb, tex.a) * vTint.a;
}
`;

export class ParticleBatch {
  mesh: Mesh<Geometry, Shader>;
  private data = new Float32Array(CAPACITY * STRIDE);
  private buffer: Buffer;
  private geometry: Geometry;
  private shader: Shader;
  private count = 0;

  constructor(atlas: TextureSource, screenW: number, screenH: number, additive: boolean) {
    const corners = new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
    this.buffer = new Buffer({
      data: this.data,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
    this.geometry = new Geometry({
      topology: 'triangle-list',
      instanceCount: 0,
      indexBuffer: new Uint16Array([0, 1, 2, 1, 3, 2]),
      attributes: {
        aCorner: { buffer: new Buffer({ data: corners, usage: BufferUsage.VERTEX }), format: 'float32x2' },
        aXYWH: { buffer: this.buffer, format: 'float32x4', instance: true, offset: 0, stride: STRIDE * 4 },
        aRot: { buffer: this.buffer, format: 'float32x4', instance: true, offset: 16, stride: STRIDE * 4 },
        aTint: { buffer: this.buffer, format: 'float32x4', instance: true, offset: 32, stride: STRIDE * 4 },
        aFrame: { buffer: this.buffer, format: 'float32x4', instance: true, offset: 48, stride: STRIDE * 4 },
      },
    });
    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uAtlasTex: atlas,
        pUniforms: {
          uScreen: { value: new Float32Array([screenW, screenH]), type: 'vec2<f32>' },
          uAtlas: { value: new Float32Array([atlas.width, atlas.height]), type: 'vec2<f32>' },
        },
      },
    });
    this.mesh = new Mesh<Geometry, Shader>({ geometry: this.geometry, shader: this.shader });
    this.mesh.cullable = false;
    // A custom-shader mesh has no usable geometry bounds; without this Pixi
    // treats it as empty and never draws it.
    this.mesh.boundsArea = new Rectangle(0, 0, screenW, screenH);
    this.mesh.blendMode = additive ? 'add' : 'normal';
  }

  resize(w: number, h: number): void {
    const u = this.shader.resources.pUniforms.uniforms as { uScreen: Float32Array };
    u.uScreen[0] = w; u.uScreen[1] = h;
    this.mesh.boundsArea = new Rectangle(0, 0, w, h);
  }

  begin(): void { this.count = 0; }

  push(
    x: number, y: number, w: number, h: number, rot: number,
    r: number, g: number, b: number, a: number,
    fx: number, fy: number, fw: number, fh: number,
  ): void {
    if (this.count >= CAPACITY) return;
    const o = this.count * STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h;
    d[o + 4] = rot;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = fx; d[o + 13] = fy; d[o + 14] = fw; d[o + 15] = fh;
    this.count++;
  }

  end(): void {
    this.geometry.instanceCount = this.count;
    if (this.count) this.buffer.update(this.count * STRIDE * 4);
  }

  get instanceCount(): number { return this.count; }

  destroy(): void {
    this.mesh.destroy(true);
    this.geometry.destroy(true);
    this.shader.destroy(true);
  }
}

// ---------------------------------------------------------------------------
// the stamps

export interface Stamp { fx: number; fy: number; fw: number; fh: number }

/**
 * Three shapes cover every effect in the game. Baked once at a generous size
 * and scaled down per particle: a soft disc is smooth under any scale, and
 * scaling a baked stamp on the GPU is free, which is the whole reason the
 * old per-particle `arc()` and `ellipse()` calls can go away.
 */
export function bakeStamps(baker: Baker): Record<'disc' | 'ring' | 'rect' | 'glow', Stamp> {
  const mk = (key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Stamp => {
    const e = baker.bakeSprite(key, w, h, draw, 1);   // stamps bake at 1x and scale
    const f = e.texture.frame;
    return { fx: f.x, fy: f.y, fw: f.width, fh: f.height };
  };

  return {
    // soft-edged disc: drops, bubbles, coins, sparks
    disc: mk('fx:disc', 64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.62, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }),
    // a ring for the ripples; drawn as a full circle and squashed by the
    // instance height, which is what gives the water-perspective ellipse
    ring: mk('fx:ring', 128, 128, (c, w, h) => {
      c.strokeStyle = '#fff';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
      c.stroke();
      // a second, fainter ring just inside reads as foam rather than a hoop
      c.globalAlpha = 0.35;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(w / 2, h / 2, w / 2 - 11, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }),
    // hard rectangle for confetti
    rect: mk('fx:rect', 16, 16, (c, w, h) => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, w, h);
    }),
    // wide soft glow: replaces the old shader's 12-tap bloom ring for the
    // handful of things that actually glow
    glow: mk('fx:glow', 128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }),
  };
}

// ---------------------------------------------------------------------------
// the particles themselves

const enum Kind { Drop, Ripple, Coin, Confetto, Bubble, Spark }

interface P {
  kind: Kind;
  alive: boolean;
  x: number; y: number;
  vx: number; vy: number;
  /** negative age = staggered start, exactly as the old code did it */
  age: number;
  life: number;
  r: number;
  rot: number;
  vr: number;
  w: number; h: number;
  cr: number; cg: number; cb: number;
  /** ripple: final radius; coin: target */
  maxR: number;
  tx: number; ty: number;
  sx: number; sy: number;
  /** bubble horizontal wobble seed */
  wob: number;
  /** coin: has it already reported arrival */
  done: boolean;
}

function make(): P {
  return {
    kind: Kind.Drop, alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1,
    r: 2, rot: 0, vr: 0, w: 6, h: 4, cr: 1, cg: 1, cb: 1, maxR: 40,
    tx: 0, ty: 0, sx: 0, sy: 0, wob: 0, done: false,
  };
}

const CONFETTI_COLORS = ['#ffd23a', '#ff6b6b', '#5ad46a', '#4fc3f7', '#c072ff', '#ffffff'];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export interface ParticleHooks {
  /** called when a flying coin reaches the counter, for Sound.coin() */
  onCoinArrive?: (index: number) => void;
  /** the water line at x, so drops die on the surface like they used to */
  waveAt?: (x: number) => number;
}

export class Particles {
  private pool: P[] = [];
  private stamps: Record<'disc' | 'ring' | 'rect' | 'glow', Stamp>;
  private coinIndex = 0;

  constructor(
    private normal: ParticleBatch,
    private additive: ParticleBatch,
    stamps: Record<'disc' | 'ring' | 'rect' | 'glow', Stamp>,
    private hooks: ParticleHooks = {},
  ) {
    this.stamps = stamps;
    for (let i = 0; i < CAPACITY; i++) this.pool.push(make());
  }

  private spawn(): P | null {
    for (const p of this.pool) if (!p.alive) { p.alive = true; p.done = false; return p; }
    return null;   // pool exhausted: drop the request rather than grow
  }

  get live(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  // --- emitters, numbers straight from spec section 7 --------------------

  /** 7.1 — drops. rand ranges and gravity are the old ones. */
  splash(x: number, y: number, count = 16, power = 1, color: [number, number, number] = [0.86, 0.94, 1]): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Drop;
      p.x = x; p.y = y;
      p.vx = (Math.random() * 180 - 90) * power;
      p.vy = (Math.random() * 170 - 260) * power;
      p.r = 1.5 + Math.random() * 2;
      p.age = 0;
      p.life = 0.5 + Math.random() * 0.4;
      [p.cr, p.cg, p.cb] = color;
    }
  }

  /** 7.2 — staggered rings, drawn squashed to 0.35 for water perspective */
  ripple(x: number, y: number, maxR = 40, count = 2): void {
    for (let i = 0; i < count; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Ripple;
      p.x = x; p.y = y;
      p.age = -i * 0.18;
      p.life = 1.1;
      p.maxR = maxR * (1 + i * 0.4);
      p.cr = 0.85; p.cg = 0.94; p.cb = 1;
    }
  }

  /** 7.3 — coin flight: throw, then ease to the counter */
  coins(x: number, y: number, n: number, targetX: number, targetY: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Coin;
      p.x = x; p.y = y;
      p.vx = Math.random() * 120 - 60;
      p.vy = -150 - Math.random() * 90;
      p.age = -i * 0.06;
      p.life = 1.1;
      p.tx = targetX; p.ty = targetY;
      p.r = 7;
      p.cr = 1; p.cg = 0.83; p.cb = 0.23;
    }
  }

  /** 7.4 */
  confetti(x: number, y: number, n = 40): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Confetto;
      p.x = x; p.y = y;
      p.vx = Math.random() * 520 - 260;
      p.vy = -120 - Math.random() * 300;
      p.rot = Math.random() * 6.28;
      p.vr = Math.random() * 16 - 8;
      p.life = 1.2 + Math.random() * 0.8;
      p.age = 0;
      p.w = 4 + Math.random() * 4;
      p.h = 3 + Math.random() * 2;
      const c = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
      [p.cr, p.cg, p.cb] = hexToRgb(c);
    }
  }

  /** 7.5 — bubbles rise and die at the surface */
  bubbles(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Bubble;
      p.x = x + Math.random() * 12 - 6;
      p.y = y;
      p.r = 1.5 + Math.random() * 2;
      p.vy = -25 - Math.random() * 20;
      p.wob = Math.random() * 6.28;
      p.age = 0;
      p.life = 8;   // they normally die at the surface, not by age
      p.cr = 0.85; p.cg = 0.95; p.cb = 1;
    }
  }

  /** additive sparkle, used for shiny fish and the catch card */
  sparks(x: number, y: number, n = 8, spread = 30): void {
    for (let i = 0; i < n; i++) {
      const p = this.spawn();
      if (!p) return;
      p.kind = Kind.Spark;
      p.x = x + (Math.random() - 0.5) * spread;
      p.y = y + (Math.random() - 0.5) * spread;
      p.vx = (Math.random() - 0.5) * 40;
      p.vy = (Math.random() - 0.5) * 40;
      p.r = 2 + Math.random() * 3;
      p.age = 0;
      p.life = 0.4 + Math.random() * 0.5;
      p.cr = 1; p.cg = 0.98; p.cb = 0.8;
    }
  }

  // --- update + submit ---------------------------------------------------

  update(dt: number): void {
    const wave = this.hooks.waveAt;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age < 0) continue;          // still staggered

      switch (p.kind) {
        case Kind.Drop: {
          p.vy += 700 * dt;             // spec 7.1
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const surface = wave ? wave(p.x) : Infinity;
          if (p.vy > 0 && p.y >= surface) {
            // hitting the water spawns a mini ripple, as it used to
            this.ripple(p.x, surface, 10, 1);
            p.alive = false;
          } else if (p.age > p.life) {
            p.alive = false;
          }
          break;
        }
        case Kind.Ripple:
          if (p.age > p.life) p.alive = false;
          break;
        case Kind.Coin: {
          const t = p.age / p.life;
          if (t < 0.35) {
            p.vy += 500 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.sx = p.x; p.sy = p.y;     // remember the hand-off point
          } else if (t < 1) {
            const k = easeInOut((t - 0.35) / 0.65);
            p.x = p.sx + (p.tx - p.sx) * k;
            p.y = p.sy + (p.ty - p.sy) * k;
          } else {
            if (!p.done) { p.done = true; this.hooks.onCoinArrive?.(this.coinIndex++); }
            p.alive = false;
          }
          break;
        }
        case Kind.Confetto:
          p.vy += 520 * dt;
          p.vx *= 0.99;                 // spec 7.4 drag
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.age > p.life) p.alive = false;
          break;
        case Kind.Bubble: {
          p.y += p.vy * dt;
          p.x += Math.sin(p.age * 5 + p.wob) * 12 * dt;
          const surface = wave ? wave(p.x) : -Infinity;
          if (p.y < surface || p.age > p.life) p.alive = false;
          break;
        }
        case Kind.Spark:
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.age > p.life) p.alive = false;
          break;
      }
    }
    if (this.coinIndex > 1e6) this.coinIndex = 0;
  }

  /** call after update, before rendering */
  submit(): void {
    const n = this.normal;
    const a = this.additive;
    n.begin();
    a.begin();
    const { disc, ring, rect } = this.stamps;

    for (const p of this.pool) {
      if (!p.alive || p.age < 0) continue;
      const t = Math.max(0, Math.min(1, p.age / p.life));

      switch (p.kind) {
        case Kind.Drop:
          n.push(p.x, p.y, p.r * 2, p.r * 2, 0, p.cr, p.cg, p.cb, 0.9 * (1 - t * t),
            disc.fx, disc.fy, disc.fw, disc.fh);
          break;
        case Kind.Ripple: {
          const r = 4 + (p.maxR - 4) * easeOut(t);
          // ry = rx * 0.35 — the water perspective from spec 7.2
          a.push(p.x, p.y, r * 2, r * 0.7, 0, p.cr, p.cg, p.cb, (1 - t) * 0.7,
            ring.fx, ring.fy, ring.fw, ring.fh);
          break;
        }
        case Kind.Coin:
          n.push(p.x, p.y, p.r * 2, p.r * 2, 0, p.cr, p.cg, p.cb, 1,
            disc.fx, disc.fy, disc.fw, disc.fh);
          break;
        case Kind.Confetto:
          n.push(p.x, p.y, p.w, p.h, p.rot, p.cr, p.cg, p.cb, 1 - t * t,
            rect.fx, rect.fy, rect.fw, rect.fh);
          break;
        case Kind.Bubble:
          n.push(p.x, p.y, p.r * 2, p.r * 2, 0, p.cr, p.cg, p.cb, 0.5,
            disc.fx, disc.fy, disc.fw, disc.fh);
          break;
        case Kind.Spark: {
          const s = p.r * 2 * (1 - t * 0.6);
          a.push(p.x, p.y, s, s, 0, p.cr, p.cg, p.cb, 1 - t,
            disc.fx, disc.fy, disc.fw, disc.fh);
          break;
        }
      }
    }
    n.end();
    a.end();
  }

  clear(): void { for (const p of this.pool) p.alive = false; }
}

/**
 * Screen shake — spec 7.8. A number that decays, applied as a translation of
 * the whole world container. In the old renderer it was a canvas translate;
 * here it moves one container, which costs nothing.
 */
export class Shake {
  amount = 0;
  add(v: number): void { this.amount = Math.max(this.amount, v); }
  update(dt: number): void { this.amount = Math.max(0, this.amount - dt * 20); }
  get offsetX(): number { return this.amount ? (Math.random() * 2 - 1) * this.amount : 0; }
  get offsetY(): number { return this.amount ? (Math.random() * 2 - 1) * this.amount : 0; }
}
