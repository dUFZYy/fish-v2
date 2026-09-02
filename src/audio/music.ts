/**
 * music.ts — procedural ambient music generator.
 *
 * Ported from the OLD game's `Music` object (`music.js`, 504 lines, copied
 * verbatim in docs/spec/06-audio-build-infra.md §2). Kept unchanged from the
 * original: the `SCALES`/`MOODS` tables (all moods, incl. `hub` and `boss`),
 * the chord progressions and motifs, swing, the 5-section arrangement cycle,
 * the Karplus-Strong plucked string synth (cache + 4 reference pitches +
 * nylon/steel timbres), the boss kick/tom drums, and the wow/flutter +
 * tanh saturation character.
 *
 * Changed from the original, because the old version could not do these:
 *
 *  - Routes through the engine's `music` bus and its two shared reverbs
 *    (`audio.connectVoice`) instead of owning a private master gain and a
 *    private convolver.
 *  - Crossfades on `setMood()` over ~2s instead of a hard cut: this is done
 *    with two alternating "slots" (each a full pad/pluck/perc/filter chain).
 *    The old mood keeps playing out of its slot while its gain ramps to 0;
 *    the new mood is scheduled into the other slot from gain 0 up to 1. The
 *    look-ahead scheduler (see below) keeps ticking throughout — there is no
 *    stop/restart of the beat clock across a mood change.
 *  - `setIntensity(0..1)` replaces the old `fight` (boss-only in spirit,
 *    even though the old code technically fed it from any drill) with one
 *    explicit, generalised knob: it opens the filter, shortens chords,
 *    forces the dense arrangement section, drives the bass "heartbeat"
 *    pulse, and speeds up the boss drums. `calm -> bite -> drill -> catch`
 *    is now the caller ramping this one number.
 *  - Notes are scheduled on a look-ahead timer (~150ms horizon, ticked every
 *    ~50ms via a plain interval) using absolute AudioContext time stamps,
 *    instead of depending on being polled every animation frame. A dropped
 *    or delayed frame no longer means a dropped or delayed note.
 *
 * This module owns no AudioContext, no master gain, no convolver — all of
 * that is `src/audio/engine.ts`'s. It only builds the instrument graph and
 * feeds the engine's `music` bus via `audio.connectVoice`.
 */

import { audio } from './engine';

// ---------------------------------------------------------------------------
// Tables — verbatim from music.js (docs/spec/06-audio-build-infra.md §2)
// ---------------------------------------------------------------------------

type ScaleName = 'major' | 'minor' | 'dorian' | 'mystic';

/** Skalen (Halbtöne über Grundton) — verbatim. */
const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
  dorian: [0, 2, 5, 7, 9],
  mystic: [0, 2, 3, 7, 8],
};

type LeadTimbre = 'nylon' | 'pluck' | 'marimba' | 'bell' | 'flute';
type PercKind = 'shaker' | 'woodblock' | 'drip' | null;

export type MoodId = 'see' | 'boot' | 'kueste' | 'riff' | 'tiefsee' | 'arktis' | 'hub' | 'boss';

interface MoodDef {
  readonly root: number;
  readonly scale: ScaleName;
  readonly chord: number;
  readonly cutoff: number;
  readonly pluckRate: number;
  readonly lead: LeadTimbre;
  readonly perc: PercKind;
  readonly percRate: number;
  readonly prog: readonly number[];
  readonly motif: readonly (readonly [number, number])[];
  readonly swing: number;
}

/** je Ort: Grundton (Hz), Skala, Tempo (s pro Akkord), Farbe (Filter Hz), Motiv, Leadinstrument, Akkordfolge — verbatim. */
const MOODS: Record<MoodId, MoodDef> = {
  see: {
    root: 220.0, scale: 'major', chord: 5.5, cutoff: 1600, pluckRate: 0.3, lead: 'nylon', perc: 'shaker', percRate: 0.5,
    prog: [0, 3, 1, 4], motif: [[0, 1], [2, 1], [4, 2], [2, 1], [1, 3]], swing: 0.55,
  },
  boot: {
    root: 196.0, scale: 'dorian', chord: 6.5, cutoff: 1300, pluckRate: 0.3, lead: 'pluck', perc: 'woodblock', percRate: 0.4,
    prog: [0, -2, 2, 1], motif: [[4, 2], [2, 1], [0, 1], [2, 2], [4, 1], [5, 3]], swing: 0.62,
  },
  kueste: {
    root: 246.9, scale: 'major', chord: 5, cutoff: 2000, pluckRate: 0.4, lead: 'flute', perc: 'shaker', percRate: 0.75,
    prog: [0, 4, 2, 3], motif: [[2, 1], [4, 1], [5, 1], [4, 2], [2, 1], [0, 2]], swing: 0.5,
  },
  riff: {
    root: 261.6, scale: 'major', chord: 4.5, cutoff: 2600, pluckRate: 0.5, lead: 'marimba', perc: 'woodblock', percRate: 1,
    prog: [0, 2, 5, 3], motif: [[0, 1], [2, 1], [4, 1], [6, 1], [5, 1], [4, 1], [2, 2]], swing: 0.58,
  },
  tiefsee: {
    root: 146.8, scale: 'mystic', chord: 9, cutoff: 800, pluckRate: 0.2, lead: 'bell', perc: 'drip', percRate: 0.3,
    prog: [0, -1, -3, 1], motif: [[0, 3], [3, 2], [2, 3], [-1, 4]], swing: 0.5,
  },
  arktis: {
    root: 174.6, scale: 'minor', chord: 7.5, cutoff: 1100, pluckRate: 0.25, lead: 'bell', perc: 'shaker', percRate: 0.35,
    prog: [0, 2, -2, 1], motif: [[4, 2], [3, 1], [2, 2], [0, 1], [2, 2]], swing: 0.5,
  },
  hub: {
    root: 293.7, scale: 'major', chord: 3.6, cutoff: 2800, pluckRate: 0.6, lead: 'marimba', perc: 'woodblock', percRate: 1.1,
    prog: [0, 4, 5, 3], motif: [[0, 1], [2, 1], [4, 1], [2, 1], [5, 1], [4, 2]], swing: 0.62,
  },
  boss: {
    root: 130.8, scale: 'minor', chord: 3.4, cutoff: 2200, pluckRate: 0.1, lead: 'pluck', perc: null, percRate: 0,
    prog: [0, 0, -2, -1], motif: [[0, 1], [0, 1], [3, 1], [2, 1]], swing: 0.5,
  },
};

/** Akkordlagen, reihum gespielt — verbatim. */
const VOICINGS: readonly (readonly number[])[] = [[0, 2, 4], [0, 2, 4, 6], [0, 4, 6], [2, 4, 6], [0, 2, 5], [0, 3, 4, 6]];

const KS_REFS: readonly number[] = [110, 220, 440, 880];

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function noteHz(root: number, scale: ScaleName, degree: number, octave = 0): number {
  const s = SCALES[scale];
  const idx = ((degree % s.length) + s.length) % s.length;
  const oct = Math.floor(degree / s.length) + octave;
  return root * Math.pow(2, (s[idx] + 12 * oct) / 12);
}

/** Bandleiern: a few cents of slow pitch wander, evaluated at the note's own scheduled time. */
function driftCents(t: number): number {
  return Math.sin(t * 0.11) * 2.4 + Math.sin(t * 0.29 + 1.7) * 1.3;
}
function driftRate(t: number): number {
  return Math.pow(2, driftCents(t) / 1200);
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Karplus-Strong string buffers, cached per (timbre, reference octave) — never rebuilt per note. */
const ksCache = new Map<string, AudioBuffer>();
/** Short percussion/accent noise bursts, cached per kind — never rebuilt per hit. */
const burstCache = new Map<string, AudioBuffer>();

function getBurst(ctx: AudioContext, key: string, seconds: number, shapePow: number): AudioBuffer {
  const cached = burstCache.get(key);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, shapePow);
  burstCache.set(key, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Scheduling constants
// ---------------------------------------------------------------------------

/** How far ahead notes get scheduled, in seconds. */
const LOOKAHEAD_SEC = 0.15;
/** How often the look-ahead timer ticks, in ms. */
const TICK_MS = 50;
/** setMood() crossfade time, in seconds. */
const CROSSFADE_SEC = 2.0;
/** Time constant for easing `intensity` toward its target, in seconds. */
const INTENSITY_TAU = 0.5;
/** A scheduling cursor further behind "now" than this is snapped forward instead of catching up in a burst (e.g. after a backgrounded tab or a stop()/start() gap). */
const CATCHUP_LIMIT_SEC = 2;

// ---------------------------------------------------------------------------
// One "slot" = one full instrument chain for one mood. Two slots alternate so
// a mood change can crossfade instead of cutting.
// ---------------------------------------------------------------------------

interface Slot {
  moodId: MoodId;
  mood: MoodDef;
  /** Whether the look-ahead scheduler advances this slot. False while a slot only rings out after being faded out by setMood(). */
  active: boolean;

  padGain: GainNode;
  pluckGain: GainNode;
  percGain: GainNode;
  filter: BiquadFilterNode;
  wow: DelayNode;
  wowLfo: OscillatorNode;
  wowLfoGain: GainNode;
  /** Per-slot crossfade gain: 0..1, ramped by setMood(). */
  layerGain: GainNode;

  // scheduling cursors — absolute AudioContext time stamps
  nextChord: number;
  chordIdx: number;
  section: number;
  sectionChord: number;
  nextPluck: number;
  nextPerc: number;
  nextDrum: number;
  drumStep: number;
  nextPulse: number;
  /** 0 = none pending; otherwise the scheduled time for the single "breathe" answer-tone. */
  breatheAt: number;
}

class MusicEngine {
  private built = false;
  private running = false;
  private timer: number | null = null;
  private lastTick = 0;

  private sat!: WaveShaperNode;
  private slots: [Slot, Slot] | null = null;
  private currentIdx: 0 | 1 = 0;
  private pendingMoodId: MoodId = 'see';

  private intensity = 0;
  private intensityTarget = 0;
  private night = false;

  private liveVoices = 0;

  /** Live oscillator/buffer-source voice count, for the perf HUD. Persistent infrastructure nodes (gains, filters, the wow LFO) are not counted — this tracks note churn. */
  get voiceCount(): number {
    return this.liveVoices;
  }

  // --------------------------------------------------------------- lifecycle

  start(): void {
    audio.init();
    if (!audio.ctx) return;
    if (!this.built) this.build();
    if (this.running) return;
    this.running = true;
    this.lastTick = 0;
    const t = audio.now;
    const cur = this.slots![this.currentIdx];
    cur.layerGain.gain.cancelScheduledValues(t);
    cur.layerGain.gain.setTargetAtTime(1, t, 0.25);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.built) {
      const t = audio.now;
      for (const s of this.slots!) s.layerGain.gain.setTargetAtTime(0, t, 0.15);
    }
  }

  dispose(): void {
    this.stop();
    if (this.built && this.slots) {
      for (const s of this.slots) {
        s.wowLfo.stop();
        s.padGain.disconnect();
        s.pluckGain.disconnect();
        s.percGain.disconnect();
        s.filter.disconnect();
        s.wow.disconnect();
        s.wowLfo.disconnect();
        s.wowLfoGain.disconnect();
        s.layerGain.disconnect();
      }
      this.sat.disconnect();
    }
    this.built = false;
    this.slots = null;
    this.liveVoices = 0;
    ksCache.clear();
    burstCache.clear();
  }

  // ------------------------------------------------------------- mix control

  setMood(id: MoodId): void {
    if (!this.built) {
      this.pendingMoodId = id;
      return;
    }
    const slots = this.slots!;
    const cur = slots[this.currentIdx];
    if (cur.moodId === id) return;

    const nextIdx: 0 | 1 = this.currentIdx === 0 ? 1 : 0;
    const next = slots[nextIdx];
    const t = audio.now;

    next.moodId = id;
    next.mood = MOODS[id];
    next.active = true;
    next.chordIdx = 0;
    next.section = 1;
    next.sectionChord = 0;
    next.nextChord = t + 0.05;
    next.nextPluck = t + 1.2;
    next.nextPerc = t + 0.05;
    next.nextDrum = t + 0.05;
    next.drumStep = 0;
    next.nextPulse = t;
    next.breatheAt = 0;

    next.layerGain.gain.cancelScheduledValues(t);
    next.layerGain.gain.setValueAtTime(next.layerGain.gain.value, t);
    next.layerGain.gain.linearRampToValueAtTime(1, t + CROSSFADE_SEC);

    cur.layerGain.gain.cancelScheduledValues(t);
    cur.layerGain.gain.setValueAtTime(cur.layerGain.gain.value, t);
    cur.layerGain.gain.linearRampToValueAtTime(0, t + CROSSFADE_SEC);
    cur.active = false;

    this.currentIdx = nextIdx;
  }

  setIntensity(v: number): void {
    this.intensityTarget = clamp01(v);
  }

  setNight(on: boolean): void {
    this.night = on;
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    const ctx = audio.ctx!;

    this.sat = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    const k = 1.7;
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    this.sat.curve = curve;
    this.sat.oversample = '2x';
    // Sends to the engine's shared reverbs instead of an internal convolver.
    audio.connectVoice(this.sat, { bus: 'music', room: 0.28, deep: 0.06 });

    const initial = this.pendingMoodId;
    const slotA = this.buildSlot(initial);
    const slotB = this.buildSlot(initial);
    slotA.layerGain.gain.value = 1;
    slotB.layerGain.gain.value = 0;
    slotB.active = false;
    this.slots = [slotA, slotB];
    this.currentIdx = 0;
    this.built = true;
  }

  private buildSlot(initialMood: MoodId): Slot {
    const ctx = audio.ctx!;
    const m = MOODS[initialMood];

    const padGain = ctx.createGain();
    padGain.gain.value = 1;
    const pluckGain = ctx.createGain();
    pluckGain.gain.value = 1;
    const percGain = ctx.createGain();
    percGain.gain.value = 1;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = m.cutoff;
    filter.Q.value = 0.5;

    // Wow (tape wobble): pad signal runs through a slowly-modulated delay.
    const wow = ctx.createDelay(0.1);
    wow.delayTime.value = 0.018;
    const wowLfo = ctx.createOscillator();
    wowLfo.frequency.value = 0.13;
    const wowLfoGain = ctx.createGain();
    wowLfoGain.gain.value = 0.0006;
    wowLfo.connect(wowLfoGain).connect(wow.delayTime);
    wowLfo.start();

    const layerGain = ctx.createGain();
    layerGain.gain.value = 0;

    padGain.connect(wow);
    wow.connect(filter);
    pluckGain.connect(filter);
    filter.connect(layerGain);
    // Percussion/drums/pulse bypass the color filter, same as the original.
    percGain.connect(layerGain);
    layerGain.connect(this.sat);

    const now = audio.now;
    return {
      moodId: initialMood,
      mood: m,
      active: true,
      padGain, pluckGain, percGain, filter, wow, wowLfo, wowLfoGain, layerGain,
      nextChord: now + 0.5,
      chordIdx: 0,
      section: 1,
      sectionChord: 0,
      nextPluck: now + 3,
      nextPerc: now,
      nextDrum: now,
      drumStep: 0,
      nextPulse: now,
      breatheAt: 0,
    };
  }

  // -------------------------------------------------------------- scheduler

  private tick(): void {
    if (!audio.ctx || !this.built || !this.slots) return;
    const now = audio.now;
    const dt = this.lastTick > 0 ? Math.max(0, now - this.lastTick) : TICK_MS / 1000;
    this.lastTick = now;

    const k = 1 - Math.exp(-dt / INTENSITY_TAU);
    this.intensity += (this.intensityTarget - this.intensity) * k;
    if (Math.abs(this.intensityTarget - this.intensity) < 0.002) this.intensity = this.intensityTarget;

    const horizon = now + LOOKAHEAD_SEC;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      this.scheduleSlot(slot, now, horizon);
    }
  }

  private scheduleSlot(slot: Slot, now: number, horizon: number): void {
    // Snap far-behind cursors forward instead of bursting a catch-up backlog
    // (e.g. after the tab was backgrounded, or a long stop()/start() gap).
    if (slot.nextChord < now - CATCHUP_LIMIT_SEC) slot.nextChord = now;
    if (slot.nextPerc < now - CATCHUP_LIMIT_SEC) slot.nextPerc = now;
    if (slot.nextDrum < now - CATCHUP_LIMIT_SEC) slot.nextDrum = now;
    if (slot.nextPulse < now - CATCHUP_LIMIT_SEC) slot.nextPulse = now;
    if (slot.nextPluck < now - CATCHUP_LIMIT_SEC) slot.nextPluck = now;

    const m = slot.mood;
    const night = this.night && slot.moodId !== 'boss' && slot.moodId !== 'hub' && this.intensity < 0.5;

    // Intensity opens the filter and brightens it, same shape as the old fight-driven brightening.
    const targetCutoff = m.cutoff * (night ? 0.6 : 1) * (1 + this.intensity * 0.7);
    slot.filter.frequency.setTargetAtTime(targetCutoff, now, 0.6);

    while (slot.nextChord <= horizon) {
      const at = slot.nextChord;
      const prog = m.prog;
      const deg = prog[slot.chordIdx % prog.length] + (night ? -2 : 0);
      slot.chordIdx++;
      const dur = m.chord * (night ? 1.2 : 1) * (1 - this.intensity * 0.42);
      const breathe = slot.section === 0 && slot.sectionChord === 1 && this.intensity < 0.2 && slot.moodId !== 'boss';
      if (breathe) {
        this.pad(slot, deg, dur, at, 0.28);
        slot.breatheAt = at + dur * 0.45;
      } else {
        this.pad(slot, deg, dur, at, 1);
        this.bass(slot, deg, dur, at);
      }
      if (++slot.sectionChord >= 2) {
        slot.sectionChord = 0;
        slot.section = (slot.section + 1) % 5;
      }
      const sec = this.intensity > 0.4 ? 2 : slot.section;
      if (sec >= 1 && !breathe) this.scheduleMelody(slot, deg, dur, sec, at);
      slot.nextChord = at + dur;
      slot.nextPerc = at;
    }

    if (m.perc) {
      const perc = m.perc;
      const percOn = (slot.section >= 2 && slot.section !== 4) || this.intensity > 0.4;
      if (percOn) {
        while (slot.nextPerc <= horizon) {
          const step = (m.chord / 8) / Math.max(0.25, m.percRate) * (1 - this.intensity * 0.4);
          if (Math.random() < 0.85) this.percHit(slot, perc, slot.nextPerc);
          slot.nextPerc += step;
        }
      }
    }

    if (slot.moodId === 'boss') {
      while (slot.nextDrum <= horizon) {
        this.drum(slot, slot.nextDrum);
        const step = this.intensity > 0.66 ? 0.30 : this.intensity > 0.33 ? 0.38 : 0.5;
        slot.nextDrum += step;
      }
    }

    if (this.intensity > 0.25) {
      while (slot.nextPulse <= horizon) {
        this.pulse(slot, slot.nextPulse);
        slot.nextPulse += 0.42;
      }
    }

    if (slot.breatheAt && slot.breatheAt <= horizon) {
      const at = slot.breatheAt;
      slot.breatheAt = 0;
      const deg = [0, 2, 4][Math.floor(Math.random() * 3)]!;
      this.pluck(slot, deg, night ? -1 : 0, at);
    }

    if (slot.section === 0 && !slot.breatheAt) {
      while (slot.nextPluck <= horizon) {
        if (Math.random() < m.pluckRate * (night ? 0.6 : 1)) {
          this.pluck(slot, Math.floor(rand(0, 10)), night ? -1 : 0, slot.nextPluck);
        }
        slot.nextPluck += rand(1.2, 3);
      }
    }
  }

  private trackVoice(node: OscillatorNode | AudioBufferSourceNode): void {
    this.liveVoices++;
    node.onended = () => {
      this.liveVoices = Math.max(0, this.liveVoices - 1);
    };
  }

  // --------------------------------------------------------------- voices

  /** weicher Akkord: langsames Ein-/Ausblenden, leichtes Detune, wechselnde Lage — verbatim shape. */
  private pad(slot: Slot, deg: number, dur: number, at: number, level: number): void {
    const ctx = audio.ctx!;
    const voicing = VOICINGS[slot.chordIdx % VOICINGS.length]!;
    const det0 = driftCents(at);
    voicing.forEach((iv, i) => {
      const f = noteHz(slot.mood.root, slot.mood.scale, deg + iv, i === 0 ? -1 : 0);
      const vol = (i === 0 ? 0.09 : 0.075 / (1 + i * 0.35)) * level;
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = det + det0;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + dur * 0.35);
        g.gain.linearRampToValueAtTime(vol * 0.67, at + dur * 0.7);
        g.gain.linearRampToValueAtTime(0, at + dur * 1.05);
        o.connect(g).connect(slot.padGain);
        this.trackVoice(o);
        o.start(at);
        o.stop(at + dur * 1.1);
      }
    });
  }

  /** Bass: trägt den Akkord — verbatim shape. */
  private bass(slot: Slot, deg: number, dur: number, at: number): void {
    const ctx = audio.ctx!;
    const f = noteHz(slot.mood.root, slot.mood.scale, deg, -2);
    const dc = driftCents(at);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = dc;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    sub.detune.value = dc;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.3, at + 0.25);
    g.gain.linearRampToValueAtTime(0.2, at + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, at + dur * 0.98);
    const sg = ctx.createGain();
    sg.gain.value = 0.5;
    o.connect(g);
    sub.connect(sg).connect(g);
    g.connect(slot.padGain);
    this.trackVoice(o);
    this.trackVoice(sub);
    o.start(at);
    sub.start(at);
    o.stop(at + dur);
    sub.stop(at + dur);
  }

  /** Plant das Motiv über einen Akkord — verbatim shape. */
  private scheduleMelody(slot: Slot, deg: number, dur: number, section: number, chordAt: number): void {
    const beat = dur / 8;
    let t = chordAt + 0.02;
    let i = 0;
    const shift = section === 3 ? 2 : 0;
    const oct = section === 4 ? 1 : 0;
    for (const [step, len] of slot.mood.motif) {
      const swung = i % 2 === 1 ? beat * (slot.mood.swing - 0.5) * 2 : 0;
      const when = t + swung;
      if (t - chordAt < dur - 0.05) this.lead(slot, deg + step + shift, oct, when, beat * len);
      t += beat * len;
      i++;
    }
  }

  /** Leadinstrument — vier Klangfarben (+ Karplus-Strong-Zupfsaite) — verbatim shape. */
  private lead(slot: Slot, deg: number, oct: number, when: number, dur: number): void {
    const ctx = audio.ctx!;
    const f = noteHz(slot.mood.root, slot.mood.scale, deg, oct + 1);
    const kind = slot.mood.lead;

    if (kind === 'nylon' || kind === 'pluck') {
      this.ksNote(slot, f, when, 0.34, kind === 'nylon' ? 'nylon' : 'steel', Math.min(dur * 1.5, 1.6));
      return;
    }

    const g = ctx.createGain();
    const o = ctx.createOscillator();
    let stop = when + dur + 0.5;

    if (kind === 'marimba') {
      o.type = 'triangle';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 4;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.09, when);
      g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
      o2.connect(g2).connect(slot.pluckGain);
      this.trackVoice(o2);
      o2.start(when);
      o2.stop(when + 0.2);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.42, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(dur * 1.4, 0.9));
      stop = when + 1.1;
    } else if (kind === 'bell') {
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.76;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.06, when);
      g2.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
      o2.connect(g2).connect(slot.pluckGain);
      this.trackVoice(o2);
      o2.start(when);
      o2.stop(when + 1.4);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.34, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
      stop = when + 2.8;
    } else if (kind === 'flute') {
      o.type = 'sine';
      o.frequency.value = f;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.006;
      vib.connect(vg).connect(o.frequency);
      this.trackVoice(vib);
      vib.start(when);
      vib.stop(when + dur + 0.4);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.3, when + 0.12);
      g.gain.setValueAtTime(0.3, when + dur * 0.75);
      g.gain.linearRampToValueAtTime(0.0001, when + dur + 0.25);
      stop = when + dur + 0.4;
    } else {
      // Fallback timbre (sawtooth through a closing lowpass), kept for any
      // future mood whose `lead` isn't one of the four named above.
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 6, when);
      lp.frequency.exponentialRampToValueAtTime(f * 1.5, when + 0.35);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.3, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(dur * 1.3, 1.1));
      o.connect(lp).connect(g).connect(slot.pluckGain);
      this.trackVoice(o);
      o.start(when);
      o.stop(when + 1.3);
      return;
    }

    o.connect(g).connect(slot.pluckGain);
    this.trackVoice(o);
    o.start(when);
    o.stop(stop);
  }

  /** Builds (and caches) the pre-computed Karplus-Strong feedback buffer for one (timbre, reference pitch). */
  private ksBuffer(refHz: number, timbre: 'nylon' | 'steel'): AudioBuffer {
    const key = `${timbre}@${refHz}`;
    const cached = ksCache.get(key);
    if (cached) return cached;

    const ctx = audio.ctx!;
    const sr = ctx.sampleRate;
    const seconds = 2.6;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / refHz));

    const soft = timbre === 'nylon' ? 0.38 : 0.72;
    let lp = 0;
    for (let i = 0; i <= N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * soft;
      y[i] = lp * (1 - (i / (N + 1)) * 0.35);
    }
    const decay = timbre === 'nylon' ? 0.9965 : 0.9975;
    const tone = timbre === 'nylon' ? 0.52 : 0.62;
    for (let i = N + 1; i < len; i++) y[i] = decay * (tone * y[i - N]! + (1 - tone) * y[i - N - 1]!);

    const fade = Math.floor(sr * 0.25);
    for (let i = len - fade; i < len; i++) y[i] *= (len - i) / fade;

    ksCache.set(key, buf);
    return buf;
  }

  /** Spielt eine gezupfte Saite bei Frequenz f — verbatim shape, routed to the slot's pluck bus. */
  private ksNote(slot: Slot, f: number, when: number, gain: number, timbre: 'nylon' | 'steel', dur: number): void {
    const ctx = audio.ctx!;
    let ref = KS_REFS[0]!;
    for (const r of KS_REFS) if (Math.abs(Math.log2(f / r)) < Math.abs(Math.log2(f / ref))) ref = r;

    const src = ctx.createBufferSource();
    src.buffer = this.ksBuffer(ref, timbre);
    src.playbackRate.value = (f / ref) * driftRate(when);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    if (dur > 0) {
      g.gain.setValueAtTime(gain, when + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.35);
    }
    src.connect(g).connect(slot.pluckGain);
    this.trackVoice(src);
    src.start(when);
    src.stop(when + (dur > 0 ? dur + 0.4 : 2.7));
  }

  /** Einzelner gezupfter Ton — die Saite darf hier voll ausklingen — verbatim shape. */
  private pluck(slot: Slot, deg: number, oct: number, at: number): void {
    const f = noteHz(slot.mood.root, slot.mood.scale, deg, oct + 1);
    this.ksNote(slot, f, at, 0.3, 'nylon', 0);
  }

  /** Perkussion: sparsam, nur in den dichteren Abschnitten — verbatim shape, bursts cached instead of rebuilt per hit. */
  private percHit(slot: Slot, kind: 'shaker' | 'woodblock' | 'drip', at: number): void {
    const ctx = audio.ctx!;
    if (kind === 'shaker' || kind === 'drip') {
      const seconds = kind === 'drip' ? 0.18 : 0.06;
      const buf = getBurst(ctx, kind, seconds, kind === 'drip' ? 5 : 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = kind === 'drip' ? 'bandpass' : 'highpass';
      f.frequency.value = kind === 'drip' ? 1200 : 4200;
      f.Q.value = kind === 'drip' ? 8 : 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(kind === 'drip' ? 0.14 : 0.045, at + 0.012);
      g.gain.linearRampToValueAtTime(0.0001, at + (kind === 'drip' ? 0.18 : 0.07));
      src.connect(f).connect(g).connect(slot.percGain);
      this.trackVoice(src);
      src.start(at);
    } else {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(560, at);
      o.frequency.exponentialRampToValueAtTime(330, at + 0.06);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.055, at + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      o.connect(lp).connect(g).connect(slot.percGain);
      this.trackVoice(o);
      o.start(at);
      o.stop(at + 0.2);
    }
  }

  /** Trommelpuls: Kick auf 1 und 3, Tom als Kontrapunkt — verbatim shape; tempo now driven by intensity instead of an external bossPhase(). */
  private drum(slot: Slot, at: number): void {
    const ctx = audio.ctx!;
    const kick = slot.drumStep % 2 === 0;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kick ? 150 : 220, at);
    o.frequency.exponentialRampToValueAtTime(kick ? 42 : 80, at + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(kick ? 0.5 : 0.26, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (kick ? 0.32 : 0.2));
    o.connect(g).connect(slot.percGain);
    this.trackVoice(o);
    o.start(at);
    o.stop(at + 0.4);

    if (this.intensity > 0.66 && kick) {
      const buf = getBurst(ctx, 'drumAccent', 0.12, 3);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 3000;
      const hg = ctx.createGain();
      hg.gain.value = 0.12;
      src.connect(hf).connect(hg).connect(slot.percGain);
      this.trackVoice(src);
      src.start(at);
    }
    slot.drumStep++;
  }

  /** Pulsierender Bassimpuls: der Herzschlag des Kampfes — verbatim shape, generalised to any mood via `intensity`. */
  private pulse(slot: Slot, at: number): void {
    const ctx = audio.ctx!;
    const f = noteHz(slot.mood.root, slot.mood.scale, 0, -2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.16 * this.intensity, at + 0.03);
    g.gain.linearRampToValueAtTime(0.0001, at + 0.28);
    o.connect(g).connect(slot.percGain);
    this.trackVoice(o);
    o.start(at);
    o.stop(at + 0.32);
  }
}

export const music = new MusicEngine();
