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
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TUNABLES } from "../src/adapters/config.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import type { ChildPlan, ChildResult } from "../src/adapters/claude-code/child.js";
import { nightRunFindings } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import {
  CATCH_UP_TOOLS,
  catchUpOf,
  catchUpRunner,
  catchUpWords,
  endStaleRunners,
  grantCatchUp,
  planCatchUp,
} from "../src/adapters/claude-code/night-catch-up.js";
import { openNightCounterpart, runNight } from "../src/adapters/claude-code/night-run.js";
import { openServer } from "../src/adapters/mcp/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import type { HookInput } from "../src/adapters/claude-code/hooks.js";
import type { ToolResult } from "../src/adapters/mcp/index.js";
import {
  NIGHT_RUNNER_PREFIX,
  WRITE_UP_REPLY_BYTES,
  WRITE_UP_REPLY_MARK,
  owedWriteUps,
  progressKey,
  readSession,
  readWriteUpProgress,
  recordSession,
  writeUpEntries,
  writeUpPlan,
} from "../src/adapters/sessions.js";
import { SCOPE_ENV, SESSION_ENV } from "../src/adapters/spawn.js";
import { readLog } from "../src/adapters/log/index.js";
import { openLog } from "../src/adapters/log/index.js";
import { Counterpart, NIGHT_WRITE_UP_EVENT } from "../src/core/counterpart.js";
import { chaptersOn, yesterdayLine } from "../src/core/handoff/last-here.js";
import { BRIEFING_KEY, SELF_TUNABLES, render } from "../src/core/self/index.js";
import { dayMemories, isOfDay } from "../src/core/self/writer.js";
import { Store } from "../src/core/store/index.js";
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

const config = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({ dataDir: dir, owner: true, injectionBudgetBytes: BUDGET, ...over });

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
  const c = Counterpart.open({ dir, owner: true, now: () => at });
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
  const c = Counterpart.open({ dir, owner: true, now: () => at });
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
    const s = openServer({ dir, owner: true, session: runner, scope });
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
      expect(line).toBe(`Yesterday, ${YESTERDAY().slice(5)}: "Seating the relief valves" (${ep}).`);
    } finally {
      s.close();
    }

    // DOCTOR's Nightly line carries the catch-up.
    c.dreams.setSetting("auto", { by: "owner" });
    const night = nightRunFindings({ today: TODAY(), config: { dataDir: dir } } as unknown as DoctorInput, c.store)[0];
    expect(night?.detail).toContain("catch-up: wrote up 2 of 2 sessions (2 parts); nothing left owed");
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
    expect(seen[0]?.stdin).toMatch(/- big-1: lived .*; parts 1–3 of 3 tonight\./);
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

    const s = openServer({ dir, owner: true, scope: proj });
    closers.push(s.counterpart);
    const refused = payload(await s.call("session_end", { session: "here-1", writeUp: "old-1" }));
    expect(refused).toMatchObject({ reason: "claimed", stored: false });
    expect(String(refused["detail"])).toContain("nightly run");
  });

  test("the other way round: a session that fetched it holds it, and tonight's plan does not grant it", async () => {
    lived("old-1", proj);
    recordSession(dir, { sessionId: "here-1", scope: proj, phase: "start", writeUpPointer: "old-1" });
    const s = openServer({ dir, owner: true, scope: proj });
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
    const s = openServer({ dir, owner: true, session: plan.runner, scope: launch });
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
    expect(catchUpWords({ state: "done", granted: 3, written: 2, parts: 5, left: 4, bounded: 2, busy: 0 })).toBe(
      "wrote up 2 of 3 sessions (5 parts); 4 sessions left owed (2 were over tonight's bound)",
    );
    expect(catchUpWords({ state: "timed-out", granted: 1, written: 0, parts: 1, left: 1, bounded: 0, busy: 0 })).toBe(
      "wrote up 0 of 1 session (1 part) before its watchdog stopped it; 1 session left owed",
    );
    expect(catchUpWords({ state: "none-granted", granted: 0, written: 0, parts: 0, left: 1, bounded: 0, busy: 1 })).toBe(
      "nothing to take (1 session was being written up elsewhere); 1 session left owed",
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
    const s = openServer({ dir, owner: true, session: "writeup-x", scope: launch });
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
  test("titles and ids, oldest first, the date in the line, chapters counted; the rest by count; none without a chapter that day", () => {
    const mk = (id: string, title: string | null, n: number, at: number) => ({ id, title, chapters: n, createdAt: at });
    const d = Date.UTC(2026, 8, 30, 9);
    const day = [mk("epi_a", "First thing", 1, d), mk("epi_b", "Second thing", 2, d + HOUR), mk("epi_c", null, 1, d + 2 * HOUR), mk("epi_d", "Fourth", 1, d + 3 * HOUR), mk("epi_e", "Fifth", 1, d + 4 * HOUR)];
    expect(yesterdayLine(day, "2026-09-30")).toBe(
      'Yesterday, 09-30: "First thing" (epi_a); "Second thing" (epi_b, 2 chapters); epi_c; "Fourth" (epi_d); and 1 more.',
    );
    expect(yesterdayLine([], "2026-09-27")).toBeNull();
  });

  test("chapters are read by the day each was WRITTEN: a session that chaptered yesterday and again today is still yesterday's, and two chapters yesterday count as two (review of #308)", () => {
    const at = (t: number): Counterpart => {
      const c = Counterpart.open({ dir, owner: true, now: () => t });
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
    const line = 'Yesterday, 09-30: "Seating the relief valves" (epi_a).';
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
    const big = Counterpart.open({ dir, owner: true, budgetBytes: BUDGET });
    closers.push(big);
    expect(big.refreshWake({ at: TODAY(), trigger: "run-end" }).reason).toBe("rendered");
    const s = Store.open({ dir, observer: true });
    try {
      expect(s.getMeta(BRIEFING_KEY) ?? "").toContain(`Yesterday, ${YESTERDAY().slice(5)}: "Seating the relief valves"`);
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
    const s = openServer({ dir, owner: true, session: runner, scope: launch });
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
    const bare = openServer({ dir, owner: true, session: "writeup-nrn_old", scope: launch });
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
    const s = openServer({ dir, owner: true, scope: proj });
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
    const s = openServer({ dir, owner: true, session: runner, scope: launch });
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
        const s = openServer({ dir, owner: true, session: runner, scope: plan.env[SCOPE_ENV] as string });
        try {
          const id = [...plan.stdin.matchAll(/^- ([A-Za-z0-9._-]+):/gm)][0]?.[1] as string;
          payload(await s.call("session_end", { session: runner, writeUp: id }));
          payload(await s.call("session_end", { session: runner, writeUp: id, memories: [] }));
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

  test("a bounded night that did every part it was allowed is `done`, not `partial`", async () => {
    const words = "the reservoir loop keeps its pressure only when the relief valve is seated first. ".repeat(70);
    lived("big-1", proj, { pieces: 12, say: (i) => `big-1 #${String(i)}: ${words}` });
    const seen: ChildPlan[] = [];
    const c0 = openNightCounterpart(config());
    const plan = planCatchUp(c0, { run: "nrn_bound", now: c0.store.now(), bytes: 1 });
    c0.close();
    expect(plan.subjects[0]).toMatchObject({ from: 1, upTo: 1 });
    // The same bound the run takes: TUNABLES are code, so the night here is
    // given a one-part allowance through its claim, as the launcher writes it.
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
    expect(seen[0]?.stdin).toContain("part 1 of 3 tonight");
    const c = openNightCounterpart(config());
    closers.push(c);
    const row = catchUpOf(c.store, "nrn_bound");
    expect(row).toMatchObject({ state: "done", granted: 1, written: 0, parts: 1, left: 1, bounded: 1 });
    expect(catchUpWords(row as NonNullable<typeof row>)).not.toContain("stopped before the rest");
    expect(owes("big-1")).toBe(true);
  });
});
