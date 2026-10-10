# `associate/` — CONTRACT

## 1. Purpose

Memories that come to mind together become linked: co-activation strengthens a typed,
valenced edge, and recall spreads activation across those edges.

## 2. Brain analog

Hebbian plasticity — "cells that fire together wire together" — plus spreading activation
through the resulting associative network. **Named deviations** (constitution line 12):
(a) credit is **retrospective and graded** — full only when the reply actually used the
memory, weak when it surfaced unused, **zero for the merely footnoted**, where in humans
every retrieval trains; (b) homeostasis is enforced structurally (a per-node edge cap and
a bounded outgoing weight with proportional renormalization) rather than emerging from
metabolic limits.

## 3. Keeps

- **Credit is retrospective and graded, and the ignorable tier does not train.** [v1]
  behavioral-spec §10 G1 — resolved at the boundary, with the reply known.
- **Homeostasis is structural.** [v1] §10 G2 — the strength-saturation scar prevented in
  edge space rather than patched after.
- **Evicted edges are archived, never dropped.** [v1] §10 G3 — no-silent-destruction
  applies to learned structure too; the archive may over-record on a crash but must never
  lose the only record of an eviction.
- **At most once, and the direction of the failure is chosen.** [v1] §10 G4 — the write
  ordering is picked so a crash **drops one flush's deltas rather than applying them
  twice**. Doubling is what the contract rules out; bounded loss is inside tolerance. (v1's
  earlier ordering silently inverted this.)
- **Cross-process exclusion with skip-on-busy**, and a buffer drain bounded to what was
  read, so a concurrent arrival is never deleted unflushed. [v1] §10 G5.
- **The declared durability exemption.** [v1] §10 G6 — per-turn deltas may buffer in fast
  mutable state and batch-flush at the boundary: **a crash loses at most one session's
  reinforcement, never a memory.** *Declared rather than discovered* is the part that
  travels.
- **A failed publish emits no success telemetry.** [v1] §10 G7 — an event claiming an
  update that never landed is worse than silence.
- **Spreading activation is bounded**: a hop limit with per-hop decay, and fan
  normalization so a hub node does not flood. [v1] §9 TUNABLE (v1: 2 hops, hop decay 0.5,
  fan normalization on).
- **An erased or pruned id must stop conducting.** [v1] scar §2.2 — v1's erase deleted edge
  rows from the index and then `rebuild()` reloaded the edge file wholesale and
  **resurrected them**, so the erased id kept conducting activation between its former
  neighbors: an association fingerprint that outlived the content.

## 4. Drops / simplifies

- **The hand-serialized edge file is gone.** Edges live in the canonical operational
  database as rows (owner rescope 1, settled). This removes the whole class the harvest
  named: ghost edges, the flush-ordering inversion, the erase-then-rebuild resurrection —
  all three were sidecar bugs, and prose files never minted one (scar §2.1).
- **The learned-edge type coupling becomes a decision instead of an inheritance.**
  **PROPOSED** — owner call at check-in. In v1, learned co-activation edges were written as
  the same type the activation pass boosts by 1.6×, so learning silently rode a multiplier
  intended for *stated* relations. Whether learned edges should be privileged over stated
  ones is a real question; this contract asks it rather than inheriting an answer.
- **Weak credit's numeric weight is not inherited.** It ships bounded by fixtures naming
  what breaks on each side, or disabled (scar §2.8). *2026-09-28: still disabled, and the
  fixture now exists (`association-build2.test.ts` › "6.", NOTES §14).*

## 5. Contract

**Inputs** — the surfacing decision record (what was surfaced, footnoted, and with what
activation); the assistant's reply and the reference-resolution verdict; the memory graph;
the lived day; the observer predicate.
**Outputs** — edge weight deltas, buffered per turn and flushed at the boundary — or
drained to the pending file when the boundary is a different process from the pass
(`pending.ts`, claimed and flushed there); archived eviction records; activation vectors
for `recall/`; telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] Display never trains; engagement does.** *Revised by b2+f8, 2026-10-10, from
   Mike's 09-14 ruling, lightly held. Why: deposit can't work otherwise; the ~0.8 precision
   bar and the saturating cap keep the anti-rich-get-richer intent.* A memory shown and
   passed by (footnoted, surfaced, on the wake) trains nothing, in either direction. One the
   reply DREW ON is credited at the `engaged` tier (`recall/reference.ts#resolveEngagement`,
   G1b). As built on 2026-10-10 that tier trains strength only and joins no pair set; the
   edge deposit from engagement is the association group's (group 4) to add. (Was:
   "Footnotes never train. The ignorable tier is ignorable in both directions.")
2. **[M] Per node, the edge count is capped and the total outgoing weight is bounded**,
   with proportional renormalization. Since 2026-09-28 this covers every edge a dream
   writes too: a dream's `link` and a gist's ties to its sources go through
   `Associate.propose` (live endpoints, pinned frozen, the DECAYED weight) at about one
   co-activation, instead of a raw upsert at 0.3 — and land ONLY WHERE THERE IS ROOM:
   a proposal never evicts or scales down another edge; a pair with no room is refused
   `no-room` and counted. Homeostasis stays the Hebbian flush's. The flush also sweeps
   the rows that carry nothing (an eviction's zero, a weight decayed to the floor;
   never a pinned memory's) and counts them.
3. **[M] Every eviction is archived before the edge is removed.** *Not met today, and
   weaker since 2026-09-28:* an eviction is reported and evented (in-process, bounded)
   and its row zeroed — and the flush's sweep now DELETES that zeroed row, so the table
   no longer keeps even the zero that said which pair was evicted. The durable archive is
   the open ask in INTERFACE-GAPS §2.
4. **[M] At most once**: the flush ordering guarantees a crash loses deltas rather than
   double-applying them, and a test asserts the direction, not merely the invariant.
5. **[M] A contended flush skips and stays buffered**; the drain is bounded to what was
   read.
6. **[M] A failed publish emits no success event.**
7. **[M] Observers train nothing**, checked before any other work (scar E7).
8. **[M] A removed id's edges are removed everywhere and cannot be resurrected by a
   rebuild** — asserted by a test that erases a node, rebuilds the cache, and checks that
   activation no longer flows between its former neighbors (scar §2.2).
9. **[M] Pinned or under-audit memories are frozen in both directions** — an arc under
   audit does not change mid-audit.
10. **[A] Hop count, hop decay, and fan normalization are knobs**, recorded with v1's
    calibration and re-earned here. Working default since 2026-09-28: an edge passes
    `w / max(MAX_OUT_WEIGHT, the node's live sum)` of what its node carries — ABSOLUTE
    weight, not its share of the siblings (NOTES §13) — and each turn's record says what
    the traversal did (seeds, expanded, stop, depth, computed, landed). *Since build 2
    (same day, NOTES §14): the walk is best-first across depths and stops under
    `SPREAD_MIN_FRACTION` of the strongest seed; `MAX_SPREAD_NODES` is a backstop whose
    binding is recorded (`waiting`); a contribution says who passed it what (`from`).*
11. **[M] The durability exemption is declared in this contract and nowhere else.** Any
    second place that buffers non-reconstructible state fails review.
12. **[A] Temporal contiguity is the weak signal, co-use the strong one** (working default,
    2026-09-28, NOTES §14). At each boundary, memories one session wrote next to each
    other are linked to their neighbours at lag 1 and 2 only — not all pairs — at
    `CONTIGUITY_RATE` (0.06, under a co-use's 0.1), forward over back where the write
    order is real time, the same both ways inside one batch. Through the same buffer,
    plan, homeostasis and sweep as a co-use (G2), frozen at a pinned endpoint (G9),
    nothing under observer (G7), and at most once (G4): the pass's cursor moves before
    anything is buffered. Counted on the boundary's `associate.flush` row — what was
    buffered, what landed, what it pushed out, a failed pass, pairs lost before a flush
    recorded them. The nightly run's rows (a dream's gists and merges, a reflection's
    entry) are not the session's and are left out, counted (review of #281).

## 6. Scars honored

**E5** (rescoped: edges are transactional rows, not a hand-serialized file with three
writers) · **E7** (observers train nothing) · **E8** (base-level decay on lived days) ·
**§2.1** (multi-writer structured state needs a transaction) · **§2.2** (a removed id must
stop conducting; supersede retargets edges too — v1's `gist.merge` set `merged_into` and
nothing re-pointed the edges, so successors started cold. So do a dream merge and, since
2026-10-09, a regrown chapter copy, NOTES §15) · **§2.4** (no success telemetry
for a publish that did not land) · **§2.8** (credit weights ship measured or disabled) ·
**§2.17** (edges have an exit path — eviction — and its count is reported).

## 7. Open questions

1. **Should this module exist at all?** *The module map's standing check-in question:*
   **fold `associate/` into `physics/` (the update is math) plus `recall/` (the traversal
   is retrieval)?** The case for folding: constitution line 10 says one brain function per
   module, and "Hebbian linking" may be two halves of functions that already have homes —
   the weight update is arithmetic like every other number on `physics/`'s page, and
   spreading activation is the first stage of retrieval. The case against: the durability
   exemption (§10 G6) and the flush ordering are a *lifecycle* neither host module owns,
   and burying a declared exemption inside a larger module is how declared things become
   discovered things. **Left open deliberately — the owner decides at check-in.**
2. **Are learned edges the same kind of thing as stated relations?** See §4. v1 answered by
   accident; either answer is defensible, and the answer changes what activation means.
3. **Does an association need a valence at all** if strength already carries readiness? v1
   typed and valenced its edges and the harvest does not record the valence ever being
   read.
