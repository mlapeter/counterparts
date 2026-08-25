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
}

/** The physics-relevant state of one memory. Days are lived-day integers
 *  (active-day clock, scar E8) — never calendar timestamps. */
export interface MemoryPhysics {
  kind: Kind;
  salience: Salience;
  birthDay: number;
  uses: number;
  lastUsedDay: number;
  consolidated: boolean;
  /** Set only by the explicit promotion crossing or revision inheritance (§5.3). */
  promotedIdentity: boolean;
  protected: boolean;
  /** Challenge pressure — a field on the memory, never a second object (§5.6). */
  pressure: number;
  lastChallengedDay: number | null;
}
