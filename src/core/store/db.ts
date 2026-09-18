/**
 * The runtime adapter: `bun:sqlite` under Bun, `node:sqlite` under Node.
 *
 * Deliberately the smallest interface the store needs — exec / prepare / run /
 * get / all / transaction / close. Both drivers accept positional `?` parameters
 * and return plain row objects, so only construction actually differs.
 *
 * Booleans and `undefined` are normalized here: node:sqlite rejects both, bun:sqlite
 * accepts them. Normalizing at the seam keeps the two runtimes behaviorally identical.
 */
import { createRequire } from "node:module";
import { StoreError } from "./errors.js";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParam = SqlValue | boolean | undefined;
export type Row = Record<string, SqlValue>;

export interface Statement {
  run(...params: SqlParam[]): void;
  get<T = Row>(...params: SqlParam[]): T | undefined;
  all<T = Row>(...params: SqlParam[]): T[];
}

export interface Db {
  readonly path: string;
  readonly driver: "bun:sqlite" | "node:sqlite";
  exec(sql: string): void;
  prepare(sql: string): Statement;
  run(sql: string, ...params: SqlParam[]): void;
  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined;
  all<T = Row>(sql: string, ...params: SqlParam[]): T[];
  /** BEGIN/COMMIT at depth 0, SAVEPOINT/RELEASE when nested. Throws ⇒ rolls back. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface RawStatement {
  run(...p: SqlValue[]): unknown;
  get(...p: SqlValue[]): unknown;
  all(...p: SqlValue[]): unknown;
}
interface RawDb {
  exec(sql: string): unknown;
  prepare(sql: string): RawStatement;
  close(): unknown;
}

const require_ = createRequire(import.meta.url);

export function runtimeIsBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function openRaw(path: string): { raw: RawDb; driver: Db["driver"] } {
  if (runtimeIsBun()) {
    try {
      const { Database } = require_("bun:sqlite") as {
        Database: new (p: string, o?: unknown) => RawDb;
      };
      return { raw: new Database(path, { create: true }), driver: "bun:sqlite" };
    } catch (cause) {
      throw new StoreError("SQLITE_UNAVAILABLE", {
        driver: "bun:sqlite",
        reason: String((cause as Error).message ?? cause),
      });
    }
  }
  try {
    const { DatabaseSync } = require_("node:sqlite") as {
      DatabaseSync: new (p: string, o?: unknown) => RawDb;
    };
    return { raw: new DatabaseSync(path), driver: "node:sqlite" };
  } catch (cause) {
    // node:sqlite landed in Node 22 (behind a flag) and is on by default from 23.4.
    // package.json declares engines.node >= 22; say so rather than failing vaguely.
    throw new StoreError("SQLITE_UNAVAILABLE", {
      driver: "node:sqlite",
      nodeVersionFloor: "22",
      running: process.versions.node,
      reason: String((cause as Error).message ?? cause),
    });
  }
}

function norm(params: SqlParam[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p;
  });
}

/**
 * How long a connection waits for someone else's write lock before giving up.
 * TUNABLE.
 *
 * Without it SQLite fails INSTANTLY with "database is locked", which is how a
 * live `counterparts backup` threw while a session held an open write
 * transaction (live-verify 2026-08-25) — and CLI CONTRACT §5 G8 says a backup
 * never throws. Brief contention between the console and a background worker is
 * normal and should WAIT; a lock held for five seconds is a real problem and
 * should still be reported rather than waited on forever.
 */
export const BUSY_TIMEOUT_MS = 5000;

export interface OpenDbOptions {
  /**
   * Convert the file to WAL when it is not already in it. A WRITER asks; nobody
   * else does.
   *
   * Reading the journal mode is free; CHANGING it is a write that takes the
   * database's exclusive lock. An opener that converted a file it had only come
   * to read would be writing at open — the observer's stand-down (contract §5),
   * and the shape of the lock incident I38. So the default is false, and it is
   * the default that matters: `vacuumInto` opens the SOURCE of a backup with
   * this, and `adapters/cli` opens box 3 read-only for a census.
   */
  readonly wal?: boolean;
}

/**
 * Put the file in WAL, and only if it is not there already.
 *
 * WAL because several processes hold this one small database open at once — the
 * session hooks, a long-running MCP server, the nightly worker, the dashboard —
 * and in WAL a reader no longer blocks the writer. Its permanent `-wal`/`-shm`
 * sidecars are classified: `LAYOUT`'s database entry matches by PREFIX (§5 G11),
 * which is why the reason NOTES §9 gave for DELETE no longer holds.
 *
 * THE READ COMES FIRST because the set is a write: on a store already in WAL —
 * every open after the first — this statement pair touches nothing.
 *
 * A CONTENDED conversion is not an error. The change needs the exclusive lock and
 * SQLite does not run the busy handler for it: with another connection inside a
 * write transaction it fails in about a millisecond (measured, bun:sqlite 1.3),
 * not after the five-second wait. The open then continues in whatever mode the
 * file is in and the next open tries again — a hook must not die because the
 * worker happened to be committing.
 *
 * ONLY the locked case is swallowed. This statement is also the first one that
 * reads the file's header, so "not a database" arrives here — and a caller that
 * opens a corrupt box 3 to count its vectors has to fail closed rather than be
 * handed a handle (`cli` verify --rebuild's guard).
 */
function convertToWal(db: Db): void {
  const current = db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode;
  if (current !== undefined && current.toLowerCase() === "wal") return;
  try {
    db.get("PRAGMA journal_mode = WAL");
  } catch (err) {
    if (!isLocked(err)) throw err;
    // Contended. The file keeps the mode it has, and this connection works in it.
  }
}

/** SQLITE_BUSY / SQLITE_LOCKED, under either driver's spelling of it. */
function isLocked(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))) {
    return true;
  }
  const message = String((err as Error)?.message ?? err);
  return message.includes("database is locked") || message.includes("database table is locked");
}

/**
 * The journal mode a database file is in, on its own connection — opened, read,
 * closed, converting nothing. What `counterparts verify` prints.
 */
export function journalModeOf(path: string): string {
  const db = openDb(path);
  try {
    return db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode ?? "unknown";
  } finally {
    db.close();
  }
}

export function openDb(path: string, opts: OpenDbOptions = {}): Db {
  const { raw, driver } = openRaw(path);
  let depth = 0;
  let savepointSeq = 0;

  const exec = (sql: string): void => {
    raw.exec(sql);
  };

  const prepare = (sql: string): Statement => {
    const st = raw.prepare(sql);
    return {
      run: (...p) => {
        st.run(...norm(p));
      },
      get: <T>(...p: SqlParam[]) => (st.get(...norm(p)) ?? undefined) as T | undefined,
      all: <T>(...p: SqlParam[]) => (st.all(...norm(p)) ?? []) as T[],
    };
  };

  const db: Db = {
    path,
    driver,
    exec,
    prepare,
    run: (sql, ...p) => prepare(sql).run(...p),
    get: <T>(sql: string, ...p: SqlParam[]) => prepare(sql).get<T>(...p),
    all: <T>(sql: string, ...p: SqlParam[]) => prepare(sql).all<T>(...p),
    transaction<T>(fn: () => T): T {
      const outer = depth === 0;
      const name = `cp_sp_${++savepointSeq}`;
      exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
      depth += 1;
      try {
        const result = fn();
        exec(outer ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (err) {
        try {
          if (outer) exec("ROLLBACK");
          else {
            exec(`ROLLBACK TO ${name}`);
            exec(`RELEASE ${name}`);
          }
        } catch {
          // A rollback that itself fails must not mask the original reason.
        }
        throw err;
      } finally {
        depth -= 1;
      }
    },
    close: () => {
      raw.close();
    },
  };

  // FIRST, before any other statement on this connection (finding I39): every
  // pragma below can contend for a lock, and without the timeout SQLite fails
  // them INSTANTLY. The journal-mode statement used to run here with zero wait,
  // inside another writer's commit window — which is where "database is locked"
  // came from. Set on every connection, including the short-lived one
  // `VACUUM INTO` opens for a backup (§5 G8, live-verify 2026-08-25).
  exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // Foreign keys are OFF by default in SQLite; referential integrity is enforced by
  // the store (contract §5 G4), so turn them on before anything is written.
  exec("PRAGMA foreign_keys = ON");
  if (opts.wal === true) convertToWal(db);
  // FULL, not WAL's usual NORMAL: that is a durability ruling for the owner to
  // make, not a cleanup to make on the way past. TUNABLE — the one knob here
  // that trades fsyncs for commit speed.
  exec("PRAGMA synchronous = FULL");
  return db;
}
