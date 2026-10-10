/**
 * CONTINUITY — can a new session pick up where the last one in this directory
 * left off? (2026-09-30, the continuity test.)
 *
 * Mike ended a ~/random session (an evening of reading: notes, a chapter,
 * session_end memories, NO handoff, because the work was finished), opened a
 * new one in the same directory two minutes later and asked "what do you
 * remember from our most recent session?". Nothing was lost; nothing pointed
 * at it. The wake's pointer moved only for a handoff, and the one that stood
 * (another session's, from 15:19) said "work here 16:01–17:53 since, not yet
 * written up" although a chapter had been written at 17:50.
 *
 * This file reproduces that afternoon on a temp store, through the same doors
 * the hooks and the MCP server use, and checks both halves:
 *   1. B's wake says who was last here, when, the chapter's title and id, and
 *      its first sentence — spliced at delivery, so it shows two minutes
 *      later, not only after the next boundary;
 *   2. the handoff pointer says how far the work since is written up;
 *   3. asked plainly, "what do you remember from our most recent session?",
 *      recall (facts mode, since Release B 2026-10-03) names that session in
 *      its header and answers with A's chapter first, then what A wrote, even
 *      with a busier session next door;
 *   4. every recall result says which session, which directory and when.
 *
 * Hermetic: every test makes its own temp directory and removes it. The clock
 * is pinned and the zone is UTC.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { sessionsHere } from "../src/core/coverage/index.js";
import {
  LAST_HERE_LIFE_DAYS,
  chaptersBySession,
  latestChapter,
  lastHereBlock,
  lastHereLadder,
} from "../src/core/handoff/last-here.js";
import type { LastHere } from "../src/core/handoff/last-here.js";
import { readRecencyAsk } from "../src/core/recall/index.js";
import { PREFACE_RESERVE_BYTES, WORK_HERE_HEADING, readSentinel } from "../src/core/self/index.js";
import { McpServer } from "../src/adapters/mcp/server.js";
import { recordSession } from "../src/adapters/sessions.js";

const MIN = 60_000;
const ZONE = "UTC";
/** 2026-09-30 00:00 UTC; the afternoon is counted from here. */
const DAY0 = Date.UTC(2026, 8, 30);
const at = (h: number, m: number): number => DAY0 + h * 60 * MIN + m * MIN;

/** Claude Code session ids are UUIDs; the wake prints the first eight. */
const A = "a1b2c3d4-0000-4000-8000-00000000000a";
const B = "b5b6b7b8-0000-4000-8000-00000000000b";
const C = "c9cacbcc-0000-4000-8000-00000000000c";

const TITLE = "An evening reading off the shelves: grief, anger, Job, and Montaigne at the table";
const CHAPTER =
  "We read four texts in a row and every one of them ended grief at a table. Karamazov first, then Iliad 24, then Job, then Montaigne's three meals.";

let root: string;
let storeDir: string;
let HERE: string;
let THERE: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-continuity-")));
  storeDir = join(root, "store");
  HERE = join(root, "random");
  THERE = join(root, "elsewhere");
  mkdirSync(HERE, { recursive: true });
  mkdirSync(THERE, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** A counterpart on a clock the test turns, in UTC, and the MCP server a
 *  session in HERE would talk to. */
function afternoon(): {
  c: Counterpart;
  set(t: number): void;
  server(session: string, scope?: string): McpServer;
  talk(session: string, t: number, scope?: string): void;
} {
  let now = at(15, 0);
  const c = Counterpart.open({ dir: storeDir, owner: true, now: () => now, timeZone: ZONE });
  open.push(c);
  const turns = new Map<string, { role: "user" | "assistant"; text: string }[]>();
  return {
    c,
    set(t: number): void {
      now = t;
    },
    server(session: string, scope = HERE): McpServer {
      return new McpServer({ counterpart: c, session, scope, owner: true, registryDir: storeDir, now: () => now });
    },
    // One turn, as the Stop hook captures it: the transcript so far, then the
    // turn-end.
    talk(session: string, t: number, scope = HERE): void {
      now = t;
      const held = turns.get(session) ?? [];
      held.push({ role: "user", text: `(${session.slice(0, 4)} at ${String(t)}) the next passage, read aloud and talked over at some length.` });
      held.push({ role: "assistant", text: `(${session.slice(0, 4)}) understood, and here is what it made me think of.` });
      turns.set(session, held);
      c.captureSpans({ session, scope, turns: [...held] });
      c.boundary({ session, scope, kind: "stop" });
    },
  };
}

function wake(c: Counterpart, session: string, scope = HERE): string {
  return c.wake(9_000, { date: "2026-09-30" }, { scope, session }).text;
}

/** Mike's afternoon: C's handoff at 15:19, a boundary at 15:30, then A's
 *  evening — turns from 16:01, notes, a chapter at 17:50, session_end with no
 *  handoff, and three more turns to 17:53. */
async function mikesAfternoon(k: ReturnType<typeof afternoon>): Promise<{ episodeId: string }> {
  k.set(at(15, 19));
  k.c.writeHandoff("The release is cut; the tarball is in the backups folder. Mike publishes.", { scope: HERE, session: C });
  // The bundle is composed BEFORE session A exists: everything A leaves has
  // to arrive by the delivery splice, as it did two minutes apart.
  k.set(at(15, 30));
  k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
  recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
  const s = k.server(A);
  // `at(16, 61)` is 17:01: minutes past the hour are counted from 16:00.
  for (let m = 1; m <= 101; m += 10) k.talk(A, at(16, m));
  k.set(at(17, 42));
  const noted = await s.call("note", { text: "Every text we read tonight ended grief at a table.", session: A });
  expect(noted.isError).not.toBe(true);
  k.talk(A, at(17, 44));
  k.set(at(17, 45));
  const ended = await s.call("session_end", {
    session: A,
    memories: [{ content: "Montaigne kept his memory on paper and his grief at three meals a day." }],
  });
  expect(ended.isError).not.toBe(true);
  k.talk(A, at(17, 48));
  k.set(at(17, 50));
  const ch = await s.call("chapter", { session: A, text: CHAPTER, title: TITLE });
  expect(ch.isError).not.toBe(true);
  const episodeId = (ch.structuredContent as Record<string, unknown>)["episodeId"] as string;
  expect(episodeId).toMatch(/^epi_/);
  // A keeps talking after the write-up.
  for (const m of [51, 52, 53]) k.talk(A, at(17, m));
  k.set(at(17, 55));
  return { episodeId };
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the next session here is told who was last here", () => {
  test("Mike's test, end to end: B's wake names A's chapter, and the pointer says how far it is written up", async () => {
    const k = afternoon();
    const { episodeId } = await mikesAfternoon(k);
    const text = wake(k.c, B);
    const lines = text.split("\n");
    const last = lines.find((l) => l.startsWith("Last here:"));
    expect(last).toBe(
      `Last here: session a1b2c3d4 on Opus 5.5, 09-30 16:01–17:53 — "${TITLE}" (${episodeId}). We read four texts in a row and every one of them ended grief at a table.`,
    );
    // The handoff C left stands, at the foot, and now says how much of A's
    // evening is written up instead of "not yet written up".
    const pointer = lines.find((l) => l.startsWith("Where I left off in this directory"));
    expect(pointer).toContain("by session c9cacbcc");
    // "Written up to" is a piece time, like the range: the last turn the
    // chapter covers (17:48), not the moment it was written.
    expect(pointer).toContain("work here 16:01–17:53 since, written up to 17:48 (chapter), 3 pieces after");
    // Order: Last here above the pointer, both above the sentinel.
    expect(lines.indexOf(last as string)).toBeLessThan(lines.indexOf(pointer as string));
    // The sentinel states the delivered total.
    expect(readSentinel(text).intact).toBe(true);
  });

  test("with no handoff at all, a finished session still leaves the line", async () => {
    const k = afternoon();
    recordSession(storeDir, { sessionId: A, scope: HERE, phase: "start", at: at(16, 0), model: "claude-opus-5-5" });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    const s = k.server(A);
    for (const m of [1, 20, 40]) k.talk(A, at(16, m));
    k.set(at(16, 45));
    await s.call("chapter", { session: A, text: CHAPTER, title: TITLE });
    k.set(at(16, 47));
    const text = wake(k.c, B);
    expect(text).toContain(`Last here: session a1b2c3d4 on Opus 5.5, 09-30 16:01–16:45 — "${TITLE}"`);
    expect(text).not.toContain("Where I left off");
  });

  test("the waking session's own chapter is not 'last here'; another directory is told nothing", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    expect(wake(k.c, A)).not.toContain("Last here:");
    expect(wake(k.c, B, THERE)).not.toContain("Last here:");
  });

  test("a chapter's directory is the one its row says, wherever its session's turn-ends are filed", async () => {
    const k = afternoon();
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    // A's turns are filed under THERE; its server, and so its chapter, is HERE's.
    for (const m of [1, 20, 40]) k.talk(A, at(16, m), THERE);
    k.set(at(16, 45));
    await k.server(A, HERE).call("chapter", { session: A, text: CHAPTER, title: TITLE });
    expect(wake(k.c, B, HERE)).toContain("Last here: session a1b2c3d4");
    expect(wake(k.c, B, THERE)).not.toContain("Last here:");
  });

  test("a session that said there was nothing new: 'nothing new to write up as of', not 'written up to'", async () => {
    const k = afternoon();
    k.set(at(15, 19));
    k.c.writeHandoff("The release is cut; the tarball is in the backups folder. Mike publishes.", { scope: HERE, session: C });
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    for (const m of [1, 10, 20]) k.talk(A, at(16, m));
    k.set(at(16, 25));
    const r = await k.server(A).call("session_end", { session: A, memories: [] });
    expect(r.isError).not.toBe(true);
    k.talk(A, at(16, 30));
    expect(wake(k.c, B)).toContain("work here 16:01–16:30 since, nothing new to write up as of 16:20, 1 piece after)");
  });

  test("a session that wrote no chapter here is not 'last here'", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    // B talks for a while in HERE and writes nothing; A is still the one named.
    for (const m of [56, 57, 58]) k.talk(B, at(17, m));
    expect(wake(k.c, "d0d0d0d0-0000-4000-8000-00000000000d")).toContain("Last here: session a1b2c3d4");
  });

  test("several sessions here that day: the newest two named, the rest by id", async () => {
    const k = afternoon();
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    const ids: string[] = [];
    const sessions = ["11111111", "22222222", "33333333", "44444444"].map((p) => `${p}-0000-4000-8000-000000000000`);
    for (const [i, sess] of sessions.entries()) {
      const s = k.server(sess);
      k.talk(sess, at(10 + i, 0));
      k.set(at(10 + i, 30));
      const ch = await s.call("chapter", { session: sess, text: `Session ${String(i)} did its part of the work and wrote it down here.`, title: `Part ${String(i)}` });
      ids.push((ch.structuredContent as Record<string, unknown>)["episodeId"] as string);
    }
    const text = wake(k.c, B);
    const lines = text.split("\n");
    expect(lines.find((l) => l.startsWith("Last here:"))).toContain(`"Part 3" (${ids[3] as string}). Session 3 did its part`);
    expect(lines.find((l) => l.startsWith("Before it:"))).toBe(`Before it: session 33333333, 09-30 12:00–12:30 — "Part 2" (${ids[2] as string}).`);
    expect(lines.find((l) => l.startsWith("+2 more here on 09-30:"))).toBe(`+2 more here on 09-30: ${ids[1] as string}, ${ids[0] as string}.`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("what were we about to do? a plan written after the handoff is named beside it (2026-10-09)", () => {
  const idOf = (r: { structuredContent?: unknown }): string => (r.structuredContent as Record<string, unknown>)["id"] as string;

  /** C leaves a handoff at its Stop ask with one planned entry in the same
   *  answer, works on, and later changes the plan in a note; A, in the same
   *  directory, leaves an open question, a done memory and a plain fact. */
  async function laterPlans(k: ReturnType<typeof afternoon>): Promise<{ changed: string; open: string; same: string; done: string }> {
    k.talk(C, at(15, 10));
    k.set(at(15, 19));
    const ended = await k.server(C).call("session_end", {
      session: C,
      handoff: "The release is cut; the tarball is in the backups folder. Mike publishes.",
      memories: [{ content: "Mike publishes 0.3.12 once he has looked at the tarball.", status: "planned" }],
    });
    expect(ended.isError).not.toBe(true);
    const same = (((ended.structuredContent as Record<string, unknown>)["outcomes"] as Record<string, unknown>[])[0]?.["id"]) as string;
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    k.talk(C, at(15, 40));
    k.set(at(15, 55));
    const changed = idOf(
      await k.server(C).call("note", {
        session: C,
        title: "Publishing waits until Monday",
        text: "Changed plan: Mike is ill, so publishing 0.3.12 waits until Monday; nothing else moves.",
        status: "planned",
      }),
    );
    k.talk(A, at(16, 5));
    k.set(at(16, 10));
    const open = idOf(
      await k.server(A).call("note", { session: A, text: "Is the tarball in the backups folder signed, or only checksummed?", unresolved: true }),
    );
    k.set(at(16, 12));
    const done = idOf(await k.server(A).call("note", { session: A, text: "The changelog for 0.3.12 is written and merged.", status: "done" }));
    k.set(at(16, 14));
    await k.server(A).call("note", { session: A, text: "The backups folder keeps one tarball per release, dated." });
    k.set(at(16, 16));
    await k.server(A, THERE).call("note", { session: A, text: "Elsewhere, the docs pass is planned for Tuesday.", status: "planned" });
    k.set(at(16, 30));
    return { changed, open, same, done };
  }

  test("the next session reads the changed plan and the open question under the handoff, newest first", async () => {
    const k = afternoon();
    const ids = await laterPlans(k);
    const text = wake(k.c, B);
    const lines = text.split("\n");
    const since = lines.find((l) => l.startsWith("Since this handoff:"));
    expect(since).toBe(
      `Since this handoff: Is the tarball in the backups folder signed, or only… (open, ${ids.open}); Publishing waits until Monday (planned, ${ids.changed}).`,
    );
    // Under the pointer's two lines, inside the bundle.
    const pointer = lines.findIndex((l) => l.startsWith("Where I left off in this directory"));
    expect(lines.indexOf(since as string)).toBe(pointer + 2);
    // What the same answer wrote, what is done, a plain fact and another
    // directory's plan are not named.
    expect(since).not.toContain(ids.same);
    expect(since).not.toContain(ids.done);
    expect(readSentinel(text).intact).toBe(true);
    // Not named twice: the work lines above the pointer leave out what it names.
    expect(lines.filter((l) => l.includes(ids.changed))).toHaveLength(1);
    // Another directory has no handoff, so no line.
    expect(wake(k.c, B, THERE)).not.toContain("Since this handoff");
    // The shown row counts what the line named.
    const shown = k.c.store.eventLog({ name: "handoff.shown", limit: 1, order: "desc" })[0];
    expect(JSON.parse(shown?.payload ?? "{}")["plans"]).toBe(2);
  });

  test("a handoff rewritten after the note covers it, and a plan settled over by a later one is not named", async () => {
    const k = afternoon();
    const ids = await laterPlans(k);
    // C revises its handoff after the note: the note is no longer since it.
    k.set(at(16, 20));
    k.c.writeHandoff("Publishing waits until Monday; the tarball is in the backups folder.", { scope: HERE, session: C });
    k.set(at(16, 40));
    const since = wake(k.c, B).split("\n").find((l) => l.startsWith("Since this handoff:"));
    expect(since).toBeUndefined();
    // A later question in the directory is, and so is a revision that holds.
    k.talk(A, at(16, 45));
    k.set(at(16, 50));
    const s = k.server(A);
    const first = idOf(await s.call("note", { session: A, text: "Ship the docs pass on Tuesday after the release.", status: "planned" }));
    k.set(at(16, 52));
    const second = idOf(
      await s.call("note", { session: A, text: "Ship the docs pass on Wednesday instead; Tuesday is the release.", status: "planned", updates: first, how: "changed" }),
    );
    const line = wake(k.c, B).split("\n").find((l) => l.startsWith("Since this handoff:")) ?? "";
    expect(line).toContain(second);
    expect(line).not.toContain(first);
    expect(line).not.toContain(ids.open);
  });

  test("an open question the wake already lists under 'Still open:' is not named again in the line (review of #332)", async () => {
    const k = afternoon();
    const ids = await laterPlans(k);
    // A boundary after the question: the bundle now lists it as still open.
    k.c.rebrief({ budgetBytes: 9_000, at: "2026-09-30" });
    const text = wake(k.c, B);
    const lines = text.split("\n");
    const open = lines.indexOf("Still open:");
    expect(open).toBeGreaterThan(-1);
    expect(lines.slice(open + 1).find((l) => l.includes("signed, or only checksummed"))).toBeDefined();
    // The line names the changed plan alone; the question is said once.
    const since = lines.find((l) => l.startsWith("Since this handoff:"));
    expect(since).toBe(`Since this handoff: Publishing waits until Monday (planned, ${ids.changed}).`);
    expect(lines.filter((l) => l.includes("signed, or only checksummed"))).toHaveLength(1);
    expect(readSentinel(text).intact).toBe(true);
  });

  test("at a ceiling with no room for the line, the handoff is carried as it was", async () => {
    const k = afternoon();
    await laterPlans(k);
    const full = k.c.wake(9_000, { date: "2026-09-30" }, { scope: HERE, session: B });
    const since = full.text.split("\n").find((l) => l.startsWith("Since this handoff:")) as string;
    expect(since).toBeDefined();
    // The work lines give way to the handoff block, so they are out of the
    // measure too: what is left is the bundle with the plain pointer alone.
    const without = full.text
      .split("\n")
      .filter((l) => l !== since && l !== WORK_HERE_HEADING && !/^- .*\(mem_[0-9a-f]+\)$/.test(l))
      .join("\n");
    const tight = new TextEncoder().encode(without).length + 8;
    const woke = k.c.wake(tight, { date: "2026-09-30" }, { scope: HERE, session: B });
    expect(woke.text).not.toContain("Since this handoff");
    expect(woke.text).toContain("Where I left off in this directory");
    expect(woke.bytes).toBeLessThanOrEqual(tight);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("its room in the wake", () => {
  function fill(c: Counterpart): void {
    for (let i = 0; i < 60; i++) {
      c.store.put({
        type: "memory",
        kind: "self",
        body: `Placeholder identity element ${i}, written long enough to compete for the budget.`,
        band: "identity",
        learnedOn: c.store.today(),
        salience: { relevance: 0.9, emotional: 0.6, predictive: 0.6 },
        physics: { promotedIdentity: true },
      });
    }
  }

  test("a chapter here takes room at the next boundary, and a full store still carries the line inside the ceiling", async () => {
    const k = afternoon();
    fill(k.c);
    const before = k.c.rebrief({ budgetBytes: 4_000, at: "2026-09-30" });
    expect(before.composeBudget).toBe(4_000 - PREFACE_RESERVE_BYTES);
    await mikesAfternoon(k);
    const after = k.c.rebrief({ budgetBytes: 4_000, at: "2026-09-30" });
    expect(after.composeBudget).toBeLessThan(4_000 - PREFACE_RESERVE_BYTES);
    const woke = k.c.wake(4_000, { date: "2026-09-30" }, { scope: HERE, session: B });
    expect(woke.text).toContain("Last here:");
    expect(woke.text).toContain("Where I left off");
    expect(woke.bytes).toBeLessThanOrEqual(4_000);
  });

  test("when there is not room for both, the line goes first and the handoff stays", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    const full = k.c.wake(9_000, { date: "2026-09-30" }, { scope: HERE, session: B });
    const pointerOnly = full.text
      .split("\n")
      .filter((l) => !l.startsWith("Last here:"))
      .join("\n");
    // A ceiling just under the bundle with both: the line is given up.
    const tight = new TextEncoder().encode(pointerOnly).length + 20;
    const woke = k.c.wake(tight, { date: "2026-09-30" }, { scope: HERE, session: B });
    expect(woke.text).not.toContain("Last here:");
    expect(woke.text).toContain("Where I left off");
    expect(woke.bytes).toBeLessThanOrEqual(tight);
  });

  test("the handoff first: the widest handoff rung that fits alone is carried, and the line only above it (review of #300 MAJOR-1)", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    // Three live handoffs here in all: C's and two more.
    k.c.writeHandoff("The parser rewrite is half done; the empty input still fails.", { scope: HERE, session: "e1e1e1e1-0000" });
    k.c.writeHandoff("The docs pass is waiting on the parser; nothing else is blocked.", { scope: HERE, session: "f2f2f2f2-0000" });
    // The same handoff ladder with no chapter line: A's own wake, since a
    // session's own chapter is not "last here" and A left no handoff. The
    // directory's work lines (lane 8) take what room the two leave, so they
    // are not part of the comparison either.
    const handoffPart = (t: string): string =>
      t
        .split("\n")
        .filter(
          (l) =>
            l.length > 0 &&
            !/^(Last here:|Before it:|\+\d+ more here on )/.test(l) &&
            !/^<!-- counterparts:wake/.test(l) &&
            l !== WORK_HERE_HEADING &&
            !/^- .*\(mem_[0-9a-f]+\)$/.test(l),
        )
        .join("\n");
    const base = k.c.wake(100_000, { date: "2026-09-30" }, { scope: THERE, session: B }).bytes;
    let lineGivenUpForWider = false;
    let lineWithHandoff = false;
    for (let ceiling = base; ceiling <= base + 2_400; ceiling += 8) {
      const b = k.c.wake(ceiling, { date: "2026-09-30" }, { scope: HERE, session: B });
      const a = k.c.wake(ceiling, { date: "2026-09-30" }, { scope: HERE, session: A });
      expect(handoffPart(b.text)).toBe(handoffPart(a.text));
      expect(b.bytes).toBeLessThanOrEqual(ceiling);
      const several = b.text.includes("handoffs, one per session");
      if (several && !b.text.includes("Last here:")) lineGivenUpForWider = true;
      if (b.text.includes("Last here:") && b.text.includes("Where ")) lineWithHandoff = true;
    }
    // Ceilings where the old order carried the newest handoff alone plus the
    // line now carry the wider handoff block and no line…
    expect(lineGivenUpForWider).toBe(true);
    // …and with room, both.
    expect(lineWithHandoff).toBe(true);
  });

  test("a FULL store: the chapter puts the wake behind, the turn-end refresh reserves its room, and the next wake has the line (review of #300 MAJOR-2)", async () => {
    const k = afternoon();
    fill(k.c);
    // The bundle composed before session A exists, at a tight ceiling, with
    // no chapter anywhere: nothing reserved, the lanes fill it. 2,650 rather
    // than 3,000: this fixture's identity lane caps at 24 elements, about
    // 2,800 bytes, so at 3,000 the cap binds before the ceiling does. (It was
    // 2,600 until the preface grew by the whole-wake sentence, 2026-10-10:
    // the composition fills in whole elements, and at 2,600 the slack it left
    // happened to hold the line.)
    k.c.rebrief({ budgetBytes: 2_650, at: "2026-09-30" });
    const s = k.server(A);
    for (const m of [1, 20, 40]) k.talk(A, at(16, m));
    k.set(at(16, 45));
    await s.call("chapter", { session: A, text: "Short and to the point: the loop test passed.", title: "Loop test" });
    // Before the worker runs, the line has no room.
    expect(k.c.wake(2_650, { date: "2026-09-30" }, { scope: HERE, session: B }).text).not.toContain("Last here:");
    // The turn-end worker's own call, as `runner.ts` makes it — no rebrief.
    const refreshed = k.c.refreshWake({ budgetBytes: 2_650, at: "2026-09-30" });
    expect(refreshed.reason).toBe("rendered");
    expect(refreshed.triggers).toContain("write-up");
    const woke = k.c.wake(2_650, { date: "2026-09-30" }, { scope: HERE, session: B });
    expect(woke.text).toContain("Last here: session a1b2c3d4");
    expect(woke.bytes).toBeLessThanOrEqual(2_650);
  });

  test("past the fortnight the line is gone, and so is its reserve", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    for (let i = 1; i <= LAST_HERE_LIFE_DAYS + 1; i++) k.c.store.advanceClock(`2026-10-${String(i).padStart(2, "0")}`);
    expect(wake(k.c, B)).not.toContain("Last here:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/** One result of a facts answer, read off its labeled lines (`mcp/facts.ts`). */
interface FactLine {
  readonly id: string;
  readonly title: string;
  readonly journal: boolean;
  readonly ways: string[];
  /** The `learned …` line (a journal's `my journal · written …` line), as printed. */
  readonly learned: string;
  readonly lines: string[];
}

/** A facts answer: the payload, the header lines, and each result. */
function factsOf(r: { structuredContent?: unknown }): { payload: Record<string, unknown>; header: string[]; items: FactLine[] } {
  const payload = (r.structuredContent ?? {}) as Record<string, unknown>;
  const text = typeof payload["answer"] === "string" ? payload["answer"] : "";
  const lines = text.split("\n");
  const blank = lines.indexOf("");
  const header = blank === -1 ? lines : lines.slice(0, blank);
  const items: FactLine[] = [];
  let cur: string[] | null = null;
  const flush = (): void => {
    if (cur === null) return;
    const m = /^\d+\. (\[journal\] )?(.*) · ((?:mem|epi)_[0-9a-f]+)(?: \(chapter \d+ of \d+\))? · (.*)$/.exec(cur[0] ?? "");
    if (m !== null) {
      items.push({
        id: m[3] as string,
        title: m[2] as string,
        journal: m[1] !== undefined,
        ways: (m[4] as string).split(", "),
        learned: cur.find((l) => /^ {3}(learned |my journal · )/.test(l)) ?? "",
        lines: cur,
      });
    }
    cur = null;
  };
  for (const l of lines) {
    if (/^\d+\. /.test(l)) {
      flush();
      cur = [l];
    } else if (l.startsWith("   ") && cur !== null) {
      cur.push(l);
    } else {
      flush();
    }
  }
  flush();
  return { payload, header, items };
}

describe("asked plainly, recall finds the last session here first (the recall half, facts mode)", () => {
  /** Another session, in another directory, busy with release work later the
   *  same day — the work that filled the candidate cap on the live store. */
  async function nextDoor(k: ReturnType<typeof afternoon>): Promise<void> {
    const s = k.server(C, THERE);
    for (let i = 0; i < 12; i++) {
      k.talk(C, at(18, i * 2), THERE);
      await s.call("note", {
        session: C,
        text: `Release session note ${String(i)}: the most recent session of the build cut the tarball and checked the doctor again, 2026-09-30.`,
      });
    }
  }

  /** By id, the address path still answers with `memories`. */
  type Row = { id: string; from?: string; journal: boolean };
  function rows(r: { structuredContent?: unknown }): Row[] {
    return ((r.structuredContent as Record<string, unknown>)["memories"] as Row[]) ?? [];
  }

  test("Mike's question: A's chapter first, then what A wrote, each saying where it came from", async () => {
    const k = afternoon();
    const { episodeId } = await mikesAfternoon(k);
    await nextDoor(k);
    k.set(at(18, 30));
    const b = k.server(B);
    const got = factsOf(await b.call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    expect(got.payload["mode"]).toBe("facts");
    // The header names the session it resolved to, so a wrong anchor is visible.
    expect(got.header.some((l) => /^time: our most recent session → 09-30 \(session a1b2c3d4, its rows first\)/.test(l))).toBe(true);
    expect(got.items[0]?.id).toBe(episodeId);
    expect(got.items[0]?.journal).toBe(true);
    expect(got.items[0]?.ways).toContain("session");
    expect(got.items[0]?.learned).toBe(`   my journal · written 09-30 in ${HERE} · session a1b2c3d4`);
    // Then the memories A wrote: its rows first, each saying whose they are.
    const lead = got.items.filter((m) => m.ways.includes("session"));
    expect(lead.length).toBeGreaterThanOrEqual(3);
    for (const m of lead.slice(1)) expect(m.learned).toMatch(/· session a1b2c3d4 · CURRENT$/);
    // Nothing from next door leads, and what of it came back says where it is from.
    const firstOther = got.items.findIndex((m) => !m.ways.includes("session"));
    expect(firstOther === -1 || firstOther >= lead.length).toBe(true);
    for (const m of got.items.filter((x) => !x.ways.includes("session"))) expect(m.learned).toContain("session ");
  });

  test("a question that is not about time is answered with provenance, and filters nothing by time", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    const b = k.server(B);
    const got = factsOf(await b.call("recall", { question: "Montaigne and his three meals", mode: "facts" }));
    expect(got.items.length).toBeGreaterThan(0);
    expect(got.header.some((l) => l.startsWith("time:"))).toBe(false);
    expect(got.items.some((m) => m.ways.includes("session"))).toBe(false);
    expect(got.items[0]?.learned).toContain("session a1b2c3d4");
  });

  test("the asker's own session is not 'the last session'; its own rows say 'this session'", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    const a = k.server(A);
    const r = factsOf(await a.call("recall", { question: "what did we do in the last session?", mode: "facts" }));
    expect(r.items.some((m) => m.ways.includes("session"))).toBe(false);
    expect(r.header.some((l) => l.includes("no earlier session found"))).toBe(true);
    const own = factsOf(await a.call("recall", { question: "Montaigne and his three meals", mode: "facts" }));
    expect(own.items[0]?.learned).toContain("this session");
  });

  test("'our most recent session' is the one Last here names, not a live sibling still at work (review of #302 MAJOR-2)", async () => {
    const k = afternoon();
    const { episodeId } = await mikesAfternoon(k);
    // D is still working here, later than A, and has written a note.
    const D = "d0d0d0d0-0000-4000-8000-00000000000d";
    for (const m of [56, 58]) k.talk(D, at(17, m));
    k.set(at(17, 59));
    await k.server(D).call("note", { session: D, text: "Halfway through the parser rewrite; the empty input still fails." });
    const got = factsOf(await k.server(B).call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    expect(got.header.some((l) => l.includes("(session a1b2c3d4, its rows first)"))).toBe(true);
    expect(got.items[0]?.id).toBe(episodeId);
    for (const m of got.items.filter((x) => x.ways.includes("session"))) expect(m.learned).toContain("session a1b2c3d4");
  });

  test("a named window filters: this evening's work comes back, this morning holds nothing", async () => {
    const k = afternoon();
    const { episodeId } = await mikesAfternoon(k);
    const b = k.server(B);
    const evening = factsOf(await b.call("recall", { question: "what did we do this evening?", mode: "facts" }));
    expect(evening.header.some((l) => l.startsWith("time: this evening → 09-30"))).toBe(true);
    expect(evening.items[0]?.id).toBe(episodeId);
    for (const m of evening.items) expect(m.ways).toContain("time");
    const morning = factsOf(await b.call("recall", { question: "what did we do this morning?", mode: "facts" }));
    expect(morning.payload["matched"]).toBe(0);
    expect(morning.items.length).toBe(0);
  });

  test("a question about something else, with a day in it, is filtered to that day", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    const got = factsOf(await k.server(B).call("recall", { question: "Montaigne at the table today", mode: "facts" }));
    expect(got.header.some((l) => l.startsWith("time: today → 09-30"))).toBe(true);
    expect(got.items.length).toBeGreaterThan(0);
    for (const m of got.items) expect(m.ways).toContain("time");
  });

  test("a dream's row is not the session's own words, and says what made it (review of #302 MAJOR-1)", async () => {
    const k = afternoon();
    const { episodeId } = await mikesAfternoon(k);
    k.set(at(17, 54));
    const dreamt = k.c.store.put({
      type: "memory",
      kind: "self",
      body: "Dreamed: four tables, one grief, set for Montaigne's three meals.",
      learnedOn: "2026-09-30",
      source: "dreamed",
      // A dream's claim, at its ceiling (2026-10-10: a row that claims nothing
      // stands at 0, below reach).
      salience: { claimed: 0.3 },
      origin: { session: A, scope: HERE, ref: "dream:drm_000000000001" },
    });
    const got = factsOf(await k.server(B).call("recall", { question: "what do you remember from our most recent session?", mode: "facts" }));
    expect(got.items[0]?.id).toBe(episodeId);
    // In the window, it comes back — but not as the session's own row, and
    // its line says a dream made it.
    const dream = got.items.find((m) => m.id === dreamt);
    expect(dream).toBeDefined();
    expect(dream?.ways).not.toContain("session");
    expect(dream?.learned).toContain("a dream launched from session a1b2c3d4");
    const firstOther = got.items.findIndex((m) => !m.ways.includes("session"));
    expect(got.items.findIndex((m) => m.id === dreamt)).toBeGreaterThanOrEqual(firstOther);
    const named = rows(await k.server(B).call("recall", { ids: [dreamt] }));
    expect(named[0]?.from).toMatch(/^a dream launched from session a1b2c3d4, /);
  });

  test("'where did we leave off?' names the newest session here and puts its episode first", async () => {
    const k = afternoon();
    await mikesAfternoon(k);
    const E = "e5e5e5e5-0000-4000-8000-00000000000e";
    k.talk(E, at(18, 0));
    k.set(at(18, 5));
    const epi = k.c.store.put({
      type: "episode",
      kind: "self",
      title: "Two chapters",
      body: "## chapter 1 — Wed 30 Sep 2026 · lived day 0\n\nThe first chapter, long done.\n\n## chapter 2 — Wed 30 Sep 2026 · lived day 0\n\nThe second chapter, which is where we are now.\n",
      meta: { sessionId: E, chapters: 2 },
      source: "episode",
      origin: { session: E, scope: HERE },
    });
    const got = factsOf(await k.server(B).call("recall", { question: "where did we leave off?", mode: "facts" }));
    expect(got.header.some((l) => l.includes("(session e5e5e5e5, its rows first)"))).toBe(true);
    expect(got.items[0]?.id).toBe(epi);
    expect(got.items[0]?.journal).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the pieces", () => {
  test("a question about time: the cue, the window it names, and whether it asks anything else", () => {
    const clock = { now: at(18, 30), zone: ZONE };
    const ask = (q: string) => readRecencyAsk(q, clock);
    expect(ask("what do you remember from our most recent session?")).toEqual({ cue: "most recent", window: null, thin: true });
    expect(ask("where did we leave off?")).toEqual({ cue: "where did we leave off", window: null, thin: true });
    expect(ask("where were we")?.thin).toBe(true);
    expect(ask("where we left off")?.cue).toBe("left off");
    expect(ask("What did we do this evening, 16:01–17:48")).toEqual({
      cue: "this evening",
      window: { from: "2026-09-30 16:01", to: "2026-09-30 17:48" },
      thin: true,
    });
    expect(ask("what did we talk about this morning")?.window).toEqual({ from: "2026-09-30 05:00", to: "2026-09-30 11:59" });
    expect(ask("what happened yesterday")?.window).toEqual({ from: "2026-09-29 00:00", to: "2026-09-29 23:59" });
    expect(ask("what happened between 4pm and 6pm")).toEqual({
      cue: "a clock time",
      window: { from: "2026-09-30 16:00", to: "2026-09-30 18:00" },
      thin: true,
    });
    // Not a time: a verse, a date, a word that only looks like the cue.
    expect(ask("what does John 3:16 say")).toBeNull();
    expect(ask("what happened on 2026-09-30")).toBeNull();
    expect(ask("the recent-ish parser rewrite")).toBeNull();
    expect(ask("Montaigne and his three meals")).toBeNull();
    // Time words narrowing a question about something else: not thin.
    for (const q of [
      "the last session of the conference",
      "the last time we used Postgres",
      "what did we decide about the deploy today?",
      "what have I recently learned about Montaigne",
    ]) {
      expect(ask(q)?.thin).toBe(false);
    }
  });

  test("the sessions that ran here come from the turn-ends, newest first", () => {
    const k = afternoon();
    k.talk(A, at(16, 1));
    k.talk(B, at(16, 30));
    k.talk(A, at(17, 0));
    k.talk(C, at(16, 5), THERE);
    // A's close, hours later, is when the host closed it — not work here.
    k.set(at(20, 0));
    k.c.boundary({ session: A, scope: HERE, kind: "session-end" });
    expect(sessionsHere(k.c.spans, HERE)).toEqual([
      { session: A, firstAt: at(16, 1), lastAt: at(17, 0), ended: true },
      { session: B, firstAt: at(16, 30), lastAt: at(16, 30), ended: false },
    ]);
    expect(sessionsHere(k.c.spans, `${HERE}/`).map((s) => s.session)).toEqual([A, B]);
    expect(sessionsHere(k.c.spans, HERE, { only: new Set([B]) }).map((s) => s.session)).toEqual([B]);
  });

  test("an episode's latest chapter and its lived day are read off its last heading — the engine's own, only", () => {
    const body =
      "## chapter 1 — Tue 29 Sep 2026 · claude-opus-5-5 · lived day 8\n\nThe first one.\n\n## chapter 2 — Wed 30 Sep 2026 · lived day 9\n\nThe second one, which is the one shown.\n\n## Chapter two of the book\n\nStill the second.\n";
    expect(latestChapter(body)).toEqual({
      text: "\n\nThe second one, which is the one shown.\n\n## Chapter two of the book\n\nStill the second.\n",
      day: 9,
    });
    expect(latestChapter("No heading at all.")).toEqual({ text: "No heading at all.", day: null });
  });

  test("an untitled chapter is named by its id; the narrowest rung drops the count", () => {
    const e = (n: number, title: string | null): LastHere => ({
      chapter: {
        id: `epi_00000000000${String(n)}`,
        session: `${String(n).repeat(8)}-0000`,
        model: null,
        title,
        excerpt: "It said something worth reading first.",
        writtenAt: n,
        createdAt: n,
        writtenDay: 1,
        scope: null,
        chapters: 1,
      },
      when: "09-30 10:00–11:00",
      date: "09-30",
    });
    expect(lastHereBlock([e(3, null)])).toBe(
      "Last here: session 33333333, 09-30 10:00–11:00 — epi_000000000003. It said something worth reading first.",
    );
    const ladder = lastHereLadder([e(3, "Three"), e(2, "Two"), e(1, "One")]);
    expect(ladder).toHaveLength(3);
    expect(ladder[2]).not.toContain("\n");
    expect(ladder[1]).toContain("+2 more here on 09-30");
  });

  test("a store with no chapters names none", () => {
    const k = afternoon();
    expect(chaptersBySession(k.c.store).size).toBe(0);
  });
});
