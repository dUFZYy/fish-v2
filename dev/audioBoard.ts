/**
 * Dev soundboard. Audio is the one part of a game that cannot be verified by
 * looking at it or by a type checker, so it gets a page where every sound is
 * one tap away and the mix controls are live.
 *
 * Served by Vite at /dev/audio.html — not part of the game bundle.
 */

import { audio, type BusName } from '../src/audio/engine';
import { sfx, TensionVoice, panFor } from '../src/audio/sfx';
import { measureAudio } from './audioMeasure';

const board = document.getElementById('board')!;
const stateEl = document.getElementById('state')!;

audio.attachLifecycle();
audio.init();

function section(title: string): HTMLDivElement {
  const h = document.createElement('h2');
  h.textContent = title;
  board.appendChild(h);
  const g = document.createElement('div');
  g.className = 'grid';
  board.appendChild(g);
  return g;
}

function btn(host: HTMLElement, label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('pointerdown', () => { audio.init(); fn(); });
  host.appendChild(b);
}

function slider(label: string, min: number, max: number, value: number, step: number, fn: (v: number) => void): void {
  const l = document.createElement('label');
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
    audio.init();
    fn(v);
  });
  l.append(s, i, o);
  board.appendChild(l);
}

// --------------------------------------------------------------- the sounds

const water = section('Wasser');
btn(water, 'plop (Köder)', () => sfx.plop(panFor(Math.random())));
btn(water, 'splash klein', () => sfx.splash(0, 0.3));
btn(water, 'splash groß', () => sfx.splash(0, 1));
btn(water, 'Blase', () => sfx.bubble(panFor(Math.random())));
btn(water, 'links', () => sfx.plop(-0.7));
btn(water, 'rechts', () => sfx.plop(0.7));

const rod = section('Rute und Schnur');
btn(rod, 'Wurf', () => sfx.cast());
btn(rod, 'Rollen-Klick', () => sfx.reelClick());
btn(rod, 'Rollen-Lauf', () => { for (let i = 0; i < 14; i++) window.setTimeout(() => sfx.reelClick(), i * 65); });
btn(rod, 'Anknabbern', () => sfx.nibble());
btn(rod, 'BISS', () => sfx.bite());
btn(rod, 'Schnur reißt', () => sfx.snap());
btn(rod, 'Fisch entwischt', () => sfx.escape());
btn(rod, 'Harpune (voll)', () => sfx.harpoon(1));
btn(rod, 'Harpune (kurz)', () => sfx.harpoon(0.25));

const win = section('Belohnung');
for (const [i, name] of ['Gewöhnlich', 'Häufig', 'Selten', 'Episch', 'Legendär'].entries()) {
  btn(win, `Fang: ${name}`, () => sfx.catchJingle(i));
}
btn(win, 'Münze', () => sfx.coin(0));
btn(win, 'Münzregen', () => { for (let i = 0; i < 10; i++) window.setTimeout(() => sfx.coin(i), i * 70); });
btn(win, 'Stufenaufstieg', () => sfx.levelUp());

const ui = section('Oberfläche');
btn(ui, 'Klick', () => sfx.click());
btn(ui, 'Kauf', () => sfx.buy());
btn(ui, 'Abgelehnt', () => sfx.denied());
btn(ui, 'Tick', () => sfx.tick());
btn(ui, 'Timer-Ticks', () => {
  for (let i = 0; i < 20; i++) window.setTimeout(() => sfx.urgentTick(i / 19), i * (110 - i * 4));
});

const world = section('Welt');
btn(world, 'Möwe', () => sfx.gull(panFor(Math.random())));
btn(world, 'Donner fern', () => sfx.thunder(0.9));
btn(world, 'Donner nah', () => sfx.thunder(0.1));

// ------------------------------------------------------------ the drill voice

const tension = new TensionVoice();
const drill = section('Drill-Spannung (Dauerklang)');
btn(drill, 'Start', () => { tension.start(); });
btn(drill, 'Stop', () => { tension.stop(); });
btn(drill, 'Auto: bis zum Riss', () => {
  tension.start();
  let t = 0;
  const id = window.setInterval(() => {
    t += 0.02;
    tension.set(t);
    if (t >= 1) { window.clearInterval(id); sfx.snap(); tension.stop(); }
  }, 60);
});

const h2 = document.createElement('h2');
h2.textContent = 'Mischung';
board.appendChild(h2);
slider('Spannung 0..1', 0, 1, 0, 0.01, (v) => tension.set(v));
slider('unter Wasser 0..1', 0, 1, 0, 0.01, (v) => audio.setSubmerged(v));
for (const bus of ['master', 'sfx', 'ui', 'amb', 'music'] as Array<BusName | 'master'>) {
  slider(bus, 0, 1, audio.getVolume(bus), 0.01, (v) => audio.setVolume(bus, v));
}

const mix = section('Prüfungen');
btn(mix, 'Stumm an/aus', () => audio.setMuted(!audio.muted));
btn(mix, 'Ducking zeigen', () => audio.duck(0.6, 1.2));
btn(mix, 'Übersteuerung?', () => {
  // Everything loud at once. On the old game's straight-to-destination wiring
  // this summed past 1.0 and clipped; here the master limiter should hold it.
  sfx.catchJingle(4);
  sfx.splash(0, 1);
  for (let i = 0; i < 10; i++) window.setTimeout(() => sfx.coin(i), i * 40);
  sfx.levelUp();
});

window.setInterval(() => {
  const c = audio.ctx;
  stateEl.textContent = c
    ? `Kontext: ${c.state}   Abtastrate: ${c.sampleRate} Hz   Latenz: ${(c.baseLatency * 1000).toFixed(1)} ms\n` +
      `unter Wasser: ${audio.submerged.toFixed(2)}   stumm: ${audio.muted}`
    : 'kein AudioContext — einmal tippen';
}, 300);

// --- measurement: the only way to catch a silent or clipping sound ---
const meas = section('Messung');
btn(meas, 'Alle Klänge messen', async () => {
  stateEl.textContent = 'messe ...';
  const rows = await measureAudio();
  const pad = (v: unknown, n: number) => String(v).padEnd(n);
  const header = pad('Klang', 20) + pad('peak', 8) + pad('rms', 9)
    + pad('atk ms', 8) + pad('hell>dunkel', 12) + 'Befund';
  const body = rows.map((r) => pad(r.name, 20) + pad(r.peak, 8) + pad(r.rms, 9)
    + pad(r.attackMs, 8) + pad(r.fall, 12) + r.verdict);
  stateEl.textContent = [header, ...body].join('\n');
  console.table(rows);
});
