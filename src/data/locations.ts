/**
 * Fishing locations.
 *
 * Ported renderer-free from the OLD game's `locations.js` (`LOCATIONS` constant, read in
 * full). Values are copied verbatim: unlock price, min level, water gradient colors, dark
 * factor, render mode. See docs/spec/04-economy-meta.md §1 "Locations" for the annotated
 * version.
 *
 * `mode` selects the renderer/input scheme in the old game (dock/boat/pier/dive/ice) — kept
 * here as data even though this repo has no renderer yet, because progress/quest logic
 * (e.g. the dive-only harpoon gear) branches on it.
 *
 * Each location also has exactly one boss species (`{ boss: true }` in the old
 * `SPECIES`/`S(locId, [...])` rows) that grants +5 gems and, if unowned, unlocks the next
 * location for free when defeated — see progress.ts / meta.ts for that wiring once
 * species data exists.
 *
 * TODO(species): `speciesIds` should hold the location's non-boss species ids, sourced
 * from `src/data/species.ts` (ported separately, does not exist in this repo yet). The old
 * game's species catalog (`fish.js`/`locations.js` `SPECIES`) was not fully read as part of
 * this economy port, so these lists are deliberately left empty rather than guessed at.
 * Once species.ts exists, import its item type here (e.g. `import type { Species } from
 * './species'`) and populate `speciesIds` per location from it — do NOT hand-fill this file
 * with guessed ids.
 */

/** Local placeholder for the species-id list until src/data/species.ts exists. */
export type SpeciesId = string;

export type LocationMode = "dock" | "boat" | "pier" | "dive" | "ice";

export interface Location {
  readonly id: string;
  readonly name: string;
  /** Coin unlock price. `0` = free starting location. */
  readonly price: number;
  /** Minimum player level required before the location can be bought/entered. */
  readonly level: number;
  readonly mode: LocationMode;
  readonly icon: string;
  /** [surface color, deep color] — water gradient. */
  readonly water: readonly [string, string];
  /** 0..1 ambient darkening factor applied to the scene. */
  readonly dark: number;
  readonly desc: string;
  /** Non-boss species ids native to this location. See TODO(species) above. */
  readonly speciesIds: readonly SpeciesId[];
}

export const LOCATIONS: readonly Location[] = [
  {
    id: "see",
    name: "Steg am See",
    price: 0,
    level: 1,
    mode: "dock",
    icon: "🌲",
    water: ["#5fa8c9", "#1c4f6b"],
    dark: 0,
    desc: "Wo alles anfing. Karpfen, Hecht, Barsch – und ein Stiefel.",
    speciesIds: [],
  },
  {
    id: "boot",
    name: "Ruderboot · Seemitte",
    price: 1200,
    level: 3,
    mode: "boat",
    icon: "🚣",
    water: ["#4b8fb5", "#0f3448"],
    dark: 0.05,
    desc: "Tiefes Wasser, große Räuber. Und Gerüchte über etwas Großes.",
    speciesIds: [],
  },
  {
    id: "kueste",
    name: "Küste",
    price: 3000,
    level: 7,
    mode: "pier",
    icon: "🌊",
    water: ["#3f7fb0", "#0c2b48"],
    dark: 0,
    desc: "Salzwasser: Makrele, Krabbe, Oktopus. Die Möwen sind frecher.",
    speciesIds: [],
  },
  {
    id: "riff",
    name: "Korallenriff",
    price: 6000,
    level: 12,
    mode: "boat",
    icon: "🐠",
    water: ["#3fd0c9", "#0e6b7a"],
    dark: 0,
    desc: "Türkis, bunt, warm. Clownfische, Schildkröten, Mantas.",
    speciesIds: [],
  },
  {
    id: "tiefsee",
    name: "Tiefsee",
    price: 12000,
    level: 18,
    mode: "dive",
    icon: "🦑",
    water: ["#0d2038", "#010409"],
    dark: 0.6,
    desc: "Kein Licht außer dem, was die Fische selbst machen.",
    speciesIds: [],
  },
  {
    id: "arktis",
    name: "Eisloch · Arktis",
    price: 20000,
    level: 25,
    mode: "ice",
    icon: "🧊",
    water: ["#3a7f96", "#0a2a3a"],
    dark: 0.1,
    desc: "Ein Loch im Eis, ein Hocker, minus 20 Grad. Heilbutt wartet.",
    speciesIds: [],
  },
] as const;

/** Look up a location by id. */
export function getLocationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

/** 0-based index into LOCATIONS, or -1 if unknown. Used for reward scaling formulas. */
export function locationIndex(id: string): number {
  return LOCATIONS.findIndex((l) => l.id === id);
}
