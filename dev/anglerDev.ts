/**
 * Angler dev page — assembles the real `Angler` class over a plain water
 * line and a real dock bake, with a pose per button and live sliders for
 * light/tension/aim, so the assembly (arm on shoulder, hat on head, rod in
 * hand, line from the rod tip) can be judged in an actual browser instead of
 * read off the source. Served by Vite at /dev/angler.html — not part of the
 * game bundle.
 */

import { Application } from 'pixi.js';
import { layout, measureLayout } from '@/engine/layout';
import { baker } from '@/bake/baker';
import { Scene, type SceneArt, type BakeFn } from '@/world/scene';
import { makeDock, DOCK_W_FRAC } from '@/game/lake';
import { Angler, type AnglerPose, type AnglerState } from '@/world/angler';

const gameHost = document.getElementById('game')!;

async function boot(): Promise<void> {
  measureLayout();
  layout.W = Math.max(280, gameHost.clientWidth || layout.W);
  layout.H = Math.max(400, gameHost.clientHeight || layout.H);
  layout.dpr = Math.min(window.devicePixelRatio || 1, 2);

  const app = new Application();
  await app.init({
    background: '#0b2636',
    resolution: layout.dpr,
    autoDensity: true,
    width: layout.W,
    height: layout.H,
    antialias: false,
    hello: false,
  });
  gameHost.appendChild(app.canvas);

  // A plain sky/water gradient — no scenery bakes, just enough to see the
  // horizon and the water pass the angler and his reflection sit against.
  const art: SceneArt = {
    id: 'dev:angler',
    gradient(_light: number, horizonFrac: number): BakeFn {
      return (ctx, w, h) => {
        const split = Math.round(h * horizonFrac);
        const sky = ctx.createLinearGradient(0, 0, 0, split);
        sky.addColorStop(0, '#5fb6e8');
        sky.addColorStop(1, '#bfe9ff');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, split);
        const water = ctx.createLinearGradient(0, split, 0, h);
        water.addColorStop(0, '#2f7fa3');
        water.addColorStop(1, '#0c2c3c');
        ctx.fillStyle = water;
        ctx.fillRect(0, split, w, h - split);
      };
    },
    waterTop: () => [0.37, 0.66, 0.79],
    waterBottom: () => [0.11, 0.31, 0.42],
  };

  const scene = new Scene(baker.sprites.textureSource, layout.W, layout.H);
  app.stage.addChild(scene.root);
  scene.setArt(art, 1);

  const dock = makeDock(scene.horizonY, 1);
  scene.nearProps.addChild(dock);

  const state: AnglerState = {
    pose: 'idle', light: 1, aimX: 0.74, aimY: 0.42,
    bobberX: null, bobberY: null, tension: 0, holding: false,
  };
  const angler = new Angler(scene, { outfit: 'klassisch', hat: 'angler', rodSkin: 'holz', bobber: 'classic' });
  (window as unknown as Record<string, unknown>).__dbg = { scene, angler, dock, layout };

  // --- bobber-out toggle: parks the bobber a bit out on the water so the
  // line/bobber/hook assembly can be checked too ---
  const dockW = Math.round(layout.W * DOCK_W_FRAC);
  const bobberOutEl = document.getElementById('bobberOut') as HTMLInputElement;
  const syncBobber = () => {
    if (bobberOutEl.checked) {
      state.bobberX = (layout.W - dockW) * 0.35;
      state.bobberY = scene.horizonY + 70;
    } else {
      state.bobberX = null;
      state.bobberY = null;
    }
  };
  bobberOutEl.addEventListener('change', syncBobber);

  const reflOnEl = document.getElementById('reflOn') as HTMLInputElement;
  reflOnEl.addEventListener('change', () => { scene.reflectionLayer.visible = reflOnEl.checked; });

  // --- pose buttons ---
  const poses: AnglerPose[] = ['idle', 'aiming', 'casting', 'waiting', 'biting', 'reeling', 'caught', 'lost'];
  const posesHost = document.getElementById('poses')!;
  const poseButtons = new Map<AnglerPose, HTMLButtonElement>();
  for (const p of poses) {
    const b = document.createElement('button');
    b.textContent = p;
    b.addEventListener('click', () => {
      state.pose = p;
      for (const [pp, el] of poseButtons) el.classList.toggle('active', pp === p);
    });
    posesHost.appendChild(b);
    poseButtons.set(p, b);
  }
  poseButtons.get('idle')!.classList.add('active');

  // --- sliders ---
  const slidersHost = document.getElementById('sliders')!;
  function slider(label: string, min: number, max: number, value: number, step: number, fn: (v: number) => void): void {
    const l = document.createElement('label');
    l.className = 'row';
    const s = document.createElement('span');
    s.textContent = label;
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
    const o = document.createElement('output');
    o.textContent = value.toFixed(2);
    i.addEventListener('input', () => {
      const v = parseFloat(i.value);
      o.textContent = v.toFixed(2);
      fn(v);
    });
    l.append(s, i, o);
    slidersHost.appendChild(l);
  }
  slider('Licht', 0, 1, state.light, 0.01, (v) => { state.light = v; });
  slider('Zug', 0, 1, state.tension, 0.01, (v) => { state.tension = v; });
  slider('Aim X', 0, 1, state.aimX, 0.01, (v) => { state.aimX = v; });
  slider('Aim Y', 0, 1, state.aimY, 0.01, (v) => { state.aimY = v; });

  const holdingHost = document.createElement('label');
  holdingHost.className = 'check';
  const holdingBox = document.createElement('input');
  holdingBox.type = 'checkbox';
  holdingHost.append(holdingBox, document.createTextNode(' Halten (Drill)'));
  slidersHost.appendChild(holdingHost);
  holdingBox.addEventListener('change', () => { state.holding = holdingBox.checked; });

  // --- loop ---
  const readout = document.getElementById('readout')!;
  let time = 0;
  app.ticker.maxFPS = 0;
  app.ticker.add((ticker) => {
    const dt = Math.min(ticker.deltaMS, 100) / 1000;
    time += dt;

    scene.update(dt, {
      light: state.light,
      time,
      sun: [layout.W * 0.3, layout.H * 0.14, 40, state.light],
      lookX: 0,
      lookY: 0,
      tier: 2,
    });
    angler.update(dt, time, state);

    const tip = angler.rodTip;
    readout.textContent =
      `pose      ${state.pose}\n` +
      `light     ${state.light.toFixed(2)}\n` +
      `tension   ${state.tension.toFixed(2)}\n` +
      `aim       ${state.aimX.toFixed(2)}, ${state.aimY.toFixed(2)}\n` +
      `bobber    ${state.bobberX === null ? 'null' : `${state.bobberX.toFixed(0)}, ${state.bobberY!.toFixed(0)}`}\n` +
      `rod tip   ${tip.x.toFixed(1)}, ${tip.y.toFixed(1)}\n` +
      `horizonY  ${scene.horizonY}\n` +
      `bakes/f   ${baker.rebakesPerFrame}`;
  });

  window.addEventListener('resize', () => {
    layout.W = Math.max(280, gameHost.clientWidth || layout.W);
    layout.H = Math.max(400, gameHost.clientHeight || layout.H);
    app.renderer.resize(layout.W, layout.H);
    scene.resize(layout.W, layout.H);
  });
}

void boot();
