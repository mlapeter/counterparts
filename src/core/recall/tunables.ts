/**
 * Every recall knob, in one visible place — the shape `physics/` uses, for the
 * same reason: a threshold hiding in a function body cannot be audited.
 *
 * **CAL = calibration-required** (scar §2.8: no threshold ships unmeasured against
 * the real space). Values marked CAL below are *v1's live calibration*, inherited
 * as the best surviving record of what real use moved — the starting point, NOT a
 * v2 measurement (recall/CONTRACT.md §4: "v1's values in behavioral-spec §9 are
 * the best surviving record of what lived use moved — the starting point, not the
 * default"). `tools/replay` is where they get re-earned against v2's own corpus.
 *
 * Structural (never tunable, never ablatable): the three hard gates, the
 * build/record split, tier disjointness, the composed budget, the sentinel,
 * the observer refusal.
 */

export interface RecallTunables {
  // ── cue extraction ───────────────────────────────────────────────────────
  /** Minimum cue token length. Shorter tokens are noise, not names. [v1: 3] */
  MIN_CUE_LENGTH: number;
  /** Cap on distinct cue tokens taken from one turn — a latency bound. CAL. */
  MAX_CUES: number;
  /** Docs fetched per cue token. Doubles as the df ceiling for rarity weighting. CAL. */
  PER_CUE_FETCH: number;
  /** Ambiguous-handle weight: a name pointing at two memories retrieves neither
   *  well, and trains nothing at all. [v1: 0.5] CAL. */
  AMBIGUOUS_WEIGHT: number;
  /** Cue carry-over: previous turn's cues re-enter at this weight, for one turn.
   *  [v1: 1 turn, decay 0.5] CAL. */
  CARRY_DECAY: number;

  // ── channels ─────────────────────────────────────────────────────────────
  /** Weight on the embedding channel's contribution. CAL. */
  SEMANTIC_WEIGHT: number;
  /** Cosine below this is not a seed at all. [v1: 0.45] CAL. */
  SEMANTIC_SEED_FLOOR: number;
  /** Nearest-neighbour slice pulled from the vector index. [v1 top-M: 8] CAL. */
  SEMANTIC_TOP_M: number;
  /** Weight on base-level activation (strength). The recency/arrival channel:
   *  it can make a memory warm, never loud. [v1: 0.15] CAL. */
  ARRIVAL_WEIGHT: number;

  // ── the gate ─────────────────────────────────────────────────────────────
  /** Relative admission: bar = mean + SNR_GLOBAL x sd of THIS turn's background. [v1: 1.2] CAL. */
  SNR_GLOBAL: number;
  /** Relative loud tier: bar = mean + SNR_STRONG x sd. [v1: 2.5] CAL. */
  SNR_STRONG: number;
  /** Hard gate (b): the absolute floor, checked BEFORE any salience adjustment. [v1: 0.2] CAL. */
  FLOOR_GLOBAL: number;
  /** Per-kind floors for the loud tier — kinds live on different activation
   *  scales, and a global strong floor silently excluded whole kinds (v1
   *  measured: person peaked near 0.79 where craft material floored at 1.0).
   *  The BACKGROUND statistic stays global. [v1 §9 G12] CAL. */
  FLOOR_STRONG_BY_KIND: Record<string, number>;
  /** Fallback strong floor for a kind with no override. [v1: 0.5] CAL. */
  FLOOR_STRONG_DEFAULT: number;
  /** Hard gate (c): fraction of a candidate's activation that must come from
   *  cues before it may go loud. Recency alone can never carry a memory there,
   *  however sacred. [v1: 0.5] CAL. */
  MIN_CUE_FRACTION: number;
  /** Two-sided salience modulation of the RELATIVE bar only. [v1 bar weight: 0.5] CAL. */
  SAL_BAR_WEIGHT: number;
  /** Salience's weight in the surfaced PICK's sort key — ordering and admission
   *  use deliberately different keys. [v1 sort weight: 0.5; fixture-bounded
   *  below ~0.3 and above ~1.2] CAL. */
  SAL_SORT_WEIGHT: number;
  /** Candidates carried into the gate. A count that must not become an
   *  undercount for aggregation lives in deliberate recall, not here. CAL. */
  MAX_CANDIDATES: number;

  // ── cold start: stricter, not looser (small stores over-surface) ──────────
  /** Below this many live memories the variance estimate is meaningless. [v1: 15] CAL. */
  COLD_START_MIN_STORE: number;
  /** Cold-start absolute floor, replacing the relative bar entirely. [v1: 0.7] CAL. */
  COLD_START_FLOOR: number;
  /** Cold-start candidate cap. [v1: 3] CAL. */
  COLD_START_MAX_CANDIDATES: number;
  /** Fewer cued candidates than this and the background distribution is a
   *  fiction — the gate degrades to the absolute regime rather than comparing a
   *  candidate against itself (see NOTES.md, the sigma-zero degeneracy). CAL. */
  MIN_BACKGROUND_SAMPLE: number;

  // ── inhibition + caps ────────────────────────────────────────────────────
  /** Near-duplicate similarity: above this, the weaker candidate is suppressed. [v1: 0.85] CAL. */
  NEAR_DUPLICATE: number;
  /** Hard cap on the loud tier. [v1: 2] */
  MAX_SURFACED: number;
  /** Hard cap on footnotes. [v1: 6] */
  MAX_FOOTNOTES: number;

  // ── affect ───────────────────────────────────────────────────────────────
  /** Emotional salience a candidate needs before it can raise the affect flag. [v1: 0.7] CAL. */
  AFFECT_MIN_EMOTION: number;
  /** Turns the affect flag stays down after firing — the emotional refractory.
   *  A high-salience wound must not light up every turn. [v1: 2] CAL. */
  AFFECT_REFRACTORY_TURNS: number;

  // ── render ───────────────────────────────────────────────────────────────
  /** Composed byte budget for the WHOLE injection, sentinel included. The host
   *  owns the real ceiling (scar §2.18) and passes it in; this is the default. CAL. */
  BUDGET_BYTES: number;
  /** Bytes of gist rendered per surfaced item before elision. CAL. */
  GIST_BYTES: number;
  /** Bytes of title rendered per footnote. CAL. */
  FOOTNOTE_TITLE_BYTES: number;
  /** Fraction of the budget above which a pressure tripwire fires (scar §2.4:
   *  every budget gets an event when it is approached, not only when it blows). */
  BUDGET_PRESSURE: number;
  /** Latency budget for the BUILD pass, milliseconds. On overrun: nothing
   *  injected, nothing buffered, no telemetry, no state written. CAL. */
  BUDGET_MS: number;

  // ── gate state ───────────────────────────────────────────────────────────
  /** Cap on remembered per-session surfacing records. The store has no meta
   *  expiry (INTERFACE-GAPS.md #1), so the row bounds itself. CAL. */
  MAX_SESSION_RECORDS: number;
}

export const TUNABLES: RecallTunables = {
  MIN_CUE_LENGTH: 3,
  MAX_CUES: 24,
  PER_CUE_FETCH: 24,
  AMBIGUOUS_WEIGHT: 0.5,
  CARRY_DECAY: 0.5,

  SEMANTIC_WEIGHT: 1.0,
  SEMANTIC_SEED_FLOOR: 0.45,
  SEMANTIC_TOP_M: 8,
  ARRIVAL_WEIGHT: 0.15,

  SNR_GLOBAL: 1.2,
  SNR_STRONG: 2.5,
  FLOOR_GLOBAL: 0.2,
  FLOOR_STRONG_BY_KIND: {
    self: 0.6,
    person: 0.6,
    entity: 0.6,
    place: 0.8,
    skill: 1.0,
    fact: 1.0,
  },
  FLOOR_STRONG_DEFAULT: 0.5,
  MIN_CUE_FRACTION: 0.5,
  SAL_BAR_WEIGHT: 0.5,
  SAL_SORT_WEIGHT: 0.5,
  MAX_CANDIDATES: 24,

  COLD_START_MIN_STORE: 15,
  COLD_START_FLOOR: 0.7,
  COLD_START_MAX_CANDIDATES: 3,
  MIN_BACKGROUND_SAMPLE: 3,

  NEAR_DUPLICATE: 0.85,
  MAX_SURFACED: 2,
  MAX_FOOTNOTES: 6,

  AFFECT_MIN_EMOTION: 0.7,
  AFFECT_REFRACTORY_TURNS: 2,

  BUDGET_BYTES: 2048,
  GIST_BYTES: 240,
  FOOTNOTE_TITLE_BYTES: 80,
  BUDGET_PRESSURE: 0.9,
  // 250 → 1200 on day 0 of the parallel run (2026-09-03): the first recall in a
  // fresh process — every hook is one — measured 794–819 ms warming the page
  // cache over a 263 MB token index after the worker's writes, and 5 of 6 real
  // turns aborted. bansai runs its surfacing at 800 ms; 1200 covers the measured
  // cold case with headroom. The structural fix (why the index churns after each
  // cycle) is the day-1 watch; this is the calibration that makes recall exist
  // in the meantime. CAL.
  BUDGET_MS: 1200,

  MAX_SESSION_RECORDS: 200,
};

export function withTunables(overrides: Partial<RecallTunables> = {}): RecallTunables {
  return { ...TUNABLES, ...overrides };
}

/** Per-kind loud-tier floor, with the declared fallback (§9 G12). */
export function strongFloor(t: RecallTunables, kind: string): number {
  return t.FLOOR_STRONG_BY_KIND[kind] ?? t.FLOOR_STRONG_DEFAULT;
}
