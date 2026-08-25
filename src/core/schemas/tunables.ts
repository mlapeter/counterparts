/**
 * Every constant this module owns, in one visible place.
 *
 * CAL = calibration-required: it must ship with a recorded measurement against
 * the real name space, or ship disabled (scar §2.8 — "the near-collision
 * similarity bar is measured, not intuited"; v1's 0.60 embedding floor was set
 * from intuition and was inert because arbitrary same-corpus pairs already sat
 * at 0.576).
 */
export const TUNABLES = {
  /**
   * CAL. Near collision is TOKEN CONTAINMENT: "Mike" against "Mike Chen".
   * Chosen because it is the exact shape §14.3 names, needs no embedder, and
   * fails toward refusal rather than toward a silent merge. It is NOT a
   * measured similarity bar; a measured one replaces it, and the replacement is
   * the reason this is a tunable rather than a hard-coded `if`.
   */
  NEAR_COLLISION: "token-containment" as const,

  /** At most one birth per chunk, counted by the engine (§5 G3). */
  MAX_BIRTHS_PER_CHUNK: 1,

  /** Minimum characters in a name. Shorter than this cannot be whole-worded
   *  usefully and mints handles that collide with English. */
  NAME_MIN_CHARS: 2,

  /** The tier a re-mention credits. `referenced` deliberately: a mention is the
   *  entity being USED, and the ignorable tier (footnoted, w = 0) would make
   *  "accumulates" unreachable — a stub that is mentioned every day would still
   *  fade, which is not the lifecycle the contract describes (NOTES.md §4). */
  MENTION_TIER: "referenced" as const,

  /** Why an entity's archive row says it left. One string, one meaning. */
  FADE_REASON: "faded-by-decay" as const,
} as const;
