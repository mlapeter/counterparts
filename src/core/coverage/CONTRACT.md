# `coverage/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

## 1. Purpose

Say what is not written up yet, in one place. A captured piece of conversation counts as
written up only when a claim for it stands in `coverage.jsonl`; this module is the one
reader of that file for "what is owed", and the pacer, retention, the next-session
write-up, the handoff pointer, doctor and `counterparts coverage` all read it here.

It does not change how pieces are claimed. `SpanBuffer.claimCoverage` still does all of
it; this module adds two callers with no proposal behind them ("nothing new", a chapter).

## 2. Brain analog

**Rehearsal debt.** What was lived and not yet consolidated is fragile; what nobody
rehearses within a few days of use is lost to the ordinary forgetting. The ledger is that
debt made countable. **Named deviation** (constitution 12): the brain keeps no ledger of
what it has not rehearsed. Here the rehearsal is a written act, and a written act can be
counted, so it is.

## 3. Keeps

- **The claim as the only proof.** [v2, `remember/` §4.1 G4] Claims partition a session:
  each takes what is unclaimed. The ledger reads that and nothing else — not asks, not
  answers, not handoffs.
- **A note claims its own turn; a write-up claims the session** (2026-10-11). A memory
  written in the moment (the note tool, a jot) takes its own span and the unclaimed
  conversation of the turn it was written in — the pieces whose cursor `from` is the
  note's own (the person's prompt that started that turn, captured at the Stop after the
  note) — and nothing said before it. A session-end write-up, the write-up door, "nothing
  new" and a chapter still take everything of the session that is unclaimed. Until
  2026-10-11 a note took the whole backlog too: one short note on 10-10 marked 2.6 hours
  of a session written up, and that stretch was never kept anywhere.
- **Host evidence handed in.** [v2, `remember/owes.ts`] Whether a session ended is the
  host's to say; core knows no host.
- **Content by reference.** [store §5 G10] Rows carry ids, counts and codes; the scope as
  its buffer key, never the path; no text and no hash of text.

## 4. Drops / simplifies

- **The asked / answered rule** (B3, 2026-09-23) and #285's separate short debt: one rule
  now, on pieces and time.
- **The 12-hour silence window** for "is it still running" in the write-up: a session is at
  work while it has captured something today and has not ended.
- **Any backfill.** On a store with old unwritten stretches the ordinary rule applies the
  first time it runs: they lapse, with one row each.

## 5. Contract

**Inputs** — a `SpanBuffer` (read-only for everything but the two claims), the store's
zone, a clock, and optional host evidence (`endedAt` per session).
**Outputs** — the ledger (per session: state, pieces, what is written up, the unwritten
stretch, recorded, owed, lapsed, small, per-date counts); `isDebt`; `askFromStretch`; `claimUnwritten`;
`workSince` (with how far that work is written up, 2026-09-30); `sessionsHere`; `chapterClaims`; three
durable row names written by `recordCoverage`.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] One rule for "owes".** A session owes a write-up when its unwritten stretch is at
   least `OWED_PIECES` pieces spanning `OWED_SPAN_MS` — or, when the session left NO RECORD
   OF ITS OWN, at least `UNRECORDED_OWED_PIECES` pieces whatever their span (S2,
   2026-10-26) — it is not active (it ended, or it has captured nothing since the calendar
   date changed in the store's zone), and the stretch has not lapsed. A record is a claim
   that is not an in-the-moment note's (a handback's memories, "nothing new", a chapter, a
   write-up's memories or the door's own claim: any claim none of whose marks is `own`),
   or a write-up mark. So the floor keeps its job for a closing tail AFTER a record, and a
   short check-in that only ever noted things in the moment still owes what it did not
   note. `remember/owes.ts#planRetention` reads it; nothing else decides it.
2. **[M] The pacer's third arm is pieces AND time**: `ASK_PIECES` unwritten pieces
   captured since the last ask (all of them, before a first ask) and `ASK_AFTER_MS` since
   the later of the stretch's first piece and the last ask. One piece, however large, is
   never an ask on its own, and an unanswered ask is not repeated without new pieces. The
   12-a-day cap is the pacer's and stands.
3. **[M] Lapse deletes nothing.** An owed stretch lapses at the first turn-end of the
   `LAPSE_DAYS_OF_USE`th day of use (a date with a `stop` boundary) after the date of its
   latest piece; the session stops owing and its text goes on retention's ordinary week.
4. **[M] One row per stretch per state** — `coverage.owed` and `coverage.lapsed` under a
   dedup key, `coverage.written` (with its writer: the session, nothing-new, a chapter,
   the next session) one per claim and without one, so the log's prune applies. The first
   pass on a store writes no written-up rows for claims made before it.
5. **[M] Dates are the pieces' own**, read in the store's zone — never the lived day on a
   piece, which lags on a date's first turn-end.
6. **[M] Read-only but for two claims**: "nothing new" and a chapter, each under
   `<by>:<id>:<time>` in the same `coverage.jsonl`, refused under observer by the buffer's
   seam — and each in ONE scope, the project it was given in, as a memory's claim is: a
   "nothing new" in project A never writes up what the same session said in B.
7. **[M] What a claim takes** (2026-10-11): each claim takes only what is unclaimed in
   its session and scope. A note's (`remember/proposals.ts`, source `jot`) is its own
   span plus the conversation pieces whose `from` equals that span's `from`, the
   turn it was written in; the Stop capture that lands that turn adds it to the note's
   claim (`SpanBuffer.capture` → `claimNotedTurn`), under the same proposal id, the
   first accepted note of the turn when there are two. A refused note, or one with no
   own span, claims nothing; nor does a note whose capture holds something the person
   typed after a reply (its turn ended with no Stop — an interrupt — or a message was
   queued mid-turn): that span is more than its turn, and stays for the write-up. A session-end write-up, the write-up door, "nothing new"
   and a chapter take everything unclaimed of the session. No new row field: the turn's
   marks are ordinary marks.
8. **[A] "Written up" / "not yet written up"** in anything a person reads; never "covered".

## 6. Tunables

`tunables.ts`, every one a working default: `ASK_PIECES` 3, `ASK_AFTER_MS` 30 min,
`OWED_PIECES` 3, `OWED_SPAN_MS` 15 min, `UNRECORDED_OWED_PIECES` 1 (S2, 2026-10-26),
`LAPSE_DAYS_OF_USE` 14 (3 until 2026-10-10), `SMALL_STRETCH_PIECES` 6.
