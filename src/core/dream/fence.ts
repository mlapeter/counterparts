/**
 * WHAT THE NIGHT MAY NOT READ (2026-10-30, round 2 of the day-summary fix). The
 * night's children — day's end, the dream, the reflection, the tagging — read
 * the store whole, whatever folder wrote a row, and what they write is what
 * every session then reads: the page, a summary, a merge filed under the
 * folder the night ran in. So a folder that does not export (`off`, `paused`,
 * `observer`, and anything under one) is closed to them, by the rule the host's
 * `foldersOn` answers: a row whose folder it says no to is not shown to a night
 * and cannot go into a merge or a gist.
 *
 * Which folder a row counts as: a memory's own (`memoryFolder`: its chapter's,
 * for a chapter's summary); an episode's; and a night's own row (a merge, a
 * gist, a reflection's entry), filed under wherever the night ran, by its
 * originals', so a merge made from a closed row is closed too.
 *
 * Where it can't tell, it reads the row as open, the other way from the wake's
 * gate (`Counterpart#daySummaryShown`, which fails closed): a row with no folder
 * recorded, or a night row whose originals are gone, has no folder to refuse,
 * and hiding every such row would blind the night to its older memories. A
 * setting file that will not read closes every folder (`foldersOn`).
 *
 * This decides reading and writing from now on. It changes no row: what is in
 * the store stays there, and an ordinary session's recall does not come here.
 */
import { MERGE_DEPTH } from "../self/writer.js";
import type { Store } from "../store/index.js";

/** The host's word on one folder (`adapters/scopes.ts#foldersOn`). */
export type FolderOn = (scope: string) => boolean;

/** Nothing closed: a host with no folder setting. */
export const NOTHING_CLOSED: ReadonlySet<string> = new Set<string>();

type FolderRow = { type: string; origin_scope: string | null; origin_ref: string | null };

/**
 * A ROW THE NIGHTLY RUN WROTE — a dream's merge or gist, a reflection's entry —
 * told by origin (`dream:` / `reflection:`, which catches a merge, whose
 * `source` is its best source's) or by source, as the store's `NIGHTLY_SQL`
 * tells it. Filed under the folder the night ran in, whatever folders its words
 * came from.
 */
export function isNightRow(row: { source: string | null; origin_ref: string | null }): boolean {
  const ref = row.origin_ref ?? "";
  return row.source === "dreamed" || row.source === "reflection" || ref.startsWith("dream:") || ref.startsWith("reflection:");
}

/**
 * THE FOLDER A MEMORY WAS WRITTEN IN (2026-10-25, Y1): its own `origin_scope`;
 * else, for a memory written from a chapter (its `origin_ref` an episode's id),
 * that chapter's. Chapter-written memories were born with no folder until Y1,
 * while the chapter itself always recorded one, so this reads the rows already
 * written without a migration. Null when neither says. Never throws.
 */
export function memoryFolder(store: Pick<Store, "row">, row: FolderRow): string | null {
  if (row.origin_scope !== null && row.origin_scope.trim().length > 0) return row.origin_scope;
  const ref = row.origin_ref ?? "";
  if (row.type !== "memory" || !ref.startsWith("epi_")) return null;
  try {
    const chapter = store.row(ref);
    if (chapter === undefined || chapter.type !== "episode") return null;
    return chapter.origin_scope !== null && chapter.origin_scope.trim().length > 0 ? chapter.origin_scope : null;
  } catch {
    return null;
  }
}

/** Does this night row rest on a closed row, following night rows among its originals? An original that is gone says nothing. */
function restsOnClosed(store: Pick<Store, "row">, meta: string, shut: (scope: string | null) => boolean, depth: number): boolean {
  if (depth >= MERGE_DEPTH) return false;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(meta) as Record<string, unknown>;
  } catch {
    return false;
  }
  for (const key of ["mergedFrom", "sources", "cites"]) {
    const ids = parsed[key];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0) continue;
      const orig = store.row(id);
      if (orig === undefined) continue;
      if (orig.type === "episode" ? shut(orig.origin_scope) : orig.type === "memory" && (isNightRow(orig) ? restsOnClosed(store, orig.meta, shut, depth + 1) : shut(memoryFolder(store, orig)))) return true;
    }
  }
  return false;
}

/**
 * DOES THIS TEXT NAME A CLOSED ROW, by id or title? For the published wake a
 * dream is handed: it was composed for no reader, so its Yesterday line and its
 * lists may name any folder's. Never throws.
 */
export function namesClosed(store: Pick<Store, "row">, text: string, closed: ReadonlySet<string>): boolean {
  for (const id of closed) {
    if (text.includes(id)) return true;
    try {
      const title = store.row(id)?.title ?? null;
      if (title !== null && title.trim().length > 0 && text.includes(title)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * EVERY MEMORY AND CHAPTER CLOSED TO THE NIGHT under `on`, archived and merged
 * rows included. A walk of the store, so one read per night call, never per
 * turn: only the night's doors ask. Never throws row by row.
 */
export function closedToNight(store: Store, on: FolderOn): ReadonlySet<string> {
  const shut = (scope: string | null): boolean => {
    if (scope === null || scope.trim().length === 0) return false;
    try {
      return on(scope) !== true;
    } catch {
      return true;
    }
  };
  const closed = new Set<string>();
  for (const type of ["memory", "episode"] as const) {
    for (const id of store.list({ type })) {
      try {
        const row = store.row(id);
        if (row === undefined) continue;
        const isClosed = type === "episode" ? shut(row.origin_scope) : isNightRow(row) ? restsOnClosed(store, row.meta, shut, 0) : shut(memoryFolder(store, row));
        if (isClosed) closed.add(id);
      } catch {
        continue;
      }
    }
  }
  return closed;
}
