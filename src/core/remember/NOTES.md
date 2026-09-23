# `remember/` — implementation notes

*What the CONTRACT left open, and the simplest reading this implementation took
(CLAUDE.md: ambiguities get the simplest reading, recorded here). The CONTRACT is
the spec and is never edited from this file. Everything below is a working default,
revisable without ceremony.*

## 1. The buffer is a top-level `spans/` directory

Captured spans are lived experience that has not been encoded yet: not
reconstructible from anything (so not `cache/`, box 3), and losing them loses the
day (so not `tmp/`, which is `backup: false` and documented as inert leavings).
That leaves a new top-level directory, `<dataDir>/spans/`, and one cross-module
consequence: `store/paths.ts` `LAYOUT` does not classify it yet, so `Store.open()`
on a dir that already has spans throws `LAYOUT_UNCLASSIFIED`. The exact entry the
coordinator must add is in INTERFACE-GAPS.md #1. **This module writes nothing
outside `spans/`.**

## 2. Scope and session keys are hashes, with a legend

A scope is a project path (`/Users/x/proj`). Pasted into `join()` it either explodes
into nested directories or escapes the data dir entirely, so the on-disk key is
`hashText(scope).slice(0, 12)` and `spans/scopes.json` is the key → scope legend
that makes `sweepAll()` able to enumerate. Cursor files are keyed the same way, as
`cursors/<scopeKey>.<sessionKey>.json` — scoped since 2026-08-26, when the PR-1
review proved a session id under two scopes starved the second one's capture (a
session-only cursor let scope B read scope A's advance as NOTHING_NEW; 11 real
v1 session ids do span scopes). A pre-change `cursors/<sessionKey>.json` file is
orphaned, not migrated: the next capture re-reads from turn 0, which the hash
layer bounds to the spec'd G9-case-3 duplicate — harmless for greenfield v2.
Cost: an owner reading the directory needs the legend. Alternative rejected:
`encodeURIComponent`, which is reversible but produces 200-character directory
names on real paths.

## 3. One span per boundary, per stream

`capture()` joins the turns since the cursor into ONE span (behavioral-spec §2's
output shape), and the assistant's turns into a second span in a separate stream —
`assistant.jsonl` is never claimed and never swept; it exists as the substrate for
"was a surfaced memory actually used?" (contract §5 Outputs).

Consequence, and it is the specced one: a *growing* re-read of the same turns
produces a different hash, so hash dedup misses it and the CURSOR is what prevents
the duplicate. Where the cursor is also unavailable (a different session id reading
an overlapping transcript slice), the duplicate lands. That is contract guarantee 9
answered honestly rather than assumed away: **bounded duplication is acceptable,
loss is not**, and `remember.test.ts` asserts all three cases including the one that
duplicates. The upgrade if replay ever prices it too high — hash per TURN and trim
the overlap before joining — is available and deliberately not built (Amendment 15).

## 4. Jots live in the buffer (CONTRACT open question 3)

Answered the uniform way: a jot is a `Span` with `kind: "jot"` in `jots.jsonl`,
claimed and swept with everything else. The alternative (already-formed proposals in
the operational DB) is simpler in isolation but would give jots their own ordering,
dedup and claim semantics — a second lifecycle to keep honest. Jots do not move the
turn cursor: they are not transcript positions.

## 5. Boundary kinds: all three end a session

`stop`, `session-end` and `pre-compaction` all route through `boundary()`, all three
raise the ask (G11's mechanized half), and all three make a session eligible for the
fallback. This follows the contract's own sentence — "every session-ending path is a
boundary" — literally. If a host's `stop` turns out to fire per assistant response
rather than per session, the eligibility predicate is the line to revisit, not the
ask.

## 6. What "a truncated response" means when nothing reports a stop reason

`InterpretResult.stopReason` is optional because the injected function may not know
one. Present-and-not-in-`OK_STOP_REASONS` is a chunk FAILURE (scar E2); absent is
allowed through. Whoever injects a real model call is expected to set it — the
alternative, refusing every result with no stop reason, would make the seam
un-injectable from a plain function and would fail closed on a fallback path whose
whole job is not losing the day.

## 7. Rejection ordering in `submitProposal`

Observer → malformed (degrade to span) → content-duplicate → gate → coverage. Two
consequences worth naming: a *duplicate* is checked before the gate, so an identical
re-deposit costs no gate work and claims nothing new; and a gate FAILURE (the
injected function threw) is treated as a refusal, not as a pass — fail toward not
authoring, the same direction observer mode fails.

## 8. Coverage is claimed sequentially, with no N

§4.1 G4 says the engine claims "the most recent N uncovered spans". This
implementation claims *all* currently-uncovered spans of the proposal's session,
which partitions a session across successive proposals exactly as the guarantee
requires and needs no N to tune. Reopen if a real session shows one proposal
swallowing material a later one should have owned.

## 9. Deliberately NOT built here

- **Pacing counters / the episode ritual.** v1 paced a ritual off capture; no [M]
  guarantee in this contract mentions pacing, and Amendment 15 says machinery is
  earned. The one pacing-adjacent property that IS specced — injected context is
  kept in capture — is implemented (`enters()`).
- **Detached execution and the watchdog.** Detachment is the adapter's; this module
  exports `TUNABLES.STALE_CLAIM_MS` and `validateWatchdog()` so the adapter can
  prove its timeout fires inside the staleness window (scars E4/E5).
- **Streaming and retries.** Owned by whoever injects `InterpretFn` (scar E3).
- **The salience clamp.** `physics.clampSalienceAtSeam()` governs every memory; a
  proposal carries `claimed` and nothing here re-judges it.

## 10. Every declarable field has an admission test and a negative example (§2.16)

v1's `thread.open` shipped with no criteria and produced 33 opens and 0 closes in 13
days. Here, each field a draft may declare is validated in `intake()` with its own
named reason (`CLAIMED_OUT_OF_RANGE`, `KIND_UNKNOWN`, `ALIASES_NOT_STRINGS`, …) and
`test/remember.test.ts` pins a negative example for each one in a single table. A
new declarable field is not done until it has both.

The one field that is *not* an admission test but a resolution rule — `updates:` —
gets the whole of `updates.ts` and its own describe block, because a declared
address is the field most likely to be confabulated.

## 11. What is NOT verified live yet

The suite exercises real files in real temp directories, and the kill-mid-arc test
is a real second process that dies holding a claim. What has NOT run is the whole
arc against a host: an adapter injecting a real gate and a real interpret function,
detached, under a watchdog. Per CLAUDE.md's definition of done, this module is
**merged, not verified** until that happens — and INTERFACE-GAPS.md #1 (`LAYOUT`)
is a hard blocker for it, because a `Store` opened beside a populated buffer throws
today.

## 12. Consuming a claim deletes the claim file

Spans are the tape, not the memory: once results are applied and persisted, the
claim file is removed and its hashes go to the bounded `consumed.jsonl` ledger
FIRST, so a crash between the two leaves spans that dedup away rather than
duplicate. This is not a canonical-prose deletion — nothing in this module can
touch box 1, and the constitution's "nothing bulk-wipes silently" is honored by the
event (`remember.claim.consumed`, with counts).

## 13. The retry bound: three failing lived days, then quarantine

The 2026-08-26 replay's P0 fix (a restored span's hash must stay OUT of
`consumed.jsonl`) traded silent loss for **indefinite retry**: a permanently-failing
span was restored and re-swept at every boundary forever, one model call each time,
on the owner's account. The review accepted the trade direction and queued the
bound; this is it, and it is parallel-run precondition §5.4.

- **The bound**: `TUNABLES.MAX_SPAN_FAILURES = 3` — three DISTINCT LIVED DAYS, not
  three attempts (PR-8 review: an attempt count would have quarantined a whole chunk
  after three Stop hooks inside one API outage). The ledger records every attempt;
  the count is the number of days on which the span failed, so an outage day is one
  failure and a poison pill is set aside on its third day.
- **The ledger**: `<scope>/failures.jsonl`, beside `consumed.jsonl`, one
  `{hash, at, day, code}` line per (span, failure). **Never span text.** The hash is the
  buffer's own span hash, which already lives in `consumed.jsonl`. Bounded by the
  same `trimLedger()` as the consumed ledger: a trim can drop old failures and so
  reset a count, which spends a few more calls and never loses a span.
- **Written by failures only.** `sweep()` calls `noteFailures()` for a chunk that
  came back THREW / TRUNCATED / MALFORMED_RESULT / APPLY_FAILED. A restore that is a
  *deferral* — `BELOW_MIN_CLAIM` scraps riding to the next boundary, spans of a
  session still running, the already-authored retirement — touches nothing and is
  never a step toward quarantine.
- **The quarantine**: at the bound the span is NOT put back. Its full line is
  appended to `<scope>/quarantine.jsonl` — the whole span, so nothing is ever
  dropped and the owner can read it in any editor (constitution line 16) — and
  `remember.span.quarantined` fires with `{scope, spans, code}`: counts and a code,
  never text, and never the hash of text either (hashing low-entropy content leaks
  it). Exclusion from future claims is structural: the span is not in the buffer.
- **Quarantined hashes DO enter `consumed.jsonl`.** This is the third disposition,
  and it is terminal rather than pass-through: recording it is what stops an
  identical re-capture from restarting the loop and what lets `mergeOrphans()`
  filter a replayed claim. It is not the P0 regression, whose whole point was that a
  span *coming back* must stay out of the ledger.
- **Counted, never absent.** `coverageReport()` carries `quarantined`, and
  `SweepReport` carries `spansQuarantined` — a span the sweep gave up on is a
  number the owner can see (scar §2.4).
- **Fails toward retry.** If the ledger or the quarantine write does not land,
  nothing is quarantined and every span goes back. A retry costs a call; a drop
  costs the day.

**Named limitation — innocent siblings.** A chunk failure marks *every* span in the
chunk, so a healthy span chunked with a poison pill three times is quarantined with
it. That is the simplest rule that bounds the cost; bisecting a failing chunk to
find the actual pill is machinery in anticipation of a failure not yet seen
(Amendment 15). The material is in `quarantine.jsonl` either way, so the cost of
being wrong is a file the owner reads, not a lost day.

**Named window.** If `noteFailures()` writes the quarantine and `restore()` then
fails, the sweep returns without consuming and the claim file is kept — so the next
stale-claim merge brings the quarantined span back for one more failed call, and it
is quarantined a second time (a duplicate line). Bounded duplication is the accepted
failure mode here; loss is not.

**`arc()` is deliberately not wired to this.** It is a retry path by docstring, but
it has no production caller (only the kill-mid-arc tests), it restores the *whole*
claim and removes the claim file, and its `work` function is arbitrary — there is no
per-span model call to bound. Wiring quarantine into it would need partial-restore
choreography it does not have, for a cost that has never been observed. The sweep is
the loop that bills the owner, and the sweep is what is bounded.

## 14. 2026-09-05 — the strike: how a span is destroyed without racing a claim

**Why there is a destruction path in this module at all.** LAUNCH-STATUS §I2:
a note is CAPTURED before it is minted, so its verbatim words sit in
`<key>/jots.jsonl` while the memory minted from them lives in the store.
*(Written as "in `prose/`" on the file floor; since the floor — schema v6,
2026-09-20 — the memory is a row, and the buffer is still the other copy, which
is the whole reason this path exists.)* The
owner's `remove` chased six surfaces, none of them this one, reported
`unchased: nothing`, and a `backup` taken afterwards copied the removed words.
Constitution 6/7 — the owner's data, removable loudly — was not true of a note.

**Why the console could not just delete the line.** `spans/` is this module's
state machine. §2 G6 forbids a span being in NEITHER a claim nor the buffer,
and `claim()` works by renaming the live file aside — so an `rmSync` or a
read-filter-write-over from `adapters/cli/removal.ts` races exactly the move
that guarantee exists to protect. The fix had to be a door here.

**`owner-strike-seam.ts`, and the shape it borrowed.** `store/owner-op-seam.ts`
already solved "a destruction that must not be reachable by holding the
object": `SpanBuffer`'s constructor hands the seam a capability through a
WeakMap, and a test in `test/cli.test.ts` pins the two files in `src/` that may
import it (this module's `spans.ts`, which grants and never calls, and the
console's `removal.ts`). A `Counterpart` — which the MCP server holds, and a
model talks to — holds a buffer and reaches nothing.

**What the race defense actually is.** Three moves, and `mutate()` is NOT one of
them. `mutate()` is the stance check plus a try/catch that turns a throw into a
reason; it excludes nobody. What excludes:

1. **The ledger, first.** The struck hashes go into `consumed.jsonl` before a
   byte moves. That file is already the terminal filter for `seenHashes()`,
   `restore()` and `mergeOrphans()`, so from that instant a re-capture of the
   same words dedups away, a worker holding the span in memory mid-arc cannot
   restore it, and a crashed run's orphan cannot merge it back. Ledgering a
   struck span is the same disposition a QUARANTINED one gets — terminal, not
   pass-through — so §12's rule (a RESTORED hash must never enter the ledger)
   is not in tension with it. **It is BOUNDED, like every consumed hash**:
   `consumed.jsonl` trims at `CONSUMED_LEDGER_MAX`, so far enough into the
   future the struck hash ages out and an identical re-capture would land as a
   new span. That is bookkeeping's price, not a hole in the removal — the
   memory stays dark, the old capture stays gone, and what would land is
   somebody saying the same words again.
2. **The rename aside.** Each file is `rename(2)`d to `<name>.striking` and the
   survivors appended back to the original path. An append racing the strike
   lands in a FRESH file at that path and is untouched; a read-filter-write-over
   would have lost it on the old inode. Ordering inside a stream shuffles by at
   most one batch, which `spans()` re-sorts on `at` anyway.
3. **The fold-back, and the order that makes it true.** A `.striking` file left
   by a crashed strike is folded home before anything else happens — appended to
   its stream (deduped by hash), **fsync'd, and only then removed**. The first
   draft read it into an array, removed it, and wrote the array back afterwards,
   so the survivors lived in RAM across a rename and a full re-read; a crash
   there lost them, and this paragraph's earlier claim that "a crash strands
   nothing" was false (review F2). It is true now, in the direction that
   matters: a crash before the fsync leaves the aside whole and the next fold
   repeats, deduped; loss is not on the table, bounded duplication is.

   The review asked for temp → fsync → *rename over the original*. Not taken,
   and the reason is the aside itself: renaming over the live path clobbers a
   turn a hook appended in the meantime, which is the exact race the aside
   exists to survive. Append-then-fsync buys the same crash property without
   buying that one back.

   The fold runs **unconditionally, per scope, before the strike decides it has
   anything to do** (review F3). Survivors in an aside belong to nobody's
   removal; a scope repaired only by the removal that happens to name them is a
   scope repaired by luck. The suffix is deliberately not `.jsonl`:
   `claimFiles()` must not see an aside as an ordinary orphan — and the console's
   residue walk now looks for `*.jsonl.striking` by name, because an aside it
   could not see was a "not applicable" printed over words that were on disk
   (review F1).

**What it does NOT defend against, said plainly.** A worker that has already read
`claim.spans` into memory will finish its arc and may mint a memory from a span
struck a millisecond later. The deny-list stops the removed id from coming back;
it does not stop a NEW id being minted from the same words in that window. The
window is the length of one model call, the strike is owner-invoked and rare, and
closing it properly means a lock the module does not have. Named, not fixed.

**A predicate may only ever take a JOT — and the console may only ever hand it
an exact line, inside one scope.** Two rules, in two places, because they are
two different mistakes.

*Here:* the hash names one span; a predicate names a SHAPE, and the only shape
it is allowed to name is a jot. A conversation span is many turns joined
together, belongs to no single memory, and striking one because a memory's body
appears inside it destroys material nobody named. `matches()` enforces it, so no
caller can get round it.

*In the console:* the predicate it builds is **full-text equality after trim,
never a substring**, and it is only ever built when the memory's `origin_scope`
is recorded. Review F4 measured what the substring version did: removing "buy
milk" from a MIGRATED row — and `tools/migrate/apply.ts` writes `origin: { ref }`
with no scope at all, so that is the shape of every imported row — struck a jot
reading "buy milk and call the vet" in one project and an unrelated "buy milk"
in another, and ledgered both their hashes. With no scope the console now
REFUSES the content chase, prints the candidate files and counts, and leaves the
decision with the owner (`--strike-by-content-across-scopes`).

Lines left by either rule are counted and printed by the console as `spans
echo`, on their own line — not as `unchased`, which is about failure.

**Files it rewrites:** `buffer.jsonl`, `jots.jsonl`, `assistant.jsonl`,
`quarantine.jsonl`, and every `claims/*.jsonl`. Those are the five that carry
`text`. `coverage.jsonl`, `consumed.jsonl` and `failures.jsonl` carry span
hashes and are left alone — the hash is the thing that must SURVIVE, or nothing
stops the words being re-captured.

**What it records.** `strikes.jsonl` beside the streams: `at`, lived `day`,
`by`, and three counts. No hash and no text, for §16 G9's reason — hashing
low-entropy content is a way of keeping it. The ring event
`remember.span.struck` carries the same counts. It is deliberately not a box-2
durable event: this module has no `Store`, and adding a `DURABLE_EVENT_NAMES`
name was the second, explicitly deferred half of cli/INTERFACE-GAPS §9.

**The brain analog, since every physics decision here has one.** This is not
forgetting — decay, interference, failure to consolidate. It is the one
operation biological memory has no counterpart for: excision on demand. That is
why it is a seam nobody can reach by accident rather than a phase of sleep.

## 15. 2026-09-14 — `crashedSessions()` still never forgets, and that is the answer to G48

**The finding.** A session leaves the crashed set only by ending normally, which
a crashed session by definition never does. So once a scope has been swept and
retired, `crashedSessions()` keeps naming its session forever, `crashedPending()`
finds no spans behind it, and the sweep answers `NOTHING_TO_SWEEP` on that scope
every day for the life of the store. On the live run that was 5–7 scopes a day,
counted into the gate row's `otherRefusals` under a comment claiming a nonzero
count "is NOT a quiet day".

**What was considered.** Dropping a session from the crashed set once all of its
spans are consumed — a `retired` marker, or a set filtered by "still holds spans
in the buffer or a claim file".

**What was done instead: the reading was fixed, not the mechanism.** Three
reasons, in order of weight:

1. **The mechanism is already correct and the row was the thing lying.**
   `crashedPending()` returns `spans: 0` for a retired session, so it costs no
   rename, no claim, no restore and above all no model call — the gate is doing
   exactly what the 2026-09-04 ruling asked. What was wrong is that a *reporting*
   counter folded that answer in with `BELOW_MIN_CLAIM` and `IO_FAILED`. The gate
   row now counts every reason by name, so the daily reads 7 quiet refusals
   instead of an ambiguous 7. The division is THREE-WAY, not two —
   `QUIET_SWEEP_REASONS`, `NOISY_NOW_SWEEP_REASONS` (`IO_FAILED`, `OBSERVER`)
   and `NOISY_IF_CHRONIC_SWEEP_REASONS` (`BELOW_MIN_CLAIM`) — because the same
   never-forgetting that made `NOTHING_TO_SWEEP` permanent makes
   `BELOW_MIN_CLAIM` permanent too: a crashed session whose leftover is under
   `MIN_CLAIM_BYTES` has it restored to the buffer (`spans.ts#claim`) and is
   never forgotten, so that scope refuses the same way on every run for good.
   The first cut of this row ambered the dashboard on the first one, which would
   have left one 200-byte leftover ambering it forever — the same shape of false
   signal, one reason further along. `noisyRefusals` counts the reasons that can
   never be a normal day even once; `chronicCandidates` counts the one that is
   only worth reading as a RUN, which needs a reader holding several days of
   rows (`tools/parallel/`), not the one-row dashboard or daily.
2. **Forgetting would erase a distinction the gate deliberately keeps.**
   "Nothing crashed here" and "a crashed session left nothing behind" are two
   different facts, kept apart on purpose (§2.4 and the comment at the gate). A
   retired session that stopped being crashed would answer `NO_CRASHED_SESSION`
   — which is *not* what happened, and the day a crashed session's spans go
   missing for some other reason is the day that difference matters.
3. **Forgetting needs new durable state, which is complexity bought in
   anticipation.** "All its spans are consumed" is not readable from the
   boundaries file; it needs either a per-session retired marker (a new record
   whose own staleness is a new failure mode) or a span scan folded into a
   function whose callers expect it to be cheap. Amendment 15: the simplest rule
   that could work has not yet failed — the set's only cost is that
   `crashedPending()` walks a scope's spans, which it does anyway.

**Left open, and named rather than closed:** G48's other half — `buffer.jsonl`
for a normally-ended session is never swept (by design) and has no prune path,
so it only grows (131 KB in the counterparts scope on 2026-09-14). That is a
retention question for the buffer, not a gate question, and nothing here touches
it.

## 16. 2026-09-23 — retention: the predicate, the week, and who reads spans

**The rule** (owner's ruling 2026-09-23, roadmap B3): a session's captured text is
deleted 7 days after it ended, when nothing is owed; a session that owes a write-up waits
until it is written up. CONTRACT §5 G15. Two files, split by the PR #189 review (B1):
`owes.ts` decides and plans and is exported from the index; `retention.ts` deletes, is
NOT exported, and only the background worker may import it (`test/cli.test.ts` pins it).

### Every reader of `spans/`, inventoried before anything was deleted

What each needs, and what a week-old deletion of a session that owes nothing costs it:

| Reader | What it reads | Needs | After retention |
|---|---|---|---|
| The crash-fallback sweep (`fallback.ts`, via `Counterpart#sweepFallback` in the worker) | `buffer.jsonl`, `jots.jsonl`, claims — CRASHED sessions only | a crashed session's uncovered text until it is swept (12 h silence) | Unaffected in practice. A crashed session the pacer asked about, or one whose substance reached the first-ask threshold, OWES and is kept however old; a short one goes after a week — six and a half days after the sweep could first have read it. |
| The next-session write-up (roadmap C2, not built) | a session's captured text | everything a session that owes still holds | This IS the predicate it will read; nothing it needs can age out. |
| The lagged semantic cue (`claude-code/vectors.ts`) | `spans()` and `assistantSpans()` filtered to the session that just spoke | that session's last turn | The session that just spoke had a boundary a moment ago, so its clock is minutes old: it is kept by the CAPTURE clock, which reads the buffer alone. (The first version of this table said "a live session is always younger than a week"; that was false for a session idle past a week — review m10. A session the host's registry still holds open is kept too, but only while the registry keeps the record, which is the same week — re-review R8 — so that is an extra guard, not this row's.) |
| The Stop's coverage report (`hooks.ts#askAtStop` → `coverageReport`) | counts over the scope's buffer | counts for the `adapter.ask` row | The counts now describe what is HELD — a week, what is owed, what is open — not everything ever captured. |
| Deposit intake (`proposals.ts#submitProposal`) and `claimCoverage` | the depositing session's spans | the session that is depositing | It is active, so its clock is fresh. |
| Dedup layer 2 (`seenHashes`) at capture and jot | every stream's hashes + claims + the consumed ledger | to refuse an exact repeat | A session's own re-read is refused by its CURSOR, which retention keeps. The deleted spans' hashes are LEDGERED, so an identical later utterance is refused while they stay in the ledger and admitted after they are trimmed out (review n3). |
| The owner's removal (`cli` remove → the strike; the echo walk) | every text stream, quarantine, claims | to find and destroy a removed memory's words | Less to find. A removed memory's source text now survives at most a week in the store (or until written up) instead of for ever. |
| The daily rotating snapshot (`adapters/snapshots.ts`) | the whole of `spans/` (`backup: true`) | a copy | Retention runs BEFORE the day's copy. But every day's copy still carries the text younger than a week, and 14 copies are kept — so raw text lives **up to 7 days in the store and up to 21 days counting the snapshots**, permanently, not only while switching over (review m5). The snapshot policy is not changed here. |
| `export` (`cli/export.ts`) | nothing — it omits `spans/` (LAUNCH-STATUS §I3) | — | Unchanged; the line saying so is INTERFACE-GAPS §12. |
| The dashboard (`views.ts` "spans" node) | nothing — "silent by design" | — | Unchanged; the new row is INTERFACE-GAPS §10. |
| Replay tooling (`tools/replay/`) | writes a fresh temp store's buffer from a corpus; never reads a live `spans/` | — | Unaffected. |
| The parallel-run recorder (`tools/parallel/record.ts`, `readers.ts`) | a v2 data dir's span files for ONE day, and every `quarantine.jsonl` | the day being recorded | A daily recorder reads days younger than a week; it would only lose text if run against a day more than 7 days old. |

### The predicate, fact by fact, and why each reads as it does

`owes = capturedText ∧ ¬writtenUp ∧ asked ∧ (¬answered ∨ ¬endedNormally)`, judged ONCE
per session across every scope of the store.

1. **`asked` reads the PACER, and fails toward keeping.** "A short session that never
   reached the pacer's threshold owes nothing" is the owner's sentence, and the durable
   evidence that the threshold was reached is the pacer's own: an ask is committed only
   when one was due. So an ask committed in the pacer's state, or recorded as issued in
   the host's `adapter.ask` rows, is `asked`; so is a pacer state that will not read.
   **And — review m1 — so is a session with no ask on record whose substance reached the
   first-ask threshold anyway.** An ask can fail to be recorded for reasons that say
   nothing about the session: delivery stood down (parallel mode), `askAtStop` threw
   before its state commit, the session was killed before its first Stop. Where the host
   recorded a pacer EVALUATION at or after the session's last capture, its measured
   substance decides; otherwise an upper-bound count from the buffer does (the furthest
   cursor any span reached, which counts tool turns, and every text byte, which counts
   injected context). The count over-estimates on purpose: its error keeps text.

2. **Clause (b) needs `asked` too.** Read literally, "(b) ended abnormally with captured
   text" makes EVERY session lost to a closed terminal — Claude Code fires no SessionEnd
   for that — owe a write-up, including a two-turn "hi"; on a keyless store that text
   would never age out, and C2 would ask a later session to write it up. So both clauses
   sit under the threshold. **Flagged for the owner's review** — it is the one reading this
   build chose rather than transcribed.

3. **`answered` means an answer LATER THAN THE LAST ASK** (review M1; the rule #186
   writes for its own mark). A session asked three times and answered once, early, still
   owes the stretch after its last ask. The chapter rule is the pacer's own: a chapter
   answers only if `appendedAtAsk` has caught up with `asks`. An accepted `session_end`
   memory, a handoff written or cleared, and #186's `nothingNewAt` registry mark (review
   m3; read defensively until #186 lands) each count if at or after the last ask — whose
   time is the pacer's new `lastAskAt` or the host's newest issued ask row, whichever is
   later. A session with an ask at an unknown time (a state written before `lastAskAt`
   existed, and ask rows pruned) can be answered only by the chapter rule. With no ask at
   all, any answer counts.

4. **`endedNormally` is read across EVERY scope and the host's registry** (review m2): a
   normal end at or after the session's last capture anywhere. A session whose boundaries
   were recorded under two directories is settled by an end in either — it used to owe
   for ever in the one that did not see the end.

5. **The assistant's own turns are not a debt.** `assistant.jsonl` is never claimed and
   never swept, so a session the key-based sweep already wrote up still holds its replies.
   Counting them as captured text would make it owe for ever. They are DELETED with the
   session, though — they are the fastest-growing file.

6. **A session the host's registry holds OPEN is kept while it does** (review m10;
   corrected by re-review R8, which found the first wording — "never deleted" —
   overstated). "Open" is a record with no end — wider than the registry's own four-hour
   `isLive`, on purpose — and a record that exists but will not read counts as open. The
   registry forgets a record 7 days after its last write (`pruneSessions`, at a
   SessionStart): the SAME week as the retention clock, so `keptLive` is an extra guard
   for the window where the registry still remembers, not the protection a recently
   active session relies on. That protection is the capture clock (`kept-young`), which
   reads the buffer and nothing the registry keeps; a test holds it with the registry
   record already pruned. Keeping registry records past the retention week would make
   `keptLive` real, and is `adapters/sessions.ts`'s to decide.

7. **The clock** is the latest thing known about the session anywhere: its last capture
   or boundary in any scope, its write-up mark, its registry end.

8. **Every failure to read a fact moves toward KEEPING**: an unreadable pacer state is
   asked, an unreadable log is no answers, an unreadable registry record is open, a host
   that throws is open.

8b. **Substance is counted in UTF-8 BYTES** (re-review R5), the pacer's own unit
   (`hooks.ts#substanceOf`). The first version summed `text.length` — UTF-16 code units —
   which under-counts a non-Latin script up to threefold: eight turns of Japanese that the
   pacer would have asked about read as short, and were deleted after a week when the
   final ask had stood down.

### How it deletes, and who may make it

9. **Through the strike, and only from the worker** (review B1). A second destruction
   path would have made the strike's first line false, so retention names whole sessions
   to the owner's strike, recorded `by: "retention"`. The first version exported
   `pruneRetention` from `remember/index.ts`, which the MCP server and the hooks import —
   so anything holding the public `Counterpart.spans` could have deleted a session that
   owed by handing it facts that said otherwise. Now `owes.ts` (the read-only plan) is
   what the index exports; `retention.ts` is imported by `bin/runner.ts` alone, and a
   test pins it and proves the pin is not vacuous.

10. **Once per date, atomically** (review m6). The row check alone let two workers that
    both passed it run the strike at once — and two strikes renaming the same stream aside
    can lose a stream. `retention.ts` now creates `spans/retention/<date>.latch` with
    `O_EXCL` before it plans; the second worker is told `ALREADY_RAN` and touches nothing.
    A month of latches is kept. The owner's own strike (a `remove` at the console) racing
    a retention pass is the same window NOTES §14 already names, and is left named.

11. **The retention ledger is trimmed; the owner's is not** — with a correction (review
    n3). A retention strike trims `consumed.jsonl` to `CONSUMED_LEDGER_MAX`, because a
    keyless store never runs the `consume()` that otherwise trims it. The first note said
    the worst case was "one re-admission that the next day's run deletes again"; that is
    wrong for an OWNER removal. Retention's appends can push the owner's struck hashes out
    of the ledger, and those are what keep a removed memory's words from coming back
    (`removal.ts`). They can only come back through a claim in flight — `restore` or
    `mergeOrphans` — which exists only on a store with a key, where `consume()` already
    trims the same ledger the same way. So the change is small, but it is not nothing.

11b. **The way OUT of owing is a grant, not a method** (re-review R1). A write-up mark
    ends a session's debt, so its text goes 7 days later: a deletion on a fuse. It was a
    public `SpanBuffer#recordWriteUp` — reachable through `Counterpart.spans`, taking any
    scope (and creating it), any session and free text for `by`. It is now
    `write-up-seam.ts#recordWriteUp`, a WeakMap grant from the buffer's constructor like
    the strike's, and `test/cli.test.ts` pins its importers to `remember/` and the one
    path the next-session write-up's door (C2) will live at, `adapters/mcp/write-up.ts`.
    It refuses by name: a `by` outside `WRITE_UP_BY` (`next-session`, `owner`), a scope
    not already in `scopes.json` (it has no `ensureScope` at all), and a session with no
    text in that scope. All three pins now see single quotes, `import()` and `require()`
    (N1), and a test proves each one catches a stray importer in every spelling.

11c. **A run is visible from the moment it holds the latch** (re-review R7). The worker
    writes a `STARTED` row as soon as `pruneRetention` takes the date's latch, before it
    plans; the result row follows. A run the watchdog kills halfway therefore leaves
    `STARTED` as the date's newest row — "started, did not finish" — rather than a date
    that is spent and silent. And a later worker that finds the latch held with NO row at
    all for the date (a run that died between the two) writes one `LATCH_HELD` row. The
    sessions a dead run did not reach are due again the next date.

12. **Claims count, and are struck.** Text held only in a claim file (a sweep in flight, or
    a crashed run's orphan) counts as captured, so nothing in flight can make a session look
    empty; a doomed session's lines are struck from claim files too.

13. **A `session_end` whose every entry was refused is not an answer.** All entries
    `DUPLICATE_CONTENT`, or all stopped by the gate battery, leave no ACCEPTED proposal
    record and no other durable row naming the session, so it reads `answered: false` —
    the direction that keeps text, and a case for C2 to ask a later session about something
    its author already tried to write. The fix is a durable row for a refused
    `session_end`, which is the MCP server's to write.

### Named, and left

- **m4 — "owed" has no way out yet.** `recordWriteUp` has no production caller until C2.
  Every session that owes keeps its text indefinitely: every asked session whose terminal
  was closed without a SessionEnd (item 2), and every `session_end` whose entries were all
  refused (item 13). By design for now; doctor's line and export's say so.
- **m9 — the crash fallback's outgoing prompt is raw.** `fallback.ts` sends the claimed
  transcript to the interpreter as captured; only the vector text is redacted. Pre-existing,
  filed in `encode/INTERFACE-GAPS` §3; with the key-based sweep becoming opt-in (C2) it
  matters less.
- **n1 — the pass's date is UTC.** The worker stamps its run with a UTC date, so for a
  Pacific owner the daily pass happens at the first boundary after 17:00 local. The
  retention clock itself is in milliseconds and has no zone; only which boundary runs the
  pass does.
- **n2 — unbound MCP jots share one session id** (`"mcp"`, `server.ts`). Retention judges
  them as one session whose clock is the newest unbound jot in the store, so old unbound
  jots stay as long as any unbound jot is under a week old. Harmless (toward keeping).
- **The raw capture's words are said honestly to the owner** (re-review R9):
  `cli/removal.ts` used to print "nothing prunes the buffer today" beside the echoes of
  a removed memory; it now says retention deletes them 7 days after the session ends,
  unless the session is still waiting to be written up, and that the daily snapshots keep
  a copy up to 14 days longer.
- **The first run on a long-lived store** deletes its whole backlog of sessions that owe
  nothing and are more than a week old, in one pass. On the owner's store, started fresh
  on 2026-09-21, nothing is older than a week before 2026-09-28.
