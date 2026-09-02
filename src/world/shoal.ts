/**
 * Shoal — the live population of a fishing spot.
 *
 * Owns spawning, swimming and despawning, bakes each species' sprite the
 * first time it is needed, and pushes one instance per creature into the
 * fish batch. Everything here is per-frame work on plain numbers; the only
 * GPU contact is `scene.pushFish`.
 *
 * Two things this does that the old game could not:
 *
 *  - A creature's motion comes from `world/motion.ts`, so a boot does not
 *    swim, a chest does not wag, and a drifting tangle tumbles.
 *  - The depth veil is a per-instance attribute, so the fog over a fish
 *    costs nothing. In the old game it was a helper canvas per fish per
 *    frame and it was half the frame budget.
 */

import { Baker, baker, prnd } from '@/bake/baker';
import {
  drawSpecies, drawTailFin, drawPecFin, fishAspect, hasSplitFins,
  pecFinPart, tailPart, type PartSpec,
} from '@/bake/fishArt';
import { layout } from '@/engine/layout';
import { SPECIES_BY_ID, speciesForLocation, type Species } from '@/data/species';
import { motionFor, type MotionProfile } from './motion';
import { Bend, type FishInstance } from './fishBatch';
import type { Scene } from './scene';

/** on-screen length in logical px for a species of `len` 1 at scale 1 */
const BASE_LEN = 46;

/** seconds a fish takes to come about */
const TURN_TIME = 0.42;

export interface Fish {
  sp: Species;
  motion: MotionProfile;
  /** logical px */
  x: number;
  y: number;
  /** the depth band centre this fish keeps to, 0..1 */
  band: number;
  /** on-screen size */
  w: number;
  h: number;
  /** 1 right, -1 left */
  dir: number;
  /** px/s along x */
  speed: number;
  /** deformation phase */
  phase: number;
  /** private phase offsets so a shoal does not move in lockstep */
  bobPhase: number;
  rollPhase: number;
  /** shiny fish are 1 in 80 and worth five times as much */
  shiny: boolean;
  /** 0 = normal, >0 = fading out */
  fade: number;
  /** far background fish are silhouettes and not interactive (2.5D) */
  distant: boolean;
  /**
   * Turn animation, 0 = not turning, otherwise 0..1 through the turn.
   *
   * The old game squashed a fish horizontally as it came about — the sprite
   * narrows to almost nothing at the halfway point and opens out facing the
   * other way. It reads as the fish rotating through the third dimension,
   * and it is the single cheapest thing that makes a 2D shoal feel like it
   * is in water rather than on a conveyor belt. The port had dropped it.
   */
  turn: number;
  /** which way it will face once the turn completes */
  turnTo: number;
  /** seconds until this fish considers changing its mind */
  nextDecision: number;
  /** atlas frame */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  /** reusable instance record, so the loop allocates nothing */
  inst: FishInstance;
  /**
   * The two limbs the old game animated every frame, baked separately and
   * swung about their own roots. Null for creatures, junk and anything that
   * does not use the generic fish rig.
   */
  limbs: {
    tail: LimbInstance;
    fin: LimbInstance;
  } | null;
}

interface LimbInstance {
  spec: PartSpec;
  inst: FishInstance;
  /** own phase offset, so the fin is not locked to the tail */
  phase: number;
  /** unsquashed width, so a turn can scale it without drift */
  baseW: number;
}

export interface ShoalOptions {
  /** how many interactive fish to keep in the water */
  count?: number;
  /** how many far silhouettes behind them */
  distantCount?: number;
  rng?: () => number;
}

export class Shoal {
  fish: Fish[] = [];
  private rng: () => number;
  private count: number;
  private distantCount: number;
  private locationId = 'see';
  private night = false;

  constructor(private scene: Scene, opts: ShoalOptions = {}) {
    this.count = opts.count ?? 9;
    this.distantCount = opts.distantCount ?? 5;
    this.rng = opts.rng ?? Math.random;
  }

  /**
   * Bakes a species at a quantised size and returns its atlas frame.
   *
   * The size ladder is what keeps the cache a cache: on-screen sizes are
   * continuous, and a key with the exact pixel size in it would re-bake
   * every frame — that is precisely how the old project's sprite cache ended
   * up slower than no cache at all. Between ladder steps the GPU scales,
   * which is free and, with mipmaps, clean.
   */
  private frameFor(sp: Species, wantW: number, shiny: boolean, lightStep: number): {
    fx: number; fy: number; fw: number; fh: number; w: number; h: number;
  } {
    const w = Baker.sizeStep(wantW);
    const h = Math.max(4, Math.round(w * fishAspect(sp)));
    const split = hasSplitFins(sp);
    const key = `sp:${sp.id}:${w}:${shiny ? 's' : 'n'}:l${lightStep}${split ? ':nf' : ''}@${layout.dpr}`;
    const e = baker.bakeSprite(key, w, h, (ctx, cw, ch) => {
      drawSpecies(ctx, cw, ch, sp, {
        shiny,
        light: Baker.lightOf(lightStep),
        omitAnimatedFins: split,
      });
    });
    const f = e.texture.frame;
    return { fx: f.x, fy: f.y, fw: f.width, fh: f.height, w, h };
  }

  /** bakes one detachable limb at the size implied by the body sprite */
  private limbFor(
    sp: Species,
    bodyW: number,
    spec: PartSpec,
    kind: 'tail' | 'fin',
    shiny: boolean,
    lightStep: number,
    phase: number,
  ): LimbInstance {
    const w = Math.max(3, Math.round(bodyW * spec.wFrac));
    const h = Math.max(3, Math.round(bodyW * spec.hFrac));
    const key = `${kind}:${sp.id}:${w}x${h}:${shiny ? 's' : 'n'}:l${lightStep}@${layout.dpr}`;
    const e = baker.bakeSprite(key, w, h, (ctx, cw, ch) => {
      const opts = { shiny, light: Baker.lightOf(lightStep) };
      if (kind === 'tail') drawTailFin(ctx, cw, ch, sp, opts);
      else drawPecFin(ctx, cw, ch, sp, opts);
    });
    const f = e.texture.frame;
    return {
      spec,
      phase,
      baseW: w,
      inst: {
        x: 0, y: 0, w, h,
        flip: 1, rot: 0, phase: 0, wobble: 0,
        veilR: 0, veilG: 0, veilB: 0, veil: 0,
        alpha: 1, bend: Bend.Rigid,
        pivotX: spec.pivotX, pivotY: spec.pivotY,
        fx: f.x, fy: f.y, fw: f.width, fh: f.height,
      },
    };
  }

  setLocation(id: string, night: boolean): void {
    this.locationId = id;
    this.night = night;
    this.fish.length = 0;
  }

  /** refills the water up to the configured counts */
  private topUp(lightStep: number): void {
    const pool = speciesForLocation(this.locationId, this.night);
    if (!pool.length) return;

    const interactive = this.fish.filter((f) => !f.distant).length;
    const distant = this.fish.length - interactive;

    for (let i = interactive; i < this.count; i++) this.spawn(pool, false, lightStep);
    for (let i = distant; i < this.distantCount; i++) this.spawn(pool, true, lightStep);
  }

  private spawn(pool: Species[], distant: boolean, lightStep: number): void {
    const sp = pool[Math.floor(this.rng() * pool.length)];
    const shiny = !distant && this.rng() < 1 / 80;
    const seed = this.fish.length + this.rng() * 1000;

    // Distant fish read as far away: smaller, slower, deeply veiled. That is
    // the 2.5D layer of the old game, and it costs nothing extra here
    // because it is the same batch.
    const sizeMul = distant ? 0.45 : 1;
    const wantW = BASE_LEN * sp.len * sizeMul * (0.85 + this.rng() * 0.3);
    const fr = this.frameFor(sp, wantW, shiny, lightStep);

    const band = sp.depth[0] + this.rng() * Math.max(0.02, sp.depth[1] - sp.depth[0]);
    const dir = this.rng() < 0.5 ? -1 : 1;
    const motion = motionFor(sp.id, sp.bodyType);
    const hy = this.scene.horizonY;
    const bottom = layout.H;
    const y = hy + band * (bottom - hy);

    const f: Fish = {
      sp, motion,
      x: dir > 0 ? -fr.w : layout.W + fr.w,
      y, band,
      w: fr.w, h: fr.h,
      dir,
      speed: (14 + sp.speed * 22) * sizeMul * motion.driftX * (motion.bend === Bend.Swim ? 1 : 1),
      phase: this.rng() * Math.PI * 2,
      bobPhase: prnd(seed, 3) * Math.PI * 2,
      rollPhase: prnd(seed, 7) * Math.PI * 2,
      shiny,
      fade: 0,
      distant,
      turn: 0,
      turnTo: dir,
      nextDecision: 2 + this.rng() * 6,
      fx: fr.fx, fy: fr.fy, fw: fr.fw, fh: fr.fh,
      inst: {
        x: 0, y: 0, w: fr.w, h: fr.h,
        flip: dir, rot: 0, phase: 0, wobble: motion.wobble,
        veilR: 0, veilG: 0, veilB: 0, veil: 0,
        alpha: 1, bend: motion.bend,
        pivotX: 0, pivotY: 0,
        fx: fr.fx, fy: fr.fy, fw: fr.fw, fh: fr.fh,
      },
      limbs: null,
    };

    // Distant silhouettes get no limbs: at 45 % size behind a heavy veil the
    // extra two quads per fish would be invisible, and there can be forty of
    // them.
    if (hasSplitFins(sp) && !distant) {
      f.limbs = {
        tail: this.limbFor(sp, fr.w, tailPart(sp), 'tail', shiny, lightStep, 0),
        // The pectoral fin runs on its own clock — in the old game it was
        // sin(tail*0.9 + 1.2), i.e. slower than the tail and out of step with
        // it. That mismatch is what makes a fish look like it is sculling
        // rather than flapping.
        fin: this.limbFor(sp, fr.w, pecFinPart(sp), 'fin', shiny, lightStep, 1.2),
      };
    }
    this.fish.push(f);
  }

  /**
   * Advances the shoal and submits it.
   *
   * `wBot` is the water's deep colour: the veil in front of a fish is water,
   * not transparency. Fading alpha instead was bug #48 in the old project —
   * you could see through a distant fish's body.
   */
  update(dt: number, t: number, light: number, wBot: [number, number, number]): void {
    const lightStep = Baker.lightStep(light);
    this.topUp(lightStep);

    const hy = this.scene.horizonY;
    const bottom = layout.H;
    const scene = this.scene;

    scene.beginFish();

    // Distant silhouettes first, so they sit behind the interactive shoal in
    // the same batch — one draw call still covers both layers.
    for (const pass of [true, false]) {
      for (const f of this.fish) {
        if (f.distant !== pass) continue;
        const m = f.motion;

        // --- turning ------------------------------------------------------
        // A fish that only ever crosses the screen and wraps around reads as
        // a conveyor belt. So it changes its mind now and then, and the turn
        // itself is animated: the sprite squashes to a sliver and opens out
        // the other way, which is how the old game did it.
        let squash = 1;
        if (f.turn > 0) {
          f.turn += dt / TURN_TIME;
          if (f.turn >= 1) { f.turn = 0; f.dir = f.turnTo; }
          else {
            // halfway through the squash, the fish is edge-on and flips
            if (f.turn >= 0.5 && f.dir !== f.turnTo) f.dir = f.turnTo;
            squash = Math.max(0.06, Math.abs(Math.cos(f.turn * Math.PI)));
          }
        } else if (!f.distant) {
          f.nextDecision -= dt;
          const nearEdge = f.x < 40 || f.x > layout.W - 40;
          if (f.nextDecision <= 0 || nearEdge) {
            f.nextDecision = 3 + this.rng() * 7;
            // near an edge it always turns back; otherwise sometimes
            if (nearEdge || this.rng() < 0.45) {
              f.turn = 0.0001;
              f.turnTo = nearEdge ? (f.x < 40 ? 1 : -1) : -f.dir;
            }
            // and it may pick a new depth inside its species' band
            const d0 = f.sp.depth[0], d1 = f.sp.depth[1];
            f.band = d0 + this.rng() * Math.max(0.02, d1 - d0);
          }
        }

        // A turning fish barely makes headway, which is also true of fish.
        f.x += f.speed * f.dir * dt * (f.turn > 0 ? 0.25 : 1);
        f.y += m.driftY * dt;

        // keep to the depth band, drifting gently back toward it
        const target = hy + f.band * (bottom - hy);
        f.y += (target - f.y) * Math.min(1, dt * 0.6);

        f.phase += dt * m.phaseRate * (0.7 + f.speed * 0.02);

        const inst = f.inst;
        inst.x = f.x;
        inst.y = f.y + Math.sin(t * m.bobRate * 6.28 + f.bobPhase) * m.bobAmp;
        inst.w = f.w * squash;
        inst.h = f.h;
        inst.flip = m.facesTravel ? f.dir : 1;
        inst.rot = m.rollAmp
          ? Math.sin(t * m.rollRate * 6.28 + f.rollPhase) * m.rollAmp
          : 0;
        inst.phase = f.phase;
        inst.wobble = m.wobble;
        inst.bend = m.bend;
        inst.fx = f.fx; inst.fy = f.fy; inst.fw = f.fw; inst.fh = f.fh;

        const veil = scene.veilFor(inst.y, wBot, f.distant ? 0.82 : 0.5);
        inst.veilR = veil.veilR;
        inst.veilG = veil.veilG;
        inst.veilB = veil.veilB;
        inst.veil = veil.veil;
        inst.alpha = f.fade > 0 ? Math.max(0, 1 - f.fade) : 1;

        // Limbs first, so they sit BEHIND the body: a pectoral fin joins the
        // near flank and a caudal fin joins the peduncle, and in both cases
        // the body edge should overlap the root and hide the seam.
        if (f.limbs) {
          this.pushLimb(f, f.limbs.tail, inst, Math.sin(f.phase) * 0.30);
          this.pushLimb(f, f.limbs.fin, inst, 0.35 + Math.sin(f.phase * 0.9 + f.limbs.fin.phase) * 0.30);
        }
        scene.pushFish(inst);
      }
    }

    scene.endFish();

    // recycle anything that has left the screen
    for (let i = this.fish.length - 1; i >= 0; i--) {
      const f = this.fish[i];
      const margin = f.w + 40;
      if (f.x < -margin || f.x > layout.W + margin) this.fish.splice(i, 1);
    }
  }

  /**
   * Places one limb relative to its body and pushes it.
   *
   * The anchor is in the body sprite's own normalised space, so it follows
   * the body's size, flip and rotation without the limb needing to know
   * anything about them.
   */
  private pushLimb(f: Fish, limb: LimbInstance, body: FishInstance, rot: number): void {
    const li = limb.inst;
    const s = limb.spec;
    // body.w is already squashed during a turn, so the anchor rides in with
    // it and the fin stays attached instead of sliding off the peduncle.
    const ax = s.anchorX * body.w * body.flip;
    const ay = s.anchorY * body.h;
    const c = Math.cos(body.rot), sn = Math.sin(body.rot);
    li.x = body.x + ax * c - ay * sn;
    li.y = body.y + ax * sn + ay * c;
    li.flip = body.flip;
    // The limb narrows with the body; keeping it at full width during a turn
    // would leave a full-size tail on a sliver of fish.
    li.w = limb.baseW * (body.w / f.w);
    // A fin on a mirrored fish must swing the other way, or it hinges
    // backwards.
    li.rot = body.rot + rot * body.flip;
    li.veilR = body.veilR;
    li.veilG = body.veilG;
    li.veilB = body.veilB;
    li.veil = body.veil;
    li.alpha = body.alpha;
    void f;
    this.scene.pushFish(li);
  }

  /** the interactive fish nearest to a point, for the cast and the lure */
  nearest(x: number, y: number, maxDist: number): Fish | null {
    let best: Fish | null = null;
    let bestD = maxDist * maxDist;
    for (const f of this.fish) {
      if (f.distant) continue;
      const dx = f.x - x, dy = f.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /** used by the bycatch/junk spawner and by tests */
  spawnById(id: string, x: number, y: number, light: number): Fish | null {
    const sp = SPECIES_BY_ID.get(id);
    if (!sp) return null;
    const before = this.fish.length;
    this.spawn([sp], false, Baker.lightStep(light));
    const f = this.fish[before];
    if (f) { f.x = x; f.y = y; f.band = Math.max(0, Math.min(1, (y - this.scene.horizonY) / Math.max(1, layout.H - this.scene.horizonY))); }
    return f ?? null;
  }
}
