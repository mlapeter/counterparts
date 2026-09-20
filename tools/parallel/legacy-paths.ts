/**
 * The PRE-ROWS store's path rules, kept alive for the instruments that still
 * read one.
 *
 * These two functions were `src/core/store/paths.ts#resolveStoredPath` and
 * `#relativizeStoredPath` until the floor (schema v6, 2026-09-20) moved memory
 * bodies into rows and deleted every reason the core had to turn a column into
 * a filesystem address. `tools/parallel/readers.ts` still needs them: it reads
 * the owner's LIVE store with its own read-only handle, and until cut-over day
 * that store is v5 — 16,000 markdown files under `prose/`, addressed by a
 * `memories.prose_path` column this build's own schema no longer has.
 *
 * They live HERE rather than in `store/` on purpose. This whole directory is
 * scaffolding for the parallel run and is retired at step 6 of the rebuild;
 * leaving the placement rules in the core would have kept ~120 lines of the old
 * floor alive as live, tested, importable code — "carrying the code", which is
 * exactly what constitution line 14 says not to do. Nothing in `src/` imports
 * this file, and nothing should: a caller that needs it is reading an old store.
 *
 * Copied verbatim, comments and all, because their edge cases were paid for
 * four review rounds deep (finding I22, PR #79's review, `STORED_PATH_ESCAPES`)
 * and a reader on the owner's live store is exactly where they still have to be
 * right. The one change: the escape case returns `""` rather than throwing a
 * `StoreError` whose code no longer exists — this is an instrument, and an
 * unreadable row is a row it reports rather than a run it ends.
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { isWithin } from "../../src/core/store/paths.js";

/**
 * A stored path, made absolute against the store that holds the row.
 *
 * Four cases, each deliberate:
 *   - `""` → `""`. A chased row's pointers were blanked, and `join(dir, "")` is
 *     the STORE ROOT. A blank pointer resolves to nothing, never to a directory.
 *   - relative → `join(dir, stored)`. The v5 shape.
 *   - absolute → PLACED against the opened dir by the same rule the v5
 *     migration used (`relativizeStoredPath`; pure, no stat, no write), so an
 *     instrument on a pre-v5 copy, backup or moved store reads ITS OWN file
 *     rather than the source's — the review of PR #79 reproduced a v5 observer
 *     on a v4 copy reading the live store's prose and calling the copy's own
 *     files missing. Only an unplaceable row (no `prose/` or `versions/`
 *     segment to key on) is read as given.
 *   - anything that would resolve OUTSIDE `<dir>/prose/` or `<dir>/versions/` —
 *     `../ESCAPE/…`, `.`, `cache/cache.sqlite`, an absolute row whose tail is
 *     `prose/../../x` — resolves to `""` and is never returned as an address.
 *     No writer ever produced such a row; a hand-edited database can.
 */
export function resolveStoredPath(dir: string, storedPath: string): string {
  if (storedPath.length === 0) return "";
  if (isAbsolute(storedPath)) {
    const placed = relativizeStoredPath(dir, storedPath);
    if (placed === null || isAbsolute(placed)) return storedPath;
    return joinInsideStore(dir, placed);
  }
  return joinInsideStore(dir, storedPath);
}

function joinInsideStore(dir: string, rel: string): string {
  return isCanonicalRelativePath(dir, rel) ? join(dir, rel) : "";
}

/**
 * True when `rel`, joined onto `dir`, lands strictly under `<dir>/prose/` or
 * `<dir>/versions/` — the only two places a stored path may name. Resolved
 * before compared (scar §2.13), so `prose/../../x` and `./prose/x` are judged
 * by where they land, not by how they are spelled. Pure: no stat, no write.
 */
export function isCanonicalRelativePath(dir: string, rel: string): boolean {
  if (rel.length === 0 || isAbsolute(rel)) return false;
  const back = relative(resolve(dir), resolve(join(dir, rel)));
  if (back.length === 0 || back.startsWith("..") || isAbsolute(back)) return false;
  const posixBack = toPosix(back);
  return posixBack.startsWith("prose/") || posixBack.startsWith("versions/");
}

/**
 * The v4 → v5 conversion of ONE path: absolute in, store-relative POSIX out, or
 * `null` when the path cannot be placed.
 *
 * Two rules, in order. If the path lies under `dir` the relative part is exact.
 * Otherwise the DEEPEST `/prose/` or `/versions/` segment keys the tail — which
 * is what places a row whose store was written under one spelling and opened
 * under another (`/var/…` vs `/private/var/…` on macOS), or a backup restored
 * to a new directory with rows that still name the old one. The tail after the
 * store-level segment can never contain a second such segment: it is
 * `prose/<family>/<id>.md` or `versions/<id>/<seq>-<hash>.md`, and an id may
 * not contain a slash.
 *
 * A relative path is returned unchanged, so the conversion is idempotent by
 * construction and a second run finds nothing to do.
 */
export function relativizeStoredPath(dir: string, path: string): string | null {
  if (path.length === 0) return path;
  if (!isAbsolute(path)) return toPosix(path);
  if (isWithin(dir, path)) {
    const rel = relative(resolve(dir), resolve(path));
    if (rel.length > 0) return toPosix(rel);
  }
  const normalized = toPosix(path);
  let best = -1;
  for (const segment of ["/prose/", "/versions/"]) {
    const at = normalized.lastIndexOf(segment);
    if (at > best) best = at;
  }
  if (best === -1) return null;
  return normalized.slice(best + 1);
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
