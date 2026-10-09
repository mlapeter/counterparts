# `associate/` — interface gaps

What this module needed from a neighbour and worked around instead of editing. Each
entry names the owner, the workaround now in the code, and what the real fix looks
like. Nothing here is implemented in `associate/` — these are decisions for the seam.

## 0. Nothing was stubbed

`physics/` supplied the decay curve (`decayCurve`) and the tier vocabulary
(`UseTier`); `store/` supplied the edge rows, the transactional `linkMany`, the
deny-list and the observer stance. **No local stub of a store or of physics exists
in this module.** The only physics symbol imported is `decayCurve` — the edge
arithmetic is this module's by the module-map ruling, but the CURVE FAMILY is not
redefined here.

## 1. `recall/` has no fourth channel yet — the traversal is exported, not wired

**Closed 2026-09-24** — hops modulate only (answer a): `recall/activate.ts` adds `spread(seeds, day)` contributions to existing candidates; wired by `core/retrieval.ts#composeTurn`.

**Answer (b) taken, 2026-09-28 (association build 2), as a working default:** a memory
only links reached may join the turn as a footnote-tier QUIET POINTER — a few a turn,
over a threshold, only beside a memory the turn shows (the anchor, which reads
`Contribution.from`), footnote tier only. Recall's gate names that one lane past hard gate (a)
and keeps every other uncued memory dark (recall CONTRACT §5 G5, NOTES §19). Build 1
measured first (`recall.decision.spread`, doctor's Association line) and fixed the
arithmetic under it (NOTES §13). The rest of this entry is the record of the choice.

**Owner:** `recall/` (its NOTES.md §7 already names the seam: "when `associate/`
ships, its hops feed a fourth channel and the gate does not change").
**Have:** `spread(input, tunables)` — a pure function — and `Associate.spreadFrom()`,
which supplies the store-backed `edgesFrom` and `conducts`. Both are exported and
tested. **`recall/` is untouched** (no-cross-edits).
**The wiring, when someone does it:** in `recall/activate.ts`, after the cue and
semantic channels have produced their candidate set, call `spreadFrom(seeds, day)`
with the cued candidates as seeds and add each `Contribution.activation` to the
matching candidate's activation.

**And the one real collision, which is recall's call to make, not associate's:**

> A hop contribution can reach a memory **no cue and no embedding touched**. Recall's
> hard gate (a) — *an uncued memory is dark, whatever its salience* — is currently
> STRUCTURAL: an uncued memory is never fetched, so its salience arithmetic is never
> evaluated. A hop channel that can *create* a candidate converts that structural
> property into a checked one.

Three defensible answers, and the choice belongs to whoever owns the gate:
(a) hops **modulate only** — a contribution is added to candidates that already
exist and never mints one (keeps gate (a) structural, and is the conservative
default); (b) hops may mint candidates but are excluded from `cueFraction`, so a
hop-only memory can reach the footnote tier and never the loud one (the closest
analogue to §9 G9's single-channel tier cap); (c) hops count as conversation. This
module takes no position — `spread()` returns contributions and says which depth
each came from, which is what any of the three needs.

## 2. `store/` has no eviction archive for edges — "removal" is a zeroed weight

**Owner:** `store/` (box 2).
**Needed:** contract G3 — "every eviction is archived BEFORE the edge is removed",
and the archive "may over-record on a crash but must never lose the only record of
an eviction".
**Have:** an `edges` table with `(src, dst)` as the primary key, `INSERT OR REPLACE`
through `link`/`linkMany`, and — correctly — **no delete of any kind** anywhere in
the store's surface.
**Workaround:** an evicted edge is written to **weight 0**. It stops conducting
(below `EDGE_FLOOR`), stops counting toward the per-node live-edge cap, and the
eviction is reported in `FlushReport.evictions` (with its prior weight) and evented
as `associate.edge.evicted`. So the eviction is *observable* and its count is
*reported* (scar §2.17) — but the prior weight survives only in the event ring and
the returned report, both of which are in-memory and bounded.
**Consequence, stated plainly:** an eviction that happens in a process that then
dies leaves the row at zero with no durable record of what it used to be. That is
weaker than G3 asks for.
**2026-09-28:** the zeroed row itself is now swept at the flush (`Store.sweepEdges`),
counted on the flush report and the `associate.flush` row. That removes a row that
already carried nothing; the prior weight's durable record is the same open ask as
before (the `edges_archive` below). Note the store did have one delete before this:
`restoreEdge`, a dream's undo.
**Real fix (store's call):** an `edges_archive` table in box 2 —
`(src, dst, weight, last_day, evicted_day, reason)`, append-only — written inside
the same transaction as the zeroing row, so the archive lands before (or with) the
eviction and can only ever over-record. `Store.linkMany` would take the archive rows
alongside the edge rows, or a sibling `evictEdges(rows)` would do both.

## 3. No cross-process exclusion — skip-on-busy is in-process only

**Owner:** `store/` (or a shared lock primitive; SEAMS is the right registry).
**Needed:** contract G5 — "cross-process exclusion with skip-on-busy, and a buffer
drain bounded to what was read".
**Have:** the drain half is real and tested (`DeltaBuffer.drain()` swaps the map, so
a concurrent arrival lands in the fresh one and is never deleted unflushed). The
exclusion half is a **single-process reentrancy guard** (`Associate.flushing`),
which is enough for one host process with a hook that can re-enter, and nothing at
all for two processes.
**Why it was not built here:** the honest options were a `meta` row (read-modify-write
— scar §2.1's exact shape, and `recall/INTERFACE-GAPS.md` §1 already records that
trap) or a lock file at the top level of the data dir (which `Store.assertLayout()`
would reject as an unclassified path, correctly). Both are worse than declaring the gap.
**Real fix:** a lock the operational database can hold — a `locks` table with an
owner token and an expiry, taken and released inside box 2's transaction, or an
advisory `BEGIN IMMEDIATE` seam exposed by the store.

**Until then the flushers are the WORKERS, one per boundary** — the credit pass does
not flush at all. It drains its buffer to `sessions/association/pending.jsonl`
(`pending.ts`) and the boundary's detached worker claims that file by renaming it
aside, absorbs the deltas and flushes them in its own process
(`counterpart.ts#applyPendingAssociations`). **Each pass is claimed by exactly one
worker**, because the rename is atomic and a second claimant meets an ENOENT. Two
workers running at once are still two flushers, and the failure mode of two flushers
is not corruption (`linkMany` is one transaction and rows are absolute) but a
lost-update race between two absolute writes — inside the same "bounded loss, never
doubling" tolerance the contract already accepts.

**Two residuals of the claim, named rather than hidden.** (a) A claim whose apply
fails is left on disk and retried by a later run, so nothing is lost; a claim that
was applied and then could not be REMOVED (the `rmSync` and the rename-aside that
follows it both failing) would be applied a second time, which is the doubling G4
rules out. It is counted — `stuck` on the `associate.flush` row and a
`counterpart.associate.claim.stuck` event — rather than assumed away. (b) A claim
file renamed aside as `.applied` after a failed remove is never claimed again and is
never cleaned up either; on the machine where that has happened, it is a file of
counts and ids sitting in `sessions/association/claims/`.

## 4. Nobody calls `retargetOnSupersede` — supersede does not know about edges

**Closed 2026-09-24** — `counterpart.ts` injects `retargetOnSupersede` into both `supersede` callers (`Schemas.open`'s `retarget`, and `applyRevision` in `core/revision.ts`).
The same callback reaches a dream merge (`Dreams`' `retarget`, 2026-09-26) and, since
2026-10-09, a regrown chapter copy (`Self`'s `retarget`; the copies archived before then
are carried once at open, NOTES §15). A bare `Store.supersede` or `Store.archive` still
carries nothing.

**Owner:** `store/` and whoever owns revision (scar §2.2: "supersede retargets edges
too — v1's `gist.merge` set `merged_into` and nothing re-pointed the edges, so
successors started cold").
**Have:** `Associate.retargetOnSupersede(oldId, newId, day)`, tested: the successor
inherits the old head's live edges symmetrically, by `max` (so a re-run cannot
inflate), and the old rows stay put and simply stop conducting.
**Gap:** `Store.supersede()` returns a new id and knows nothing about `associate/`,
which is right — the store must not depend on a core module above it. So the call
belongs to whichever layer composes them (the boundary adapter, or `sleep/` when a
consolidation supersedes). **Until someone wires it, every supersede leaves the
successor cold**, which is the scar, live again.

## 5. The credit tiers arrive from a reference-resolution step that has no home

**Closed 2026-09-24** — `Counterpart.creditReferences` (tiers from `recall/reference.ts`) feeds `coactivate`; the flush crosses processes via `pending.ts`.

**Owner:** the boundary adapter (`recall/INTERFACE-GAPS.md` §5 records the same gap
from the other side).
**Needed:** `coactivate(members)` takes `{id, tier}` — the tier being §9.2's
retrospective verdict, resolved with the reply known.
**Have, since the credit seam landed:** `Counterpart.creditReferences` resolves the
tiers once (`recall/reference.ts`) and hands the SAME list to both halves —
`recall.resolveUse` per memory, `associate.coactivate` for the set. Two independent
resolutions would be two clocks, and there is one.
**And the flush goes with it (2026-09-17).** `coactivate` buffers in process and
`flush()` publishes, so the two must run in the same process or nothing is ever
written. Deferring the flush to the session boundary is only safe where the boundary
is the same process; on this host every hook is a fresh one, and for the whole of
the parallel run the buffer died at hook exit. What crosses the process line now is
the FILE: the credit pass drains its buffer into `sessions/association/pending.jsonl`
(`pending.ts`) and the boundary's worker claims it and flushes it
(`counterpart.ts#applyPendingAssociations`). `sessionEnd`'s own flush is what a
single-process caller still gets, and it runs before the carried claims.

## 6. `store.edgesFrom(src)` is the only edge read

**Owner:** `store/`.
**Have:** outgoing edges for one node. No `edgesInto`, no enumeration, no count.
**Consequences, both accepted here:** (a) symmetry is maintained by *writing* both
directions, never by reading backwards — which is why `planFlush` emits two rows per
pair; (b) the per-node count cap and its evictions are therefore **directional**: a
hub evicting its edge to a quiet node does not touch the quiet node's edge back, so
the pair can conduct one way and not the other until the quiet node's own flush
settles it. That is defensible (synapses are directional) but it is a consequence of
the read surface, not a decision.
**Real fix if a dashboard or a hygiene sweep needs it:** `edgesInto(dst)` and an
`edgeCount()`/`edges(limit, offset)` enumeration. A dead-edge sweep (rows sitting at
zero forever) also has no home today.
**Partly closed 2026-09-28:** `Store.allEdges()` (a read, for doctor's census) and
`Store.sweepEdges(dead)` (the flush's sweep of rows that carry nothing; the predicate is
this module's). Still no `edgesInto`.

## 7. Guarantee 9 is half-reachable: there is no "under audit" flag

**Owner:** `self/` or whoever owns the audit/protected vocabulary.
**Needed:** "pinned or under-audit memories are frozen in both directions — an arc
under audit does not change mid-audit."
**Have:** `MemoryRow.protected`. Associate refuses to accumulate any delta touching
a protected endpoint (`frozen-protected`, tested). **"Under audit" has no
representation in v2's schema at all**, so that half of the guarantee is unreachable
rather than unimplemented. Recorded rather than invented — a flag minted here would
be a second vocabulary for a concept another module owns.

## 8. The observer predicate still lives in `store/`

**Closed 2026-09-24** — the predicate lives in `src/core/observer.ts` (hoisted 2026-08-25).

Not a defect, and recorded so nobody "fixes" it: `Associate.observer` reads
`store.observer` and never re-derives it. `docs/SEAMS.md` queued item 4 already says
the hoist to `src/core/observer.ts` is a MOVE, not a rewrite; associate is now the
third consumer and will follow the move without changing behavior.

## 9. Eviction is one-way (noted 2026-09-28, not changed)

**Owner:** this module, with `store/`'s read surface (§6).
**Have:** the count cap evicts on the BUSY node only — its row to the quiet node goes to
zero (and is now swept at the flush), while the quiet node's row back stays and still
conducts until its own homeostasis or decay settles it. So after an eviction a pair can
conduct one way and not the other.
**Why it is left:** removing both directions would mean the busy node's cap reaching
into the quiet node's edges, which the quiet node may value (it is one of few), and it
is not the build-1 question. If replay shows one-way ghosts mattering, the fix is to
zero the back row inside the same plan (`planFlush` already loads both endpoints of
every delta), counted as its own eviction reason.

## 10. Left for the next build (from the adversarial review of #279, 2026-09-28)

**Both built in association build 2 (2026-09-28, NOTES §14):** the best-first queue with
a threshold (`SPREAD_MIN_FRACTION`, the node budget a recorded backstop), and the
ceiling (recall's `HOP_CEILING`; a pointer's own cap was dropped after the review of #281). Recorded, as
they were left — build 1 was measure-and-fix only:

- **A best-first queue across depths, with an activation threshold.** Today each hop's
  frontier is ranked, but depth 1 still finishes before depth 2 starts, and a node is
  expanded however little it carries. A single priority queue over (carried) across
  depths, stopping under a threshold, would spend the node budget where activation is.
- **A ceiling on the per-candidate hop score.** Contributions sum across paths with no
  cap, so a candidate reached by many seeds can gather a hop score out of proportion to
  its own cue. A ceiling (relative to the candidate's cue + semantic, say) belongs with
  option (b) of §1, when hops start to matter for what is shown.

## 11. Nearby by context — not built in build 2 (2026-09-28)

**Owner:** `self/` (the wake's hints lane, `self/identity.ts#rankLanes`).
**Wanted:** the missing half of #238 — seed the wake's "Nearby" from what this
directory last used (its last credited ids, or its handoff) and blend that with
habituation, so links shape what the wake offers too.
**Why not now:** it was the brief's optional item, "only if cheap", and it is not. The
wake is composed once, at the first boundary of a lived day, and read from every
directory (`self/INTERFACE-GAPS.md` §12), so a per-directory seed has nowhere to run
without putting ranking on the wake path, which is meant to compute nothing; the last
credited ids are per session on `recall.credit` rows, not per directory. A per-directory
lane rendered at wake, or a small per-directory cache the boundary writes, would each
be its own design.

## 12. A dream's lookups never reach the credit pass (noted 2026-09-28)

**Owner:** the Claude Code adapter (`transcript.ts`, `hooks.ts#creditAtBoundary`).
**Have:** index co-credit works where the lookups are in the session's own transcript:
the hook flattens every `recall ids:[…]` batch in a reply's slice into the credit pass's
expansions (tested, `association-build2.test.ts` › "5."). **Gap:** the nightly run —
page writer, dream, reflection — runs in a background agent, and a subagent's tool calls
are on a sidechain `parseTranscript` skips (`isSidechain`, `transcript.ts` ~473), so the
ids a dream looks up together never co-credit. That may be right as it stands (the dream
proposes, waking use confirms), and it is recorded so nobody assumes the opposite.
