/**
 * Spreading activation — a PURE traversal.
 *
 * Seeds plus edge data in, activation contributions out. It reads no store, calls
 * no model, and writes nothing: the graph arrives as two functions the caller
 * supplies (`edgesFrom`, `conducts`), which is what makes the erase test
 * expressible at all — "a removed id stops conducting" is a property of the
 * predicate, not of a deletion that has to be chased through a cache.
 *
 * `recall/` CAN consume this as a fourth channel beside cue, semantic and arrival
 * (its NOTES.md §7 already names the seam and says the gate does not change).
 * **It is not wired in here** — see INTERFACE-GAPS.md §1, which also records the
 * one real collision: a hop contribution can reach an UNCUED memory, and whether
 * that memory may become a candidate is recall's hard gate (a) to decide.
 *
 * Bounds, all three of them structural:
 *   - **depth** — `HOPS` hops, and a node is expanded once, at the shallowest
 *     depth it was reached;
 *   - **fan** — a node's contribution is shared across its live edges
 *     (`FAN_NORMALIZATION`), so a hub cannot flood;
 *   - **size** — `MAX_SPREAD_NODES` expansions, and the result says when it hit
 *     the ceiling instead of quietly returning less.
 */
import { conducts, edgeWeightAt } from "./edges.js";
import type { EdgeState } from "./edges.js";
import type { AssociateTunables } from "./tunables.js";

export interface Seed {
  readonly id: string;
  /** The activation this memory already has from the caller's own channels. */
  readonly activation: number;
}

export interface SpreadInput {
  readonly seeds: readonly Seed[];
  /** Lived day (scar E8) — edges are decayed to it before anything conducts. */
  readonly day: number;
  readonly edgesFrom: (id: string) => readonly EdgeState[];
  /**
   * Does this id conduct? FALSE for anything that is not live memory: removed
   * (deny-listed), archived, or superseded. Non-conducting nodes neither receive
   * a contribution nor pass one along, and they are not in the fan denominator
   * either — an erased id must not even shape the arithmetic between its former
   * neighbours (contract G8, scar §2.2).
   */
  readonly conducts: (id: string) => boolean;
}

export interface Contribution {
  readonly id: string;
  /** The added activation, summed over every path that reached it. */
  readonly activation: number;
  /** Shallowest hop at which it was reached. */
  readonly depth: number;
  readonly paths: number;
}

export type SpreadStop = "exhausted" | "hop-limit" | "node-limit";

export interface SpreadResult {
  readonly contributions: readonly Contribution[];
  /** Nodes whose edges were read. */
  readonly expanded: number;
  /** Seeds and destinations refused by `conducts`. */
  readonly blocked: number;
  readonly stop: SpreadStop;
}

export function spread(input: SpreadInput, t: AssociateTunables): SpreadResult {
  const acc = new Map<string, { activation: number; depth: number; paths: number }>();
  const expandedAt = new Map<string, number>();
  /** Seeds receive NO contribution: their activation is the caller's own, and a
   *  round trip (a → b → a) would hand it back to them as new evidence. The
   *  contributions are what the graph ADDS, never an echo (NOTES.md §6). */
  const seedIds = new Set(input.seeds.map((s) => s.id));
  let blocked = 0;
  let expanded = 0;
  let stop: SpreadStop = "exhausted";

  let frontier: { id: string; carried: number }[] = [];
  for (const s of input.seeds) {
    if (!input.conducts(s.id)) {
      blocked += 1;
      continue;
    }
    if (s.activation > 0) frontier.push({ id: s.id, carried: s.activation });
  }

  for (let depth = 1; depth <= t.HOPS && frontier.length > 0; depth++) {
    const next: { id: string; carried: number }[] = [];
    for (const node of frontier) {
      if (expandedAt.has(node.id)) continue;
      if (expanded >= t.MAX_SPREAD_NODES) {
        stop = "node-limit";
        return finish(acc, expanded, blocked, stop);
      }
      expandedAt.set(node.id, depth);
      expanded += 1;

      const live: { dst: string; weight: number }[] = [];
      for (const e of input.edgesFrom(node.id)) {
        if (e.dst === node.id) continue;
        const w = edgeWeightAt(e, input.day, t);
        if (!conducts(w, t)) continue;
        if (!input.conducts(e.dst)) {
          blocked += 1;
          continue;
        }
        live.push({ dst: e.dst, weight: w });
      }
      if (live.length === 0) continue;

      const fan = t.FAN_NORMALIZATION ? live.reduce((sum, e) => sum + e.weight, 0) : 1;
      if (fan <= 0) continue;
      for (const e of live) {
        if (seedIds.has(e.dst)) continue;
        const gain = node.carried * t.HOP_DECAY * (e.weight / fan);
        if (gain <= 0) continue;
        const have = acc.get(e.dst);
        if (have === undefined) acc.set(e.dst, { activation: gain, depth, paths: 1 });
        else {
          // Contributions SUM across paths — two co-active seeds pointing at the
          // same memory say more than one does — while `depth` keeps the
          // shallowest arrival (NOTES.md §6).
          have.activation += gain;
          have.paths += 1;
          if (depth < have.depth) have.depth = depth;
        }
        if (!expandedAt.has(e.dst)) next.push({ id: e.dst, carried: gain });
      }
    }
    frontier = next;
    if (frontier.length > 0 && depth === t.HOPS) stop = "hop-limit";
  }

  return finish(acc, expanded, blocked, stop);
}

function finish(
  acc: ReadonlyMap<string, { activation: number; depth: number; paths: number }>,
  expanded: number,
  blocked: number,
  stop: SpreadStop,
): SpreadResult {
  const contributions = [...acc]
    .map(([id, v]) => ({ id, activation: v.activation, depth: v.depth, paths: v.paths }))
    .sort((a, b) => b.activation - a.activation || (a.id < b.id ? -1 : 1));
  return { contributions, expanded, blocked, stop };
}
