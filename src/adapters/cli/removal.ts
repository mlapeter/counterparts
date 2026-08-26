/**
 * THE DESTRUCTION PATH. It lives here, in the owner's console, and nowhere else.
 *
 * `src/core/store/owner-op-seam.ts` declares `OwnerRemovalPort` as TYPES ONLY —
 * the store exports no delete, no unlink, no rm, and that absence is the
 * enforcement (§5 G2, §16 G1). This file is the one implementation. A test in
 * `test/cli.test.ts` walks the import graph and fails if any core module, any
 * other adapter, or anything a model can reach imports it. **That test failing
 * is the point**: it is the caller-universality check the contract asks for
 * (§16 G2, earned-mechanism #14).
 *
 * The order below is not style. Every step is a crash point, and at every one of
 * them the memory is either fully alive, or dark AND RECORDED (§16 G10–G11):
 *
 *   1. **Validate the target.** Memory-bearing roots only (§16 G16). The
 *      archive, the backups, the graph and the removal record itself are never
 *      nameable, so a typo cannot point removal at the record of removal.
 *   2. **Read everything that must be read, BEFORE anything is chased** (§16
 *      G13). v1 named this bug by making it: chasing copies first left every
 *      span unidentifiable, so the contamination scan had nothing to match on.
 *      The scan returns **ids only** — printing the matches would re-leak
 *      exactly what is being erased (§16 G15).
 *   3. **`requested`.** If the record cannot be written, NOTHING MOVES. A
 *      removal that happened without a record is the one outcome worse than a
 *      removal that did not happen.
 *   4. **`dark`.** From this moment `Store.deniedIds()` contains the id, and
 *      every consumer that consults it — recall, sleep, associate, prospective,
 *      the cache rebuild — skips it. A restored backup or a stray copy cannot
 *      quietly resurrect it; the stray is skipped and LOGGED, never deleted
 *      (§16 G12).
 *   5. **Chase**, then `chased`, then `complete`. Whatever could not be chased
 *      is REPORTED, never silently dropped (§16 G15: no silent partial success).
 *
 * The record carries no body and no content hash (§16 G9, scar §2.20): a hash of
 * low-entropy content is brute-forceable, which would make the record of a
 * removal a leak of the thing removed.
 */
import { existsSync, rmSync } from "node:fs";

import { paths } from "../../core/store/index.js";
import type { RemovalNote, Store } from "../../core/store/index.js";
// The seam's OUTCOME type is not re-exported by `store/index.ts` (only the port
// and the request are), so it is imported from the seam file itself. Filed in
// INTERFACE-GAPS.md §2 — the seam should travel as one unit.
import type { OwnerRemovalOutcome, OwnerRemovalRequest } from "../../core/store/owner-op-seam.js";

export interface RemovalPlan {
  readonly targetId: string;
  readonly valid: boolean;
  readonly reason: "ok" | "unknown-id" | "not-memory-bearing" | "already-removed";
  /** IDS ONLY. Other memories whose text overlaps the doomed content (§16 G15). */
  readonly contamination: readonly string[];
  /** What the chase will visit, by surface name. Counts, never contents. */
  readonly surfaces: { readonly surface: string; readonly count: number }[];
  /** Surfaces this implementation cannot reach — named, never implied. */
  readonly unchasable: readonly string[];
}

export interface RemovalOptions {
  /** Wall-clock, not lived days: a week away must still be a week of second
   *  thoughts (§16's note on the released ceremony). */
  now?: () => number;
  onEvent?: (name: string, data: Record<string, string | number | boolean | null>) => void;
}

/** Prose families a removal may target. Everything else is chased, never named. */
const MEMORY_BEARING = new Set(["memory", "episode", "schema"]);

/**
 * STEP 1 + 2: validate, then read everything the removal will need. Pure — it
 * writes nothing and takes no lock, so it is safe to run before a confirmation
 * prompt and safe to run again after one (scar §2.13's re-plan-under-the-lock
 * rule; E5's never-hold-a-lock-across-a-human-prompt rule).
 */
export function planRemoval(store: Store, targetId: string): RemovalPlan {
  const none = (reason: RemovalPlan["reason"]): RemovalPlan => ({
    targetId,
    valid: false,
    reason,
    contamination: [],
    surfaces: [],
    unchasable: [],
  });

  const row = store.row(targetId);
  if (row === undefined) return none("unknown-id");
  if (!MEMORY_BEARING.has(row.type)) return none("not-memory-bearing");
  if (store.deniedIds().includes(targetId)) return none("already-removed");

  // EVERYTHING THAT READS THE DOOMED CONTENT HAPPENS HERE (§16 G13).
  let body = "";
  try {
    body = store.readProse(targetId).body;
  } catch {
    // The prose is already gone. The removal still proceeds — the row, the
    // graph and the deny-list entry are the rest of the surface.
  }
  const contamination: string[] = [];
  if (body.trim().length > 0) {
    for (const hit of store.search(body, 20)) {
      if (hit.id !== targetId) contamination.push(hit.id);
    }
  }

  const versions = store.versions(targetId);
  const edges = store.edgesFrom(targetId);
  const prospective = store.prospectiveFor(targetId);

  return {
    targetId,
    valid: true,
    reason: "ok",
    contamination,
    surfaces: [
      { surface: "prose", count: 1 },
      { surface: "versions", count: versions.length },
      { surface: "edges", count: edges.length },
      { surface: "prospective", count: prospective.length },
      { surface: "cache", count: 1 },
    ],
    // Named, not implied: `store/` has no chase surface for box-2 rows, so the
    // row, its edges and its prospective windows survive as DARK state that
    // every consumer skips via the deny-list. See INTERFACE-GAPS.md §1.
    unchasable: ["operational.memories", "operational.edges", "operational.prospective"],
  };
}

/**
 * STEPS 3–5. The one implementation of `OwnerRemovalPort`.
 *
 * It throws only when the RECORD cannot be written, because that is the single
 * failure where doing nothing is correct. Every later failure is caught, counted
 * and reported in `unchased` — a chase that half-worked must say so.
 */
export function ownerRemoval(
  store: Store,
  request: OwnerRemovalRequest,
  opts: RemovalOptions = {},
): OwnerRemovalOutcome {
  const emit = opts.onEvent ?? ((): void => {});
  const notes: RemovalNote[] = [];
  const append = (stage: RemovalNote["stage"]): void => {
    const note: RemovalNote = {
      memoryId: request.targetId,
      stage,
      actor: request.actor,
      reason: request.reason,
    };
    store.appendRemovalRecord(note);
    notes.push(note);
    emit("cli.removal.stage", { stage, target: request.targetId });
  };

  const plan = planRemoval(store, request.targetId);
  if (!plan.valid) {
    // Nothing is recorded for a target that was never removable: a record here
    // would put an id on the deny-list on the strength of a typo.
    throw new Error(`removal refused: ${plan.reason}`);
  }

  // 3. REQUESTED — if this throws, nothing has moved and nothing will (§16 G10).
  append("requested");

  const row = store.row(request.targetId);
  const prosePath = row?.prose_path ?? null;
  const versions = store.versions(request.targetId);

  // 4. DARK — the deny-list is live from this line onward (§16 G12).
  append("dark");

  const chased: string[] = [];
  const unchased: string[] = [...plan.unchasable];

  // 5. CHASE. Box 1 first: the prose and every archived version of it.
  if (prosePath !== null && existsSync(prosePath)) {
    try {
      rmSync(prosePath, { force: true });
      chased.push("prose");
    } catch {
      unchased.push("prose");
    }
  } else {
    chased.push("prose");
  }
  let versionsGone = 0;
  for (const version of versions) {
    try {
      if (existsSync(version.path)) rmSync(version.path, { force: true });
      versionsGone += 1;
    } catch {
      /* counted below */
    }
  }
  if (versionsGone === versions.length) chased.push("versions");
  else unchased.push("versions");
  try {
    rmSync(paths.versionsFor(store.dir, request.targetId), { recursive: true, force: true });
  } catch {
    /* an empty directory left behind is not a leak */
  }

  // Box 3: the rebuild skips every denied id and LOGS the skip, so the cache
  // comes back without the memory and with a record that it was left out.
  try {
    store.rebuildCache();
    chased.push("cache");
  } catch {
    unchased.push("cache");
  }

  append("chased");
  append("complete");
  emit("cli.removal.complete", {
    target: request.targetId,
    chased: chased.length,
    unchased: unchased.length,
    contamination: plan.contamination.length,
  });

  return { chased, unchased, notes };
}

/**
 * The read-back a removal is only trustworthy with: is the id dark, is its prose
 * gone, and does any canonical file still hold its text? Ids only in, verdict
 * out — no body ever crosses this boundary.
 */
export function verifyRemoval(store: Store, targetId: string): {
  denied: boolean;
  proseGone: boolean;
  rowSurvives: boolean;
} {
  const row = store.row(targetId);
  const prosePath = row?.prose_path ?? null;
  return {
    denied: store.deniedIds().includes(targetId),
    proseGone: prosePath === null || !existsSync(prosePath),
    rowSurvives: row !== undefined,
  };
}
