/**
 * Place — which props a fishing spot needs, and where they go.
 *
 * The scene knows layer ORDER; `locationsArt` knows how each prop is DRAWN;
 * this file is the third thing, and it is genuinely separate: it knows that
 * the lake has a jetty, the boat locations have a hull whose three pieces
 * straddle the water pass, the coast has a mole, and the arctic has a stool
 * and an igloo. Putting that anywhere else would either give the renderer
 * knowledge of locations or give the art knowledge of the layer stack.
 *
 * Everything here is torn down and rebuilt on a location change or a resize.
 * That is affordable because it is a handful of sprites out of an atlas that
 * is already warm — the cost of a location change is a few bakes, not a
 * reload.
 */

import type { Container, Sprite } from 'pixi.js';
import type { Scene } from '@/world/scene';
import { makeDock } from './lake';
import {
  makeBoat, makePier, makePierUnderwater, makeStool, makeIgloo,
  type BoatSprites,
} from './locationsArt';
import type { Location } from '@/data/locations';

/** everything a place owns on screen, so it can be removed again as a unit */
export interface PlaceProps {
  sprites: Sprite[];
  destroy(): void;
}

function attach(scene: Scene, into: Container, s: Sprite, bag: Sprite[]): void {
  into.addChild(s);
  bag.push(s);
  void scene;
}

/**
 * Builds the props for a location and hangs them in the right layers.
 *
 * The boat is the interesting one: its hull has to be in THREE places
 * relative to the water pass — the submerged part under it (so the water
 * veils and refracts it), the topside over it, and the near gunwale in front
 * of the angler. That is why `makeBoat` returns three sprites rather than
 * one, and why this cannot be a single "props" container.
 */
export function buildPlaceProps(scene: Scene, loc: Location, light: number): PlaceProps {
  const bag: Sprite[] = [];
  const horizon = scene.horizonY;

  switch (loc.mode) {
    case 'dock':
      attach(scene, scene.nearProps, makeDock(horizon, light), bag);
      break;

    case 'boat': {
      const b: BoatSprites = makeBoat(horizon, light);
      // under the water pass, so the hull below the line is veiled with depth
      attach(scene, scene.propsLayer, b.underwater, bag);
      // over the water pass, under the angler
      attach(scene, scene.nearProps, b.topside, bag);
      // in front of the angler — he sits IN the boat
      attach(scene, scene.anglerLayer, b.front, bag);
      break;
    }

    case 'pier': {
      attach(scene, scene.propsLayer, makePierUnderwater(horizon, light), bag);
      attach(scene, scene.nearProps, makePier(horizon, light), bag);
      break;
    }

    case 'ice': {
      attach(scene, scene.nearProps, makeIgloo(horizon), bag);
      attach(scene, scene.nearProps, makeStool(horizon), bag);
      break;
    }

    case 'dive':
      // The dive has no platform: the player is in the water. Nothing to
      // place, and the angler is replaced by the diver.
      break;
  }

  return {
    sprites: bag,
    destroy() {
      for (const s of bag) s.destroy();
      bag.length = 0;
    },
  };
}

/**
 * Where the angler stands, per location, as a fraction across the screen and
 * a y offset from the water line. The lake's jetty and the coast's mole put
 * him above the water; in a boat he sits lower, in the boat itself.
 */
export function anglerAnchor(loc: Location): { xFrac: number; yOffset: number } | null {
  switch (loc.mode) {
    case 'dock': return { xFrac: 0.64, yOffset: -20 };
    case 'pier': return { xFrac: 0.72, yOffset: -24 };
    case 'boat': return { xFrac: 0.58, yOffset: -6 };
    case 'ice': return { xFrac: 0.60, yOffset: -2 };
    case 'dive': return null;      // the diver replaces him
  }
}
