/**
 * Where the data dir is, what lives in it, and which of it is backed up.
 *
 * `dataDir()` reads the environment AT CALL TIME (never at module load) so a test
 * can redirect it per test — the hermetic-test rule in CLAUDE.md depends on this.
 */
import { homedir } from "node:os";
import { join, posix, resolve, relative, isAbsolute, sep } from "node:path";
import { StoreError } from "./errors.js";

export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
export const DEFAULT_DATA_DIR_NAME = ".counterparts";
/**
 * The STORE sits one level below the base dir. The base dir belongs to the host
 * adapters (configuration, credentials); the store classifies every top-level
 * entry it holds and refuses an unclassified one at open (§5 G11), so a store
 * that IS the base dir cannot open once a host has written its config there.
 * Ruled by the owner 2026-09-04 after the launch inventory reproduced it.
 */
export const DEFAULT_STORE_SUBDIR = "store";

/**
 * Roots this repo may never write into: v1's live memory and its ancestor.
 * (CLAUDE.md "never touch the live stores"; scar §2.13 — a path guard resolves
 * both sides before it compares, so `~/.bansai/../.bansai/x` is caught too.)
 */
export const FORBIDDEN_ROOT_NAMES = [".bansai", ".claude-engram"] as const;

export function forbiddenRoots(): string[] {
  const home = homedir();
  return FORBIDDEN_ROOT_NAMES.map((n) => resolve(join(home, n)));
}

/** True when `child` is `parent` or lives underneath it. Both sides resolved first. */
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Throws rather than returning a path that points at a live v1 store. */
export function assertSafeDataDir(dir: string): string {
  const resolved = resolve(dir);
  for (const root of forbiddenRoots()) {
    if (isWithin(root, resolved)) {
      throw new StoreError("DATA_DIR_FORBIDDEN", { root });
    }
  }
  return resolved;
}

/**
 * The data directory for THIS call. Resolution order:
 *   1. `COUNTERPARTS_DATA_DIR` (read now, not at import)
 *   2. `~/.counterparts/store` (the base dir minus its host-adapter files)
 */
export function dataDir(): string {
  const fromEnv = process.env[DATA_DIR_ENV];
  const raw =
    fromEnv && fromEnv.trim().length > 0
      ? fromEnv
      : join(homedir(), DEFAULT_DATA_DIR_NAME, DEFAULT_STORE_SUBDIR);
  return assertSafeDataDir(raw);
}

/**
 * Contract §5 G11: every top-level path in the data directory is classified —
 * in the backup set, or on an explicit exclusion list. A new directory that is
 * not listed here fails `layout.test`'s totality assertion.
 *
 * `match: "prefix"` covers SQLite's journal sidecars (`-journal`, `-wal`, `-shm`)
 * without leaving them unclassified.
 */
export interface LayoutEntry {
  readonly name: string;
  readonly match: "exact" | "prefix";
  readonly backup: boolean;
  readonly why: string;
}

export const LAYOUT: readonly LayoutEntry[] = [
  {
    name: "prose",
    match: "exact",
    backup: true,
    why: "Box 1 — canonical prose. The memories themselves.",
  },
  {
    name: "versions",
    match: "exact",
    backup: true,
    why: "Archived prior versions of canonical prose (archive-on-overwrite).",
  },
  {
    name: "operational.sqlite",
    match: "prefix",
    backup: true,
    why: "Box 2 — canonical operational state. Backed up as a database, not rebuilt.",
  },
  {
    name: "cache",
    match: "exact",
    backup: false,
    why: "Box 3 — rebuildable embeddings/FTS. Never backed up; its loss is a re-index.",
  },
  {
    name: "spans",
    match: "exact",
    backup: true,
    why: "remember/'s capture buffer: lived experience awaiting encoding; not reconstructible.",
  },
  {
    name: "tmp",
    match: "exact",
    backup: false,
    why: "Staging for atomic writes. Crash-leaked temps are inert: the loader reads *.md under prose/ only.",
  },
  {
    name: "sessions",
    match: "exact",
    backup: false,
    why: "adapters/sessions.ts — the live-session registry a host's hooks leave for its tools. Host state, not memory: no content, and its loss costs a lazy bind, never a memory.",
  },
];

export function classifyTopLevel(name: string): LayoutEntry | undefined {
  return LAYOUT.find((e) =>
    e.match === "exact" ? e.name === name : name.startsWith(e.name),
  );
}

/** Throws on the first unclassified top-level entry (contract §5 G11). */
export function assertLayoutClassified(names: readonly string[]): void {
  for (const name of names) {
    if (!classifyTopLevel(name)) {
      throw new StoreError("LAYOUT_UNCLASSIFIED", { name });
    }
  }
}

/** Directory name per prose family. Spelled out — "memorys" is not a word. */
export const PROSE_DIR: Record<string, string> = {
  memory: "memories",
  episode: "episodes",
  schema: "schemas",
};

/**
 * The two stored spellings of a canonical file, RELATIVE to the store root and
 * POSIX-separated whatever the host: `prose/<family>/<id>.md` and
 * `versions/<id>/<seq>-<hash>.md`. These are what `memories.prose_path` and
 * `versions.path` hold (CONTRACT §5 G14, 2026-09-05); the absolute forms below
 * are `join(dir, …)` of exactly these, so there is one spelling of each.
 *
 * A store directory is SELF-CONTAINED: copy it, move it, restore it from a
 * backup — the rows inside still name the files beside them, never the files
 * of the store they were copied from (finding I22: an absolute path made a
 * copied store read and DELETE the source's prose).
 */
export const stored = {
  proseFile: (type: string, id: string): string =>
    posix.join("prose", PROSE_DIR[type] ?? type, `${id}.md`),
  versionFile: (id: string, seq: number, hash: string): string =>
    posix.join("versions", id, `${String(seq).padStart(4, "0")}-${hash}.md`),
} as const;

export const paths = {
  prose: (dir: string) => join(dir, "prose"),
  proseKind: (dir: string, type: string) => join(dir, "prose", PROSE_DIR[type] ?? type),
  proseFile: (dir: string, type: string, id: string) => join(dir, stored.proseFile(type, id)),
  versions: (dir: string) => join(dir, "versions"),
  versionsFor: (dir: string, id: string) => join(dir, "versions", id),
  versionFile: (dir: string, id: string, seq: number, hash: string) =>
    join(dir, stored.versionFile(id, seq, hash)),
  tmp: (dir: string) => join(dir, "tmp"),
  operational: (dir: string) => join(dir, "operational.sqlite"),
  cacheDir: (dir: string) => join(dir, "cache"),
  cache: (dir: string) => join(dir, "cache", "cache.sqlite"),
} as const;

/**
 * A stored path, made absolute against the store that holds the row — the ONE
 * way a stored value becomes a filesystem address (CONTRACT §5 G14).
 *
 * Four cases, each deliberate:
 *   - `""` → `""`. A chased row's pointers are blanked (`owner-op-seam.ts`), and
 *     `join(dir, "")` is the STORE ROOT — handed to the removal path's
 *     `existsSync` + `rmSync`, that would be the one address worse than the
 *     source's file. A blank pointer resolves to nothing, never to a directory.
 *   - relative → `join(dir, stored)`. The v5 shape.
 *   - absolute → PLACED against the opened dir by the same rule the migration
 *     uses (`relativizeStoredPath`; pure, no stat, no write), so an INSTRUMENT
 *     on a pre-v5 copy, backup or moved store reads ITS OWN file rather than the
 *     source's — the review of PR #79 reproduced a v5 observer on a v4 copy
 *     reading the live store's prose and calling the copy's own files missing.
 *     Only an unplaceable row (no `prose/` or `versions/` segment to key on) is
 *     read as given; `verify` counts those as "absolute (unplaceable)".
 *   - anything that would resolve OUTSIDE `<dir>/prose/` or `<dir>/versions/` —
 *     `../ESCAPE/…`, `.`, `cache/cache.sqlite`, an absolute row whose tail is
 *     `prose/../../x` — is refused with `STORED_PATH_ESCAPES` and never returned.
 *     No writer in this module produces such a row; a hand-edited database can.
 *     The guard runs AFTER the join, on both branches, so the two rules compose.
 */
export function resolveStoredPath(dir: string, storedPath: string): string {
  if (storedPath.length === 0) return "";
  if (isAbsolute(storedPath)) {
    const placed = relativizeStoredPath(dir, storedPath);
    if (placed === null || isAbsolute(placed)) return storedPath;
    return joinInsideStore(dir, placed, storedPath);
  }
  return joinInsideStore(dir, storedPath, storedPath);
}

function joinInsideStore(dir: string, rel: string, original: string): string {
  if (!isCanonicalRelativePath(dir, rel)) {
    throw new StoreError("STORED_PATH_ESCAPES", { path: original });
  }
  return join(dir, rel);
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
 * not contain a slash (`serializeProse` refuses one).
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
