# 06 — Audio, Music, Native/Build Infrastructure

Source: old project `C:\Users\duf73\Desktop\claude projekte\fishing-game` (read-only reference,
nothing there was modified). This document exists so the rebuild can reproduce the audio
engine, the native/Capacitor shell, the build/deploy pipeline, and the on-device performance
tooling without re-deriving any of it from scratch. `audio.js` and `music.js` are copied
**verbatim** below — both are plain Web Audio API code with no external dependencies, so they
can be dropped into the new project unchanged (only the global hooks they read —
`save`, `saveGame`, `getLocation`, `hubScreen`, `bossFight`, `cutscene`, `gameState`,
`dayTime`, `getPalette`, `weather`, `isDeepSea`, `rand` — need to exist with the same
shape in the rebuild, or be adapted).

---

## 1. Audio (`audio.js`) — synthesized sound effects

No audio files anywhere. Every sound is generated at call time from two Web Audio
primitives:

- **`tone(freq, dur, type, vol, slide, delay)`** — one `OscillatorNode` → `GainNode` →
  destination. Gain envelope is exponential attack (0.0001 → vol over 0.01s) then
  exponential decay to 0.0001 over `dur`. `slide` linearly ramps the oscillator frequency
  to `freq + slide` (floored at 40 Hz) over `dur`, producing pitch sweeps. `delay` offsets
  the start time from "now".
- **`noise(dur, vol, cutoff, delay)`** — builds a one-shot `AudioBuffer` of white noise with
  a linear amplitude taper baked in (`(1 - i/len)`), runs it through a lowpass
  `BiquadFilterNode` (`cutoff` Hz) and a gain envelope (linear vol → exponential decay to
  0.0001).

Every named effect is a short composition of `tone()`/`noise()` calls with relative
delays — e.g. `plop()` is a downward sine sweep + a filtered noise burst + two quiet
"blubbering" harmonics after it; `catchJingle(rarityIndex)` plays a 4-note arpeggio and
layers extra notes on top as `rarityIndex` increases (2+ adds a fifth/sixth, 4+ adds a
long high sine "sparkle"). This rarity-scaling jingle is the one sound effect that reads
game state (a catch's rarity tier) rather than just being a fixed sting.

`Sound.ensure()` lazily creates the singleton `AudioContext` (`webkitAudioContext`
fallback) and calls `.resume()` whenever it's `"suspended"` — this is the entire
iOS/browser autoplay-unlock mechanism; there is no separate unlock object. Every sound
method early-returns if `!this.ctx || this.muted`, so calling any sound before the
context exists (or while muted) is always safe and silent — no need to guard call sites.

**iOS unlock/resume handling** lives in `script.js`, not `audio.js`: a single
`unlockAudio()` function calls `Sound.ensure()` and, if music is enabled in the save,
`Music.start()`. It is wired to the *first* `pointerdown` on the canvas — not a dedicated
"tap to start" screen (that screen was removed; the comment in `script.js` notes any
first touch counts: pressing ANGELN, tapping a shelf item, swiping the location strip,
skipping the loading screen, or tapping empty space). Both `Sound.ensure()` and
`Music.start()` are idempotent/re-entrant (`Music.start()` no-ops after the first call via
`this.started`), so calling `unlockAudio()` on every pointerdown is cheap and correct.
There is no `visibilitychange`/`pagehide` handling for audio specifically — the only
`visibilitychange` listener in the game calls `Perf.stoer(120)` (marks a perf "disturbance"
so the frame-time benchmark discards the next 120 samples), not anything audio-related.

### `audio.js` (verbatim)

```javascript
// --- Sound (synthetisiert per Web Audio, keine Assets nötig) ---
const Sound = {
  ctx: null,
  muted: false,

  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  tone(freq, dur, type = "sine", vol = 0.2, slide = 0, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },

  noise(dur, vol = 0.2, cutoff = 1200, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
  },

  // Plopp: tiefer Sinus-Sweep + kurzer gefilterter Impuls + leises Blubbern danach
  plop()   { this.tone(420, 0.12, "sine", 0.28, -300); this.noise(0.12, 0.2, 700); this.tone(900, 0.05, "sine", 0.08, 400, 0.08); this.tone(1200, 0.04, "sine", 0.05, 500, 0.16); },
  splash() { this.noise(0.45, 0.3, 2200); this.noise(0.25, 0.15, 900, 0.05); this.tone(260, 0.25, "sine", 0.1, -180); },
  whoosh() { this.noise(0.35, 0.08, 600); },
  bite()   { this.tone(880, 0.08, "square", 0.12); this.tone(1320, 0.12, "square", 0.12, 0, 0.09); },
  fail()   { this.tone(320, 0.35, "sawtooth", 0.12, -180); },
  snap()   { this.noise(0.08, 0.3, 4000); this.tone(200, 0.3, "sawtooth", 0.1, -120, 0.05); },
  buy()    { this.tone(700, 0.08, "sine", 0.15); this.tone(1050, 0.16, "sine", 0.15, 0, 0.08); },
  click()  { this.tone(420, 0.04, "square", 0.04); },
  tick()   { this.tone(1900, 0.02, "square", 0.025); },
  coin(delay = 0) { this.tone(1400, 0.07, "triangle", 0.08, 300, delay); },

  reelClick() { this.tone(2400, 0.015, "square", 0.02); },
  catchJingle(rarityIndex = 0) {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 0.18, "triangle", 0.18, 0, i * 0.11));
    if (rarityIndex >= 2) [1318, 1568].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.16, 0, 0.5 + i * 0.12));
    if (rarityIndex >= 4) this.tone(2093, 0.6, "sine", 0.14, 0, 0.8);
  }
};
```

**Known backlog item for the rebuild (`docs/BACKLOG.md` S3):** `audio.js` was flagged as
"still raw oscillators" — the plan on file is to route these one-shots through the same
reverb bus as `music.js` and pitch them to the current location's key, the way
`Music.pad()`/`Music.lead()` already do. Worth doing from the start in the rebuild rather
than retrofitting later.

---

## 2. Music (`music.js`) — procedural ambient generator

Endless, no audio files, entirely Web Audio. One module (`Music`) drives everything.

### Signal chain (built once in `Music.start()`)

```
pad synths ──► wow (DelayNode, ~18ms, LFO-modulated ±0.6ms) ──► filter (lowpass) ─┬─► dry ──┐
pluck (Karplus-Strong) ─────────────────────────────────────────► filter ─────────┘         ├─► saturator (tanh waveshaper) ─► master ─► destination
                                                          filter ──► reverb (convolver, generated IR) ─► wet ─┘
ambience (water/rain noise, birds) ─────────────────────────────────────────────────────────────────────────┘
```

- **Reverb**: not a sample — a `ConvolverNode` fed a *generated* impulse response: 3.2s
  stereo buffer of white noise shaped by `(1 - i/len)^2.6` decay.
- **"Wow" (tape wobble)**: pad signal runs through a `DelayNode` whose delay time is
  modulated by a 0.13 Hz LFO (±0.6ms) — a deliberate, barely-audible pitch waver.
- **Saturation**: one `WaveShaperNode` on the whole mix using a `tanh(x·1.7)/tanh(1.7)`
  curve (`oversample: "2x"`) — softens digital peaks without raising loudness.
- **Global drift**: `driftCents()` sums two slow sine LFOs (0.11 Hz and 0.29 Hz) to produce
  a few cents of pitch wander, applied via `oscillator.detune` and `playbackRate` on plucked
  notes — an intentional "old tape" imperfection, not a bug.

### Per-location mood tables (`Music.MOODS`)

Each location key (`see`, `boot`, `kueste`, `riff`, `tiefsee`, `arktis`, plus `hub` for the
main-menu aquarium room and `boss` for boss fights) has its own:

| field | meaning |
|---|---|
| `root` | base frequency (Hz) |
| `scale` | one of `SCALES.major/minor/dorian/mystic` — 5-note (pentatonic-family) scale as semitone offsets |
| `chord` | seconds per chord |
| `cutoff` | lowpass filter target frequency (location's "color") |
| `pluckRate` | probability of an idle random pluck note during the quiet section |
| `lead` | lead instrument timbre: `nylon`/`pluck` (Karplus-Strong string), `marimba`, `bell`, `flute`, or default sawtooth |
| `perc` | percussion voice: `shaker`, `woodblock`, `drip`, or `null` |
| `percRate` | percussion density multiplier |
| `prog` | chord progression as scale-degree offsets, cycled |
| `motif` | the location's melodic hook: array of `[scaleDegree, lengthInEighths]` pairs |
| `swing` | 0.5 = straight, higher = swung eighths |

`hub` (the aquarium/main-menu room) is deliberately brighter/faster (D4 root, major, 3.6s
chords, wide-open filter, marimba lead, woodblock perc) to make it audibly different from
being "on the water" — documented in the source as an intentional mood break. `boss` is
low, minor, fast chord changes (3.4s), no ambient percussion, and gets its own drum layer.

### Structure/arrangement logic (`update()`, called every frame)

- **Mood selection priority**: boss fight/cutscene > hub screen open > current location.
  `moodKey()` encodes this precedence; mood changes trigger a scheduled crossfade (master
  gain dips to 25% over 0.20s, recovers to 100% over 0.55s, new chord starts in the dip at
  +0.18s) — no hard cuts, no silence.
- **Fight intensity (`fight`, 0→1)**: eases toward 1 while `gameState` is `"reeling"` or
  `"biting"` (drill in progress), eases back to 0 otherwise (`+= (target - fight) * 0.03`
  per frame). Drives: filter opens (brighter), chords shorten (more driving), percussion
  turns on regardless of section, and a pulsing bass heartbeat (triangle wave, ~0.42s
  period) fades in above `fight > 0.25`.
- **Day/night**: `night = light < 0.4 && !boss && !hub && fight < 0.5` — darkens/slows
  chords (transposed down 2 degrees, 1.2× duration) and halves the idle pluck rate. Combat
  and the hub room are exempt (hub's lamp-lit room doesn't track time of day at all).
  Rain (`weather.type === "rain"`) also darkens the filter by 0.8×.
  This is orthogonal to gameplay day/night — it only reads it, doesn't drive it.
- **5-section cycle** (`section`, advances every 2 chords): 0 = pad+bass only (with a
  deliberate "breathe" — one chord in 5 plays only a soft pad, no bass/lead, so ambient
  sound — water, wind, birds — has room), 1 = melody enters, 2 = melody + percussion,
  3 = melody transposed up a third, 4 = melody up an octave. During combat this collapses
  to always using section 2's dense arrangement.
- **Melody**: `scheduleMelody()` walks the location's `motif` array, converting each
  `[degree, length]` into a `lead()` call at `beat = chordDuration/8` timing, with swing
  applied to every other eighth-note.
- **Lead instrument synthesis** (`lead()`): 4 distinct signal chains selected by
  `m.lead` — marimba (triangle + sine partial at 4× freq with fast decay), bell (sine +
  detuned sine partial at 2.76× freq, long decay), flute (sine with 5.2 Hz vibrato,
  sustained envelope), nylon/pluck (routes to the Karplus-Strong string synth below),
  default/pluck-fallback (sawtooth through a closing lowpass sweep).
- **Karplus-Strong plucked string (`ksBuffer`/`ksNote`)**: a *real* physical string model,
  not a filtered sawtooth. Builds a buffer once per (reference octave × timbre) — 4
  reference pitches (110/220/440/880 Hz) × 2 timbres (`nylon` soft-filtered noise excitation
  + slow decay, `steel` sharper excitation + shorter decay) are cached in `ksCache`; other
  pitches are played by varying `playbackRate`. The feedback loop is pre-computed into the
  buffer once (not a live DelayNode loop, which can't go below ~340Hz cleanly in Web Audio)
  by averaging each sample with its neighbor N samples back (`decay * (tone*y[i-N] +
  (1-tone)*y[i-N-1])`), which is literally the Karplus-Strong algorithm.
- **Bass** (`bass()`): triangle + sub-sine an octave down, tracks the chord degree 2
  octaves below root.
- **Percussion** (`percHit()`): `shaker`/`drip` are filtered noise bursts (bandpass for
  drip, highpass for shaker); `woodblock` is a pitched triangle sweep (560→330 Hz) through
  a lowpass — deliberately softened attack (18ms ramp) because a hard 4ms attack "clicked".
- **Boss drums** (`drum()`): alternating kick (150→42 Hz sine sweep) / tom (220→80 Hz),
  called on its own schedule (`nextDrum`, tempo tightens as `bossPhase()` increases:
  0.5s → 0.38s → 0.30s per hit), plus a highpass noise accent layered on kicks once
  `phase >= 3`.
- **Ambience** (`startAmbience()`): looping brown noise (lowpass 400Hz, slow 0.08Hz LFO on
  gain = "water"), looping white noise (lowpass 1800Hz, gain driven to 0 or up depending on
  weather = "rain"), and randomly-triggered `bird()` chirps (2–4 short pitch-swept sines).
  All three are gain-automated per frame based on state: rain silenced in deep sea/hub/ice
  locations (snow makes no patter sound — this was itself a prior bug fix, `#104`); water
  ambience is quieter in hub (0.12) and deep sea (0.10) than surface locations (0.25); birds
  only sing when not in hub, daylight > 0.55, no rain, and not on a boat/deep-sea location.

### Toggle / volume

`Music.toggle()` flips `enabled`, lazily calls `start()` if turning on for the first time,
persists to `save.music` + `saveGame()`. `setVolume(v)` ramps `master.gain` to
`v * 0.6` (or 0 if disabled/muted) via `setTargetAtTime` (0.4s time constant) — never an
instant jump.

### `music.js` (verbatim)

```javascript
// --- Musik & Ambiente: prozedural, endlos, ruhig. Web Audio, keine Dateien. ---
// Pad-Akkorde (pentatonisch) + sparsame gezupfte Töne + Hall. Tonart/Tempo/Klangfarbe ändern sich mit Ort und Tageszeit.
const Music = {
  ctx: null, master: null, padGain: null, pluckGain: null, ambGain: null, reverb: null, filter: null,
  enabled: true, started: false, nextChord: 0, nextPluck: 0, chordIdx: 0, ambience: {},
  volume: 0.5,

  // Skalen (Halbtöne über Grundton)
  SCALES: { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10], dorian: [0, 2, 5, 7, 9], mystic: [0, 2, 3, 7, 8] },
  // je Ort: Grundton (Hz), Skala, Tempo (s pro Akkord), Farbe (Filter Hz),
  // dazu ein eigenes Motiv (Skalenstufen + Notenlängen in Takten), ein Leadinstrument und eine Akkordfolge.
  // Das Motiv ist der "Ohrwurm" – ohne ihn klang jeder Ort gleich (nur Pad + Zufallstöne).
  MOODS: {
    see: {
      // Der See ist der erste Ort, den jeder hört: warme Nylonsaite, viel Luft dazwischen
      root: 220.0, scale: "major", chord: 5.5, cutoff: 1600, pluckRate: 0.3, lead: "nylon", perc: "shaker", percRate: 0.5,
      prog: [0, 3, 1, 4], motif: [[0, 1], [2, 1], [4, 2], [2, 1], [1, 3]], swing: 0.55
    },
    boot: {
      root: 196.0, scale: "dorian", chord: 6.5, cutoff: 1300, pluckRate: 0.3, lead: "pluck", perc: "woodblock", percRate: 0.4,
      prog: [0, -2, 2, 1], motif: [[4, 2], [2, 1], [0, 1], [2, 2], [4, 1], [5, 3]], swing: 0.62
    },
    kueste: {
      root: 246.9, scale: "major", chord: 5, cutoff: 2000, pluckRate: 0.4, lead: "flute", perc: "shaker", percRate: 0.75,
      prog: [0, 4, 2, 3], motif: [[2, 1], [4, 1], [5, 1], [4, 2], [2, 1], [0, 2]], swing: 0.5
    },
    riff: {
      root: 261.6, scale: "major", chord: 4.5, cutoff: 2600, pluckRate: 0.5, lead: "marimba", perc: "woodblock", percRate: 1,
      prog: [0, 2, 5, 3], motif: [[0, 1], [2, 1], [4, 1], [6, 1], [5, 1], [4, 1], [2, 2]], swing: 0.58
    },
    tiefsee: {
      root: 146.8, scale: "mystic", chord: 9, cutoff: 800, pluckRate: 0.2, lead: "bell", perc: "drip", percRate: 0.3,
      prog: [0, -1, -3, 1], motif: [[0, 3], [3, 2], [2, 3], [-1, 4]], swing: 0.5
    },
    arktis: {
      root: 174.6, scale: "minor", chord: 7.5, cutoff: 1100, pluckRate: 0.25, lead: "bell", perc: "shaker", percRate: 0.35,
      prog: [0, 2, -2, 1], motif: [[4, 2], [3, 1], [2, 2], [0, 1], [2, 2]], swing: 0.5
    },
    // Das Becken-Zimmer (E12): eigene Musik fürs Hauptmenü. Am Wasser ist es ruhig und
    // weit — hier drinnen ist es gemütlich, warm und ein bisschen albern. Der Wechsel
    // ist Absicht: man hört, dass man das Spiel verlassen hat.
    //
    // Warum diese Werte: Grundton D4 (293,7 Hz) liegt eine Quarte über dem See und ist
    // damit hell, ohne schrill zu werden. Dur, kurze Akkorde (3,6 s statt 5,5 s) und ein
    // weit offener Filter machen das Tempo; das Schwungmaß 0,62 gibt der Melodie den
    // leichten Hüpfer, an dem man „albern" hört. Das Leadinstrument ist die **Marimba** —
    // ein Holzinstrument in einem Zimmer aus Holzbrettern, dazu der Holzblock als Puls.
    // Das Motiv ist bewusst kurz und springt in Terzen auf und ab, statt zu schweben.
    hub: {
      root: 293.7, scale: "major", chord: 3.6, cutoff: 2800, pluckRate: 0.6, lead: "marimba", perc: "woodblock", percRate: 1.1,
      prog: [0, 4, 5, 3], motif: [[0, 1], [2, 1], [4, 1], [2, 1], [5, 1], [4, 2]], swing: 0.62
    },
    // Bosskampf: tiefer, düsterer, schnelle Akkordwechsel – dazu Trommelpuls (siehe drum())
    boss: {
      root: 130.8, scale: "minor", chord: 3.4, cutoff: 2200, pluckRate: 0.1, lead: "pluck", perc: null, percRate: 0,
      prog: [0, 0, -2, -1], motif: [[0, 1], [0, 1], [3, 1], [2, 1]], swing: 0.5
    }
  },
  bossMode: false, nextDrum: 0, drumStep: 0,
  section: 1, sectionChord: 0, lastMoodKey: null,   // Start direkt mit Melodie, nicht mit Pad-Fläche
  // Drill: zwischen ruhig und Bosskampf. fight läuft weich von 0 auf 1 und wieder zurück,
  // damit die Musik anzieht, wenn ein Fisch hängt – und danach sanft zurückgleitet.
  fight: 0, nextPulse: 0,

  start() {
    if (this.started) return;
    Sound.ensure(); if (!Sound.ctx) return;
    this.ctx = Sound.ctx; this.started = true;
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0;
    this.filter = c.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = 1400; this.filter.Q.value = 0.5;
    // Hall: generierte Impulsantwort (Rauschen mit exponentiellem Abfall)
    this.reverb = c.createConvolver();
    const len = c.sampleRate * 3.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.55, this.dry = c.createGain(); this.dry.gain.value = 0.7;
    this.padGain = c.createGain(); this.padGain.gain.value = 0.22;
    this.pluckGain = c.createGain(); this.pluckGain.gain.value = 0.35;
    this.ambGain = c.createGain(); this.ambGain.gain.value = 0.5;
    // Flächen laufen durch eine langsam schwankende Verzögerung – das ist der
    // "Bandeier"-Effekt: minimal schwebende Tonhöhe, wie bei einer alten Kassette.
    const wow = c.createDelay(0.1); wow.delayTime.value = 0.018;
    const wowLfo = c.createOscillator(); wowLfo.frequency.value = 0.13;
    const wowAmt = c.createGain(); wowAmt.gain.value = 0.0006;
    wowLfo.connect(wowAmt).connect(wow.delayTime); wowLfo.start();
    this.padGain.connect(wow); wow.connect(this.filter);
    this.pluckGain.connect(this.filter);
    this.filter.connect(this.dry); this.filter.connect(this.reverb); this.reverb.connect(wet);
    // Bandsättigung auf der Summe: eine weiche Kennlinie rundet die digitalen
    // Spitzen ab. Nichts wird lauter, es klingt nur wärmer und gebundener.
    const sat = c.createWaveShaper();
    const curve = new Float32Array(2048), k = 1.7;
    for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
    sat.curve = curve; sat.oversample = "2x";
    this.dry.connect(sat); wet.connect(sat); this.ambGain.connect(sat);
    sat.connect(this.master);
    this.master.connect(c.destination);
    this.setVolume(this.volume);
    this.startAmbience();
    this.nextChord = c.currentTime + 0.5; this.nextPluck = c.currentTime + 3;
  },

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.enabled && !Sound.muted ? v * 0.6 : 0, this.ctx.currentTime, 0.4); },
  toggle() { this.enabled = !this.enabled; if (!this.started && this.enabled) this.start(); this.setVolume(this.volume); save.music = this.enabled; saveGame(); },

  // Welches Stück gerade dran ist. Reihenfolge = Rangfolge: Boss schlägt alles, das
  // offene Becken-Menü schlägt den Ort, sonst spielt der Ort.
  moodKey() { return this.bossMode ? "boss" : ((typeof hubScreen !== "undefined" && hubScreen) ? "hub" : getLocation().id); },
  mood() { return this.MOODS[this.moodKey()] || this.MOODS.see; },

  // Boss-Modus schaltet sich selbst an/aus (siehe update) – sofortiger Akkordwechsel, damit man es hört
  setBoss(on) {
    if (this.bossMode === on) return;
    this.bossMode = on;
    if (!this.started) return;
    this.nextChord = this.ctx.currentTime; this.chordIdx = 0;
    this.nextDrum = this.ctx.currentTime + 0.05; this.drumStep = 0;
    this.nextPluck = this.ctx.currentTime + (on ? 4 : 2);
  },

  // Trommelpuls: Kick auf 1 und 3, Tom als Kontrapunkt. Tempo steigt mit der Boss-Phase.
  drum(phase) {
    const c = this.ctx, t = c.currentTime;
    const kick = this.drumStep % 2 === 0;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(kick ? 150 : 220, t);
    o.frequency.exponentialRampToValueAtTime(kick ? 42 : 80, t + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kick ? 0.5 : 0.26, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kick ? 0.32 : 0.2));
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
    // ab Phase 3 ein Rausch-Akzent oben drauf
    if (phase >= 3 && kick) {
      const len = Math.floor(c.sampleRate * 0.12), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource(); src.buffer = buf;
      const hf = c.createBiquadFilter(); hf.type = "highpass"; hf.frequency.value = 3000;
      const hg = c.createGain(); hg.gain.value = 0.12;
      src.connect(hf).connect(hg).connect(this.master); src.start(t);
    }
    this.drumStep++;
  },
  noteHz(root, scale, degree, octave = 0) { const s = this.SCALES[scale]; const idx = ((degree % s.length) + s.length) % s.length; const oct = Math.floor(degree / s.length) + octave; return root * Math.pow(2, (s[idx] + 12 * oct) / 12); },

  // --- Gezupfte Saite (Karplus-Strong) ---------------------------------------
  // Der alte Zupfton war ein Sägezahn durch einen Tiefpass. Das klingt nach
  // Synthesizer, weil es einer ist. Hier wird stattdessen eine echte Saite
  // nachgerechnet: ein kurzer Rauschstoß läuft im Kreis durch eine Verzögerung,
  // die bei jedem Umlauf ein bisschen Höhen verliert – genau das macht eine
  // Nylonsaite auch. Das Ergebnis klingt hölzern und warm statt elektronisch.
  //
  // Die Rückkopplung läuft nicht als Web-Audio-Schleife (ein DelayNode in einem
  // Kreis kann technisch nicht kürzer als ein Renderblock sein, damit wären alle
  // Töne über ~340 Hz verstimmt), sondern wird einmal in einen Puffer gerechnet.
  // Pro Klangfarbe reichen vier Puffer – je einer pro Oktave; die Zwischentöne
  // entstehen über die Abspielgeschwindigkeit, so wie es ein Sampler macht.
  ksCache: {},
  KS_REFS: [110, 220, 440, 880],
  ksBuffer(refHz, timbre) {
    const key = timbre + "@" + refHz;
    if (this.ksCache[key]) return this.ksCache[key];
    const c = this.ctx, sr = c.sampleRate;
    const seconds = 2.6, len = Math.floor(sr * seconds);
    const buf = c.createBuffer(1, len, sr), y = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / refHz));
    // Anregung: gefiltertes Rauschen. Je weicher gefiltert, desto weicher der Anschlag –
    // "nylon" wird angezupft, "steel" schärfer angerissen.
    const soft = timbre === "nylon" ? 0.38 : 0.72;
    // N+1 Startwerte, nicht N: der Umlauf unten greift auf zwei Nachbarn zurück
    // (i-N und i-N-1), und ohne den zusätzlichen Wert läuft der erste Schritt
    // auf einen leeren Index – das ergäbe NaN und würde den ganzen Puffer stumm machen.
    let lp = 0;
    for (let i = 0; i <= N; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * soft;
      y[i] = lp * (1 - i / (N + 1) * 0.35);
    }
    // Umlauf: Mittelwert zweier Nachbarn = Höhenverlust pro Runde.
    // decay steuert, wie lange die Saite klingt, tone die Klangfarbe (0.5 = warm).
    const decay = timbre === "nylon" ? 0.9965 : 0.9975;
    const tone = timbre === "nylon" ? 0.52 : 0.62;
    for (let i = N + 1; i < len; i++) y[i] = decay * (tone * y[i - N] + (1 - tone) * y[i - N - 1]);
    // Ausklang glattziehen, damit der Puffer nicht hart abbricht
    const fade = Math.floor(sr * 0.25);
    for (let i = len - fade; i < len; i++) y[i] *= (len - i) / fade;
    this.ksCache[key] = buf;
    return buf;
  },
  // Spielt eine gezupfte Saite bei Frequenz f. gain skaliert die Lautstärke.
  ksNote(f, when, gain = 0.3, timbre = "nylon", dur = 0) {
    const c = this.ctx;
    // nächstgelegene Referenzoktave suchen – die Feinstimmung macht playbackRate
    let ref = this.KS_REFS[0];
    for (const r of this.KS_REFS) if (Math.abs(Math.log2(f / r)) < Math.abs(Math.log2(f / ref))) ref = r;
    const src = c.createBufferSource();
    src.buffer = this.ksBuffer(ref, timbre);
    src.playbackRate.value = (f / ref) * this.driftRate();
    const g = c.createGain();
    g.gain.setValueAtTime(gain, when);
    // Wenn die Note kürzer als der Puffer ist, wird sie sanft abgedämpft –
    // wie eine Hand, die auf die Saite legt. Kein hartes Abschneiden.
    if (dur > 0) {
      g.gain.setValueAtTime(gain, when + dur * 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.35);
    }
    src.connect(g).connect(this.pluckGain);
    src.start(when);
    src.stop(when + (dur > 0 ? dur + 0.4 : 2.7));
  },

  // --- Bandleiern ------------------------------------------------------------
  // Jeder digital erzeugte Ton ist exakt gestimmt. Genau das hört man als
  // "künstlich". Ein altes Tonband eiert um ein paar Cent – zu wenig, um schief
  // zu klingen, genug, damit es lebendig wirkt. Zwei überlagerte langsame Wellen,
  // damit kein hörbares Muster entsteht.
  driftCents() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    return Math.sin(t * 0.11) * 2.4 + Math.sin(t * 0.29 + 1.7) * 1.3;
  },
  driftRate() { return Math.pow(2, this.driftCents() / 1200); },

  update() {
    if (!this.started || !this.enabled || Sound.muted) return;
    const c = this.ctx, light = getPalette(dayTime).light;
    // Bosskampf und Boss-Auftritt schalten die Musik automatisch um
    const wantBoss = (typeof bossFight !== "undefined" && !!bossFight) || (typeof cutscene !== "undefined" && !!cutscene);
    if (wantBoss !== this.bossMode) this.setBoss(wantBoss);
    const m = this.mood();
    // Drill: Musik zieht an, sobald ein Fisch hängt – weicher Auf- und Abbau statt Umschalten
    const wantFight = !this.bossMode && (gameState === "reeling" || gameState === "biting");
    this.fight += ((wantFight ? 1 : 0) - this.fight) * 0.03;
    if (this.fight < 0.004) this.fight = 0;
    // Nachts dunkler, langsamer – im Kampf nicht (der bleibt treibend), und im
    // Becken-Zimmer auch nicht: dort ist immer Lampenlicht, die Uhrzeit steht sogar still.
    const inHub = typeof hubScreen !== "undefined" && hubScreen;
    const night = light < 0.4 && !this.bossMode && !inHub && this.fight < 0.5;
    if (this.bossMode && c.currentTime >= this.nextDrum) {
      const ph = (typeof bossFight !== "undefined" && bossFight && typeof bossPhase === "function") ? bossPhase(bossFight) : 1;
      this.drum(ph);
      this.nextDrum = c.currentTime + (ph === 3 ? 0.30 : ph === 2 ? 0.38 : 0.5);
    }
    // im Drill öffnet sich der Filter – die Musik wird präsenter, ohne lauter zu werden
    this.filter.frequency.setTargetAtTime(m.cutoff * (night ? 0.6 : 1) * (weather.type === "rain" ? 0.8 : 1) * (1 + this.fight * 0.7), c.currentTime, 0.6);
    // Stückwechsel (Ort, Becken-Menü, Boss): nicht den alten Akkord aussitzen, aber auch
    // nicht hart schneiden. Die Summe geht in 0,20 s auf ein Viertel zurück und in
    // 0,55 s wieder hoch; der neue Akkord setzt genau im Tal ein (0,18 s). Man hört
    // einen Atemzug, keinen Schnitt — und nie eine Stille, denn 25 % bleiben stehen.
    const moodKey = this.moodKey();
    if (moodKey !== this.lastMoodKey) {
      if (this.lastMoodKey !== null) {
        const g = this.master.gain, lvl = this.enabled && !Sound.muted ? this.volume * 0.6 : 0;
        g.cancelScheduledValues(c.currentTime);
        g.setValueAtTime(g.value, c.currentTime);
        g.linearRampToValueAtTime(lvl * 0.25, c.currentTime + 0.20);
        g.linearRampToValueAtTime(lvl, c.currentTime + 0.75);
        this.nextChord = c.currentTime + 0.18; this.chordIdx = 0; this.section = 1; this.sectionChord = 0;
        this.nextPluck = c.currentTime + 1.2; this.nextPerc = c.currentTime + 0.18;
      }
      this.lastMoodKey = moodKey;
    }
    if (c.currentTime >= this.nextChord) {
      const prog = m.prog || [0, 2, 3, 1];
      const deg = prog[this.chordIdx % prog.length] + (night ? -2 : 0);
      this.chordIdx++;
      // Im Drill werden die Akkorde kürzer → treibender, ohne die Tonart zu wechseln
      const dur = m.chord * (night ? 1.2 : 1) * (1 - this.fight * 0.42);
      // Atempause: im ruhigen Abschnitt bleibt der zweite Akkord fast leer.
      // Gemütliche Spielemusik lebt von der Stille dazwischen – dann hört man
      // das Wasser, den Wind und die Vögel, und der nächste Ton wirkt wieder wie
      // ein Ereignis. Ohne das läuft ein Loop, der einen nach zehn Minuten nervt.
      // Im Kampf und beim Boss gibt es keine Pausen, da soll es treiben.
      const breathe = this.section === 0 && this.sectionChord === 1 && !this.bossMode && this.fight < 0.2;
      if (breathe) {
        this.pad(m, deg, dur, 0.28);      // nur ein Hauch Fläche, kein Bass, keine Melodie
        this.breathTone = c.currentTime + dur * 0.45;   // ein einzelner Ton in die Stille
      } else {
        this.pad(m, deg, dur);
        this.bass(m, deg, dur);
      }
      // Abschnittswechsel alle 2 Akkorde: 0 nur Pad+Bass, 1 Melodie, 2 Melodie+Perkussion,
      // 3 Melodie eine Terz höher, 4 Melodie eine Oktave höher – so bleibt es in Bewegung
      if (++this.sectionChord >= 2) { this.sectionChord = 0; this.section = (this.section + 1) % 5; }
      const sec = this.fight > 0.4 ? 2 : this.section;   // im Drill immer die dichte Fassung
      if (sec >= 1 && !breathe) this.scheduleMelody(m, deg, dur, sec);
      this.nextChord = c.currentTime + dur;
      this.nextPerc = c.currentTime;
    }
    // Perkussion in den dichteren Abschnitten – und immer, solange ein Fisch hängt
    const percOn = (m.perc && this.section >= 2 && this.section !== 4) || (m.perc && this.fight > 0.4);
    if (percOn && c.currentTime >= (this.nextPerc || 0)) {
      const step = (m.chord / 8) / Math.max(0.25, m.percRate || 0.5) * (1 - this.fight * 0.4);
      if (Math.random() < 0.85) this.percHit(m.perc);
      this.nextPerc = c.currentTime + step;
    }
    // Pulsierender Bassimpuls im Drill – der Herzschlag des Kampfes
    if (this.fight > 0.25 && c.currentTime >= this.nextPulse) {
      const t = c.currentTime, f = this.noteHz(m.root, m.scale, 0, -2);
      const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16 * this.fight, t + 0.03);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.32);
      this.nextPulse = t + 0.42;
    }
    // Ein einzelner Ton mitten in die Atempause – die Antwort auf die Stille
    if (this.breathTone && c.currentTime >= this.breathTone) {
      this.breathTone = 0;
      this.pluck(m, [0, 2, 4][Math.floor(Math.random() * 3)], night ? -1 : 0);
    }
    // vereinzelte Zufallstöne nur im ruhigen Abschnitt, damit es dort nicht leer wirkt
    if (this.section === 0 && !this.breathTone && c.currentTime >= this.nextPluck) {
      if (Math.random() < m.pluckRate * (night ? 0.6 : 1)) this.pluck(m, Math.floor(rand(0, 10)), night ? -1 : 0);
      this.nextPluck = c.currentTime + rand(1.2, 3);
    }
    // Ambiente an Wetter/Zeit anpassen
    // Tiefsee: kein Regen zu hören, und das Wasserrauschen der Oberfläche verstummt
    // Im Becken-Zimmer regnet es nicht und es singt kein Vogel: dort bleibt nur ein
    // leises Blubbern, das Becken selbst. Es ist ein Zimmer, kein Ufer.
    const deep = typeof isDeepSea === "function" && isDeepSea();
    // Arktis: der Niederschlag ist Schnee, und Schnee macht kein Prasseln (#104)
    const eis = typeof getLocation === "function" && getLocation().mode === "ice";
    if (this.ambience.rain) this.ambience.rain.gain.setTargetAtTime(weather.type === "rain" && !deep && !inHub && !eis ? 0.35 : 0, c.currentTime, 2);
    if (this.ambience.water) this.ambience.water.gain.setTargetAtTime(inHub ? 0.12 : (deep ? 0.10 : 0.25), c.currentTime, 2);
    if (this.ambience.birds) this.ambience.birdsOn = !inHub && light > 0.55 && weather.type !== "rain" && getLocation().mode !== "boat" && !deep;
    if (this.ambience.birdsOn && Math.random() < 0.004) this.bird();
  },

  // Akkordlagen. Vorher lag über jedem Akkord dieselbe Griffweise [0,2,4] –
  // sauber, aber eben immer gleich und immer nur ein Dreiklang. Die Stufe 6 ist
  // auf einer fünftönigen Skala die None, die 5 die Sexte: das sind die Töne,
  // die einen Akkord von "Kinderlied" nach "Sommerabend" verschieben.
  // Reihum gespielt, damit dieselbe Harmonie nie zweimal gleich klingt.
  VOICINGS: [[0, 2, 4], [0, 2, 4, 6], [0, 4, 6], [2, 4, 6], [0, 2, 5], [0, 3, 4, 6]],

  // weicher Akkord: langsames Ein-/Ausblenden, leichtes Detune, wechselnde Lage
  pad(m, deg, dur, level = 1) {
    const c = this.ctx;
    const voicing = this.VOICINGS[this.chordIdx % this.VOICINGS.length];
    const det0 = this.driftCents();
    voicing.forEach((iv, i) => {
      const f = this.noteHz(m.root, m.scale, deg + iv, i === 0 ? -1 : 0);
      // je höher die Stimme, desto leiser – sonst deckt die None den Grundton zu
      const vol = (i === 0 ? 0.09 : 0.075 / (1 + i * 0.35)) * level;
      for (const det of [-4, 4]) {
        const o = c.createOscillator(); o.type = i === 0 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = det + det0;
        const g = c.createGain(); g.gain.setValueAtTime(0, c.currentTime);
        g.gain.linearRampToValueAtTime(vol, c.currentTime + dur * 0.35);
        g.gain.linearRampToValueAtTime(vol * 0.67, c.currentTime + dur * 0.7);
        g.gain.linearRampToValueAtTime(0, c.currentTime + dur * 1.05);
        o.connect(g).connect(this.padGain); o.start(); o.stop(c.currentTime + dur * 1.1);
      }
    });
  },

  // --- Melodie ---------------------------------------------------------------
  // Plant das Motiv über einen Akkord. Je nach Abschnitt variiert es (Oktave, Terz, Umkehrung),
  // damit dieselbe Tonfolge nicht endlos gleich klingt.
  scheduleMelody(m, deg, dur, section) {
    const c = this.ctx, beat = dur / 8;             // Motivlängen sind Achtel des Akkords
    let t = c.currentTime + 0.02, i = 0;
    const shift = section === 3 ? 2 : 0;            // Abschnitt 3: eine Terz höher
    const oct = section === 4 ? 1 : 0;              // Abschnitt 4: eine Oktave höher
    for (const [step, len] of m.motif) {
      const swung = i % 2 === 1 ? beat * (m.swing - 0.5) * 2 : 0;   // leichter Swing
      const when = t + swung;
      if (t - c.currentTime < dur - 0.05) this.lead(m, deg + step + shift, oct, when, beat * len);
      t += beat * len; i++;
    }
  },

  // Leadinstrument – vier Klangfarben, damit die Orte hörbar verschieden sind
  lead(m, deg, oct, when, dur) {
    const c = this.ctx, f = this.noteHz(m.root, m.scale, deg, oct + 1);
    const g = c.createGain();
    const kind = m.lead;
    const o = c.createOscillator();
    let stop = when + dur + 0.5;
    if (kind === "marimba") {
      o.type = "triangle"; o.frequency.value = f;
      const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 4;
      const g2 = c.createGain(); g2.gain.setValueAtTime(0.09, when); g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
      o2.connect(g2).connect(this.pluckGain); o2.start(when); o2.stop(when + 0.2);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.42, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(dur * 1.4, 0.9));
      stop = when + 1.1;
    } else if (kind === "bell") {
      o.type = "sine"; o.frequency.value = f;
      const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2.76; // glockiger Oberton
      const g2 = c.createGain(); g2.gain.setValueAtTime(0.06, when); g2.gain.exponentialRampToValueAtTime(0.0001, when + 1.2);
      o2.connect(g2).connect(this.pluckGain); o2.start(when); o2.stop(when + 1.4);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.34, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
      stop = when + 2.8;
    } else if (kind === "flute") {
      o.type = "sine"; o.frequency.value = f;
      const vib = c.createOscillator(); vib.frequency.value = 5.2;
      const vg = c.createGain(); vg.gain.value = f * 0.006;
      vib.connect(vg).connect(o.frequency); vib.start(when); vib.stop(when + dur + 0.4);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.3, when + 0.12);
      g.gain.setValueAtTime(0.3, when + dur * 0.75);
      g.gain.linearRampToValueAtTime(0.0001, when + dur + 0.25);
      stop = when + dur + 0.4;
    } else if (kind === "nylon" || kind === "pluck") {
      // Echte gezupfte Saite. Der Oszillator wird hier gar nicht gebraucht.
      this.ksNote(f, when, 0.34, kind === "nylon" ? "nylon" : "steel", Math.min(dur * 1.5, 1.6));
      return;
    } else {
      o.type = "sawtooth"; o.frequency.value = f;
      const lp = c.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(f * 6, when); lp.frequency.exponentialRampToValueAtTime(f * 1.5, when + 0.35);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.3, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(dur * 1.3, 1.1));
      o.connect(lp).connect(g).connect(this.pluckGain); o.start(when); o.stop(when + 1.3);
      return;
    }
    o.connect(g).connect(this.pluckGain); o.start(when); o.stop(stop);
  },

  // Bass: trägt den Akkord, macht das Ganze weniger schwebend
  bass(m, deg, dur) {
    const c = this.ctx, t = c.currentTime, f = this.noteHz(m.root, m.scale, deg, -2);
    const dc = this.driftCents();
    const o = c.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.detune.value = dc;
    const sub = c.createOscillator(); sub.type = "sine"; sub.frequency.value = f / 2; sub.detune.value = dc;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.25);
    g.gain.linearRampToValueAtTime(0.2, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 0.98);
    const sg = c.createGain(); sg.gain.value = 0.5;
    o.connect(g); sub.connect(sg).connect(g); g.connect(this.padGain);
    o.start(t); sub.start(t); o.stop(t + dur); sub.stop(t + dur);
  },

  // Perkussion: sparsam, nur in den dichteren Abschnitten
  percHit(kind) {
    const c = this.ctx, t = c.currentTime;
    if (kind === "shaker" || kind === "drip") {
      const len = Math.floor(c.sampleRate * (kind === "drip" ? 0.18 : 0.06));
      const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, kind === "drip" ? 5 : 2);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = kind === "drip" ? "bandpass" : "highpass";
      f.frequency.value = kind === "drip" ? 1200 : 4200; f.Q.value = kind === "drip" ? 8 : 0.7;
      // sanft ein- und ausblenden statt hart einsetzen
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(kind === "drip" ? 0.14 : 0.045, t + 0.012);
      g.gain.linearRampToValueAtTime(0.0001, t + (kind === "drip" ? 0.18 : 0.07));
      src.connect(f).connect(g).connect(this.master); src.start(t);
    } else { // weiches Holzblock-Tock (früher eine Rechteckwelle mit 4 ms Attack – das klickte)
      const o = c.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(560, t);
      o.frequency.exponentialRampToValueAtTime(330, t + 0.06);
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.018);   // längerer Anschlag = kein Klick
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
    }
  },

  // Einzelner gezupfter Ton – die Saite darf hier voll ausklingen
  pluck(m, deg, oct) {
    const f = this.noteHz(m.root, m.scale, deg, oct + 1);
    this.ksNote(f, this.ctx.currentTime, 0.3, "nylon", 0);
  },

  // Wasser (braunes Rauschen, tief gefiltert, langsam wogend) + Regen (weißes Rauschen, gefiltert)
  startAmbience() {
    const c = this.ctx;
    const mk = (color, cutoff, gain) => {
      const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (color === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(this.ambGain); src.start();
      return g;
    };
    this.ambience.water = mk("brown", 400, 0.25);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08; const lg = c.createGain(); lg.gain.value = 0.1;
    lfo.connect(lg).connect(this.ambience.water.gain); lfo.start();
    this.ambience.rain = mk("white", 1800, 0);
  },

  bird() {
    const c = this.ctx, t0 = c.currentTime, base = rand(1800, 3200);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = c.createOscillator(); o.type = "sine";
      const t = t0 + i * 0.13;
      o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.6), t + 0.06); o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(g).connect(this.ambGain); o.start(t); o.stop(t + 0.15);
    }
  }
};
```

---

## 3. Native / Capacitor

### `package.json` dependencies (Capacitor 8.x)

```json
"devDependencies": {
  "@capacitor/cli": "^8.5.0",
  "terser": "^5.51.0"
},
"dependencies": {
  "@capacitor-community/admob": "^8.1.0",
  "@capacitor/android": "^8.5.0",
  "@capacitor/core": "^8.5.0",
  "@capacitor/haptics": "^8.0.2",
  "@capacitor/ios": "^8.5.0",
  "@capacitor/share": "^8.0.1",
  "@capacitor/splash-screen": "^8.0.2",
  "@capacitor/status-bar": "^8.0.3",
  "@revenuecat/purchases-capacitor": "^13.4.2"
}
```
npm scripts: `build` → `powershell -File ./build.ps1`; `sync` → build + `npx cap sync`;
`ios` → `npx cap open ios`.

### `capacitor.config.json`

```json
{
  "appId": "de.fishingadventure.app",
  "appName": "A Silly Fishing Game",
  "webDir": "dist/site",
  "bundledWebRuntime": false,
  "ios": { "contentInset": "never", "backgroundColor": "#1c4f6b", "preferredContentMode": "mobile" },
  "android": { "backgroundColor": "#1c4f6b", "allowMixedContent": false },
  "plugins": {
    "SplashScreen": { "launchShowDuration": 800, "backgroundColor": "#1c4f6b", "showSpinner": false },
    "StatusBar": { "style": "DARK", "overlaysWebView": true }
  }
}
```
Bundle id `de.fishingadventure.app`, app name "A Silly Fishing Game", theme color
`#1c4f6b` used consistently as splash/background across web meta tags, Capacitor config,
and native manifests.

### Native bridge (`native.js`) — plugin usage pattern

Plugins are accessed via `window.Capacitor.registerPlugin("Name")` directly — **no
bundler-generated plugin imports**, so this works unmodified inside the single-file HTML
bundle. `Native.init()` runs once, `setTimeout(() => Native.init(), 0)` after game setup
(so the Capacitor bridge object exists), and is a no-op in browser (`isNative()` checks
`window.Capacitor.isNativePlatform()`).

- **Haptics**: `window.haptic = pattern => Haptics.impact({ style: array.length>2 ?
  "HEAVY" : "MEDIUM" })` — replaces `navigator.vibrate` (unavailable on iOS WKWebView).
- **AdMob** (`@capacitor-community/admob`): `initialize({ initializeForTesting: false })`,
  then **required before first ad**: `requestTrackingAuthorization()` (iOS ATT prompt) →
  `requestConsentInfo()` → `showConsentForm()` if required (UMP/GDPR) →
  `canRequestAds` gate. Rewarded ad lifecycle via listeners
  (`onRewardVideoAdRewarded/Dismissed/FailedToLoad/Loaded`) plus a preload-on-dismiss loop.
  `Ads.showRewarded` is monkey-patched at runtime to call the native rewarded flow instead
  of the web placeholder. Banner: `showBanner({ adSize: "ADAPTIVE_BANNER", position:
  "BOTTOM_CENTER", margin: 0 })` — margin 0 because the game reserves space above the
  banner itself via `safeBottom` (App Store rule: ads must not overlap UI controls).
  All ad unit IDs in the source are **Google test IDs** — flagged `TODO` to replace with
  real IDs before release (both `native.js` config and `Info.plist`/`AndroidManifest.xml`
  app IDs).
- **RevenueCat** (`@revenuecat/purchases-capacitor`): `Purchases.configure({ apiKey })` per
  platform, `getCustomerInfo()` → checks `entitlements.active.adfree`, purchase flow via
  `getOfferings()` → `purchasePackage()`. Entitlement key: `"adfree"`. Product IDs:
  `gems_50`/`gems_200`/`gems_600`. RevenueCat keys in the source are placeholders
  (`appl_XXXXXXXX`/`goog_XXXXXXXX`).

### iOS `Info.plist` — must-preserve keys

| Key | Value | Why |
|---|---|---|
| `CADisableMinimumFrameDurationOnPhone` | `true` | **Critical for ProMotion.** Without it iOS caps the WKWebView at 60Hz regardless of actual game speed — measured 125fps in Safari vs. would-be 60fps in Capacitor without this key on an iPhone 15 Pro Max. Any perf measurement without this key is measuring the cap, not the game. |
| `UISupportedInterfaceOrientations` | Portrait only (iPhone); Portrait + upside-down (iPad) | Portrait-locked game |
| `UIRequiresFullScreen` | `true` | |
| `UIStatusBarHidden` | `true` | |
| `UIViewControllerBasedStatusBarAppearance` | `true` | |
| `GADApplicationIdentifier` | `ca-app-pub-3940256099942544~1458002511` (Google **test** app ID) | AdMob — replace before release |
| `NSUserTrackingUsageDescription` | German ATT usage string ("we use this identifier to show more relevant ads…") | Required for `requestTrackingAuthorization()` |
| `SKAdNetworkItems` | ~48 `SKAdNetworkIdentifier` entries | Required for AdMob mediation attribution on iOS 14+ |
| `LSRequiresIPhoneOS`, `UIRequiredDeviceCapabilities: [armv7]` | — | boilerplate |

### Android `AndroidManifest.xml` essentials

- `<activity android:screenOrientation="portrait">` + a broad `configChanges` list
  (orientation/keyboard/screenSize/locale/etc.) so Capacitor doesn't recreate the activity
  (and lose WebGL context) on every rotation/config change.
- `com.google.android.gms.ads.APPLICATION_ID` meta-data =
  `ca-app-pub-3940256099942544~3347511713` (Google test ID, same TODO as iOS).
- `FileProvider` (`androidx.core.content.FileProvider`) for share/export
  (`@capacitor/share`), authority `${applicationId}.fileprovider`.
- Only permission requested: `android.permission.INTERNET`.
- `android:launchMode="singleTask"`, custom `AppTheme.NoActionBarLaunch` theme for the
  launch activity.

### Splash/icons

- iOS: `Assets.xcassets/Splash.imageset` (2732×2732 @1x/2x/3x source), driven via
  `LaunchScreen.storyboard`; matches `capacitor.config.json`'s
  `backgroundColor: "#1c4f6b"`.
- Android: standard adaptive icon set under `mipmap-{m,h,xh,xxh,xxxh}dpi` (`ic_launcher`,
  `ic_launcher_round`, `ic_launcher_foreground` + `mipmap-anydpi-v26` adaptive XML,
  `drawable/ic_launcher_background.xml`).
- Both generated via the standard `@capacitor/assets`-style pipeline (not authored by
  hand); the rebuild should regenerate from a source icon/splash rather than reuse these
  files directly (out of scope to copy — they're the old branding).

### GitHub Actions workflows

**`.github/workflows/ios.yml`** — "iOS · TestFlight". Triggers on `push` tag `v*` or
manual dispatch. Runs on `macos-15`, Xcode 16.2. Steps: `npm ci` → `pwsh -File
./build.ps1` (builds the web bundle) → `npx cap sync ios` → patches
`ExportOptions.plist`'s `TEAM_ID_PLACEHOLDER` with a secret → writes the App Store Connect
API key `.p8` to a temp file → `xcodebuild archive` with **cloud/automatic signing via the
API key** (`-authenticationKeyIssuerID/-authenticationKeyID/-authenticationKeyPath`,
`CODE_SIGN_STYLE=Automatic`) → `xcodebuild -exportArchive` → uploads to TestFlight. No
macOS certificate needed — everything is API-key based, so it works from a Windows dev
machine that can't sign iOS builds locally.
Required repo secrets: `APPLE_KEY_ID`, `APPLE_ISSUER_ID`, `APPLE_KEY_CONTENT` (base64 of
the `.p8`), `APPLE_TEAM_ID`.
`ExportOptions.plist` (checked in, has `TEAM_ID_PLACEHOLDER` substituted at CI time):
`method: app-store-connect`, `signingStyle: automatic`, `destination: upload`,
`uploadSymbols: true`, `manageAppVersionAndBuildNumber: true`.

**`.github/workflows/android.yml`** — "Android · Debug APK". Same triggers. Runs on
`ubuntu-latest`, Java 21 (Temurin). Steps: `npm ci` → `pwsh -File ./build.ps1` → `npx cap
sync android` → `./gradlew assembleDebug` → uploads `app-debug.apk` as a workflow
artifact. No secrets needed (debug build, unsigned/debug-signed). Release signing for
Google Play is explicitly noted as **not yet implemented** ("follows once the Play
Console account is set up").

---

## 4. Build & deploy

### `build.ps1`

Bundles ~40 JS files (in a fixed, dependency-ordered array — fonts/i18n/utility modules
first, then game systems, then rendering, then `script.js`/`native.js`/`online.js` last)
into one file, each prefixed with a `// ===== filename.js =====` comment marker. Usage:
`.\build.ps1` (minified) or `.\build.ps1 -Dev` (unminified, for debugging).

Steps:
1. Concatenate all listed files (skipping any that don't exist) into `dist\bundle.js`.
2. If not `-Dev` and `node_modules\.bin\terser.cmd` exists: minify with
   `terser --compress passes=2,drop_console=true --mangle toplevel=true`. **Property
   mangling is deliberately NOT used** — the code relies on Canvas API property names and
   a plain `save` object whose keys are read/written by name; mangling those would break
   at runtime. Falls back to unminified if terser is missing or fails.
3. Wraps the JS in a minimal HTML shell inline (`<meta charset>`, title, favicon (inline
   SVG emoji), viewport meta incl. `viewport-fit=cover`, `apple-mobile-web-app-capable`,
   `theme-color: #1c4f6b`, a `<style>` block that pins the canvas full-viewport with
   `overscroll-behavior: none`, `touch-action: none`, and a `<canvas id="gameCanvas">`).
4. Writes `dist\fishing-adventure.html` and copies it to `dist\site\index.html`; also
   copies `privacy.html` to `dist\site\privacy.html`.
5. **`phaser.js` is copied as a separate file, never bundled into the minified JS.**
   Explicit reasoning in the script: `terser --mangle toplevel` breaks Phaser's UMD
   wrapper, and bundling it doubles startup time (referenced spike doc
   `SPIKE-PHASER.md`). `world.js` lazy-loads it after first paint.
6. Cleans up the intermediate `dist\bundle.js`.
7. Prints the final `dist\site\index.html` size in KB and whether it was minified.

**Rebuild implication**: any large third-party rendering library (if the rebuild keeps a
Phaser/Pixi-style hybrid layer) should stay a separate unbundled/unminified script file,
loaded lazily post-first-paint — don't fold it into a toplevel-mangled bundle.

### Dev server (`tools/server.js`)

Zero-dependency Node `http` static file server on port 8765 (override via `PORT` env var —
useful to get a separate origin/`localStorage`). Serves the whole project root directly
(no build step needed for local dev — the browser loads the ~40 unbundled `.js` files via
individual `<script>` tags from `index.html`, presumably). Also supports a `PUT
/__out/<name>` upload endpoint gated behind `RECORD=1` env var, used only by marketing
tooling to receive recorded video/logo files from the browser — not relevant to core
gameplay.

### Deploy (`tools/deploy-web.ps1`)

Publishes to GitHub Pages via a **second, public repo** (`silly-fishing-game-web`)
because GitHub Pages needs a paid plan to publish from a private repo, and the source repo
stays private pre-release. Flow: run `build.ps1` → clone/fetch-reset a temp checkout of
the public web repo → copy exactly 3 files from `dist\site\` (`index.html`, `phaser.js`,
`privacy.html`) — **never the source tree** → ensure `.nojekyll` exists (otherwise Pages
ignores any `_`-prefixed asset) → commit (with an explicit `user.email`/`user.name`
override, since a fresh clone has no configured git identity) and push, but only if there
are actual changes. Checks `$LASTEXITCODE` after both `commit` and `push` and throws if
either fails (a past incident: an unchecked failed commit silently reported "uploaded" and
triggered a benchmark run against a stale build). Final published URL pattern:
`https://<user>.github.io/<public-repo>/`. Prints the benchmark query param reminder
(`?bench=1`) after a successful deploy.

---

## 5. Bench/perf tooling — for a rebuilt perf HUD

Two complementary tools exist; a rebuild's lightweight perf HUD should take the *concept*
from both even if the exact table format isn't reproduced.

### `bench.js` — the on-device benchmark rig

**Core principle** (stated explicitly in the file, learned after 4 failed
optimization rounds that measured the wrong thing): the only frame-timing number that
doesn't lie is **the gap between two `requestAnimationFrame` callbacks**. Measuring
`performance.now()` around a draw call measures command recording (Canvas 2D is lazily
rasterized — the browser records draw commands and rasterizes later at composite/upload
time), not actual GPU/rasterization cost. Forcing rasterization via `getImageData()` is
equally wrong — it permanently kicks a canvas off GPU acceleration, so you'd measure a
different pipeline than the one that ships. **Fix**: only measure the raw
frame-to-frame delta, let the real game run for a few seconds under each configuration.

- Invocation: `?bench=1` (full run, ~2 min) or `?bench=1&kurz=1` (half duration).
- Runs an ordered list of **"rows"** (`ZEILEN`), each a `{ id, text, setz(Bench) }` — `setz`
  applies a configuration (resolution multiplier `dpr`, render path
  `direct`/`sub`/`copy`, GPU filter on/off, scene drawing on/off, upload on/off, specific
  location, hub open/closed, etc.) and measures for `DAUER_MS` (3000ms) per row, discarding
  the first `WARM_BILDER` (20) frames after every switch so re-settling doesn't skew data.
  Rows are deliberately ordered so **each adjacent pair isolates exactly one cost**
  (documented explicitly: e.g. `c2d` vs `hybrid 2x` isolates "what the whole Phaser layer
  costs"; `1x`/`2x`/`3x` isolates "does cost scale with pixel count").
  An idle/baseline row is measured **both first and last** — if they disagree, thermal
  throttling (not configuration) explains later rows.
- **`WACHE_ZEILEN`** ("the Watch") is a separate, shorter mode: measures per-*screen* FPS
  (idle, hub, each location, an open menu) rather than per-render-posten — meant to be
  rerun regularly as a regression check ("is it still running fine"), and includes a 4th
  "change vs. last run" column in its report table.
- Metrics reported per row: **fps** (median frame rate — "does it run"), **p95** (95th
  percentile of frame interval — "does it stutter"; should stay close to the median),
  **hak/s** ("hitches per second" — frames that took longer than 2× the median — "the
  number you *feel*").
- Output: an on-screen table (photographable) plus a tap-to-copy JSON blob to clipboard.

### `log.js` (called "Schreiber"/"the writer" in the source) — detailed frame log

Hooks the same per-frame data `perf.js` already computes (it does not measure anything
itself) and writes **every individual frame**, not a rolling average, because "which
operation costs what, over time" can't be answered from an average. Timed/sectioned by
`bench.js` (mode `"log"`) so sections share the same warmup/switching mechanics as the
Watch and the row-benchmark.

- Invocation: `?log=1` (~50s run) or via an in-game "Diagnose" menu ("Schreiber starten").
- Per frame it records: `id` (current bench row/screen id), `t` (ms since log start), `dt`
  (raw frame interval), and a breakdown: `gesamt` (total), `szene` (scene draw), `kopie`
  (copy), `bitmap`, `upload`, `shader`, `flaeche` (fill/area cost), `warten` (time spent
  waiting on GPU/compositor).
- Report sections (plain text, meant to be pasted into a chat):
  1. **Per-section table**: n, fps, dt p50/p95/max, and p50 of each cost component
     (scene/copy/bitmap/upload/shader/area/wait), plus canvas size in MB per section.
  2. **Timeline in 250ms buckets** (`EIMER_MS`): dt/upload/scene/wait p50 per bucket — lets
     you see *when* within a section something degrades, not just the aggregate.
  3. **The 40 slowest frames** (`WORST`), each fully broken down — the outliers a median
     hides.
  4. **Captured console.error/console.warn/window.onerror/unhandledrejection** during the
     run (capped at 60 entries), each tagged with the section id it occurred in.
- Delivery mechanism (iOS-specific gotcha worth reproducing): the first version wrote the
  report straight to the clipboard and **silently failed on iOS** —
  `navigator.clipboard.writeText` requires "transient activation" (a real user gesture),
  and a benchmark that finishes itself after 50 seconds has none. Fixed by opening a
  full-screen `<textarea readonly>` sheet with explicit Copy/Share buttons — the button
  press *is* the gesture. `wrap="off"` on the textarea so table rows don't line-wrap into
  unreadable mush on a phone screen (copied text is unaffected).

### Recommendation for the rebuild's perf HUD

A minimal version should keep: (1) frame-to-frame `rAF` delta as the only ground truth
metric, never `performance.now()` around draw calls; (2) p50/p95/hitches-per-second as the
three numbers surfaced; (3) per-screen ("Wache"-style) breakdown so a regression can be
pinned to a specific location/menu; (4) a copyable/shareable text report, because
clipboard writes need a real user gesture on iOS.

---

## 6. Prototypes — what each tested and concluded

### `prototypes/pixi-test/` — Canvas2D vs. PixiJS (WebGL) for the deep-sea scene

Side-by-side comparison rendering the *same* deep-sea scene: left side using the game's
actual `draw.js`/`backdrop.js`/`visuals.js`/`fish.js` functions unmodified in Canvas 2D;
right side using PixiJS but **reusing those exact same Canvas-2D draw functions**, baked
once into `RenderTexture`s and played back as sprites — proving the hand-drawn art style
survives a renderer migration unchanged.

- **Measured** (desktop RTX 4090, so absolute FPS isn't representative, but the *ratio*
  is): at the game's real particle count (55 plankton) both renderers hit the display's
  FPS ceiling — **no current performance problem PixiJS would fix**. The gap only opens at
  ~500+ moving particles (Canvas2D: 134–178fps vs PixiJS steady ~240fps at 2000
  particles: Canvas2D drops to ~61-63fps vs PixiJS ~241fps, roughly 4×). Bottleneck for
  Canvas2D at high counts is fill-rate/draw-call count, not pixel count (DPR barely
  changes the 2000-particle result).
  **Bundle size cost**: PixiJS + pixi-filters ≈ 1MB raw / 270KB gzip — bigger than the
  *entire current game* (333KB raw / 110KB gzip). This, not framerate, was called "the
  real price."
- **What only WebGL/PixiJS gets you**: true bloom (`AdvancedBloomFilter`, multi-object
  blur+additive — Canvas2D's `shadowBlur` is a per-path drop shadow, doesn't compose
  across objects), a displacement-filter water-wobble (would need per-frame
  `getImageData`/`putImageData` in Canvas2D — untenable on mobile), fragment-shader
  godrays/vignette, additive blend without breaking batching, and `ParticleContainer`
  (2000 sprites in 1 draw call: 0.41ms vs Canvas2D's 3.3ms).
- **Proposed 4-layer migration plan** (6–9 dev days total) if ever pursued: Layer 1
  background/water (2–3 days, best ROI — bake per-location textures instead of redrawing
  every frame), Layer 2 fish (2–3 days, pre-render tail-phase frames as sprites — texture
  memory risk on old iPhones flagged explicitly), Layer 3 effects/particles (1–2 days),
  Layer 4 **UI stays Canvas 2D** (1 day of glue — a second transparent canvas on top,
  because Pixi's text rendering at 10–13px risks blurriness on Retina, and this game's UI
  is exactly that kind of small text/roundRect-heavy content).
- **Named risks**: text sharpness on Retina (mitigated by keeping UI on Canvas2D), VRAM on
  old iPhones (2–3GB RAM devices; ~40MB for fish textures + ~12MB per background texture
  estimated), **WebGL context loss in Capacitor's Android WebView** — flagged as "the
  point most likely to cause trouble" (needs `webglcontextrestored` handling to re-bake all
  `RenderTexture` content, since Canvas2D has no equivalent failure mode), and load time
  (270KB gzip ≈ 0.5–1s on 4G, called "the most expensive line item of all" for a
  "instantly playable" casual game).
- **Conclusion**: *"Partially — yes for layers 1 and 3, no for the rest, at least not
  before release."* Recommended order if pursued post-release: Layer 4 (UI/world split)
  first as a pure cleanup (valuable even without Pixi), then A/B layer 1+3 on one location
  (deep sea) with a code-level toggle, verify on a real old iPhone before going further.

### `prototypes/phaser-test/` — Canvas2D vs. Phaser hybrid rendering, feasibility spike

Tests issue **#95**: can a hybrid where **Phaser renders the game-world scene** and
**Canvas 2D stays the UI/surface layer** carry the game? Full report lives in the old
project's `docs/SPIKE-PHASER.md` (not copied here — out of scope, but referenced).
The game source itself was untouched (`dist/site/index.html` verified byte-identical
before/after via SHA-1).

- Structure: `scene-c2d.js` = today's Canvas2D water rendering (verbatim from the game);
  `water-frag.js` = the same water as a GLSL fragment shader; `scene-phaser.js` = one
  Phaser scene, one shader quad, one draw call; `ui-layer.js` = the Canvas-2D layer on top,
  loading the **actual game files directly** (`fontdata.js`, `font.js`, `i18n.js`,
  `wood.js`, `icons.js`) unmodified — proving these files' runtime patches (`i18n.js`
  patches `fillText`, `font.js` patches `ctx.font`) keep working layered over a Phaser
  scene. This was called "the core of the proof."
- Query params exercised: `?mode=c2d|hybrid`, `dpr=1|2|3`, `lang=en` (proves the i18n
  patch survives above a Phaser scene), `loop=eigen` (Phaser self-driven timing vs.
  synced), `lib=slim|full|core` (custom-trimmed vs. stock vs. Phaser's own minimal entry
  point).
- Benchmarked: FPS across resolution × CPU throttling, load time under throttled
  network+CPU, frame-sync between the two layers (a real bug was caught this way — see
  below), and WebGL context-loss recovery.
- **Three real pitfalls documented, worth remembering for any future hybrid-renderer
  attempt**:
  1. `continue` inside a loop over a shader uniform array turned the entire water shader
     black — silently, no shader error, no console output, while the sky (same shader)
     stayed correct.
  2. Calling `game.loop.stop()` immediately after `new Phaser.Game()` or inside `create()`
     is a no-op — Phaser (re-)starts its own loop afterward regardless, causing the scene
     to render **twice per displayed frame**, invisibly (only caught by literally counting
     frames: 1444 world frames vs 722 UI frames over the same period).
  3. Phaser's own trimmed "core" custom build doesn't include the Shader GameObject
     (`this.add.shader is not a function`) — a hand-rolled water shader needs
     `gameobjects/shader/*` pulled in explicitly.

### `prototypes/worker-test/` — does WebKit rasterize an OffscreenCanvas in a Worker with hardware acceleration?

A standalone single-file test page (no game code), answering the one open question before
committing to moving Canvas2D rasterization off the main thread. Context: profiling showed
a single synchronous "draw scene, then read it as a texture" call costs ~14ms of a ~23ms
frame at the lake location — of which ~4ms is upload bytes and ~10ms is the actual
rasterization that Canvas2D defers until the texture is read. The plan under test: move
that rasterization into a Worker via `OffscreenCanvas`, so the main thread only receives a
finished bitmap to upload. This only pays off **if** WebKit hardware-accelerates rasterizing
an `OffscreenCanvas` inside a Worker — if it falls back to software rendering there, the
"optimization" would be strictly worse than today.

- Method: draws a scene with the same *character* as the real world scene (large gradient
  fills, many small paths, bezier-filled fish shapes, circles, a few soft shadows — ~1200
  draw commands, comparable to the lake backdrop's measured 1420) on both the main thread
  and inside a Worker, **interleaved** round-robin (not sequential — sequential would let
  the second path's numbers be skewed by the first path's thermal warmup, a mistake the
  project had already made and specifically avoids here). 24 rounds per path + 4 warmup
  rounds, discarded.
  Main-thread path: `zeichne()` (draw) → `texImage2D` upload, both measured.
  Worker path: `postMessage` a "draw" command → worker draws into its
  `OffscreenCanvas`, then **`transferToImageBitmap()`** (chosen specifically because it
  *forces* rasterization, mirroring what reading the main canvas as a texture does — without
  it the test would again measure only command recording) → bitmap transferred back →
  main thread does `texImage2D` upload only.
- The metric that matters: **how long the main thread is blocked**, not how long anything
  takes in total (Worker-side time is "free" as long as it overlaps other work).
- Verdict logic built into the page: if the Worker's rasterization is >1.6× slower than the
  main thread's, conclude "software rasterization, not worth it"; if main-thread blocking
  time drops by >40%, conclude "the split works, pursue it"; otherwise "main thread isn't
  meaningfully relieved — the cost is in handoff/upload, not rasterization, so this
  particular optimization doesn't pay off." (No committed numeric result was present in the
  files read — this is a **methodology test rig**, meant to be re-run on a target device;
  treat its presence as "this question was asked and is answerable this way," not as a
  settled finding.)

**Rebuild implication of all three prototypes together**: today's Canvas2D approach is not
performance-limited at current content density; a renderer migration (Pixi or Phaser
hybrid) is a *quality/capability* upgrade (bloom, shaders, godrays) more than a performance
fix, and the biggest real risk of adding WebGL to the stack is context loss inside
Capacitor's Android WebView, not raw speed. If the rebuild wants to skip this
investigation cycle, it can start directly at "Canvas2D world layer + Canvas2D UI layer"
with the option to add a WebGL/Pixi world layer later behind the exact 4-layer split
outlined in the pixi-test README, or evaluate the worker-based rasterization split before
reaching for a full renderer swap, since it is far cheaper to build and reverses cleanly if
the device doesn't accelerate it.

---

## 7. Open backlog/bugs a rebuild should get right from the start

Selected from `docs/BACKLOG.md` (Release Blockers, Core-is-broken, Trust/Fairness, First
60 seconds, Soul, Polish sections) and `docs/BUGS.md`'s Top-15 fix list — prioritized for
"never introduce this in the first place" rather than "fix it later."

**Core loop / boss fights**
1. Boss fights must be unwinnable without input (old build: Megalodon boss could be beaten
   with zero player action).
2. Boss fight must not start scoring/damage during its intro cutscene, before the player
   can react.
3. During a boss "line freeze" mechanic, give explicit on-screen instruction for what to
   do (old build gave no feedback — player had to guess).
4. Boss health bar must never scroll off the top of the screen.
5. A boss must never simultaneously exist as a free-swimming fish AND a boss encounter —
   the line must visibly attach to the boss.
6. Update/simulation loops (weather, fish, wildlife, line physics, sonar, timed
   consumables like rain totems) must pause behind any menu/overlay/cutscene/title screen —
   not keep ticking invisibly and draining timed items unseen.
7. Line-snap/break must never be a full loss — design it as "smaller fish" or "longer
   fight," never a dead end, and never a paid "second try."

**Trust / monetization fairness**
8. Credit rewarded-ad rewards **locally, before** showing the ad; if the ad fails to load
   or errors out, pay out anyway. (Called out as the single most universal complaint found
   in competitor reviews.)
9. Persist a catch to save data **immediately after landing it, before** the celebration
   animation plays — a crash during the reward moment must never lose the catch.
10. Scale ad-watch and idle-time rewards **proportionally** to game progress, not as flat
    absolute amounts (a flat 30s-ad reward becomes worthless late-game).
11. Rank any leaderboard by weight/collection-completeness, never by player level (avoids
    incentivizing low-value grinding).
12. Show full, legible gacha odds and a prominent "AD"/sponsored-content label — both are
    legal requirements (Apple 3.1.1 / ad-disclosure law), not just nice-to-haves.

**First 60 seconds / onboarding**
13. Gate feature surfaces progressively (aquarium after first catch, shop after 3rd catch,
    dex from level 3, quests from 5, pass/talents from 8, leaderboard/gacha from 10) rather
    than showing the full, busiest screen in the game as the very first thing a new player
    sees.
14. Guarantee a first catch within ~15 seconds of starting, and make it something visually
    nice — not a plain default fish.
15. Show exactly one "next objective" at a time; don't badge everything at once.
16. Never show a contradictory empty-state (old bug: an empty aquarium/collection box
    displaying "FULL – COLLECT").
17. Give every collection/dex entry a way to see **how** to obtain a still-missing item
    (depth/time-of-day/bait), not just that it's missing — and consider marking
    not-yet-caught species directly in the water while fishing, not just in the dex.

**UI / accessibility fundamentals**
18. All touch targets ≥ 44pt, with real hit-test tolerance/slop — not a literal
    pixel-perfect hitbox (old build: some buttons as small as 30–38px with zero tolerance).
19. Never let translucent/"glass" overlay panels drop below readable contrast — old build
    had characters/fish visually obscuring text through glass panels in the dex, drill
    UI, and share screens.
20. Keep all in-game text off a single system font for anything you want to feel branded
    (title, overlay headers, catch-card) — a shared system font across iOS/Android/Windows
    reads as generic/unbranded.
21. Build every icon as a drawn asset from day one, not emoji — emoji icons were flagged
    as "the most visible AI-generated-content marker" and appeared in ~27 places.
22. Route all UI text through a proper text-fit/truncation function driven by actual
    measured remaining width — not guessed/hardcoded constants (old build: 15+ truncation
    bugs, rod name almost always clipped).
23. Cap in-flight error/toast messages to a bounded width with scaling — don't let
    dynamic strings run edge-to-edge across the screen (old bug: drill failure messages
    ran the full screen width).
24. Localize number formatting per-locale from the start (decimal comma vs. point,
    thousands separators) — don't ship literal `.`-formatted numbers in a German-first
    game.
25. Establish a single source-of-truth color palette (named roles) before UI work starts —
    old build had 534 scattered hex literals, 8 different "gold" tones, 10 different
    overlay accent colors.
26. Fix draw order once, up front: sky elements (sun/moon/clouds/birds) behind HUD cards;
    horizon line behind background islands; light/rays clipped to their card, not bleeding
    over the frame.

**Physical/visual correctness**
27. Snow/ice-biome precipitation must not play a rain-patter sound — weather SFX must be
    keyed to precipitation *type*, not just "is it precipitating."
28. Aquarium/tank fish must only flip direction on wall contact, never re-randomize their Y
    position in the same frame (old bug: `baseY` re-rolled on turn, reading as
    teleportation) — if height should ever change, drift it gradually over seconds, never
    snap it.
29. Don't stack a "depth alpha falloff" AND a "light alpha falloff" as literal transparency
    on swimming creatures on top of an atmospheric depth-fog pass — the combination made
    fish at depth/night up to ~42% see-through, effectively doubling one visual effect
    with the wrong technique (fog should carry all of the "farther = hazier" read; alpha
    should be reserved for intentional despawn-fades only).
30. Any "press feedback" (button press animation + haptic) must be wired to a per-element
    stable key, not to coordinate comparison against the pointer position — coordinate-based
    matching breaks the moment any UI element moves between press and paint, and it must
    cover *every* interactive element (full-width buttons included) and non-button tap
    targets (loot chests, decorative wildlife, tap-into-empty-space) consistently, not as
    an opt-in per element.

**Audio (see also section 1/2 above)**
31. Route one-shot SFX through the same reverb bus / key-matched pitch as the music system
    from the start, instead of building them as separate unprocessed oscillators
    and retrofitting cohesion later.
32. Build the "first user gesture unlocks audio" hook once, generically, on the very first
    pointerdown anywhere — not tied to a specific "tap to start" screen that might get
    redesigned away later (this exact thing happened in the old build and needed a fix).

**Process / non-UI**
33. Persist game version + build metadata visibly (a small on-screen build tag) but strip
    it from production builds before release — old build shipped "v0.9.0 · resolution ·
    renderer path · web" as a visible debug string in production.
34. Remove all placeholder/debug strings before release review (old build shipped literal
    "Platzhalter – hier läuft später das Ad-SDK" text and similar debug artifacts as
    Top-15 fix items).
35. Decide the studio/attribution name and how prior contributors are credited before
    App Store metadata is finalized — treat this as a release blocker, not an afterthought.
36. Before any real device performance work, adopt the "only trust rAF frame-to-frame
    delta" measurement discipline documented in `bench.js` from day one, rather than
    re-discovering it after several rounds of chasing the wrong bottleneck (resolution,
    MSAA, upload path, draw-call count were each individually blamed and fixed without
    effect in the old project's history).
37. Treat native ad-unit IDs and RevenueCat keys as placeholders that must be swapped
    before store submission, and keep that swap as a single documented config location
    (`native.js` config + platform manifests) rather than scattered literals.
38. Get the first real TestFlight upload through the CI pipeline early — cloud code-signing
    via an App Store Connect API key rarely works on the first attempt, budget dedicated
    time for it rather than doing it last-minute.
39. Legal/compliance text (privacy policy, imprint, "restore purchases") must be reviewed
    for actual content, not just "the button exists and is wired up."
40. Keep monetization config (AdMob IDs, RevenueCat products, entitlement key names) in one
    place per platform from the start, matching what `native.js`/`Info.plist`/
    `AndroidManifest.xml` need — this made the old project's pre-release TODO list
    trivially auditable ("grep for test IDs") instead of a scavenger hunt.

---

## 8. `GAME_VERSION` scheme

Defined once in `script.js`: `const GAME_VERSION = "0.9.0";` — a plain semver-shaped string
constant, manually bumped (no automated versioning script found in the codebase). It is
read in exactly two display contexts:

- `intro.js`: rendered as `v${GAME_VERSION}` on the title/intro screen (bottom of screen,
  above the safe-area inset).
- `progress.js` (settings/diagnostics panel): rendered as `v${GAME_VERSION} ·
  ${canvasWidth}×${canvasHeight} @${dprMultiplier}x · ${Native.isNative() ? "app" :
  "web"}` normally, and additionally `· ${Perf.stufeText()} · ${frameTime}ms` when the
  render-diagnostics toggle (Shift+I, or the mobile equivalent in settings) is on. Plain
  `v${GAME_VERSION}` otherwise.

It is **not** wired into `capacitor.config.json`, `Info.plist`'s
`CFBundleShortVersionString` (that's driven by Xcode's `$(MARKETING_VERSION)` build
setting instead), or Android's `versionName` — those are separate, platform-native version
fields not kept in sync with the JS constant automatically. `docs/BUGS.md` flags the
in-game version string as a "debug artifact" that should be stripped from production
builds (item 34 above) — it was intended for internal QA/bench correlation
(`log.js`'s report headers reference `World.tier`/build state, not `GAME_VERSION`
directly), not as a player-facing app version display.

**Rebuild recommendation**: keep a single JS constant as the source of truth for anything
shown in-game (useful for correlating bug reports / bench logs to a build), but drive the
actual App Store / Play Store version numbers from the native project files
(`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` on iOS, `versionName`/`versionCode` on
Android) as today, and make sure the in-game debug string is togglable off (or dev-only)
rather than always-on in production, closing the gap the old build shipped with.
