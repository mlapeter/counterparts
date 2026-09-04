/**
 * Consolidation marking, and the ONE place identity promotion happens.
 *
 * Two jobs, in this order, because the second depends on the first:
 *
 * 1. **Consolidation marking.** A memory that has survived at least one lived day
 *    past its birth and now sits at or above the semantic floor gets
 *    `consolidated = true`, which is worth `+CONS_BONUS` to `base` for the rest
 *    of its life (`physics/` §5.2). This is the replay-and-integrate pass, on
 *    v0's 3-lived-day cadence.
 *
 *    The criterion MOVED to `physics.consolidationEligibility()` on 2026-08-25
 *    (SEAMS item M, INTERFACE-GAPS.md §5). This phase now executes a crossing it
 *    does not define — the shape the whole contract is built on, and the same
 *    relationship it already had with `promotionEligibility`. The property the
 *    old inline criterion was written to protect travelled with it: there is
 *    deliberately NO reinforcement requirement, because "a formative one-shot
 *    consolidates without repetition" is a property physics protects with a
 *    `max`, and a repetition gate would quietly repeal it.
 *
 * 2. **Identity promotion — HERE AND ONLY HERE.** Physics decides eligibility
 *    (`base >= THETA_ID` AND reinforcement on >= N = 3 DISTINCT lived days);
 *    sleep executes the crossing. The crossing is an EXPLICIT, COUNTED EVENT
 *    with a persisted §5.3 record — never an emergent side effect of a number
 *    drifting past a line (scar §2.4). Nothing is born into identity; this and
 *    revision inheritance are the only two doors.
 *
 *    Ordering matters: consolidation runs first *within* this phase, so the
 *    `+0.2` it grants is visible to the promotion test in the same cycle. That
 *    is the intended path into the identity band, not an accident of sequencing.
 */

import { consolidationEligibility, promote } from "../physics/index.js";
import type { PromotionReason } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { PROMOTION_RECORD_PREFIX } from "./tunables.js";
import type { PhaseCtx, PhaseOutcome, PromotionRecord } from "./types.js";
import { countSkip, emptyOutcome, isJournal } from "./types.js";

export const CONSOLIDATION_SKIPS = [
  // The three housekeeping entries. The rest of this list IS physics' reason
  // vocabulary, so a reason cannot drift between the two.
  "archived",
  "removed",
  "journal",
  "already-consolidated",
  "born-today",
  "below-semantic-floor",
] as const;

export type ConsolidationSkip = (typeof CONSOLIDATION_SKIPS)[number];

export interface ConsolidateResult extends PhaseOutcome {
  readonly consolidated: readonly string[];
  readonly promoted: readonly PromotionRecord[];
  /** Every blocking promotion reason, counted. "Never asked" is not "refused". */
  readonly promotionBlocked: Readonly<Record<string, number>>;
}

export function promotionRecordKey(id: string): string {
  return `${PROMOTION_RECORD_PREFIX}${id}`;
}

export function runConsolidate(ctx: PhaseCtx): ConsolidateResult {
  const out = emptyOutcome();
  for (const skip of CONSOLIDATION_SKIPS) out.skipped[skip] = 0;
  const promotionBlocked: Record<string, number> = {};
  const consolidated: string[] = [];
  const promoted: PromotionRecord[] = [];

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
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
    // A source is not consolidated and cannot cross into the identity band; the
    // MEMORY made from it can, and that is the path (`types.ts#isJournal`).
    if (isJournal(row)) {
      countSkip(out, "journal");
      continue;
    }
    out.examined += 1;

    let p = rowToPhysics(row);

    // ── 1. consolidation marking ────────────────────────────────────────────
    // Physics decides; this phase executes and counts. The skip vocabulary below
    // IS physics' reason vocabulary, so a reason cannot drift between them.
    const eligibility = consolidationEligibility(p, day);
    if (!eligibility.eligible) {
      countSkip(out, eligibility.reason);
    } else {
      if (ctx.apply) store.updatePhysics(id, { consolidated: true });
      p = { ...p, consolidated: true };
      consolidated.push(id);
      out.changed += 1;
      ctx.event("sleep.consolidated", id, { kind: p.kind, day });
      ctx.step("item", { index, id });
    }

    // ── 2. the identity crossing ────────────────────────────────────────────
    const outcome = promote(p, day);
    if (!outcome.promoted || outcome.crossing === null) {
      // Promotion needs ALL conditions, so ALL blocking reasons are reported —
      // "base too low" and "not enough distinct days" are different diagnoses,
      // and mirrored into the skip map they reach the cycle report as well.
      for (const reason of outcome.verdict.blockedBy) {
        promotionBlocked[reason] = (promotionBlocked[reason] ?? 0) + 1;
        countSkip(out, `promotion:${reason}`);
      }
      continue;
    }
    const record: PromotionRecord = { id, ...outcome.crossing };
    if (ctx.apply) {
      // Record BEFORE the flag: a crossing nobody could account for afterwards
      // is exactly the emergent promotion this phase exists to replace. If the
      // record cannot be written, the memory does not cross.
      store.setMeta(promotionRecordKey(id), JSON.stringify(record));
      store.appendEvent?.({
        name: record.event,
        day,
        ref: id,
        dedupKey: promotionRecordKey(id),
        payload: { ...record },
      });
      store.updatePhysics(id, { promotedIdentity: true });
      // The band column in box 2 is canonical for a crossing (it is a decision,
      // not a decay reading) — unlike the decay phase, which touches no canonical
      // state at all.
      store.setBand(id, "identity", day);
    }
    promoted.push(record);
    out.changed += 1;
    ctx.event("sleep.promoted", id, {
      kind: record.kind,
      base: record.base,
      reinforcedDays: record.reinforcedDays,
      day,
    });
    ctx.step("item", { index, id });
  }

  return { ...out, consolidated, promoted, promotionBlocked };
}

export type { PromotionReason };
