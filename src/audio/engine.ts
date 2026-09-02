/**
 * Audio engine — buses, space, and headroom.
 *
 * The old game connected every oscillator straight to `destination` at a
 * fixed gain. Three consequences, all audible:
 *   - a catch jingle plus coins plus a splash summed past 1.0 and clipped,
 *     which is the crunchy edge on the loud moments
 *   - nothing had any space, so every sound was a dry beep in a vacuum
 *   - there was no way to duck the music under an important sound, or to
 *     turn SFX down separately from music
 *
 * This engine fixes all three structurally rather than by tweaking numbers:
 *
 *   voices ─┬─► sfx  ──┐
 *           ├─► ui   ──┤
 *           ├─► amb  ──┼─► master ─► limiter ─► destination
 *           └─► music ─┘      ▲
 *                             └── ducked by loud one-shots
 *           └─► sends: room reverb (short, bright)
 *                      deep reverb (long, dark)
 *
 * Everything is still synthesised: no audio assets, no download, no decode.
 * That was the right call in the old game and it stays.
 */

export type BusName = 'sfx' | 'ui' | 'amb' | 'music';

export interface PlayOpts {
  /** 0..1 within the bus */
  gain?: number;
  /** -1 left .. 1 right; omit for centre */
  pan?: number;
  /** seconds from now */
  delay?: number;
  /** 0..1 into the short bright reverb */
  room?: number;
  /** 0..1 into the long dark reverb */
  deep?: number;
  bus?: BusName;
}

/** How many one-shot voices may overlap before new ones are dropped. */
const MAX_VOICES = 24;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private buses = new Map<BusName, GainNode>();
  private roomSend!: GainNode;
  private deepSend!: GainNode;
  /** global tone shaping for "we are under water" */
  private submerge!: BiquadFilterNode;
  private submergeAmount = 0;

  /** pre-rendered noise, made once instead of per sound */
  noise!: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };

  private voices = 0;
  private volumes: Record<BusName | 'master', number> = { master: 0.9, sfx: 1, ui: 0.7, amb: 0.6, music: 0.5 };
  muted = false;
  private unlocked = false;
  /** true while rendering into an OfflineAudioContext for measurement */
  private offline = false;

  /**
   * True once the context exists and can accept scheduled sound.
   *
   * An OfflineAudioContext reports 'suspended' until rendering starts, so a
   * plain state check makes every sound silent under measurement — which is
   * exactly the trap the old project's notes warn about: when a measurement
   * gives an absurd result, check the instrument before the code.
   */
  get ready(): boolean { return !!this.ctx && (this.offline || this.ctx.state === 'running'); }

  /**
   * Builds the graph. Safe to call repeatedly. Must be called from a user
   * gesture on iOS, otherwise the context stays suspended.
   */
  init(injected?: BaseAudioContext): void {
    // An injected context is how the sounds get MEASURED: rendering the same
    // graph into an OfflineAudioContext turns "it did not throw" into peak and
    // RMS numbers. The old project shipped a silent sound because a NaN made
    // it inaudible and nobody looked at the samples.
    if (injected) { this.adopt(injected); return; }
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        // 'interactive' asks for the smallest buffer the device will give,
        // which is what a game wants: a reel click 100 ms late feels broken.
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        this.ctx = null;
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /**
   * Rebuilds the whole graph on a different context. Used to render the real
   * sounds into an OfflineAudioContext so they can be measured rather than
   * assumed, and to hand the engine back to a live context afterwards.
   */
  adopt(ctx: BaseAudioContext): void {
    this.ctx = ctx as AudioContext;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.buses.clear();
    this.voices = 0;
    this.build();
  }

  private build(): void {
    const c = this.ctx!;

    // --- master chain -----------------------------------------------------
    // The limiter is the part the old game lacked. Ratio 20 with a 3 ms
    // attack turns "clipped and crunchy" into "loud and clean", and it means
    // individual sound gains no longer have to be conservative guesses.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.limiter.connect(c.destination);

    this.master = c.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.limiter);

    // --- underwater tone --------------------------------------------------
    // One filter the whole mix passes through. At full amount everything
    // above ~700 Hz is gone, which is exactly what being under water does.
    this.submerge = c.createBiquadFilter();
    this.submerge.type = 'lowpass';
    this.submerge.frequency.value = 20000;
    this.submerge.Q.value = 0.4;
    this.submerge.connect(this.master);

    // --- buses ------------------------------------------------------------
    for (const name of ['sfx', 'ui', 'amb', 'music'] as BusName[]) {
      const g = c.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.submerge);
      this.buses.set(name, g);
    }

    // --- two reverbs ------------------------------------------------------
    // Short and bright for anything above the surface, long and dark for
    // the deep sea and the dive. Both impulse responses are generated, so
    // there is still nothing to download.
    this.roomSend = c.createGain();
    this.roomSend.gain.value = 1;
    const room = c.createConvolver();
    room.buffer = this.impulse(0.9, 2.6, 5200);
    const roomWet = c.createGain();
    roomWet.gain.value = 0.5;
    this.roomSend.connect(room).connect(roomWet).connect(this.submerge);

    this.deepSend = c.createGain();
    this.deepSend.gain.value = 1;
    const deep = c.createConvolver();
    deep.buffer = this.impulse(3.4, 1.5, 900);
    const deepWet = c.createGain();
    deepWet.gain.value = 0.62;
    const deepTone = c.createBiquadFilter();
    deepTone.type = 'lowpass';
    deepTone.frequency.value = 1400;
    this.deepSend.connect(deep).connect(deepTone).connect(deepWet).connect(this.submerge);

    this.noise = {
      white: this.noiseBuffer('white', 2),
      pink: this.noiseBuffer('pink', 2),
      brown: this.noiseBuffer('brown', 3),
    };
  }

  /**
   * A synthetic impulse response: decaying noise with a frequency-dependent
   * decay, so highs die before lows the way they do in a real space.
   */
  private impulse(seconds: number, decay: number, tone: number): AudioBuffer {
    const c = this.ctx!;
    const sr = c.sampleRate;
    const len = Math.max(1, Math.floor(sr * seconds));
    const buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // one-pole lowpass state, so the tail darkens as it decays
      let lp = 0;
      const k = Math.min(0.99, (tone * 2 * Math.PI) / sr);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        const n = Math.random() * 2 - 1;
        lp += k * (n - lp);
        // early reflections: a few sparse taps keep it from sounding like
        // a wash of noise
        const tap = i < sr * 0.08 && Math.random() < 0.004 ? 2.5 : 1;
        d[i] = lp * env * tap * (ch === 0 ? 1 : 0.92);
      }
    }
    return buf;
  }

  private noiseBuffer(kind: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const c = this.ctx!;
    const sr = c.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      // Paul Kellet's pink noise approximation
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------- routing

  bus(name: BusName): GainNode | null { return this.buses.get(name) ?? null; }

  /**
   * Connects a voice's output to its bus and to the two reverb sends.
   * Returns the node the caller should feed, so a sound never has to know
   * anything about the graph above it.
   */
  connectVoice(out: AudioNode, o: PlayOpts): void {
    const c = this.ctx!;
    let node: AudioNode = out;
    if (o.pan !== undefined && o.pan !== 0) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      node = p;
    }
    node.connect(this.buses.get(o.bus ?? 'sfx')!);
    if (o.room) {
      const s = c.createGain();
      s.gain.value = o.room;
      node.connect(s).connect(this.roomSend);
    }
    if (o.deep) {
      const s = c.createGain();
      s.gain.value = o.deep;
      node.connect(s).connect(this.deepSend);
    }
  }

  /** Reserve a voice slot; returns false when the cap is reached. */
  claim(seconds: number): boolean {
    if (this.muted || !this.ready) return false;
    if (this.voices >= MAX_VOICES) return false;
    this.voices++;
    // Offline rendering has no wall clock, so the timer would never fire and
    // the cap would lock after 24 sounds. Nothing to release there anyway.
    if (!this.offline) {
      window.setTimeout(() => { this.voices--; }, Math.min(6000, (seconds + 0.3) * 1000));
    }
    return true;
  }

  get now(): number { return this.ctx ? this.ctx.currentTime : 0; }

  // ------------------------------------------------------------- mix control

  setVolume(which: BusName | 'master', v: number): void {
    const val = Math.max(0, Math.min(1, v));
    this.volumes[which] = val;
    if (!this.ctx) return;
    const target = which === 'master' ? this.master : this.buses.get(which);
    target?.gain.setTargetAtTime(this.muted ? 0 : val, this.now, 0.03);
  }

  getVolume(which: BusName | 'master'): number { return this.volumes[which]; }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.now, 0.05);
  }

  /**
   * Ducks the music bus for `hold` seconds. Used by the loud, meaningful
   * one-shots (bite, catch, snap) so they land instead of fighting the pad.
   */
  duck(amount = 0.45, hold = 0.6): void {
    if (!this.ctx) return;
    const g = this.buses.get('music')!.gain;
    const base = this.volumes.music;
    const t = this.now;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(base * (1 - amount), t, 0.04);
    g.setTargetAtTime(base, t + hold, 0.25);
  }

  /** 0 = above water, 1 = fully submerged. Ramped, never snapped. */
  setSubmerged(amount: number, seconds = 0.4): void {
    this.submergeAmount = Math.max(0, Math.min(1, amount));
    if (!this.ctx) return;
    // 20 kHz (open) down to 620 Hz, exponential so the middle feels right
    const f = 620 * Math.pow(20000 / 620, 1 - this.submergeAmount);
    this.submerge.frequency.setTargetAtTime(f, this.now, seconds / 3);
    this.submerge.Q.setTargetAtTime(0.4 + this.submergeAmount * 1.6, this.now, seconds / 3);
  }

  get submerged(): number { return this.submergeAmount; }

  // ----------------------------------------------------------- lifecycle

  /**
   * Wires the unlock and interruption handling. On iOS an AudioContext
   * starts suspended, and it is ALSO suspended again after a phone call,
   * Siri, or the app going to the background — so this listens for both.
   */
  attachLifecycle(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    const unlock = () => {
      this.init();
      // A silent one-sample buffer is the reliable way to convince older
      // WebKit that a real gesture happened.
      if (this.ctx) {
        const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
      }
    };
    for (const ev of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.addEventListener(ev, unlock, { once: false, passive: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
    window.addEventListener('pageshow', () => { if (this.ctx?.state === 'suspended') void this.ctx.resume(); });
  }
}

export const audio = new AudioEngine();
