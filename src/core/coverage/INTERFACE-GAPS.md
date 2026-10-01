# `coverage/` — INTERFACE-GAPS

What this module still owes, or leans on that is not what it looks like.

## 1. Three evidence lifetimes

The ledger joins facts that expire on different clocks: the host's registry forgets a
record 7 days after its last write (`adapters/sessions.ts#pruneSessions`); event rows are
kept about 90 lived days (dedup-keyed ones for good); captured text goes 7 days after a
session owes nothing (`remember/retention.ts`). A session whose registry record is gone
reads its end from `boundaries.jsonl` alone, and a `claude -p` / SDK session whose record
is gone can no longer be told from a person's for the small-stretch pointer.

## 2. A write-up's memories carry the writer's session — CLOSED 2026-10-01

Since wake build 3 the memory's `origin_session` is the ENDED session's and its meta says
`secondHand` / `writtenUpBy`; the proposal record still carries the writer, which is what
the ledger classifies the claim from (`next-session`).

## 3. Throughput: debts in projects not reopened lapse

Two writers now (2026-10-01): the next session in the same project (at most
`WRITE_UP_ASKS_PER_DAY` pointers a day store-wide, one part each), and the nightly run's
catch-up, in any project, up to `NIGHT_WRITE_UP_SESSIONS` / `NIGHT_WRITE_UP_BYTES` a
night, claim-first between them. The catch-up rides the nightly run, so it runs only on a
day whose first prompt starts one (`auto`, with a dream due): on `ask`, or a day with no
dream offered, owed stretches still wait for a session in their directory. What the night
leaves is on its `adapter.night.writeup` row.

## 4. The crash sweep is unreachable

`remember/fallback.ts` is still the worker's step 1, and keyless it only writes its gate
row (`not-opted-in`). Nothing in this module reaches it, and nothing claims what it would
have.

## 5. A piece in a claim file can only be closed by the write-up mark

The ledger counts what a claim file holds in flight (NOTES §4), but
`SpanBuffer.claimCoverage` marks only the live buffer's pieces: a memory, "nothing new" or
a chapter cannot claim a piece while it sits in a claim file. The door's write-up mark
(`writtenUpAt`) does close it. Keyless, claim files are only a crashed run's orphans, which
the next claim merges back.

## 6. "Nothing new" before 2026-09-30

Before this build a `memories: []` answer marked the registry (`nothingNewAt`) and claimed
nothing. Those sessions' stretches read unwritten now, and lapse with their days of use.
The registry mark is still written; nothing decides on it any more.
