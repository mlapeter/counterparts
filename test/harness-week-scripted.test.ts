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
import { McpServer } from "../src/adapters/mcp/index.js";
import { Counterpart } from "../src/core/counterpart.js";
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

test("the check-ins week runs through the real hooks with no model: remembers land, every check-in is owed and written up by the next night, Last here follows", async () => {
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
  const count = (sql: string): number => (db.query(sql).get() as { n: number }).n;
  // Three sessions noted something in the moment; the nights wrote every session up, second-hand, as its own.
  expect(count("SELECT COUNT(DISTINCT origin_session) AS n FROM memories WHERE type = 'memory' AND archived = 0 AND meta NOT LIKE '%secondHand%'")).toBe(3);
  expect(count("SELECT COUNT(DISTINCT origin_session) AS n FROM memories WHERE type = 'memory' AND archived = 0")).toBe(10);
  db.close();
  const d1 = r.sessions[0]!.coverage!;
  expect(d1.written).toBeGreaterThan(0);
  expect(d1.unwritten).toBeLessThan(d1.pieces);
  // S2 (2026-10-26), THE AFTER: a check-in that left no record of its own (no handback, no chapter, no write-up)
  // owes what it said whatever its size; its in-session `remember`s claim their own turns only. Until S2 (0.3.37)
  // every one of these was under the floor (3 pieces over 15 minutes) and never owed.
  for (const s of r.sessions) {
    expect(s.coverage).not.toBeNull();
    expect(s.coverage!.state).toBe("ended");
    expect(s.coverage!.overFloor).toBe(false);
    expect(s.coverage!.owed).toBe(true);
    expect(s.coverage!.whyNot).toBeNull();
  }
  // PINNED AS OF S2: the night timing. Each morning's first prompt finds yesterday's check-ins owed and starts a night;
  // with too little new for a dream (yesterday's notes alone: the scripted dream drained the queue the night before)
  // it is the catch-up alone. Its write-ups bring the queue to three on days 2 and 4, so the ordinary relaunch runs
  // the whole night at that day's second session; on day 7, two owed write-ups and two new memories make four, so
  // the morning's night runs whole (owed write-ups count as new, `dream.OWED_COUNTS_AS_NEW`; with it off, day 8's).
  // Before S2 there was no night all week. A later gate change is expected to move this: update the pin rather than
  // reading it as a regression.
  expect(r.nights.map((n) => [n.day, n.launchedIn, n.kind])).toEqual([
    [2, "d2s1", "catch-up:too-little-new"],
    [2, "d2s2", "night"],
    [3, "d3s1", "catch-up:too-little-new"],
    [4, "d4s1", "catch-up:too-little-new"],
    [4, "d4s2", "night"],
    [5, "d5s1", "catch-up:too-little-new"],
    [6, "d6s1", "catch-up:too-little-new"],
    [7, "d7s1", "night"],
    [8, "d8s1", "catch-up:too-little-new"],
  ]);
  // Each night's catch-up takes what is owed by then — one part per check-in, all in one batch — and writes it up
  // through the real door (the scripted catch-up seat), so nothing carries to the next night: 10 parts in the week.
  expect(r.nights.map((n) => n.catchUp!.planned.map((p) => p.session))).toEqual([["d1s1"], ["d2s1"], ["d2s2"], ["d3s1"], ["d4s1"], ["d4s2"], ["d5s1"], ["d6s1", "d6s2"], ["d7s1"]]);
  for (const n of r.nights) {
    expect(n.catchUp!.planned.every((p) => p.parts === 1 && p.of === 1)).toBe(true);
    expect(n.catchUp!.ran).toMatchObject({ state: "done", written: n.catchUp!.planned.length, left: 0, partsLeft: 0 });
    expect(n.asked[0]!.act).toBe("catch-up");
    // A whole night asks its dream (journaled by the script) and goes on to the refused reflection.
    if (n.kind === "night") expect(n.asked.map((a) => a.act)).toContain("dream");
    else expect(n.asked.map((a) => a.act)).toEqual(["catch-up"]);
  }
  expect(r.owedAtEnd).toEqual([]);
  expect(r.wakes.filter((k) => k.morning).map((k) => k.gate.reason)).toEqual(["first-day", ...Array(7).fill("too-little-new")]);
  // "Last here" names the newest session each morning — a check-in with no chapter — and "Last said here" the same one.
  // Until S2 it named nothing all week.
  const mornings = r.wakes.filter((k) => k.morning && k.label !== "d1s1");
  expect(mornings.map((k) => k.lastHere?.session)).toEqual(["d1s1", "d2s2", "d3s1", "d4s2", "d5s1", "d6s2", "d7s1"]);
  for (const k of mornings) {
    expect(k.lastHere?.episode).toBeNull();
    expect(k.lastSaid).toBe(k.lastHere?.session ?? "none");
  }
  // Nothing of the script's words in the record, nor of the store's.
  const json = JSON.stringify(r);
  expect(json).not.toContain("grumpy");
  expect(json).not.toContain("Priya");
  expect(renderWeek(r)).toContain("model calls 0");
  // The harness's own choices are said as such, so nobody reads them as product behaviour.
  expect(r.install).toBe("without-meeting");
  expect(renderWeek(r)).toContain("HARNESS, NOT PRODUCT: scripted seat");
  expect(renderWeek(r)).toContain("HARNESS, NOT PRODUCT: began without the meeting");
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
        onAsk: { memories: ["The owner wants tomatoes on the south bed."], handoff: "Plant the tomato starts on the south bed on Saturday." },
        turns: [
          { say: "one more: tomatoes or beans on the south bed?", remember: ["The owner is choosing between tomatoes and beans for the south bed."] },
          ...Array.from({ length: 8 }, (_, i) => ({ say: `thinking it through out loud, part ${String(i + 1)}, the south bed gets the most sun of all of them`, after: 5 })),
          { say: "ok, tomatoes it is", remember: ["The owner chose tomatoes for the south bed."], chapter: { title: "Choosing the south bed", text: "We talked the south bed through and settled on tomatoes." } },
        ],
      },
    ],
  },
  {
    sessions: [
      { scope: "chat", turns: [{ say: "morning, quick hello" }] },
      // The default answer to an ask: a `session_end` with no memories ("nothing new"), which the server accepts.
      { scope: "chat", turns: Array.from({ length: 8 }, (_, i) => ({ say: `an afternoon note about the compost heap, number ${String(i + 1)}, long enough to count`, after: 5 })) },
    ],
  },
];

test("a night the gate launches runs its catch-up through the real door and a scripted dream, and refuses every other child; asks answered and ignored; a tail after a handback is not owed; Last here names the chapter, then the newer session", async () => {
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
  const compost = r.sessions.find((s) => s.label === "d2s2")!;
  expect(compost.asks).toBeGreaterThan(0);
  expect(compost.asksAnswered).toBe(compost.asks);
  // THE TAIL AFTER A HANDBACK (S2): the compost session answered its ask, then said two more lines over five minutes.
  // It left a record of its own, so the floor (3 pieces over 15 minutes) still decides, and its tail owes nothing.
  expect(compost.coverage).toMatchObject({ owed: false, whyNot: "under-floor:pieces", unwritten: 2 });
  // A ONE-LINE SESSION WITH NO RECORD (S2): "morning, quick hello" is owed. Until S2 it was under the floor.
  const hello = r.sessions.find((s) => s.label === "d2s1")!;
  expect(hello.coverage).toMatchObject({ owed: true, whyNot: null, unwritten: 1, overFloor: false });
  // WITHOUT THE MEETING the first lived day is over at the first boundary, so the gate is due by
  // the second session's first prompt (3 new memories): the product launches the night there, on
  // day 1. Its scripted dream journals, so day 2 finds too little new and nothing owed from an
  // earlier day: no night. Day 3's first prompt finds the one-line hello owed (S2), and with too
  // little new the night is its catch-up alone.
  // PINNED AS OF S2: the night timing and catch-up rows. A later gate change is expected to move them;
  // update the pin to the new timing rather than reading the change as a regression.
  expect(r.nights.map((n) => [n.day, n.launchedIn, n.kind])).toEqual([
    [1, "d1s2", "night"],
    [3, "d3s1", "catch-up:too-little-new"],
  ]);
  // Each night's catch-up takes what is owed then, and the scripted catch-up seat writes it up through the real door:
  // the long day-1 session that ignored its ask on night 1, the one-line hello on day 3's.
  expect(r.nights.map((n) => n.catchUp!.planned)).toEqual([[{ session: "d1s1", parts: 1, of: 1 }], [{ session: "d2s1", parts: 1, of: 1 }]]);
  for (const n of r.nights) {
    expect(n.catchUp!.ran).toEqual({ state: "done", granted: 1, written: 1, left: 0, partsLeft: 0 });
    expect(n.asked[0]!.act).toBe("catch-up");
  }
  // The whole night: the scripted dream journals, then the reflection and the tags are asked, and refused.
  expect(r.nights[0]!.asked.map((a) => a.act)).toEqual(["catch-up", "dream", "reflection", "tags"]);
  expect(r.nights[0]!.state).toBe("partial");
  // The catch-up alone: nothing else is asked, and it is done.
  expect(r.nights[1]!.asked.map((a) => a.act)).toEqual(["catch-up"]);
  expect(r.nights[1]!.state).toBe("done");
  // Day 2's wake: "Last here" names the chapter day 1's second session wrote.
  const morning = r.wakes.find((k) => k.label === "d2s1")!;
  expect(morning.lastHere?.session).toBe("d1s2");
  expect(morning.lastHere?.episode).toMatch(/^epi_/);
  expect(morning.lines).toContain("Last here");
  // The handoff its `session_end` left stands on the next morning's wake, as its pointer line.
  expect(morning.lines).toContain("Handoff");
  // S2: day 2's second session finds a NEWER session than that chapter (the hello): it is named first, the chapter after it.
  const afternoon = r.wakes.find((k) => k.label === "d2s2")!;
  expect(afternoon.lastHere).toEqual({ episode: null, session: "d2s1" });
  expect(afternoon.lines).toContain("Before it");
  // Nothing owed at the end: the nights wrote it all up.
  expect(r.owedAtEnd).toEqual([]);
  expect(JSON.stringify(r)).not.toContain("tomatoes");
});

test("compare runs tier 0 on both sides for free: S2 switched off on the base (the floor alone), on in the variant — the check-ins are owed and the nights plan them", () => {
  const cli = join(import.meta.dir, "..", "tools", "harness", "cli.ts");
  const p = Bun.spawnSync(
    [process.execPath, cli, "compare", "--mode", "week", "--base-set", "coverage.UNRECORDED_OWED_PIECES=1000000000", "--base-set", "dream.OWED_COUNTS_AS_NEW=false", "--", "--seat", "scripted", "--script", "checkins"],
    { env: { ...env(), TMPDIR: root }, stdout: "pipe", stderr: "pipe", cwd: join(import.meta.dir, "..") },
  );
  expect(p.exitCode).toBe(0);
  const text = p.stdout.toString();
  const row = (name: string): string[] => (text.split("\n").find((l) => l.trimStart().startsWith(name)) ?? "").trim().slice(name.length).trim().split(/\s+/);
  expect(row("model children started").slice(0, 2)).toEqual(["0", "0"]);
  expect(row("sessions owed at their end")[0]).toBe("0");
  expect(Number(row("sessions owed at their end")[1])).toBeGreaterThan(0);
  expect(row("night catch-up parts planned")[0]).toBe("0");
  expect(Number(row("night catch-up parts planned")[1])).toBe(10);
  // "Last here" naming a later session with no chapter is not behind a switch: both sides have it.
  expect(row("mornings with a Last here").slice(0, 2)).toEqual(["7", "7"]);
});

test("the CLI refuses a model named for a scripted seat, and an unknown seat", async () => {
  const cli = join(import.meta.dir, "..", "tools", "harness", "cli.ts");
  for (const args of [["--seat", "scripted", "--model", "haiku"], ["--seat", "robot"]]) {
    const p = Bun.spawnSync([process.execPath, cli, "week", ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(1);
  }
});

test("a reflection-only night records no catch-up plan: only a night kind runs one", async () => {
  // A stub model: a turn says "Noted."; the dream child begins and journals a dream; the reflection child does
  // nothing, so the day's reflection is left behind and a later session the same day launches the reflection alone.
  const start = async (p: ChildPlan): Promise<ChildResult> => {
    const e = (JSON.parse(p.args[p.args.indexOf("--mcp-config") + 1]!) as { mcpServers: { counterparts: { env: Record<string, string> } } }).mcpServers.counterparts.env;
    if (e["COUNTERPARTS_NIGHT_CHILD"] === "dream") {
      const at0 = Number(e["HARNESS_NOW"]);
      const copy = Counterpart.open({ dir: e["COUNTERPARTS_DATA_DIR"]!, budgetBytes: 9_000, now: () => at0, timeZone: "UTC" });
      const server = new McpServer({ counterpart: copy, session: e["COUNTERPARTS_SESSION"]!, scope: root, env: { COUNTERPARTS_NIGHT_CHILD: "dream" }, now: () => at0 });
      const b = (await server.call("dream", { phase: "begin", session: e["COUNTERPARTS_SESSION"] })).structuredContent;
      await server.call("dream", { phase: "journal", dream: b["dream"], session: e["COUNTERPARTS_SESSION"], title: "T", text: "A dream." });
      copy.close();
    } else if ((p.args[p.args.indexOf("--allowedTools") + 1] ?? "").includes("mcp__counterparts__remember")) {
      // A person's turn files a memory, as a model calling `remember` would.
      const at0 = Number(e["HARNESS_NOW"]);
      const copy = Counterpart.open({ dir: e["COUNTERPARTS_DATA_DIR"]!, budgetBytes: 9_000, now: () => at0, timeZone: "UTC" });
      copy.store.put({ type: "memory", kind: "fact", body: `A thing said at ${String(at0)}.`, salience: { novelty: null, relevance: 0.7, emotional: 0.3, predictive: 0.6 } });
      copy.close();
    }
    return { code: 0, timedOut: false, error: null, output: JSON.stringify({ type: "result", result: "Noted." }) };
  };
  const remembering = (n: number): ScriptedDay["sessions"][number] => ({ scope: "chat", turns: Array.from({ length: n }, (_, i) => `a line about the garden, number ${String(i + 1)}, long enough to count`) });
  const r = await runWeek({ script: [{ sessions: [remembering(3)] }, { sessions: [remembering(2), remembering(2), remembering(2)] }], scriptName: "reflection-fixture", install: "without-meeting", start, workRoot: join(root, "work"), env: env() });
  expect(r.nights.some((n) => n.kind.startsWith("reflection:"))).toBe(true);
  for (const n of r.nights) {
    if (n.kind.startsWith("reflection:")) expect(n.catchUp).toBeNull();
    else expect(n.catchUp).not.toBeNull();
  }
});
