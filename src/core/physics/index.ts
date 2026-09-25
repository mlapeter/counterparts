/**
 * `physics/` — all the arithmetic of memory on one page.
 *
 * Implements CONTRACT.md §5 exactly (including the 2026-08-25 rewrites of §5.3
 * bands and §5.6 revision). PURE FUNCTIONS ONLY: no I/O, no model calls, no
 * imports beyond `../types.js` and this module's own clock. Guarantee 1 is a test
 * that asserts precisely that.
 *
 * Nothing here mutates its arguments. Every state-changing operation returns the
 * NEXT values for the caller to persist, plus the verdict and the reason for it.
 * Reasons are first-class: a bare boolean cannot be told apart from a bug
 * (scar §2.4 — "a number in a log is not a monitor").
 *
 * Implementation choices where the contract is silent are recorded in NOTES.md.
 */

import type { Band, Kind, MemoryPhysics, Salience } from "../types.js";
import { BOUNDARY_HOUR_DEFAULT } from "./clock.js";

export { dayKey, livedDay, livedDaysBetween } from "./clock.js";
export type { Band, Kind, MemoryPhysics, Salience } from "../types.js";

// ---------------------------------------------------------------------------
// The TUNABLE table — every constant in physics, in one visible place.
// CAL = calibration-required: it must ship with a recorded measurement against
// the real space, or ship disabled (scar §2.8, guarantee 11).
// ---------------------------------------------------------------------------

export const TUNABLES = {
  // --- §5.2 strength ---
  /** Repetition credit per use [v0, verbatim]. */
  REP_PER_USE: 0.12,
  /** Repetition cap. With CONS_BONUS this tops out at 0.70, structurally below
   *  THETA_ID = 0.85 — guarantee 4 is arithmetic, not a check [v0; v1 §10 G11]. */
  REP_CAP: 0.5,
  /** Consolidation bonus [v0, verbatim]. */
  CONS_BONUS: 0.2,

  // --- §5.3 bands ---
  /** Semantic floor, evaluated on DECAYED strength (§5.3 rewrite). */
  THETA_SEM: 0.5,
  /** Identity floor, evaluated on `base` — one half of promotion eligibility. */
  THETA_ID: 0.85,
  /** Distinct lived days of reinforcement required to promote (owner ruling N = 3).
   *  Same number, same ancestry, as the slow-kind revision pace (Amendment 15). */
  N_PROMOTION_DAYS: 3,
  /**
   * The salience-claim ceiling for a FALLBACK-minted memory (owner ruling
   * 2026-08-29, the authorship doctrine's salience half): the experiencer's own
   * "remember this" commands the full 0-1 floor — lived testimony, the analog
   * of affect stamping a memory vivid at encoding — but the crash fallback's
   * author is a model retelling a transcript after the fact, and a reteller's
   * claim is CAPPED. The first blind replay showed why: 97.9% of sweep mints
   * self-claimed importance (mode 0.8), parking ~75% of the store above
   * THETA_SEM with no independent check (review F5). 0.6 clears the semantic
   * floor (a crashed day still matters) and sits structurally below THETA_ID.
   * WORKING DEFAULT — to be revisited against the re-run's watch metrics.
   */
  SWEEP_CLAIM_CEILING: 0.6,
  /**
   * CAL. The claimed floor an AUTHORED memory gets when its author claimed
   * nothing — the authorship doctrine's other half, measured 2026-09-04 on the
   * live parallel-run store: all 48 authored memories carried
   * relevance/emotional/predictive = 0, so an unclaimed note's `sal(m)` was
   * ZERO. It was the weakest thing in the store, first to decay, and (now that
   * `challengeForce = strength x sal`) any revision it declared pushed with no
   * force at all — the exact inversion of "the experiencer's testimony is
   * trusted". Silence is the common case: the asks never say to set salience.
   *
   * WHY THIS NUMBER, and it is arithmetic rather than taste:
   *   - `AUTHORED_DEFAULT_CLAIM + CONS_BONUS = 0.45 < THETA_SEM = 0.5`, and the
   *     largest `wSal` is 1.0, so a defaulted memory CANNOT reach the semantic
   *     band on the default alone — not even after consolidation. It gets there
   *     only by being used (rep 0.3 needs 3 FULL credits — since the 2026-09-25
   *     spacing rule, three well-spaced credited days, not three in a row) or by an author
   *     actually claiming something. That is the structural form of v1's scar:
   *     a mode-0.8 self-claim parked ~75% of the store above THETA_SEM.
   *   - 0.25 < 0.34, the measured mean of the claims authors DID make, so
   *     staying silent says strictly less than speaking.
   *   - 0.25 < SWEEP_CLAIM_CEILING = 0.6: the default is a floor under the
   *     lived channel, not a promotion of it over the retelling channel.
   *   - It buys survival rather than rank: at kind `fact` (S = 60 lived days)
   *     strength falls below PHI_PRUNE = 0.02 after ~152 lived days instead of
   *     being prunable from birth.
   * ENGINE-SET off the mint CHANNEL, exactly like `SWEEP_CLAIM_CEILING`; an
   * explicit claim, however low, is never overridden. WORKING DEFAULT.
   */
  AUTHORED_DEFAULT_CLAIM: 0.25,

  // --- §5.4 decay ---
  /** Stability base, lived days. Reproduces v0's -0.015/day over ~a month. */
  S_BASE: 60,
  /** Use-stability coupling; logarithmic so a well-used memory slows without
   *  becoming immortal. */
  BETA: 0.5,
  /** Local rollover hour for the active-day clock (see clock.ts). */
  BOUNDARY_HOUR: BOUNDARY_HOUR_DEFAULT,
  /** CAL / open question 1 — a three-way decided by replay, not by taste.
   *  v1 ran flat, this page defaults exponential, engram upgraded to power-law
   *  (Ebbinghaus / Wixted / Jost). `tools/replay` runs all three. */
  DECAY_SHAPE: "exponential" as DecayShape,
  /** CAL. Power-law exponent, used only when DECAY_SHAPE === "power-law". */
  POWER_LAW_PSI: 1.0,

  // --- §5.1 salience ---
  /** CAL. Size of the nearest-neighbour slice in E(m) for novelty (v1's top-M). */
  K_NEAREST: 8,

  // --- §5.5 reinforcement ---
  /** Retrospective credit weights by tier. The ignorable tier never trains. */
  W_REFERENCED: 1.0,
  W_SURFACED: 0.25,
  W_FOOTNOTED: 0.0,
  /**
   * CAL. THE SPACING EFFECT (2026-09-25, owner's "rich get richer"). A credited
   * use adds `w x spacingFactor(gap)` to `uses`, where `gap` is the lived days
   * since `lastUsedDay` and `spacingFactor = max(SPACING_FLOOR, 1 - exp(-gap /
   * SPACING_DAYS))`: a use the day after the last one adds little, a use after a
   * long gap adds (nearly) the whole tier weight — massed practice buys less
   * than spaced practice, as in people.
   *
   * WHY 7 LIVED DAYS. The curve should reach "full credit" where forgetting has
   * visibly started, because re-learning what was on its way out is the thing
   * spacing rewards. The shortest stability any memory has is S_BASE / kappa =
   * 60 lived days (fact, kappa 1.0); at 7 days `exp(-7/60)` has taken ~11% off
   * strength, at 14 days ~21%, at 21 days ~30%. With 7 as the time constant the
   * factor reads 0.13 next day, 0.35 at 3 days, 0.63 at a week, 0.86 at two
   * weeks and 0.95 at three — so the daily loop that motivated this (shown in
   * the wake, mentioned, credited, shown again) gains ~0.13 uses a day instead
   * of 1.0, and `stability` (which grows with log(1 + uses)) barely moves. A
   * lived day is an ACTIVE day (clock.ts), so on the owner's measured pace (7
   * lived across 15 calendar days in September) "a week" is closer to two
   * calendar weeks — slower than the literature's optimal gaps, on purpose:
   * nothing here should make a memory immortal by being talked about daily.
   * WORKING DEFAULT, to be re-read against replay.
   */
  SPACING_DAYS: 7,
  /** The smallest fraction of the tier weight any credited use adds. With
   *  SPACING_DAYS = 7 it never binds (gap >= 1 gives 0.133); it is here so a
   *  longer SPACING_DAYS cannot make a real use worth nothing. CAL. */
  SPACING_FLOOR: 0.1,

  // --- §5.6 revision ---
  /** Pressure stability, lived days. Same curve FAMILY as memory decay, its own
   *  constant: challenge persistence is not the target's use history (NOTES.md). */
  S_PRESSURE: 60,
  /** Slow-kind daily force cap (iota >= SLOW_KIND_IOTA: self, person). Without
   *  it, one flawless claimed-maximal challenge (F = 1.0) crosses even the
   *  highest self bar (0.9) in a single day, and the ratified "one odd act
   *  doesn't rewrite your model of a friend" ~3-day property is an
   *  approximation, not a bound. 0.35 x 3 days > 0.9 max bar => >= 3 lived days
   *  is now arithmetic. Fast kinds are deliberately uncapped: world-state
   *  should flip on one clear correction. TUNABLE. */
  F_DAY_CAP_SLOW: 0.35,
  /** The iota threshold above which a kind is "slow" for the daily cap. */
  SLOW_KIND_IOTA: 0.8,
  /** Lived days a superseded version stays resolvable. TUNABLE default —
   *  assistant-recommended, explicitly NOT an owner ruling. */
  H_SUPERSEDED_DAYS: 90,

  // --- §5.7 dedup ---
  /** CAL, and the sharpest instance of scar §2.8: in v1's embedding space
   *  arbitrary same-corpus pairs sat at median cosine 0.576, so an intuited
   *  floor is inert. Do not ship this number unmeasured. */
  TAU_DUP: 0.95,

  // --- §5.8 forgetting ---
  /** CAL, and the one constant here with NO ancestry — v1 never pruned, so there
   *  is no measurement to inherit (open question 5). */
  PHI_PRUNE: 0.02,
  /** CAL, same provenance gap as PHI_PRUNE. Lived days of dwell before a floor
   *  memory may be pruned. */
  D_FLOOR_DAYS: 90,

  // --- guarantee 12: the symmetry counter (scar §2.10) ---
  /** Stated expected ceiling on up-moves : down-moves. v1's ratchet read
   *  279:0 — this is the tripwire that would have fired. CAL. */
  SYMMETRY_MAX_UP_DOWN_RATIO: 4,
  /** Below this many moves, the answer is "never asked", not "healthy"
   *  (scar §2.4: "did not fire" and "was never asked" are different records). */
  SYMMETRY_MIN_SAMPLE: 20,

  // --- §5.2 per-kind physics [v1 §4.3] ---
  /** CAL, all of it. v1 recorded which ARM DRIVES, not a weight, so every
   *  non-driving omega below is a proposed reading, not a measurement
   *  (open question 3 asks whether the 0.4s exist at all). */
  KINDS: {
    //         driver (v1)    omega_sal  omega_rep  kappa  iota
    self: { wSal: 1.0, wRep: 0.0, kappa: 0.7, iota: 0.9 },
    person: { wSal: 1.0, wRep: 0.0, kappa: 0.75, iota: 0.8 },
    entity: { wSal: 1.0, wRep: 1.0, kappa: 0.85, iota: 0.5 },
    skill: { wSal: 0.4, wRep: 1.0, kappa: 0.5, iota: 0.25 },
    place: { wSal: 0.4, wRep: 1.0, kappa: 0.85, iota: 0.25 },
    fact: { wSal: 1.0, wRep: 1.0, kappa: 1.0, iota: 0.2 },
  } as const satisfies Record<Kind, KindPhysics>,
} as const;

export interface KindPhysics {
  /** Weight on the salience arm of `base` (§5.2). */
  wSal: number;
  /** Weight on the repetition arm of `base` (§5.2). */
  wRep: number;
  /** Decay multiplier — it DIVIDES stability: fact (1.00) erodes fastest,
   *  skill (0.50) slowest (§5.4). */
  kappa: number;
  /** Revision inertia — the fraction of the target's strength a challenge must
   *  out-sum to land (§5.6). */
  iota: number;
}

export type DecayShape = "exponential" | "flat" | "power-law";

export function kindPhysics(kind: Kind): KindPhysics {
  return TUNABLES.KINDS[kind];
}

// ---------------------------------------------------------------------------
// Small shared arithmetic
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Distinct reinforced lived days; an absent field reads as 0 (the
 *  promotion-blocking direction, so an un-migrated row cannot be promoted). */
export function reinforcedDays(m: Pick<MemoryPhysics, "reinforcedDays">): number {
  return m.reinforcedDays ?? 0;
}

/** Cosine similarity over caller-supplied vectors. Physics never fetches one. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// §5.1 Salience, fixed at encoding
// ---------------------------------------------------------------------------

/**
 * novelty = 1 - max cos( v(m), v(e) ) over the schema slice E(m).
 *
 * E(m) EMPTY — a blind chunk — yields `null`, RECORDED, never defaulted to a
 * number (scar §2.9: blind encoding must be countable, not invisible).
 * Vectors are inputs; this module never fetches one.
 */
export function novelty(
  v: readonly number[],
  context: readonly (readonly number[])[],
): number | null {
  if (context.length === 0) return null;
  let best = -1;
  for (const e of context) best = Math.max(best, cosine(v, e));
  return clamp01(1 - best);
}

/** True when novelty could not be computed — the countable blind-write case. */
export function isBlindEncoding(s: Salience): boolean {
  return s.novelty === null;
}

/**
 * sal(m) = mean of the salience dimensions, floored by the author's claim.
 *
 * With novelty present that is v0's verbatim mean of four. With novelty null it
 * is the mean of the THREE author-supplied dimensions — the null case specified,
 * not implicit (review finding 2), and never a defaulted zero or one.
 */
export function sal(s: Salience): number {
  const dims: number[] = [s.relevance, s.emotional, s.predictive];
  if (s.novelty !== null) dims.unshift(s.novelty);
  let sum = 0;
  for (const x of dims) sum += clamp01(x);
  const mean = sum / dims.length;
  return clamp01(Math.max(mean, s.claimed ?? 0));
}

/** The mean of the stored dimensions alone, ignoring any claimed floor. */
export function computedSal(s: Salience): number {
  return sal({ ...s, claimed: null });
}

export interface SalienceLiftEvent {
  readonly event: "salience.lifted";
  readonly computed: number;
  /** The claim as the author made it (clamped to [0,1] at intake), pre-CAP.
   *  Telemetry must carry it, or the re-run's watch metrics cannot propose
   *  the right ceiling. */
  readonly claimed: number;
  /** The claim actually stored (post-cap): what `sal(m)` will honor. */
  readonly applied: number;
  /** The ceiling this claim was subject to (1 for lived testimony). */
  readonly ceiling: number;
  /** True when the raw claim exceeded the ceiling and was cut down to it. */
  readonly capped: boolean;
}

/**
 * The claim the author never made. Kept SEPARATE from `salience.lifted` on
 * purpose: the lift metric is "how often does an author's claim out-rank the
 * computed dimensions", and folding a defaulted floor into it would read every
 * silent note as a claim and destroy the number the ceiling decision needs.
 */
export interface SalienceDefaultEvent {
  readonly event: "salience.defaulted";
  /** The mean of the stored dimensions — 0 for the case this exists for. */
  readonly computed: number;
  /** The floor applied, i.e. `TUNABLES.AUTHORED_DEFAULT_CLAIM`. */
  readonly floor: number;
  /** What `sal(m)` will honor with the default in place. */
  readonly applied: number;
}

export interface SeamClamp {
  /** The salience to store: dimensions untouched, claim recorded as the floor. */
  salience: Salience;
  /** True only when an AUTHOR's own claim out-ranked the computed dimensions.
   *  A defaulted floor is never a lift — see `SalienceDefaultEvent`. */
  lifted: boolean;
  blind: boolean;
  /** True when the author's raw claim was cut to the ceiling. */
  capped: boolean;
  /** True when the author claimed nothing and the channel's default floor was
   *  applied in its place. Recorded on the row as `meta.claimedDefault`. */
  defaulted: boolean;
  /** The raw claim when it was capped, else null — the minting seam preserves
   *  it in prose meta so the un-capped testimony is never silently lost. */
  rawClaim: number | null;
  event: SalienceLiftEvent | null;
  defaultEvent: SalienceDefaultEvent | null;
}

/**
 * The proposal -> memory seam (guarantee 2). A claimed salience is a FLOOR:
 * `sal(m) >= sal_claimed(m)`, clamped here, and ANY LIFT EMITS AN EVENT.
 * The stored dimensions are never rewritten to satisfy the claim, so salience
 * stays fixed at birth and a null novelty stays null.
 *
 * `ceiling` is the authorship doctrine's salience half (owner ruling
 * 2026-08-29): lived testimony — the experiencer's own deposit — passes 1, the
 * full floor; a retelling author (the crash-fallback sweep) passes
 * `TUNABLES.SWEEP_CLAIM_CEILING`, and a raw claim above it is CUT to it, with
 * the cut recorded on the event and the raw claim handed back for prose meta.
 * The cap runs here and nowhere else, exactly like the floor ("clamped here,
 * once" stays literally true).
 *
 * `defaultClaim` is the same idea in the other direction and the same kind of
 * engine-set number: when the author claimed NOTHING, the channel's default
 * floor stands in (`TUNABLES.AUTHORED_DEFAULT_CLAIM` for the lived channel,
 * `null` — nothing at all — for every other). Silence is not testimony, so a
 * default is recorded as `defaulted`, never as a lift; and an explicit claim,
 * however low, is never overridden, because the branch is on `claimed === null`
 * and nothing else.
 */
export function clampSalienceAtSeam(
  dims: Salience,
  claimedSal: number | null,
  ceiling = 1,
  defaultClaim: number | null = null,
): SeamClamp {
  const raw = claimedSal === null ? null : clamp01(claimedSal);
  const capped = raw !== null && raw > ceiling;
  const defaulted = raw === null && defaultClaim !== null;
  const claimed =
    raw === null ? (defaultClaim === null ? null : clamp01(defaultClaim)) : Math.min(raw, ceiling);
  const salience: Salience = { ...dims, claimed };
  const computed = computedSal(salience);
  const lifted = !defaulted && claimed !== null && claimed > computed;
  return {
    salience,
    lifted,
    blind: isBlindEncoding(salience),
    capped,
    defaulted,
    rawClaim: capped ? raw : null,
    event:
      lifted || capped
        ? {
            event: "salience.lifted",
            computed,
            claimed: raw as number,
            applied: sal(salience),
            ceiling,
            capped,
          }
        : null,
    defaultEvent: defaulted
      ? {
          event: "salience.defaulted",
          computed,
          floor: claimed as number,
          applied: sal(salience),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// §5.2 Strength — the one number
// ---------------------------------------------------------------------------

export function rep(m: Pick<MemoryPhysics, "uses">): number {
  return Math.min(TUNABLES.REP_PER_USE * m.uses, TUNABLES.REP_CAP);
}

export function cons(m: Pick<MemoryPhysics, "consolidated">): number {
  return m.consolidated ? TUNABLES.CONS_BONUS : 0;
}

/**
 * base = max( omega_sal x sal, omega_rep x rep ) + cons.
 *
 * A MAX, never a product, and age is NOT an input [v1 Appendix A #1] — "a
 * formative one-shot consolidates without repetition" is true only because of
 * the max. Monotone non-decreasing (guarantee 3): salience is fixed, uses only
 * rise, consolidation only turns on.
 */
export function base(m: MemoryPhysics): number {
  const k = kindPhysics(m.kind);
  return Math.max(k.wSal * sal(m.salience), k.wRep * rep(m)) + cons(m);
}

/** Stability S, in lived days. kappa DIVIDES (§5.4). */
export function stability(m: Pick<MemoryPhysics, "kind" | "uses">): number {
  return (
    (TUNABLES.S_BASE * (1 + TUNABLES.BETA * Math.log(1 + Math.max(0, m.uses)))) /
    kindPhysics(m.kind).kappa
  );
}

/** The decay curve itself, over an elapsed lived-day interval. */
export function decayCurve(
  elapsedDays: number,
  s: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  const dt = Math.max(0, elapsedDays);
  switch (shape) {
    case "flat":
      return Math.max(0, 1 - dt / s);
    case "power-law":
      return Math.pow(1 + dt / s, -TUNABLES.POWER_LAW_PSI);
    case "exponential":
    default:
      return Math.exp(-dt / s);
  }
}

/**
 * D(m, d) — Ebbinghaus over LIVED days.
 *
 * Identity-band memories are decay-exempt (D = 1): the named deviation of §2 —
 * flashbulb memories do fade in humans, here they do not. Everything else rides
 * the curve from its last credited use. Idempotent by construction: D is a pure
 * function of d, so there is no step to run twice (guarantee 5, scar E8).
 */
export function decay(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number {
  if (m.promotedIdentity) return 1;
  return decayCurve(d - m.lastUsedDay, stability(m), shape);
}

export function strength(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): number {
  return clamp01(base(m) * decay(m, d, shape));
}

// ---------------------------------------------------------------------------
// §5.3 Bands
// ---------------------------------------------------------------------------

/**
 * band = identity if promoted; semantic if DECAYED strength >= THETA_SEM;
 * episodic otherwise.
 *
 * Nothing is born into identity, whatever salience is claimed: identity is
 * entered only by inheriting it through a declared revision, or by the explicit
 * counted promotion crossing of `promotionEligibility()`. Semantic and episodic
 * are evaluated on decayed strength, so a faded semantic memory demotes and
 * gains the prune exit — every band names its way out (scar §2.17).
 */
export function band(m: MemoryPhysics, d: number, shape: DecayShape = TUNABLES.DECAY_SHAPE): Band {
  if (m.promotedIdentity) return "identity";
  return strength(m, d, shape) >= TUNABLES.THETA_SEM ? "semantic" : "episodic";
}

export type PromotionReason =
  | "eligible"
  | "already-identity"
  | "base-below-identity-threshold"
  | "insufficient-distinct-days";

export interface PromotionVerdict {
  eligible: boolean;
  /** The first blocking reason, or "eligible". */
  reason: PromotionReason;
  /** Every blocking reason — promotion needs ALL conditions, so all are reported. */
  blockedBy: PromotionReason[];
  base: number;
  reinforcedDays: number;
  requiredDays: number;
  threshold: number;
}

/**
 * Promotion eligibility (§5.3): `base >= THETA_ID` AND reinforcement on
 * >= N = 3 DISTINCT lived days. Evaluated at consolidation by `sleep/`.
 * Note it is `base`, not decayed strength: promotion is about what the memory
 * earned, not about how recently it was touched.
 */
export function promotionEligibility(m: MemoryPhysics): PromotionVerdict {
  const b = base(m);
  const days = reinforcedDays(m);
  const blockedBy: PromotionReason[] = [];
  if (m.promotedIdentity) blockedBy.push("already-identity");
  if (b < TUNABLES.THETA_ID) blockedBy.push("base-below-identity-threshold");
  if (days < TUNABLES.N_PROMOTION_DAYS) blockedBy.push("insufficient-distinct-days");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    base: b,
    reinforcedDays: days,
    requiredDays: TUNABLES.N_PROMOTION_DAYS,
    threshold: TUNABLES.THETA_ID,
  };
}

export type ConsolidationReason =
  | "eligible"
  | "already-consolidated"
  | "archived"
  | "born-today"
  | "below-semantic-floor";

export interface ConsolidationVerdict {
  eligible: boolean;
  /** The first blocking reason, or "eligible". */
  reason: ConsolidationReason;
  /** Every blocking reason — consolidation needs ALL conditions (scar §2.4). */
  blockedBy: ConsolidationReason[];
  band: Band;
  birthDay: number;
}

/**
 * Consolidation eligibility (SEAMS item M), mirroring `promotionEligibility`:
 * a memory that has survived at least one lived day past its birth and now sits
 * at or above the semantic floor is eligible. `consolidated` is worth
 * `+CONS_BONUS` to `base` for the rest of the memory's life (§5.2), so deciding
 * WHEN it turns on is arithmetic and belongs here — `sleep/` executes a crossing
 * it does not define, exactly as it does for promotion.
 *
 * **There is deliberately NO reinforcement requirement.** "A formative one-shot
 * consolidates without repetition" is a property `base` protects with a `max`,
 * and a repetition gate here would quietly repeal it.
 *
 * Nothing consolidates on the day it was encoded, whatever it claims for itself:
 * sleep consolidates yesterday's experience. A memory already in the identity
 * band is past the semantic floor by definition and is not blocked by it.
 */
export function consolidationEligibility(
  m: MemoryPhysics,
  d: number,
  opts: { archived?: boolean } = {},
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): ConsolidationVerdict {
  const b = band(m, d, shape);
  const blockedBy: ConsolidationReason[] = [];
  if (opts.archived === true) blockedBy.push("archived");
  if (m.consolidated) blockedBy.push("already-consolidated");
  if (d <= m.birthDay) blockedBy.push("born-today");
  if (b !== "semantic" && !m.promotedIdentity) blockedBy.push("below-semantic-floor");
  return {
    eligible: blockedBy.length === 0,
    reason: blockedBy[0] ?? "eligible",
    blockedBy,
    band: b,
    birthDay: m.birthDay,
  };
}

export interface PromotionCrossing {
  readonly event: "band.promoted";
  readonly day: number;
  readonly kind: Kind;
  readonly base: number;
  readonly reinforcedDays: number;
}

export interface PromotionOutcome {
  promoted: boolean;
  verdict: PromotionVerdict;
  /** The explicit, counted crossing record — never an emergent side effect
   *  (scar §2.4). Null when the memory was not eligible. */
  crossing: PromotionCrossing | null;
  next: Pick<MemoryPhysics, "promotedIdentity"> | null;
}

export function promote(m: MemoryPhysics, d: number): PromotionOutcome {
  const verdict = promotionEligibility(m);
  if (!verdict.eligible) return { promoted: false, verdict, crossing: null, next: null };
  return {
    promoted: true,
    verdict,
    crossing: {
      event: "band.promoted",
      day: d,
      kind: m.kind,
      base: verdict.base,
      reinforcedDays: verdict.reinforcedDays,
    },
    next: { promotedIdentity: true },
  };
}

// ---------------------------------------------------------------------------
// Guarantee 12 — the symmetry counter (scar §2.10)
// ---------------------------------------------------------------------------

const BAND_RANK: Record<Band, number> = { episodic: 0, semantic: 1, identity: 2 };

export function bandMove(from: Band, to: Band): "up" | "down" | "none" {
  const delta = BAND_RANK[to] - BAND_RANK[from];
  return delta > 0 ? "up" : delta < 0 ? "down" : "none";
}

export type SymmetryReason =
  | "within-expectation"
  | "ratchet-suspected"
  | "reverse-ratchet-suspected"
  | "never-asked";

export interface SymmetryCheck {
  ok: boolean;
  reason: SymmetryReason;
  kind: Kind;
  up: number;
  down: number;
  /** up : down. Infinity when nothing ever moved down — v1's exact shape. */
  ratio: number;
  expectedMax: number;
}

/**
 * Up-moves and down-moves, counted separately, PER KIND, against a stated
 * expected ratio (guarantee 12). This is the tripwire v1 lacked: it ran
 * 279 up-moves against zero down-moves for three days and nothing fired.
 * Below the minimum sample the answer is "never-asked", not "healthy".
 */
export function symmetryCheck(kind: Kind, counts: { up: number; down: number }): SymmetryCheck {
  const { up, down } = counts;
  const ratio = down === 0 ? (up === 0 ? 0 : Infinity) : up / down;
  const expectedMax = TUNABLES.SYMMETRY_MAX_UP_DOWN_RATIO;
  const shape = { kind, up, down, ratio, expectedMax };
  if (up + down < TUNABLES.SYMMETRY_MIN_SAMPLE) {
    return { ok: true, reason: "never-asked", ...shape };
  }
  if (ratio > expectedMax) return { ok: false, reason: "ratchet-suspected", ...shape };
  if (up > 0 && down / up > expectedMax) {
    return { ok: false, reason: "reverse-ratchet-suspected", ...shape };
  }
  return { ok: true, reason: "within-expectation", ...shape };
}

// ---------------------------------------------------------------------------
// §5.5 Reinforcement
// ---------------------------------------------------------------------------

export type UseTier = "referenced" | "surfaced" | "footnoted";

export const USE_TIER_WEIGHT: Record<UseTier, number> = {
  referenced: TUNABLES.W_REFERENCED,
  surfaced: TUNABLES.W_SURFACED,
  footnoted: TUNABLES.W_FOOTNOTED,
};

export type CreditReason =
  | "credited"
  | "ignorable-tier"
  | "birth-day"
  | "already-credited-today"
  | "stale-day";

export interface CreditOutcome {
  credited: boolean;
  reason: CreditReason;
  /** The TIER weight (§5.5). What was actually added is `credit`. */
  w: number;
  /** The spacing factor for this occasion, in [SPACING_FLOOR, 1). 0 when nothing
   *  was credited. */
  spacing: number;
  /** What this occasion added to `uses`: `w x spacing`. 0 when not credited. */
  credit: number;
  /** State to persist. Identical to the input state when nothing was credited. */
  next: Pick<MemoryPhysics, "uses" | "lastUsedDay" | "reinforcedDays">;
}

/**
 * Graded retrospective reinforcement (§5.5). At most ONE credited occasion per
 * memory per lived day, never on its birth day [v1 §10 G9], and the ignorable
 * (footnoted) tier never trains. Credit is resolved at the boundary, when the
 * reply is known — this function is the arithmetic, not the trigger.
 *
 * A credited use also resets the forgetting curve: `lastUsedDay := d` raises
 * S through `uses`, so the next interval is longer — the testing effect.
 */
export function creditUse(m: MemoryPhysics, d: number, tier: UseTier): CreditOutcome {
  const w = USE_TIER_WEIGHT[tier];
  const days = reinforcedDays(m);
  const unchanged = { uses: m.uses, lastUsedDay: m.lastUsedDay, reinforcedDays: days };
  const refused = (reason: CreditReason): CreditOutcome => ({
    credited: false,
    reason,
    w,
    spacing: 0,
    credit: 0,
    next: unchanged,
  });
  if (w <= 0) return refused("ignorable-tier");
  if (d === m.birthDay) return refused("birth-day");
  if (d < m.lastUsedDay) return refused("stale-day");
  if (d === m.lastUsedDay) return refused("already-credited-today");
  // THE SPACING EFFECT (2026-09-25). Only `uses` is scaled. `reinforcedDays`
  // still counts the OCCASION, one per distinct lived day, because promotion's
  // N = 3 is a count of separate days a memory proved useful, not a magnitude
  // (NOTES, "Spacing credit"). The guards above are unchanged and run first.
  const spacing = spacingFactor(d - m.lastUsedDay);
  const credit = w * spacing;
  return {
    credited: true,
    reason: "credited",
    w,
    spacing,
    credit,
    next: { uses: m.uses + credit, lastUsedDay: d, reinforcedDays: days + 1 },
  };
}

/**
 * The spacing factor for a use `gap` lived days after the last one:
 * `max(SPACING_FLOOR, 1 - exp(-gap / SPACING_DAYS))`. Smooth, monotone rising,
 * below 1 for every finite gap. A non-positive gap (which `creditUse`'s guards
 * never let through) reads as the floor rather than as zero or negative credit.
 */
export function spacingFactor(gap: number): number {
  if (!(gap > 0)) return TUNABLES.SPACING_FLOOR;
  return Math.max(TUNABLES.SPACING_FLOOR, 1 - Math.exp(-gap / TUNABLES.SPACING_DAYS));
}

// ---------------------------------------------------------------------------
// §5.6 Revision — declared, pressure-accumulated, no second object
// ---------------------------------------------------------------------------

/** The challenging memory, as physics sees it: its own state plus its declaration. */
export interface Challenge {
  id: string;
  /** The `updates: <memory-id>` field, DECLARED BY THE WRITER. There is no
   *  inferred-revision path (guarantee 7). */
  declaredUpdates: string | null;
  physics: MemoryPhysics;
}

export type ChallengeReason =
  | "revised"
  | "below-bar"
  | "no-declared-target"
  | "target-mismatch"
  | "already-challenged-today"
  | "stale-day";

export interface ChallengeLogEntry {
  readonly event: "revision.pressure";
  readonly day: number;
  readonly challengerId: string;
  readonly force: number;
  readonly pressureAfter: number;
  readonly bar: number;
}

export interface ChallengeOutcome {
  verdict: "revise" | "hold";
  credited: boolean;
  reason: ChallengeReason;
  /** F(new -> old) for this challenge; 0 when nothing was credited. */
  force: number;
  /** P(old) decayed to day d, before this challenge. */
  pressureBefore: number;
  pressureAfter: number;
  /** iota(kind) x strength(old, d) — what the pressure has to beat. */
  bar: number;
  next: Pick<MemoryPhysics, "pressure" | "lastChallengedDay">;
  /** Every increment is logged — the pressure history IS the evidence record. */
  log: ChallengeLogEntry | null;
}

/**
 * F(new -> old) = strength(new, d) x sal(new) — author-assessed evidence weight.
 *
 * NOVELTY PLAYS NO ROLE HERE by design (review condition (c)): it was doing
 * double duty as detector and magnitude, and because novelty is computed against
 * context that CONTAINS the target when the author was informed, it rewarded
 * blind challenges over informed ones. The declaration carries intent; sal
 * carries magnitude.
 */
export function challengeForce(
  challenger: MemoryPhysics,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  return strength(challenger, d, shape) * sal(challenger.salience);
}

/**
 * P(old) decayed to day d. Same curve family as memory, keyed to the last
 * challenge day, so an abandoned challenge FADES instead of lying in ambush.
 * Pressure decays even against an identity-band target: D = 1 exempts the
 * memory, never the pressure standing against it.
 */
export function pressureAt(
  m: Pick<MemoryPhysics, "pressure" | "lastChallengedDay">,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  if (m.pressure <= 0 || m.lastChallengedDay === null) return 0;
  return m.pressure * decayCurve(d - m.lastChallengedDay, TUNABLES.S_PRESSURE, shape);
}

/** iota(kind) x strength(old, d) — the revision bar. */
export function revisionBar(
  target: MemoryPhysics,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): number {
  return kindPhysics(target.kind).iota * strength(target, d, shape);
}

/**
 * One declared challenge landing on one target on lived day d (§5.6, rewritten
 * 2026-08-25). Order of operations: decay P to d, add F, compare.
 *
 *   P(old) += F(new -> old)
 *   REVISE iff P(old) > iota(kind(old)) x strength(old, d)
 *
 * ONE credited challenge per target per lived day — no session can spam a belief
 * into flipping. The pressure is a FIELD ON THE TARGET ROW; there is no second
 * object, so scar §2.2's dangling-ledger family cannot recur.
 */
export function applyChallenge(
  targetId: string,
  target: MemoryPhysics,
  challenge: Challenge,
  d: number,
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): ChallengeOutcome {
  const bar = revisionBar(target, d, shape);
  const pressureBefore = pressureAt(target, d, shape);
  const unchanged = { pressure: target.pressure, lastChallengedDay: target.lastChallengedDay };
  const refuse = (reason: ChallengeReason): ChallengeOutcome => ({
    verdict: "hold",
    credited: false,
    reason,
    force: 0,
    pressureBefore,
    pressureAfter: pressureBefore,
    bar,
    next: unchanged,
    log: null,
  });

  if (challenge.declaredUpdates === null) return refuse("no-declared-target");
  if (challenge.declaredUpdates !== targetId) return refuse("target-mismatch");
  if (target.lastChallengedDay !== null && d === target.lastChallengedDay) {
    return refuse("already-challenged-today");
  }
  if (target.lastChallengedDay !== null && d < target.lastChallengedDay) return refuse("stale-day");

  const rawForce = challengeForce(challenge.physics, d, shape);
  const slow = kindPhysics(target.kind).iota >= TUNABLES.SLOW_KIND_IOTA;
  const force = slow ? Math.min(rawForce, TUNABLES.F_DAY_CAP_SLOW) : rawForce;
  const pressureAfter = pressureBefore + force;
  const revise = pressureAfter > bar;
  return {
    verdict: revise ? "revise" : "hold",
    credited: true,
    reason: revise ? "revised" : "below-bar",
    force,
    pressureBefore,
    pressureAfter,
    bar,
    next: { pressure: pressureAfter, lastChallengedDay: d },
    log: {
      event: "revision.pressure",
      day: d,
      challengerId: challenge.id,
      force,
      pressureAfter,
      bar,
    },
  };
}

export interface SupersedeRecord {
  readonly event: "memory.superseded";
  readonly predecessorId: string;
  readonly successorId: string;
  readonly day: number;
  /** Superseded versions stay RESOLVABLE until this lived day (guarantee 9).
   *  Nothing in physics deletes one. */
  readonly resolvableUntilDay: number;
}

export function supersedeRecord(
  predecessorId: string,
  successorId: string,
  d: number,
): SupersedeRecord {
  return {
    event: "memory.superseded",
    predecessorId,
    successorId,
    day: d,
    resolvableUntilDay: d + TUNABLES.H_SUPERSEDED_DAYS,
  };
}

export function supersededResolvable(supersededOnDay: number, d: number): boolean {
  return d - supersededOnDay <= TUNABLES.H_SUPERSEDED_DAYS;
}

/**
 * The successor's revision-relevant seed state on REVISE. Pressure resets to 0,
 * and identity membership is INHERITED (§5.3(a)) unless the caller declares the
 * revision a demotion — the only way out of the identity band.
 */
export function successorSeed(
  target: MemoryPhysics,
  opts: { inheritIdentity?: boolean } = {},
): Pick<MemoryPhysics, "promotedIdentity" | "pressure" | "lastChallengedDay"> {
  const inherit = opts.inheritIdentity ?? true;
  return {
    promotedIdentity: inherit ? target.promotedIdentity : false,
    pressure: 0,
    lastChallengedDay: null,
  };
}

// ---------------------------------------------------------------------------
// §5.7 Dedup
// ---------------------------------------------------------------------------

export type DedupReason =
  | "declared-revision-never-merged"
  | "revision-successor-never-merged"
  | "identical-content-hash"
  | "cosine-at-or-above-tau"
  | "below-tau"
  | "no-similarity-supplied";

export interface DedupInput {
  /** The id of the ORIGINAL this candidate would merge into. */
  originalId: string;
  /** The candidate's `updates:` declaration, if it made one. */
  declaredUpdates: string | null;
  /**
   * True when merging this pair would archive a revision's SUCCESSOR — either
   * because the two rows stand in a direct successor relation (one was minted by
   * revising, carrying the other's words), or because the candidate is a
   * successor and the pair is same-hash. The second case is sound for the same
   * reason as the first: a successor's body IS its challenger's body by
   * construction, so any same-hash group it belongs to is that challenger plus
   * ordinary twins of the same sentence, and none of those is what the revision
   * produced. Lineage is a store fact, so the caller reads it and supplies it
   * here — the same division of labour as `sameContentHash`.
   */
  revisionSuccessorPair?: boolean;
  /** Content hashes, supplied by the caller. */
  sameContentHash?: boolean;
  /** cos( v(new), v(orig) ), supplied by the caller. Null when no vector exists. */
  cosine?: number | null;
}

export interface DedupVerdict {
  verdict: "merge" | "leave-alone";
  reason: DedupReason;
  /** The whole effect of a merge: uses(orig) += 1. Never a rewrite, never a blend. */
  effect: { usesDelta: number } | null;
}

/**
 * Dedup (§5.7). Ambiguous near-duplicates are LEFT ALONE (owner decision) —
 * accepted rent, paid for zero substrate confabulation [v1 §4.2 G9].
 *
 * A memory that declares `updates:` is NEVER deduplicated into its target
 * (guarantee 8): otherwise a topically-close refutation merges into the belief
 * it refutes and REINFORCES it — scar §2.10's one-way ratchet, rebuilt by
 * accident. The declaration is checked FIRST, before hash and before cosine.
 *
 * The declaration's other half, and the same refusal (guarantee 8b): **a
 * revision's SUCCESSOR and the challenger it was made from are never merged
 * into each other, in either direction**. A revision mints the successor with
 * the challenger's own words — that is what winning an argument means here
 * (§5.6) — so the two bodies are identical BY CONSTRUCTION and every dedup pass
 * after the crossing finds them. Checked before hash and cosine, because the
 * hash is precisely what is guaranteed to match.
 */
export function dedupVerdict(input: DedupInput): DedupVerdict {
  if (input.declaredUpdates !== null && input.declaredUpdates === input.originalId) {
    return { verdict: "leave-alone", reason: "declared-revision-never-merged", effect: null };
  }
  if (input.revisionSuccessorPair === true) {
    return { verdict: "leave-alone", reason: "revision-successor-never-merged", effect: null };
  }
  if (input.sameContentHash === true) {
    return { verdict: "merge", reason: "identical-content-hash", effect: { usesDelta: 1 } };
  }
  const cos = input.cosine ?? null;
  if (cos === null) {
    return { verdict: "leave-alone", reason: "no-similarity-supplied", effect: null };
  }
  if (cos >= TUNABLES.TAU_DUP) {
    return { verdict: "merge", reason: "cosine-at-or-above-tau", effect: { usesDelta: 1 } };
  }
  return { verdict: "leave-alone", reason: "below-tau", effect: null };
}

// ---------------------------------------------------------------------------
// §5.8 Forgetting
// ---------------------------------------------------------------------------

export type PruneReason =
  | "prunable"
  | "above-floor"
  | "dwell-too-short"
  | "band-not-episodic"
  | "protected"
  | "in-live-revision-chain";

/** Counts, kind, dates. NEVER a body and NEVER a content hash (scar §2.20). */
export interface PruneRecord {
  readonly event: "memory.pruned";
  readonly day: number;
  readonly kind: Kind;
  readonly band: Band;
  readonly birthDay: number;
  readonly lastUsedDay: number;
  readonly uses: number;
  readonly strength: number;
}

export interface PruneVerdict {
  prune: boolean;
  reason: PruneReason;
  /** Every failing gate, not just the first — all five are named. */
  blockedBy: PruneReason[];
  strength: number;
  band: Band;
  dwellDays: number;
  record: PruneRecord | null;
}

/**
 * The ONLY physics-driven removal (§5.8), gated on all five conditions. No
 * model, on any path, holds delete power — this returns a verdict and a record;
 * it deletes nothing itself. Everything else merely fades: a low-strength memory
 * is still present and still retrievable by a strong enough cue.
 */
export function pruneVerdict(
  m: MemoryPhysics,
  d: number,
  ctx: { inLiveRevisionChain: boolean },
  shape: DecayShape = TUNABLES.DECAY_SHAPE,
): PruneVerdict {
  const s = strength(m, d, shape);
  const b = band(m, d, shape);
  const dwellDays = d - m.lastUsedDay;
  const blockedBy: PruneReason[] = [];
  if (s >= TUNABLES.PHI_PRUNE) blockedBy.push("above-floor");
  if (dwellDays < TUNABLES.D_FLOOR_DAYS) blockedBy.push("dwell-too-short");
  if (b !== "episodic") blockedBy.push("band-not-episodic");
  if (m.protected) blockedBy.push("protected");
  if (ctx.inLiveRevisionChain) blockedBy.push("in-live-revision-chain");
  const prune = blockedBy.length === 0;
  return {
    prune,
    reason: blockedBy[0] ?? "prunable",
    blockedBy,
    strength: s,
    band: b,
    dwellDays,
    record: prune
      ? {
          event: "memory.pruned",
          day: d,
          kind: m.kind,
          band: b,
          birthDay: m.birthDay,
          lastUsedDay: m.lastUsedDay,
          uses: m.uses,
          strength: s,
        }
      : null,
  };
}
