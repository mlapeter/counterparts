/**
 * `tools/migrate/tunables.ts` — every knob the migration turns, in one visible
 * place (CONTRACT §6).
 *
 * A migration is a pile of approximations. The rule this file enforces is that
 * NONE of them is anonymous: every place v1 and v2 disagree has a named constant
 * here, a row in the contract's approximations table, and a counter in the
 * report. A number that governs behaviour with no name here would be a number
 * with no home and no test (scar §2.8).
 *
 * The two cuts below deliberately equal v2's own physics thresholds
 * (`physics.TUNABLES.THETA_ID` / `THETA_SEM`). They are re-stated rather than
 * imported because they are answering a DIFFERENT question — "where did v1's
 * one-dimensional gradient sit?" — and coupling them to v2's band arithmetic
 * would make a physics recalibration silently rewrite the owner's history.
 */

export interface MigrateTunables {
  /**
   * THE ONE PLACE MIGRATION MINTS PERMANENT INK. A v1 trace whose gradient is at
   * or above this cut arrives in v2 already `promotedIdentity`, because v2 enters
   * the identity band only by a counted promotion crossing and a cutover is not
   * one — so without this, every v1 identity-band memory would silently demote at
   * the first decay pass. Set above 1 to disable entirely; every application is
   * counted in the report.
   */
  IDENTITY_GRADIENT_CUT: number;
  /** Starting band for a v1 gradient at or above this. Recomputed each cycle by
   *  `sleep/`, so this is a starting position and not a claim. */
  SEMANTIC_GRADIENT_CUT: number;
  /**
   * v1's `occurrences` counts encounters INCLUDING birth (absent = 1 = born);
   * v2's `uses` counts credited uses, of which birth is not one. Subtracting the
   * birth is the whole rule, and it is a rule rather than an off-by-one.
   */
  BIRTH_IS_NOT_A_USE: boolean;
  /**
   * Carry v1's single aggregate salience as v2's CLAIMED FLOOR, so `sal(m)`
   * reproduces v1's number exactly while the three dimensions stay honest about
   * what v1 actually measured. Off, the aggregate is lost and strength moves.
   */
  SALIENCE_AS_CLAIMED_FLOOR: boolean;
  /**
   * Map v1's open surprise ledger onto v2's `pressure` field. DEFAULT OFF, and
   * that is a decision rather than an omission: v2 fires a revision at
   * `pressure >= iota x strength(target)`, and v1's `cumulativeScore` was
   * accumulated by different arithmetic against different strengths — injecting
   * it risks a spurious revision on the first real challenge in the new store.
   * The ledger is counted and reported either way.
   */
  LEDGER_TO_PRESSURE: boolean;
}

export const TUNABLES: MigrateTunables = {
  IDENTITY_GRADIENT_CUT: 0.85,
  SEMANTIC_GRADIENT_CUT: 0.5,
  BIRTH_IS_NOT_A_USE: true,
  SALIENCE_AS_CLAIMED_FLOOR: true,
  LEDGER_TO_PRESSURE: false,
};

export function withTunables(over: Partial<MigrateTunables> = {}): MigrateTunables {
  return { ...TUNABLES, ...over };
}
