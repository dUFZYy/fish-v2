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

/** vertical strips per fish; more = smoother bend. 8 is visually identical to continuous. */
const SEGMENTS = 8;
/** how many instances the buffers are sized for */
const CAPACITY = 128;
/** floats per instance in the dynamic buffer (17 used, padded to 20 for 16-byte alignment) */
const STRIDE = 20;

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

  // Tail weight: 0 at the head, 1 at the tail tip, eased. The head of a fish
  // barely moves while the tail sweeps — same shape as the old procedural
  // path deformation in fish.js.
  float tailT  = 0.5 - aLocal.x * flip;        // 0 at head side, 1 at tail side
  float weight = tailT * tailT * (3.0 - 2.0 * tailT);

  // Travelling wave along the body, not a rigid swing.
  float bend = sin(phase - tailT * 2.2) * wobble * weight;

  vec2 local = vec2(aLocal.x * aXYWH.z * flip, (aLocal.y + bend) * aXYWH.w);

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
    // --- shared quad, subdivided along x ---
    const cols = SEGMENTS + 1;
    const local = new Float32Array(cols * 2 * 2);
    for (let i = 0; i < cols; i++) {
      const u = i / SEGMENTS - 0.5;
      local[i * 4 + 0] = u; local[i * 4 + 1] = -0.5;
      local[i * 4 + 2] = u; local[i * 4 + 3] = 0.5;
    }
    const indices = new Uint16Array(SEGMENTS * 6);
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.set([a, b, c, b, d, c], i * 6);
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
