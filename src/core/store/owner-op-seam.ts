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
 *   5. Copies are chased — the words and every box-2 row by `chaseRemoved`
 *      here, in ONE transaction, and box 3 by a rebuild — then `stage: "chased"`
 *      (appended inside that same transaction) and `stage: "complete"` follow.
 *      Every crash point leaves the memory either fully alive, or dark AND
 *      recorded (§16 G11). Since the floor (schema v6) the CLI has no files left
 *      to chase: the words ARE the columns this blanks, so the erase is one
 *      commit rather than a file walk that could be interrupted halfway.
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
export type OwnerOpSite = "chaseRemoved" | "unarchiveMerged";

export interface OwnerOpAccess {
  readonly dir: string;
  ownerMutate<T>(site: OwnerOpSite, fn: (db: Db) => T): T;
  rawRow(id: string): MemoryRow | undefined;
  isDenied(id: string): boolean;
  /**
   * Re-index ONE row's tokens from its own prose, leaving its embedding alone.
   * The seam's only route to box 3, and deliberately the lexical half only —
   * a restore must never make a paid embedding call and must never drop a
   * vector nothing here could recompute. See `store/index.ts`'s grant for why
   * a restore has to touch box 3 at all.
   */
  reindexLexical(id: string): void;
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
 * and THE WORDS THEMSELVES — the body, the title, the meta and the content hash,
 * on the memory row and on every one of its version rows. Before the floor
 * these were pointers at files the CLI deleted separately; the columns are the
 * content now, so blanking them IS the erase and it happens inside the same
 * transaction as the record.
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
    // every word they held. `reason`, `version_day` and `successor_id` are
    // lineage metadata the removal has no cause to destroy, so they are left
    // alone; `learned_on` and `happened_on` go with the content, because a date
    // a memory was learned on is a fact ABOUT the removed memory.
    db.run(
      `UPDATE versions
          SET title = NULL, body = '', meta = '{}', content_hash = '',
              learned_on = '', happened_on = NULL,
              created_at = NULL, model = NULL, event_date = NULL
        WHERE memory_id = ?`,
      id,
    );

    if (row !== undefined) {
      // The skeleton: an address, its family, and nothing else. Physics is
      // zeroed rather than kept — a removed memory is not a protected one, and
      // must not go on conducting, ranking or resisting anything.
      // THE TOMBSTONE SHAPE. `body = ''` AND `content_hash = ''` together are
      // what `rowTombstoned` reads, and both halves have to land: a blank body
      // beside a hash that still names words would read as a row whose words
      // went missing (`MEMORY_BODY_MISSING`) rather than as a removal, and
      // `Schemas.load`'s skip — the thing that keeps the next session starting
      // after a removal — is keyed on the pair.
      db.run(
        `UPDATE memories
            SET novelty = NULL, relevance = 0, emotional = 0, predictive = 0, claimed = NULL,
                uses = 0, reinforced_days = 0, consolidated = 0, promoted_identity = 0,
                protected = 0, pressure = 0, last_challenged_day = NULL,
                archived = 1, archived_reason = ?, content_hash = '',
                title = NULL, body = '', meta = '{}', confidential = 0,
                learned_on = '', happened_on = NULL,
                created_at = NULL, updated_at = NULL, model = NULL, event_date = NULL
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

// ── the repair ──────────────────────────────────────────────────────────────

/**
 * The archive reason `sleep/dedup.ts` writes when it merges a duplicate. It is
 * spelled here rather than imported because `store/` sits BELOW `sleep/` and
 * must not depend on it; `test/store.test.ts` pins the two spellings equal, so
 * a rename cannot silently make this door match nothing.
 */
export const MERGED_ARCHIVE_REASON = "merged";

/** The durable name a restore appends. Registered in the dashboard's vocabulary. */
export const UNMERGE_EVENT = "memory.unmerged";

/** What a restore did, in ids and counts. Never a body (§5 G10). */
export interface UnmergeRecord {
  readonly event: typeof UNMERGE_EVENT;
  readonly day: number;
  /** The row put back on its feet. */
  readonly candidateId: string;
  /** What it had been merged into, read from the durable merge record. Null
   *  when no merge event survives the retention window — the archive reason
   *  still says `merged`, and the restore is still the right answer. */
  readonly originalId: string | null;
  /** The lived day the merge was recorded on. */
  readonly mergedOnDay: number | null;
  /**
   * The use the merge credited to the original — and which this restore
   * deliberately LEAVES STANDING. Taking it back would rewrite a physics count
   * whose band may already have been materialized and whose crossing may
   * already be a durable row, in order to undo a single use. Recording the
   * number here is what makes the credit auditable without touching it.
   */
  readonly usesDelta: number | null;
}

export interface UnmergeReport {
  readonly id: string;
  readonly record: UnmergeRecord;
  /** True when the row was already live: a repeated repair changes nothing. */
  readonly noop: boolean;
}

/**
 * Put back a row the dedup pass archived as a duplicate — the repair half of
 * the finding in `sleep/NOTES.md` §12 (probe H).
 *
 * It lives on this seam, beside the chase, for the same structural reason:
 * holding a `Store` gives you no way to un-archive anything, and the
 * caller-universality test pins who may import this file at all. The store's
 * public surface has no general `unarchive`, and it must not grow one — a
 * pruned row, a revised predecessor and a removed row are all archived, and
 * each is archived for a reason a repair tool has no business reversing. This
 * door undoes exactly ONE reason and refuses every other by name.
 *
 * The refusals, in order: no capability; a removed id (the deny-list answers
 * before anything else); an unknown id; a row with a successor (restoring it
 * would put two live versions in one revision chain); an archive reason that
 * is not the merge's.
 *
 * **Box 3 is re-indexed, and the reason is a moving target.** On master as this
 * was written, `archive()` left box 3 alone — no deindex, no vector drop — so a
 * restore needed nothing. That stops being true the moment `archive()` starts
 * DEINDEXING, which PR #64 (`overnight/df-live-rows`) adds so document frequency
 * is counted over live rows; whichever of the two lands second would otherwise
 * leave this door restoring a row that is live, listed in `beliefs(entity)`, and
 * invisible to lexical recall. So the restore calls `access.reindexLexical`
 * unconditionally: on today's master that rewrites the same `doc_tokens` rows
 * the id already had, and after #64 it is the only thing standing between the
 * repair and a half-restored belief. The EMBEDDING is untouched in both worlds —
 * `indexDoc` writes a vector only when handed one, and it is not handed one —
 * because a repair that made a paid embedding call, or dropped a vector nothing
 * here can recompute, would be a worse bug than the one it is fixing.
 *
 * What the restore does NOT do is erase the merge: the `sleep.merged.<id>` meta record and the `memory.merged`
 * event both stay exactly where they are, and `memory.unmerged` is appended
 * beside them. Constitution 7: the history is the point, and a repair that
 * tidied away the evidence of the bug would be the same class of mistake as
 * the bug.
 */
export function unarchiveMerged(store: Store, id: string): UnmergeReport {
  const access = GRANTS.get(store);
  if (access === undefined) {
    throw new StoreError("OWNER_OP_UNGRANTED", { id, site: "unarchiveMerged" });
  }
  if (access.isDenied(id)) throw new StoreError("REMOVED", { id, by: "owner" });
  const row = access.rawRow(id);
  if (row === undefined) throw new StoreError("ID_UNKNOWN", { id });
  if (row.superseded_by !== null) {
    throw new StoreError("UNMERGE_SUPERSEDED", { id, successor: row.superseded_by });
  }
  if (row.archived === 1 && row.archived_reason !== MERGED_ARCHIVE_REASON) {
    throw new StoreError("UNMERGE_NOT_A_MERGE", { id, reason: row.archived_reason });
  }

  const report = access.ownerMutate("unarchiveMerged", (db) => {
    const noop = row.archived === 0;
    const merge = db.get<{ day: number; payload: string | null }>(
      `SELECT day, payload FROM events
        WHERE name = 'memory.merged' AND ref = ?
        ORDER BY seq DESC LIMIT 1`,
      id,
    );
    const payload = readMergePayload(merge?.payload ?? null);
    const record: UnmergeRecord = {
      event: UNMERGE_EVENT,
      day: store.livedDay(),
      candidateId: id,
      originalId: payload.originalId,
      mergedOnDay: merge?.day ?? null,
      usesDelta: payload.usesDelta,
    };
    // ALREADY LIVE: say so, and write NOTHING. A `memory.unmerged` row appended
    // here would read "the owner put this back" about a restore that never
    // happened — a durable lie in the one log the owner is asked to trust. The
    // CLI's own loop skips live rows, and that is not a substitute for this
    // door being honest by itself.
    if (noop) return { id, record, noop };

    db.run(
      "UPDATE memories SET archived = 0, archived_reason = NULL, updated_at = ? WHERE id = ?",
      store.now(),
      id,
    );
    // Recorded inside the same transaction, and latched on the id, so a second
    // `--apply` over the same store writes nothing at all (§5 G3).
    store.appendEvent({
      name: UNMERGE_EVENT,
      day: record.day,
      ref: id,
      dedupKey: `${UNMERGE_EVENT}:${id}`,
      payload: { ...record },
    });
    return { id, record, noop };
  });

  // Box 2 first, box 3 after the commit — the same order `Store.put`,
  // `revise` and `supersede` use (`index.ts`: `this.mutate(...)` then
  // `indexOne`). Box 3 is the rebuildable box; indexing inside box 2's
  // transaction would be the one write in the system that inverted that order,
  // and a re-index that ran and then rolled back would leave the index ahead of
  // the row rather than behind it.
  if (!report.noop) access.reindexLexical(id);
  return report;
}

/** Ids and numbers out of the merge record's JSON, or nulls. Never throws. */
function readMergePayload(raw: string | null): {
  originalId: string | null;
  usesDelta: number | null;
} {
  if (raw === null) return { originalId: null, usesDelta: null };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      originalId: typeof parsed["originalId"] === "string" ? parsed["originalId"] : null,
      usesDelta: typeof parsed["usesDelta"] === "number" ? parsed["usesDelta"] : null,
    };
  } catch {
    return { originalId: null, usesDelta: null };
  }
}
