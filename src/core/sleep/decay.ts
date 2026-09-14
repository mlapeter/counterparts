/**
 * The decay tick — synaptic downscaling, as a cache refresh.
 *
 * What this phase does: recompute `strength(m, d)` and `band(m, d)` for every
 * live memory and materialize the result into the ranking cache (box 3) — and,
 * since 2026-09-14, write each row's band back to the box-2 `band` column when
 * the column disagrees with the arithmetic.
 *
 * What it does NOT do, and cannot: apply a decay STEP to canonical state.
 * Strength is a pure function of stored state and the lived day, so there is no
 * "step" to apply and nothing to double-apply. `uses`, `lastUsedDay` and the
 * prose are untouched. v1 materialized decay into canonical files (~1.9K file
 * writes a day); v2 received that as an open choice with the evidence attached
 * (behavioral-spec §11) and declined it, and still declines it.
 *
 * THE BAND COLUMN IS THE ONE EXCEPTION, and it is a reconciliation rather than a
 * materialization (IMPROVEMENTS U8, 2026-09-14). `band(m, d)` is the same pure
 * function either way; the column existed as a fossil — episodic at mint,
 * identity at promotion, and never "semantic" — so on the live store 869 rows
 * were semantic in the cache and episodic in the table, and every surface that
 * read the column (the `status` tool's `byBand`) reported a number the system
 * itself did not believe. A pass that EMITS `band.transition` rows and leaves
 * the table contradicting them is a pass that lies in two places at once
 * (constitution 16). So: one UPDATE per row whose column is wrong, never a
 * strength write, never a row that already agrees — a caught-up store writes a
 * handful a day, and a replayed day writes nothing at all. See `NOTES.md` §5.
 *
 * THE SKIP LIST IS BEHAVIOR, and each skip is reported separately (§3, v1 §11
 * G5). Note what "skipped" means here: because the recompute is arithmetic, an
 * identity-band memory is not branched around — `physics.decay()` returns D = 1
 * for it, so the exemption IS the arithmetic. The category is still counted,
 * because "how many rows did not move, and why" is the question the telemetry
 * exists to answer, and a category that is structurally zero is a different
 * record from one that never fired (scar §2.4).
 *
 * CALM BY DEFAULT (v1 §11 G8): a row is written only when it actually moves
 * past `DECAY_QUANTUM` or changes band. A quiet day writes almost nothing.
 *
 * AND — since 2026-08-25 — THIS IS THE ONE PLACE BAND MOVES ARE COUNTED BY
 * DIRECTION, which is what makes `physics.symmetryCheck` (guarantee 12, scar
 * §2.10) a live tripwire instead of a function nobody calls.
 *
 * One place, deliberately, and the reason is arithmetic. Every way a band can
 * change is visible HERE, because `band(m, d)` is a pure function of stored
 * state and this pass reads it for every live row against its last reading:
 *
 *   - a DECAY DEMOTION (semantic→episodic) is only ever a number falling back
 *     under `THETA_SEM`, so this pass is the only place it exists at all —
 *     it was v1's dominant crossing, 268 of 345;
 *   - a REVISION-DRIVEN demotion is the same fact: a challenged memory's
 *     strength moves, and the next tick reads the new band. `schemas/` writes
 *     no band and neither does `supersede` — a source scan says so;
 *   - the IDENTITY CROSSING is a decision `consolidate/` makes and records for
 *     itself, and it becomes a band move here on the next tick, because
 *     `promotedIdentity` makes `band()` answer "identity".
 *
 * Counting the crossing at the promotion site TOO would count it twice — the
 * cache diff has no way to know a move was already recorded — and a
 * double-counted up-move is a ratchet tripwire lying in the ratchet's own
 * direction. So the promotion's up-move is counted one lived day later, which
 * is a lag in a counter whose sample threshold is 20 moves across the whole
 * history, and is the price of having exactly one definition of a crossing.
 */

import { band, bandMove, strength } from "../physics/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { TUNABLES } from "./tunables.js";
import type { BandTransition, PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome, isJournal, recordBandTransition } from "./types.js";
import type { StrengthCache, StrengthRow } from "./strength-cache.js";

/** Skip categories, enumerated so a zero is distinguishable from an absence. */
export const DECAY_SKIPS = [
  "archived",
  "removed",
  /** The journal, which is a source and not a memory (`types.ts#isJournal`). */
  "journal",
  "identity-band",
  "reinforced-today",
  "at-floor",
  "under-audit",
  "unchanged",
] as const;

export type DecaySkip = (typeof DECAY_SKIPS)[number];

export interface DecayResult extends PhaseOutcome {
  /** The rows written this cycle — ids and numbers, never text. */
  written: readonly StrengthRow[];
  /**
   * Band crossings this tick, BY DIRECTION (guarantee 12). v1's dominant
   * crossing was the semantic→episodic decay demotion — 268 of 345 — and this
   * pass is the only place one is observable, because a demotion is not a
   * decision anybody makes: it is the arithmetic falling back under `THETA_SEM`.
   */
  transitions: readonly BandTransition[];
  /**
   * Rows whose box-2 `band` column disagreed with `band(m, d)` and was brought
   * to it this pass (U8). It is a RECONCILIATION count, not a crossing count:
   * `transitions` is the crossing record and is read off the cache diff, while
   * this is "how many rows did the table have wrong". On a caught-up store it is
   * the same handful as the crossings; the first pass after this shipped carries
   * the whole backlog, which is the number worth seeing once.
   *
   * It is ALSO `PhaseOutcome.reconciled`, which is how it reaches the phase
   * report and the durable `sleep.cycle` row; this field is the name the phase's
   * own callers already use. Counted under observer too — only the write is
   * gated on `apply`.
   */
  bandsReconciled: number;
}

export function runDecay(ctx: PhaseCtx, cache: StrengthCache | null): DecayResult {
  const out = emptyOutcome();
  for (const skip of DECAY_SKIPS) out.skipped[skip] = 0;

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const prior = cache === null ? new Map<string, StrengthRow>() : cache.readAll();
  const written: StrengthRow[] = [];
  const transitions: BandTransition[] = [];
  let bandsReconciled = 0;
  const ids = store.list();

  let index = 0;
  for (const id of ids) {
    if (out.examined >= ctx.budget) {
      out.budgetExhausted = true;
      out.skippedForBudget = ids.length - index;
      break;
    }
    index += 1;
    const row = store.row(id);
    if (row === undefined) continue;
    if (denied.has(id)) {
      countSkip(out, "removed");
      continue;
    }
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    // The journal is a source, not a memory: it is not examined, so it cannot
    // move a band or write a strength row (`types.ts#isJournal`).
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    out.examined += 1;

    const p = rowToPhysics(row);
    const s = strength(p, day);
    const b = band(p, day);

    // The named skip categories. They are reported, not branched on: the
    // arithmetic already produces the right number for each.
    if (p.promotedIdentity) countSkip(out, "identity-band");
    if (p.lastUsedDay === day) countSkip(out, "reinforced-today");
    if (s < PHYSICS.PHI_PRUNE) countSkip(out, "at-floor");

    // THE BAND OF RECORD (U8), and why it is here rather than inside the
    // `moved` branch below. `moved` is a question about the CACHE — has this row
    // changed since its last reading — and a row whose cache was right all along
    // while the table was wrong answers "no" forever. Asking the column directly
    // is what makes the reconciliation total: after a pass that was not cut
    // short by the budget, no live non-journal row's column contradicts the
    // arithmetic, which is exactly what `counterparts verify` now counts.
    //
    // THE COUNT IS NOT GATED ON `apply`, only the WRITE is. `PhaseCtx.apply`'s
    // contract is that the read-only path walks the identical code and computes
    // the identical verdicts — it simply never reaches a write — and
    // `sleep.observer.report`'s `would` rides on that. Counting inside the
    // `apply` branch made an observer report 0 disagreements on a store with
    // 869 of them, which is the one number an instrument exists to print.
    const wrong = row.band !== b;
    if (wrong) {
      bandsReconciled += 1;
      if (ctx.apply) store.setBand(id, b, day);
    }

    const was = prior.get(id);
    const moved =
      was === undefined ||
      was.band !== b ||
      Math.abs(was.strength - s) >= TUNABLES.DECAY_QUANTUM;
    if (!moved) {
      // A ROW THE PASS ACTED ON IS NOT AN UNCHANGED ROW, even when the cache had
      // nothing to say about it. On the exact U8 shape — the column wrong and
      // the ranking cache already right — `moved` is false for every row, and
      // counting those as `unchanged` is what made `runCycle` issue 869 UPDATEs
      // and then file the phase as `ran-nothing-found` / `nothing-to-do`. Either
      // or, never both: the row is counted once, in the category that is true.
      if (wrong) out.changed += 1;
      else countSkip(out, "unchanged");
      continue;
    }
    // A CROSSING, not a first reading. `was === undefined` is the cache filling
    // in — a fresh store, or the tick after `rebuildCache()` dropped box 3 — and
    // counting those as up-moves would hand the ratchet tripwire a burst of
    // fabricated promotions on exactly the days it is least able to tell.
    if (was !== undefined && was.band !== b) {
      const direction = bandMove(was.band, b);
      if (direction !== "none") {
        const transition: BandTransition = {
          id,
          kind: row.kind,
          from: was.band,
          to: b,
          direction,
          site: "decay",
          day,
        };
        transitions.push(transition);
        recordBandTransition(ctx, transition);
      }
    }
    written.push({ id, strength: s, band: b, day });
    out.changed += 1;
    ctx.step("item", { index, id });
  }

  // A PASS THAT ONLY RECONCILED STILL DID SOMETHING. The old guard asked the
  // cache alone, so the U8 catch-up — 869 columns rewritten, no strength row
  // moved — left no ring event at all, and the one pass worth watching was the
  // one the log could not see.
  if (ctx.apply && cache !== null && (written.length > 0 || bandsReconciled > 0)) {
    if (written.length > 0) cache.write(written);
    ctx.event("sleep.decay.materialized", undefined, {
      rows: written.length,
      examined: out.examined,
      bandsReconciled,
      day,
    });
  }
  return { ...out, reconciled: bandsReconciled, written, transitions, bandsReconciled };
}
