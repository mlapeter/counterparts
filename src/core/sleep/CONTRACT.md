# `sleep/` — CONTRACT

## 1. Purpose

The librarian: pure physics on a cycle — the decay refresh, dedup, consolidation, floor
pruning, and re-rendering the wake briefing. No standing model calls.

## 2. Brain analog

Systems consolidation during sleep: replay, schema integration, synaptic downscaling, and
the pruning of what was never used. **Named deviations** (constitution line 12): (a) it runs
as boundary-time micro-sleeps rather than one nightly block, because a session end is when
the material is freshest and the host is idle; (b) it prunes at the floor — human forgetting
is loss of access, not deletion, and this module deletes, loudly and on physics' verdict
alone.

## 3. Keeps

- **The cycle moves MEMORIES, and the journal is not one.** [added 2026-09-04, measured]
  An episode is the owner's first-person account and the source a memory was made from —
  "context and source, in that order, ingested ONCE as an ordinary memory"
  (`self/episodes.ts`). Forgetting applies to what was minted FROM an episode, never to the
  episode itself (constitution 6: the owner owns the data, in prose readable in any editor;
  7: memory changes like human memory — a claim about memories). Every phase here was
  written when every row in the store was a memory; episodes only became real when the
  chapter door shipped, and on the live store all **224 migrated episodes sit in the
  episodic band at zero on every salience dimension**, so the floor prune would have
  archived the entire journal — and an archived episode stops reconciling, so the memories
  it had not yet minted would never exist.
- **Detached from the host, single writer, hard watchdog.** [engram E4, v1 §5 G1] — one
  lock; a live holder inside its lease is respected; a stale lease is reclaimed
  **atomically**, so N simultaneous reclaimers produce exactly one winner. (v1's earlier
  unlink-then-create reclaim produced two live writers and a double-ticked clock.)
- **Two watchdog levels and a cross-key invariant binding them** — configuration **refuses**
  any setting where the hard kill could land after the lock becomes reclaimable. *The
  single-writer lease depends on a wedged runner dying before its lock can be taken.*
  [v1 §5 G2]
- **Per-concern completion markers, advanced only after the work *and* its persist succeed**,
  gating on "active day > my marker", never on a transient "is this a new day" flag. A crash
  between the clock ticking and the work finishing **replays that day exactly once**. Markers
  only move forward. [v1 §5 G3, engram E8]
- **A budget is not a debt** — a day the work wasn't needed is not arrears to make up.
  [v1 §5 G4] *Where a phase RESUMES under that rule is a separate question, and a working
  answer rather than a guarantee: `NOTES.md` §8.*
- **Phase order is behavior, not implementation.** [v1 §5 G5] The consequences that must
  survive: decay runs *after* the boundary's own writes (hence the same-lived-day
  reinforcement exemption); revision-dependent renders run *after* revision, so they see this
  boundary's own supersedes; the briefing is the **last content write**.
- **Degrade, don't abort** — index rebuild, embedding refresh, horizon computation, backup,
  and every prune each fail without failing the cycle. [v1 §5 G6]
- **The claim is truncated only after results are applied AND persisted.** [v1 §5 G7, E6]
- **Environment is pinned by the spawner, last**, so no caller can leak a run into the wrong
  store. [v1 §5 G8, scar §2.13]
- **Decay's skip list is behavior, and each skip is reported separately** — archived
  memories; anything under audit; **identity-band memories** (the named deviation); and
  **anything reinforced the same lived day**. [v1 §11 G5]
- **Calm by default** — a quiet day produces almost no motion. [v1 §11 G8]
- **A torn clock is loud, and repair moves forward only** — clamped forward against canonical
  stamps, markers snapped with it, so recovery never retro-runs history; an upgraded store
  initializes markers to the present. [v1 §11 G9]
- **Expiry archives, never deletes, and names what it archived** [v1 §11 G7] — still true of
  everything except the floor prune, which is the one deletion and is recorded. *(The floor
  prune has since resolved toward archival — `NOTES.md` §2. What this module DOES delete,
  loudly and counted, is telemetry: superseded-version rows past `H` and, since
  2026-09-05, unlatched event-log rows past the retention window — §5 G16. Neither is a
  memory; v1's spec names telemetry as "the one system-path exception to no-deletion —
  bounded-retention logs" (`docs/harvest/behavioral-spec.md` #17; `log-audit.md` §3
  records v1's `pruneLogs` as exactly that exception), and the sweep is not silent.)*
- **Autonomous, budgeted, and loud**: at most once per lived day, on its own trigger, never
  an owner chore — *"I won't remember to run random scripts occasionally."* [v1 §7 G8]
- **Over-budget is measured at full membership, not on the rendered output** — a renderer
  that demotes until it fits *by construction never reports being over budget*. [v1 §7]
- **Auto-consolidation on a cycle** (v0: every 3 days) — the pass that links a memory to its
  schemas and sets the consolidation bonus in `physics/` §5.2. [v0]

## 4. Drops / simplifies

- **The librarian is pure physics with ZERO standing model calls at launch** (owner decision
  2026-08-25, settled). Definitionally: zero *generative* calls. **Embedding lookups are
  permitted arithmetic** — the owner's own dedup-by-cosine decision presumes them — and they
  degrade to lexical-only rather than fail (scar E1). The v1 phases that were model calls go
  with their subsystems: the interpretation sweep (now a crash fallback owned by
  `remember/`), the accommodation invitation (replaced by strength-weighted revision), the
  gist-merge proposal pass, and the recompression proposal pass. What remains of
  recompression is the render and its archive-first discipline — see open question 3.
- **The daily materialize-decay pass is released** (owner rescope 1, settled). Strength is a
  pure function of stored state and the clock (`physics/` §5.4); this module refreshes the
  cached column used for ranking. Because the number is derived, a replayed day is a no-op by
  construction rather than by a per-item stamp. *(Amended 2026-09-14, IMPROVEMENTS U8: the
  box-2 `band` column is the exception and is the band of record — the decay pass writes a
  row's band back when the column disagrees with `band(m, d)`, so the table cannot contradict
  the `band.transition` rows the same pass emits. Strength is still cache-only, the write
  fires only on disagreement, the reconciliation counts into the phase's `changed` and is
  reported as `reconciled` on the phase report and the durable `sleep.cycle` row, and
  `NOTES.md` §5 carries the reasoning.)*
- **The accommodation phase, the ledger phase, and their forensics holds are gone** (owner
  decision, settled) — see `schemas/CONTRACT.md` §4.
- **Hygiene's model-proposed gist merges are dropped in favour of physics dedup**: hash plus
  embedding cosine, ambiguous near-dupes left alone (owner decision, settled). v1's own
  record supports it — `hygiene.run` fired twice in a month.
- **Floor pruning is added, and it is the one place the system deletes.** Physics alone
  decides (`physics/` §5.8); no model holds delete power on any path (owner decision,
  settled). **This is a real departure from v1**, where fading was explicitly not deletion
  and ~10K of 12.4K memories sat at the floor as "the thesis working, not a backlog."
  Flagged, not resolved: open question 1.

## 5. Contract

**Inputs** — the store; the lived-day clock and its completion markers; the lock; the
observer predicate; the host's reported execution ceiling.
*A SCHEMA ROW DOES NOT CROSS into the identity band, from 2026-09-18. Only the crossing is
withheld — a belief is still consolidated exactly as it always was, so no strength
trajectory changes — because "this row entered the identity band" is a claim about a
MEMORY, and a belief, an entity, the identity core and the self page are standing claims
with their own machinery for changing. `dedup` has skipped schema rows whole since it
shipped; this is the narrower half of the same thought. Proved reachable by the self page's
adversarial review: forty cycles over a page carrying the physics repeated credit leaves
produced a `band.promoted` record on a row no lane can rank.*
**Outputs** — a refreshed strength cache; dedup merges; consolidation links; prune verdicts
and their records; the next session's briefing, written last; a per-cycle summary vector
(content-by-reference).

**Guarantees** — **[M]** mechanized · **[A]** advisory:

1. **[M]** Zero generative model calls, asserted by a test over this module's call graph.
   Embedding calls are permitted, isolated per batch, and degrade to empty-and-logged rather
   than throwing (scar E1).
2. **[M]** Single writer, atomic stale-lease reclaim, and a configuration check that refuses
   any watchdog/lease setting where a wedged runner could outlive its lock.
3. **[M]** Every day-gated concern is idempotent under replay — by being a pure function or
   by carrying a per-item stamp; a test replays each twice and asserts the second is a no-op
   (scar E8).
4. **[M]** Markers advance only after the work and its persist both succeed, and only move
   forward.
5. **[M]** Phase order is asserted, including the three consequences in §3.
6. **[M]** Every optional phase degrades without failing the cycle, and each degradation is a
   distinct record — "did not run", "ran and found nothing", and "failed" are three things
   (scar §2.4).
7. **[M]** Nothing under audit or in a live revision chain is decayed, merged, or pruned.
   **What the code enforces, stated exactly** (the wording above was wider than the
   predicate, and 2026-09-04's dedup finding lived in the gap): PRUNE reads
   `prune.ts#inLiveRevisionChain` — a row with a forwarding address, a row with standing
   pressure, or a row whose version rows still point at a successor inside `H`. That
   predicate reads FALSE for a fresh successor, which has none of the three, so it never
   protected the head of a chain and dedup never consulted it at all. DEDUP's protection
   of the head is G9b's, by its own rule, and after it the two known ways to lose a
   successor to a merge are closed. *The gap this paragraph named on 2026-09-04 — an
   element whose statement collides with an ordinary memory's body with no revision
   anywhere, which G9b cannot reach — is closed by **9c** below (2026-09-05). Nothing is
   open under this wording today.*
8. **[M]** Every prune is recorded — counts, kind, dates; never a body, never a content hash
   (scar §2.20) — and a failed record append means nothing moves.
9. **[M]** A memory that declares `updates:` is never merged into its target (`physics/`
   §5.7) — otherwise a refutation reinforces the belief it refutes.
   **9b. [M] A revision's SUCCESSOR is never the losing candidate of a same-hash merge**,
   and never merges with the challenger it was minted from in either direction
   (`physics/` §5.7 G8b; `dedup.ts` reads `source: "accommodation"` + `origin_ref` off the
   row — the two supersede sites that mint with lineage, `schemas/index.ts` for both
   element arms and `revision.ts` for the identity arm). The successor carries the
   challenger's own words, so the two share a content hash BY CONSTRUCTION and G9 cannot
   reach the pair — its declaration names the PREDECESSOR. The rule is "never the loser"
   rather than a pair relation because a THIRD row with the same text takes the original's
   seat and the pair reads false against it; an accommodation row can never legitimately
   lose such a merge, since its body is its challenger's body and every same-hash group it
   is in is that challenger plus twins of the same sentence. The cosine path is untouched:
   a merely SIMILAR row is an ordinary near-duplicate question. *Found 2026-09-04 on the
   first store that ever crossed the pressure bar: the successor lost the tie-break
   (`mem_` before `sch_`), was archived `merged` on the revision's own evening, and the
   revised belief stopped rendering as a belief — constitution 7. The same shape as G15's
   journal finding: a phase written when identical bodies could only mean a duplicate.*
   **G9b IS STILL LOAD-BEARING under 9c**, and not belt-and-braces: `schemas/index.ts`
   mints element successors as `type: "schema"` (which 9c now covers), but
   `revision.ts`'s IDENTITY arm mints its successor as `type: "memory"`, and for that row
   G9b is the only rule between it and the challenger whose words it carries. A test
   pins exactly that case.
   **9c. [M] A `type: "schema"` row is never a dedup candidate, in either direction, on
   either path** (`types.ts#isSchemaRow`, read where `runDedup` builds the live set, so
   `contentHashCandidates` and any injected cosine source are covered by construction
   rather than one at a time; an injected source that hands one over anyway is named
   `schema` in the skip map, not `already-archived`). A belief or a current-state row is
   a standing claim with its own machinery for changing — `schemas/` §5.6 (a belief moves
   only when a challenger's force beats its inertia, and the old version is kept with
   lineage), §5 G1 (no operation edits a belief), §5 G4 (near collisions refuse LOUDLY
   rather than merging) — and "these two say the same thing, so they are one thing" is a
   claim about NOTES. Duplicates among elements are a `schemas/` question and are
   deliberately not answered here. The exclusion is narrow: two ordinary memories with
   one body still merge, and a test says so. *Probe H, found by the adversarial review
   2026-09-04 and closed 2026-09-05: an `addBelief` with statement X and a memory with
   body X, born the same lived day, no revision anywhere. G9b could not apply, `mem_`
   sorted before `sch_`, and the belief was archived `merged` — `beliefs(entity)` empty,
   constitution 7 again. Migration settles the DIRECTION of the loss and not its
   frequency: `tools/migrate/apply.ts` minted every element at the import day while
   migrated memories kept their v1 birth day, so on any such pair the memory is never
   younger and the element always loses — but a pair needs two distinct v1 items whose
   gated text is byte-identical, so the count is unknown and only a scan can give it. The
   repair for stores that already lost one is `counterparts repair-merged-beliefs`
   (`cli/` §5, `store/owner-op-seam.ts#unarchiveMerged`).*
10. **[M]** Observer sessions spawn no cycle at all — a cycle advances the clock, decays the
    store, and rewrites the briefing: *the instrument mutating what it measures* (scar E7).
11. **[M]** A worker that cannot run — missing credential, unmet dependency, repeated
    identical failure — escalates on the *n*th occurrence instead of re-logging the same line
    forever, and its backlog depth is a reported metric (scar E4: v1's runner starved for two
    days on an inherited credential and drained only when someone noticed).
12. **[A]** Cadences — consolidation every 3 lived days, backup daily, prune dwell — are
    knobs. That each has a completion marker and a tripwire is mechanized.
13. **[M]** Created-versus-exited counts per kind are reported every cycle; a kind with a
    zero exit count after the bake-in window is a defect to investigate (scar §2.17).
14. **[M]** Band moves are counted BY DIRECTION and the count is durable — the decay
    materialization diffs each row's band against its last reading and appends a latched
    `band.transition` record; a first materialization is not a crossing. At cycle end those
    rows feed `physics.symmetryCheck` per kind and the verdict is reported. **Below
    `SYMMETRY_MIN_SAMPLE` the verdict is `never-asked`, which carries `ok: true`: every
    consumer reads the REASON, never the boolean** (scar §2.4). A store whose port cannot be
    asked gets no verdict and says so, rather than six `never-asked` rows claiming a counter
    that does not exist was consulted. *(Added 2026-08-25 — physics guarantee 12 had been
    enforced in one place and consumed by nobody, which is how v1 ran 279 up-moves against
    zero down-moves for three days with a tripwire already in the codebase — scar §2.10.)*

15. **[M]** **The journal is outside every phase.** One predicate — `types.ts#isJournal`
    — is read by decay, dedup, consolidate and prune, so the rule cannot hold in three
    places and lapse in the fourth. A journal row is never decayed, never given a strength
    row, never moved across a band, never consolidated or promoted, never merged, and never
    pruned; it is **counted as a named skip** in each phase (`journal`) rather than passed
    over in silence, and G13's created-versus-exited census counts memories only, since a
    chapter written today is not a memory born today and would give its kind a permanent
    created-without-exit imbalance — the exact signal that counter exists to raise. What
    the journal produces IS subject to everything: the ingested memory decays, consolidates,
    merges and is pruned like any other. *Two findings, a day apart and the same shape:
    dedup merged an ingested memory into its own episode (identical prose, identical
    content hash) at the boundary that minted it; and prune would have taken the whole
    migrated journal at the floor.*

16. **[M]** **The durable event log has bounded retention, and the cycle is what bounds
    it.** The `log` phase — the cycle's LAST phase, after the briefing, which stays the
    last CONTENT write (§3 G5: the sweep writes no content) — calls `Store.pruneEvents`
    with the phase budget as its cap. **Retention:** an unlatched row is deleted once its
    lived day is older than `retentionDays` lived days (`day < livedDay − retentionDays`).
    `retentionDays` is the store's option, default `DEFAULT_RETENTION_DAYS` = 90 lived
    days, and **the default is pinned ≥ 90 by a test** — the parallel run reads its
    evidence off this table (`tools/parallel/readers.ts`) and needs ≥ 7 active days plus
    review slack, so a shorter default would destroy the run's record from under it; no
    reader found on 2026-09-05 needs more (`NOTES.md` §15 lists them). **Kept by kind:**
    every row the store latches with a `dedup_key` — `memory.pruned`, `memory.merged`,
    `memory.unmerged`, `band.promoted`, `band.transition`, `revision.pressure`,
    `gate.chunk` — is kept at any age; that is what `repair-merged-beliefs`, the owner's
    read-only check (`memory.merged` rows with `sch_` losers), the symmetry counter (G14)
    and `schemas.story()` read, and the phase counts them as the named skip `latched`
    rather than passing over them in silence. **Bounded per pass:** at most
    `TUNABLES.BUDGETS.log` (5,000) rows go per cycle, OLDEST FIRST by `seq`, so a store
    swept for the first time takes its backlog a cap's worth a day; the rows left are
    `skippedForBudget`, reported and never owed (§3: a budget is not a debt). **Idempotent:**
    once per lived day by marker (a replayed day is `already-done-today`), and a clean
    window is `ran-nothing-found` on the phase and `pruned: 0` on the store. **Observer:**
    computed from the read-only census, `changed` carries the would-delete count, and
    nothing is attempted. **Legible before it runs** (constitution 16): `counterparts
    verify` prints the rows held, the oldest row's lived day and date, the latched count,
    and what the next pass would delete. *Filed 2026-09-05 as `NOTES.md` §13: `pruneEvents`
    existed, documented this window, and had no caller anywhere in `src/` — every unlatched
    row ever written was still there, and the dashboard's "I keep events for N lived days;
    older ones are swept" described a sweep that never ran. Owner ruling the same day: wire
    it into sleep.*

## 6. Scars honored

**E1** (per-batch isolation on the embedding refresh) · **E4** (detached execution,
watchdogs, and a starved worker that alarms) · **E5** (rescoped: one documented lock at the
seam between the owner CLI and the background worker, staleness validated against every
watchdog that can hold it, never held across a human prompt) · **E6** (restore before
consume) · **E7** (no cycle under observer) · **E8** (active-day clock, idempotent under
replay) · **§2.1** (transactional state changes) · **§2.4** (every discard logs what and how
much) · **§2.11** (the backup phase is asserted against the layout; the canonical database is
checkpointed, never copied — see `cli/`) · **§2.13** (the spawner pins the environment last) ·
**§2.17** (curation paths must fire) · **§2.20** (prune records are content-by-reference).

## 7. Open questions

1. **Does the floor prune actually delete?** The module map calls it "real forgetting"; v1's
   §11 G6 says the opposite in as many words ("fading is not deletion... human forgetting
   deletes; this only fades"), and v1's live shape — ~10K of 12.4K memories at the floor — was
   read as the thesis working. Deleting is simpler and honest to constitution line 3; not
   deleting costs disk and keeps a strong cue able to reach anything. **Flagged, not
   resolved.**
2. **Ebbinghaus versus flat-per-lived-day decay** — `physics/` open question 1. The choice
   changes what a "calm day" looks like in this module's telemetry.
3. **Does recompression need a model?** Shortening a statement while preserving first person,
   the author's voice, and load-bearing specifics is a generative job. *Correction (adversarial
   review, finding 4): v0's briefing WAS model-compressed — `generateBriefing` was an API call
   instructed to fit 2,000 chars; the earlier text here inverted that evidence.* The honest
   position: launch renders the briefing WITHOUT a model (rank by strength, take what fits the
   budget, verbatim statements) — not because v0 did, but because Amendment 15 says the simple
   rule goes first. If briefing quality fails in use with a named failure, recompression is the
   first candidate to earn a model call back — and v0 is the precedent FOR that call, not
   against it.
4. **Is one lock still the right shape** when the operational box is transactional? The
   remaining need is coordinating prose writes with the owner CLI — a narrower job than v1's
   lock did.
