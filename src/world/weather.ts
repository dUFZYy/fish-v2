/**
 * Weather — rain, gloom and lightning.
 *
 * The state itself is the ported `events.ts`: the clear/rain timer, the
 * gloom ramp, the drop list and the lightning roll are all its numbers,
 * verbatim from the old game. This file is only the picture and the sound.
 *
 * The drops are one instanced batch, which matters more here than anywhere
 * else in the game: at six new drops per frame there are a few hundred on
 * screen at once, and the old renderer drew each as its own line into the
 * full-screen canvas. That is the shape of cost this rebuild removes — the
 * drops now cost one draw call whether there are ten or four hundred.
 *
 * The lightning flash is the one place a full-screen quad is justified: it
 * lasts about a third of a second, and CLAUDE.md's rule is about a PERMANENT
 * second layer in the compositor, not about a brief additive flash.
 */

import { Container, Graphics, type TextureSource } from 'pixi.js';
import { ParticleBatch } from './particles';
import type { Scene } from './scene';
import { audio } from '@/audio/engine';
import { sfx } from '@/audio/sfx';
import {
  createInitialWeather, tickWeather, RAINDROP_SPEED_MIN, RAINDROP_SPEED_MAX,
  type WeatherState,
} from '@/game/events';
import { layout } from '@/engine/layout';
import type { Stamp } from './particles';

export class Weather {
  state: WeatherState = createInitialWeather();
  private drops: ParticleBatch;
  private flash = new Graphics();
  private root = new Container();
  private stamp: Stamp;
  /** seconds until the thunder that belongs to the last flash */
  private thunderIn = -1;
  private thunderDistance = 0.5;

  constructor(private scene: Scene, atlas: TextureSource, stamps: Record<'disc' | 'ring' | 'rect' | 'glow', Stamp>) {
    this.stamp = stamps.rect;
    this.drops = new ParticleBatch(atlas, layout.W, layout.H, false);
    this.root.addChild(this.drops.mesh, this.flash);
    scene.root.addChild(this.root);
  }

  /** rain drives the palette's gloom, which the caller feeds to getPalette */
  get gloom(): number { return this.state.gloom; }
  get raining(): boolean { return this.state.type === 'rain'; }

  update(dt: number, time: number): void {
    const res = tickWeather(this.state, dt, {
      canvasWidth: layout.W,
      time,
      horizonY: this.scene.horizonY,
    }, Math.random);
    this.state = res.state;

    if (res.transition === 'toRain') sfx.thunder(0.85);
    if (res.rippleRolled) {
      const x = Math.random() * layout.W;
      const y = this.scene.waveAt(x, 0);
      this.scene.particles.ripple(x, y, 12, 1);
    }
    if (res.lightningRolled) {
      // The flash is seen before the thunder is heard, and the delay is what
      // tells you how far away the storm is. Two seconds of delay reads as
      // "over there"; a tenth of a second reads as "here".
      this.thunderDistance = Math.random();
      this.thunderIn = 0.15 + this.thunderDistance * 2.4;
    }
    if (this.thunderIn > 0) {
      this.thunderIn -= dt;
      if (this.thunderIn <= 0 && audio.ready) {
        sfx.thunder(this.thunderDistance);
        this.scene.shake.add(2 + (1 - this.thunderDistance) * 5);
      }
    }

    this.draw();
  }

  private draw(): void {
    const s = this.state;

    // --- the drops -------------------------------------------------------
    this.drops.begin();
    if (s.drops.length) {
      const f = this.stamp;
      for (const d of s.drops) {
        // A drop is a streak, not a dot: length follows its speed, and it
        // leans with the drift so the rain has a direction.
        const len = 7 + (d.v - RAINDROP_SPEED_MIN) / (RAINDROP_SPEED_MAX - RAINDROP_SPEED_MIN) * 9;
        this.drops.push(d.x, d.y, 1.4, len, 0.14, 0.72, 0.84, 0.95, 0.42,
          f.fx, f.fy, f.fw, f.fh);
      }
    }
    this.drops.end();

    // --- the flash -------------------------------------------------------
    const g = this.flash;
    if (s.flash > 0.002) {
      g.clear();
      g.rect(0, 0, layout.W, layout.H).fill({ color: 0xdfefff, alpha: Math.min(0.5, s.flash * 0.5) });
      g.visible = true;
    } else if (g.visible) {
      g.clear();
      g.visible = false;
    }
  }

  resize(w: number, h: number): void {
    this.drops.resize(w, h);
  }

  destroy(): void {
    this.drops.destroy();
    this.root.destroy({ children: true });
  }
}
