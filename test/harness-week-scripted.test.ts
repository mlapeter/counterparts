/**
 * Tier 0 of the scripted week (`tools/harness/week.ts`, `seat: "scripted"`):
 * the same host — Claude Code's own adapter in-process on the harness's
 * clock, its real `sessionStart` / `userPromptSubmit` / `stop` / `sessionEnd`,
 * the worker boundaries it asks for, `runNight` when its gate launches one —
 * with NO model anywhere. Each line gets the script's canned reply, its
 * scripted `remember` / `chapter` calls go through the memory's own MCP
 * server, a Stop ask is answered with `session_end` or ignored, and the
 * night's seat refuses every ask.
 *
 * Every child goes through the starter, and the starter here throws: a run
 * that reaches it fails. The record's own count says 0 too.
 *
 * Hermetic: a temp root and a fake HOME, removed after.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";

import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { OWNER_WEEK_CHECKINS } from "../tools/harness/checkins-week.js";
import type { ScriptedDay } from "../tools/harness/owner-week.js";
import { renderWeek } from "../tools/harness/cli.js";
import { runWeek } from "../tools/harness/week.js";

let root: string;
let started: number;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-week-scripted-test-")));
  started = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The starter every model child would go through: counted, and it fails the run. */
const noModel = (_p: ChildPlan): Promise<ChildResult> => {
  started += 1;
  throw new Error("tier 0 started a model child");
};

const env = (): NodeJS.ProcessEnv => ({ HOME: join(root, "home"), PATH: process.env["PATH"] ?? "", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });

test("the check-ins week runs through the real hooks with no model: remembers land, no session is owed, no night runs", async () => {
  const out = join(root, "week.sqlite");
  const r = await runWeek({ script: OWNER_WEEK_CHECKINS, scriptName: "checkins", owner: "Robin", seat: "scripted", start: noModel, workRoot: join(root, "work"), out, env: env() });
  expect(started).toBe(0);
  expect(r.modelCalls).toBe(0);
  expect(r.seat).toBe("scripted");
  expect(r.usage.calls).toBe(0);
  expect(r.sessions.map((s) => s.label)).toEqual(["d1s1", "d2s1", "d2s2", "d3s1", "d4s1", "d4s2", "d5s1", "d6s1", "d6s2", "d7s1"]);
  // Every Stop went through the product's pacer, and each says why it asked nothing.
  for (const s of r.sessions) {
    expect(s.stops).toBe(s.turns);
    expect(Object.values(s.stopReasons).reduce((a, n) => a + n, 0)).toBe(s.stops);
    expect(s.remembersRefused).toBe(0);
  }
  // The scripted `remember`s went through the server, bound to their session, and claimed their turn's pieces.
  expect(r.sessions.reduce((a, s) => a + (s.remembers ?? 0), 0)).toBe(3);
  const db = new Database(out, { readonly: true });
  const sessionsWithMemories = (db.query("SELECT COUNT(DISTINCT origin_session) AS n FROM memories WHERE type = 'memory' AND archived = 0").get() as { n: number }).n;
  expect(sessionsWithMemories).toBe(3);
  db.close();
  const d1 = r.sessions[0]!.coverage!;
  expect(d1.written).toBeGreaterThan(0);
  expect(d1.unwritten).toBeLessThan(d1.pieces);
  // THE BEFORE OF S2: every check-in ended, and none is owed: each is under the floor.
  for (const s of r.sessions) {
    expect(s.coverage).not.toBeNull();
    expect(s.coverage!.state).toBe("ended");
    expect(s.coverage!.owed).toBe(false);
    expect(s.coverage!.whyNot).toMatch(/^under-floor:/);
  }
  expect(r.owedAtEnd).toEqual([]);
  // No night: never enough new memories in the dream's window, and nothing owed for a catch-up alone.
  expect(r.nights).toEqual([]);
  expect(r.wakes.filter((k) => k.morning).map((k) => k.gate.reason)).toEqual(["first-day", ...Array(7).fill("too-little-new")]);
  // "Last here" names nothing all week (no chapter); "Last said here" follows the newest session.
  expect(r.wakes.every((k) => k.lastHere === null)).toBe(true);
  expect(r.wakes.find((k) => k.label === "d3s1")!.lastSaid).toBe("d2s2");
  expect(r.wakes.find((k) => k.label === "d8s1")!.lastSaid).toBe("d7s1");
  // Nothing of the script's words in the record, nor of the store's.
  const json = JSON.stringify(r);
  expect(json).not.toContain("grumpy");
  expect(json).not.toContain("Priya");
  expect(renderWeek(r)).toContain("model calls 0");
  expect(readdirSync(join(root, "work"))).toEqual([]);
});

/** Day 1: three remembers (enough for a dream the next morning), a long session that ignores its ask, and a chapter. Day 2: one line. */
const NIGHT: readonly ScriptedDay[] = [
  {
    sessions: [
      {
        scope: "chat",
        onAsk: "ignore",
        turns: [
          { say: "a long evening of talk about the garden and the new beds out back", remember: ["The owner is building raised beds in the back garden."] },
          ...Array.from({ length: 9 }, (_, i) => ({ say: `and another thing about the garden, number ${String(i + 1)}, with enough words to count as substance for the pacer`, after: 5 })),
        ],
      },
      {
        scope: "chat",
        onAsk: { memories: ["The owner wants tomatoes on the south bed."] },
        turns: [
          { say: "one more: tomatoes or beans on the south bed?", remember: ["The owner is choosing between tomatoes and beans for the south bed."] },
          ...Array.from({ length: 8 }, (_, i) => ({ say: `thinking it through out loud, part ${String(i + 1)}, the south bed gets the most sun of all of them`, after: 5 })),
          { say: "ok, tomatoes it is", remember: ["The owner chose tomatoes for the south bed."], chapter: { title: "Choosing the south bed", text: "We talked the south bed through and settled on tomatoes." } },
        ],
      },
    ],
  },
  { sessions: [{ scope: "chat", turns: [{ say: "morning, quick hello" }] }] },
];

test("a night the gate launches runs its catch-up plan with the scripted seat refusing every child; asks answered and ignored; Last here names the chapter", async () => {
  const r = await runWeek({ script: NIGHT, scriptName: "night-fixture", seat: "scripted", start: noModel, workRoot: join(root, "work"), env: env() });
  expect(started).toBe(0);
  expect(r.modelCalls).toBe(0);
  const [long, chose] = r.sessions;
  // The long session asked at a Stop and the script left it unanswered; its words stay unwritten and owed.
  expect(long!.asks).toBeGreaterThan(0);
  expect(long!.asksIgnored).toBe(long!.asks);
  expect(long!.coverage!.owed).toBe(true);
  expect(long!.coverage!.whyNot).toBeNull();
  // The second answered its ask with a `session_end`, and wrote a chapter.
  expect(chose!.asks).toBeGreaterThan(0);
  expect(chose!.asksAnswered).toBe(chose!.asks);
  expect(chose!.chapters).toBe(1);
  // WITHOUT THE MEETING the first lived day is over at the first boundary, so the gate is due by
  // the second session's first prompt (3 new memories): the product launches the night there, on
  // day 1, and again on each morning after, since a refused dream never journals.
  expect(r.nights.map((n) => [n.day, n.launchedIn])).toEqual([
    [1, "d1s2"],
    [2, "d2s1"],
    [3, "d3s1"],
  ]);
  for (const n of r.nights) {
    // Its catch-up planned the owed session first, granted it, and the refused child wrote nothing.
    expect(n.catchUp!.owed).toBe(1);
    expect(n.catchUp!.planned).toEqual([{ session: "d1s1", parts: 1, of: 1 }]);
    expect(n.catchUp!.ran).toEqual({ state: "could-not-start", granted: 1, written: 0, left: 1, partsLeft: 1 });
    expect(n.asked[0]!.act).toBe("catch-up");
    expect(n.asked[n.asked.length - 1]!.act).toBe("dream");
    // A refused dream ends the run: the reflection and the tags are never asked.
    expect(n.asked.map((a) => a.act)).not.toContain("reflection");
    expect(n.asked.map((a) => a.act)).not.toContain("tags");
    expect(n.state).toBe("could-not-start");
  }
  // Day 2's wake: "Last here" names the chapter day 1's second session wrote.
  const morning = r.wakes.find((k) => k.label === "d2s1")!;
  expect(morning.lastHere?.session).toBe("d1s2");
  expect(morning.lastHere?.episode).toMatch(/^epi_/);
  expect(morning.lines).toContain("Last here");
  // Still owed at the end: nobody wrote it up.
  expect(r.owedAtEnd).toContain("d1s1");
  expect(JSON.stringify(r)).not.toContain("tomatoes");
});

test("compare runs tier 0 on both sides for free: lowering the floor makes the check-ins owed and the nights plan them", () => {
  const cli = join(import.meta.dir, "..", "tools", "harness", "cli.ts");
  const p = Bun.spawnSync(
    [process.execPath, cli, "compare", "--mode", "week", "--set", "coverage.OWED_PIECES=1", "--set", "coverage.OWED_SPAN_MS=60000", "--", "--seat", "scripted", "--script", "checkins"],
    { env: { ...env(), TMPDIR: root }, stdout: "pipe", stderr: "pipe", cwd: join(import.meta.dir, "..") },
  );
  expect(p.exitCode).toBe(0);
  const text = p.stdout.toString();
  const row = (name: string): string[] => (text.split("\n").find((l) => l.trimStart().startsWith(name)) ?? "").trim().slice(name.length).trim().split(/\s+/);
  expect(row("model children started").slice(0, 2)).toEqual(["0", "0"]);
  expect(row("sessions owed at their end")[0]).toBe("0");
  expect(Number(row("sessions owed at their end")[1])).toBeGreaterThan(0);
  expect(row("night catch-up parts planned")[0]).toBe("0");
  expect(Number(row("night catch-up parts planned")[1])).toBeGreaterThan(0);
});

test("the CLI refuses a model named for a scripted seat, and an unknown seat", async () => {
  const cli = join(import.meta.dir, "..", "tools", "harness", "cli.ts");
  for (const args of [["--seat", "scripted", "--model", "haiku"], ["--seat", "robot"]]) {
    const p = Bun.spawnSync([process.execPath, cli, "week", ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(1);
  }
});
