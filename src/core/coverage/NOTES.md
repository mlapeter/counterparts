# `coverage/` — NOTES

What the build (2026-09-30, `coverage/0930`) decided where the brief left room. Each is a
working default.

## 0. The pacer's arm needs new pieces

After an ask, the arm fires again only when `ASK_PIECES` pieces have been captured since
it, as well as the half hour: an ask nobody answers is not repeated on the clock alone
(review of #289 — before, an unanswered ask came back every 30 minutes, 12 by hour six).

## 1. Where "owed" and "lapsed" are evaluated

Two places, one rule. The rule is pure over the buffer (`ledger`), so whoever reads it
gets the same answer: retention's plan, the SessionStart pointer, the door, doctor and the
console each compute it when they need it. The ROWS are written in one place: the
turn-end worker (`claude-code/bin/runner.ts`, step 3a), after the sleep cycle and before
retention, at every turn-end — keyless, like every step but the sweep. Before retention so
a lapse is recorded while its pieces are still there to count. Nothing reads the rows to
decide; they are the record.

## 2. The lag, and which way it went

The lived day on a piece lags on a date's first turn-end (the capture runs before the
worker advances the clock). The lapse therefore does not read the lived day at all: days of
use are the distinct dates, in the store's zone, on which a turn-end was recorded
(`stop` boundaries in `boundaries.jsonl`, every scope — a session's end or a compaction is
not a turn-end; review of #289). That is what the lived clock counts — `advanceClock`
moves once per new date with a worker run, and a worker runs at every turn-end — without
its lag. A stretch whose latest piece is on date D lapses when three later dates of use
exist, which is the first turn-end of the third one. Retention never strikes boundaries,
so the count does not shrink. Zone moves and the clock's "one day back holds" rule can make
the two counts differ by a day; not measured.

## 3. The stretch is the session's, across scopes

The ledger is per session, from each piece's own `session`, not the scope-wide
`CoverageReport`. A session with words in two projects has one stretch over both (the
floor is on the session); the pacer reads its own project's only. A claim is per scope —
a memory's, the door's, and since the review of #289 "nothing new" and a chapter's too,
each in the project it was given in — so after one project's share is written up, the
other's is owed on its own if it is still past the floor. A share under the floor is owed
by nobody and goes on its week.

## 4. What counts as a piece

`buffer.jsonl` and `jots.jsonl`, as `CoverageReport` counts them, plus what a claim holds
in flight (a claim file is the buffer renamed aside; nothing in flight may make a session
look written up — retention's old promise). Not quarantine: that is the sweep's terminal
give-up. The assistant's own turns are not pieces; they do count as "captured" for the
active / quiet state.

## 5. Small

An owed stretch under `SMALL_STRETCH_PIECES` (6, the first-ask turn count) is small: the
pointer keeps #285's "one line is enough" sentence, it is offered only after every full
debt has had today's pointer, and only for a session the registry knows and a person
drove. Unlike #285's short debt it is a retention debt like any other, until written up
or lapsed. Doctor counts only what the pointer can offer (`sessions.ts#pointable`); a small
debt from `claude -p` or the SDK is named apart, as left to lapse.

## 6. Written-up rows

Read off `coverage.jsonl` by claim (`proposalId` and session): one row per claim. The
writer is the claim's prefix — `nothing-new:<session>:<time>`, `chapter:<episode>#<n>:<time>`,
`writeup:` (the door's own claim) — or, for a `prp_` proposal, the session itself unless
the proposal's session is another one (the door's last part deposits under the writer and
covers the ended session). The time and the chapter number are in the claim so that every
answer is its own claim and its own row (review of #289: with `chapter:<episode>` only the
first chapter per session per scope ever got one). A watermark in meta
(`coverage.written.through`) starts at the first pass, so an old store gets no backfill;
each pass re-reads from ten minutes before the watermark (moved only once it has fallen
that far behind, so a quiet turn-end writes nothing). Written-up rows carry NO dedup key,
so the log's ordinary 90-lived-day prune lets them go; a repeat in the re-read window is
found by rebuilding each recent row's key (scope, session, claim) from the row itself.
Owed and lapsed rows keep theirs: one per stretch, bounded by the stretches.

**The owed key shifts with its stretch** (named, accepted — review of #289, C8). It is
`session:firstAt`. When a per-scope claim writes up part of a stretch that spans two
projects, the first unclaimed piece moves and the rest gets a second owed row. Keying on
the first piece's hash would stop that, but a hash of said words does not belong in the
log (store §5 G10); a second row for a real remainder is the smaller cost.

## 7. The handoff pointer

`handoff/` stays a module that depends on `store/` alone: the words "how current" are
computed by the composition root at delivery (`Counterpart#handoffSince`, from the newest
`handoff.written` row's time and `workSince`) and passed in. After the review of #289:
the writing session's own pieces up to its next boundary after the write are not "work
since" (a handoff is written mid-turn, and that turn's Stop captures the prompt that asked
for it); work is named only past the owed floor; and it is named by its times —
"work here 13:02–15:41 since" — not by a length. The reserve is sized to the widest of
those words, so the share rule turns the reserve on from about 3,000 bytes of ceiling
instead of 2,400.

**How far, not whether (2026-09-30, the continuity test).** `workSince` also returns the
latest written-up piece's time (`writtenUpTo`, a piece time like the range around it),
what claimed it (`writtenUpBy`: memories, a chapter, "nothing new", a later session's
write-up told apart by the proposal's own session), and how many unwritten pieces came
after it. The pointer says "written up to 17:48 (chapter), 3 pieces after" where it said
"not yet written up" for a session that had written a chapter and then said three more
things. Beside it: `sessionsHere`, the sessions whose `stop` turn-ends and pieces are
filed in a scope (first and last, and whether a `session-end` closed it), and
`chapterClaims`, the episodes a scope's chapter claims name — how the wake's "Last here"
line finds the chapters written in a directory (`handoff/NOTES.md` §9).

## 8. Doctor

The `Write-ups` line replaces #192's `Crash write-up` and keeps its key (`crash-write-up`)
so the console's layout and its headline order are untouched. The 3-day wait is gone:
amber when a stretch from yesterday or earlier is owed.

## 9. Lapse after fourteen days of use, not three (2026-10-10, Group 1c)

Review 01 C4 measured 18 owed stretches (153 pieces, several from 2–4-hour sessions) that
lapsed unwritten on the 10-10 snapshot: the nightly write-up takes four sessions a night,
oldest first, and the next session's pointer only its own directory, and neither reached
them in two days of use. An owed stretch now stays owed for `LAPSE_DAYS_OF_USE` = 14 days
of use; retention keeps its text that long (it never strikes an owed session), and the
night carries what it could not take with a count (`planCatchUp`'s `bounded`). Past the
bound it is let go and said as a loss — the row keeps its name, `coverage.lapsed`, so old
and new rows count together, and its words (the dashboard, `counterparts coverage`,
doctor's "lost unwritten this week") say lost. Decided by g1c-builder, 2026-10-10, lightly
held; revisit after ~5 lived days. Why: 01 says lapse only when the text must go, and
nothing else bounds how long an owed session's text is held; fourteen is twice the
ordinary week.
