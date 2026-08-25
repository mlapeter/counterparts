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
  **PROPOSED** — owner call at check-in. "Consolidating" named a transition, and v1's own
  crossing telemetry reads as movement between the other three.
- **v1's separate salience-strength and gradient-position collapse into one number.**
  **PROPOSED** — owner call at check-in. v1 ran two, decayed one, ranked on a blend, and
  spent a release cycle discovering one was inert (10,470 of 12,375 traces at exactly 0).
  One number cannot go inert unnoticed. Cost if wrong: band membership becomes
  decay-sensitive — intended, but a change.

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
blind encoding must be countable, not invisible). The other three dimensions are
author-supplied, and a claimed salience is a **floor**: `sal(m) ≥ sal_claimed(m)`, clamped
at the proposal→memory seam, any lift logged [v1 §4.1 G3].

### 5.2 Strength — the one number

```
rep(m)  = min( 0.12 × uses(m), 0.5 )                                # v0, verbatim; TUNABLE
cons(m) = 0.2 if consolidated(m) else 0                             # v0, verbatim; TUNABLE
base(m) = max( ω_sal(k) × sal(m),  ω_rep(k) × rep(m) ) + cons(m)    # MAX, not product
strength(m, d) = clamp01( base(m) × D(m, d) )
```

`base` is monotone non-decreasing (salience is fixed, `uses` only rises). The repetition arm
alone tops out at `0.5 + 0.2 = 0.70`, below `Θ_id = 0.85`: **no amount of repetition reaches
identity; only revision does** [v1 §10 G11], enforced by arithmetic rather than a check.

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

```
band(m) = identity if base(m) ≥ Θ_id = 0.85     else                 # TUNABLE (v1's value)
          semantic if base(m) ≥ Θ_sem = 0.50    else  episodic       # TUNABLE
```

**Band membership is evaluated on `base`, not `strength`** — `base` is monotone, so identity
membership never flickers and the decay exemption cannot oscillate.

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

### 5.6 Revision — strength-weighted, no ledger

The writer declares `updates: <id>`. The declaration establishes *that* this is a revision;
physics decides whether it lands.

```
σ(new)     = max( σ_min, novelty(new) )                # surprise; σ_min = 0.30 TUNABLE
F(new→old) = strength(new, d) × σ(new)                 # the challenger's force
REVISE iff  F(new→old) > ι(kind(old)) × strength(old, d)
```

Plus one inherited gate for the slow kinds only (`ι ≥ 0.8`: self, person): the challenger
must have been reinforced on **≥ 3 distinct lived days** [v1 §6.2 G4 — "one odd act doesn't
rewrite your model of a friend"]. Entity, fact, skill, and place are deliberately excluded,
as in v1: world-state should flip on one clear correction.

**Where accumulation went.** A challenger that loses today is still stored. When the same
contradiction recurs it deduplicates onto the challenger (§5.7), raising `uses` → `strength`
→ `F`, until it crosses. Sustained surprise wins; one loud claim against a well-held belief
does not. On REVISE the old version is marked superseded with lineage, stays **resolvable**,
and is retained for `H = 90` lived days (owner decision; TUNABLE). No path deletes it.

**Stated caveat — cosine is negation-blind.** "Mike loves X" and "Mike hates X" are
topically close, so a similarity term alone scores a direct contradiction as *low* surprise.
This contract does not ask cosine to detect contradiction: the declaration carries intent,
`σ_min` floors any declared revision's force, and `novelty` supplies magnitude.
**Calibration-required** (scar §2.8) — `σ_min` ships fixture-bounded or disabled.

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
it: the one-way ratchet of scar §2.10, rebuilt by accident.

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
   and a lift emits an event.
3. **[M]** `base` is monotone non-decreasing: reinforcement re-lifts what decay eroded;
   nothing demotes what salience earned.
4. **[M]** Repetition never reaches the identity band — structurally, from the cap
   arithmetic, not from a removable check.
5. **[M]** Exactly-once decay, by being a pure function of the clock rather than a step.
6. **[M]** One lived-day function, with a totality test over its call sites (scar §2.4).
7. **[M]** Revision requires a declared `updates:` target. There is no inferred-revision
   path, and no arithmetic here edits a memory that was not named.
8. **[M]** A declared revision is never merged into its target by dedup.
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

1. **Ebbinghaus versus flat-per-lived-day.** This page decays exponentially over lived days;
   behavioral-spec §11 G3 states v1's decay as "a flat per-lived-day erosion scaled by the
   kind's durability multiplier — **not** an exponential over calendar time." The objection
   there is to *calendar* time, which this page does not use — but flatness also earned v1 a
   property an exponential does not give free: bands are crossed at most twice between
   reinforcements, so crossing telemetry self-bounds. Unresolved; both shapes are one line.
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
