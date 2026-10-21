# `physics/` — CONTRACT

*This contract guides the work; it doesn't limit it. Anything here, RESOLVED items included, can be raised for discussion at any time and revised when there's a better way (constitution line 13).*

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
sal(m) = mean( novelty, relevance, predictive )                     # 2026-10-10: emotional out
novelty(m) = 1 − max( cos( v(m), v(e) ) for e in E(m) )             # prediction error
```

**Feeling is not in the mean (2026-10-10, Group 1, review 02 C1; decided by b2+f8, lightly
held).** It was v0's mean of four, and the same feeling also lifted height (§5.10) and slowed
decay — counted twice in height. Now emotion reaches strength exactly twice, once each: height
through `EMO_LIFT × I` and steepness through q (§5.4). The numeric `emotional` score stays on
the row as an input to `I`. With `novelty` null the mean is of the two author-supplied
dimensions.

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
`class`. NOTES "2026-10-10 — the default by what a memory is about". **2026-10-11
(random-06, lightly held):** a revision by `updates` sent no `about` reads its default by the
mark of the memory it revises (`store/marks.ts#inheritFrom`, `counterpart-deposit.ts#carryAbout`),
which it is born with; a sent mark always wins.

**The old-claims era, since 2026-10-10 (decided by Mike, loosely held; working default).** A
memory written before the store's `claims.era.cutoff` (meta, UTC ms; recorded once at the
first writable open by this build) with an explicit claim is read by the CURVE —
`curveSal(m)`, through `salArm` and `steepnessInput` — at `defaultClaimFor(...)` when that is
lower, carried on `MemoryPhysics.eraClaim` from the read seam (`store/operational.ts#eraClaimOf`).
Exempt: the core, about owner/us, said by the owner, protected, a pending or repeating date.
**Extended 2026-10-11 (Mike, lightly held):** an old DEFAULT (`meta.claimedDefault`) reads at
today's `defaultClaimFor(...)` in either direction and with no exemptions — an owner memory
written at the old flat 0.25 reads 0.40 — so an upgrader reads what a fresh install writes;
the curve signature's `eraReads: 2` re-curves a store signed before it once.
**2026-10-14 (Mike, lightly held; review 2026-10-18):** where the era LOWERS a claim
(`eraClaim` below the stored claim), `curveSal` is `eraClaim` alone — the old relevance and
predictive, scored under the same old field text, no longer floor it back up (on the live
store they held 103 of 485 lowered claims exactly where they were); where it raises an old
default, `sal()` with the era's claim, as before. The exempt read exactly as before too: an
old default on one (a protected done work event's 0.25 → 0.20) carries
`MemoryPhysics.eraExempt` from the seam and is floored by its dimensions. `eraReads: 3`.
**2026-10-11 (random-06, lightly held):** a dream's merged memory is read at its strongest
original's moment (`meta.eraWrittenAt`, `store/operational.ts#eraCarriedFrom`) when that
original was old, with its `claimedDefault` — so a merge does not move the era's reading.
The stored claim is never rewritten (`eraClaim` is not a column), so "an explicit claim is
never overridden" holds for the claim as stored; `sal(m.salience)` still reads it. Deleting
the key (`counterparts claims-era --off`) restores the old reading exactly — the reading, not
the archive: a memory the floor prune let go meanwhile stays archived. The cutoff is in the
decay pass's curve signature, so a toggle recomputes every next-change day once.

### 5.2 Strength — the one number

```
rep(m)  = 0.5 × (1 − e^(−uses(m) / 3))                              # saturating since 2026-10-11; TUNABLE
cons(m) = 0.2 if consolidated(m) else 0                             # v0; LEGACY rows only (§5.11)
base(m) = max( ω_sal(k) × sal(m),  ω_rep(k) × rep(m) ) + cons(m)    # MAX, not product
strength(m, d) = clamp01( base(m) × D(m, d) × fade(m) )          # fade: §5.12, 1 unless settled changed
```

*The repetition arm saturates since 2026-10-11 (the `drewOn` build; the shape is #371's):
it was v0's `min(0.12 × uses, 0.5)`, linear to a wall at five uses. With the engaged tier
(§5.5) use can come more often, so each further use adds less: 0.14 after one, 0.24 after
two, 0.40 after five, never past 0.5 (`REP_SCALE_USES`). Built by the drewOn builder,
2026-10-11, from Mike's 10-10 direction, lightly held.*

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
  about me(m) = about(m) ∈ {me, us} ∧ kind(m) ∈ {self, person, entity}     # the mark, read by sleep/
                ∧ status(m) ∉ {planned, proposed, asked}                     # 2026-10-11 (08 C2)
  FAST lane   = I(m) ≥ 0.6  and  an awake return ≥ 2 lived days after birth
  SLOW lane   = the RECURRENCE lane (2026-10-11, 08 C1): over m's slot, ≥ 4 recurrence
                days (engaged-only days ×0.5, never alone; glimpse-only ×0.1 and
                rated-1-only ×0.25, never alone, never m's anchor — the
                2026-10-19 experiment) from ≥ 3 sessions spanning
                ≥ 7, inside the trailing 30 lived days; m itself used at least once;
                m not an earlier state of its slot; strength(m, d) ≥ REACH
  promote     ⇔ about me(m) ∧ (FAST ∨ SLOW) ∧ not demoted
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
  first; a demotion (`counterparts core --demote`, or mine since 2026-10-11) is sticky.

  *(Group 3 part A, 2026-10-11, working defaults; item 14, review 08 C1/C2/C4.)* A
  RECURRENCE DAY is a lived day on which m or a member of its SLOT — the memories a
  standing "A over B" ties it to (a settled `changed`; not a slot proposal still waiting) —
  was used awake (an engaged use counts half; in the 2026-10-19 experiment a glimpse
  `SHOWN_RECURRENCE_WEIGHT` and a rating of 1 `ONTOPIC_RECURRENCE_WEIGHT` of a day, neither
  ever making "m itself used at least once" true), cited by a reflection, or re-encoded (a
  newer member written that day by a session). Dream replays never count. In a slot with
  a dream FOLD (Group 3 part B; decided by random-06, 2026-10-11, lightly held) only what
  came back after the fold counts: a member already there when it was folded gives no
  re-encoding, and only its later uses count. The caller
  counts it (`sleep/consolidate.ts#coreRecurrence`) into `CoreContext.recurrence`;
  without one the row's own return days stand in (`rowRecurrence`). The absolute 0.5
  floor is gone: it fought the steeper curves; within reach is the floor now.
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

### 5.4 Decay — a power law over lived days (rewritten 2026-10-10, Group 1)

```
D(m, d) = ( 1 + t / S(m) )^−ψ                         ψ = 1 (hyperbolic)            # 03 C1
t       = d − anchor(m)                               anchor = max(last use, last return, last replay)
        = 0                                           while a dated memory is PENDING (§5.4a)
S(m)    = S0 × e^(G·q) × (1 + β ln(1 + uses)) × R(m) / κ(k)   S0 = 0.4, G = 8, β = 0.5
q(m)    = clamp01( sal(m) + EMO_Q × I(m) )            EMO_Q = 0.5                    # §5.10
R(m)    = 1 + RETURN_GAIN × ln(1 + returns(m))        # §5.11; 1 at no returns
S(m)    = ∞                                           identity band; any kind with κ = 0
```

*(Decided by b2+f8, 2026-10-10, lightly held; revisit after ~5 lived days — synthesis §1 G1.1,
mechanisms review 03 C1.)* Until then every memory rode one exponential with `S_base = 60`
(at most ×1.45 for feeling), so the steepest memory kept 74% after 18 lived days, nothing fell
below anything, and strength tracked age and claimed salience rather than what mattered. Now:

- **Steep early, flat late** inside one memory's curve (the hyperbola), and **strong memories
  flat overall** (S grows exponentially with q). S runs from 0.4 lived days at q = 0 through
  ~3 (a default 0.25 note), 22 (0.5) and 109 (0.7) to ~1,200 (q = 1), before use, returns and
  kind. A default note leaves reach in ~2 lived days; a 0.7 fact reads 0.70 → 0.66 → 0.55 →
  0.38 at 0/7/30/90; a felt reading lasts months. 03 §5 has the design table; the tests hold it
  within ±1 lived day.
- **Never fades = S = ∞** — the core today, and any kind whose κ is 0 (none yet; the owner's
  records later). `(1 + t/∞)^−1 = 1`: the exemption is the arithmetic, not a branch.
- **The anchor** is the latest of the last credited use, the last counted return (a
  reflection's citation) and the last counted dream replay (decided by g1a-builder, lightly
  held): a replay re-anchors the curve without being a use (no `uses`, no rep arm, no
  credit-today latch), which is how it "revives" a memory below reach. The day it goes
  under the prune's floor counts from the same day (§5.8).
- **Revision pressure keeps its exponential** (`pressureAt` names its own shape): it is the
  revision model's curve, not this one.

**§5.4a The dated hold (2026-10-10, review 07 C1/C2; decided by b2+f8, lightly held — it
reverses prospective G10, "no decay exemption before arrival").** A memory whose
`event_date` is still ahead is HELD at t = 0 through its last day plus `HOLD_GRACE_DAYS = 7`
(prospective's grace, one owner); a date that still repeats is held through each occurrence's
window (`HOLD_LEAD_DAYS = 3` before to the grace after) and fades on its curve between them, as
the owner's 2026-10-09 design says. After the window
closes the hold is gone and the memory is back on its own curve AS IF IT HAD NEVER BEEN HELD:
t from its own anchor, not from the close, on its own stability — an old routine reminder is
below reach (and, 14 lived days past the day its own curve went under the floor, archived)
at once; a felt dated fact lands
where its own curve puts it (Mike, 2026-10-11, lightly held; it replaces the 2026-10-10
"spent" slope, stability ÷ 4 from the close until a use). A date already past when the memory was written is not a
reminder and is not held. Computed at the read seam from `event_date`, `learned_on`, the
repeat word and the store's calendar today (`store/operational.ts#datedHold`) — no column,
no use credited, `uses` / `lastUsedDay` / returns untouched.

**§5.4b Below reach (2026-10-10, review 03 C2; decided by b2+f8, lightly held).**
`REACH = 0.15`. A memory under it is BELOW REACH: a computed state, never stored, never a
deletion. Ambient channels leave it out (turn recall's surfaced and footnote tiers,
spreading's landings, the wake's work lines); deliberate recall lists it after its main
results as faded; a use, an open or a replay brings it back. The identity band is never
below reach. Chapters, their copies, handoffs and entity cards are outside reach altogether
(`store/operational.ts#reachExempt`): each is born at strength 0 by design.
`nextChangeDay(m, d)` is the next lived day a memory's band, reach or prune eligibility
changes with nothing else happening — the nightly turn-down's key (13 C2).

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
- *(Superseded 2026-10-10.)* `S_base = 60` reproduced v0's `−0.015 × age_days` slope over
  roughly the first month; it gave every memory the same slow curve, and is gone.

### 5.5 Reinforcement

```
w = 1.00 referenced by the reply | 0.50 engaged (drewOn) | 0.25 surfaced-unused | 0.00 footnoted    # TUNABLE
uses(m) += w ;  last_used_day(m) := d   (only when w > 0)
```

*The `engaged` tier, 2026-10-11:* the session named the memory in a `drewOn` field — it was
shown this session and shaped what was done or said (`Counterpart#creditDrewOn`; recall
CONTRACT, the third door). Half a use; its return is a `returns.source = 'engaged'` row
worth `ENGAGED_RETURN_WEIGHT` × spacing, spaced from the last return of any kind, with no
core-lane day (the lanes count `awake` and `reflection`). **The tier only goes up within a
day:** a higher tier the same lived day LIFTS an engaged credit (`creditUse`'s
`upgradeFrom`: `uses` gains the difference, no second reinforced day, the engaged return
replaced by the awake one), never the other way. `ENGAGED_RECURRENCE_WEIGHT` (0.5) is what
an engaged return will count for toward Group 3's recurrence lane, which is not built.
*Amended 2026-10-19 — an experiment, not a ruling (Mike; the feedback loop; check ~10-22;
revert by setting `W_ENGAGED` back to 0.5):* trying `drewOn` as a FULL use. `W_ENGAGED` is
1.0, and at a full awake return's weight (`AWAKE_RETURN_MIN_WEIGHT`) its return is an
`awake` one, as an open's is (`partialSourceOf`) — a lane day and a full recurrence day.
The once-a-lived-day rule and the boundary's cap of 3 stay. At 0.5 everything above holds
again unchanged.

*Amended 2026-10-19 — an experiment, not a ruling (the feedback loop; check on ~10-22;
revert by reverting the PR).* Trying a session's ratings as use, to see whether the day
starts teaching the system. Three tiers join: `shown` (`W_SHOWN` 0.1, an ambient showing
left unrated at a `rated` boundary), `ontopic` (`W_ONTOPIC` 0.25, rated 1) and `useful`
(`W_USEFUL` 0.75, rated 2); rated 3 is `referenced`, rated 0 nothing
(`recall/rated.ts#RATING_TIER`). Everything above holds for them: once a lived day, never
on the birth day, the tier only goes up within a day. Their returns (§5.11): `useful` is
an AWAKE return (the awake floor is `AWAKE_RETURN_MIN_WEIGHT`, 0.75, where it was the
literal 1.0 — `surfaced` at 0.25 still earns none), worth its weight × spacing; `shown`
and `ontopic` are PARTIAL returns of their own `returns.source`, the engaged shape
(`PARTIAL_RETURN_SOURCES`: the `returns` sum only, no lane day, no `lastReturnDay`). A
lift deletes the partial row it lifts, read back exactly from its source in any session.
No format change: `source` was always free text, and an older build skips sources it does
not know. Known cost, on the watch list: a credited use re-anchors the curve
(`decayAnchor`), so a memory glimpsed every day does not fade while it keeps showing.

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
- **In practice, for now, memories change through the reconsolidation settle**, beside
  this arithmetic: a contradiction settled `changed`, `corrected` or `open`, each with a
  reason and an undo (a `changed` settle's one cut is §5.12).

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

Only physics forgets (owner decision): no model deletes; for now, a model may archive,
with a record and an undo.

```
PRUNE(m,d) iff strength(m,d) < φ = 0.02                            # TUNABLE
           and (d − max(floorDay(m), curveSince)) ≥ D_floor = 14    # lived days UNDER the floor (2026-10-14)
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

**The wait is under the floor (2026-10-14; decided by Mike, lightly held; review
2026-10-18).** `floorDay(m)` is the first lived day the curve is under φ — the anchor plus
`daysUntilBelow(m, φ)`, read off the curve and never stored. `curveSince` is the lived day
this build's curve first read the store (`sleep/decay.ts#curveSinceDay`: the meta row
`decay.curve.since`, written whenever the decay pass signs the store under a curve it was
not signed under — its first signing too, so an upgrader from a build older than the
signature waits as well; `d` itself while the store is still signed under another; none on
a store no pass has signed, an observer preview). Until
2026-10-14 the count ran from the anchor (`d − anchor ≥ 14`, 90 until 2026-10-10), so a
memory unused for months left the night it crossed the floor. The curve's crossing day
alone would not do: a new curve that lowers a memory (the era's scale-down, §5.1) reads it
as under the floor for weeks already, and `curveSince` is what keeps that curve from
emptying the store the night it arrives. Its cost: every curve change pauses every exit
for 14 lived days. A per-memory change that lowers a curve (a `changed` fade §5.12, a
smaller claim) still reads as if the memory had always been on the lower curve, as before;
so does a dated memory whose window has closed (§5.4a). `PruneVerdict.dwellDays` still
reads `d − anchor` (the entity fade's kind floor reads it); `belowFloorDays` is the wait.
The dashboard's let-go day (`letGoDay`, the memories view's "fading") passes the same
`curveSince`, so the pause does not read as a let-go.

A prune is recorded — counts, kind, dates, never a body and never a content hash (scar
§2.20) — and is the only physics-driven removal. **It is archival, never deletion**: the row
keeps its words and stays readable by id. Two states, kept apart since 2026-10-10 (review 03
C3/D4): BELOW REACH (§5.4b — computed, revivable, deliberate recall still finds it) and
EXITED (archived here). `D_floor` 90 → 14 (decided by b2+f8, lightly held): exit follows
reach — a default note reaches the floor in ~34 lived days, a felt or salient one in months
to years. The journal, chapters' copies and live handoffs are never pruned (`sleep/prune.ts`).
If any later change would DELETE rows, it waits for the owner (synthesis §8 A).

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
q(m)        = clamp01( sal(m) + EMO_Q × I(m) )             EMO_Q = 0.5        # §5.4 (was EMO_SLOPE)
feeling now = strength × exp( −(d − recorded_day(f)) / S(v) )                     # read only
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
  average a strong one down. **Since 2026-10-11 (Group 2, Mike, lightly held) the feelings
  read are the LATEST recording's** — the strongest of those recorded at the newest moment
  (a write's feelings share one): a later feeling-now, a dream's or a reflection's, is how
  the memory sits now, so an apology or new information lowers its weight (or a later,
  stronger one raises it). With nothing recorded later, the strongest felt at the time (so a
  merge, which carries each original's feelings at their own moments, is not weighed by its
  newest original's; review of #420). Nothing is rewritten; recall by feeling reads every
  one; the fast lane's lived peak (`feeling_peak_lived`) is still the strongest felt at the time.
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
  back to a lived day. *(Closed 2026-10-10, store v13, review 02 C5: `feelings.recorded_day`
  is the lived day the feeling was written, so a feeling a reflection adds weeks later
  softens from then; rows from before v13 were backfilled — session feelings from their
  memory's birth, later ones from the event log's day at their moment.)*
- **Slope, since 2026-10-10:** feeling enters stability through q (§5.4), `e^(G × EMO_Q ×
  I)` — ×11 at I = 0.6, against `EMO_SLOPE`'s ×1.3. It is out of `sal()`'s mean (§5.1).

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
  reflection cannot cite its way through the slow lane quickly (since 2026-10-11 its four
  recurrence days, each reflection its own session, take three weeks of weekly citing). This is not the #238 loop come back; do not "fix" it to
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
last use, G5; the prune's wait reads the cut curve, §5.8, G10), not the uses. A credited use
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

### 5.13 Support — a belief earned by life (wave 2 lane C, 2026-10-21; starting points)

*Design: `~/counterparts-notes/2026-10-21-beliefs-design.md` §3–5 (Mike, 10-21, lightly held).
Every number is a top-level tunable read at use, to check on live numbers ~2026-10-26.*

A belief (`memories.birth_route` set; `MemoryPhysics.belief`) is born weak — its salience at
most `BELIEF_BIRTH_CEILING` (0.3), no feeling of its own — and rises only by SUPPORT: lived
memories filed for it, each counted ONCE per belief (`belief_support`'s key).

```
w(s)    = route(s) × spread(s) × (1 + SUPPORT_FEELING × I_lived(s))       SUPPORT_FEELING = 0.5
route   = testimony 1 (said_by owner) · choice 1 (said_by self) · use 0.5 · found 0.7 · link 0.25
found   → SUPPORT_FOUND_ECHOED (1) once a lived filing (testimony, choice, use) on the same
          belief has a memory born on a LATER lived day than the found one's
spread  = the smallest that applies against earlier filings of the same stance:
          same session 0.25 · same lived day 0.5 · same folder 0.75 · else 1
          (no folder — the chapter episodes — is one shared "unknown" folder)
links   = at most SUPPORT_LINK_MAX (0.5) together, from beliefs at strength ≥ SUPPORT_LINK_FLOOR
uses(b) = Σ w over its support                                   # the repetition arm
anchor  = the last lived day a support filing counted            # the curve restarts there
base(b) = max( ω_sal(k) × salArm(b),  1 × rep(b) ) + cons(b)     # ω_rep is 1 for any belief
```

- **The same curve as any memory.** Support is a return-like credit with a use's reach: it
  lifts the height through the repetition arm (for a belief at full weight whatever its
  subject's kind — a belief about a person, ω_rep 0, is earned like any other) and restarts
  the curve; a return would only lengthen it. Unsupported, a newborn 0.3 belief leaves reach
  in about five lived days. **Named ceiling:** `rep` saturates at `REP_CAP` (0.5), so a belief
  never reaches `THETA_SEM` however supported, and its revision bar is at most ι × 0.5 —
  0.1 for a belief on the self subject (kind `fact`), 0.4 for one about a person, so the
  "≥ 3 lived days to overturn a friend-model" bound of §5.6 holds for no born belief (two
  days at `F_DAY_CAP_SLOW`). The first question for the 10-26 check.
- **Recounted, not accumulated.** The store recounts a belief's whole table at every filing
  and unfiling (`store/wave2.ts#recountSupport`) and moves its `uses` and reinforced days by
  the difference from the last count, so an echoed found filing or an unfiled one reads
  exactly, and a use credited some other way is kept. The anchor never moves back.
- **What never counts:** the belief itself, a showing, a recall, a rating, a reflection
  citing it, a dream's words, a reflection's entry. A rating of a belief's slot (lane E) may
  be a physics USE credit; it is never support.
- **Feeling** is the counted memory's strongest felt at the time (`feeling_peak_lived`), so a
  feeling recorded later does not make it count more.
- **Contrary** filings are counted the same way and press the belief through §5.6 at their
  weight: `F = w × strength(new) × sal(new)` (`Challenge.weight`), one credited challenge a
  lived day, REVISE when P > ι × strength. The revised belief is born weak again (route `correction`)
  with no support: what was filed backed the belief that lost, and stays on it. A contrary
  filing never lowers `uses`.
- **A migrated belief** (channel `migrated`) keeps the strength it lived (owner ruling
  2026-08-29), for now: it is not born here.

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
   flatness self-bounds crossing telemetry). *(Decided 2026-10-10 by b2+f8, lightly held:
   power-law, ψ = 1 — §5.4.)* This page defaulted exponential. And engram —
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
