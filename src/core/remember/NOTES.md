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
`<key>/jots.jsonl` while the memory minted from them lives in `prose/`. The
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
3. **The fold-back.** A `.striking` file left by a crashed strike is read
   through the same predicate and merged (deduped by hash) before the next
   strike runs, so a crash strands nothing. The suffix is deliberately not
   `.jsonl`: `claimFiles()` must not see an aside as an ordinary orphan.

**What it does NOT defend against, said plainly.** A worker that has already read
`claim.spans` into memory will finish its arc and may mint a memory from a span
struck a millisecond later. The deny-list stops the removed id from coming back;
it does not stop a NEW id being minted from the same words in that window. The
window is the length of one model call, the strike is owner-invoked and rare, and
closing it properly means a lock the module does not have. Named, not fixed.

**A predicate may only ever take a JOT.** The hash names one span; the content
predicate names a SHAPE, and the only shape it is allowed to name is a jot —
the memory's own words, deposited as themselves. A conversation span is many
turns joined together, belongs to no single memory, and striking one because a
memory's body appears inside it would destroy material nobody named. The rule
lives in `matches()` here AND in the console's plan count, so a caller cannot
forget it and the plan's number is the number the strike takes. Lines left that
way are counted and printed by the console as `spans echo`.

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
