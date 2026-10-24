# `associate/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

## 1. Purpose

Memories that come to mind together become linked: co-activation strengthens a typed,
valenced edge, and recall spreads activation across those edges.

## 2. Brain analog

Hebbian plasticity — "cells that fire together wire together" — plus spreading activation
through the resulting associative network. **Named deviations** (constitution line 12):
(a) credit is **retrospective and graded** — full only when the reply actually used the
memory, weak when it surfaced unused, and the footnoted tier's own credit factor zero, where
in humans every retrieval trains. *Since 2026-10-19 (the feedback loop):* an unrated footnote
is a `shown` glimpse today (a use at `W_SHOWN`, credited at a `rated` boundary), and memories
shown on one turn there lay a faint edge (`SHOWN_TOGETHER_DEPOSIT`, G1 below); memory-to-memory
pairs train only on credited use. (Was: "zero for the merely footnoted".) *Since 2026-10-24
(R3 cue learning — an experiment):* a footnote SHOWN AND ACTED ON trains its cue pairs — the
words of the turn that showed it, wired to it — through a rating (1 a little, 2–3 fully, 0
depresses) or `drewOn`; one merely shown and passed by still trains no cue pair. (b) homeostasis is enforced structurally (a per-node edge cap and
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
- **Cue pairs, the same homeostasis** (2026-10-24, R3 cue learning — an experiment;
  switch `physics.CUE_LEARNING`). The node Hebb was missing: the CUE WORD. A credited use
  wires the words of the turn that showed the memory to it (`cue_edges`, index terms only),
  split over the words by their weights. Bounded like edges and by the same machinery: a
  saturating update per pair (`CUE_W_CAP`), synaptic scaling per word (`CUE_MAX_OUT`),
  exponential fading with lived days (`S_CUE`) and a floor the flush sweeps; deltas
  buffered (`buffer.ts#CueBuffer`, the declared exemption), drained to the pending file on
  the hook path, applied by the worker in the same claim as the pairs and after them (at
  most once for both), skipped on busy, refused for a pinned or no-longer-live memory, and
  nothing at all under observer — written or read. Erasing a memory deletes its pairs (the
  removal counts them), and every pair out of one of its words that no memory holds after it
  (the privacy guard, df > 0, kept true after the fact — review of #613); a pruned or merged one's are swept at the next cue flush.
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

1. **[M] Display trains nothing outside a rating; engagement does — strength only.**
   *(Heading reworded 2026-10-24: it read "Display never trains", which the 2026-10-19
   amendment below contradicts — at a `rated` boundary display leaves a faint trail.)*
   *Reworded 2026-10-11 by
   the drewOn builder, from Mike's 10-10 direction, lightly held (wording from #371).* A
   memory shown and passed by (footnoted, surfaced, on the wake) trains nothing, in either
   direction. One the session NAMES in a `drewOn` field is credited at the `engaged` tier
   (`Counterpart#creditDrewOn`) for strength; *since 2026-10-11 (group 4, NOTES §17)* the
   memories one `drewOn` names together also enter one pair set at the `referenced` tier,
   so each pair gets a co-use's `HEBB_RATE` deposit — the tier comes from the engagement,
   not from the lane that showed it (review 06 C1). (Was: "Footnotes never train. The
   ignorable tier is ignorable in both directions.")
   *Amended 2026-10-19 — an experiment, not a ruling (the feedback loop; check on ~10-22;
   revert by setting `CO_USE_DEPOSIT` and `SHOWN_TOGETHER_DEPOSIT` to 0).* Trying strong
   co-use links, to see whether quiet pointers start to show and get used. At a `rated`
   boundary (`Counterpart#rateShown`) the memories CO-USED in the stretch since the
   session's previous rating — rated 2 or 3, or otherwise used there (opened, quoted,
   `drewOn`), never one rated 0, at most `CO_USE_MAX_MEMBERS` — are linked pairwise at
   `CO_USE_DEPOSIT` (0.25: two co-uses clear the quiet-pointer weight, 0.4), and memories
   shown on the same turn of the stretch, none rated 0, at `SHOWN_TOGETHER_DEPOSIT` (0.05).
   So display alone now leaves a faint trail when the session did not call it noise. Both
   go through `Associate#deposit` into the same buffer and pending file as a co-use: the
   count cap, the outgoing bound (G2), decay, the sweep, the frozen endpoint (G9) and the
   observer stand-down (G7) hold. The hop arithmetic and the pointer threshold are not
   touched.
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
    other are linked to their neighbours at lag 1 only (lag 2 dropped 2026-10-11,
    NOTES §17) — not all pairs — at
    `CONTIGUITY_RATE` (0.06, under a co-use's 0.1), forward over back where the write
    order is real time, the same both ways inside one batch. Through the same buffer,
    plan, homeostasis and sweep as a co-use (G2), frozen at a pinned endpoint (G9),
    nothing under observer (G7), and at most once (G4): the pass's cursor moves before
    anything is buffered. Counted on the boundary's `associate.flush` row — what was
    buffered, what landed, what it pushed out, a failed pass, pairs lost before a flush
    recorded them. The nightly run's rows (a dream's gists and merges, a reflection's
    entry) are not the session's and are left out, counted (review of #281).
    *Since 2026-10-11 (group 4, NOTES §17) the same pass gives each new memory a faint
    link (`WRITE_LINK_WEIGHT` 0.05) to what was in mind when it was written — for a memory
    written in the moment (the jot door), what recall showed its session on the write's
    own turn; a write-up's, a catch-up's or a chapter copy's memories get none (review of
    #423) — through `Associate.propose`: room-only, never evicting. It is the new memory's
    encoding context; the shown memory's strength does not change (G1).*
    *Amended 2026-10-19 — an experiment, not a ruling (agreed with Mike; check on ~10-22;
    revert by setting `WRITE_LINK_MAX` back to 4): write-time links are OFF
    (`WRITE_LINK_MAX` 0), so the pass lays none and the flush row carries no `atWrite`.
    Trying it to see whether co-use links from ratings build the graph without the noise
    (at most 3 of 161 write-time pairs were ever reinforced; the 2026-10-18 association
    diagnosis). Contiguity is unchanged, and edges already laid are kept and fade like any
    other.*

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
