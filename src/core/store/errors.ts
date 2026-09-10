/**
 * One error type for the whole store, carrying a stable machine-readable code.
 *
 * Why a code and not a message: contract §5 G10 — telemetry is content-by-reference,
 * "error messages included". A code plus ids/counts can be logged; a message that
 * quotes prose cannot. Callers (and tests) assert the reason, never the prose.
 */
export type StoreErrorCode =
  | "OBSERVER_REFUSED"
  | "DATA_DIR_FORBIDDEN"
  /**
   * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` is set and nothing named a data dir —
   * no `dir`, no `COUNTERPARTS_DATA_DIR` — so `dataDir()` refused to hand back
   * `~/.counterparts/store` (`paths.ts`). `detail` carries `{ guard, dir, remedy }`:
   * the variable that refused, the directory it would have opened, and how to
   * name one. On the owner's machine that directory is his live memory, and on
   * 2026-09-05 a caller reached it by passing the wrong option name.
   */
  | "IMPLICIT_DEFAULT_DIR_REFUSED"
  /**
   * `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` holds a value the guard will not guess
   * at — not blank, not one of `EXPLICIT_DIR_ARMING_VALUES`. Thrown at the
   * guard's decision point instead of falling open: the #80 review measured
   * `=true`, `=yes`, `=on` and `= 1` all silently resolving the default, which
   * is the one failure direction a safety guard may not have. `detail` carries
   * `{ guard, value, accepted }`.
   */
  | "EXPLICIT_DIR_GUARD_MALFORMED"
  | "PROSE_FRONTMATTER_MISSING"
  | "PROSE_PAYLOAD_MISSING"
  | "PROSE_PAYLOAD_MALFORMED"
  | "PROSE_PAYLOAD_MISMATCH"
  | "PROSE_BODY_INVALID"
  | "PROSE_META_UNSERIALIZABLE"
  | "PROSE_FILE_MISSING"
  | "ID_MALFORMED"
  | "ID_UNKNOWN"
  | "ID_CYCLE"
  | "ID_CHAIN_TOO_DEEP"
  | "ID_DANGLING"
  | "ID_TAKEN"
  | "ARCHIVE_COLLISION"
  /**
   * The owner removed this id. The deny-list answering before the prose does —
   * a NAMED refusal, never the ENOENT of a chased file (§16 G12).
   * `detail` carries `{ id, by: "owner" }`: the code is the wire shape every
   * consumer switches on, the actor is the story it tells.
   */
  | "REMOVED"
  /** A chase was attempted on an id no removal record has taken dark (§16 G10). */
  | "REMOVAL_NOT_DARK"
  /** The owner-op capability was never granted for this store. */
  | "OWNER_OP_UNGRANTED"
  /**
   * A restore was attempted on a row the dedup pass did not archive. The
   * un-archive door exists to undo ONE thing — `archived_reason: "merged"` —
   * and a door that also un-archives prunes, revisions and removals would be
   * the general resurrection verb the store deliberately does not have.
   */
  | "UNMERGE_NOT_A_MERGE"
  /**
   * The row has a successor. Restoring it would put two live versions in one
   * revision chain, which is the state `resolve` exists to make impossible.
   */
  | "UNMERGE_SUPERSEDED"
  | "VERSION_UNKNOWN"
  | "CLOCK_BACKWARDS"
  /** An instrument opened a store that does not exist yet, or is a schema behind:
   *  initializing it would be writing at open, which an observer may not do. */
  | "STORE_UNINITIALIZED"
  /** A store written by a NEWER build: refused rather than stamped backwards. */
  | "SCHEMA_AHEAD"
  /**
   * A stored path that, resolved against the opened store, would land outside
   * its `prose/` or `versions/` root — `../ESCAPE/…`, a bare `.`, `cache/…`.
   * Only a hand-edited database can hold one; it is never resolved (§5 G15).
   */
  | "STORED_PATH_ESCAPES"
  | "SQLITE_UNAVAILABLE"
  | "LAYOUT_UNCLASSIFIED";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  /** Ids / counts only. Never body text (contract §5 G10). */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: StoreErrorCode,
    detail: Record<string, string | number | boolean | null> = {},
  ) {
    super(`${code} ${JSON.stringify(detail)}`);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}

export function isStoreError(e: unknown, code?: StoreErrorCode): e is StoreError {
  return e instanceof StoreError && (code === undefined || e.code === code);
}
