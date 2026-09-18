/**
 * `adapters/snapshots.ts` — the daily rotating copy, against real temp stores.
 *
 * This is the only mechanism in the package that DELETES a copy of the owner's
 * memory, so most of this file is about refusals rather than about features. The
 * two properties it exists to keep:
 *
 *   1. **Rotation deletes only what it can prove is a snapshot**, and refuses
 *      outright when the directory it was pointed at is the store, contains the
 *      store, is a filesystem root or is the home directory. It never follows a
 *      symlink out, never touches the copy just taken, never rotates after a
 *      copy that failed, and reads a broken `keep` as the default rather than as
 *      "delete them all".
 *   2. **A half-copy is never a snapshot.** The copy lands under a `.partial-…`
 *      name and is renamed into place; an interrupted one is not counted toward
 *      `keep`, does not satisfy "today's exists", and is swept once it is old
 *      enough that no live run could be writing it.
 *
 * Hermetic by construction (CLAUDE.md): a fresh temp root per test, removed in
 * `afterEach`, the store nested one level down exactly as `~/.counterparts/store`
 * is, and the snapshots directory resolved from the data dir this test hands in
 * — never from `$HOME`, so nothing here can reach a real `~/.counterparts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  Counterpart,
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
} from "../src/core/counterpart.js";
import { openDb } from "../src/core/store/db.js";
import type { EventRow } from "../src/core/store/index.js";
import { loadConfig } from "../src/adapters/claude-code/config.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import {
  DEFAULT_KEEP,
  PARTIAL_PREFIX,
  PARTIAL_STALE_MS,
  SNAPSHOT_NAME_RE,
  assertRotatableDir,
  keepOf,
  resolveSnapshotsDir,
  rotate,
  runSnapshot,
  snapshotNamesIn,
  todaysSnapshot,
} from "../src/adapters/snapshots.js";

/** Midday UTC on that date — well clear of both day boundaries. */
function at(date: string, clock = "T12:00:00Z"): number {
  return Date.parse(`${date}${clock}`);
}

const TODAY = "2026-09-18";
const NOW = at(TODAY);

let root: string;
let dir: string;
let snapsDir: string;
const open: Counterpart[] = [];
/** Directories made read-only by a test, restored before the tree is removed. */
const chmodded: string[] = [];

beforeEach(() => {
  // REALPATHED: on macOS `$TMPDIR` is itself a symlink, and the guards below
  // compare real paths. A test working in the unresolved spelling would be
  // asserting against a difference the guards deliberately erase.
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-snap-")));
  // The store sits ONE LEVEL DOWN, exactly as `~/.counterparts/store` does: the
  // default snapshots directory is its sibling, and that only has a meaning
  // inside a base directory this package created.
  dir = join(root, "store");
  snapsDir = join(root, "snapshots");
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
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

/**
 * Make the copy FAIL, the way a full disk or a bad permission would: the
 * snapshots directory exists and is readable, so its contents are read and its
 * rotation is possible — but nothing new can be written into it, which is where
 * `snapshot()` lands its partial copy.
 */
function makeCopiesFail(where = snapsDir): void {
  mkdirSync(where, { recursive: true });
  chmodSync(where, 0o500);
  chmodded.push(where);
}

/** A real counterpart at `dir`, with one memory in it so a copy has substance. */
function counterpart(): Counterpart {
  const c = Counterpart.open({ dir, owner: true });
  open.push(c);
  return c;
}

function seeded(): Counterpart {
  const c = counterpart();
  c.store.put({
    type: "memory",
    kind: "fact",
    title: "Worth a copy",
    body: "The floor is being rebuilt, and a copy of it is kept beside it.",
  });
  return c;
}

/** An existing snapshot directory of that exact name, with a file in it. */
function fakeSnapshot(name: string, where = snapsDir): string {
  const path = join(where, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "operational.sqlite"), "not really a database");
  return path;
}

function rowsOf(c: Counterpart, name: string): EventRow[] {
  return c.store.eventLog({ name, limit: 100 });
}

function payload(row: EventRow | undefined): Record<string, unknown> {
  if (row === undefined || row.payload === null) return {};
  return JSON.parse(row.payload) as Record<string, unknown>;
}

// ── where the copies go ─────────────────────────────────────────────────────

describe("the snapshots directory", () => {
  test("defaults to a sibling of the store, never inside it", () => {
    const resolved = resolveSnapshotsDir(dir);
    expect(resolved.reason).toBe("beside-the-store");
    expect(resolved.dir).toBe(snapsDir);
    // The one thing that must never be true: the copies are not in the tree
    // being copied, which would both recurse and land an unclassified top-level
    // path the store refuses at every open.
    expect(resolved.dir?.startsWith(`${dir}/`)).toBe(false);
  });

  test("a store that is NOT the `store/` subdirectory gets no default at all", () => {
    // A store somebody pointed at an arbitrary directory has no base directory,
    // and helping ourselves to a sibling of it would write tens of megabytes
    // into a directory this package does not own.
    const resolved = resolveSnapshotsDir(join(root, "somewhere-else"));
    expect(resolved.reason).toBe("no-default-dir");
    expect(resolved.dir).toBe(null);
  });

  test("a configured dir wins, and is resolved", () => {
    const resolved = resolveSnapshotsDir(dir, join(root, "elsewhere", "..", "elsewhere"));
    expect(resolved.reason).toBe("configured");
    expect(resolved.dir).toBe(join(root, "elsewhere"));
  });
});

// ── danger 1: every refusal on the directory rotation deletes inside ────────

describe("the directory rotation deletes inside — every refusal", () => {
  test("refuses a directory inside the store", () => {
    expect(() => assertRotatableDir(dir, join(dir, "snapshots"))).toThrow(/inside the store/);
    // And with the v1 shape — a trailing slash and a relative segment.
    expect(() => assertRotatableDir(dir, join(dir, "prose", ".."))).toThrow(/inside the store/);
  });

  test("refuses a directory that CONTAINS the store", () => {
    expect(() => assertRotatableDir(dir, root)).toThrow(/contains the store/);
  });

  test("refuses a filesystem root", () => {
    expect(() => assertRotatableDir(dir, "/")).toThrow(/filesystem root/);
  });

  test("refuses the home directory itself", () => {
    expect(() => assertRotatableDir(dir, homedir())).toThrow(/home directory/);
  });

  test("refuses v1's live stores, through the store's own guard", () => {
    expect(() => assertRotatableDir(dir, join(homedir(), ".bansai", "snapshots"))).toThrow();
  });

  test("a SYMLINK is judged by its target, not by its name", () => {
    // The legitimate case: a link to somewhere else entirely still works.
    const volume = join(root, "volume");
    mkdirSync(volume, { recursive: true });
    const link = join(root, "linked-snapshots");
    symlinkSync(volume, link);
    expect(assertRotatableDir(dir, link)).toBe(realpathSync(volume));

    // The dangerous case: a link pointing back into the store passes a string
    // comparison and must not pass this one. `resolve` does not follow links;
    // `realpath` does, which is the whole reason it is there.
    mkdirSync(join(dir, "prose"), { recursive: true });
    const trap = join(root, "trap");
    symlinkSync(join(dir, "prose"), trap);
    expect(() => assertRotatableDir(dir, trap)).toThrow(/inside the store/);
  });

  test("a directory that does not exist yet is allowed — a fresh install has none", () => {
    expect(assertRotatableDir(dir, snapsDir)).toBe(snapsDir);
    expect(existsSync(snapsDir)).toBe(false);
  });
});

// ── danger 1: what rotation is willing to delete ────────────────────────────

describe("rotation deletes only what it can prove is a snapshot", () => {
  test("keeps the newest N and reports every deletion, oldest first", () => {
    mkdirSync(snapsDir, { recursive: true });
    const names = [
      "2026-09-10T12-00-00-000Z",
      "2026-09-11T12-00-00-000Z",
      "2026-09-12T12-00-00-000Z",
      "2026-09-13T12-00-00-000Z",
      "2026-09-14T12-00-00-000Z",
    ];
    for (const n of names) fakeSnapshot(n);
    const errors: string[] = [];
    const report = rotate(snapsDir, 3, null, 0, errors);
    expect(report.deleted).toEqual([names[0] as string, names[1] as string]);
    expect(report.kept).toBe(3);
    expect(report.oldest).toBe(names[2] as string);
    expect(errors).toEqual([]);
    expect(readdirSync(snapsDir).sort()).toEqual(names.slice(2));
  });

  test("never deletes the snapshot just taken, even when it is over the limit", () => {
    mkdirSync(snapsDir, { recursive: true });
    fakeSnapshot("2026-09-10T12-00-00-000Z");
    const justTaken = "2026-09-11T12-00-00-000Z";
    fakeSnapshot(justTaken);
    // A `keep` of 1 with two snapshots would delete the older one; naming the
    // newest as just-taken and asking for zero-from-the-top is the belt-and
    // -braces case: it is excluded by NAME, not by its position in the sort.
    const report = rotate(snapsDir, 1, "2026-09-10T12-00-00-000Z", 0, []);
    expect(report.deleted).toEqual([]);
    expect(existsSync(join(snapsDir, "2026-09-10T12-00-00-000Z"))).toBe(true);
    expect(existsSync(join(snapsDir, justTaken))).toBe(true);
  });

  test("a broken `keep` falls back to the default rather than deleting everything", () => {
    expect(keepOf(0)).toBe(DEFAULT_KEEP);
    expect(keepOf(-5)).toBe(DEFAULT_KEEP);
    expect(keepOf(Number.NaN)).toBe(DEFAULT_KEEP);
    expect(keepOf(1.5)).toBe(DEFAULT_KEEP);
    expect(keepOf(undefined)).toBe(DEFAULT_KEEP);
    expect(keepOf(3)).toBe(3);

    mkdirSync(snapsDir, { recursive: true });
    for (let i = 10; i < 14; i += 1) fakeSnapshot(`2026-09-${String(i)}T12-00-00-000Z`);
    // The whole point: zero must not mean zero.
    const report = rotate(snapsDir, 0, null, 0, []);
    expect(report.deleted).toEqual([]);
    expect(readdirSync(snapsDir).length).toBe(4);
  });

  test("anything that is not a snapshot by NAME is invisible to rotation", () => {
    mkdirSync(snapsDir, { recursive: true });
    for (let i = 10; i < 14; i += 1) fakeSnapshot(`2026-09-${String(i)}T12-00-00-000Z`);
    // A person's own directory, a loose file, a partial copy, and a plausible
    // but wrong name. None of the four may be deleted, and none may be counted.
    mkdirSync(join(snapsDir, "keep-this-forever"), { recursive: true });
    writeFileSync(join(snapsDir, "README.md"), "mine");
    mkdirSync(join(snapsDir, `${PARTIAL_PREFIX}2026-09-14T12-00-00-000Z-9`), { recursive: true });
    mkdirSync(join(snapsDir, "2026-09-14"), { recursive: true });

    expect(snapshotNamesIn(snapsDir).length).toBe(4);
    const report = rotate(snapsDir, 1, null, 0, []);
    expect(report.deleted.length).toBe(3);
    expect(existsSync(join(snapsDir, "keep-this-forever"))).toBe(true);
    expect(existsSync(join(snapsDir, "README.md"))).toBe(true);
    expect(existsSync(join(snapsDir, "2026-09-14"))).toBe(true);
    expect(existsSync(join(snapsDir, `${PARTIAL_PREFIX}2026-09-14T12-00-00-000Z-9`))).toBe(true);
  });

  test("a SYMLINK inside the directory is never followed out", () => {
    mkdirSync(snapsDir, { recursive: true });
    const precious = join(root, "precious");
    mkdirSync(precious, { recursive: true });
    writeFileSync(join(precious, "irreplaceable.txt"), "everything");
    // A link WEARING a snapshot's name — the shape that would let rotation walk
    // out of this directory and delete somebody else's tree.
    symlinkSync(precious, join(snapsDir, "2026-09-01T12-00-00-000Z"));
    fakeSnapshot("2026-09-11T12-00-00-000Z");
    fakeSnapshot("2026-09-12T12-00-00-000Z");

    expect(snapshotNamesIn(snapsDir)).toEqual([
      "2026-09-11T12-00-00-000Z",
      "2026-09-12T12-00-00-000Z",
    ]);
    const report = rotate(snapsDir, 1, null, 0, []);
    expect(report.deleted).toEqual(["2026-09-11T12-00-00-000Z"]);
    expect(existsSync(join(precious, "irreplaceable.txt"))).toBe(true);
  });

  test("the name pattern is exactly what `snapshotName` writes", () => {
    expect(SNAPSHOT_NAME_RE.test("2026-09-18T12-00-00-000Z")).toBe(true);
    expect(SNAPSHOT_NAME_RE.test("2026-09-18")).toBe(false);
    expect(SNAPSHOT_NAME_RE.test("../../etc")).toBe(false);
    expect(SNAPSHOT_NAME_RE.test(`${PARTIAL_PREFIX}2026-09-18T12-00-00-000Z-7`)).toBe(false);
  });
});

// ── the run ─────────────────────────────────────────────────────────────────

describe("one run", () => {
  test("takes a copy, records it, and the copy holds the memory", () => {
    const c = seeded();
    const id = c.store.list({ archived: false })[0] as string;
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });

    expect(report.reason).toBe("taken");
    expect(report.name).toBe("2026-09-18T12-00-00-000Z");
    expect(report.errors).toEqual([]);
    expect(report.files).toBeGreaterThan(0);

    // The copy is a real store, and the memory is in it.
    const copy = openDb(join(snapsDir, report.name as string, "operational.sqlite"));
    expect(copy.get<{ id: string }>("SELECT id FROM memories WHERE id = ?", id)?.id).toBe(id);
    copy.close();

    // And the durable row says what happened — written AFTER the copy, so the
    // snapshot does not contain its own record.
    const taken = rowsOf(c, SNAPSHOT_TAKEN_EVENT);
    expect(taken.length).toBe(1);
    const p = payload(taken[0]);
    expect(p["date"]).toBe(TODAY);
    expect(p["name"]).toBe(report.name);
    expect(p["kept"]).toBe(1);
    expect(p["mirror"]).toBe("off");
    const inside = openDb(join(snapsDir, report.name as string, "operational.sqlite"));
    const seen = inside.all<{ name: string }>("SELECT name FROM events").map((r) => r.name);
    expect(seen).not.toContain(SNAPSHOT_TAKEN_EVENT);
    inside.close();
  });

  test("copies the WHOLE backup set, not just the database", () => {
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    const copied = join(snapsDir, report.reason === "taken" ? (report.name as string) : "");
    // Prose is canonical on today's floor; a database-only snapshot would be the
    // scar §2.11 incident again.
    expect(existsSync(join(copied, "prose"))).toBe(true);
    expect(existsSync(join(copied, "operational.sqlite"))).toBe(true);
    // Box 3 is classified as excluded and must NOT be there.
    expect(existsSync(join(copied, "cache"))).toBe(false);
  });

  test("a second run on the same UTC day is a no-op", () => {
    const c = seeded();
    const first = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(first.reason).toBe("taken");
    // Later the same UTC day, a different instant: still one copy, no new row.
    const second = runSnapshot({
      counterpart: c,
      dataDir: dir,
      now: at(TODAY, "T23:59:59Z"),
      date: TODAY,
    });
    expect(second.reason).toBe("already-today");
    expect(second.name).toBe(null);
    expect(snapshotNamesIn(snapsDir).length).toBe(1);
    // No second row: today's `snapshot.taken` IS the record, and a row per
    // boundary would be a flood rather than a fact.
    expect(rowsOf(c, SNAPSHOT_TAKEN_EVENT).length).toBe(1);

    // The NEXT day takes one.
    const next = runSnapshot({
      counterpart: c,
      dataDir: dir,
      now: at("2026-09-19"),
      date: "2026-09-19",
    });
    expect(next.reason).toBe("taken");
    expect(snapshotNamesIn(snapsDir).length).toBe(2);
  });

  test("rotation runs with the copy: fourteen deep, the fifteenth pushes one out", () => {
    const c = seeded();
    mkdirSync(snapsDir, { recursive: true });
    for (let i = 1; i <= DEFAULT_KEEP; i += 1) {
      fakeSnapshot(`2026-09-${String(i).padStart(2, "0")}T00-00-00-000Z`);
    }
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.reason).toBe("taken");
    expect(report.rotation?.deleted).toEqual(["2026-09-01T00-00-00-000Z"]);
    expect(report.rotation?.kept).toBe(DEFAULT_KEEP);
    expect(report.rotation?.oldest).toBe("2026-09-02T00-00-00-000Z");

    // Scar §2.4: the discard says WHAT went and HOW MANY are left.
    const rotated = payload(rowsOf(c, SNAPSHOT_ROTATED_EVENT)[0]);
    expect(rotated["deleted"]).toBe(1);
    expect(rotated["names"]).toEqual(["2026-09-01T00-00-00-000Z"]);
    expect(rotated["kept"]).toBe(DEFAULT_KEEP);
    expect(rotated["keep"]).toBe(DEFAULT_KEEP);
  });

  test("a run that deletes nothing writes no rotation row", () => {
    const c = seeded();
    runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    // A daily row saying "nothing was deleted" would make a store that has not
    // filled up yet read like a rotation that is working.
    expect(rowsOf(c, SNAPSHOT_ROTATED_EVENT).length).toBe(0);
  });

  test("a store outside the package's layout is skipped, silently and by name", () => {
    const elsewhere = join(root, "loose");
    const c = Counterpart.open({ dir: elsewhere, owner: true });
    open.push(c);
    const report = runSnapshot({ counterpart: c, dataDir: elsewhere, now: NOW, date: TODAY });
    expect(report.reason).toBe("no-default-dir");
    expect(report.dir).toBe(null);
    // No row: a configuration fact repeated at every boundary is a flood. Doctor
    // says it in words instead (`test/doctor.test.ts`).
    expect(rowsOf(c, SNAPSHOT_FAILED_EVENT).length).toBe(0);
    expect(existsSync(join(root, "snapshots"))).toBe(false);
  });

  test("a refused directory is one row per day, and no copy is attempted", () => {
    const c = seeded();
    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      config: { dir: join(dir, "inside") },
      now: NOW,
      date: TODAY,
    });
    expect(report.reason).toBe("refused");
    expect(report.errors[0]).toContain("inside the store");
    expect(existsSync(join(dir, "inside"))).toBe(false);

    const rows = rowsOf(c, SNAPSHOT_FAILED_EVENT);
    expect(rows.length).toBe(1);
    expect(payload(rows[0])["step"]).toBe("resolve");
    // Deduped per calendar date: a refused directory refuses identically at
    // every boundary and the count belongs nowhere.
    runSnapshot({ counterpart: c, dataDir: dir, config: { dir: join(dir, "inside") }, now: NOW, date: TODAY });
    expect(rowsOf(c, SNAPSHOT_FAILED_EVENT).length).toBe(1);
  });

  test("a failed copy leaves a row, leaves no partial behind, and ROTATES NOTHING", () => {
    const c = seeded();
    mkdirSync(snapsDir, { recursive: true });
    for (let i = 1; i <= 5; i += 1) fakeSnapshot(`2026-09-0${String(i)}T00-00-00-000Z`);
    makeCopiesFail();

    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      config: { keep: 2 },
      now: NOW,
      date: TODAY,
    });
    expect(report.reason).toBe("failed");
    expect(report.rotation?.deleted).toEqual([]);
    // THE POINT: losing the oldest good backup on the day no new one could be
    // made is the worst outcome available here, so rotation does not run at all.
    expect(snapshotNamesIn(snapsDir).length).toBe(5);
    // And the partial directory is gone — a half-copy is never left lying about.
    expect(readdirSync(snapsDir).filter((n) => n.startsWith(PARTIAL_PREFIX))).toEqual([]);

    const rows = rowsOf(c, SNAPSHOT_FAILED_EVENT);
    expect(rows.length).toBe(1);
    expect(payload(rows[0])["step"]).toBe("copy");
    expect(payload(rows[0])["date"]).toBe(TODAY);
  });

  test("a failing copy is retried a bounded number of times a day", () => {
    const c = seeded();
    makeCopiesFail();
    const run = (): string =>
      runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY }).reason;
    expect(run()).toBe("failed");
    expect(run()).toBe("failed");
    expect(run()).toBe("failed");
    // A copy of this store is tens of megabytes and the worker runs at every
    // boundary; a persistent failure must not pay that cost all day.
    expect(run()).toBe("attempts-exhausted");
    expect(rowsOf(c, SNAPSHOT_FAILED_EVENT).length).toBe(3);
  });

  test("an aborted watchdog stops the copy before it starts", () => {
    const c = seeded();
    const controller = new AbortController();
    controller.abort();
    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      now: NOW,
      date: TODAY,
      signal: controller.signal,
    });
    expect(report.reason).toBe("aborted");
    expect(snapshotNamesIn(snapsDir).length).toBe(0);
    expect(payload(rowsOf(c, SNAPSHOT_FAILED_EVENT)[0])["reason"]).toBe("aborted");
  });

  test("it never throws, whatever it is handed", () => {
    const c = seeded();
    // A directory that refuses, a keep that is nonsense, a mirror that cannot be.
    expect(() =>
      runSnapshot({
        counterpart: c,
        dataDir: dir,
        config: { dir: "/", keep: Number.NaN, mirror: homedir() },
        now: NOW,
        date: TODAY,
      }),
    ).not.toThrow();
  });
});

// ── danger 2: an interrupted copy is never a snapshot ───────────────────────

describe("a half-copy is never a snapshot", () => {
  test("an interrupted copy is not counted, does not satisfy today, and is swept", () => {
    const c = seeded();
    mkdirSync(snapsDir, { recursive: true });
    // Exactly what a worker killed mid-copy leaves: a partial directory wearing
    // today's instant, with a torn tree inside it.
    const abandoned = join(snapsDir, `${PARTIAL_PREFIX}2026-09-18T09-00-00-000Z-4242`);
    mkdirSync(join(abandoned, "prose"), { recursive: true });
    writeFileSync(join(abandoned, "operational.sqlite"), "half a database");

    // It is not a snapshot: not counted toward `keep`...
    expect(snapshotNamesIn(snapsDir)).toEqual([]);
    // ...and it does not satisfy "today's exists".
    expect(todaysSnapshot(snapsDir, TODAY)).toBe(null);

    // Aged past the window in which a live run could still be writing it.
    const old = (NOW - PARTIAL_STALE_MS - 60_000) / 1000;
    utimesSync(abandoned, old, old);

    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.reason).toBe("taken");
    expect(report.rotation?.cleaned).toBe(1);
    expect(existsSync(abandoned)).toBe(false);
    // The real copy landed, and it is the only snapshot there.
    expect(snapshotNamesIn(snapsDir)).toEqual(["2026-09-18T12-00-00-000Z"]);
  });

  test("a FRESH partial is left alone — it may be a concurrent run's", () => {
    const c = seeded();
    mkdirSync(snapsDir, { recursive: true });
    const live = join(snapsDir, `${PARTIAL_PREFIX}2026-09-18T11-59-00-000Z-99`);
    mkdirSync(live, { recursive: true });
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.rotation?.cleaned).toBe(0);
    // A sweep that deleted this would be the module destroying another run's
    // copy while it was being written.
    expect(existsSync(live)).toBe(true);
  });
});

// ── the mirror ──────────────────────────────────────────────────────────────

describe("the mirror", () => {
  test("receives the same copy and rotates on its own terms", () => {
    const c = seeded();
    const mirror = join(root, "mirror");
    mkdirSync(mirror, { recursive: true });
    for (let i = 1; i <= 3; i += 1) fakeSnapshot(`2026-09-0${String(i)}T00-00-00-000Z`, mirror);

    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      config: { mirror, keep: 2 },
      now: NOW,
      date: TODAY,
    });
    expect(report.reason).toBe("taken");
    expect(report.mirror?.ok).toBe(true);
    const name = report.name as string;
    expect(existsSync(join(mirror, name, "operational.sqlite"))).toBe(true);
    // Its own rotation: three old plus the new one, keeping two.
    expect(snapshotNamesIn(mirror)).toEqual(["2026-09-03T00-00-00-000Z", name]);
    // No partial left in the mirror either.
    expect(readdirSync(mirror).filter((n) => n.startsWith(PARTIAL_PREFIX))).toEqual([]);
    expect(payload(rowsOf(c, SNAPSHOT_TAKEN_EVENT)[0])["mirror"]).toBe("ok");
  });

  test("a mirror failure is reported and NEVER fatal", () => {
    const c = seeded();
    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      // A mirror that is the home directory: refused by the same guard the
      // primary directory passes.
      config: { mirror: homedir() },
      now: NOW,
      date: TODAY,
    });
    // The snapshot beside the store still landed. Losing the second copy is not
    // worth losing the first.
    expect(report.reason).toBe("taken");
    expect(report.mirror?.ok).toBe(false);
    expect(report.errors.some((e) => e.startsWith("mirror:"))).toBe(true);
    expect(snapshotNamesIn(snapsDir).length).toBe(1);
    expect(payload(rowsOf(c, SNAPSHOT_TAKEN_EVENT)[0])["mirror"]).toBe("failed");
  });
});

// ── the configuration key ───────────────────────────────────────────────────

describe("the `snapshots` configuration key", () => {
  test("parses, and an absent block is absent rather than defaulted", () => {
    const loaded = loadConfig({ dataDir: "/x/store", snapshots: { dir: "/s", keep: 7, mirror: "/m" } });
    expect(loaded.reason).toBe("loaded");
    expect(loaded.config.snapshots).toEqual({ dir: "/s", keep: 7, mirror: "/m" });
    expect(loadConfig({ dataDir: "/x/store" }).config.snapshots).toBeUndefined();
  });

  test("an unknown sub-key is ignored, the way `identity`'s are", () => {
    const loaded = loadConfig({ snapshots: { keep: 3, compress: true } });
    expect(loaded.reason).toBe("loaded");
    expect(loaded.config.snapshots).toEqual({ keep: 3 });
  });

  test("a sub-key of the wrong type stands the whole configuration down", () => {
    // The `dataDir` rule, for the same reason: a path this package will WRITE
    // INTO and ROTATE INSIDE is either a string the owner wrote or a
    // configuration we did not understand.
    for (const bad of [
      { snapshots: "yes" },
      { snapshots: [] },
      { snapshots: { dir: 7 } },
      { snapshots: { mirror: true } },
      { snapshots: { keep: "14" } },
      // A `keep` of zero would mean "delete every copy". It is a configuration
      // nobody can act on, not an instruction.
      { snapshots: { keep: 0 } },
      { snapshots: { keep: -1 } },
    ]) {
      const loaded = loadConfig(bad);
      expect(loaded.reason, JSON.stringify(bad)).toBe("unreadable");
      expect(loaded.config.observer).toBe(true);
    }
  });
});

// ── the worker ──────────────────────────────────────────────────────────────

describe("the worker's fourth step", () => {
  test("a failed copy leaves a row and the worker still reports a run", async () => {
    // A real store, minted the way the worker finds one.
    const c = seeded();
    c.close();
    open.length = 0;
    makeCopiesFail();

    const report = await runOnce({
      config: { dataDir: dir, owner: true },
      date: TODAY,
      env: {},
    });
    // The snapshot broke; the worker did not. Nothing about a failed copy may
    // reach the host, and the process exits 0 either way.
    expect(report.snapshot?.reason).toBe("failed");

    const after = counterpart();
    expect(rowsOf(after, SNAPSHOT_FAILED_EVENT).length).toBe(1);
  });

  test("a healthy boundary leaves a copy and a row", async () => {
    const c = seeded();
    c.close();
    open.length = 0;

    const report = await runOnce({
      config: { dataDir: dir, owner: true },
      date: TODAY,
      env: {},
    });
    expect(report.ran).toBe(true);
    expect(report.snapshot?.reason).toBe("taken");
    expect(snapshotNamesIn(snapsDir).length).toBe(1);

    const after = counterpart();
    expect(rowsOf(after, SNAPSHOT_TAKEN_EVENT).length).toBe(1);
  });

  test("an observer takes no copy at all", async () => {
    seeded().close();
    open.length = 0;
    const report = await runOnce({
      config: { dataDir: dir, observer: true },
      date: TODAY,
      env: {},
    });
    expect(report.reason).toBe("observer");
    expect(report.snapshot).toBe(null);
    // The instrument does not mutate what it measures — not even to back it up.
    expect(existsSync(snapsDir)).toBe(false);
  });
});
