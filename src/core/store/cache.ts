/**
 * Box 3 — the rebuildable cache: a SEPARATE sqlite file for the inverted text index
 * and embeddings. Never backed up. Its loss is a re-index, never a memory.
 *
 * The index is a plain inverted table rather than FTS5 on purpose: FTS5 is a
 * compile-time option and the two runtimes we support do not guarantee it the same
 * way. The simplest thing that answers a cue identically on both is 40 lines of
 * tokenizer (constitution line 15 — machinery is earned, not anticipated).
 */
import type { Db, SqlValue } from "./db.js";
import { openDb } from "./db.js";

/**
 * Bumped to 2 (2026-08-25, SEAMS item J): the `ranking` table joins box 3.
 * Bumped to 3 (2026-09-04): `doc_lens` — the document length the cue channel
 * needs to stop rewarding a memory for being long (see `LengthNorm` below).
 * Bumped to 4 (2026-09-05): embeddings are written as a float32 BLOB rather
 * than JSON text (see `encodeVector`). The bump changes what a WRITE produces;
 * reads stay tolerant of both shapes, and `counterparts migrate-cache`
 * converts the rows already on disk.
 */
export const CACHE_SCHEMA_VERSION = 4;

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
  // `vec` is a float32 BLOB: `dim` little-endian IEEE-754 singles, `dim * 4`
  // bytes (v4, 2026-09-05). It was JSON text through v3, and the declared type
  // here is AFFINITY, not a constraint — a v3 cache whose table says `TEXT`
  // stores a bound BLOB as a BLOB (SQLite's TEXT affinity keeps NULL/TEXT/BLOB
  // storage classes unchanged), so the write side needs no table rewrite and
  // the read side decodes whichever shape a row actually holds.
  `CREATE TABLE IF NOT EXISTS embeddings (
     memory_id TEXT PRIMARY KEY,
     dim       INTEGER NOT NULL,
     vec       BLOB NOT NULL
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
   * positive (a correction the owner once gave, as a turn-4 footnote — see
   * `recall/tunables.ts`), and it is the conservative
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
  // WAL here whatever the stance, unlike box 2: the dashboard and the worker read
  // and write this file at the same time, its sidecars live inside `cache/` where
  // nothing classifies them, and box 3 is DECLARED rebuildable — the same reason
  // the constructor lets an instrument materialize this directory at all.
  const db = openDb(path, { wal: true });
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

/**
 * Scoped to box 3 alone: drops only this file's tables, touches no canonical state.
 *
 * `keepEmbeddings` spares exactly one table, and it exists because "rebuildable"
 * is not the same claim for all four. `doc_tokens`, `doc_lens` and `ranking` are
 * recomputed from state this process already holds; `embeddings` are recomputed
 * from a PAID NETWORK CALL, one per row, and a console with no embedder wired
 * cannot put them back at all (`adapters/cli/NOTES.md`, 2026-09-04 — a bare
 * `verify` would have dropped ~13,700 of them). The table is left in place
 * rather than read out and rewritten, so nothing has to fit in memory.
 */
export function resetCache(db: Db, opts: { keepEmbeddings?: boolean } = {}): void {
  const drop = opts.keepEmbeddings === true ? TABLES.filter((t) => t !== "embeddings") : TABLES;
  forgetAvgDocLen(db);
  db.transaction(() => {
    for (const t of drop) db.exec(`DROP TABLE IF EXISTS ${t}`);
    for (const sql of DDL) db.exec(sql);
    db.run("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schemaVersion', ?)", String(CACHE_SCHEMA_VERSION));
  });
}

// ── vectors: the wire shape of box 3's embeddings ────────────────────────────

/**
 * A vector as box 3 stores it since v4: **`dim` little-endian float32s**, not
 * JSON text.
 *
 * The measurement that motivated it (`docs/LAUNCH-STATUS.md` §E-W1(4), and the
 * synthetic re-measurement in this module's NOTES): at 1,024 dimensions a JSON
 * row is ~12.7 KB against 4 KB of float32, and `nearest()` — a full scan that
 * `JSON.parse`d every row — cost 590–1,040 ms on the live store's ~13.9K
 * vectors. Nothing about that is the parser being slow; it is the SCAN reading
 * three times the bytes and then allocating a 1,024-element `number[]` per row
 * to throw away.
 *
 * **float32 is not a lossy choice for an embedding, it is the embedder's own
 * precision.** Every provider this adapter speaks to computes and serves single
 * precision; JSON text was storing float64 room that never held float64
 * information. What float32 IS lossy about is a value that arrived as a
 * float64 which is not exactly representable as a float32 — a re-serialized
 * vector, a hand-written test fixture — and there the round trip moves the
 * value by at most one float32 ulp (~1e-7 relative). `nearest` accumulates in
 * float64 either way, so for a vector whose values are already float32-exact
 * (`Math.fround(x) === x`) the scores are BIT-IDENTICAL before and after; that
 * is the property `test/store.test.ts` pins, and the general case is pinned as
 * same-order, ≤1e-6 score movement.
 */
export function encodeVector(vec: readonly number[]): Uint8Array {
  const f = new Float32Array(vec.length);
  // `Number.isFinite`, not `?? 0`: a `NaN` or an infinity is not a coordinate,
  // and it must not reach the scan. v3 coerced it by accident —
  // `JSON.stringify(NaN)` is `"null"` and `JSON.parse` gave back `null ?? 0` —
  // so writing it through would have been a REGRESSION dressed as a format
  // change. A NaN row scores `NaN`, and `nearest`'s comparator
  // (`b.score - a.score || id`) reads `NaN - x` as falsy and falls through to
  // the id tiebreak, so one such row sorts anywhere at all, first included.
  // `countNonFinite` is how a caller reports what it coerced.
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i];
    f[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
  }
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}

/** How many of `vec`'s entries `encodeVector` would coerce to zero. */
export function countNonFinite(vec: readonly number[]): number {
  let n = 0;
  for (const x of vec) if (!(typeof x === "number" && Number.isFinite(x))) n += 1;
  return n;
}

/**
 * Read a stored vector back in whatever shape the row holds — float32 BLOB
 * (v4) or JSON text (v3 and earlier).
 *
 * Tolerating both is deliberate and is what makes the migration safe rather
 * than a flag day: a cache mid-`migrate-cache` (or one written by a v4 process
 * and last converted by nothing) is MIXED, and a reader that assumed one shape
 * would turn an unconverted row into either a crash or a silent zero-similarity
 * lie. The cost is one `typeof` per row.
 *
 * The BLOB arm returns a `Float32Array` VIEW where it can — no per-row copy of
 * 1,024 numbers, which is most of what the old scan spent. A driver that hands
 * back a pooled buffer at an unaligned `byteOffset` (node:sqlite's `Buffer`s do
 * this; bun:sqlite's always start at 0) forces one copy, which is what the
 * second arm is.
 *
 * A byte length that is not a multiple of four is **not** a short vector, it is
 * a CORRUPT ROW, and it comes back empty rather than truncated: truncating
 * would hand the scan a silently shortened vector and a cosine computed over a
 * prefix, which is a wrong number with no signal on it. Empty scores 0 through
 * `cosine`'s zero-norm arm, `nearestVectors` skips it, and `vectorFormats`
 * counts the row in `other` so a census names it instead of a scan hiding it.
 */
export function decodeVector(raw: SqlValue): Float32Array | number[] {
  if (typeof raw === "string") return JSON.parse(raw) as number[];
  if (raw instanceof Uint8Array) {
    if (raw.byteLength % 4 !== 0) return [];
    const n = raw.byteLength >>> 2;
    if (n === 0) return [];
    if (raw.byteOffset % 4 === 0) return new Float32Array(raw.buffer, raw.byteOffset, n);
    const copy = new Uint8Array(raw); // fresh buffer, byteOffset 0
    return new Float32Array(copy.buffer, 0, n);
  }
  return [];
}

/** How many vectors box 3 holds, in each of the two shapes. Cheap: a grouped count. */
export interface VectorFormatCensus {
  readonly total: number;
  /** v4 rows: `dim` little-endian float32s. */
  readonly float32: number;
  /** v3 rows: `JSON.stringify(vec)`. What `migrate-cache` converts. */
  readonly jsonText: number;
  /**
   * Unreadable: neither shape, or a BLOB whose byte length is not a multiple
   * of four (`decodeVector` returns empty for those rather than a truncated
   * vector). Named rather than folded into a total.
   */
  readonly other: number;
  /** `SUM(LENGTH(vec))` over each shape, in bytes. */
  readonly float32Bytes: number;
  readonly jsonTextBytes: number;
}

export function vectorFormats(db: Db): VectorFormatCensus {
  // The GROUP BY key is the shape as a READER sees it, not `typeof` alone: a
  // blob of 4,097 bytes has `typeof = 'blob'` and is still not a vector, and a
  // census that counted it as one would report a store as fully converted while
  // `decodeVector` was returning empty for it.
  const rows = db.all<{ t: string; n: number; b: number | null }>(
    `SELECT CASE
              WHEN typeof(vec) = 'blob' AND LENGTH(vec) % 4 = 0 THEN 'blob'
              WHEN typeof(vec) = 'text' THEN 'text'
              ELSE 'other'
            END AS t,
            COUNT(*) AS n, SUM(LENGTH(vec)) AS b
       FROM embeddings GROUP BY t`,
  );
  let float32 = 0;
  let jsonText = 0;
  let other = 0;
  let float32Bytes = 0;
  let jsonTextBytes = 0;
  for (const r of rows) {
    const bytes = r.b ?? 0;
    if (r.t === "blob") {
      float32 += r.n;
      float32Bytes += bytes;
    } else if (r.t === "text") {
      jsonText += r.n;
      jsonTextBytes += bytes;
    } else other += r.n;
  }
  return { total: float32 + jsonText + other, float32, jsonText, other, float32Bytes, jsonTextBytes };
}

export interface ConvertBatchReport {
  /** Rows examined this batch. Zero means the walk is finished. */
  readonly examined: number;
  /** Rows rewritten as float32 BLOBs. */
  readonly converted: number;
  /** Rows whose `vec` would not parse — left exactly as they are, and named. */
  readonly skipped: readonly string[];
  /** Coordinates coerced to zero because they were NaN or infinite. */
  readonly coerced: number;
  /** The last `memory_id` examined, to continue the walk past a skipped row. */
  readonly lastId: string | null;
}

/**
 * Convert up to `batch` JSON-text vectors to float32 BLOBs, in ONE transaction,
 * and report what happened. `examined === 0` means the walk is finished.
 *
 * **Batched, not one statement**, because this runs on a 177 MB file the
 * Stop-hook worker also writes to: a single transaction over 13.9K rows holds
 * box 3's write lock for the whole rewrite, and `BUSY_TIMEOUT_MS` is five
 * seconds. Idempotent by its WHERE clause — a converted row is not selected —
 * so an interrupted run resumes by being run again, and a finished one is a
 * no-op.
 *
 * **`after` is what makes one bad row survivable.** The first version parsed
 * inside the transaction and let a throw roll the batch back; because the
 * selection is `ORDER BY memory_id LIMIT ?`, the very next attempt selected the
 * same unparseable row and threw again, and every row after it stayed in the
 * old shape forever — one corrupt byte holding 13,000 vectors hostage. Now a
 * row that will not parse is SKIPPED, NAMED, and left untouched (nothing here
 * repairs data it cannot read), and the caller walks past it with
 * `after = lastId`.
 */
export function convertVectorBatch(db: Db, batch = 500, after?: string): ConvertBatchReport {
  const rows =
    after === undefined
      ? db.all<{ memory_id: string; vec: SqlValue }>(
          "SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' ORDER BY memory_id LIMIT ?",
          batch,
        )
      : db.all<{ memory_id: string; vec: SqlValue }>(
          "SELECT memory_id, vec FROM embeddings WHERE typeof(vec) = 'text' AND memory_id > ? ORDER BY memory_id LIMIT ?",
          after,
          batch,
        );
  const lastId = rows.length === 0 ? null : (rows[rows.length - 1]?.memory_id ?? null);
  if (rows.length === 0) return { examined: 0, converted: 0, skipped: [], coerced: 0, lastId };
  // Parse OUTSIDE the transaction: a throw here must cost one row, not a batch.
  const decoded: { id: string; arr: number[] }[] = [];
  const skipped: string[] = [];
  let coerced = 0;
  for (const row of rows) {
    try {
      const arr = Array.from(decodeVector(row.vec));
      coerced += countNonFinite(arr);
      decoded.push({ id: row.memory_id, arr });
    } catch {
      skipped.push(row.memory_id);
    }
  }
  const converted = db.transaction(() => {
    const upd = db.prepare("UPDATE embeddings SET dim = ?, vec = ? WHERE memory_id = ?");
    let n = 0;
    for (const d of decoded) {
      upd.run(d.arr.length, encodeVector(d.arr), d.id);
      n += 1;
    }
    return n;
  });
  return { examined: rows.length, converted, skipped, coerced, lastId };
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
        encodeVector(vec),
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
    encodeVector(vec),
  );
}

/**
 * Take one document OUT of the text index — the other half of `indexDoc`.
 *
 * **The rule this makes structural: the index is the index OF THE LIVE STORE.**
 * `doc_tokens` is what `docFrequency` counts and what `searchIndex` selects
 * from, and both of those numbers are read against a LIVE denominator:
 * `recall/`'s `storeSize` is `store.list({ archived: false }).length`, and
 * `activate.ts` throws away any hit whose row is archived or superseded. While
 * a dead row kept its token rows, the two counts came from two different
 * populations — so `df > storeSize` was reachable, and
 * `informativeness(df, storeSize)` returns exactly zero at `df >= storeSize`.
 * MEASURED 2026-09-04: a fresh store, one note, one revision — `revision.ts`
 * calls `Store.supersede`, the head is archived and stays indexed,
 * `df(sourdough) = 2` against `storeSize = 1`, every cue is dropped, and the
 * MCP `recall` door answers `nothing-came` on a store whose only memory plainly
 * matches the question. That is NOTES §12's N=1 re-zeroing, restored by an
 * ordinary revision (LAUNCH-STATUS I13).
 *
 * It also stops a dead row from spending a slot ON THE LEXICAL CHANNEL:
 * `searchIndex` takes the top `limit` per cue, and a row `activate` will
 * discard was still winning one of them. Narrowing the candidate SET is the
 * same failure length normalization was moved into the SQL to avoid.
 *
 * **`embeddings` is left alone, and the semantic half of that same slot problem
 * is therefore still OPEN.** A vector cost a paid network call, so deleting it
 * here would spend money — but the first draft of this docblock justified that
 * with "nothing reads a dead row's vector", and an adversarial review measured
 * the opposite: `nearest` (below) scans `embeddings` with no filter, and
 * `activate.ts`'s semantic channel takes that ranking as `SEMANTIC_TOP_M`
 * candidates before discarding the dead one. After a `supersede`, `nearestTo`
 * returned the dead row FIRST of three. So what is true is narrower: nothing
 * can be DELIVERED from a dead row, and its vector can still displace a live
 * neighbour from the semantic slate. Named as a follow-up in
 * `recall/NOTES.md` §13 (filter inside `Store.nearestTo` — over-fetch and drop
 * the non-live against box 2, the shape the lexical half just got) rather than
 * widened into this change. `rebuildCache` does not carry a dead row's vector
 * forward — a rebuild reproduces the LIVE index — and that asymmetry is named
 * there too.
 *
 * **Two things this does NOT reach, deliberately.** The `ranking` table keeps
 * the row: it is keyed by id and read per-id by callers that already iterate
 * live rows, so it is inert rather than wrong. And the rule is kept by the two
 * WRITERS of `archived = 1` that live in this module — `Store.archive` and
 * `Store.supersede`; the third, `owner-op-seam.ts`'s removal scrub, is reached
 * only by its caller's convention (the console's destruction path always
 * follows it with `rebuildCache`, which drops the row as `skippedDenied`). If
 * that rebuild ever failed, `counterparts verify`'s "indexed but not live" line
 * now names the leftover instead of hiding it.
 */
export function deindexDoc(db: Db, id: string): void {
  forgetAvgDocLen(db);
  db.transaction(() => {
    db.run("DELETE FROM doc_tokens WHERE memory_id = ?", id);
    db.run("DELETE FROM doc_lens WHERE memory_id = ?", id);
  });
}

/** How many vectors box 3 holds. The count `unembeddedCount()` is NOT. */
export function embeddingCount(db: Db): number {
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM embeddings")?.n ?? 0;
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
  const rows = db.all<{ memory_id: string; vec: SqlValue }>("SELECT memory_id, vec FROM embeddings");
  const hits: Hit[] = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
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
  const rows = db.all<{ memory_id: string; vec: SqlValue }>("SELECT memory_id, vec FROM embeddings");
  const scored: { id: string; score: number; vec: Float32Array | number[] }[] = [];
  for (const row of rows) {
    const other = decodeVector(row.vec);
    if (other.length === 0) continue;
    scored.push({ id: row.memory_id, score: cosine(vec, other), vec: other });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // `Array.from` only on the `limit` survivors: the caller's contract is
  // `number[][]`, and materializing the whole scan to satisfy it would give
  // back exactly the per-row allocation the BLOB read exists to avoid.
  return scored.slice(0, limit).map((s) => (Array.isArray(s.vec) ? s.vec : Array.from(s.vec)));
}

/**
 * `ArrayLike<number>` rather than `readonly number[]`: since v4 the stored side
 * arrives as a `Float32Array` view over the row's bytes, and widening the
 * parameter is what lets the scan score it WITHOUT copying it into an array
 * first. The arithmetic is unchanged and still accumulates in float64.
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
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
