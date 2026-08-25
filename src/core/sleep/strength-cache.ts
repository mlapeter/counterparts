/**
 * The RANKING CACHE — box 3, and only box 3.
 *
 * Strength is a PURE FUNCTION of stored state and the lived day
 * (`physics/` §5.4). Nothing here is truth: this file holds a materialized copy
 * of `strength(m, d)` and `band(m, d)` so a ranker does not have to recompute
 * the whole store per query. Delete it and nothing is lost but a re-materialize;
 * that is the definition of box 3.
 *
 * Two consequences the contract leans on:
 *
 *   - **A replayed day is a no-op BY CONSTRUCTION** (§4, owner rescope 1), not by
 *     a per-item stamp. Same state, same day ⇒ same number ⇒ the same row.
 *   - **Canonical state is untouched by decay.** No `uses`, no band column in
 *     box 2, no prose. A decay pass that mutated canonical state would be v1's
 *     materialize-decay churn, which v2 got as an open choice and declined.
 *
 * It is a SEPARATE FILE from `cache/cache.sqlite` on purpose: the store holds an
 * open connection to that one and takes `BEGIN IMMEDIATE` on it, and its
 * `resetCache()` drops only its own three tables. A foreign table inside it would
 * contend for write locks and survive a rebuild inconsistently. See
 * INTERFACE-GAPS.md §1 — the real fix is a ranking-cache writer on `Store`.
 *
 * Opening is LAZY. An eagerly-opened SQLite file is a created file, and an
 * observer cycle that creates a file has already failed the byte-compare it
 * exists to pass.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Band } from "../types.js";
import { openDb } from "../store/db.js";
import type { Db } from "../store/db.js";

export const STRENGTH_CACHE_FILE = "strength.sqlite";

export function strengthCachePath(dir: string): string {
  return join(dir, "cache", STRENGTH_CACHE_FILE);
}

export interface StrengthRow {
  id: string;
  strength: number;
  band: Band;
  day: number;
}

export interface StrengthCache {
  /** Never opens anything that is not already open — a miss is `undefined`. */
  readAll(): Map<string, StrengthRow>;
  write(rows: readonly StrengthRow[]): void;
  close(): void;
}

interface CacheRow {
  memory_id: string;
  strength: number;
  band: string;
  day: number;
}

const DDL = `CREATE TABLE IF NOT EXISTS ranking (
   memory_id TEXT PRIMARY KEY,
   strength  REAL NOT NULL,
   band      TEXT NOT NULL,
   day       INTEGER NOT NULL
 )`;

/**
 * The shipped implementation: one small SQLite file inside the cache directory,
 * opened on first use and closed with the cycle.
 */
export function sqliteStrengthCache(dir: string): StrengthCache {
  const path = strengthCachePath(dir);
  let db: Db | null = null;

  const open = (): Db => {
    if (db === null) {
      mkdirSync(dirname(path), { recursive: true });
      db = openDb(path);
      db.exec(DDL);
    }
    return db;
  };

  return {
    readAll(): Map<string, StrengthRow> {
      const rows = open().all<CacheRow>("SELECT * FROM ranking");
      const out = new Map<string, StrengthRow>();
      for (const r of rows) {
        out.set(r.memory_id, {
          id: r.memory_id,
          strength: r.strength,
          band: r.band as Band,
          day: r.day,
        });
      }
      return out;
    },
    write(rows: readonly StrengthRow[]): void {
      if (rows.length === 0) return;
      const d = open();
      d.transaction(() => {
        const st = d.prepare(
          "INSERT OR REPLACE INTO ranking (memory_id, strength, band, day) VALUES (?, ?, ?, ?)",
        );
        for (const r of rows) st.run(r.id, r.strength, r.band, r.day);
      });
    },
    close(): void {
      if (db !== null) {
        db.close();
        db = null;
      }
    },
  };
}

/** An injectable in-process cache — for probes, replay scoring, and tests. */
export function memoryStrengthCache(seed: readonly StrengthRow[] = []): StrengthCache & {
  rows: Map<string, StrengthRow>;
  writes: number;
} {
  const rows = new Map<string, StrengthRow>();
  for (const r of seed) rows.set(r.id, { ...r });
  const self = {
    rows,
    writes: 0,
    readAll: () => new Map(rows),
    write(batch: readonly StrengthRow[]): void {
      for (const r of batch) rows.set(r.id, { ...r });
      self.writes += batch.length;
    },
    close: () => {
      /* nothing to close */
    },
  };
  return self;
}
