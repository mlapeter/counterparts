/**
 * `/api/search`.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { band, strength } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";

// ─────────────────────────────────────────────────────────────────────────────
// search
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchView {
  readonly q: string;
  readonly hits: { id: string; score: number; text: string; kind: Kind; band: Band; strength: number; confidential: boolean }[];
  readonly absent: string | null;
}

export function searchView(src: DashboardSource, q: string, limit = 25): SearchView {
  const store = src.store;
  const day = store.livedDay();
  const query = q.trim();
  if (query.length === 0) return { q: "", hits: [], absent: NEVER };
  let raw: { id: string; score: number }[];
  try {
    raw = store.search(query, limit * 2);
  } catch {
    return { q: query, hits: [], absent: NONE };
  }
  const hits: SearchView["hits"] = [];
  for (const hit of raw) {
    const row = store.row(hit.id);
    // The journal is searchable in the owner's editor; it is not a memory here.
    if (row === undefined || isJournal(row)) continue;
    const r = reveal(store, hit.id, 100);
    let s = 0;
    let b: Band = row.band;
    try {
      const physics = store.physicsOf(hit.id);
      s = strength(physics, day);
      b = band(physics, day);
    } catch {
      /* a row that will not read is still a hit; it lists with a named absence */
    }
    hits.push({
      id: hit.id,
      score: hit.score,
      text: r.text ?? r.label,
      kind: row.kind,
      band: b,
      strength: s,
      confidential: r.confidential,
    });
    if (hits.length >= limit) break;
  }
  return { q: query, hits, absent: hits.length === 0 ? NONE : null };
}
