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
humans every retrieval reconsolidates [v1 §10 G1]; (d) a DREAM's replay counts as a
return worth half an awake one and toward no core lane (§5.11) — sleep replay does
strengthen human memory, but here a dream is the model's own pass, so it is discounted and
kept out of the door to identity.

**Since 2026-09-26 (owner decisions, dreaming + consolidation)** the analog is sharper:
durability comes from SPACED RETRIEVAL — Ebbinghaus's savings (1885), the spacing effect
(Cepeda et al. 2006), Bjork & Bjork's storage strength (1992: each retrieval makes the
trace harder to lose, more so after a gap) — rather than from a one-time bonus; and the
identity band is systems consolidation for memories about me or about us, by two lanes: a
strongly felt one that comes back (the amygdala's stamp plus one reactivation), or one
that keeps coming back over weeks.

## 3. Keeps

- **The strength formula's shape — encoding salience, repetition with a cap, a
  consolidation bonus, a decay term.** [v0] `clamp01( mean(salience) + min(accessCount ×
  0.12, 0.5) + (consolidated ? 0.2 : 0) − 0.015 × age_days )`, kept with the decay term
  upgraded (§5.4). **The consolidation bonus is LEGACY since 2026-09-26**: kept, exactly,
  for memories born before schema v8, and closed to everything made since (§5.2, §5.11).
- **Durability from spaced returns** (§5.11, 2026-09-26). [Ebbinghaus; Bjork & Bjork 1992;
  the held #238's spacing curve, harvested with its penalty dropped] — each counted return
  lengthens stability, with diminishing returns; close-together returns count less, never
  against.
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
- **Repetition alone never makes identity** [v1 §10 G11] — since 2026-09-26 a rule of the
  core lanes rather than a threshold: only a memory about me or about us can become core at
  all, so a fact, a skill or a place never does however often it returns (§5.3).
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

**By what it is about, since 2026-10-10 (Group 1c; review 01 C2; working default).** The
lived channel's default is `defaultClaimFor(about, status, saidBy, kind)`: 0.20 a done
work event, 0.25 other work and unmarked (`AUTHORED_DEFAULT_CLAIM`), 0.35 the world, 0.40
the owner, us or me (or said by the owner, or kind self/person). Every row stays under
`THETA_SEM`; the 0.40 row plus a strong feeling would not (0.535), so the bound now rests
on `FELT_HEIGHT_CAP` (§5.10) rather than on the sum. `salience.defaulted` carries the row's
`class`. NOTES "2026-10-10 — the default by what a memory is about".

### 5.2 Strength — the one number

```
rep(m)  = min( 0.12 × uses(m), 0.5 )                                # v0, verbatim; TUNABLE
cons(m) = 0.2 if consolidated(m) else 0                             # v0; LEGACY rows only (§5.11)
base(m) = max( ω_sal(k) × sal(m),  ω_rep(k) × rep(m) ) + cons(m)    # MAX, not product
strength(m, d) = clamp01( base(m) × D(m, d) × fade(m) )          # fade: §5.12, 1 unless settled changed
```

`base` is monotone non-decreasing (salience is fixed, `uses` only rises). **Identity is
reached only through §5.3's explicit promotion by a core lane, or declared revision —
never at birth, by either arm, and never by `base`.** `consolidated` can be set only on a
LEGACY row (born before schema v8): the upgrade kept that path open for exactly those rows,
and every memory made since earns its durability from returns (§5.11) instead.

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

- **Nothing is born into identity.** At birth, band ≤ semantic regardless of claimed
  salience. Identity is entered only by: (a) a declared revision landing on an existing
  identity element — the successor inherits membership — or (b) **promotion at
  consolidation by a CORE LANE** (rewritten 2026-09-26, owner decisions; working defaults):

  ```
  about me(m) = about(m) ∈ {me, us, owner}, and kind(m) ≠ skill            # the mark, read by sleep/
  FAST lane   = I(m) ≥ 0.6  and  an awake return ≥ 2 lived days after birth
  SLOW lane   = awake returns on ≥ 5 distinct lived days spanning ≥ 21 lived days
  promote     ⇔ about me(m) ∧ (FAST ∨ SLOW) ∧ not demoted by the owner
  recognized  ⇔ about(m) unmarked ∧ a feeling on m in the recognition group,   # wheel v2
                mine, its own strength ≥ 0.6, felt in a session (a reflection's only
                with the reflected-feeling door open; a dream's never)
  promote     ⇐ recognized ∧ FAST ∧ not demoted by the owner                   # fast lane only
  ```

  *(Wheel v2, 2026-09-30, working default.)* Recognising myself in something is the
  feeling that most shapes a self, so a memory NOBODY has marked that carries a feeling
  of the recognition group (recognized, "that's me", familiar — `feelings-wheel.ts`
  `selfRelevant`) counts as about me for the FAST lane. A mark always wins (`work`
  keeps it out), the slow lane still needs one, and nothing here raises confidence.
  Read by `sleep/consolidate.ts#coreContextFor` (`CoreContext.selfRelevantFeeling`).

  *(v9, 2026-09-27, working defaults.)* "About me" is a MARK set by meaning — by the
  writer at `note` / `session_end` or by a reflection (`me`, `us`, `owner`, `work`,
  `world`) — no longer the kind label; the v9 upgrade carried the old label rule onto the
  rows it found. An awake return is an organic use OR a reflection that cited the memory
  (§5.11). The fast lane's `I(m)` reads every feeling, including one a reflection recorded
  later, while `CORE_FAST_ACCEPTS_REFLECTED_FEELING` is open (the default, the owner's call
  of 2026-09-27); closed, it reads only feelings felt at the time or written in a
  session, AND its return must be an ordinary use, not a reflection's citation — closed
  means nothing reaches the core on reflection alone (owner ruling D1 on #256). A
  feeling recorded later while AWAKE (`source: awake`, 2026-10-02, `note`'s
  `feelingsNow`) is read the same way as a reflection's: only while the door is open.

  Emotion counts toward the core ON PURPOSE, through the fast lane (the `promotionBase`
  stopgap of #244 is retired); repetition counts through the slow lane, and only for
  memories about me or about us. A dream's replays count toward neither lane: a dream may
  NOMINATE, only a lane promotes. `sleep/` caps the crossings at three a night, strongest
  first; the owner's demotion (`counterparts core --demote`) is sticky.
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
S(m)    = S_base × (1 + β × ln(1 + uses(m))) × E(m) × R(m) / κ(k)    # stability, lived days
S_base  = 60      β = 0.5                                            # both TUNABLE
E(m)    = 1 + EMO_SLOPE × I(m)                                       # §5.10
R(m)    = 1 + RETURN_GAIN × ln(1 + returns(m))                       # §5.11; 1 at no returns
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
The ignorable tier never trains. A credited use is ALSO asked, beside this and without
changing it, whether it is a RETURN (§5.11).

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
SUCCESSOR ever the losing candidate of a same-hash merge**: the successor carries the
challenger's own words (§5.6), so their bodies are identical by construction and the hash
rule would archive one of them on the revision's own evening. The caller supplies the
lineage; this module names the refusal. Both refusals are checked before hash and before
cosine. *(8b added 2026-09-04, the first
store that ever crossed the bar: the successor lost the id tie-break and the revised
belief stopped being a belief.)*

### 5.8 Forgetting

Only physics forgets (owner decision): no model, on any path, holds delete power.

```
PRUNE(m,d) iff strength(m,d) < φ = 0.02                            # TUNABLE
           and (d − last_used_day(m)) ≥ D_floor = 90                # TUNABLE, lived days
           and band(m) == episodic  and not protected(m)
           and m is neither successor nor predecessor in a live revision chain
           and m's reminder date does not still repeat                # 2026-10-09
```

The sixth gate (`recurring`, the owner's decision of 2026-10-09, held lightly): a memory
whose `event_date` repeats (`meta.recurring`, prospective §3) is refused by name, as a
protected one is. Each delivered occurrence counts as a use, which carries a daily,
weekly or monthly repeat; a yearly one is used once a year, and no single use outlasts
365 lived days at an ordinary salience. Only the prune: it still decays, its band and
strength read as before. The caller supplies it (`sleep/prune.ts`, from the row's meta).
It is an exemption from the floor, so the verdict names it only where the first three
conditions hold (review of #341); a repeat above the floor is refused `above-floor` alone.
`protected` is named on the same terms (2026-10-09): it is the owner's exemption from the
floor, so a protected memory the arithmetic is still keeping is refused by the arithmetic
alone. So is `in-live-revision-chain` (review of #343): the chain holds back a row the floor
would otherwise have let go, and a row it holds above the floor is refused by the arithmetic
alone. None of the three changes an outcome — where the floor holds, the verdict is already
a refusal.

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
4. **[M]** Repetition alone never reaches the identity band: only a memory about me or
   about us can be promoted at all (the `not-about-me` refusal), so however often a fact,
   a skill or a place returns it never crosses (2026-09-26; before, the cap arithmetic).
5. **[M]** Exactly-once decay, by being a pure function of the clock rather than a step.
6. **[M]** One lived-day function, with a totality test over its call sites (scar §2.4).
7. **[M]** Revision requires a declared `updates:` target. There is no inferred-revision
   path, and no arithmetic here edits a memory that was not named.
8. **[M]** A declared revision is never merged into its target by dedup.
    **8b. [M]** A revision's successor is never the losing candidate of a same-hash
    merge, and never merges with its challenger in either direction — the lineage is a
    store fact the caller supplies, the refusal is named
    (`revision-successor-never-merged`), and it is checked before hash and cosine.
9. **[M]** Superseded versions stay resolvable for `H` lived days; nothing here deletes one.
10. **[M]** Prune is gated on all six conditions and is recorded; no model-reachable caller
    can invoke it.
11. **[A]** The per-kind tables are v1's calibration, not law. They ship with a recorded
    calibration and a fixture-bounded window, or disabled (scar §2.8).
12. **[M]** Up-moves and down-moves are counted separately, per kind, with a stated expected
    ratio — the symmetry counter that made v1's one-way ratchet visible (scar §2.10).
13. **[M]** Emotion (§5.10) lifts only the SALIENCE arm and lengthens only stability:
    `sal()` is unchanged (recall's turn gate and revision force read it without the
    lift), the repetition arm gets no lift (guarantee 4 stands), and a silent note with
    the strongest possible feeling is below `THETA_SEM` at birth and below `THETA_ID`
    even consolidated. The recorded feeling is never rewritten; softening is a read.
    **Emotion counts toward identity through the core's fast lane and nowhere else**
    (owner decisions 2026-09-26; `promotionBase`, the interim stopgap, is retired). The
    lift itself stays height only.
14. **[M]** Returns (§5.11) only ever LENGTHEN stability: the factor is exactly 1 at zero
    returns, so a memory that has never returned fades as it always did, and nothing a
    return does lowers strength. The v8 upgrade moves no memory down a band and makes
    none prune sooner — measured on every row by the first sleep after it
    (`sleep/upgrade.ts`, `physics.v8.census`), not asserted.

### 5.10 Emotion — height, slope, and the feeling that softens

*(Added 2026-09-26, emotion part A — owner decisions of 2026-09-25/26. Working defaults,
not rulings: the three constants are CAL and unmeasured. NOTES "Emotion, part A" has the
simulation and the reasons.)*

```
I(m)        = max( emotional(m), max strength of the feelings recorded on m )   # his or mine
salArm(m)   = clamp01( sal(m) + EMO_LIFT × I(m) )          EMO_LIFT  = 0.15   # TUNABLE
            capped at FELT_HEIGHT_CAP = 0.49 when sal(m) < THETA_SEM   # 2026-10-10; TUNABLE
base(m)     = max( ω_sal(k) × salArm(m), ω_rep(k) × rep(m) ) + cons(m)       # §5.2, arm lifted
S(m)        = §5.4's S × (1 + EMO_SLOPE × I(m))            EMO_SLOPE = 0.5    # TUNABLE
feeling now = strength × exp( −(d − birth_day(m)) / S(v) )                        # read only
S(v)        = S_FEELING + |v| × (S_FEELING_NEGATIVE − S_FEELING)   for v < 0
            = S_FEELING + v   × (S_FEELING_POSITIVE − S_FEELING)   for v ≥ 0
              S_FEELING = 20, S_FEELING_NEGATIVE = 14, S_FEELING_POSITIVE = 28    # TUNABLE
```

- **Feeling sets height and slope, never the band (2026-10-10, Group 1c).** A memory whose
  own `sal` is under the semantic floor is lifted by feeling at most to `FELT_HEIGHT_CAP`,
  so no feeling — at the write or recorded later — carries it into the semantic band; use
  still has to. One at or above the floor keeps the whole lift. The core's fast lane reads
  "strongly felt" as `I ≥ CORE_FAST_FEELING` or a feeling of at least `CORE_FAST_RELATIVE_FLOOR` (0.5) that is `CORE_FAST_ABOVE_DEFAULT` (0.1)
  above its word's stored default (`CoreContext.stronglyFelt`, review 08 C3).
- **Height ADDS.** Before this, a lone `emotional: 0.9` on a note read as a mean of 0.3
  under a claimed floor of 0.25 — the feeling averaged away. Now intensity adds on top of
  whatever the mean-with-floor is. `sal()` itself is v0's verbatim mean and stays that way.
- **The strongest feeling decides**, whoever's it is: `I` is a MAX over the numeric score
  and every recorded feeling on the memory (the owner's and the self's), read beside the
  row by `store.row()` as `feelingPeak`. A MAX, like `base`, so quieter feelings never
  average a strong one down.
- **Slope follows the same number.** "How long a memory lasts follows the strongest
  feeling on it." It changes decay on EXISTING stores — every row with an `emotional`
  score or a recorded feeling — which is why the multiplier is modest (×1.45 at I = 0.9).
- **The feeling softens faster than the fact.** A feeling's strength as it reads now is
  the recorded strength softened over the lived days since its MEMORY was born.
  `S_FEELING = 20 < S_BASE = 60`. *(Wheel v2, 2026-09-30.)* The clock depends on the
  feeling's VALENCE `v` (the writer's, else its word's default): an unpleasant feeling
  softens faster than a pleasant one — the fading affect bias — from ~15.8 lived days at
  angry's −0.7 to ~25.6 at happy's +0.7; a feeling read without a valence keeps 20. The
  table keeps the strength as recorded; nothing
  writes the softened value back. Height and slope use the RECORDED peak (affect stamps a
  trace at encoding); the softened value is what mood-matching (recall G18) and the
  displays read. **Approximation, named:** a feeling's age is counted from its memory's
  birth day, because the lived-day clock cannot map a feeling's wall-clock `created_at`
  back to a lived day. Today every feeling is written in the same call that mints its
  memory, so the two agree; a feeling added to an old memory later (`addFeelings` is
  public) would read as already softened.

### 5.11 Returns — durability from coming back

*(Added 2026-09-26 — owner decisions, dreaming + consolidation. Working defaults, CAL.
NOTES "Returns, core lanes and the v8 upgrade" has the simulations and the reasons.)*

```
return          = a credited, REFERENCED use on a lived day after the memory's previous
                  counted return (either kind) or its birth — NOT while the memory was
                  showing in the wake's hints lane, unless recall surfaced it on the turn's
                  own cue (the SAME turn) — or a DREAM replay (at most once per dream per
                  memory, and once per RETURN_SPACING_DAYS)
weight          = w × (1 − exp(−gap / RETURN_SPACING_DAYS))        RETURN_SPACING_DAYS = 7
w               = 1 awake, DREAM_RETURN_WEIGHT dream                DREAM_RETURN_WEIGHT = 0.5
returns(m)     += weight                                           # the history is a table
R(m)            = 1 + RETURN_GAIN × ln(1 + returns(m))              RETURN_GAIN = 1.0
```

- **Never against the memory.** A return is computed BESIDE `creditUse`, which is
  unchanged: `uses`, `lastUsedDay` and the rep arm credit exactly as before, and a close
  return only adds less. The held #238 scaled `uses` down for consecutive-day use; that
  penalty is dropped.
- **The loop, broken.** A use while the memory was on display in the hints lane may have
  been prompted by the display — the rich-get-richer loop (#238) — so it is not a return.
  `self/` ranks that lane on ORGANIC strength and habituation for the same reason.
- **Awake returns feed the core lanes** (`returnDays`, `first/lastReturnDay`); a dream's
  do not — and a dream's replay earlier the same lived day does not take the lane day of
  an organic return: the awake return still counts, at the weight its (zero) gap from the
  replay gives it (review of #251).
- **A REFLECTION's citation is an awake return** (v9, 2026-09-27, working default): source
  `reflection`, weight `REFLECTION_RETURN_WEIGHT` (1) × spacing, counted toward both lanes
  beside `awake`. **It is on display by construction** — the reflection is HANDED the core
  candidates and the most strongly felt memories, and then cites them — **and it counts
  anyway, on purpose.** Awake returns are rare (14 memories used across 391 turns in the
  owner's first week), so without it the lanes starve; deliberately revisiting a memory is
  what rehearsal is; and its guard is spacing, not the display rule: at most once a lived
  day per memory (a reflection and an organic use on one day are one lane day), and at
  most once every `REFLECTION_SPACING_DAYS` (7) per memory from reflections — so a
  reflection cannot cite its way through the slow lane's five days in ~10 (it would take
  four weeks of weekly citing). This is not the #238 loop come back; do not "fix" it to
  `on-display`.
- **The legacy path.** `consolidated` / `+CONS_BONUS` stays exactly as it was for rows
  born before schema v8 and is closed to every row made since. At zero returns, R = 1:
  the upgrade changes no memory's arithmetic.

### 5.12 A changed fact fades once (2026-09-29, contradictions — a working default)

When a memory is settled as `changed` — true at its time, not now — it takes ONE cut:
its `fade` (a per-row multiplier on strength, 1 for every memory until then; schema v10)
is multiplied by `CHANGED_FADE` (0.5, CAL), so its strength today and on every later day
is half what it would have been — graded weakening, not a switch (FadeMem). Nothing else
moves: not `base` (G3 holds), not `lastUsedDay` (D stays a pure function of d and the real
last use, G5; the prune's dwell counts real lived days, G10), not the uses. A credited use
resets decay as always and leaves the fade alone, so a used "earlier" memory is held at
the cut height; one credited occasion per lived day still holds. Two settles multiply;
`unfade` divides one settle's factor back out, exactly, in any order. A core memory is
never settled `changed` (its path is pressure). The caller applies the patch through
`Store.updatePhysics` and records the factor on the trail.

**Why a multiplier, not a clock move** (review of PR #284, B1). The first build moved
`lastUsedDay` back so the curve read half. The Stop's retrospective credit of the read
that preceded the settle then set it to today and erased the cut (the memory ended
stronger than before, with a return and a reinforced day besides); the moved day
shortened the prune's 90-day dwell, so a weak old memory was archived the next night;
and the dashboard showed a last use before birth. The multiplier has none of these.
Open for the owner: whether a later use should lift the fade back toward 1.

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
