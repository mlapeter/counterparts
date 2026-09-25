/**
 * `/api/memories` — the constellation, the kinds, the hubs.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { TUNABLES as PHYSICS } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, KINDS } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { reveal } from "../reveal.js";
import { BAND_GLOSS } from "./rows.js";
import type { BarRow } from "./rows.js";
import { absenceFor, census, countMap } from "./shared.js";
import type { MemoryLine } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// memories
// ─────────────────────────────────────────────────────────────────────────────

export interface KindRow {
  readonly kind: Kind;
  readonly count: number;
  readonly meanStrength: number;
  readonly absent: string | null;
  readonly wSal: number;
  readonly wRep: number;
  readonly kappa: number;
  readonly iota: number;
  readonly gloss: string;
}

export interface HubRow {
  readonly id: string;
  readonly text: string;
  readonly confidential: boolean;
  readonly weight: number;
  readonly degree: number;
}

export interface MemoriesView {
  readonly day: number;
  readonly total: number;
  readonly points: MemoryLine[];
  readonly distribution: { from: number; to: number; count: number }[];
  readonly bands: BarRow[];
  readonly kinds: KindRow[];
  readonly hubs: HubRow[];
  readonly hubsAbsent: string | null;
  readonly pointsAbsent: string | null;
  readonly note: string;
}

const KIND_GLOSS: Record<Kind, string> = {
  self: "who I am — salience only, and the slowest to be argued out of",
  person: "someone I know — salience carries it, repetition does not",
  entity: "a thing in the world — both arms count",
  skill: "how to do something — repetition is nearly all of it, and it erodes slowest",
  place: "somewhere — repetition-driven, slow to erode",
  fact: "a plain fact — erodes fastest, and the cheapest to overturn",
};

export function memoriesView(src: DashboardSource, opts: { limit?: number } = {}): MemoriesView {
  const store = src.store;
  const day = store.livedDay();
  const rows = census(src);
  const limit = opts.limit ?? 4000;
  const byKind = countMap<Kind>(rows, "kind");
  const byBand = countMap<Band>(rows, "band");
  const peak = Math.max(1, ...BANDS.map((b) => byBand.get(b) ?? 0));
  const everLived = day > 0 || rows.length > 0;

  const meanByKind = new Map<Kind, number[]>();
  for (const r of rows) {
    const list = meanByKind.get(r.kind) ?? [];
    list.push(r.strength);
    meanByKind.set(r.kind, list);
  }

  const buckets = 20;
  const distribution = Array.from({ length: buckets }, (_, i) => ({
    from: i / buckets,
    to: (i + 1) / buckets,
    count: 0,
  }));
  for (const r of rows) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor(r.strength * buckets)));
    const bucket = distribution[i];
    if (bucket !== undefined) bucket.count += 1;
  }

  return {
    day,
    total: rows.length,
    points: rows.slice(0, limit),
    pointsAbsent: rows.length === 0 ? (everLived ? NONE : NEVER) : null,
    distribution,
    bands: BANDS.map((b) => {
      const count = byBand.get(b) ?? 0;
      return { label: b, count, fraction: count / peak, note: BAND_GLOSS[b], absent: absenceFor(count, everLived) };
    }),
    kinds: KINDS.map((kind) => {
      const count = byKind.get(kind) ?? 0;
      const list = meanByKind.get(kind) ?? [];
      const tunables = PHYSICS.KINDS[kind];
      return {
        kind,
        count,
        meanStrength: list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length,
        absent: absenceFor(count, everLived),
        wSal: tunables.wSal,
        wRep: tunables.wRep,
        kappa: tunables.kappa,
        iota: tunables.iota,
        gloss: KIND_GLOSS[kind],
      };
    }),
    hubs: hubs(src, 15),
    hubsAbsent: hubs(src, 1).length === 0 ? (everLived ? NONE : NEVER) : null,
    note: "Every dot is one memory — or one of the beliefs and entities the schemas hold, which decay and consolidate the same way and are counted apart only where a headline says memories. How many lived days old across, how strong up, how much it mattered at encoding as its size. Colour is the band it is in today, computed now — not the band it was born into.",
  };
}

function hubs(src: DashboardSource, limit: number): HubRow[] {
  const store = src.store;
  const weight = new Map<string, { w: number; d: number }>();
  for (const id of store.list({ archived: false })) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    for (const edge of store.edgesFrom(id)) {
      for (const end of [id, edge.dst]) {
        const cur = weight.get(end) ?? { w: 0, d: 0 };
        cur.w += edge.weight;
        cur.d += 1;
        weight.set(end, cur);
      }
    }
  }
  return [...weight.entries()]
    .sort((a, b) => b[1].w - a[1].w || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id, v]) => {
      const r = reveal(store, id, 72);
      return { id, text: r.text ?? r.label, confidential: r.confidential, weight: v.w, degree: v.d };
    });
}
