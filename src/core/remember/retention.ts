/**
 * RAW TRANSCRIPT RETENTION — owner's ruling 2026-09-23 (roadmap B3).
 *
 * Until this existed nothing pruned `spans/` (INTERFACE-GAPS §9): every
 * conversational turn stayed on disk verbatim for as long as the store lived,
 * every nightly backup copied it, and a removed memory's source text survived
 * its removal in the buffer beside it. The rule the owner set:
 *
 *   **a session's captured text is deleted 7 days after it ended, when nothing
 *   is owed; a session that owes a write-up waits until it is written up.**
 *
 * ── THE PREDICATE, DEFINED ONCE ───────────────────────────────────────────
 *
 * `owesWriteUp` is the one definition of "this session ended and was never
 * written up". Retention reads it here, doctor reads it through
 * `retentionRuns`, and the next-session write-up (roadmap C2) is meant to read
 * it too — so "what may be deleted" and "what the next session is asked to
 * write" can never be two different sets. It decides on FACTS, never on text:
 *
 *   - `capturedText` — the session still holds conversation or jot text here
 *     (buffer, jots, quarantine, a claim in flight). The assistant's own turns
 *     do NOT count: nothing ever writes a session up from them, so counting
 *     them would make a session the key-based sweep already wrote up owe for
 *     ever. With nothing captured there is nothing to write up FROM, so nothing
 *     is owed, whatever else is true.
 *   - `asked` — the PACER FOUND SUBSTANCE: at least one ask was committed
 *     (`self/episodes.ts`; an ask is committed only when one was due). A short
 *     session that never reached the pacer's threshold owes nothing — the
 *     owner's words, and the reason this reads the pacer rather than
 *     re-deriving a threshold from text. An unreadable pacer state counts as
 *     asked: the safe direction for a rule that deletes.
 *   - `answered` — a chapter was written, an accepted `session_end` memory was
 *     recorded, or the session wrote or cleared a handoff (a handoff-only
 *     `session_end` is an answer: the author had the pen and used it).
 *   - `endedNormally` — a `session-end` boundary at or after the session's last
 *     capture. A session resumed after it ended and then lost is judged by the
 *     stretch after its last normal end, not by an end it later reopened.
 *   - `writtenUp` — marked written up after it ended
 *     (`SpanBuffer#recordWriteUp`, C2's door).
 *
 *   owes = capturedText ∧ ¬writtenUp ∧ asked ∧ (¬answered ∨ ¬endedNormally)
 *
 * Read as the owner stated it: (a) the pacer found substance and no answer was
 * recorded, or (b) it ended abnormally with captured text — and in both, a
 * session that never reached the pacer's threshold owes nothing. Clause (b)
 * therefore also needs `asked`: without it every short session that was lost
 * to a closed terminal (Claude Code fires no SessionEnd for that) would owe a
 * write-up of "hi" for ever (NOTES §16 says why this reading was taken).
 *
 * ── THE CLOCK ─────────────────────────────────────────────────────────────
 *
 * Seven days (`TUNABLES.RETENTION_MS`) from the LATER of the session's last
 * activity in that scope (capture or boundary) and its write-up mark — so a
 * session written up late is kept a week past the write-up, and a live session
 * is always young. It is the buffer's own clock (`SpanBuffer#now`), the same
 * one every span and boundary was stamped with.
 *
 * ── HOW IT DELETES ────────────────────────────────────────────────────────
 *
 * Through the owner's strike (`owner-strike-seam.ts`), naming whole sessions,
 * recorded `by: "retention"`: the same rename-aside choreography, the same
 * recovery of a crashed aside, the same counts-only record. There is still one
 * path in this module that destroys a span. Every text-bearing file goes —
 * the buffer, jots, the assistant's turns, quarantine, and any claim file —
 * and nothing that carries only hashes or counts (cursors, boundaries,
 * coverage, proposals, the ledgers) is touched.
 *
 * Nothing here opens a store, calls a model or throws into a caller.
 */
import { HANDOFF_CLEARED_EVENT, HANDOFF_WRITTEN_EVENT } from "../handoff/index.js";
import type { Store } from "../store/index.js";

import { strikeSpans } from "./owner-strike-seam.js";
import type { ProposalRecord } from "./proposals.js";
import type { Span, SpanBuffer } from "./spans.js";
import { TUNABLES } from "./tunables.js";

/** The durable row one retention run leaves. Counts only — never a session id,
 *  never a hash, never a word (§16 G9's rule for a record of destruction). */
export const RETENTION_EVENT = "remember.prune";

// ── the predicate ───────────────────────────────────────────────────────────

/** What `owesWriteUp` decides on. Facts, no text. */
export interface WriteUpFacts {
  readonly capturedText: boolean;
  readonly asked: boolean;
  readonly answered: boolean;
  readonly endedNormally: boolean;
  readonly writtenUp: boolean;
}

/** THE predicate — see the header. Pure. */
export function owesWriteUp(f: WriteUpFacts): boolean {
  if (!f.capturedText) return false;
  if (f.writtenUp) return false;
  if (!f.asked) return false;
  return !f.answered || !f.endedNormally;
}

// ── the facts, gathered ─────────────────────────────────────────────────────

/** The pacer's record of one session (`self/episodes.ts#episodeFacts`). */
export interface EpisodeFactsReading {
  readonly status: "loaded" | "absent" | "unreadable";
  readonly asks: number;
  readonly chapters: number;
}

/**
 * What retention needs from outside the buffer. Injected, because the pacer is
 * `self/`'s and the handoff is its own module's: `remember/` reads their facts
 * and never their code.
 */
export interface RetentionSources {
  episode(session: string): EpisodeFactsReading;
  /** Sessions that wrote or cleared a handoff — an answer. */
  readonly handoffSessions: ReadonlySet<string>;
}

/** Ceiling on the handoff rows read — the log keeps ~90 lived days of them. */
const HANDOFF_ROW_CEILING = 50_000;

/**
 * The store-backed sources: the pacer's record through `episode` (the caller
 * passes `self/episodes.ts#episodeFacts`), and the handoff rows read here.
 * Never throws: an unreadable log is an empty set, which only ever makes a
 * session look LESS answered — the direction that keeps text.
 */
export function retentionSources(
  store: Pick<Store, "eventLog">,
  episode: (session: string) => EpisodeFactsReading,
): RetentionSources {
  const handoffSessions = new Set<string>();
  for (const name of [HANDOFF_WRITTEN_EVENT, HANDOFF_CLEARED_EVENT]) {
    try {
      for (const row of store.eventLog({ name, limit: HANDOFF_ROW_CEILING })) {
        try {
          const session = (JSON.parse(row.payload ?? "{}") as { session?: unknown }).session;
          if (typeof session === "string" && session.length > 0) handoffSessions.add(session);
        } catch {
          /* a row that will not parse answers nothing */
        }
      }
    } catch {
      /* an unreadable log is no answers, never a throw */
    }
  }
  return {
    episode: (session) => {
      try {
        return episode(session);
      } catch {
        return { status: "unreadable", asks: 0, chapters: 0 };
      }
    },
    handoffSessions,
  };
}

export type RetentionVerdict = "deleted" | "kept-owed" | "kept-young";

/** One session's standing in one scope. Ids and counts, never text. */
export interface HeldSession {
  readonly scope: string;
  readonly session: string;
  readonly facts: WriteUpFacts;
  readonly owes: boolean;
  /** When its retention clock started: the later of its last activity here and
   *  its write-up mark. */
  readonly clockFrom: number;
  /** Text lines and bytes it holds in the files retention deletes from. */
  readonly lines: number;
  readonly bytes: number;
  readonly verdict: RetentionVerdict;
}

interface Tally {
  lines: number;
  bytes: number;
  captured: number;
  lastCaptureAt: number;
  lastAt: number;
  lastNormalEndAt: number | null;
  writtenUpAt: number | null;
}

/**
 * EVERY SESSION THIS BUFFER HOLDS TEXT FOR, per scope, with its facts and its
 * verdict. Read-only: it plans and deletes nothing. `now` defaults to the
 * buffer's own clock.
 */
export function planRetention(
  buffer: SpanBuffer,
  sources: RetentionSources,
  opts: { scopes?: readonly string[] } = {},
): HeldSession[] {
  const now = buffer.now();
  const scopes = buffer.scopes();
  // A `session_end` answer counts wherever it was recorded: the server files it
  // under the session's own scope, but a session is judged once per scope and
  // its answer is its answer.
  const endAnswered = new Set<string>();
  for (const scope of scopes) {
    for (const p of buffer.proposalRecords<ProposalRecord>(scope)) {
      if (p !== null && typeof p === "object" && p.accepted === true && p.source === "session-end" && typeof p.session === "string") {
        endAnswered.add(p.session);
      }
    }
  }

  const out: HeldSession[] = [];
  for (const scope of opts.scopes ?? scopes) {
    const tallies = new Map<string, Tally>();
    const tally = (session: unknown): Tally | null => {
      if (typeof session !== "string" || session.length === 0) return null;
      let t = tallies.get(session);
      if (t === undefined) {
        t = { lines: 0, bytes: 0, captured: 0, lastCaptureAt: 0, lastAt: 0, lastNormalEndAt: null, writtenUpAt: null };
        tallies.set(session, t);
      }
      return t;
    };
    const text = (span: Span, captured: boolean): void => {
      const t = tally(span.session);
      if (t === null) return;
      const at = typeof span.at === "number" ? span.at : 0;
      t.lines += 1;
      t.bytes += span.text.length;
      if (captured) t.captured += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      t.lastAt = Math.max(t.lastAt, at);
    };
    // Conversation and jots (the sweep's input), the assistant's own turns,
    // quarantine, and anything a claim holds right now: all of it is text this
    // session still has on disk. Only the first, third and fourth are text a
    // write-up could be made FROM.
    for (const s of buffer.spans(scope)) text(s, true);
    for (const s of buffer.assistantSpans(scope)) text(s, false);
    for (const s of buffer.quarantined(scope)) text(s, s.kind !== "assistant");
    for (const s of buffer.claimedSpans(scope)) text(s, s.kind !== "assistant");
    for (const b of buffer.boundaries(scope)) {
      const t = tally(b.session);
      if (t === null) continue;
      const at = typeof b.at === "number" ? b.at : 0;
      t.lastAt = Math.max(t.lastAt, at);
      if (b.kind === "session-end") t.lastNormalEndAt = Math.max(t.lastNormalEndAt ?? 0, at);
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t === null) continue;
      t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }

    for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      // A session that holds no text here has nothing to delete and nothing to
      // write up from; it is not counted at all.
      if (t.lines === 0) continue;
      const episode = sources.episode(session);
      const facts: WriteUpFacts = {
        capturedText: t.captured > 0,
        asked: episode.status === "unreadable" || episode.asks > 0,
        answered:
          (episode.status === "loaded" && episode.chapters > 0) ||
          endAnswered.has(session) ||
          sources.handoffSessions.has(session),
        endedNormally: t.lastNormalEndAt !== null && t.lastNormalEndAt >= t.lastCaptureAt,
        writtenUp: t.writtenUpAt !== null,
      };
      const owes = owesWriteUp(facts);
      const clockFrom = Math.max(t.lastAt, t.writtenUpAt ?? 0);
      const verdict: RetentionVerdict = owes
        ? "kept-owed"
        : now - clockFrom < TUNABLES.RETENTION_MS
          ? "kept-young"
          : "deleted";
      out.push({ scope, session, facts, owes, clockFrom, lines: t.lines, bytes: t.bytes, verdict });
    }
  }
  return out;
}

// ── the run ─────────────────────────────────────────────────────────────────

/** What one run came to. Counts only. */
export interface RetentionReport {
  readonly reason: "PRUNED" | "NOTHING" | "OBSERVER" | "IO_FAILED";
  /** Scopes holding any session text at all. */
  readonly scopes: number;
  /** (scope, session) pairs whose text was deleted this run. */
  readonly deleted: number;
  /** ...kept because they owe a write-up, however old. */
  readonly keptOwed: number;
  /** ...kept because their 7 days have not run yet. */
  readonly keptYoung: number;
  /** ...due for deletion that the strike could not complete (IO, or a stance
   *  that stood it down). They stay, and are due again next run. */
  readonly failed: number;
  /** Text lines the strike took out, across every file. */
  readonly lines: number;
  /** Bytes of text held by the deleted sessions, as planned. */
  readonly bytes: number;
}

/**
 * PLAN, THEN DELETE exactly the sessions the plan calls `deleted` — and only
 * those: the strike is handed session ids from the plan, never a pattern. A
 * session the predicate says owes is not in any request, whatever its age.
 */
export function pruneRetention(buffer: SpanBuffer, sources: RetentionSources): RetentionReport {
  const plan = planRetention(buffer, sources);
  const doomed = new Map<string, string[]>();
  let bytes = 0;
  for (const h of plan) {
    if (h.verdict !== "deleted") continue;
    const list = doomed.get(h.scope) ?? [];
    list.push(h.session);
    doomed.set(h.scope, list);
  }
  let deleted = 0;
  let failed = 0;
  let lines = 0;
  let observed = false;
  let ioFailed = false;
  for (const [scope, sessions] of doomed) {
    const struck = strikeSpans(buffer, { scope, sessions, by: "retention" });
    if (struck.reason === "OBSERVER" || struck.reason === "IO_FAILED") {
      failed += sessions.length;
      if (struck.reason === "OBSERVER") observed = true;
      else ioFailed = true;
      continue;
    }
    deleted += sessions.length;
    lines += struck.struck;
    for (const h of plan) if (h.scope === scope && sessions.includes(h.session)) bytes += h.bytes;
  }
  const report: RetentionReport = {
    reason: observed ? "OBSERVER" : ioFailed ? "IO_FAILED" : deleted > 0 ? "PRUNED" : "NOTHING",
    scopes: new Set(plan.map((h) => h.scope)).size,
    deleted,
    keptOwed: plan.filter((h) => h.verdict === "kept-owed").length,
    keptYoung: plan.filter((h) => h.verdict === "kept-young").length,
    failed,
    lines,
    bytes,
  };
  buffer.emit("remember.retention", undefined, {
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    failed: report.failed,
    lines: report.lines,
  });
  return report;
}

// ── the record, and its readers ─────────────────────────────────────────────

/** The payload of one `remember.prune` row. `date` is the run's calendar date,
 *  the same one the worker stamps its other rows with. */
export function retentionRow(report: RetentionReport, date: string): Record<string, string | number> {
  return {
    date,
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    failed: report.failed,
    lines: report.lines,
    bytes: report.bytes,
    retentionDays: Math.round(TUNABLES.RETENTION_MS / 86_400_000),
  };
}

/** One recorded run, as the log holds it. */
export interface RetentionRun {
  readonly date: string;
  readonly reason: string;
  readonly scopes: number;
  readonly deleted: number;
  readonly keptOwed: number;
  readonly keptYoung: number;
  readonly failed: number;
  readonly lines: number;
  readonly bytes: number;
  readonly at: number;
  readonly day: number;
}

/** How far back a reading looks, in lived days — the event log's own window. */
const RETENTION_LOOKBACK_DAYS = 90;
const RETENTION_ROW_CEILING = 5_000;

/** Every recorded run inside the log's window, NEWEST FIRST. Never throws. */
export function retentionRuns(store: Pick<Store, "eventLog" | "livedDay">): RetentionRun[] {
  let rows;
  try {
    rows = store.eventLog({
      name: RETENTION_EVENT,
      // Bounded by day, not by count: `eventLog` cuts oldest-first.
      sinceDay: Math.max(0, store.livedDay() - RETENTION_LOOKBACK_DAYS),
      limit: RETENTION_ROW_CEILING,
    });
  } catch {
    return [];
  }
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const out: (RetentionRun & { seq: number })[] = [];
  for (const row of rows) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
    } catch {
      continue;
    }
    out.push({
      date: typeof p["date"] === "string" ? p["date"] : "",
      reason: typeof p["reason"] === "string" ? p["reason"] : "",
      scopes: num(p["scopes"]),
      deleted: num(p["deleted"]),
      keptOwed: num(p["keptOwed"]),
      keptYoung: num(p["keptYoung"]),
      failed: num(p["failed"]),
      lines: num(p["lines"]),
      bytes: num(p["bytes"]),
      at: row.at,
      day: row.day,
      seq: row.seq,
    });
  }
  // Newest first, and the log's own order breaks a tie: two runs recorded in
  // one millisecond share an `at`, and "the newest" still has to mean one.
  return out
    .sort((a, b) => (b.at !== a.at ? b.at - a.at : b.seq - a.seq))
    .map(({ seq: _seq, ...run }) => run);
}

/**
 * THE READING DOCTOR SHOWS: the newest run — how many sessions it deleted, how
 * many are waiting on a write-up, how many are simply younger than a week — or
 * null when retention has never run on this store.
 */
export function lastRetentionRun(store: Pick<Store, "eventLog" | "livedDay">): RetentionRun | null {
  return retentionRuns(store)[0] ?? null;
}
