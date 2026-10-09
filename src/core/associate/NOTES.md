# `associate/` — implementation notes

Where the contract was silent, ambiguous, or asked for machinery this build has not
earned yet. Each entry says what was decided and why, so the next session argues with
a recorded choice rather than re-deriving one.

## 1. Why the edge arithmetic is here and not on `physics/`'s page

The contract's open question 1 ("should this module exist at all?") is closed by the
module map's 2026-08-25 ruling: `associate/` stays a module. This build takes the
ruling literally in both directions — **all** the edge arithmetic lives in
`edges.ts` (increment, cap, lived-day decay, count cap, renormalization), and
`physics/` gains nothing. The one import across that line is `decayCurve`: edges
decay on the same CURVE FAMILY as memories, with their own stability constant
(`S_EDGE = 30` against memory's `S_BASE = 60`). That is what "a physics-family
curve, own constants" means, and it is why there is no second `Math.exp` in this
directory.

## 2. Weak credit ships DISABLED, and that is the contract's instruction

Contract §4: *"Weak credit's numeric weight is not inherited. It ships bounded by
fixtures naming what breaks on each side, or disabled (scar §2.8)."* No such fixture
exists, so `EDGE_WEAK_CREDIT = 0`: today only a **referenced × referenced** pair
mints an edge. v1's weak reinforcement weight (0.25, `physics.TUNABLES.W_SURFACED`)
is recorded in the tunable's comment as the calibration to re-earn, deliberately not
wired in — reusing it here would be inheriting exactly the number §4 says not to
inherit, and *edge* credit is not the same quantity as *strength* credit anyway.

The consequence is worth stating: with weak credit at zero, a surfaced-but-unused
memory is reported as `ignorable-tier`, the same reason a footnote gets. They are
not the same thing — one is structural and permanent (a footnote must never train),
the other is a disabled knob. `tierFactor()` keeps them separate in the code:
`footnoted` returns a literal `0`, `surfaced` returns the tunable.

*2026-09-28:* considered again in association build 2 and left at 0, now with the
fixture this section said was missing — see §14.

## 3. `HEBB_RATE` has no ancestry, and says so

v1's harvest records the tier STRUCTURE of credit (§10 G1) and never an edge
increment, so unlike most constants here there is no v1 calibration to quote. 0.1 is
an assistant-chosen starting point with a stated shape — ten fully-credited
co-activations reach the cap — in the same class as `physics.PHI_PRUNE`: CAL, no
provenance, and `tools/replay` is where it gets earned.

## 4. Decay is REALIZED at flush, which is why the shape is pinned

Two ways to carry edge decay: keep the weight fixed and decay lazily at every read
(pure, and what `edgeWeightAt` does for reads), or realize the decay into the stored
weight whenever the row is rewritten (`weight := decayed`, `last_day := d`). This
build does both, and they agree **only because the curve is exponential**:
`w·e^(-Δ₁/S)·e^(-Δ₂/S) = w·e^(-(Δ₁+Δ₂)/S)`. A flat or power-law edge curve would make
the realized value depend on how often the row happened to be rewritten — the same
"two clocks" fiction physics avoids.

So `EDGE_DECAY_SHAPE` is pinned to `"exponential"` and the tunable's comment says
changing it requires a `last_reinforced_day` column, not a new constant. Note that
this is a deliberate divergence from `physics.DECAY_SHAPE`, whose three-way is
decided by replay: memories may end up on a power law while edges stay exponential,
and that is fine — they are different quantities on different clocks.

## 5. Symmetry is written, not read — and it can legitimately break

`store.edgesFrom(src)` is the only edge read (INTERFACE-GAPS §6), so a pair is kept
symmetric by writing **both** directed rows, never by reading backwards. Two places
where the two directions then diverge, both accepted:

- **Renormalization** scales one node's outgoing edges. A hub over its outgoing
  bound scales its edge to a quiet node; the quiet node's edge back is untouched.
- **Eviction** is per node. A hub past `MAX_EDGES_PER_NODE` zeroes its weakest edge;
  the other endpoint keeps its edge to the hub until its own flush settles it.

Both are true to the analog (synapses are directional and scale locally), and both
are visible: `linked()` is symmetric-by-conjunction, `weightAt()` is directional.

## 6. Three traversal choices the contract left open

1. **Seeds receive no contribution.** A round trip (a → b → a) would hand a seed its
   own activation back as if the graph had independently proposed it. Contributions
   are what the graph ADDS; the seed's own activation is the caller's.
2. **Contributions SUM across paths; depth keeps the shallowest arrival.** Two
   co-active seeds pointing at the same memory really is more evidence than one.
   First-arrival-only was the alternative and is also defensible; this one is the
   standard spreading-activation shape, and `Contribution.paths` makes the
   difference inspectable.
3. **A node is expanded once**, at the shallowest depth it was reached. With the
   hop limit at 2 the difference is small; it is what keeps a dense graph from
   re-walking itself. (2026-09-28, best-first: once, when it reaches the head of the
   queue — §14.)

Also: a non-conducting destination is excluded from the **fan denominator**, not
merely from the output. An erased id must not even shape the arithmetic between its
former neighbours — if it stayed in the denominator, erasing a memory would quietly
weaken every hop out of the nodes it used to touch.

## 7. Guarantee 9 is implemented on `protected` only

A protected endpoint freezes the pair in both directions (`frozen-protected`), and
the freeze is checked at BOTH ends of the buffer's life: at accumulation, so a
protected memory's edges are never even pending, and again at publish, so a pin that
lands between the turn and the boundary still freezes the arc it was meant to freeze
— an arc that goes under audit mid-session must not change. "Under audit" itself has
no flag in v2's schema;
inventing one here would mint a second vocabulary for a concept another module owns.
Recorded in INTERFACE-GAPS §7 rather than approximated.

Note the freeze deliberately does NOT try to stop decay on a frozen memory's
existing edges. Decay is a pure function of stored state and elapsed lived days;
"frozen" here means *this module writes nothing about that memory*, which is the
honest reading of a freeze that must survive a crash.

## 8. Deltas are dated at the FLUSH, not at the turn

The buffer holds `{a, b, delta}` and no day. A session that crosses the active-day
boundary therefore credits its co-activations to the flush day. The error is bounded
by one lived day and lands in the same tolerance §10 G6 already declares for the
buffer; carrying a per-delta day would mean either N transactions or planning
against several "current" weights for one edge, and neither is earned.

Relatedly: **there is no one-occasion-per-lived-day cap on edges**, though there is
one on memories (`physics.creditUse`). Repeated co-activation across a day's turns
is genuine repeated co-activation, and `EDGE_CAP` already bounds where it can get to.
If replay shows a single chatty session saturating a pair, the fix is a per-flush
delta cap, named, not a silent one-per-day rule copied over from a different
quantity.

## 9. Open question 2, answered as a build default: learned edges are NOT privileged

The contract asks (and §4 flags as an inheritance v1 never decided): *are learned
co-activation edges the same kind of thing as stated relations?* v1 wrote learned
edges as the same type its activation pass boosted by 1.6×, so learning silently
rode a multiplier intended for stated relations.

**This build ships one weight and no type multiplier at all.** There is no edge
`type` column in box 2, no valence, and nothing in `spread()` that could privilege
one edge over another except its weight. That is the simplest brain-faithful rule
that could work (Amendment 15) and it makes the question answerable later with
evidence: if replay shows stated relations need to out-pull learned ones, the fix is
a typed edge with a measured multiplier, and the harvest's "1.6×" is a starting
point, not a default. The owner may overrule this at any check-in; it is recorded as
a default, not a ruling.

Open question 3 ("does an association need a valence at all?") is answered the same
way and for the same reason: no valence is stored, because the harvest never records
v1's valence being read.

## 10. Deliberately NOT built (Amendment 15 — complexity is earned)

- **A typed/valenced edge vocabulary** — see §9.
- **A durable eviction archive** — INTERFACE-GAPS §2; eviction is a zeroed weight
  plus a report and an event, and the archive table is the store's call.
- **Cross-process locking** — INTERFACE-GAPS §3; the in-process guard is real, and a
  meta-row lock would rebuild scar §2.1 inside a transactional database.
- **A dead-edge sweep.** Zeroed rows accumulate (bounded by `MAX_EDGES_PER_NODE` per
  node, so the table cannot grow without bound in the count-cap direction). Whoever
  builds hygiene should sweep them; nothing here depends on it.
- **`edgesInto` / whole-graph enumeration** — INTERFACE-GAPS §6.
- **Wiring the traversal into `recall/`** — the gate decision is recall's
  (INTERFACE-GAPS §1), and this module must not edit it.

## 11. The declared durability exemption is declared in exactly two places

`associate/CONTRACT.md` §5 G11 and the header of `buffer.ts`. Contract G11 says any
second place that buffers non-reconstructible state fails review; this note is the
pointer, not a third declaration. Everything in the buffer is an increment to
learned structure that the next co-activation re-earns — a crash loses at most one
session's reinforcement, never a memory.

## 12. The pending file, and why the hook does not flush (2026-09-17)

`coactivate` buffers and `flush` publishes, and on the host this ships against those
two run in different processes: the credit pass is inside a Stop hook, the boundary
is inside the detached worker that Stop spawns. The buffer died at hook exit for the
whole parallel run — 430 edges in the owner's store, every one stamped with the
import's lived day, through 214 credit passes.

The first repair moved the flush into the hook. It worked, and it put two SQLite
writes on a path that meets the worker's own write lock: an adversarial probe
measured 5.3 s apiece under a held lock (I38's scenario, `database is locked` in 3 of
8 runs), with the drained deltas then recorded nowhere durable at all. **The
direction of a failure is a choice** (§10 G4), and "the hook waits ten seconds and
then loses the work silently" is not the choice this module makes.

So the pass drains to a file and the worker applies it (`pending.ts`). Three things
are worth writing down:

- **The claim is a rename, and the file is removed only after the apply.** A claim
  whose apply met a busy database is left where it is and retried; nothing is lost,
  and the row that eventually lands says how old the carried work was. The residual —
  an applied claim that cannot be removed would be applied twice — is counted on the
  row (`stuck`) rather than assumed away.
- **The cap drops the NEWEST pass, not the oldest line.** Dropping the oldest would
  mean rewriting a file that other hook processes are appending to. A delta is
  re-earnable; somebody else's line is not.
- **Where it lives is a deploy fact, not a taste.** `assertLayout()` runs in the
  store's constructor, so a new top-level name would stop every store opened by code
  that predates it — and after a deploy, the MCP servers of running sessions are that
  code. `sessions/` is already classified, and the file is a subdirectory inside it.

## 13. Association build 1: measure, then fix the plumbing (2026-09-28)

Working defaults, held lightly. No new behaviour: the traversal is measured, its
arithmetic made to mean something, and five bugs closed, so the next build (quiet
pointers from hops, temporal contiguity, index co-credit) stands on something sound.

**Measured.** Every turn's `recall.decision` row carries `spread`: seeds, nodes
expanded, where it stopped and why (`exhausted` / `hop-limit` / `node-limit`), the
deepest hop expanded, contributions computed, and how many LANDED on a candidate the
24-cut kept —
plus `dropped`, the scored candidates the 24-cut left out. Doctor's Association line
reads the last week of them and a census of the edges (total, conducting, and by
source — derived, since the table records none: a gist's ties, a dream's links, the
rest learned from use). Read `landed` knowing the rule: seeds are the cued candidates
and a seed receives nothing (§6), so hops can only land on a candidate that meaning or
the calendar reached and the words did not. On a lexical-only turn `landed` is 0 by
construction. That is option (a) of INTERFACE-GAPS §1 working as chosen; option (b) is
the next build's question.

**Frontier order.** Seeds expand strongest first and each hop's frontier by the
activation it carries (summed over every path that reached the node), not in the order
the first cue's postings happened to list them. On a big store the 64-node budget is
spent before the seeds run out, so insertion order used to decide which memories ever
spread.

**Absolute weight.** An edge passes `w / max(MAX_OUT_WEIGHT, node's live sum)` of what
its node carries (then `HOP_DECAY`). The old rule divided by the node's live sum, so a
lone 0.03 edge passed 100% and a weight meant nothing on its own. Homeostasis keeps a
node's sum ≤ 4, so hubs still cannot flood; the `max` keeps a legacy node written
outside homeostasis (an old gist at 40 × 0.3 = 12) at most at what it carries. What it
does to a fresh edge: one Hebbian credit (0.1) passes 0.5 × 0.1 / 4 = 1.25% of the
seed's activation — near-silent until use trains it, which is the intent. A trained
edge at 1.0 passes 12.5%.

**Dream and gist links go through this module** (`Associate.propose`). Both endpoints
live, a pinned endpoint frozen (the dream's bundle never shows a pinned memory, so this
is the second line), each direction raised to at least the proposal from its DECAYED
weight — the old `Math.max(w, stored weight)` with `day = today` resurrected what an
old pair weighed before it faded. And a proposal lands ONLY WHERE THERE IS ROOM
(adversarial review of #279): it never evicts an edge and never scales one down, so
nothing waking use learned is ever paid for by a dream. A pair lands when both ends
have room — a new live edge under `MAX_EDGES_PER_NODE`, the outgoing sum after the raise
within `MAX_OUT_WEIGHT` — and otherwise is refused `no-room` (a `link` answers ok:false
`no-room`; a gist's tie is counted). Pairs are taken in the dream's own order, so a gist
with more sources than room keeps the FIRST NAMED, and its change records the sources
that actually landed. The dream row always carries `gistLinks`, `linkNoRoom`,
`linkFrozen` and `linkFailed`, zeros included. Homeostasis stays the Hebbian flush's.
The proposal is `HEBB_RATE` (0.1, the dream's `LINK_WEIGHT`), not 0.3: the dream
proposes, waking use confirms, `S_EDGE` fades the rest. Because a proposal touches
only its own pair's two rows, a dream's undo (which restores that pair) is complete.

**Links no longer inherit the once-a-day credit rule** (§8 said they must not; the
credit seam did it anyway). The pair set is built from every use whose strength credit
was refused only for its day cadence, not from the credited ones alone, so a memory used
on turn 1 and again on turn 5 beside a new one links to it. An ambiguous handle still
trains nothing, edges included. Pairs stay at most once per turn. The count of uses
that joined links this way is `linkedDespite`, on the credit summary and the
`recall.credit` row; `Counterpart.resolveUses` follows the same rule.

**Recall's side**, recorded here because it is this module's channel: hops are now in
neither half of `cueFraction` (in the denominator, a neighbour could push a well-cued
memory under `MIN_CUE_FRACTION` and footnote it), and the 24-cut ranks by activation over
the gate's own salience factor, so the cut keeps what the salience-modulated bar would.

**Hygiene.** The flush sweeps rows that carry nothing — an eviction's zero, a weight
decayed to the floor — after its write lands, and counts them (`swept` on the flush
report and the `associate.flush` row). The write transaction reads only SQL-prefiltered
candidates: rows at or below the floor, or last written at least `fadeHorizon` lived
days ago (the days a full-weight edge takes to fade under the floor, ≈118 at today's
constants); `isDead` decides on that subset, and a row that faded more recently is swept
on a later flush. A row touching a PINNED memory is never swept (G9, frozen both ways).
A sweep that fails costs only the tidying. The cost, stated: sweeping an eviction's zero
removes the last trace in the table of which pair was evicted (CONTRACT G3,
INTERFACE-GAPS §2). Eviction stays one-way (INTERFACE-GAPS §9).

## 14. Association build 2: links change what comes to mind (2026-09-28)

Working defaults, held lightly: build, watch, adjust. Measured on the seeded demo bench
(40 labelled queries, a pattern-completion fixture); unmeasured on a live store.

**Best-first across depths, with a threshold** (`spread.ts`). One queue over what each
node carries — a seed by its own activation, a reached node by the sum of everything
that arrived — and the strongest node is expanded next, whatever its depth, so a strong
first-hop node goes before a weak seed. The walk stops at the first node carrying less
than `SPREAD_MIN_FRACTION` (0.02) of the strongest seed (stop `threshold`), relative so
it means the same on any store size. `MAX_SPREAD_NODES` (64) is a backstop behind it;
when it binds the result says how many nodes over the threshold were still `waiting`.
A node is expanded once, at the carried it had when it reached the head of the queue;
later paths still add to its contribution. On the bench the walk stopped at the
threshold on 40 of 40 turns (it hit the node budget on 33 of 40 before), with 31 nodes
expanded a turn instead of 62, and got past the seeds on every turn.

**Seeds** are recall's: the `SPREAD_SEEDS` (24) strongest candidates, words and meaning
both, ranked the way the cut ranks them — not the ~1,000-id cue union. **A seed still
receives nothing** (§6), a choice kept on purpose and worth arguing with: links can
lift a candidate ranked past the seeds into the cut, and can add a quiet pointer, but
they do not reorder the seeds themselves — inside the conversation's own top 24 the
conversation decides. The cost, on the bench: links landed on a kept candidate about
once every other turn (24 in 40 lexical turns, where master's modulate-only rule landed
0; 23 in the semantic arm, where master landed 47 on semantic hits that are seeds now),
and no memory a link lifted reached delivery in either arm. The alternative
is to let a seed receive from OTHER seeds (never its own round trip); it needs
per-origin bookkeeping to exclude the echo, and it is the first thing to try if links
turn out to matter more inside the top than past it.

**Who passed what** (`Contribution.from`): each contribution names the expanded nodes
whose edges reached it and how much each passed. Recall uses it for the quiet pointer's
anchor (recall NOTES §19).

**Temporal contiguity** (`contiguity.ts`, the boundary's `Counterpart.contiguityPass`).
The weak, ubiquitous signal beside co-use's strong one. At each boundary, before its
flush, the memories written since the last pass are placed in their session's write
order and each is linked to its neighbours at lag 1 and 2 (`CONTIGUITY_WINDOW`) —
not all pairs. `CONTIGUITY_RATE` 0.06 at lag 1, `CONTIGUITY_LAG_DECAY` 0.5 at lag 2.
The deltas go into the same buffer and out through the same plan, homeostasis and
sweep as a co-use, and are counted on the boundary's own `associate.flush` row
(`source: "boundary"`, `contiguity`).
- *The order signal, as found.* A memory row carries `origin_session` and `created_at`
  and nothing finer: no span, turn or chapter position. The proposal's own instant
  (`proposal.at`) sets `learned_on` only; `origin.spanHash` exists only on a note (a
  jot), and a proposal's `covers` claims every unclaimed span of the session at once, so
  it orders nothing. Chapter entries carry no memory ids. On the seeded store every
  session's memories share ONE `created_at` (one batch at session end) and insertion
  order is the only order. So: `created_at` then rowid is the sequence; two memories
  written more than `CONTIGUITY_BATCH_MS` (60 s) apart have a real order and get the
  forward bias (forward = the rate, back = `CONTIGUITY_BACKWARD` 0.5 of it); inside one
  batch — the order the model listed them in — both directions get the mean (0.75 of
  the rate). A delta therefore may carry a different b→a half (`PairDelta.back`).
- *At most once.* The cursor (`CONTIGUITY_CURSOR_META`: the newest `created_at` read and
  the ids written at that moment) moves BEFORE anything is buffered, so a failed flush
  drops the pass and a crash after the flush cannot re-plan pairs that landed. A pass
  reads a session again to find a new memory's older neighbours but plans only pairs
  that touch a new memory.
- *The first pass.* With no cursor, only the memories born on the current lived day are
  linked: a new store's first session, not an old store's whole history.
- *Under the floor.* A delta at or under `EDGE_FLOOR` (0.02) on a pair with no live edge
  is written and swept by the same flush (§13's sweep); at 0.06 only a real-order lag-2
  backward delta (0.015) is that small, and it is counted (`underFloor`). It reinforces
  a pair that already conducts.
- *On the bench* (every session linked as if written under this build — the product
  would not do that): 152 pairs across 30 sessions, all one-batch; 596 rows written, 8
  nodes renormalized; delivered memories unchanged, candidates touched by a hop up about
  a quarter. Near silent until use confirms a link, as intended: a 0.045 edge passes 0.6%
  of what its node carries. 596 rows for 152 pairs is 304 directed rows plus siblings
  `plan()` rewrote (touching a node realizes the decay of all its edges) and the
  renormalized nodes — so a count of `rows` ("links written") counts rewrites too.
- *How long they live* (review of #281, finding 7; `S_EDGE` 30, floor 0.02), if no use
  confirms them:

  | edge | weight | lived days above the floor |
  |---|---|---|
  | lag 1, real order, forward | 0.06 | 33 |
  | lag 1, one batch | 0.045 | 24 |
  | lag 1, real order, back | 0.03 | 12 |
  | lag 2, real order, forward | 0.03 | 12 |
  | lag 2, one batch | 0.0225 | 3.5 |
  | lag 2, real order, back | 0.015 | swept at once |

  Lag 2 in the common one-batch case lives three and a half lived days and passes 0.28%
  of its node's activation meanwhile — under the spread threshold even from the
  strongest seed. Kept as built for now; whether it earns its rows (dropping it halves
  contiguity's rows) is the owner's decision.

**After the adversarial review of #281 (same day).**
- *The nightly run's rows are left out* (finding 1). A dream's gists and merges and a
  reflection's entry carry the launching session's id; they were read as that session's
  newest memories and chained to its notes with full waking homeostasis and no waking use
  — the thing #279 refused for dream links. Both reads now know a nightly row by origin
  (`dream:` / `reflection:`, which also catches merges) and by source (`dreamed` /
  `reflection`); the session's sequence skips them and the pass counts them
  (`excluded`).
- *What landed, and what it cost* (findings 2 and 9). The boundary keeps the pairs it
  buffered and, after its flush, says which LANDED as a conducting link, which lost
  their own new link to the count cap (`evictedOwn`), how many OTHER links the cap
  pushed out at nodes contiguity touched (`evictedOther` — possibly waking-learned, which
  is the number to watch while contiguity goes through full homeostasis), and how many
  of those nodes the outgoing bound scaled back (`renormalizedNodes`). Exact on the host,
  where co-use flushes on its own; attributed to contiguity's nodes when a single-process
  caller also co-activated in-process. Doctor now says "buffered … landed", not "linked".
- *A failed pass, and pairs lost before a flush recorded them, leave a row* (finding 3).
  The boundary's `associate.flush` row is also written when the pass failed, buffered
  pairs its flush did not write, or finds an earlier pass's pairs lost; the cursor
  carries a `pending` count until the row about them lands. A crash after the row and
  before the mark is cleared over-reports one pass as lost — the safe direction.
- *Known gaps, stated and not fixed:*
  - **A memory committed behind the cursor is never linked** (finding 6). `created_at`
    is stamped before the write lock is taken, so a writer that stamped earlier and
    committed after a pass read a newer row lands below the cursor: never fresh, never
    linked, not counted. Needs lock contention (which I38 shows happens). A fix would
    re-read from `cursor.at − CONTIGUITY_BATCH_MS` against a small seen set.
  - **Two runners at once could plan one pass twice** (finding 11). The cursor read, the
    row read and the cursor write are not one transaction and the runner has no lock;
    two boundaries inside about a millisecond could buffer the same deltas, doubling one
    pass's weights. A session that ends twice is fine (the second pass is `nothing-new`).
  - **A superseding row is linked as new** (review decision F). `Store.supersede` writes
    a new row with a new `created_at`, so when the successor carries a session it is
    linked next to whatever that session wrote last — up to two contiguity links it did
    not earn. The old row's learned links stop conducting; they are carried over
    (`retargetOnSupersede`) on the paths that go through the composition root — a schema
    revision (`counterpart.ts`, both `supersede` callers) and a dream merge — but not by a
    bare `Store.supersede`, which is what the review's probe called (its successor had no
    edge). An in-place `Store.revise` keeps `created_at` and is never re-linked.

**Index co-credit** was already built by #279 (§13): the hook flattens a reply's
`recall ids:[…]` batches into the credit pass's expansions, every expansion is a
referenced use, and the pair set takes the uses whose strength credit was refused only
for its day cadence. Verified with a test; nothing added.

**Weak credit stays 0** (§2, and the tunable's comment): at v1's 0.25 a
referenced × surfaced pair conducts on its first meeting — "shown beside" linked to
"thought with" — and surfaced × surfaced is swept at every flush, so it can never
accumulate across boundaries; the credit pass passes no surfaced member in any case, and
one loud slot a turn means surfaced × surfaced cannot occur in one reply. The fixture
contract §4 asks for is `association-build2.test.ts` › "6.".

## 15. Regrown chapter copies carry their links (2026-10-09)

The association diagnosis of 10-02 (measured on a copy of the owner's store) found 324
of 1,200 edge rows with an archived endpoint: 260 on chapter copies archived
`episode-regrown`, 54 on dream-merge originals, 10 on corrected memories. Read against the
code:

- **Regrown copies were the gap.** `Self#ingestEpisode` mints a new copy when its chapter
  grows and archives the old one, and nothing handed the old copy's links on. Now `Self`
  takes a `retarget` callback (SEAMS E, the way `schemas/` and `dream/` do; `self/` may
  not import this module) and calls it per archived copy, after the archive, so one stale
  copy's tie to another is not carried. The composition root wires it to
  `retargetOnSupersede`, the merge rule unchanged: the old copy's live outgoing weights as
  they stand on the day, `max` with what the new copy has, both directions, capped. A
  throw costs the links, never the copy (`self.episode.relink.failed`).
- **Dream merges and corrections were not.** Both already go through
  `retargetOnSupersede` (`dream/index.ts`, `revision.ts`). Their 64 rows are the
  originals' own, left in place by design (this module has no delete); the merged or
  corrected memory holds the carried copies.
- **The links already stranded are carried once.** `Counterpart#relinkRegrownCopies` runs
  at open, latched in meta (`REGROWN_RELINK_META`) like the v12 subject backfill: it reads
  the edge table (not the store), finds each source archived `episode-regrown`, and hands
  its links to the chapter's live copy (`origin_ref`), or counts it `noLiveCopy` when the
  chapter has none. A link that has faded below the floor since carries nothing. Writer
  only; fail-open, tried again next open; idempotent if cut short. A carry whose write
  failed (the edge module answers `failed` rather than throwing) leaves the pass
  unlatched, so a store that keeps failing re-reads its edge table at every open until
  one pass lands, as the v12 backfill would.
- *Review of #329.* A copy a removal has taken dark (its edge rows still waiting for the
  chase) carries nothing and is counted `removed`: its links must not outlive the chase on
  the live copy. The live copies come from one `store.copiesOf` read, not a
  `list({ originRef })` per chapter (`origin_ref` has no index). Measured on synthetic
  stores at open: about 800 memories and 1,800 edge rows (130 pairs stranded), the pass
  went from 120–340 ms to about 50 ms; about 15,000 memories and 12,000 edge rows, from
  2.8–3.4 s to about 0.3 s. Most of what is left is one `linkMany` per copy. Every later
  open pays one meta read.
- *Known limits, the merge rule's own:* only the old copy's outgoing rows are read, so a
  row written one way into it would not carry (co-use, contiguity and a dream's links all
  write both ways today), and contiguity's forward-over-back difference becomes the
  stronger outgoing weight both ways. The carry writes through `linkMany`, not the flush,
  so the per-node cap applies at the next flush that touches the copy, not at the carry.
  The archived copy's rows stay until they decay to the floor and a flush sweeps them, so
  a re-run of the 10-02 count will still find them for a while; count what the live copy
  holds, not what the archived one still has.
