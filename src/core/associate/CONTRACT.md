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
  what breaks on each side, or disabled (scar §2.8).

## 5. Contract

**Inputs** — the surfacing decision record (what was surfaced, footnoted, and with what
activation); the assistant's reply and the reference-resolution verdict; the memory graph;
the lived day; the observer predicate.
**Outputs** — edge weight deltas, buffered per turn and flushed at the boundary; archived
eviction records; activation vectors for `recall/`; telemetry by reference.

**Guarantees** — **[M]** mechanized, **[A]** advisory:

1. **[M] Footnotes never train.** The ignorable tier is ignorable in both directions.
2. **[M] Per node, the edge count is capped and the total outgoing weight is bounded**,
   with proportional renormalization.
3. **[M] Every eviction is archived before the edge is removed.**
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
    calibration and re-earned here.
11. **[M] The durability exemption is declared in this contract and nowhere else.** Any
    second place that buffers non-reconstructible state fails review.

## 6. Scars honored

**E5** (rescoped: edges are transactional rows, not a hand-serialized file with three
writers) · **E7** (observers train nothing) · **E8** (base-level decay on lived days) ·
**§2.1** (multi-writer structured state needs a transaction) · **§2.2** (a removed id must
stop conducting; supersede retargets edges too — v1's `gist.merge` set `merged_into` and
nothing re-pointed the edges, so successors started cold) · **§2.4** (no success telemetry
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
