/**
 * The store COPY's records this tool reads, through a read-only SQLite handle
 * of its own: the ambient decisions, who started each turn, the recorded cue
 * words, the ratings, and every memory's lived birth day. Ids and numbers only.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";

export interface DecisionRow {
  readonly seq: number;
  readonly at: number;
  readonly day: number;
  readonly session: string;
  readonly turn: number;
  readonly footnotes: string[];
  readonly surfaced: string[];
  readonly candidates: number | null;
  readonly semantic: string | null;
  readonly startedBy: string | null;
  readonly build: string | null;
}

export interface Rating {
  readonly session: string;
  readonly turn: number;
  readonly since: number;
  readonly id: string;
  readonly score: number;
  readonly lane: string;
}

export interface StoreData {
  decisions: DecisionRow[];
  /** `${session}\u0000t${turn}` -> recorded own cue terms, strongest first. */
  cueRows: Map<string, string[]>;
  ratings: Rating[];
  /** memory id -> lived birth day (every row, archived included). */
  birthDay: Map<string, number>;
  title: (id: string) => string;
  close: () => void;
}

function ids(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === "string" ? x : (x as { id?: unknown })?.id)).filter((x): x is string => typeof x === "string");
}

export function readStoreData(storeDir: string): StoreData {
  const db = new Database(join(storeDir, "counterparts.sqlite"), { readonly: true });
  const startedBy = new Map<string, string>();
  for (const r of db.query("SELECT payload FROM events WHERE name = 'adapter.recall'").all() as { payload: string }[]) {
    try {
      const p = JSON.parse(r.payload) as { session?: string; turn?: number; startedBy?: string };
      if (typeof p.session === "string" && typeof p.turn === "number" && typeof p.startedBy === "string") startedBy.set(`${p.session}\u0000${p.turn}`, p.startedBy);
    } catch {
      /* skip */
    }
  }
  const decisions: DecisionRow[] = [];
  for (const r of db.query("SELECT seq, at, day, payload FROM events WHERE name = 'recall.decision' ORDER BY seq").all() as {
    seq: number;
    at: number;
    day: number;
    payload: string;
  }[]) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof p["session"] !== "string" || typeof p["turn"] !== "number") continue;
    const session = p["session"] as string;
    const turn = p["turn"] as number;
    decisions.push({
      seq: r.seq,
      at: r.at,
      day: typeof p["day"] === "number" ? (p["day"] as number) : r.day,
      session,
      turn,
      footnotes: ids(p["footnotes"]),
      surfaced: ids(p["surfaced"]),
      candidates: typeof p["candidates"] === "number" ? (p["candidates"] as number) : null,
      semantic: typeof p["semanticSource"] === "string" ? (p["semanticSource"] as string) : null,
      startedBy: startedBy.get(`${session}\u0000${turn}`) ?? null,
      build: typeof p["build"] === "string" ? (p["build"] as string) : null,
    });
  }
  const cueRows = new Map<string, string[]>();
  for (const r of db.query("SELECT session_id, ref, value FROM gate_session WHERE kind = 'cues' AND ref LIKE 't%'").all() as {
    session_id: string;
    ref: string;
    value: string;
  }[]) {
    try {
      const v = JSON.parse(r.value) as { c?: [string, number][] };
      if (Array.isArray(v.c)) cueRows.set(`${r.session_id}\u0000${r.ref}`, v.c.map((x) => x[0]));
    } catch {
      /* skip */
    }
  }
  const ratings: Rating[] = [];
  for (const r of db.query("SELECT payload FROM events WHERE name = 'recall.rated'").all() as { payload: string }[]) {
    try {
      const p = JSON.parse(r.payload) as { session?: string; turn?: number; since?: number; ratings?: { id?: string; score?: number; lane?: string }[] };
      if (typeof p.session !== "string" || typeof p.turn !== "number") continue;
      for (const x of p.ratings ?? []) {
        if (typeof x.id !== "string" || typeof x.score !== "number") continue;
        ratings.push({ session: p.session, turn: p.turn, since: typeof p.since === "number" ? p.since : 0, id: x.id, score: x.score, lane: x.lane ?? "?" });
      }
    } catch {
      /* skip */
    }
  }
  const birthDay = new Map<string, number>();
  for (const r of db.query("SELECT id, birth_day FROM memories").all() as { id: string; birth_day: number }[]) birthDay.set(r.id, r.birth_day);
  const titleQ = db.query("SELECT title FROM memories WHERE id = ?");
  return {
    decisions,
    cueRows,
    ratings,
    birthDay,
    title: (id: string) => ((titleQ.get(id) as { title: string | null } | null)?.title ?? "(no title)"),
    close: () => db.close(),
  };
}
