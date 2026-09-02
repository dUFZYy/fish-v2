/**
 * Daily quests: 3 per day, date-seeded (deterministic), refreshed at local midnight.
 *
 * Ported renderer-free from the OLD game's `quests.js` (read in full), minus the
 * FX/sound/canvas calls per docs/spec/04-economy-meta.md §13. The RNG call ORDER inside
 * `ensureQuests` is preserved exactly (including a "wasted" `rnd()` call for the location
 * pick on every iteration, even for templates that don't use it) because it is load-bearing
 * for determinism: the old game consumes the seeded stream in that exact sequence, and any
 * reordering would silently pick different quests for the same date.
 */

import type { SaveData, QuestInstance, QuestsState } from "./save";
import { LOCATIONS, type Location } from "@/data/locations";
import { isLocationOwned, todayKey } from "./progress";

export { todayKey };

// ---------------------------------------------------------------------------------------
// Deterministic per-day RNG — quests.js seeded(seedStr)
// FNV-1a-ish string hash seed, xorshift-ish mixing step. NOT cryptographic, deliberately
// reproducible: same seed string -> same infinite sequence of [0,1) floats.
// ---------------------------------------------------------------------------------------
export function seededRng(seedStr: string): () => number {
  let h = 2166136261;
  for (const ch of seedStr) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Reward scaling — quests.js QUEST_SCALE / questReward()
// ---------------------------------------------------------------------------------------
export const QUEST_SCALE = 0.45;

/** Rounds to the nearest multiple of 10, minimum 10. quests.js questReward(). */
export function questReward(n: number): number {
  return Math.max(10, Math.round((n * QUEST_SCALE) / 10) * 10);
}

// ---------------------------------------------------------------------------------------
// Quest event shape — what questEvent() is dispatched with. Mirrors the ad-hoc object
// literals the old game passed from catchFish()/seagull-shoo/harvestAquarium().
// ---------------------------------------------------------------------------------------
export interface QuestEvent {
  type: "catch" | "seagull" | "harvest";
  junk?: boolean;
  rarityIdx?: number;
  kg?: number;
  perfect?: boolean;
  night?: boolean;
  streak?: number;
  loc?: string;
  rain?: boolean;
  species?: string;
  /** harvest-only; no template currently listens for "harvest", kept for parity. */
  n?: number;
}

interface QuestMakeResult {
  text: string;
  target: number;
  reward: number;
  locId?: string;
}

interface QuestTemplate {
  id: string;
  make: (n: number | undefined, loc: Location | undefined) => QuestMakeResult;
  /** Candidate values for `n`, randomly chosen; absent for fixed-target templates. */
  n?: readonly number[];
  test: (q: QuestInstance, ev: QuestEvent) => boolean;
  /** When set, `ev[unique]` values are deduped via `q.seen` (only "species" is used). */
  unique?: "species";
}

/** quests.js QUEST_TEMPLATES, in original order (shuffle-pick order depends on it). */
export const QUEST_TEMPLATES: readonly QuestTemplate[] = [
  {
    id: "catch",
    n: [3, 5, 8],
    make: (n) => ({ text: `Fange ${n} Fische`, target: n!, reward: questReward(40 * n!) }),
    test: (_q, ev) => ev.type === "catch" && !ev.junk,
  },
  {
    id: "rare",
    make: () => ({ text: "Fange einen seltenen (oder besseren) Fisch", target: 1, reward: questReward(250) }),
    test: (_q, ev) => ev.type === "catch" && (ev.rarityIdx ?? -1) >= 2,
  },
  {
    id: "heavy",
    n: [3, 5, 10],
    make: (n) => ({ text: `Fange etwas über ${n} kg`, target: 1, reward: questReward(120 + n! * 10) }),
    test: (q, ev) => ev.type === "catch" && (ev.kg ?? -Infinity) >= (q.n ?? Infinity),
  },
  {
    id: "perfect",
    n: [1, 2, 3],
    make: (n) => ({ text: `${n}× perfekter Drill`, target: n!, reward: questReward(100 * n!) }),
    test: (_q, ev) => ev.type === "catch" && !!ev.perfect,
  },
  {
    id: "night",
    make: () => ({ text: "Fange einen Nachtfisch", target: 1, reward: questReward(200) }),
    test: (_q, ev) => ev.type === "catch" && !!ev.night,
  },
  {
    id: "streak",
    n: [3, 4, 5],
    make: (n) => ({ text: `Serie von ${n} Fängen`, target: 1, reward: questReward(80 * n!) }),
    test: (q, ev) => ev.type === "catch" && (ev.streak ?? -Infinity) >= (q.n ?? Infinity),
  },
  {
    id: "species",
    n: [3, 4, 5],
    unique: "species",
    make: (n) => ({ text: `Fange ${n} verschiedene Arten`, target: n!, reward: questReward(60 * n!) }),
    test: (_q, ev) => ev.type === "catch" && !ev.junk,
  },
  {
    id: "junk",
    make: () => ({ text: "Fische etwas Müll aus dem Wasser", target: 1, reward: questReward(90) }),
    test: (_q, ev) => ev.type === "catch" && !!ev.junk,
  },
  {
    id: "rain",
    make: () => ({ text: "Fange einen Fisch im Regen", target: 1, reward: questReward(150) }),
    test: (_q, ev) => ev.type === "catch" && !!ev.rain,
  },
  {
    id: "seagull",
    make: () => ({ text: "Verjage eine Möwe", target: 1, reward: questReward(120) }),
    test: (_q, ev) => ev.type === "seagull",
  },
  {
    id: "location",
    make: (_n, loc) => ({ text: `Fange 3 Fische: ${loc!.name}`, target: 3, reward: questReward(220), locId: loc!.id }),
    test: (q, ev) => ev.type === "catch" && ev.loc === q.locId && !ev.junk,
  },
];

// ---------------------------------------------------------------------------------------
// Generation — quests.js ensureQuests()
// ---------------------------------------------------------------------------------------

/**
 * Regenerates `save.quests` if it's missing or stale (not generated for `now`'s date).
 * Returns `save` unchanged (same reference) when today's quests already exist — mirrors
 * the old game's early `return` so callers can cheaply detect "nothing changed".
 */
export function ensureQuests(save: SaveData, now: Date = new Date()): SaveData {
  const key = todayKey(now);
  if (save.quests && save.quests.day === key) return save;

  const rnd = seededRng(`${key}-fishing`);
  const owned = LOCATIONS.filter((l) => isLocationOwned(save, l));
  const pool = QUEST_TEMPLATES.filter((t) => t.id !== "location" || owned.length > 1).slice();

  const picked: QuestInstance[] = [];
  while (picked.length < 3 && pool.length > 0) {
    const t = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
    const n = t.n ? t.n[Math.floor(rnd() * t.n.length)] : undefined;
    // Consumed every iteration regardless of whether `t` uses it — matches the old game's
    // RNG call order exactly (load-bearing for determinism, see file header).
    const loc = owned[Math.floor(rnd() * owned.length)];
    const made = t.make(n, loc);
    picked.push({
      tid: t.id,
      n,
      progress: 0,
      done: false,
      claimed: false,
      seen: [],
      ...made,
    });
  }

  const quests: QuestsState = { day: key, list: picked };
  return { ...save, quests };
}

// ---------------------------------------------------------------------------------------
// Progress / payout — quests.js questEvent()
// ---------------------------------------------------------------------------------------

export interface QuestEventResult {
  save: SaveData;
  /** Quests that just completed as a result of this event (0..n, usually 0 or 1). */
  completed: QuestInstance[];
  /** Total coins granted across all quests completed by this event. */
  coinsGranted: number;
}

/**
 * quests.js questEvent(), minus the FX/sound calls and minus `addPassPoints(50)` (season
 * pass point accrual is meta.ts's job — the caller should invoke it once per entry in
 * `completed`, exactly like the old code's flat, unscaled `addPassPoints(50)` per quest).
 * Ensures today's quests exist first, exactly like the old game's `ensureQuests()` call at
 * the top of `questEvent`.
 */
export function questEvent(save: SaveData, ev: QuestEvent, now: Date = new Date()): QuestEventResult {
  const withQuests = ensureQuests(save, now);
  const state = withQuests.quests!;
  const completed: QuestInstance[] = [];
  let coinsGranted = 0;
  let totalCoins = withQuests.stats.totalCoins;
  let questsStat = withQuests.stats.quests;

  const list = state.list.map((q) => {
    if (q.done) return q;
    const t = QUEST_TEMPLATES.find((x) => x.id === q.tid);
    if (!t || !t.test(q, ev)) return q;

    let seen = q.seen;
    if (t.unique) {
      const value = ev[t.unique];
      if (value === undefined || seen.includes(value)) return q;
      seen = [...seen, value];
    }

    const progress = Math.min(q.target, q.progress + 1);
    let next: QuestInstance = { ...q, progress, seen };
    if (progress >= q.target) {
      next = { ...next, done: true };
      coinsGranted += next.reward;
      totalCoins += next.reward;
      questsStat += 1;
      completed.push(next);
    }
    return next;
  });

  const nextSave: SaveData = {
    ...withQuests,
    coins: withQuests.coins + coinsGranted,
    quests: { ...state, list },
    stats: { ...withQuests.stats, totalCoins, quests: questsStat },
  };

  return { save: nextSave, completed, coinsGranted };
}

// ---------------------------------------------------------------------------------------
// Countdown — quests.js drawQuests()'s header text, minus the drawing
// ---------------------------------------------------------------------------------------

/** Milliseconds until local midnight (when quests regenerate lazily on next ensureQuests). */
export function msUntilReset(now: Date = new Date()): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

export interface ResetCountdown {
  hours: number;
  minutes: number;
}

/** quests.js drawQuests()'s `{hh}h {mm}min` computation. */
export function resetCountdown(now: Date = new Date()): ResetCountdown {
  const ms = msUntilReset(now);
  return { hours: Math.floor(ms / 3600000), minutes: Math.floor((ms % 3600000) / 60000) };
}
