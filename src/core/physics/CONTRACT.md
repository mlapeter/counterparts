# `physics/` — CONTRACT

## 1. Purpose

All the arithmetic of memory on one page: strength, decay, reinforcement, revision, dedup,
forgetting — pure functions, no opinions, no model calls.

## 2. Brain analog

Synaptic plasticity and the forgetting curve: potentiation from use, downscaling from
disuse, consolidation moving a trace from episodic to semantic. **Named deviations**
(constitution line 12): (a) identity-band memories are decay-exempt — flashbulb memories
*do* fade in humans, here they do not [v1 §11 G5]; (b) traces never blend — generalization
is only an explicit, provenance-carrying revision, so there is no substrate confabulation
[v1 §4.2 G9]; (c) only a retrieval the assistant actually *used* resets the curve, where in
humans every retrieval reconsolidates [v1 §10 G1].

## 3. Keeps

- **The strength formula's shape — encoding salience, repetition with a cap, a
  consolidation bonus, a decay term.** [v0] `clamp01( mean(salience) + min(accessCount ×
  0.12, 0.5) + (consolidated ? 0.2 : 0) − 0.015 × age_days )`, kept with the decay term
  upgraded (§5.4).
- **Four-dimensional salience {novelty, relevance, emotional, predictive}, 0–1 each, scored
  once at encoding** and never re-scored. [v0]
- **Novelty is prediction error against schema expectations, computed.** [v0 dimension,
  v1 mechanism §8] — schema activation at encoding is what makes prediction error possible.
- **The gradient is a MAX of a salience path and a repetition path, never a product, and
  age is not one of its inputs.** [v1 Appendix A #1] — "a formative one-shot consolidates
  without repetition" is true *only* because it is a max.
- **Per-kind physics tables** (revision inertia, gradient driver, decay multiplier). [v1
  §4.3] — the single most reusable piece of v1 calibration.
- **The active-day clock.** [engram E8, re-earned v1 §11] One lived-day function, every
  site routes through it, rollover at a local boundary hour rather than UTC.
- **Repetition is structurally capped below identity.** [v1 §10 G11] — free here: v0's own
  `0.5` repetition cap plus its `0.2` consolidation bonus sum to `0.70`, already below the
  identity threshold.
- **Graded retrospective reinforcement; the ignorable tier does not train.** [v1 §10 G1]
- **The `updates: <memory-id>` field, declared by the writer.** [v0] — the revision channel
  v0 already had, which v1 rebuilt as the ledger and the owner has now returned to v0's
  shape.
- **Auto-consolidation on a cycle** (v0: every 3 days). [v0]
- **Every constant is TUNABLE; every similarity constant is calibration-required.**
  [v1 scar §2.8]

## 4. Drops / simplifies

- **The contradiction-ledger subsystem — accumulation buckets, per-event caps, decline
  half-lives, forensics holds, retargeting, cooldowns — is replaced by strength-weighted
  revision** (owner decision 2026-08-25, settled). Safe because §5.6 reproduces its
  behavior in one inequality: a challenger not yet strong enough loses today and gets
  stronger by recurring, which is what accumulation was simulating. The bug family the
  ledger minted (dangling targets, retarget-on-supersede, immortal pinned evidence — scar
  §2.2) has no analog, because there is no second object to strand.
- **Materialized decay — a daily pass rewriting every memory's strength into its file — is
  released** (owner rescope 1, settled). Strength is a pure function of stored state and
  the clock; `sleep/` materializes it into a cache column for ranking speed only. This
  makes exactly-once decay (scar E8) true by construction rather than by a per-item stamp.
  See open question 2 for the recorded revisit condition.
- **v1's four gradient bands collapse to three** (episodic / semantic / identity).
  **SETTLED — owner ruling 2026-08-25.** "Consolidating" named a transition, and v1's own
  crossing telemetry reads as movement between the other three.
- **v1's separate salience-strength and gradient-position collapse into one number.**
  **SETTLED — owner ruling 2026-08-25.** v1 ran two, decayed one, ranked on a blend, and
  spent a release cycle discovering one was inert (10,470 of 12,375 traces at exactly 0).
  One number cannot go inert unnoticed. Band membership becomes decay-sensitive for the
  lower bands — intended, and now §5.3's law.

## 5. Contract

**Inputs** — per memory: `salience{novelty, relevance, emotional, predictive}`, `kind`,
`birth_day`, `uses`, `last_used_day`, `consolidated`, `protected`; the lived day `d`; and,
for the similarity functions, embedding vectors *supplied by the caller*.
**Outputs** — numbers and verdicts only: `strength`, `band`, a reinforcement delta, a
revision verdict, a dedup verdict, a prune verdict.

`d` = lived-day integer. `k` = kind. `v(m)` = m's embedding, supplied. `cos` = cosine.

### 5.1 Salience, fixed at encoding

```
sal(m) = mean( novelty, relevance, emotional, predictive )          # v0, verbatim
novelty(m) = 1 − max( cos( v(m), v(e) ) for e in E(m) )             # prediction error
```

`E(m)` is the schema slice m was encoded against (beliefs + current state) unioned with its
`K = 8` nearest existing memories (TUNABLE; v1's semantic seed top-M). `E(m)` empty — a
blind chunk — yields `novelty = null`, recorded, **never defaulted to a number** (scar §2.9:
blind encoding must be countable, not invisible); `sal(m)` is then the mean of the three
author-supplied dimensions (the null case specified, not implicit — review finding 2). The
other three dimensions are
author-supplied, and a claimed salience is a **floor**: `sal(m) ≥ sal_claimed(m)`, clamped
at the proposal→memory seam, any lift logged [v1 §4.1 G3].

A memory whose author claimed **nothing** takes its channel's default floor, applied at the
same seam and only when `claimed` is null: `AUTHORED_DEFAULT_CLAIM = 0.25` on the lived
channel, nothing at all on the others. The number is bounded rather than chosen:
`0.25 + cons = 0.45 < THETA_SEM`, so the default alone can never park a memory in the
semantic band — the arithmetic form of the F5 scar. A default is recorded as `defaulted`
(`salience.defaulted`, plus `meta.claimedDefault` on the row), never as a lift, and an
explicit claim — however low — is never overridden. See NOTES.md item 16.

### 5.2 Strength — the one number

```
rep(m)  = min( 0.12 × uses(m), 0.5 )                                # v0, verbatim; TUNABLE
cons(m) = 0.2 if consolidated(m) else 0                             # v0, verbatim; TUNABLE
base(m) = max( ω_sal(k) × sal(m),  ω_rep(k) × rep(m) ) + cons(m)    # MAX, not product
strength(m, d) = clamp01( base(m) × D(m, d) )
```

`base` is monotone non-decreasing (salience is fixed, `uses` only rises). The repetition arm
alone tops out at `0.5 + 0.2 = 0.70`, below `Θ_id = 0.85` [v1 §10 G11] — and after review
finding 2, the salience arm cannot walk in either: **identity is reached only through §5.3's
explicit promotion (≥ N distinct lived days) or declared revision — never at birth, by
either arm.**

Per-kind constants. `ω` reads v1 §4.3's *gradient driver* column; **TUNABLE,
calibration-required** — v1 recorded which arm drives, not a weight, so the non-driving arm's
number is a proposed reading:

| kind | driver (v1) | ω_sal | ω_rep | κ decay mult. (v1) | ι revision inertia (v1) |
|---|---|---|---|---|---|
| self | salience | 1.0 | 0.0 | 0.70 | 0.9 |
| person | salience | 1.0 | 0.0 | 0.75 | 0.8 |
| entity | both | 1.0 | 1.0 | 0.85 | 0.5 |
| skill | repetition | 0.4 | 1.0 | 0.50 | 0.25 |
| place | repetition | 0.4 | 1.0 | 0.85 | 0.25 |
| fact | both | 1.0 | 1.0 | 1.00 | 0.2 |

### 5.3 Bands

*(Rewritten 2026-08-25 after adversarial review findings 2 and 3: the original
base-evaluated bands were a one-way ratchet with no exit from semantic, and a single
salience-claimed self-write could be BORN into the identity band — decay-exempt,
unprunable, and unrevisable. Both closed below. The §4 note "band membership becomes
decay-sensitive — intended" is the law; the earlier base-evaluated text was the error.)*

```
band(m, d) = identity  if promoted(m)                              # explicit crossing only
             semantic  if strength(m, d) ≥ Θ_sem = 0.50            # TUNABLE, decay-sensitive
             episodic  otherwise
```

- **Nothing is born into identity** (owner ruling, N = 3). At birth, band ≤ semantic
  regardless of claimed salience. Identity is entered only by: (a) a declared revision
  landing on an existing identity element — the successor inherits membership — or (b)
  **promotion at consolidation** after `base ≥ Θ_id = 0.85` (TUNABLE) *and* reinforcement
  on **≥ N = 3 distinct lived days**. The same number, with the same ancestry, as the
  slow-kind revision pace — one rationale, used twice (Amendment 15).
- **Promotion is an explicit, counted crossing event** — a distinct record, never an
  emergent side effect (scar §2.4) — and **identity-band membership is enumerable on
  demand** beside the protected list: permanence and inspectability scale together
  (scar §2.19).
- **Identity stays sticky by design**: decay-exempt (`D = 1`), demoted only by revision —
  the named deviation of §2 stands. **Semantic/episodic are evaluated on decayed
  `strength`**: a faded semantic memory demotes to episodic and gains the prune exit —
  every band now names its way out (scar §2.17 restored), and G12's symmetry counter
  counts something that can actually move both ways.
- The systems-consolidation analog is exact: nothing becomes core identity the day it
  happens; it consolidates in over lived days, or arrives by deliberate revision.

### 5.4 Decay — Ebbinghaus over lived days

```
D(m, d) = 1                                          if band(m) == identity   # named deviation
        = exp( −( d − last_used_day(m) ) / S(m) )    otherwise
S(m)    = S_base × (1 + β × ln(1 + uses(m))) / κ(k)                  # stability, lived days
S_base  = 60      β = 0.5                                            # both TUNABLE
```

- **The active-day clock is the only clock** [E8]: `d` counts days lived, rolling at
  `boundary_hour = 4` local (TUNABLE) — a UTC rollover splits one lived evening into two
  days and corrupts every occasion count downstream [v1 §11 G2].
- **Retrieval resets the curve — the testing effect.** A credited use sets
  `last_used_day := d` and raises `S`, so the next interval is longer. `β` is logarithmic so
  a well-used memory slows its decay without becoming immortal, mirroring v0's capped access
  bonus.
- `κ` **divides**: a fact (`κ=1.00`) erodes fastest, a skill (`κ=0.50`) slowest — exactly as
  v1's multiplier column reads.
- **Decay is idempotent by construction.** `D` is a pure function of `d`; there is no step to
  run twice. v1 needed a per-item `last_decayed_day` stamp to make a monotonic subtraction
  crash-safe (E8's widening); this shape does not.
- `S_base = 60` reproduces v0's `−0.015 × age_days` slope over roughly the first month, then
  flattens — which is the point of the curve.

### 5.5 Reinforcement

```
w = 1.00 referenced by the reply | 0.25 surfaced-unused | 0.00 footnoted    # TUNABLE
uses(m) += w ;  last_used_day(m) := d   (only when w > 0)
```

At most one credited occasion per memory per lived day, and never on its birth day [v1 §10
G9]. Credit is retrospective, resolved at the boundary when the reply is known [v1 §10 G1].
The ignorable tier never trains.

### 5.6 Revision — declared, pressure-accumulated, no second object

*(Rewritten 2026-08-25 after adversarial review finding 1: the original single-shot
inequality `F = strength × σ` had a ceiling at σ — a well-held belief was arithmetically
unrevisable, and the 08-24 exhibit would not have fired. The fix restores the ledger's SUM
in one field, under Amendment 15's earned-machinery rule: the simple version failed with a
named failure, in review, before shipping.)*

The writer declares `updates: <id>`. The declaration establishes *that* this is a revision;
physics decides whether it lands — today, or after sustained challenge.

```
F(new→old) = strength(new, d) × sal(new)     # author-assessed evidence weight;
                                             # novelty plays NO role here (see below)
P(old)     += F(new→old)                     # challenge pressure — a FIELD ON THE
                                             # TARGET row, never a second object
REVISE iff  P(old) > ι(kind(old)) × strength(old, d)
```

- **One credited challenge per target per lived day** (mirrors §5.5's occasion rule): no
  session can spam a belief into flipping. **And for slow kinds only (`ι ≥ 0.8`: self,
  person), the credited daily force is capped at `F_DAY_CAP_SLOW = 0.35` (TUNABLE)** —
  added at implementation (2026-08-25) when the build surfaced that without it one
  flawless claimed-maximal challenge (F = 1.0) crosses even the highest self bar (0.9) in
  a single day, making the ratified "~3 lived days to overturn a friend-model" an
  approximation rather than a bound. With the cap, ≥ 3 lived days is arithmetic
  (0.35 × 3 > 0.9). Entity/fact/skill/place (`ι ≤ 0.5`) are deliberately uncapped: one
  clear, strong correction still flips world-state same-day, as in v1.
- **Every increment is logged** — lived day, challenger id, contributed F. The pressure
  history IS the evidence record, rendered as a story by the dashboard: the ledger's
  explainability at a hundredth of its machinery.
- **P decays like everything else** — the same curve family, keyed to the last challenge
  day — so an abandoned challenge fades instead of lying in ambush.
- **On REVISE:** the old version is marked superseded with lineage, stays resolvable for
  `H = 90` lived days (TUNABLE default — assistant-recommended, not owner-ruled), and the
  successor starts with `P = 0`. Supersession carries or resets the field *on the row* —
  there is no second object to strand, so scar §2.2's dangling family cannot recur.
- **Novelty is out of the force term by design** (review condition (c)): σ was doing double
  duty as detector and magnitude, and because novelty is computed against context that
  *contains the target* when the author was informed, it rewarded blind challenges over
  informed ones. The declaration carries intent; `sal(new)` — the author's own
  how-much-this-mattered — carries magnitude; novelty returns to encoding salience (§5.1)
  only. The cosine negation-blindness caveat is thereby moot on this path.
- Identity-band elements are revisable through this same arithmetic — the review's
  unrevisability ceiling is resolved by summation.

### 5.7 Dedup

```
identical content hash, or cos( v(new), v(orig) ) ≥ τ_dup = 0.95   → merge: uses(orig) += 1
below τ_dup                                                        → leave both alone
```

Ambiguous near-duplicates are **left alone** (owner decision) — accepted rent, paid for zero
substrate confabulation [v1 §4.2 G9]. `τ_dup` is **calibration-required**: in v1's space
arbitrary same-corpus pairs sat at median cosine 0.576, so an intuited floor is inert (scar
§2.8). **A memory that declares `updates:` is never deduplicated into its target** —
otherwise a topically-close refutation merges into the belief it refutes and *reinforces*
it: the one-way ratchet of scar §2.10, rebuilt by accident. **Nor is a revision's
SUCCESSOR ever merged with the challenger it was minted from, in either direction**: the
successor carries the challenger's own words (§5.6), so their bodies are identical by
construction and the hash rule would archive one of them on the revision's own evening.
Both refusals are checked before hash and before cosine. *(8b added 2026-09-04, the first
store that ever crossed the bar: the successor lost the id tie-break and the revised
belief stopped being a belief.)*

### 5.8 Forgetting

Only physics forgets (owner decision): no model, on any path, holds delete power.

```
PRUNE(m,d) iff strength(m,d) < φ = 0.02                            # TUNABLE
           and (d − last_used_day(m)) ≥ D_floor = 90                # TUNABLE, lived days
           and band(m) == episodic  and not protected(m)
           and m is neither successor nor predecessor in a live revision chain
```

A prune is recorded — counts, kind, dates, never a body and never a content hash (scar
§2.20) — and is the only physics-driven removal. Everything else merely fades: a
low-strength memory is still present and still retrievable by a strong enough cue.

### 5.9 Guarantees

**[M]** mechanized · **[A]** advisory (scar §2.6's razor).

1. **[M]** Physics makes no model calls and performs no I/O. Vectors are inputs; this module
   never fetches one. A test asserts it imports nothing from `store/`, `encode/`, or any
   client.
2. **[M]** Salience is fixed at birth; a claimed salience is a floor, clamped at the seam,
   and a lift emits an event. An UNCLAIMED memory takes its channel's default floor —
   recorded as a default, not as a lift — and no default can reach `THETA_SEM` on its own.
3. **[M]** `base` is monotone non-decreasing: reinforcement re-lifts what decay eroded;
   nothing demotes what salience earned.
4. **[M]** Repetition never reaches the identity band — structurally, from the cap
   arithmetic, not from a removable check.
5. **[M]** Exactly-once decay, by being a pure function of the clock rather than a step.
6. **[M]** One lived-day function, with a totality test over its call sites (scar §2.4).
7. **[M]** Revision requires a declared `updates:` target. There is no inferred-revision
   path, and no arithmetic here edits a memory that was not named.
8. **[M]** A declared revision is never merged into its target by dedup.
    **8b. [M]** A revision's successor is never merged with its challenger, in either
    direction — the lineage is a store fact the caller supplies, the refusal is named
    (`revision-successor-never-merged`), and it is checked before hash and cosine.
9. **[M]** Superseded versions stay resolvable for `H` lived days; nothing here deletes one.
10. **[M]** Prune is gated on all five conditions and is recorded; no model-reachable caller
    can invoke it.
11. **[A]** The per-kind tables are v1's calibration, not law. They ship with a recorded
    calibration and a fixture-bounded window, or disabled (scar §2.8).
12. **[M]** Up-moves and down-moves are counted separately, per kind, with a stated expected
    ratio — the symmetry counter that made v1's one-way ratchet visible (scar §2.10).

## 6. Scars honored

**E8** (active-day clock, idempotent under replay) · **§2.2** (supersede is a graph
operation — answered by having one object, not two) · **§2.4** (symmetry counters; the
null-novelty record) · **§2.6** (mechanize invariants; instruct only preferences) ·
**§2.8** (no threshold ships unmeasured against the real space) · **§2.9** (blind encoding
is counted, not defaulted) · **§2.10** (strengthening without a live softening path is a
ratchet) · **§2.17** (every kind names its exit — here prune and supersede) · **§2.20**
(prune records carry no body and no hash).

## 7. Open questions

1. **Decay shape: flat vs exponential vs power-law — a THREE-way, decided by replay** (owner
   ruling 2026-08-25: Ebbinghaus-family default, evidence picks). v1 ran flat per-lived-day
   erosion (its README's objection was to *calendar* time, which this page does not use, and
   flatness self-bounds crossing telemetry). This page defaults exponential. And engram —
   the production ancestor — deliberately upgraded exponential → **power-law**, citing
   Ebbinghaus/Wixted/Jost (review finding 4's addendum; line 12 wants that ancestry named).
   All three are one line; `tools/replay` runs all three against v1's recorded month.
2. **Lazy versus materialized strength.** Default here: pure function, materialized by
   `sleep/` into a cache column for ranking. v1 materialized deliberately (ratified
   2026-08-08: "a memory stating its own current strength is directly trustworthy") with a
   filed revisit trigger, and the harvest hands v2 this as an open choice with the evidence
   attached. The recorded revisit condition survives: **a 50–100× store-size increase**
   flips the cost argument (SYNTHESIS adjudication 3).
3. **Do the non-driving arm weights (`ω = 0.4` for skill/place salience) exist at all?** v1
   recorded a driver, not a weight. Zero is simpler and defensible.
4. **Does `associate/`'s edge arithmetic belong on this page?** The module map's standing
   check-in question; owned by `associate/CONTRACT.md` open question 1.
5. **What is the honest floor-prune dwell time?** `φ` and `D_floor` are guesses. v1 never
   pruned, so there is no measurement to inherit — the one constant here with no ancestry.
