/**
 * `/api/memories` — the constellation, the kinds, the hubs.
 *
 * Split out of `web/views.ts`, which re-exports every public name from here;
 * the four rules in that file's header apply to every line below.
 */
import { TUNABLES as PHYSICS, band as bandOf, strength as strengthOf } from "../../../../core/physics/index.js";
import { isJournal } from "../../../../core/sleep/index.js";
import { rowToPhysics } from "../../../../core/store/index.js";
import type { Band, Kind } from "../../../../core/types.js";
import { NEVER, NONE } from "../../layout.js";
import { BANDS, KINDS } from "../../registries.js";
import type { DashboardSource } from "../../source.js";
import { WITHHELD, reveal, revealHere } from "../reveal.js";
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
  /** The kind in words, for a reader who will never see κ or ι: what it is,
   *  how fast it fades, how easily it is corrected. */
  readonly plain: { readonly label: string; readonly what: string; readonly fades: string; readonly corrects: string };
  /** Where this kind's κ sits between the slowest- and fastest-fading kinds,
   *  0.2 (slowest) to 1 (fastest). For a small five-step bar. */
  readonly fadeSpeed: number;
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
  /** Of `total`: memories proper — the number `counterparts status` prints. */
  readonly memories: number;
  /** Of `total`: entities and beliefs about them (schema rows). */
  readonly schemas: number;
  readonly points: MemoryLine[];
  readonly distribution: { from: number; to: number; count: number }[];
  /** Strength in ten steps, each step split by today's band — the scatter's
   *  right margin. Over every row, not only the plotted ones. */
  readonly strengthByBand: { from: number; to: number; bands: Record<string, number> }[];
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

/** Each kind, in plain words (owner, 2026-09-25: "the kinds table in words").
 *  The words are the κ/ι ordering said aloud; the numbers stay in the JSON. */
const KIND_PLAIN: Record<Kind, KindRow["plain"]> = {
  self: { label: "About me", what: "who I am", fades: "fade slowly", corrects: "hardest to argue out of" },
  person: { label: "People", what: "someone I know", fades: "fade slowly", corrects: "hard to correct" },
  entity: { label: "Things", what: "a thing in the world", fades: "fade fairly fast", corrects: "take some arguing to correct" },
  skill: { label: "Skills", what: "how to do something", fades: "fade slowest", corrects: "easy to correct" },
  place: { label: "Places", what: "somewhere", fades: "fade fairly fast", corrects: "easy to correct" },
  fact: { label: "Facts", what: "a plain fact", fades: "fade fastest", corrects: "easiest to correct" },
};

function fadeSpeed(kappa: number): number {
  const all = KINDS.map((k) => PHYSICS.KINDS[k].kappa);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return hi === lo ? 1 : 0.2 + 0.8 * ((kappa - lo) / (hi - lo));
}

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

  // Walked once: it reads every live row's edges, and it was walked twice.
  const hubRows = hubs(src, 15);
  const steps = 10;
  const strengthByBand = Array.from({ length: steps }, (_, i) => ({
    from: i / steps,
    to: (i + 1) / steps,
    bands: Object.fromEntries(BANDS.map((b) => [b, 0])) as Record<string, number>,
  }));
  for (const r of rows) {
    const step = strengthByBand[Math.min(steps - 1, Math.max(0, Math.floor(r.strength * steps)))];
    if (step !== undefined) step.bands[r.band] = (step.bands[r.band] ?? 0) + 1;
  }

  return {
    day,
    total: rows.length,
    memories: rows.filter((r) => !r.schema).length,
    schemas: rows.filter((r) => r.schema).length,
    strengthByBand,
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
        plain: KIND_PLAIN[kind] ?? { label: kind, what: KIND_GLOSS[kind] ?? kind, fades: "", corrects: "" },
        fadeSpeed: fadeSpeed(tunables.kappa),
      };
    }),
    hubs: hubRows,
    hubsAbsent: hubRows.length === 0 ? (everLived ? NONE : NEVER) : null,
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

// ─────────────────────────────────────────────────────────────────────────────
// the list — every memory, with its words, a page at a time
// ─────────────────────────────────────────────────────────────────────────────

export type ListState = "live" | "archived" | "all";

export interface ListRow {
  readonly id: string;
  /** The title, when the memory carries one (withheld when confidential). */
  readonly title: string | null;
  /** The first line of the memory's own words — or its named absence, or the withholding. */
  readonly line: string;
  readonly confidential: boolean;
  readonly kind: Kind;
  readonly band: Band;
  readonly strength: number;
  readonly bornDay: number;
  /** Lived days since it was born. */
  readonly livedDays: number;
  /** Why it was archived, in plain words; null while it is live. */
  readonly archived: string | null;
  /** The reason exactly as the store recorded it. */
  readonly archivedReason: string | null;
  /** An entity or a belief about one (a schema row), not a memory proper. */
  readonly schema: boolean;
  /** For a schema row: what it is — "entity", "belief", "current state". */
  readonly schemaRole: string | null;
}

export interface MemoryListView {
  readonly day: number;
  readonly state: ListState;
  readonly kind: Kind | null;
  readonly band: Band | null;
  readonly offset: number;
  readonly limit: number;
  /** Rows matching every filter — what the pager pages over. */
  readonly total: number;
  /** Within the live/archived choice alone, so every chip can say its count. */
  readonly counts: {
    readonly live: number;
    readonly archived: number;
    readonly kinds: Record<string, number>;
    readonly bands: Record<string, number>;
  };
  readonly rows: ListRow[];
  readonly absent: string | null;
}

/** The archive reasons the core writes, said the way a person would say them. */
const ARCHIVE_WORDS: Record<string, string> = {
  pruned: "let go at the floor — too weak for too long",
  merged: "merged into a near-duplicate",
  "faded-by-decay": "faded away — nothing mentions it any more",
  "handoff-cleared": "old handoff note cleared",
  "handoff-duplicate": "a repeated handoff note, cleared",
  "episode-regrown": "regrown from its episode — a newer reading replaced it",
  "removed-by-owner": "removed by you",
};

export function archiveWords(reason: string | null, superseded: boolean): string {
  if (reason !== null && reason in ARCHIVE_WORDS) return ARCHIVE_WORDS[reason] as string;
  if (superseded) return "revised — a newer version replaced it";
  return reason === null || reason.length === 0 ? "archived" : `archived (${reason})`;
}

export const LIST_MAX = 200;

/** A schema row's role, from its own meta: an entity has no `entityId` to hang on. */
function schemaRole(meta: string): string {
  try {
    const m = JSON.parse(meta) as Record<string, unknown>;
    if (m["role"] === "current-state") return "current state";
    if (typeof m["entityId"] === "string") return "belief";
    return "entity";
  } catch {
    return "entity";
  }
}

function firstLine(body: string, width: number): string {
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  const t = line ?? body.trim();
  return t.length > width ? `${t.slice(0, width - 1).trimEnd()}…` : t;
}

/**
 * `/api/memories/list` — every memory, newest first, filtered and paged HERE so
 * a store of twenty thousand rows sends one page. The sort and the filters read
 * only the row columns and the physics (one row read per id); the words are
 * read for the page slice alone, through `revealHere` — an archived row's OWN
 * words, never its successor's.
 */
export function memoryListView(
  src: DashboardSource,
  opts: { state?: string | null; kind?: string | null; band?: string | null; offset?: number; limit?: number } = {},
): MemoryListView {
  const store = src.store;
  const day = store.livedDay();
  const state: ListState = opts.state === "archived" || opts.state === "all" ? opts.state : "live";
  const kind = KINDS.includes(opts.kind as Kind) ? (opts.kind as Kind) : null;
  const band = BANDS.includes(opts.band as Band) ? (opts.band as Band) : null;
  const limit = Math.max(1, Math.min(LIST_MAX, Math.floor(opts.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  interface Slim {
    id: string;
    kind: Kind;
    band: Band;
    strength: number;
    bornDay: number;
    learnedOn: string;
    archived: boolean;
  }
  const all: Slim[] = [];
  let live = 0;
  let archived = 0;
  for (const id of store.list({})) {
    const row = store.row(id);
    if (row === undefined || isJournal(row)) continue;
    const isArchived = row.archived === 1;
    if (isArchived) archived += 1;
    else live += 1;
    if (state === "live" && isArchived) continue;
    if (state === "archived" && !isArchived) continue;
    let b: Band = row.band;
    let s = 0;
    try {
      const physics = rowToPhysics(row);
      b = bandOf(physics, day);
      s = strengthOf(physics, day);
    } catch {
      /* a row whose physics will not compute still lists, at zero */
    }
    all.push({ id, kind: row.kind, band: b, strength: s, bornDay: row.birth_day, learnedOn: row.learned_on, archived: isArchived });
  }
  const kinds: Record<string, number> = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const bands: Record<string, number> = Object.fromEntries(BANDS.map((b) => [b, 0]));
  for (const r of all) {
    kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
    bands[r.band] = (bands[r.band] ?? 0) + 1;
  }
  const matching = all.filter((r) => (kind === null || r.kind === kind) && (band === null || r.band === band));
  // Newest first: the lived day it was born, then the calendar day it was
  // recorded, then the id — so the order is defined, not SQLite's.
  matching.sort(
    (a, b) =>
      b.bornDay - a.bornDay ||
      (a.learnedOn < b.learnedOn ? 1 : a.learnedOn > b.learnedOn ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const rows: ListRow[] = matching.slice(offset, offset + limit).map((r) => {
    const row = store.row(r.id);
    const here = revealHere(store, r.id, 160);
    let title: string | null = null;
    let line: string;
    if (!here.present) line = here.label;
    else if (here.confidential) line = WITHHELD;
    else {
      const t = row?.title ?? null;
      title = t !== null && t.trim().length > 0 ? t.trim() : null;
      line = firstLine(row?.body ?? "", 160) || here.label;
    }
    return {
      id: r.id,
      title,
      line,
      confidential: here.confidential,
      kind: r.kind,
      band: r.band,
      strength: r.strength,
      bornDay: r.bornDay,
      livedDays: Math.max(0, day - r.bornDay),
      archived: r.archived ? archiveWords(row?.archived_reason ?? null, (row?.superseded_by ?? null) !== null) : null,
      archivedReason: r.archived ? (row?.archived_reason ?? null) : null,
      schema: row?.type === "schema",
      schemaRole: row?.type === "schema" ? schemaRole(row.meta) : null,
    };
  });
  const everLived = day > 0 || live + archived > 0;
  return {
    day,
    state,
    kind,
    band,
    offset,
    limit,
    total: matching.length,
    counts: { live, archived, kinds, bands },
    rows,
    absent: matching.length === 0 ? (everLived ? NONE : NEVER) : null,
  };
}
