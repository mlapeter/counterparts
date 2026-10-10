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
