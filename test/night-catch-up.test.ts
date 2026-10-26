/**
 * THE MORNING CATCH-UP AND THE "YESTERDAY" LINE (2026-10-01, wake build 3).
 *
 * The nightly run writes up owed stretches in ANY directory before its page
 * writer, through a short child of its own pinned to a runner id whose record
 * carries the launcher's grant; the door files the memories under the subject's
 * directory, as that session's, second-hand, dated the day it was lived; the
 * claims keep the in-session catch-up off the same stretch; the bound leaves
 * the rest owed and says so; doctor and the log read the run's row; and the
 * wake carries yesterday's chapters on one dated line.
 *
 * Hermetic (CLAUDE.md): a fresh temp store per test, removed after. No real
 * `claude` is started: the catch-up child is an injected starter that drives
 * the real MCP server as the runner, exactly as the child's tools would.
 */
import { stampWords } from "../src/core/handoff/last-here.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES } from "../src/adapters/config.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import {
  CATCH_UP_RUN_PREFIX,
  CATCH_UP_TOOLS,
  NOTHING_OWED_BEFORE_KEY,
  catchUpOf,
  catchUpRunner,
  catchUpWords,
  endStaleRunners,
  grantCatchUp,
  planCatchUp,
  runCatchUp,
} from "../src/adapters/claude-code/night-catch-up.js";
import type { CatchUpReport } from "../src/adapters/claude-code/night-catch-up.js";
import { NIGHT_KIND_ENV, NIGHT_RUN_ENV, OWED_AS_NEW_KIND, claudeCodeSeat, nightRowTimeoutMs, openNightCounterpart, readKind, runNight } from "../src/adapters/claude-code/night-run.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code/hooks.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { dreamingSettingWords, nightRunLine } from "../src/adapters/cli/dream-core.js";
import { beginNewInstall } from "../src/core/onboarding.js";
import { DREAM_TUNABLES } from "../src/core/dream/index.js";
import { nightRunLost, nightRunWords } from "../src/core/dream/index.js";
import { McpServer, openServer } from "../src/adapters/mcp/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_PART_BYTES,
  WRITE_UP_REPLY_BYTES,
  WRITE_UP_REPLY_MARK,
  owedWriteUps,
  progressKey,
  readSession,
  readWriteUpProgress,
  recordSession,
  sessionPath,
  updateWriteUpProgress,
  writeUpEntries,
  writeUpPlan,
} from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import { readLog } from "../src/adapters/log/index.js";
import { openLog } from "../src/adapters/log/index.js";
import { Counterpart, NIGHT_WRITE_UP_EVENT } from "../src/core/counterpart.js";
import { LAST_HERE_NOROOM_EVENT, chaptersOn, yesterdayLine } from "../src/core/handoff/last-here.js";
import { BRIEFING_KEY, SELF_TUNABLES, render } from "../src/core/self/index.js";
import { dayMemories, isOfDay } from "../src/core/self/writer.js";
import { Store } from "../src/core/store/index.js";
import { sessionsHere } from "../src/core/coverage/index.js";
import { narrate } from "../src/adapters/dashboard/web/narrate.js";
import { addDays, localDate, readableDate } from "../src/core/time.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const BUDGET = 9_000;

let root: string;
let dir: string;
let proj: string;
let other: string;
let launch: string;
const closers: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-catch-up-")));
  dir = join(root, "store");
  proj = join(root, "proj");
  other = join(root, "other");
  launch = join(root, "launch");
  for (const d of [dir, proj, other, launch]) mkdirSync(d, { recursive: true });
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

const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, injectionBudgetBytes: BUDGET, ...over });

/** Claude Code's seat with a test's starter for the catch-up's children. */
const seatFor = (start: (plan: ChildPlan) => Promise<ChildResult>): ReturnType<typeof claudeCodeSeat> =>
  claudeCodeSeat({ config: config(), open: () => openNightCounterpart(config()), startCatchUp: start });

/** Local midnight today, in the process's zone (the store's, with no `timeZone`). */
function midnight(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
const YESTERDAY_10 = (): number => midnight() - 14 * HOUR;
const TODAY = (): string => localDate(Date.now());
const YESTERDAY = (): string => addDays(TODAY(), -1);

function payload(r: ToolResult): Record<string, unknown> {
  return r.structuredContent;
}

/**
 * A session that talked in `scope` YESTERDAY, six pieces eight minutes apart
 * (owed, not small), each with a reply; then ended — or crashed (no end on any
 * record: the ledger reads it quiet since the date changed).
 */
function lived(
  id: string,
  scope: string,
  opts: { at?: number; end?: boolean; pieces?: number; reply?: (i: number) => string; say?: (i: number) => string } = {},
): void {
  let at = opts.at ?? YESTERDAY_10();
  const c = Counterpart.open({ dir, now: () => at });
  try {
    recordSession(dir, { sessionId: id, scope, phase: "start", at });
    const turns: { role: "user" | "assistant"; text: string }[] = [];
    for (let i = 0; i < (opts.pieces ?? 6); i++) {
      at += 8 * MIN;
      turns.push({ role: "user", text: opts.say?.(i) ?? `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs, or the loop loses pressure.` });
      turns.push({ role: "assistant", text: opts.reply?.(i) ?? `(${id} #${String(i)}) Understood — seat the valve on loop ${String(i)} first.` });
      c.captureSpans({ session: id, scope, turns: [...turns] });
    }
    c.boundary({ session: id, scope, kind: "stop" });
    recordSession(dir, { sessionId: id, scope, phase: "boundary", at });
    if (opts.end !== false) {
      c.boundary({ session: id, scope, kind: "session-end" });
      recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
    }
  } finally {
    c.close();
  }
}

/** A chapter written yesterday by another session, titled. */
function chapterYesterday(session: string, title: string): string {
  const at = YESTERDAY_10() + 3 * HOUR;
  const c = Counterpart.open({ dir, now: () => at });
  try {
    const out = c.appendEpisode(session, `What we did: ${title}.`, { title });
    expect(out.appended).toBe(true);
    return out.episodeId as string;
  } finally {
    c.close();
  }
}

/**
 * THE CATCH-UP CHILD, as its one tool would drive it: the runner's id and its
 * directory from the pinned environment, the sessions from the prompt, and for
 * each one fetch → answer until it is written up or tonight's allowance stops it.
 */
function drivingChild(seen: ChildPlan[], answers: { memories: (id: string, part: number) => unknown[] } = { memories: (id, part) => [{ content: `Written up from ${id}, part ${String(part)}: the relief valve is seated before the pump runs, or the reservoir loop loses pressure.`, kind: "fact" }] }): (plan: ChildPlan) => Promise<ChildResult> {
  return async (plan) => {
    seen.push(plan);
    const runner = plan.env[SESSION_ENV] as string;
    const scope = plan.env[SCOPE_ENV] as string;
    const ids = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1] as string);
    const s = openServer({ dir, session: runner, scope });
    try {
      for (const id of ids) {
        for (let guard = 0; guard < 10; guard++) {
          const f = payload(await s.call("session_end", { session: runner, writeUp: id }));
          if (f["reason"] !== "part") break;
          const part = f["part"] as number;
          const a = payload(await s.call("session_end", { session: runner, writeUp: id, part, memories: answers.memories(id, part) }));
          if (a["reason"] !== "part-written") break;
        }
      }
    } finally {
      s.counterpart.close();
    }
    return { code: 0, timedOut: false, error: null };
  };
}

function owes(id: string): boolean {
  const c = openNightCounterpart(config());
  try {
    return writeUpPlan({ store: c.store, spans: c.spans }).find((h) => h.session === id)?.owes === true;
  } finally {
    c.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
describe("end to end: an owed session from yesterday, in another directory, written up by the night run", () => {
  test("its memories land under ITS directory, as ITS, second-hand, dated the day lived; it stops owing; the claims let go; the row, the log and the wake say so", async () => {
    lived("old-1", proj);
    // A crash in a third directory: no end on any record, quiet since yesterday.
    lived("crash-1", other, { end: false, at: YESTERDAY_10() + HOUR });
    const ep = chapterYesterday("chap-1", "Seating the relief valves");
    expect(owes("old-1")).toBe(true);
    expect(owes("crash-1")).toBe(true);

    const seen: ChildPlan[] = [];
    const log = openLog({ dataDir: dir, proc: "nightly", session: "s-launch" });
    const out = await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_cu1",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      baseEnv: { PATH: "/usr/bin:/bin" },
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
      onEvent: log.event,
    });
    expect(out.run).toBe("nrn_cu1");

    // THE CHILD: its own runner id, pinned; one tool; its own turn ceiling and watchdog.
    expect(seen.length).toBe(1);
    const plan = seen[0] as ChildPlan;
    const runner = catchUpRunner("nrn_cu1");
    expect(runner.startsWith(NIGHT_RUNNER_PREFIX)).toBe(true);
    expect(plan.env[SESSION_ENV]).toBe(runner);
    expect(plan.args[plan.args.indexOf("--allowedTools") + 1]).toBe(CATCH_UP_TOOLS.join(","));
    expect(plan.args[plan.args.indexOf("--max-turns") + 1]).toBe(String(TUNABLES.NIGHT_WRITE_UP_MAX_TURNS));
    expect(plan.timeoutMs).toBe(TUNABLES.NIGHT_WRITE_UP_MS);
    expect(plan.args).toContain("--strict-mcp-config");
    expect(plan.stdin).toContain("- old-1:");
    expect(plan.stdin).toContain("- crash-1:");
    // No one's words in the prompt: ids, dates and counts only.
    expect(plan.stdin).not.toContain("relief valve");

    // BOTH WRITTEN UP, and owing nothing.
    expect(owes("old-1")).toBe(false);
    expect(owes("crash-1")).toBe(false);

    const c = openNightCounterpart(config());
    closers.push(c);
    const rows = c.store
      .list({ type: "memory", archived: false })
      .map((id) => c.store.row(id))
      .filter((r) => r !== undefined && r.origin_session !== null && ["old-1", "crash-1"].includes(r.origin_session));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r?.happened_on).toBe(YESTERDAY());
      expect(r?.learned_on).toBe(TODAY());
      expect(JSON.parse(r?.meta ?? "{}")).toMatchObject({ secondHand: true, writtenUpBy: runner });
    }
    // Under the SUBJECT's directory — never the runner's or the launcher's.
    const spans = c.spans;
    expect(spans.writeUps(proj).map((w) => w.session)).toContain("old-1");
    expect(spans.writeUps(other).map((w) => w.session)).toContain("crash-1");
    expect(spans.proposalRecords<{ session: string }>(launch).length).toBe(0);

    // LET GO: no claim stands, the grant is withdrawn, the runner's record ended.
    for (const p of Object.values(readWriteUpProgress(c.store))) expect(p.claim).toBeUndefined();
    expect(readSession(dir, runner)?.mayWriteUp).toEqual([]);
    expect(readSession(dir, runner)?.endedAt).not.toBeNull();

    // THE ROW, and the log line.
    const row = catchUpOf(c.store, "nrn_cu1");
    expect(row).toMatchObject({ state: "done", granted: 2, written: 2, parts: 2, left: 0, bounded: 0 });
    expect(c.store.eventLog({ name: NIGHT_WRITE_UP_EVENT }).length).toBe(1);
    const lines = readLog(dir, TODAY()).entries.filter((e) => e.name === NIGHT_WRITE_UP_EVENT);
    expect(lines.length).toBe(1);
    expect(lines[0]?.data).toMatchObject({ written: 2, left: 0 });

    // THE WAKE, rendered at the run's end: yesterday's chapter on one dated line.
    const s = Store.open({ dir, observer: true });
    try {
      const wake = s.getMeta(BRIEFING_KEY) ?? "";
      const line = wake.split("\n").find((l) => l.startsWith("Yesterday, "));
      expect(line).toBe(`Yesterday, ${stampWords(YESTERDAY().slice(5))}: "Seating the relief valves" (${ep}).`);
    } finally {
      s.close();
    }

    // DOCTOR's Nightly line carries the catch-up.
    c.dreams.setSetting("auto", { by: "owner" });
    const night = nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
    expect(night?.detail).toContain("catch-up: caught up 2 of 2 sessions (2 parts written); nothing left owed");
  });

  test("a session of several parts is written up whole in one night: the runner goes on from part to part", async () => {
    const words = "the reservoir loop keeps its pressure only when the relief valve is seated first. ".repeat(70);
    lived("big-1", proj, { pieces: 12, say: (i) => `big-1 #${String(i)}: ${words}` });
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_big",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    expect(seen[0]?.stdin).toMatch(/- big-1: lived .*; parts 1–3 of 3\./);
    expect(owes("big-1")).toBe(false);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store, "nrn_big")).toMatchObject({ state: "done", granted: 1, written: 1, parts: 3, left: 0 });
    const mine = c.store
      .list({ type: "memory", archived: false })
      .map((id) => c.store.row(id))
      .filter((r) => r?.origin_session === "big-1");
    expect(mine.length).toBe(3);
  });

  test("a quiet night — nothing owed — starts no catch-up child and writes no row", async () => {
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_quiet",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    expect(seen).toEqual([]);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store)).toBeNull();
  });

  test("the reflection-alone run does no catch-up", async () => {
    lived("old-1", proj);
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_r",
      session: "s-launch",
      scope: launch,
      kind: { kind: "reflection", dream: "drm_x" },
      date: TODAY(),
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    expect(seen).toEqual([]);
    expect(owes("old-1")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("claim-first: the night run and an in-session catch-up never write the same stretch", () => {
  test("granted and claimed: the SessionStart pointer passes it over, and a session pointed at it before is refused `claimed`", async () => {
    lived("old-1", proj);
    const c = openNightCounterpart(config());
    closers.push(c);
    const now = c.store.now();
    // A session in the same directory was pointed at it earlier (the hook's mark).
    recordSession(dir, { sessionId: "here-1", scope: proj, phase: "start", writeUpPointer: "old-1" });
    const plan = planCatchUp(c, { run: "nrn_claim", now });
    expect(plan.subjects.map((s) => s.session)).toEqual(["old-1"]);
    expect(grantCatchUp(c, plan, { scope: launch, now })?.subjects.length).toBe(plan.subjects.length);

    const progress = readWriteUpProgress(c.store);
    const wp = writeUpPlan({ store: c.store, spans: c.spans });
    expect(owedWriteUps(wp, dir, proj, now, { exclude: "here-2", progress }).map((o) => o.held.session)).not.toContain("old-1");

    const s = openServer({ dir, scope: proj });
    closers.push(s.counterpart);
    const refused = payload(await s.call("session_end", { session: "here-1", writeUp: "old-1" }));
    expect(refused).toMatchObject({ reason: "claimed", stored: false });
    expect(String(refused["detail"])).toContain("nightly run");
  });

  test("the other way round: a session that fetched it holds it, and tonight's plan does not grant it", async () => {
    lived("old-1", proj);
    recordSession(dir, { sessionId: "here-1", scope: proj, phase: "start", writeUpPointer: "old-1" });
    const s = openServer({ dir, scope: proj });
    closers.push(s.counterpart);
    expect(payload(await s.call("session_end", { session: "here-1", writeUp: "old-1" }))).toMatchObject({ reason: "part" });
    const key = progressKey("old-1", Object.keys(readWriteUpProgress(s.counterpart.store))[0]?.split("|")[1] ?? "");
    expect(readWriteUpProgress(s.counterpart.store)[key]?.claim?.by).toBe("here-1");
    const plan = planCatchUp(s.counterpart, { run: "nrn_late", now: s.counterpart.store.now() });
    expect(plan.subjects).toEqual([]);
    expect(plan.busy).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the night's bound: whole parts while they fit, the rest left owed and said", () => {
  test("a session cap and a byte cap: what is left is counted, and the door stops at the allowance", async () => {
    // Three sessions; the oldest is about three parts long.
    const words = "the reservoir loop keeps its pressure only when the relief valve is seated first. ".repeat(70);
    lived("big-1", proj, { at: YESTERDAY_10() - 2 * HOUR, pieces: 12, say: (i) => `big-1 #${String(i)}: ${words}` });
    lived("mid-1", other);
    lived("late-1", proj, { at: YESTERDAY_10() + 2 * HOUR });
    const c = openNightCounterpart(config());
    closers.push(c);
    const now = c.store.now();
    const plan = planCatchUp(c, { run: "nrn_b", now, sessions: 2, bytes: 30 * 1024 });
    // Oldest first: big-1 takes its first part (always), mid-1 fits only if the bytes allow.
    expect(plan.subjects[0]?.session).toBe("big-1");
    expect(plan.subjects[0]?.from).toBe(1);
    expect(plan.subjects[0]?.upTo).toBe(1);
    expect(plan.subjects[0]?.of).toBeGreaterThan(1);
    expect(plan.subjects.length).toBeLessThanOrEqual(2);
    expect(plan.bounded).toBeGreaterThanOrEqual(2);
    expect(plan.owed).toBe(3);

    // The door serves part 1 and refuses part 2 by name.
    expect(grantCatchUp(c, plan, { scope: launch, now })?.subjects.length).toBe(plan.subjects.length);
    const s = openServer({ dir, session: plan.runner, scope: launch });
    closers.push(s.counterpart);
    expect(payload(await s.call("session_end", { session: plan.runner, writeUp: "big-1" }))).toMatchObject({ reason: "part", part: 1 });
    expect(
      payload(
        await s.call("session_end", {
          session: plan.runner,
          writeUp: "big-1",
          part: 1,
          memories: [{ content: "The big session's first part: seat the relief valve before the pump runs.", kind: "fact" }],
        }),
      ),
    ).toMatchObject({ reason: "part-written" });
    const spent = payload(await s.call("session_end", { session: plan.runner, writeUp: "big-1" }));
    expect(spent).toMatchObject({ reason: "allowance-spent", part: 2 });
    expect(String(spent["detail"])).toContain("stays owed");
  });

  test("the words of the row: what it wrote, what it left, and why", () => {
    expect(catchUpWords({ state: "done", granted: 3, written: 2, parts: 5, left: 4, partsLeft: 30, bounded: 2, busy: 0, limit: "parts" })).toBe(
      "caught up 2 of 3 sessions (5 parts written); 4 sessions still owed, 30 parts (2 were over the run's ceiling)",
    );
    expect(catchUpWords({ state: "done", granted: 3, written: 1, parts: 40, left: 2, partsLeft: 12, bounded: 2, busy: 0, limit: "time" })).toBe(
      "caught up 1 of 3 sessions (40 parts written); 2 sessions still owed, 12 parts (it stopped at its hour)",
    );
    expect(catchUpWords({ state: "timed-out", granted: 1, written: 0, parts: 1, left: 1, bounded: 0, busy: 0 })).toBe(
      "caught up 0 of 1 session (1 part written) before its watchdog stopped it; 1 session still owed",
    );
    // THE MORNING OF 2026-10-11, as the row now says it: 5 of a session's 17
    // parts written is not "0 of 1".
    expect(catchUpWords({ state: "done", granted: 1, written: 0, parts: 5, left: 2, partsLeft: 15, bounded: 0, busy: 0 })).toBe(
      "caught up 0 of 1 session (5 parts written); 2 sessions still owed, 15 parts",
    );
    expect(catchUpWords({ state: "none-granted", granted: 0, written: 0, parts: 0, left: 1, bounded: 0, busy: 1 })).toBe(
      "nothing to take (1 session was being written up elsewhere); 1 session still owed",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the granted door, its rough edges smoothed", () => {
  test("a small debt is served while a larger one waits elsewhere (no full-first gate on a grant), and a runner goes on to the next part", async () => {
    lived("full-1", other, { at: YESTERDAY_10() - HOUR });
    lived("small-1", proj, { pieces: 3 });
    const c = openNightCounterpart(config());
    closers.push(c);
    const now = c.store.now();
    recordSession(dir, { sessionId: "writeup-x", scope: launch, phase: "start" });
    const { grantWriteUps } = await import("../src/adapters/sessions.js");
    expect(grantWriteUps(dir, { runner: "writeup-x", scope: launch, subjects: ["small-1"], at: now })).toBe(true);
    const s = openServer({ dir, session: "writeup-x", scope: launch });
    closers.push(s.counterpart);
    expect(payload(await s.call("session_end", { session: "writeup-x", writeUp: "small-1" }))).toMatchObject({ reason: "part", ended: "small-1" });
  });

  test("its replies are handed over labelled, and a long one is cut and says so", () => {
    lived("talky-1", proj, { reply: (i) => `${String(i)} ${"x".repeat(WRITE_UP_REPLY_BYTES * 2)}` });
    const c = openNightCounterpart(config());
    closers.push(c);
    const held = writeUpPlan({ store: c.store, spans: c.spans }).find((h) => h.session === "talky-1");
    const entries = writeUpEntries(c.spans, { session: "talky-1", scopes: held?.scopes ?? [] });
    const replies = entries.filter((e) => e.reply === true);
    expect(replies.length).toBe(6);
    for (const r of replies) {
      expect(Buffer.byteLength(r.text, "utf8")).toBeLessThanOrEqual(WRITE_UP_REPLY_BYTES);
      expect(r.text).toContain("the rest of this reply is not shown");
    }
    expect(WRITE_UP_REPLY_MARK).toBe("[its reply]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the day lived: the page writer reads a write-up on the day it happened", () => {
  test("a second-hand memory learned today about yesterday is yesterday's — and not today's", () => {
    const c = openNightCounterpart(config());
    closers.push(c);
    const today = TODAY();
    const yesterday = YESTERDAY();
    const id = c.store.put({
      type: "memory",
      kind: "fact",
      body: "Written up this morning: yesterday the relief valve was seated before the pump ran.",
      learnedOn: today,
      happenedOn: yesterday,
      meta: { secondHand: true, writtenUpBy: "writeup-nrn_x" },
    });
    const plain = c.store.put({ type: "memory", kind: "fact", body: "Learned today, lived today.", learnedOn: today, happenedOn: yesterday });
    const row = c.store.row(id);
    expect(row !== undefined && isOfDay(c.store, row, yesterday)).toBe(true);
    expect(row !== undefined && isOfDay(c.store, row, today)).toBe(false);
    // A first-hand memory with a happened date stays on the day it was learned.
    const p = c.store.row(plain);
    expect(p !== undefined && isOfDay(c.store, p, today)).toBe(true);
    const day = dayMemories(c.store, { about: yesterday, day: c.store.livedDay(), budgetBytes: 10_000, max: 50 });
    expect(day.memories.map((m) => m.id)).toEqual([id]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the Yesterday line", () => {
  test("titles and ids, oldest first, the date in the line; an untitled chapter and the rest by count (no bare ids, 2026-10-20); none without a chapter that day", () => {
    const mk = (id: string, title: string | null, n: number, at: number) => ({ id, title, chapters: n, createdAt: at });
    const d = Date.UTC(2026, 8, 30, 9);
    const day = [mk("epi_a", "First thing", 1, d), mk("epi_b", "Second thing", 2, d + HOUR), mk("epi_c", null, 1, d + 2 * HOUR), mk("epi_d", "Fourth", 1, d + 3 * HOUR), mk("epi_e", "Fifth", 1, d + 4 * HOUR)];
    expect(yesterdayLine(day, "2026-09-30")).toBe(
      'Yesterday, Sep 30: "First thing" (epi_a); "Second thing" (epi_b); "Fourth" (epi_d); "Fifth" (epi_e); and 1 more.',
    );
    expect(yesterdayLine([], "2026-09-27")).toBeNull();
  });

  test("chapters are read by the day each was WRITTEN: a session that chaptered yesterday and again today is still yesterday's, and two chapters yesterday count as two (review of #308)", () => {
    const at = (t: number): Counterpart => {
      const c = Counterpart.open({ dir, now: () => t });
      closers.push(c);
      return c;
    };
    const y = YESTERDAY_10();
    // Session one: a chapter yesterday morning, another yesterday afternoon, a third today.
    let ep = "";
    for (const [t, text] of [[y, "What we did this morning: seated the relief valve on loop one before the pump ran."], [y + 5 * HOUR, "What we did this afternoon: bled the air out of loop two and checked the pressure held."], [Date.now(), "What we did today: replaced the gauge on loop three and logged the readings."]] as const) {
      const c = at(t);
      // A new chapter each time: the ask opens the next one.
      c.episodeAsk("two-days", { turns: 9, bytes: 6_000 });
      const out = c.appendEpisode("two-days", text, { title: "Two days of valves" });
      expect(out.appended).toBe(true);
      ep = out.episodeId as string;
      c.close();
    }
    const c = openNightCounterpart(config());
    closers.push(c);
    // The session wrote again today: it is still yesterday's.
    expect(chaptersOn(c.store, YESTERDAY()).map((d) => d.id)).toEqual([ep]);
    // Two chapters headed with the same day count as two.
    const said = readableDate(YESTERDAY());
    const two = c.store.put({
      type: "episode",
      kind: "self",
      title: "Two chapters",
      body: `## chapter 1 — ${said} · lived day 3\n\nOne.\n\n## chapter 2 — ${said} · lived day 3\n\nTwo.\n`,
      learnedOn: YESTERDAY(),
    });
    expect(chaptersOn(c.store, YESTERDAY()).find((d) => d.id === two)?.chapters).toBe(2);
    // A RETITLE today is not a chapter today (second review of #308): only a
    // heading's date says when a chapter was written.
    c.store.revise(two, { title: "Two chapters, retitled" });
    expect(chaptersOn(c.store, TODAY()).map((d) => d.id)).not.toContain(two);
    expect(chaptersOn(c.store, YESTERDAY()).find((d) => d.id === two)?.chapters).toBe(2);
  });

  test("it rides the wake's budget: furniture under the framing, and on a ceiling too small for it the floor goes without it", () => {
    const empty = { identity: [], craft: [], threads: [], hints: [], horizon: [] };
    const line = 'Yesterday, Sep 30: "Seating the relief valves" (epi_a).';
    const resolve = (): { statement: string } => ({ statement: "" });
    const roomy = render(empty, { budgetBytes: 2_000, day: 3, yesterday: line }, resolve, SELF_TUNABLES);
    expect(roomy.text.split("\n")[2]).toBe(line);
    expect(roomy.elements).toBe(0);
    expect(roomy.overBudget).toBe(false);
    const floor = render(empty, { budgetBytes: 2_000, day: 3 }, resolve, SELF_TUNABLES).bytes;
    const tight = render(empty, { budgetBytes: floor + 10, day: 3, yesterday: line }, resolve, SELF_TUNABLES);
    expect(tight.text).not.toContain("Yesterday,");
    expect(tight.overBudget).toBe(false);
  });

  test("the live wake carries it once a chapter was written yesterday", () => {
    chapterYesterday("chap-1", "Seating the relief valves");
    const big = Counterpart.open({ dir, budgetBytes: BUDGET });
    closers.push(big);
    expect(big.refreshWake({ at: TODAY(), trigger: "run-end" }).reason).toBe("rendered");
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.getMeta(BRIEFING_KEY) ?? "").toContain(`Yesterday, ${stampWords(YESTERDAY().slice(5))}: "Seating the relief valves"`);
    } finally {
      s.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("review of #308: the runner writes up and nothing else; claims and grants hold; a short night says so", () => {
  test("HIGH: a runner may not take the ordinary path — no first-hand memory, no handoff, no note, no chapter — and still writes up", async () => {
    lived("old-1", proj);
    const c = openNightCounterpart(config());
    closers.push(c);
    const now = c.store.now();
    const plan = grantCatchUp(c, planCatchUp(c, { run: "nrn_h", now }), { scope: launch, now });
    expect(plan?.subjects.length).toBe(1);
    const runner = catchUpRunner("nrn_h");
    const s = openServer({ dir, session: runner, scope: launch });
    closers.push(s.counterpart);
    const MEM = [{ content: "A first-hand memory the runner should never write: the pump was serviced.", kind: "fact" }];
    for (const [tool, args] of [
      ["session_end", { session: runner, memories: MEM }],
      ["session_end", { session: runner, memories: [], handoff: "Pick up the valve work." }],
      ["session_end", { memories: MEM }],
      ["note", { session: runner, content: "A note from the runner." }],
      ["chapter", { session: runner, text: "A chapter from the runner." }],
    ] as const) {
      const out = payload(await s.call(tool, args as Record<string, unknown>));
      expect(out).toMatchObject({ stored: false, reason: "write-up-runner" });
    }
    // Nothing landed under the launcher's directory, and no handoff there.
    expect(s.counterpart.spans.proposalRecords<{ session: string }>(launch).length).toBe(0);
    expect(s.counterpart.readHandoffs(launch)).toEqual([]);
    // A runner record with the prefix and no grant left is refused too.
    const bare = openServer({ dir, session: "writeup-nrn_old", scope: launch });
    closers.push(bare.counterpart);
    expect(payload(await bare.call("session_end", { session: "writeup-nrn_old", memories: MEM }))["reason"]).toBe("write-up-runner");
    // Reading is allowed; the write-up itself goes through.
    expect(payload(await s.call("status", {}))["reason"]).not.toBe("write-up-runner");
    expect(payload(await s.call("session_end", { session: runner, writeUp: "old-1" }))).toMatchObject({ reason: "part" });
  });

  test("MEDIUM: a claim taken between the plan and the grant is never claimed twice — the subject is passed over as busy", async () => {
    lived("old-1", proj);
    lived("old-2", other);
    const c = openNightCounterpart(config());
    closers.push(c);
    const now = c.store.now();
    const plan = planCatchUp(c, { run: "nrn_race", now });
    expect(plan.subjects.map((x) => x.session).sort()).toEqual(["old-1", "old-2"]);
    // A session in proj fetches old-1 after the plan was read.
    recordSession(dir, { sessionId: "here-1", scope: proj, phase: "start", writeUpPointer: "old-1" });
    const s = openServer({ dir, scope: proj });
    closers.push(s.counterpart);
    expect(payload(await s.call("session_end", { session: "here-1", writeUp: "old-1" }))).toMatchObject({ reason: "part" });
    const granted = grantCatchUp(c, plan, { scope: launch, now });
    expect(granted?.subjects.map((x) => x.session)).toEqual(["old-2"]);
    expect(granted?.busy).toBe(1);
    expect(readSession(dir, catchUpRunner("nrn_race"))?.mayWriteUp).toEqual(["old-2"]);
    const progress = readWriteUpProgress(c.store);
    const holders = Object.entries(progress).map(([k, p]) => [k.split("|")[0], p.claim?.by]);
    expect(holders).toContainEqual(["old-1", "here-1"]);
    expect(holders).toContainEqual(["old-2", catchUpRunner("nrn_race")]);
  });

  test("LOW: a runner nobody ended holds no grant past the claim window — the door refuses it, and the next run ends it", async () => {
    lived("old-1", proj);
    const c = openNightCounterpart(config());
    closers.push(c);
    const long = c.store.now() - 3 * HOUR;
    const runner = catchUpRunner("nrn_killed");
    const { grantWriteUps } = await import("../src/adapters/sessions.js");
    expect(grantWriteUps(dir, { runner, scope: launch, subjects: ["old-1"], at: long })).toBe(true);
    const s = openServer({ dir, session: runner, scope: launch });
    closers.push(s.counterpart);
    expect(payload(await s.call("session_end", { session: runner, writeUp: "old-1" }))).toMatchObject({ reason: "grant-expired" });
    expect(endStaleRunners(dir, c.store.now())).toBe(1);
    expect(readSession(dir, runner)?.mayWriteUp).toEqual([]);
    expect(readSession(dir, runner)?.endedAt).not.toBeNull();
  });

  test("LOW: a child that exits 0 having written up less than it was granted is `partial`, not `done`", async () => {
    lived("old-1", proj);
    lived("old-2", other);
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_short",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      // A usage limit after the first session: it writes one up and exits 0.
      startCatchUp: async (plan) => {
        seen.push(plan);
        const runner = plan.env[SESSION_ENV] as string;
        const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
        try {
          const id = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)][0]?.[1] as string;
          payload(await s.call("session_end", { session: runner, writeUp: id }));
          // A catch-up's empty answer says why (2026-10-11).
          payload(await s.call("session_end", { session: runner, writeUp: id, memories: [], nothing: "routine valve checks, nothing new" }));
        } finally {
          s.counterpart.close();
        }
        return { code: 0, timedOut: false, error: null };
      },
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    const c = openNightCounterpart(config());
    closers.push(c);
    const row = catchUpOf(c.store, "nrn_short");
    expect(row).toMatchObject({ state: "partial", granted: 2, written: 1, left: 1 });
    expect(catchUpWords(row as NonNullable<typeof row>)).toContain("it stopped before the rest");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("second review of #308", () => {
  test("the SessionStart pointer keeps a claim the night took after the pointer read the map, and does not point at that subject", async () => {
    lived("old-1", proj);
    const runner = catchUpRunner("nrn_between");
    let calls = 0;
    const a = openAdapter(config(), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
      scope: { mode: "on", matched: proj, entry: null },
    });
    try {
      const store = a.counterpart.store;
      const original = store.updateMeta.bind(store);
      // The night's grant lands between the pointer's read of the map and its
      // save: on the pointer's SECOND progress write (the first is the prune).
      store.updateMeta = ((key: string, fn: (current: string | undefined) => string | null | undefined) => {
        if (key === "adapter.writeup.progress") {
          calls += 1;
          if (calls === 2) {
            original(key, (current) => {
              const all = JSON.parse(current ?? "{}") as Record<string, Record<string, unknown>>;
              const k = Object.keys(all).find((x) => x.startsWith("old-1|")) ?? `old-1|${proj}`;
              all[k] = { chunk: 24 * 1024, parts: 1, done: 0, handedAt: Date.now(), ...(all[k] ?? {}), claim: { by: runner, at: Date.now(), upTo: 1 } };
              return JSON.stringify(all);
            });
          }
        }
        return original(key, fn);
      }) as typeof store.updateMeta;
      const out = a.sessionStart({ sessionId: "here-1", scope: proj, at: TODAY() } as HookInput);
      expect(out.ask ?? "").not.toContain("writeUp: old-1");
      expect(a.events().map((e) => e.name)).toContain("adapter.writeup.deferred");
      const claim = Object.entries(readWriteUpProgress(store)).find(([k]) => k.startsWith("old-1|"))?.[1].claim;
      expect(claim).toMatchObject({ by: runner, upTo: 1 });
      expect(readSession(dir, "here-1")?.writeUpPointer).toBeUndefined();
    } finally {
      a.counterpart.close();
    }
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test("a batch bound of one part: the run goes on, batch after batch, each a runner of its own, until the session is written up whole", async () => {
    const words = "the reservoir loop keeps its pressure only when the relief valve is seated first. ".repeat(70);
    lived("big-1", proj, { pieces: 12, say: (i) => `big-1 #${String(i)}: ${words}` });
    const seen: ChildPlan[] = [];
    const c0 = openNightCounterpart(config());
    const plan = planCatchUp(c0, { run: "nrn_bound", now: c0.store.now(), bytes: 1 });
    c0.close();
    expect(plan.subjects[0]).toMatchObject({ from: 1, upTo: 1 });
    // TUNABLES are code, so the night here is given a one-part batch the way
    // the launcher writes it onto each claim.
    const { TUNABLES: T } = await import("../src/adapters/config.js");
    const before = T.NIGHT_WRITE_UP_BYTES;
    (T as { NIGHT_WRITE_UP_BYTES: number }).NIGHT_WRITE_UP_BYTES = 1;
    try {
      await runNight({
        open: () => openNightCounterpart(config()),
        config: config(),
        run: "nrn_bound",
        session: "s-launch",
        scope: launch,
        kind: { kind: "night" },
        date: TODAY(),
        startCatchUp: drivingChild(seen),
        start: async () => ({ code: 0, timedOut: false, error: null }),
      });
    } finally {
      (T as { NIGHT_WRITE_UP_BYTES: number }).NIGHT_WRITE_UP_BYTES = before;
    }
    expect(seen.map((p) => p.env[SESSION_ENV])).toEqual([catchUpRunner("nrn_bound"), catchUpRunner("nrn_bound", 2), catchUpRunner("nrn_bound", 3)]);
    expect(seen.map((p) => /part (\d) of 3\./.exec(p.stdin)?.[1])).toEqual(["1", "2", "3"]);
    const c = openNightCounterpart(config());
    closers.push(c);
    const row = catchUpOf(c.store, "nrn_bound");
    expect(row).toMatchObject({ state: "done", granted: 1, written: 1, parts: 3, left: 0, partsLeft: 0, bounded: 0, batches: 3, limit: null });
    expect(owes("big-1")).toBe(false);
    // Every runner let go and ended.
    for (let b = 1; b <= 3; b++) {
      expect(readSession(dir, catchUpRunner("nrn_bound", b))?.endedAt).not.toBeNull();
      expect(readSession(dir, catchUpRunner("nrn_bound", b))?.mayWriteUp).toEqual([]);
    }
    for (const p of Object.values(readWriteUpProgress(c.store))) expect(p.claim).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("everything owed (2026-10-11): no session bound, a sanity ceiling and a watchdog", () => {
  /** A catch-up run straight through the launcher, as the night and the command start it. */
  function catchUp(run: string, seen: ChildPlan[], over: { parts?: number; totalMs?: number; now?: () => number } = {}): ReturnType<typeof runCatchUp> {
    return runCatchUp({
      open: () => openNightCounterpart(config()),
      config: config(),
      run,
      scope: launch,
      seat: seatFor(drivingChild(seen)),
      now: over.now ?? ((): number => Date.now()),
      ...(over.parts === undefined ? {} : { parts: over.parts }),
      ...(over.totalMs === undefined ? {} : { totalMs: over.totalMs }),
    });
  }

  test("an unbounded night clears every owed session — seven of them, more than the old four — oldest first", async () => {
    const ids = ["s-1", "s-2", "s-3", "s-4", "s-5", "s-6", "s-7"];
    ids.forEach((id, i) => lived(id, i % 2 === 0 ? proj : other, { at: YESTERDAY_10() - (ids.length - i) * HOUR }));
    for (const id of ids) expect(owes(id)).toBe(true);
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_all",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    for (const id of ids) expect(owes(id)).toBe(false);
    // Oldest first, in the order the child was given them.
    const order = seen.flatMap((p) => [...p.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)].map((m) => m[1]));
    expect(order).toEqual(ids);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store, "nrn_all")).toMatchObject({ state: "done", granted: 7, written: 7, parts: 7, left: 0, partsLeft: 0, bounded: 0, limit: null });
  });

  test("the sanity ceiling: the run stops at its parts, says what is left in sessions AND parts, and the rest stays owed", async () => {
    for (const [i, id] of ["c-1", "c-2", "c-3"].entries()) lived(id, proj, { at: YESTERDAY_10() - (3 - i) * HOUR });
    const seen: ChildPlan[] = [];
    const report = await catchUp("nrn_ceil", seen, { parts: 2 });
    expect(report).toMatchObject({ state: "done", granted: 2, written: 2, parts: 2, left: 1, partsLeft: 1, bounded: 1, limit: "parts" });
    expect(owes("c-3")).toBe(true);
    expect(catchUpWords(report as CatchUpReport)).toBe("caught up 2 of 2 sessions (2 parts written); 1 session still owed, 1 part (1 was over the run's ceiling)");
  });

  test("the watchdog: no batch starts that could outlast the run's hour", async () => {
    for (const [i, id] of ["w-1", "w-2"].entries()) lived(id, proj, { at: YESTERDAY_10() - (2 - i) * HOUR });
    let clock = Date.now();
    const seen: ChildPlan[] = [];
    const { TUNABLES: T } = await import("../src/adapters/config.js");
    const before = T.NIGHT_WRITE_UP_BATCH_PARTS;
    (T as { NIGHT_WRITE_UP_BATCH_PARTS: number }).NIGHT_WRITE_UP_BATCH_PARTS = 1;
    try {
      // Each child "takes" 55 minutes of an hour's watchdog.
      const report = await runCatchUp({
        open: () => openNightCounterpart(config()),
        config: config(),
        run: "nrn_hour",
        scope: launch,
        seat: seatFor(async (p) => {
          const r = await drivingChild(seen)(p);
          clock += 55 * MIN;
          return r;
        }),
        now: () => clock,
      });
      expect(seen.length).toBe(1);
      expect(report).toMatchObject({ state: "done", written: 1, left: 1, limit: "time", bounded: 1, batches: 1 });
      expect(catchUpWords(report as CatchUpReport)).toContain("(it stopped at its hour)");
    } finally {
      (T as { NIGHT_WRITE_UP_BATCH_PARTS: number }).NIGHT_WRITE_UP_BATCH_PARTS = before;
    }
  });

  test("a batch that brings nothing back starts no other: the run is `partial`, and says so", async () => {
    lived("n-1", proj);
    const seen: ChildPlan[] = [];
    const report = await runCatchUp({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_none",
      scope: launch,
      // A child that exits 0 having called nothing (a usage limit at once).
      seat: seatFor(async (p) => {
        seen.push(p);
        return { code: 0, timedOut: false, error: null };
      }),
      now: () => Date.now(),
    });
    expect(seen.length).toBe(1);
    expect(report).toMatchObject({ state: "partial", granted: 1, written: 0, parts: 0, left: 1, batches: 1 });
  });

  /** Every part of `id` back and answered, the mark not landed: the state a
   *  failed `recordWriteUp` leaves, which one fetch finishes. */
  function markNotLanded(id: string, scope: string): void {
    const c = openNightCounterpart(config());
    try {
      updateWriteUpProgress(c.store, (all) => {
        all[progressKey(id, scope)] = { chunk: WRITE_UP_PART_BYTES, parts: 1, done: 1, handedAt: Date.now() - HOUR, answer: "memories" };
        return true;
      });
    } finally {
      c.close();
    }
  }

  test("review of #401: a last part answered whose mark did not land, and a child that does nothing — one batch, `partial`, no part counted (it used to re-grant it to the ceiling)", async () => {
    lived("stuck-1", proj);
    markNotLanded("stuck-1", proj);
    expect(owes("stuck-1")).toBe(true);
    const seen: ChildPlan[] = [];
    const report = await runCatchUp({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_stuck",
      scope: launch,
      seat: seatFor(async (p) => {
        seen.push(p);
        return { code: 0, timedOut: false, error: null };
      }),
      now: () => Date.now(),
      parts: 20,
    });
    expect(seen.length).toBe(1);
    expect(report).toMatchObject({ state: "partial", granted: 1, written: 0, parts: 0, left: 1, batches: 1 });
    expect(owes("stuck-1")).toBe(true);
  });

  test("review of #401: the same state and a child that fetches it — the fetch lands the mark, written up, no part counted, the run goes on", async () => {
    lived("stuck-2", proj, { at: YESTERDAY_10() - HOUR });
    lived("next-2", other);
    markNotLanded("stuck-2", proj);
    const seen: ChildPlan[] = [];
    const report = await catchUp("nrn_mark", seen);
    expect(owes("stuck-2")).toBe(false);
    expect(owes("next-2")).toBe(false);
    expect(report).toMatchObject({ state: "done", granted: 2, written: 2, parts: 1, left: 0 });
  });

  test("the night's `started` row carries the catch-up's whole watchdog, so a long catch-up is never read as a lost run", () => {
    const row = nightRowTimeoutMs(config(), "night");
    expect(row).toBeGreaterThanOrEqual(TUNABLES.NIGHT_RUN_MS + TUNABLES.NIGHT_WRITE_UP_TOTAL_MS);
    expect(nightRowTimeoutMs(config(), "reflection")).toBe(TUNABLES.NIGHT_RUN_MS);
    const startedAt = Date.now();
    const run = { state: "started" as const, startedAt, timeoutMs: row };
    // 50 minutes into a heavy morning's catch-up: still under way.
    expect(nightRunLost(run, startedAt + 50 * MIN)).toBe(false);
    // The old row (the main child's twenty minutes alone) read it as lost.
    expect(nightRunLost({ ...run, timeoutMs: TUNABLES.NIGHT_RUN_MS }, startedAt + 50 * MIN)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("weak spot 2 (2026-10-11): a store that will not open once the child ended is said, not read as nothing", () => {
  test("the run ends `failed`, reason `unread`, with the store's code — never `nothing-ran`", async () => {
    let broken = false;
    const out = await runNight({
      open: () => {
        if (broken) throw Object.assign(new Error("the store is ahead"), { code: "SCHEMA_AHEAD" });
        return openNightCounterpart(config());
      },
      config: config(),
      run: "nrn_ahead",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      startCatchUp: drivingChild([]),
      // A newer build migrates the store while the child runs.
      start: async () => {
        broken = true;
        return { code: 0, timedOut: false, error: null };
      },
    });
    expect(out).toMatchObject({ state: "failed", reason: "unread", detail: "SCHEMA_AHEAD" });
    expect(nightRunWords(out)).toContain("a newer build took the store while it ran");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("`counterparts catch-up`: the night's catch-up on demand, through the same launcher, child and door", () => {
  function console_(): { io: Io; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
  }

  test("it clears every owed session while another session is still at work — and leaves that one alone", async () => {
    lived("old-1", proj, { at: YESTERDAY_10() - HOUR });
    lived("old-2", other);
    // At work right now: it captured today and has not ended.
    lived("live-1", proj, { at: Date.now() - 50 * MIN, end: false });
    expect(owes("old-1")).toBe(true);
    expect(owes("old-2")).toBe(true);
    expect(owes("live-1")).toBe(false);
    const seen: ChildPlan[] = [];
    const c = console_();
    const code = await run(["catch-up", "--dir", dir], { io: c.io, env: { PATH: "/usr/bin:/bin", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, catchUpStart: drivingChild(seen) });
    expect(c.err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(owes("old-1")).toBe(false);
    expect(owes("old-2")).toBe(false);
    // THE SAME CHILD as the night's: one tool, its own runner, pinned to the store's own directory.
    expect(seen.length).toBe(1);
    const plan = seen[0] as ChildPlan;
    expect(plan.args[plan.args.indexOf("--allowedTools") + 1]).toBe(CATCH_UP_TOOLS.join(","));
    expect(String(plan.env[SESSION_ENV]).startsWith(`${NIGHT_RUNNER_PREFIX}${CATCH_UP_RUN_PREFIX}`)).toBe(true);
    expect(plan.env[SCOPE_ENV]).toBe(dir);
    expect(plan.stdin).not.toContain("live-1");
    // WHAT IT PRINTS: what it is about to do, each batch, then what it took and what is left.
    expect(c.out[0]).toContain("Catching up on sessions that ended before they were written up");
    expect(c.out.some((l) => /^  batch 1: 2 sessions, 2 parts \(~\d+ KB\)$/.test(l))).toBe(true);
    expect(c.out[c.out.length - 1]).toBe("Caught up 2 of 2 sessions (2 parts written); nothing left owed.");
    // The row is the night's kind, and doctor names who ran it.
    const cp = openNightCounterpart(config());
    closers.push(cp);
    const row = catchUpOf(cp.store);
    expect(row?.run.startsWith(CATCH_UP_RUN_PREFIX)).toBe(true);
    expect(row).toMatchObject({ state: "done", granted: 2, written: 2, left: 0 });
  });

  test("nothing owed: one line, exit 0, no child", async () => {
    Counterpart.open({ dir }).close();
    const seen: ChildPlan[] = [];
    const c = console_();
    expect(await run(["catch-up", "--dir", dir], { io: c.io, env: { PATH: "/usr/bin:/bin" }, catchUpStart: drivingChild(seen) })).toBe(EXIT.ok);
    expect(seen).toEqual([]);
    expect(c.out[c.out.length - 1]).toBe("Nothing to catch up: every ended session is written up.");
  });

  test("a child that could not start: said on stderr, exit 3, everything still owed", async () => {
    lived("old-1", proj);
    const c = console_();
    const code = await run(["catch-up", "--dir", dir], {
      io: c.io,
      env: { PATH: "/usr/bin:/bin" },
      catchUpStart: async () => ({ code: null, timedOut: false, error: "Error", spawnCode: "ENOENT" }),
    });
    expect(code).toBe(EXIT.failed);
    expect(c.err.join("\n")).toContain("is claude on your PATH and logged in?");
    expect(owes("old-1")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SessionStart stops pointing at another session where the night catches up (2026-10-11)", () => {
  function startIn(scope: string, setting: "auto" | "ask"): { ask: string; events: string[]; skipped: unknown[] } {
    const a = openAdapter(config(), {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 4242 }),
      scope: { mode: "on", matched: scope, entry: null },
    });
    try {
      if (setting === "auto") a.counterpart.dreams.setSetting("auto", { by: "owner" });
      const out = a.sessionStart({ sessionId: "here-1", scope, at: TODAY() } as HookInput);
      const events = a.events();
      return {
        ask: out.ask ?? "",
        events: events.map((e) => e.name),
        skipped: events.filter((e) => e.name === "adapter.writeup.skipped").map((e) => e.data),
      };
    } finally {
      a.counterpart.close();
    }
  }

  test("under auto: no pointer, no mark on the new session, and the skip is said with its reason", () => {
    lived("old-1", proj);
    const s = startIn(proj, "auto");
    expect(s.ask).not.toContain("writeUp: old-1");
    expect(s.ask).not.toContain("<counterparts-write-up>");
    expect(s.events).not.toContain("adapter.writeup.ask");
    expect(s.skipped).toContainEqual({ reason: "night-catches-up" });
    expect(readSession(dir, "here-1")?.writeUpPointer).toBeUndefined();
    // Still owed, for the night or the command.
    expect(owes("old-1")).toBe(true);
  });

  test("under ask (no night runs): the pointer is still how a quiet folder's session is written up", () => {
    lived("old-1", proj);
    const s = startIn(proj, "ask");
    expect(s.ask).toContain("writeUp: old-1");
    expect(readSession(dir, "here-1")?.writeUpPointer).toBe("old-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the two ceilings (Mike, 2026-10-11): the night takes 100 parts, `counterparts catch-up` 400", () => {
  /** `n` one-part sessions, a minute apart, oldest first, all owed. */
  function owedSessions(prefix: string, n: number): string[] {
    const ids = Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`);
    ids.forEach((id, i) => lived(id, i % 2 === 0 ? proj : other, { at: YESTERDAY_10() - (n - i) * MIN }));
    return ids;
  }

  test("the constants: 100 a night, 400 for the command, one hour each", () => {
    expect(TUNABLES.NIGHT_WRITE_UP_PARTS).toBe(100);
    expect(TUNABLES.CATCH_UP_COMMAND_PARTS).toBe(400);
    expect(TUNABLES.NIGHT_WRITE_UP_TOTAL_MS).toBe(60 * MIN);
  });

  test("the night stops at 100 parts: 104 owed, the oldest 100 written, 4 left owed for the next night", async () => {
    const ids = owedSessions("n", 104);
    const seen: ChildPlan[] = [];
    await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: "nrn_hundred",
      session: "s-launch",
      scope: launch,
      kind: { kind: "night" },
      date: TODAY(),
      startCatchUp: drivingChild(seen),
      start: async () => ({ code: 0, timedOut: false, error: null }),
    });
    const c = openNightCounterpart(config());
    closers.push(c);
    const row = catchUpOf(c.store, "nrn_hundred");
    // Six batches of 16 and a seventh of the 4 the ceiling had left.
    expect(row).toMatchObject({ state: "done", written: 100, parts: 100, left: 4, partsLeft: 4, bounded: 4, batches: 7, limit: "parts" });
    expect(seen.length).toBe(7);
    expect(catchUpWords(row as NonNullable<typeof row>)).toBe(
      "caught up 100 of 100 sessions (100 parts written); 4 sessions still owed, 4 parts (4 were over the run's ceiling)",
    );
    for (const id of ids.slice(0, 100)) expect(owes(id)).toBe(false);
    for (const id of ids.slice(100)) expect(owes(id)).toBe(true);
  }, 120_000);

  test("the command does not read the night's ceiling: with the night's set to 1, it still clears all 5 owed", async () => {
    const ids = owedSessions("k", 5);
    const { TUNABLES: T } = await import("../src/adapters/config.js");
    const before = T.NIGHT_WRITE_UP_PARTS;
    (T as { NIGHT_WRITE_UP_PARTS: number }).NIGHT_WRITE_UP_PARTS = 1;
    try {
      const code = await run(["catch-up", "--dir", dir], { io: { out: () => undefined, err: () => undefined }, env: { PATH: "/usr/bin:/bin" }, catchUpStart: drivingChild([]) });
      expect(code).toBe(EXIT.ok);
    } finally {
      (T as { NIGHT_WRITE_UP_PARTS: number }).NIGHT_WRITE_UP_PARTS = before;
    }
    for (const id of ids) expect(owes(id)).toBe(false);
    const c = openNightCounterpart(config());
    closers.push(c);
    expect(catchUpOf(c.store)).toMatchObject({ state: "done", written: 5, parts: 5, left: 0, limit: null });
  });

  test("the command reads its own: set to 2, it stops at 2 parts and says what is left stays owed", async () => {
    const ids = owedSessions("m", 3);
    const out: string[] = [];
    const { TUNABLES: T } = await import("../src/adapters/config.js");
    const before = T.CATCH_UP_COMMAND_PARTS;
    (T as { CATCH_UP_COMMAND_PARTS: number }).CATCH_UP_COMMAND_PARTS = 2;
    try {
      const code = await run(["catch-up", "--dir", dir], { io: { out: (l) => out.push(l), err: () => undefined }, env: { PATH: "/usr/bin:/bin" }, catchUpStart: drivingChild([]) });
      expect(code).toBe(EXIT.ok);
    } finally {
      (T as { CATCH_UP_COMMAND_PARTS: number }).CATCH_UP_COMMAND_PARTS = before;
    }
    expect(ids.map(owes)).toEqual([false, false, true]);
    expect(out).toContain("What is left stays owed: run this again, or the nightly run takes it.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the night starts when write-ups from an earlier day are owed, even when the dream is not due (2026-10-11)", () => {
  const NIGHTLY = "/pkg/bin/nightly.ts";
  let plans: SpawnPlan[] = [];
  let offsetMs = 0;
  // THE CATCH-UP ALONE is what these pin, so owed write-ups do NOT count as new here (S2's
  // `OWED_COUNTS_AS_NEW`, on by default, would make most of these nights whole); the S2 tests
  // at the end of this block turn it back on.
  const D = DREAM_TUNABLES as { OWED_COUNTS_AS_NEW: boolean };
  const owedCounted = D.OWED_COUNTS_AS_NEW;
  beforeEach(() => {
    plans = [];
    offsetMs = 0;
    D.OWED_COUNTS_AS_NEW = false;
  });
  afterEach(() => {
    D.OWED_COUNTS_AS_NEW = owedCounted;
  });

  /** The hooks as install leaves a NEW store (dreaming `auto`, the meeting not started), a clock the test moves, and a spawner that records. */
  function hooksAt(opts: { setting?: "auto" | "ask" | "off" | "new-install"; observer?: boolean } = {}): ClaudeCodeAdapter {
    const counterpart = Counterpart.open({ dir, ...(opts.observer === true ? { observer: true } : {}), now: () => Date.now() + offsetMs });
    closers.push(counterpart);
    const setting = opts.setting ?? "new-install";
    if (opts.observer !== true) {
      if (setting === "new-install") beginNewInstall(counterpart.store);
      else counterpart.dreams.setSetting(setting, { by: "owner" });
    }
    return new ClaudeCodeAdapter({
      counterpart,
      config: config(opts.observer === true ? { observer: true } : {}),
      command: "/usr/bin/bun",
      args: ["run", "/pkg/bin/runner.ts"],
      nightArgs: ["run", NIGHTLY],
      spawner: (p) => {
        plans.push(p);
        return { pid: 4242 };
      },
      now: () => Date.now() + offsetMs,
    });
  }
  const nightPlans = (): SpawnPlan[] => plans.filter((p) => p.args.includes(NIGHTLY));

  function prompt(a: ClaudeCodeAdapter, session: string, over: Partial<HookInput> = {}): ReturnType<ClaudeCodeAdapter["userPromptSubmit"]> {
    recordSession(dir, { sessionId: session, scope: launch, phase: "start" });
    return a.userPromptSubmit({ sessionId: session, scope: launch, turns: [], at: TODAY(), prompt: "good morning", ...over } as HookInput);
  }

  /** `n` memories the person saved, on the store's lived day. */
  function saved(c: Counterpart, n: number): void {
    const day = c.store.livedDay();
    for (let i = 0; i < n; i++) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `Saved on the first day, ${String(i)}: the pump on loop ${String(i)} runs only after its relief valve is seated.`,
        salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
        physics: { birthDay: day, lastUsedDay: day },
      });
    }
  }

  /** The detached process's side, as `bin/nightly.ts` runs it: the run the hook planned, with the kind it was told. */
  async function nightOf(plan: SpawnPlan, seen: ChildPlan[], started: ChildPlan[], opts: { dated?: boolean } = {}): Promise<Awaited<ReturnType<typeof runNight>>> {
    return runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: String(plan.env[NIGHT_RUN_ENV]),
      session: String(plan.env[SESSION_ENV]),
      scope: String(plan.env[SCOPE_ENV]),
      kind: readKind(plan.env[NIGHT_KIND_ENV]),
      // `bin/nightly.ts` names no date: the run reads the store's today.
      ...(opts.dated === false ? {} : { date: TODAY() }),
      startCatchUp: drivingChild(seen),
      start: async (p) => {
        started.push(p);
        return { code: 0, timedOut: false, error: null };
      },
    });
  }

  test("a NEW install, the meeting skipped, two memories saved on day 1, its sessions ended owing: day 2's first prompt starts the night, the catch-up writes day 1 up, the dream is skipped and says why", async () => {
    lived("day1-a", proj);
    lived("day1-b", other, { at: YESTERDAY_10() + 2 * HOUR });
    const a = hooksAt();
    const c = a.counterpart;
    // The first session's end moved the lived day past the first.
    c.store.advanceClock(YESTERDAY());
    saved(c, 2);
    expect(c.dreams.setting()).toBe("auto");
    expect(c.dreams.status(TODAY()).reason).toBe("too-little-new");
    expect(owes("day1-a")).toBe(true);
    expect(owes("day1-b")).toBe(true);

    const turn = prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    expect(plan.env[NIGHT_KIND_ENV]).toBe("catch-up:too-little-new");
    expect(readKind(plan.env[NIGHT_KIND_ENV])).toEqual({ kind: "night", dreamSkipped: "too-little-new" });
    // The day is claimed through the one latch, and the log says why.
    expect(c.store.dreamAsk(TODAY())?.state).toBe("launched");
    const asked = c.store.eventLog({ name: "dream.ask" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(asked.find((p) => p["state"] === "launched")?.["dreamSkipped"]).toBe("too-little-new");
    expect(c.dreams.nightRun()).toMatchObject({ state: "started", kind: "night", session: "day2-1", date: TODAY() });
    // While it runs, doctor already says what it is (review of #426), not "the whole night".
    const running = nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
    expect(running?.detail).toContain("running now (the catch-up alone; too little new to dream on)");
    // Nothing said to anyone: no line for the model, none for the terminal.
    expect(turn.dream).toBeUndefined();
    expect(turn.injection ?? "").not.toContain("nightly run");
    // A second session's prompt starts nothing more.
    prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(1);

    const seen: ChildPlan[] = [];
    const started: ChildPlan[] = [];
    const out = await nightOf(plan, seen, started);
    // The catch-up ran and wrote day 1 up; no dream child, no reflection child.
    expect(seen).toHaveLength(1);
    expect(started).toEqual([]);
    expect(owes("day1-a")).toBe(false);
    expect(owes("day1-b")).toBe(false);
    expect(out).toMatchObject({ state: "done", reason: null, kind: "night", dream: null, reflection: null, parts: [] });
    expect(out.children).toEqual([
      { child: "dream", code: null, ms: 0, skipped: "too-little-new" },
      { child: "reflection", code: null, ms: 0, skipped: "too-little-new" },
    ]);
    const night = c.store.eventLog({ name: "dream.night" }).map((e) => JSON.parse(e.payload ?? "{}") as Record<string, unknown>);
    expect(night.find((p) => p["state"] === "done")?.["children"]).toBe("dream:skipped-too-little-new,reflection:skipped-too-little-new");
    expect(catchUpOf(c.store, out.run)).toMatchObject({ state: "done", granted: 2, written: 2, left: 0 });

    // Doctor: green, the catch-up alone, never a failed dream. The CLI line says the same.
    const row = c.dreams.nightRun();
    if (row === null) throw new Error("no row");
    const found = nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
    expect(found?.severity).toBe("green");
    expect(found?.detail).toContain("(the catch-up alone; too little new to dream on) finished");
    expect(found?.detail).toContain("catch-up: caught up 2 of 2 sessions");
    expect(nightRunLine(row)).toContain("done (the catch-up alone) — the catch-up ran; the dream and the reflection were skipped (too little new to dream on)");
    // No hand-back for it: the mechanism did the work, it does not remind.
    expect(prompt(a, "day2-3", { prompt: "back again" }).injection ?? "").not.toContain("the nightly run");
  });

  test("no session end ever processed (lived day 0, `first-day`): the night still starts and writes day 1 up", async () => {
    lived("crash-1", proj, { end: false });
    const a = hooksAt();
    saved(a.counterpart, 1);
    expect(a.counterpart.store.livedDay()).toBe(0);
    expect(a.counterpart.dreams.status(TODAY()).reason).toBe("first-day");
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    expect(plan.env[NIGHT_KIND_ENV]).toBe("catch-up:first-day");
    const out = await nightOf(plan, [], [], { dated: false });
    expect(owes("crash-1")).toBe(false);
    expect(out.state).toBe("done");
    expect(out.date).toBe(TODAY());
    expect(a.counterpart.dreams.nightRun()?.date).toBe(TODAY());
    expect(out.children?.map((ch) => ch.skipped)).toEqual(["first-day", "first-day"]);
  });

  test("a person whose only day was day 1 comes back on day 5: day 1 is still owed (lapse counts days of USE), and the night writes it up", async () => {
    lived("day1-a", proj, { at: midnight() - 4 * 24 * HOUR + 10 * HOUR });
    const a = hooksAt();
    a.counterpart.store.advanceClock(addDays(TODAY(), -4));
    saved(a.counterpart, 2);
    expect(owes("day1-a")).toBe(true);
    prompt(a, "day5-1");
    expect(nightPlans()).toHaveLength(1);
    await nightOf(nightPlans()[0] as SpawnPlan, [], []);
    expect(owes("day1-a")).toBe(false);
  });

  test("dream due AND write-ups owed: ONE night, the whole one — the catch-up, then the dream's child", async () => {
    lived("day1-a", proj);
    const a = hooksAt();
    const c = a.counterpart;
    for (const back of [3, 2, 1]) c.store.advanceClock(addDays(TODAY(), -back));
    saved(c, 4);
    expect(c.dreams.status(TODAY()).due).toBe(true);
    prompt(a, "day2-1");
    prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    expect(plan.env[NIGHT_KIND_ENV]).toBe("night");
    const seen: ChildPlan[] = [];
    const started: ChildPlan[] = [];
    await nightOf(plan, seen, started);
    expect(seen).toHaveLength(1);
    expect(started.length).toBeGreaterThan(0);
    expect(owes("day1-a")).toBe(false);
  });

  test("nothing owed and the dream not due: no night (unchanged) — nor for a session that ended TODAY", () => {
    const a = hooksAt();
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(0);
    // Owed, but from today: tomorrow's.
    lived("today-1", proj, { at: Math.max(midnight() + MIN, Date.now() - 2 * HOUR) });
    expect(owes("today-1")).toBe(true);
    prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(0);
    expect(a.counterpart.store.dreamAsk(TODAY())).toBeUndefined();
  });

  test("review of #426: a day that read nothing owed from an earlier day remembers it — the held sessions are read once that day, not at every prompt — and the next day reads again", () => {
    const a = hooksAt();
    const c = a.counterpart;
    saved(c, 2);
    lived("today-1", proj, { at: Math.max(midnight() + MIN, Date.now() - 2 * HOUR) });
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(0);
    expect(c.store.getMeta(NOTHING_OWED_BEFORE_KEY)).toBe(TODAY());
    // Pinned trade-off: an earlier day's debt that turns up later the same day
    // (it cannot, short of a late capture) waits for tomorrow — 14 days of use
    // to lapse, so nothing is lost.
    lived("day1-late", other);
    expect(owes("day1-late")).toBe(true);
    prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(0);
    // The next calendar day reads again, and today's session is now owed from an earlier day.
    prompt(a, "day3-1", { at: addDays(TODAY(), 1) });
    expect(nightPlans()).toHaveLength(1);
    expect(nightPlans()[0]?.env[NIGHT_KIND_ENV]).toMatch(/^catch-up:/);
  });

  test("dreaming `ask`: no night starts, and the next session's pointer is how it gets written up, as before", () => {
    lived("day1-a", proj);
    const a = hooksAt({ setting: "ask" });
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(0);
    const start = a.sessionStart({ sessionId: "here-1", scope: proj, at: TODAY() } as HookInput);
    expect(start.ask ?? "").toContain("writeUp: day1-a");
  });

  test("dreaming `off` keeps its promise — nothing starts the nightly run, no catch-up either — and the pointer still works", () => {
    lived("day1-a", proj);
    const a = hooksAt({ setting: "off" });
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    prompt(a, "day2-2", { entrypoint: "sdk-cli" });
    expect(nightPlans()).toHaveLength(0);
    expect(a.counterpart.dreams.nightRun()).toBeNull();
    expect(a.counterpart.store.dreamAsk(TODAY())).toBeUndefined();
    expect(dreamingSettingWords("off")).toContain("nothing starts the nightly run");
    const start = a.sessionStart({ sessionId: "here-1", scope: proj, at: TODAY() } as HookInput);
    expect(start.ask ?? "").toContain("writeUp: day1-a");
  });

  test("the claim: two offers raced to the latch, one wins — and two sessions prompting on day 2 start ONE run", () => {
    lived("day1-a", proj);
    const a = hooksAt();
    saved(a.counterpart, 2);
    const dreams = a.counterpart.dreams;
    const one = dreams.catchUpOffer({ at: TODAY(), session: "x-1" });
    const two = dreams.catchUpOffer({ at: TODAY(), session: "x-2" });
    if (one === null || two === null) throw new Error("no offer");
    expect([dreams.claimOffer(one), dreams.claimOffer(two)]).toEqual([true, false]);
    expect(dreams.catchUpOffer({ at: TODAY(), session: "x-3" })).toBeNull();
  });

  test("the claim through the hooks: three sessions prompting on day 2, watched or not, start one run", () => {
    lived("day1-a", proj);
    const a = hooksAt();
    const b = hooksAt();
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    prompt(b, "day2-2");
    prompt(b, "day2-3", { entrypoint: "sdk-cli" });
    expect(nightPlans()).toHaveLength(1);
  });

  test("the exclusions hold: an observer and a night child's own prompt start nothing; a session nobody watches may start it, and holds no line for it", () => {
    lived("day1-a", proj);
    const watcher = hooksAt({ observer: true });
    prompt(watcher, "obs-1");
    expect(nightPlans()).toHaveLength(0);
    const a = hooksAt();
    saved(a.counterpart, 2);
    prompt(a, "child-1", { nightRun: true });
    expect(nightPlans()).toHaveLength(0);
    prompt(a, "sdk-1", { entrypoint: "sdk-cli" });
    expect(nightPlans()).toHaveLength(1);
    expect(nightPlans()[0]?.env[NIGHT_KIND_ENV]).toBe("catch-up:first-day");
    expect(a.counterpart.dreams.heldTold(TODAY(), "next-1")).toBeNull();
  });

  test("a catch-up that could not start: the row says so (amber under auto), and no ask follows — there is no dream to ask about", async () => {
    lived("day1-a", proj);
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    const plan = nightPlans()[0] as SpawnPlan;
    const out = await runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: String(plan.env[NIGHT_RUN_ENV]),
      session: "day2-1",
      scope: launch,
      kind: readKind(plan.env[NIGHT_KIND_ENV]),
      date: TODAY(),
      startCatchUp: async () => ({ code: null, timedOut: false, error: "spawn ENOENT", spawnCode: "ENOENT" }),
      start: async () => {
        throw new Error("the dream's child must not start");
      },
    });
    expect(out).toMatchObject({ state: "could-not-start", reason: "spawn-failed", detail: "catch-up" });
    expect(owes("day1-a")).toBe(true);
    offsetMs += 5_000;
    const next = prompt(a, "day2-2");
    expect(next.dream).toBeUndefined();
    expect(nightPlans()).toHaveLength(1);
    expect(nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, a.counterpart.store)[0]?.severity).toBe("amber");
    // The dream comes due later that day (review of #426): under `auto` the
    // catch-up's failure turns nothing into an ask — no "I couldn't start
    // dreaming" — the ordinary relaunch starts the whole night, headless.
    saved(a.counterpart, 2);
    expect(a.counterpart.dreams.status(TODAY()).reason).toBe("asked-today");
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    expect(a.counterpart.dreams.status(TODAY()).due).toBe(true);
    const later = prompt(a, "day2-3");
    expect(nightPlans()).toHaveLength(2);
    expect(nightPlans()[1]?.env[NIGHT_KIND_ENV]).toBe("night");
    expect(later.dream?.offer ?? null).toBeNull();
    expect(later.injection ?? "").not.toContain("couldn't start dreaming");
    expect(later.injection ?? "").not.toContain("could not start");
  });

  test("a catch-up-only run whose own process could not start (the runner): the row reads as the catch-up alone, and no ask follows even once the dream is due", () => {
    lived("day1-a", proj);
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 2);
    // Nothing could start the background process at all.
    const failing = new ClaudeCodeAdapter({
      counterpart: a.counterpart,
      config: config(),
      command: "/usr/bin/bun",
      args: ["run", "/pkg/bin/runner.ts"],
      nightArgs: ["run", NIGHTLY],
      spawner: () => {
        throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
      },
      now: () => Date.now() + offsetMs,
    });
    prompt(failing, "day2-1");
    const row = a.counterpart.dreams.nightRun();
    expect(row).toMatchObject({ state: "could-not-start", reason: "runner" });
    expect(row?.children?.map((ch) => ch.skipped)).toEqual(["too-little-new", "too-little-new"]);
    expect(nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, a.counterpart.store)[0]?.detail).toContain("(the catch-up alone; too little new to dream on) could not start");
    saved(a.counterpart, 2);
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    const later = prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(1);
    expect(nightPlans()[0]?.env[NIGHT_KIND_ENV]).toBe("night");
    expect(later.dream?.offer ?? null).toBeNull();
    expect(later.injection ?? "").not.toContain("couldn't start dreaming");
  });

  test("pinned: once the catch-up has brought the queue to three, the ordinary relaunch dreams later that day (after the quiet window)", async () => {
    lived("day1-a", proj);
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 2);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    await nightOf(nightPlans()[0] as SpawnPlan, [], []);
    // The write-up's memory makes three: inside the quiet window, nothing.
    prompt(a, "day2-2");
    expect(nightPlans()).toHaveLength(1);
    offsetMs += DREAM_TUNABLES.ABANDONED_AFTER_MS + 60_000;
    prompt(a, "day2-3");
    expect(nightPlans()).toHaveLength(2);
    expect(nightPlans()[1]?.env[NIGHT_KIND_ENV]).toBe("night");
  });

  // ── S2 (2026-10-26): short sessions written up ───────────────────────────
  /** Two short check-ins yesterday (two lines each, 8 minutes: under the 15-minute floor), no record of their own. */
  function checkIns(): void {
    lived("checkinA", proj, { pieces: 2, at: YESTERDAY_10() + 5 * HOUR });
    lived("checkinB", proj, { pieces: 2, at: YESTERDAY_10() + 7 * HOUR });
  }

  test("S2: two short check-ins with no record are owed, and with one saved memory make three — day 2's first prompt starts the WHOLE night, its catch-up first", async () => {
    D.OWED_COUNTS_AS_NEW = true;
    checkIns();
    const a = hooksAt();
    const c = a.counterpart;
    c.store.advanceClock(YESTERDAY());
    saved(c, 1);
    expect(c.dreams.status(TODAY()).reason).toBe("too-little-new");
    expect(owes("checkinA")).toBe(true);
    expect(owes("checkinB")).toBe(true);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    // Not the catch-up alone: 1 new + 2 owed write-ups reach `MIN_NEW` — a whole night that says why
    // (S2 review), so it reads the queue again after its catch-up.
    expect(plan.env[NIGHT_KIND_ENV]).toBe(OWED_AS_NEW_KIND);
    expect(readKind(plan.env[NIGHT_KIND_ENV])).toEqual({ kind: "night", owedAsNew: true });
    expect(c.store.dreamAsk(TODAY())?.state).toBe("launched");
    const seen: ChildPlan[] = [];
    const started: ChildPlan[] = [];
    const out = await nightOf(plan, seen, started);
    // The catch-up ran first and wrote both up through the door; then the night's own children were asked.
    expect(seen).toHaveLength(1);
    expect(owes("checkinA")).toBe(false);
    expect(owes("checkinB")).toBe(false);
    expect(started.length).toBeGreaterThan(0);
    expect((out.children ?? []).some((ch) => ch.skipped !== undefined)).toBe(false);
    expect(catchUpOf(c.store, out.run)).toMatchObject({ granted: 2, written: 2, left: 0, parts: 2 });
  });

  test("S2: under three even with the owed counted (none saved, two owed), the night is still the catch-up alone", async () => {
    D.OWED_COUNTS_AS_NEW = true;
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    expect(nightPlans()[0]?.env[NIGHT_KIND_ENV]).toBe("catch-up:too-little-new");
  });

  test("S2, the Dana shape: a chapter, then check-ins with none — the next wake's Last here names the newest check-in, not the chapter; once the night writes it up, its write-up is named", async () => {
    // The meeting: two lines, then a chapter through the memory's own `chapter` tool, which claims what it said.
    lived("meetingX", proj, { pieces: 2, at: YESTERDAY_10() });
    const at = YESTERDAY_10() + HOUR;
    const mc = Counterpart.open({ dir, now: () => at });
    let ep = "";
    try {
      const server = new McpServer({ counterpart: mc, session: "meetingX", scope: proj, now: () => at, env: {} });
      const ch = payload(await server.call("chapter", { session: "meetingX", title: "Meeting Robin", text: "We met; Robin is a nurse on a new ward." }));
      ep = String(ch["episodeId"]);
    } finally {
      mc.close();
    }
    expect(ep).toMatch(/^epi_/);
    expect(owes("meetingX")).toBe(false);
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: 9_000, at: TODAY() });
    // The wake the next session here would get (the session start composes it so; read here so no meeting begins).
    const before = a.counterpart.wake(9_000, { date: TODAY() }, { scope: proj, session: "morning-1" }).text;
    expect(before).toMatch(/Last here: session checkinB, [^\n]*, no chapter, not written up yet\./);
    expect(before).toContain(`\nBefore it: session meetingX`);
    expect(before).toContain(`(${ep})`);
    // The night writes both up (the catch-up alone: nothing saved, two owed).
    prompt(a, "day2-1");
    await nightOf(nightPlans()[0] as SpawnPlan, [], []);
    a.counterpart.rebrief({ budgetBytes: 9_000, at: TODAY() });
    const after = a.counterpart.wake(9_000, { date: TODAY() }, { scope: proj, session: "morning-2" }).text;
    expect(after).toMatch(/Last here: session checkinB, [^\n]*, no chapter — "Written up from checkinB, part 1[^"]*" \(mem_[0-9a-f]+\)\./);
    expect(after).toContain(`(${ep})`);
  });

  // ── S2 review (2026-10-26): the awkward states ───────────────────────────
  /** The detached process's side with a catch-up seat that answers as told, and a starter that records every night child. */
  async function nightWith(plan: SpawnPlan, startCatchUp: (p: ChildPlan) => Promise<ChildResult>, started: ChildPlan[]): Promise<Awaited<ReturnType<typeof runNight>>> {
    return runNight({
      open: () => openNightCounterpart(config()),
      config: config(),
      run: String(plan.env[NIGHT_RUN_ENV]),
      session: String(plan.env[SESSION_ENV]),
      scope: String(plan.env[SCOPE_ENV]),
      kind: readKind(plan.env[NIGHT_KIND_ENV]),
      date: TODAY(),
      startCatchUp,
      start: async (p) => {
        started.push(p);
        return { code: 0, timedOut: false, error: null };
      },
    });
  }
  /** A session that said `n` lines a minute apart in `scope`, then ended — started as `entrypoint` says. */
  function quick(id: string, scope: string, n: number, from: number, entrypoint?: string): void {
    let at = from;
    const c = Counterpart.open({ dir, now: () => at });
    try {
      recordSession(dir, { sessionId: id, scope, phase: "start", at, ...(entrypoint === undefined ? {} : { entrypoint }) });
      const turns: { role: "user" | "assistant"; text: string }[] = [];
      for (let i = 0; i < n; i++) {
        at += MIN;
        turns.push({ role: "user", text: `${id} #${String(i)}: the relief valve on loop ${String(i)} is seated before the pump runs.` });
        turns.push({ role: "assistant", text: `(${id} #${String(i)}) Seat the valve on loop ${String(i)} first.` });
        c.captureSpans({ session: id, scope, turns: [...turns] });
      }
      c.boundary({ session: id, scope, kind: "stop" });
      c.boundary({ session: id, scope, kind: "session-end" });
      recordSession(dir, { sessionId: id, scope, phase: "end", at: at + 1 });
    } finally {
      c.close();
    }
  }

  test("S2 review: a night made whole by owed write-ups whose catch-up writes NOTHING ends as the catch-up alone — no writer, no dream, no reflection on too little new", async () => {
    D.OWED_COUNTS_AS_NEW = true;
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 1);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    const plan = nightPlans()[0] as SpawnPlan;
    expect(readKind(plan.env[NIGHT_KIND_ENV])).toMatchObject({ kind: "night" });
    const started: ChildPlan[] = [];
    // The model seat ran the catch-up and it exited cleanly having called nothing.
    const out = await nightWith(plan, async () => ({ code: 0, timedOut: false, error: null }), started);
    expect(started).toEqual([]);
    expect(out.state).toBe("done");
    expect(out.children).toEqual([
      { child: "dream", code: null, ms: 0, skipped: "too-little-new" },
      { child: "reflection", code: null, ms: 0, skipped: "too-little-new" },
    ]);
    expect(owes("checkinA")).toBe(true);
  });

  test("S2 review: a whole-by-owed night whose catch-up could not start ends could-not-start, its dream unasked", async () => {
    D.OWED_COUNTS_AS_NEW = true;
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 1);
    prompt(a, "day2-1");
    const started: ChildPlan[] = [];
    const out = await nightWith(nightPlans()[0] as SpawnPlan, async () => ({ code: null, timedOut: false, error: "spawn ENOENT", spawnCode: "ENOENT" }), started);
    expect(started).toEqual([]);
    expect(out).toMatchObject({ state: "could-not-start", detail: "catch-up" });
  });

  test("S2 review: a whole-by-owed night whose catch-up DID write goes on to the dream (the forecast came true)", async () => {
    D.OWED_COUNTS_AS_NEW = true;
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 1);
    prompt(a, "day2-1");
    const started: ChildPlan[] = [];
    const out = await nightWith(nightPlans()[0] as SpawnPlan, drivingChild([]), started);
    expect(started.length).toBeGreaterThan(0);
    expect((out.children ?? []).some((ch) => ch.skipped !== undefined)).toBe(false);
  });

  test("S2 review: twenty owed check-ins and a catch-up that writes nothing — the night is one child with at most a batch's parts, and the owed stay owed (re-planned, bounded, until they lapse)", async () => {
    for (let i = 0; i < 20; i++) lived(`ci-${String(i)}`, i % 2 === 0 ? proj : other, { pieces: 1, at: YESTERDAY_10() + i * 20 * MIN });
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    expect(owes("ci-0")).toBe(true);
    prompt(a, "day2-1");
    const seen: ChildPlan[] = [];
    const out = await nightWith(
      nightPlans()[0] as SpawnPlan,
      async (p) => {
        seen.push(p);
        return { code: 0, timedOut: false, error: null };
      },
      [],
    );
    expect(seen).toHaveLength(1);
    const row = catchUpOf(a.counterpart.store, out.run);
    expect(row).toMatchObject({ batches: 1, written: 0 });
    expect(row?.granted ?? 0).toBeLessThanOrEqual(TUNABLES.NIGHT_WRITE_UP_BATCH_PARTS);
    expect(owes("ci-19")).toBe(true);
  });

  test("S2 review: a one-line check-in answered with NOTHING stops owing (the door's own claim closes it)", async () => {
    lived("hello", proj, { pieces: 1, at: YESTERDAY_10() + 5 * HOUR });
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    expect(owes("hello")).toBe(true);
    prompt(a, "day2-1");
    // The writer finds nothing worth keeping and says so in one line, as the door asks.
    const out = await nightWith(
      nightPlans()[0] as SpawnPlan,
      async (plan) => {
        const runner = plan.env[SESSION_ENV] as string;
        const s = openServer({ dir, session: runner, scope: plan.env[SCOPE_ENV] as string });
        try {
          const f = payload(await s.call("session_end", { session: runner, writeUp: "hello" }));
          expect(f["reason"]).toBe("part");
          const back = payload(await s.call("session_end", { session: runner, writeUp: "hello", part: f["part"], memories: [], nothing: "a hello and nothing else" }));
          expect(back["reason"]).not.toBe("refused");
        } finally {
          s.counterpart.close();
        }
        return { code: 0, timedOut: false, error: null };
      },
      [],
    );
    expect(catchUpOf(a.counterpart.store, out.run)).toMatchObject({ written: 1, left: 0 });
    expect(owes("hello")).toBe(false);
  });

  test("S2 review: a short `claude -p` run (six quick lines, no record) is not taken by the night — only a person's short session is", async () => {
    quick("sdk-run", proj, 6, YESTERDAY_10() + 5 * HOUR, "sdk-cli");
    // Once its registry record is pruned (7 days on, while its owed text is kept until it lapses), nobody can
    // say whose it was: it still fails closed (S2 review).
    quick("sdkprune", proj, 6, YESTERDAY_10() + 6 * HOUR, "sdk-cli");
    rmSync(sessionPath(dir, "sdkprune") as string, { force: true });
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    expect(owes("sdk-run")).toBe(true);
    expect(owes("sdkprune")).toBe(true);
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(0);
  });

  test("S2 review: beside a person's short session, the night writes up the person's and passes the `claude -p` run over", async () => {
    quick("sdk-run", proj, 6, YESTERDAY_10() + 5 * HOUR, "sdk-cli");
    quick("cli-run", proj, 6, YESTERDAY_10() + 6 * HOUR, "cli");
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    prompt(a, "day2-1");
    expect(nightPlans()).toHaveLength(1);
    const seen: ChildPlan[] = [];
    await nightWith(nightPlans()[0] as SpawnPlan, drivingChild(seen), []);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.stdin).toContain("- cli-run:");
    expect(seen[0]?.stdin).not.toContain("sdk-run");
    expect(owes("cli-run")).toBe(false);
  });

  test("S2 review: the later session's line inside a tight ceiling — dropped whole, then the session alone, then with the chapter before it; never over the budget", () => {
    chapterYesterday("meetingY", "Meeting Robin");
    lived("meetingY", proj, { pieces: 2, at: YESTERDAY_10() });
    checkIns();
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: 9_000, at: TODAY() });
    const bytes = (t: string): number => new TextEncoder().encode(t).length;
    const plain = bytes(a.counterpart.wake(9_000, { date: TODAY() }).text);
    const at = (budget: number): string => a.counterpart.wake(budget, { date: TODAY() }, { scope: proj, session: "morning-1" }).text;
    const full = at(9_000);
    expect(full).toMatch(/Last here: session checkinB, [^\n]*, no chapter, not written up yet\.\nBefore it: session meetingY/);
    const lines = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("Last here:") || l.startsWith("Before it:"));
    let sawHeadAlone = false;
    // From the ceiling the stored bundle itself needs (under it the bundle is delivered as found, S2 or not).
    const floor = bytes(at(plain));
    for (let budget = floor; budget <= bytes(full) + 400; budget += 20) {
      const t = at(budget);
      expect(bytes(t)).toBeLessThanOrEqual(budget);
      const got = lines(t);
      // Never "Before it" without the line it follows.
      if (got.some((l) => l.startsWith("Before it:"))) expect(got[0]).toMatch(/^Last here: session checkinB, /);
      if (got.length === 1) sawHeadAlone = true;
    }
    expect(lines(at(floor))).toEqual([]);
    expect(sawHeadAlone).toBe(true);
  });

  test("S2 review: Last here in one folder never quotes what the same session noted in ANOTHER folder", async () => {
    lived("both", proj, { pieces: 2, at: YESTERDAY_10() + 5 * HOUR });
    const at = YESTERDAY_10() + 6 * HOUR;
    const mc = Counterpart.open({ dir, now: () => at });
    try {
      const server = new McpServer({ counterpart: mc, session: "both", scope: other, now: () => at, env: {} });
      const r = payload(await server.call("remember", { text: "In the other folder: the vault code for the side project is 4417, keep it there.", title: "Vault code 4417" }));
      expect(JSON.stringify(r)).toMatch(/mem_[0-9a-f]+/);
    } finally {
      mc.close();
    }
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: 9_000, at: TODAY() });
    const text = a.counterpart.wake(9_000, { date: TODAY() }, { scope: proj, session: "morning-1" }).text;
    const line = text.split("\n").find((l) => l.startsWith("Last here:")) ?? "";
    expect(line).toMatch(/^Last here: session both, /);
    expect(line).not.toContain("4417");
    expect(line).toContain("not written up yet");
  });

  // ── review of #636's follow-ups (2026-10-26): headless runs, and room with no chapter ──
  /** What SessionStart hands a person's session opening in `proj` (Claude Code's own entrypoint). */
  function wokeHere(a: ClaudeCodeAdapter, session: string): string {
    const out = a.sessionStart({ sessionId: session, scope: proj, at: TODAY(), entrypoint: "cli" } as HookInput);
    expect(out.ok).toBe(true);
    return out.injection;
  }
  const lastHereLines = (t: string): string[] => t.split("\n").filter((l) => l.startsWith("Last here:") || l.startsWith("Before it:"));
  /** Enough to fill the lanes at the ceiling: long identity elements past the lane's count, and "Nearby" memories. */
  function fullLanes(c: Counterpart): void {
    for (let i = 0; i < 40; i++) {
      c.store.put({
        type: "memory",
        kind: "fact",
        body: `Working note ${String(i)}: the pump on loop ${String(i)} runs only after its relief valve is seated, and the reservoir is topped up first.`,
        salience: { relevance: 0.8, emotional: 0.5, predictive: 0.7 },
        physics: { birthDay: c.store.livedDay(), lastUsedDay: c.store.livedDay() },
      });
    }
    for (let i = 0; i < 60; i++) {
      c.store.put({
        type: "memory",
        kind: "self",
        body: `Placeholder identity element ${String(i)}, written long enough to compete for the budget. `.repeat(4).trim(),
        band: "identity",
        learnedOn: c.store.today(),
        salience: { relevance: 0.9, emotional: 0.6, predictive: 0.6 },
        physics: { promotedIdentity: true },
      });
    }
  }

  test("review of #636: a `claude -p` run is never named in its own folder's Last here; the person's session before it is", () => {
    lived("person-1", proj, { pieces: 2, at: YESTERDAY_10() + 5 * HOUR });
    quick("sdk-run", proj, 6, YESTERDAY_10() + 7 * HOUR, "sdk-cli");
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    const text = wokeHere(a, "morning-1");
    // "Last here" only: "Last said here" (inside about a day, so by the clock) may quote the run (review of #638).
    expect(lastHereLines(text).join("\n")).not.toContain("sdk-run");
    expect(lastHereLines(text)[0]).toMatch(/^Last here: session person-1, [^\n]*, no chapter, not written up yet\.$/);
  });

  test("review of #636: a folder whose only later session is a `claude -p` run shows no Last here for it; a person's chapterless one alone shows", () => {
    quick("sdk-only", proj, 6, YESTERDAY_10() + 7 * HOUR, "sdk-cli");
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    expect(lastHereLines(wokeHere(a, "morning-1"))).toEqual([]);
    // The same shape, a person's session: it is named.
    quick("cli-only", proj, 6, YESTERDAY_10() + 8 * HOUR, "cli");
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    expect(lastHereLines(wokeHere(a, "morning-2"))[0]).toMatch(/^Last here: session cli-only, /);
  });

  test("review of #636: no chapter, full lanes, a 9,000 B wake — the boundary reserves the chapterless line's room, and SessionStart carries it inside the ceiling", () => {
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    fullLanes(a.counterpart);
    // Nothing later here yet: no line, and nothing reserved for one.
    const bare = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() }).composeBudget as number;
    checkIns();
    const reserved = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() }).composeBudget as number;
    const text = wokeHere(a, "morning-1");
    const bytes = (t: string): number => new TextEncoder().encode(t).length;
    expect(bytes(text)).toBeGreaterThan(BUDGET - 1_000);
    expect(bytes(text)).toBeLessThanOrEqual(BUDGET);
    const got = lastHereLines(text);
    expect(got).toEqual([expect.stringMatching(/^Last here: session checkinB, [^\n]*, no chapter, not written up yet\.$/)]);
    // The lanes gave up the line's room at the boundary (before this, with no chapter, the reserve was zero).
    expect(bare - reserved).toBeGreaterThanOrEqual(bytes(got[0] as string));
    expect(a.counterpart.store.eventLog({ name: LAST_HERE_NOROOM_EVENT })).toHaveLength(0);
  });

  test("review of #636: with no room at all the chapterless line steps down cleanly — never over the ceiling, and its no-room row names the session it would have named", () => {
    checkIns();
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    fullLanes(a.counterpart);
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    const bytes = (t: string): number => new TextEncoder().encode(t).length;
    // Delivered under ceilings tighter than the one it was composed to, from the bundle's own size up.
    const at = (budget: number, n: number): string => a.counterpart.wake(budget, { date: TODAY() }, { scope: proj, session: `morning-${String(n)}` }).text;
    const floor = bytes(at(bytes(a.counterpart.wake(BUDGET, { date: TODAY() }).text), 0));
    let dropped = 0;
    let shown = 0;
    for (let budget = floor, n = 1; budget <= floor + 400; budget += 20, n++) {
      const t = at(budget, n);
      expect(bytes(t)).toBeLessThanOrEqual(budget);
      const got = lastHereLines(t);
      if (got.length === 0) dropped++;
      else {
        shown++;
        expect(got).toEqual([expect.stringMatching(/^Last here: session checkinB, /)]);
      }
    }
    expect(dropped).toBeGreaterThan(0);
    expect(shown).toBeGreaterThan(0);
    const rows = a.counterpart.store.eventLog({ name: LAST_HERE_NOROOM_EVENT });
    expect(rows.map((r) => r.ref)).toEqual(["checkinB"]);
    // The dashboard reads the ref as the session it is, not an unknown memory (review of #638).
    expect(narrate(a.counterpart.store, rows[0] as Parameters<typeof narrate>[1]).subject).toBe("session checkinB");
  });

  // ── review of #638 (2026-10-26): the awkward states, through SessionStart ──
  test("review of #638: more `claude -p` runs than the walk tries, all newer than the person's session — the person's is still named", () => {
    lived("person-1", proj, { pieces: 2, at: YESTERDAY_10() + 2 * HOUR });
    for (let i = 0; i < 5; i++) quick(`sdk-${String(i)}`, proj, 3, YESTERDAY_10() + (4 + i) * HOUR, "sdk-cli");
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    const text = wokeHere(a, "morning-1");
    expect(lastHereLines(text).join("\n")).not.toMatch(/sdk-\d/);
    expect(lastHereLines(text)[0]).toMatch(/^Last here: session person-1, /);
  });

  test("review of #638: a `claude -p` run whose registry record was pruned reads as a person's — named, inside the ceiling", () => {
    lived("person-1", proj, { pieces: 2, at: YESTERDAY_10() + 2 * HOUR });
    quick("sdkprune", proj, 3, YESTERDAY_10() + 6 * HOUR, "sdk-cli");
    rmSync(sessionPath(dir, "sdkprune") as string, { force: true });
    expect(readSession(dir, "sdkprune")).toBeNull();
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    const text = wokeHere(a, "morning-1");
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(BUDGET);
    expect(lastHereLines(text)[0]).toMatch(/^Last here: session sdkprune, [^\n]*, no chapter, not written up yet\.$/);
  });

  test("review of #638: nothing crosses folders — a headless run and a person's session in another folder change neither folder's line", () => {
    lived("pproj", proj, { pieces: 2, at: YESTERDAY_10() + 2 * HOUR });
    lived("pother", other, { pieces: 2, at: YESTERDAY_10() + 3 * HOUR });
    quick("sdk-other", other, 3, YESTERDAY_10() + 6 * HOUR, "sdk-cli");
    quick("sdk-proj", proj, 3, YESTERDAY_10() + 7 * HOUR, "sdk-cli");
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    const inProj = lastHereLines(wokeHere(a, "morning-1"));
    expect(inProj).toHaveLength(1);
    expect(inProj[0]).toMatch(/^Last here: session pproj, /);
    const out = a.sessionStart({ sessionId: "morning-2", scope: other, at: TODAY(), entrypoint: "cli" } as HookInput);
    expect(out.ok).toBe(true);
    const inOther = lastHereLines(out.injection);
    expect(inOther).toHaveLength(1);
    expect(inOther[0]).toMatch(/^Last here: session pother, /);
  });

  test("review of #638: a brand-new user's first days — the second session is told of the first, and the reserve trims nothing on a store that does not fill the wake", () => {
    const a = hooksAt();
    a.counterpart.store.advanceClock(YESTERDAY());
    saved(a.counterpart, 3);
    const bare = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    lived("first", proj, { pieces: 2, at: YESTERDAY_10() + 2 * HOUR });
    const after = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() });
    // The line's room is held back at the boundary...
    expect((bare.composeBudget as number) - (after.composeBudget as number)).toBeGreaterThan(0);
    // ...and costs this store nothing: the bundle sits far under the budget, so no lane gave anything up.
    expect(after.bytes).toBeLessThan((after.composeBudget as number) / 2);
    expect(after.elements).toBeGreaterThanOrEqual(bare.elements);
    expect(lastHereLines(wokeHere(a, "second"))[0]).toMatch(/^Last here: session first, /);
  });

  test("review of #638: a folder whose only later session is headless leaves the bound's room unused — no line, no row, inside the ceiling", () => {
    const a = hooksAt({ setting: "auto" });
    a.counterpart.store.advanceClock(YESTERDAY());
    fullLanes(a.counterpart);
    const bare = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() }).composeBudget as number;
    quick("sdk-only", proj, 6, YESTERDAY_10() + 7 * HOUR, "sdk-cli");
    const reserved = a.counterpart.rebrief({ budgetBytes: BUDGET, at: TODAY() }).composeBudget as number;
    // The boundary has no registry: the bound counts the run (the PR's stated cost).
    expect(bare - reserved).toBeGreaterThan(0);
    const text = wokeHere(a, "morning-1");
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(BUDGET);
    expect(lastHereLines(text)).toEqual([]);
    expect(a.counterpart.store.eventLog({ name: LAST_HERE_NOROOM_EVENT })).toHaveLength(0);
  });

  test("review of #638: the shared walk — chaptersHereFor with the folder's sessions handed in equals its own walk, per scope and per reader", () => {
    lived("writer-a", proj, { pieces: 3, at: YESTERDAY_10() + 1 * HOUR });
    lived("writer-b", other, { pieces: 3, at: YESTERDAY_10() + 2 * HOUR });
    lived("writer-c", proj, { pieces: 3, at: YESTERDAY_10() + 4 * HOUR });
    lived("nobody", proj, { pieces: 2, at: YESTERDAY_10() + 6 * HOUR });
    chapterYesterday("writer-a", "Valve order on loop A");
    chapterYesterday("writer-b", "Reservoir top-up in the other folder");
    chapterYesterday("writer-c", "Pump start checklist");
    const a = hooksAt({ setting: "auto" });
    const c = a.counterpart;
    c.store.advanceClock(YESTERDAY());
    type Spans = Parameters<typeof sessionsHere>[0];
    type Chapters = NonNullable<Parameters<Counterpart["chaptersHereFor"]>[2]>;
    const cc = c as unknown as { spans: Spans; chaptersInWindow(day: number): Chapters };
    const all = cc.chaptersInWindow(c.store.livedDay());
    expect(all.size).toBe(3);
    let compared = 0;
    for (const scope of cc.spans.scopes()) {
      const here = sessionsHere(cc.spans, scope);
      for (const reader of [null, "writer-a", "writer-b", "writer-c", "nobody", "stranger"]) {
        const own = c.chaptersHereFor(scope, reader, all);
        expect(c.chaptersHereFor(scope, reader, all, here)).toEqual(own);
        compared += own.length;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});
