/**
 * The edge arithmetic — increment, cap, decay by lived day, homeostasis.
 *
 * It lives HERE rather than on `physics/`'s page by the module map's 2026-08-25
 * ruling: edge-level arithmetic keeps `physics/` one page. What it does NOT do is
 * define a second decay CURVE — `decayCurve` is imported from physics and given
 * this module's own stability constant (`S_EDGE`). One curve family, two
 * constants, which is what "a physics-family curve, own constants" means.
 *
 * Everything in this file is pure. Nothing reads a store, nothing writes one, and
 * every state-changing operation returns the NEXT rows for the caller to persist —
 * the same shape physics uses, for the same reason: the flush ordering that makes
 * at-most-once true (index.ts) can only be reasoned about if the arithmetic has no
 * say in when it lands.
 */
import { decayCurve } from "../physics/index.js";
import type { AssociateTunables } from "./tunables.js";

/** One directed edge as this module sees it. Mirrors `store.EdgeRow`, without
 *  binding the arithmetic to the row shape. */
export interface EdgeState {
  readonly src: string;
  readonly dst: string;
  readonly weight: number;
  readonly lastDay: number;
}

/** An accumulated co-activation delta for one UNORDERED pair. */
export interface PairDelta {
  readonly a: string;
  readonly b: string;
  readonly delta: number;
}

/** An edge pushed out by the per-node count cap (§10 G3, scar §2.17). */
export interface Eviction {
  readonly src: string;
  readonly dst: string;
  /** The weight it held when it was evicted — the part that would otherwise be
   *  the only lost record. Carried in the flush report and the event. */
  readonly priorWeight: number;
  readonly reason: "count-cap" | "below-floor";
}

export interface FlushPlan {
  /** Absolute next rows — never deltas. A partially-applied plan is impossible
   *  because the caller writes them in ONE transaction. */
  readonly rows: readonly EdgeState[];
  readonly evictions: readonly Eviction[];
  /** Nodes whose outgoing total was scaled back by synaptic scaling. */
  readonly renormalized: readonly string[];
  readonly nodesTouched: number;
}

/** Canonical unordered-pair key. `a|b` with the ids sorted, so one pair has one
 *  buffer slot however the caller ordered it. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * An edge's weight AT a lived day — the decay, applied lazily and idempotently.
 * A pure function of (stored weight, stored day, asked day), so there is no step
 * to run twice (physics guarantee 5's shape, scar E8).
 */
export function edgeWeightAt(e: EdgeState, day: number, t: AssociateTunables): number {
  const elapsed = day - e.lastDay;
  if (elapsed <= 0) return e.weight;
  return e.weight * decayCurve(elapsed, t.S_EDGE, t.EDGE_DECAY_SHAPE);
}

/** Dead edges conduct nothing. The floor is where an edge stops being an
 *  association and becomes a rounding error. */
export function conducts(weight: number, t: AssociateTunables): boolean {
  return weight > t.EDGE_FLOOR;
}

/** Increment, capped. The cap is the per-edge half of homeostasis (§10 G2). */
export function strengthen(current: number, delta: number, t: AssociateTunables): number {
  const next = current + Math.max(0, delta);
  return next > t.EDGE_CAP ? t.EDGE_CAP : next;
}

/**
 * One node's outgoing edges, after the deltas: cap the LIVE edge count (weakest
 * evicted), then bound the total outgoing weight by PROPORTIONAL renormalization.
 *
 * Order matters and is deliberate: evict first, scale second. Scaling first would
 * shrink edges that are about to be evicted anyway and let the survivors keep more
 * weight than the bound allows.
 */
export function homeostasis(
  src: string,
  weights: ReadonlyMap<string, number>,
  t: AssociateTunables,
): { next: Map<string, number>; evictions: Eviction[]; renormalized: boolean } {
  const next = new Map(weights);
  const evictions: Eviction[] = [];

  // Live edges, strongest first; ties broken by id so the plan is deterministic.
  const live = [...next.entries()]
    .filter(([, w]) => conducts(w, t))
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));

  for (const [dst, w] of live.slice(t.MAX_EDGES_PER_NODE)) {
    // "Removal" here is a zeroed weight, not a deleted row: this module has no
    // delete and the store exports none (no-silent-destruction). The eviction is
    // reported and evented; the durable eviction ARCHIVE is a store gap
    // (INTERFACE-GAPS.md §2).
    next.set(dst, 0);
    evictions.push({ src, dst, priorWeight: w, reason: "count-cap" });
  }

  const kept = live.slice(0, t.MAX_EDGES_PER_NODE);
  const total = kept.reduce((sum, [, w]) => sum + w, 0);
  let renormalized = false;
  if (total > t.MAX_OUT_WEIGHT && total > 0) {
    const factor = t.MAX_OUT_WEIGHT / total;
    for (const [dst, w] of kept) next.set(dst, w * factor);
    renormalized = true;
  }
  return { next, evictions, renormalized };
}

/**
 * The whole flush, as arithmetic: current rows + buffered deltas + a lived day
 * → the absolute next rows.
 *
 * Two properties the caller depends on:
 *
 * 1. **Symmetric by construction.** One unordered pair mints two directed rows,
 *    because the store's edge table is keyed (src, dst) and a traversal reads
 *    `edgesFrom` only. Renormalization can later make the two directions differ
 *    in magnitude — a hub's edge to a quiet node is scaled while the quiet node's
 *    edge back is not — and that asymmetry is real, not a bug (NOTES.md §5).
 * 2. **Decay is REALIZED, not merely observed.** Every row a touched node writes
 *    carries its decayed-to-`day` weight and `lastDay = day`. Exact for the
 *    exponential family, which is why the shape is pinned (NOTES.md §4).
 */
export function planFlush(
  deltas: readonly PairDelta[],
  day: number,
  edgesFrom: (id: string) => readonly EdgeState[],
  t: AssociateTunables,
): FlushPlan {
  /** node -> (dst -> weight at `day`, deltas applied). */
  const nodes = new Map<string, Map<string, number>>();
  /** node -> (dst -> the row as stored), so unchanged rows are not rewritten. */
  const stored = new Map<string, Map<string, EdgeState>>();

  const load = (id: string): Map<string, number> => {
    const have = nodes.get(id);
    if (have !== undefined) return have;
    const decayed = new Map<string, number>();
    const raw = new Map<string, EdgeState>();
    for (const e of edgesFrom(id)) {
      decayed.set(e.dst, edgeWeightAt(e, day, t));
      raw.set(e.dst, e);
    }
    nodes.set(id, decayed);
    stored.set(id, raw);
    return decayed;
  };

  for (const d of deltas) {
    if (d.a === d.b) continue;
    const forward = load(d.a);
    const back = load(d.b);
    forward.set(d.b, strengthen(forward.get(d.b) ?? 0, d.delta, t));
    back.set(d.a, strengthen(back.get(d.a) ?? 0, d.delta, t));
  }

  const rows: EdgeState[] = [];
  const evictions: Eviction[] = [];
  const renormalized: string[] = [];
  for (const [src, weights] of [...nodes].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const settled = homeostasis(src, weights, t);
    evictions.push(...settled.evictions);
    if (settled.renormalized) renormalized.push(src);
    const raw = stored.get(src) ?? new Map<string, EdgeState>();
    for (const [dst, weight] of [...settled.next].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const before = raw.get(dst);
      if (before !== undefined && before.weight === weight && before.lastDay === day) continue;
      rows.push({ src, dst, weight, lastDay: day });
    }
  }
  return { rows, evictions, renormalized, nodesTouched: nodes.size };
}
