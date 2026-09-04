/**
 * Every `self/` knob, in one visible place — the shape `physics/` and `recall/`
 * use, for the same reason: a threshold hiding in a function body cannot be
 * audited.
 *
 * **CAL = calibration-required** (scar §2.8). Values marked CAL are v1's live
 * calibration, inherited as the best surviving record of what real use moved.
 * They are a starting point, not a v2 measurement; `tools/replay` re-earns them.
 *
 * **The total wake budget is deliberately NOT here.** v1's 9,000 bytes was 90% of
 * one host's injection cliff; in v2 the ceiling is a host capability the caller
 * reports (contract §4, scar §2.18). `BriefingRequest.budgetBytes` is required at
 * the call, and there is no constant anywhere in this module to fall back to.
 *
 * Structural (never tunable, never ablatable): the composed budget, the
 * header/sentinel pair, the trim order existing and being declared, the freeze
 * itself, the observer refusal, pre-render-not-render-on-wake.
 */

export interface SelfTunables {
  // ── briefing lanes ────────────────────────────────────────────────────────
  /** Most identity elements considered for the briefing. The BUDGET is the real
   *  bound; this only stops a pathological store from composing a megabyte to
   *  throw it away. CAL. [v1 self-index: 16 elements] */
  IDENTITY_MAX: number;
  /** The largest fraction of the COMPOSED BUDGET the identity lane may take
   *  **while the other lanes have content to spend the rest on**. Not a lane
   *  budget (contract §5 G2 — the total still governs): it is how the total is
   *  SPLIT when lanes compete, applied by whole elements and released back to
   *  identity when nothing else can use the room. CAL.
   *
   *  Measured 2026-09-03/04 on the live host: a migrated store's identity
   *  elements run ~1.1 KB each, identity trims LAST, so the wake delivered to
   *  every session was 8 identity elements filling all 9,000 bytes — craft 0,
   *  threads 0, hints 0, horizon 0 — while v1's wake the same day carried 20
   *  elements across four lanes. 0.5 leaves ~4.5 KB for the other four lanes at
   *  that ceiling, which is v1's whole non-identity wake, and still gives
   *  identity four of the long migrated elements (or ~20 v2-native ones). */
  IDENTITY_SHARE: number;
  /** Most craft (skill-kind) elements considered. CAL. */
  CRAFT_MAX: number;
  /** Most open threads considered. CAL. [v1 threads lane: count-capped at 12] */
  THREADS_MAX: number;
  /** Most warm-shelf hints considered. CAL. */
  HINTS_MAX: number;
  /** Most arriving occasions considered. CAL. */
  HORIZON_MAX: number;
  /** A non-identity element must reach this decayed strength to be craft or a
   *  hint. Identity elements are constitutive and face no floor (contract §3:
   *  "identity is re-inhabited, not retrieved"). CAL. */
  WARM_FLOOR: number;

  // ── budget telemetry ──────────────────────────────────────────────────────
  /** Fraction of the budget at which the render reports pressure. A budget gets
   *  an event when APPROACHED and one when crossed (scar §2.4). [v1: 0.9] */
  BUDGET_PRESSURE: number;

  // ── the standing self-schema counter (contract §5 G4) ─────────────────────
  /** Total bytes of self-kind + identity-band prose at which the counter trips.
   *  v1 measured ~72 KB of accumulated `currentState` before anyone noticed
   *  (earned-mechanism #5); the tripwire exists so the next time is measured. CAL. */
  SCHEMA_BYTES_TRIP: number;
  /** Fraction of the trip point that reports pressure. */
  SCHEMA_BYTES_PRESSURE: number;

  // ── episodes (behavioral-spec §13, all TUNABLE by name) ───────────────────
  /** First ask needs this many real turns AND `FIRST_ASK_BYTES`... CAL. */
  FIRST_ASK_TURNS: number;
  /** ...or this many real bytes... CAL. */
  FIRST_ASK_BYTES: number;
  /** ...or bytes alone past this point, so a one-prompt agentic session still
   *  journals (§13 G1). CAL. */
  SOLO_ASK_BYTES: number;
  /** Further substance since the last ask, in turns, before another chapter. CAL. */
  REASK_TURNS: number;
  /** Further substance since the last ask, in bytes, before another chapter. CAL. */
  REASK_BYTES: number;
  /** Chapters one session may open. The orphanable-tail bound is measured
   *  against this, never hidden (§13 known gap). CAL. */
  MAX_CHAPTERS: number;
  /** Lived days an episode may be re-ingested after its first ingest. The window
   *  CLOSES — a deliberate deviation from human reconsolidation (§13 G12). CAL. */
  REGROW_WINDOW_DAYS: number;
}

export const SELF_TUNABLES: SelfTunables = {
  IDENTITY_MAX: 24,
  IDENTITY_SHARE: 0.5,
  CRAFT_MAX: 8,
  THREADS_MAX: 12,
  HINTS_MAX: 8,
  HORIZON_MAX: 6,
  WARM_FLOOR: 0.35,

  BUDGET_PRESSURE: 0.9,

  SCHEMA_BYTES_TRIP: 72_000,
  SCHEMA_BYTES_PRESSURE: 0.75,

  FIRST_ASK_TURNS: 6,
  FIRST_ASK_BYTES: 4_000,
  SOLO_ASK_BYTES: 12_000,
  REASK_TURNS: 8,
  REASK_BYTES: 8_000,
  MAX_CHAPTERS: 6,
  REGROW_WINDOW_DAYS: 3,
};

export function withTunables(overrides: Partial<SelfTunables>): SelfTunables {
  return { ...SELF_TUNABLES, ...overrides };
}
