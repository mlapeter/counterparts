/**
 * Box 3 — the rebuildable cache: a SEPARATE sqlite file for the inverted text index
 * and embeddings. Never backed up. Its loss is a re-index, never a memory.
 *
 * The index is a plain inverted table rather than FTS5 on purpose: FTS5 is a
 * compile-time option and the two runtimes we support do not guarantee it the same
 * way. The simplest thing that answers a cue identically on both is 40 lines of
 * tokenizer (constitution line 15 — machinery is earned, not anticipated).
 */
import type { Db } from "./db.js";
import { openDb } from "./db.js";

/** Bumped to 2 (2026-08-25, SEAMS item J): the `ranking` table joins box 3. */
export const CACHE_SCHEMA_VERSION = 2;

const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS doc_tokens (
     memory_id TEXT NOT NULL,
     token     TEXT NOT NULL,
     tf        INTEGER NOT NULL,
     PRIMARY KEY (memory_id, token)
   )`,
  `CREATE INDEX IF NOT EXISTS doc_tokens_token ON doc_tokens (token)`,
  `CREATE TABLE IF NOT EXISTS embeddings (
     memory_id TEXT PRIMARY KEY,
     dim       INTEGER NOT NULL,
     vec       TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS cache_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  // SEAMS item J — the materialized ranking cache.
  //
  // Strength is a PURE FUNCTION of stored state and the lived day (physics §5.4),
  // so nothing here is truth: it is `strength(m, d)` and `band(m, d)` written down
  // so a ranker need not recompute the whole store per query. Delete the file and
  // the next decay tick re-materializes every row.
  //
  // It lives in box 3's own file (and in `TABLES`, so `resetCache` drops it with
  // the rest) rather than in the side file `sleep/strength-cache.ts` opened: the
  // store holds the write lock on this database, and two connections contending
  // for it left box 3 with two owners and one rebuild story
  // (sleep/INTERFACE-GAPS.md §1).
  `CREATE TABLE IF NOT EXISTS ranking (
     memory_id TEXT PRIMARY KEY,
     strength  REAL NOT NULL,
     band      TEXT NOT NULL,
     day       INTEGER NOT NULL
   )`,
];

const TABLES = ["doc_tokens", "embeddings", "cache_meta", "ranking"] as const;

export function openCache(path: string): Db {
  const db = openDb(path);
  db.transaction(() => {
    for (const sql of DDL) db.exec(sql);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
  });
  return db;
}

/** Scoped to box 3 alone: drops only this file's tables, touches no canonical state. */
export function resetCache(db: Db): void {
  db.transaction(() => {
    for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const sql of DDL) db.exec(sql);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
  });
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** (Re)index one document. Idempotent: the doc's prior rows are replaced wholesale. */
export function indexDoc(db: Db, id: string, text: string, vec?: readonly number[]): void {
  const counts = new Map<string, number>();
  for (const tok of tokenize(text)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO doc_tokens (memory_id, token, tf) VALUES (?, ?, ?)");
    for (const [token, tf] of counts) ins.run(id, token, tf);
    if (vec !== undefined) {
      db.run(
        "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
        id,
        vec.length,
        JSON.stringify(vec),
      );
    }
  });
}

export interface Hit {
  id: string;
  score: number;
}

/** Deterministic: score desc, then id asc — so "same cue, same order" is testable. */
export function searchIndex(db: Db, cue: string, limit = 10): Hit[] {
  const tokens = [...new Set(tokenize(cue))];
  if (tokens.length === 0) return [];
  const placeholders = tokens.map(() => "?").join(",");
  const rows = db.all<{ memory_id: string; score: number }>(
    `SELECT memory_id, SUM(tf) AS score FROM doc_tokens
      WHERE token IN (${placeholders})
      GROUP BY memory_id
      ORDER BY score DESC, memory_id ASC
      LIMIT ?`,
    ...tokens,
    limit,
  );
  return rows.map((r) => ({ id: r.memory_id, score: r.score }));
}

export function nearest(db: Db, vec: readonly number[], limit = 10): Hit[] {
  const rows = db.all<{ memory_id: string; vec: string }>("SELECT memory_id, vec FROM embeddings");
  const hits: Hit[] = [];
  for (const row of rows) {
    const other = JSON.parse(row.vec) as number[];
    hits.push({ id: row.memory_id, score: cosine(vec, other) });
  }
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, limit);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
