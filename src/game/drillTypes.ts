/**
 * The shape of the drill ("Halten & Loslassen", drill v3) state.
 *
 * Split out from drill.ts so the state machine can already compile against
 * the final shape while the drill formulas themselves are still being
 * ported. Fields and units follow docs/spec/01-core-loop.md section 4.
 *
 * TODO(E1): drill.ts implements the update loop over this state.
 */

export interface ReelState {
  /** the hooked fish's remaining fight, 0..1 (1 = fresh) */
  fight: number;
  /** line tension, 0..1; reaching 1 snaps the line */
  tension: number;
  /** how far the fish has been reeled in, 0..1 (1 = landed) */
  progress: number;
  /** true while the player holds the screen */
  holding: boolean;
  /** seconds left of the current flee; 0 = not fleeing */
  fleeing: number;
  /** seconds until the flee starts, during the warning; 0 = no warning */
  warning: number;
  /** seconds until the next feint may trigger */
  nextFeint: number;
  /** true while no tension was ever taken past the danger threshold */
  perfect: boolean;
  /** seconds elapsed since the drill started */
  elapsed: number;
  /** boss variant: which side the boss is pulling toward, 0 = neither */
  bossDir: -1 | 0 | 1;
}
