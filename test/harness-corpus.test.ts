/**
 * `harness corpus` (tools/harness/corpus.ts) and `--preset` (settings.ts,
 * compare.ts): a snapshot copied out of a fake `~/.counterparts/snapshots`
 * through the CLI, the newest picked, the copy checked, named and made
 * read-only, the source left as it was, and everything that isn't a snapshot
 * refused; a preset expanded into settings this build can set, recorded one
 * by one, and a compare run with it end to end.
 *
 * Hermetic: a fake HOME under a fresh temp dir, removed after; the CLI runs
 * with that HOME, so the real `~/.counterparts` is never the default.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { Counterpart } from "../src/core/counterpart.js";
import { runningBuild } from "../src/core/store/operational.js";
import { CompareError, planSides, runCompare } from "../tools/harness/compare.js";
import { corpusName } from "../tools/harness/corpus.js";
import { PRESETS, SettingError, applySettings, expandPreset, parseSetting, restoreSettings } from "../tools/harness/settings.js";

const CLI = resolve(import.meta.dir, "..", "tools", "harness", "cli.ts");
const OLDER = "2026-01-04T12-00-00-000Z";
const NEWER = "2026-01-05T12-00-00-000Z";

let root: string;
let home: string;
let snapshots: string;

function midday(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

/** A real store, closed, with one belief, one tag and one subject link written as the v14 tables hold them. */
function makeStore(dir: string, date: string): void {
  const c = Counterpart.open({ dir, budgetBytes: 9_000, now: () => midday(date), timeZone: "UTC" });
  for (const id of ["mem_aaaaaaaaaaa1", "mem_aaaaaaaaaaa2"]) {
    c.store.put({ id, type: "memory", kind: "fact", body: `A fact, ${id}.`, salience: { novelty: null, relevance: 0.6, emotional: 0.2, predictive: 0.5 }, physics: { birthDay: 0, lastUsedDay: 0 }, source: "authored" });
  }
  c.close();
  const db = new Database(join(dir, "counterparts.sqlite"));
  db.run("UPDATE memories SET birth_route = 'session' WHERE id = 'mem_aaaaaaaaaaa2'");
  db.run("INSERT INTO memory_tags (memory_id, tag, via, created_at) VALUES ('mem_aaaaaaaaaaa1', 'kiln', 'write', 1), ('mem_aaaaaaaaaaa2', 'kiln', 'write', 1)");
  db.run("INSERT INTO memory_subjects (memory_id, subject_id, via, created_at) VALUES ('mem_aaaaaaaaaaa1', 'mem_aaaaaaaaaaa2', 'write', 1)");
  // One file, as a snapshot is (the daily copy is not in WAL mode).
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  db.run("PRAGMA journal_mode = DELETE");
  db.close();
  // A leftover shared-memory file from the store's own WAL connection: a real snapshot has none.
  rmSync(join(dir, "counterparts.sqlite-shm"), { force: true });
}

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function corpus(args: readonly string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, "corpus", ...args], {
    encoding: "utf8",
    cwd: root,
    env: { PATH: process.env["PATH"] ?? "", HOME: home, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-corpus-")));
  home = join(root, "home");
  snapshots = join(home, ".counterparts", "snapshots");
  makeStore(join(snapshots, OLDER), "2026-01-04");
  makeStore(join(snapshots, NEWER), "2026-01-05");
  // A half copy, newer than both, and a stray folder: neither is a snapshot.
  mkdirSync(join(snapshots, ".partial-2026-01-06T12-00-00-000Z"), { recursive: true });
  writeFileSync(join(snapshots, ".partial-2026-01-06T12-00-00-000Z", "counterparts.sqlite"), "half");
  mkdirSync(join(snapshots, "zz-not-a-snapshot"));
  writeFileSync(join(snapshots, "zz-not-a-snapshot", "counterparts.sqlite"), "no");
  // The live store's place: a decoy, never to be copied.
  mkdirSync(join(home, ".counterparts", "store"), { recursive: true });
  writeFileSync(join(home, ".counterparts", "store", "counterparts.sqlite"), "live");
});

afterEach(() => {
  restoreSettings();
  rmSync(root, { recursive: true, force: true });
});

// ── corpus ──────────────────────────────────────────────────────────────────

test("the newest snapshot is copied out, checked, named by date, schema and build, made read-only, and its counts printed", () => {
  const source = join(snapshots, NEWER, "counterparts.sqlite");
  const before = { hash: hash(source), mtime: statSync(source).mtimeMs };
  const json = join(root, "record.json");
  const r = corpus(["--json", json]);
  expect(r.err).toBe("");
  expect(r.status).toBe(0);
  // The default target is ~/counterparts-backups, under the HOME the CLI ran with.
  const name = `2026-01-05-corpus-v14-${runningBuild()}`;
  const copy = join(home, "counterparts-backups", name, "counterparts.sqlite");
  expect(existsSync(copy)).toBe(true);
  expect(hash(copy)).toBe(before.hash);
  expect(statSync(copy).mode & 0o222).toBe(0);
  // The source as it was; no half copy left in the target.
  expect(hash(source)).toBe(before.hash);
  expect(statSync(source).mtimeMs).toBe(before.mtime);
  expect(readdirSync(join(home, "counterparts-backups"))).toEqual([name]);
  const rec = JSON.parse(readFileSync(json, "utf8")) as Record<string, unknown>;
  expect(rec["snapshot"]).toBe(NEWER);
  expect(rec["schemaVersion"]).toBe(14);
  expect(rec["build"]).toBe(runningBuild());
  expect(rec["counts"]).toMatchObject({ memories: 2, beliefs: 1, beliefSupport: 0, tags: 2, distinctTags: 1, subjectLinks: 1 });
  expect(r.out).toContain(`corpus: ${copy}`);
  expect(r.out).toContain("beliefs 1");
  expect(r.out).toContain("tag rows 2 · distinct tags 1");
  // No memory's words in what it prints.
  expect(r.out).not.toContain("A fact");
});

test("a named snapshot is copied, and a second copy to the same place is refused rather than overwritten", () => {
  const out = join(root, "backups");
  const first = corpus(["--from", join(snapshots, OLDER), "--out", out]);
  expect(first.status).toBe(0);
  expect(readdirSync(out)).toEqual([`2026-01-04-corpus-v14-${runningBuild()}`]);
  const again = corpus(["--from", join(snapshots, OLDER, "counterparts.sqlite"), "--out", out]);
  expect(again.status).toBe(1);
  expect(again.err).toContain("CORPUS_EXISTS");
  expect(readdirSync(out)).toEqual([`2026-01-04-corpus-v14-${runningBuild()}`]);
});

test("the live store, a folder outside the snapshots, a half copy, and a target under ~/.counterparts are refused by name", () => {
  const out = join(root, "backups");
  const codes = [
    corpus(["--from", join(home, ".counterparts", "store"), "--out", out]),
    corpus(["--from", join(home, ".counterparts", "store", "counterparts.sqlite"), "--out", out]),
    corpus(["--from", join(root, "elsewhere"), "--out", out]),
    corpus(["--from", join(snapshots, ".partial-2026-01-06T12-00-00-000Z"), "--out", out]),
    corpus(["--from", join(snapshots, "zz-not-a-snapshot"), "--out", out]),
    corpus(["--out", join(home, ".counterparts", "corpora")]),
    corpus(["--snapshots", join(root, "none"), "--out", out]),
    corpus(["--keep"]),
  ].map((r) => (r.status === 0 ? "copied" : (/[A-Z_]{6,}/.exec(r.err)?.[0] ?? r.err.trim())));
  expect(codes).toEqual([
    "CORPUS_IS_LIVE",
    "CORPUS_IS_LIVE",
    "CORPUS_NOT_A_SNAPSHOT",
    "CORPUS_NOT_A_SNAPSHOT",
    "CORPUS_NOT_A_SNAPSHOT",
    "CORPUS_WRITES_LIVE",
    "CORPUS_NO_SNAPSHOTS",
    "corpus has no --keep (its flags: --from --snapshots --out --json)",
  ]);
  expect(existsSync(out)).toBe(false);
});

test("a --json record aimed under ~/.counterparts is refused before anything is copied, and the live file is left as it was", () => {
  const live = join(home, ".counterparts", "store", "counterparts.sqlite");
  const out = join(root, "backups");
  for (const target of [live, join(home, ".counterparts", "record.json")]) {
    const r = corpus(["--json", target, "--out", out]);
    expect(r.status).toBe(1);
    expect(r.err).toContain("CORPUS_WRITES_LIVE");
  }
  expect(readFileSync(live, "utf8")).toBe("live");
  expect(existsSync(join(home, ".counterparts", "record.json"))).toBe(false);
  expect(existsSync(out)).toBe(false);
});

test("a snapshot with a -wal, -shm or -journal file beside it is not one file, and is refused", () => {
  const out = join(root, "backups");
  for (const side of ["-wal", "-shm", "-journal"]) {
    const sidecar = join(snapshots, NEWER, `counterparts.sqlite${side}`);
    writeFileSync(sidecar, "x");
    const r = corpus(["--out", out]);
    expect(r.status).toBe(1);
    expect(r.err).toContain("CORPUS_NOT_ONE_FILE");
    rmSync(sidecar);
  }
  expect(existsSync(out)).toBe(false);
});

test("a v13 snapshot (no tags, no beliefs, no build log) is counted as having none, not refused", () => {
  const dir = join(snapshots, "2026-01-06T12-00-00-000Z-pre-migration-v13-to-v14");
  mkdirSync(dir);
  const db = new Database(join(dir, "counterparts.sqlite"));
  db.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  db.run("INSERT INTO meta VALUES ('schemaVersion', '13'), ('livedDay', '29')");
  db.run("CREATE TABLE memories (id TEXT, type TEXT, archived INTEGER, kind TEXT)");
  db.run("INSERT INTO memories VALUES ('m1', 'memory', 0, 'fact'), ('m2', 'memory', 1, 'fact')");
  db.run("CREATE TABLE memory_subjects (memory_id TEXT, subject_id TEXT, via TEXT, created_at INTEGER)");
  db.close();
  const out = join(root, "backups");
  // The newest is the pre-migration copy now.
  const r = corpus(["--out", out]);
  expect(r.err).toBe("");
  expect(readdirSync(out)).toEqual(["2026-01-06-corpus-v13"]);
  expect(r.out).toContain("build (the store logs none)");
  expect(r.out).toContain("memories 1 live, 1 archived");
  expect(r.out).toContain("beliefs none (not kept before v14)");
  expect(r.out).toContain("subject links 0");
  expect(r.out).toContain("no beliefs yet");
});

test("the folder's name carries the snapshot's date, the schema, and a build made safe for a path", () => {
  expect(corpusName(NEWER, 14, "0.3.32")).toBe("2026-01-05-corpus-v14-0.3.32");
  expect(corpusName(NEWER, 13, null)).toBe("2026-01-05-corpus-v13");
  expect(corpusName(NEWER, 14, "a/b c")).toBe("2026-01-05-corpus-v14-a_b_c");
});

// ── presets ─────────────────────────────────────────────────────────────────

test("every setting of every preset is one this build can set, each key once", () => {
  for (const [name, settings] of Object.entries(PRESETS)) {
    expect(settings.length).toBeGreaterThan(0);
    for (const s of settings) expect(() => parseSetting(s)).not.toThrow();
    const done = applySettings(settings);
    expect(done.map((s) => `${s.module}.${s.key}`)).toEqual(settings.map((s) => s.split("=")[0]!));
    restoreSettings();
    expect(expandPreset(name)).toBe(settings);
  }
  expect(() => expandPreset("nope")).toThrow(SettingError);
  // physics-off: 28 settings, every memory in reach.
  expect(PRESETS["physics-off"]).toHaveLength(28);
  expect(PRESETS["physics-off"]).toContain("physics.REACH=0");
});

test("a preset is planned as its settings ahead of the side's own, named in the header, and a key set twice is refused", () => {
  const plan = { mode: "replay" as const, set: [], baseSet: [], runs: 1, passthrough: [] };
  const [base, variant] = planSides({ ...plan, preset: ["physics-off"], set: ["physics.CORE_FAST_GAP_DAYS=1"] });
  expect(base.set).toEqual([]);
  expect(variant.set).toEqual([...PRESETS["physics-off"]!, "physics.CORE_FAST_GAP_DAYS=1"]);
  expect(variant.presets).toEqual(["physics-off"]);
  const code = (f: () => unknown): string => {
    try {
      f();
      return "none";
    } catch (e) {
      return e instanceof CompareError || e instanceof SettingError ? e.code : `other: ${String(e)}`;
    }
  };
  expect(code(() => planSides({ ...plan, preset: ["physics-off"], set: ["physics.S0=1"] }))).toBe("COMPARE_SET_TWICE");
  expect(code(() => planSides({ ...plan, preset: ["nope"] }))).toBe("SETTING_PRESET");
  // The same preset on both sides is nothing to compare.
  expect(code(() => planSides({ ...plan, preset: ["physics-off"], basePreset: ["physics-off"] }))).toBe("COMPARE_NOTHING_DIFFERS");
});

test("a replay compared with physics off: the variant's record lists every setting of the preset, and the table names it", () => {
  const out = join(root, "backups");
  expect(corpus(["--out", out]).status).toBe(0);
  const source = join(out, readdirSync(out)[0]!, "counterparts.sqlite");
  const { text, sides } = runCompare({ mode: "replay", set: [], baseSet: [], preset: ["physics-off"], runs: 1, passthrough: ["--source", source] });
  const [base, variant] = sides;
  expect(base.runs[0]!.ok).toBe(true);
  expect(variant.runs[0]!.ok).toBe(true);
  expect(base.runs[0]!.settings).toEqual([]);
  expect(variant.runs[0]!.settings).toEqual([...PRESETS["physics-off"]!]);
  expect(text).toContain("preset physics-off (28 settings)");
  // Everything in reach under physics off.
  expect(text).toMatch(/below reach, last day\s+\S+\s+0\b/);
  expect(text).toContain("below reach, last day");
  expect(text).not.toContain("FAILED");
});
