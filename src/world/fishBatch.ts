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
const CAPACITY = 128;
/** floats per instance in the dynamic buffer (18 used, padded to 20 for 16-byte alignment) */
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

uniform vec2 uScreen;  // logical size
uniform vec2 uAtlas;   // atlas texture size in pixels

out vec2 vUV;
out vec4 vVeil;
out float vAlpha;

void main() {
  float flip   = aMotion.x;
  float rot    = aMotion.y;
  float phase  = aMotion.z;
  float wobble = aMotion.w;

  vec2 local;
  if (aBend < 0.5) {
    // SWIM: a travelling wave down the body, weighted toward the tail. The
    // head of a fish barely moves while the tail sweeps — the same shape as
    // the old procedural path deformation in fish.js, but per-vertex.
    float tailT  = 0.5 - aLocal.x * flip;      // 0 at the head, 1 at the tail
    float weight = tailT * tailT * (3.0 - 2.0 * tailT);
    float bend   = sin(phase - tailT * 2.2) * wobble * weight;
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

  float c = cos(rot), s = sin(rot);
  vec2 world = aXYWH.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);

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
      },
    });

    this.shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        uAtlasTex: atlas,
        fishUniforms: {
          uScreen: { value: new Float32Array([screenW, screenH]), type: 'vec2<f32>' },
          uAtlas: { value: new Float32Array([atlas.width, atlas.height]), type: 'vec2<f32>' },
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
