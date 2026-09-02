/**
 * Save game persistence.
 *
 * Ported renderer-free from the OLD game's `shop.js` (`SAVE_KEY`, `defaultSave()`,
 * `loadSave()`, `saveGame()`) with fields contributed by nearly every old module — see
 * docs/spec/04-economy-meta.md §11 "Save schema" for the full annotated field table this
 * file implements.
 *
 * The OLD game's "migration strategy" was: no `version` field at all, a shallow
 * `Object.assign(defaultSave(), data)` for the top level, an EXTRA shallow merge one level
 * deep for exactly `owned`/`equipped`/`stats`, and every other nested object
 * (`dex`, `inv`, `totemTime`, `quests`, `pass`, `aquarium`, `daily`, `talents`,
 * `rodUpgrades`, `dexRewards`, `seenAch`, `seenSpecies`, `seenItems`, `storySeen`,
 * `achievements`, `dayScore`) taken as-is if present, or simply absent otherwise —
 * every accessor function across the old codebase then lazily initialized its own field
 * on first touch (e.g. `invBag()`, `passState()`, `dailyState()`, `totemTimes()`).
 *
 * This port reproduces that tolerance (a save missing any field, or shaped like an ancient
 * version, must still load without data loss) but replaces the "every accessor
 * lazy-inits its own corner" pattern with a single, pure, fully-tested `migrate()` that
 * deep-merges every KNOWN nested object against its defaults (not just owned/equipped/
 * stats — a deliberate, backwards-compatible improvement: it only ever *adds* missing
 * sub-keys, exactly like the old lazy-init accessors would have on first touch, so it
 * produces equivalent-or-better results, never different ones for data that was already
 * present). Unknown top-level fields (rendering/perf diagnostics: `gfx`, `gfxDpr`, `gfxDiag`,
 * `gfxPfadAB`, `gfxAutoNull`, `gfxAuto`, `wache`) are preserved verbatim but never
 * interpreted — ignored, not rejected, per the old game's own contract for those fields.
 *
 * `migrate()` never throws: malformed JSON, a non-object payload, or a field with the wrong
 * type all fall back to that field's default; a warning is logged at most once per process
 * via `resetSaveWarningForTests()`-resettable state (kept out of the hot path / tests).
 */

// ---------------------------------------------------------------------------------------
// Storage abstraction — isolates `localStorage` so save.ts (and only save.ts) touches the
// DOM, and so migrate()/loadSave() are unit-testable without a browser.
// ---------------------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory StorageLike, used as the default outside a browser (tests, SSR, node). */
export class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function defaultStorage(): StorageLike {
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return new MemoryStorage();
}

/** Same key the OLD game used — required so an old browser save is picked up as-is. */
export const SAVE_KEY = "fishing-adventure-save-v1";

/** Stamped onto every save produced by `migrate()`, going forward. The old game had none. */
export const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------------------
// Nested shapes
// ---------------------------------------------------------------------------------------

export interface OwnedCatalog {
  rods: string[];
  baits: string[];
  bobbers: string[];
  rodskins: string[];
  hats: string[];
  outfits: string[];
  harpoons: string[];
  locations: string[];
}

export interface EquippedCatalog {
  rod: string;
  bait: string;
  bobber: string;
  rodskin: string;
  hat: string;
  outfit: string;
  harpoon: string;
}

export interface DexEntry {
  count: number;
  record: number;
  shiny?: number;
}

export interface Stats {
  catches: number;
  totalCoins: number;
  biggestKg: number;
  perfects: number;
  rainCatches: number;
  shinies: number;
  gachas: number;
  totems: number;
  upgrades: number;
  quests: number;
  adsWatched: number;
  /** Old field appears only in a grep hit in the spec source, likely dive/harpoon shots. */
  shots: number;
}

export interface DailyState {
  /** Date the player was last claim-eligible (Y-M-D, local time, no zero-padding). */
  last: string;
  streak: number;
  /** Date the streak reward was last claimed (Y-M-D). */
  claimed: string;
  /** Date `adsUsed` applies to; resets to 0 when this no longer matches today. */
  adsDay: string;
  adsUsed: number;
}

export interface QuestInstance {
  /** Template id, see quests.ts QUEST_TEMPLATES. */
  tid: string;
  n?: number;
  progress: number;
  target: number;
  done: boolean;
  /** Dead field in the old game (set, never read) — kept only for round-trip fidelity. */
  claimed: boolean;
  /** Values already counted toward a `unique` template (e.g. species ids seen). */
  seen: Array<string | number>;
  text: string;
  reward: number;
  locId?: string;
}

export interface QuestsState {
  /** Y-M-D the current 3 quests were generated for. */
  day: string;
  list: QuestInstance[];
}

export interface PassState {
  /** YYYY-MM season id; state resets whenever this no longer matches the current month. */
  season: string;
  points: number;
  claimedFree: number[];
  claimedPremium: number[];
  premium: boolean;
}

export interface AquariumDecorState {
  ground: string;
  back: string;
  owned: string[];
  slots: Array<string | null>;
  ownedSets: string[];
}

export interface AquariumState {
  slots: string[];
  extra: number;
  stored: number;
  /** ms epoch (real-world time — passive income accrues offline too). */
  lastTick: number;
  harvested: number;
  decor: AquariumDecorState;
}

export interface DayScore {
  day: string;
  coins: number;
}

// ---------------------------------------------------------------------------------------
// Top-level save shape
// ---------------------------------------------------------------------------------------

export interface SaveData {
  /** Stamped by migrate(); absent/0 on anything that came from the old game's blob shape. */
  schemaVersion: number;

  coins: number;
  gems: number;

  owned: OwnedCatalog;
  equipped: EquippedCatalog;

  location: string;

  dex: Record<string, DexEntry>;
  stats: Stats;
  achievements: string[];

  seenAch: Record<string, boolean>;
  seenSpecies: Record<string, boolean>;
  seenItems: Record<string, boolean>;

  level: number;
  xp: number;

  talents: Record<string, number>;
  rodUpgrades: Record<string, number>;
  dexRewards: Record<string, boolean>;

  /** Generic owned-but-not-consumed item bags, keyed by kind (e.g. "totem"). */
  inv: Record<string, Record<string, number>>;
  /** Active totem countdowns, seconds remaining, keyed by totem id. */
  totemTime: Record<string, number>;

  daily: DailyState;
  quests: QuestsState | null;
  pass: PassState | null;
  aquarium: AquariumState | null;
  dayScore: DayScore | null;

  storySeen: Record<string, boolean>;

  premium: boolean;
  /** ms epoch of the last ad offer shown (any kind) — drives the cooldown. */
  lastAdOffer: number;
  adOffersSeen: number;

  playerName?: string;
  lang?: "de" | "en";
  music: boolean;
  muted: boolean;
  seenSonar: boolean;
  onboardRare: boolean;
  shopOpened: boolean;

  // --- Rendering / perf diagnostics — NOT economy-relevant, never interpreted by this
  // port. Preserved verbatim so importing an old save doesn't lose or reject them.
  gfx?: number;
  gfxDpr?: number;
  gfxDiag?: unknown;
  gfxPfadAB?: unknown;
  gfxAutoNull?: unknown;
  gfxAuto?: unknown;
  wache?: unknown;
}

// ---------------------------------------------------------------------------------------
// Defaults — mirrors the OLD game's defaultSave() plus every field that game lazily
// initialized on first touch (gems, talents, rodUpgrades, dexRewards, daily, ... ).
// ---------------------------------------------------------------------------------------

function defaultOwned(): OwnedCatalog {
  return {
    rods: ["holz"],
    baits: ["wurm"],
    bobbers: ["classic"],
    rodskins: ["holz"],
    hats: ["angler"],
    outfits: ["klassisch"],
    harpoons: ["standard"],
    locations: [],
  };
}

function defaultEquipped(): EquippedCatalog {
  return {
    rod: "holz",
    bait: "wurm",
    bobber: "classic",
    rodskin: "holz",
    hat: "angler",
    outfit: "klassisch",
    harpoon: "standard",
  };
}

function defaultStats(): Stats {
  return {
    catches: 0,
    totalCoins: 0,
    biggestKg: 0,
    perfects: 0,
    rainCatches: 0,
    shinies: 0,
    gachas: 0,
    totems: 0,
    upgrades: 0,
    quests: 0,
    adsWatched: 0,
    shots: 0,
  };
}

function defaultDaily(): DailyState {
  return { last: "", streak: 0, claimed: "", adsDay: "", adsUsed: 0 };
}

/** Fresh SaveData, equivalent to the OLD game's `defaultSave()` extended with every
 *  field the old accessors would lazily create on first touch. */
export function defaultSave(): SaveData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    coins: 0,
    gems: 0,
    owned: defaultOwned(),
    equipped: defaultEquipped(),
    location: "see",
    dex: {},
    stats: defaultStats(),
    achievements: [],
    seenAch: {},
    seenSpecies: {},
    seenItems: {},
    level: 1,
    xp: 0,
    talents: {},
    rodUpgrades: {},
    dexRewards: {},
    inv: {},
    totemTime: {},
    daily: defaultDaily(),
    quests: null,
    pass: null,
    aquarium: null,
    dayScore: null,
    storySeen: {},
    premium: false,
    lastAdOffer: 0,
    adOffersSeen: 0,
    music: true,
    muted: false,
    seenSonar: false,
    onboardRare: false,
    shopOpened: false,
  };
}

// ---------------------------------------------------------------------------------------
// Safe field readers — never throw, fall back to the given default on any type mismatch.
// ---------------------------------------------------------------------------------------

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(`[save] ${message}`);
}

/** Test-only: allow multiple tests in one process to each observe their own warning. */
export function resetSaveWarningForTests(): void {
  warned = false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strArray(v: unknown, fallback: string[]): string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;
}

function numArray(v: unknown, fallback: number[]): number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number") ? (v as number[]) : fallback;
}

/** Shallow string/boolean/number dict merge: keeps every valid own-key from `v`, defaults
 *  fill in the rest — mirrors the old game's per-field lazy-init, generalized. */
function mergeScalarDict<T extends number | boolean | string>(
  v: unknown,
  fallback: Record<string, T>,
  isT: (x: unknown) => x is T,
): Record<string, T> {
  const out: Record<string, T> = { ...fallback };
  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (isT(val)) out[k] = val;
    }
  }
  return out;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === "boolean";

function mergeOwned(v: unknown): OwnedCatalog {
  const d = defaultOwned();
  if (!isRecord(v)) return d;
  return {
    rods: strArray(v.rods, d.rods),
    baits: strArray(v.baits, d.baits),
    bobbers: strArray(v.bobbers, d.bobbers),
    rodskins: strArray(v.rodskins, d.rodskins),
    hats: strArray(v.hats, d.hats),
    outfits: strArray(v.outfits, d.outfits),
    harpoons: strArray(v.harpoons, d.harpoons),
    locations: strArray(v.locations, d.locations),
  };
}

function mergeEquipped(v: unknown): EquippedCatalog {
  const d = defaultEquipped();
  if (!isRecord(v)) return d;
  return {
    rod: str(v.rod, d.rod),
    bait: str(v.bait, d.bait),
    bobber: str(v.bobber, d.bobber),
    rodskin: str(v.rodskin, d.rodskin),
    hat: str(v.hat, d.hat),
    outfit: str(v.outfit, d.outfit),
    harpoon: str(v.harpoon, d.harpoon),
  };
}

function mergeStats(v: unknown): Stats {
  const d = defaultStats();
  if (!isRecord(v)) return d;
  return {
    catches: num(v.catches, d.catches),
    totalCoins: num(v.totalCoins, d.totalCoins),
    biggestKg: num(v.biggestKg, d.biggestKg),
    perfects: num(v.perfects, d.perfects),
    rainCatches: num(v.rainCatches, d.rainCatches),
    shinies: num(v.shinies, d.shinies),
    gachas: num(v.gachas, d.gachas),
    totems: num(v.totems, d.totems),
    upgrades: num(v.upgrades, d.upgrades),
    quests: num(v.quests, d.quests),
    adsWatched: num(v.adsWatched, d.adsWatched),
    shots: num(v.shots, d.shots),
  };
}

function mergeDaily(v: unknown): DailyState {
  const d = defaultDaily();
  if (!isRecord(v)) return d;
  return {
    last: str(v.last, d.last),
    streak: num(v.streak, d.streak),
    claimed: str(v.claimed, d.claimed),
    adsDay: str(v.adsDay, d.adsDay),
    adsUsed: num(v.adsUsed, d.adsUsed),
  };
}

function mergeDex(v: unknown): Record<string, DexEntry> {
  if (!isRecord(v)) return {};
  const out: Record<string, DexEntry> = {};
  for (const [id, entryRaw] of Object.entries(v)) {
    if (!isRecord(entryRaw)) continue;
    const entry: DexEntry = {
      count: num(entryRaw.count, 0),
      record: num(entryRaw.record, 0),
    };
    if (typeof entryRaw.shiny === "number") entry.shiny = entryRaw.shiny;
    out[id] = entry;
  }
  return out;
}

function mergeInv(v: unknown): Record<string, Record<string, number>> {
  if (!isRecord(v)) return {};
  const out: Record<string, Record<string, number>> = {};
  for (const [kind, bagRaw] of Object.entries(v)) {
    if (!isRecord(bagRaw)) continue;
    const bag: Record<string, number> = {};
    for (const [id, n] of Object.entries(bagRaw)) {
      if (typeof n === "number" && Number.isFinite(n)) bag[id] = n;
    }
    out[kind] = bag;
  }
  return out;
}

function mergeQuestInstance(v: unknown): QuestInstance | null {
  if (!isRecord(v)) return null;
  if (typeof v.tid !== "string") return null;
  const inst: QuestInstance = {
    tid: v.tid,
    progress: num(v.progress, 0),
    target: num(v.target, 1),
    done: bool(v.done, false),
    claimed: bool(v.claimed, false),
    seen: Array.isArray(v.seen) ? (v.seen.filter((x) => typeof x === "string" || typeof x === "number") as Array<string | number>) : [],
    text: str(v.text, ""),
    reward: num(v.reward, 0),
  };
  if (typeof v.n === "number") inst.n = v.n;
  if (typeof v.locId === "string") inst.locId = v.locId;
  return inst;
}

function mergeQuests(v: unknown): QuestsState | null {
  if (!isRecord(v)) return null;
  if (typeof v.day !== "string") return null;
  const list = Array.isArray(v.list)
    ? (v.list.map(mergeQuestInstance).filter((x): x is QuestInstance => x !== null))
    : [];
  return { day: v.day, list };
}

function mergePass(v: unknown): PassState | null {
  if (!isRecord(v)) return null;
  if (typeof v.season !== "string") return null;
  return {
    season: v.season,
    points: num(v.points, 0),
    claimedFree: numArray(v.claimedFree, []),
    claimedPremium: numArray(v.claimedPremium, []),
    premium: bool(v.premium, false),
  };
}

function mergeAquariumDecor(v: unknown): AquariumDecorState {
  const d: AquariumDecorState = { ground: "kies", back: "schlicht", owned: ["pflanzen"], slots: ["pflanzen", null, null, null], ownedSets: [] };
  if (!isRecord(v)) return d;
  return {
    ground: str(v.ground, d.ground),
    back: str(v.back, d.back),
    owned: strArray(v.owned, d.owned),
    slots: Array.isArray(v.slots) ? v.slots.map((x) => (typeof x === "string" ? x : null)) : d.slots,
    ownedSets: strArray(v.ownedSets, d.ownedSets),
  };
}

function mergeAquarium(v: unknown): AquariumState | null {
  if (!isRecord(v)) return null;
  return {
    slots: strArray(v.slots, []),
    extra: num(v.extra, 0),
    stored: num(v.stored, 0),
    lastTick: num(v.lastTick, Date.now()),
    harvested: num(v.harvested, 0),
    decor: mergeAquariumDecor(v.decor),
  };
}

function mergeDayScore(v: unknown): DayScore | null {
  if (!isRecord(v)) return null;
  if (typeof v.day !== "string") return null;
  return { day: v.day, coins: num(v.coins, 0) };
}

// ---------------------------------------------------------------------------------------
// migrate() — pure, unit-testable, never throws.
// ---------------------------------------------------------------------------------------

/**
 * Turn an arbitrary parsed-JSON value (an old-game save, a partial save, `{}`, or garbage)
 * into a complete, well-typed SaveData. Every field independently falls back to its
 * default; malformed input never throws and never loses fields that WERE valid.
 */
export function migrate(raw: unknown): SaveData {
  const d = defaultSave();
  if (!isRecord(raw)) {
    if (raw !== undefined && raw !== null) {
      warnOnce("save data was not a JSON object; falling back to defaults");
    }
    return d;
  }

  const out: SaveData = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    coins: num(raw.coins, d.coins),
    gems: num(raw.gems, d.gems),
    owned: mergeOwned(raw.owned),
    equipped: mergeEquipped(raw.equipped),
    location: str(raw.location, d.location),
    dex: mergeDex(raw.dex),
    stats: mergeStats(raw.stats),
    achievements: strArray(raw.achievements, []),
    seenAch: mergeScalarDict(raw.seenAch, {}, isBool),
    seenSpecies: mergeScalarDict(raw.seenSpecies, {}, isBool),
    seenItems: mergeScalarDict(raw.seenItems, {}, isBool),
    level: Math.max(1, num(raw.level, d.level)),
    xp: Math.max(0, num(raw.xp, d.xp)),
    talents: mergeScalarDict(raw.talents, {}, isNum),
    rodUpgrades: mergeScalarDict(raw.rodUpgrades, {}, isNum),
    dexRewards: mergeScalarDict(raw.dexRewards, {}, isBool),
    inv: mergeInv(raw.inv),
    totemTime: mergeScalarDict(raw.totemTime, {}, isNum),
    daily: mergeDaily(raw.daily),
    quests: mergeQuests(raw.quests),
    pass: mergePass(raw.pass),
    aquarium: mergeAquarium(raw.aquarium),
    dayScore: mergeDayScore(raw.dayScore),
    storySeen: mergeScalarDict(raw.storySeen, {}, isBool),
    premium: bool(raw.premium, false),
    lastAdOffer: num(raw.lastAdOffer, 0),
    adOffersSeen: num(raw.adOffersSeen, 0),
    music: bool(raw.music, true), // old game: `save.music !== false`, i.e. default true
    muted: bool(raw.muted, false),
    seenSonar: bool(raw.seenSonar, false),
    onboardRare: bool(raw.onboardRare, false),
    shopOpened: bool(raw.shopOpened, false),
  };

  if (typeof raw.playerName === "string") out.playerName = raw.playerName;
  if (raw.lang === "de" || raw.lang === "en") out.lang = raw.lang;

  // Rendering/perf diagnostics: preserved verbatim, never interpreted.
  if (typeof raw.gfx === "number") out.gfx = raw.gfx;
  if (typeof raw.gfxDpr === "number") out.gfxDpr = raw.gfxDpr;
  if ("gfxDiag" in raw) out.gfxDiag = raw.gfxDiag;
  if ("gfxPfadAB" in raw) out.gfxPfadAB = raw.gfxPfadAB;
  if ("gfxAutoNull" in raw) out.gfxAutoNull = raw.gfxAutoNull;
  if ("gfxAuto" in raw) out.gfxAuto = raw.gfxAuto;
  if ("wache" in raw) out.wache = raw.wache;

  return out;
}

// ---------------------------------------------------------------------------------------
// loadSave / saveSave
// ---------------------------------------------------------------------------------------

/** Read+migrate the save from storage (defaults to `localStorage`, or an in-memory
 *  fallback outside a browser). Never throws. */
export function loadSave(storage: StorageLike = defaultStorage()): SaveData {
  let raw: unknown;
  try {
    const text = storage.getItem(SAVE_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    warnOnce("save data was not valid JSON; falling back to defaults");
    raw = null;
  }
  return migrate(raw);
}

/** Serialize and persist a SaveData. Never throws (storage failures are swallowed, same
 *  as the old game's `try { localStorage.setItem(...) } catch (e) {}`). */
export function saveSave(data: SaveData, storage: StorageLike = defaultStorage()): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    warnOnce("failed to write save data to storage");
  }
}
