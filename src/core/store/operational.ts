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
import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import type { Db, Row } from "./db.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
import type { ProseType } from "./prose.js";

/**
 * Bumped to 3 (2026-08-25, the box-2 chase): `removal_tombstone`.
 * Version 2 was SEAMS items B + K (`gate_session` and `events`).
 * No live store exists yet, so the FRESH-OPEN path is the only migration — the
 * DDL below is `CREATE TABLE IF NOT EXISTS` and nothing rewrites an older file.
 * Every bump so far ADDS a table, so an older file gains the table on open and
 * loses nothing.
 */
export const SCHEMA_VERSION = 3;
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
     happened_on       TEXT
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
  if (readSchemaVersion(db) === String(SCHEMA_VERSION)) return db;
  if (opts.initialize === false) {
    db.close();
    throw new StoreError("STORE_UNINITIALIZED", { path, expected: SCHEMA_VERSION });
  }
  db.transaction(() => {
    for (const sql of DDL) db.exec(sql);
    const put = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
    put.run("livedDay", "0");
    put.run("lastActiveDate", "");
    put.run("retentionDays", String(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
    // Last, and REPLACE not IGNORE: the version row is the latch the next open
    // reads, so it must be written only after the DDL it describes has run.
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
  });
  return db;
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
