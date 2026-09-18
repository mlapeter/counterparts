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

## 5. Decay writes the CACHE, and reconciles ONE canonical column

The brief is explicit and the contract agrees (§4, owner rescope 1): the daily
materialize-decay pass is released, and canonical state takes no decay STEP. So:

- No `uses`, no `lastUsedDay`, no prose write in the decay phase. Strength lives
  in the ranking cache and nowhere else.
- v1 materialized decay into canonical files (~1.9K writes/day) and ratified it
  on the grounds that "a memory stating its own current strength is directly
  trustworthy". v2 received that as an open choice with the evidence attached
  (behavioral-spec §11) and declined it: strength is a pure function, so the
  cached number is derived and a replayed day is a no-op **by construction**
  rather than by a per-item stamp.

**Amended 2026-09-14 (IMPROVEMENTS U8) — the box-2 `band` column is the band of
record, and decay keeps it true.** Until this date the column was written by
`consolidate` on promotion only, on the reasoning that "a crossing is a decision,
not a decay reading, and the two must not share a writer". That reasoning was
sound about the CROSSING and wrong about the COLUMN, and the live store showed
the cost: `ranking` said 1,054 memories were semantic while `memories.band` said
185 — every one stamped `band_day = 184`, the single day `band.promoted` ever
fired — and 869 live rows were semantic in the cache and episodic in the table.
The same decay pass emitted `band.transition` rows for moves the table went on
denying. Three things settled the ruling:

1. **Two readers gate on the column, and the reconciliation can only move it
   toward identity, so neither can lose a row.** The first draft of this note
   said "nothing gates on it", and that was wrong — `store/NOTES.md` now
   enumerates all of them. The two that gate: `revision.ts` routes a declaration
   to the identity arm on `row.band === "identity" || target.promotedIdentity`,
   and `self/identity.ts` lists a removed element as an identity absence on
   `gone.wasPromotedIdentity || gone.band === "identity"` (the band a tombstone
   captured at chase time, `store/owner-op-seam.ts`). Both are ORs with the
   promotion flag, and `band()` answers `identity` **iff** `promotedIdentity`
   (`physics/index.ts`: it is the function's first line, before any arithmetic),
   so on a live row the reconciliation only ever writes the column INTO identity
   — never out of it — and those two gates can only gain rows they should
   already have had. The one path that can put `identity` in the column without
   the flag is migration (`tools/migrate/plan.ts`: a v1 trace above the identity
   gradient cut that v1 itself had retired arrives with `bandOf()` identity and
   `promotedIdentity: false`), and it arrives ARCHIVED, which decay skips; only
   the owner-op `unarchiveMerged` door could bring such a row back into the pass,
   and then the column would be corrected to what the arithmetic says. The rest
   only read: `consolidate` builds physics with `rowToPhysics` and never reads
   `band`; `schemas/` reads it and never writes it (§4 of its CONTRACT, and a
   source scan); `self/identity.ts` also selects `list({ band: "identity" })`,
   and identity is decay-exempt, so that set is byte-identical before and after.
   What DID read the stale column and report it: the `status` MCP tool's
   `byBand`. The CLI census and the dashboard had already routed around the
   column by computing the band themselves and saying so in a comment — a
   workaround is evidence of the bug, not a fix for it.
2. **A surface that emits a transition must not contradict it.** Constitution 16:
   the system shows its workings. Two stores of the same fact, one of them
   wrong and both of them read, is the shape the parallel run keeps finding.
3. **It is not v1's churn.** The write fires only when the column disagrees with
   `band(m, d)` — a handful of rows a day once caught up, zero on a replayed day,
   and one catch-up pass for the backlog while the store fits the decay phase's
   budget (`BUDGETS.decay` = 20,000 examined rows; the live store is ~14,000, and
   a larger one clears a budget's worth a day like every other phase). Strength, the number that actually
   moves every day for every row, is still cache-only. (The first catch-up pass
   on a large store is ~900 single-statement `UPDATE`s under `synchronous =
   FULL`; it happens once, inside a boundary that already writes per row.)

`consolidate` still writes the column at the identity crossing, and still writes
it FIRST — the crossing is its decision. Decay now brings every other row to the
arithmetic. `band_day` therefore means **"the lived day the column was last
brought to physics"**, which is what it always meant for promotions and now means
for everything; the crossing's own record is the latched `band.transition` row,
never this column. `counterparts verify` counts the disagreement
(`cli/commands.ts#bandOfRecordCensus`) so the invariant is checked rather than
believed, and `DecayResult.bandsReconciled` reports it per pass.

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

**A budget is not a blindfold either — the consolidate cursor, 2026-09-18.** "Not
owed" was read as "start from the head again", and on a store bigger than the
budget those are very different sentences. `runConsolidate` walked
`store.list()` — `ORDER BY id`, every row — from index 0 and stopped at 5,000.
Measured on the live store the day before
(`docs/promotion-diagnosis-2026-09-17.md`): 15,292 examinable rows, so the pass
had never looked past about the 5,300th of them, **10,000+ memories had never once
been asked whether they consolidate or belong to who the owner is, and under those
settings never would.** The tell was arithmetic rather than anecdote — of the ten
most-reinforced semantic rows, the only one inside the window was the only one
consolidated.

The phase now keeps a resume cursor (`markers.ts`, one box-2 meta row per phase,
`sleep.cursor.<phase>`, beside the completion marker): the marker says WHEN the
phase last ran, the cursor says WHERE it stopped. It resumes strictly after the
cursor, wraps to the head when it reaches the end, and visits each id at most once
per run, so a store of N rows is covered in `ceil(N / budget)` runs. The ordering
is `list()`'s own, which is why a cursor means anything; "strictly after" is why
the row it stopped on is not re-read; and a cursor whose row has since gone lands
on the next id that is still there, out of the comparison rather than a branch of
its own. The cursor moves only under `ctx.apply`, so an observer's read-only
report does not move the store's place in the store, and a run killed mid-phase
re-walks the same stretch — the marker's own bargain.

**Raising the budget was the other option and was NOT taken here.** It is one
number (`tunables.ts`) against a store that will keep growing; the cursor makes
the budget mean "per night" rather than "ever", which is what it always read as.
The two are independent, and the number is still the owner's to raise.

**And the durable row now says a phase ran out of road.** `sleep.cycle`'s phase
entries carry `budgetExhausted` (always) and `skippedForBudget` (only where a
phase left rows behind), and doctor's Sleep line names them — *"consolidate ran
out of budget (N rows not reached this run)"*, without a severity, because with a
cursor a big store is MEANT to take several nights over a pass. The report has
carried both numbers since the budgets existed and nothing durable copied them:
the truncation was not wrong, it was unsayable, which is scar §2.4's shape and
what hid this for two weeks.

**The other budgeted phases were left alone, on purpose.** `decay` (20,000) and
`prune` (1,000) have the identical start-from-index-0 shape over `store.list()`;
neither is truncating on this store today, and a cursor changes what they see, so
that is a decision to take with a measurement rather than by symmetry. `dedup`
(1,000) iterates candidate PAIRS, not rows, and the pair list is rebuilt each run
from the grouping — a row cursor would not even be the right key. `log` (5,000)
deletes oldest-first, so the work it does is consumed and the next pass naturally
continues; it needs no cursor at all.

The three-way vocabulary that makes this legible (§5 G6, scar §2.4):

| status | reason | means |
|---|---|---|
| `ran` | `completed` | it ran and changed something |
| `ran-nothing-found` | `nothing-to-do` | it ran and there was nothing to do |
| `did-not-run` | `already-done-today` / `not-due-this-cadence` / `observer-report` / `no-render-fn` | it never ran, and here is which |
| `failed` | `failed` (+ `error` code) | it threw; the marker stands still |

**`changed` is "rows this phase acted on", and the band reconciliation is one of
them (U8, amended 2026-09-14).** The first cut counted the reconciliation in
`DecayResult.bandsReconciled` only, and nothing durable read it: on the exact
live shape — the column wrong and the ranking cache already right, so no row's
cache "moved" — the pass issued 869 `UPDATE`s and then filed itself
`ran-nothing-found` / `nothing-to-do`, and the `sleep.decay.materialized` ring
event was skipped because no strength row was written. A row is now counted once,
in whichever category is true (`changed` when its column was reconciled,
`skipped.unchanged` when nothing about it moved at all), the count rides the
phase outcome as `reconciled` onto the `PhaseReport` and the durable
`sleep.cycle` row's decay entry, and the ring event fires when either half did
work. The count is taken under OBSERVER too — only the write is gated on
`PhaseCtx.apply`, which is what that flag's contract promises and what
`sleep.observer.report`'s `would` rests on.

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
hash is exactly what is guaranteed to match). `dedup.ts` supplies the fact from
two columns — `source: "accommodation"`, written at exactly the two supersede
sites that mint with lineage, and `origin_ref`, the challenger.

The rule as shipped is **"an accommodation row is never the LOSING candidate of a
same-hash merge"**, not merely the pair relation. The pair relation alone was the
first draft and it is not enough — see the two doors below, both closed by the
wider clause, both regression-tested. The wider clause is sound rather than a
blanket exemption: a successor's body IS its challenger's body by construction
(`schemas/index.ts:946`), so every same-hash group a successor belongs to is that
challenger plus ordinary twins of the same sentence, and none of those is the
thing the revision produced. The COSINE path is deliberately untouched — a merely
similar row is an ordinary near-duplicate question, and the argument above does
not hold for it. The guard is otherwise narrow: two ordinary memories with one
body still merge, and a test says so.

**The two doors the pair relation left open**, both found by the adversarial
review, both closed here:

1. **A twin born EARLIER takes the original's seat.** An ordinary memory that
   already says what the challenger is about to say becomes the group's original.
   The challenger and the successor then both pair against the TWIN, the relation
   reads false against it, and **both archive** — so the element is left with no
   live version at all: `currentState(entity) === []`. Strictly worse than the
   finding this note opened with, which at least left the challenger standing.
2. **Two challengers with one body, revising two elements on one day.** `sb`
   pairs against `ca` rather than against its own `cb`; the relation is false;
   `cb` and `sb` both archive and element *b* silently loses its revision while
   element *a* keeps its own.

The trigger for both is ordinary — the same sentence noted twice — not exotic.

**What the fix deliberately does not protect in case 1: the challenger.** It is a
plain memory saying what a plain memory already said, so it merges into the twin
under the ordinary rule and credits it. Nothing about the revision is lost: the
successor holds the words, the element holds the successor, and `origin_ref`
still names the challenger, whose prose and id survive the archive.

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
exactly the row this bug destroys, and dedup never consulted it in any case.
Widening the predicate to "is the head of a chain still inside `H`" and reading
it in dedup would be the general close of G7's wording; G9b's own rule reaches
every case the finding and the review produced, so G7's paragraph in the CONTRACT
now states what the predicate actually enforces rather than more.

**CLOSED 2026-09-05 — probe H (adversarial review, 2026-09-04).** The paragraph
below is kept as written, because it is the filing that led to §14. Read it as
history: the answer it asks for — "whether a `type: "schema"` row should ever be
a dedup candidate at all" — is yes-it-should-not, and §14 is the fix.
An element and an ordinary memory can collide with **no revision anywhere**: an
`addBelief` whose statement is X and a memory whose body is X, born the same
lived day. No accommodation row is involved, so G9b does not apply; the tie-break
puts `mem_` before `sch_` and the belief is archived `merged` into the memory.
Kin of the migration case: migrated ELEMENTS were minted at the import day while
migrated MEMORIES kept their v1 `birthDay`, so on the live store a migrated
belief colliding with a memory body would already have lost — the memory is older
on every such pair. Not chased here (constitution 15: named, not built), because
the honest fix is the wider question of whether a `type: "schema"` row should
ever be a dedup candidate at all — the same shape as G15's journal answer.

**The owner's read-only check, for both this and the finding above:** look for
`memory.merged` events whose `candidateId` starts with `sch_`. That one query
answers "has an element ever been archived as a duplicate on this store", needs
no writes, and does not depend on any claim made in this file.

**What changes on a live store.** Only stores where a dedup pass runs while a
revision's successor and its challenger are both live — in practice any cycle
after a crossing, not merely the same evening, since the pair stays live and
identical until something merges it. Nothing is repaired retroactively: a
successor already archived `merged` stays archived (its prose and id survive, and
its merge record names the original). Stores that never revise are untouched;
genuine duplicates merge exactly as before.

**UNVERIFIED, and do not repeat it as fact:** "the owner's live store has had 1
revision declaration with 0 effect — zero `superseded_by`, zero
`revision.pressure`" is a day-1 reading that master's day-2 watch list still owes
a recount of, and this session cannot open that store. It is also the weakest
possible claim to lean on here, because the CURRENT-STATE arm supersedes on ONE
declaration with no bar to climb (PR #22 is live), so a successor may already
exist without any pressure event to show for it. The read-only check that settles
it: `memory.merged` events whose `candidateId` starts with `sch_`.

## 13. Nothing sweeps the events table — the missing `pruneEvents` caller

**RESOLVED 2026-09-05, the same day, by owner ruling ("wire it into sleep") —
§15 records the two decisions this section asked for and what was built. The
filing is kept as written, because it is the argument §15 answers.**

**Filed 2026-09-05, during replay §2a's review. Not fixed here, deliberately.**

`Store.pruneEvents()` exists, is documented as bounded retention ("logs are
telemetry, not canonical memory — the one named exception to
no-silent-destruction"; the comment cited `CLAUDE.md` for that, wrongly — the
source is v1's spec, `docs/harvest/behavioral-spec.md` #17, and both citations
were fixed with §15), deletes `WHERE day < livedDay - retentionDays AND
dedup_key IS NULL`, has a `PruneReport`, emits `store.events.pruned`, and is
covered by `test/seams.test.ts`. **It has no caller anywhere in `src/`.** The
only invocation in the repo is that test's.

So `DEFAULT_RETENTION_DAYS = 90` is a number the log is *eligible* for and never
subject to. Every unlatched row ever written is still there — `recall.decision`
(one per turn, and replay INTERFACE-GAPS §7 explicitly reasoned "it ages out on
the log's existing window" when choosing not to latch it), the adapter rows, and
now `gate.deposit` (one per authored deposit, same reasoning, same gap). None of
those choices is *wrong*; the sentence they each leaned on is not true yet.

**What is owed, and the two decisions it needs.**

1. **Which phase calls it.** `prune` is the obvious name and the wrong one — it
   is the memory floor, and a phase that both forgets memories and truncates
   telemetry is one budget away from doing half of each. A separate terminal
   step after `decay`, or a call at `runCycle`'s end outside the phase budget,
   keeps "what the cycle forgot" and "what the log dropped" separately
   reportable. The phase list is `satisfies`-checked in three places, so adding
   one is a typed change, not a quiet one.
2. **What the retention should be.** 90 lived days is the store's current
   default and nobody has measured against it. The parallel run is the first
   thing that will have an opinion: its evidence is the store after the fact, so
   a window shorter than the run destroys the run's own record. Whatever number
   is chosen must be longer than the longest run any contract plans, and the
   choice belongs beside that number rather than inside a phase.

**Why not tonight.** Turning a dormant deletion path on is a change to what the
owner's live store *loses*, on a store where nothing has ever been swept — the
opposite risk profile from the record that surfaced it. Constitution line 7's
"nothing bulk-wipes silently" points the same way: the first run of this would
delete months of rows in one pass, and it should be a decision someone made on
purpose, with a count printed first.

## 14. Beliefs are not dedup candidates — 2026-09-05

**The finding, restated as a question rather than a bug.** §12 above closed two
ways a REVISION could lose its successor to a merge, and filed probe H as the
third: an element and an ordinary memory colliding with no revision anywhere.
The honest fix was named there and not built ("constitution 15: named, not
built") because it is not a patch to the tie-break — it is a question about what
the dedup pass is *for*. The owner answered it in one sentence: beliefs and
memories are different kinds of things, and the duplicate-merger should compare
notes with notes.

**The rule as shipped: (a), the wide one.** A `type: "schema"` row is not a
dedup candidate at all. `types.ts#isSchemaRow` is read in `runDedup` where the
LIVE SET is built, so `contentHashCandidates` and any injected cosine source
both receive a `liveIds` with no element in it. The alternative on the table was
(b) — compare schema rows only with schema rows on the same entity — and it was
rejected on contract grounds rather than taste:

- `schemas/` §2 and constitution line 12: **named deviation.** "Beliefs never
  blend into each other. Generalization is only ever an explicit,
  provenance-carrying revision." A merge is exactly a blend with a `uses`
  credit and no provenance.
- `schemas/` §5 G4: **near collisions refuse LOUDLY rather than merging.** Two
  beliefs saying one thing is a schemas-module question with a schemas-module
  answer — refuse and say so — and a sleep phase archiving one at 2am is the
  opposite of loud.
- `schemas/` §5 G1: **no operation edits a belief.** Rule (b) would have made
  the nightly pass the exception.
- And empirically: `tools/migrate/apply.ts#writeElement` already de-duplicates
  same-entity elements at import time, by `entity + role + statement`. The pair
  rule (b) would police is not arriving through this door.

Both alternatives were tested rather than argued: "two beliefs with one body are
left to `schemas/`, not merged here" is the test that would pass under (b) too
if it asserted a merge, and asserts the refusal instead.

**Why (a) is narrow even though it sounds wide.** Elements still fade, still
take pressure, still cross bands, still get pruned. This is not `isJournal` —
that predicate is read by four phases and takes the journal out of forgetting
altogether. `isSchemaRow` is read by ONE phase, and its doc comment says so, so
the next reader does not generalize it into an exemption nobody granted.

**G9b is not made redundant, and this is the fact that decided the shape of the
change.** `schemas/index.ts:955` mints element successors with `type: "schema"`,
which (a) covers. `revision.ts:387` mints the IDENTITY arm's successor with
`type: "memory"` — an ordinary `mem_` row carrying `source: "accommodation"` —
and (a) does not reach it. Without G9b, an identity element revised under three
days of pressure would still lose its successor to the challenger. There is now
a test at exactly that case, and it is the one that would fail if someone
decided G9b had become dead code. The five PR #56 tests keep every invariant
assertion; only their `leftAlone` reason line moved to `skipped.schema`, with
the reason written beside it.

**Two honesty repairs made in the same loop.** The journal exclusion in this
phase was SILENT while CONTRACT §5 G15 claims "counted as a named skip in each
phase" — decay, prune and consolidate counted it and dedup did not. It counts
now. And a pair handed over by an injected source naming a stood-down row used
to be counted `already-archived`, which is false for a live belief; it is named
`schema` or `journal`.

**What changes on a live store, and it is not nothing.** Any cycle where an
element and an ordinary memory share a body. Migration makes that likely: every
migrated element was minted at the import day while migrated memories kept their
v1 birth day, so the memory is older on every such pair and wins without even
needing the `mem_` < `sch_` tie-break. Nothing is repaired by the fix itself —
an element already archived `merged` stays archived, with its prose, its id and
its merge record intact. The repair is a separate, owner-run tool:
`counterparts repair-merged-beliefs --dry-run`, and `--apply` if the owner
chooses (`cli/NOTES.md` §5).

**Two things the adversarial review measured that belong here rather than in a
PR comment.**

1. **The cosine arm has never fired on the live store.** `Counterpart.sessionEnd`
   calls `runCycle({store, render, …})` with no `candidates`
   (`core/counterpart.ts:1114`), so `runDedup`'s `source` is `undefined` and only
   the content-hash arm has ever run in production. The cosine test in this
   suite is a guard against future wiring, not a description of something that
   has already happened — worth saying plainly, because it makes the live
   exposure smaller than the tests' coverage suggests, and a reader who assumed
   otherwise would over-read the finding in either direction.
2. **`skipped["schema"]` now counts every live element, every night.** On a
   migrated store that is a number in the thousands, and it means "nothing
   happened" — the same shape as the journal skip. It is a census of what the
   phase stood down, not an alarm, and nobody should read a cycle report as if
   a big number there were a problem.

**The class, for G12:** anything else. Not "telemetry-only and provably
identical" — the surface-set hash is unchanged (`800a9a9421cd969f` on master and
on this branch) because it hashes FIELD NAMES on three record shapes and no
field moved, but what the store HOLDS moves: an element that would have been
archived stays live, one fewer `sleep.merged.<id>` is written, and recall, the
wake and every schema slice see a belief where they would have seen nothing.
The day-1 record says nothing either way about schema/memory collisions, so
"no live row is affected" is not a claim this session can make.

## 15. The log sweep — §13's caller, and the two decisions it asked for — 2026-09-05

**What was built.** A new terminal phase, `log` (`log.ts`), after `briefing`,
that calls `Store.pruneEvents({ limit: ctx.budget })` and reports like every
other phase: `examined` = rows past the window (unlatched + latched), `changed`
= rows deleted, `skipped.latched` = rows past the window kept by their latch,
`skippedForBudget` = eligible rows the cap left for tomorrow. It emits
`sleep.log.swept` (counts only) and the store emits `store.events.pruned`.
`Store.pruneEvents` grew the cap (`WHERE seq IN (SELECT seq … ORDER BY seq
LIMIT ?)`, oldest first) and a fuller report (`eligible`, `remaining`,
`limit`); `Store.eventLogCensus()` is the read-only count of the same numbers,
which is what the observer report and `counterparts verify` use. CONTRACT §5
G16 states the guarantee.

**Decision 1 — which phase.** §13 named `prune` as the obvious and wrong home,
and the alternative of a call at `runCycle`'s end outside the phase machinery.
Neither. A PHASE gets everything the sweep needs for free and would otherwise
have to re-spell: a marker (once per lived day, `already-done-today` on replay),
a budget (the per-pass cap, and "a budget is not a debt" already means "take a
cap's worth today, report the rest, owe nothing"), degrade-don't-abort, the
observer's `apply === false` path, the three-way outcome vocabulary, and a row
in the dashboard's cycle table via `CYCLE_PHASES` (which is `PHASES`, imported).
It runs LAST because §3's guarantee is that the briefing is the last **content**
write, and a telemetry delete is not one — the order test now asserts both: the
briefing's `store.put` is the final content write, and `store.events.pruned`
comes after it. The name is `log` because that is what the code calls the table
everywhere (`eventLog`, "the durable event log", `no-durable-event-log`);
`events` would collide with `CycleReport.events`, the in-memory telemetry ring.

**Decision 2 — the retention, and where it lives.** `Store.retentionDays`
stays the one window, default `DEFAULT_RETENTION_DAYS` = 90 lived days in
`store/operational.ts`. It was already the knob for the version and
gate-session sweeps, and the dashboard already promised it in prose in two
places ("I keep events for `${store.retentionDays}` lived days; older ones are
swept unless a replay latch holds them" — `activity.ts`, `web/views.ts`), so a
second sleep-side number would have made two 90s that drift, and moving the
store's default into physics would have made the store import physics for one
constant. What the sleep module owns is the FLOOR ON THE DEFAULT: a test pins
`DEFAULT_RETENTION_DAYS >= 90` with the reason beside it — the parallel run's
instrument reads its evidence off this table and needs ≥ 7 active days plus
review slack. The knob remains the owner's: a store opened with
`retentionDays: 30` sweeps at 30 and no test forbids it, because a floor that
silently refused the owner's own setting would be the ceremony constitution 15
tells us not to build ahead of a failure.

**Every reader of the table, and what each needs — the survey the retention
was chosen against.** Latched (kept at any age, so retention is irrelevant to
them): `repair-merged-beliefs` and the seam's `unarchiveMerged` (`memory.merged`
by name and by ref — and the command ALSO unions archived schema rows via
`list()`, so it does not lean on the log alone); the symmetry counter in
`cycle.ts`, `dashboard/status.ts`, `web/views.ts#healthView`, the replay
driver (`band.transition`); `schemas.story()`, `dashboard/stories.ts`
(`revision.pressure`); the replay driver and the daily (`gate.chunk`); the
dashboard's exits and the demo seeder (`memory.pruned`, `memory.merged`,
`band.promoted`). Unlatched (subject to the window): `tools/parallel/readers.ts`
reads `adapter.*`, `sweep.gate`, `recall.decision` **for one date at a time**
(SQL-filtered by `day` or by the payload's `date`) plus a whole-table
`COUNT(*)` of `recall.decision` — a run window of ≥ 7 active days sits far
inside 90; `tools/replay/driver.ts` reads `gate.deposit` over the WHOLE run at
the end, on a store it created whose lived days are the corpus's active days
— **26 in the recorded replay** — so a corpus longer than the window would lose
its first days' deposit records to the sweep, and that is the one bound worth
naming (the fix, if a longer corpus ever exists, is a driver that reads
incrementally or opens its store with a longer window, not a longer default);
`tools/demo/seed.ts` counts `recall.decision` over its 30 days; the dashboard's
feed, node lists and health heatmap read `LOG_CEILING` or the last 21 lived
days and already say "what I still have"; `eventDetail(seq)` already answers
"no event with that seq in the kept window"; the `session` node's "N sessions
seen" is now a count over the window rather than since birth. `date.repaired`
and `salience.defaulted` (repair tools) are unlatched and written at repair
time; nothing reads them back. No reader needs more than 90 lived days.

**The cap.** `TUNABLES.BUDGETS.log = 5_000` rows per pass. Measured, not
calibrated: on a 100,000-row log, a 5,000-row capped delete took 177 ms cold and
17 ms warm, 20,000 rows took 35 ms, and the census over 70,000 rows took 10 ms
(bun 1.3.10, this machine, 2026-09-05). A day's inflow on the live store is
hundreds of rows, not thousands, so steady state clears in one pass and the cap
only bites on a backlog — which is the case it exists for.

**What the live store's events table holds — and the premise the "0 rows"
claim rests on.** This session never opened `~/.counterparts`. What CAN be said
is arithmetic on the write sites: every `appendEvent` in `src/` passes a `day`
taken from `livedDay()` at write time (or a `d.day` / `t.day` / `log.day` that
is that same value carried a few lines), `advanceClock` refuses to move
backwards, and `tools/migrate` writes no events (it sets `livedDay` to v1's
`activeDay` and writes rows, not log entries). So the oldest event's day ≥ the
lived day at migration, the store has lived at most the calendar days since
2026-08-25 — eleven at the time of writing — and the cutoff is `livedDay − 90`:
**the first pass should delete 0 rows**, whatever v1's clock set `livedDay` to,
until the store has lived 90 days past its first v2 event.

**The premise, named (adversarial review of PR #81):** that argument holds
only for a store that had **no events before migration set its clock**.
"Forward-only" is `advanceClock`'s promise, and `tools/migrate/apply.ts`
does not use `advanceClock` — `setMetaIfChanged` (`apply.ts:364`) writes
`livedDay` through `setMeta`, the side door, with no guard that the target
store is fresh. A store that had already run a hook, `verify`, or an install
before migration jumped its clock carries day-0 rows that a 400-ish clock puts
three hundred days past the cutoff. The reviewer's probe: five `adapter.boundary`
rows at day 0, then `setMeta("livedDay", "400")`, one row at 400 — first cycle
`eligible=5`, deleted 5, the post-migration row kept; clock set first, then
rows — `eligible=0`, deleted 0. **The live store is the second shape:** the
coordinator ran `counterparts verify` read-only against it on 2026-09-05 and it
printed **1,342 rows held, oldest lived day 184, 0 past the window** — so the
arithmetic holds there, on a measurement rather than on this paragraph. If a
future `verify` ever shows a non-zero `past the window` on a store that should
have none, the named suspect is a clock moved by `setMeta` over rows that
predate it, not the write sites.

**`gate.deposit` stays unlatched, on purpose.** The reviewer argued it and this
note agrees: a latch needs a dedup key, a per-row key would make the most
voluminous kind "kept at any age" — the I23 growth shape again — and a key that
collapses repeats would change the "two refusals are two events" semantics
`test/gate-records.test.ts` protects. Readers that need it past the window size
their own store's `retentionDays` instead — which is what the replay driver now
does (`tools/replay/driver.ts`).

**The cycle now leaves ONE durable row per run (`sleep.cycle`, 2026-09-14,
IMPROVEMENTS U9).** Everything this module emits — `sleep.cycle.start`,
`sleep.cycle.done`, `sleep.phase.failed` — lives in an in-process `EVENT_RING`
that dies with the worker, so "did the cycle run today, and did every phase
succeed" was not a question the store could answer; the only durable evidence
was the SIDE EFFECTS other phases wrote (`band.transition`, `memory.pruned`),
which a quiet cycle does not leave at all. `sleep/` did not change: the row is
written by the composition root from the returned `CycleReport`, the same way
`sweep.gate` is written from the sweep reports, because this module has no
opinion about the store's event log and should not grow one. Payload:
`reason` (`ran` | `clock-failed` | `threw`) and `code`, `date`, `day`,
`phases: [{ phase, status, reason, code? }]` for EVERY phase in the executed
order, `started` (how many the cycle entered), `failedPhase`/`stage` when the
thrower said, and the counts `promoted`, `pruned`, `merged`, `bandUp`,
`bandDown`, `failed`, `trimmed`. Unlatched like `sweep.gate` — two boundaries in
one lived day leave two rows, because the cycle really did run twice — and pruned
with everything else at the store's 90-lived-day window.

**And a cycle that DIES carries its work out with it** (`CyclePartial`, added in
review of the same PR). Degrade-don't-abort covers a phase BODY that throws; a
throw from outside one — a marker advance, the clock, `onStep`'s hard kill —
escapes with no `CycleReport`, and the first version of the row read it as a
quiet clean night: seven phases had run and the briefing had trimmed six
elements, and the row said `phases: [], failed: 0, promoted: 0`. That is the
fabricated zero (scar §2.4) arriving through an exception. `runCycle` now
attaches the reports it had — plus `CycleKilled`'s phase and stage — to the
escaping error as a non-enumerable symbol property, and the recorder writes
`null`, never 0, for every count the run never finished taking.
