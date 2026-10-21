/**
 * DID THE CATCH-UP READ? (2026-10-11, after the first live `counterparts
 * catch-up`.)
 *
 * That run closed 16 of its 24 parts with `[]`, about two seconds each. Read
 * back, every one of those parts was already written up before it began — the
 * sessions' own chapters and notes had claimed their words — so the reader was
 * right and the door was wasteful. Three things follow, each held here:
 *
 *   - a part with nothing unwritten is passed over by the door and costs a
 *     catch-up batch nothing (never the last part, which sets the mark);
 *   - a catch-up's `[]` for a part that holds unwritten words needs a one-line
 *     `nothing` reason, or it is refused and the part stays owed — "unread";
 *   - `catch-up --reowe <run>` owes again what a run closed empty while its
 *     words were unwritten, refuses by name what it cannot, and finds nothing
 *     to do for a run whose empty parts were already written up.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No real
 * `claude` is started; the child is an injected starter driving the real MCP
 * server as the runner.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AdapterConfig } from "../src/adapters/config.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { catchUpOf, catchUpWords, grantCatchUp, planCatchUp, releaseCatchUp, runCatchUp } from "../src/adapters/claude-code/night-catch-up.js";
import { claudeCodeSeat, openNightCounterpart } from "../src/adapters/claude-code/night-run.js";
import { applyReowe, reowePlan } from "../src/adapters/claude-code/reowe.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { openLog } from "../src/adapters/log/index.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  WRITE_UP_KEPT_MARK,
  WRITE_UP_PART_BYTES,
  firstUnwrittenPart,
  progressKey,
  readWriteUpProgress,
  recordSession,
  writeUpEntries,
  writeUpPartsDated,
  writeUpPlan,
} from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import { Counterpart } from "../src/core/counterpart.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

let root: string;
let dir: string;
let proj: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-unread-parts-")));
  dir = join(root, "store");
  proj = join(root, "proj");
  for (const d of [dir, proj]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of closers.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

const config = (): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: 9_000 });

function midnight(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
const YESTERDAY_9 = (): number => midnight() - 15 * HOUR;

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/** About `bytes` of distinct prose for piece `i`. */
function prose(id: string, i: number, bytes: number): string {
  const line = `${id} piece ${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs, or the loop loses pressure. `;
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

/**
 * A session that talked yesterday: `kept` long pieces its own chapter then
 * wrote up (a chapter claims every unwritten word before it), then `unkept`
 * more nobody wrote up, then it ended. Each piece about `bytes` long.
 */
function livedWithChapter(id: string, opts: { kept: number; unkept: number; bytes: number }): void {
  let at = YESTERDAY_9();
  const c = Counterpart.open({ dir, now: () => at });
  try {
    recordSession(dir, { sessionId: id, scope: proj, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    const say = (i: number): void => {
      at += 8 * MIN;
      turns.push({ role: "user", text: prose(id, i, opts.bytes) });
      turns.push({ role: "assistant", text: `(${id} #${String(i)}) Understood.` });
      c.captureSpans({ session: id, scope: proj, turns: [...turns] });
    };
    for (let i = 0; i < opts.kept; i++) say(i);
    if (opts.kept > 0) {
      at += MIN;
      expect(c.appendEpisode(id, "What we did: seated the first loops' valves.", { scope: proj, title: "The first loops" }).appended).toBe(true);
    }
    for (let i = opts.kept; i < opts.kept + opts.unkept; i++) say(i);
    c.boundary({ session: id, scope: proj, kind: "stop" });
    recordSession(dir, { sessionId: id, scope: proj, phase: "boundary", at });
    c.boundary({ session: id, scope: proj, kind: "session-end" });
    recordSession(dir, { sessionId: id, scope: proj, phase: "end", at: at + 1 });
  } finally {
    c.close();
  }
}

/** The session's parts as the door cuts them now. */
function partsOf(id: string): ReturnType<typeof writeUpPartsDated> {
  const c = openNightCounterpart(config());
  try {
    return writeUpPartsDated(writeUpEntries(c.spans, { session: id, scopes: [proj] }), WRITE_UP_PART_BYTES);
  } finally {
    c.close();
  }
}

function owes(id: string): boolean {
  const c = openNightCounterpart(config());
  try {
    return writeUpPlan({ store: c.store, spans: c.spans }).find((h) => h.session === id)?.owes === true;
  } finally {
    c.close();
  }
}

function progressOf(id: string): { done: number } | undefined {
  const c = openNightCounterpart(config());
  try {
    return readWriteUpProgress(c.store)[progressKey(id, proj)];
  } finally {
    c.close();
  }
}

/** Grant one batch to `runner` as the launcher does, and return its plan. */
function grant(run: string, runner: string, parts?: number): ReturnType<typeof planCatchUp> {
  const c = openNightCounterpart(config());
  try {
    const plan = planCatchUp(c, { run, runner, now: Date.now(), ...(parts === undefined ? {} : { parts }) });
    const claimed = grantCatchUp(c, plan, { scope: dir, now: Date.now() });
    expect(claimed).not.toBeNull();
    return claimed as NonNullable<typeof claimed>;
  } finally {
    c.close();
  }
}

function release(plan: ReturnType<typeof planCatchUp>): void {
  const c = openNightCounterpart(config());
  try {
    releaseCatchUp(c, plan, { scope: dir, now: Date.now() });
  } finally {
    c.close();
  }
}

/** The runner's MCP server, its write-up answers going to the process log as in production. */
function runnerServer(runner: string): ReturnType<typeof openServer> {
  const log = openLog({ dataDir: dir, proc: "mcp", session: runner, now: () => Date.now() });
  const s = openServer({ dir, session: runner, scope: dir, onEvent: log.event });
  closers.push({ close: () => s.counterpart.close() });
  return s;
}

/** A child that fetches each part and answers as `answer` says, until the door stops it. */
function child(answer: (id: string, part: number) => Record<string, unknown>): (plan: ChildPlan) => Promise<ChildResult> {
  return async (plan) => {
    const runner = plan.env[SESSION_ENV] as string;
    const ids = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1] as string);
    const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
    try {
      for (const id of ids) {
        for (let guard = 0; guard < 12; guard++) {
          const f = payload(await s.call("session_end", { session: runner, writeUp: id }));
          if (f["reason"] !== "part") break;
          const a = payload(await s.call("session_end", { session: runner, writeUp: id, part: f["part"], ...answer(id, f["part"] as number) }));
          if (a["reason"] !== "part-written") break;
        }
      }
    } finally {
      s.counterpart.close();
    }
    return { code: 0, timedOut: false, error: null };
  };
}

const memory = (id: string, part: number): Record<string, unknown> => ({
  memories: [{ content: `From ${id}, part ${String(part)}: the relief valves are seated before the pumps run, or the loops lose pressure.`, kind: "fact" }],
});

function runIt(runId: string, start: (plan: ChildPlan) => Promise<ChildResult>): Promise<Awaited<ReturnType<typeof runCatchUp>>> {
  return runCatchUp({
    open: () => openNightCounterpart(config()),
    config: config(),
    run: runId,
    scope: dir,
    seat: claudeCodeSeat({ config: config(), open: () => openNightCounterpart(config()), startCatchUp: start }),
    now: () => Date.now(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
describe("a part with nothing unwritten is passed over", () => {
  test("parts count what is not yet written up; a kept entry counts nothing, even cut across parts", () => {
    const kept = { text: "k".repeat(30), kept: true, jot: false, at: 1 };
    const fresh = { text: "f".repeat(30), kept: false, jot: false, at: 2 };
    // Each kept entry costs its text and the mark (21 characters): one a part at 60.
    const parts = writeUpPartsDated([kept, kept, fresh], 60);
    expect(parts.map((p) => p.unwritten > 0)).toEqual([false, false, true]);
    // One kept entry longer than a part: every slice is kept, only the first carries the mark.
    const long = writeUpPartsDated([{ text: "k".repeat(100), kept: true, jot: false, at: 1 }, fresh], 40);
    expect(long.length).toBeGreaterThan(2);
    expect(long[0]?.text.startsWith(WRITE_UP_KEPT_MARK)).toBe(true);
    expect(long.slice(0, -1).every((p) => p.unwritten === 0)).toBe(true);
    expect(long[long.length - 1]?.unwritten).toBeGreaterThan(0);
  });

  test("firstUnwrittenPart skips parts with nothing unwritten, but never the last", () => {
    const u = (...xs: number[]): { unwritten: number }[] => xs.map((unwritten) => ({ unwritten }));
    expect(firstUnwrittenPart(u(0, 0, 5, 0), 1)).toBe(3);
    expect(firstUnwrittenPart(u(0, 0, 5, 0), 4)).toBe(4);
    expect(firstUnwrittenPart(u(0, 0, 0), 1)).toBe(3);
    expect(firstUnwrittenPart(u(7), 1)).toBe(1);
  });

  test("the door hands a granted runner the first part with unwritten words, and records the ones before it done", async () => {
    livedWithChapter("chap-1", { kept: 8, unkept: 6, bytes: 7_000 });
    const parts = partsOf("chap-1");
    const first = firstUnwrittenPart(parts, 1);
    // The shape this test needs: at least two parts the chapter wrote up wholly.
    expect(first).toBeGreaterThanOrEqual(3);
    expect(owes("chap-1")).toBe(true);
    const plan = grant("cup_door", "writeup-cup_door");
    const s = runnerServer("writeup-cup_door");
    const f = payload(await s.call("session_end", { session: "writeup-cup_door", writeUp: "chap-1" }));
    expect(f).toMatchObject({ reason: "part", part: first, skipped: first - 1 });
    expect(String(f["next"])).toContain("nothing:");
    expect(progressOf("chap-1")?.done).toBe(first - 1);
    release(plan);
  });

  test("the plan starts the batch at that part: passed-over parts cost no bytes and no place in the batch", () => {
    livedWithChapter("chap-1", { kept: 8, unkept: 6, bytes: 7_000 });
    const parts = partsOf("chap-1");
    const first = firstUnwrittenPart(parts, 1);
    const c = openNightCounterpart(config());
    closers.push(c);
    const plan = planCatchUp(c, { run: "cup_plan", now: Date.now() });
    const s = plan.subjects.find((x) => x.session === "chap-1");
    expect(s).toMatchObject({ from: first, upTo: parts.length, done: 0, served: parts.length - first + 1 });
    expect(s?.passed).toEqual(Array.from({ length: first - 1 }, (_, i) => i + 1));
    const servedBytes = parts.slice(first - 1).reduce((n, p) => n + Buffer.byteLength(p.text, "utf8"), 0);
    expect(s?.bytes).toBe(servedBytes);
  });

  test("a run says how many parts came back already written up in their own session", async () => {
    livedWithChapter("chap-1", { kept: 8, unkept: 6, bytes: 7_000 });
    const parts = partsOf("chap-1");
    const first = firstUnwrittenPart(parts, 1);
    const report = await runIt("cup_passed", child(memory));
    expect(report).toMatchObject({ state: "done", written: 1, parts: parts.length, passed: first - 1, unread: 0 });
    expect(owes("chap-1")).toBe(false);
    expect(catchUpWords(report as NonNullable<typeof report>)).toContain(`${String(first - 1)} of them already written up in their own session`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("a catch-up's empty answer says why, or the part stays owed", () => {
  test("[] with no reason for a part with unwritten words is refused, records nothing, and the same part comes back", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 6, bytes: 6_000 });
    const plan = grant("cup_guard", "writeup-cup_guard");
    const s = runnerServer("writeup-cup_guard");
    const f = payload(await s.call("session_end", { session: "writeup-cup_guard", writeUp: "plain-1" }));
    expect(f["reason"]).toBe("part");
    const part = f["part"] as number;
    const bare = await s.call("session_end", { session: "writeup-cup_guard", writeUp: "plain-1", part, memories: [] });
    expect(bare.isError).toBe(true);
    expect(payload(bare)).toMatchObject({ reason: "reason-required", part });
    expect(progressOf("plain-1")?.done ?? 0).toBe(0);
    // A reason of a word or two is no reason.
    expect(payload(await s.call("session_end", { session: "writeup-cup_guard", writeUp: "plain-1", part, memories: [], nothing: "no" }))["reason"]).toBe("reason-required");
    // Fetching again hands the same part back.
    expect(payload(await s.call("session_end", { session: "writeup-cup_guard", writeUp: "plain-1" }))).toMatchObject({ reason: "part", part });
    // With a reason it closes, nothing minted.
    const reasoned = payload(await s.call("session_end", { session: "writeup-cup_guard", writeUp: "plain-1", part, memories: [], nothing: "only valve checks, all of them routine" }));
    expect(reasoned).toMatchObject({ answer: "nothing-new", deposited: 0 });
    expect(["part-written", "written-up"]).toContain(String(reasoned["reason"]));
    release(plan);
  });

  test("a live session's [] stays a real answer, with no reason asked", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 6, bytes: 2_000 });
    // The ordinary path: a session the SessionStart pointer named.
    recordSession(dir, { sessionId: "live-9", scope: proj, phase: "start", at: Date.now(), writeUpPointer: "plain-1" });
    const s = openServer({ dir, session: "live-9", scope: proj });
    closers.push({ close: () => s.counterpart.close() });
    const f = payload(await s.call("session_end", { session: "live-9", writeUp: "plain-1" }));
    expect(f["reason"]).toBe("part");
    const a = payload(await s.call("session_end", { session: "live-9", writeUp: "plain-1", part: f["part"], memories: [] }));
    expect(["part-written", "written-up"]).toContain(String(a["reason"]));
  });

  test("a run whose child answers [] with no reason: those parts are unread, stay owed, and the words say so", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 6, bytes: 6_000 });
    const report = await runIt("cup_bare", child(() => ({ memories: [] })));
    expect(report).toMatchObject({ state: "partial", written: 0, parts: 0 });
    expect(report?.unread).toBeGreaterThan(0);
    expect(owes("plain-1")).toBe(true);
    expect(catchUpWords(report as NonNullable<typeof report>)).toContain("unread");
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store, "cup_bare")?.unread).toBe(report?.unread);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("catch-up --reowe <run>", () => {
  /** Two parts of a three-part session answered [] (with a reason) by a batch allowed two, then stopped. */
  async function emptyBatch(runId: string): Promise<void> {
    livedWithChapter("plain-1", { kept: 0, unkept: 9, bytes: 7_000 });
    expect(partsOf("plain-1").length).toBeGreaterThanOrEqual(3);
    const runner = `writeup-${runId}`;
    const plan = grant(runId, runner, 2);
    const s = runnerServer(runner);
    for (let k = 0; k < 2; k++) {
      const f = payload(await s.call("session_end", { session: runner, writeUp: "plain-1" }));
      expect(f["reason"]).toBe("part");
      payload(await s.call("session_end", { session: runner, writeUp: "plain-1", part: f["part"], memories: [], nothing: "said only routine things here" }));
    }
    release(plan);
    expect(progressOf("plain-1")?.done).toBe(2);
  }

  test("parts closed empty while their words were unwritten are owed again; nothing else moves", async () => {
    await emptyBatch("cup_bad");
    const c = openNightCounterpart(config());
    closers.push(c);
    const plan = reowePlan(c, "cup_bad", Date.now());
    expect(plan.found).toBe(true);
    expect(plan.subjects).toEqual([expect.objectContaining({ session: "plain-1", empty: [1, 2], unwritten: [1, 2], kept: [], status: "reowe", resetTo: 0 })]);
    expect(applyReowe(c, plan, Date.now())).toEqual(["plain-1"]);
    expect(readWriteUpProgress(c.store)[progressKey("plain-1", proj)]?.done).toBe(0);
  });

  test("the command: the plan, then --dry-run stops; --yes moves; no console and no --yes refuses", async () => {
    await emptyBatch("cup_cli");
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) };
    const env = { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    expect(await run(["catch-up", "--dir", dir, "--reowe", "cup_cli", "--dry-run"], { io, env })).toBe(EXIT.ok);
    expect(out.join("\n")).toContain("would be owed again from part 1");
    expect(out.join("\n")).toContain("Dry run: nothing was changed.");
    expect(progressOf("plain-1")?.done).toBe(2);
    expect(await run(["catch-up", "--dir", dir, "--reowe", "cup_cli"], { io, env })).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("not an interactive console");
    expect(progressOf("plain-1")?.done).toBe(2);
    expect(await run(["catch-up", "--dir", dir, "--reowe", "cup_cli", "--yes"], { io, env })).toBe(EXIT.ok);
    expect(out.join("\n")).toContain("Owed again: plain-1");
    expect(progressOf("plain-1")?.done).toBe(0);
    // A run id that is not one is a usage mistake.
    expect(await run(["catch-up", "--dir", dir, "--reowe", "nope"], { io, env })).toBe(EXIT.usage);
  });

  test("empty parts the session had already written up: nothing to re-owe", async () => {
    livedWithChapter("chap-1", { kept: 8, unkept: 6, bytes: 7_000 });
    const first = firstUnwrittenPart(partsOf("chap-1"), 1);
    // What the live run's log looked like: the kept parts answered [] by a runner.
    const log = openLog({ dataDir: dir, proc: "mcp", session: "writeup-cup_old", now: () => Date.now() });
    for (let k = 1; k < first; k++) log.event({ at: Date.now(), name: "mcp.write_up", ref: "chap-1", data: { reason: "part-written", part: k, of: partsOf("chap-1").length, deposited: 0, marked: null } });
    const c = openNightCounterpart(config());
    closers.push(c);
    const plan = reowePlan(c, "cup_old", Date.now());
    expect(plan.subjects).toEqual([expect.objectContaining({ session: "chap-1", unwritten: [], status: "nothing-to-reowe" })]);
    expect(plan.subjects[0]?.kept.length).toBe(first - 1);
    expect(applyReowe(c, plan, Date.now())).toEqual([]);
  });

  test("a session the run went on to write up needs its claims taken back: refused by name", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 9, bytes: 7_000 });
    const runner = "writeup-cup_marked";
    const plan = grant("cup_marked", runner);
    const s = runnerServer(runner);
    let first = true;
    for (let guard = 0; guard < 10; guard++) {
      const f = payload(await s.call("session_end", { session: runner, writeUp: "plain-1" }));
      if (f["reason"] !== "part") break;
      const part = f["part"] as number;
      const a = payload(await s.call("session_end", { session: runner, writeUp: "plain-1", part, ...(first ? { memories: [], nothing: "said only routine things here" } : memory("plain-1", part)) }));
      first = false;
      if (a["reason"] !== "part-written") break;
    }
    release(plan);
    expect(owes("plain-1")).toBe(false);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(reowePlan(c, "cup_marked", Date.now()).subjects).toEqual([expect.objectContaining({ session: "plain-1", unwritten: [1], status: "needs-retraction" })]);
  });

  test("words no longer kept, and a run the log never saw, are refused by name", async () => {
    Counterpart.open({ dir }).close();
    const log = openLog({ dataDir: dir, proc: "mcp", session: "writeup-cup_gone", now: () => Date.now() });
    log.event({ at: Date.now(), name: "mcp.write_up", ref: "gone-1", data: { reason: "part-written", part: 1, of: 2, deposited: 0, marked: null } });
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(reowePlan(c, "cup_gone", Date.now()).subjects).toEqual([expect.objectContaining({ session: "gone-1", status: "pruned" })]);
    expect(reowePlan(c, "cup_never", Date.now()).found).toBe(false);
    const err: string[] = [];
    expect(await run(["catch-up", "--dir", dir, "--reowe", "cup_never"], { io: { out: () => undefined, err: (l) => err.push(l) }, env: { PATH: "/usr/bin:/bin" } })).toBe(EXIT.refused);
    expect(err.join("\n")).toContain("keeps a week");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("review of #435: the edges", () => {
  test("a part that mixes kept and unwritten words counts as unwritten, so the door serves it", () => {
    const kept = { text: "k".repeat(30), kept: true, jot: false, at: 1 };
    const fresh = { text: "f".repeat(30), kept: false, jot: false, at: 2 };
    const parts = writeUpPartsDated([kept, fresh, kept], 1_000);
    expect(parts.length).toBe(1);
    expect(parts[0]?.unwritten).toBe(30);
    expect(firstUnwrittenPart([{ unwritten: 0 }, ...parts, { unwritten: 0 }], 1)).toBe(2);
  });

  test("words claimed between the grant and the fetch: the door hands nothing, and no part is recorded done", async () => {
    // The race's direction: claims only ever add kept words, so a plan made
    // before them can only over-serve, never pass over a part with unwritten words.
    livedWithChapter("whole-1", { kept: 0, unkept: 9, bytes: 7_000 });
    expect(owes("whole-1")).toBe(true);
    const plan = grant("cup_whole", "writeup-cup_whole");
    const cc = openNightCounterpart(config());
    try {
      expect(cc.spans.claimCoverage({ scope: proj, session: "whole-1", proposalId: "prp_review" }).length).toBeGreaterThan(0);
    } finally {
      cc.close();
    }
    const parts = partsOf("whole-1");
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.every((p) => p.unwritten === 0)).toBe(true);
    const s = runnerServer("writeup-cup_whole");
    const f = payload(await s.call("session_end", { session: "writeup-cup_whole", writeUp: "whole-1" }));
    expect(f).toMatchObject({ reason: "owes-nothing" });
    expect(progressOf("whole-1")?.done ?? 0).toBe(0);
    release(plan);
  });

  test("a run that stops short after a reasoned [] and a deposit: only the parts never reached are unread", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 12, bytes: 7_000 });
    const n = partsOf("plain-1").length;
    expect(n).toBeGreaterThanOrEqual(4);
    const stopAfterTwo = async (plan: ChildPlan): Promise<ChildResult> => {
      const runner = plan.env[SESSION_ENV] as string;
      const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
      try {
        for (let k = 1; k <= 2; k++) {
          const f = payload(await s.call("session_end", { session: runner, writeUp: "plain-1" }));
          const answer = k === 1 ? { memories: [], nothing: "only routine valve checks here" } : memory("plain-1", k);
          payload(await s.call("session_end", { session: runner, writeUp: "plain-1", part: f["part"], ...answer }));
        }
      } finally {
        s.counterpart.close();
      }
      return { code: 0, timedOut: false, error: null };
    };
    const report = await runIt("cup_short", stopAfterTwo);
    expect(report).toMatchObject({ state: "partial", parts: 2, passed: 0, unread: n - 2 });
  });

  test("--reowe: parts after the empty ones that brought memories back are refused by name", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 12, bytes: 7_000 });
    expect(partsOf("plain-1").length).toBeGreaterThanOrEqual(4);
    const runner = "writeup-cup_dep";
    const plan = grant("cup_dep", runner, 2);
    const s = runnerServer(runner);
    for (let k = 1; k <= 2; k++) {
      const f = payload(await s.call("session_end", { session: runner, writeUp: "plain-1" }));
      const answer = k === 1 ? { memories: [], nothing: "only routine valve checks here" } : memory("plain-1", k);
      expect(payload(await s.call("session_end", { session: runner, writeUp: "plain-1", part: f["part"], ...answer }))["reason"]).toBe("part-written");
    }
    release(plan);
    const c = openNightCounterpart(config());
    closers.push(c);
    const re = reowePlan(c, "cup_dep", Date.now());
    expect(re.subjects).toEqual([expect.objectContaining({ session: "plain-1", empty: [1], deposited: [2] })]);
    expect(["after-deposits", "needs-retraction"]).toContain(String(re.subjects[0]?.status));
    expect(applyReowe(c, re, Date.now())).toEqual([]);
    expect(readWriteUpProgress(c.store)[progressKey("plain-1", proj)]?.done).toBe(2);
  });

  test("--reowe: a session another writer holds right now is refused busy, and nothing moves", async () => {
    livedWithChapter("plain-1", { kept: 0, unkept: 9, bytes: 7_000 });
    const runner = "writeup-cup_busy";
    const plan = grant("cup_busy", runner, 2);
    const s = runnerServer(runner);
    for (let k = 0; k < 2; k++) {
      const f = payload(await s.call("session_end", { session: runner, writeUp: "plain-1" }));
      payload(await s.call("session_end", { session: runner, writeUp: "plain-1", part: f["part"], memories: [], nothing: "said only routine things here" }));
    }
    release(plan);
    // A later run takes the session and is mid-batch.
    const later = grant("cup_later", "writeup-cup_later");
    const later_s = runnerServer("writeup-cup_later");
    expect(payload(await later_s.call("session_end", { session: "writeup-cup_later", writeUp: "plain-1" }))["reason"]).toBe("part");
    const c = openNightCounterpart(config());
    closers.push(c);
    const re = reowePlan(c, "cup_busy", Date.now());
    expect(re.subjects).toEqual([expect.objectContaining({ session: "plain-1", status: "busy" })]);
    expect(applyReowe(c, re, Date.now())).toEqual([]);
    expect(readWriteUpProgress(c.store)[progressKey("plain-1", proj)]?.done).toBe(2);
    release(later);
  });

  test("catch-up --dry-run or --yes without --reowe is a usage mistake, not a real run", async () => {
    Counterpart.open({ dir }).close();
    const err: string[] = [];
    const io: Io = { out: () => undefined, err: (l) => err.push(l) };
    const env = { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" };
    expect(await run(["catch-up", "--dir", dir, "--dry-run"], { io, env })).toBe(EXIT.usage);
    expect(await run(["catch-up", "--dir", dir, "--yes"], { io, env })).toBe(EXIT.usage);
    expect(err.join("\n")).toContain("--reowe");
  });
});
