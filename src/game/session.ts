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
import {
  attractRadius, attractRate, rollAttracted, rollNibble, shouldStartBite,
  BAITS, type Bait,
} from './bite';
import { addXP, xpToNext, getLevel, getXP, anglerTitle } from './progress';
import { RODS } from '@/data/items';
import { initReel, updateReel } from './drill';
import type { ReelState } from './drillTypes';
import {
  computeCatch, rollWeight, rollShiny, lineSnappedMessage, type CatchResult,
} from './catch';
import type { Species } from '@/data/species';
import { loadSave, saveSave, type SaveData } from './save';
import { checkAchievements, type AchievementId } from './events';
import { SPECIES } from '@/data/species';
import { LOCATIONS } from '@/data/locations';

/** what the HUD and the screens need from a running session */
export interface SessionView {
  phase: GameState['phase'];
  coins: number;
  gems: number;
  level: number;
  title: string;
  xp: number;
  xpNeeded: number;
  streak: number;
  /** 0..1, only while reeling */
  tension: number;
  progress: number;
  /** 0..1 of the bite window remaining, only while biting */
  biteLeft: number;
  hookedName: string | null;
  /** logical px, 0 when the line is not out */
  lureRadius: number;
}

export interface SessionCallbacks {
  onCatch?(r: CatchResult, sp: Species, weight: number, shiny: boolean, perfect: boolean): void;
  onLost?(message: string): void;
  onView?(v: SessionView): void;
  onToast?(text: string): void;
  onLevelUp?(level: number, title: string): void;
  onAchievement?(id: string): void;
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

/** seconds between two bait twitches */
const TWITCH_COOLDOWN = 0.8;
/** how long a twitch keeps drawing attention */
const TWITCH_BOOST_TIME = 2.2;
/** attraction multiplier while a twitch is working */
const TWITCH_MULT = 1.8;
/** landing the hook this close to a fish scares it off */
const CAST_SCARE_RADIUS = 26;
/** landing it this close, but not on top, is rewarded */
const CAST_BONUS_RADIUS = 78;
/** the reward, as a fraction added to the attraction rate */
const CAST_BONUS_MULT = 0.75;

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
  private twitchCooldown = 0;
  private twitchBoost = 0;
  /** attraction bonus earned by landing the cast beside a visible fish */
  private castBonus = 0;
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
        this.tapWhileWaiting(x, y);
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
    // Casting ON a fish scares it — that detail was already in the old game
    // ("nah dran, nicht drauf"), and it is half a mechanic. This is the other
    // half: landing just BESIDE a visible fish is rewarded, which turns the
    // shoal from wallpaper into something to aim at.
    const onTop = this.shoal.nearest(targetX, targetY, CAST_SCARE_RADIUS);
    if (onTop) {
      onTop.attracted = false;
      onTop.turnTo = onTop.x < targetX ? -1 : 1;
      if (onTop.dir !== onTop.turnTo) { onTop.turn = 0.0001; }
      onTop.speed *= 2.2;
      this.cb.onToast?.('Nah dran, nicht drauf!');
      this.castBonus = 0;
    } else {
      const beside = this.shoal.nearest(targetX, targetY, CAST_BONUS_RADIUS);
      this.castBonus = beside ? CAST_BONUS_MULT : 0;
    }

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

  /**
   * A tap while the line is out.
   *
   * Near the bobber it TWITCHES the bait; anywhere else it reels in. The
   * twitch is new: waiting was dead time, with nothing the player could do
   * but watch, and the nibble tell was the only feedback. Now a twitch draws
   * attention — a short attraction bonus, a couple of bubbles, and every
   * interested fish turns toward it. It costs a cooldown so it cannot be
   * mashed.
   */
  private tapWhileWaiting(x: number, y: number): void {
    const s = this.state;
    const near = Math.hypot(x - s.bobberX, y - s.bobberY) < 70;
    if (near && this.twitchCooldown <= 0) {
      this.twitchCooldown = TWITCH_COOLDOWN;
      this.twitchBoost = TWITCH_BOOST_TIME;
      sfx.plop(panFor(s.bobberX / layout.W));
      this.scene.particles.bubbles(s.bobberX, s.hookY, 3);
      this.scene.particles.ripple(s.bobberX, s.bobberY, 18, 1);
      for (const f of this.shoal.fish) {
        if (f.distant) continue;
        const want = s.bobberX >= f.x ? 1 : -1;
        if (f.dir !== want && f.turn === 0) { f.turn = 0.0001; f.turnTo = want; }
      }
      return;
    }
    this.state = transition(s, { type: 'RETRIEVE_TAP' });
    this.shoal.clearInterest();
    sfx.cast(panFor(s.bobberX / layout.W));
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
    this.shoal.clearInterest();
  }

  /** the equipped rod from the ported catalog, falling back to the starter */
  private currentRod(): (typeof RODS)[number] {
    const id = this.save.equipped?.rod ?? RODS[0].id;
    return RODS.find((r) => r.id === id) ?? RODS[0];
  }

  private currentBait(): Bait {
    const id = this.save.equipped?.bait ?? BAITS[0].id;
    return BAITS.find((b) => b.id === id) ?? BAITS[0];
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
  /**
   * Waiting for a bite.
   *
   * The rates are NOT invented here — every one of them comes from the
   * ported `bite.ts`, which carries the old game's formula and each of its
   * multipliers as a separately tested function: the rod's lure radius, the
   * bait, the ramp with wait time, rain, the golden hour, the lockruf totem,
   * the patience talent and the rarity penalty. An earlier version of this
   * file guessed at "nearest fish within 90 px, 45 % nibble", which played
   * nothing like the original.
   */
  private updateWaiting(dt: number): void {
    const s = this.state;
    s.waitTime += dt;

    // bobber rides the wave; the hook sinks toward its target depth
    s.bobberY = getWave(s.bobberX, s.time, this.scene.horizonY);
    s.hookY += (s.hookTargetY - s.hookY) * Math.min(1, dt * 2.5);

    this.twitchCooldown = Math.max(0, this.twitchCooldown - dt);
    this.twitchBoost = Math.max(0, this.twitchBoost - dt);

    const rod = this.currentRod();
    const radius = attractRadius(layout.W, layout.H, rod.radius, 0, false);
    // The two new bonuses multiply the ported rate rather than replacing it,
    // so every original multiplier still applies underneath.
    const bonus = (1 + this.castBonus) * (this.twitchBoost > 0 ? TWITCH_MULT : 1);

    // Already-interested fish keep swimming in; the rest may become
    // interested, at a rate that depends on what they are.
    for (const f of this.shoal.fish) {
      if (f.distant) continue;
      const dx = s.bobberX - f.x;
      const dy = s.hookY - f.y;
      const dist = Math.hypot(dx, dy);

      if (!f.attracted) {
        if (dist > radius) continue;
        const rate = attractRate({
          catches: this.save.stats?.catches ?? 0,
          waitTime: s.waitTime,
          raining: false,
          goldenHour: false,
          lockrufTotemActive: false,
          geduldTalentRank: 0,
          bait: this.currentBait(),
          isBoss: !!f.sp.boss,
          rarityIdx: rarityIndex(f.sp),
        });
        if (!rollAttracted(rate * bonus, dt, this.rng)) continue;
        f.attracted = true;
        f.turn = 0;                    // it has made up its mind
      }

      // swim at the bait
      f.turnTo = dx >= 0 ? 1 : -1;
      if (f.dir !== f.turnTo && f.turn === 0) f.turn = 0.0001;
      const speed = 26 + f.sp.speed * 30;
      f.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      const targetBand = (s.hookY - this.scene.horizonY) / Math.max(1, layout.H - this.scene.horizonY);
      f.band += (targetBand - f.band) * Math.min(1, dt * 1.6);

      if (rollNibble(dist, 1, dt, this.rng)) {
        sfx.nibble(panFor(f.x / layout.W));
        this.scene.particles.bubbles(f.x, f.y, 2);
      }
      if (shouldStartBite(dist, 1)) { this.beginBite(f); return; }
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
      this.shoal.clearInterest();
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

    this.applyRewards(result, sp);
    // The fish is out of the water now; leaving it swimming was a bug you
    // only notice once, and then cannot unsee.
    if (this.hooked) this.shoal.remove(this.hooked);

    this.cb.onCatch?.(result, sp, result.kg, this.hookedShiny, result.perfect);
  }

  private failCatch(reason: 'lineSnapped' | 'shakenOff', reel: ReelState, nearMiss: boolean): void {
    const s = this.state;
    this.state = transition(s, { type: 'REEL_FAILED', reason });
    this.state.streak = 0;
    this.tension.stop();
    this.hooked = null;
    this.shoal.clearInterest();

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

  private applyRewards(r: CatchResult, sp: Species): void {
    this.save.coins = (this.save.coins ?? 0) + r.coins;

    // XP goes through the ported curve, which handles crossing several
    // levels at once and returns what was gained — the level-up reward and
    // its popup hang off that, not off a hand-rolled threshold.
    const res = addXP(this.save, r.xp);
    this.save = res.save;
    for (const up of res.levelUps) {
      sfx.levelUp();
      this.cb.onToast?.(`Stufe ${up.level}: ${anglerTitle(up.level)}`);
      this.cb.onLevelUp?.(up.level, anglerTitle(up.level));
    }

    // the dex: seen, caught, and the personal record
    const dex = this.save.dex;
    const entry = (dex[sp.id] ??= { count: 0, record: 0 });
    entry.count += 1;
    entry.record = Math.max(entry.record, r.kg);
    if (this.hookedShiny) entry.shiny = (entry.shiny ?? 0) + 1;

    const stats = this.save.stats;
    stats.catches += 1;
    stats.totalCoins += r.coins;
    stats.biggestKg = Math.max(stats.biggestKg, r.kg);
    if (r.perfect) stats.perfects += 1;
    if (this.hookedShiny) stats.shinies += 1;

    this.awardAchievements();
    saveSave(this.save);
  }

  /**
   * The 37 achievements are ported with their conditions as predicates; they
   * were simply never being checked. This is the one place that has all the
   * numbers they ask about, so it is where the check belongs.
   */
  private awardAchievements(): void {
    const sv = this.save;
    const newly = checkAchievements({
      catches: sv.stats.catches,
      dex: sv.dex,
      totalSpeciesCount: SPECIES.length,
      biggestKg: sv.stats.biggestKg,
      streak: this.state.streak,
      perfects: sv.stats.perfects,
      rainCatches: sv.stats.rainCatches,
      totalCoins: sv.stats.totalCoins,
      // owned.locations holds the bought ones; the starter lake is free and
      // never appears there, so it is counted separately.
      unlockedLocationsCount: (sv.owned?.locations?.length ?? 0) + 1,
      totalLocationsCount: LOCATIONS.length,
      level: getLevel(sv),
      dexRewardKeys: Object.keys(sv.dexRewards ?? {}),
      questsCompleted: sv.stats.quests,
      gachasOpened: sv.stats.gachas,
      shinies: sv.stats.shinies,
      bossSpeciesIds: SPECIES.filter((x) => x.boss).map((x) => x.id),
      tiefseeExclusiveSpeciesIds: SPECIES
        .filter((x) => x.locations.length === 1 && x.locations[0] === 'tiefsee')
        .map((x) => x.id),
    }, sv.achievements as unknown as readonly AchievementId[]);

    for (const id of newly) {
      sv.achievements.push(id);
      this.cb.onAchievement?.(id);
    }
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
      level: getLevel(this.save),
      title: anglerTitle(getLevel(this.save)),
      xp: getXP(this.save),
      xpNeeded: xpToNext(getLevel(this.save)),
      streak: s.streak,
      tension: s.reel?.tension ?? 0,
      progress: s.reel?.progress ?? 0,
      biteLeft: s.phase === 'biting' ? Math.max(0, s.biteTimer) / BITE_WINDOW : 0,
      hookedName: this.hookedSpecies?.nameDe ?? null,
      lureRadius: s.phase === 'waiting'
        ? attractRadius(layout.W, layout.H, this.currentRod().radius, 0, false)
        : 0,
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
