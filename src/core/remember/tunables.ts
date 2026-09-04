/**
 * Every constant `remember/` has, in one visible place (the shape `physics/` set).
 *
 * CAL = calibration-required (scar §2.8): it must ship with a recorded measurement
 * against a real corpus, or ship disabled. Where a CAL number here is shipped
 * enabled, the reason is written next to it — the honest test is "what does being
 * wrong cost?", and for the two `updates:` thresholds the cost of being wrong is a
 * REFUSAL, which the contract already prices at zero (§5 G10: "a miss costs nothing
 * durable: the memory still lands").
 */
export const TUNABLES = {
  /** Below this, a claim is not worth a run: scraps ride to the next boundary
   *  (behavioral-spec §2 G8, v1's measured 200 bytes). */
  MIN_CLAIM_BYTES: 200,
  /** How long a claim file must sit untouched before a later claim treats it as a
   *  crashed run's leftovers and merges it back in. Any detached worker's watchdog
   *  must fire well INSIDE this window — see `validateWatchdog()` (scars E4, E5). */
  STALE_CLAIM_MS: 10 * 60_000,
  /** Hashes retained in the consumed ledger (dedup layer 2's tail). Bounded on
   *  purpose: it is telemetry-grade bookkeeping, not canonical memory. */
  CONSUMED_LEDGER_MAX: 2000,
  /** CAL. How long a session must go SILENT — no boundary of any kind — before
   *  the fallback may call it crashed and read its transcript. It is the third
   *  clause of the crash definition (uncovered spans ∧ no `session-end`
   *  boundary ∧ this window), and it has nothing to do with `STALE_CLAIM_MS`:
   *  that one ages a CLAIM FILE against a worker's watchdog, this one ages a
   *  SESSION against its author. `validateWatchdog()` is untouched by it.
   *
   *  Shipped enabled at 60 minutes, and the honest question is what being wrong
   *  costs in each direction. TOO SHORT re-creates the bug this gate exists to
   *  kill: a live session that pauses — the owner at lunch, a long build, a
   *  human thinking — is read as crashed, and the sweep paraphrases turns whose
   *  author is still holding the pen (measured 2026-09-04: 13 chunks, 61
   *  sweep-minted memories beside 34 authored notes in one evening, twins that
   *  TAU_DUP 0.95 can never merge). TOO LONG costs only DELAY: a genuinely
   *  crashed session's spans wait in the buffer for the next worker run past
   *  the window — nothing is lost, because nothing is dropped. An asymmetric
   *  cost gets the generous number, and 60 minutes is a judgement, not a
   *  finding: long enough that an ordinary pause in a live session is not read
   *  as a death, short enough that a real crash is recovered the same day.
   *
   *  NOT MEASURED, and both halves are owed (scar §2.8): (a) the distribution
   *  of inter-turn gaps inside live sessions — the number this window has to
   *  clear — and (b) sessions swept under this rule that LATER received an
   *  authored deposit, which is the falsifier. A nonzero (b) is the window
   *  being too short. */
  CRASH_STALE_MS: 60 * 60_000,
  /** Target bytes per fallback chunk. Chunking is per-chunk failure isolation
   *  (scar E1), not a token budget — the budget belongs to whoever injects the
   *  interpret function. */
  CHUNK_BYTES: 12_000,
  /** How many DISTINCT LIVED DAYS a span may fail on before the sweep stops
   *  paying for it: at this count it is QUARANTINED (written to
   *  `quarantine.jsonl`, never restored) instead of retried. The P0 fix traded
   *  silent loss for indefinite retry — one model call per boundary, forever,
   *  on the owner's account (replay-review 2026-08-26, "Poison-pill retry is
   *  unbounded"). This is that bound. Days, not attempts (PR-8 review): three
   *  Stop hooks inside one API outage are ONE day's failure and quarantine
   *  nothing; a poison pill fails on every day it is tried and is set aside on
   *  the third. */
  MAX_SPAN_FAILURES: 3,
  /** CAL. Content-match score floor for `updates:` resolution. Shipped enabled
   *  because failure = refusal = the memory lands unlinked. */
  UPDATES_FLOOR: 0.55,
  /** CAL. Required margin between the best and second-best candidate. Inside this
   *  margin the author's hint is a tiebreak; below the floor it is powerless. */
  UPDATES_MARGIN: 0.1,
  /** Candidates scored per resolution. */
  UPDATES_CANDIDATES: 8,
} as const;

/**
 * Scar E4/E5, mechanized: a detached worker's watchdog must fire before its claim
 * looks stale, or two runs can hold the same spans. The contract asks for the
 * timeout to be "validated against the lock-staleness window" (§5 G1) — this is
 * that validation, exported so the adapter that owns detachment can call it.
 */
export function validateWatchdog(
  timeoutMs: number,
  staleClaimMs: number = TUNABLES.STALE_CLAIM_MS,
): { ok: boolean; reason: "OK" | "TIMEOUT_NOT_FINITE" | "TIMEOUT_EXCEEDS_STALENESS" } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, reason: "TIMEOUT_NOT_FINITE" };
  }
  if (timeoutMs >= staleClaimMs) return { ok: false, reason: "TIMEOUT_EXCEEDS_STALENESS" };
  return { ok: true, reason: "OK" };
}
