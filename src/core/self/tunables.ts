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
  /** Further substance since the last ask, in turns, before another chapter —
   *  AND the byte threshold below, never or. CAL. */
  REASK_TURNS: number;
  /** Further substance since the last ask, in bytes, before another chapter. CAL. */
  REASK_BYTES: number;
  /**
   * Asks ONE SESSION may raise ON ONE CALENDAR DAY. A backstop on the COUNT; the
   * re-ask pair is what bounds the cadence, and the orphanable tail is measured
   * against that pair, never hidden (§13 known gap). CAL.
   *
   * **The measurement against per-session, and why it no longer holds.** On
   * 2026-09-04 a per-session cap of 6 was reached inside ONE evening
   * conversation, and the cap moved to the lived day (later the calendar date,
   * I32) at v1's day calibration: "a work day gets about three". That evening
   * was measured under the OLD re-ask rule — two pacers, an OR, and a byte half
   * a third of v1's, so the model's own chapter-writing reply could re-trigger
   * the ask. The SAME DAY the rule became one pacer and an AND
   * (`episodes.ts#askDue`: `sinceTurns >= REASK_TURNS && sinceBytes >=
   * REASK_BYTES`). Under the AND, six asks in one session need roughly
   * 6 + 5×8 = 46 real turns AND the bytes to go with them, so frequency is held
   * by the pacer and this number is only a ceiling on a very long session.
   *
   * **What the day cap cost, measured 2026-09-17**
   * (`docs/finding-12-diagnosis-2026-09-17.md`): shared across every session a
   * calendar day held, it refused 196 of 264 Stop moments, and the crash-fallback
   * sweep wrote 888 memories against the author's 193. The owner runs five or
   * more sessions a day, so the day's four asks were spent before most sessions
   * began — the author was not losing a fight, it was never invited. Per
   * session, keeping the substance pacer, is the owner's ruling of 2026-09-17.
   *
   * **And why the session's whole life was too long a window, 2026-09-18.** A
   * coordinating session spent all six inside one working day; its end-of-day
   * handoff — the stretch most worth writing — was never offered the pen, and
   * nothing could give the allowance back short of a new session. So the count
   * is per session PER CALENDAR DAY (owner's ruling), on the store's own date
   * rather than the lived day, for the reason I32 gave. Exhausting it inside one
   * day still binds; for now that is accepted, and the pacer means six asks in a
   * day is already about 46 real turns.
   */
  MAX_ASKS_PER_SESSION: number;
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
  MAX_ASKS_PER_SESSION: 6,
  REGROW_WINDOW_DAYS: 3,
};

export function withTunables(overrides: Partial<SelfTunables>): SelfTunables {
  return { ...SELF_TUNABLES, ...overrides };
}
