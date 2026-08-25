/**
 * The floor prune — and it is ARCHIVAL, not deletion.
 *
 * `physics.pruneVerdict` alone decides. No model on any path holds this power,
 * and this phase adds no criterion of its own: it supplies the one piece of
 * context physics cannot compute (is this memory in a live revision chain?),
 * applies the verdict absolutely, and records it.
 *
 * **The contract's open question 1, resolved toward archival.** `sleep/CONTRACT.md`
 * §4 called the floor prune "the one place the system deletes" and flagged the
 * question as open; v1's §11 G6 said the opposite in as many words. The answer
 * is archival, and the store settles it structurally: there is no delete, no
 * unlink, no remove anywhere in `store/`, so there is no verb to call. A pruned
 * memory keeps its prose, keeps its id, stays resolvable, and carries
 * `archived_reason = "pruned"`. Fading is not deletion; a strong enough cue can
 * still reach it, and the exit is countable (scar §2.17). See NOTES.md §2.
 *
 * **Record first, move second (§5 G8).** The record is counts, kind, and dates —
 * NEVER a body and NEVER a content hash (scar §2.20; hashing low-entropy content
 * leaks it). A failed record append means NOTHING MOVES for that memory: the
 * archive is skipped, the failure is counted with its reason, and the cycle
 * continues.
 */

import { pressureAt, pruneVerdict, supersededResolvable } from "../physics/index.js";
import type { MemoryPhysics, PruneReason } from "../physics/index.js";
import { rowToPhysics } from "../store/operational.js";
import { PRUNE_ARCHIVE_REASON, PRUNE_RECORD_PREFIX } from "./tunables.js";
import type { MemoryRow, PhaseCtx, PhaseOutcome, PrunedRecord } from "./types.js";
import { countSkip, emptyOutcome } from "./types.js";

export interface PruneResult extends PhaseOutcome {
  readonly pruned: readonly PrunedRecord[];
  /** Every blocking gate, counted — physics names all five, not just the first. */
  readonly blocked: Readonly<Record<string, number>>;
  /** Memories left in place because their record could not be written. */
  readonly recordFailures: readonly { id: string; error: string }[];
}

export function pruneRecordKey(id: string): string {
  return `${PRUNE_RECORD_PREFIX}${id}`;
}

/**
 * The one input physics cannot see: is this memory load-bearing in a revision
 * that is still live? Three ways to be, all read from canonical state:
 *
 *   - it has already been superseded (it has a forwarding address);
 *   - a version row still points at a successor within the resolvable horizon H;
 *   - challenge pressure is standing against it right now — an argument in
 *     progress is not a memory to quietly retire.
 */
export function inLiveRevisionChain(
  store: Pick<PhaseCtx["store"], "versions">,
  id: string,
  row: MemoryRow,
  physics: MemoryPhysics,
  day: number,
): boolean {
  if (row.superseded_by !== null) return true;
  if (pressureAt(physics, day) > 0) return true;
  return store
    .versions(id)
    .some((v) => v.successor_id !== null && supersededResolvable(v.version_day, day));
}

export function runPrune(ctx: PhaseCtx): PruneResult {
  const out = emptyOutcome();
  out.skipped["archived"] = 0;
  out.skipped["removed"] = 0;
  const blocked: Record<string, number> = {};
  const pruned: PrunedRecord[] = [];
  const recordFailures: { id: string; error: string }[] = [];

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
    // Already archived — including anything this cycle's dedup archived. An
    // archived memory has already exited; it is not pruned a second time.
    if (row.archived === 1) {
      countSkip(out, "archived");
      continue;
    }
    out.examined += 1;

    const p = rowToPhysics(row);
    const verdict = pruneVerdict(p, day, {
      inLiveRevisionChain: inLiveRevisionChain(store, id, row, p, day),
    });
    if (!verdict.prune || verdict.record === null) {
      // EVERY failing gate, not just the first — physics names all five, and a
      // memory blocked by two reasons that reports one is a memory nobody can
      // explain. Mirrored into the skip map so the cycle report carries them.
      for (const reason of verdict.blockedBy) {
        blocked[reason] = (blocked[reason] ?? 0) + 1;
        countSkip(out, `blocked:${reason}`);
      }
      continue;
    }

    if (ctx.apply) {
      try {
        store.setMeta(pruneRecordKey(id), JSON.stringify(verdict.record));
        // Beside it, never instead of it: the meta row is what §5 G8 gates the
        // move on; the durable event is what makes the record queryable.
        store.appendEvent?.({
          name: verdict.record.event,
          day,
          ref: id,
          dedupKey: pruneRecordKey(id),
          payload: { ...verdict.record },
        });
      } catch (err) {
        // §5 G8: a failed record append means nothing moves.
        const code = errorCode(err);
        recordFailures.push({ id, error: code });
        countSkip(out, "record-append-failed");
        ctx.event("sleep.prune.record-failed", id, { error: code });
        continue;
      }
      store.archive(id, PRUNE_ARCHIVE_REASON);
    }
    pruned.push({ id, record: verdict.record });
    out.changed += 1;
    ctx.event("sleep.pruned", id, {
      kind: verdict.record.kind,
      band: verdict.record.band,
      strength: verdict.record.strength,
      uses: verdict.record.uses,
      dwellDays: verdict.dwellDays,
      day,
    });
    ctx.step("item", { index, id });
  }

  return { ...out, pruned, blocked, recordFailures };
}

function errorCode(err: unknown): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return err instanceof Error ? err.name : "UNKNOWN";
}

export type { PruneReason };
