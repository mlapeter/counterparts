/**
 * THE BUILD STAMP (2026-10-22, provenance): which build wrote a row.
 *
 *   - the build log in `meta`: `build.<version>.since` and
 *     `build.<version>.settings`, written once per build at its first
 *     writable open, never again, never under observer;
 *   - `build: <version>` on rows that carry JSON, at write time: a memory's
 *     meta at birth (remember, session_end), event payloads (recall.decision,
 *     dream.*), a dream change's detail, a reflection's detail;
 *   - doctor's Builds line; the harness's run records and compare rows;
 *   - "unknown" when the manifest can't be read, and nothing breaks.
 *
 * Through the real doors: Counterpart.open, the MCP tools, the turn's recall,
 * `counterparts doctor`. Hermetic: every test makes and removes its own temp
 * data dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLogFindings } from "../src/adapters/claude-code/doctor.js";
import { run } from "../src/adapters/cli/index.js";
import { Dashboard } from "../src/adapters/dashboard/index.js";
import { renderActivity } from "../src/adapters/dashboard/activity.js";
import type { Io } from "../src/adapters/cli/index.js";
import { McpServer } from "../src/adapters/mcp/index.js";
import { recordSession } from "../src/adapters/sessions.js";
import { Counterpart } from "../src/core/counterpart.js";
import type { PutInput } from "../src/core/store/index.js";
import {
  BUILD_UNKNOWN,
  buildLogKeys,
  parseBuildLog,
  readBuildFrom,
  runningBuild,
  setRunningBuild,
  withBuild,
} from "../src/core/store/operational.js";
import { readRecord, renderCompare } from "../tools/harness/compare.js";
import { applySettings, restoreSettings } from "../tools/harness/settings.js";

let root: string;
let dir: string;
const open: Counterpart[] = [];
let offsetMs = 0;
const SESSION = "s-build";

beforeEach(() => {
  offsetMs = 0;
  root = mkdtempSync(join(tmpdir(), "counterparts-build-stamp-"));
  dir = join(root, "store");
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  setRunningBuild(undefined);
  restoreSettings();
  rmSync(root, { recursive: true, force: true });
});

/** Moves the test clock to noon today (the session TTL and `today` agree all day). */
function atNoon(): void {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  offsetMs = noon.getTime() - Date.now();
}

function brain(opts: { observer?: boolean } = {}): Counterpart {
  const c = Counterpart.open({
    dir,
    ...(opts.observer === true ? { observer: true } : { identity: { name: "Mike" } }),
    now: () => Date.now() + offsetMs,
  });
  open.push(c);
  return c;
}

function shut(c: Counterpart): void {
  open.splice(open.indexOf(c), 1);
  c.close();
}

function mem(c: Counterpart, body: string, over: Partial<PutInput> = {}): string {
  const day = c.store.livedDay();
  return c.store.put({
    type: "memory",
    kind: "fact",
    body,
    salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
    physics: { birthDay: day, lastUsedDay: day },
    ...over,
  });
}

function server(c: Counterpart): McpServer {
  recordSession(dir, { sessionId: SESSION, scope: "/proj", phase: "start", at: Date.now() + offsetMs });
  return new McpServer({ counterpart: c, scope: "/proj", registryDir: dir, now: () => Date.now() + offsetMs });
}

/** Every `build.*` meta row, as the store holds it. */
function logRows(c: Counterpart): Record<string, string> {
  return Object.fromEntries(c.store.metaWithPrefix("build."));
}

function payloads(c: Counterpart, name: string): Record<string, unknown>[] {
  return c.store.eventLog({ name, limit: 500 }).map((r) => JSON.parse(r.payload ?? "null") as Record<string, unknown>);
}

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe("the version this process runs", () => {
  test("is the package's own manifest's, and 'unknown' when there is none to read", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as { version: string };
    expect(runningBuild()).toBe(pkg.version);
    expect(readBuildFrom(join(root, "nope", "package.json"))).toBe(BUILD_UNKNOWN);
    const bad = join(root, "package.json");
    writeFileSync(bad, "{ not json");
    expect(readBuildFrom(bad)).toBe(BUILD_UNKNOWN);
    writeFileSync(bad, JSON.stringify({ name: "x" }));
    expect(readBuildFrom(bad)).toBe(BUILD_UNKNOWN);
    writeFileSync(bad, JSON.stringify({ version: "1.2.3" }));
    expect(readBuildFrom(bad)).toBe("1.2.3");
  });

  test("withBuild stamps a JSON object, leaves null and arrays alone, and keeps a payload's own build", () => {
    setRunningBuild("7.0.0");
    expect(withBuild<Record<string, unknown>>({ a: 1 })).toEqual({ a: 1, build: "7.0.0" });
    expect(withBuild({ build: "6.0.0" })).toEqual({ build: "6.0.0" });
    expect(withBuild(null)).toBeNull();
    expect(withBuild([1, 2])).toEqual([1, 2]);
  });
});

describe("the build log: once per build, at its first writable open", () => {
  test("a store opened by a new version writes its two rows once, not again on the next open, and the next version adds its own", () => {
    setRunningBuild("9.9.1");
    const first = brain();
    first.store.advanceClock("2026-09-10");
    first.store.advanceClock("2026-09-11");
    const keys1 = buildLogKeys("9.9.1");
    expect(logRows(first)).toEqual({ [keys1.since]: "0", [keys1.settings]: "[]" });
    shut(first);

    // The same build again, days later: nothing rewritten.
    const again = brain();
    expect(again.store.livedDay()).toBeGreaterThan(0);
    expect(logRows(again)).toEqual({ [keys1.since]: "0", [keys1.settings]: "[]" });
    const day = again.store.livedDay();
    shut(again);

    // A new build: its own rows, at the lived day it arrived; the old ones untouched.
    setRunningBuild("9.9.2");
    const next = brain();
    const keys2 = buildLogKeys("9.9.2");
    expect(logRows(next)).toEqual({
      [keys1.since]: "0",
      [keys1.settings]: "[]",
      [keys2.since]: String(day),
      [keys2.settings]: "[]",
    });
    expect(next.store.buildLog().map((l) => [l.build, l.since])).toEqual([
      ["9.9.1", 0],
      ["9.9.2", day],
    ]);
    shut(next);

    // Under observer nothing is written, a new build or not.
    setRunningBuild("9.9.3");
    const look = brain({ observer: true });
    expect(Object.keys(logRows(look))).not.toContain(buildLogKeys("9.9.3").since);
  });

  test("the settings row names what the harness set for the run", () => {
    applySettings(["physics.CORE_FAST_GAP_DAYS=1"]);
    const c = brain();
    const settings = JSON.parse(logRows(c)[buildLogKeys(runningBuild()).settings] ?? "null") as { module: string; key: string; value: unknown }[];
    expect(settings.map((s) => [s.module, s.key, s.value])).toEqual([["physics", "CORE_FAST_GAP_DAYS", 1]]);
  });

  test("the log reads back oldest first: by lived day, then by the order the rows went in", () => {
    const rows = [
      { key: "build.0.3.31.since", value: "12" },
      { key: "build.0.3.31.settings", value: "[]" },
      { key: "build.0.3.30.since", value: "12" },
      { key: "build.0.3.30.settings", value: "[]" },
      { key: "build.0.3.29.since", value: "4" },
      { key: "build.weird", value: "x" },
    ];
    expect(parseBuildLog(rows).map((l) => [l.build, l.since, l.settings])).toEqual([
      ["0.3.29", 4, null],
      ["0.3.31", 12, []],
      ["0.3.30", 12, []],
    ]);
  });
});

describe("the stamp on what the mechanisms write", () => {
  test("a memory written through remember and through session_end carries meta.build", async () => {
    setRunningBuild("9.9.4");
    atNoon();
    const c = brain();
    c.store.advanceClock("2026-09-10");
    const s = server(c);
    const r = await s.call("remember", { text: "Mike keeps the release notes in the changelog, newest first.", kind: "fact" });
    expect(r.isError ?? false).toBe(false);
    const e = await s.call("session_end", { session: SESSION, memories: [{ content: "We split the build stamp into a log and a field.", kind: "fact" }] });
    expect(e.isError ?? false).toBe(false);
    const docs = c.store.list({ type: "memory" }).map((id) => c.store.read(id).doc);
    const remembered = docs.find((d) => d.body.includes("changelog"));
    const ended = docs.find((d) => d.body.includes("build stamp"));
    expect(remembered?.meta["build"]).toBe("9.9.4");
    expect(ended?.meta["build"]).toBe("9.9.4");
  });

  test("the turn's recall.decision row carries the build", () => {
    setRunningBuild("9.9.5");
    const c = brain();
    mem(c, "The rotary compost tumbler jammed after the winter freeze.");
    c.recallForTurn({ sessionId: "s1", text: "the rotary compost tumbler jammed again" }, { at: "2026-01-02" });
    const rows = payloads(c, "recall.decision");
    expect(rows.length).toBe(1);
    expect(rows[0]!["build"]).toBe("9.9.5");
  });

  test("a dream's change and its events, and the reflection's row, carry the build through the dream and reflect tools", async () => {
    setRunningBuild("9.9.6");
    atNoon();
    const c = brain();
    c.store.advanceClock("2026-09-10");
    for (let d = 11; d <= 20; d += 1) c.store.advanceClock(`2026-09-${String(d)}`);
    const a = mem(c, "The migration step must run before the container boots, or it boots empty.");
    mem(c, "Mike likes to talk decisions through out loud before he commits to one.", { kind: "person" });
    const s = server(c);
    const begin = await s.call("dream", { phase: "begin", session: SESSION });
    expect(begin.isError ?? false).toBe(false);
    const dreamId = begin.structuredContent["dream"] as string;
    const p = await s.call("dream", { phase: "propose", session: SESSION, dream: dreamId, changes: [{ action: "replayed", id: a }] });
    expect(p.isError ?? false).toBe(false);
    await s.call("dream", { phase: "journal", session: SESSION, dream: dreamId, text: "A short dream." });

    const changes = c.store.dreamChanges(dreamId);
    expect(changes.length).toBeGreaterThan(0);
    for (const ch of changes) expect((JSON.parse(ch.detail) as Record<string, unknown>)["build"]).toBe("9.9.6");
    const dreamRows = c.store.eventLog({ limit: 500 }).filter((r) => r.name.startsWith("dream.") && r.payload !== null);
    expect(dreamRows.length).toBeGreaterThan(0);
    for (const r of dreamRows) expect((JSON.parse(r.payload!) as Record<string, unknown>)["build"]).toBe("9.9.6");

    const rb = await s.call("reflect", { phase: "begin", session: SESSION, dream: dreamId });
    expect(rb.isError ?? false).toBe(false);
    const rid = rb.structuredContent["reflection"] as string;
    expect(c.store.reflection(rid)?.detail).toBeDefined();
    expect((JSON.parse(c.store.reflection(rid)!.detail) as Record<string, unknown>)["build"]).toBe("9.9.6");
    const fin = await s.call("reflect", { phase: "finish", session: SESSION, reflection: rid, entry: "A full day." });
    expect(fin.isError ?? false).toBe(false);
    expect((JSON.parse(c.store.reflection(rid)!.detail) as Record<string, unknown>)["build"]).toBe("9.9.6");
  }, 60_000);

  test("a build with the version unknown stamps 'unknown' everywhere and nothing breaks", async () => {
    setRunningBuild(readBuildFrom(join(root, "no-such", "package.json")));
    atNoon();
    const c = brain();
    expect(logRows(c)[buildLogKeys(BUILD_UNKNOWN).since]).toBe("0");
    const s = server(c);
    const r = await s.call("remember", { text: "A note written by a build that could not read its own version.", kind: "fact" });
    expect(r.isError ?? false).toBe(false);
    const doc = c.store.list({ type: "memory" }).map((x) => c.store.read(x).doc).find((d) => d.body.includes("could not read its own version"));
    expect(doc?.meta["build"]).toBe(BUILD_UNKNOWN);
    c.recallForTurn({ sessionId: "s1", text: "a note about its own version" }, { at: "2026-01-02" });
    expect(payloads(c, "recall.decision")[0]!["build"]).toBe(BUILD_UNKNOWN);
    expect(buildLogFindings(c.store)[0]?.detail).toBe("running unknown: unknown since lived day 0");
  });
});

describe("the readers", () => {
  test("doctor prints the last three builds, newest first, and how many came earlier", async () => {
    for (const [v, date] of [
      ["9.8.1", "2026-09-10"],
      ["9.8.2", "2026-09-11"],
      ["9.8.3", "2026-09-12"],
      ["9.8.4", "2026-09-13"],
    ] as const) {
      setRunningBuild(v);
      const c = brain();
      c.store.advanceClock(date);
      shut(c);
    }
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
    const json = capture();
    await run(["doctor", `--config=${configPath}`, "--json"], { io: json.io, env: {}, home: root });
    const report = JSON.parse(json.out.join("\n")) as { findings: { key: string; detail: string; data: Record<string, unknown> }[] };
    const line = report.findings.find((f) => f.key === "build-log");
    expect(line?.detail).toBe("running 9.8.4: 9.8.4 since lived day 3; 9.8.3 since lived day 2; 9.8.2 since lived day 1; 1 earlier");
    expect(line?.data).toEqual({ builds: 4, running: "9.8.4", newest: "9.8.4", since: 3 });
    const plain = capture();
    await run(["doctor", `--config=${configPath}`], { io: plain.io, env: {}, home: root });
    expect(plain.out.join("\n")).toContain("running 9.8.4: 9.8.4 since lived day 3; 9.8.3 since lived day 2; 9.8.2 since lived day 1");
  });

  test("after a downgrade doctor names the build running, not the newest logged (review of #591: 0.3.30 → 0.3.31 → 0.3.30)", async () => {
    for (const [v, date] of [
      ["0.3.30", "2026-09-10"],
      ["0.3.31", "2026-09-11"],
      ["0.3.30", "2026-09-12"],
    ] as const) {
      setRunningBuild(v);
      const c = brain();
      c.store.advanceClock(date);
      shut(c);
    }
    // The third open logged nothing (one row per version), but what it writes is stamped 0.3.30.
    const c = brain();
    const id = mem(c, "Written after the downgrade.");
    expect(c.store.read(id).doc.meta["build"]).toBe("0.3.30");
    expect(c.store.buildLog().map((l) => l.build)).toEqual(["0.3.30", "0.3.31"]);
    shut(c);
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000, embedder: { enabled: false } }));
    const json = capture();
    await run(["doctor", `--config=${configPath}`, "--json"], { io: json.io, env: {}, home: root });
    const report = JSON.parse(json.out.join("\n")) as { findings: { key: string; detail: string; data: Record<string, unknown> }[] };
    const line = report.findings.find((f) => f.key === "build-log");
    expect(line?.detail).toBe("running 0.3.30, newest logged 0.3.31: 0.3.31 since lived day 1; 0.3.30 since lived day 0");
    expect(line?.data).toEqual({ builds: 2, running: "0.3.30", newest: "0.3.31", since: 1 });
  });

  test("the dashboard's activity line leaves the build out; the row keeps it", () => {
    setRunningBuild("9.7.1");
    const c = brain();
    c.store.appendEvent({ name: "sleep.cycle", day: 0, payload: { promoted: 2 } });
    shut(c);
    const dash = Dashboard.open({ dir });
    try {
      const out = renderActivity(dash.source, { name: "sleep.cycle", limit: 5 });
      const line = out.split("\n").find((l) => l.includes("promoted 2"));
      expect(line?.trim()).toBe("↳ promoted 2");
      expect(out).not.toContain("9.7.1");
      const row = dash.source.store.eventLog({ name: "sleep.cycle", order: "desc", limit: 1 })[0];
      expect(JSON.parse(row?.payload ?? "{}")["build"]).toBe("9.7.1");
    } finally {
      dash.close();
    }
  });

  test("a compare names each side's build in its table; a record from before the stamp shows none", () => {
    const base = readRecord("week", { build: "0.3.30", elapsedMs: 1, daily: [], nights: [], sessions: [] }, null);
    const variant = readRecord("week", { build: "0.3.31", elapsedMs: 1, daily: [], nights: [], sessions: [] }, null);
    const older = readRecord("week", { elapsedMs: 1, daily: [], nights: [], sessions: [] }, null);
    expect(base.rows["build"]).toBe("0.3.30");
    expect(older.rows["build"]).toBeNull();
    const table = renderCompare("week", [
      { plan: { name: "base", ref: "v0.3.30", set: [] }, sha: "aaaaaaaa", dirty: false, runs: [base] },
      { plan: { name: "variant", ref: null, set: [] }, sha: "bbbbbbbb", dirty: false, runs: [variant] },
    ]);
    const row = table.split("\n").find((l) => l.trim().startsWith("build"));
    expect(row).toContain("0.3.30");
    expect(row).toContain("0.3.31");
    expect(row).toContain("≠");
  });
});
