import { engine } from '@/engine/app';
import { baker } from '@/bake/baker';
import { standalone } from '@/bake/standalone';
import { Scene } from '@/world/scene';
import { Shoal } from '@/world/shoal';
import { Tackle } from '@/world/tackle';
import { layout } from '@/engine/layout';
import { LAKE, lakeArt, makeDock, setSkyPhase, skyStateFor, DAY_SECONDS } from './lake';
import { Session } from './session';
import { audio } from '@/audio/engine';
import { sfx, panFor } from '@/audio/sfx';
import { Hud, type HudState } from '@/ui/hud';

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

  const scene = new Scene(baker.sprites.textureSource, engine.W, engine.H, {
    onCoinArrive: (i) => sfx.coin(i),
  });
  engine.world.addChild(scene.root);
  if (!waterOn) scene.water.mesh.visible = false;

  const art = lakeArt(LAKE);
  let dayTime = frozenDay ?? 0.42;
  setSkyPhase(dayTime);
  scene.setArt(art, skyStateFor(dayTime, engine.W, engine.H, LAKE).light);

  // The dock is a placed sprite in the near parallax group, not part of the
  // screen-sized near bake — see makeDock for why.
  let dock = makeDock(scene.horizonY, skyStateFor(dayTime, engine.W, engine.H, LAKE).light);
  scene.nearProps.addChild(dock);

  const shoal = new Shoal(scene, { count, distantCount: distant });
  shoal.setLocation(LAKE.id, false);

  const tackle = new Tackle(scene);

  // --- the HUD, as small DOM elements over the canvas ---------------------
  const uiHost = document.getElementById('ui')!;
  const hud = new Hud(uiHost, {
    onMenu: () => hud.toast('Menü folgt'),
  });

  // --- the session: the only place a game event becomes a sound ------------
  const session = new Session(scene, shoal, {
    onToast: (text) => hud.toast(text),
    onLost: (text) => hud.toast(text),
    onCatch: (r, sp) => {
      hud.toast(`${sp.nameDe} · ${r.kg.toFixed(2)} kg · +${r.coins}`);
    },
    onLevelUp: (lvl, title) => hud.toast(`Stufe ${lvl} — ${title}`),
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
    const sky = skyStateFor(dayTime, engine.W, engine.H, LAKE);
    const wBot = art.waterBottom(sky.light);

    session.update(dt);
    shoal.update(dt, t, sky.light, wBot);

    const st = session.state;
    const tip = { x: engine.W * 0.72, y: scene.horizonY - 62 };
    const lineOut = st.phase !== 'ready' && st.phase !== 'casting';
    tackle.update(t, {
      tipX: tip.x,
      tipY: tip.y,
      bobberX: lineOut ? st.bobberX : null,
      bobberY: lineOut ? st.bobberY : null,
      hookX: st.hookX,
      hookY: st.hookY,
      tension: st.reel?.tension ?? 0,
      fighting: st.phase === 'reeling' || st.phase === 'biting',
      lureRadius: session.view().lureRadius,
      light: sky.light,
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

    hud.update(hudStateFrom(session, dayTime));
  });

  let lookX = 0;

  // --- input: one tap does everything, as in the old game -----------------
  engine.app.stage.eventMode = 'static';
  engine.app.stage.hitArea = { contains: () => true };
  engine.app.stage.on('pointerdown', (e: { global: { x: number; y: number } }) => {
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
    scene, shoal, session, tackle, hud, baker, standalone, engine,
    /** dev only: freeze the simulation while still rendering, so a still
     *  frame can be captured of a state that only lasts a moment. */
    freeze: (on: boolean) => { engine.app.ticker.speed = on ? 0 : 1; },
    report: () => `${scene.report()}  ${baker.report()}  scn ${standalone.report().mb}MB  ${layout.W}x${layout.H}@${layout.dpr}  ${session.state.phase}`,
  };
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
