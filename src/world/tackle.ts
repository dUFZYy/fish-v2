/**
 * Tackle — the line, the hook and the bobber.
 *
 * Three things that must be redrawn every frame because they follow a
 * continuous curve, and three things that are therefore deliberately NOT
 * baked (CLAUDE.md rule: what moves continuously does not go on a bake that
 * carries its position).
 *
 * The line is a handful of points in a Graphics, rebuilt per frame. That
 * sounds like exactly the per-frame Canvas-2D work this rebuild exists to
 * remove, and it is not: a Graphics with ~14 points is one tiny geometry
 * upload and one draw call, whereas the old renderer redrew the line into a
 * full-screen canvas that then went to the GPU whole. The cost is not the
 * drawing, it was ever only the surface it was drawn onto.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { baker, Baker } from '@/bake/baker';
import { drawBobber, drawHook } from '@/bake/anglerArt';
import { BOBBERS } from '@/data/items';
import { layout } from '@/engine/layout';
import type { Scene } from './scene';

export interface TackleState {
  /** rod tip in logical px — where the line starts */
  tipX: number;
  tipY: number;
  /** bobber position, or null when the line is in */
  bobberX: number | null;
  bobberY: number | null;
  /** hook position; below the bobber while fishing */
  hookX: number;
  hookY: number;
  /** 0..1 — a tight line sags less */
  tension: number;
  /** true while a fish is on and the line should twitch */
  fighting: boolean;
  light: number;
}

const LINE_SEGMENTS = 14;

/** the catalog entry for a bobber id, falling back to the starter float */
function bobberItem(id: string) {
  return BOBBERS.find((b) => b.id === id) ?? BOBBERS[0];
}

export class Tackle {
  readonly root = new Container();
  private line = new Graphics();
  private bobber = new Sprite();
  private hook = new Sprite();
  private lightStep = -1;
  private bobberSkin = 'standard';

  constructor(private scene: Scene, bobberSkin = 'standard') {
    this.bobberSkin = bobberSkin;
    this.root.addChild(this.line, this.hook, this.bobber);
    scene.tackleLayer.addChild(this.root);
    this.bobber.anchor.set(0.5);
    this.hook.anchor.set(0.5, 0);
  }

  private rebake(light: number): void {
    const step = Baker.lightStep(light);
    if (step === this.lightStep) return;
    this.lightStep = step;
    const b = baker.bakeSprite(
      `bobber:${this.bobberSkin}:18@${layout.dpr}`, 18, 18,
      (ctx, w, h) => drawBobber(ctx, w, h, bobberItem(this.bobberSkin)),
    );
    this.bobber.texture = b.texture;
    this.bobber.setSize(14, 14);

    const hk = baker.bakeSprite(`hook:10@${layout.dpr}`, 10, 14, (ctx, w, h) => drawHook(ctx, w, h));
    this.hook.texture = hk.texture;
    this.hook.setSize(8, 11);
  }

  update(t: number, s: TackleState): void {
    this.rebake(s.light);

    if (s.bobberX === null || s.bobberY === null) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    const bx = s.bobberX;
    const by = s.bobberY;

    this.bobber.x = bx;
    this.bobber.y = by;
    // A bobber with a fish on it is pulled under and jitters; at rest it just
    // rides the wave, which the caller has already put into bobberY.
    if (s.fighting) {
      this.bobber.y += 3 + Math.sin(t * 34) * 2.2;
      this.bobber.rotation = Math.sin(t * 21) * 0.22;
    } else {
      this.bobber.rotation = Math.sin(t * 1.6) * 0.06;
    }

    this.hook.x = s.hookX;
    this.hook.y = s.hookY;
    this.hook.visible = s.hookY > by + 6;

    // --- the line: rod tip to bobber, sagging, then bobber to hook ---
    const g = this.line;
    g.clear();
    // Sag is a catenary approximated by a parabola. It goes slack when the
    // line is loose and straightens as tension rises, which is the clearest
    // read the player has on the drill besides the sound.
    const sag = (1 - Math.min(1, s.tension)) * Math.min(46, Math.abs(bx - s.tipX) * 0.28) + 4;
    g.moveTo(s.tipX, s.tipY);
    for (let i = 1; i <= LINE_SEGMENTS; i++) {
      const u = i / LINE_SEGMENTS;
      const x = s.tipX + (bx - s.tipX) * u;
      const y = s.tipY + (by - s.tipY) * u + Math.sin(u * Math.PI) * sag
        // a tight line under load hums; a slack one does not
        + (s.fighting ? Math.sin(u * 9 + t * 26) * s.tension * 1.6 : 0);
      g.lineTo(x, y);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.5 });

    if (this.hook.visible) {
      g.moveTo(bx, by);
      g.lineTo(s.hookX, s.hookY);
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.34 });
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
