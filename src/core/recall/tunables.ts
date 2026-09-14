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
  /** Docs fetched per cue token. A postings bound and NOTHING else: it used to
   *  double as the df ceiling for rarity weighting, which meant rarity stopped
   *  being measured once a store held more than this many documents carrying a
   *  word. `Store.docFrequency` counts now (MEASURED 2026-09-04, see
   *  `store/cache.ts#docFrequency`). CAL. */
  PER_CUE_FETCH: number;
  /** Ambiguous-handle weight: a name pointing at two memories retrieves neither
   *  well, and trains nothing at all. [v1: 0.5] CAL. */
  AMBIGUOUS_WEIGHT: number;
  /** Cue carry-over: previous turn's cues re-enter at this weight, for one turn.
   *  [v1: 1 turn, decay 0.5] CAL. */
  CARRY_DECAY: number;

  // ── the document side of §9 G4: length normalization + a per-doc ceiling ──
  /** tf saturation for a cue's evidence in ONE document (BM25 k1). At `k1 = 1`
   *  and `CUE_LENGTH_NORM = 0` this is exactly the previous `2·tf/(tf+1)`, which
   *  is why it is 1: the change ships length normalization and nothing else. CAL. */
  CUE_TF_SATURATION: number;
  /** How much of a cue's evidence is normalized by document length (BM25 b).
   *  0 = none (the measured bug); 1 = fully proportional to length. CAL. */
  CUE_LENGTH_NORM: number;
  /** Clamp the length factor at 1: penalize a long document, never REWARD a
   *  short one. BM25's factor is centered on the mean, which raises short
   *  documents above their old scores — harmless for ranking, not harmless for
   *  the ABSOLUTE floors below, which are v1 inheritances calibrated against the
   *  old scale. See `store/cache.ts#LengthNorm.oneSided` for the measurement. CAL. */
  CUE_LENGTH_ONE_SIDED: boolean;
  /** Per-document ceiling on the cue channel, as a multiple of that document's
   *  single strongest cue. Corroboration is real evidence; sheer coverage is
   *  not. v1 capped the same quantity absolutely (`entityCueCap`); this is the
   *  scale-free form, because v2's cue weights are smoothed idf rather than v1's
   *  normalized similarities and an absolute number would not transfer. CAL. */
  CUE_DOC_CAP: number;

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
  /** Hard gate (b): the absolute floor, checked BEFORE any salience adjustment.
   *  **In cue units** — multiples of `informativeness(1, storeSize)`, the weight
   *  of one maximally-rare cue (`gate.ts#floorUnit`). The `_UNITS` suffix is not
   *  decoration: this knob was `FLOOR_GLOBAL`, an absolute number on v1's 0-1
   *  cosine scale, and renaming it is how every stale reading of the old scale
   *  becomes a compile error rather than a silent miscalibration. CAL. */
  FLOOR_GLOBAL_UNITS: number;
  /** Per-kind OVERRIDES of the loud-tier floor, in the same cue units. The
   *  mechanism of §9 G12 — kinds may live on different activation scales — is
   *  kept; v1's numbers for it are not, because v2's own corpus refuses them
   *  (see the measurement at the value below). An empty map means no kind has
   *  earned an override yet. The BACKGROUND statistic stays global. CAL. */
  FLOOR_STRONG_BY_KIND_UNITS: Record<string, number>;
  /** The loud-tier floor for a kind with no override — today, every kind. CAL. */
  FLOOR_STRONG_DEFAULT_UNITS: number;
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
  /** Cold-start absolute floor, replacing the relative bar entirely. In the same
   *  cue units as the other two floors — a store this small is exactly where an
   *  absolute number on the wrong scale does the most damage. CAL. */
  COLD_START_FLOOR_UNITS: number;
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
  /** Bytes of title rendered per footnote. CAL. 80 → 150 on 2026-09-14
   *  (IMPROVEMENTS U2): a title authored at session_end runs past 80 and was
   *  clipped mid-clause, and an 80-character title with one multi-byte dash
   *  lost its tail to the byte cap. Migrated titles are STORED at 80
   *  characters and render exactly as before. Six footnotes at 150 bytes plus
   *  ids and framing is ~1,100 bytes against a 2,048 default budget. */
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

  // MEASURED 2026-09-04 on a copy of the live store (15,421 indexed documents,
  // mean 106 indexed tokens, max 3,184 — a 30x spread). Ambient recall returned
  // the same nine memories of 9–20 KB for every topic across two unrelated
  // sessions, judged 0-of-9 relevant by the instance that lived them, and 12 of
  // 19 turns then read "all-gated" because those nine were spent.
  //
  // `tools/recall-bench` swept one-sided x b ∈ {0, 0.5, 0.75, 1.0} x
  // cap ∈ {inf, 3, 2} — 23 cells — over the 13 prompts of that conversation.
  // What the grid says, in order:
  //   - b = 0 (no normalization) is the bug: 31 of 32 delivered items were hubs,
  //     on 13 of 13 turns.
  //   - THE CAP ALONE MAKES IT WORSE. At b = 0, cap = 3 took hub hits from 31 to
  //     52 — capping the hubs' sums compresses the turn's variance, which lowers
  //     the relative bar and admits MORE of them. The ceiling is the second half
  //     of this rule and is not a substitute for the first.
  //   - every b >= 0.5 takes hub hits to zero, at every cap and either sidedness.
  //     So b is chosen on what it COSTS, and the labeled positives decide:
  //     b = 1.0 loses `mem_8fb634c2783e` (the School-of-Life passage) from the
  //     deliberate answer; cap = 2 loses `mem_0d42a06a737977c9` from it.
  //   - ONE cell in the grid delivers an AMBIENT labeled positive —
  //     one-sided, b = 0.5, cap = 3, which footnotes `mem_e64f1a8b2d77` (the
  //     owner's correction about anchoring on the first-stated goal) on turn 4.
  //     Nothing else in 23 cells does, and "0 of 9 delivered footnotes were
  //     relevant" is the finding this change exists to move. It also carries the
  //     fewest recurring ids of the hub-free cells (7 ids / 33 of 79 deliveries,
  //     against 9 / 38 for two-sided b = 0.75) and keeps both deliberate
  //     positives. So: 0.5, clamped, cap 3 — not BM25's textbook 0.75, which is
  //     what the grid was expected to pick and did not.
  // The bench measures the LEXICAL channel only (no embeddings on authored
  // memories, and the bench passes no turn vector), so it is a floor, not a
  // forecast. CAL.
  CUE_TF_SATURATION: 1.0,
  CUE_LENGTH_NORM: 0.5,
  CUE_LENGTH_ONE_SIDED: true,
  CUE_DOC_CAP: 3.0,

  SEMANTIC_WEIGHT: 1.0,
  SEMANTIC_SEED_FLOOR: 0.45,
  SEMANTIC_TOP_M: 8,
  ARRIVAL_WEIGHT: 0.15,

  // 1.2 -> 1.6 (CAL, 2026-09-04). Once length normalization stopped nine hubs
  // from setting every turn's variance, the relative bar admitted far more:
  // over the 13-prompt bench, delivered items went from 2.5 to 6.1 per turn.
  // 1.6 takes that to 4.8 without losing any of the four labeled positives; at
  // 2.0 the ambient positive goes. Scale-free by construction — it is a count
  // of standard deviations — which is why it is the volume knob that shipped
  // and the absolute floors below are not. `tools/recall-bench --gate-sweep`.
  SNR_GLOBAL: 1.6,
  SNR_STRONG: 2.5,

  // ── THE FLOORS, RE-EARNED. In cue units: multiples of one maximally-rare
  // cue, `informativeness(1, storeSize)` (`gate.ts#floorUnit`).
  //
  // MEASURED 2026-09-04 on a copy of the live store (14,431 live memories,
  // unit = 8.88), over the same 13 real prompts as `CUE_LENGTH_NORM` above.
  // With document frequency finally COUNTED rather than read off the length of
  // a bounded top-K (`store/cache.ts#docFrequency`), each turn's best candidate
  // lands at, in units:
  //
  //   turn  3 → 0.88   ("thanks, as before interesting to chat with you. where
  //                      would you like to take the conversation from here?")
  //   turn  2 → 1.86 · 13 → 2.13 · 4 → 3.13 · 6 → 3.19 · 10 → 3.19
  //   turn 12 → 3.28 ·  9 → 3.55 ·  1 → 3.88 · 11 → 4.20
  //   turn  8 → 4.68 ·  5 → 4.70 ·  7 → 5.17
  //
  // The near-contentless turn is now FOUR TIMES below the busiest, on a scale
  // that says the same thing at N=17 and N=15,000 — which is what the relative
  // bar could never give (it ranked turn 3 FIRST, at 3.5 sd over its own thin
  // background). And the scale-freeness is checked at the other end rather than
  // asserted: a hermetic 17-memory fixture whose turn cleanly cues one memory
  // lands at 3.00 units, INSIDE the live store's 0.88-5.17 band, where before
  // this change the same fixture sat two orders of magnitude below the floors.
  //
  // `FLOOR_GLOBAL_UNITS` — hard gate (b), admission. A FIFTH of one
  // maximally-rare cue: below that a candidate was grazed, not cued. Swept at
  // 0 / 0.5 / 1.0 against the 13 prompts; 0 and 0.5 are identical (37
  // deliveries, 2.8 per turn) and 1.0 costs six deliveries for nothing the
  // targets asked for, so anywhere in [0, 0.5] is free on this corpus and the
  // value is chosen at the OTHER end — by the weakest signal a channel is
  // allowed to offer at full strength. That is a temporal arrival
  // (`prospective.CUE_STRENGTH` 0.5 units) and an ambiguous handle
  // (`AMBIGUOUS_WEIGHT` 0.5 of a cue that is itself rarely maximal): measured
  // at 0.41 units for a two-way "Robin" on an eight-memory store. 0.2 sits
  // under both with room. Zero is not an option — a floor of zero is the dead
  // knob this change exists to retire.
  //
  // `FLOOR_STRONG_DEFAULT_UNITS` — the loud tier. Sorted, the thirteen best
  // candidates leave their widest upper gap between 4.20 and 4.68, and 4.5 sits
  // in it: loud on 3 of 13 turns (23%, against a target of "at most about one
  // in four"), turn 3 silent, all four labeled positives kept. 4.0 gives 4 of 13
  // and 3.5 gives 6 of 13 — the same knee read one notch looser; 5.0 gives 1 of
  // 13, which is a different claim than "rarely". CAL.
  FLOOR_GLOBAL_UNITS: 0.2,
  // EMPTY, AND THE EMPTINESS IS THE MEASUREMENT. v1 shipped a per-kind shape
  // (self/person/entity 0.6, place 0.8, skill/fact 1.0) because in v1 the kinds
  // sat on different activation scales — person peaked near 0.79 where craft
  // material floored at 1.0. On v2's corpus they do not: over 312 candidate
  // rows from the 13 prompts, p50 runs 1.21-1.45 and p90 1.93-2.79 across
  // `fact`, `person`, `self`, `skill` and `entity` — one distribution, not five.
  // v2's activation is cue-driven and kind-agnostic, so there is nothing for a
  // shape to correct. Scar §2.8 says a knob ships measured or disabled: the
  // MECHANISM of §9 G12 stays (a kind that earns an override gets one), and
  // v1's unearned numbers do not ride along inside it.
  FLOOR_STRONG_BY_KIND_UNITS: {},
  FLOOR_STRONG_DEFAULT_UNITS: 4.5,
  MIN_CUE_FRACTION: 0.5,
  SAL_BAR_WEIGHT: 0.5,
  SAL_SORT_WEIGHT: 0.5,
  MAX_CANDIDATES: 24,

  COLD_START_MIN_STORE: 15,
  // 0.7 on v1's cosine scale -> 0.4 CUE UNITS: TWICE `FLOOR_GLOBAL_UNITS`, so
  // "cold start is stricter, not looser" is arithmetic rather than a comment.
  // The old number could not be carried across because the two scales do not
  // meet — on an eight-memory store one cue unit is 1.50, so v1's 0.7 was 0.47
  // units there and 0.08 units on the live store: the same numeral meaning two
  // different bars, which is the whole finding. CAL.
  COLD_START_FLOOR_UNITS: 0.4,
  COLD_START_MAX_CANDIDATES: 3,
  MIN_BACKGROUND_SAMPLE: 3,

  NEAR_DUPLICATE: 0.85,
  // 2 -> 1 (CAL, 2026-09-04). §3 says the loud tier is for RARELY, and after
  // length normalization it fired on 13 of 13 real turns. A cap could not fix
  // the TURN count — only a floor can, and the floor above now does (3 of 13) —
  // but the cap is what bounds a single turn, it is scale-free, and it halves
  // what the owner reads uninvited. Left at 1: with the loud floor in place the
  // cap binds on no turn of the 13, so raising it back to 2 would be trading a
  // measured bound for an unmeasured one.
  MAX_SURFACED: 1,
  MAX_FOOTNOTES: 6,

  AFFECT_MIN_EMOTION: 0.7,
  AFFECT_REFRACTORY_TURNS: 2,

  BUDGET_BYTES: 2048,
  GIST_BYTES: 240,
  FOOTNOTE_TITLE_BYTES: 150,
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

/**
 * The loud-tier floor for one kind, in ACTIVATION, from the per-kind override
 * table and the declared fallback (§9 G12). `unit` is `gate.ts#floorUnit` — the
 * weight of one maximally-rare cue on this store — because the table is in cue
 * units and a floor has to be a number in the same space as an activation before
 * it can refuse one.
 */
export function strongFloor(t: RecallTunables, kind: string, unit: number): number {
  return (t.FLOOR_STRONG_BY_KIND_UNITS[kind] ?? t.FLOOR_STRONG_DEFAULT_UNITS) * unit;
}
