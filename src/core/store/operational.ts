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
import { dirname, resolve } from "node:path";

import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import type { Db, Row } from "./db.js";
import { openDb } from "./db.js";
import { StoreError } from "./errors.js";
import { PRE_ROWS_READABLE_BY, defaultSnapshotsDir } from "./paths.js";
import { snapshotBeforeMigration } from "./pre-migration.js";
import type { ProseType } from "./prose.js";

/**
 * Bumped to 6 (2026-09-20, the floor): **the memory IS the row.** `title`,
 * `body`, `meta` and `confidential` are columns on `memories`; a version row
 * carries its own `title`/`body`/`meta` plus the two provenance dates; and
 * `memories.prose_path` and `versions.path` are GONE, because there are no
 * files for them to name. Markdown became an export (`render.ts`).
 *
 * **There is no migration from v5, and there must not be one.** A v5 store's
 * bodies are ~16,000 markdown files this build cannot see; adding `body` through
 * `ADDED_COLUMNS` would "migrate" the owner's live memory into a store with
 * every body NULL, every prose file orphaned, stamped v6 — and unreadable by the
 * old build too. So a pre-rows store is refused BY NAME, before any transaction
 * and before any directory is created, in `Store`'s constructor
 * (`STORE_PRE_ROWS`). The cut-over carries nothing: the owner starts blank
 * (ruling 6, 2026-09-18), and the old store stays on disk, byte-identical.
 *
 * Version 5 (2026-09-05, finding I22) made the two path columns store-relative;
 * both columns are gone with this bump and the conversion with them. Version 4
 * (2026-08-29, the mint-source doctrine) added `source` + three `origin_*`
 * columns on `memories`. Version 3 was the box-2 chase (`removal_tombstone`);
 * version 2 was SEAMS items B + K (`gate_session` and `events`).
 *
 * Migration is still ADDITIVE and idempotent for whatever comes after v6: the
 * DDL below is `CREATE TABLE IF NOT EXISTS`, and columns added after a table
 * first shipped live in `ADDED_COLUMNS`, applied by `ensureAddedColumns` — a
 * `pragma table_info` check, then `ALTER TABLE ADD COLUMN` for whatever is
 * missing, inside the same one-transaction migrate-at-open. A fresh open and a
 * migrated open MUST converge on the identical schema; a test asserts
 * table_info equality.
 */
export const SCHEMA_VERSION = 6;
/**
 * The oldest schema an OBSERVER may open without a migration having run.
 *
 * v5 earned a floor below itself because its only change was the SPELLING of
 * two path columns, which every v5 reader resolved both ways. v6 has no such
 * exemption and cannot have one: a v5 store keeps its words in files this build
 * has no code to read, so an instrument opening one would report an empty store
 * rather than an unreadable one. The floor is therefore the version itself, and
 * the refusal a reader actually meets is `STORE_PRE_ROWS`, which names the last
 * build that CAN read it (`floor/v5-last`) instead of asking for a migration
 * that does not exist.
 */
export const OBSERVER_READ_FLOOR = 6;
/** Retention for superseded-version rows, in LIVED days. TUNABLE (module-map ruling 2).
 *
 *  Owner ruling 1, 2026-09-18: the prune STAYS, at 90. It now deletes the words
 *  themselves rather than a note about a file — his steer was simple, elegant
 *  working-memory mechanics over keeping everything, and losing some history
 *  after a month or two is an acceptable price. Our own store sets it high for
 *  debugging. `store/NOTES.md` carries what changed underneath the number. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * THE TOMBSTONE SHAPE — what a chased row looks like once the owner-op seam has
 * blanked it (`owner-op-seam.ts#chaseRemoved`).
 *
 * It was "the pointers are blank" while the words were in a file; now the words
 * are the columns, so it is the columns that are blanked, and the pair is the
 * predicate: an empty body AND an empty content hash. Both halves matter. A row
 * whose body is empty while the hash still names words that were there is NOT a
 * tombstone — it is a row whose words went missing underneath the store, which
 * is the `MEMORY_BODY_MISSING` fault, and reading the two as one condition would
 * turn a disk event into a silent "the owner removed this".
 *
 * Spelled once, here, because three modules ask it: the store's own reads, the
 * console's removal read-back, and `schemas/index.ts`, whose skip is what keeps
 * a session starting after a removal (#139).
 */
export function rowTombstoned(row: Pick<MemoryRow, "body" | "content_hash">): boolean {
  return row.body === "" && row.content_hash === "";
}

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
     learned_on        TEXT NOT NULL,
     happened_on       TEXT,
     source            TEXT,
     origin_session    TEXT,
     origin_scope      TEXT,
     origin_ref        TEXT,
     -- v6: the memory itself. prose_path is gone; there is no file.
     title             TEXT,
     body              TEXT NOT NULL,
     -- The payload's meta, VERBATIM JSON. One column, not columns: 28 distinct
     -- keys are in use across src/ and tools/, the set is open, and contract §3's
     -- "unrecognized fields survive parse -> serialize untouched" (G6, v1's named
     -- incident) is satisfied for free by storing the text as given.
     meta              TEXT NOT NULL DEFAULT '{}',
     -- The one key promoted OUT of that JSON, because it is a GATE: a gate that
     -- must parse JSON on every read is a gate that will one day fail open
     -- (confidentialByMeta, the one truth table, computes it at every write).
     confidential      INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS memories_band ON memories (band, archived)`,
  `CREATE INDEX IF NOT EXISTS memories_kind ON memories (kind, archived)`,
  `CREATE TABLE IF NOT EXISTS versions (
     memory_id    TEXT NOT NULL REFERENCES memories(id),
     seq          INTEGER NOT NULL,
     reason       TEXT NOT NULL,
     version_day  INTEGER NOT NULL,
     archived_at  INTEGER NOT NULL,
     content_hash TEXT NOT NULL,
     successor_id TEXT REFERENCES memories(id),
     -- v6: the archived words themselves, where path used to name a file.
     title        TEXT,
     body         TEXT NOT NULL,
     meta         TEXT NOT NULL DEFAULT '{}',
     -- The two PROVENANCE dates as they stood in this version. Not in the floor
     -- plan; added because the code disagreed with it. revise({learnedOn}) is
     -- a change to canonical content and keeps its prior version like any other
     -- (see index.ts#revise), and with the dates taken from the LIVE row instead a
     -- corrected date would have silently rewritten every version behind it.
     learned_on   TEXT NOT NULL DEFAULT '',
     happened_on  TEXT,
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
  /** v6: the memory itself, and the two fields that travel with it. */
  title: string | null;
  body: string;
  /** `ProseDoc.meta` as verbatim JSON (G6). Parsed once, at the read seam. */
  meta: string;
  /** `confidentialByMeta(meta)` at the last write. A column, never re-derived
   *  per call site: the confidentiality class is a gate (CONTRACT §5 G13). */
  confidential: number;
}

export interface VersionRow extends Row {
  memory_id: string;
  seq: number;
  reason: string;
  version_day: number;
  archived_at: number;
  content_hash: string;
  successor_id: string | null;
  title: string | null;
  body: string;
  meta: string;
  learned_on: string;
  happened_on: string | null;
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
  /**
   * Where the copy taken before a migration goes. Absent ⇒ the default beside
   * the store (`defaultSnapshotsDir`); a store with neither refuses to migrate.
   */
  readonly snapshotsDir?: string;
  /** The clock that names the pre-migration copy. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Told once, after a migration committed, what was copied and where. */
  readonly onMigrated?: (note: MigrationNote) => void;
}

/** What the open did to the schema, for the caller's record. */
export interface MigrationNote {
  readonly from: string;
  readonly to: number;
  /** The pre-migration copy's name inside `dir`. */
  readonly snapshot: string;
  readonly dir: string;
}

/**
 * Does `memories` carry the column that holds a memory's words?
 *
 * The one question that tells a pre-rows database from a v6 one, whatever its
 * stamp says. A `PRAGMA` on an open handle; no rows read, nothing written.
 * A file with no `memories` table at all (a fresh one) answers false, which is
 * why the caller asks it only about a database that already has a version.
 */
function hasBodyColumn(db: Db): boolean {
  try {
    return db.all<{ name: string }>("PRAGMA table_info(memories)").some((c) => c.name === "body");
  } catch {
    return false;
  }
}

/**
 * Is the database at `path` a PRE-ROWS one wearing the current filename?
 *
 * The second lock's question, asked without a `Store` — for the two console
 * doors that open box 3 directly and so never meet `openOperational` at all
 * (`migrate-cache`, and `verify --rebuild`'s census). Review f5c measured both
 * running to completion on a v5 database renamed to `counterparts.sqlite`, and
 * `migrate-cache --apply` would rewrite and VACUUM ~17,000 documents' index in
 * a store this build has declared it cannot read.
 *
 * Opening it is safe HERE in a way it is not at the filename door: this file is
 * already named `counterparts.sqlite`, so it is not the owner's parked v5 store
 * with a `-wal` full of his words — that one is caught by name, before anything
 * opens. `wal: false`, one PRAGMA and one SELECT, closed immediately.
 *
 * False for a file that is not there, is not a database, or is a healthy v6 one.
 */
export function isPreRowsDatabase(path: string): boolean {
  let db;
  try {
    db = openDb(path, { wal: false });
    const found = readSchemaVersion(db);
    if (found === null) return false;
    const n = Number.parseInt(found, 10);
    return Number.isFinite(n) && n < SCHEMA_VERSION && !hasBodyColumn(db);
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* nothing to say about a handle that will not close */
    }
  }
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
  // A WRITER converts the file to WAL; an instrument reads the mode and leaves
  // it, for the same reason it does not run the DDL — changing the journal mode
  // takes the write lock (`db.ts#convertToWal`).
  const db = openDb(path, { wal: opts.initialize !== false });
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
  // ── THE SECOND LOCK, and it is a real one ──────────────────────────────────
  //
  // The filename door in `Store`'s constructor is the FIRST lock, and it is the
  // only one that ever fires on a store that still has its directory. This one
  // catches the store that walked past it: a v5 database wearing the v6 NAME.
  // `mv operational.sqlite counterparts.sqlite` is the first thing a person
  // tries, and with `prose/` and `versions/` moved aside too the constructor
  // sees nothing to refuse.
  //
  // Past here the old code did what it does for anything below SCHEMA_VERSION:
  // ran the DDL (`CREATE TABLE IF NOT EXISTS`, so the v5 `memories` table keeps
  // its shape and gains NO `body` column), ran `ensureAddedColumns` (a no-op,
  // the list is empty) — and then STAMPED the file v6. After that this build
  // reads no body and the old build refuses it `SCHEMA_AHEAD` for ever;
  // recovering it means hand-editing `meta` with sqlite3. Reviewer A measured
  // exactly that (`adversarial-review-f5a`, MAJOR-2), and it is the one outcome
  // this whole phase exists to prevent.
  //
  // **Keyed on the SHAPE, not on the version.** A bare `found < SCHEMA_VERSION`
  // would be wrong: a genuinely v6-shaped database whose stamp was lowered by
  // hand must still migrate forward, and three tests say so. What distinguishes
  // a pre-rows database is that `memories` has no `body` column — ask that.
  //
  // The WAL argument that put the FIRST lock on filenames does not apply here:
  // this build opened the file itself several statements ago.
  if (found !== null && Number.parseInt(found, 10) < SCHEMA_VERSION && !hasBodyColumn(db)) {
    db.close();
    throw new StoreError("STORE_PRE_ROWS", {
      path,
      found,
      expected: SCHEMA_VERSION,
      reason: "no-body-column",
      readableBy: PRE_ROWS_READABLE_BY,
    });
  }
  let note = null as MigrationNote | null;
  try {
    db.transaction(() => {
      // THE CLAIM. `transaction` is BEGIN IMMEDIATE, so this connection now holds
      // the write lock; the version is read again under it. Of several processes
      // opening an old store at once, the first through here copies and
      // migrates, and the rest find it current and do neither.
      const now = readSchemaVersion(db);
      if (now === String(SCHEMA_VERSION)) return;
      if (now !== null && Number.parseInt(now, 10) > SCHEMA_VERSION) {
        throw new StoreError("SCHEMA_AHEAD", { path, expected: SCHEMA_VERSION, found: now });
      }
      // A store with a version is about to change shape: copy it first. A
      // fresh file (no version) has nothing to lose. VACUUM INTO runs on its
      // own connection, which may read while this one holds the lock, and
      // sees the store as it stands before the DDL below.
      if (now !== null) note = copyBeforeMigrating(path, now, opts);
      for (const sql of DDL) db.exec(sql);
      ensureAddedColumns(db);
      const put = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)");
      put.run("livedDay", "0");
      put.run("lastActiveDate", "");
      put.run("retentionDays", String(opts.retentionDays ?? DEFAULT_RETENTION_DAYS));
      // Last, and REPLACE not IGNORE: the version row is the latch the next open
      // reads, so it must be written only after the DDL it describes has run.
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
    });
  } catch (err) {
    db.close();
    throw err;
  }
  if (note !== null) opts.onMigrated?.(note);
  return db;
}

/**
 * The copy before a migration, or the refusal that stops it. Throws
 * `MIGRATION_SNAPSHOT_FAILED` inside the transaction, which rolls back: the
 * store stays on `found` and the build that wrote it still opens it.
 */
function copyBeforeMigrating(path: string, found: string, opts: OpenOperationalOptions): MigrationNote {
  const configured = opts.snapshotsDir !== undefined && opts.snapshotsDir.trim().length > 0;
  const dir = configured ? resolve(opts.snapshotsDir as string) : defaultSnapshotsDir(dirname(path));
  try {
    const snapshot = snapshotBeforeMigration({
      dbPath: path,
      dir,
      from: found,
      to: SCHEMA_VERSION,
      now: (opts.now ?? Date.now)(),
    });
    return { from: found, to: SCHEMA_VERSION, snapshot, dir: dir as string };
  } catch (err) {
    const reason = String((err as Error).message ?? err);
    throw new StoreError("MIGRATION_SNAPSHOT_FAILED", {
      path,
      found,
      expected: SCHEMA_VERSION,
      dir,
      reason,
      remedy:
        `This store is on schema v${found} and this build needs v${SCHEMA_VERSION}, but a copy of it could not ` +
        `be saved first (${reason}), so nothing was changed and the previous build still opens it; ` +
        `fix that and open it again.`,
    });
  }
}

/**
 * Columns added to a table AFTER it first shipped. `CREATE TABLE IF NOT EXISTS`
 * cannot grow an existing table, so a pre-existing store gains these here —
 * checked against `pragma table_info` and added one `ALTER TABLE` at a time,
 * inside the migrate-at-open transaction. Idempotent by construction, and a
 * fresh CREATE must list the same columns so both paths converge (a test
 * asserts table_info equality between a fresh open and a migrated one).
 */
export const ADDED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  // EMPTY at v6, and that is the floor's safety rule rather than an accident.
  //
  // A pre-v6 store is refused by name before anything opens it, so nothing here
  // can reach one — and the v6 columns must NOT be listed: `body` added through
  // this path to a v5 store would be NULL on every row while the words sat in
  // files this build cannot see, and the store would be stamped v6 and
  // unreadable by the build that can (`SCHEMA_VERSION` above, `STORE_PRE_ROWS`).
  //
  // The mechanism stays for whatever v7 adds additively to a v6 store.
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
