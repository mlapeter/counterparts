/**
 * "AS IF ON DAY D": hide every memory born on or after lived day D from one
 * replayed turn, without cloning the store, by wrapping three methods on THIS
 * process's store instance (the tool's own observer handle on the copy; no
 * file under src/ changes):
 *
 *   - `search` and `nearestTo` — the two top-K reads that fill the lexical and
 *     semantic candidate pools. Wrapped to over-fetch, drop later-born ids,
 *     then truncate to the asked limit, so a later-born memory never takes a
 *     slot an older one would have had (a filter after the top-K would let it
 *     crowd them out).
 *   - `deniedIds` — every other lane that admits a candidate (hops, links,
 *     see-also, temporal, schemas, beliefs) checks it, so later-born ids are
 *     added there as removed.
 *
 * WHAT THIS CANNOT UNDO, all "as of today" rather than "as of day D": document
 * frequencies and store size (rarity), strength / reach / fade (a memory faded
 * or archived since is invisible; one archived later but live then cannot be
 * brought back), later revisions of an older memory's text, use and return
 * history, learned cue weights (R3), the edge graph, and the session's own
 * state (what it had already shown, its carried cues, its train of thought).
 * The tool counts any later-born id that still reaches a shown slot (`leaks`).
 */
import type { Store } from "../../src/core/store/index.ts";

type Hit = { id: string; score: number };

export interface BornBefore {
  /** Set the cutoff: memories with birth_day >= day are hidden. null: no filter. */
  setDay(day: number | null): void;
  restore(): void;
}

export function wrapBornBefore(store: Store, birthDay: ReadonlyMap<string, number>): BornBefore {
  let cutoff: number | null = null;
  let hidden: string[] = [];
  const s = store as unknown as {
    search: (cue: string, limit?: number, norm?: unknown, opts?: unknown) => Hit[];
    nearestTo: (vec: readonly number[], limit?: number, opts?: unknown) => Hit[];
    deniedIds: () => string[];
  };
  const orig = { search: s.search, nearestTo: s.nearestTo, deniedIds: s.deniedIds };
  const later = (id: string): boolean => cutoff !== null && (birthDay.get(id) ?? Number.POSITIVE_INFINITY) >= cutoff;
  const overFetch = (fetch: (n: number) => Hit[], limit: number): Hit[] => {
    if (cutoff === null) return fetch(limit);
    for (let n = Math.max(limit * 4, 32); ; n *= 4) {
      const got = fetch(n);
      const kept = got.filter((h) => !later(h.id));
      if (kept.length >= limit || got.length < n) return kept.slice(0, limit);
    }
  };
  s.search = function (cue, limit = 10, norm, opts) {
    return overFetch((n) => orig.search.call(store, cue, n, norm, opts), limit);
  };
  s.nearestTo = function (vec, limit = 10, opts) {
    return overFetch((n) => orig.nearestTo.call(store, vec, n, opts), limit);
  };
  s.deniedIds = function () {
    const base = orig.deniedIds.call(store);
    return cutoff === null ? base : [...base, ...hidden];
  };
  return {
    setDay(day) {
      cutoff = day;
      hidden = day === null ? [] : [...birthDay].filter(([, d]) => d >= day).map(([id]) => id);
    },
    restore() {
      s.search = orig.search;
      s.nearestTo = orig.nearestTo;
      s.deniedIds = orig.deniedIds;
    },
  };
}
