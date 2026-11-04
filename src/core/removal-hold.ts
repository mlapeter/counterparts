/**
 * THE HOLD: A CHAT'S DELETE, MADE NON-DESTRUCTIVE (HD1, 2026-11-04; Mike's
 * yes 09:16, lightly held; design note 2026-11-03-briefs/HD1-design-note.md).
 *
 * A person can ask Claude to delete one memory. The model may not destroy
 * anything (CLI CONTRACT §1: the erase is the owner's console's, or an
 * owner-side clock's), so what the model's call does is HIDE: it appends
 * `held` to the removal record, and the store's deny-list hides the memory at
 * once from everything that reads it — recall, the wake, footnotes, the night,
 * sleep, reminders. Twenty-four hours of wall-clock time later something no
 * model can call erases it with the console's own removal
 * (`sweepHeldRemovals`, in `adapters/cli/`): hosted's ten-minute timer, or
 * the worker on local. Inside the window `released` undoes it, whole.
 *
 * This file writes only removal-record rows, through `Store.appendRemovalRecord`
 * — the same door the console's removal records through — and reads. It
 * destroys nothing, and imports nothing that does: the caller-universality
 * test in `test/cli.test.ts` still pins who may reach the erase.
 *
 * `removalRefusal` lives here, not in the console's removal module where it was born
 * (2026-09-22), so the model's door and the console's ask the SAME question:
 * an id the hold refuses is one the console refuses, and the other way round,
 * except that a held id is the console's to finish.
 */
import { isSelfPageRow } from "./self/page.js";
import { REMOVAL_HOLD_MS } from "./store/index.js";
import type { Store } from "./store/index.js";

/** Everything a removal (or a hold) can say instead of going ahead. */
export type RemovalRefusal = "unknown-id" | "not-memory-bearing" | "already-removed" | "is-the-self-page";

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/** The fixed reason a hold records (§16 G9: the record holds no words of the memory, and no model-written why). */
export const HOLD_REASON = "asked in chat";

/**
 * IS THIS ID REMOVABLE AT ALL — step 1 of a removal on its own, and nothing
 * after it. Pure: it writes nothing and takes no lock.
 *
 * Extracted 2026-09-22 for the console's interactive picker; moved here
 * 2026-11-04 (HD1) so the hold asks it too. A HELD id is removable — the hold
 * is the first half of a removal, and the console's `--confirm` or the sweep
 * finishes it — so `already-removed` means taken dark, not held.
 */
export function removalRefusal(store: Store, targetId: string): RemovalRefusal | null {
  const row = store.row(targetId);
  if (row === undefined) return "unknown-id";
  if (!MEMORY_BEARING.has(row.type)) return "not-memory-bearing";
  if (store.deniedIds().includes(targetId) && !store.isHeld(targetId)) return "already-removed";
  // THE SELF PAGE IS NOT REMOVED, IT IS CLEARED (2026-09-18, S1). Removal
  // tombstones a row and `schemas/` reads every schema row at open; the page
  // has its own door (`self-page --clear`), which keeps it as a version. See
  // the console's removal module for the history of this rule.
  if (isSelfPageRow(store, targetId)) return "is-the-self-page";
  return null;
}

/** What a hold or an undo names the memory by: its title, or its first line. Never more. */
export function heldTitle(doc: { title?: string | null; body: string }): string {
  const t = (doc.title ?? "").trim();
  if (t.length > 0) return t.replace(/\s+/g, " ");
  const first = (doc.body.split("\n").find((l) => l.trim().length > 0) ?? "").trim().replace(/\s+/g, " ");
  const chars = [...first];
  return chars.length <= 80 ? first : `${chars.slice(0, 79).join("").trimEnd()}…`;
}

export type HoldOutcome =
  | {
      readonly ok: true;
      /** `held` now, or `already-held` (a second ask is the first one's answer: idempotent). */
      readonly reason: "held" | "already-held";
      readonly id: string;
      readonly title: string;
      /** When the memory was written, epoch ms. */
      readonly createdAt: number;
      /** When the hold was placed, and when the sweep may erase it (epoch ms). */
      readonly heldAt: number;
      readonly erasableAt: number;
    }
  | { readonly ok: false; readonly reason: RemovalRefusal; readonly id: string };

/**
 * PUT ONE MEMORY ON THE HOLD. Refused for what removal refuses; idempotent on
 * an id already held (the deadline stays the first hold's — a second ask does
 * not buy a second day). Throws only when the record cannot be written, which
 * is the one failure where doing nothing is correct (§16 G10).
 */
export function holdForRemoval(store: Store, id: string, opts: { actor?: string } = {}): HoldOutcome {
  const already = store.pendingHolds().find((h) => h.id === id);
  const refusal = already === undefined ? removalRefusal(store, id) : null;
  if (refusal !== null) return { ok: false, reason: refusal, id };
  if (already === undefined) {
    store.appendRemovalRecord({ memoryId: id, stage: "held", actor: opts.actor ?? "self", reason: HOLD_REASON });
  }
  const hold = store.pendingHolds().find((h) => h.id === id);
  const doc = store.heldProse(id);
  const row = store.row(id);
  const heldAt = hold?.at ?? store.now();
  return {
    ok: true,
    reason: already === undefined ? "held" : "already-held",
    id,
    title: doc === null ? id : heldTitle(doc),
    createdAt: row?.created_at ?? heldAt,
    heldAt,
    erasableAt: heldAt + REMOVAL_HOLD_MS,
  };
}

export type ReleaseOutcome =
  | { readonly ok: true; readonly reason: "released"; readonly id: string; readonly title: string }
  | { readonly ok: false; readonly reason: "unknown-id" | "not-held" | "already-removed"; readonly id: string };

/**
 * UNDO A HOLD before the erase: `released`, and the memory is back as it was —
 * nothing about it was touched while it was held, and the store re-indexes its
 * words. After the erase it is `already-removed`, and nothing brings it back.
 */
export function releaseHold(store: Store, id: string, opts: { actor?: string } = {}): ReleaseOutcome {
  if (store.row(id) === undefined && store.removalRecord(id).length === 0) return { ok: false, reason: "unknown-id", id };
  if (!store.isHeld(id)) {
    return { ok: false, reason: store.deniedIds().includes(id) ? "already-removed" : "not-held", id };
  }
  const doc = store.heldProse(id);
  store.appendRemovalRecord({ memoryId: id, stage: "released", actor: opts.actor ?? "self", reason: HOLD_REASON });
  return { ok: true, reason: "released", id, title: doc === null ? id : heldTitle(doc) };
}

/** The holds waiting, with their titles and when each may be erased: the `deleted` handle's list. */
export function heldList(store: Store): { id: string; title: string; heldAt: number; erasableAt: number }[] {
  return store.pendingHolds().map((h) => {
    const doc = store.heldProse(h.id);
    return { id: h.id, title: doc === null ? h.id : heldTitle(doc), heldAt: h.at, erasableAt: h.at + REMOVAL_HOLD_MS };
  });
}

/** The holds whose window has passed at `now`: the sweep's work list, oldest first. */
export function dueHolds(store: Store, now: number): { id: string; at: number }[] {
  return store.pendingHolds().filter((h) => h.at + REMOVAL_HOLD_MS <= now);
}

/** Recall's handle for the holds waiting (HD1): each by title, with when it goes, to undo one. */
export const DELETED_HANDLE = "deleted";

/**
 * The wake's count of a chat's deletes still on their hold (HD1): a count,
 * never titles — titles would show again what was asked gone. Null at none.
 * The line both wakes carry: the MCP `wake` and Claude Code's session start.
 */
export function heldWakeLine(n: number): string | null {
  if (n <= 0) return null;
  return `${n === 1 ? "1 memory" : `${String(n)} memories`} deleted in chat ${n === 1 ? "is" : "are"} waiting to be erased: recall "${DELETED_HANDLE}" to see or undo.`;
}
