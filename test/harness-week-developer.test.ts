/**
 * The developer week (`tools/harness/developer-week.ts`, `week --script
 * developer`) and what the harness grew for it (2026-11-04): compactions,
 * lines the host wrote (hand-backs, notices, a declined permission prompt),
 * sessions at their own hours, `after` on a model's turns, checkable
 * expectations (`expectations.ts`), and the trace file.
 *
 * No model anywhere: tier 0 runs with the scripted seat, and the model-seat
 * checks run with a starter that answers from a script. Hermetic: a temp root
 * and a fake HOME, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { DEVELOPER_EXPECTATIONS, DEVELOPER_FOLDERS, DEVELOPER_OWNER, DEVELOPER_WEEK } from "../tools/harness/developer-week.js";
import { probeHits, readExpectations, sectionAt } from "../tools/harness/expectations.js";
import type { ScriptedDay } from "../tools/harness/owner-week.js";
import { renderWeek } from "../tools/harness/cli.js";
import { SERVE_AT_ENV } from "../tools/harness/serve-at.js";
import { resetUsage } from "../tools/harness/usage.js";
import { INTERRUPTED_FOR_TOOL, hostTurns, runWeek } from "../tools/harness/week.js";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-week-developer-test-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetUsage();
});

const noModel = (_p: ChildPlan): Promise<ChildResult> => {
  throw new Error("tier 0 started a model child");
};

const env = (): NodeJS.ProcessEnv => ({ HOME: join(root, "home"), PATH: process.env["PATH"] ?? "", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });

test("the script is a developer's week: four folders, several sessions a day, two compactions, agents and a loop, a declined prompt, an aside every day", () => {
  const sessions = DEVELOPER_WEEK.flatMap((d) => d.sessions);
  expect(new Set(sessions.map((s) => s.scope))).toEqual(new Set(DEVELOPER_FOLDERS));
  expect(DEVELOPER_WEEK.length).toBe(7);
  expect(DEVELOPER_WEEK.filter((d) => d.sessions.length >= 2).length).toBeGreaterThanOrEqual(5);
  const lines = sessions.flatMap((s) => s.turns.map((t) => (typeof t === "string" ? { say: t } : t)));
  expect(lines.filter((t) => "compact" in t && t.compact !== undefined).length).toBe(2);
  expect(lines.filter((t) => "host" in t && t.host === "peer").length).toBe(2);
  expect(lines.filter((t) => "host" in t && t.host === "task-notification").length).toBe(1);
  expect(lines.filter((t) => "declined" in t && t.declined === true).length).toBe(1);
  // A model turn costs a call: the week stays near Dana's size (54 lines; Dana's meaningful week is 43).
  expect(lines.length).toBeLessThanOrEqual(60);
  // Every hour is a working hour of its own, so no two sessions of a day share one.
  for (const d of DEVELOPER_WEEK) expect(new Set(d.sessions.map((s) => s.hour)).size).toBe(d.sessions.length);
  // Each expectation is told where it says, and its probe matches the line that tells it.
  const labelled = DEVELOPER_WEEK.flatMap((d, i) => d.sessions.map((s, k) => ({ label: `d${String(i + 1)}s${String(k + 1)}`, s })));
  for (const e of DEVELOPER_EXPECTATIONS) {
    const at = labelled.find((x) => x.label === e.told);
    expect(at?.s.scope).toBe(e.folder);
    expect(at?.s.turns.some((t) => e.probe.test(typeof t === "string" ? t : t.say))).toBe(true);
  }
});

test("tier 0: the developer week runs through the real hooks with no model; compactions, host lines and the scorecard land in the record", async () => {
  const trace = join(root, "trace.jsonl");
  const r = await runWeek({ script: DEVELOPER_WEEK, scriptName: "developer", owner: DEVELOPER_OWNER, expect: DEVELOPER_EXPECTATIONS, roots: "each", seat: "scripted", start: noModel, workRoot: join(root, "work"), env: env(), trace });
  expect(r.modelCalls).toBe(0);
  // Each folder answered on by itself, as a person's repos are; the recall decisions say what the cross-project bar did.
  expect(r.roots).toBe("each");
  expect(r.recallProjects!.decisions).toBeGreaterThan(0);
  expect(r.recallProjects!.projectSkipped).toBe(0);
  expect(r.sessions.map((s) => s.label)).toEqual(["d1s1", "d1s2", "d1s3", "d2s1", "d2s2", "d2s3", "d3s1", "d3s2", "d3s3", "d4s1", "d4s2", "d4s3", "d5s1", "d5s2", "d6s1", "d7s1", "d7s2"]);
  const by = new Map(r.sessions.map((s) => [s.label, s]));
  expect([by.get("d2s1")!.compactions, by.get("d4s3")!.compactions]).toEqual([1, 1]);
  expect([by.get("d2s2")!.hostLines, by.get("d3s1")!.hostLines, by.get("d4s3")!.hostLines]).toEqual([1, 1, 1]);
  expect(by.get("d3s1")!.declined).toBe(1);
  // A compaction's fresh wake is recorded beside the session's own, and is not a morning.
  expect(r.wakes.filter((w) => w.compact === true).map((w) => [w.label, w.morning])).toEqual([["d2s1", false], ["d4s3", false]]);
  // The scorecard: one row a fact; personal and "us" facts are read in every folder, work facts in their own.
  const rows = r.expectations!;
  expect(rows.map((x) => x.id)).toEqual(DEVELOPER_EXPECTATIONS.map((e) => e.id));
  for (const x of rows) {
    if (x.kind === "work") expect(x.reach.map((y) => y.folder)).toEqual([x.folder]);
    else expect(x.reach.map((y) => y.folder).sort()).toEqual([...DEVELOPER_FOLDERS].sort());
    for (const l of x.leaks) expect(l.folder).not.toBe(x.folder);
    // Every crossing at a prompt says its lane and whether the script judged it relevant.
    for (const l of x.leaks.filter((y) => y.where === "prompt")) expect(l.lane !== undefined && l.relevant !== undefined).toBe(true);
    expect(["ok", "amber", "red"]).toContain(x.grade);
  }
  // The scripted `remember`s are written in the folder they were said in: the store side of separation.
  for (const id of ["W1-seed", "W2-shaping", "W3-nfc", "W4-gpu07", "W5-paper"]) {
    const x = rows.find((y) => y.id === id)!;
    expect(Object.keys(x.store)).toEqual([x.folder]);
  }
  // The record holds no word the run handed the model: probes' matches stay out, only ids and headings.
  expect(JSON.stringify(r)).not.toContain("St. Brigid");
  expect(renderWeek(r)).toContain("P1-partner (personal, told d1s1 in sim)");
  // The trace carries the text, for a person scoring by hand: wakes, turns, the two compactions, each day's store.
  const kinds = readFileSync(trace, "utf8").trim().split("\n").map((l) => (JSON.parse(l) as { kind: string }).kind);
  expect(kinds.filter((k) => k === "compact").length).toBe(2);
  expect(kinds.filter((k) => k === "turn").length).toBe(DEVELOPER_WEEK.flatMap((d) => d.sessions).reduce((n, x) => n + x.turns.length, 0));
  expect(kinds).toContain("night");
  expect(existsSync(`${trace}.store-day7.sqlite`)).toBe(true);
});

test("a declined permission prompt enters nothing: the same session with and without it captures the same pieces", async () => {
  const day = (declined: boolean): ScriptedDay[] => [
    { sessions: [{ scope: "repo", turns: [{ say: "run the linter on this file please, it's small", reply: "Running it." }, { say: "no, don't run it, just read it", reply: "Reading.", ...(declined ? { declined: true } : {}) }, { say: "ok thanks", reply: "Sure." }] }] },
  ];
  const run = async (declined: boolean): Promise<number> => {
    const r = await runWeek({ script: day(declined), seat: "scripted", start: noModel, workRoot: join(root, declined ? "a" : "b"), env: env(), nights: false });
    return r.sessions[0]!.coverage!.pieces;
  };
  expect(await run(true)).toBe(await run(false));
  // The host's own entry, as its transcript reader reads it: plumbing. A hand-back and a notice are the host's, kept.
  expect(hostTurns({ type: "user", message: { role: "user", content: [{ type: "text", text: INTERRUPTED_FOR_TOOL }] } }).map((t) => t.source)).toEqual(["plumbing"]);
  expect(hostTurns({ type: "user", isMeta: true, origin: { kind: "peer" }, message: { role: "user", content: 'Another Claude session sent a message:\n<agent-message from="x">done</agent-message>' } }).map((t) => t.source)).toEqual(["injected"]);
  expect(hostTurns({ type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: "<task-notification>\n<status>completed</status>\n</task-notification>" } }).map((t) => t.source)).toEqual(["injected"]);
});

test("with a model in the seat, a compaction starts the model on a fresh conversation opened by the summary, on the same memory session; `after` moves the clock", async () => {
  const plans: ChildPlan[] = [];
  const start = (p: ChildPlan): Promise<ChildResult> => {
    plans.push(p);
    return Promise.resolve({ code: 0, timedOut: false, error: null, output: JSON.stringify({ type: "result", result: "ok." }) });
  };
  const script: ScriptedDay[] = [
    {
      sessions: [
        {
          scope: "repo",
          hour: 9,
          turns: [
            "first line",
            { say: "second line", after: 30 },
            { say: "third line, after the compaction", compact: "SUMMARY-WORDS: what happened before." },
            { say: "fourth line", declined: true },
          ],
        },
      ],
    },
  ];
  await runWeek({ script, start, install: "without-meeting", nights: false, workRoot: join(root, "work"), env: env() });
  // The person's lines, not a Stop ask put to the model.
  const turns = plans.filter((p) => (p.args[p.args.indexOf("--allowedTools") + 1] ?? "").includes("mcp__counterparts__remember") && !(p.stdin ?? "").includes("(Stop hook feedback)"));
  expect(turns.length).toBe(4);
  const arg = (p: ChildPlan, f: string): string | undefined => (p.args.includes(f) ? p.args[p.args.indexOf(f) + 1] : undefined);
  const a = arg(turns[0]!, "--session-id")!;
  expect(arg(turns[1]!, "--resume")).toBe(a);
  const b = arg(turns[2]!, "--session-id")!;
  expect(b).not.toBe(a);
  expect(arg(turns[3]!, "--resume")).toBe(b);
  expect(turns[2]!.stdin).toContain("continued from a previous conversation");
  expect(turns[2]!.stdin).toContain("SUMMARY-WORDS");
  expect(turns[3]!.stdin).not.toContain("SUMMARY-WORDS");
  expect(turns[3]!.stdin).toContain(INTERRUPTED_FOR_TOOL);
  // One memory session throughout: the server is bound to the hooks' session, not the model's conversation.
  const served = (p: ChildPlan): Record<string, string> => (JSON.parse(arg(p, "--mcp-config")!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
  expect(new Set(turns.map((t) => served(t)[SERVE_AT_ENV.session])).size).toBe(1);
  // The session's own hour; a model's turn takes 3 minutes, and `after` adds its own.
  const now = turns.map((t) => Number(served(t)[SERVE_AT_ENV.now]));
  expect(now[0]).toBe(Date.parse("2026-03-02T09:00:00Z"));
  expect(now[1]! - now[0]!).toBe(33 * 60_000);
  expect(now[2]! - now[1]!).toBe(3 * 60_000);
});

test("expectations: a hit counts after the telling session, leaks are named with their heading, and a folder with no later session says so", () => {
  const wake = "Who I am:\nsomething\n\nElsewhere:\n- evals: the gpu-07 box again\n";
  expect(sectionAt(wake, wake.indexOf("gpu-07"))).toBe("Elsewhere");
  const e = [
    { id: "W", kind: "work" as const, fact: "f", probe: /gpu-07/, told: "s1", folder: "evals", reach: ["evals"], never: "others" as const },
    { id: "P", kind: "personal" as const, fact: "p", probe: /Mochi/, told: "s1", folder: "evals", reach: "every" as const, never: [] },
  ];
  const sessions = [
    { label: "s1", folder: "evals" },
    { label: "s2", folder: "sim" },
    { label: "s3", folder: "evals" },
  ];
  const hits = [
    ...probeHits(e, "gpu-07 and Mochi", { label: "s1", folder: "evals", where: "prompt" }),
    ...probeHits(e, wake, { label: "s2", folder: "sim", where: "wake" }),
    ...probeHits(e, "Mochi", { label: "s3", folder: "evals", where: "prompt" }),
  ];
  const [w, p] = readExpectations(e, hits, sessions, [{ folder: "evals", about: null, text: "gpu-07 failed" }]);
  expect(w!.reach).toEqual([{ folder: "evals", verdict: "missed", first: null, sessions: 1 }]);
  expect(w!.leaks).toEqual([{ label: "s2", folder: "sim", where: "wake", section: "Elsewhere", judged: "by-design" }]);
  // Missing in its own folder is amber for a work fact; a personal fact missing anywhere is red.
  expect(w!.grade).toBe("amber");
  expect(p!.grade).toBe("red");
  expect(w!.store).toEqual({ evals: 1 });
  expect(p!.reach).toEqual([
    { folder: "evals", verdict: "seen", first: "s3", sessions: 1 },
    { folder: "sim", verdict: "missed", first: null, sessions: 1 },
  ]);
});
