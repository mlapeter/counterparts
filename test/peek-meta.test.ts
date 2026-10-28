/**
 * `store#peekMeta` (F1, review of #668): one meta value read from a database
 * this build may refuse, on its own connection. Never throws, creates
 * nothing, and never waits on a lock. Hermetic: every test works in a temp dir
 * it removes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { peekMeta } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cp-peek-meta-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function metaStore(path: string, wal: boolean): void {
  const db = openDb(path, { wal });
  try {
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", "self.wake.build", "0.3.39");
  } finally {
    db.close();
  }
}

describe("peekMeta", () => {
  test("a missing path, a corrupt file and a directory each give null, and no file is created", () => {
    const missing = join(root, "missing.sqlite");
    const corrupt = join(root, "corrupt.sqlite");
    const dir = join(root, "a-directory");
    writeFileSync(corrupt, "this is not a database, only some words in a file ".repeat(200));
    mkdirSync(dir);
    const before = readdirSync(root).sort();
    expect(peekMeta(missing, "self.wake.build")).toBeNull();
    expect(peekMeta(corrupt, "self.wake.build")).toBeNull();
    expect(peekMeta(dir, "self.wake.build")).toBeNull();
    expect(readdirSync(root).sort()).toEqual(before);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a store without the key gives null; with it, the value", () => {
    const path = join(root, "store.sqlite");
    metaStore(path, true);
    expect(peekMeta(path, "self.wake.build")).toBe("0.3.39");
    expect(peekMeta(path, "no.such.key")).toBeNull();
  });

  test("a WAL store with a live writer in BEGIN IMMEDIATE: read without blocking the writer's COMMIT", () => {
    const path = join(root, "store.sqlite");
    metaStore(path, true);
    const writer = openDb(path, { wal: true });
    try {
      writer.exec("BEGIN IMMEDIATE");
      writer.run("UPDATE meta SET value = ? WHERE key = ?", "0.3.40", "self.wake.build");
      const t0 = Date.now();
      // The committed value, at once: a WAL reader never waits on the writer.
      expect(peekMeta(path, "self.wake.build")).toBe("0.3.39");
      expect(Date.now() - t0).toBeLessThan(1_000);
      writer.exec("COMMIT");
    } finally {
      writer.close();
    }
    expect(peekMeta(path, "self.wake.build")).toBe("0.3.40");
  });

  test("a rollback-journal store held EXCLUSIVE: null at once, not after the five-second busy wait", () => {
    const path = join(root, "store.sqlite");
    metaStore(path, false);
    const holder = openDb(path, { wal: false });
    try {
      holder.exec("BEGIN EXCLUSIVE");
      const t0 = Date.now();
      expect(peekMeta(path, "self.wake.build")).toBeNull();
      expect(Date.now() - t0).toBeLessThan(1_000);
      holder.exec("COMMIT");
    } finally {
      holder.close();
    }
    expect(peekMeta(path, "self.wake.build")).toBe("0.3.39");
  });
});
