/**
 * The decay tick — synaptic downscaling, as a cache refresh.
 *
 * What this phase does: recompute `strength(m, d)` and `band(m, d)` for every
 * live memory and materialize the result into the ranking cache (box 3).
 *
 * What it does NOT do, and cannot: touch canonical state. Strength is a pure
 * function of stored state and the lived day, so there is no "step" to apply and
 * nothing to double-apply. `uses`, `lastUsedDay`, the box-2 band column, and the
 * prose are all untouched. v1 materialized decay into canonical files (~1.9K
 * file writes a day); v2 received that as an open choice with the evidence
 * attached (behavioral-spec §11) and declined it.
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
 */

import { band, strength } from "../physics/index.js";
import { TUNABLES as PHYSICS } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { TUNABLES } from "./tunables.js";
import type { PhaseCtx, PhaseOutcome } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";
import type { StrengthCache, StrengthRow } from "./strength-cache.js";

/** Skip categories, enumerated so a zero is distinguishable from an absence. */
export const DECAY_SKIPS = [
  "archived",
  "removed",
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
}

export function runDecay(ctx: PhaseCtx, cache: StrengthCache | null): DecayResult {
  const out = emptyOutcome();
  for (const skip of DECAY_SKIPS) out.skipped[skip] = 0;

  const { store, day } = ctx;
  const denied = new Set(store.deniedIds());
  const prior = cache === null ? new Map<string, StrengthRow>() : cache.readAll();
  const written: StrengthRow[] = [];
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
    out.examined += 1;

    const p = rowToPhysics(row);
    const s = strength(p, day);
    const b = band(p, day);

    // The named skip categories. They are reported, not branched on: the
    // arithmetic already produces the right number for each.
    if (p.promotedIdentity) countSkip(out, "identity-band");
    if (p.lastUsedDay === day) countSkip(out, "reinforced-today");
    if (s < PHYSICS.PHI_PRUNE) countSkip(out, "at-floor");

    const was = prior.get(id);
    const moved =
      was === undefined ||
      was.band !== b ||
      Math.abs(was.strength - s) >= TUNABLES.DECAY_QUANTUM;
    if (!moved) {
      countSkip(out, "unchanged");
      continue;
    }
    written.push({ id, strength: s, band: b, day });
    out.changed += 1;
    ctx.step("item", { index, id });
  }

  if (ctx.apply && cache !== null && written.length > 0) {
    cache.write(written);
    ctx.event("sleep.decay.materialized", undefined, {
      rows: written.length,
      examined: out.examined,
      day,
    });
  }
  return { ...out, written };
}
