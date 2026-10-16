/**
 * RAW TRANSCRIPT RETENTION — owner's ruling 2026-09-23 (roadmap B3).
 *
 * A session's captured text is deleted 3 days after it ended (7 until
 * 2026-10-13), when nothing is owed; a session that owes a write-up waits
 * until it is written up — never past 14 days after its last activity. Since
 * 2026-09-30 "owes" is `core/coverage/`'s rule — an unwritten stretch of three
 * pieces over fifteen minutes, not at work, not lapsed — read by
 * `remember/owes.ts#planRetention`; these tests hold retention to three
 * promises:
 *
 *   1. the acceptance scenario — three sessions (written up 10 days ago,
 *      written up 2 days ago, owing a write-up 10 days ago): exactly the first
 *      is deleted, and the `remember.prune` row says 1 / 1 / 1 — proved at the
 *      job AND through the whole worker (`runOnce`);
 *   2. NOTHING DELETES WHILE THE RULE SAYS A SESSION OWES — every shape of
 *      answer on disk, at an age well past the week;
 *   3. the delete goes through the owner's strike and keeps its properties:
 *      whole sessions and nothing else, every text file, recorded as
 *      `retention` with counts only, refused under observer, a bounded ledger.
 *
 * Hermetic: a fresh temp data dir per test, removed after. Nothing here holds
 * a credential, and the one worker run is handed an EMPTY environment so a
 * developer's own key can never reach it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import { CLAIM_NOTHING_NEW, claimUnwritten } from "../src/core/coverage/index.js";
import * as rememberIndex from "../src/core/remember/index.js";
import {
  NO_HOST_EVIDENCE,
  RETENTION_EVENT,
  SpanBuffer,
  TUNABLES as REMEMBER_TUNABLES,
  keyFor,
  lastRetentionRun,
  planRetention,
  retentionRuns,
  retentionSources,
} from "../src/core/remember/index.js";
import type { HostSessionEvidence, RetentionSources } from "../src/core/remember/index.js";
import { SCALAR_REF } from "../src/core/recall/index.js";
// The deleting half, by path — the way only the worker may import it in `src/`.
import { pruneRetention } from "../src/core/remember/retention.js";
import { WRITE_UP_BY, recordWriteUp } from "../src/core/remember/write-up-seam.js";
import { markNothingNew, pruneSessions, recordSession, sessionPath } from "../src/adapters/sessions.js";
import { retentionHost, retentionJob, runOnce } from "../src/adapters/claude-code/bin/runner.js";

const DAY = 86_400_000;
const MIN = 60_000;
const SCOPE = "/scope/retention";
const NOW = Date.parse("2026-09-23T15:00:00Z");

let dir: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "counterparts-retention-"));
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/** A counterpart on a clock the test turns by hand. */
function brain(start = NOW): { c: Counterpart; set(at: number): void } {
  let at = start;
  const c = Counterpart.open({ dir, owner: true, now: () => at });
  open.push(c);
  return {
    c,
    set(next: number): void {
      at = next;
    },
  };
}

const TALK = [
  "We spent the morning on the migration plan and what to cut from it.",
  "Good, and the rollback is the snapshot from the night before.",
  "Then the second index goes, and the store format stays as it is.",
];

/** The transcript `live` captures for one session, turn by turn. */
function turnsOf(session: string): { role: "user" | "assistant"; text: string }[] {
  return TALK.flatMap((text, i) => [
    { role: "user" as const, text: `${text} (${session})` },
    { role: "assistant" as const, text: `Noted, step ${String(i)} (${session}).` },
  ]);
}

/** A session that talked — three pieces, ten minutes apart, so what it left
 *  unwritten is past the floor — and then did or did not answer, and did or
 *  did not end normally. */
async function live(
  b: { c: Counterpart; set(at: number): void },
  session: string,
  at: number,
  opts: { answer?: "chapter" | "session-end" | "handoff" | null; endNormally?: boolean } = {},
): Promise<void> {
  const turns = turnsOf(session);
  for (let i = 0; i < TALK.length; i++) {
    b.set(at + i * 10 * MIN);
    b.c.captureSpans({ session, scope: SCOPE, turns: turns.slice(0, 2 * (i + 1)) });
    b.c.boundary({ session, scope: SCOPE, kind: "stop" });
  }
  if (opts.answer === "chapter") {
    expect(b.c.appendEpisode(session, `The migration plan came together today (${session}).`, { scope: SCOPE }).appended).toBe(true);
  } else if (opts.answer === "session-end") {
    const landed = await b.c.submitSessionEnd(
      { content: `The migration keeps the store format and drops the second index (${session}).`, kind: "fact" },
      { session, scope: SCOPE },
    );
    expect(landed.deposited).toBe(true);
  } else if (opts.answer === "handoff") {
    expect(b.c.writeHandoff(`Where it stands: migration half done (${session}).`, { scope: SCOPE, session }).written).toBe(true);
  }
  if (opts.endNormally !== false) b.c.boundary({ session, scope: SCOPE, kind: "session-end" });
}

/** The sources the worker builds: this host's registry, the store's zone, and
 *  the default clocks unless a test names its own. */
function sources(c: Counterpart, clocks: { retentionMs?: number; maxMs?: number } = {}): RetentionSources {
  return retentionSources(c.store, { host: retentionHost(c.store), ...clocks });
}

/** Hand-made sources, for a test about ONE fact. */
function fake(host: Partial<HostSessionEvidence> = {}, clocks: { retentionMs?: number; maxMs?: number } = {}): RetentionSources {
  return { host: () => ({ ...NO_HOST_EVIDENCE, ...host }), zone: "UTC", ...clocks };
}

/** A ceiling far off, for the tests about what is OWED at ages past the
 *  default 14 days — the ceiling has its own tests below. */
const NO_CEILING = { maxMs: 100_000 * DAY };

let dates = 0;
/** A fresh date per call, so the O_EXCL latch never stands in a test's way
 *  unless the test is about the latch. */
function nextDate(): string {
  dates += 1;
  return `2030-01-${String(dates % 28 + 1).padStart(2, "0")}`;
}

function prune(buffer: SpanBuffer, src: RetentionSources, date = nextDate()) {
  return pruneRetention(buffer, src, { date });
}

/** Every session id that still has a line in any text-bearing file of the scope. */
function heldSessions(root: string): string[] {
  const scopeDir = join(root, "spans", keyFor(SCOPE));
  const out = new Set<string>();
  for (const name of ["buffer.jsonl", "jots.jsonl", "assistant.jsonl", "quarantine.jsonl"]) {
    const file = join(scopeDir, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      out.add((JSON.parse(line) as { session: string }).session);
    }
  }
  const claims = join(scopeDir, "claims");
  if (existsSync(claims)) {
    for (const f of readdirSync(claims)) {
      for (const line of readFileSync(join(claims, f), "utf8").split("\n")) {
        if (line.trim().length > 0) out.add((JSON.parse(line) as { session: string }).session);
      }
    }
  }
  return [...out].sort();
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the acceptance scenario: three sessions, exactly one deleted", () => {
  test("written up 10 days ago GOES; written up 2 days ago and owing 10 days ago STAY — and the row says so", async () => {
    const b = brain();
    await live(b, "written-old", NOW - 10 * DAY, { answer: "chapter" });
    await live(b, "written-recent", NOW - 2 * DAY, { answer: "session-end" });
    await live(b, "owes-old", NOW - 10 * DAY, { answer: null });
    b.set(NOW);
    expect(heldSessions(dir)).toEqual(["owes-old", "written-old", "written-recent"]);

    const plan = planRetention(b.c.spans, sources(b.c));
    expect(plan.map((h) => [h.session, h.verdict])).toEqual([
      ["owes-old", "kept-owed"],
      ["written-old", "deleted"],
      ["written-recent", "kept-young"],
    ]);

    const job = retentionJob({ counterpart: b.c, date: "2026-09-23" });
    expect(job.reason).toBe("ran");
    expect(job.recorded).toBe(true);
    expect({
      deleted: job.report?.deleted,
      keptOwed: job.report?.keptOwed,
      keptYoung: job.report?.keptYoung,
      failed: job.report?.failed,
    }).toEqual({ deleted: 1, keptOwed: 1, keptYoung: 1, failed: 0 });
    // Every text line of the one session — its turns AND the assistant's.
    expect(job.report?.lines).toBe(2 * TALK.length);
    expect(heldSessions(dir)).toEqual(["owes-old", "written-recent"]);

    // THE ROWS: `STARTED` the moment the latch was held (re-review R7), then
    // the result, with the counts — and no session id or word in either.
    const rows = b.c.store.eventLog({ name: RETENTION_EVENT });
    expect(rows.map((r) => (JSON.parse(r.payload ?? "{}") as { reason: string }).reason)).toEqual(["STARTED", "PRUNED"]);
    const payload = JSON.parse(rows[1]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ date: "2026-09-23", reason: "PRUNED", deleted: 1, keptOwed: 1, keptYoung: 1, failed: 0, retentionDays: 3, maxDays: 14 });
    for (const row of rows) {
      expect(row.payload).not.toContain("written-old");
      expect(row.payload).not.toContain("migration");
    }
    expect(lastRetentionRun(b.c.store)).toMatchObject({ date: "2026-09-23", deleted: 1, keptOwed: 1, keptYoung: 1 });
  });

  test("the same store through the WHOLE worker: `runOnce` deletes exactly the first, keylessly — and the day's snapshot holds no text at all", async () => {
    // Seeded on a clock set back from the real one, because the worker opens
    // its own counterpart on the wall clock.
    const real = Date.now();
    const b = brain(real);
    await live(b, "written-old", real - 10 * DAY, { answer: "chapter" });
    await live(b, "written-recent", real - 2 * DAY, { answer: "session-end" });
    await live(b, "owes-old", real - 10 * DAY, { answer: null });
    // A session that ended (or was killed) long ago, still holding its last
    // turn's typed cue tokens in recall's gate row, from before rows had a time.
    b.c.store.setGateRecords([
      {
        sessionId: "ended-long-ago",
        kind: "scalar",
        ref: SCALAR_REF,
        turn: 7,
        lastDay: 0,
        value: JSON.stringify({ v: 1, affectFiredTurn: null, carriedCues: ["zanzibarquokka"], carriedFromTurn: 7 }),
      },
    ]);
    b.c.close();
    open.length = 0;

    // Snapshots go where the configuration says — a sibling temp dir, removed
    // below — because a test store is not named like the default layout.
    const snaps = mkdtempSync(join(tmpdir(), "counterparts-retention-snaps-"));
    try {
      const config = { dataDir: dir, owner: true, snapshots: { dir: snaps } };
      const report = await runOnce({ config, date: "2026-09-23" });
      expect(report.ran).toBe(true);
      expect(report.retention?.reason).toBe("ran");
      expect(report.retention?.report).toMatchObject({ deleted: 1, keptOwed: 1, keptYoung: 1, failed: 0 });
      expect(heldSessions(dir)).toEqual(["owes-old", "written-recent"]);

      // The day's snapshot copies no conversation text (2026-10-13): not the
      // deleted session's, and not the kept ones' either. The database is there.
      expect(report.snapshot?.reason).toBe("taken");
      const copies = readdirSync(snaps).filter((n) => !n.startsWith("."));
      expect(copies.length).toBe(1);
      expect(readdirSync(join(snaps, copies[0] as string))).not.toContain("spans");
      expect(readdirSync(join(snaps, copies[0] as string))).toContain("counterparts.sqlite");
      // ...and no typed cue tokens: the worker emptied the ended session's
      // carry before the copy was taken.
      expect(readFileSync(join(snaps, copies[0] as string, "counterparts.sqlite")).includes("zanzibarquokka")).toBe(false);

      // Once per date: a second worker the same day does nothing and adds no
      // row — the date holds its STARTED row and its result, and that is all.
      const again = await runOnce({ config, date: "2026-09-23" });
      expect(again.retention?.reason).toBe("already-ran");
      const check = Counterpart.open({ dir });
      open.push(check);
      expect(check.store.eventLog({ name: RETENTION_EVENT })).toHaveLength(2);
    } finally {
      rmSync(snaps, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("THE RULE — nothing deletes while coverage says a session owes", () => {
  test("every shape of answer on disk, 30 days old: DELETED if and only if the plan says nothing is owed", async () => {
    const b = brain();
    const shapes: { session: string; answer: "chapter" | "session-end" | "handoff" | null; endNormally: boolean }[] = [];
    for (const answer of ["chapter", "session-end", "handoff", null] as const)
      for (const endNormally of [false, true]) shapes.push({ session: `s-${String(answer)}-${String(endNormally)}`, answer, endNormally });
    for (const s of shapes) await live(b, s.session, NOW - 30 * DAY, { answer: s.answer, endNormally: s.endNormally });
    b.set(NOW);
    const plan = planRetention(b.c.spans, sources(b.c, NO_CEILING));
    expect(plan).toHaveLength(shapes.length);
    // A chapter and a memory write the stretch up; a handoff and silence do
    // not — ended or not (a session quiet since the date changed is not at work).
    const owing = plan.filter((h) => h.owes).map((h) => h.session).sort();
    expect(owing).toEqual(["s-handoff-false", "s-handoff-true", "s-null-false", "s-null-true"]);
    for (const h of plan) expect(h.verdict).toBe(h.owes ? "kept-owed" : "deleted");
    const report = prune(b.c.spans, sources(b.c, NO_CEILING));
    expect(heldSessions(dir)).toEqual(owing);
    expect(report.keptOwed).toBe(owing.length);
    expect(report.deleted).toBe(shapes.length - owing.length);
  });

  test("a CLOSING-TURN TAIL — one piece — owes nothing: it goes after its week, crashed or not", () => {
    const buf = new SpanBuffer({ dir, now: () => NOW - 8 * DAY });
    buf.capture({ session: "tail", scope: SCOPE, turns: [{ role: "user", text: "One last thing before I go." }] });
    buf.boundary({ session: "tail", scope: SCOPE, kind: "stop" });
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), fake());
    expect(h?.facts).toMatchObject({ capturedText: true, unwritten: 1, state: "quiet" });
    expect(h?.owes).toBe(false);
    expect(h?.verdict).toBe("deleted");
  });

  test("written up, then more work, lost without a normal end — the stretch AFTER the write-up is owed", async () => {
    const b = brain();
    await live(b, "then-more", NOW - 20 * DAY, { answer: "chapter", endNormally: false });
    const more = [...turnsOf("then-more"), ...turnsOf("then-more-2")];
    for (let i = 0; i < 3; i++) {
      b.set(NOW - 20 * DAY + HOUR_AND(i));
      b.c.captureSpans({ session: "then-more", scope: SCOPE, turns: more.slice(0, 6 + 2 * (i + 1)) });
    }
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c, NO_CEILING));
    expect(h?.facts).toMatchObject({ unwritten: 3, state: "quiet" });
    expect(h?.verdict).toBe("kept-owed");
  });

  test("a HANDOFF ALONE is not a write-up: the stretch is still owed", async () => {
    const b = brain();
    await live(b, "handoff-only", NOW - 9 * DAY, { answer: "handoff" });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.unwritten).toBe(TALK.length);
    expect(h?.verdict).toBe("kept-owed");
  });

  test("resumed after a normal end and then lost: judged by the stretch AFTER its last write-up", async () => {
    const b = brain();
    await live(b, "resumed", NOW - 12 * DAY, { answer: "chapter" });
    // The same session id comes back two days later, talks, and is lost.
    const back = [...turnsOf("resumed"), ...turnsOf("resumed-again")];
    for (let i = 0; i < 3; i++) {
      b.set(NOW - 10 * DAY + i * 10 * MIN);
      b.c.captureSpans({ session: "resumed", scope: SCOPE, turns: back.slice(0, 6 + 2 * (i + 1)) });
      b.c.boundary({ session: "resumed", scope: SCOPE, kind: "stop" });
    }
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.state).toBe("quiet");
    expect(h?.verdict).toBe("kept-owed");
  });

  test("a session written up AFTER it ended stops owing, and its clock starts at the write-up", async () => {
    const b = brain();
    await live(b, "late", NOW - 10 * DAY, { answer: null });
    b.set(NOW - 1 * DAY);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "late", by: "next-session" })).toBe("RECORDED");
    b.set(NOW);
    let [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.writtenUp).toBe(true);
    expect(h?.owes).toBe(false);
    expect(h?.verdict).toBe("kept-young");
    // Three days after the write-up, and still inside the 14-day ceiling: it is
    // the 3-day clock, from the write-up, that deletes it.
    b.set(NOW + 3 * DAY);
    [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.verdict).toBe("deleted");
  });

  test("the assistant's own turns are not a debt: a session whose conversation the sweep consumed owes nothing", () => {
    // What the key-based fallback leaves behind: `assistant.jsonl` is never
    // claimed or swept, so a session it wrote up still holds its replies.
    const buf = new SpanBuffer({ dir, now: () => NOW - 10 * DAY });
    buf.capture({ session: "swept", scope: SCOPE, turns: [{ role: "assistant", text: "Only the reply is left." }] });
    const later = new SpanBuffer({ dir, now: () => NOW });
    const [h] = planRetention(later, fake());
    expect(h?.facts.capturedText).toBe(false);
    expect(h?.verdict).toBe("deleted");
  });

  test("text held only in a CLAIM file still counts — nothing in flight can make a session look written up", () => {
    const writer = (at: number): SpanBuffer => new SpanBuffer({ dir, now: () => at, minClaimBytes: 0 });
    const turns: { role: "user"; text: string }[] = [];
    for (let i = 0; i < 3; i++) {
      turns.push({ role: "user", text: `A turn a crashed sweep is holding, number ${String(i)}.` });
      writer(NOW - 10 * DAY + i * 10 * MIN).capture({ session: "mid-sweep", scope: SCOPE, turns: [...turns] });
    }
    const claim = writer(NOW - 10 * DAY + HOUR_AND(0)).claim(SCOPE);
    expect(claim.claimed).toBe(true);
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), fake());
    expect(h?.facts.capturedText).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
  });
});

/** An hour into a session, and ten minutes more per step after it. */
function HOUR_AND(step: number): number {
  return 60 * MIN + step * 10 * MIN;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("the PR #189 review's findings, each held by a test", () => {
  test("B1: the deleting half is not reachable through remember's index — a plan is all it can give", async () => {
    expect(Object.keys(rememberIndex)).not.toContain("pruneRetention");
    expect(Object.keys(rememberIndex)).not.toContain("strikeSpans");
    // The review's repro, through everything the index DOES export: one session
    // that owes. The plan says so, and a plan deletes nothing.
    const b = brain();
    await live(b, "A", NOW - 1 * DAY, { answer: null, endNormally: false });
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c)).map((h) => h.verdict)).toEqual(["kept-owed"]);
    const future = new SpanBuffer({ dir, now: () => NOW + 30 * DAY });
    expect(planRetention(future, fake({}, NO_CEILING)).map((h) => h.verdict)).toEqual(["kept-owed"]);
    expect(heldSessions(dir)).toEqual(["A"]);
    expect(b.c.spans.spans(SCOPE).length).toBeGreaterThan(0);
    expect(b.c.spans.assistantSpans(SCOPE).length).toBeGreaterThan(0);
  });

  test("m10: a session the registry holds OPEN is kept past its clock — up to the ceiling, not past it", async () => {
    const b = brain();
    await live(b, "idle-open", NOW - 10 * DAY, { answer: "chapter", endNormally: false });
    recordSession(dir, { sessionId: "idle-open", scope: SCOPE, phase: "start", at: NOW - 10 * DAY });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.open).toBe(true);
    expect(h?.verdict).toBe("kept-live");
    const report = prune(b.c.spans, sources(b.c));
    expect(report.keptLive).toBe(1);
    expect(heldSessions(dir)).toEqual(["idle-open"]);
    // Fourteen days after its last activity the ceiling wins, open or not
    // (Mike, 2026-10-13: never kept more than 14 days).
    b.set(NOW + 5 * DAY);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("deleted");
    b.set(NOW);
    // Once the registry records its end, the ordinary rule applies.
    recordSession(dir, { sessionId: "idle-open", scope: SCOPE, phase: "end", at: NOW - 9 * DAY });
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("deleted");
  });

  test("m10: a registry record that will not read is treated as open — cannot tell means keep", async () => {
    const b = brain();
    await live(b, "garbled", NOW - 10 * DAY, { answer: "chapter", endNormally: false });
    recordSession(dir, { sessionId: "garbled", scope: SCOPE, phase: "start", at: NOW - 10 * DAY });
    writeFileSync(sessionPath(dir, "garbled") as string, "{half a rec", "utf8");
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("kept-live");
  });

  test("m2: an end recorded in one directory settles the text the session left in another — and a word under the floor there owes nothing", async () => {
    const b = brain();
    const OTHER = "/scope/retention-worktree";
    b.set(NOW - 10 * DAY);
    b.c.captureSpans({ session: "two-dirs", scope: OTHER, turns: [{ role: "user", text: "A word in the worktree (other dir)." }] });
    b.c.boundary({ session: "two-dirs", scope: OTHER, kind: "stop" });
    await live(b, "two-dirs", NOW - 10 * DAY, { answer: "chapter" }); // the end lands under SCOPE only
    b.set(NOW);
    const plan = planRetention(b.c.spans, sources(b.c));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.scopes).toEqual([OTHER, SCOPE].sort());
    // The chapter wrote up SCOPE only (2026-09-30, review of #289); the one word
    // in the worktree is under the floor, so nothing is owed.
    expect(plan[0]?.facts).toMatchObject({ state: "ended", unwritten: 1 });
    expect(plan[0]?.owes).toBe(false);
    expect(plan[0]?.verdict).toBe("deleted");
    const report = prune(b.c.spans, sources(b.c));
    expect(report.deleted).toBe(1);
    expect(b.c.spans.spans(OTHER)).toEqual([]);
    expect(b.c.spans.spans(SCOPE)).toEqual([]);
  });

  test("m3, since 2026-09-30: #186's registry mark alone writes nothing up; the claim a \"nothing new\" now makes does", async () => {
    const withAnswer = async (claim: boolean): Promise<string | undefined> => {
      const b = brain();
      await live(b, "nothing-new", NOW - 10 * DAY, { answer: null });
      recordSession(dir, { sessionId: "nothing-new", scope: SCOPE, phase: "end", at: NOW - 10 * DAY });
      expect(markNothingNew(dir, "nothing-new", NOW - 10 * DAY + 60_000)).not.toBeNull();
      if (claim) expect(claimUnwritten(b.c.spans, { session: "nothing-new", scope: SCOPE, by: CLAIM_NOTHING_NEW, ref: "nothing-new" }).pieces).toBe(TALK.length);
      b.set(NOW);
      const verdict = planRetention(b.c.spans, sources(b.c))[0]?.verdict;
      b.c.close();
      open.length = 0;
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-retention-"));
      return verdict;
    };
    expect(await withAnswer(true)).toBe("deleted");
    expect(await withAnswer(false)).toBe("kept-owed");
  });

  test("m6: the date's latch is taken with O_EXCL BEFORE anything is planned — a second run that date touches nothing", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    // Another worker holds today's latch already.
    mkdirSync(join(dir, "spans", "retention"), { recursive: true });
    writeFileSync(join(dir, "spans", "retention", "2026-09-23.latch"), "", "utf8");
    const second = pruneRetention(b.c.spans, sources(b.c), { date: "2026-09-23" });
    expect(second.reason).toBe("ALREADY_RAN");
    expect(heldSessions(dir)).toEqual(["old"]);
    // The next date is its own, and the first run on it wins it.
    expect(pruneRetention(b.c.spans, sources(b.c), { date: "2026-09-24" }).deleted).toBe(1);
    expect(pruneRetention(b.c.spans, sources(b.c), { date: "2026-09-24" }).reason).toBe("ALREADY_RAN");
    // The job reads a held latch as "already ran", deletes nothing — and, since
    // the date has no row at all, leaves one saying the latch was held (R7).
    expect(retentionJob({ counterpart: b.c, date: "2026-09-24" }).reason).toBe("already-ran");
    expect(retentionRuns(b.c.store).map((r) => r.reason)).toEqual(["LATCH_HELD"]);
  });

  test("m6: latches stay bounded — a month of them, the oldest let go", () => {
    const buf = new SpanBuffer({ dir, now: () => NOW });
    for (let d = 1; d <= 40; d += 1) {
      pruneRetention(buf, fake(), { date: `2026-08-${String(((d - 1) % 31) + 1).padStart(2, "0")}` });
    }
    for (let d = 1; d <= 9; d += 1) pruneRetention(buf, fake(), { date: `2026-09-0${String(d)}` });
    const latches = readdirSync(join(dir, "spans", "retention"));
    expect(latches.length).toBe(31);
    expect(latches.sort()[latches.length - 1]).toBe("2026-09-09.latch");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the re-review's residuals (R1, R7, R8)", () => {
  test("R1: the write-up mark is not on the buffer anyone holds; it refuses an unknown scope, a free-text `by` and a session with no text", async () => {
    const b = brain();
    await live(b, "owes", NOW - 1 * DAY, { answer: null, endNormally: false });
    // The review's repro started with `c.spans.recordWriteUp(...)`: it is gone.
    expect((b.c.spans as unknown as Record<string, unknown>)["recordWriteUp"]).toBeUndefined();
    const legend = readFileSync(join(dir, "spans", "scopes.json"), "utf8");
    expect(recordWriteUp(b.c.spans, { scope: "/nowhere/at/all", session: "owes", by: "next-session" })).toBe("UNKNOWN_SCOPE");
    // ...and it never ADDS a scope: the legend and the directory are untouched.
    expect(readFileSync(join(dir, "spans", "scopes.json"), "utf8")).toBe(legend);
    expect(existsSync(join(dir, "spans", keyFor("/nowhere/at/all")))).toBe(false);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "owes", by: "anything" as never })).toBe("BAD_BY");
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "no-such-session", by: "owner" })).toBe("NO_TEXT");
    // Nothing moved: still owed (inside the ceiling).
    b.set(NOW + 10 * DAY);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("kept-owed");
    expect(b.c.spans.writeUps(SCOPE)).toEqual([]);
    // The one accepted shape, and the record carries the fixed word.
    expect(WRITE_UP_BY).toEqual(["next-session", "owner", "api"]);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "owes", by: "next-session" })).toBe("RECORDED");
    expect(b.c.spans.writeUps(SCOPE).map((w) => w.by)).toEqual(["next-session"]);
  });

  test("R7: a run that dies after taking the latch leaves a STARTED row; a held latch with no row leaves LATCH_HELD", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    // A healthy run: STARTED first, then the result — and the newest is the result.
    expect(retentionJob({ counterpart: b.c, date: "2026-09-23" }).reason).toBe("ran");
    expect(retentionRuns(b.c.store).map((r) => [r.date, r.reason])).toEqual([
      ["2026-09-23", "PRUNED"],
      ["2026-09-23", "STARTED"],
    ]);
    // A latch held by a run that died before its first row: the next worker
    // says so rather than leaving the date spent and silent.
    mkdirSync(join(dir, "spans", "retention"), { recursive: true });
    writeFileSync(join(dir, "spans", "retention", "2026-09-24.latch"), "", "utf8");
    expect(retentionJob({ counterpart: b.c, date: "2026-09-24" }).reason).toBe("already-ran");
    expect(lastRetentionRun(b.c.store)).toMatchObject({ date: "2026-09-24", reason: "LATCH_HELD" });
    // ...once: a third worker that day finds the row and adds nothing.
    expect(retentionJob({ counterpart: b.c, date: "2026-09-24" }).reason).toBe("already-ran");
    expect(retentionRuns(b.c.store).filter((r) => r.date === "2026-09-24")).toHaveLength(1);
  });

  test("R7: a run that throws after the latch is visible as STARTED, and its sessions are due again the next date", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    const throwing = { ...sources(b.c), host: (): never => { throw new Error("host went away"); } } as unknown as RetentionSources;
    expect(() => pruneRetention(b.c.spans, throwing, {
      date: "2026-09-25",
      onLatched: () => {
        b.c.store.appendEvent({ name: RETENTION_EVENT, day: 0, payload: { date: "2026-09-25", reason: "STARTED" } });
      },
    })).toThrow();
    expect(lastRetentionRun(b.c.store)).toMatchObject({ date: "2026-09-25", reason: "STARTED" });
    expect(heldSessions(dir)).toEqual(["old"]);
    expect(prune(b.c.spans, sources(b.c)).deleted).toBe(1);
  });

  test("R8: a session with capture inside its clock is kept by the CAPTURE clock, whatever the registry still holds", async () => {
    const b = brain();
    await live(b, "recent", NOW - 2 * DAY, { answer: "chapter", endNormally: false });
    recordSession(dir, { sessionId: "recent", scope: SCOPE, phase: "start", at: NOW - 2 * DAY });
    b.set(NOW);
    // The registry forgets it (as `pruneSessions` would, given a later clock)...
    // Later than the record file's real mtime, which the prune reads; a clock
    // fixed from NOW stopped being later once the calendar passed it (10-16).
    expect(pruneSessions(dir, Date.now() + 30 * DAY)).toBe(1);
    // ...and it is still kept: it is young, and that reads the buffer alone.
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.open).toBe(false);
    expect(h?.verdict).toBe("kept-young");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the delete: the owner's strike, naming whole sessions", () => {
  test("recorded as RETENTION, counts only — no hash, no id, no word", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    prune(b.c.spans, sources(b.c));
    const strikes = readFileSync(join(dir, "spans", keyFor(SCOPE), "strikes.jsonl"), "utf8").trim().split("\n");
    expect(strikes).toHaveLength(1);
    const rec = JSON.parse(strikes[0] as string) as Record<string, unknown>;
    expect(rec["by"]).toBe("retention");
    expect(Object.keys(rec).sort()).toEqual(["at", "by", "day", "files", "ledgered", "struck"]);
    expect(strikes[0]).not.toContain("old");
  });

  test("the cursor, the boundaries and the proposals stay: only TEXT goes", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "session-end" });
    b.set(NOW);
    const before = b.c.spans.boundaries(SCOPE).length;
    prune(b.c.spans, sources(b.c));
    expect(b.c.spans.boundaries(SCOPE).length).toBe(before);
    expect(b.c.spans.cursor(SCOPE, "old")).toBe(turnsOf("old").length);
    // A re-read of the same transcript captures nothing: the cursor, not the
    // text, is what says it was already seen.
    const again = b.c.captureSpans({ session: "old", scope: SCOPE, turns: turnsOf("old") });
    expect(again.reason).toBe("NOTHING_NEW");
  });

  test("an observer deletes nothing, and says so through the strike's own stand-down", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.c.close();
    open.length = 0;
    const obs = new SpanBuffer({ dir, observer: true, now: () => NOW });
    const report = prune(obs, fake());
    expect(report.reason).toBe("OBSERVER");
    expect(report.deleted).toBe(0);
    // An instrument does not even take the date's latch.
    expect(existsSync(join(dir, "spans", "retention"))).toBe(false);
    expect(heldSessions(dir)).toEqual(["old"]);
    expect(obs.events("remember.observer.standdown").map((e) => e.data?.site)).toContain("strike");
  });

  test("the ledger a retention run writes is BOUNDED — a keyless store never runs the consume that would trim it", () => {
    const writer = new SpanBuffer({ dir, now: () => NOW - 10 * DAY });
    for (let i = 0; i < 12; i += 1) {
      writer.capture({ session: `s${String(i)}`, scope: SCOPE, turns: [{ role: "user", text: `turn number ${String(i)} of an old week` }] });
      writer.boundary({ session: `s${String(i)}`, scope: SCOPE, kind: "session-end" });
    }
    const small = new SpanBuffer({ dir, now: () => NOW, consumedLedgerMax: 5 });
    const report = prune(small, fake());
    expect(report.deleted).toBe(12);
    const ledger = readFileSync(join(dir, "spans", keyFor(SCOPE), "consumed.jsonl"), "utf8").trim().split("\n");
    expect(ledger.length).toBeLessThanOrEqual(5);
  });

  test("the job never throws, runs once per date, and a new date runs again", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    expect(retentionJob({ counterpart: b.c, date: "2026-09-23" }).reason).toBe("ran");
    expect(retentionJob({ counterpart: b.c, date: "2026-09-23" }).reason).toBe("already-ran");
    const next = retentionJob({ counterpart: b.c, date: "2026-09-24" });
    expect(next.reason).toBe("ran");
    expect(next.report?.deleted).toBe(0);
    expect(retentionRuns(b.c.store).filter((r) => r.reason !== "STARTED").map((r) => r.date)).toEqual(["2026-09-24", "2026-09-23"]);
  });

  test("the retention clocks are Mike's: 3 days after the write-up, never more than 14", () => {
    expect(REMEMBER_TUNABLES.RETENTION_MS).toBe(3 * DAY);
    expect(REMEMBER_TUNABLES.RETENTION_MAX_MS).toBe(14 * DAY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("THE CEILING and the configured clocks (Mike, 2026-10-13)", () => {
  test("a session that OWES is kept up to 14 days after its last activity, and deleted at 14", async () => {
    const b = brain();
    await live(b, "owes", NOW - 13 * DAY, { answer: null });
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c)).map((h) => [h.owes, h.verdict])).toEqual([[true, "kept-owed"]]);
    // Its last piece was twenty minutes after it began: an hour past the day.
    b.set(NOW + 1 * DAY + 60 * MIN);
    const [h] = planRetention(b.c.spans, sources(b.c));
    // Still owed — coverage's rule is unchanged — and deleted anyway.
    expect(h?.owes).toBe(true);
    expect(h?.verdict).toBe("deleted");
    expect(prune(b.c.spans, sources(b.c)).deleted).toBe(1);
    expect(heldSessions(dir)).toEqual([]);
  });

  test("the ceiling reads the last ACTIVITY: a late write-up or a late end cannot push it out", async () => {
    const b = brain();
    await live(b, "late", NOW - 15 * DAY, { answer: null, endNormally: false });
    b.set(NOW - 1 * DAY);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "late", by: "next-session" })).toBe("RECORDED");
    recordSession(dir, { sessionId: "late", scope: SCOPE, phase: "end", at: NOW - 1 * DAY });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    // The 3-day clock alone would keep it (written up yesterday): the ceiling does not.
    expect(h?.clockFrom).toBeGreaterThanOrEqual(NOW - 1 * DAY);
    expect(h?.verdict).toBe("deleted");
  });

  test("a host's clocks are what the plan reads — and a bad one falls back, never meaning 'delete now'", async () => {
    const b = brain();
    await live(b, "written", NOW - 5 * DAY, { answer: "chapter" });
    await live(b, "owes", NOW - 20 * DAY, { answer: null });
    b.set(NOW);
    const verdicts = (clocks: { retentionMs?: number; maxMs?: number }): string[][] =>
      planRetention(b.c.spans, sources(b.c, clocks)).map((h) => [h.session, h.verdict]);
    // Defaults: 3 days and 14.
    expect(verdicts({})).toEqual([["owes", "deleted"], ["written", "deleted"]]);
    // A longer setting, for a developer's store: 14 and 30.
    expect(verdicts({ retentionMs: 14 * DAY, maxMs: 30 * DAY })).toEqual([["owes", "kept-owed"], ["written", "kept-young"]]);
    // Nonsense is the default, not zero.
    expect(verdicts({ retentionMs: 0, maxMs: Number.NaN })).toEqual(verdicts({}));
    expect(retentionSources(b.c.store, { retentionMs: -1, maxMs: 0 })).toMatchObject({
      retentionMs: REMEMBER_TUNABLES.RETENTION_MS,
      maxMs: REMEMBER_TUNABLES.RETENTION_MAX_MS,
    });
  });

  test("the job takes the configuration's clocks, and its row says which it ran under", async () => {
    const b = brain();
    await live(b, "written", NOW - 5 * DAY, { answer: "chapter" });
    b.set(NOW);
    const job = retentionJob({ counterpart: b.c, date: "2026-09-23", clocks: { retentionMs: 14 * DAY, maxMs: 30 * DAY } });
    expect(job.report).toMatchObject({ deleted: 0, keptYoung: 1 });
    expect(lastRetentionRun(b.c.store)).toMatchObject({ deleted: 0, keptYoung: 1 });
    const rows = b.c.store.eventLog({ name: RETENTION_EVENT });
    expect(JSON.parse(rows[rows.length - 1]?.payload ?? "{}")).toMatchObject({ retentionDays: 14, maxDays: 30 });
  });
});
