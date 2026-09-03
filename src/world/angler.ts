/**
 * Angler — the assembled figure standing on the dock: torso+legs, head, hat,
 * a rod-holding arm and a bent rod, all joined at the attachment points
 * `bake/anglerArt.ts` exports, plus the line/bobber/hook.
 *
 * Bake-once vs live, per CLAUDE.md rule 1 and the anglerArt.ts file header:
 *  - body, head, arm, hat, rod-shaft, bobber, hook textures are BAKED (one
 *    atlas entry per distinct light step / mood / look — the atlas itself
 *    dedups by key, so calling the bake helpers every frame costs one Map
 *    lookup on a hit, never a redraw).
 *  - the idle "breathe", the arm swing and the rod's bend are LIVE transforms
 *    computed every frame and applied to sprites/a mesh — never baked with a
 *    position in them.
 *  - the rod is one `MeshSimple` strip sampling the straight rod bake by
 *    length (`rodBendCurve`'s `t`), so a bent rod costs one mesh, not a stack
 *    of sprites.
 *  - the line is a `Graphics` polyline rebuilt every frame from
 *    `lineSagCurve` (a handful of points — cheap, and the whole point is that
 *    it changes continuously, so baking it would be exactly the mistake
 *    CLAUDE.md rule 1 describes).
 *
 * Layer placement, per world/scene.ts's layer order:
 *   scene.reflectionLayer   mirrored body/head/hat/arm/rod, BELOW the water
 *                           pass (so the reflection gets veiled/blended)
 *   scene.tackleLayer       hook + line + bobber, BELOW the water pass
 *   scene.anglerLayer       body, head, hat, arm, rod — ABOVE the water pass
 */

import { Container, Graphics, MeshSimple, Sprite, type Texture } from 'pixi.js';
import { baker, Baker } from '@/bake/baker';
import {
  drawAnglerBody, drawAnglerHead, drawArm, drawHat, drawRod, drawBobber, drawHook,
  anglerBodyAttach, armAttach, anglerHeadAttach, hatAttach,
  rodBendCurve, lineSagCurve, updateLineBow,
  type AnglerMood, type Pt,
} from '@/bake/anglerArt';
import { OUTFITS, RODSKINS, BOBBERS } from '@/data/items';
import type { OutfitItem, RodSkinItem, BobberItem } from '@/data/items';
import { layout } from '@/engine/layout';
import { DOCK_W_FRAC } from '@/game/lake';
import type { Scene } from './scene';

export type AnglerPose = 'idle' | 'aiming' | 'casting' | 'waiting' | 'biting' | 'reeling' | 'caught' | 'lost';

export interface AnglerLook { outfit: string; hat: string; rodSkin: string; bobber: string }

export interface AnglerState {
  pose: AnglerPose;
  light: number;
  /** rod tip aim, 0..1 across the screen, for aiming and casting */
  aimX: number; aimY: number;
  /** where the bobber currently is in logical px; null when the line is in */
  bobberX: number | null; bobberY: number | null;
  /** 0..1 line tension, bends the rod */
  tension: number;
  /** true while the player is holding during the drill */
  holding: boolean;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function find<T extends { id: string }>(list: readonly T[], id: string): T {
  return list.find((x) => x.id === id) ?? list[0]!;
}

// ---------------------------------------------------------------------------
// Bake box sizes, in the "formula space" each *Fit()/draw*() in anglerArt.ts
// uses internally (fractions of its own w/h). Head and arm fit their own box
// exactly; body and hat do not — the body's legs run to about 1.31x its own
// h (draw.js's leg()/boot geometry, ported verbatim), and several tall hats
// (zylinder, muetze, krone...) draw a few percent above y=0. The PHYSICAL
// bake box below pads for that overflow so nothing is clipped; the DRAW
// callback still gets handed the smaller "formula" height/width so the
// piece's own internal proportions (bodyFit's `s = h/4.3` etc.) are
// unaffected by the padding.
// ---------------------------------------------------------------------------

const BODY_S = 130;                                  // drawAnglerBody's own h
const BODY_W = Math.round(BODY_S * (170 / 260));       // same box aspect as dev/artSheet.ts's reference bake
const BODY_PAD_BOTTOM = Math.round(BODY_S * 0.36);     // legs run to ~1.31*h — see above
const BODY_H_PHYS = BODY_S + BODY_PAD_BOTTOM;

const HEAD_S = 63;                                    // chosen so hr(=HEAD_S/3.6) meets anglerBodyAttach's headRadius
const HEAD_W = Math.round(HEAD_S * (140 / 180));

const ARM_S = 66;
const ARM_W = Math.round(ARM_S * (130 / 210));

const HAT_S = 60;                                     // chosen so hatFit's hr(=HAT_S/3.4) meets the head's own hr
const HAT_W = Math.round(HAT_S * (120 / 160));
const HAT_PAD_TOP = Math.round(HAT_S * 0.4);           // tall crowns draw a little above y=0
const HAT_H_PHYS = HAT_S + HAT_PAD_TOP;

const ROD_TEX_W = 150;
const ROD_TEX_H = 34;
const ROD_WORLD_S = 60;         // rodBendCurve's own "s" — world-px shaft thickness at the grip
const ROD_WORLD_LEN = 130;      // on-screen rod length, grip to its (unbent) rest tip
const ROD_SEGMENTS = 10;

/**
 * How tall the whole figure should stand, as a fraction of screen height.
 *
 * All the piece sizes above are absolute bake pixels, chosen for detail. On
 * a wide dev page that happened to look right; on a 390x844 phone it made
 * the angler 25 % of the screen tall — the old game's angler is about 16 %,
 * a small figure sitting on a jetty rather than a giant looming over it.
 *
 * So the bakes keep their generous sizes (they are drawn at device density
 * and stay sharp) and everything is PLACED through one factor derived from
 * the screen. Measured: the assembled figure is 209 logical px tall at
 * scale 1.
 */
const FIGURE_H_FRAC = 0.16;
const FIGURE_H_AT_SCALE_1 = 209;

function figureScale(): number {
  return (layout.H * FIGURE_H_FRAC) / FIGURE_H_AT_SCALE_1;
}

/** drawRod's own constants (draw.js:595-693 port), mirrored here so the live
 * bend mesh samples the SAME texture fractions the straight bake drew into:
 * `gripLen = w*0.12` (rodAttach) and the shaft taper `w0=h*0.4 .. w1=h*0.125`. */
const ROD_GRIP_U = 0.12;
const ROD_W0_V = 0.4, ROD_W1_V = 0.125;

const BOBBER_PX = 30;
const HOOK_W = 20, HOOK_H = 24;
/** how far below the bobber the hook hangs, logical px */
const HOOK_DROP = 16;

function moodFor(pose: AnglerPose): AnglerMood {
  switch (pose) {
    case 'biting': return 'surprised';
    case 'reeling': return 'focused';
    case 'caught': return 'grin';
    case 'lost': return 'pout';
    default: return 'focused'; // idle/aiming/casting/waiting — "neutral" per spec, folded into focused
  }
}

const DEFAULT_STATE: AnglerState = {
  pose: 'idle', light: 1, aimX: 0.74, aimY: 0.42,
  bobberX: null, bobberY: null, tension: 0, holding: false,
};

export class Angler {
  private scene: Scene;
  private outfit: OutfitItem;
  private rodSkin: RodSkinItem;
  private bobberSkin: BobberItem;
  private hatId: string;

  // --- main figure ---
  private figure = new Container();
  private bodySprite = new Sprite();
  private headSprite = new Sprite();
  private hatSprite = new Sprite();
  private armWrap = new Container();
  private armSprite = new Sprite();
  private rodMesh: MeshSimple;
  private rodVerts: Float32Array;

  // --- tackle (below the water pass) ---
  private lineGfx = new Graphics();
  private bobberSprite = new Sprite();
  private hookSprite = new Sprite();

  // --- reflection twins (below the water pass, mirrored + faded) ---
  private reflection = new Container();
  private rBody = new Sprite();
  private rHead = new Sprite();
  private rHat = new Sprite();
  private rArmWrap = new Container();
  private rArmSprite = new Sprite();
  private rRodMesh: MeshSimple;
  private rRodVerts: Float32Array;

  // static attach points, in each piece's own formula space
  private bodyAttach = anglerBodyAttach(BODY_W, BODY_S);
  private headAttach = anglerHeadAttach(HEAD_W, HEAD_S);
  private armPts = armAttach(ARM_W, ARM_S);
  private hatPts = hatAttach(HAT_W, HAT_S);
  private restArmAngle: number;
  private armHandLen: number;

  // static (look-fixed, light-independent) textures, baked once
  private rodTex: Texture;
  private bobberTex: Texture;
  private hookTex: Texture;

  private lineBow = 0;
  private prevBobberX: number | null = null;
  private lastRodTip: Pt = { x: 0, y: 0 };

  constructor(scene: Scene, look: AnglerLook) {
    this.scene = scene;
    this.outfit = find(OUTFITS, look.outfit);
    this.rodSkin = find(RODSKINS, look.rodSkin);
    this.bobberSkin = find(BOBBERS, look.bobber);
    this.hatId = look.hat;

    this.restArmAngle = Math.atan2(
      this.armPts.hand.y - this.armPts.shoulder.y,
      this.armPts.hand.x - this.armPts.shoulder.x,
    );
    this.armHandLen = Math.hypot(
      this.armPts.hand.x - this.armPts.shoulder.x,
      this.armPts.hand.y - this.armPts.shoulder.y,
    );

    // one-time, light-independent bakes
    this.rodTex = baker.bakeSprite(
      `angler:rod:${this.rodSkin.id}@${layout.dpr}`, ROD_TEX_W, ROD_TEX_H,
      (ctx) => drawRod(ctx, ROD_TEX_W, ROD_TEX_H, this.rodSkin, 1),
    ).texture;
    this.bobberTex = baker.bakeSprite(
      `angler:bobber:${this.bobberSkin.id}@${layout.dpr}`, BOBBER_PX, BOBBER_PX,
      (ctx) => drawBobber(ctx, BOBBER_PX, BOBBER_PX, this.bobberSkin),
    ).texture;
    this.hookTex = baker.bakeSprite(
      `angler:hook@${layout.dpr}`, HOOK_W, HOOK_H,
      (ctx) => drawHook(ctx, HOOK_W, HOOK_H),
    ).texture;

    // Rod mesh: a triangle-strip ribbon, two vertices (top/bottom edge of the
    // shaft) per rodBendCurve point. UVs only depend on each point's fixed
    // `t = i/segments`, never on the live bend, so they are built once here
    // and never touched again — only `.vertices` changes per frame.
    const n = ROD_SEGMENTS + 1;
    const uvs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = i / ROD_SEGMENTS;
      const u = lerp(ROD_GRIP_U, 1, t);
      const vHalf = lerp(ROD_W0_V, ROD_W1_V, t) / 2;
      uvs[i * 4 + 0] = u; uvs[i * 4 + 1] = 0.5 - vHalf;
      uvs[i * 4 + 2] = u; uvs[i * 4 + 3] = 0.5 + vHalf;
    }
    this.rodVerts = new Float32Array(n * 4);
    this.rRodVerts = new Float32Array(n * 4);

    // The ribbon needs its own index list.
    //
    // MeshSimple with no indices builds MeshGeometry's default quad,
    // [0,1,2, 0,2,3] — six indices, whatever the vertex count. So a
    // 22-vertex rod drew only its FIRST segment and the rod looked like a
    // 20 px stub in the angler's hand while its geometry was correctly 84 px
    // long. Nothing warns about this; the mesh simply renders a fraction of
    // itself.
    //
    // Written as an explicit triangle LIST rather than relying on
    // triangle-strip winding, because a list is unambiguous and this ribbon
    // is rebuilt every frame.
    const indices = new Uint32Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.set([a, b, c, b, d, c], i * 6);
    }

    this.rodMesh = new MeshSimple({ texture: this.rodTex, vertices: this.rodVerts.slice(), uvs, indices, topology: 'triangle-list' });
    this.rRodMesh = new MeshSimple({ texture: this.rodTex, vertices: this.rRodVerts.slice(), uvs, indices: indices.slice(), topology: 'triangle-list' });

    // --- assemble the main figure ---
    this.armWrap.addChild(this.armSprite);
    this.figure.addChild(this.bodySprite, this.armWrap, this.headSprite, this.hatSprite, this.rodMesh);
    scene.anglerLayer.addChild(this.figure);

    // --- tackle: line below bobber/hook so the sprites sit on top of it ---
    this.bobberSprite.anchor.set(0.5);
    this.bobberSprite.texture = this.bobberTex;
    this.bobberSprite.setSize(BOBBER_PX, BOBBER_PX);
    this.hookSprite.anchor.set(0.5, 0);
    this.hookSprite.texture = this.hookTex;
    this.hookSprite.setSize(HOOK_W, HOOK_H);
    scene.tackleLayer.addChild(this.lineGfx, this.bobberSprite, this.hookSprite);

    // --- reflection twin, mirrored + faded, below the water pass ---
    this.rArmWrap.addChild(this.rArmSprite);
    this.reflection.addChild(this.rBody, this.rArmWrap, this.rHead, this.rHat, this.rRodMesh);
    // A reflection seen at a low angle across water is FLATTER and fainter
    // than the thing it mirrors — a full-height, 35 % copy read as a second
    // angler swimming under the jetty. Compressed to 0.78 and faded to 0.2,
    // it reads as a reflection.
    this.reflection.alpha = 0.2;
    scene.reflectionLayer.addChild(this.reflection);

    this.update(0, 0, DEFAULT_STATE);
  }

  /** rod tip in logical px, so the caller can start the line there */
  get rodTip(): { x: number; y: number } { return { x: this.lastRodTip.x, y: this.lastRodTip.y }; }

  private bakeBody(step: number): Texture {
    const light = Baker.lightOf(step);
    const key = `angler:body:${this.outfit.id}:l${step}@${layout.dpr}`;
    return baker.bakeSprite(key, BODY_W, BODY_H_PHYS, (ctx) => drawAnglerBody(ctx, BODY_W, BODY_S, light, this.outfit)).texture;
  }
  private bakeHead(step: number, mood: AnglerMood): Texture {
    const light = Baker.lightOf(step);
    const key = `angler:head:${mood}:${this.outfit.skin}:l${step}@${layout.dpr}`;
    return baker.bakeSprite(key, HEAD_W, HEAD_S, (ctx) => drawAnglerHead(ctx, HEAD_W, HEAD_S, light, mood, this.outfit.skin)).texture;
  }
  private bakeArm(step: number): Texture {
    const light = Baker.lightOf(step);
    const key = `angler:arm:${this.outfit.id}:l${step}@${layout.dpr}`;
    return baker.bakeSprite(key, ARM_W, ARM_S, (ctx) => drawArm(ctx, ARM_W, ARM_S, light, this.outfit)).texture;
  }
  private bakeHat(step: number): Texture {
    const light = Baker.lightOf(step);
    const key = `angler:hat:${this.hatId}:l${step}@${layout.dpr}`;
    return baker.bakeSprite(key, HAT_W, HAT_H_PHYS, (ctx) => {
      ctx.translate(0, HAT_PAD_TOP);
      drawHat(ctx, HAT_W, HAT_S, this.hatId, light);
    }).texture;
  }

  /** live aim direction (screen radians, 0 = pointing right) for the arm/rod, from the shoulder */
  private aimAngleFor(s: AnglerState, t: number, shoulder: Pt): number {
    switch (s.pose) {
      case 'idle':
        return -0.42 + Math.sin(t * 1.1) * 0.04;
      case 'aiming':
      case 'casting': {
        const tx = s.aimX * layout.W, ty = s.aimY * layout.H;
        let a = Math.atan2(ty - shoulder.y, tx - shoulder.x);
        if (s.pose === 'casting') a += Math.sin(t * 14) * 0.05 * (1 - clamp(s.tension, 0, 1));
        return a;
      }
      case 'waiting':
      case 'biting': {
        const bx = s.bobberX ?? shoulder.x + Math.cos(-0.45) * ROD_WORLD_LEN;
        const by = s.bobberY ?? shoulder.y + Math.sin(-0.45) * ROD_WORLD_LEN;
        let a = Math.atan2(by - shoulder.y, bx - shoulder.x);
        if (s.pose === 'biting') a += Math.sin(t * 22) * 0.06;
        return a;
      }
      case 'reeling': {
        const bx = s.bobberX ?? shoulder.x + ROD_WORLD_LEN;
        const by = s.bobberY ?? shoulder.y - 30;
        const base = Math.atan2(by - shoulder.y, bx - shoulder.x);
        const amp = 0.08 * (0.4 + 0.6 * clamp(s.tension, 0, 1)) * (s.holding ? 1.4 : 0.6);
        return base + Math.sin(t * 6) * amp;
      }
      case 'caught':
        return -1.1;
      case 'lost':
        return 0.35;
    }
  }

  update(dt: number, t: number, s: AnglerState): void {
    const step = Baker.lightStep(s.light);
    const mood = moodFor(s.pose);

    // --- bake lookups (cache hit after the first distinct step/mood) ---
    const bodyTex = this.bakeBody(step);
    const headTex = this.bakeHead(step, mood);
    const armTex = this.bakeArm(step);
    const hatTex = this.bakeHat(step);

    // --- dock anchor (CLAUDE.md/lake.ts: dock anchored right, DOCK_W_FRAC
    // wide, deck top 20px above the horizon) ---
    const k = figureScale();
    const dockW = Math.round(layout.W * DOCK_W_FRAC);
    const dockX = layout.W - dockW;
    const deckTopY = this.scene.horizonY - 20;
    // 0.42 rather than 0.32 across the deck: at 0.32 he stood on the very
    // end of the jetty with his boots past its left edge.
    const baseX = dockX + dockW * 0.42;

    // --- idle breathe: a LIVE translate on the torso+head, never baked ---
    const breathe = Math.sin(t * 1.6) * BODY_S * k * 0.007;

    this.bodySprite.texture = bodyTex;
    this.bodySprite.setSize(BODY_W * k, BODY_H_PHYS * k);
    this.bodySprite.x = baseX - (BODY_W * k) / 2;
    this.bodySprite.y = deckTopY - BODY_H_PHYS * k + breathe;

    const worldShoulder: Pt = {
      x: this.bodySprite.x + this.bodyAttach.shoulder.x * k,
      y: this.bodySprite.y + this.bodyAttach.shoulder.y * k,
    };
    const worldHeadCenter: Pt = {
      x: this.bodySprite.x + this.bodyAttach.headCenter.x * k,
      y: this.bodySprite.y + this.bodyAttach.headCenter.y * k,
    };

    this.headSprite.texture = headTex;
    this.headSprite.setSize(HEAD_W * k, HEAD_S * k);
    this.headSprite.x = worldHeadCenter.x - this.headAttach.center.x * k;
    this.headSprite.y = worldHeadCenter.y - this.headAttach.center.y * k;

    this.hatSprite.texture = hatTex;
    this.hatSprite.setSize(HAT_W * k, HAT_H_PHYS * k);
    this.hatSprite.x = worldHeadCenter.x - this.hatPts.center.x * k;
    this.hatSprite.y = worldHeadCenter.y - (this.hatPts.center.y + HAT_PAD_TOP) * k;

    // --- arm: baked bent-elbow pose, rotated live around the shoulder ---
    const aimAngle = this.aimAngleFor(s, t, worldShoulder);
    const armRot = aimAngle - this.restArmAngle;
    this.armSprite.texture = armTex;
    this.armSprite.setSize(ARM_W * k, ARM_S * k);
    this.armWrap.pivot.set(this.armPts.shoulder.x * k, this.armPts.shoulder.y * k);
    this.armWrap.position.set(worldShoulder.x, worldShoulder.y);
    this.armWrap.rotation = armRot;

    // hand/grip in world space — see the header derivation: rotating the
    // baked (shoulder->hand) vector by `armRot` always lands it at `aimAngle`.
    const handWorld: Pt = {
      x: worldShoulder.x + this.armHandLen * k * Math.cos(aimAngle),
      y: worldShoulder.y + this.armHandLen * k * Math.sin(aimAngle),
    };

    // --- rod: bend curve from the hand to a rest tip along the aim, biased
    // toward the bobber; drawn as one MeshSimple strip (never a re-bake) ---
    const restTip: Pt = {
      x: handWorld.x + ROD_WORLD_LEN * k * Math.cos(aimAngle),
      y: handWorld.y + ROD_WORLD_LEN * k * Math.sin(aimAngle),
    };
    const bobberTargetX = s.bobberX ?? restTip.x;
    const bend = clamp(s.tension, 0, 1);
    const points = rodBendCurve({
      gripX: handWorld.x, gripY: handWorld.y,
      rodTipX: restTip.x, rodTipY: restTip.y,
      bobberX: bobberTargetX, bend, s: ROD_WORLD_S * k, segments: ROD_SEGMENTS,
    });
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const half = p.width / 2;
      this.rodVerts[i * 4 + 0] = p.x + p.nx * half;
      this.rodVerts[i * 4 + 1] = p.y + p.ny * half;
      this.rodVerts[i * 4 + 2] = p.x - p.nx * half;
      this.rodVerts[i * 4 + 3] = p.y - p.ny * half;
    }
    this.rodMesh.vertices = this.rodVerts;
    this.lastRodTip = { x: points[points.length - 1]!.x, y: points[points.length - 1]!.y };

    // --- line, bobber, hook — live every frame, never baked ---
    const bobberX = s.bobberX;
    const bobberY = s.bobberY;
    const prevX = this.prevBobberX ?? bobberX ?? this.lastRodTip.x;
    this.lineBow = updateLineBow(this.lineBow, bobberX ?? prevX, prevX, dt);
    this.prevBobberX = bobberX;

    this.lineGfx.clear();
    if (bobberX !== null && bobberY !== null) {
      const floating = s.pose === 'waiting' || s.pose === 'biting';
      const by = floating ? this.scene.waveAt(bobberX, 0) : bobberY;

      const linePts = lineSagCurve({
        tipX: this.lastRodTip.x, tipY: this.lastRodTip.y,
        bobberX, bobberY: by,
        reeling: s.pose === 'reeling', casting: s.pose === 'casting',
        lineBow: this.lineBow, time: t,
      });
      this.lineGfx.moveTo(linePts[0]!.x, linePts[0]!.y);
      for (let i = 1; i < linePts.length; i++) this.lineGfx.lineTo(linePts[i]!.x, linePts[i]!.y);
      this.lineGfx.stroke({ width: 1.2, color: 0xffffff, alpha: 0.65 });

      this.bobberSprite.visible = true;
      this.bobberSprite.x = bobberX;
      this.bobberSprite.y = by;

      this.hookSprite.visible = s.pose !== 'reeling';
      this.hookSprite.x = bobberX;
      this.hookSprite.y = by + HOOK_DROP;
    } else {
      this.bobberSprite.visible = false;
      this.hookSprite.visible = false;
    }

    // --- reflection: mirrored copies, alpha 0.35, slow horizontal wobble ---
    this.rBody.texture = bodyTex;
    this.rBody.setSize(BODY_W * k, BODY_H_PHYS * k);
    this.rBody.x = this.bodySprite.x;
    this.rBody.y = this.bodySprite.y;

    this.rHead.texture = headTex;
    this.rHead.setSize(HEAD_W * k, HEAD_S * k);
    this.rHead.x = this.headSprite.x;
    this.rHead.y = this.headSprite.y;

    this.rHat.texture = hatTex;
    this.rHat.setSize(HAT_W * k, HAT_H_PHYS * k);
    this.rHat.x = this.hatSprite.x;
    this.rHat.y = this.hatSprite.y;

    this.rArmSprite.texture = armTex;
    this.rArmSprite.setSize(ARM_W, ARM_S);
    this.rArmWrap.pivot.copyFrom(this.armWrap.pivot);
    this.rArmWrap.position.copyFrom(this.armWrap.position);
    this.rArmWrap.rotation = this.armWrap.rotation;

    this.rRodVerts.set(this.rodVerts);
    this.rRodMesh.vertices = this.rRodVerts;

    const squash = 0.78;
    this.reflection.x = Math.sin(t * 0.6) * 4;
    // Mirror about the water line, then compress toward it: with a scale of
    // -squash the pivot has to move by the same factor or the reflection
    // drifts away from the figure's feet.
    this.reflection.y = this.scene.horizonY * (1 + squash);
    this.reflection.scale.y = -squash;
  }

  destroy(): void {
    this.figure.destroy({ children: true });
    this.reflection.destroy({ children: true });
    this.lineGfx.destroy();
    this.bobberSprite.destroy();
    this.hookSprite.destroy();
  }
}
