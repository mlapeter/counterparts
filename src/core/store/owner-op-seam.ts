/**
 * The owner-removal seam — the ONE place in `store/` that destroys anything.
 *
 * The store's public surface still exports no delete, no unlink, no rm, and no
 * method that removes a memory (§5 G2, §16 G1 — "enforced by absence"). What
 * changed on 2026-08-25 is that the chase's box-2 half now EXISTS, because
 * "anything can be removed loudly" was only half-true while the `memories`,
 * `edges` and `prospective` rows survived a removal as reported-but-dark state
 * (BUILD-STATUS gap 3, cli/INTERFACE-GAPS §1).
 *
 * It lives in this file rather than on `Store` so that the enforcement stays
 * structural: `Store` hands this module a capability at construction time (a
 * WeakMap the rest of the program cannot see), and the caller-universality test
 * in `test/cli.test.ts` pins who may import this file at all. Nothing reaches
 * `chaseRemoved` by having a `Store`; you have to import the destruction path
 * on purpose, from the one directory allowed to.
 *
 * How the pieces fit with `adapters/cli/`, which owns the other half:
 *
 *   1. The CLI (an owner-only, non-model-reachable path) implements
 *      `OwnerRemovalPort`. It is the ONLY implementor.
 *   2. Before anything moves, the CLI calls `Store.appendRemovalRecord({stage:
 *      "requested"})`. A failed append is never reported as success — if the record
 *      cannot be written, nothing moves (§16 G10).
 *   3. Everything that must READ the doomed content happens before any copy is
 *      chased (§16 G13): the contamination scan returns ids only.
 *   4. Then `stage: "dark"` is appended. From that moment the store's deny-list
 *      refuses to load the id, at read and at rebuild — a restored backup or a
 *      stray copy cannot quietly resurrect it, and the stray is skipped and
 *      logged, never deleted (§16 G12).
 *   5. Copies are chased — prose and version FILES by the CLI, box-2 rows by
 *      `chaseRemoved` here, box 3 by a rebuild — and `stage: "chased"` (appended
 *      inside this module's own transaction) then `stage: "complete"` follow.
 *      Every crash point leaves the memory either fully alive, or dark AND
 *      recorded (§16 G11).
 *
 * Note kept from inside v1's released ceremony (contract §4): the cooling-off
 * period was deliberately WALL-CLOCK, not active days — a week of not using the
 * machine must still be a week of second thoughts.
 */
import { StoreError } from "./errors.js";
import type { Db } from "./db.js";
import type { MemoryRow } from "./operational.js";
import type { RemovalNote, Store } from "./index.js";

export interface OwnerRemovalRequest {
  /** Memory-bearing roots only. The archive, backups, the graph, and the removal
   *  record itself are never nameable targets — they are chased as copies (§16 G16). */
  targetId: string;
  actor: "owner";
  reason: string;
  /** Wall-clock ms, not lived days. */
  requestedAt: number;
}

export interface OwnerRemovalOutcome {
  /** Ids only — printing matches would re-leak what is being erased (§16 G15). */
  chased: string[];
  unchased: string[];
  /**
   * Surfaces the removal deliberately does NOT take, in their own words. A
   * third category on purpose: `unchased` means "could not", and reporting a
   * conversation turn the removal is leaving on principle as a failure is a
   * different lie from the silence §16 G15 forbids, not a smaller one.
   */
  leftAlone: string[];
  notes: RemovalNote[];
}

export interface OwnerRemovalPort {
  (request: OwnerRemovalRequest): OwnerRemovalOutcome;
}

// ── the capability ──────────────────────────────────────────────────────────

/**
 * What a `Store` hands this module, and nothing else: a guarded transaction
 * runner and the two reads the chase needs.
 *
 * `ownerMutate` is the store's own seam, not a naked database handle — an
 * instrument that has stood down must refuse to destroy a memory exactly as it
 * refuses to write one (observer-mode G3), and a chase that took the database
 * directly would be the one write in the system that skipped the stance check.
 */
export type OwnerOpSite = "chaseRemoved";

export interface OwnerOpAccess {
  readonly dir: string;
  ownerMutate<T>(site: OwnerOpSite, fn: (db: Db) => T): T;
  rawRow(id: string): MemoryRow | undefined;
  isDenied(id: string): boolean;
}

const GRANTS = new WeakMap<object, OwnerOpAccess>();

/**
 * Called once, by `Store`'s constructor. Holding a `Store` does not give you
 * the capability; importing THIS file does, and that import is what the
 * caller-universality test pins (§16 G2).
 */
export function grantOwnerOps(store: object, access: OwnerOpAccess): void {
  GRANTS.set(store, access);
}

// ── the chase ───────────────────────────────────────────────────────────────

/** What the chase touched, by surface. Counts and verdicts — never contents. */
export interface ChaseReport {
  readonly id: string;
  /** Surfaces whose rows are GONE. */
  readonly removed: { surface: string; count: number }[];
  /** Surfaces stripped to a skeleton and kept, because a survivor points at them. */
  readonly neutralized: { surface: string; count: number }[];
  /** Surfaces this chase deliberately leaves whole, named so the list is honest. */
  readonly survives: string[];
  /** True when the chase found nothing left to do (a replayed or repeated chase). */
  readonly noop: boolean;
}

/** The archived-reason a neutralized row carries, so raw SQL reads honestly too. */
export const REMOVED_REASON = "removed-by-owner";

/**
 * Remove one memory's box-2 state, in ONE transaction, and append the `chased`
 * stage inside it — so the record and the removal land together or not at all.
 *
 * What DIES: the edges touching it (in both directions — an erased id left in
 * the learned graph keeps CONDUCTING activation between its former neighbours,
 * §16 G14), its prospective windows, the per-session gate rows that name it,
 * and every content pointer it had (prose path, content hash, and the same pair
 * on each of its version rows, whose files the CLI has already chased).
 *
 * What SURVIVES, on purpose:
 *   - the removal record (canonical, append-only) and therefore the deny-list;
 *   - a `removal_tombstone` row: what the memory WAS, in flags and counts, so a
 *     removed protected element still appears in the permanent enumeration as
 *     `[removed]` rather than vanishing (scar §2.19 from the other side);
 *   - the memory's own row and its version rows, STRIPPED — because box 2's
 *     foreign keys make them the lineage: a survivor whose `superseded_by` or
 *     `successor_id` names this id must resolve to a named removal, never to a
 *     dangling pointer. `Store.resolve` stops at a denied id and `Store.read`
 *     refuses it by name, so the skeleton reads as `[removed by the owner]`
 *     everywhere an id is rendered, and as nothing at all anywhere else.
 *
 * It refuses outright unless the id is already dark: a chase without a record
 * is the one outcome worse than a chase that did not happen (§16 G10).
 */
export function chaseRemoved(store: Store, id: string): ChaseReport {
  const access = GRANTS.get(store);
  if (access === undefined) {
    throw new StoreError("OWNER_OP_UNGRANTED", { id, site: "chaseRemoved" });
  }
  if (!access.isDenied(id)) {
    // Not "unknown id": the id may well exist. The refusal is about ORDER —
    // the record comes first, always.
    throw new StoreError("REMOVAL_NOT_DARK", { id, site: "chaseRemoved" });
  }

  return access.ownerMutate("chaseRemoved", (db) => {
    const row = access.rawRow(id);
    const already = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM removal_tombstone WHERE memory_id = ?",
      id,
    );
    const noop = (already?.n ?? 0) > 0;

    const edges =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM edges WHERE src = ? OR dst = ?", id, id)?.n ??
      0;
    const prospective =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM prospective WHERE memory_id = ?", id)?.n ?? 0;
    const gateRows =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM gate_session WHERE ref = ?", id)?.n ?? 0;
    const versions =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM versions WHERE memory_id = ?", id)?.n ?? 0;

    // Rows that carry nothing anyone else points at: they simply go.
    db.run("DELETE FROM edges WHERE src = ? OR dst = ?", id, id);
    db.run("DELETE FROM prospective WHERE memory_id = ?", id);
    db.run("DELETE FROM gate_session WHERE ref = ?", id);

    // Version rows stay (a successor's predecessor pointer lives here) and lose
    // both content pointers. `reason` is lineage metadata — "supersede",
    // "revise" — that the removal has no cause to destroy, so it is left alone.
    db.run("UPDATE versions SET path = '', content_hash = '' WHERE memory_id = ?", id);

    if (row !== undefined) {
      // The skeleton: an address, its family, and nothing else. Physics is
      // zeroed rather than kept — a removed memory is not a protected one, and
      // must not go on conducting, ranking or resisting anything.
      db.run(
        `UPDATE memories
            SET novelty = NULL, relevance = 0, emotional = 0, predictive = 0, claimed = NULL,
                uses = 0, reinforced_days = 0, consolidated = 0, promoted_identity = 0,
                protected = 0, pressure = 0, last_challenged_day = NULL,
                archived = 1, archived_reason = ?, content_hash = '', prose_path = '',
                learned_on = '', happened_on = NULL
          WHERE id = ?`,
        REMOVED_REASON,
        id,
      );
      if (!noop) {
        db.run(
          `INSERT INTO removal_tombstone
             (memory_id, type, kind, band, protected, promoted_identity, superseded_by,
              versions, edges, prospective, gate_rows, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          row.type,
          row.kind,
          row.band,
          row.protected,
          row.promoted_identity,
          row.superseded_by,
          versions,
          edges,
          prospective,
          gateRows,
          Date.now(),
        );
      }
    }

    const note: RemovalNote = { memoryId: id, stage: "chased", actor: "owner" };
    store.appendRemovalRecord(note);

    return {
      id,
      removed: [
        { surface: "operational.edges", count: edges },
        { surface: "operational.prospective", count: prospective },
        { surface: "operational.gate_session", count: gateRows },
      ],
      neutralized: [
        { surface: "operational.memories", count: row === undefined ? 0 : 1 },
        { surface: "operational.versions", count: versions },
      ],
      survives: ["removal_record", "deny-list", "removal_tombstone"],
      noop,
    };
  });
}
