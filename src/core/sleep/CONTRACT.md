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
  [v1 §5 G4]
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
  everything except the floor prune, which is the one deletion and is recorded.
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
  construction rather than by a per-item stamp.
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
8. **[M]** Every prune is recorded — counts, kind, dates; never a body, never a content hash
   (scar §2.20) — and a failed record append means nothing moves.
9. **[M]** A memory that declares `updates:` is never merged into its target (`physics/`
   §5.7) — otherwise a refutation reinforces the belief it refutes.
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
