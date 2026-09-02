import { engine } from '@/engine/app';
import { baker } from '@/bake/baker';
import { standalone } from '@/bake/standalone';
import { Scene } from '@/world/scene';
import { Shoal } from '@/world/shoal';
import { layout } from '@/engine/layout';
import { LAKE, lakeArt, makeDock, setSkyPhase, skyStateFor, DAY_SECONDS } from './lake';
import { audio } from '@/audio/engine';
import { sfx, panFor } from '@/audio/sfx';

/**
 * The lake, standing up.
 *
 * This is the first build in which the real content meets the real renderer:
 * the ported scenery, the ported species with their own body shapes, the
 * water pass, the particles. No gameplay yet — the state machine, drill and
 * catch are ported and tested but not wired, which is the next step.
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
  setSkyPhase(frozenDay ?? 0.42);
  scene.setArt(art, skyStateFor(frozenDay ?? 0.42, engine.W, engine.H, LAKE).light);

  // The dock is a placed sprite in the near parallax group, not part of the
  // screen-sized near bake — see makeDock for why.
  let dock = makeDock(scene.horizonY, skyStateFor(frozenDay ?? 0.42, engine.W, engine.H, LAKE).light);
  scene.nearProps.addChild(dock);

  const shoal = new Shoal(scene, { count, distantCount: distant });
  shoal.setLocation(LAKE.id, false);

  // --- the day clock -------------------------------------------------------
  // 300 seconds per in-game day, as in the old game. The palette is resolved
  // from the phase, the scene quantises the resulting light to 64 steps for
  // its cache, and the bakes are handed that same quantised value — if the
  // two disagreed, the baked hills would be lit differently from the live
  // grass in front of them and the seam would show exactly at that edge.
  let dayTime = frozenDay ?? 0.42;

  // --- ambient life --------------------------------------------------------
  // A bubble now and then, and a ripple where a fish breaks the surface.
  // Cheap, and it is what stops still water looking like a photograph.
  let bubbleTimer = 0;

  engine.onUpdate((dt, t) => {
    if (frozenDay === null) {
      dayTime = (dayTime + dt / DAY_SECONDS) % 1;
      setSkyPhase(dayTime);
    }
    const sky = skyStateFor(dayTime, engine.W, engine.H, LAKE);

    const wBot = art.waterBottom(sky.light);
    shoal.update(dt, t, sky.light, wBot);

    bubbleTimer -= dt;
    if (bubbleTimer <= 0) {
      bubbleTimer = 0.5 + Math.random() * 1.6;
      const x = Math.random() * engine.W;
      const y = scene.horizonY + 60 + Math.random() * (engine.H - scene.horizonY - 80);
      scene.particles.bubbles(x, y, 2 + Math.floor(Math.random() * 3));
      if (Math.random() < 0.25 && audio.ready) sfx.bubble(panFor(x / engine.W));
    }

    scene.update(dt, {
      light: sky.light,
      time: t,
      sun: sky.sun,
      // The look drifts slowly, which is what makes the parallax read as a
      // camera rather than as a slide. The game will drive this from the
      // bobber once casting is wired.
      lookX: Math.sin(t * 0.07) * 14,
      lookY: Math.sin(t * 0.05) * 5,
      tier: engine.qualityTier,
    });
  });

  // --- one tap makes a splash, so the build is visibly alive ---------------
  engine.app.stage.eventMode = 'static';
  engine.app.stage.hitArea = { contains: () => true };
  engine.app.stage.on('pointerdown', (e: { global: { x: number; y: number } }) => {
    const x = e.global.x;
    const y = e.global.y;
    audio.init();
    if (y < scene.horizonY) return;
    const surface = scene.waveAt(x, 0);
    scene.particles.splash(x, surface, 14, 1);
    scene.particles.ripple(x, surface, 44, 2);
    scene.shake.add(2);
    sfx.plop(panFor(x / engine.W));
  });

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
    scene, shoal, baker, standalone,
    report: () => `${scene.report()}  ${baker.report()}  scn ${standalone.report().mb}MB  ${layout.W}x${layout.H}@${layout.dpr}`,
  };
}

function clampInt(v: string | null, dflt: number, lo: number, hi: number): number {
  const n = v === null ? dflt : parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
