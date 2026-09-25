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

## Spacing credit (2026-09-25)

The owner's "rich get richer", on a four-day-old store with few personal memories: one
emotional memory sat in the wake's "Nearby, if it helps:" lane nearly every session, the
assistant mentioned it, the mention was credited, and `creditUse` added the full tier
weight on every new lived day whatever the gap — so `uses`, and with it `stability`
(`S_BASE × (1 + BETA × ln(1 + uses))`), climbed every day it was shown. The other half of
the loop, the lane's ordering, is `self/`'s (self NOTES §26).

- **The curve.** `credit = w × max(SPACING_FLOOR, 1 − exp(−gap / SPACING_DAYS))`, `gap`
  in lived days since `lastUsedDay`. Smooth, monotone, below 1 for every finite gap. At
  `SPACING_DAYS = 7`: 0.13 the next day, 0.35 at 3 days, 0.63 at a week, 0.86 at two
  weeks, 0.95 at three. `SPACING_FLOOR = 0.1` never binds at 7 (gap ≥ 1 gives 0.133) and
  exists so a longer time constant cannot make a real use worth nothing.
- **Why 7.** Full credit should arrive where forgetting has visibly begun, since
  re-learning what was fading is what spacing rewards. The shortest stability any memory
  has is `S_BASE / kappa = 60` lived days (fact); at 7 days decay has taken ~11%, at 14
  ~21%, at 21 ~30%. A lived day is an ACTIVE day, and the owner's clock ran 7 lived days
  across 15 calendar ones in September, so this is slower in calendar time than the
  literature's gaps — on purpose: nothing should become near-immortal by being talked
  about daily. Measured in `test/hints-nearby.test.ts`'s ten-render simulation: seven
  credited showings came to ~1.26 uses where they used to be 7.
- **`reinforcedDays` is NOT scaled — decided, and why.** Promotion (`N_PROMOTION_DAYS = 3`,
  owner ruling) counts distinct lived days a memory proved useful; it is an occasion
  count, not a magnitude, and the "two days is not three" guarantee is about days. So three
  days in a row still count three. What changes is the rep arm of `base`: `rep = 0.12 ×
  uses` now needs well-spaced use to climb, so a rep-driven memory (skill, place, entity,
  fact) reaches the identity floor more slowly under massed use. A salience-driven memory
  (self, person) was never rep-driven and promotes exactly as before on three distinct days.
  That leaves one path to identity through daily wake echoes — a high-salience memory
  mentioned three days running — and the thing that stops the wake manufacturing those
  days is the hints lane's habituation (self NOTES §26), not a second rule here.
- **`AUTHORED_DEFAULT_CLAIM`'s arithmetic.** Its note said "rep 0.3 needs 3 credited days";
  that is now three FULL credits — three well-spaced days, not three in a row. The comment
  was amended in place; the constant and its bound (`0.25 + CONS_BONUS < THETA_SEM`) are
  unchanged.
- **The store needed nothing.** `Store.reinforce` applies `creditUse`'s verdict
  absolutely and `uses` is a REAL column; the new `spacing` / `credit` fields ride on the
  returned `CreditOutcome` for any caller that wants to report them.
- Tests that pinned `uses` as a COUNT of credits (lifecycle, entity-named) now pin
  `reinforcedDays`, which is what they were counting; tests that pin the amount compute it
  with `spacingFactor`.

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
