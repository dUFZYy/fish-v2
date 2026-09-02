/**
 * FishBatch — every fish, creature and floating prop in ONE draw call.
 *
 * This class exists because of the single most expensive line in the old
 * game. There, the depth veil over each fish was produced by copying the
 * cached fish image into a helper canvas, filling it with `source-in`, and
 * copying it back: five steps, per fish, per frame, eight times over. On a
 * tile-based mobile GPU that cost 11 of the 16.7 ms frame budget, because a
 * canvas written and read in the same frame forces the driver to finish all
 * queued work.
 *
 * Here the same look costs nothing measurable:
 *  - the fish body is baked once into an atlas (see bake/atlas.ts)
 *  - the depth veil is a per-instance tint attribute
 *  - the tail wobble is computed in the vertex shader, so it stays exactly
 *    as smooth and procedural as the old per-frame path deformation instead
 *    of being quantised into sprite frames
 *  - all instances share one geometry, one shader, one texture: one draw call
 *
 * Coordinates are logical CSS px with (0,0) top-left, matching the old game.
 */

import { Buffer, BufferUsage, Geometry, Mesh, Rectangle, Shader, type TextureSource } from 'pixi.js';

/**
 * Grid resolution of the shared quad.
 *
 * COLS drives the fish tail wave (weighted along x); ROWS drives the
 * anchored plant sway (weighted along y). With one row a swaying plant can
 * only shear; four rows give it an actual bend, and 45 vertices per instance
 * is nothing.
 */
const COLS = 8;
const ROWS = 4;
/** how many instances the buffers are sized for */
const CAPACITY = 640;   // body + tail + fin per creature, plus props
/** floats per instance in the dynamic buffer (20 used exactly) */
const STRIDE = 20;

/**
 * How a thing moves.
 *
 * The old game had one motion for everything in the water, which is why an
 * old boot swam off with a tail wave. These are three different physical
 * situations and they get three different deformations:
 *
 *   Swim   a travelling wave down the body, strongest at the tail. Fish,
 *          creatures, anything alive that moves head-first.
 *   Anchor rooted at the bottom, the tip sways sideways. Seaweed, plants.
 *   Rigid  no deformation at all. A boot, a bottle, a chest. They drift and
 *          turn as whole objects; the game rotates and bobs them, the shader
 *          leaves their shape alone.
 */
export const enum Bend { Swim = 0, Anchor = 1, Rigid = 2 }

export interface FishInstance {
  /** centre in logical px */
  x: number;
  y: number;
  /** on-screen size in logical px */
  w: number;
  h: number;
  /** 1 = facing right, -1 = facing left */
  flip: number;
  /** rotation in radians (diving, dying, boss tilt) */
  rot: number;
  /** tail phase in radians — advance with swim speed */
  phase: number;
  /** wobble amplitude as a fraction of height (0.06–0.18 looks natural) */
  wobble: number;
  /** veil colour (depth fog / night tint), premultiplied by veil */
  veilR: number;
  veilG: number;
  veilB: number;
  /** 0 = fish unchanged, 1 = fully the water colour in front of it */
  veil: number;
  /** overall alpha */
  alpha: number;
  /** how the shape deforms — see Bend */
  bend: Bend;
  /**
   * Rotation pivot in local units, -0.5..0.5 across the sprite.
   *
   * (0,0) rotates about the centre, which is what a whole fish wants. A fin
   * wants to rotate about its ROOT, so it is pushed as its own instance with
   * the pivot at the edge where it joins the body. That is what lets the
   * caudal fin sweep and the pectoral fin scull independently, instead of
   * the whole fish bending — which is what the first version did, and it
   * looked like the fish was wobbling rather than swimming.
   */
  pivotX: number;
  pivotY: number;
  /** atlas frame in pixels */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
}

const vertex = /* glsl */ `#version 300 es
precision highp float;

// per-vertex (shared quad, subdivided along x)
in vec2 aLocal;        // -0.5..0.5 in both axes

// per-instance
in vec4 aXYWH;         // centre x, centre y, width, height (logical px)
in vec4 aMotion;       // flip, rot, phase, wobble
in vec4 aVeil;         // veil rgb (0..1) and veil amount
in vec4 aFrame;        // atlas frame x, y, w, h in texture pixels
in float aAlpha;
in float aBend;        // 0 = swim, 1 = anchored sway, 2 = rigid
in vec2 aPivot;        // rotation pivot in local units (-0.5..0.5)

uniform vec2 uScreen;  // logical size
uniform vec2 uAtlas;   // atlas texture size in pixels
// The water, so a fish is distorted BY the surface rather than wobbling on
// its own. Same numbers the water pass uses, so the two agree.
uniform float uTime;
uniform float uHorizon;
uniform vec4  uWaveA;    // amplitude, 1/length, speed, unused
uniform vec4  uWaveB;
uniform float uRefract;  // 0 = off

out vec2 vUV;
out vec4 vVeil;
out float vAlpha;

float waveY(float x) {
  return uHorizon + sin(x * uWaveA.y + uTime * uWaveA.z) * uWaveA.x
                  + sin(x * uWaveB.y + uTime * uWaveB.z) * uWaveB.x;
}

void main() {
  float flip   = aMotion.x;
  float rot    = aMotion.y;
  float phase  = aMotion.z;
  float wobble = aMotion.w;

  vec2 local;
  if (aBend < 0.5) {
    // SWIM: only the TAIL sweeps.
    //
    // The first version weighted the bend with a smoothstep that still moved
    // the middle of the body, and with the ambient bob on top the whole fish
    // read as bobbing up and down — Dustin's exact complaint, and he was
    // right. In the old game the tail FIN moved and the rest of the fish was
    // displaced by the water, not by itself.
    //
    // So the weight is now zero over the front two thirds and rises steeply
    // only across the rear third, which is where a caudal fin actually is.
    float tailT  = 0.5 - aLocal.x * flip;      // 0 at the head, 1 at the tail
    float weight = smoothstep(0.62, 1.0, tailT);
    weight *= weight;
    float bend   = sin(phase - tailT * 1.6) * wobble * weight;
    local = vec2(aLocal.x * aXYWH.z * flip, (aLocal.y + bend) * aXYWH.w);
  } else if (aBend < 1.5) {
    // ANCHOR: rooted at the bottom edge, the tip sways sideways. Weighted by
    // height squared so the base does not move at all and the bend reads as
    // a plant in a current rather than a rocking signpost.
    float up     = clamp(0.5 - aLocal.y, 0.0, 1.0);
    float weight = up * up;
    float sway   = sin(phase - up * 1.2) * wobble * weight;
    local = vec2((aLocal.x + sway) * aXYWH.z * flip, aLocal.y * aXYWH.w);
  } else {
    // RIGID: a boot is a boot. It drifts and turns as a whole object.
    local = vec2(aLocal.x * aXYWH.z * flip, aLocal.y * aXYWH.w);
  }

  // Rotate about the pivot rather than the centre, so a fin swings from its
  // root. The pivot is in local units, so it flips with the sprite.
  vec2 piv = vec2(aPivot.x * aXYWH.z * flip, aPivot.y * aXYWH.w);
  vec2 rel = local - piv;
  float c = cos(rot), s = sin(rot);
  vec2 world = aXYWH.xy + piv + vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);

  // ---- seen THROUGH water --------------------------------------------------
  // The old game got its liveliness from a full-screen shader that sampled
  // the whole scene at an offset derived from the surface: things just under
  // the water rose and fell with the wave above them, and the effect died off
  // with depth. That is what made it read as looking INTO water.
  //
  // Recreating it by sampling the scene would mean a render target and a
  // second full-screen pass. It does not have to be: the same displacement,
  // applied per vertex to the sprite, gives the same motion — and because the
  // quad is a 8x4 grid it is a real distortion across the body, not a shift.
  // Identical formula and identical wave numbers as the water pass, so the
  // fish and the bands move together.
  if (uRefract > 0.001 && world.y > uHorizon) {
    float d  = clamp((world.y - uHorizon) / max(uScreen.y - uHorizon, 1.0), 0.0, 1.0);
    float wy = waveY(world.x);
    // surface slope: what is under a steep part of the wave is pushed aside
    float slope = (waveY(world.x + 2.0) - waveY(world.x - 2.0)) * 0.25;
    // slow body-of-water sway, growing with depth
    float sway  = sin(world.y * 0.045 - uTime * 1.1 + sin(world.x * 0.012)) * (0.5 + d);
    // and the lift that ties shallow things to the wave crest above them
    float lift  = (uHorizon - wy) * exp(-d * 3.0) * 0.75;
    vec2 off = vec2(slope * 14.0 * exp(-d * 2.1) + sway * 0.9,
                    lift + cos(world.x * 0.02 + uTime * 0.8) * 0.6);
    world -= off * uRefract;
  }

  // logical px -> clip space (y down)
  vec2 clip = vec2(world.x / uScreen.x * 2.0 - 1.0, 1.0 - world.y / uScreen.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);

  vUV = (aFrame.xy + (aLocal + 0.5) * aFrame.zw) / uAtlas;
  vVeil = aVeil;
  vAlpha = aAlpha;
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
in vec4 vVeil;
in float vAlpha;

uniform sampler2D uAtlasTex;

out vec4 fragColor;

void main() {
  vec4 tex = texture(uAtlasTex, vUV);   // premultiplied alpha
  if (tex.a < 0.003) discard;

  vec3 rgb = tex.rgb;

  // The depth veil is water colour IN FRONT of the fish, never transparency.
  // Bug #48 in the old project: fading alpha let you see through the body.
  rgb = mix(rgb, vVeil.rgb * tex.a, vVeil.a);

  fragColor = vec4(rgb, tex.a) * vAlpha;
}
`;

export class FishBatch {
  mesh: Mesh<Geometry, Shader>;
  private instanceData = new Float32Array(CAPACITY * STRIDE);
  private instanceBuffer: Buffer;
  private geometry: Geometry;
  private shader: Shader;
  private count = 0;

  constructor(atlas: TextureSource, screenW: number, screenH: number) {
    // --- shared quad, subdivided in both axes ---
    const nx = COLS + 1;
    const ny = ROWS + 1;
    const local = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (j * nx + i) * 2;
        local[k] = i / COLS - 0.5;
        local[k + 1] = j / ROWS - 0.5;
      }
    }
    const indices = new Uint16Array(COLS * ROWS * 6);
    let w = 0;
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        indices[w++] = a; indices[w++] = b; indices[w++] = c;
        indices[w++] = b; indices[w++] = d; indices[w++] = c;
      }
    }

    this.instanceBuffer = new Buffer({
      data: this.instanceData,
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });

    this.geometry = new Geometry({
      topology: 'triangle-list',
      instanceCount: 0,
      indexBuffer: indices,
      attributes: {
        aLocal: { buffer: new Buffer({ data: local, usage: BufferUsage.VERTEX }), format: 'float32x2' },
        aXYWH:   { buffer: this.instanceBuffer, format: 'float32x4', instance: true, offset: 0,  stride: STRIDE * 4 },
        aMotion: { buffer: this.instanceBuffer, format: 'float32x4', instance: true, offset: 16, stride: STRIDE * 4 },
        aVeil:   { buffer: this.instanceBuffer, format: 'float32x4', instance: true, offset: 32, stride: STRIDE * 4 },
        aFrame:  { buffer: this.instanceBuffer, format: 'float32x4', instance: true, offset: 48, stride: STRIDE * 4 },
        aAlpha:  { buffer: this.instanceBuffer, format: 'float32',   instance: true, offset: 64, stride: STRIDE * 4 },
        aBend:   { buffer: this.instanceBuffer, format: 'float32',   instance: true, offset: 68, stride: STRIDE * 4 },
        aPivot:  { buffer: this.instanceBuffer, format: 'float32x2', instance: true, offset: 72, stride: STRIDE * 4 },
      },
    });

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uAtlasTex: atlas,
        fishUniforms: {
          uScreen: { value: new Float32Array([screenW, screenH]), type: 'vec2<f32>' },
          uAtlas: { value: new Float32Array([atlas.width, atlas.height]), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uHorizon: { value: screenH * 0.35, type: 'f32' },
          uWaveA: { value: new Float32Array([10, 1 / 25, 2, 0]), type: 'vec4<f32>' },
          uWaveB: { value: new Float32Array([4, 1 / 90, -0.7, 0]), type: 'vec4<f32>' },
          uRefract: { value: 1, type: 'f32' },
        },
      },
    });

    this.mesh = new Mesh<Geometry, Shader>({ geometry: this.geometry, shader: this.shader });
    this.mesh.cullable = false;
    // The vertex shader positions instances itself, so the geometry carries no
    // usable bounds (its only vertex attribute spans -0.5..0.5 in local space).
    // Without an explicit bounds area Pixi treats the mesh as empty and skips it.
    this.mesh.boundsArea = new Rectangle(0, 0, screenW, screenH);
  }

  resize(w: number, h: number): void {
    const u = this.shader.resources.fishUniforms.uniforms as { uScreen: Float32Array };
    u.uScreen[0] = w;
    u.uScreen[1] = h;
    this.mesh.boundsArea = new Rectangle(0, 0, w, h);
  }

  /**
   * Feeds the water state, so the shoal is distorted by the same surface the
   * water pass draws. Must be called every frame with the same wave numbers.
   */
  setWater(
    time: number,
    horizon: number,
    waveA: readonly [number, number, number],
    waveB: readonly [number, number, number],
    refract = 1,
  ): void {
    const u = this.shader.resources.fishUniforms.uniforms as Record<string, number | Float32Array>;
    u.uTime = time;
    u.uHorizon = horizon;
    u.uRefract = refract;
    const a = u.uWaveA as Float32Array;
    a[0] = waveA[0]; a[1] = waveA[1]; a[2] = waveA[2];
    const b = u.uWaveB as Float32Array;
    b[0] = waveB[0]; b[1] = waveB[1]; b[2] = waveB[2];
  }

  setAtlas(atlas: TextureSource): void {
    this.shader.resources.uAtlasTex = atlas;
    const u = this.shader.resources.fishUniforms.uniforms as { uAtlas: Float32Array };
    u.uAtlas[0] = atlas.width;
    u.uAtlas[1] = atlas.height;
  }

  /** call once per frame before pushing instances */
  begin(): void { this.count = 0; }

  push(f: FishInstance): void {
    if (this.count >= CAPACITY) return;
    const o = this.count * STRIDE;
    const d = this.instanceData;
    d[o + 0] = f.x;  d[o + 1] = f.y;  d[o + 2] = f.w;  d[o + 3] = f.h;
    d[o + 4] = f.flip; d[o + 5] = f.rot; d[o + 6] = f.phase; d[o + 7] = f.wobble;
    d[o + 8] = f.veilR; d[o + 9] = f.veilG; d[o + 10] = f.veilB; d[o + 11] = f.veil;
    d[o + 12] = f.fx; d[o + 13] = f.fy; d[o + 14] = f.fw; d[o + 15] = f.fh;
    d[o + 16] = f.alpha;
    d[o + 17] = f.bend;
    d[o + 18] = f.pivotX;
    d[o + 19] = f.pivotY;
    this.count++;
  }

  /** upload and make the mesh render `count` instances */
  end(): void {
    this.geometry.instanceCount = this.count;
    this.instanceBuffer.update(this.count * STRIDE * 4);
  }

  get instanceCount(): number { return this.count; }

  destroy(): void {
    this.mesh.destroy(true);
    this.geometry.destroy(true);
    this.shader.destroy(true);
  }
}
