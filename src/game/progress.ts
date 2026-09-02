/**
 * Progression: XP/level curve, titles, level-up rewards, location unlock checks, the daily
 * login bonus, and fishdex (species-log) completion rewards.
 *
 * Ported renderer-free from the OLD game's `progress.js` (read in full), with the
 * FX/toast/canvas calls stripped out per docs/spec/04-economy-meta.md §13's
 * pure-vs-renderer-bound split. Every function here is pure: it takes a `SaveData` (and
 * whatever else it needs) and returns either a plain value or `{ save, ...events }` — never
 * mutates its input, never touches `localStorage` or a global `save` singleton like the old
 * code did.
 *
 * `checkAchievements()` (events.js) is out of scope — not in this port's source file list.
 */

import type { SaveData, DailyState } from "./save";
import { LOCATIONS, type Location, locationIndex } from "@/data/locations";
import { HATS } from "@/data/items";

// ---------------------------------------------------------------------------------------
// Shared date key — todayKey() lived in quests.js in the old game but is used by both
// quests.js AND progress.js (dailyState/dailyReward/claimDaily); it lives here so both
// progress.ts and quests.ts (which imports it from here) share one implementation.
// No timezone normalization, no zero-padding — verbatim port.
// ---------------------------------------------------------------------------------------

/** `"{year}-{month}-{day}"` in LOCAL time, 1-based month, no zero-padding. */
export function todayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Same format as todayKey(), for the date exactly 24h before `date`. */
function yesterdayKey(date: Date = new Date()): string {
  const t = new Date(date);
  t.setDate(t.getDate() - 1);
  return todayKey(t);
}

// ---------------------------------------------------------------------------------------
// XP / level curve — progress.js
// ---------------------------------------------------------------------------------------

/** XP per catch by rarity index (0=common .. 4=legendary). progress.js XP_BY_RARITY. */
export const XP_BY_RARITY: readonly number[] = [12, 30, 70, 160, 420];

/** XP needed to go from `level` to `level + 1`. progress.js xpToNext(). */
export function xpToNext(level: number): number {
  return Math.round(90 + level * 55 + Math.pow(level, 1.7) * 6);
}

export function getLevel(save: SaveData): number {
  return save.level || 1;
}

export function getXP(save: SaveData): number {
  return save.xp || 0;
}

/** Coins granted per level-up, before the tier multiplier. progress.js LEVEL_COIN_F. */
export const LEVEL_COIN_F = 25;

/**
 * 1..6 — the 1-based index of the highest UNLOCKED location. progress.js progressTier().
 * Note: "unlocked" = `isLocationOwned`, i.e. free (price 0) or present in
 * `save.owned.locations` — level alone does not count.
 */
export function progressTier(save: SaveData): number {
  let tier = 1;
  for (let i = 0; i < LOCATIONS.length; i++) {
    if (isLocationOwned(save, LOCATIONS[i]!)) tier = Math.max(tier, i + 1);
  }
  return tier;
}

/** 1.0 (tier 1) .. 5.0 (tier 6) — scales level-up coins, daily bonus, ad rewards, pass
 *  coin rewards. progress.js tierMult(). */
export function tierMult(save: SaveData): number {
  return 1 + (progressTier(save) - 1) * 0.8;
}

/** progress.js xpForCatch(sp, perfect, shiny), adapted: takes the rarity index and junk
 *  flag directly instead of a species object (species.ts does not exist in this port yet). */
export function xpForCatch(params: {
  rarityIdx: number;
  junk?: boolean;
  perfect?: boolean;
  shiny?: boolean;
}): number {
  let xp = XP_BY_RARITY[params.rarityIdx] ?? 0;
  if (params.junk) xp = 5;
  if (params.perfect) xp = Math.round(xp * 1.25);
  if (params.shiny) xp *= 3;
  return xp;
}

export interface LevelUpEvent {
  level: number;
  rewardCoins: number;
  /** 1 every 5th level, else 0. */
  rewardGems: number;
  /** Set when a location's `level` requirement equals the newly-reached level — this only
   *  means the location is now purchasable, NOT that it was unlocked/bought automatically. */
  revealedLocationId?: string;
}

export interface AddXpResult {
  save: SaveData;
  /** One entry per level gained (addXP can cross multiple levels in one call). */
  levelUps: LevelUpEvent[];
}

/**
 * progress.js addXP(), minus the popup/FX/sound calls and minus the `addPassPoints()` call
 * (season-pass point accrual is meta.ts's responsibility now — the caller is expected to
 * invoke both `addXP` and `meta.ts`'s pass-points function; this is a deliberate module
 * boundary, not a behavior change to the underlying math).
 */
export function addXP(save: SaveData, amount: number): AddXpResult {
  let level = save.level || 1;
  let xp = (save.xp || 0) + amount;
  let coins = save.coins;
  let gems = save.gems;
  let totalCoins = save.stats.totalCoins;
  const levelUps: LevelUpEvent[] = [];
  const mult = tierMult(save); // owned locations don't change within this loop

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level++;
    const rewardCoins = Math.round(level * LEVEL_COIN_F * mult);
    coins += rewardCoins;
    totalCoins += rewardCoins;
    const rewardGems = level % 5 === 0 ? 1 : 0;
    gems += rewardGems;
    const revealed = LOCATIONS.find((l) => l.level === level);
    levelUps.push({ level, rewardCoins, rewardGems, revealedLocationId: revealed?.id });
  }

  return {
    save: {
      ...save,
      level,
      xp,
      coins,
      gems,
      stats: { ...save.stats, totalCoins },
    },
    levelUps,
  };
}

/** progress.js anglerTitle(). */
export function anglerTitle(level: number): string {
  if (level >= 40) return "Legende des Sees";
  if (level >= 30) return "Meisterangler";
  if (level >= 20) return "Kapitän";
  if (level >= 12) return "Profi";
  if (level >= 6) return "Angler";
  return "Anfänger";
}

// ---------------------------------------------------------------------------------------
// Daily bonus — progress.js
// ---------------------------------------------------------------------------------------

/** Coins for streak day 1..7 (day 8+ repeats day 7's value). progress.js DAILY_STREAK. */
export const DAILY_STREAK: readonly number[] = [60, 90, 130, 190, 260, 380, 650];
/** Rewarded-ad daily-bonus claims per day. progress.js DAILY_ADS. */
export const DAILY_ADS = 2;

/**
 * progress.js dailyState(): computes what save.daily SHOULD read right now (resetting
 * `adsUsed` when the day has rolled over) WITHOUT mutating `save` — callers that need the
 * reset persisted should write `{ ...save, daily: dailyState(save, today) }` back.
 */
export function dailyState(save: SaveData, today: string = todayKey()): DailyState {
  const d = save.daily;
  if (d.adsDay !== today) return { ...d, adsDay: today, adsUsed: 0 };
  return d;
}

export function dailyClaimable(save: SaveData, today: string = todayKey()): boolean {
  return dailyState(save, today).claimed !== today;
}

export function dailyAdsLeft(save: SaveData, today: string = todayKey()): number {
  return DAILY_ADS - dailyState(save, today).adsUsed;
}

export interface DailyRewardInfo {
  streak: number;
  coins: number;
}

/** progress.js dailyReward(). */
export function dailyReward(save: SaveData, now: Date = new Date()): DailyRewardInfo {
  const today = todayKey(now);
  const d = dailyState(save, today);
  const yesterday = yesterdayKey(now);
  const streak = d.last === yesterday ? d.streak + 1 : d.last === today ? d.streak : 1;
  const idx = Math.min(streak, 7) - 1;
  const coins = Math.round((DAILY_STREAK[idx] ?? DAILY_STREAK[DAILY_STREAK.length - 1]!) * tierMult(save));
  return { streak, coins };
}

export interface ClaimDailyResult {
  save: SaveData;
  coins: number;
  streak: number;
  /** true if the 7-day streak achievement/gem bonus fired this claim. */
  weekBonus: boolean;
}

/** progress.js claimDaily(). Returns null if already claimed today (no-op, like the old
 *  early `return` on `!dailyClaimable()`). */
export function claimDaily(save: SaveData, now: Date = new Date()): ClaimDailyResult | null {
  const today = todayKey(now);
  if (!dailyClaimable(save, today)) return null;
  const r = dailyReward(save, now);
  const weekBonus = r.streak >= 7;
  const daily: DailyState = { ...dailyState(save, today), streak: r.streak, last: today, claimed: today };
  const next: SaveData = {
    ...save,
    daily,
    coins: save.coins + r.coins,
    gems: save.gems + (weekBonus ? 2 : 0),
    stats: { ...save.stats, totalCoins: save.stats.totalCoins + r.coins },
    achievements: weekBonus && !save.achievements.includes("woche") ? [...save.achievements, "woche"] : save.achievements,
  };
  return { save: next, coins: r.coins, streak: r.streak, weekBonus };
}

/** progress.js adBonusAmount(). */
export function adBonusAmount(save: SaveData): number {
  return Math.round(120 * tierMult(save));
}

export interface WatchAdForBonusResult {
  save: SaveData;
  coins: number;
}

/** progress.js watchAdForBonus() — the ad-play itself and the "#15: reward before ad"
 *  ordering are UI/ads.js concerns; this only does the reward bookkeeping the caller
 *  should apply once the ad has been granted. Returns null if no daily ad claims are left. */
export function watchAdForBonus(save: SaveData, now: Date = new Date()): WatchAdForBonusResult | null {
  const today = todayKey(now);
  if (dailyAdsLeft(save, today) <= 0) return null;
  const amt = adBonusAmount(save);
  const daily: DailyState = { ...dailyState(save, today), adsUsed: dailyState(save, today).adsUsed + 1 };
  const next: SaveData = {
    ...save,
    daily,
    coins: save.coins + amt,
    stats: { ...save.stats, totalCoins: save.stats.totalCoins + amt, adsWatched: save.stats.adsWatched + 1 },
  };
  return { save: next, coins: amt };
}

// ---------------------------------------------------------------------------------------
// Location unlock checks — locations.js isLocationOwned/selectLocation (purchase branch)
// ---------------------------------------------------------------------------------------

/** locations.js isLocationOwned(). */
export function isLocationOwned(save: SaveData, loc: Location): boolean {
  return loc.price === 0 || save.owned.locations.includes(loc.id);
}

export type LocationUnlockBlockedReason = "level" | "coins";

/** Non-mutating check mirroring the two failure branches in locations.js selectLocation(). */
export function canUnlockLocation(save: SaveData, loc: Location): { ok: true } | { ok: false; reason: LocationUnlockBlockedReason } {
  if (isLocationOwned(save, loc)) return { ok: true };
  if (getLevel(save) < loc.level) return { ok: false, reason: "level" };
  if (save.coins < loc.price) return { ok: false, reason: "coins" };
  return { ok: true };
}

/**
 * locations.js selectLocation()'s coin-purchase branch only (the travel/scene-transition
 * side of that function is renderer-bound). Returns null if the location is already owned
 * or the unlock is currently blocked (see canUnlockLocation).
 */
export function buyLocation(save: SaveData, loc: Location): SaveData | null {
  if (isLocationOwned(save, loc)) return null;
  const check = canUnlockLocation(save, loc);
  if (!check.ok) return null;
  return {
    ...save,
    coins: save.coins - loc.price,
    owned: { ...save.owned, locations: [...save.owned.locations, loc.id] },
  };
}

// ---------------------------------------------------------------------------------------
// Fischdex (species-log) rewards — progress.js checkDexRewards()
// ---------------------------------------------------------------------------------------

/** Hat granted for 100% dex completion, per location id. progress.js DEX_HATS. */
export const DEX_HATS: Readonly<Record<string, string>> = {
  see: "kranz",
  boot: "nessiemuetze",
  kueste: "moewenhut",
  riff: "blumenkranz",
  tiefsee: "leuchthelm",
  arktis: "eiskrone",
};

export interface DexRewardEvent {
  locId: string;
  tier: "50" | "100";
  coins: number;
  gems: number;
  hatId?: string;
}

export interface CheckDexRewardsResult {
  save: SaveData;
  rewards: DexRewardEvent[];
}

/**
 * progress.js checkDexRewards(), minus the toast/sound calls. Species data does not exist
 * in this repo yet, so the caller supplies each location's NON-BOSS species ids (from
 * src/data/species.ts once it exists) via `speciesByLocation`.
 */
export function checkDexRewards(save: SaveData, speciesByLocation: Readonly<Record<string, readonly string[]>>): CheckDexRewardsResult {
  let coins = save.coins;
  let gems = save.gems;
  let totalCoins = save.stats.totalCoins;
  let dexRewards = save.dexRewards;
  let hats = save.owned.hats;
  const rewards: DexRewardEvent[] = [];

  for (const loc of LOCATIONS) {
    const list = speciesByLocation[loc.id] ?? [];
    if (list.length === 0) continue;
    const got = list.filter((id) => save.dex[id]).length;
    const idx = locationIndex(loc.id);
    const key50 = `${loc.id}:50`;
    const key100 = `${loc.id}:100`;

    if (got >= Math.ceil(list.length / 2) && !dexRewards[key50]) {
      const reward = Math.round(300 * (idx + 1));
      coins += reward;
      totalCoins += reward;
      dexRewards = { ...dexRewards, [key50]: true };
      rewards.push({ locId: loc.id, tier: "50", coins: reward, gems: 0 });
    }

    if (got >= list.length && !dexRewards[key100]) {
      const reward = Math.round(1000 * (idx + 1));
      coins += reward;
      totalCoins += reward;
      gems += 3;
      const hat = DEX_HATS[loc.id];
      if (hat && HATS.some((h) => h.id === hat) && !hats.includes(hat)) {
        hats = [...hats, hat];
      }
      dexRewards = { ...dexRewards, [key100]: true };
      rewards.push({ locId: loc.id, tier: "100", coins: reward, gems: 3, hatId: hat });
    }
  }

  return {
    save: {
      ...save,
      coins,
      gems,
      dexRewards,
      owned: { ...save.owned, hats },
      stats: { ...save.stats, totalCoins },
    },
    rewards,
  };
}
