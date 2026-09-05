/**
 * Box 2 — the canonical operational database. One small SQLite file holding the
 * physics fields, the band cache, superseded-version rows, edges, prospective
 * entries, the removal record, and meta/clock state.
 *
 * Canonical, NOT a cache: it is backed up as a database and never "rebuilt". The
 * rebuild contract belongs to box 3 alone (contract §4, owner rescope 1).
 *
 * Every multi-row mutation is wrapped in a transaction by the seam in `index.ts`.
 */
import { dirname } from "node:path";

import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import type { Db, Row } from "./db.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
import { relativizeStoredPath } from "./paths.js";
import type { ProseType } from "./prose.js";

/**
 * Bumped to 5 (2026-09-05, finding I22): `memories.prose_path` and
 * `versions.path` hold STORE-RELATIVE paths (`prose/<family>/<id>.md`,
 * `versions/<id>/<seq>-<hash>.md`) where v4 and before held absolute ones. No
 * DDL moves; the migration is a DATA rewrite of two columns, done once, inside
 * the same transaction as everything else at open (`relativizeStoredPaths`).
 * It is the first migrate-at-open the live store will ever run.
 *
 * Version 4 (2026-08-29, the mint-source doctrine) added `source` + three
 * `origin_*` columns on `memories`. Version 3 was the box-2 chase
 * (`removal_tombstone`); version 2 was SEAMS items B + K (`gate_session` and
 * `events`).
 *
 * Migration is ADDITIVE and idempotent: the DDL below is `CREATE TABLE IF NOT
 * EXISTS`, and columns added after a table first shipped live in
 * `ADDED_COLUMNS`, applied by `ensureAddedColumns` — a `pragma table_info`
 * check, then `ALTER TABLE ADD COLUMN` for whatever is missing, inside the
 * same one-transaction migrate-at-open. A fresh open and a migrated open MUST
 * converge on the identical schema; a test asserts table_info equality.
 *
 * The v4 columns are all NULLABLE, deliberately: a pre-v4 row's provenance was
 * never recorded, and a DEFAULT would fabricate it (the one existing v3 store
 * is the replay evidence store, whose rows are almost all SWEPT — defaulting
 * them 'authored' would be a false claim in the very column that exists for
 * honest attribution). NULL renders as "unrecorded", by name.
 */
export const SCHEMA_VERSION = 5;
/**
 * The oldest schema an OBSERVER may open without a migration having run.
 *
 * An instrument writes nothing at open, so a store a schema behind normally
 * refuses under observer by name (`STORE_UNINITIALIZED`) rather than migrating
 * itself out from under the process that owns it. v5 is the exception that
 * earns a floor: its only change is the SPELLING of two path columns, and every
 * v5 reader resolves both spellings (`resolveStoredPath`). So a v4 store reads
 * correctly through a v5 observer, and refusing would have taken `status`,
 * `verify`, `backup` and the dashboard away from the owner between the merge
 * and the first writer open — the exact window in which `verify` is supposed
 * to show the unmigrated count. A store below the floor still refuses: v3 lacks
 * columns the readers select.
 */
export const OBSERVER_READ_FLOOR = 4;
/** The durable record the v5 path migration leaves in `events`. Counts only. */
export const PATHS_MIGRATED_EVENT = "store.migrate.paths";
/** Retention for superseded-version rows, in LIVED days. TUNABLE (module-map ruling 2). */
export const DEFAULT_RETENTION_DAYS = 90;

const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS memories (
     id                TEXT PRIMARY KEY,
     type              TEXT NOT NULL,
     kind              TEXT NOT NULL,
     band              TEXT NOT NULL,
     band_day          INTEGER NOT NULL,
     novelty           REAL,
     relevance         REAL NOT NULL,
     emotional         REAL NOT NULL,
     predictive        REAL NOT NULL,
     claimed           REAL,
     birth_day         INTEGER NOT NULL,
     uses              REAL NOT NULL DEFAULT 0,
     last_used_day     INTEGER NOT NULL,
     reinforced_days   INTEGER NOT NULL DEFAULT 0,
     consolidated      INTEGER NOT NULL DEFAULT 0,
     promoted_identity INTEGER NOT NULL DEFAULT 0,
     protected         INTEGER NOT NULL DEFAULT 0,
     pressure          REAL NOT NULL DEFAULT 0,
     last_challenged_day INTEGER,
     archived          INTEGER NOT NULL DEFAULT 0,
     archived_reason   TEXT,
     superseded_by     TEXT REFERENCES memories(id),
     revision          INTEGER NOT NULL DEFAULT 0,
     content_hash      TEXT NOT NULL,
     prose_path        TEXT NOT NULL,
     learned_on        TEXT NOT NULL,
     happened_on       TEXT,
     source            TEXT,
     origin_session    TEXT,
     origin_scope      TEXT,
     origin_ref        TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS memories_band ON memories (band, archived)`,
  `CREATE INDEX IF NOT EXISTS memories_kind ON memories (kind, archived)`,
  `CREATE TABLE IF NOT EXISTS versions (
     memory_id    TEXT NOT NULL REFERENCES memories(id),
     seq          INTEGER NOT NULL,
     reason       TEXT NOT NULL,
     version_day  INTEGER NOT NULL,
     archived_at  INTEGER NOT NULL,
     path         TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     successor_id TEXT REFERENCES memories(id),
     PRIMARY KEY (memory_id, seq)
   )`,
  `CREATE TABLE IF NOT EXISTS edges (
     src      TEXT NOT NULL REFERENCES memories(id),
     dst      TEXT NOT NULL REFERENCES memories(id),
     weight   REAL NOT NULL,
     last_day INTEGER NOT NULL,
     PRIMARY KEY (src, dst)
   )`,
  `CREATE TABLE IF NOT EXISTS prospective (
     memory_id      TEXT NOT NULL REFERENCES memories(id),
     window_key     TEXT NOT NULL,
     event_date     TEXT NOT NULL,
     precision      TEXT NOT NULL,
     state          TEXT NOT NULL,
     fires          INTEGER NOT NULL DEFAULT 0,
     last_fired_day INTEGER,
     PRIMARY KEY (memory_id, window_key)
   )`,
  // SEAMS item B — per-session gate state, ONE ROW PER RECORD.
  //
  // It replaces `recall/`'s `meta` row at `recall.gate.<sessionId>`, which was a
  // JSON document read-modify-written by two writers (a turn's `recall()` and a
  // late `resolveUse()` from the boundary, in different processes) — scar §2.1's
  // exact shape, arriving inside a transactional database because the transaction
  // was around the wrong span. A row per record means a late writer inserts ITS
  // record and can no longer drop anybody else's.
  //
  // `kind` is open on purpose: `surfaced` and `credited` are recall's, `window` is
  // where prospective's offered-window keys land (prospective/INTERFACE-GAPS.md §3
  // — brake 3 of four, currently in-process), and `scalar` carries the row-level
  // fields (turn counter, refractory, carried cues) that are not per-memory.
  `CREATE TABLE IF NOT EXISTS gate_session (
     session_id TEXT NOT NULL,
     kind       TEXT NOT NULL,
     ref        TEXT NOT NULL,
     turn       INTEGER NOT NULL,
     tier       TEXT,
     trains     INTEGER,
     value      TEXT,
     last_day   INTEGER NOT NULL,
     PRIMARY KEY (session_id, kind, ref)
   )`,
  `CREATE INDEX IF NOT EXISTS gate_session_day ON gate_session (last_day)`,
  // SEAMS item K — the durable event log.
  //
  // `schemas/`'s revision story kept its pressure increments in an in-memory ring:
  // the pressure number survived a restart and the story of how it got there did
  // not (schemas/INTERFACE-GAPS.md §1), and constitution line 16 says the owner
  // can see what changed and why. `sleep/`'s prune/promotion/merge records have the
  // same shape (sleep/INTERFACE-GAPS.md §3).
  //
  // `dedup_key` is what reconciles an APPEND-ONLY log with sleep's §5 G3 replay
  // idempotence: a record that must land at most once ever carries one, and the
  // partial unique index makes the second append a no-op. Telemetry passes null
  // (SQLite treats NULLs as distinct), so ordinary increments still accumulate.
  //
  // Payload is content-BY-REFERENCE: ids, hashes, counts, scores. Never body text.
  // memory_id/ref is deliberately NOT a foreign key — a record outlives its row.
  `CREATE TABLE IF NOT EXISTS events (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     at        INTEGER NOT NULL,
     day       INTEGER NOT NULL,
     name      TEXT NOT NULL,
     ref       TEXT,
     dedup_key TEXT,
     payload   TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS events_dedup ON events (dedup_key) WHERE dedup_key IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS events_name ON events (name, ref)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events (day)`,
  // The removal record. Append-only, canonical, and deliberately carries NO body and
  // NO content hash (§16 G9: hashing low-entropy content would leak what was removed).
  // memory_id is deliberately NOT a foreign key — the record must outlive the row.
  `CREATE TABLE IF NOT EXISTS removal_record (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     memory_id TEXT NOT NULL,
     stage     TEXT NOT NULL,
     at        INTEGER NOT NULL,
     actor     TEXT NOT NULL,
     reason    TEXT
   )`,
  // What the chase leaves behind: the skeleton of a removed memory, so that
  // "everything permanent is enumerable and inspectable" survives the one
  // operation that ends permanence (scar §2.19 from the other side — a removed
  // protected element must show as `[removed]`, never vanish from the list).
  //
  // Same content rule as the record itself (§16 G9): ids, flags, counts and a
  // timestamp. NO title, NO body, NO content hash — a hash of low-entropy
  // content is brute-forceable, which would make the tombstone a leak of the
  // thing it marks. `superseded_by` is kept because an id is an address, not
  // content, and a successor's lineage must not dangle.
  //
  // Deliberately NOT foreign-keyed: the tombstone outlives the row it describes.
  `CREATE TABLE IF NOT EXISTS removal_tombstone (
     memory_id         TEXT PRIMARY KEY,
     type              TEXT NOT NULL,
     kind              TEXT NOT NULL,
     band              TEXT NOT NULL,
     protected         INTEGER NOT NULL,
     promoted_identity INTEGER NOT NULL,
     superseded_by     TEXT,
     versions          INTEGER NOT NULL,
     edges             INTEGER NOT NULL,
     prospective       INTEGER NOT NULL,
     gate_rows         INTEGER NOT NULL,
     at                INTEGER NOT NULL
   )`,
];

export interface MemoryRow extends Row {
  id: string;
  type: ProseType;
  kind: Kind;
  band: Band;
  band_day: number;
  novelty: number | null;
  relevance: number;
  emotional: number;
  predictive: number;
  claimed: number | null;
  birth_day: number;
  uses: number;
  last_used_day: number;
  reinforced_days: number;
  consolidated: number;
  promoted_identity: number;
  protected: number;
  pressure: number;
  last_challenged_day: number | null;
  archived: number;
  archived_reason: string | null;
  superseded_by: string | null;
  revision: number;
  content_hash: string;
  prose_path: string;
  learned_on: string;
  happened_on: string | null;
  /** Who minted this memory (engine-set at the seam; mint.ts `ClaimChannel`,
   *  plus "migrated" from the v1 importer). NULL = a pre-v4 row whose
   *  provenance was never recorded — rendered "unrecorded", never defaulted. */
  source: string | null;
  origin_session: string | null;
  origin_scope: string | null;
  /** The proposal / trace id this memory was minted from. Ids only, never text. */
  origin_ref: string | null;
}

export interface VersionRow extends Row {
  memory_id: string;
  seq: number;
  reason: string;
  version_day: number;
  archived_at: number;
  path: string;
  content_hash: string;
  successor_id: string | null;
}

export interface EdgeRow extends Row {
  src: string;
  dst: string;
  weight: number;
  last_day: number;
}

export interface ProspectiveRow extends Row {
  memory_id: string;
  window_key: string;
  event_date: string;
  precision: string;
  state: string;
  fires: number;
  last_fired_day: number | null;
}

export interface GateSessionRow extends Row {
  session_id: string;
  kind: string;
  ref: string;
  turn: number;
  tier: string | null;
  trains: number | null;
  value: string | null;
  last_day: number;
}

export interface EventRow extends Row {
  seq: number;
  at: number;
  day: number;
  name: string;
  ref: string | null;
  dedup_key: string | null;
  payload: string | null;
}

export interface RemovalRow extends Row {
  seq: number;
  memory_id: string;
  stage: string;
  at: number;
  actor: string;
  reason: string | null;
}

export interface TombstoneRow extends Row {
  memory_id: string;
  type: ProseType;
  kind: Kind;
  band: Band;
  protected: number;
  promoted_identity: number;
  superseded_by: string | null;
  versions: number;
  edges: number;
  prospective: number;
  gate_rows: number;
  at: number;
}

export interface OpenOperationalOptions {
  /**
   * May this open CREATE or MIGRATE the database? False for an instrument: an
   * observer that ran the DDL would be writing at open — which is both a
   * stand-down violation and, in the field, the reason `counterparts backup`
   * threw "database is locked" while a session held a write transaction
   * (live-verify 2026-08-25). Defaults to true.
   */
  readonly initialize?: boolean;
  /** Written once, at creation only. Ignored for an already-initialized store. */
  readonly retentionDays?: number;
  /** The provenance clock, for the migration's event row. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The schema version recorded in the file, or null if there is not one yet. */
function readSchemaVersion(db: Db): string | null {
  try {
    return db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'")?.value ?? null;
  } catch {
    return null; // no meta table: a fresh file
  }
}

/**
 * Open box 2, and write NOTHING when it is already current.
 *
 * The steady state is the common case — the same shape `openCache` uses — and it
 * matters more here, because a write at open takes SQLite's write lock, so a
 * read-only caller could be refused (or refuse someone else) purely by opening.
 */
export function openOperational(path: string, opts: OpenOperationalOptions = {}): Db {
  const db = openDb(path);
  const found = readSchemaVersion(db);
  if (found === String(SCHEMA_VERSION)) return db;
  // A store from a NEWER build must never be stamped backwards: v4 is the
  // first version doing column surgery, and "migrating" a future file would
  // mean rewriting state this build does not understand (PR-2 review nit).
  if (found !== null && Number.parseInt(found, 10) > SCHEMA_VERSION) {
    db.close();
    throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found });
  }
  if (opts.initialize === false) {
    // A store at or above the read floor is readable as it stands (see
    // OBSERVER_READ_FLOOR); the migration waits for a writer.
    if (found !== null && Number.parseInt(found, 10) >= OBSERVER_READ_FLOOR) return db;
    db.close();
    throw new StoreError("STORE_UNINITIALIZED", {
      path,
      expected: SCHEMA_VERSION,
      found: found ?? "none",
    });
  }
  db.transaction(() => {
    for (const sql of DDL) db.exec(sql);
    ensureAddedColumns(db);
    const put = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
    put.run("livedDay", "0");
    put.run("lastActiveDate", "");
    put.run("retentionDays", String(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
    // v5: the path columns. Runs on every migrating open, and is a no-op by its
    // own predicate on a store that already holds relative paths — so two
    // writers racing into this branch on the same v4 file cannot double-convert.
    const converted = relativizeStoredPaths(db, dirname(path));
    if (converted.prose.converted + converted.versions.converted > 0) {
      const day = Number.parseInt(
        db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'livedDay'")?.value ?? "0",
        10,
      );
      db.run(
        `INSERT INTO events (at, day, name, ref, dedup_key, payload) VALUES (?, ?, ?, NULL, NULL, ?)`,
        (opts.now ?? Date.now)(),
        Number.isFinite(day) ? day : 0,
        PATHS_MIGRATED_EVENT,
        JSON.stringify({ from: found ?? "none", to: SCHEMA_VERSION, ...converted }),
      );
    }
    // Last, and REPLACE not IGNORE: the version row is the latch the next open
    // reads, so it must be written only after the DDL it describes has run.
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
  });
  return db;
}

export interface PathsConverted {
  /** Rows whose path was absolute and is now store-relative. */
  readonly converted: number;
  /** Rows whose absolute path had no `prose/` or `versions/` segment: left as they were. */
  readonly unplaceable: number;
}

/**
 * The v5 data migration: every absolute `memories.prose_path` and
 * `versions.path` becomes store-relative (`paths.ts#relativizeStoredPath`).
 *
 * Only rows whose value is absolute are selected, so the rewrite is idempotent
 * by predicate and cheap in the steady state (a v5 store never enters this
 * branch at all — the version latch short-circuits `openOperational`). A row
 * that cannot be placed is LEFT, not blanked and not guessed: `verify` counts
 * it as "absolute (unmigrated)", and `resolveStoredPath` keeps reading it where
 * it always read it. Blank pointers (a chased row's) are untouched.
 *
 * Whether the file EXISTS at the new address is deliberately not consulted.
 * The absolute address is wrong for a copied store whatever is at it; the
 * relative one is the only address that can be right. Missing files are a
 * separate fact, and `Store.pathCensus()` reports them separately.
 */
export function relativizeStoredPaths(
  db: Db,
  dir: string,
): { prose: PathsConverted; versions: PathsConverted } {
  const prose = convertColumn(db, dir, "memories", "prose_path", "id");
  const versions = convertColumn(db, dir, "versions", "path", "rowid");
  return { prose, versions };
}

function convertColumn(
  db: Db,
  dir: string,
  table: string,
  column: string,
  key: string,
): PathsConverted {
  // `GLOB '/*'` is a POSIX absolute path; a Windows drive letter is covered by
  // the JS-side `isAbsolute` in `relativizeStoredPath`, so the SQL predicate is
  // widened to "not already relative": anything that does not start with
  // `prose/` or `versions/` and is not blank.
  const rows = db.all<{ k: string | number; p: string }>(
    `SELECT ${key} AS k, ${column} AS p FROM ${table}
      WHERE ${column} <> '' AND ${column} NOT GLOB 'prose/*' AND ${column} NOT GLOB 'versions/*'`,
  );
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
  let converted = 0;
  let unplaceable = 0;
  for (const row of rows) {
    const rel = relativizeStoredPath(dir, row.p);
    if (rel === null) {
      unplaceable += 1;
      continue;
    }
    if (rel !== row.p) {
      update.run(rel, row.k);
      converted += 1;
    }
  }
  return { converted, unplaceable };
}

/**
 * Columns added to a table AFTER it first shipped. `CREATE TABLE IF NOT EXISTS`
 * cannot grow an existing table, so a pre-existing store gains these here —
 * checked against `pragma table_info` and added one `ALTER TABLE` at a time,
 * inside the migrate-at-open transaction. Idempotent by construction, and a
 * fresh CREATE must list the same columns so both paths converge (a test
 * asserts table_info equality between a fresh open and a migrated one).
 */
const ADDED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  // v4 — the mint-source doctrine. Nullable on purpose (see SCHEMA_VERSION).
  { table: "memories", column: "source", ddl: "ALTER TABLE memories ADD COLUMN source TEXT" },
  { table: "memories", column: "origin_session", ddl: "ALTER TABLE memories ADD COLUMN origin_session TEXT" },
  { table: "memories", column: "origin_scope", ddl: "ALTER TABLE memories ADD COLUMN origin_scope TEXT" },
  { table: "memories", column: "origin_ref", ddl: "ALTER TABLE memories ADD COLUMN origin_ref TEXT" },
];

function ensureAddedColumns(db: Db): void {
  const byTable = new Map<string, Set<string>>();
  for (const spec of ADDED_COLUMNS) {
    let have = byTable.get(spec.table);
    if (have === undefined) {
      have = new Set(
        db.all<{ name: string }>(`PRAGMA table_info(${spec.table})`).map((r) => r.name),
      );
      byTable.set(spec.table, have);
    }
    if (!have.has(spec.column)) db.exec(spec.ddl);
  }
}

export function rowToSalience(row: MemoryRow): Salience {
  return {
    novelty: row.novelty,
    relevance: row.relevance,
    emotional: row.emotional,
    predictive: row.predictive,
    // The author's claimed FLOOR, kept beside the dimensions so `sal(m)` stays
    // reproducible from stored state alone (physics §5.1). Never defaulted.
    claimed: row.claimed,
  };
}

export function rowToPhysics(row: MemoryRow): MemoryPhysics {
  return {
    kind: row.kind,
    salience: rowToSalience(row),
    birthDay: row.birth_day,
    uses: row.uses,
    lastUsedDay: row.last_used_day,
    // Distinct lived days that credited a use — `uses` is a weighted sum and
    // cannot reconstruct it (physics §5.3/§5.5). Absent reads as 0.
    reinforcedDays: row.reinforced_days,
    consolidated: row.consolidated === 1,
    promotedIdentity: row.promoted_identity === 1,
    protected: row.protected === 1,
    pressure: row.pressure,
    lastChallengedDay: row.last_challenged_day,
  };
}
