/**
 * The copy the store takes before a schema migration (`store/pre-migration.ts`,
 * `operational.ts#openOperational`), and how the daily rotation treats it.
 *
 * A migration is simulated the way the store's own tests do it: a store written
 * by this build has its stamp lowered by hand, so the next writer open runs the
 * whole migrate-at-open transaction over rows that are really there.
 *
 * Hermetic: a fresh temp root per test, the store one level down as
 * `~/.counterparts/store` is, removed in `afterEach`. Child processes get an
 * explicit `env` so the preload's temp home reaches them too.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRE_MIGRATION_NAME_RE,
  SCHEMA_VERSION,
  STORE_MIGRATED_EVENT,
  Store,
  isStoreError,
  paths,
  preMigrationName,
  preMigrationVersions,
} from "../src/core/store/index.js";
import { describeFault } from "../src/adapters/claude-code/standdown.js";
import {
  PRE_MIGRATION_KEEP_DAYS,
  expiredPreMigration,
  readSnapshotsDir,
  rotate,
} from "../src/adapters/snapshots.js";

const OLD = String(SCHEMA_VERSION - 1);
const NOW = Date.parse("2026-09-24T12:00:00Z");
const STORE_INDEX = fileURLToPath(new URL("../src/core/store/index.ts", import.meta.url));

let root: string;
let dir: string;
let snapsDir: string;
const open: Store[] = [];
const chmodded: string[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-premig-")));
  dir = join(root, "store");
  snapsDir = join(root, "snapshots");
});

afterEach(() => {
  for (const s of open.splice(0)) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  for (const path of chmodded.splice(0)) {
    try {
      chmodSync(path, 0o755);
    } catch {
      /* already gone */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function store(opts: Parameters<typeof Store.open>[0] = {}): Store {
  const s = Store.open({ dir, now: () => NOW, ...opts });
  open.push(s);
  return s;
}

/** A store written by this build, with rows in it, stamped one version back. */
function oldStore(): string[] {
  const s = Store.open({ dir });
  const ids = [
    s.put({ type: "memory", kind: "fact", title: "One", body: "Written before the upgrade." }),
    s.put({ type: "memory", kind: "fact", title: "Two", body: "Also written before it." }),
  ];
  s.close();
  const db = new Database(paths.operational(dir));
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", [OLD]);
  db.close();
  return ids;
}

function stampOf(path: string): string | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schemaVersion'").get()?.value;
  } finally {
    db.close();
  }
}

function countRows(path: string): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM memories").get()?.n ?? -1;
  } finally {
    db.close();
  }
}

function preMigrationCopies(where = snapsDir): string[] {
  if (!existsSync(where)) return [];
  return readdirSync(where).filter((n) => PRE_MIGRATION_NAME_RE.test(n));
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return isStoreError(err) ? err.code : `THREW ${String(err)}`;
  }
  return "NO_THROW";
}

describe("a copy before the schema changes", () => {
  test("an old store is copied, named from→to, and then migrated", () => {
    const ids = oldStore();
    const s = store();
    expect(s.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(s.migration).not.toBeNull();

    const copies = preMigrationCopies();
    expect(copies).toEqual([preMigrationName(NOW, OLD, SCHEMA_VERSION)]);
    expect(preMigrationVersions(copies[0] ?? "")).toEqual({ from: OLD, to: String(SCHEMA_VERSION) });
    expect(s.migration).toEqual({ from: OLD, to: SCHEMA_VERSION, snapshot: copies[0] ?? "", dir: snapsDir });

    // The copy holds the old version's stamp and the old version's rows.
    const copied = join(snapsDir, copies[0] ?? "", "counterparts.sqlite");
    expect(stampOf(copied)).toBe(OLD);
    expect(countRows(copied)).toBe(ids.length);

    // A durable record of it, naming the copy.
    const rows = s.eventLog({ name: STORE_MIGRATED_EVENT, limit: 10 });
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toEqual({
      from: OLD,
      to: SCHEMA_VERSION,
      snapshot: copies[0],
      dir: snapsDir,
    });
    // No partial left behind.
    expect(readdirSync(snapsDir).filter((n) => n.startsWith(".partial-"))).toEqual([]);
  });

  test("the copy is restorable: put back in place, it is the old store with its rows", () => {
    const ids = oldStore();
    store().close();
    open.length = 0;
    const [name] = preMigrationCopies();

    // Roll back the way NOTES says: the copy's database becomes the store's.
    const restored = join(root, "restored", "store");
    mkdirSync(restored, { recursive: true });
    writeFileSync(
      join(restored, "counterparts.sqlite"),
      readFileSync(join(snapsDir, name ?? "", "counterparts.sqlite")),
    );
    expect(stampOf(join(restored, "counterparts.sqlite"))).toBe(OLD);
    // And a build that opens it reads every memory in it (it migrates it
    // again on the way in, taking its own copy first).
    const back = Store.open({ dir: restored, now: () => NOW });
    open.push(back);
    for (const id of ids) expect(back.read(id).doc.body).toContain("before");
  });

  test("a fresh store takes no copy, and a current one takes none either", () => {
    store().close();
    open.length = 0;
    store().close();
    expect(existsSync(snapsDir)).toBe(false);
  });

  test("when the copy cannot be made, nothing migrates and the refusal says why and what to do", () => {
    const ids = oldStore();
    const before = readFileSync(paths.operational(dir));
    mkdirSync(snapsDir, { recursive: true });
    chmodSync(snapsDir, 0o500);
    chmodded.push(snapsDir);

    let caught: unknown;
    try {
      store();
    } catch (err) {
      caught = err;
    }
    expect(isStoreError(caught, "MIGRATION_SNAPSHOT_FAILED")).toBe(true);
    const detail = (caught as { detail: Record<string, unknown> }).detail;
    expect(detail["found"]).toBe(OLD);
    expect(detail["expected"]).toBe(SCHEMA_VERSION);
    expect(String(detail["remedy"])).toContain("nothing was changed");
    // The hook's sentence carries the reason, since doctor opens as an observer.
    const fault = describeFault(caught);
    expect(fault.code).toBe("MIGRATION_SNAPSHOT_FAILED");
    expect(fault.reason).toContain("could not be saved first");

    // The store is still on the old version, with its rows.
    expect(stampOf(paths.operational(dir))).toBe(OLD);
    expect(countRows(paths.operational(dir))).toBe(ids.length);
    expect(preMigrationCopies()).toEqual([]);
    // The main database file is byte-identical (a rolled-back BEGIN IMMEDIATE
    // writes nothing to it).
    expect(readFileSync(paths.operational(dir)).equals(before)).toBe(true);
  });

  test("a store outside <base>/store with no snapshots dir named refuses to migrate", () => {
    dir = join(root, "elsewhere");
    oldStore();
    expect(codeOf(() => store())).toBe("MIGRATION_SNAPSHOT_FAILED");
    expect(stampOf(paths.operational(dir))).toBe(OLD);
    // Naming one is the way out.
    const named = join(root, "my-snaps");
    const s = store({ snapshotsDir: named });
    expect(s.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(preMigrationCopies(named).length).toBe(1);
  });

  test("a snapshots dir inside the store is refused, and the store stays as it was", () => {
    oldStore();
    expect(codeOf(() => store({ snapshotsDir: join(dir, "cache", "snaps") }))).toBe("MIGRATION_SNAPSHOT_FAILED");
    expect(stampOf(paths.operational(dir))).toBe(OLD);
  });

  test("an observer open of an old store writes nothing and copies nothing", () => {
    oldStore();
    const before = readFileSync(paths.operational(dir));
    expect(codeOf(() => store({ observer: true }))).toBe("STORE_UNINITIALIZED");
    expect(readFileSync(paths.operational(dir)).equals(before)).toBe(true);
    expect(existsSync(snapsDir)).toBe(false);
  });
});

describe("several processes opening an old store at once", () => {
  test("one takes the copy and migrates; the rest find it current", async () => {
    oldStore();
    const script = join(root, "open.ts");
    writeFileSync(
      script,
      `import { Store } from ${JSON.stringify(STORE_INDEX)};\n` +
        `const s = Store.open({ dir: process.argv[2] });\n` +
        `console.log(JSON.stringify({ migrated: s.migration !== null, version: s.getMeta("schemaVersion") }));\n` +
        `s.close();\n`,
    );

    // Hold the write lock so every child reads the old stamp and then queues
    // on BEGIN IMMEDIATE: the claim is exercised, not left to timing.
    const holder = new Database(paths.operational(dir));
    holder.run("BEGIN IMMEDIATE");
    const children = [0, 1, 2].map(() =>
      Bun.spawn([process.execPath, script, dir], {
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    await Bun.sleep(1500);
    holder.run("ROLLBACK");
    holder.close();

    const results = await Promise.all(
      children.map(async (c) => {
        const code = await c.exited;
        const out = await new Response(c.stdout).text();
        const err = await new Response(c.stderr).text();
        return { code, out: out.trim(), err: err.trim() };
      }),
    );
    for (const r of results) expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: "" });
    const parsed = results.map((r) => JSON.parse(r.out) as { migrated: boolean; version: string });
    expect(parsed.filter((p) => p.migrated).length).toBe(1);
    for (const p of parsed) expect(p.version).toBe(String(SCHEMA_VERSION));

    expect(preMigrationCopies().length).toBe(1);
    const s = store();
    expect(s.eventLog({ name: STORE_MIGRATED_EVENT, limit: 10 }).length).toBe(1);
  }, 20_000);
});

describe("rotation keeps a pre-migration copy apart", () => {
  function copyAt(name: string): void {
    mkdirSync(join(snapsDir, name), { recursive: true });
    writeFileSync(join(snapsDir, name, "counterparts.sqlite"), "a copy");
  }
  function dailyOn(date: string): string {
    const name = `${date}T03-00-00-000Z`;
    copyAt(name);
    return name;
  }
  function daysBefore(n: number): string {
    return new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
  }

  test("it is not a daily copy: not counted toward keep, not deleted with them", () => {
    const pre = preMigrationName(NOW - 3 * 86_400_000, "6", 7);
    copyAt(pre);
    for (let d = 30; d >= 1; d--) dailyOn(daysBefore(d));
    const read = readSnapshotsDir(snapsDir);
    expect(read.preMigration).toEqual([pre]);
    expect(read.names).not.toContain(pre);

    const report = rotate(snapsDir, 14, null, 0, [], NOW);
    expect(report.kept).toBe(14);
    expect(report.deleted).not.toContain(pre);
    expect(report.preMigration).toEqual([pre]);
    expect(existsSync(join(snapsDir, pre))).toBe(true);
  });

  test(`it goes once it is ${PRE_MIGRATION_KEEP_DAYS} days old and keep newer daily copies exist`, () => {
    const pre = preMigrationName(NOW - 20 * 86_400_000, "6", 7);
    copyAt(pre);
    for (let d = 19; d >= 1; d--) dailyOn(daysBefore(d));
    const report = rotate(snapsDir, 14, null, 0, [], NOW);
    expect(report.deleted).toContain(pre);
    expect(report.preMigration).toEqual([]);
    expect(existsSync(join(snapsDir, pre))).toBe(false);
  });

  test("an old one stays while the daily copies behind it are too few", () => {
    const pre = preMigrationName(NOW - 40 * 86_400_000, "6", 7);
    copyAt(pre);
    for (let d = 5; d >= 1; d--) dailyOn(daysBefore(d));
    const report = rotate(snapsDir, 14, null, 0, [], NOW);
    expect(report.deleted).toEqual([]);
    expect(existsSync(join(snapsDir, pre))).toBe(true);
    expect(expiredPreMigration([pre], [], 14, NOW)).toEqual([]);
  });

  test("a pre-migration-named directory that is not a copy is never deleted", () => {
    const pre = preMigrationName(NOW - 40 * 86_400_000, "6", 7);
    mkdirSync(join(snapsDir, pre), { recursive: true });
    writeFileSync(join(snapsDir, pre, "mine.txt"), "not a store");
    for (let d = 20; d >= 1; d--) dailyOn(daysBefore(d));
    const report = rotate(snapsDir, 14, null, 0, [], NOW);
    expect(report.unrecognised).toContain(pre);
    expect(existsSync(join(snapsDir, pre))).toBe(true);
  });
});
