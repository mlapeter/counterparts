# `sleep/` — implementation notes

*Where the CONTRACT is silent, contradicts itself, or was overruled by a later
ruling, this file says what was decided and why. Constitution line 13: decisions
are defaults. Every one of these is revisable; none of them is hidden.*

---

## 1. Phase order: `prune` before `dedup`

The contract fixes three consequences (§3 G5) and leaves the rest of the ordering
open; the build brief fixes the full list, and this module implements it:

    clock → decay → consolidate → prune → dedup → versions → briefing

**The tension worth recording:** a merge credits `uses` on the ORIGINAL, which
raises `base`, which raises `strength`. Running dedup FIRST would therefore
rescue a floor memory whose duplicate was about to vouch for it. Running prune
first — as here — means a memory can be archived at the floor on the same cycle
that a near-duplicate would have credited it.

In practice the window is narrow: prune requires `D_FLOOR_DAYS` (90) of dwell and
strength under `PHI_PRUNE` (0.02), and one `usesDelta: 1` is worth `REP_PER_USE`
(0.12) of repetition credit — enough to matter only for a `wRep > 0` kind that
has sat untouched for a quarter. It is also RECOVERABLE, because the prune is
archival: nothing was lost, an id still resolves, and a future dedup pass sees an
archived original and leaves it alone.

Reverse the order if replay shows the window is real. It is one line.

## 2. The floor prune ARCHIVES — CONTRACT open question 1, resolved

`CONTRACT.md` §4 says the floor prune "is the one place the system deletes" and
§7 OQ1 flags it as unresolved, against v1's §11 G6 which says the opposite in as
many words ("fading is not deletion... human forgetting deletes; this only
fades").

**Resolved toward archival**, and the store settles it structurally rather than
by preference: `store/` exports no `delete`, `remove`, `unlink`, or `rm`, for
prose or anything else — there is no verb to call. A pruned memory keeps its
prose file, keeps its id, stays resolvable, and carries
`archived_reason = "pruned"`.

What is NOT lost by choosing archival: the exit is still countable (scar §2.17 —
a band with no exit is a defect), the prune record is still written, and the
memory still stops competing for ranking. What IS paid: disk, and the honest
version of constitution line 3 is now "forget the trials" in the sense of
*access*, not *bytes*. If the disk bill is ever the argument, the answer is an
owner operation on the structurally-distinct removal path (`owner-op-seam.ts`),
not a delete verb inside the librarian.

`CONTRACT.md` §2's named deviation (b) — "this module deletes, loudly and on
physics' verdict alone" — should be re-read as "this module retires, loudly and
on physics' verdict alone" when the contract is next revised.

## 3. Observer: a full read-only REPORT, and no spawn

The contract (§5 G10) says an observer session **spawns no cycle at all**. The
build brief says an observer **runs the whole cycle as a read-only report**. Both
are implemented, and they are not the same statement:

- `shouldSpawn(store)` returns `{ spawn: false, reason: "observer" }`. That is the
  spawner's question, and its answer is the contract's.
- `runCycle` on an observer store computes every phase with `ctx.apply === false`
  and returns the full report. That is the dashboard's and the replay scorer's
  path (constitution line 16 wants the workings visible), and it writes nothing.

The mechanism matters: an observer does not *attempt* writes and catch the
store's refusal — it never calls a `WRITE_METHOD` at all. The test asserts zero
`store.observer.standdown` events alongside a byte-identical data dir, because
"stood down at the seam" and "never reached the seam" are different claims and
only the second is what an instrument should be able to make about itself.

`ctx.apply` also means the observer report is a REAL report: `changed` carries the
count the phase WOULD have acted on, while `status` stays `did-not-run` so the two
can never be confused.

**One honest caveat on that number, for `decay` only.** An observer is handed a
`null` ranking cache — opening the SQLite file would CREATE it, and a created file
is a mutation. So the calm-day comparison has nothing to compare against, and the
observer's decay `changed` counts every live row rather than the rows that would
actually move. Every other phase's observer count is exact. Fixing it needs a
read-only cache handle that refuses to create its file; it is not worth a second
code path until a dashboard actually reads that number.

## 4. The consolidation criterion is stated here, not imported

Physics has no `consolidationEligibility` (INTERFACE-GAPS §5). The rule used:

> not already consolidated · not archived · `day > birthDay` · `band(m, d) ===
> "semantic"` (or already identity)

Built only from physics' exports, so it cannot drift from the band definition.
The two deliberate choices inside it:

- **No reinforcement requirement.** Physics protects "a formative one-shot
  consolidates without repetition" with a `max` in `base`; a `reinforcedDays >= 1`
  gate here would repeal it from the outside.
- **`day > birthDay`.** Sleep consolidates yesterday's experience. Note the
  interaction with the clock: the clock phase runs FIRST, so a memory written
  during the session that just ended is already a day behind by the time this
  phase looks at it, and consolidates on the very next cycle. That is the correct
  brain analog (consolidation happens during the sleep that follows the day) but
  it makes "born today" a narrow category in practice — it catches memories minted
  *during* the cycle's own lived day, not memories minted during the session the
  cycle is closing. Worth a second look when the adapter fixes the boundary's
  exact ordering.

## 5. Decay writes the CACHE and nothing else

The brief is explicit and the contract agrees (§4, owner rescope 1): canonical
state is untouched by decay. So:

- No `uses`, no `lastUsedDay`, no prose, and **no box-2 `band` column write** in
  the decay phase. Band movement caused by fading lives in the ranking cache.
- The box-2 `band` column IS written by `consolidate`, on promotion only — a
  crossing is a decision, not a decay reading, and the two must not share a
  writer. This is the one place the two phases' authority differs and it is
  deliberate.
- v1 materialized decay into canonical files (~1.9K writes/day) and ratified it
  on the grounds that "a memory stating its own current strength is directly
  trustworthy". v2 received that as an open choice with the evidence attached
  (behavioral-spec §11) and declined it: strength is a pure function, so the
  cached number is derived and a replayed day is a no-op **by construction**
  rather than by a per-item stamp.

**The skip list is reported, not branched on.** An identity-band memory is not
skipped by an `if`; `physics.decay()` returns `D = 1` for it and the arithmetic
does the exempting. The category is still counted, because "how many rows did not
move, and why" is the question the telemetry exists to answer.

**`DECAY_QUANTUM` earns its place.** Without it, exponential decay moves every
floor memory by ~1e-9 a day and "calm by default" (v1 §11 G8) would be a claim
instead of a measurement — the cache would rewrite in full every quiet day.

## 6. A merge ARCHIVES the duplicate, and that is not optional

`physics.dedupVerdict` states the whole effect of a merge as `uses(orig) += 1`
and says nothing about the duplicate. Leaving it live would make dedup **not
idempotent**: the next cycle finds the same pair and credits again — a `uses`
ratchet, and a direct breach of §5 G3. So the duplicate is archived with reason
`"merged"`. Archival, not deletion, on the same grounds as §2 above; and it feeds
the created-versus-exited census, which is how a curation path that stops firing
becomes visible (scar §2.17).

## 7. The default dedup candidate source hashes the BODY, not the document

`memories.content_hash` addresses the whole serialized prose document — id and
frontmatter included — so two distinct memories can never share one. It is a
change detector, not a duplicate detector. The duplicate question is about the
body, which is the memory. The body hash is computed in memory and never
recorded: prune records are content-by-reference and carry no hash at all (scar
§2.20).

Embedding-backed candidates arrive INJECTED (`SleepOptions.candidates`), are
permitted arithmetic rather than a generative call (§4), and are isolated: a
throw degrades the pass to lexical-only and logs it (scar E1). The lexical pairs
already found still stand — degradation is partial, not total.

## 8. Budget semantics: the marker advances on a truncated phase

"A budget is not a debt" (§3, v1 §5 G4). A phase stopped by its budget still
advances its marker and reports `budgetExhausted` + `skippedForBudget`. The work
not done is not owed: tomorrow's cycle starts from tomorrow's store, not from a
backlog. A phase that FAILS is the opposite case — its marker does not advance, so
the next lived day retries it.

The three-way vocabulary that makes this legible (§5 G6, scar §2.4):

| status | reason | means |
|---|---|---|
| `ran` | `completed` | it ran and changed something |
| `ran-nothing-found` | `nothing-to-do` | it ran and there was nothing to do |
| `did-not-run` | `already-done-today` / `not-due-this-cadence` / `observer-report` / `no-render-fn` | it never ran, and here is which |
| `failed` | `failed` (+ `error` code) | it threw; the marker stands still |

## 9. `CycleKilled` — why a crash needs its own class

Degrade-don't-abort would otherwise swallow the very thing the crash test is
trying to prove: a test throwing from `onStep` would be caught, recorded as a
failed phase, and the cycle would sail on and advance every later marker. So
`CycleKilled` is the one error `runCycle` rethrows untouched. It is not
test-only scaffolding — a cooperative watchdog abort should throw it too, and
markers stay honest either way.

`onStep` itself is ordinary per-step telemetry. That a test can weaponize it is
the point: the crash seam is the same seam the adapter watches through.

## 10. Records are keyed by memory id, never by day or sequence

`sleep.pruned.<id>`, `sleep.promoted.<id>`, `sleep.merged.<id>`. Ids are never
reused (`store/` G2), so a replayed day rewrites the identical key with identical
content instead of appending a second line. That is what makes the meta-row
workaround (INTERFACE-GAPS §3) idempotent enough to satisfy §5 G3 while the real
table is missing.

## 11. What is measured on full membership

CONTRACT §3: *over-budget is measured at full membership, not on the rendered
output — a renderer that demotes until it fits by construction never reports
being over budget.* That detector lives in `self/`, which owns the render and its
lanes. `sleep/` reports its OWN budgets the same way — `skippedForBudget` counts
candidates never reached, not items dropped from an output — so the same honesty
applies on this side of the seam.

## 12. Dedup ate a revision's successor — 2026-09-04

**Symptom.** The demo seeder built the first store that ever crossed the pressure
bar, and the `stories` view rendered the crossing as a disappearance:

    it now says  "The migration Teodoro Whitlock merged cannot be rev…" [sch_…, archived: merged]
    day 29  …  REVISED, becoming "…" [sch_…, archived: merged]

The revised belief was superseded correctly and then, the same evening, archived
out of existence as a belief: `schemas.beliefs(entity)` empty, the successor gone
from every slice. Constitution 7 — "revisions keep their history; nothing
bulk-wipes silently" — broken by a phase doing exactly what it was told.

**Cause.** `schemas/index.ts#supersedeElement` mints the successor with
`input.statement ?? store.readProse(challengerId).body`. That is the design: the
statement that won the argument IS the new belief (§5.6), so successor and
challenger are byte-identical BY CONSTRUCTION. `contentHashCandidates` groups on
the body, the tie-break sorts by birth day and then by id — both born the same
lived day, and `mem_` sorts before `sch_` — so the successor is always the
candidate and the challenger always the original. `dedupVerdict`'s existing
refusal, `declared-revision-never-merged`, compares the CANDIDATE's `updates:`
declaration against the original's id; the successor declares nothing, and the
challenger's declaration names the PREDECESSOR, which is archived and out of the
live set. Nothing in the pass could see what the pair was. Both arms of the
dispatch fire it: the belief path and the current-state replacement, plus
`revision.ts`'s identity arm, which supersedes the same way.

**Fix.** A second named refusal rather than a change to what a successor says —
the contract wants the challenger's statement verbatim, so the body is not
negotiable. `physics.dedupVerdict` gains `revisionSuccessorPair` and the verdict
`revision-successor-never-merged`, checked before hash and before cosine (the
hash is exactly what is guaranteed to match). `dedup.ts#revisionSuccessorPair`
supplies the fact from two columns — `source: "accommodation"`, written at
exactly the two supersede sites, and `origin_ref`, the challenger — and asks it
BOTH WAYS, because which row the tie-break calls the original is an accident of
ids. The guard is narrow by construction: two ordinary memories with one body
still merge, and a test says so.

Same shape as the journal finding a day earlier (CONTRACT §5 G15), and worth
naming as a class: **phases that walk "every row" were written when two identical
bodies could only mean a duplicate.** Three constructions now make identical
bodies on purpose — an episode and the memory ingested from it; a revised
belief's successor and its challenger; a replaced now-fact's successor and its
challenger — and each needed the pass to be told what it was looking at.

**What this fix deliberately did NOT do.** CONTRACT §5 G7 already promises that
nothing "in a live revision chain" is decayed, merged, or pruned, and a fresh
successor is the head of one — so the shorter fix looks like handing dedup
`prune.ts#inLiveRevisionChain`. It would not have worked as that predicate
stands: a successor has no forwarding address, no standing pressure (the seed
resets it) and no version rows of its own, so the predicate reads `false` for
exactly the row this bug destroys. Closing G7's wording properly means widening
the predicate to "is the head of a chain still inside H" AND consulting it in
dedup — a bigger change than the finding demands, and one that would also close
the twin-original edge below. Amendment 15: named, not built, until it fires.

**The edge this guard does not cover.** If an ordinary memory with the
challenger's exact body was born EARLIER, it becomes the group's original and
both the challenger and the successor pair against IT rather than against each
other — the pair relation is false, and the successor merges after all. Not seen
in any store; recorded so the next person finds it named rather than fresh.

**What changes on a live store.** Only stores where a dedup pass runs while a
revision's successor and its challenger are both live — in practice any cycle
after a crossing, not merely the same evening, since the pair stays live and
identical until something merges it. Nothing is repaired retroactively: a
successor already archived `merged` stays archived (its prose and id survive, and
its merge record names the original). The owner's live store had 1 revision
declaration with 0 effect as of parallel-run day 1 — no crossing, no successor,
so there is nothing there for this to change yet. Stores that never revise are
untouched; genuine duplicates merge exactly as before.
