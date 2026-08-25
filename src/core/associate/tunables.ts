/**
 * Every knob in `associate/`, in one visible place — the shape `physics/` and
 * `recall/` use, for the same reason: a constant hiding in a function body cannot
 * be audited.
 *
 * **CAL = calibration-required** (scar §2.8: no threshold ships unmeasured against
 * the real space). Where v1 has a live calibration it is quoted as the starting
 * point, NOT a v2 measurement; where it has none, the entry says so out loud.
 * `tools/replay` is where these get re-earned.
 *
 * Structural (never tunable, never ablatable): the ignorable tier trains nothing;
 * the flush ordering (drain first, publish second) and its chosen failure
 * direction; the observer refusal; the conducting predicate that keeps a removed
 * or archived id from carrying activation.
 */
import type { DecayShape, UseTier } from "../physics/index.js";

export interface AssociateTunables {
  // ── the Hebbian update ───────────────────────────────────────────────────
  /**
   * The co-activation increment for a fully-credited pair — both endpoints
   * REFERENCED by the reply. CAL, and one of the few constants here with NO
   * ancestry at all: v1's harvest records the tier structure of credit (§10 G1)
   * and never the edge increment, so there is no number to inherit. At 0.1 a
   * pair reaches `EDGE_CAP` after ten co-activations that both mattered.
   */
  HEBB_RATE: number;
  /**
   * Edge credit for the WEAK tier — surfaced but unused. **Ships DISABLED (0)**
   * on purpose: contract §4 says weak credit's numeric weight is not inherited
   * and ships "bounded by fixtures naming what breaks on each side, or
   * disabled", and no such fixture exists yet. v1's reinforcement weight for the
   * weak tier was 0.25 (`physics.TUNABLES.W_SURFACED`) — recorded here as the
   * calibration to re-earn, deliberately NOT wired in. See NOTES.md §2. CAL.
   */
  EDGE_WEAK_CREDIT: number;
  /** Per-edge ceiling. An edge is a readiness, not an unbounded counter. */
  EDGE_CAP: number;
  /** At or below this weight an edge is DEAD: it conducts nothing and is
   *  eligible for eviction. Also the "live edge" test for the count cap. CAL. */
  EDGE_FLOOR: number;

  // ── homeostasis (§10 G2) ─────────────────────────────────────────────────
  /** Cap on LIVE edges out of one node. Past it, the weakest are evicted. CAL. */
  MAX_EDGES_PER_NODE: number;
  /** Bound on the total outgoing weight of one node, enforced by PROPORTIONAL
   *  renormalization — synaptic scaling, not clipping: the node's edges keep
   *  their relative order and lose absolute weight together. CAL. */
  MAX_OUT_WEIGHT: number;

  // ── edge decay (physics family, own constants) ───────────────────────────
  /** Edge stability, in LIVED days (scar E8). Shorter than memory's `S_BASE`
   *  (60): an association that stops being used should fade faster than the
   *  memories it joins, or the graph becomes a fossil record of every
   *  coincidence. CAL, no ancestry. */
  S_EDGE: number;
  /**
   * The curve shape for edges. PINNED to exponential, and that is load-bearing
   * rather than a taste: decay is realized into the stored weight at flush time
   * (weight := decayed, last_day := d), which is exact only for a memoryless
   * curve. Changing this shape requires a separate "last reinforced day" column,
   * not a new constant (NOTES.md §4).
   */
  EDGE_DECAY_SHAPE: DecayShape;

  // ── spreading activation (§9 TUNABLE, v1's live calibration) ─────────────
  /** Hop limit. [v1: 2] CAL. */
  HOPS: number;
  /** Per-hop decay. [v1: 0.5] CAL. */
  HOP_DECAY: number;
  /** Fan normalization: a node's outgoing weight is shared among its edges, so a
   *  hub cannot flood. [v1: on] Structural-ish — off is an A/B arm, not a
   *  shipping mode. */
  FAN_NORMALIZATION: boolean;
  /** Nodes expanded in one traversal — a latency bound, and the reason a dense
   *  graph cannot turn one seed into a whole-store sweep. CAL. */
  MAX_SPREAD_NODES: number;
}

export const TUNABLES: AssociateTunables = {
  HEBB_RATE: 0.1,
  EDGE_WEAK_CREDIT: 0,
  EDGE_CAP: 1.0,
  EDGE_FLOOR: 0.02,

  MAX_EDGES_PER_NODE: 32,
  MAX_OUT_WEIGHT: 4.0,

  S_EDGE: 30,
  EDGE_DECAY_SHAPE: "exponential",

  HOPS: 2,
  HOP_DECAY: 0.5,
  FAN_NORMALIZATION: true,
  MAX_SPREAD_NODES: 64,
};

export function withTunables(overrides: Partial<AssociateTunables> = {}): AssociateTunables {
  return { ...TUNABLES, ...overrides };
}

/**
 * The per-endpoint credit factor. **The ignorable tier is 0 and that is
 * structural** (§10 G1, contract G1): a footnote trains nothing, in either
 * direction, whatever the other endpoint did. The weak tier reads its factor
 * from the CAL table above, where it ships disabled.
 */
export function tierFactor(tier: UseTier, t: AssociateTunables): number {
  switch (tier) {
    case "referenced":
      return 1;
    case "surfaced":
      return t.EDGE_WEAK_CREDIT;
    case "footnoted":
    default:
      return 0;
  }
}

/** The co-activation delta for one pair: the rate, graded by BOTH endpoints. */
export function pairCredit(a: UseTier, b: UseTier, t: AssociateTunables): number {
  return t.HEBB_RATE * tierFactor(a, t) * tierFactor(b, t);
}
