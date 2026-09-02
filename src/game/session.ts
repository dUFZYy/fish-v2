/**
 * Session — the driver.
 *
 * Everything else is a part: the state machine is pure, the drill is pure,
 * the catch maths is pure, the renderer knows nothing about fishing and the
 * audio knows nothing about anything. This file is the only place where a
 * game event turns into a sound, a particle and a number on the HUD.
 *
 * Keeping it in one place is deliberate. In the old game the loop, the
 * drawing, the sound and the save were interleaved in `script.js` and
 * `draw.js`, which is why a change to the drill could break the HUD. Here
 * the pure parts are unit-tested (66 tests) and this file is the wiring —
 * so a bug is either in a tested formula or in one obvious place.
 */

import { engine } from '@/engine/app';
import { layout } from '@/engine/layout';
import type { Scene } from '@/world/scene';
import type { Shoal, Fish } from '@/world/shoal';
import { audio } from '@/audio/engine';
import { sfx, panFor, TensionVoice } from '@/audio/sfx';

import {
  createInitialState, transition, BITE_WINDOW, CAST_FLIGHT_TIME, RETRIEVE_ANIM_TIME,
  type GameState, type FishInstance as LogicFish, type FishSpecies,
} from './state';
import { castTo, landBobber, getWave } from './cast';
import { initReel, updateReel } from './drill';
import type { ReelState } from './drillTypes';
import {
  computeCatch, rollWeight, rollShiny, lineSnappedMessage, type CatchResult,
} from './catch';
import type { Species } from '@/data/species';
import { loadSave, saveSave, type SaveData } from './save';

/** what the HUD and the screens need from a running session */
export interface SessionView {
  phase: GameState['phase'];
  coins: number;
  gems: number;
  level: number;
  xp: number;
  xpNeeded: number;
  streak: number;
  /** 0..1, only while reeling */
  tension: number;
  progress: number;
  /** 0..1 of the bite window remaining, only while biting */
  biteLeft: number;
  hookedName: string | null;
}

export interface SessionCallbacks {
  onCatch?(r: CatchResult, sp: Species, weight: number, shiny: boolean, perfect: boolean): void;
  onLost?(message: string): void;
  onView?(v: SessionView): void;
  onToast?(text: string): void;
}

/**
 * A species as the pure logic wants it. The logic modules were written
 * against the old game's field names, and the data module uses clearer ones;
 * this is the one adapter between them, rather than renaming 111 species.
 */
function toLogicSpecies(sp: Species): FishSpecies {
  return {
    id: sp.id,
    rarity: sp.rarity as FishSpecies['rarity'],
    kg: [sp.weight[0], sp.weight[1]] as const,
    value: sp.value,
    fight: sp.fight,
    len: sp.len,
    depth: [sp.depth[0], sp.depth[1]] as const,
    loc: [...sp.locations],
    junk: !!sp.bycatch,
    boss: !!sp.boss,
    speed: sp.speed,
  };
}

let nextFishId = 1;

export class Session {
  state: GameState = createInitialState();
  save: SaveData;
  private tension = new TensionVoice();
  private rng: () => number = Math.random;
  /** the shoal fish that is currently on the hook, for rendering */
  hooked: Fish | null = null;
  private hookedSpecies: Species | null = null;
  private hookedWeight = 0;
  private hookedShiny = false;
  /** seconds until the next bite roll; the pure bite module decides the rate */
  private nextBiteRoll = 0;
  private reelClickAcc = 0;
  private lastResult: CatchResult | null = null;

  constructor(
    private scene: Scene,
    private shoal: Shoal,
    private cb: SessionCallbacks = {},
  ) {
    this.save = loadSave();
  }

  // ---------------------------------------------------------------- input

  /**
   * One tap does everything, exactly as in the old game: cast where you
   * tapped, strike when the fish bites, hold to reel, tap to dismiss the
   * catch card. That single-input design is why the game works one-handed,
   * and it is worth preserving literally.
   */
  onPointerDown(x: number, y: number): void {
    audio.init();
    const s = this.state;
    switch (s.phase) {
      case 'ready':
        if (y <= this.scene.horizonY) return;
        this.cast(x, y);
        break;
      case 'waiting':
        // A second tap into the water reels the line back in.
        this.state = transition(s, { type: 'RETRIEVE_TAP' });
        sfx.cast(panFor(s.bobberX / layout.W));
        break;
      case 'biting':
        this.strike();
        break;
      case 'reeling':
        this.state = { ...s, isHolding: true };
        break;
      case 'caught':
        this.finishCatch();
        break;
      default:
        break;
    }
  }

  onPointerUp(): void {
    if (this.state.phase === 'reeling') this.state = { ...this.state, isHolding: false };
  }

  // ---------------------------------------------------------------- actions

  private get rodTip(): { x: number; y: number } {
    // Until the angler is attached the rod tip is where it sits on the dock.
    return { x: layout.W * 0.72, y: this.scene.horizonY - 62 };
  }

  private cast(targetX: number, targetY: number): void {
    const tip = this.rodTip;
    const anim = castTo(tip.x, tip.y, targetX, targetY, {
      horizonY: this.scene.horizonY,
      canvasWidth: layout.W,
      canvasHeight: layout.H,
    });
    this.state = transition(this.state, { type: 'CAST', anim });
    sfx.cast(panFor(targetX / layout.W));
    this.nextBiteRoll = 0;
  }

  private strike(): void {
    const s = this.state;
    const fish = s.bitingFish;
    if (!fish) return;
    const rod = this.currentRod();
    const reel = initReel({
      fight: fish.species.fight,
      junk: !!fish.species.junk,
      rodZone: rod.zone,
      catches: this.save.stats?.catches ?? 0,
      armeTalentRank: 0,
      handTalentRank: 0,
      bobberX: s.bobberX,
      hookY: s.hookY,
    }, this.rng);
    this.state = transition(s, { type: 'STRIKE', reel });
    this.tension.start();
    sfx.bite(panFor(s.bobberX / layout.W));
    this.scene.shake.add(3);
  }

  private finishCatch(): void {
    this.state = transition(this.state, { type: 'FINISH_CATCH' });
    this.hooked = null;
    this.hookedSpecies = null;
  }

  private currentRod(): { zone: number; radius: number } {
    // The shop catalog is ported; until the equipment screen is wired the
    // starter rod's numbers stand in.
    return { zone: 0.3, radius: 1 };
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    const s = this.state;
    switch (s.phase) {
      case 'casting': this.updateCasting(dt); break;
      case 'waiting': this.updateWaiting(dt); break;
      case 'biting': this.updateBiting(dt); break;
      case 'reeling': this.updateReeling(dt); break;
      case 'retrieving': this.updateRetrieving(dt); break;
      default: break;
    }
    this.cb.onView?.(this.view());
  }

  private updateCasting(dt: number): void {
    const s = this.state;
    const anim = s.castAnim;
    if (!anim) return;
    anim.t += dt / CAST_FLIGHT_TIME;
    if (anim.t < 1) return;
    const landed = landBobber(anim, s.time, this.scene.horizonY);
    this.state = transition(s, { type: 'LAND_BOBBER', ...landed });
    // The plop, the splash and the ring, all at the landing point.
    sfx.plop(panFor(landed.bobberX / layout.W));
    this.scene.particles.splash(landed.bobberX, landed.bobberY, 12, 0.8);
    this.scene.particles.ripple(landed.bobberX, landed.bobberY, 38, 2);
  }

  /**
   * Waiting. The bite rate comes from the pure bite module; what happens
   * here is only the picking of a fish and the tell that it is interested.
   */
  private updateWaiting(dt: number): void {
    const s = this.state;
    this.nextBiteRoll -= dt;

    // bobber rides the wave
    const by = getWave(s.bobberX, s.time, this.scene.horizonY);
    s.bobberY = by;
    s.hookY += (s.hookTargetY - s.hookY) * Math.min(1, dt * 2.5);

    if (this.nextBiteRoll > 0) return;
    this.nextBiteRoll = 0.35;

    // Which fish is close enough to notice the bait? The rod's lure radius
    // decides, which is the stat the player currently cannot see — see
    // docs/SPIEL-VORSCHLAEGE.md item 4.
    const radius = 90 * this.currentRod().radius;
    const near = this.shoal.nearest(s.bobberX, s.hookY, radius);
    if (!near) return;

    // steer it toward the bait, and nibble when it arrives
    const dx = s.bobberX - near.x;
    const dy = s.hookY - near.y;
    const dist = Math.hypot(dx, dy);
    near.dir = dx >= 0 ? 1 : -1;
    near.x += Math.sign(dx) * Math.min(Math.abs(dx), 26 * dt * 6);
    near.band += (((s.hookY - this.scene.horizonY) / Math.max(1, layout.H - this.scene.horizonY)) - near.band) * 0.25;

    if (dist < 22) {
      if (this.rng() < 0.45) {
        sfx.nibble(panFor(near.x / layout.W));
        this.scene.particles.bubbles(near.x, near.y, 2);
        return;
      }
      this.beginBite(near);
    }
  }

  private beginBite(f: Fish): void {
    const sp = f.sp;
    this.hooked = f;
    this.hookedSpecies = sp;
    this.hookedShiny = rollShiny({ junk: !!sp.bycatch, boss: !!sp.boss }, false, 0, this.rng);
    this.hookedWeight = rollWeight({ kg: [sp.weight[0], sp.weight[1]] }, 1, this.rng);
    const logic: LogicFish = {
      id: nextFishId++,
      species: toLogicSpecies(sp),
      x: f.x, y: f.y,
      vx: 0, vy: 0,
      scale: 1,
      state: 'biting',
      shiny: this.hookedShiny,
    };
    this.state = transition(this.state, { type: 'FISH_REACHES_HOOK', fish: logic });
    sfx.bite(panFor(f.x / layout.W));
    this.scene.particles.ripple(this.state.bobberX, this.state.bobberY, 26, 1);
  }

  private updateBiting(dt: number): void {
    const s = this.state;
    s.biteTimer -= dt;
    // the ring tightens audibly as the window closes
    this.reelClickAcc += dt;
    if (this.reelClickAcc > 0.12) {
      this.reelClickAcc = 0;
      sfx.urgentTick(1 - Math.max(0, s.biteTimer) / BITE_WINDOW);
    }
    if (s.biteTimer <= 0) {
      this.state = transition(s, { type: 'BITE_TIMEOUT' });
      this.hooked = null;
      sfx.escape(panFor(s.bobberX / layout.W));
      this.cb.onToast?.('Entwischt!');
    }
  }

  private updateReeling(dt: number): void {
    const s = this.state;
    const reel = s.reel;
    if (!reel) return;
    const res = updateReel(reel, dt, s.isHolding, {
      canvasWidth: layout.W,
      uiScale: 1,
      canJump: reel.progress > 0.4,
    }, this.rng);
    s.reel = res.state;

    this.tension.set(res.state.tension);
    if (res.reelClickRolled) sfx.reelClick(panFor(res.state.anchorX / layout.W));
    if (res.holdSplashRolled) {
      const y = getWave(res.state.anchorX, s.time, this.scene.horizonY);
      this.scene.particles.splash(res.state.anchorX, y, 5, 0.4);
    }
    if (res.jumped) {
      const y = getWave(res.state.anchorX, s.time, this.scene.horizonY);
      this.scene.particles.splash(res.state.anchorX, y, 16, 1.1);
      this.scene.particles.ripple(res.state.anchorX, y, 48, 2);
      sfx.splash(panFor(res.state.anchorX / layout.W), 0.8);
      this.scene.shake.add(3);
    }

    // drag the hooked fish toward the surface as the drill progresses
    if (this.hooked) {
      const hy = this.scene.horizonY;
      this.hooked.x += (res.state.anchorX - this.hooked.x) * Math.min(1, dt * 4);
      const targetBand = (1 - res.state.progress) * 0.7 + 0.03;
      this.hooked.band += (targetBand - this.hooked.band) * Math.min(1, dt * 2);
      void hy;
    }

    if (res.completed) this.landCatch(false);
    else if (res.failed) this.failCatch(res.failed, res.state, res.nearMiss);
  }

  private landCatch(_junkOnly: boolean): void {
    const s = this.state;
    const sp = this.hookedSpecies;
    const reel = s.reel;
    if (!sp || !reel) return;

    const perfect = reel.perfect;
    const result = computeCatch({
      species: toLogicSpecies(sp),
      scale: 1,
      reelPerfect: perfect,
      shiny: this.hookedShiny,
      streakBefore: s.streak,
      feilschTalentRank: 0,
      lehreTalentRank: 0,
      rng: this.rng,
    });

    this.lastResult = result;
    this.state = transition(s, { type: 'REEL_COMPLETE' });
    // computeCatch already advanced the streak — take its number rather than
    // recomputing it, or the two drift apart.
    this.state.streak = result.streakAfter;

    this.tension.stop();

    // The reward, in the order the player perceives it: the water breaks,
    // the fish is out, the jingle, then the coins fly to the counter.
    const bx = reel.anchorX;
    const by = getWave(bx, s.time, this.scene.horizonY);
    this.scene.particles.splash(bx, by, 22, 1.3);
    this.scene.particles.ripple(bx, by, 60, 3);
    this.scene.shake.add(4 + rarityIndex(sp) * 2);
    sfx.splash(panFor(bx / layout.W), 1);
    sfx.catchJingle(rarityIndex(sp));
    if (this.hookedShiny) this.scene.particles.sparks(bx, by - 30, 14, 40);
    if (rarityIndex(sp) >= 3) this.scene.particles.confetti(bx, by - 40, 30);
    this.scene.particles.coins(bx, by - 20, Math.min(12, 3 + rarityIndex(sp) * 2), 60, 40);

    this.applyRewards(result);
    this.cb.onCatch?.(result, sp, result.kg, this.hookedShiny, result.perfect);
  }

  private failCatch(reason: 'lineSnapped' | 'shakenOff', reel: ReelState, nearMiss: boolean): void {
    const s = this.state;
    this.state = transition(s, { type: 'REEL_FAILED', reason });
    this.state.streak = 0;
    this.tension.stop();
    this.hooked = null;

    if (reason === 'lineSnapped') {
      sfx.snap(panFor(reel.anchorX / layout.W));
      this.scene.shake.add(6);
    } else {
      sfx.escape(panFor(reel.anchorX / layout.W));
    }
    const msg = lineSnappedMessage(reel.progress);
    this.cb.onLost?.(msg.message);
    if (msg.floatingText) this.cb.onToast?.(msg.floatingText);
    void nearMiss;
  }

  private applyRewards(r: CatchResult): void {
    this.save.coins = (this.save.coins ?? 0) + r.coins;
    this.save.xp = (this.save.xp ?? 0) + r.xp;
    saveSave(this.save);
  }

  private updateRetrieving(dt: number): void {
    const s = this.state;
    if (!s.retrieveAnim) return;
    s.retrieveAnim.t += dt / RETRIEVE_ANIM_TIME;
    if (s.retrieveAnim.t >= 1) {
      this.state = transition(s, { type: 'RETRIEVE_ANIM_DONE' });
    }
  }

  // ---------------------------------------------------------------- view

  view(): SessionView {
    const s = this.state;
    return {
      phase: s.phase,
      coins: this.save.coins ?? 0,
      gems: this.save.gems ?? 0,
      level: this.save.level ?? 1,
      xp: this.save.xp ?? 0,
      xpNeeded: 151,
      streak: s.streak,
      tension: s.reel?.tension ?? 0,
      progress: s.reel?.progress ?? 0,
      biteLeft: s.phase === 'biting' ? Math.max(0, s.biteTimer) / BITE_WINDOW : 0,
      hookedName: this.hookedSpecies?.nameDe ?? null,
    };
  }

  get result(): CatchResult | null { return this.lastResult; }

  destroy(): void {
    this.tension.stop();
  }
}

function rarityIndex(sp: Species): number {
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const i = order.indexOf(sp.rarity);
  return i < 0 ? 0 : i;
}

/** the engine's frame hook, so boot.ts stays a wiring file */
export function driveSession(session: Session): void {
  engine.onUpdate((dt) => session.update(dt));
}
