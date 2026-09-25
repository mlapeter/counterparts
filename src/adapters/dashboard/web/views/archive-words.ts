/**
 * Why a memory was archived, in plain words — the one table the health tab's
 * archive bar, the memories list and the home count all read.
 *
 * `many` names a group ("old handoff notes cleared · 12"); `one` names a single
 * row on its card. A reason not in the table still gets words, from
 * `unmappedArchiveWords`, so nothing archived is ever left unsaid.
 */
import { TUNABLES as SCHEMA_TUNABLES } from "../../../../core/schemas/index.js";
import { MERGE_ARCHIVE_REASON, PRUNE_ARCHIVE_REASON } from "../../../../core/sleep/index.js";

/** `owner-op-seam.ts#REMOVED_REASON`, spelled here because that module is the
 *  store's WRITE seam and this directory imports no write seam. */
export const REMOVED_BY_OWNER = "removed-by-owner";

export interface ArchiveReasonWords {
  readonly reason: string;
  readonly many: string;
  readonly one: string;
}

/** EVERY `archived_reason` the code writes, in the order the health bar draws them. */
export const ARCHIVE_WORDS: readonly ArchiveReasonWords[] = [
  { reason: "handoff-cleared", many: "old handoff notes cleared", one: "old handoff note cleared" },
  { reason: "handoff-duplicate", many: "duplicate handoff notes retired", one: "a repeated handoff note, cleared" },
  { reason: SCHEMA_TUNABLES.REVISED_REASON, many: "revised", one: "revised — a newer version replaced it" },
  { reason: SCHEMA_TUNABLES.REPLACED_REASON, many: "replaced by a correction", one: "replaced by a correction" },
  { reason: "supersede", many: "replaced by a newer version", one: "replaced by a newer version" },
  { reason: "episode-regrown", many: "rebuilt from the journal", one: "regrown from its episode — a newer reading replaced it" },
  { reason: SCHEMA_TUNABLES.FADE_REASON, many: "faded from use", one: "faded away — nothing mentions it any more" },
  { reason: PRUNE_ARCHIVE_REASON, many: "let go at the floor", one: "let go at the floor — too weak for too long" },
  { reason: MERGE_ARCHIVE_REASON, many: "merged duplicates", one: "merged into a near-duplicate" },
  { reason: REMOVED_BY_OWNER, many: "removed by you", one: "removed by you" },
];

/** `[reason, many]` pairs, in the bar's order. */
export const ARCHIVE_PHRASES: readonly (readonly [string, string])[] = ARCHIVE_WORDS.map((w) => [w.reason, w.many] as const);

const BY_REASON = new Map(ARCHIVE_WORDS.map((w) => [w.reason, w]));

/** The table's entry for a reason, or undefined when the table has none. */
export function archiveEntry(reason: string | null): ArchiveReasonWords | undefined {
  return reason === null ? undefined : BY_REASON.get(reason);
}

/** The one fallback: a reason nobody mapped keeps its own name; no reason says so. */
export function unmappedArchiveWords(reason: string | null): string {
  return reason === null || reason.length === 0 ? "archived, no reason recorded" : `archived (${reason})`;
}

/** One archived row, in words, for its card or list line. */
export function archiveWords(reason: string | null, superseded: boolean): string {
  const entry = archiveEntry(reason);
  if (entry !== undefined) return entry.one;
  if (superseded) return "revised — a newer version replaced it";
  return unmappedArchiveWords(reason);
}
