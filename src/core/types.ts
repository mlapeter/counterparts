/**
 * The shared seam between core modules. Deliberately minimal: fields the physics
 * contract names as inputs (physics/CONTRACT.md §5) plus the kind/band vocabulary.
 * Modules may extend with their own types; nothing here may be broken without a
 * cross-module conversation.
 */

export type Kind = "self" | "person" | "entity" | "skill" | "place" | "fact";

export type Band = "episodic" | "semantic" | "identity";

/** Four dimensions, 0-1, fixed at encoding. novelty is null for a blind write
 *  (no schema context existed) — recorded, never defaulted (scar §2.9). */
export interface Salience {
  novelty: number | null;
  relevance: number;
  emotional: number;
  predictive: number;
  /** The author's claimed aggregate salience, if any — a FLOOR, not a value
   *  (physics §5.1). Stored on the row so `sal(m)` stays reproducible from state
   *  alone; the dimensions above are never rewritten to satisfy it, and a null
   *  novelty is never defaulted to satisfy it. Clamped at the proposal->memory
   *  seam by `clampSalienceAtSeam()`, which emits an event on any lift. */
  claimed?: number | null;
}

/** The physics-relevant state of one memory. Days are lived-day integers
 *  (active-day clock, scar E8) — never calendar timestamps. */
export interface MemoryPhysics {
  kind: Kind;
  salience: Salience;
  birthDay: number;
  uses: number;
  lastUsedDay: number;
  /** How many DISTINCT lived days credited a use. `uses` is a weighted sum
   *  (§5.5's tiers) and cannot reconstruct this, and identity promotion is gated
   *  on >= N = 3 distinct lived days (§5.3). Incremented only by `creditUse()`.
   *  Optional so this stays an extension, not a break; absent reads as 0, which
   *  is the promotion-blocking direction. */
  reinforcedDays?: number;
  consolidated: boolean;
  /** Set only by the explicit promotion crossing or revision inheritance (§5.3). */
  promotedIdentity: boolean;
  protected: boolean;
  /** Challenge pressure — a field on the memory, never a second object (§5.6). */
  pressure: number;
  lastChallengedDay: number | null;
}
