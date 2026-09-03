import { engine } from '@/engine/app';
import { baker } from '@/bake/baker';
import { standalone } from '@/bake/standalone';
import { Scene } from '@/world/scene';
import { Shoal } from '@/world/shoal';
import { Angler, type AnglerPose } from '@/world/angler';
import { layout } from '@/engine/layout';
import { LAKE, lakeArt, makeDock, setSkyGloom, setSkyPhase, skyGloomStep, skyStateFor, DAY_SECONDS } from './lake';
import { Weather } from '@/world/weather';
import { Session } from './session';
import { audio } from '@/audio/engine';
import { sfx, panFor } from '@/audio/sfx';
import { music } from '@/audio/music';
import { setAmbience, setRain } from '@/audio/ambience';
import { Hud, type HudState } from '@/ui/hud';
import { Screens } from '@/ui/screens';
import { CatchCard, LevelUpPopup } from '@/ui/catchCard';
import { SPECIES_BY_ID } from '@/data/species';

/**
 * Boot — wiring only.
 *
 * Every part is built and connected here and nowhere else: the scene owns
 * layer order, the shoal owns the fish, the session owns the rules, the HUD
 * owns the DOM. This file introduces them to each other.
 *
 * Switches, all readable off the device with ?perf=1:
 *   ?fish=N     interactive fish in the water (load test)
 *   ?far=N      far silhouettes behind them
 *   ?water=0    water pass off, as a counter-check
 *   ?day=0.5    freeze the day clock at a phase (0 = midnight, 0.5 = noon)
 *   ?q=...      pin the resolution tier
 */
export async function startGame(): Promise<void> {
  const p = new URLSearchParams(location.search);
  const count = clampInt(p.get('fish'), 9, 1, 120);
  const distant = clampInt(p.get('far'), 5, 0, 40);
  const waterOn = p.get('water') !== '0';
  const frozenDay = p.has('day') ? Number(p.get('day')) : null;

  audio.attachLifecycle();

  // Music and ambience can only start from a gesture (iOS), so they wait for
  // the first touch rather than being started here and silently failing.
  let soundStarted = false;
  const startSound = () => {
    if (soundStarted || !audio.ready) return;
    soundStarted = true;
    music.start();
    music.setMood('see');
    setAmbience(LAKE.id, false);
  };
  for (const ev of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(ev, () => { audio.init(); startSound(); }, { passive: true });
  }

  const scene = new Scene(baker.sprites.textureSource, engine.W, engine.H, {
    onCoinArrive: (i) => sfx.coin(i),
  });
  engine.world.addChild(scene.root);
  if (!waterOn) scene.water.mesh.visible = false;

  const art = lakeArt(LAKE);
  // The scenery's cache key must include the gloom step, or a shower would
  // grey the sky strip and leave the baked hills sunny.
  const artId = art.id;
  Object.defineProperty(art, 'id', { get: () => `${artId}:g${skyGloomStep()}` });
  let dayTime = frozenDay ?? 0.42;
  setSkyPhase(dayTime);
  scene.setArt(art, skyStateFor(dayTime, engine.W, engine.H, LAKE).light);

  // The dock is a placed sprite in the near parallax group, not part of the
  // screen-sized near bake — see makeDock for why.
  let dock = makeDock(scene.horizonY, skyStateFor(dayTime, engine.W, engine.H, LAKE).light);
  scene.nearProps.addChild(dock);

  const shoal = new Shoal(scene, { count, distantCount: distant });
  shoal.setLocation(LAKE.id, false);

  // The angler owns the figure, the rod AND the line/bobber/hook — its own
  // renderer already draws them from the rod tip, so the separate Tackle
  // pass is gone rather than drawing a second line beside it.
  const angler = new Angler(scene, {
    outfit: session0Look().outfit,
    hat: session0Look().hat,
    rodSkin: session0Look().rodSkin,
    bobber: session0Look().bobber,
  });
  const weather = new Weather(scene, baker.sprites.textureSource, scene.stamps);

  // --- the HUD and the menus, as small DOM elements over the canvas -------
  const uiHost = document.getElementById('ui')!;

  const screens = new Screens(uiHost, {
    shop: {
      onBuyOrEquip: (cat, id) => { hud.toast(`${cat}: ${id}`); },
      onBuyTotem: (id) => { hud.toast(id); },
    },
    settings: {
      onQualityChange: (q) => engine.setQuality(q as never),
      onMusicVolume: (v: number) => audio.setVolume('music', v),
      onSfxVolume: (v: number) => audio.setVolume('sfx', v),
      onAmbienceVolume: (v: number) => audio.setVolume('amb', v),
      onMusicToggle: (on: boolean) => audio.setVolume('music', on ? 0.5 : 0),
      onSfxToggle: (on: boolean) => audio.setVolume('sfx', on ? 1 : 0),
    },
  });
  const catchCard = new CatchCard({ onContinue: () => session.onPointerDown(0, 0) });
  const levelUp = new LevelUpPopup();

  const openScreen = (id: 'dex' | 'shop' | 'quests' | 'settings' | 'achievements') => {
    const sv = session.save;
    switch (id) {
      case 'dex':
        screens.open({ id, data: { dex: sv.dex, seenSpecies: sv.seenSpecies ?? {}, totalCatches: sv.stats.catches, biggestKg: sv.stats.biggestKg } });
        break;
      case 'shop':
        screens.open({ id, data: { coins: sv.coins, gems: sv.gems, owned: sv.owned, equipped: sv.equipped } });
        break;
      case 'quests':
        screens.open({ id, data: { quests: [], secondsToReset: 0 } as never });
        break;
      case 'settings':
        screens.open({ id, data: { lang: 'de', quality: 'auto', music: audio.getVolume('music'), sfx: audio.getVolume('sfx'), ambience: audio.getVolume('amb'), haptics: true, version: '2.0.0' } as never });
        break;
      case 'achievements':
        screens.open({ id, data: { unlocked: sv.achievements ?? [] } as never });
        break;
    }
  };

  const hud = new Hud(uiHost, {
    onMenu: () => openScreen('settings'),
    onDex: () => openScreen('dex'),
    onShop: () => openScreen('shop'),
    onBonus: () => openScreen('quests'),
  });

  // --- the session: the only place a game event becomes a sound ------------
  const session = new Session(scene, shoal, {
    onToast: (text) => hud.toast(text),
    onLost: (text) => hud.toast(text),
    onCatch: (r, sp, _kg, shiny, perfect) => {
      const entry = session.save.dex[sp.id];
      catchCard.show(uiHost, {
        species: sp,
        weightKg: r.kg,
        shiny,
        perfect,
        newInDex: !entry || entry.count <= 1,
        newRecord: !!entry && Math.abs(entry.record - r.kg) < 1e-9,
        coins: r.coins,
      });
    },
    onAchievement: (id) => hud.toast(`Erfolg: ${id}`),
    onLevelUp: (lvl, title) => {
      levelUp.show(uiHost, { level: lvl, title } as never);
      window.setTimeout(() => levelUp.hide(), 2600);
    },
  });

  // --- ambient life --------------------------------------------------------
  // A bubble now and then. Cheap, and it is what stops still water looking
  // like a photograph.
  let bubbleTimer = 0;

  engine.onUpdate((dt, t) => {
    if (frozenDay === null) {
      dayTime = (dayTime + dt / DAY_SECONDS) % 1;
      setSkyPhase(dayTime);
    }
    weather.update(dt, t);
    setSkyGloom(weather.gloom);
    const sky = skyStateFor(dayTime, engine.W, engine.H, LAKE);
    const wBot = art.waterBottom(sky.light);

    session.update(dt);
    shoal.update(dt, t, sky.light, wBot);

    const st = session.state;
    const lineOut = st.phase !== 'ready' && st.phase !== 'casting';
    angler.update(dt, t, {
      pose: poseFor(st.phase),
      light: sky.light,
      aimX: st.bobberX / Math.max(1, engine.W),
      aimY: st.bobberY / Math.max(1, engine.H),
      bobberX: lineOut ? st.bobberX : null,
      bobberY: lineOut ? st.bobberY : null,
      tension: st.reel?.tension ?? 0,
      holding: st.isHolding,
    });

    bubbleTimer -= dt;
    if (bubbleTimer <= 0) {
      bubbleTimer = 0.5 + Math.random() * 1.6;
      const x = Math.random() * engine.W;
      const y = scene.horizonY + 60 + Math.random() * (engine.H - scene.horizonY - 80);
      scene.particles.bubbles(x, y, 2 + Math.floor(Math.random() * 3));
      if (Math.random() < 0.25 && audio.ready) sfx.bubble(panFor(x / engine.W));
    }

    // The camera drifts toward whatever the player is looking at: the bobber
    // while fishing, the middle of the water otherwise. Slow, so it reads as
    // a camera and not as a slide.
    const focusX = lineOut ? st.bobberX : engine.W * 0.5;
    lookX += ((focusX - engine.W * 0.5) * 0.09 - lookX) * Math.min(1, dt * 1.2);

    scene.update(dt, {
      light: sky.light,
      time: t,
      sun: sky.sun,
      lookX,
      lookY: Math.sin(t * 0.05) * 4,
      tier: engine.qualityTier,
    });

    // --- the music follows the game rather than just playing over it -----
    // Calm while the line is in, a lift while a fish is interested, and the
    // drill's own tension pushed straight into the arrangement. The old
    // engine only had a boss flag; this is the same idea generalised, and it
    // is what makes a catch feel like the end of something.
    if (soundStarted) {
      const st2 = session.state;
      const intensity =
        st2.phase === 'reeling' ? 0.55 + (st2.reel?.tension ?? 0) * 0.45
        : st2.phase === 'biting' ? 0.6
        : st2.phase === 'caught' ? 0.35
        : lineOut ? 0.18 : 0;
      music.setIntensity(intensity);
      music.setNight(sky.light < 0.35);
      setRain(weather.gloom);
    }

    hud.update(hudStateFrom(session, dayTime));

    // A menu that covers the whole screen means the world behind it is not
    // visible, and drawing it anyway is exactly the cost the old game paid:
    // two full-screen surfaces composited every frame, one of them entirely
    // hidden. Stop rendering the scene while that is true.
    scene.root.renderable = !screens.coversWorld;
  });

  let lookX = 0;

  // --- input: one tap does everything, as in the old game -----------------
  engine.app.stage.eventMode = 'static';
  engine.app.stage.hitArea = { contains: () => true };
  engine.app.stage.on('pointerdown', (e: { global: { x: number; y: number } }) => {
    if (screens.isOpen) return;          // the sheet has its own input
    if (catchCard.visible) { catchCard.hide(); session.onPointerDown(0, 0); return; }
    session.onPointerDown(e.global.x, e.global.y);
  });
  engine.app.stage.on('pointerup', () => session.onPointerUp());
  engine.app.stage.on('pointerupoutside', () => session.onPointerUp());

  const onResize = () => {
    scene.resize(engine.W, engine.H);
    baker.invalidateAll();
    standalone.clear();
    const light = skyStateFor(dayTime, engine.W, engine.H, LAKE).light;
    scene.setArt(art, light);
    dock.destroy();
    dock = makeDock(scene.horizonY, light);
    scene.nearProps.addChild(dock);
  };
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  (window as unknown as { __game: unknown }).__game = {
    scene, shoal, session, angler, hud, weather, screens, catchCard, baker, standalone, engine,
    openScreen,
    /** dev only: freeze the simulation while still rendering, so a still
     *  frame can be captured of a state that only lasts a moment. */
    freeze: (on: boolean) => { engine.app.ticker.speed = on ? 0 : 1; },
    report: () => `${scene.report()}  ${baker.report()}  scn ${standalone.report().mb}MB  ${layout.W}x${layout.H}@${layout.dpr}  ${session.state.phase}`,
  };
}

/**
 * The game's phase names and the angler's pose names are deliberately
 * separate vocabularies — the renderer should not have to know that
 * "retrieving" exists — so one small table maps between them.
 */
function poseFor(phase: string): AnglerPose {
  switch (phase) {
    case 'casting': return 'casting';
    case 'waiting': return 'waiting';
    case 'biting': return 'biting';
    case 'reeling': case 'bossfight': return 'reeling';
    case 'caught': return 'caught';
    case 'retrieving': return 'lost';
    default: return 'idle';
  }
}

/** what the angler is wearing; the equipment screen will drive this later */
function session0Look(): { outfit: string; hat: string; rodSkin: string; bobber: string } {
  return { outfit: 'standard', hat: 'none', rodSkin: 'standard', bobber: 'standard' };
}

/** the session's view plus the clock, in the shape the HUD wants */
function hudStateFrom(session: Session, dayTime: number): HudState {
  const v = session.view();
  const minutes = Math.floor(dayTime * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const night = dayTime < 0.22 || dayTime > 0.78;
  return {
    coins: v.coins,
    gems: v.gems,
    clock: `${hh}:${mm}`,
    timeOfDay: night ? 'night' : dayTime > 0.68 ? 'dusk' : 'day',
    level: v.level,
    anglerTitle: v.title,
    xp: v.xp,
    xpToNext: v.xpNeeded,
    rod: { name: 'Holzrute' },
    bait: { name: 'Regenwurm' },
  };
}

function clampInt(v: string | null, dflt: number, lo: number, hi: number): number {
  const n = v === null ? dflt : parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
