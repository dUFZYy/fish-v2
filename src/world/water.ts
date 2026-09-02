/**
 * WaterOverlay — every water effect of the old game in ONE quad over the
 * water region, without ever reading the scene.
 *
 * ── Why this is not a port of `world-frag.js` ────────────────────────────
 * The old shader was a full-screen post-process over the whole scene. It
 * read the scene texture 15+ times per pixel: once for refraction, twice
 * for the mirror band, and twelve times for the bloom rings — and the bloom
 * loop sat OUTSIDE the water branch, so it ran over the sky too. On a tile
 * GPU those reads are the scarce resource, and they are the reason the
 * effects cost half the frame no matter how little content was on screen.
 *
 * Reading the scene is only necessary for two of the effects. The other
 * nine are pure formulas, and a formula that mixes toward a colour or adds
 * light is exactly what alpha blending already does:
 *
 *     final = mix(scene, veil, a) + add
 *
 * With premultiplied output `rgb = veil*a + add`, `alpha = a` and the normal
 * blend function, the GPU produces that line for free. So this pass emits
 * colour and alpha and never samples anything but a tiny noise lookup.
 *
 * The two that DID need the scene are solved elsewhere, more cheaply:
 *   refraction → the fish/backdrop shaders wobble their own UVs with the
 *                same wave formula (see fishBatch.ts), so the distortion
 *                still tracks the surface
 *   reflection → the dock, boat and angler are drawn a second time,
 *                mirrored about the water line and clipped to the water
 *                (see surface.ts); two extra small quads instead of a
 *                full-screen sample
 *   bloom      → glowing objects carry a baked additive halo sprite
 *                instead of a 12-tap ring over every pixel of the screen
 *
 * Net effect: same look, one pass, no render target, no scene read.
 */

import { Buffer, BufferUsage, Geometry, Mesh, Rectangle, Shader } from 'pixi.js';

/** Effect strengths. Names and meanings match the old uFx1/uFx2 packing. */
export interface WaterFx {
  /** wave-band strength near the surface (old uWTop/uWBot band mix) */
  bands: number;
  /** caustic light net */
  caustics: number;
  /** sun glitter just under the surface */
  glitter: number;
  /** Beer-Lambert turbidity */
  turbidity: number;
  /** foam line on the surface */
  foam: number;
  /** vignette */
  vignette: number;
  /** plankton specks */
  plankton: number;
  /** light shafts from the sun */
  shafts: number;
}

export const DEFAULT_FX: WaterFx = {
  bands: 1, caustics: 1, glitter: 1, turbidity: 1,
  foam: 1, vignette: 1, plankton: 1, shafts: 1,
};

export interface WaterParams {
  /** water line in logical px */
  horizon: number;
  /** wave A: amplitude, 1/length, speed — same numbers as getWave */
  waveA: [number, number, number];
  waveB: [number, number, number];
  /** daylight 0..1 */
  light: number;
  /** water colour top/bottom as 0..1 rgb */
  wTop: [number, number, number];
  wBot: [number, number, number];
  /** sun x, y, radius, strength (visibility × light) */
  sun: [number, number, number, number];
  /** ice lid: water effects start below this y (0 = open water) */
  lid: number;
  /** 1 = deep sea (everything is water, no surface line) */
  deepSea: boolean;
  fx: WaterFx;
  /** 2 = full, 1 = cheap (drops the fine caustic octave and the shafts) */
  tier: number;
}

const vertex = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;                // 0..1 across the water quad
uniform vec4 uQuad;          // x, y, w, h of the quad in logical px
uniform vec2 uScreen;
out vec2 vPx;                // logical pixel position, y from top
void main() {
  vPx = uQuad.xy + aPos * uQuad.zw;
  vec2 clip = vec2(vPx.x / uScreen.x * 2.0 - 1.0, 1.0 - vPx.y / uScreen.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;

in vec2 vPx;

uniform vec2  uScreen;
uniform float uTime;
uniform float uHorizon;
uniform vec4  uWaveA;    // amplitude, 1/length, speed, unused
uniform vec4  uWaveB;
uniform float uLight;
uniform vec3  uWTop;
uniform vec3  uWBot;
uniform vec4  uSun;      // x, y, radius, strength
uniform vec4  uFx1;      // bands, caustics, glitter, turbidity
uniform vec4  uFx2;      // foam, vignette, plankton, shafts
uniform float uLid;
uniform float uDeep;     // 0 or 1
uniform float uTier;     // 1 = cheap, 2 = full

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// identical shape to getWave() in the game logic
float waveY(float x, float ph) {
  return uHorizon + sin(x * uWaveA.y + uTime * uWaveA.z + ph) * uWaveA.x
                  + sin(x * uWaveB.y + uTime * uWaveB.z + ph) * uWaveB.x;
}

void main() {
  vec2 px = vPx;

  // veil is mixed toward, add is added. Both accumulate, then leave as
  // one premultiplied fragment. This is the whole trick of this file.
  vec3  veil = uWBot;
  float a = 0.0;
  vec3  add = vec3(0.0);

  if (uDeep > 0.5) {
    // ============================ deep sea ============================
    float d = clamp(px.y / uScreen.y, 0.0, 1.0);

    // residual light from above: one broad soft breath, never three columns
    float shaft = uTier > 1.5
      ? fbm(vec2(px.x / uScreen.x * 2.2 + uTime * 0.05, uTime * 0.1))
      : noise(vec2(px.x / uScreen.x * 2.2 + uTime * 0.05, uTime * 0.1));
    add += vec3(0.3, 0.5, 0.7) * (0.35 + 0.65 * shaft) * exp(-d * 4.0) * 0.045;

    // Beer-Lambert into the black, capped so single fish stay aimable
    veil = vec3(0.01, 0.028, 0.055);
    a = min(0.35, (1.0 - exp(-d * 2.0)) * 0.4 * uFx1.w);

    // marine snow: two layers of slowly sinking flakes
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      if (i == 0 || uTier > 1.5) {
        float sc = 0.017 + fi * 0.012;
        vec2 pg = vec2(px.x * sc + fi * 7.3 + sin(uTime * 0.2 + fi) * 0.3,
                       px.y * sc - uTime * (0.05 + fi * 0.04));
        vec2 cell = floor(pg);
        vec2 f = fract(pg) - vec2(hash(cell), hash(cell + 3.7));
        float fl = exp(-dot(f, f) * 260.0) * step(0.72, hash(cell + 11.0));
        add += vec3(0.55, 0.72, 0.85) * fl * 0.32;
      }
    }
  } else {
    float wy = waveY(px.x, 0.0);
    float top = max(wy, uLid);
    if (px.y < top) { fragColor = vec4(0.0); return; }   // above water: untouched

    float d = clamp((px.y - uHorizon) / max(uScreen.y - uHorizon, 1.0), 0.0, 1.0);
    float edge = px.y - wy;
    float surf = uLid > 1.0 ? 0.0 : 1.0;   // no bands or foam under an ice lid

    // --- the three wave bands from the old drawWater, as a formula ---
    float bandEnd = smoothstep(72.0, 26.0, px.y - uHorizon) * surf * uFx1.x;
    // Each band is a mix toward a water colour, so they compose as ordinary
    // alpha over one another.
    float b1 = 0.18 * smoothstep(-0.9, 0.9, px.y - waveY(px.x, 1.7) - 18.0) * bandEnd;
    float b2 = 0.25 * smoothstep(-0.9, 0.9, px.y - waveY(px.x, 0.8) - 8.0)  * bandEnd;
    float b3 = 0.45 * smoothstep(-0.9, 0.9, px.y - wy)                      * bandEnd;
    // resolve the three sequential mixes into one colour + coverage
    vec3  bandCol = (uWBot * b1 * (1.0 - b2) * (1.0 - b3) + uWTop * (b2 * (1.0 - b3) + b3));
    float bandA   = b1 * (1.0 - b2) * (1.0 - b3) + b2 * (1.0 - b3) + b3;

    // --- turbidity: Beer-Lambert veil BETWEEN eye and fish (bug #48) ---
    float turb = (1.0 - exp(-d * 1.9 * uFx1.w)) * 0.55;
    vec3  turbCol = uWBot * 0.55;

    // combine bands over turbidity (bands sit closer to the eye)
    a = turb + bandA * (1.0 - turb);
    veil = a > 0.0001 ? (turbCol * turb * (1.0 - bandA) + bandCol) / a : uWBot;

    // --- caustics: two overlaid light nets, coarse carries, fine shimmers ---
    vec2 cq = px * 0.035;
    float c1 = sin(cq.x * 1.7 + cq.y * 0.9 + uTime * 0.9);
    float c2 = sin(cq.x * -1.1 + cq.y * 2.3 - uTime * 0.7);
    float c3 = sin((cq.x + cq.y) * 1.9 + uTime * 1.3);
    float cNet = pow(max(0.0, (c1 + c2 + c3) / 3.0), 6.0);
    float caust = cNet;
    if (uTier > 1.5) {
      vec2 cf = cq * 2.3;
      float f1 = sin(cf.x * 1.3 - cf.y * 1.1 - uTime * 1.1);
      float f2 = sin(cf.x * -0.9 + cf.y * 1.9 + uTime * 0.8);
      // the fine octave only shimmers where the coarse net is already bright;
      // standing free it formed diagonal stripes, which read as an artefact
      caust += pow(max(0.0, (f1 + f2) / 2.0), 7.0) * 0.7 * smoothstep(0.01, 0.12, cNet);
    }
    caust *= exp(-d * 2.6) * uLight * uFx1.y;
    add += vec3(0.85, 0.95, 1.0) * caust * 0.5;

    // --- light shafts from the SUN only; the moon glitters but casts none ---
    float shaftOn = smoothstep(0.35, 0.6, uSun.w) * step(1.5, uTier) * uFx2.w;
    if (shaftOn > 0.01) {
      float sx = (px.x - uSun.x) / uScreen.x;
      float sh = fbm(vec2(sx * 6.0 - d * 1.1, uTime * 0.22));
      add += vec3(1.0, 0.98, 0.88) * smoothstep(0.55, 0.95, sh)
             * 0.10 * shaftOn * uSun.w * (1.0 - d * 0.75) * min(uFx1.y, 1.0) * surf;
    }

    // --- plankton: a sparse point field, not noise ---
    vec2 pg = vec2(px.x * 0.02 + uTime * 0.06, px.y * 0.02);
    vec2 cell = floor(pg);
    vec2 pf = fract(pg) - vec2(hash(cell), hash(cell + 3.7));
    float pl = exp(-dot(pf, pf) * 220.0) * step(0.72, hash(cell + 11.0));
    add += vec3(0.78, 0.92, 1.0) * pl * 0.35 * (1.0 - d * 0.5) * uFx2.z;

    // --- sun glitter pinned to the wave crests ---
    if (uSun.w > 0.02 && uFx1.z > 0.001) {
      float band = exp(-(px.y - uHorizon) / 80.0);
      float g = noise(vec2(px.x * 0.055 - uTime * 1.9, px.y * 0.35 + uTime * 0.4));
      g *= 0.6 + 0.4 * sin(px.x * uWaveA.y + uTime * uWaveA.z);
      add += vec3(1.0) * smoothstep(0.62, 0.95, g) * band * 0.5 * uSun.w * uFx1.z
             * exp(-abs(px.x - uSun.x) / (uScreen.x * 0.22));
    }

    // --- foam line, broken up by noise instead of drawn through ---
    float foam = smoothstep(2.6, 0.0, edge) * (0.18 + 0.30 * uLight) * uFx2.x * surf;
    foam *= 0.55 + 0.45 * noise(vec2(px.x * 0.08 - uTime * 1.4, uTime * 0.5));
    add += vec3(1.0) * foam;
  }

  // --- vignette (replaces the old drawDepthFog area fill) ---
  float vig = smoothstep(0.45, 1.0, distance(px / uScreen, vec2(0.5))) * 0.28 * uFx2.y;
  if (vig > 0.0) {
    vec3 vCol = vec3(0.0, 0.0, 0.055);
    float na = vig + a * (1.0 - vig);
    veil = na > 0.0001 ? (vCol * vig + veil * a * (1.0 - vig)) / na : veil;
    a = na;
  }

  // premultiplied: rgb = veil*a + add, alpha = a
  fragColor = vec4(veil * a + add, a);
}
`;

export class WaterOverlay {
  mesh: Mesh<Geometry, Shader>;
  private shader: Shader;
  private geometry: Geometry;
  private u: Record<string, Float32Array | number>;

  constructor(screenW: number, screenH: number) {
    // one unit quad; the vertex shader maps it onto the water rect
    const pos = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.geometry = new Geometry({
      topology: 'triangle-list',
      indexBuffer: new Uint16Array([0, 1, 2, 1, 3, 2]),
      attributes: {
        aPos: { buffer: new Buffer({ data: pos, usage: BufferUsage.VERTEX }), format: 'float32x2' },
      },
    });

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        waterUniforms: {
          uQuad: { value: new Float32Array([0, 0, screenW, screenH]), type: 'vec4<f32>' },
          uScreen: { value: new Float32Array([screenW, screenH]), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uHorizon: { value: screenH * 0.35, type: 'f32' },
          uWaveA: { value: new Float32Array([10, 1 / 25, 2, 0]), type: 'vec4<f32>' },
          uWaveB: { value: new Float32Array([4, 1 / 90, -0.7, 0]), type: 'vec4<f32>' },
          uLight: { value: 1, type: 'f32' },
          uWTop: { value: new Float32Array([0.37, 0.66, 0.79]), type: 'vec3<f32>' },
          uWBot: { value: new Float32Array([0.11, 0.31, 0.42]), type: 'vec3<f32>' },
          uSun: { value: new Float32Array([screenW * 0.3, screenH * 0.12, 40, 1]), type: 'vec4<f32>' },
          uFx1: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
          uFx2: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
          uLid: { value: 0, type: 'f32' },
          uDeep: { value: 0, type: 'f32' },
          uTier: { value: 2, type: 'f32' },
        },
      },
    });

    this.u = this.shader.resources.waterUniforms.uniforms as Record<string, Float32Array | number>;
    this.mesh = new Mesh<Geometry, Shader>({ geometry: this.geometry, shader: this.shader });
    this.mesh.cullable = false;
    this.mesh.boundsArea = new Rectangle(0, 0, screenW, screenH);
  }

  /**
   * Sets the quad to cover only the water. The top edge must sit above the
   * highest possible wave crest, otherwise the surface line clips.
   */
  setRegion(x: number, y: number, w: number, h: number): void {
    const q = this.u.uQuad as Float32Array;
    q[0] = x; q[1] = y; q[2] = w; q[3] = h;
    this.mesh.boundsArea = new Rectangle(x, y, w, h);
  }

  resize(w: number, h: number): void {
    const s = this.u.uScreen as Float32Array;
    s[0] = w; s[1] = h;
  }

  update(t: number, p: WaterParams): void {
    const u = this.u;
    u.uTime = t;
    u.uHorizon = p.horizon;
    u.uLight = p.light;
    u.uLid = p.lid;
    u.uDeep = p.deepSea ? 1 : 0;
    u.uTier = p.tier;
    const wa = u.uWaveA as Float32Array;
    wa[0] = p.waveA[0]; wa[1] = p.waveA[1]; wa[2] = p.waveA[2];
    const wb = u.uWaveB as Float32Array;
    wb[0] = p.waveB[0]; wb[1] = p.waveB[1]; wb[2] = p.waveB[2];
    const wt = u.uWTop as Float32Array;
    wt[0] = p.wTop[0]; wt[1] = p.wTop[1]; wt[2] = p.wTop[2];
    const wbo = u.uWBot as Float32Array;
    wbo[0] = p.wBot[0]; wbo[1] = p.wBot[1]; wbo[2] = p.wBot[2];
    const sun = u.uSun as Float32Array;
    sun[0] = p.sun[0]; sun[1] = p.sun[1]; sun[2] = p.sun[2]; sun[3] = p.sun[3];
    const f1 = u.uFx1 as Float32Array;
    f1[0] = p.fx.bands; f1[1] = p.fx.caustics; f1[2] = p.fx.glitter; f1[3] = p.fx.turbidity;
    const f2 = u.uFx2 as Float32Array;
    f2[0] = p.fx.foam; f2[1] = p.fx.vignette; f2[2] = p.fx.plankton; f2[3] = p.fx.shafts;
  }

  destroy(): void {
    this.mesh.destroy(true);
    this.geometry.destroy(true);
    this.shader.destroy(true);
  }
}
