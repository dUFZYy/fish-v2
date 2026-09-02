/**
 * Measures every sound instead of trusting it.
 *
 * The old project shipped a musical voice that was completely silent: a
 * division produced a NaN, the samples came out as zeros, and nobody noticed
 * because nobody looked at the samples. The fix was found by MEASURING the
 * rendered audio, not by listening.
 *
 * So each sound is rendered through the real graph in an OfflineAudioContext
 * and reported with:
 *   peak   — 0 means silent (a bug), > 1.0 means it would clip
 *   rms    — how loud it actually is, which peak does not tell you
 *   nan    — any non-finite sample at all is a bug
 *   attack — ms to reach 90 % of peak; a "transient" that takes 200 ms isn't one
 *   fall   — spectral centroid early vs late. Water must get DARKER as it
 *            decays; if this is not negative, it will not read as water.
 *
 * Exposed as `window.measureAudio()` so it can be run from the console or
 * from an automated check. Not part of the game bundle.
 */

import { audio } from '../src/audio/engine';

export interface SoundReport {
  name: string;
  peak: number;
  rms: number;
  nan: number;
  attackMs: number;
  centroidEarly: number;
  centroidLate: number;
  fall: number;
  verdict: string;
}

function centroid(data: Float32Array, from: number, to: number, sr: number): number {
  // cheap spectral centroid via zero-crossing-weighted energy: good enough to
  // tell "bright" from "dark", which is all we need here
  let cross = 0;
  let energy = 0;
  let prev = data[from] ?? 0;
  for (let i = from + 1; i < to; i++) {
    const v = data[i];
    if ((v >= 0) !== (prev >= 0)) cross++;
    energy += v * v;
    prev = v;
  }
  const n = Math.max(1, to - from);
  if (energy / n < 1e-9) return 0;
  return (cross / 2) * (sr / n);
}

export async function measureOne(
  name: string,
  play: () => void,
  seconds = 2.2,
): Promise<SoundReport> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);

  // The engine adopts the offline context, so what gets measured is the real
  // graph with the real limiter and the real reverbs — not a reconstruction.
  // A reconstruction would only ever prove that the reconstruction works.
  const live = audio.ctx;
  audio.adopt(ctx);
  try {
    play();
  } catch (e) {
    if (live) audio.adopt(live);
    throw e;
  }
  const rendered = await ctx.startRendering();
  if (live) audio.adopt(live);

  const d = rendered.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let nan = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (!Number.isFinite(v)) { nan++; continue; }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / d.length);

  let attackIdx = 0;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) >= peak * 0.9) { attackIdx = i; break; }
  }

  // find the sounding region so the centroid is not measured over silence
  const thresh = peak * 0.02;
  let last = 0;
  for (let i = d.length - 1; i >= 0; i--) { if (Math.abs(d[i]) > thresh) { last = i; break; } }
  const span = Math.max(1, last);
  const early = centroid(d, 0, Math.floor(span * 0.25), sr);
  const late = centroid(d, Math.floor(span * 0.6), span, sr);

  const fall = early > 0 ? (late - early) / early : 0;
  const problems: string[] = [];
  if (nan > 0) problems.push(`${nan} NICHT-ENDLICHE Samples`);
  if (peak < 0.001) problems.push('STUMM');
  if (peak > 1.0) problems.push('ÜBERSTEUERT');
  if (rms < 1e-5 && peak >= 0.001) problems.push('fast stumm');

  return {
    name,
    peak: +peak.toFixed(4),
    rms: +rms.toFixed(5),
    nan,
    attackMs: +((attackIdx / sr) * 1000).toFixed(1),
    centroidEarly: Math.round(early),
    centroidLate: Math.round(late),
    fall: +fall.toFixed(2),
    verdict: problems.length ? problems.join(', ') : 'ok',
  };
}

export async function measureAudio(): Promise<SoundReport[]> {
  const s = await import('../src/audio/sfx');
  const cases: Array<[string, () => void, number?]> = [
    ['plop', () => s.sfx.plop(0)],
    ['splash klein', () => s.sfx.splash(0, 0.3)],
    ['splash groß', () => s.sfx.splash(0, 1), 2.6],
    ['cast', () => s.sfx.cast()],
    ['reelClick', () => s.sfx.reelClick(), 0.4],
    ['bite', () => s.sfx.bite()],
    ['nibble', () => s.sfx.nibble(), 0.5],
    ['snap', () => s.sfx.snap()],
    ['escape', () => s.sfx.escape()],
    ['catch 0', () => s.sfx.catchJingle(0), 2.4],
    ['catch 4', () => s.sfx.catchJingle(4), 3.2],
    ['coin', () => s.sfx.coin(0), 0.6],
    ['levelUp', () => s.sfx.levelUp(), 3],
    ['buy', () => s.sfx.buy(), 0.8],
    ['denied', () => s.sfx.denied(), 0.6],
    ['click', () => s.sfx.click(), 0.3],
    ['tick', () => s.sfx.tick(), 0.3],
    ['bubble', () => s.sfx.bubble(0), 0.6],
    ['gull', () => s.sfx.gull(0), 1.4],
    ['thunder nah', () => s.sfx.thunder(0.1), 4],
    ['harpoon', () => s.sfx.harpoon(1), 1.2],
    ['alles gleichzeitig', () => {
      s.sfx.catchJingle(4); s.sfx.splash(0, 1); s.sfx.levelUp();
      for (let i = 0; i < 10; i++) s.sfx.coin(i);
    }, 3.4],
  ];

  const out: SoundReport[] = [];
  for (const [name, play, secs] of cases) {
    try {
      out.push(await measureOne(name, play, secs ?? 2.2));
    } catch (e) {
      out.push({
        name, peak: 0, rms: 0, nan: 0, attackMs: 0,
        centroidEarly: 0, centroidLate: 0, fall: 0,
        verdict: 'FEHLER: ' + String(e),
      });
    }
  }
  return out;
}

(window as unknown as { measureAudio: typeof measureAudio }).measureAudio = measureAudio;
