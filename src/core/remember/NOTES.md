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
that makes `sweepAll()` able to enumerate. Session cursor files are keyed the same
way. Cost: an owner reading the directory needs the legend. Alternative rejected:
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
