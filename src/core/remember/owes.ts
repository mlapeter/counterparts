/**
 * WHAT A SESSION OWES — the read-only half of raw-transcript retention.
 *
 * Owner's ruling 2026-09-23 (roadmap B3): **a session's captured text is
 * deleted 7 days after it ended, when nothing is owed; a session that owes a
 * write-up waits until it is written up.** This file decides; it never deletes.
 * The deleting half is `retention.ts`, which only the background worker may
 * import and which `index.ts` does NOT re-export (PR #189 review, B1): holding
 * a `Counterpart` — and so its public `SpanBuffer` — reaches the plan and never
 * the strike.
 *
 * ── THE PREDICATE, DEFINED ONCE ───────────────────────────────────────────
 *
 * `owesWriteUp` is the one definition of "this session ended and was never
 * written up". Retention reads it, doctor reads the counts it produces, and the
 * next-session write-up (roadmap C2) is meant to read it too — so "what may be
 * deleted" and "what the next session is asked to write" are one set. It
 * decides on FACTS, never on text:
 *
 *   owes = capturedText ∧ ¬writtenUp ∧ asked ∧ (¬answered ∨ ¬endedNormally)
 *
 *   - `capturedText` — conversation or jot text is still held for it somewhere
 *     in the store (buffer, jots, quarantine, a claim in flight). The
 *     assistant's own turns do not count: nothing writes a session up from them.
 *   - `asked` — the pacer found substance. TRUE when an ask was committed (the
 *     pacer's state, or the host's own ask rows), when the pacer's state will
 *     not read, and — PR #189 review m1 — when no ask was committed but the
 *     session's substance reached the first-ask threshold anyway: a stood-down,
 *     failed or never-reached ask is not evidence the session was short. Only a
 *     session the pacer SAW, in full, and found short — or whose captured text
 *     is under the threshold by any count — is "never asked".
 *   - `answered` — an answer LATER THAN THE LAST ASK (review M1, the rule #186
 *     writes for its own mark): a chapter that caught up with the ask count
 *     (`appendedAtAsk >= asks`), or an accepted `session_end` memory, a handoff
 *     written or cleared, or a "nothing new" mark (#186) at or after the last
 *     committed ask. One early answer does not cover the asks that followed it.
 *     With no ask committed at all, any answer counts. With an ask committed at
 *     an unknown time, only the chapter rule can prove an answer.
 *   - `endedNormally` — a normal end at or after the session's last capture, in
 *     ANY scope of the store or in the host's registry (review m2): an end
 *     recorded in one directory settles the text the session left in another.
 *   - `writtenUp` — marked written up (`SpanBuffer#recordWriteUp`, C2's door)
 *     at or after its last capture.
 *
 * ── AND ONE THING THAT IS NOT A DEBT BUT STILL KEEPS ──────────────────────
 *
 * A session the host's registry still holds OPEN — a record with no end — is
 * not deleted while the registry holds it (review m10): an idle-but-alive
 * session is not an ended one. That lasts only as long as the record does, and
 * the registry forgets a record 7 days after its last write
 * (`adapters/sessions.ts#pruneSessions`) — the same week as the retention clock
 * (re-review R8). What actually protects a session active in the last week is
 * the capture clock, which reads the buffer and nothing the registry keeps.
 *
 * ── THE CLOCK ─────────────────────────────────────────────────────────────
 *
 * Seven days (`TUNABLES.RETENTION_MS`) from the LATEST thing known about the
 * session anywhere in the store: its last capture or boundary in any scope, its
 * write-up mark, its registry end. It is the buffer's own clock.
 *
 * Every failure to read a fact moves toward KEEPING: an unreadable pacer state
 * counts as asked, an unreadable log as no answers, a missing ask time as "no
 * time-based answer can be proved".
 */
import { Buffer } from "node:buffer";

import { HANDOFF_CLEARED_EVENT, HANDOFF_WRITTEN_EVENT } from "../handoff/index.js";
import type { Store } from "../store/index.js";

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

// ── the facts' sources ──────────────────────────────────────────────────────

/** The pacer's record of one session (`self/episodes.ts#episodeFacts`). */
export interface EpisodeFactsReading {
  readonly status: "loaded" | "absent" | "unreadable";
  readonly asks: number;
  readonly chapters: number;
  readonly appendedAtAsk: number;
  readonly lastAskAt: number | null;
}

/** What the HOST knows about one session. Every field is optional evidence;
 *  `NO_HOST_EVIDENCE` is what a host that knows nothing says. */
export interface HostSessionEvidence {
  /**
   * The host's registry holds a record for this session with no end. Kept while
   * it does — and ONLY while it does: the registry drops a record 7 days after
   * its last write (`adapters/sessions.ts#pruneSessions`), the same week as the
   * retention clock, so this is an extra guard, not the one that protects a
   * recently active session. That one is the capture clock (`kept-young`).
   */
  readonly open: boolean;
  /** The registry's end, epoch ms. */
  readonly endedAt: number | null;
  /** A "nothing new" answer (#186), epoch ms. */
  readonly nothingNewAt: number | null;
  /** The newest ask the host recorded as ISSUED, epoch ms. */
  readonly lastAskedAt: number | null;
  /** The host's newest pacer evaluation — when, and the substance it measured. */
  readonly lastEvaluation: { readonly at: number; readonly turns: number; readonly bytes: number } | null;
}

export const NO_HOST_EVIDENCE: HostSessionEvidence = {
  open: false,
  endedAt: null,
  nothingNewAt: null,
  lastAskedAt: null,
  lastEvaluation: null,
};

/** The pacer's first-ask thresholds (`self/tunables.ts`), passed in so this
 *  module never re-derives them: typed turns OR conversation text bytes. */
export interface FirstAskThreshold {
  readonly turns: number;
  readonly textBytes: number;
}

/**
 * Everything retention reads from outside the buffer. Injected, because the
 * pacer is `self/`'s, the registry and the ask rows are the host's, and
 * `remember/` reads their facts and never their code.
 */
export interface RetentionSources {
  episode(session: string): EpisodeFactsReading;
  /** When this session wrote or cleared a handoff — each an answer. */
  handoffAnswers(session: string): readonly number[];
  host(session: string): HostSessionEvidence;
  readonly firstAsk: FirstAskThreshold;
}

/** Ceiling on the handoff rows read — the log keeps ~90 lived days of them. */
const HANDOFF_ROW_CEILING = 50_000;

const UNREADABLE_EPISODE: EpisodeFactsReading = {
  status: "unreadable",
  asks: 0,
  chapters: 0,
  appendedAtAsk: 0,
  lastAskAt: null,
};

/**
 * The store-backed sources. The handoff rows are read here; the pacer and the
 * host are the caller's. Never throws: every read that fails reads as the fact
 * that keeps text.
 */
export function retentionSources(
  store: Pick<Store, "eventLog">,
  opts: {
    episode: (session: string) => EpisodeFactsReading;
    host?: (session: string) => HostSessionEvidence;
    firstAsk: FirstAskThreshold;
  },
): RetentionSources {
  const handoffs = new Map<string, number[]>();
  for (const name of [HANDOFF_WRITTEN_EVENT, HANDOFF_CLEARED_EVENT]) {
    try {
      for (const row of store.eventLog({ name, limit: HANDOFF_ROW_CEILING })) {
        try {
          const session = (JSON.parse(row.payload ?? "{}") as { session?: unknown }).session;
          if (typeof session !== "string" || session.length === 0) continue;
          const list = handoffs.get(session) ?? [];
          list.push(row.at);
          handoffs.set(session, list);
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
        return opts.episode(session);
      } catch {
        return UNREADABLE_EPISODE;
      }
    },
    handoffAnswers: (session) => handoffs.get(session) ?? [],
    host: (session) => {
      try {
        return opts.host?.(session) ?? NO_HOST_EVIDENCE;
      } catch {
        // A host that cannot answer may be holding the session open: keep it.
        return { ...NO_HOST_EVIDENCE, open: true };
      }
    },
    firstAsk: opts.firstAsk,
  };
}

// ── the plan ────────────────────────────────────────────────────────────────

export type RetentionVerdict = "deleted" | "kept-owed" | "kept-young" | "kept-live";

/** One session's standing across the whole store. Ids and counts, never text. */
export interface HeldSession {
  readonly session: string;
  /** Every scope that holds text for it — the strike runs once per scope. */
  readonly scopes: readonly string[];
  readonly facts: WriteUpFacts;
  readonly owes: boolean;
  /** The host's registry holds it open. */
  readonly open: boolean;
  /** When its retention clock started. */
  readonly clockFrom: number;
  /** Text lines and bytes it holds in the files retention deletes from. */
  readonly lines: number;
  readonly bytes: number;
  readonly verdict: RetentionVerdict;
}

interface Tally {
  scopes: Set<string>;
  lines: number;
  bytes: number;
  captured: number;
  lastCaptureAt: number;
  lastActivityAt: number;
  lastNormalEndAt: number | null;
  writtenUpAt: number | null;
  /** The furthest cursor any of its spans reached — an UPPER bound on turns. */
  maxTo: number;
  /** Conversation, jot and assistant text — an upper bound on its bytes. */
  textBytes: number;
}

const numberOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * EVERY SESSION THIS STORE HOLDS TEXT FOR, judged once across every scope,
 * with its facts and its verdict. Read-only: it plans and deletes nothing.
 */
export function planRetention(buffer: SpanBuffer, sources: RetentionSources): HeldSession[] {
  const now = buffer.now();
  const tallies = new Map<string, Tally>();
  const answersBySession = new Map<string, number[]>();
  const tally = (session: unknown): Tally | null => {
    if (typeof session !== "string" || session.length === 0) return null;
    let t = tallies.get(session);
    if (t === undefined) {
      t = {
        scopes: new Set(),
        lines: 0,
        bytes: 0,
        captured: 0,
        lastCaptureAt: 0,
        lastActivityAt: 0,
        lastNormalEndAt: null,
        writtenUpAt: null,
        maxTo: 0,
        textBytes: 0,
      };
      tallies.set(session, t);
    }
    return t;
  };

  for (const scope of buffer.scopes()) {
    const text = (span: Span, captured: boolean): void => {
      const t = tally(span.session);
      if (t === null) return;
      const at = numberOr(span.at, 0);
      // UTF-8 BYTES, the pacer's own unit (`hooks.ts#substanceOf`) — never UTF-16
      // code units, which under-count every non-Latin script by up to three
      // times and would read a substantive session as short (re-review R5).
      const size = Buffer.byteLength(span.text, "utf8");
      t.scopes.add(scope);
      t.lines += 1;
      t.bytes += size;
      t.textBytes += size;
      t.maxTo = Math.max(t.maxTo, numberOr(span.to, 0));
      if (captured) t.captured += 1;
      t.lastCaptureAt = Math.max(t.lastCaptureAt, at);
      t.lastActivityAt = Math.max(t.lastActivityAt, at);
    };
    // Conversation and jots (the sweep's input), the assistant's own turns,
    // quarantine, and anything a claim holds right now: all of it is text this
    // session still has on disk. Only the non-assistant kinds are text a
    // write-up could be made FROM.
    for (const s of buffer.spans(scope)) text(s, true);
    for (const s of buffer.assistantSpans(scope)) text(s, false);
    for (const s of buffer.quarantined(scope)) text(s, s.kind !== "assistant");
    for (const s of buffer.claimedSpans(scope)) text(s, s.kind !== "assistant");
    for (const b of buffer.boundaries(scope)) {
      const t = tally(b.session);
      if (t === null) continue;
      const at = numberOr(b.at, 0);
      t.lastActivityAt = Math.max(t.lastActivityAt, at);
      if (b.kind === "session-end") t.lastNormalEndAt = Math.max(t.lastNormalEndAt ?? 0, at);
    }
    for (const w of buffer.writeUps(scope)) {
      const t = tally(w.session);
      if (t === null) continue;
      t.writtenUpAt = Math.max(t.writtenUpAt ?? 0, w.at);
    }
    // An accepted `session_end` memory is an answer WHEREVER it was recorded,
    // and when it was recorded is what decides whether it answered the last ask.
    for (const p of buffer.proposalRecords<ProposalRecord>(scope)) {
      if (p === null || typeof p !== "object" || p.accepted !== true || p.source !== "session-end") continue;
      if (typeof p.session !== "string") continue;
      const list = answersBySession.get(p.session) ?? [];
      list.push(numberOr(p.at, 0));
      answersBySession.set(p.session, list);
    }
  }

  const out: HeldSession[] = [];
  const first = sources.firstAsk;
  // The pacer's own rule (`self/episodes.ts#askDue`), whichever comes first.
  const paced = (turns: number, bytes: number): boolean => turns >= first.turns || bytes >= first.textBytes;

  for (const [session, t] of [...tallies.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    // A session that holds no text anywhere has nothing to delete and nothing
    // to write up from; it is not counted at all.
    if (t.lines === 0) continue;
    const episode = sources.episode(session);
    const host = sources.host(session);

    // ASKED — see the header. Committed, unreadable, or substantive by any count.
    const committed = episode.status === "unreadable" || episode.asks > 0 || host.lastAskedAt !== null;
    let asked = committed;
    if (!asked) {
      const ev = host.lastEvaluation;
      asked =
        ev !== null && ev.at >= t.lastCaptureAt
          ? paced(ev.turns, ev.bytes) // the pacer saw everything captured: its word
          : paced(t.maxTo, t.textBytes); // it did not: an upper-bound count decides
    }

    // ANSWERED — later than the last ask (review M1).
    const lastAskAt = maxOf(episode.lastAskAt, host.lastAskedAt);
    const chapterAnswer =
      episode.status === "loaded" && episode.chapters > 0 && episode.appendedAtAsk >= episode.asks;
    const times = [
      ...(answersBySession.get(session) ?? []),
      ...sources.handoffAnswers(session),
      ...(host.nothingNewAt === null ? [] : [host.nothingNewAt]),
    ];
    const answered = !committed
      ? chapterAnswer || times.length > 0
      : lastAskAt === null
        ? chapterAnswer
        : chapterAnswer || times.some((at) => at >= lastAskAt);

    const lastNormalEnd = maxOf(t.lastNormalEndAt, host.endedAt);
    const facts: WriteUpFacts = {
      capturedText: t.captured > 0,
      asked,
      answered,
      endedNormally: lastNormalEnd !== null && lastNormalEnd >= t.lastCaptureAt,
      writtenUp: t.writtenUpAt !== null && t.writtenUpAt >= t.lastCaptureAt,
    };
    const owes = owesWriteUp(facts);
    const clockFrom = Math.max(t.lastActivityAt, t.writtenUpAt ?? 0, host.endedAt ?? 0);
    const verdict: RetentionVerdict = host.open
      ? "kept-live"
      : owes
        ? "kept-owed"
        : now - clockFrom < TUNABLES.RETENTION_MS
          ? "kept-young"
          : "deleted";
    out.push({
      session,
      scopes: [...t.scopes].sort(),
      facts,
      owes,
      open: host.open,
      clockFrom,
      lines: t.lines,
      bytes: t.bytes,
      verdict,
    });
  }
  return out;
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// ── the report, the record, and its readers ─────────────────────────────────

/** What one run came to. Counts only. */
export interface RetentionReport {
  /** `STARTED` is the row a run writes the moment it holds the date's latch,
   *  before it plans; `LATCH_HELD` is the row a later run writes when it finds
   *  the latch held and no row at all for the date (re-review R7). Either one as
   *  the NEWEST row for a date means that run did not finish. */
  readonly reason: "PRUNED" | "NOTHING" | "ALREADY_RAN" | "OBSERVER" | "IO_FAILED" | "STARTED" | "LATCH_HELD";
  /** Scopes holding any session text at all. */
  readonly scopes: number;
  /** Sessions whose text was deleted this run. */
  readonly deleted: number;
  /** ...kept because they owe a write-up, however old. */
  readonly keptOwed: number;
  /** ...kept because their 7 days have not run yet. */
  readonly keptYoung: number;
  /** ...kept because the host's registry holds them open. */
  readonly keptLive: number;
  /** ...due for deletion that the strike could not complete. They stay, and
   *  are due again next run. */
  readonly failed: number;
  /** Text lines the strike took out, across every file. */
  readonly lines: number;
  /** Bytes of text held by the deleted sessions, as planned. */
  readonly bytes: number;
}

/** The payload of one `remember.prune` row. */
export function retentionRow(report: RetentionReport, date: string): Record<string, string | number> {
  return {
    date,
    reason: report.reason,
    scopes: report.scopes,
    deleted: report.deleted,
    keptOwed: report.keptOwed,
    keptYoung: report.keptYoung,
    keptLive: report.keptLive,
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
  readonly keptLive: number;
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
      scopes: numberOr(p["scopes"], 0),
      deleted: numberOr(p["deleted"], 0),
      keptOwed: numberOr(p["keptOwed"], 0),
      keptYoung: numberOr(p["keptYoung"], 0),
      keptLive: numberOr(p["keptLive"], 0),
      failed: numberOr(p["failed"], 0),
      lines: numberOr(p["lines"], 0),
      bytes: numberOr(p["bytes"], 0),
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
 * many are waiting on a write-up, how many are younger than a week, how many
 * the host still holds open — or null when retention has never run here.
 */
export function lastRetentionRun(store: Pick<Store, "eventLog" | "livedDay">): RetentionRun | null {
  return retentionRuns(store)[0] ?? null;
}
