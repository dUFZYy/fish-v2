/**
 * ambience.ts — per-location ambience layers: water lapping, rain, wind,
 * birds, and a deep-sea drone.
 *
 * Ported in spirit from the OLD game's `Music.startAmbience()`/`Music.bird()`
 * (music.js, docs/spec/06-audio-build-infra.md §2), which only had two
 * continuous layers (water, rain) plus occasional bird chirps, all built
 * from a freshly-`createBuffer()`'d noise buffer at `startAmbience()` time.
 *
 * Rebuilt here as four continuous generators (water, rain, wind, a deep-sea
 * drone) permanently connected to the engine's `amb` bus, each built ONCE
 * from the engine's pre-rendered noise buffers (`audio.noise.white/pink/
 * brown`, from src/audio/engine.ts) — never allocating an AudioBuffer at
 * play time. Only their gains and filter frequencies move afterwards (slow
 * LFOs for organic movement, plus direct automation from the exported
 * setters), which is cheap: no new nodes, no GC churn.
 *
 * Bird chirps are the one inherently one-shot element (a melodic pitch
 * sweep, not a drone) — they use a couple of short-lived OscillatorNodes per
 * chirp, no AudioBuffer, triggered by a low-rate probability timer.
 *
 * This module owns no AudioContext and no bus — both are src/audio/engine.ts's.
 */

import { audio } from './engine';

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface Layer {
  src: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface AmbienceNodes {
  water: Layer;
  deep: Layer;
  rain: Layer;
  wind: Layer;
  waterLfo: OscillatorNode;
  waterLfoGain: GainNode;
  windLfo: OscillatorNode;
  windLfoGain: GainNode;
}

interface Profile {
  /** Base water-lapping level for this location. */
  water: number;
  /** Whether the low deep-sea drone plays instead of/alongside water. */
  deepDrone: boolean;
  /** Whether rain patter is audible here at all (deep sea/hub/ice: no). */
  rainAllowed: boolean;
  /** Whether birds may chirp here at all (deep sea/hub/boat locations: no). */
  birdsAllowed: boolean;
  /** Baseline wind level for this location, independent of setWind(). */
  windBase: number;
}

const PROFILES: Record<string, Profile> = {
  see: { water: 0.25, deepDrone: false, rainAllowed: true, birdsAllowed: true, windBase: 0.10 },
  boot: { water: 0.25, deepDrone: false, rainAllowed: true, birdsAllowed: false, windBase: 0.18 },
  kueste: { water: 0.25, deepDrone: false, rainAllowed: true, birdsAllowed: true, windBase: 0.20 },
  riff: { water: 0.25, deepDrone: false, rainAllowed: true, birdsAllowed: false, windBase: 0.10 },
  tiefsee: { water: 0.10, deepDrone: true, rainAllowed: false, birdsAllowed: false, windBase: 0 },
  arktis: { water: 0.25, deepDrone: false, rainAllowed: false, birdsAllowed: true, windBase: 0.45 },
  hub: { water: 0.12, deepDrone: false, rainAllowed: false, birdsAllowed: false, windBase: 0 },
};
const DEFAULT_PROFILE: Profile = PROFILES.see!;

/** How often the bird-chirp probability check runs, in ms. */
const BIRD_CHECK_MS = 1200;
/** Chance of a chirp per check when birds are allowed — averages roughly one chirp every ~8s. */
const BIRD_CHANCE = 0.15;

let nodes: AmbienceNodes | null = null;
let currentId = 'see';
let currentNight = false;
let rainLevel = 0;
let windLevel = 0;
let birdTimer: number | null = null;

function makeLoop(ctx: AudioContext, buffer: AudioBuffer, filterType: BiquadFilterType, freq: number, initialGain: number, dest: AudioNode): Layer {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = initialGain;
  src.connect(filter).connect(gain).connect(dest);
  src.start();
  return { src, filter, gain };
}

function ensureBuilt(): AmbienceNodes | null {
  if (nodes) return nodes;
  const ctx = audio.ctx;
  const bus = audio.bus('amb');
  if (!ctx || !bus) return null;

  // Water: brown noise, low-passed, with a slow LFO on its own gain so the
  // lapping never sits perfectly still.
  const water = makeLoop(ctx, audio.noise.brown, 'lowpass', 400, 0, bus);
  const waterLfo = ctx.createOscillator();
  waterLfo.frequency.value = 0.08;
  const waterLfoGain = ctx.createGain();
  waterLfoGain.gain.value = 0.06;
  waterLfo.connect(waterLfoGain).connect(water.gain.gain);
  waterLfo.start();

  // Deep-sea drone: the same brown noise buffer, played back slower and
  // filtered lower — a distinct low rumble without allocating a new buffer.
  const deep = makeLoop(ctx, audio.noise.brown, 'lowpass', 150, 0, bus);
  deep.src.playbackRate.value = 0.55;

  // Rain: white noise, low-passed to a patter.
  const rain = makeLoop(ctx, audio.noise.white, 'lowpass', 1800, 0, bus);

  // Wind: pink noise, with a slow LFO sweeping the filter for gusts.
  const wind = makeLoop(ctx, audio.noise.pink, 'lowpass', 900, 0, bus);
  const windLfo = ctx.createOscillator();
  windLfo.frequency.value = 0.05;
  const windLfoGain = ctx.createGain();
  windLfoGain.gain.value = 250;
  windLfo.connect(windLfoGain).connect(wind.filter.frequency);
  windLfo.start();

  nodes = { water, deep, rain, wind, waterLfo, waterLfoGain, windLfo, windLfoGain };
  startBirdTimer();
  applyAll();
  return nodes;
}

function profile(): Profile {
  return PROFILES[currentId] ?? DEFAULT_PROFILE;
}

function applyAll(): void {
  applyWaterAndDeep();
  applyRain();
  applyWind();
}

function applyWaterAndDeep(): void {
  if (!nodes) return;
  const p = profile();
  const t = audio.now;
  nodes.water.gain.gain.setTargetAtTime(p.water, t, 1.5);
  nodes.deep.gain.gain.setTargetAtTime(p.deepDrone ? 0.22 : 0, t, 1.5);
}

function applyRain(): void {
  if (!nodes) return;
  const p = profile();
  const t = audio.now;
  const target = p.rainAllowed ? rainLevel * 0.35 : 0;
  nodes.rain.gain.gain.setTargetAtTime(target, t, 2);
}

function applyWind(): void {
  if (!nodes) return;
  const p = profile();
  const t = audio.now;
  const target = Math.max(p.windBase, windLevel) * 0.3;
  nodes.wind.gain.gain.setTargetAtTime(target, t, 1.5);
}

function startBirdTimer(): void {
  if (birdTimer !== null) return;
  birdTimer = window.setInterval(() => {
    if (!nodes) return;
    const p = profile();
    if (!p.birdsAllowed || currentNight || rainLevel > 0.4) return;
    if (Math.random() < BIRD_CHANCE) bird();
  }, BIRD_CHECK_MS);
}

/** 2-4 short pitch-swept sine chirps — verbatim shape from Music.bird(). */
function bird(): void {
  const ctx = audio.ctx;
  const bus = audio.bus('amb');
  if (!ctx || !bus) return;
  const t0 = audio.now;
  const base = rand(1800, 3200);
  const chirps = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < chirps; i++) {
    const t = t0 + i * 0.13;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.6), t + 0.06);
    o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.15);
  }
}

/** Sets the active location's ambience profile (water level, rain/bird/drone eligibility). `night` gates birds off. */
export function setAmbience(id: string, night: boolean): void {
  currentId = id;
  currentNight = night;
  ensureBuilt();
  applyAll();
}

/** 0..1 rain intensity, e.g. driven by the weather system. Silenced automatically where `rainAllowed` is false (deep sea, hub, arctic snow). */
export function setRain(v: number): void {
  rainLevel = clamp01(v);
  ensureBuilt();
  applyRain();
}

/** 0..1 wind intensity on top of the location's baseline. */
export function setWind(v: number): void {
  windLevel = clamp01(v);
  ensureBuilt();
  applyWind();
}

/** Silences all ambience layers and stops bird chirps. The underlying loop sources are kept alive (a stopped AudioBufferSourceNode cannot restart) — calling setAmbience()/setRain()/setWind() again revives them. */
export function stop(): void {
  if (birdTimer !== null) {
    window.clearInterval(birdTimer);
    birdTimer = null;
  }
  if (!nodes) return;
  const t = audio.now;
  for (const layer of [nodes.water, nodes.deep, nodes.rain, nodes.wind]) {
    layer.gain.gain.setTargetAtTime(0, t, 0.3);
  }
}
