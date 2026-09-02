/**
 * Motion profiles — what a thing in the water does when nothing happens.
 *
 * The old game gave everything in the water the same tail wave, so an old
 * boot swam away flapping and a clump of seaweed wagged like a trout. That
 * reads as a bug even to someone who could not name it, because the eye
 * knows what floats, what swims and what is rooted.
 *
 * The deformation itself is one of three vertex-shader modes (see `Bend`).
 * This file decides which mode a species gets and how it drifts, so the
 * decision lives in one table instead of being scattered through the
 * spawner.
 */

import { Bend } from './fishBatch';

export interface MotionProfile {
  bend: Bend;
  /** deformation amplitude as a fraction of the sprite's height (or width, for Anchor) */
  wobble: number;
  /** radians per second of the deformation phase, before speed scaling */
  phaseRate: number;
  /** horizontal drift in logical px/s; 0 = does not travel */
  driftX: number;
  /** vertical drift; positive sinks */
  driftY: number;
  /** peak rotation in radians as the object turns over while it drifts */
  rollAmp: number;
  /** rotation cycles per second */
  rollRate: number;
  /** vertical bob amplitude in px */
  bobAmp: number;
  bobRate: number;
  /** true if it should face its direction of travel (fish do, junk does not) */
  facesTravel: boolean;
}

/**
 * A swimming fish.
 *
 * The bob used to be 5 px on top of the tail bend AND the depth-band drift —
 * three vertical motions at once, which is why the shoal looked restless.
 * The water itself now displaces every fish (fishBatch's refraction term), so
 * the sprite's own vertical motion can be almost nothing: 1.5 px is enough to
 * keep two fish at the same depth from moving in lockstep.
 */
const SWIMMER: MotionProfile = {
  bend: Bend.Swim, wobble: 0.13, phaseRate: 3.0,
  driftX: 1, driftY: 0, rollAmp: 0, rollRate: 0,
  bobAmp: 1.5, bobRate: 0.4, facesTravel: true,
};

/**
 * Rooted plants. No drift at all, and the sway is slow: a frond in a lake
 * current moves at roughly a third of the rate of a swimming fish, and the
 * base never moves.
 */
const PLANT: MotionProfile = {
  bend: Bend.Anchor, wobble: 0.18, phaseRate: 0.8,
  driftX: 0, driftY: 0, rollAmp: 0, rollRate: 0,
  bobAmp: 0, bobRate: 0, facesTravel: false,
};

/**
 * Waterlogged junk. It keeps its shape, sinks very slowly, drifts with the
 * water and turns over as it goes — that slow tumble is what makes a boot
 * read as a boot rather than as a strange fish.
 */
const SINKING_JUNK: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 4, driftY: 1.5, rollAmp: 0.22, rollRate: 0.11,
  bobAmp: 2, bobRate: 0.35, facesTravel: false,
};

/**
 * A sealed bottle is buoyant: it hangs near the surface, bobs on the swell
 * and rolls further than a boot because there is air in it.
 */
const FLOATING_JUNK: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 7, driftY: -0.4, rollAmp: 0.35, rollRate: 0.18,
  bobAmp: 4, bobRate: 0.8, facesTravel: false,
};

/** Heavy and settled. A chest barely moves; it just sits there being a chest. */
const HEAVY_JUNK: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 1.5, driftY: 0.6, rollAmp: 0.05, rollRate: 0.06,
  bobAmp: 1, bobRate: 0.25, facesTravel: false,
};

/** A fish frozen into a block of ice does not swim. It is cargo. */
const FROZEN: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 3, driftY: 0.8, rollAmp: 0.12, rollRate: 0.08,
  bobAmp: 2, bobRate: 0.4, facesTravel: false,
};

/**
 * Creatures that do not move head-first. A jellyfish pulses, a starfish
 * and a shell sit, a crab walks sideways. They keep their shape here and
 * get their own motion from the game where they need one — what matters is
 * that they do not get a tail wave they have no tail for.
 */
const DRIFTER: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 6, driftY: 0, rollAmp: 0.06, rollRate: 0.2,
  bobAmp: 3, bobRate: 0.5, facesTravel: false,
};

const BOTTOM_DWELLER: MotionProfile = {
  bend: Bend.Rigid, wobble: 0, phaseRate: 0,
  driftX: 5, driftY: 0, rollAmp: 0, rollRate: 0,
  bobAmp: 1, bobRate: 0.3, facesTravel: true,
};

/**
 * By species id first (a few need naming individually), then by body type.
 * Ids win, because "seetang" is typed as a creature in the data but is a
 * plant in the water.
 */
const BY_ID: Record<string, MotionProfile> = {
  // Bycatch seaweed is a torn-off tangle drifting in the water, not a rooted
  // plant: it has no base to hold still, so it tumbles like the other junk.
  // The ROOTED weed at the lake bed is scenery (bake/lakeArt.ts) and is the
  // one that gets Bend.Anchor.
  seetang: { ...DRIFTER, rollAmp: 0.16, rollRate: 0.09, bobAmp: 5, bobRate: 0.5 },
  stiefel: SINKING_JUNK,
  taucherstiefel: SINKING_JUNK,
  flaschenpost: FLOATING_JUNK,
  schatzkiste: HEAVY_JUNK,
  gefroren: FROZEN,
  perlmuschel: BOTTOM_DWELLER,
  seestern: BOTTOM_DWELLER,
  krabbe: BOTTOM_DWELLER,
  koenigskrabbe: BOTTOM_DWELLER,
  hummer: BOTTOM_DWELLER,
  scholle: BOTTOM_DWELLER,
  heilbutt: BOTTOM_DWELLER,
  quallе: DRIFTER,
  qualle: DRIFTER,
  tiefseequalle: DRIFTER,
  riesenessel: DRIFTER,
  seepferdchen: { ...PLANT, wobble: 0.09, phaseRate: 1.1, driftX: 2 },
};

const BY_BODY: Record<string, MotionProfile> = {
  boot: SINKING_JUNK,
  bottle: FLOATING_JUNK,
  chest: HEAVY_JUNK,
  weed: { ...DRIFTER, rollAmp: 0.16, rollRate: 0.09, bobAmp: 5, bobRate: 0.5 },
  jelly: DRIFTER,
  star: BOTTOM_DWELLER,
  shell: BOTTOM_DWELLER,
  crab: BOTTOM_DWELLER,
  flat: BOTTOM_DWELLER,
  seahorse: { ...PLANT, wobble: 0.09, phaseRate: 1.1, driftX: 2 },
  octopus: DRIFTER,
  squid: { ...SWIMMER, wobble: 0.10, phaseRate: 3.6 },
  penguin: { ...SWIMMER, wobble: 0.05, phaseRate: 3.6 },
  turtle: { ...SWIMMER, wobble: 0.04, phaseRate: 1.2 },
  ray: { ...SWIMMER, wobble: 0.17, phaseRate: 1.5 },
  serpent: { ...SWIMMER, wobble: 0.20, phaseRate: 1.8 },
  blob: { ...SWIMMER, wobble: 0.04, phaseRate: 1.0 },
  fish: SWIMMER,
};

export function motionFor(id: string, bodyType?: string): MotionProfile {
  return BY_ID[id] ?? BY_BODY[bodyType ?? 'fish'] ?? SWIMMER;
}

/** exported for the dev pages and tests */
export const PROFILES = { SWIMMER, PLANT, SINKING_JUNK, FLOATING_JUNK, HEAVY_JUNK, FROZEN, DRIFTER, BOTTOM_DWELLER };
