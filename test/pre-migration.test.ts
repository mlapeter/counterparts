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
  renameSync,
  rmSync,
  utimesSync,
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
import { doctorFindings, readCounterpartOpen } from "../src/adapters/claude-code/doctor.js";
import type { CheckoutReading } from "../src/adapters/claude-code/doctor.js";
import { openCounterpart, run, snapshotsDirBeside } from "../src/adapters/cli/commands.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { questionEmbedder } from "../src/adapters/mcp/bin/serve.js";
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
    expect(copies.length).toBe(1);
    expect(preMigrationVersions(copies[0] ?? "")).toEqual({ from: OLD, to: String(SCHEMA_VERSION) });
    expect(s.migration).toEqual({ from: OLD, to: SCHEMA_VERSION, snapshot: copies[0] ?? "", reused: false, dir: snapsDir });
    // Named by the wall clock, whatever clock the store was handed (NOW is fixed).
    expect(copies[0]?.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

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
      reused: false,
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
    // The reason leads, so the hook's 200-character cap trims the preamble.
    expect(fault.reason.startsWith(String(detail["reason"]))).toBe(true);
    expect(fault.reason).toContain("the store is unchanged");

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

describe("a migration that fails after its copy", () => {
  /** Makes the migration itself fail after the copy: the meta seeds raise. */
  function breakMigration(): void {
    const db = new Database(paths.operational(dir));
    db.run("CREATE TRIGGER boom BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'boom'); END");
    db.close();
  }

  test("repeated opens reuse the one copy instead of taking a new one each time", () => {
    oldStore();
    breakMigration();
    for (let i = 0; i < 4; i++) {
      expect(codeOf(() => store())).toContain("boom");
    }
    expect(preMigrationCopies().length).toBe(1);
    expect(stampOf(paths.operational(dir))).toBe(OLD);
  });

  test("an older copy is reused while the live store has not been written since it", () => {
    oldStore();
    breakMigration();
    codeOf(() => store());
    const [today] = preMigrationCopies();
    // Make it an older copy: renamed two days back, the live files older still.
    const older = `${new Date(Date.now() - 2 * 86_400_000).toISOString().replace(/[:.]/g, "-")}-pre-migration-v${OLD}-to-v${String(SCHEMA_VERSION)}`;
    renameSync(join(snapsDir, today ?? ""), join(snapsDir, older));
    const threeDaysAgo = (Date.now() - 3 * 86_400_000) / 1000;
    for (const f of [paths.operational(dir), `${paths.operational(dir)}-wal`]) {
      if (existsSync(f)) utimesSync(f, threeDaysAgo, threeDaysAgo);
    }
    codeOf(() => store());
    expect(preMigrationCopies()).toEqual([older]);

    // Once the live store is newer than that copy, a fresh one is taken.
    const now = Date.now() / 1000;
    utimesSync(paths.operational(dir), now, now);
    codeOf(() => store());
    expect(preMigrationCopies().length).toBe(2);
  });

  test("a successful open after a failed one reuses today's copy and says so", () => {
    oldStore();
    breakMigration();
    codeOf(() => store());
    const db = new Database(paths.operational(dir));
    db.run("DROP TRIGGER boom");
    db.close();
    const s = store();
    expect(s.getMeta("schemaVersion")).toBe(String(SCHEMA_VERSION));
    expect(s.migration?.reused).toBe(true);
    expect(preMigrationCopies().length).toBe(1);
  });
});

describe("doctor on a store behind this build", () => {
  const checkout: CheckoutReading = {
    reason: "master",
    root: "/repo",
    branch: "master",
    head: "abc1234",
    dirty: 0,
    behindBy: null,
    originMaster: "abc1234",
    atMaster: true,
    timedOut: false,
  };
  async function doctor(): Promise<{ code: number; said: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["doctor", `--dir=${dir}`], {
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
      // Armed, so `--dir` grades the store alone and the default config is not read.
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home: root,
      checkout,
    });
    return { code, said: [...out, ...err].join("\n") };
  }
  function lowerTo(stamp: string): void {
    const db = new Database(paths.operational(dir));
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schemaVersion', ?)", [stamp]);
    db.close();
  }

  test("a copy that can be made: amber, and the store is left as it was", async () => {
    oldStore();
    const before = readFileSync(paths.operational(dir));
    const { code, said } = await doctor();
    expect(code).toBe(0);
    expect(said).toContain(`is on schema v${OLD}; the next session copies it to ${snapsDir}`);
    expect(said).not.toContain("doctor failed");
    expect(readFileSync(paths.operational(dir)).equals(before)).toBe(true);
    // The probe removed what it made: no snapshots directory left behind.
    expect(existsSync(snapsDir)).toBe(false);
  });

  test("a copy that cannot be made: red, naming the refusal every hook will meet", async () => {
    oldStore();
    mkdirSync(snapsDir, { recursive: true });
    chmodSync(snapsDir, 0o500);
    chmodded.push(snapsDir);
    const { code, said } = await doctor();
    expect(code).toBe(1);
    expect(said).toContain("MIGRATION_SNAPSHOT_FAILED");
    expect(said).toContain("Store open");
    expect(said).not.toContain("doctor failed");
  });

  test("two versions back is a clear line, not a crash", async () => {
    oldStore();
    lowerTo(String(SCHEMA_VERSION - 2));
    const { code, said } = await doctor();
    expect(said).not.toContain("doctor failed");
    expect(code).toBe(0);
    expect(said).toContain(`is on schema v${String(SCHEMA_VERSION - 2)}`);
  });

  test("an observer that could read the old store is still graded on what a session meets", () => {
    oldStore();
    mkdirSync(snapsDir, { recursive: true });
    chmodSync(snapsDir, 0o500);
    chmodded.push(snapsDir);
    // As if the read floor admitted this store: the observer open succeeds.
    const reading = readCounterpartOpen(dir, () => ({ close: () => undefined }));
    expect(reading.ok).toBe(true);
    expect(reading.migration?.problem).not.toBeNull();
    const findings = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "not-read",
      config: {},
      dir,
      store: null,
      today: "2026-09-24",
      refusals: {},
      open: reading,
    });
    const open = findings.find((f) => f.key === "store-open");
    expect(open?.severity).toBe("red");
  });
});

describe("the MCP server and the console pass snapshots.dir", () => {
  test("openServer puts the copy in the directory it was given", () => {
    oldStore();
    const named = join(root, "configured-snaps");
    const server = openServer({ dir, snapshotsDir: named });
    server.counterpart.close();
    expect(preMigrationCopies(named).length).toBe(1);
    expect(existsSync(snapsDir)).toBe(false);
  });

  test("the server reads snapshots.dir from its configuration", () => {
    const configPath = join(root, "claude-code.json");
    const named = join(root, "configured-snaps");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, snapshots: { dir: named } }));
    expect(questionEmbedder(configPath).snapshotsDir).toBe(named);
  });

  test("the console reads snapshots.dir from the configuration beside the store", () => {
    oldStore();
    const named = join(root, "configured-snaps");
    writeFileSync(join(root, "claude-code.json"), JSON.stringify({ dataDir: dir, snapshots: { dir: named } }));
    expect(snapshotsDirBeside(dir)).toBe(named);
    openCounterpart(dir).close();
    expect(preMigrationCopies(named).length).toBe(1);
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
