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

/**
 * Bumped to 2 (2026-08-25, SEAMS item J): the `ranking` table joins box 3.
 * Bumped to 3 (2026-09-04): `doc_lens` — the document length the cue channel
 * needs to stop rewarding a memory for being long (see `LengthNorm` below).
 */
export const CACHE_SCHEMA_VERSION = 3;

const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS doc_tokens (
     memory_id TEXT NOT NULL,
     token     TEXT NOT NULL,
     tf        INTEGER NOT NULL,
     PRIMARY KEY (memory_id, token)
   )`,
  `CREATE INDEX IF NOT EXISTS doc_tokens_token ON doc_tokens (token)`,
  // Document length, in indexed tokens — SUM(tf) over the row's `doc_tokens`.
  //
  // It is DERIVED FROM `doc_tokens` AND NOTHING ELSE, which is the whole reason
  // it is its own table rather than a column somewhere upstream: a cache that
  // predates this version rebuilds its lengths with one `GROUP BY` over the
  // index it already has (`backfillLengths` below) — no prose read, no embedder,
  // and above all no `resetCache`, which would drop 13,868 vectors that cost a
  // network call each to recompute.
  `CREATE TABLE IF NOT EXISTS doc_lens (
     memory_id TEXT PRIMARY KEY,
     len       INTEGER NOT NULL
   )`,
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

const TABLES = ["doc_tokens", "doc_lens", "embeddings", "cache_meta", "ranking"] as const;

/**
 * Length normalization for the token channel — the document side of §9 G4.
 *
 * Cue matching is already rarity-weighted on the CUE side: a token spanning the
 * whole store is evidence of nothing, and that zero is what replaces the stop
 * list. This is the same rule read from the other end of the edge: **a memory
 * spanning every topic is specific evidence for none of them.** Before this,
 * `searchIndex` scored a document by raw `SUM(tf)` and took the top `limit` by
 * it, so the longest documents in the store won every cue — measured
 * 2026-09-04 on the live store, where nine memories of 9–20 KB (against a
 * ~1.1 KB median, ~106 indexed tokens) came back as footnotes for every topic
 * across two unrelated sessions and were judged 0-of-9 relevant.
 *
 * The formula is BM25's, and it is chosen because it is the SMALLEST change
 * that could work (constitution 15): the old score's saturating half,
 * `2·tf/(tf+1)`, is exactly this expression at `b = 0, k1 = 1`. Turning `b` up
 * adds length normalization and moves nothing else.
 *
 *   score(tok, doc) = tf·(k1+1) / ( tf + k1·( 1 − b + b·len/avgLen ) )
 *
 * The CAL home for these numbers — the calibration record, with how they were
 * chosen — is `src/core/recall/tunables.ts` (`CUE_TF_SATURATION`,
 * `CUE_LENGTH_NORM`). This default exists because `search()` has two callers
 * that are not recall (`counterpart.ts`'s update-candidate lookup and the CLI's
 * contamination scan), and a test asserts the two agree.
 */
export interface LengthNorm {
  /** tf saturation (BM25 k1). 1.0 reproduces the previous `2·tf/(tf+1)`. */
  readonly k1: number;
  /** length normalization (BM25 b). 0 = none; 1 = fully proportional. */
  readonly b: number;
  /**
   * ONE-SIDED: clamp the length factor at 1, so a long document is penalized
   * and a short one is never REWARDED.
   *
   * BM25's factor is centered on the mean, so at `b = 0.75` a very short
   * document scores up to ~1.6× what it scored with no normalization at all.
   * That is fine for ranking — ranking is relative — and it is not fine for the
   * gate's ABSOLUTE floors (`FLOOR_GLOBAL_UNITS`, `FLOOR_STRONG_DEFAULT_UNITS`),
   * which a candidate clears in a fixed number of cue units. Clamping keeps
   * every score at or below its previous value, so a floor means what it meant.
   *
   * Measured before shipping (`tools/recall-bench`, 13 real prompts, 2026-09-04),
   * and the measurement REFUSED the hypothesis it was built to confirm: clamping
   * does NOT bring the loud tier down (24 one-sided vs 23 two-sided at b=0.75,
   * against 4 before). So the loud-tier inflation is the RELATIVE BAR meeting a
   * distribution that no longer has nine outliers setting its variance — not the
   * scale meeting old floors. That question is now answered, and it is answered
   * against the clamp. Recorded because a flag kept for a reason that turned out
   * to be false is how a codebase accumulates folklore.
   *
   * The clamp ships anyway, for the two reasons that survived: at `b = 0.5` it
   * is the only configuration in the grid that recovers an AMBIENT labeled
   * positive (`mem_e64f1a8b2d77`, the owner's correction about anchoring on the
   * first-stated goal, as a turn-4 footnote), and it is the conservative
   * arithmetic — no score exceeds what it was before normalization, so an
   * inherited absolute floor still means what it meant.
   */
  readonly oneSided?: boolean;
}

export const DEFAULT_LENGTH_NORM: LengthNorm = { k1: 1, b: 0.5, oneSided: true };

/**
 * Mean document length, memoized per open database.
 *
 * A recall pass issues up to `MAX_CUES` index probes, and re-deriving
 * `AVG(len)` over 15k rows inside each of them is real time against a 1200 ms
 * budget. Staleness is harmless by construction: this is a SMOOTHING CONSTANT,
 * not truth — it moves by a fraction of a token when a memory is written, and
 * every writer here invalidates it anyway. A second process's writes are not
 * seen until this one reopens, which is the same tolerance box 3 already has.
 */
const avgLenMemo = new WeakMap<Db, number>();

export function avgDocLen(db: Db): number {
  const memo = avgLenMemo.get(db);
  if (memo !== undefined) return memo;
  const row = db.get<{ a: number | null }>("SELECT AVG(len) AS a FROM doc_lens");
  const avg = row?.a !== null && row?.a !== undefined && row.a > 0 ? row.a : 1;
  avgLenMemo.set(db, avg);
  return avg;
}

function forgetAvgDocLen(db: Db): void {
  avgLenMemo.delete(db);
}

/**
 * The v2 → v3 migration, and the reason the length column is not a rebuild.
 *
 * Lengths are a pure function of `doc_tokens`, so an existing cache re-derives
 * them with one aggregate — no prose read, no embedder, and no `resetCache`.
 * That distinction is the whole point: `rebuildCache()` drops `embeddings`, and
 * on a store whose embedder is not configured in the migrating process, those
 * vectors do not come back. Returns the number of rows written.
 */
export function backfillLengths(db: Db): number {
  const have = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
  if (have > 0) return 0;
  db.run(
    `INSERT OR REPLACE INTO doc_lens (memory_id, len)
       SELECT memory_id, SUM(tf) FROM doc_tokens GROUP BY memory_id`,
  );
  forgetAvgDocLen(db);
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM doc_lens")?.n ?? 0;
}

export function openCache(path: string): Db {
  const db = openDb(path);
  // Idempotent open: write the version row only when it differs. An observer
  // constructing a Store over an up-to-date cache must not churn a byte — the
  // dashboard build measured exactly that churn and filed it (its gap §1).
  // A fresh or outdated cache still initializes (box 3 is rebuildable, and an
  // absent cache is not canonical state), but the steady state is read-only.
  const existing = (() => {
    try {
      const row = db.get<{ value: string }>("SELECT value FROM cache_meta WHERE key = 'schemaVersion'");
      return row?.value ?? null;
    } catch {
      return null; // table absent: fresh cache
    }
  })();
  if (existing !== String(CACHE_SCHEMA_VERSION)) {
    db.transaction(() => {
      for (const sql of DDL) db.exec(sql);
      // The version bump and the lengths it promises land in ONE transaction:
      // a cache stamped v3 with no lengths would score every document as if it
      // were average, silently, which is the failure this version exists to end.
      backfillLengths(db);
      db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
    });
  }
  return db;
}

/** Scoped to box 3 alone: drops only this file's tables, touches no canonical state. */
export function resetCache(db: Db): void {
  forgetAvgDocLen(db);
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
  let len = 0;
  for (const tok of tokenize(text)) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
    len += 1;
  }
  forgetAvgDocLen(db);
  db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    const ins = db.prepare("INSERT INTO doc_tokens (memory_id, token, tf) VALUES (?, ?, ?)");
    for (const [token, tf] of counts) ins.run(id, token, tf);
    // A document with no indexable tokens has no length either: it leaves the
    // table rather than dragging a zero through `AVG(len)`.
    if (len > 0) db.run("INSERT OR REPLACE INTO doc_lens (memory_id, len) VALUES (?, ?)", id, len);
    else db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
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

/**
 * Write ONE document's vector, and touch nothing else.
 *
 * Split out of `indexDoc` because the backfill needs exactly this and `indexDoc`
 * does far more: it `DELETE`s and re-inserts every token row for the document.
 * For a memory whose text has not changed, that is pure churn on `doc_tokens` —
 * and `doc_tokens` is the 263 MB index whose page-cache warming measured 794-819
 * ms on the first recall of every fresh hook process, which is the whole reason
 * `BUDGET_MS` went from 250 to 1200. Sixty-four token-index rewrites per Stop
 * would have fought the constraint that motivated the lag in the first place.
 */
export function setEmbedding(db: Db, id: string, vec: readonly number[]): void {
  db.run(
    "INSERT OR REPLACE INTO embeddings (memory_id, dim, vec) VALUES (?, ?, ?)",
    id,
    vec.length,
    JSON.stringify(vec),
  );
}

export interface Hit {
  id: string;
  score: number;
}

/**
 * Deterministic: score desc, then id asc — so "same cue, same order" is testable.
 *
 * The normalization is applied **inside the SQL, before `ORDER BY … LIMIT`**,
 * and that placement is the fix rather than a detail of it. Normalizing the
 * score afterwards in the caller would have left the CANDIDATE SET chosen by
 * raw `SUM(tf)`: the longest documents would still occupy all `limit` slots for
 * every cue, and the caller would only have re-ranked a set that was already
 * wrong.
 *
 * `LEFT JOIN` + `COALESCE`: a row whose length is not (yet) known is treated as
 * average rather than dropped. Box 3 is rebuildable and partially-built states
 * are ordinary; a missing length must cost precision, never a hit.
 *
 * `CAST(… AS REAL)` on every operand: SQLite divides integers as integers, and
 * both drivers bind an integer-valued JS number as INTEGER. At `b = 1` with an
 * integer mean length, `1 * len / avg` would truncate — silently, and only for
 * some values of the tunables, which is the worst way for arithmetic to be wrong.
 */
export function searchIndex(db: Db, cue: string, limit = 10, norm: LengthNorm = DEFAULT_LENGTH_NORM): Hit[] {
  const tokens = [...new Set(tokenize(cue))];
  if (tokens.length === 0) return [];
  const placeholders = tokens.map(() => "?").join(",");
  const avg = avgDocLen(db);
  const lengthFactor =
    `CAST(? AS REAL) + CAST(? AS REAL) * COALESCE(dl.len, CAST(? AS REAL)) / CAST(? AS REAL)`;
  const clamped = norm.oneSided === true ? `MAX(1.0, ${lengthFactor})` : lengthFactor;
  const rows = db.all<{ memory_id: string; score: number }>(
    `SELECT dt.memory_id AS memory_id,
            SUM(CAST(dt.tf AS REAL) * CAST(? AS REAL)
                / (dt.tf + CAST(? AS REAL) * (${clamped}))) AS score
       FROM doc_tokens dt
       LEFT JOIN doc_lens dl ON dl.memory_id = dt.memory_id
      WHERE dt.token IN (${placeholders})
      GROUP BY dt.memory_id
      ORDER BY score DESC, dt.memory_id ASC
      LIMIT ?`,
    norm.k1 + 1,
    norm.k1,
    1 - norm.b,
    norm.b,
    avg,
    avg,
    ...tokens,
    limit,
  );
  return rows.map((r) => ({ id: r.memory_id, score: r.score }));
}

/**
 * Document frequency — in how many indexed documents does each token appear?
 *
 * This exists because the caller that needs df was counting the wrong thing.
 * `recall/activate.ts` took `df = searchIndex(tok, PER_CUE_FETCH).length`, which
 * is `min(trueDf, PER_CUE_FETCH)` — so on a store with more than
 * `PER_CUE_FETCH` documents holding a token, EVERY common word measured as
 * "appears in 24 documents" and drew a rarity weight near the maximum.
 * MEASURED 2026-09-04 on a 15,421-document index: `the` and `conversation`
 * scored `informativeness = 5.7` against a ceiling of 8.95, where their true
 * frequencies (df 350–10k) put them at 0–3. On a seventeen-memory fixture the
 * truncation cannot happen at all, so the bug was invisible to every hermetic
 * test and grew with the store.
 *
 * `doc_tokens` is keyed `(memory_id, token)`, so `COUNT(*)` per token IS the
 * document count — no `DISTINCT` needed, and the `doc_tokens_token` index
 * covers it. One grouped query for the whole turn: measured 8–36 ms cold and
 * 2–4 ms warm for 72 tokens on that same index.
 */
export function docFrequency(db: Db, tokens: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return out;
  // Bound the statement's variable count; SQLite's default limit is 999.
  const CHUNK = 400;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = db.all<{ token: string; n: number }>(
      `SELECT token, COUNT(*) AS n FROM doc_tokens WHERE token IN (${placeholders}) GROUP BY token`,
      ...slice,
    );
    for (const r of rows) out.set(r.token, r.n);
  }
  return out;
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

/**
 * The same ranking as `nearest`, returning the VECTORS rather than the ids —
 * the context slice a novelty measurement is error against. One scan, one
 * ordering, no second definition of "nearest" to drift from the first.
 */
export function nearestVectors(db: Db, vec: readonly number[], limit = 10): number[][] {
  const rows = db.all<{ memory_id: string; vec: string }>("SELECT memory_id, vec FROM embeddings");
  const scored: { id: string; score: number; vec: number[] }[] = [];
  for (const row of rows) {
    const other = JSON.parse(row.vec) as number[];
    if (other.length === 0) continue;
    scored.push({ id: row.memory_id, score: cosine(vec, other), vec: other });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, limit).map((s) => s.vec);
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
