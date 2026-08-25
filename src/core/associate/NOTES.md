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
   re-walking itself.

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
