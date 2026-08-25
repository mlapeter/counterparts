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
  | "REMOVED"
  | "VERSION_UNKNOWN"
  | "CLOCK_BACKWARDS"
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
