/**
 * Lane 0 (2026-10-10), scale review C5: `db.ts` keeps prepared statements per
 * connection. What must hold: a kept statement survives the schema changing
 * under it (a cache reset drops and re-creates tables), a statement stopped
 * after one row holds no lock against another connection, and a flood of
 * one-off SQL (an `IN (…)` of every width) neither breaks nor grows the cache
 * without bound.
 *
 * Hermetic: a fresh temp dir per test, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../src/core/store/db.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-lane0-statements-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("a kept statement reads the re-created table after a DROP/CREATE", () => {
  const db = openDb(join(dir, "a.sqlite"));
  db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)");
  db.run("INSERT INTO t (v) VALUES ('one')");
  expect(db.all<{ v: string }>("SELECT v FROM t").map((r) => r.v)).toEqual(["one"]);
  db.exec("DROP TABLE t");
  db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT, w TEXT)");
  db.run("INSERT INTO t (v, w) VALUES ('two', 'x')");
  expect(db.all<{ v: string }>("SELECT v FROM t").map((r) => r.v)).toEqual(["two"]);
  db.close();
});

test("a statement stopped after its first row does not keep another connection from writing", () => {
  for (const wal of [false, true]) {
    const p = join(dir, `b-${String(wal)}.sqlite`);
    const a = openDb(p, { wal });
    a.exec("CREATE TABLE t (k INTEGER PRIMARY KEY, v TEXT)");
    for (let i = 0; i < 5; i += 1) a.run("INSERT INTO t (v) VALUES (?)", `v${String(i)}`);
    const b = openDb(p, { wal });
    a.get("SELECT v FROM t ORDER BY k");
    b.exec("PRAGMA busy_timeout = 50");
    b.transaction(() => b.run("INSERT INTO t (v) VALUES ('from b')"));
    expect(a.get<{ n: number }>("SELECT COUNT(*) AS n FROM t")?.n).toBe(6);
    a.close();
    b.close();
  }
});

test("a thousand one-off statements: every one answers", () => {
  const db = openDb(join(dir, "c.sqlite"));
  db.exec("CREATE TABLE t (k INTEGER PRIMARY KEY)");
  for (let i = 1; i <= 50; i += 1) db.run("INSERT INTO t (k) VALUES (?)", i);
  for (let w = 1; w <= 1000; w += 1) {
    const ks = Array.from({ length: (w % 50) + 1 }, (_, i) => i + 1);
    const sql = `SELECT COUNT(*) AS n FROM t WHERE k IN (${ks.map(() => "?").join(", ")}) AND ${String(w)} = ${String(w)}`;
    expect(db.get<{ n: number }>(sql, ...ks)?.n).toBe(ks.length);
  }
  db.close();
});

test("a table changed on this connection: a kept SELECT * reads the new columns, under their own names (review of #368)", () => {
  // Without emptying the cache, bun 1.3 answered the old columns after the
  // ALTER and the values under the wrong names after the rebuild; Node 22's
  // `all` threw "Cannot get name of column".
  type Row = Record<string, unknown>;
  const db = openDb(join(dir, "d.sqlite"));
  db.exec("CREATE TABLE m (a INTEGER, b TEXT)");
  db.run("INSERT INTO m (a, b) VALUES (1, 'bee')");
  expect(db.get<Row>("SELECT * FROM m")).toEqual({ a: 1, b: "bee" });
  db.exec("ALTER TABLE m ADD COLUMN c TEXT DEFAULT 'cee'");
  expect(db.get<Row>("SELECT * FROM m")).toEqual({ a: 1, b: "bee", c: "cee" });
  expect(db.all<Row>("SELECT * FROM m")).toEqual([{ a: 1, b: "bee", c: "cee" }]);
  // The column surgery a migration does: build, copy, drop, rename.
  db.exec("CREATE TABLE m_new (b TEXT, a INTEGER, c TEXT)");
  db.exec("INSERT INTO m_new SELECT b, a, c FROM m");
  db.exec("DROP TABLE m");
  db.exec("ALTER TABLE m_new RENAME TO m");
  expect(db.get<Row>("SELECT * FROM m")).toEqual({ b: "bee", a: 1, c: "cee" });
  // Through `run` too.
  db.run("ALTER TABLE m ADD COLUMN d INTEGER DEFAULT 4");
  expect(db.all<Row>("SELECT * FROM m")).toEqual([{ b: "bee", a: 1, c: "cee", d: 4 }]);
  db.close();
});
