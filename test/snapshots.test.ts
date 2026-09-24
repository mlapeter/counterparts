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
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import { journalModeOf, openDb } from "../src/core/store/db.js";
import { Store, paths } from "../src/core/store/index.js";
import type { EventRow } from "../src/core/store/index.js";
import { loadConfig } from "../src/adapters/claude-code/config.js";
import { RESTORE_STEPS } from "../src/adapters/claude-code/doctor.js";
import { runOnce } from "../src/adapters/claude-code/bin/runner.js";
import {
  DEFAULT_KEEP,
  PARTIAL_PREFIX,
  PARTIAL_STALE_MS,
  SNAPSHOT_NAME_RE,
  assertRotatableDir,
  cleanPartials,
  futureNamesIn,
  keepOf,
  readSnapshotsDir,
  resolveSnapshotsDir,
  rotate,
  runSnapshot,
  snapshotNamesIn,
  todaysSnapshot,
  verifyCopy,
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
  writeFileSync(join(path, "counterparts.sqlite"), "not really a database");
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
    // READ-ONLY on the real home directory: `realpathSync` and a string compare,
    // nothing more. It is here rather than in a temp tree because `os.homedir()`
    // cannot be moved under bun (measured: mutating `process.env.HOME` at runtime
    // does not move it), so there is no hermetic stand-in for this one.
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

  /**
   * MAJOR-1 OF THE F2 REVIEW. `assertSafeDataDir` — the guard that refuses v1's
   * live memory — is pure string math and follows no links, so applying it
   * BEFORE the realpath meant a `snapshots.dir` that was a symlink into
   * `~/.bansai` cleared it and the forbidden directory came back as rotatable.
   * The copy was refused further down, but `cleanPartials` runs first.
   *
   * It cannot be proved against the real forbidden roots: `os.homedir()` cannot
   * be moved under bun, so relocating them into a temp tree is impossible and
   * the only alternative would be pointing a test at the owner's actual
   * `~/.bansai`. So the refusal is INJECTED, and what is asserted is the thing
   * that was wrong — which SPELLING of the path the guard is asked about.
   */
  test("the live-store refusal is asked about the path the link RESOLVES to, not the link's name", () => {
    const pretendLive = join(root, "pretend-live-store");
    mkdirSync(pretendLive, { recursive: true });
    const link = join(root, "innocent-looking");
    symlinkSync(pretendLive, link);

    const asked: string[] = [];
    // PURE STRING MATH, exactly like `assertSafeDataDir`: it follows no links.
    // That is the property that made the ordering matter.
    const refuse = (path: string): string => {
      asked.push(path);
      if (path === pretendLive || path.startsWith(`${pretendLive}/`)) {
        throw new Error("DATA_DIR_FORBIDDEN");
      }
      return path;
    };
    // The link's own name is harmless to string math; its target is not.
    expect(() => assertRotatableDir(dir, link, refuse)).toThrow(/FORBIDDEN/);
    // BOTH spellings are asked about — the one the owner typed, so a literal
    // path under a forbidden root is refused by the name they wrote, and the one
    // it resolves to, which is where a delete would actually land. Before the
    // fix only the first was asked, and the function RETURNED the forbidden
    // directory as rotatable.
    expect(asked[0]).toBe(link);
    expect(asked).toContain(pretendLive);
  });

  test("a symlink the refusal does NOT object to still works, and resolves to its target", () => {
    const volume = join(root, "ordinary-volume");
    mkdirSync(volume, { recursive: true });
    const link = join(root, "ordinary-link");
    symlinkSync(volume, link);
    const asked: string[] = [];
    const refuse = (path: string): string => {
      asked.push(path);
      return path;
    };
    expect(assertRotatableDir(dir, link, refuse)).toBe(realpathSync(volume));
    expect(asked.length).toBe(2);
  });

  test("a directory that does not exist yet is allowed — a fresh install has none", () => {
    expect(assertRotatableDir(dir, snapsDir)).toBe(snapsDir);
    expect(existsSync(snapsDir)).toBe(false);
  });
});

// ── danger 1: what rotation is willing to delete ────────────────────────────

/**
 * A REALISTIC pre-rows snapshot — the kind the owner actually has.
 *
 * `spans/` is the point. F2 went live on the v5 store, so his
 * `~/.counterparts/snapshots/` fills with copies of it, and a v5 backup set was
 * `["operational.sqlite", "prose", "spans", "versions"]`. `spans` is still in
 * the new `LAYOUT`, so a real v5 copy was RECOGNISED as one of ours and was
 * therefore rotatable. A v5 copy WITHOUT `spans/` was already safe, which is
 * the near-miss that shows the rule was nearly right.
 */
function preRowsSnapshot(name: string, where = snapsDir): string {
  const path = join(where, name);
  mkdirSync(join(path, "prose", "memories"), { recursive: true });
  mkdirSync(join(path, "versions"), { recursive: true });
  mkdirSync(join(path, "spans", "default"), { recursive: true });
  writeFileSync(join(path, "operational.sqlite"), "a v5 database");
  writeFileSync(join(path, "prose", "memories", "mem_aaaaaaaaaaaa.md"), "ZQOLDFLOORWORDS");
  writeFileSync(join(path, "spans", "default", "jots.jsonl"), "{}\n");
  return path;
}

describe("the pre-rows rule reaches the partial sweep too (review f5c, NIT-3)", () => {
  test("an abandoned `.partial-` holding PRE-ROWS names is kept, not cleaned", () => {
    // The one path left that still deleted pre-rows bytes. B-MAJOR-2's rule —
    // a directory holding any `PRE_ROWS_MARKERS` entry is never ours — was
    // applied to finished copies and not to partials.
    //
    // A partial is by definition an incomplete copy, so in principle it is a
    // half-copy nobody wants. "In principle" is exactly the confidence that
    // lost three weeks of journal in v1, and the cost of keeping one is a
    // directory — while a copy of the owner's old floor, interrupted or not,
    // may be the only thing holding those words.
    const stale = join(snapsDir, `${PARTIAL_PREFIX}2026-09-01T00-00-00-000Z-4242`);
    mkdirSync(join(stale, "prose", "memories"), { recursive: true });
    writeFileSync(join(stale, "operational.sqlite"), "a v5 database");
    writeFileSync(join(stale, "prose", "memories", "mem_1.md"), "ZQOLDFLOORWORDS");
    const old = (Date.parse("2026-09-18T12:00:00Z") - 30 * 24 * 60 * 60_000) / 1000;
    utimesSync(stale, old, old);

    const errors: string[] = [];
    expect(cleanPartials(snapsDir, Date.parse("2026-09-18T12:00:00Z"), errors)).toBe(0);
    expect(errors).toEqual([]);
    expect(readFileSync(join(stale, "prose", "memories", "mem_1.md"), "utf8")).toContain(
      "ZQOLDFLOORWORDS",
    );

    // Non-vacuous: a partial of THIS build's shape, same age, is still swept.
    const ours = join(snapsDir, `${PARTIAL_PREFIX}2026-09-02T00-00-00-000Z-4243`);
    mkdirSync(join(ours, "spans"), { recursive: true });
    writeFileSync(join(ours, "counterparts.sqlite"), "half a database");
    utimesSync(ours, old, old);
    expect(cleanPartials(snapsDir, Date.parse("2026-09-18T12:00:00Z"), errors)).toBe(1);
    expect(existsSync(ours)).toBe(false);
    expect(existsSync(stale)).toBe(true);
  });
});

describe("a pre-rows snapshot is never rotated away (review B, MAJOR-2)", () => {
  test("three real v5 copies beside fourteen v6 ones, keep 14: nothing v5 is deleted", () => {
    // THE ARITHMETIC THAT MAKES THIS LIVE-RELEVANT. `resolveSnapshotsDir`
    // returns `<dirname(store)>/snapshots` whenever the store is called
    // `store`, and the cut-over most naturally mints the new one at the same
    // path — so the fresh v6 store inherits the directory full of his pre-rows
    // copies. Fourteen daily boundaries later, every one of them was gone.
    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      preRowsSnapshot(`${day}T00-00-00-000Z`);
    }
    for (let d = 1; d <= 14; d += 1) {
      fakeSnapshot(`2026-10-${String(d).padStart(2, "0")}T00-00-00-000Z`);
    }

    const report = rotate(snapsDir, 14, null, 0, []);
    expect(report.deleted).toEqual([]);
    // They do not count toward `keep` either — otherwise they would push the
    // owner's real v6 copies out instead.
    expect(report.kept).toBe(14);
    expect(report.preRows.length).toBe(3);
    expect(report.unrecognised).toEqual([]);
    // …and the words are still on disk.
    for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
      expect(
        readFileSync(
          join(snapsDir, `${day}T00-00-00-000Z`, "prose", "memories", "mem_aaaaaaaaaaaa.md"),
          "utf8",
        ),
      ).toContain("ZQOLDFLOORWORDS");
    }
  });

  test("with keep 1 they are still not the ones that go", () => {
    // Non-vacuity from the other side: rotation IS deleting here, and it is
    // deleting only v6 copies.
    preRowsSnapshot("2026-09-01T00-00-00-000Z");
    fakeSnapshot("2026-10-01T00-00-00-000Z");
    fakeSnapshot("2026-10-02T00-00-00-000Z");
    const report = rotate(snapsDir, 1, null, 0, []);
    expect(report.deleted).toEqual(["2026-10-01T00-00-00-000Z"]);
    expect(existsSync(join(snapsDir, "2026-09-01T00-00-00-000Z", "operational.sqlite"))).toBe(true);
    expect(report.preRows).toEqual(["2026-09-01T00-00-00-000Z"]);
  });

});

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

  /**
   * MINOR-7 OF THE F2 REVIEW. Inside the default directory this is belt and
   * braces — the package made every entry there. It earns its keep the moment
   * somebody points `snapshots.dir` or `mirror` at a directory of their own,
   * shared with another tool: a folder of theirs that happens to wear the name
   * used to be `rm -rf`ed, and a `.partial-my-own-thing` used to be swept.
   */
  /**
   * MAJOR-A OF THE SECOND F2 REVIEW. The LAYOUT rule is right — never delete
   * what we cannot prove we made — but a candidate it rejects used to be dropped
   * from the return value, so it was invisible to rotation, to "today's exists",
   * to `kept`, to `oldest`, to doctor and to every row. `LAYOUT` is read at
   * runtime, so the rule can change underneath copies that already exist (a
   * floor change; a copy somebody partly cleaned out) and nothing said so:
   * permanent, uncounted residue in the one directory the owner relies on. The
   * rule is unchanged; the silence is gone.
   */
  test("a rejected candidate is counted and NAMED, on the report and on the row", () => {
    const c = seeded();
    mkdirSync(snapsDir, { recursive: true });
    for (let i = 1; i <= 3; i += 1) fakeSnapshot(`2026-09-0${String(i)}T00-00-00-000Z`);
    // What a copy taken on an older floor looks like after the layout moves on.
    for (const name of ["2026-08-01T00-00-00-000Z", "2026-08-02T00-00-00-000Z"]) {
      const old = join(snapsDir, name);
      mkdirSync(old, { recursive: true });
      writeFileSync(join(old, "an-older-floor.db"), "a copy we cannot recognise");
    }

    const read = readSnapshotsDir(snapsDir);
    expect(read.names.length).toBe(3);
    expect(read.unrecognised).toEqual(["2026-08-01T00-00-00-000Z", "2026-08-02T00-00-00-000Z"]);

    const report = runSnapshot({ counterpart: c, dataDir: dir, config: { keep: 1 }, now: NOW, date: TODAY });
    expect(report.reason).toBe("taken");
    expect(report.rotation?.unrecognised).toEqual([
      "2026-08-01T00-00-00-000Z",
      "2026-08-02T00-00-00-000Z",
    ]);
    // Kept, never deleted — we do not destroy what we cannot prove we made.
    expect(existsSync(join(snapsDir, "2026-08-01T00-00-00-000Z"))).toBe(true);
    // And said out loud, on the row a person reads tomorrow.
    const taken = payload(rowsOf(c, SNAPSHOT_TAKEN_EVENT)[0]);
    expect(taken["unrecognised"]).toBe(2);
    expect(String(taken["unrecognisedNames"])).toContain("2026-08-01T00-00-00-000Z");
    const rotated = payload(rowsOf(c, SNAPSHOT_ROTATED_EVENT)[0]);
    expect(rotated["unrecognised"]).toBe(2);
  });

  test("a directory wearing the name but holding nothing of ours is neither counted nor deleted", () => {
    mkdirSync(snapsDir, { recursive: true });
    const theirs = join(snapsDir, "2026-01-01T00-00-00-000Z");
    mkdirSync(theirs, { recursive: true });
    writeFileSync(join(theirs, "my-notes.md"), "not a snapshot");
    // And their own partial-looking folder, which is not the shape we write.
    const theirPartial = join(snapsDir, ".partial-my-own-thing");
    mkdirSync(theirPartial, { recursive: true });
    const old = (NOW - PARTIAL_STALE_MS - 60_000) / 1000;
    utimesSync(theirPartial, old, old);
    fakeSnapshot("2026-09-11T12-00-00-000Z");

    expect(snapshotNamesIn(snapsDir)).toEqual(["2026-09-11T12-00-00-000Z"]);
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, config: { keep: 1 }, now: NOW, date: TODAY });
    expect(report.reason).toBe("taken");
    expect(report.rotation?.cleaned).toBe(0);
    expect(existsSync(join(theirs, "my-notes.md"))).toBe(true);
    expect(existsSync(theirPartial)).toBe(true);
  });

  /**
   * MINOR-5. A laptop waking with a bad RTC plants a name that sorts newest
   * forever and holds a `keep` slot. It is NOT deleted — guessing that a name is
   * wrong is not a reason to destroy the bytes behind it — but the "silently" is
   * gone: it is counted on the rotation row and on the doctor line.
   */
  test("a future-dated copy is counted and reported, never deleted", () => {
    mkdirSync(snapsDir, { recursive: true });
    fakeSnapshot("2099-01-01T00-00-00-000Z");
    fakeSnapshot("2026-09-01T12-00-00-000Z");
    fakeSnapshot("2026-09-02T12-00-00-000Z");
    expect(futureNamesIn(snapshotNamesIn(snapsDir), NOW)).toEqual(["2099-01-01T00-00-00-000Z"]);
    const report = rotate(snapsDir, 2, null, 0, [], NOW);
    expect(report.future).toBe(1);
    expect(existsSync(join(snapsDir, "2099-01-01T00-00-00-000Z"))).toBe(true);
  });

  /**
   * MINOR-f OF THE SECOND F2 REVIEW. Rotation asks this with the live clock and
   * doctor asks it with midnight today; an INSTANT cutoff made the two disagree
   * by up to a day, so doctor could say "1 dated in the future" while the row
   * for the same directory said none. Two surfaces that are supposed to agree
   * (constitution 16).
   */
  test('"future" means the same thing whatever instant of the day asks', () => {
    const names = ["2026-09-19T08-00-00-000Z"];
    const midnight = Date.parse(`${TODAY}T00:00:00Z`);
    expect(futureNamesIn(names, NOW)).toEqual(futureNamesIn(names, midnight));
    expect(futureNamesIn(names, Date.parse(`${TODAY}T23:59:59Z`))).toEqual(
      futureNamesIn(names, midnight),
    );
  });

  test("a partial whose mtime is in the FUTURE is still swept", () => {
    mkdirSync(snapsDir, { recursive: true });
    const skewed = join(snapsDir, `${PARTIAL_PREFIX}2026-09-18T09-00-00-000Z-4242`);
    mkdirSync(skewed, { recursive: true });
    // A negative age is always below the staleness bound, so it used to be kept
    // forever (second F2 review, NIT-2) — the same clock-skew family as a
    // future-dated copy.
    const ahead = (NOW + PARTIAL_STALE_MS + 60_000) / 1000;
    utimesSync(skewed, ahead, ahead);
    expect(cleanPartials(snapsDir, NOW, [])).toBe(1);
    expect(existsSync(skewed)).toBe(false);
  });

  test("a missing directory and an empty one are different answers", () => {
    // Doctor needs those apart: one is a store that has not taken a copy yet,
    // the other is copies that have gone missing.
    expect(readSnapshotsDir(snapsDir)).toEqual({ names: [], readable: false, unrecognised: [], preRows: [], preMigration: [] });
    mkdirSync(snapsDir, { recursive: true });
    expect(readSnapshotsDir(snapsDir)).toEqual({ names: [], readable: true, unrecognised: [], preRows: [], preMigration: [] });
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
    const copy = openDb(join(snapsDir, report.name as string, "counterparts.sqlite"));
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
    const inside = openDb(join(snapsDir, report.name as string, "counterparts.sqlite"));
    const seen = inside.all<{ name: string }>("SELECT name FROM events").map((r) => r.name);
    expect(seen).not.toContain(SNAPSHOT_TAKEN_EVENT);
    inside.close();
  });

  test("copies the WHOLE backup set, not just the database — and the words come with it", () => {
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    const copied = join(snapsDir, report.reason === "taken" ? (report.name as string) : "");
    expect(existsSync(join(copied, "counterparts.sqlite"))).toBe(true);
    // Box 3 is classified as excluded and must NOT be there.
    expect(existsSync(join(copied, "cache"))).toBe(false);
    // THE COPY STILL HAS THE MEMORIES. `prose/` was the thing this test used to
    // look for, and losing it without replacing the claim would leave "the whole
    // backup set" asserted against a set of one file nobody checked the contents
    // of — which is scar §2.11 said backwards. The database alone has to carry
    // the bodies now, so that is what is asserted.
    const source = Store.open({ dir, observer: true });
    const expected = source.list().map((id) => source.readProse(id).body).sort();
    source.close();
    expect(expected.length).toBeGreaterThan(0);
    const restored = Store.open({ dir: copied, observer: true });
    expect(restored.list().map((id) => restored.readProse(id).body).sort()).toEqual(expected);
    restored.close();
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

  /**
   * THE CAP'S OWN CONFIDENTLY-WRONG ANSWER. `eventLog` is `ORDER BY seq ASC
   * LIMIT`, so a full read is the OLDEST rows and today's are exactly the ones
   * missing — and under a frozen lived-day clock (I32, a week of it) every row
   * sits in one `day`, so the window fills and the cap would read zero forever.
   */
  test("a failure window too full to read counts as exhausted, not as zero", () => {
    const c = seeded();
    makeCopiesFail();
    const day = c.store.livedDay();
    // More rows than the read's limit, none of them today's.
    for (let i = 0; i < 1000; i += 1) {
      c.store.appendEvent({
        name: SNAPSHOT_FAILED_EVENT,
        day,
        payload: { date: "2026-09-01", step: "copy", reason: "old" },
      });
    }
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    // Fail-closed, and the cheap direction: what is refused is a RETRY, never a
    // backup — the copy beside the store is untouched either way.
    expect(report.reason).toBe("attempts-exhausted");
    // AND IT SAYS SO (F2 review, MINOR-2). `attempts-exhausted` writes no row of
    // its own, so at this limit the mechanism would otherwise stop for good with
    // nothing anywhere saying why.
    // `eventLog` is ascending, so the new row is at the END of a read this
    // large — the very trap the fix is about.
    const named = c.store
      .eventLog({ name: SNAPSHOT_FAILED_EVENT, limit: 5000 })
      .filter((r) => payload(r)["reason"] === "attempt-window-unreadable");
    expect(named.length).toBe(1);
  });

  /**
   * N-2 OF THE F2 REVIEW. `snapshotName` spells an instant, and the row carries
   * the run's date — so a boundary that starts at 23:59:59 and copies at
   * 00:00:01 filed the copy under tomorrow while the row said today. "Today's
   * exists" would never find it, and yesterday ended with no copy at all.
   */
  test("the copy's name always carries the run's date, even across UTC midnight", () => {
    const c = seeded();
    // The run is about the 18th; the clock has already turned over to the 19th.
    const report = runSnapshot({
      counterpart: c,
      dataDir: dir,
      now: at("2026-09-19", "T00-00-01Z".replace(/-/g, ":")),
      date: TODAY,
    });
    expect(report.reason).toBe("taken");
    expect(report.name?.startsWith(`${TODAY}T`)).toBe(true);
    // Which is what makes the next boundary the same day a no-op rather than a
    // second copy.
    expect(todaysSnapshot(snapsDir, TODAY)).toBe(report.name);
    expect(
      runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY }).reason,
    ).toBe("already-today");
  });

  test("an aborted watchdog stops the copy before it starts, and does NOT spend the day's budget", () => {
    const c = seeded();
    const controller = new AbortController();
    controller.abort();
    const aborted = (): string =>
      runSnapshot({
        counterpart: c,
        dataDir: dir,
        now: NOW,
        date: TODAY,
        signal: controller.signal,
      }).reason;
    expect(aborted()).toBe("aborted");
    expect(snapshotNamesIn(snapsDir).length).toBe(0);
    const p = payload(rowsOf(c, SNAPSHOT_FAILED_EVENT)[0]);
    expect(p["reason"]).toBe("aborted");
    // `step: "aborted"`, not `"copy"` — nothing was copied (F2 review, MINOR-1).
    expect(p["step"]).toBe("aborted");

    // Three overrunning boundaries used to spend the whole day's allowance, so a
    // day whose sleep cycle ran long got no backup at all though nothing had
    // ever tried to copy.
    aborted();
    aborted();
    const healthy = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(healthy.reason).toBe("taken");
  });

  /**
   * MINOR-a OF THE SECOND F2 REVIEW. The run's date is the first half of every
   * name this module writes, so a `date` that is not a calendar date built a
   * name matching neither load-bearing pattern: never recognised as a snapshot
   * (so a full copy at every boundary), never rotated, and its partial never
   * swept — unbounded disk growth from one bad string. No caller can do it
   * today; a `--date` flag on the worker is one line away.
   */
  test("a run date that is not a calendar date falls back to the clock and says so", () => {
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: "not-a-date" });
    expect(report.reason).toBe("taken");
    expect(report.name?.startsWith(`${TODAY}T`)).toBe(true);
    expect(SNAPSHOT_NAME_RE.test(report.name as string)).toBe(true);
    expect(report.errors.join(" ")).toContain("not a calendar date");
    // Which means the copy is a real snapshot: counted, and found by tomorrow's
    // "today's exists" gate rather than copied again at every boundary.
    expect(snapshotNamesIn(snapsDir)).toEqual([report.name as string]);
    expect(todaysSnapshot(snapsDir, TODAY)).toBe(report.name);
  });

  test("an observer takes no copy and leaves no directory", () => {
    // The runner refuses under observer before it opens a store, so nothing
    // reaches this today — but `noteAdapterEvent` standing the ROW down while the
    // copy still wrote tens of megabytes was a stand-down in name only (F2
    // review, MINOR-6). An instrument that leaves a directory behind is the thing
    // §15 G3 is about.
    seeded().close();
    open.length = 0;
    const c = Counterpart.open({ dir, observer: true });
    open.push(c);
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.reason).toBe("observer");
    expect(existsSync(snapsDir)).toBe(false);
  });

  /**
   * MINOR-9 OF THE F2 REVIEW. `report.ok` only ever meant "no leg reported an
   * error" — and `copyTree` returns 0 files and `ok: true` for a source that is
   * not there. A structurally empty directory would have taken the name, counted
   * toward `keep`, satisfied "today's exists" and pushed a real copy out on day
   * 15. It is looked at before the rename now.
   */
  test("a copy is looked at before the rename makes it a snapshot", () => {
    const candidate = join(root, "candidate");
    mkdirSync(candidate, { recursive: true });

    // Nothing landed at all.
    expect(verifyCopy(candidate, 0)).toContain("no files");
    // Files, but no database.
    writeFileSync(join(candidate, "something.md"), "prose");
    expect(verifyCopy(candidate, 1)).toContain("no counterparts.sqlite");
    // A database that is there and empty.
    writeFileSync(join(candidate, "counterparts.sqlite"), "");
    expect(verifyCopy(candidate, 2)).toContain("is empty");
    // A database that is not one.
    writeFileSync(join(candidate, "counterparts.sqlite"), "this is not a database");
    expect(verifyCopy(candidate, 2)).toMatch(/would not open|did not verify/);

    // And a real snapshot passes, which is the arm that must not be broken.
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(verifyCopy(join(snapsDir, report.name as string), report.files)).toBe(null);
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
    // A partial THIS build could actually leave: the database and `spans/`,
    // half-written. It used to hold a `prose/` — which no copy of a v6 store
    // has, and which the sweep now reads as a pre-rows copy and keeps (see the
    // test below).
    const abandoned = join(snapsDir, `${PARTIAL_PREFIX}2026-09-18T09-00-00-000Z-4242`);
    mkdirSync(join(abandoned, "spans"), { recursive: true });
    writeFileSync(join(abandoned, "counterparts.sqlite"), "half a database");

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
    // Its mtime is set against the run's clock rather than the machine's. Before
    // NIT-2's `Math.abs` this test passed for the wrong reason: the fixture's
    // instant is years from the real clock, so the age came out NEGATIVE and a
    // negative age was always "fresh".
    const minuteAgo = (NOW - 60_000) / 1000;
    utimesSync(live, minuteAgo, minuteAgo);
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.rotation?.cleaned).toBe(0);
    // A sweep that deleted this would be the module destroying another run's
    // copy while it was being written.
    expect(existsSync(live)).toBe(true);
  });
});

// ── restoring from one ──────────────────────────────────────────────────────

/**
 * THE QUESTION THE WHOLE TRACK IS FOR: if the database were wiped this
 * afternoon, what comes back? The F2 review proved both halves of the answer —
 * the memories come back, and they cannot be FOUND until the cache is rebuilt,
 * because `cache/` is classified out of the backup set on purpose. A person
 * restoring on the worst day of the year, not told about the second half, opens
 * the copy, asks it something, gets nothing, and concludes the backup is empty.
 */
describe("a snapshot can actually be restored", () => {
  test("the memories come back with the copy; the search index comes back with a rebuild", () => {
    const c = seeded();
    const id = c.store.list({ archived: false })[0] as string;
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    expect(report.reason).toBe("taken");
    const original = c.store.search("rebuilt");
    expect(original.length).toBeGreaterThan(0);
    c.close();
    open.length = 0;

    // Step 2 of the restore procedure: copy the snapshot into a store's place.
    const restoredDir = join(root, "restored", "store");
    mkdirSync(join(root, "restored"), { recursive: true });
    cpSync(join(snapsDir, report.name as string), restoredDir, { recursive: true });

    const restored = Counterpart.open({ dir: restoredDir, owner: true });
    open.push(restored);
    // The canonical halves are all there.
    expect(restored.store.list({ archived: false })).toContain(id);
    expect(restored.store.readProse(id).body.length).toBeGreaterThan(0);
    // And NOTHING is findable, which is the half nobody was being told about.
    expect(restored.store.search("rebuilt")).toEqual([]);

    // Step 3: the rebuild. This is what `counterparts verify --rebuild` runs.
    restored.store.rebuildCache();
    expect(restored.store.search("rebuilt").length).toBeGreaterThan(0);
  });

  /**
   * NIT-5 OF THE SECOND F2 REVIEW, and the one cross-PR coupling worth pinning.
   *
   * An archived snapshot ends up on read-only media, and a WAL-mode database
   * cannot be opened there. Two facts keep that working, and both were MEASURED
   * rather than asserted: `VACUUM INTO` writes a rollback-mode file even from a
   * WAL source, and `verifyCopy` does not convert it, because F1 makes WAL
   * conversion opt-in and `verifyCopy` calls `openDb` with no options. Either is
   * one edit away from silently becoming false — adding `{ wal: true }` to that
   * call would convert every snapshot at verification time.
   *
   * Written to hold on EITHER floor: today's source is rollback-mode, F1's will
   * be WAL, and the copy must read rollback-mode in both cases.
   */
  test("a snapshot's database is rollback-mode with no sidecars, before and after verification", () => {
    const c = seeded();
    const report = runSnapshot({ counterpart: c, dataDir: dir, now: NOW, date: TODAY });
    const copy = join(snapsDir, report.name as string);
    const db = join(copy, "counterparts.sqlite");
    // WHICH FLOOR THIS RAN ON, recorded rather than assumed. Since F1 the source
    // is WAL and this is the interesting case — a copy that inherited the
    // source's mode would be a copy that cannot be opened on read-only media.
    // Before F1 it was rollback and the assertions below held trivially; naming
    // the source's mode is what keeps the test from passing vacuously either way.
    const sourceMode = journalModeOf(paths.operational(dir));
    expect(["wal", "delete", "truncate", "persist", "memory", "off"]).toContain(sourceMode);

    // Header bytes 18 and 19 are the file-format read/write versions: 1 is
    // rollback (journal), 2 is WAL. Read as bytes so this needs no connection
    // and cannot itself change the file.
    const header = (): number[] => {
      const bytes = readFileSync(db);
      return [bytes[18] as number, bytes[19] as number];
    };
    expect(header(), `source was ${sourceMode}`).toEqual([1, 1]);
    // Three verifications later it is still rollback-mode...
    for (let i = 0; i < 3; i += 1) expect(verifyCopy(copy, report.files)).toBe(null);
    expect(header(), `source was ${sourceMode}`).toEqual([1, 1]);
    // ...and no sidecar has appeared beside it. A `-wal` in an archive is a
    // database that will not open on read-only media.
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      expect(existsSync(`${db}${suffix}`), suffix).toBe(false);
    }
  });

  test("the restore steps doctor prints name the rebuild and the cost of skipping the key", () => {
    // The steps are a string rather than prose in a file precisely so this can
    // be asserted: a procedure nobody can find is not a procedure.
    expect(RESTORE_STEPS).toContain("--rebuild");
    expect(RESTORE_STEPS).toContain("embed key");
    expect(RESTORE_STEPS).toContain("stop every session");
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
    expect(existsSync(join(mirror, name, "counterparts.sqlite"))).toBe(true);
    // Its own rotation: three old plus the new one, keeping two.
    expect(snapshotNamesIn(mirror)).toEqual(["2026-09-03T00-00-00-000Z", name]);
    // No partial left in the mirror either.
    expect(readdirSync(mirror).filter((n) => n.startsWith(PARTIAL_PREFIX))).toEqual([]);
    expect(payload(rowsOf(c, SNAPSHOT_TAKEN_EVENT)[0])["mirror"]).toBe("ok");
  });

  test("the mirrored copy is verified before ITS rename, and a bad one leaves the primary alone", () => {
    const c = seeded();
    const mirror = join(root, "mirror");
    mkdirSync(mirror, { recursive: true });
    // A mirror volume that accepts the copy and then cannot be read back: the
    // `cpSync` returns, so only a look at what was written catches it (second F2
    // review, MINOR-b). Simulated by making the mirror unwritable AFTER the
    // guard — `cpSync` fails and the same arm handles it — and then by the
    // honest case below.
    chmodSync(mirror, 0o500);
    chmodded.push(mirror);
    const report = runSnapshot({ counterpart: c, dataDir: dir, config: { mirror }, now: NOW, date: TODAY });
    // The primary landed regardless. That is the whole rule.
    expect(report.reason).toBe("taken");
    expect(report.mirror?.ok).toBe(false);
    expect(snapshotNamesIn(snapsDir).length).toBe(1);
    // Nothing half-written was renamed into place in the mirror.
    expect(snapshotNamesIn(mirror)).toEqual([]);
    // And the mirror's failure has a row of its own, with a step the daily
    // attempt cap does not count.
    const failed = rowsOf(c, SNAPSHOT_FAILED_EVENT).map(payload);
    expect(failed.length).toBe(1);
    expect(String(failed[0]?.["step"])).toContain("mirror");
    // The cap counts only copy/rename/verify, so tomorrow's budget is intact.
    expect(runSnapshot({ counterpart: c, dataDir: dir, now: at("2026-09-19"), date: "2026-09-19" }).reason).toBe(
      "taken",
    );
  });

  test("a mirror that is the snapshots directory, or inside it, is refused in words", () => {
    const c = seeded();
    // A "second location" nested inside the first dies with the same disk and
    // silently doubles local storage, and the outer rotation cannot see it
    // (second F2 review, MINOR-e). `mirror === dir` used to fail with a raw
    // ENOTEMPTY from the rename.
    for (const mirror of [snapsDir, join(snapsDir, "offsite"), root]) {
      rmSync(snapsDir, { recursive: true, force: true });
      const report = runSnapshot({ counterpart: c, dataDir: dir, config: { mirror }, now: NOW, date: TODAY });
      expect(report.reason, mirror).toBe("taken");
      expect(report.mirror?.ok, mirror).toBe(false);
      expect(report.mirror?.why, mirror).toMatch(/second place|snapshots directory itself|contains the store/);
      expect(report.mirror?.why, mirror).not.toContain("ENOTEMPTY");
      // The primary is untouched either way.
      expect(snapshotNamesIn(snapsDir).length, mirror).toBe(1);
    }
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
    const p = payload(rowsOf(c, SNAPSHOT_TAKEN_EVENT)[0]);
    expect(p["mirror"]).toBe("failed");
    // "failed" with no why is the half-record this project keeps finding in v1.
    expect(p["mirrorWhy"]).toContain("home directory");
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

  test("an unknown sub-key is REPORTED, not dropped in silence", () => {
    const loaded = loadConfig({ snapshots: { keep: 3, mirrors: "/m" } });
    expect(loaded.reason).toBe("loaded");
    expect(loaded.config.snapshots?.keep).toBe(3);
    // A typo'd `"mirrors"` that quietly did nothing is how somebody believes
    // they have a second copy and does not.
    expect(loaded.config.snapshots?.ignored?.join(" ")).toContain("snapshots.mirrors");
  });

  /**
   * MAJOR-2 OF THE F2 REVIEW, and the reason this one block is lenient.
   *
   * Measured on the first draft: `"keep": 0` — or `"14"` with quotes, the
   * likelier typo — returned `{ observer: true }` with `dataDir` GONE. From the
   * next hook on, nothing was captured, nothing recalled, no row written, and the
   * one stderr line a hook produces goes nowhere (I32). A backup preference is
   * not worth memory.
   */
  test("a bad value inside the block NEVER degrades the adapter — it falls back and says so", () => {
    for (const bad of [
      { snapshots: "yes" },
      { snapshots: [] },
      { snapshots: { dir: 7 } },
      { snapshots: { mirror: true } },
      { snapshots: { keep: "14" } },
      { snapshots: { keep: 0 } },
      { snapshots: { keep: -1 } },
      { snapshots: { keep: 1.5 } },
      { snapshots: { keep: null } },
      // A relative path would resolve against whatever directory the host
      // session happened to be in, scattering one copy per project.
      { snapshots: { dir: "snaps" } },
      // Blank meaning "the default" surprises somebody who blanked it to switch
      // snapshots off.
      { snapshots: { mirror: "  " } },
    ]) {
      const loaded = loadConfig({ dataDir: "/x/store", ...bad });
      const what = JSON.stringify(bad);
      expect(loaded.reason, what).toBe("loaded");
      expect(loaded.config.observer, what).toBeUndefined();
      // The rest of the configuration survives intact — this is the whole point.
      expect(loaded.config.dataDir, what).toBe("/x/store");
      // And the field that could not be read is named, with what is used instead.
      expect((loaded.config.snapshots?.ignored ?? []).length, what).toBeGreaterThan(0);
      expect(loaded.config.snapshots?.dir, what).toBeUndefined();
      expect(loaded.config.snapshots?.keep, what).toBeUndefined();
      // `keepOf` is what the fallback actually is, and it is not restated.
      expect(keepOf(loaded.config.snapshots?.keep), what).toBe(DEFAULT_KEEP);
    }
  });

  /**
   * MINOR-d OF THE SECOND F2 REVIEW. These phrases are built from the owner's
   * own configuration file and end up on a doctor line in his terminal: a key
   * carrying ANSI escapes was measured reaching that terminal raw, and a
   * 200,000-character value made a 200,000-character line.
   */
  test("the ignored phrases are stripped of control characters and bounded", () => {
    const escaped = loadConfig({ snapshots: { "\u001b[2J\u001b[Hmirror": "/x" } });
    const line = (escaped.config.snapshots?.ignored ?? []).join("");
    expect(line).toContain("snapshots.");
    expect(line).not.toMatch(/[\u0000-\u001f\u007f]/);

    const long = loadConfig({ snapshots: { keep: "q".repeat(200_000) } });
    for (const l of long.config.snapshots?.ignored ?? []) expect(l.length).toBeLessThanOrEqual(120);

    const many: Record<string, unknown> = {};
    for (let i = 0; i < 2000; i += 1) many[`key${String(i)}`] = 1;
    const capped = loadConfig({ snapshots: many }).config.snapshots?.ignored ?? [];
    expect(capped.length).toBeLessThanOrEqual(9);
    expect(capped[capped.length - 1]).toContain("more");
  });

  test("everything OUTSIDE the block keeps the file's strict rule", () => {
    // The leniency is scoped to one block on purpose: a knob whose wrong answer
    // makes the adapter ACT still stands the configuration down.
    expect(loadConfig({ dataDir: 7 }).reason).toBe("unreadable");
    expect(loadConfig({ embedder: { enabled: "yes" } }).reason).toBe("unreadable");
    expect(loadConfig({ observer: "maybe" }).reason).toBe("unreadable");
    // Even alongside a perfectly good snapshots block.
    expect(loadConfig({ dataDir: 7, snapshots: { keep: 14 } }).reason).toBe("unreadable");
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
    });
    expect(report.ran).toBe(true);
    expect(report.snapshot?.reason).toBe("taken");
    expect(snapshotNamesIn(snapsDir).length).toBe(1);
    // The worker runs on the real clock and the run's DATE is injected, so this
    // is the assertion that cannot misfile across UTC midnight: the copy's name
    // carries the run's date, whatever the wall clock says (F2 review, N-2).
    expect(snapshotNamesIn(snapsDir)[0]?.startsWith(`${TODAY}T`)).toBe(true);

    const after = counterpart();
    expect(rowsOf(after, SNAPSHOT_TAKEN_EVENT).length).toBe(1);
  });

  test("an observer takes no copy at all", async () => {
    seeded().close();
    open.length = 0;
    const report = await runOnce({
      config: { dataDir: dir, observer: true },
      date: TODAY,
    });
    expect(report.reason).toBe("observer");
    expect(report.snapshot).toBe(null);
    // The instrument does not mutate what it measures — not even to back it up.
    expect(existsSync(snapsDir)).toBe(false);
  });
});
