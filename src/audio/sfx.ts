/**
 * SFX — layered, varied, placed.
 *
 * The old game's sounds were single oscillators with an envelope, wired
 * straight to the output. That is why they read as beeps: a real sound has
 * a transient, a body and a tail, and it is never identical twice.
 *
 * Every sound here is built from the same three ideas:
 *
 *   1. LAYERS. A splash is not one noise burst. It is a bright transient
 *      (the surface breaking), a filtered body with a falling cutoff (the
 *      cavity closing), and droplets on the way down. Water sounds like
 *      water because of the falling filter, not because of the waveform.
 *   2. VARIATION. Pitch, filter and timing get a small random offset on
 *      every trigger, so casting two hundred times does not fatigue. The
 *      old reel click was one fixed 2400 Hz square wave.
 *   3. PLACE. Everything goes through the engine's reverb sends and is
 *      panned by where it happened on screen. A sound with no space in it
 *      always sounds like a menu, never like a lake.
 *
 * Still entirely synthesised: no assets, no download, no decode.
 */

import { audio, type PlayOpts } from './engine';

// ---------------------------------------------------------------------------
// small helpers

/**
 * Output trim for the sound currently being built.
 *
 * Character and level are separate concerns. The recipes below decide what a
 * sound IS; this decides how loud it sits in the mix. Keeping them apart means
 * a calibration pass never touches a waveform, and the calibration itself can
 * come from measurement instead of taste — see LEVEL at the bottom.
 */
let trim = 1;

function withTrim(t: number, fn: () => void): void {
  const prev = trim;
  trim = t;
  try { fn(); } finally { trim = prev; }
}

/** random in [a, b) */
function rr(a: number, b: number): number { return a + Math.random() * (b - a); }
/** semitones to ratio */
function st(n: number): number { return Math.pow(2, n / 12); }

interface ToneSpec {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** end frequency; omit for no glide */
  to?: number;
  /** exponential glide instead of linear */
  expo?: boolean;
  /** attack in seconds */
  attack?: number;
  /** lowpass cutoff; omit for none */
  lp?: number;
  /** highpass cutoff */
  hp?: number;
  /** resonance for the filter */
  q?: number;
  /** detune a second oscillator by this many cents for thickness */
  detune?: number;
  delay?: number;
}

interface NoiseSpec {
  dur: number;
  gain?: number;
  kind?: 'white' | 'pink' | 'brown';
  /** filter type; bandpass is what makes noise sound like a thing */
  filter?: BiquadFilterType;
  /** cutoff at the start */
  from: number;
  /** cutoff at the end; omit to hold */
  to?: number;
  q?: number;
  attack?: number;
  /** playback rate, also shifts the noise character */
  rate?: number;
  delay?: number;
}

function tone(s: ToneSpec, o: PlayOpts = {}): void {
  const c = audio.ctx;
  if (!c || !audio.claim(s.dur + (s.delay ?? 0))) return;
  const t0 = c.currentTime + (s.delay ?? 0) + (o.delay ?? 0);
  const g = c.createGain();
  const peak = (s.gain ?? 0.2) * (o.gain ?? 1) * trim;
  const atk = s.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);

  let out: AudioNode = g;
  if (s.lp || s.hp) {
    const f = c.createBiquadFilter();
    f.type = s.hp ? 'highpass' : 'lowpass';
    f.frequency.setValueAtTime(s.hp ?? s.lp!, t0);
    f.Q.value = s.q ?? 0.7;
    g.connect(f);
    out = f;
  }

  const mk = (detuneCents: number) => {
    const osc = c.createOscillator();
    osc.type = s.type ?? 'sine';
    osc.frequency.setValueAtTime(s.freq, t0);
    if (detuneCents) osc.detune.value = detuneCents;
    if (s.to !== undefined) {
      if (s.expo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, s.to), t0 + s.dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, s.to), t0 + s.dur);
    }
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + s.dur + 0.03);
  };
  mk(0);
  if (s.detune) mk(s.detune);

  audio.connectVoice(out, o);
}

function noise(s: NoiseSpec, o: PlayOpts = {}): void {
  const c = audio.ctx;
  if (!c || !audio.claim(s.dur + (s.delay ?? 0))) return;
  const t0 = c.currentTime + (s.delay ?? 0) + (o.delay ?? 0);

  const src = c.createBufferSource();
  src.buffer = audio.noise[s.kind ?? 'white'];
  src.loop = true;
  src.playbackRate.value = s.rate ?? 1;
  // start at a random offset so the same buffer never sounds like a loop
  const off = Math.random() * (src.buffer.duration - s.dur - 0.05);

  const f = c.createBiquadFilter();
  f.type = s.filter ?? 'lowpass';
  f.frequency.setValueAtTime(s.from, t0);
  if (s.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, s.to), t0 + s.dur);
  f.Q.value = s.q ?? 0.7;

  const g = c.createGain();
  const peak = (s.gain ?? 0.2) * (o.gain ?? 1) * trim;
  const atk = s.attack ?? 0.003;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + s.dur);

  src.connect(f).connect(g);
  audio.connectVoice(g, o);
  src.start(t0, Math.max(0, off), s.dur + 0.05);
}

/**
 * A plucked string by Karplus-Strong, used for the line twang and the catch
 * arpeggio. Cheap, and it has a real physical decay that an oscillator with
 * an envelope never gets.
 */
function pluck(freq: number, dur: number, bright: number, o: PlayOpts = {}): void {
  const c = audio.ctx;
  if (!c || !audio.claim(dur)) return;
  const sr = c.sampleRate;
  const n = Math.max(2, Math.round(sr / freq));
  const len = Math.floor(sr * dur);
  const buf = c.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  // excitation: noise, softened for a nylon-ish attack
  const ring = new Float32Array(n);
  for (let i = 0; i < n; i++) ring[i] = (Math.random() * 2 - 1) * bright;
  let lp = 0;
  let idx = 0;
  const damp = 0.5 + 0.48 * bright;
  for (let i = 0; i < len; i++) {
    const v = ring[idx];
    lp += (v - lp) * damp;
    const out = lp * 0.999;
    ring[idx] = out;
    idx = (idx + 1) % n;
    d[i] = out * Math.pow(1 - i / len, 0.6);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = (o.gain ?? 0.2) * trim;
  src.connect(g);
  audio.connectVoice(g, o);
  src.start(c.currentTime + (o.delay ?? 0));
}

/** screen x (0..1) → pan, gently, so nothing ever sits hard in one ear */
export function panFor(xFrac: number): number {
  return Math.max(-0.7, Math.min(0.7, (xFrac - 0.5) * 1.3));
}

// ---------------------------------------------------------------------------
// the sound library

let reelRobin = 0;

export const sfx = {
  /** bait breaking the surface — the small one */
  plop(pan = 0): void {
    const p = rr(-1, 1);
    // transient: the surface tearing
    noise({ dur: 0.05, gain: 0.16, from: 4000, to: 900, filter: 'bandpass', q: 0.9 }, { pan, room: 0.25 });
    // body: cavity closing, pitch falls — this is the "water" part
    tone({ freq: 460 * st(p), dur: 0.13, to: 150, expo: true, type: 'sine', gain: 0.3, lp: 1800 },
      { pan, room: 0.35 });
    // two bubbles rising after
    tone({ freq: 900 * st(p * 2), dur: 0.05, to: 1400, type: 'sine', gain: 0.06, delay: rr(0.07, 0.1) }, { pan, room: 0.4 });
    tone({ freq: 1250 * st(p * 2), dur: 0.04, to: 1800, type: 'sine', gain: 0.04, delay: rr(0.15, 0.2) }, { pan, room: 0.4 });
  },

  /** a real splash — fish landing, boss surfacing */
  splash(pan = 0, size = 1): void {
    const g = 0.22 + 0.18 * size;
    noise({ dur: 0.08, gain: g * 0.9, from: 9000, to: 2500, filter: 'highpass', q: 0.6 }, { pan, room: 0.3 });
    noise({ dur: 0.28 + 0.3 * size, gain: g, from: 3200, to: 350, q: 1.1 }, { pan, room: 0.55 });
    tone({ freq: 300 / (0.6 + size * 0.5), dur: 0.26, to: 90, expo: true, type: 'sine', gain: 0.16 }, { pan, room: 0.4 });
    // droplets falling back
    for (let i = 0; i < 3 + Math.round(size * 3); i++) {
      tone({ freq: rr(900, 2200), dur: 0.035, to: rr(600, 1200), type: 'sine', gain: rr(0.02, 0.05), delay: rr(0.12, 0.5) },
        { pan: pan + rr(-0.25, 0.25), room: 0.5 });
    }
  },

  /** the rod whipping forward */
  cast(pan = 0): void {
    noise({ dur: 0.26, gain: 0.1, from: 500, to: 2600, filter: 'bandpass', q: 1.6, rate: 1.2 }, { pan, room: 0.2 });
    noise({ dur: 0.18, gain: 0.05, from: 1800, to: 400, filter: 'bandpass', q: 2.2, delay: 0.1 }, { pan, room: 0.2 });
  },

  /** one notch of the reel — round-robin so a run of them has rhythm, not a tone */
  reelClick(pan = 0): void {
    reelRobin = (reelRobin + 1) % 4;
    const f = [2150, 2400, 2280, 2560][reelRobin] * st(rr(-0.3, 0.3));
    tone({ freq: f, dur: 0.016, type: 'square', gain: 0.035, hp: 1200, q: 3 }, { pan, room: 0.12 });
  },

  /**
   * The bite alert. Has to cut through the music and read as "now" —
   * so it ducks the music under itself rather than being turned up.
   */
  bite(pan = 0): void {
    audio.duck(0.5, 0.5);
    noise({ dur: 0.03, gain: 0.1, from: 6000, to: 2000, filter: 'bandpass', q: 1 }, { pan });
    tone({ freq: 880, dur: 0.09, type: 'triangle', gain: 0.16, detune: 8, lp: 5000 }, { pan, room: 0.3 });
    tone({ freq: 1320, dur: 0.14, type: 'triangle', gain: 0.15, detune: -8, lp: 5000, delay: 0.085 }, { pan, room: 0.35 });
  },

  /** fish nibbling before the real bite — small, curious, easy to miss */
  nibble(pan = 0): void {
    tone({ freq: rr(620, 760), dur: 0.045, to: 520, type: 'sine', gain: 0.06, lp: 2200 }, { pan, room: 0.3 });
  },

  /** the line letting go */
  snap(pan = 0): void {
    audio.duck(0.55, 0.7);
    noise({ dur: 0.05, gain: 0.3, from: 9000, to: 3000, filter: 'highpass' }, { pan, room: 0.3 });
    pluck(196, 0.5, 0.9, { pan, gain: 0.22, room: 0.5 });
    tone({ freq: 220, dur: 0.35, to: 70, expo: true, type: 'sawtooth', gain: 0.09, lp: 900 }, { pan, room: 0.4 });
  },

  /** the fish getting away without a snap */
  escape(pan = 0): void {
    tone({ freq: 420, dur: 0.32, to: 180, expo: true, type: 'triangle', gain: 0.13, lp: 2200 }, { pan, room: 0.4 });
    noise({ dur: 0.3, gain: 0.12, from: 1800, to: 300, q: 1.2, delay: 0.05 }, { pan, room: 0.5 });
  },

  /**
   * Catch fanfare. An arpeggio in the key the music is in, on plucked
   * strings plus a bell, with more of it the rarer the fish. The old
   * version was four fixed triangle tones regardless of anything.
   */
  catchJingle(rarityIndex = 0, rootHz = 261.63): void {
    audio.duck(0.4, 1.4);
    const scale = [0, 4, 7, 11, 14, 16, 19];     // major 9th arpeggio
    const notes = 3 + Math.min(4, rarityIndex);
    for (let i = 0; i < notes; i++) {
      const f = rootHz * st(scale[i % scale.length] + 12 * Math.floor(i / scale.length));
      // The arpeggio carries a COMMON catch on its own — measurement showed
      // rarity 0 at 0.147 against a legendary's 0.573, i.e. the everyday
      // reward sounded like an afterthought. The bell and shimmer on top are
      // the bonus, not the substance.
      pluck(f, 0.55, 0.45, { gain: 0.42, delay: i * 0.085, room: 0.45, pan: rr(-0.15, 0.15) });
    }
    if (rarityIndex >= 2) {
      // a bell on the top note for the good ones
      const f = rootHz * st(scale[Math.min(notes, scale.length - 1)] + 12);
      tone({ freq: f, dur: 0.9, type: 'sine', gain: 0.1, detune: 5 }, { delay: notes * 0.085, room: 0.7, deep: 0.2 });
      tone({ freq: f * 2, dur: 0.7, type: 'sine', gain: 0.04 }, { delay: notes * 0.085 + 0.01, room: 0.7 });
    }
    if (rarityIndex >= 4) {
      // and a shimmer tail for a legendary
      noise({ dur: 1.6, gain: 0.05, from: 6000, to: 11000, filter: 'bandpass', q: 0.6, attack: 0.4, delay: 0.3 },
        { room: 0.9 });
    }
  },

  /** one coin; call with rising index for a run */
  coin(index = 0, pan = 0): void {
    const f = 1180 * st(Math.min(index, 12) * 0.9);
    noise({ dur: 0.02, gain: 0.05, from: 7000, filter: 'highpass' }, { pan });
    tone({ freq: f, dur: 0.09, to: f * 1.18, type: 'triangle', gain: 0.075, detune: 12 }, { pan, room: 0.25 });
    tone({ freq: f * 2.02, dur: 0.06, type: 'sine', gain: 0.03 }, { pan, room: 0.25 });
  },

  levelUp(): void {
    audio.duck(0.5, 2);
    const root = 261.63;
    for (const [i, s] of [0, 4, 7, 12].entries()) {
      tone({ freq: root * st(s), dur: 1.3, type: 'triangle', gain: 0.1, detune: 7, attack: 0.05, lp: 4200 },
        { delay: i * 0.06, room: 0.7 });
    }
    noise({ dur: 1.8, gain: 0.045, from: 4000, to: 9000, filter: 'bandpass', q: 0.5, attack: 0.5 }, { room: 0.9 });
  },

  buy(): void {
    tone({ freq: 700, dur: 0.08, type: 'sine', gain: 0.13, detune: 6 }, { bus: 'ui', room: 0.2 });
    tone({ freq: 1050, dur: 0.17, type: 'sine', gain: 0.13, detune: -6, delay: 0.075 }, { bus: 'ui', room: 0.3 });
  },

  denied(): void {
    tone({ freq: 220, dur: 0.16, to: 165, type: 'square', gain: 0.07, lp: 1400 }, { bus: 'ui' });
  },

  click(): void {
    noise({ dur: 0.012, gain: 0.05, from: 2600, filter: 'bandpass', q: 1.4 }, { bus: 'ui' });
    tone({ freq: 380, dur: 0.03, type: 'sine', gain: 0.05, lp: 1800 }, { bus: 'ui' });
  },

  tick(): void {
    tone({ freq: 1900, dur: 0.014, type: 'square', gain: 0.02, hp: 900 }, { bus: 'ui' });
  },

  /** ring/timer tick that tightens as the window closes (0..1 urgency) */
  urgentTick(urgency: number): void {
    tone({ freq: 1500 + urgency * 900, dur: 0.02, type: 'square', gain: 0.018 + urgency * 0.03, hp: 800 },
      { bus: 'ui' });
  },

  /** a single bubble, for idle water life */
  bubble(pan = 0): void {
    const f = rr(500, 1500);
    tone({ freq: f, dur: rr(0.05, 0.11), to: f * rr(1.4, 2.1), expo: true, type: 'sine', gain: rr(0.02, 0.05), lp: 3000 },
      { pan, room: 0.4, deep: 0.2 });
  },

  /** gull cry, two syllables, slightly different every time */
  gull(pan = 0): void {
    const base = rr(1150, 1400);
    for (let i = 0; i < 2; i++) {
      tone({
        freq: base * st(rr(-1, 1)), dur: 0.16, to: base * 0.62, expo: true,
        type: 'sawtooth', gain: 0.05, lp: 3200, q: 2, delay: i * 0.22,
      }, { pan, room: 0.6 });
    }
  },

  thunder(distance = 0.5): void {
    const near = 1 - distance;
    noise({ dur: 0.15 + near * 0.2, gain: 0.1 + near * 0.2, from: 300 + near * 4000, to: 120, q: 0.8 },
      { room: 0.8 });
    noise({ dur: 2.2 + near, gain: 0.12 + near * 0.15, kind: 'brown', from: 180, to: 60, attack: 0.08, delay: 0.1 },
      { room: 1, deep: 0.4 });
  },

  /** harpoon shot (dive mode) */
  harpoon(charge: number, pan = 0): void {
    noise({ dur: 0.07, gain: 0.14, from: 1200 + charge * 2500, to: 400, filter: 'bandpass', q: 1.3 }, { pan, deep: 0.5 });
    tone({ freq: 260 + charge * 220, dur: 0.22, to: 110, expo: true, type: 'sawtooth', gain: 0.1, lp: 1400 },
      { pan, deep: 0.6 });
  },
};

/**
 * Line tension as a continuous voice — the drill's most important sound and
 * one the old game did not have at all. Two detuned saws through a lowpass
 * whose cutoff and pitch follow the tension, so the player hears danger
 * before they see the bar turn red.
 */
export class TensionVoice {
  private osc: OscillatorNode[] = [];
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private running = false;

  start(): void {
    const c = audio.ctx;
    if (!c || this.running) return;
    this.running = true;

    this.gain = c.createGain();
    this.gain.gain.value = 0.0001;

    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 400;
    this.filter.Q.value = 6;

    for (const cents of [-9, 9]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 92;
      o.detune.value = cents;
      o.connect(this.filter);
      o.start();
      this.osc.push(o);
    }
    this.filter.connect(this.gain);
    audio.connectVoice(this.gain, { room: 0.3, gain: 1 });
  }

  /** tension 0..1 */
  set(tension: number): void {
    const c = audio.ctx;
    if (!c || !this.gain || !this.filter) return;
    const t = Math.max(0, Math.min(1, tension));
    const now = c.currentTime;
    // silent until there is real tension, then rises fast near the top
    const g = Math.max(0.0001, Math.pow(t, 1.7) * 0.45);   // calibrated with the rest, see LEVEL
    this.gain.gain.setTargetAtTime(g, now, 0.05);
    this.filter.frequency.setTargetAtTime(300 + t * t * 2600, now, 0.06);
    for (const o of this.osc) o.frequency.setTargetAtTime(88 + t * 46, now, 0.08);
  }

  stop(): void {
    const c = audio.ctx;
    if (!c) { this.running = false; return; }
    if (this.gain) this.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.05);
    const oscs = this.osc;
    window.setTimeout(() => {
      for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } }
    }, 300);
    this.osc = [];
    this.gain = null;
    this.filter = null;
    this.running = false;
  }
}

// ---------------------------------------------------------------------------
// Calibration
//
// These numbers are not taste, they are measurement. `dev/audioMeasure.ts`
// renders every sound through the real graph in an OfflineAudioContext and
// reports its peak. The first pass found the whole library sitting three to
// thirteen times below the available headroom: a UI click peaked at 0.0085,
// which on a phone speaker is silence. Nothing clipped, so nothing would ever
// have complained — it would just have shipped quiet, and the fix would have
// been someone turning their phone up and hearing the room instead.
//
// Each factor is measured-peak → target-peak for that sound's role:
//   gameplay events   0.30 .. 0.45   (heard over ambience and music)
//   big moments       0.55 .. 0.75   (they may kiss the limiter)
//   UI                0.08 .. 0.15   (present, never intrusive)
//
// Re-run the measurement after changing any recipe; the table is only true
// for the recipes it was measured against.
const LEVEL = {
  plop: 5,
  splash: 3.6,
  cast: 12,
  reelClick: 9,
  bite: 2.3,
  nibble: 9,
  snap: 3.6,
  escape: 5,
  catchJingle: 2.6,
  coin: 8,
  levelUp: 2,
  buy: 2,
  denied: 12,
  click: 12,
  tick: 13,
  urgentTick: 10,
  bubble: 10,
  gull: 5,
  thunder: 4,
  harpoon: 10,
} satisfies Partial<Record<keyof typeof sfx, number>>;

// Wrap each entry in its trim. Done here rather than inside the recipes so a
// recipe stays a description of a sound and nothing else.
type SfxTable = Record<string, (...args: never[]) => void>;
for (const [name, factor] of Object.entries(LEVEL)) {
  const table = sfx as unknown as SfxTable;
  const original = table[name];
  table[name] = (...args: never[]) => withTrim(factor, () => original(...args));
}

/** The measured calibration, exposed so the dev board can show it. */
export const SFX_LEVELS: Readonly<typeof LEVEL> = LEVEL;
