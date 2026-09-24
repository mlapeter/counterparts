/**
 * RAW TRANSCRIPT RETENTION — owner's ruling 2026-09-23 (roadmap B3).
 *
 * A session's captured text is deleted 7 days after it ended, when nothing is
 * owed; a session that owes a write-up waits until it is written up. The
 * predicate (`remember/retention.ts#owesWriteUp`) is defined once and read by
 * everything that decides; these tests hold it to three promises:
 *
 *   1. the acceptance scenario — three sessions (written up 10 days ago,
 *      written up 2 days ago, owing a write-up 10 days ago): exactly the first
 *      is deleted, and the `remember.prune` row says 1 / 1 / 1 — proved at the
 *      job AND through the whole worker (`runOnce`);
 *   2. NOTHING DELETES WITHOUT THE PREDICATE SAYING NOTHING IS OWED — every
 *      combination of facts, at an age well past the week;
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

import { ADAPTER_ASK_EVENT, Counterpart } from "../src/core/counterpart.js";
import * as rememberIndex from "../src/core/remember/index.js";
import {
  NO_HOST_EVIDENCE,
  RETENTION_EVENT,
  SpanBuffer,
  TUNABLES as REMEMBER_TUNABLES,
  keyFor,
  lastRetentionRun,
  owesWriteUp,
  planRetention,
  retentionRuns,
  retentionSources,
} from "../src/core/remember/index.js";
import type {
  EpisodeFactsReading,
  HostSessionEvidence,
  RetentionSources,
  WriteUpFacts,
} from "../src/core/remember/index.js";
// The deleting half, by path — the way only the worker may import it in `src/`.
import { pruneRetention } from "../src/core/remember/retention.js";
import { WRITE_UP_BY, recordWriteUp } from "../src/core/remember/write-up-seam.js";
import { SELF_TUNABLES, episodeFacts } from "../src/core/self/index.js";
import { ASK_ROW_COUNTING, markNothingNew, pruneSessions, recordSession, sessionPath } from "../src/adapters/sessions.js";
import { retentionHost, retentionJob, runOnce } from "../src/adapters/claude-code/bin/runner.js";

const DAY = 86_400_000;
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
  { role: "user" as const, text: "We spent the morning on the migration plan and what to cut from it." },
  { role: "assistant" as const, text: "The plan keeps the store format and drops the second index entirely." },
  { role: "user" as const, text: "Good, and the rollback is the snapshot from the night before." },
];

/** A session that talked, crossed the pacer's threshold (so it was ASKED), and
 *  then did — or did not — answer and end normally. */
async function live(
  b: { c: Counterpart; set(at: number): void },
  session: string,
  at: number,
  opts: { answer?: "chapter" | "session-end" | "handoff" | null; endNormally?: boolean; asked?: boolean } = {},
): Promise<void> {
  b.set(at);
  b.c.captureSpans({ session, scope: SCOPE, turns: TALK.map((t) => ({ ...t, text: `${t.text} (${session})` })) });
  if (opts.asked !== false) {
    expect(b.c.episodeAsk(session, { turns: 9, bytes: 6_000 }).asked).toBe(true);
  }
  b.c.boundary({ session, scope: SCOPE, kind: "stop" });
  if (opts.answer === "chapter") {
    expect(b.c.appendEpisode(session, `The migration plan came together today (${session}).`).appended).toBe(true);
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

const FIRST_ASK = {
  turns: SELF_TUNABLES.FIRST_ASK_TURNS,
  textBytes: SELF_TUNABLES.FIRST_ASK_TEXT_BYTES,
};

/** The sources the worker builds: the pacer, the handoff rows, this host's
 *  registry and ask rows. */
function sources(c: Counterpart): RetentionSources {
  return retentionSources(c.store, {
    episode: (id) => episodeFacts(c.store, id),
    host: retentionHost(c.store),
    firstAsk: FIRST_ASK,
  });
}

/** Hand-made sources, for a test about ONE fact. */
function fake(episode: Partial<EpisodeFactsReading>, host: Partial<HostSessionEvidence> = {}): RetentionSources {
  const e: EpisodeFactsReading = { status: "loaded", asks: 0, chapters: 0, appendedAtAsk: 0, lastAskAt: null, ...episode };
  return { episode: () => e, handoffAnswers: () => [], host: () => ({ ...NO_HOST_EVIDENCE, ...host }), firstAsk: FIRST_ASK };
}

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
    expect(job.report?.lines).toBe(2);
    expect(heldSessions(dir)).toEqual(["owes-old", "written-recent"]);

    // THE ROWS: `STARTED` the moment the latch was held (re-review R7), then
    // the result, with the counts — and no session id or word in either.
    const rows = b.c.store.eventLog({ name: RETENTION_EVENT });
    expect(rows.map((r) => (JSON.parse(r.payload ?? "{}") as { reason: string }).reason)).toEqual(["STARTED", "PRUNED"]);
    const payload = JSON.parse(rows[1]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ date: "2026-09-23", reason: "PRUNED", deleted: 1, keptOwed: 1, keptYoung: 1, failed: 0, retentionDays: 7 });
    for (const row of rows) {
      expect(row.payload).not.toContain("written-old");
      expect(row.payload).not.toContain("migration");
    }
    expect(lastRetentionRun(b.c.store)).toMatchObject({ date: "2026-09-23", deleted: 1, keptOwed: 1, keptYoung: 1 });
  });

  test("the same store through the WHOLE worker: `runOnce` deletes exactly the first, keylessly, before the snapshot", async () => {
    // Seeded on a clock set back from the real one, because the worker opens
    // its own counterpart on the wall clock.
    const real = Date.now();
    const b = brain(real);
    await live(b, "written-old", real - 10 * DAY, { answer: "chapter" });
    await live(b, "written-recent", real - 2 * DAY, { answer: "session-end" });
    await live(b, "owes-old", real - 10 * DAY, { answer: null });
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

      // The day's snapshot was taken AFTER the deletion: its copy of the buffer
      // holds no line of the deleted session.
      expect(report.snapshot?.reason).toBe("taken");
      const copies = readdirSync(snaps).filter((n) => !n.startsWith("."));
      expect(copies.length).toBe(1);
      const copied = join(snaps, copies[0] as string, "spans", keyFor(SCOPE), "buffer.jsonl");
      expect(readFileSync(copied, "utf8")).not.toContain("(written-old)");
      expect(readFileSync(copied, "utf8")).toContain("(owes-old)");

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
describe("THE PREDICATE — nothing deletes unless it says nothing is owed", () => {
  test("the truth table, whole", () => {
    const rows: [WriteUpFacts, boolean][] = [];
    for (const capturedText of [false, true])
      for (const asked of [false, true])
        for (const answered of [false, true])
          for (const endedNormally of [false, true])
            for (const writtenUp of [false, true]) {
              const f = { capturedText, asked, answered, endedNormally, writtenUp };
              rows.push([f, owesWriteUp(f)]);
            }
    const owing = rows.filter(([, owes]) => owes).map(([f]) => f);
    // Exactly three shapes owe: asked and unanswered (ended either way), and
    // asked, answered, but lost without a normal end. All three hold text and
    // none has been written up since.
    expect(owing).toEqual([
      { capturedText: true, asked: true, answered: false, endedNormally: false, writtenUp: false },
      { capturedText: true, asked: true, answered: false, endedNormally: true, writtenUp: false },
      { capturedText: true, asked: true, answered: true, endedNormally: false, writtenUp: false },
    ]);
  });

  test("every combination of facts on disk, 30 days old: DELETED if and only if the predicate says nothing is owed", async () => {
    const b = brain();
    const shapes: { session: string; asked: boolean; answer: "chapter" | null; endNormally: boolean }[] = [];
    for (const asked of [false, true])
      for (const answer of ["chapter", null] as const)
        for (const endNormally of [false, true]) {
          if (!asked && answer !== null) continue; // a chapter needs an ask to open it
          shapes.push({ session: `s-${String(asked)}-${String(answer)}-${String(endNormally)}`, asked, answer, endNormally });
        }
    for (const s of shapes) await live(b, s.session, NOW - 30 * DAY, { asked: s.asked, answer: s.answer, endNormally: s.endNormally });
    b.set(NOW);
    const plan = planRetention(b.c.spans, sources(b.c));
    expect(plan).toHaveLength(shapes.length);
    for (const h of plan) {
      expect({ session: h.session, deleted: h.verdict === "deleted" }).toEqual({
        session: h.session,
        deleted: !owesWriteUp(h.facts),
      });
    }
    const report = prune(b.c.spans, sources(b.c));
    const owed = plan.filter((h) => h.owes).map((h) => h.session).sort();
    expect(heldSessions(dir)).toEqual(owed);
    expect(report.keptOwed).toBe(owed.length);
    expect(report.deleted).toBe(shapes.length - owed.length);
  });

  test("a SHORT session the pacer never asked about owes nothing — it goes after its week, crashed or not", async () => {
    const b = brain();
    await live(b, "short-crashed", NOW - 8 * DAY, { asked: false, endNormally: false });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts).toMatchObject({ capturedText: true, asked: false });
    expect(h?.verdict).toBe("deleted");
  });

  test("clause (b): asked, ANSWERED, but lost without a normal end — the tail after its answer is owed", async () => {
    const b = brain();
    await live(b, "answered-then-lost", NOW - 20 * DAY, { answer: "chapter", endNormally: false });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts).toMatchObject({ asked: true, answered: true, endedNormally: false });
    expect(h?.verdict).toBe("kept-owed");
  });

  test("a handoff-only answer is an answer", async () => {
    const b = brain();
    await live(b, "handoff-only", NOW - 9 * DAY, { answer: "handoff" });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.answered).toBe(true);
    expect(h?.verdict).toBe("deleted");
  });

  test("resumed after a normal end and then lost: judged by the stretch AFTER its last end", async () => {
    const b = brain();
    await live(b, "resumed", NOW - 12 * DAY, { answer: "chapter" });
    // The same session id comes back two days later, talks, and is lost.
    b.set(NOW - 10 * DAY);
    b.c.captureSpans({
      session: "resumed",
      scope: SCOPE,
      turns: [...TALK, { role: "user" as const, text: "Back again after the weekend (resumed)." }],
    });
    b.c.boundary({ session: "resumed", scope: SCOPE, kind: "stop" });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.endedNormally).toBe(false);
    expect(h?.verdict).toBe("kept-owed");
  });

  test("an UNREADABLE pacer state counts as asked — the safe direction for a rule that deletes", async () => {
    const b = brain();
    await live(b, "corrupt", NOW - 30 * DAY, { answer: null, endNormally: false });
    b.c.store.setMeta("self.episode.corrupt", "{not json");
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.asked).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
  });

  test("a session written up AFTER it ended stops owing, and its week starts at the write-up", async () => {
    const b = brain();
    await live(b, "late", NOW - 30 * DAY, { answer: null });
    b.set(NOW - 3 * DAY);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "late", by: "next-session" })).toBe("RECORDED");
    b.set(NOW);
    let [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.writtenUp).toBe(true);
    expect(h?.owes).toBe(false);
    expect(h?.verdict).toBe("kept-young");
    b.set(NOW + 5 * DAY);
    [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.verdict).toBe("deleted");
  });

  test("the assistant's own turns are not a debt: a session whose conversation the sweep consumed owes nothing", () => {
    // What the key-based fallback leaves behind: `assistant.jsonl` is never
    // claimed or swept, so a session it wrote up still holds its replies.
    const buf = new SpanBuffer({ dir, now: () => NOW - 10 * DAY });
    buf.capture({ session: "swept", scope: SCOPE, turns: [{ role: "assistant", text: "Only the reply is left." }] });
    const src = fake({ asks: 3 });
    const later = new SpanBuffer({ dir, now: () => NOW });
    const [h] = planRetention(later, src);
    expect(h?.facts.capturedText).toBe(false);
    expect(h?.verdict).toBe("deleted");
  });

  test("text held only in a CLAIM file still counts as captured — nothing in flight can make a session look empty", () => {
    const buf = new SpanBuffer({ dir, now: () => NOW - 10 * DAY, minClaimBytes: 0 });
    buf.capture({ session: "mid-sweep", scope: SCOPE, turns: [{ role: "user", text: "A turn a crashed sweep is holding." }] });
    const claim = buf.claim(SCOPE);
    expect(claim.claimed).toBe(true);
    const src = fake({ asks: 1, lastAskAt: NOW - 10 * DAY });
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), src);
    expect(h?.facts.capturedText).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the PR #189 review's findings, each held by a test", () => {
  test("B1: the deleting half is not reachable through remember's index — fake facts through `Counterpart.spans` delete nothing", async () => {
    expect(Object.keys(rememberIndex)).not.toContain("pruneRetention");
    expect(Object.keys(rememberIndex)).not.toContain("strikeSpans");
    // The review's repro, through everything the index DOES export: one session,
    // asked a day ago and never answered — owed.
    const b = brain();
    await live(b, "A", NOW - 1 * DAY, { answer: null, endNormally: false });
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c)).map((h) => h.verdict)).toEqual(["kept-owed"]);
    // A buffer on a clock 30 days on, and facts made up to say "never asked":
    // the plan agrees to delete — and a plan is all the index can give.
    const future = new SpanBuffer({ dir, now: () => NOW + 30 * DAY });
    expect(planRetention(future, fake({ status: "absent" })).map((h) => h.verdict)).toEqual(["deleted"]);
    expect(heldSessions(dir)).toEqual(["A"]);
    expect(b.c.spans.spans(SCOPE).length).toBeGreaterThan(0);
    expect(b.c.spans.assistantSpans(SCOPE).length).toBeGreaterThan(0);
  });

  test("M1: one early answer does not cover the asks after it — a chapter, a session_end memory, a handoff", async () => {
    for (const answer of ["chapter", "session-end", "handoff"] as const) {
      const b = brain();
      await live(b, "early", NOW - 10 * DAY, { answer, endNormally: false });
      // Four more hours, two more asks, never answered — then a clean end.
      b.set(NOW - 10 * DAY + 2 * 3_600_000);
      b.c.captureSpans({ session: "early", scope: SCOPE, turns: [...TALK, ...TALK].map((t, i) => ({ ...t, text: `${t.text} [${String(i)}] (early)` })) });
      expect(b.c.episodeAsk("early", { turns: 30, bytes: 30_000 }).asked).toBe(true);
      b.set(NOW - 10 * DAY + 4 * 3_600_000);
      expect(b.c.episodeAsk("early", { turns: 60, bytes: 60_000 }).asked).toBe(true);
      b.c.boundary({ session: "early", scope: SCOPE, kind: "session-end" });
      b.set(NOW);
      const [h] = planRetention(b.c.spans, sources(b.c));
      expect({ answer, answered: h?.facts.answered, verdict: h?.verdict }).toEqual({ answer, answered: false, verdict: "kept-owed" });
      b.c.close();
      open.length = 0;
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-retention-"));
    }
  });

  test("M1: an answer AFTER the last ask does settle it", async () => {
    const b = brain();
    await live(b, "late-answer", NOW - 10 * DAY, { answer: null, endNormally: false });
    b.set(NOW - 10 * DAY + 3_600_000);
    expect(b.c.episodeAsk("late-answer", { turns: 30, bytes: 30_000 }).asked).toBe(true);
    b.set(NOW - 10 * DAY + 2 * 3_600_000);
    expect(b.c.appendEpisode("late-answer", "What the afternoon came to, written at the end.").appended).toBe(true);
    b.c.boundary({ session: "late-answer", scope: SCOPE, kind: "session-end" });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.answered).toBe(true);
    expect(h?.verdict).toBe("deleted");
  });

  test("m1: no pacer record, but substance past the first-ask threshold — a stood-down or failed ask is not a short session", () => {
    // 30 turns past the text threshold, the pacer never recorded anything, no
    // end: it OWES.
    const buf = new SpanBuffer({ dir, now: () => NOW - 8 * DAY });
    const turns = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${String(i)}: a real exchange about the migration plan and what it costs.`.padEnd(
        Math.ceil(SELF_TUNABLES.FIRST_ASK_TEXT_BYTES / 30) + 10,
        ".",
      ),
    }));
    buf.capture({ session: "substantive", scope: SCOPE, turns });
    buf.boundary({ session: "substantive", scope: SCOPE, kind: "stop" });
    const later = new SpanBuffer({ dir, now: () => NOW });
    const [h] = planRetention(later, fake({ status: "absent" }));
    expect(h?.facts.asked).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
    // ...unless the pacer SAW all of it and measured it short: its word stands.
    const sawIt = fake({ status: "absent" }, { lastEvaluation: { at: NOW - 8 * DAY, turns: 3, bytes: 900 } });
    expect(planRetention(later, sawIt)[0]?.verdict).toBe("deleted");
    // An evaluation OLDER than the last capture did not see it all: the count decides.
    const stale = fake({ status: "absent" }, { lastEvaluation: { at: NOW - 9 * DAY, turns: 3, bytes: 900 } });
    expect(planRetention(later, stale)[0]?.verdict).toBe("kept-owed");
  });

  test("with no evaluation covering the last capture, the BYTES decide — the cursor is not a count of typed turns", () => {
    // One typed prompt, five short assistant blocks, then a capture at the
    // session's end that no ask row saw. Eleven-odd pieces, a few hundred bytes.
    const buf = new SpanBuffer({ dir, now: () => NOW - 8 * DAY });
    const turns = [
      { role: "user" as const, text: "Rename the config key and update the tests." },
      ...Array.from({ length: 5 }, (_, i) => ({ role: "assistant" as const, text: `Step ${String(i)} done.` })),
    ];
    buf.capture({ session: "short", scope: SCOPE, turns });
    buf.boundary({ session: "short", scope: SCOPE, kind: "stop" });
    const atEnd = new SpanBuffer({ dir, now: () => NOW - 8 * DAY + 60_000 });
    atEnd.capture({ session: "short", scope: SCOPE, turns: [...turns, { role: "user", text: "<command-name>/exit</command-name>", source: "injected" }] });
    atEnd.boundary({ session: "short", scope: SCOPE, kind: "session-end" });
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), fake({ status: "absent" }));
    expect(h?.facts.asked).toBe(false);
    expect(h?.owes).toBe(false);
  });

  test("an ask row from before typed-turn counting is read by its bytes alone", () => {
    const b = brain(NOW - 10 * DAY);
    b.c.captureSpans({ session: "old-row", scope: SCOPE, turns: TALK });
    b.c.boundary({ session: "old-row", scope: SCOPE, kind: "stop" });
    // Both-roles turns past the typed-turn threshold, bytes under the text one.
    const row = { session: "old-row", asked: false, outcome: "paced", reason: "not-enough-substance", turns: 7, bytes: 2_500 };
    expect(row.turns).toBeGreaterThanOrEqual(SELF_TUNABLES.FIRST_ASK_TURNS);
    expect(row.bytes).toBeLessThan(SELF_TUNABLES.FIRST_ASK_TEXT_BYTES);
    b.c.noteAdapterEvent(ADAPTER_ASK_EVENT, row);
    b.c.boundary({ session: "old-row", scope: SCOPE, kind: "session-end" });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.asked).toBe(false);
    expect(h?.owes).toBe(false);
    // The same numbers on a stamped row are typed turns, and they do count.
    b.set(NOW - 10 * DAY);
    b.c.noteAdapterEvent(ADAPTER_ASK_EVENT, { ...row, counting: ASK_ROW_COUNTING });
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.facts.asked).toBe(true);
  });

  test("m1: the host's ask rows count as asks, and their time as the last ask", async () => {
    const b = brain();
    await live(b, "host-asked", NOW - 10 * DAY, { asked: false, answer: null });
    // The pacer's state was never written, but the host recorded an ask.
    b.c.noteAdapterEvent(ADAPTER_ASK_EVENT, { session: "host-asked", asked: true, outcome: "asked", turns: 9, bytes: 6_000 });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.facts.asked).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
  });

  test("m10: a session the registry holds OPEN is never deleted, whatever its age", async () => {
    const b = brain();
    await live(b, "idle-open", NOW - 400 * DAY, { asked: false, endNormally: false });
    recordSession(dir, { sessionId: "idle-open", scope: SCOPE, phase: "start", at: NOW - 400 * DAY });
    b.set(NOW);
    const [h] = planRetention(b.c.spans, sources(b.c));
    expect(h?.open).toBe(true);
    expect(h?.verdict).toBe("kept-live");
    const report = prune(b.c.spans, sources(b.c));
    expect(report.keptLive).toBe(1);
    expect(heldSessions(dir)).toEqual(["idle-open"]);
    // Once the registry records its end, the ordinary rule applies.
    recordSession(dir, { sessionId: "idle-open", scope: SCOPE, phase: "end", at: NOW - 399 * DAY });
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("deleted");
  });

  test("m10: a registry record that will not read is treated as open — cannot tell means keep", async () => {
    const b = brain();
    await live(b, "garbled", NOW - 30 * DAY, { asked: false, endNormally: false });
    recordSession(dir, { sessionId: "garbled", scope: SCOPE, phase: "start", at: NOW - 30 * DAY });
    writeFileSync(sessionPath(dir, "garbled") as string, "{half a rec", "utf8");
    b.set(NOW);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("kept-live");
  });

  test("m2: an end recorded in one directory settles the text the session left in another", async () => {
    const b = brain();
    const OTHER = "/scope/retention-worktree";
    b.set(NOW - 10 * DAY);
    b.c.captureSpans({ session: "two-dirs", scope: OTHER, turns: TALK.map((t) => ({ ...t, text: `${t.text} (other dir)` })) });
    b.c.boundary({ session: "two-dirs", scope: OTHER, kind: "stop" });
    await live(b, "two-dirs", NOW - 10 * DAY, { answer: "chapter" }); // the end lands under SCOPE only
    b.set(NOW);
    const plan = planRetention(b.c.spans, sources(b.c));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.scopes).toEqual([OTHER, SCOPE].sort());
    expect(plan[0]?.facts.endedNormally).toBe(true);
    expect(plan[0]?.verdict).toBe("deleted");
    const report = prune(b.c.spans, sources(b.c));
    expect(report.deleted).toBe(1);
    expect(b.c.spans.spans(OTHER)).toEqual([]);
    expect(b.c.spans.spans(SCOPE)).toEqual([]);
  });

  test("m3: #186's 'nothing new' mark is an answer when it came after the last ask — and not when it came before", async () => {
    // #186 has landed: the mark is written by its own `markNothingNew` and read
    // back through the registry's own parser.
    const withMark = async (markAfterAsk: boolean): Promise<string | undefined> => {
      const b = brain();
      await live(b, "nothing-new", NOW - 10 * DAY, { answer: null });
      recordSession(dir, { sessionId: "nothing-new", scope: SCOPE, phase: "end", at: NOW - 10 * DAY });
      expect(markNothingNew(dir, "nothing-new", markAfterAsk ? NOW - 10 * DAY + 60_000 : NOW - 11 * DAY)).not.toBeNull();
      b.set(NOW);
      const verdict = planRetention(b.c.spans, sources(b.c))[0]?.verdict;
      b.c.close();
      open.length = 0;
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), "counterparts-retention-"));
      return verdict;
    };
    expect(await withMark(true)).toBe("deleted");
    expect(await withMark(false)).toBe("kept-owed");
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
      pruneRetention(buf, fake({}), { date: `2026-08-${String(((d - 1) % 31) + 1).padStart(2, "0")}` });
    }
    for (let d = 1; d <= 9; d += 1) pruneRetention(buf, fake({}), { date: `2026-09-0${String(d)}` });
    const latches = readdirSync(join(dir, "spans", "retention"));
    expect(latches.length).toBe(31);
    expect(latches.sort()[latches.length - 1]).toBe("2026-09-09.latch");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the re-review's residuals (R1, R5, R7, R8)", () => {
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
    // Nothing moved: still owed.
    b.set(NOW + 30 * DAY);
    expect(planRetention(b.c.spans, sources(b.c))[0]?.verdict).toBe("kept-owed");
    expect(b.c.spans.writeUps(SCOPE)).toEqual([]);
    // The one accepted shape, and the record carries the fixed word.
    expect(WRITE_UP_BY).toEqual(["next-session", "owner", "api"]);
    expect(recordWriteUp(b.c.spans, { scope: SCOPE, session: "owes", by: "next-session" })).toBe("RECORDED");
    expect(b.c.spans.writeUps(SCOPE).map((w) => w.by)).toEqual(["next-session"]);
  });

  test("R5: substance is counted in UTF-8 BYTES, like the pacer — a session in Japanese is not read as short", () => {
    // Fewer turns than the first ask needs, so the bytes decide: past the text
    // threshold in UTF-8, under a third of it in UTF-16 code units.
    const unit = "今日は移行計画について長く話し合い、どの索引を残してどれを落とすかを決めた。";
    const count = SELF_TUNABLES.FIRST_ASK_TURNS - 1;
    const line = unit.repeat(Math.ceil(SELF_TUNABLES.FIRST_ASK_TEXT_BYTES / (count * Buffer.byteLength(unit, "utf8"))) + 1);
    const turns = Array.from({ length: count }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `${String(i)}: ${line}`,
    }));
    const buf = new SpanBuffer({ dir, now: () => NOW - 8 * DAY });
    buf.capture({ session: "nihongo", scope: SCOPE, turns });
    buf.boundary({ session: "nihongo", scope: SCOPE, kind: "stop" });
    const utf8 = turns.reduce((n, t) => n + Buffer.byteLength(t.text, "utf8"), 0);
    expect(utf8).toBeGreaterThanOrEqual(SELF_TUNABLES.FIRST_ASK_TEXT_BYTES);
    expect(turns.reduce((n, t) => n + t.text.length, 0)).toBeLessThan(SELF_TUNABLES.FIRST_ASK_TEXT_BYTES);
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), fake({ status: "absent" }));
    expect(h?.facts.asked).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
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

  test("R8: a session with capture in the last week is kept by the CAPTURE clock, whatever the registry still holds", async () => {
    const b = brain();
    await live(b, "recent", NOW - 5 * DAY, { asked: false, endNormally: false });
    recordSession(dir, { sessionId: "recent", scope: SCOPE, phase: "start", at: NOW - 5 * DAY });
    b.set(NOW);
    // The registry forgets it (as `pruneSessions` would, given a later clock)...
    expect(pruneSessions(dir, NOW + 30 * DAY)).toBe(1);
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
    expect(b.c.spans.cursor(SCOPE, "old")).toBe(TALK.length);
    // A re-read of the same transcript captures nothing: the cursor, not the
    // text, is what says it was already seen.
    const again = b.c.captureSpans({ session: "old", scope: SCOPE, turns: TALK.map((t) => ({ ...t, text: `${t.text} (old)` })) });
    expect(again.reason).toBe("NOTHING_NEW");
  });

  test("an observer deletes nothing, and says so through the strike's own stand-down", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.c.close();
    open.length = 0;
    const obs = new SpanBuffer({ dir, observer: true, now: () => NOW });
    const src = fake({ asks: 1, chapters: 1, appendedAtAsk: 1, lastAskAt: NOW - 10 * DAY });
    const report = prune(obs, src);
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
    const src = fake({ status: "absent" });
    const report = prune(small, src);
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

  test("the retention window is the owner's seven days", () => {
    expect(REMEMBER_TUNABLES.RETENTION_MS).toBe(7 * DAY);
  });
});
