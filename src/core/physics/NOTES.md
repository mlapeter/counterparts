# `physics/` — NOTES

Working notes beside the contract. **`CONTRACT.md` is the spec; this file never
edits it.** Where the contract is silent or its prose and its equations disagree,
the choice made in `index.ts` is recorded here so the next reader does not have to
re-derive it — and so the owner can overrule any of it cheaply (constitution
line 13: decisions are defaults).

## Implementation choices

*(First build, 2026-08-25. Every item is a place the contract did not decide, or
decided twice.)*

1. **The claimed-salience floor is stored, not applied to the dimensions.**
   §5.1 makes a claimed salience a floor clamped "at the proposal→memory seam,"
   but guarantee 2 also fixes the dimensions at birth, and §5.1 forbids ever
   defaulting a null novelty. Lifting a dimension to satisfy a claim would break
   one of those. So `Salience` gained an optional `claimed` field: the dimensions
   are stored exactly as authored, the claim is stored beside them, and
   `sal(m) = max(mean(dims), claimed)`. `sal(m)` therefore stays reproducible from
   stored state alone, the lift is inspectable forever rather than only in the
   event log, and `clampSalienceAtSeam()` still emits `salience.lifted` at the
   seam (guarantee 2's event).

2. **`base` is not clamped; only `strength` is.** §5.2 clamps at `strength`
   and nowhere else, so `base` can exceed 1 (salience 1.0 plus the consolidation
   bonus reads 1.2). Kept literal. Consequence: `THETA_ID` is compared against an
   unclamped `base`, which is the only reading under which the threshold can
   discriminate at the top of the range at all.

3. **Promotion counts a new field, `reinforcedDays`.** §5.3 gates promotion on
   "reinforcement on ≥ N = 3 **distinct lived days**," which `uses` cannot
   reconstruct — `uses` is a weighted sum (a 0.25 surfaced credit and four of
   them are indistinguishable). `MemoryPhysics` therefore gained
   `reinforcedDays`, incremented only by `creditUse()`. It is **optional** in
   `types.ts` (absent reads as 0) so that adding it breaks no other module's
   construction sites; 0 is the promotion-*blocking* direction, so an un-migrated
   row can never be promoted by accident.

4. **Any credited tier counts a reinforced day.** A 0.25 "surfaced-unused"
   credit is still a lived day on which the memory was reinforced. The contract
   distinguishes the tiers by weight, not by whether they count as an occasion.

5. **Pressure has its own stability constant, `S_PRESSURE = 60`.** §5.6 says P
   decays "like everything else — the same curve family, keyed to the last
   challenge day." *Family*, not the same constant: reusing the target's `S(m)`
   would couple how long a challenge persists to the target's own use history and
   kind, which is machinery nobody asked for (Amendment 15). One flat constant,
   no κ, no `uses` coupling.

6. **Pressure decays even against a decay-exempt identity element.** `D = 1`
   exempts the *memory* (§5.4's named deviation); nothing exempts the *pressure
   standing against it*. Otherwise a stale challenge on an identity element would
   wait forever — exactly the ambush §5.6 says pressure decay exists to prevent.

7. **Order of operations in `applyChallenge`: decay P to `d` → add F → compare.**
   The alternative (compare, then decay) would let a challenge win on pressure it
   no longer has.

8. **The credited challenge is the FIRST of the lived day, not the strongest.**
   §5.6 says "one credited challenge per target per lived day" without saying
   which. First-wins needs no lookahead and no re-scoring, and mirrors §5.5's
   occasion rule, which is also first-wins.

9. **`REVISE` is strict `>`.** The contract writes `P(old) > ι × strength(old,d)`.
   Ties hold.

10. **Novelty is clamped to [0, 1].** `1 − cos` exceeds 1 for a negative cosine;
    the contract is silent. Clamped, because every other salience dimension is
    0–1 and the mean would otherwise be out of range.

11. **`successorSeed()` inherits identity by default.** §5.3(a) says a declared
    revision landing on an identity element hands membership to the successor;
    §5.3 also says identity is "demoted only by revision." Both are true with an
    explicit `inheritIdentity: false` opt-out, so demotion is possible but never
    accidental.

12. **The prune record carries exactly the contract's fields** — day, kind, band,
    birth day, last-used day, uses, strength. No id, no hash, no body (scar
    §2.20). A caller that wants to know *which* memory it just pruned already
    knows: it passed it in. Attaching identity to telemetry is the caller's
    decision, made in the open.

13. **All three decay shapes ship behind `TUNABLES.DECAY_SHAPE`, defaulting to
    exponential.** Open question 1 names `tools/replay` as the deciding consumer
    and says all three are one line — they are. Only the default is tested for
    behavior; the alternates are tested only for `D(0) = 1` and monotonicity.
    Choosing between them is replay's job, not this module's.

14. **`livedDay()` is a function of an active-day list, not of elapsed calendar
    days.** The lived-day integer is "how many distinct active days came before
    this one," which makes a week away one interval and not seven, and makes a key
    that is not yet in the list total rather than a special case.

15. **Every verdict names its reason, and every gate names *all* its failures.**
   `blockedBy` on prune and promotion lists every failing condition, not just the
   first, so a log line can never read "refused" without saying by what. Reasons
   are a closed union, so an unhandled case is a type error rather than a string
   nobody greps for.

16. **An UNCLAIMED memory takes its channel's default floor, and a default is
   never a lift.** (2026-09-04, measured on the live parallel-run store.) All 48
   authored memories carried `relevance = emotional = predictive = 0` and most
   carried no claim, so `sal(m) = max(0, null ?? 0) = 0`: the lived channel's own
   deposits were the weakest things in the store, first to decay, and — since
   `challengeForce = strength × sal` — every revision they declared pushed with
   ZERO force. That inverts the authorship doctrine it was supposed to serve.
   `clampSalienceAtSeam()` therefore takes a fourth argument, `defaultClaim`,
   applied only when `claimed === null`; `mint.ts` passes
   `TUNABLES.AUTHORED_DEFAULT_CLAIM` on the `authored` channel and `null` on every
   other, engine-set off the channel exactly as `SWEEP_CLAIM_CEILING` is. Three
   properties are deliberate:
   - **0.25, and the number is arithmetic.** `0.25 + CONS_BONUS = 0.45 <
     THETA_SEM = 0.5`, and `max(ω_sal) = 1.0`, so a defaulted memory cannot reach
     the semantic band on the default alone even after consolidation — it needs
     3 credited days of use (`rep = 0.36`) or an actual claim. That is the
     structural form of the F5 scar (a self-claimed 0.8 parked ~75% of the store
     above `THETA_SEM`). It also sits below 0.34, the measured mean of the claims
     authors did make, so silence says strictly less than speaking, and below
     `SWEEP_CLAIM_CEILING = 0.6`, so the floor is not a promotion over the
     retelling channel.
   - **A default is recorded as `defaulted`, never as `lifted`.** The lift metric
     is "how often does an author's claim out-rank the computed dimensions"; a
     defaulted floor folded into it would read every silent note as a claim and
     destroy the number the ceiling decision needs. `SeamClamp` gained
     `defaulted` and `defaultEvent` (`salience.defaulted`) for that reason, and
     the separation is load-bearing rather than tidy: `tools/replay/baselines.ts`
     computes three watch metrics off `salience.lifted` and `mint.proposal`'s
     `lifted` flag (lift rate, mean lift size, capped share). A default entering
     either would move all three silently, against F5's own +0.150 / 97.9%
     baselines. Defaults stay out of both by construction.
   - **An explicit claim, however low, is never overridden** — the branch is on
     `claimed === null` and nothing else. An explicit `0` is testimony.
   The FALLBACK channel is untouched: its ceiling and its interpreter-supplied
   dimensions are exactly what they were. CAL, and a working default.

17. **Emotion, part A (2026-09-26) — feelings start to matter (CONTRACT §5.10).**
   Owner decisions of 2026-09-25/26, built as working defaults. Three constants,
   all CAL and unmeasured, chosen by the arithmetic below and kept modest because
   this changes decay on an existing store.

   **Where the lift lives.** In `base()`'s salience ARM (`salArm`), not in `sal()`.
   `sal()` is also what recall's turn gate reads (§9 G10: the emotional dimension
   counts only when the turn itself carries first-person feeling) and what
   `challengeForce` multiplies by (the author's own how-much-this-mattered). Folding
   the lift into `sal()` would have broken G10 silently and changed revision force.
   The repetition arm gets nothing, so "repetition never reaches identity" is still
   the cap arithmetic alone.

   **Intensity** `I = max(emotional, strongest recorded feeling)`. `feelingPeak` is
   read beside the row by `Store.row()` (one indexed subquery), which every physics
   read goes through — sleep, recall, the dashboard, `physicsOf`, `read`. A bare
   `SELECT * FROM memories` carries none and reads as the numeric score alone.

   **The simulation.** A silent authored fact (claimed default 0.25, no dimensions,
   never used, κ = 1), strength over lived days, at three intensities:

   | I | height | S (lived days) | d0 | d7 | d30 | d60 | d90 | below φ = 0.02 on |
   |---|---|---|---|---|---|---|---|---|
   | 0 | 0.250 | 60 | 0.250 | 0.222 | 0.152 | 0.092 | 0.056 | day 152 |
   | 0.5 | 0.325 | 75 | 0.325 | 0.296 | 0.218 | 0.146 | 0.098 | day 210 |
   | 0.9 | 0.385 | 87 | 0.385 | 0.355 | 0.273 | 0.193 | 0.137 | day 258 |

   (`test/emotion.test.ts` pins this table.) A `person` memory (κ = 0.75) at I = 0.9:
   S = 116, below the floor on day 344 instead of 203. A note that said only
   `emotional: 0.9`: before, height 0.300 and S = 60 (floor on day 163); now height
   0.435 and S = 87 (floor on day 268).

   **Why these numbers.**
   - `EMO_LIFT = 0.15`. The lift is felt (a strongly felt silent note starts 54%
     higher than an unfelt one) and bounded where it matters:
     `AUTHORED_DEFAULT_CLAIM + EMO_LIFT = 0.40 < THETA_SEM`, so a feeling alone does
     not make a silent note semantic at birth — consolidation (+0.2) or use still has
     to, and a consolidated one at I = 0.9 holds semantic for ~14 lived days, then
     fades back. Consolidated, it is 0.60, far under `THETA_ID = 0.85`. Larger lifts
     (0.25+) would carry a felt silent note to semantic on birth; smaller ones (0.05)
     are rounding error against a 0.25 floor.
   - `EMO_SLOPE = 0.5`. ×1.25 stability at I = 0.5, ×1.45 at 0.9 — the strongly felt
     memory lasts ~1.7× as long before it reaches the prune floor. It stays a slope,
     not an exemption: nothing becomes immortal by being felt (identity is still the
     only decay exemption, and still by promotion only).
   - `S_FEELING = 20`. A 0.9 feeling reads 0.63 after a week, 0.45 after two, 0.20
     after a month — while the fact it sits on is still at 0.79 of its height after
     two weeks. "The feeling softens faster than the fact" as arithmetic.

   **What moves on an existing store.** Every row with an `emotional` score or a
   recorded feeling is now taller and slower. The first sleep pass after an upgrade
   will re-read those bands; some episodic rows will read semantic (counted as
   up-moves by guarantee 12's counter — expected, and a one-time step). A felt row
   that reads semantic on a day after its birth is then CONSOLIDATED by the same
   pass, and `consolidated` is permanent (+0.2 to `base` for life).

   **Identity would have been reachable, in a window (adversarial review of #244) — closed below.**
   Promotion eligibility is on `base`, and the lift is in `base`. The "stays under
   identity" bound above is for a SILENT note only. For a memory whose `sal` was
   claimed or computed, the consolidated bar `THETA_ID − CONS_BONUS = 0.65` is now
   met at `sal ≥ 0.65 − 0.15 × I`: at I = 0.9 a consolidated memory with
   `sal ∈ [0.515, 0.65)` and ≥ 3 distinct reinforced days is newly eligible, where
   before it was not. Identity is decay-exempt, so this is one-way. It includes the
   retelling channel: a sweep memory at `SWEEP_CLAIM_CEILING = 0.6` with an
   `emotional` dimension ≥ 0.34 reaches 0.6 + 0.15 × I + 0.2 ≥ 0.85 (0.80 before).
   On an existing store the first sleep after the upgrade could have promoted such rows.
   **Settled 2026-09-26 (coordinator, holding the status quo until the owner's
   consolidation/dreaming redesign lands): emotion does NOT count toward identity.**
   Promotion reads `promotionBase` — `base` without the lift — so its reach is exactly
   what it was before #244, and the settling view (which reads the verdict's `base`)
   follows. The lift still makes a memory taller and slower to fade.
   **Superseded the same day by the redesign** ("Returns, core lanes and the v8
   upgrade", below): `promotionBase` is retired, promotion reads no `base` at all, and
   emotion counts toward the core on purpose — through the fast lane, and only for
   memories about me or about us.

   Anything that ranks by strength (the self page's ordering, the dashboard's
   lists) shifts toward felt memories. Felt, consolidated, high-salience memories
   also reach the strength CEILING of 1.0 more often (`strength` clamps `base × D`,
   and base can exceed 1 with the consolidation bonus), so anything that ranks by
   strength sees more ties. The self lanes break a tie on born day, then on a hash
   of the memory's words (`self/identity.ts#tieKey`, added in review), then id —
   so two stores built alike (the demo seed's two runs) render the same wake, and
   `demo-seed.test.ts` compares the wake's bytes exactly again. On a live store,
   lines tied on everything else move from id order to hash order — both
   arbitrary, so nothing is lost; identity additionally rotates by last-rendered
   day, which dominates after one render.

   **Softening's clock, an approximation named.** A feeling softens over the lived
   days since its MEMORY's birth day: the lived-day clock is a counter and cannot map
   a feeling's wall-clock `created_at` back to a lived day. Every feeling written
   today is written in the same call that minted its memory, so they agree; a later
   `addFeelings` on an old memory would read as already softened.

   **Not carried across a revision.** Feelings belong to a memory id. A supersede
   mints a new id, so the successor starts without them (and without their lift).
   Named, not solved — revisit with the self/schemas work.

## Returns, core lanes and the v8 upgrade (2026-09-26)

*Owner decisions of 2026-09-26 (dreaming + consolidation), held lightly: "try it, see
how it goes, adjust". CONTRACT §5.2, §5.3, §5.4, §5.11; `sleep/consolidate.ts`;
`self/identity.ts#hintReading`. Every number below is a working default and CAL.*

**What changed, in one paragraph.** The one-time `+CONS_BONUS` for a memory that
survived a day at the semantic floor was the only road to staying strong. Now a memory
stays strong by COMING BACK: each spaced return lengthens its stability (diminishing),
close-together returns count less but never against it, and a dream's replay counts as
half a return. The bonus is kept, exactly, for rows born before the upgrade (`legacy`),
so no memory moves down. The core (identity band) is for memories about me or about us
only, by a fast lane (strongly felt, and back after a gap) or a slow lane (back on five
distinct days over three weeks), at most three a night.

**The tunables, and why each number.**

| name | value | reason |
|---|---|---|
| `RETURN_SPACING_DAYS` | 7 | `1 − exp(−gap/7)`: 0.13 next day, 0.63 after a week, 0.95 after three. Full weight once forgetting has visibly started (a fact with S = 60 has lost ~11% by day 7). #238's curve, with its penalty on `uses` dropped. |
| `RETURN_GAIN` | 1.0 | stability × (1 + ln(1 + returns)): one full return ×1.69, three ×2.39, ten ×3.40. In the 60-day run a fact that came back on 5–6 days ends with S ≈ 330 lived days against ≈ 130 without its returns — retrieval practice at its usual strength. The number most worth watching: generous if the store stops forgetting what it uses a few times. |
| `DREAM_RETURN_WEIGHT` | 0.5 | the owner's "start ~0.5": a replay strengthens, less than living it again. Counts toward no core lane. |
| `DREAMED_CLAIM_CEILING` | 0.3 | a dream's gist starts below `THETA_SEM` and just above a silent note's 0.25 default, so it is neither semantic at birth nor prunable from birth; it rises only by being used awake (rep arm, returns). |
| `CORE_FAST_FEELING` | 0.6 | "strongly felt" — the top of the ordinary range: the sweep's claim ceiling is 0.6 too, and feelings recorded at 0.7–0.9 are the ones a person names. Either person's feeling (`emotionalIntensity`). |
| `CORE_FAST_GAP_DAYS` | 2 | "came back at least once after a gap": not the very next day, which is usually the same thread continuing. |
| `CORE_SLOW_DAYS` / `CORE_SLOW_SPAN_DAYS` | 5 / 21 | "kept coming back over several weeks": five separate days spread over three weeks is a habit, not a burst. The owner's example numbers. |
| `CORE_MAX_PER_SLEEP` (sleep) | 3 | the owner's rail: a store that grew a lane of eligible memories does not rewrite who it is overnight; strongest first, the rest wait three lived days. |
| `HINT_STEP` / `HINT_RECOVERY_DAYS` / `HINT_HABITUATION` (self) | 1 / 3 / 1 | #238's habituation with its half step for "used while shown" removed (its review: that barely habituated). |

**Judgement calls, recorded because the brief was silent.**

1. **A return needs a REFERENCED use.** A memory surfaced and left unused (tier 0.25)
   did not come back; it was offered. Simpler too: every awake return is also a lane day.
2. **"Shown in the hints lane" is decided by the store**, from `wake_display`: from the
   first day of the current showing through the day a publish dropped it (the drop day
   is ambiguous, #238's reading kept). **A use recall surfaced on the turn's own cue
   (a quoted loud candidate) is organic even while shown** — found building the lifecycle
   test: on a store small enough that the lane holds every warm memory, the plain rule
   would have let nothing ever return. An id EXPANDED off the wake is the loop, and is
   not a return.
3. **The hints lane scores ORGANIC strength** — the uses the memory had when it was first
   ever shown plus its awake returns, decayed from its last organic use — times
   habituation. #238's review found the loop back every day by ~day 20 because
   display-prompted uses kept `lastUsedDay` and `uses` up; both are set aside here.
4. **Legacy is a flag the migration sets on every row it finds**, not a date: exact, and
   a dream's merge of legacy rows carries it (the merged memory stands where its
   strongest original stood). Rows born on the upgrade's own lived day before it are
   legacy; rows born after are not.
5. **Existing identity rows stay identity**, whatever their kind — the old rule promoted
   facts and entities; the new one never will, and nothing takes back what was earned.
6. **"About me"** is `self` kind, or a `person` memory naming the owner (the identity
   core's name and aliases, whole-word). With no name configured, only `self` qualifies.
7. **A demotion restarts fading from the demotion day** and is sticky against the lanes.

**A. The upgrade, on a real v7 store** (`tools/sim/consolidation.ts --v7-src <a v7
checkout>`: the demo store seeded by the v7 build, then opened by this one).

| kind | rows | consolidated (kept) | episodic / semantic / identity | band moved at upgrade | prune day sooner | later |
|---|---|---|---|---|---|---|
| entity | 24 | 16 | 6 / 16 / 2 | 0 | 0 | 0 |
| fact | 39 | 36 | 0 / 34 / 5 | 0 | 0 | 0 |
| person | 29 | 21 | 5 / 21 / 3 | 0 | 0 | 0 |
| place | 7 | 0 | 7 / 0 / 0 | 0 | 0 | 0 |
| self | 33 | 13 | 17 / 11 / 5 | 0 | 0 | 0 |
| skill | 13 | 0 | 13 / 0 / 0 | 0 | 0 | 0 |

The census the first sleep recorded: `{"checked":145,"bandDown":0,"bandUp":0,"weaker":0,
"pruneSooner":0,"pruneLater":0,"legacy":145,"consolidated":86}`. Zero by construction
(the returns factor is 1 at zero returns and a legacy row keeps its path) — and measured.
`doctor` prints it as the Upgrade line. What the upgrade DOES change is the future of a
memory made after it: it will never get the one-time bonus, and stays strong only by
returning.

**B. Sixty lived days** on a synthetic store: 20 ordinary facts (a cued return 6% of
days), a strong memory used every time the hints lane shows it (the loop), two strongly
felt `self` memories (12%), two steady ones (30%), two rare ones (3%), one felt memory
naming the owner (10%), three steady ones about him (25%), three about Ada (40%), two
new facts a day, and on day 10 a burst of five felt `self` memories that all come back on
day 12.

- **Hints lane** (8 slots): the loop memory was shown on 34 of 60 days, longest run 8
  days; 99 distinct memories were shown. Every one of its 34 uses was on display, so it
  gathered 0 returns and never came near the core.
- **The core**: Mike-felt on day 10 (fast); three of the burst on day 13 and the other two
  on day 16 (fast; the cap held two back once); both felt `self` memories by day 19
  (fast); both steady `self` memories on day 25 and the three steady Mike memories on
  days 34–40 (slow). The rare `self` memories, every fact, and all three Ada memories
  (26–30 return days each — not about me) stayed out.
- **Durability**: facts that came back on 5–6 days end with S ≈ 320–340 lived days
  (≈130 without their returns) and sit around the semantic floor at day 60; facts that
  never came back fade as before.

**Hazards named.** `RETURN_GAIN` is the lever most likely to need turning (see above). The
fast lane opens on ONE return after a gap, so a strongly felt memory about me is core
within days — the owner's intent, and the cap is the rail. A dream's feeling-now cannot
raise intensity (capped at the peak), so a dream cannot open the fast lane.

## Observations for the owner (arithmetic vs prose)

- **§5.6's "a slow kind cannot cross from rest in fewer than ~3 lived days" is
  an approximation, not a bound.** The maximum single-day force is
  `strength(new) × sal(new) = 1.0` (a challenger with all four dimensions at 1.0),
  while the highest possible self-kind bar is `ι × strength(old) = 0.9 × 1.0 =
  0.9`. So one *flawless* challenge can cross a self belief in one day. The
  per-day cap bounds **spam**, not a single perfect claim. The equations win over
  the prose (they are what §5 says to implement exactly), so nothing was "fixed"
  in code — but if the owner meant the prose as the guarantee, the cheapest fix is
  a per-day force cap (`min(F, F_day_max)`), not a change to ι.
  `test/physics.test.ts` documents the boundary by using salience 0.9 (F = 0.81)
  for its "one loud claim" spam, which is below the 0.855 bar it tests against.

- **`TAU_DUP`, `PHI_PRUNE`, `D_FLOOR_DAYS`, `POWER_LAW_PSI`, the symmetry ratio,
  and the whole per-kind table are calibration-required** and marked as such in
  the `TUNABLES` table. Per scar §2.8 and guarantee 11 they ship with a recorded
  measurement or they ship disabled; `PHI_PRUNE` and `D_FLOOR_DAYS` are the two
  with no ancestry at all (open question 5 — v1 never pruned).


## After the review of #251 (2026-09-26) — working defaults, held lightly

- **Legacy history counts as returns (Q1).** The review found the upgrade closed v7's
  road to the core for legacy rows: `promotionBase ≥ 0.85` with 3 reinforced days, any
  kind. The decision is to let those rows go under the new rule (only memories about me
  or about us become core), but not weaker than the design intends.
  - At the upgrade, each legacy row's `reinforced_days` become `returns` rows of source
    `legacy`. They are placed evenly from birth to the last use, the last one on it,
    because the days themselves were never kept, and weighed by `spacingWeight`.
  - They lengthen stability and nothing else. The lanes read awake returns only, and
    invented day positions are not a lane's evidence.
  - `creditReturn`'s `since` lets spacing measure a post-upgrade return from the last
    legacy day.
- **The slow lane needs the semantic floor (Q2).** `CORE_SLOW_FLOOR` = `THETA_SEM` =
  0.5, decayed strength on the promoting day (`CoreContext.day`; `promote` always passes
  it).
  - The independent upgrade run had six `self` rows with salience `[0,0,0,0]` cross on
    repetition alone.
  - The fast lane is unchanged.
- **A dream follows spacing (Q5).** A replay counts at most once per
  `RETURN_SPACING_DAYS` per memory (refusal reason `dream-spaced`).
  - `DREAM_RETURN_WEIGHT` 0.5 and `RETURN_GAIN` 1.0 are unchanged, to be tuned on the
    real store.
  - The return factor R after each period (the returns total in brackets), from
    `creditReturn` itself:

  | Days | Dream replay every night | Awake every day | Awake every week |
  |---|---|---|---|
  | 30 | 1.85 (1.3) | 2.61 (4.0) | 2.26 (2.5) |
  | 90 | 2.58 (3.9) | 3.56 (12.0) | 3.15 (7.6) |
  | 365 | **3.86** (16.5) | 4.90 (48.6) | **4.52** (32.9) |

  - Before the spacing rule, nightly replay reached R ≈ 4.23 at a year, nearly weekly
    awake use. It now stays below.
- **Awake after a dream the same day (review S1).** The awake return keeps its lane day,
  at the weight its zero gap gives it (0).


## 2026-09-27 — reflection returns, and the fast lane's feeling

Working defaults from the owner's conversation of 2026-09-27, held lightly.

- **`ReturnSource` gains `reflection`.** `creditReturn` treats it as an awake return for
  "already today" (a reflection and an organic use on one lived day are one lane day —
  whichever comes second is refused `already-returned-today`, harmlessly), weighs it at
  `REFLECTION_RETURN_WEIGHT` × spacing, and refuses it `reflection-spaced` within
  `REFLECTION_SPACING_DAYS` of the memory's last reflection return (the store reads that
  day off the `returns` table; no column).
- **How reflection returns feed the two lanes (decided):** they satisfy the fast lane's
  "came back after a gap" (a single one can, with the feeling bar met), and they count
  toward the slow lane at most once a week per memory — the weekly spacing is the one
  rule that gives both "the reflection can't cite the same memory every night" and "not
  through the slow lane in ~10 days". Ten nights of citing one memory give two lane days
  (tested). Reflection alone could still carry a memory through the slow lane over four
  weeks of weekly citing; that is left open on purpose — a memory the waking self keeps
  coming back to every week for a month is the slow lane's own description.
- **The fast lane and a feeling recorded later.** `MemoryPhysics.feelingPeakLived` is the
  peak without the feelings a reflection recorded later — and, since #317 (2026-10-02),
  those an ordinary session recorded looking back (`source: awake`); both are
  `store/feelings.ts#LATER_FEELING_SOURCES` (`Store.row()` computes both peaks).
  `promotionEligibility` reads it unless `ctx.acceptsReflectedFeeling` (else the tunable
  `CORE_FAST_ACCEPTS_REFLECTED_FEELING`) is true. The design review of 2026-09-27 wanted
  it closed; **the owner opened it** the same day: nearly all sessions are straight work
  with little typing, so what matters may never come up in the moment, and a memory has
  to be able to reach the core on reflection alone. So one reflection can raise a
  memory's feeling and give it its return in one night, and the next consolidation can
  promote it (tested). The guard is visibility, not a gate: the promotion's record names
  its returns' sources (`reflectionOnly`), doctor counts "promoted on reflection alone",
  and the next morning share says "I think X has become part of who I am".
  `counterparts core --reflected-feeling off` closes it without a release.

## 2026-09-27 — owner rulings on the review of #256

Held lightly.

- **"Off" means fully closed (D1).** With `core --reflected-feeling off`, the fast lane
  needs a feeling felt at the time (not one a reflection recorded later) AND a return that
  is an ordinary use: `CoreContext.organicReturnDay` (the last lived day of a counted
  `awake` return; sleep reads it off the `returns` table) stands in for `lastReturnDay` in
  the fast lane's gap. Open, the fast lane is as before. The slow lane is the same either
  way (see the watch item).
- **Watch list (D5, no change):** reflection alone can carry a memory through the SLOW
  lane in about four weeks of weekly citing (five reflection days spanning 28+ lived days;
  pinned by `test/reflect-review.test.ts` "D5"). Look again after a few weeks of live
  reflections; if it shows up, the next step is to count reflection days toward the fast
  lane's return only.

## 2026-09-29 — the changed cut is a multiplier (review of #284)

`strength = clamp01(base × D × fade)`. `fade` is a column (v10, default 1), read by
`rowToPhysics`, written only by a `changed` settle (`changedFade`: fade × factor) and its
undo (`unfade`: ÷ factor, snapped to 1). The first build moved `lastUsedDay` instead; the
review's probes showed the turn's own credit erasing it, a second credit on one lived day,
a shortened prune dwell and impossible history (§5.12 has the list). The multiplier is
outside `base` and outside `D`, so guarantees 3, 5 and 10 read as before; `hintReading`
and every other reader go through `strength()` and see it without change.

## 2026-09-30 — the feelings wheel v2: valence softens, recognition reaches the fast lane

- **Valence-asymmetric softening** (`softenedFeeling(strength, age, valence)`,
  `feelingSofteningDays`). The research for the walk (fading affect bias: the hurt goes
  out of a bad memory sooner than the warmth out of a good one, while the memory stays)
  gave the shape; the numbers are the brief's: S runs from `S_FEELING = 20` at valence 0
  to `S_FEELING_NEGATIVE = 14` at −1 and `S_FEELING_POSITIVE = 28` at +1, in proportion
  to |v|. At the cores' default valences the spread is modest (angry ~15.8, sad ~16.4,
  calm ~24, happy/warm ~25.6) — the defaults sit at ±0.5–0.7, so the ends are only
  reached by a writer's own valence. Read-side only: nothing that reads `feelingPeak`
  (height, slope, the fast lane) sees valence. `test/feelings-wheel-v2.test.ts` pins an
  angry and a happy feeling of one strength holding a memory identically.
- **Recognition on the fast lane** (`CoreContext.selfRelevantFeeling`). Small enough to
  build: one optional field, read by `promotionEligibility` as "about me" only when the
  fast lane is met, and set by `sleep/consolidate.ts#coreContextFor` only for a memory
  whose `about` is NULL (unmarked) and which carries a recognition-group feeling. The
  dashboards' core-road readers ask the same context, so they see it too.
  **Which feeling counts** (the review of #301, M1): mine (`whose = self`), at least
  `CORE_FAST_FEELING` on its own (a strong memory with a faint recognition does not
  count), recorded in a session — or by a reflection while the reflected-feeling door
  is open; never a dream's. The reflection's list of core candidates asks the same
  (`dream/reflect.ts`), and doctor counts the memories on this lane ("Recognition"). Not built:
  anything reading recognition for the self page (arcs from uneasy to calm, moments of
  recognition) — that is the page's design note, not a mechanism yet.

## 2026-10-09 — a repeating date is not pruned (the sixth gate)

The owner's decision on #339's review, held lightly: each occurrence of a repeating
reminder that is actually said or surfaced counts as a use (`Counterpart#creditOccurrence`
→ `store.reinforce`, the `surfaced` tier, once per occurrence), and if that cannot carry a
yearly one across its gap, the prune refuses a live repeat by name. It cannot: one
surfaced use multiplies S by `1 + 0.5 ln 1.25` ≈ 1.11, so a default-claim memory is back
under `PHI_PRUNE` in about 170 lived days (a fact) to 270 (a person, with the emotion
lift), and past the 90-day dwell by then. Measured through the hooks: without the gate,
`test/recurring-reinforce.test.ts`'s yearly birthday was let go 263 lived days after its
first May 14. So `pruneVerdict` takes `ctx.recurring` and blocks with `recurring`, the
way `protected` blocks; `sleep/prune.ts` reads it off the row (`store#recurrenceOfRow`,
the predicate `recurringMemories` uses). Nothing else moves here: decay, band and strength
are unchanged, so the memories view still shows a repeat as fading between its dates.
(Prospective, in the review of #341, stopped refusing a live repeat `faded`, so a QUIET
yearly that faded by its next date is still cued on it — prospective NOTES §16.) The
entity-card fade (`schemas/`) never passes it. The memories view's `letGoDay` did not
either, so the view called a faded repeat "fading" and gave it a let-go day the prune
would refuse; it passes it now (2026-10-09, below), and the view shows the repeat instead.
`fired.ts` counts it with `protected` and `in-live-revision-chain` as a real refusal —
and so `pruneVerdict` names it only where the floor would otherwise have let the memory
go (review of #341). It is an exemption from the floor, not a standing rule: named on
every live repeat every night, a strong daily pill reminder read as a refusal and turned
the fired view's prune row BLOCKED on a store where nothing was wrong.

Why `surfaced` and not `referenced`: an occurrence delivered is a showing, and nothing
says the reply used it; and `creditReturn` refuses `not-referenced`, so a schedule earns
no return and a daily `self` reminder cannot walk the slow core lane on the calendar
alone. The rep arm still climbs where the kind has one (`uses` +0.25 a day: a daily
`fact` sits at the 0.5 cap after about 17 days) — rehearsal working, not a side effect.

## 2026-10-09 — `protected` is named on the same terms (follow-up to the review of #341)

The review of #341 made `recurring` an exemption FROM THE FLOOR: named only where the
three floor conditions would have let the memory go. `protected` is the same kind of
gate — the owner's "never forget this", not a reason the memory is still strong — and
was still named on every protected row every night. The self page is born protected
(`self/page.ts`), so every store with a page carried a `protected` refusal per cycle,
and `fired.ts` counts `protected` as a real refusal: the owner's store, under three
weeks old, read "memory.pruned BLOCKED: 10 refusals, protected ×8" when nothing there
could have sat out the 90-day dwell. Now `pruneVerdict` names `protected` only where
`floorLetsGo`. Outcomes are unchanged — where the floor holds, `blockedBy` already has an
arithmetic reason — and so is the entity-card fade's verdict (`schemas/` filters the same
list; a card above the floor is held by `above-floor`). Measured through the hooks
(`test/recurring-reinforce.test.ts`): a protected memory and the self page over seven
nights count no `protected`, and the fired view's prune row is not BLOCKED.

`in-live-revision-chain` followed in the review of #343, on the same terms. A superseded
row is archived by `supersede`, so the prune never reaches it; what the gate holds on a
live row is challenge pressure standing against it (`pressureAt > 0`) or a version that
still points at a successor within H lived days — and either one was counted on every
night it lasted, however strong the row. Now all three named rules count only where they
are what kept the memory. Measured through the hooks (`test/recurring-reinforce.test.ts`):
a row under pressure, still in its live chain each night, counts no
`in-live-revision-chain` over seven nights, and the fired view's prune row is not BLOCKED.

The memories view's `letGoDay` passes the row's recurrence (`store#recurrenceOfRow`) as
`ctx.recurring`, so the dashboard asks physics the exact question the prune asks: a
faded repeat is not "fading", has no let-go day, and its row and card say how often it
comes round instead.

## 2026-10-10 — Group 1, strength: the power-law curve, below reach, the dated hold (g1a)

The mechanisms review (`~/counterparts-notes/2026-10-10-mechanisms-synthesis.md` §1 G1, review
03) found decay close to cosmetic: one exponential with S ≥ 60 for every memory, nothing below
anything, and the first possible exit at lived day 91. What changed here, all lightly held
(revisit after ~5 lived days; Mike walks `docs/IMPROVEMENTS.md` "Decisions to review"):

- **The curve** (b2+f8): power-law, ψ = 1; `S = 0.4 · e^(8q) · (1 + 0.5 ln(1+uses)) · (1 +
  ln(1+returns)) / κ`, `q = clamp01(sal + 0.5 I)`. `EMO_SLOPE` and `S_BASE` are gone. The
  design table of 03 §5 is a test (±1 lived day, `test/strength.test.ts`): the closed form is
  `t_reach = S · (h/0.15 − 1)`.
- **Feeling once** (b2+f8, 02 C1): `emotional` out of `sal()`'s mean. Consequences on an
  existing store, by name: every `sal()` reader moves — `challengeForce`, `revisionBar` via
  strength, recall's turn gate (`gatedSal` now adds `EMO_LIFT × I` on a felt turn only) — and
  rows with an `emotional` score lose that share of their mean (their claim floor stays).
- **Never fades = S = ∞** (03 D6): the identity band, and any κ = 0 kind. `decay()` keeps its
  early return for identity only as a fast path; `stability()` returns ∞ either way.
- **The anchor** (g1a-builder): `decayAnchor = max(lastUsedDay, lastReturnDay,
  lastDreamDay)`. A return's ×(1 + ln(1 + w)) on S alone lifts a faded default note by ~0.01;
  the synthesis says a replay revives, so the replay re-anchors t. `creditUse` still reads
  `lastUsedDay` alone (no credit-today collision, the one 07 C1 warned of for a nightly touch).
- **The dated hold** (b2+f8, 07 C1/C2): `MemoryPhysics.hold`, computed at the read seam
  (`store/operational.ts#datedHold`) from `event_date`, `learned_on`, the repeat word and the
  store's calendar today (`meta.lastActiveDate`, read beside the row by `Store.row()` as
  `today_date`). Pending → t = 0; spent → q = 0 and t from the window's close at the latest
  (calendar days since the close, an upper bound on the lived days since). Held through
  `HOLD_GRACE_DAYS` (= prospective's 7-day grace); a repeating date through each occurrence's
  window, `HOLD_LEAD_DAYS` (3) before to the grace after, fading between (the owner's 10-09
  design: "its strength still decays for recall and display") — g1a-builder. A memory read without the store's today (a bare `SELECT *`) carries no hold;
  every `Store.row()` / `read()` / `physicsOf()` does.
- **Below reach** (b2+f8, 03 C2): `REACH = 0.15`, `belowReach(m, d)`; never for the identity
  band. `nextChangeDay(m, d)`: the next band / reach / prune-eligibility day (13 C2), d + 1 for
  a dated memory (the calendar turns it), `NEVER_CHANGES` for the core.
- **Exit** (b2+f8, 03 C3): `D_FLOOR_DAYS` 90 → 14, dwell from the anchor. Archival.
- **Review of #372, on a copy of the live store (decided by Mike, 2026-10-10, loosely held):** the spent slope is the
  memory's own stability / `SPENT_STABILITY_DIVISOR` (4), until a use after the window (q = 0
  had archived 9 of 17 dated memories in 30 lived days, among them a felt fact); skill and place
  `wSal` 0.4 → 1.0 (a 0.25 skill was born at 0.10, below reach); `symmetryCheck` flags only
  up-ratchets — an up-move with no input behind it (`BandTransition.cause`, recorded by the
  decay pass from the row's cleared next-change day) or ups past the ratio; downs never.
  "Used after the window" reads lived days since the anchor against calendar days since the
  close: on a store mostly left alone during a window it errs toward ordinary.
- **Revision pressure stays exponential** (g1a-builder): `pressureAt` defaults its own shape.
- **Expected the first night on an existing store:** many rows cross `THETA_SEM` downward at
  once (the curve and `sal()` both moved), so the symmetry tripwire may read
  `reverse-ratchet-suspected` for a while. That is the curve arriving, not a ratchet; it is
  left to fire rather than suppressed. `CORE_SLOW_FLOOR` (0.5) now reads the new strength.
- **Flagged, not fixed:** a kind whose ω_sal is 0.4 (skill, place) at the 0.25 default is born
  at 0.10, below reach (03 D3 warned the routine default must sit above REACH).

## 2026-10-10 — the default by what a memory is about; a feeling stops under the floor; "strongly felt" by the word (Group 1c)

- **`defaultClaimFor`** (review 01 C2; the work-event row raised 0.10 → 0.20 by b2+f8 after
  the review of #369, lightly held — G1a's `REACH` is 0.15, and a routine work event should
  stay in reach about a lived day): an unclaimed authored memory's floor is 0.20 for a
  done work event (`about=work`, `status=done`), 0.25 for other work and for an unmarked
  memory (`AUTHORED_DEFAULT_CLAIM`, unchanged), 0.35 for the world, 0.40 for the owner, us
  or me — or said by the owner, or kind self/person (checked first, so the owner's ruling
  about work is not a work event). The mint reads `about` from the door
  (`MintOptions.about`), `status`/`saidBy`/`kind` from the proposal; `salience.defaulted`
  carries the `class`. Decided by g1c-builder, 2026-10-10, lightly held; revisit after ~5
  lived days. Why: 01 D2's table; unmarked keeps 0.25 because `status: done` alone is not
  enough to call an unmarked memory routine.
- **`FELT_HEIGHT_CAP` 0.49** (`salArm`): the old invariant "a strong feeling alone does not
  make a silent note semantic" was arithmetic (0.25 + 0.15 < 0.5) and the 0.40 default
  breaks it (0.40 + 0.15 × 0.9 = 0.535). Now a memory whose own `sal` is under `THETA_SEM`
  is lifted by feeling at most to 0.49; one at or above it keeps the whole lift. This is
  b2+f8's "feeling sets stability, not the band" (§4 #7) on the height side, and it covers a
  feeling recorded later, which a cap at the mint could not. It is general, not only for
  defaulted rows: an explicit claim under 0.5 with a strong feeling no longer starts
  semantic either (it did at 0.35–0.49). Decided by g1c-builder, 2026-10-10, lightly held;
  revisit after ~5 lived days. Why: no column or meta read is needed, and a writer who
  wants a memory semantic says 0.5 or more. **Overlap with G1a**, which is changing `sal()`
  and `stability()` in the same file: `salArm` reads `sal()` and nothing else of theirs.
- **`CORE_FAST_ABOVE_DEFAULT` 0.1, `CORE_FAST_RELATIVE_FLOOR` 0.5** (review 08 C3; the floor
  from the review of #369, b2+f8, lightly held): the fast lane's feeling half opens at
  `CORE_FAST_FEELING` or for a feeling of at least 0.5 that is 0.1 above the strength its word is stored at when
  nobody weighs it (`store/feelings.ts#defaultStrength`, capped 0.55, which still keeps an
  unweighed word out). Read in consolidation (`sleep/consolidate.ts#stronglyFelt`) and
  handed in as `CoreContext.stronglyFelt`; the recognition door and `laterFeelingCarriers`
  read the same test (`feelingIsStrong`). On the fixture in
  `test/encoding-attention.test.ts`, 4 of 11 about-us memories with a return three lived days after birth
  now meet the fast lane, against 2 before. The return gate still binds (08: "worth little
  without #5"). The dashboard's "needs intensity 0.6" reading is now one of two ways in.

## 2026-10-11 — the dated hold without the spent slope

- **Cut (Mike, 2026-10-11, lightly held):** `SPENT_STABILITY_DIVISOR`, its "ends on use" rule,
  `DatedHold`'s `spent` state and `stability(m, { spent })`. `datedHold` returns null once a
  one-off date's window (its last day plus `HOLD_GRACE_DAYS`) has closed, so `elapsed` is
  `t = 0` while pending and `d − decayAnchor` otherwise: the memory is on its own curve as if it
  had never been held, t from its own anchor, not the close. The pending hold is unchanged, for
  one-off dates and around each occurrence of a repeating one. The 2026-10-10 bullets above
  describe what this replaces.
- **What it does to a store:** a dated memory with an old anchor reads, the day after its
  window, exactly what a never-dated twin reads. A routine 0.25 reminder written weeks before
  its date is below reach at once, and — past `PHI_PRUNE` with its dwell long done — archived on
  that same night's pass (the test in `test/strength.test.ts` asserts it, and the twin was
  archived weeks earlier). A felt 0.6 fact stays in reach for months on its own curve.
- **Readers of the spent state, all checked:** `elapsed` / `decay` / `daysUntilBelow`
  (here); `sleep/decay.ts#bandMoveCause`'s `held` (now only a pending hold, the case a repeat's
  window opening still needs); `nextChangeDay` (`d + 1` while held, so the first pass after the
  close looks at it and gives it its normal day); `store/operational.ts#eraClaimOf` and
  prospective's `faded` (both test `pending` only, unchanged). The dashboard's "hold"
  (firm / settling / fading) and meaning mode's `hold` are other things.
- **The curve signature** drops `spent: 4` for `afterHold: "own-curve"`, so a store signed by
  the ÷4 build re-curves once: every next-change day forgotten, every live row read on the next
  pass. On a synthetic 1,100-row temp store (the owner's size) that pass examined all 1,100 rows
  within the decay budget (20,000) and the whole cycle took ~55–65 ms against ~40–45 ms for a
  steady night: one pass, no backlog.
- **Not fixed, pre-existing:** a repeat between windows carries no hold, so its next-change day
  is its curve's, and nothing makes the turn-down look at it the day its next window opens on
  the calendar; until some pass reads it, the ranking cache can still read it below reach
  (ambient recall prefilters on that cache).

## 2026-10-14 — the era all the way down, and the wait under the floor

Decided by Mike, 2026-10-14, lightly held; review 2026-10-18. Both from a read-only analysis
of a copy of the live store (lived day 23).

- **The era's scale-down reached the claim and stopped there.** `sal()` is
  `max(mean of the dimensions, claimed)`, and the era replaced only `claimed`. Pre-Group-1
  memories carry author-scored relevance/predictive (mean ~0.29 / ~0.21; since Group 1 a
  writer leaves them at ~0.02), so of 485 lowered claims 103 read no lower at all and the
  lowered median read 0.395 against the 0.25 meant. `curveSal` now returns `eraClaim` alone
  when it is below the stored claim. Considered and not taken: scaling the dimensions by
  `eraClaim / claimed` (keeps the high-dimension rows above the default, the very rows at
  issue), and zeroing only the author dimensions while keeping novelty (closer to a fresh
  install, but novelty alone tops even the lowest default only above 0.6; not worth the extra rule).
  The 106 memories the era raises read as before, and so do the era's exempt (review of
  #494): an old DEFAULT on a protected, core, owner's or dated row is still read at today's
  default (2026-10-11), but floored by its own dimensions as on master — the seam marks it
  `eraExempt` (`store/operational.ts#eraExemptRow`, the one exemption list). None on the live
  copy. Below reach on that copy: 332 of 1,603
  prunable live rows with the fix off, 570 with it on.
- **The prune had no real wait.** `pruneVerdict` counted `d − decayAnchor(m)`, days since the
  last use, so a memory unused for weeks was archived the first night it crossed the floor.
  Now it counts lived days under the floor: `floorDay(m)` (anchor + `daysUntilBelow(φ)`, off
  the curve, never stored), never earlier than `curveSince`. Deriving the crossing from the
  curve alone back-dates it whenever the curve changes — the era fix above would have read
  130 memories as under the floor for weeks — so the decay pass records the lived day a new
  curve signature arrives (`decay.curve.since`, a `meta` row; no column, no store version) and
  `sleep/decay.ts#curveSinceDay` hands it to the prune (`d` itself while the store is still
  signed under another curve). A first signing writes it too (review of #494): a store from a
  build older than the signature (npm 0.3.15/0.3.16) would otherwise have had no pause. So a
  brand-new store pauses its first 14 lived days as well — harmless, nothing in it is old;
  tests about the prune on a settled store use `test/store-fixture.ts#settledCurve`.
  The dashboard's `letGoDay` / `holdOf` read the same `curveSince`.
- **What the wait does not cover:** a per-memory lowering (a `changed` fade, a smaller claim)
  and a dated memory whose window closed still read as if always on the lower curve — the
  same as before, no regression; the 2026-10-11 bullet above about a reminder archived "that
  same night" still holds when its own curve went under the floor 14 or more lived days
  earlier. The cost of the guard: every curve change pauses every exit for 14 lived days.
  A budgeted prune pass that reaches a row late only delays it.
- **`dwell-too-short` is named only under the floor**: above it the memory has not started
  waiting and `above-floor` speaks alone, so the night's count is the memories waiting out
  their 14 days. `PruneVerdict.dwellDays` keeps its meaning (days since the anchor; the entity
  fade's kind floor reads it); `belowFloorDays` is the wait.
- **Measured on that copy (lived day 23), nothing used meanwhile:** under the floor tonight,
  0 — so 0 exits tonight under every rule. Through day 37 (the next 14 lived days) the old
  count would have archived 74 with the era fix off and 130 with it on; the new wait archives
  0. The first exits come on day 39; by day 44, 26; by day 51, 130 (fix on).


## 2026-10-21 — support: how a belief is earned (wave 2 lane C, §5.13)

**Why support is a use, not a return.** The brief asked for "a return-like credit". A return
here only lengthens stability (`R`), so a belief credited by returns alone would never rise
above its birth ceiling (0.3) — "resistance comes from accumulated support" (design §5)
could not hold. So the support's sum is the belief's `uses`, and the last day support
counted restarts its curve. The `returns` table's key (memory, day, source) would also have
collapsed two supports filed the same day.

**Its own arm, its own resistance (the coordinator's redirect on #575).** The first build
put support through the repetition arm (capped at `REP_CAP` 0.5, so no belief could reach
the semantic floor, nor lane F's core floor) and left resistance to `ι × strength` — a
belief on the self subject is kind `fact`, ι 0.2, so its bar was at most 0.1 and one
ordinary contrary memory flipped the best-supported belief about me, the inverse of design
§5. Now: a support arm (`BELIEF_SUPPORT_CAP` 0.9, `SCALE` 4) replaces the repetition arm for
a belief and sets its steepness; and the bar is `beliefResistance`, from support and the
lived days it comes from. The first shape (`min(1, days/2)²`) hardened in two days — two
supports over two days resisted ~0.76, nearly a month-old belief's — so the days term is
log-shaped over about two weeks (`ln(1 + days) / ln(15)`, design session 10-21). Numbers at
the defaults: one support from one day 0.17, two 0.19 (under the daily cap, contested the
same day); two over two days 0.28; a support a day for a week 0.72 (holds two days, goes on
the third); ten over twenty days 0.97; thirty days of daily support ~1.0 (three days, never
more). The bar does not decay with the belief's strength: it is what life put behind it;
the pressure decays on its own.

**Contested, not superseded.** Crossing the bar used to mint a successor in the challenger's
words, so a memory's body became a belief. A belief born under lane C now keeps its words,
takes `BELIEF_CONTESTED_FADE` once, restarts its pressure and carries `meta.contested`; the
reflection decides what to do with it (C2/C3). A migrated belief keeps the old path.

**The cost of recounting.** On 2,000 beliefs × 20 supports (40,000 rows; a temp store, bun),
a 21st filing with its whole-table recount takes 0.30 ms at the median and 0.64 ms at p95,
an unfiling 0.32 / 0.67 ms: the recount reads only that belief's rows (the key's prefix) and
each counted memory's row.

**Review of #575 (2026-10-21).** Support is the belief's own now (`support`, `supportDays`, a
box-2 meta row per belief, read beside the row): the first build put it in the shared `uses`,
which `Store#reinforce` also writes, and the reviewer lifted a belief with no support from
0.10 to 0.78 by reinforcing it on eight days — the shown → used → stronger loop. A belief
also takes no use credit or return at all, for now. An un-echoed find counts its filing day
(ten old memories found on one night had hardened a belief to 0.82 at once: "hardened by the
reflection alone"); once life echoes it, its memory's own day. A stronger contrary memory the
same day tops the day's pressure up to its force (`applyChallenge`'s `creditedToday`), so a
second one is not lost to the once-a-day rule. A contested belief is cut once.
The row read's support join first asked `PRAGMA table_info` on every read (5,000 reads 32–40
→ 123–143 ms, re-review of #575); the v14 column is now asked once per store
(`reads-memories.ts#hasBirthRoute`), back to 31–37 ms, recount 0.38 ms p50, and a test counts
the PRAGMAs so it cannot quietly return. A supporting memory the owner has made dark still
counts until the chase removes it (minor, left as is).

**R2, the writing session, not the birth day (2026-10-24, lightly held).** `creditUse` and
`creditReturn` take `ownWrite` from the caller; physics stays pure. `Store#reinforce` decides
it from the row (origin session, or `meta.writtenUpBy` for a write-up), because every credit
path ends there (recall's opens, quotes, drewOn and ratings, chapter copies, the self page's
confirm) and the store already hands physics the one other row fact, the display. Three
choices the brief left open: a non-writer's birth-day credit counts a reinforced day (the
first credit is told apart by `reinforcedDays === 0` on a memory whose `lastUsedDay` is still
its birth day); a return on the birth day stays `birth-day` for anyone but the writer, since
spacing measures from birth; and `own-write` holds on the birth day only. The first build
refused the writer on every day, and `test/settled-repeats.test.ts` caught it: one session
that wrote a memory on 10-03 and drew on it on 10-12 lost that credit. A session can run for
days (a resumed conversation, a Desktop chat), and its later uses were always credited. Dream replays, reflections, schemas mentions and
reminder occurrences pass no session, so they keep the birth-day rule.

**R3, cue learning's switch (2026-10-24, an experiment).** `CUE_LEARNING` sits here beside
`OWN_WRITE_GATE` because both modules it gates read physics: recall (recording a turn's cue
words, training at credit, and the read) and associate (buffering, flushing, `learnedCues`).
Training reuses `creditUse`'s verdict for the writer's birth-day session (`own-write`) rather
than re-deriving it: recall trains on `credited` or `already-credited-today` only.

## 2026-10-24 — the core door is one support arc (E2, an experiment, `CORE_DOOR_SUPPORT`)

**What the arithmetic forced (the first cut; recalibrated below).** The `returns` table keeps one row per memory, lived day and
source, and `creditReturn` refuses a second awake-class return the same day, so "three uses in
one session on one day" is one filing before the spread discounts are ever asked; a reflection
returns at most weekly, so "five nights of citations" is one filing unless the nights are a week
apart. With the belief's own numbers (cap 0.9, scale 4, fourteen days) one lived day's factor is
0.256, and the only thing that tells "one strongly felt use" (in) from "one plain use" (out) is
the feeling multiplier: 0.0618 at 0.5, 0.051 unfelt. That sliver is where the line sits, and it
is the honest shape of "one strongly felt return gets most of the way": the second occasion on
another lived day, not a higher threshold, is what an unfelt memory needs (0.129).

**Lived days, not filing days.** The belief's `days` gives an un-echoed find its filing day (one
night of finds, one day of hardness). Here each citation is its own week, so that reading let two
weekly citations of a never-used memory cross (0.097 at the first line) — the reflection carrying
a memory alone. `SupportCredit.livedDays` leaves an un-echoed find's day out (lane F's
`livedSupportDays` already reads it so), and the door reads it: a reflection alone has no lived
day and level 0, by arithmetic rather than a rule; a later real use echoes every earlier find,
which then counts full on its own day. Additive: no belief reads it.

**A filing's own day as its "born" day.** `supportCredit` decides echo and same-day spread by the
counted memory's birth day. For a memory's own evidence the occasion is the return, so each
filing's day stands there; with the memory's birth day instead, every filing after the first
would take SAME_DAY and no find could ever be echoed. Returns keep no folder, so every filing
shares the unknown one and takes SAME_FOLDER after the first: a constant 0.75 until a return
records its folder.

**The harness, the first cut (10-24 and 10-23 corpora, the same life a day apart; identical answers).** Off is
byte-identical to master (JSON equal but the run's instant, its settings line and the random ids
of contradiction pairs). On: 9 core at the end against 12; the first promotion on day 7 (the
lanes' first on day 8), then none until day 19, by when the lanes had 6. Of the lanes' 12, 5
cross on too (both slow-lane ones, one of them ten days sooner, by a re-encoding and a use); 7 do
not, every one a fast-lane memory that came in on a reflection's citation alone (its finds still
un-echoed at the end). Every fast-lane memory that had a real use still crosses (3 of 3). 4
enter that the lanes left out: one use at intensity 0.5 (two), a find echoed by a later use (one;
that use, felt at 0.5, would have carried it alone), two same-day re-encodings of its slot (one).
The memories glimpsed and never used (211 on 10-24) file nothing from their glimpses: 159 have no
other evidence in their slot (level 0), 52 carry their slot's real uses or re-encodings.

A second-order effect to know: what is core changes what the wake shows in its hints lane, and a
use while shown there is not a return. One memory's day-18 use was a return with the door off
and on display with it on.

**The review's recalibration (E2 review, 2026-10-24, the roadmap seat's target).** The first
cut's line was a sliver between one plain use and one use felt at 0.5, so the door was in effect
"one use felt at 0.485 or more" — the day after birth included (`mem_3d44aeb08b60`, one use the
day after it was made), and a writer's bare `emotional: 0.5` claim with it (`mem_fd38c2c77233`).
Neither is "from separate moments, over time". Two calibration moves, both inside the arc:
- the days factor counts the SLOT'S MAKING as its first lived day once any lived filing stands
  (a reflection alone still gives none), and a lived filing fewer than `CORE_SUPPORT_GAP_DAYS` (2)
  after it as that same day: the making and the next day are one occasion. This is the fast
  lane's gap, read as spacing in the days count — a day count cannot see spacing otherwise;
- the line moves 0.0615 → 0.1005, midway between one spaced use felt at 0.55 (0.0997, the most an
  unweighed word gives) and at 0.6 (0.1013, the fast lane's bar). A sharp feeling bar is a cliff
  in level whatever the line: `SUPPORT_FEELING` 0.5 puts the whole 0.55–0.6 band inside 0.0016 of
  level, so the margin that matters is in the feeling the line stands for (0.575), against the
  feelings real memories carry. On both corpora 0.0999, 0.1005 and 0.1012 cross the same six.
What it gives up: `mem_c439775f4cb8`, one use felt at 0.5 that its word called strongly felt
(0.1 above the word's default), now waits for a second occasion. The door reads intensity, not
the word-relative "strongly felt" (`stronglyFelt`); making the door read that judgement is a
design question, not a line. The record's `support.days` now includes the making's day, so a
single spaced use reads "2 lived days", and it no longer equals lane F's `livedSupportDays`.
Slots written twice on their first day by two sessions (`mem_8412e26dc04e`, then used the next
day; `mem_b5d49bb663b2`) are one occasion now and cross when life comes back to them (days 30 and
29, against the first cut's 21 and 20; the lanes took the first on day 31 and never the second).
Six cross on both corpora (the lanes 12, the first cut 9); on days 7/14/21/28 and the last the
core reads 0/0/3/4/6 (the lanes 0/6/10/11/12). Of the first cut's nine, the three that leave are
the three single uses felt at 0.5; nothing enters that the first cut left out. Nearest real
levels to the line: 0.1013 above (`mem_ed879e9691a6`, one spaced use felt at 0.6), 0.0980 below
(the two felt at 0.5).

## 2026-10-24 21:00 — merged in shadow (E2 addendum)

`CORE_DOOR_SUPPORT` has three values (`CoreDoorMode`), read only through `coreDoorMode()`, and
`promotionEligibility` takes an optional third argument, `supportDoor`, so the shadow in
`sleep/consolidate.ts` asks the arc's question with the same function the door on uses (no second
copy of the eligibility rules to drift). The default argument is the setting's, so every other
caller is unchanged. Default `"shadow"`: the lanes decide; the arc's answers are rows
(`promotion.shadow`, `promotion.shadow.sleep`; sleep NOTES). Promoting or reverting is one value.
