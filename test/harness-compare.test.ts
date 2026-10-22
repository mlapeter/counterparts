/**
 * `harness compare` (tools/harness/compare.ts, settings.ts, usage.ts, page.ts):
 * a setting set from outside and put back, refused when it can't be set; a
 * child's tokens read from its own result line; the two sides planned, with a
 * compare where nothing differs refused; the records read into rows (an older
 * build's record too); the table, its disagreements and its noise floor; the
 * page read through the public seam. No worktree and no `claude` is started.
 *
 * Hermetic: temp dirs, removed after, and every setting restored.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seatAsk } from "../src/core/counterpart.js";
import { TUNABLES as PHYSICS } from "../src/core/physics/index.js";
import { spawnSync } from "node:child_process";

import { CompareError, absolutePaths, cell, linesChanged, planSides, readRecord, renderCompare, runArgs, runCompare, sameSettings } from "../tools/harness/compare.js";
import type { SideResult } from "../tools/harness/compare.js";
import { planModelChild } from "../tools/harness/model-seat.js";
import { pageReading } from "../tools/harness/page.js";
import { SETTINGS_ENV, SettingError, appliedSettings, applySettings, applySettingsFromEnv, parseSetting, restoreSettings, settingsForChild } from "../tools/harness/settings.js";
import { childUsage, recordUsage, resetUsage, totalTokens, usageTally } from "../tools/harness/usage.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-compare-")));
});

afterEach(() => {
  restoreSettings();
  resetUsage();
  rmSync(root, { recursive: true, force: true });
});

// ── settings ────────────────────────────────────────────────────────────────

test("a setting is set on the module itself, recorded with the build's own value, and put back", () => {
  const was = PHYSICS.CORE_FAST_GAP_DAYS;
  const done = applySettings(["physics.CORE_FAST_GAP_DAYS=1", "physics.CORE_FAST_ACCEPTS_REFLECTED_FEELING=false"]);
  expect(PHYSICS.CORE_FAST_GAP_DAYS as number).toBe(1);
  expect(PHYSICS.CORE_FAST_ACCEPTS_REFLECTED_FEELING as boolean).toBe(false);
  expect(done[0]).toEqual({ module: "physics", key: "CORE_FAST_GAP_DAYS", value: 1, was });
  expect(appliedSettings()).toHaveLength(2);
  expect(settingsForChild()).toBe("physics.CORE_FAST_GAP_DAYS=1;physics.CORE_FAST_ACCEPTS_REFLECTED_FEELING=false");
  restoreSettings();
  expect(PHYSICS.CORE_FAST_GAP_DAYS).toBe(was);
  expect(PHYSICS.CORE_FAST_ACCEPTS_REFLECTED_FEELING).toBe(true);
  expect(appliedSettings()).toEqual([]);
  expect(settingsForChild()).toBe("");
});

test("a setting that can't be set is refused by name, and none of the batch is set", () => {
  const code = (f: () => unknown): string => {
    try {
      f();
      return "none";
    } catch (e) {
      return e instanceof SettingError ? e.code : `other: ${String(e)}`;
    }
  };
  expect(code(() => parseSetting("CORE_FAST_GAP_DAYS=1"))).toBe("SETTING_SHAPE");
  expect(code(() => parseSetting("physics.CORE_FAST_GAP_DAYS"))).toBe("SETTING_SHAPE");
  expect(code(() => parseSetting("nowhere.X=1"))).toBe("SETTING_MODULE");
  expect(code(() => parseSetting("physics.NO_SUCH_KEY=1"))).toBe("SETTING_KEY");
  expect(code(() => parseSetting("physics.CORE_FAST_GAP_DAYS=soon"))).toBe("SETTING_TYPE");
  expect(code(() => parseSetting("physics.CORE_FAST_GAP_DAYS= "))).toBe("SETTING_SHAPE");
  expect(code(() => parseSetting("physics.CORE_FAST_ACCEPTS_REFLECTED_FEELING=1"))).toBe("SETTING_TYPE");
  const was = PHYSICS.CORE_FAST_GAP_DAYS;
  // One bad in a batch: the good one before it is not set either.
  expect(code(() => applySettings(["physics.CORE_FAST_GAP_DAYS=1", "physics.NO_SUCH_KEY=2"]))).toBe("SETTING_KEY");
  expect(PHYSICS.CORE_FAST_GAP_DAYS).toBe(was);
  expect(code(() => applySettings(["physics.CORE_FAST_GAP_DAYS=1", "physics.CORE_FAST_GAP_DAYS=3"]))).toBe("SETTING_TWICE");
  // A key some reader copied at load: refused, since it would change only the live object's readers.
  expect(code(() => parseSetting("physics.W_SHOWN=0.9"))).toBe("SETTING_CAPTURED");
  expect(code(() => parseSetting("physics.SHOWN_RECURRENCE_WEIGHT=0.9"))).toBe("SETTING_CAPTURED");
  expect(code(() => parseSetting("physics.HOLD_LEAD_DAYS=3"))).toBe("SETTING_CAPTURED");
  expect(code(() => parseSetting("remember.CONSUMED_LEDGER_MAX=3"))).toBe("SETTING_CAPTURED");
  expect(PHYSICS.CORE_FAST_GAP_DAYS).toBe(was);
  expect(appliedSettings()).toEqual([]);
});

test("a child's server applies what its parent passed down, and nothing when nothing was", () => {
  expect(applySettingsFromEnv({})).toEqual([]);
  expect(applySettingsFromEnv({ [SETTINGS_ENV]: "  " })).toEqual([]);
  applySettingsFromEnv({ [SETTINGS_ENV]: "physics.CORE_FAST_GAP_DAYS=1;" });
  expect(PHYSICS.CORE_FAST_GAP_DAYS as number).toBe(1);
});

test("the model's child gets the run's settings on its server, and none when the run set none", () => {
  const dir = join(root, "store");
  mkdirSync(dir);
  const ask = seatAsk("dream", { prompt: "p", run: "nrn_h", session: "s1", scope: root });
  const serverEnv = (): Record<string, string> => {
    const plan = planModelChild({ dir, configPath: join(root, "c.json"), now: () => Date.parse("2026-03-02T09:00:00Z"), env: { PATH: "/bin", HOME: root } }, ask, "host-1");
    const cfg = JSON.parse(plan.args[plan.args.indexOf("--mcp-config") + 1]!) as { mcpServers: Record<string, { env: Record<string, string> }> };
    return Object.values(cfg.mcpServers)[0]!.env;
  };
  expect(serverEnv()[SETTINGS_ENV]).toBeUndefined();
  applySettings(["physics.CORE_FAST_GAP_DAYS=1"]);
  expect(serverEnv()[SETTINGS_ENV]).toBe("physics.CORE_FAST_GAP_DAYS=1");
});

// ── usage ───────────────────────────────────────────────────────────────────

const RESULT = (input: number, output: number, cost: number): string =>
  JSON.stringify({ type: "result", result: "ok", total_cost_usd: cost, usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } });

test("a child's tokens come from its last result line; one that said none is counted as unread", () => {
  const out = [JSON.stringify({ type: "system", subtype: "init" }), "not json", RESULT(5, 7, 0.01)].join("\n");
  expect(childUsage(out)).toEqual({ input: 5, output: 7, cacheRead: 1000, cacheCreate: 10, costUsd: 0.01 });
  expect(childUsage("")).toBeNull();
  expect(childUsage(JSON.stringify({ type: "result", result: "no usage" }))).toBeNull();
  recordUsage(out);
  recordUsage(RESULT(1, 1, 0.02));
  recordUsage(undefined);
  const t = usageTally();
  expect(t).toEqual({ calls: 2, unread: 1, input: 6, output: 8, cacheRead: 2000, cacheCreate: 20, costUsd: 0.03 });
  expect(totalTokens(t)).toBe(2034);
});

// ── the plan ────────────────────────────────────────────────────────────────

const base = { mode: "night" as const, set: [] as string[], baseSet: [] as string[], runs: 1, passthrough: [] as string[] };

test("the sides: a branch against the base, a setting against the build, and a compare where nothing differs refused", () => {
  const code = (f: () => unknown): string => {
    try {
      f();
      return "none";
    } catch (e) {
      return e instanceof CompareError ? e.code : `other: ${String(e)}`;
    }
  };
  expect(code(() => planSides(base))).toBe("COMPARE_NOTHING_DIFFERS");
  // The same build twice is a noise check: allowed with repeats.
  expect(planSides({ ...base, runs: 2 }).map((s) => s.ref)).toEqual([null, null]);
  expect(planSides({ ...base, branch: "feat/x" }).map((s) => s.ref)).toEqual([null, "feat/x"]);
  expect(planSides({ ...base, base: "origin/master", branch: "feat/x" }).map((s) => s.ref)).toEqual(["origin/master", "feat/x"]);
  // A setting alone: both sides on the base's build.
  expect(planSides({ ...base, base: "origin/master", set: ["physics.CORE_FAST_GAP_DAYS=1"] }).map((s) => [s.ref, s.set.length])).toEqual([
    ["origin/master", 0],
    ["origin/master", 1],
  ]);
  expect(code(() => planSides({ ...base, set: ["a.B=1"], passthrough: ["--json", "x"] }))).toBe("COMPARE_OWNS_FLAG");
  expect(code(() => planSides({ ...base, set: ["a.B=1"], passthrough: ["--keep"] }))).toBe("COMPARE_OWNS_FLAG");
  expect(code(() => planSides({ ...base, set: ["a.B=1"], runs: 0 }))).toBe("COMPARE_RUNS");
  expect(code(() => planSides({ ...base, set: ["a.B=1"], runs: 1.5 }))).toBe("COMPARE_RUNS");
});

test("a run's arguments: the mode's own flags as given, the side's settings, its record, and a page file only where a page can change", () => {
  const side = { name: "variant" as const, ref: null, set: ["physics.CORE_FAST_GAP_DAYS=1"] };
  expect(runArgs("night", side, ["--dir", "n", "--model"], "/s/v.json", "/s/v.page.md")).toEqual([
    "tools/harness/cli.ts", "night", "--dir", "n", "--model", "--set", "physics.CORE_FAST_GAP_DAYS=1", "--json", "/s/v.json", "--page-out", "/s/v.page.md",
  ]);
  expect(runArgs("replay", side, [], "/s/v.json", "/s/v.page.md")).not.toContain("--page-out");
});

// ── reading and the table ───────────────────────────────────────────────────

const replayRecord = (cores: number[]): Record<string, unknown> => ({
  harness: "physics-only",
  elapsedMs: 12_000,
  settings: [],
  days: cores.map((identity, day) => ({ day, identity, promoted: day > 0 && identity > cores[day - 1]! ? identity - cores[day - 1]! : 0, alive: 100 + day })),
  early: [{ id: "m1" }],
});

test("a replay reads as the core on day 1, each seventh day and the last, with its promotions", () => {
  const r = readRecord("replay", replayRecord([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 3]), null);
  expect(r.rows).toEqual({ build: null, "core, day 1": 0, "core, day 7": 1, "core, day 14": 2, "core, day 15": 3, "promoted, all days": 3, "early promotions": 1, "alive, last day": 115 });
  expect(r.tokens).toBeNull();
});

test("a week reads its core by day, its nights, its page by numbers, and its tokens", () => {
  const rec = {
    elapsedMs: 60_000,
    settings: [{ module: "physics", key: "CORE_FAST_GAP_DAYS", value: 1, was: 2 }],
    usage: { calls: 3, unread: 0, input: 10, output: 20, cacheRead: 300, cacheCreate: 4, costUsd: 0.5 },
    daily: [{ day: 1, alive: 10, core: 0 }, { day: 2, alive: 14, core: 1 }],
    nights: [{ state: "done" }, { state: "failed" }],
    sessions: [{ footnotes: 2, failedTurns: 0 }, { footnotes: 3, failedTurns: 1 }],
    page: { version: 2, bytes: 900, lines: 12, by: "reflection", cites: 4, claims: 6, uncited: 1 },
  };
  const r = readRecord("week", rec, "page words");
  expect(r.rows).toMatchObject({ "core, end of day 1": 0, "core, end of day 2": 1, "memories, last day": 14, "nights done": 1, "footnotes shown": 5, "failed turns": 1, "page version": 2, "page bytes": 900, "page cites": 4, "page claims": 6, "page uncited claims": 1 });
  expect(r.tokens).toBe(334);
  expect(r.calls).toBe(3);
  expect(r.settings).toEqual(["physics.CORE_FAST_GAP_DAYS=1"]);
  expect(r.pageText).toBe("page words");
});

test("an older build's record (no settings, usage or page) reads as unknowns, not zeros", () => {
  const r = readRecord("week", { elapsedMs: 1, daily: [], nights: [], sessions: [] }, null);
  expect(r.tokens).toBeNull();
  expect(r.calls).toBeNull();
  expect(r.settings).toEqual([]);
  expect(r.rows["page version"]).toBeNull();
  const none = readRecord("night", { night: { state: "done" }, dream: null, reflection: null, page: null }, null);
  expect(none.rows["page version"]).toBe("none");
  expect(none.rows["dream returns"]).toBeNull();
});

test("a night reads the run's own dream and reflection (the replayed side of each pair)", () => {
  const r = readRecord(
    "night",
    { night: { state: "done" }, dream: { changes: { recorded: { link: 9 }, replayed: { link: 3, merge: 1 } }, returns: { recorded: 8, replayed: 2 } }, reflection: { cites: { recorded: 5, replayed: 7 }, returns: { recorded: 5, replayed: 6 } } },
    null,
  );
  expect(r.rows).toMatchObject({ night: "done", "dream link": 3, "dream merge": 1, "dream returns": 2, "reflection cites": 7, "reflection returns": 6 });
});

test("lines changed counts lines on either side the other lacks, blank lines aside", () => {
  expect(linesChanged("a\nb\nc", "a\nb\nc")).toBe(0);
  expect(linesChanged("a\nb\nc", "a\nB\nc")).toBe(2);
  expect(linesChanged("a\n\nb", "a\nb\n\n")).toBe(0);
  expect(linesChanged("a\na", "a")).toBe(1);
  expect(linesChanged("", "x\ny")).toBe(2);
});

test("a cell shows one value when the runs agree, each run's when they don't", () => {
  expect(cell([3, 3])).toBe("3");
  expect(cell([3, 4, 3])).toBe("3 / 4 / 3");
  expect(cell([null])).toBe("—");
  expect(cell([])).toBe("—");
  expect(cell([0.25])).toBe("0.25");
});

const side = (name: "base" | "variant", set: string[], runs: SideResult["runs"]): SideResult => ({ plan: { name, ref: null, set }, sha: "abcdef1234", dirty: true, runs });

test("the table marks where the sides differ, says a failed run and a build that ignored --set, and shows a side's own spread", () => {
  const ok = (core: number, page: string, settings: string[] = []): SideResult["runs"][number] => ({
    ...readRecord("week", { elapsedMs: 120_000, settings: [], usage: { calls: 2, input: 1, output: 1, cacheRead: 0, cacheCreate: 0, costUsd: 0 }, daily: [{ day: 1, alive: 5, core }], nights: [], sessions: [], page: { version: 1, bytes: 10, lines: 1, by: null, cites: null, claims: null, uncited: null } }, page),
    settings,
  });
  const failed = { ok: false, error: "boom", elapsedMs: null, tokens: null, costUsd: null, calls: null, unread: null, settings: [], rows: {}, pageText: null };
  const text = renderCompare("week", [
    side("base", [], [ok(0, "a\nb"), ok(0, "a\nc")]),
    side("variant", ["physics.CORE_FAST_GAP_DAYS=1"], [ok(2, "a\nx"), failed]),
  ]);
  expect(text).toContain("variant run 2 FAILED: boom");
  expect(text).toContain("its record says settings [], asked [physics.CORE_FAST_GAP_DAYS=1]");
  expect(text).toMatch(/core, end of day 1\s+0\s+2\s+≠/);
  expect(text).toMatch(/page lines differing, run 1 vs later runs\s+2/);
  expect(text).toContain("(uncommitted changes)");
});

test("one run a side says it is one sample", () => {
  const r = readRecord("night", { night: { state: "done" } }, null);
  expect(renderCompare("night", [side("base", [], [r]), side("variant", ["physics.CORE_FAST_GAP_DAYS=1"], [r])])).toContain("one sample");
  expect(renderCompare("replay", [side("base", [], [r]), side("variant", ["x.Y=1"], [r])])).not.toContain("one sample");
});

// ── the page ────────────────────────────────────────────────────────────────

test("a store with no page reads as none, and its page file is written empty", () => {
  const dir = join(root, "store");
  mkdirSync(dir);
  const out = join(root, "page.md");
  expect(pageReading(dir, out)).toBeNull();
  expect(existsSync(out)).toBe(true);
  expect(readFileSync(out, "utf8")).toBe("");
});

// ── the review's cases (#566) ───────────────────────────────────────────────

test("the mode's paths are made absolute against where the compare was started, flags and other values left alone", () => {
  expect(absolutePaths(["--dir", "night-1019", "--model", "--source", "/abs/x.sqlite", "--days", "2"], "/home/me")).toEqual([
    "--dir", "/home/me/night-1019", "--model", "--source", "/abs/x.sqlite", "--days", "2",
  ]);
  expect(absolutePaths(["--dir", "--model"], "/home/me")).toEqual(["--dir", "--model"]);
});

test("a record's settings match what was asked by value, in any order", () => {
  expect(sameSettings(["physics.A=1"], ["physics.A=1.0"])).toBe(true);
  expect(sameSettings(["physics.B=true", "physics.A=1"], ["physics.A=1", "physics.B=true"])).toBe(true);
  expect(sameSettings([], ["physics.A=1"])).toBe(false);
  expect(sameSettings(["physics.A=2"], ["physics.A=1"])).toBe(false);
});

test("a ref that doesn't exist is refused before any side runs", () => {
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...a: string[]): void => {
    spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  };
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  const said: string[] = [];
  let code = "none";
  try {
    runCompare({ mode: "replay", branch: "no-such-ref", set: [], baseSet: [], runs: 1, passthrough: [], repo, onProgress: (l) => said.push(l) });
  } catch (e) {
    code = e instanceof CompareError ? e.code : String(e);
  }
  expect(code).toBe("COMPARE_GIT");
  expect(said).toEqual([]);
  expect(spawnSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf8" }).stdout.trim().split("\n")).toHaveLength(1);
});

test("the compare refuses a flag it doesn't have, or a mode flag before --, without running anything", () => {
  const cli = join(import.meta.dir, "..", "tools", "harness", "cli.ts");
  const run = (...a: string[]): { status: number | null; err: string } => {
    const r = spawnSync(process.execPath, [cli, "compare", ...a], { encoding: "utf8", cwd: root });
    return { status: r.status, err: r.stderr };
  };
  expect(run("--mode", "replay", "--bogus").err).toContain("compare has no --bogus");
  expect(run("--mode", "replay", "--set", "physics.CORE_FAST_GAP_DAYS=1", "--source", "x").err).toContain("compare has no --source");
  expect(run("--mode", "replay", "--set", "physics.CORE_FAST_GAP_DAYS=1", "--runs", "abc").err).toContain("COMPARE_RUNS");
  expect(run("--mode", "replay", "--set", "physics.CORE_FAST_GAP_DAYS=1", "--runs", "abc").status).toBe(1);
});

test("a week or night record whose page couldn't be read says so in its row", () => {
  expect(readRecord("week", { daily: [], nights: [], sessions: [], page: { error: "locked" } }, null).rows["page version"]).toBe("unread");
});
