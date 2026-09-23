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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Counterpart } from "../src/core/counterpart.js";
import {
  RETENTION_EVENT,
  SpanBuffer,
  TUNABLES as REMEMBER_TUNABLES,
  keyFor,
  lastRetentionRun,
  owesWriteUp,
  planRetention,
  pruneRetention,
  retentionRuns,
  retentionSources,
} from "../src/core/remember/index.js";
import type { EpisodeFactsReading, RetentionSources, WriteUpFacts } from "../src/core/remember/index.js";
import { episodeFacts } from "../src/core/self/index.js";
import { retentionJob, runOnce } from "../src/adapters/claude-code/bin/runner.js";

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

function sources(c: Counterpart): RetentionSources {
  return retentionSources(c.store, (id) => episodeFacts(c.store, id));
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

    // THE ROW: one, with the counts, and no session id or word in it.
    const rows = b.c.store.eventLog({ name: RETENTION_EVENT });
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ date: "2026-09-23", reason: "PRUNED", deleted: 1, keptOwed: 1, keptYoung: 1, failed: 0, retentionDays: 7 });
    expect(rows[0]?.payload).not.toContain("written-old");
    expect(rows[0]?.payload).not.toContain("migration");
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
      const report = await runOnce({ config, date: "2026-09-23", env: {} });
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

      // Once per date: a second worker the same day does nothing and adds no row.
      const again = await runOnce({ config, date: "2026-09-23", env: {} });
      expect(again.retention?.reason).toBe("already-ran");
      const check = Counterpart.open({ dir });
      open.push(check);
      expect(check.store.eventLog({ name: RETENTION_EVENT })).toHaveLength(1);
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
    const report = pruneRetention(b.c.spans, sources(b.c));
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
    expect(b.c.spans.recordWriteUp({ scope: SCOPE, session: "late", by: "sess_next" })).toBe(true);
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
    const facts: EpisodeFactsReading = { status: "loaded", asks: 3, chapters: 0 };
    const src: RetentionSources = { episode: () => facts, handoffSessions: new Set() };
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
    const src: RetentionSources = { episode: () => ({ status: "loaded", asks: 1, chapters: 0 }), handoffSessions: new Set() };
    const [h] = planRetention(new SpanBuffer({ dir, now: () => NOW }), src);
    expect(h?.facts.capturedText).toBe(true);
    expect(h?.verdict).toBe("kept-owed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("the delete: the owner's strike, naming whole sessions", () => {
  test("recorded as RETENTION, counts only — no hash, no id, no word", async () => {
    const b = brain();
    await live(b, "old", NOW - 10 * DAY, { answer: "chapter" });
    b.set(NOW);
    pruneRetention(b.c.spans, sources(b.c));
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
    pruneRetention(b.c.spans, sources(b.c));
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
    const src: RetentionSources = { episode: () => ({ status: "loaded", asks: 1, chapters: 1 }), handoffSessions: new Set() };
    const report = pruneRetention(obs, src);
    expect(report.reason).toBe("OBSERVER");
    expect(report.deleted).toBe(0);
    expect(report.failed).toBe(1);
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
    const src: RetentionSources = { episode: () => ({ status: "absent", asks: 0, chapters: 0 }), handoffSessions: new Set() };
    const report = pruneRetention(small, src);
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
    expect(retentionRuns(b.c.store).map((r) => r.date)).toEqual(["2026-09-24", "2026-09-23"]);
  });

  test("the retention window is the owner's seven days", () => {
    expect(REMEMBER_TUNABLES.RETENTION_MS).toBe(7 * DAY);
  });
});
