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

export function openDb(path: string): Db {
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

  // Foreign keys are OFF by default in SQLite; referential integrity is enforced by
  // the store (contract §5 G4), so turn them on before anything is written.
  exec("PRAGMA foreign_keys = ON");
  // Deliberately NOT WAL: WAL leaves -wal/-shm sidecars in the data dir, and every
  // top-level path must be classified (§5 G11). The prefix classifier covers the
  // transient -journal; WAL's permanent pair would be two more boxes to explain.
  exec("PRAGMA journal_mode = DELETE");
  exec("PRAGMA synchronous = FULL");
  // Wait for a contended lock instead of failing instantly (§5 G8, live-verify
  // 2026-08-25). Set on every connection, including the short-lived one
  // `VACUUM INTO` opens for a backup.
  exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return db;
}
