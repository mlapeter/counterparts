/**
 * Where the data dir is, what lives in it, and which of it is backed up.
 *
 * `dataDir()` reads the environment AT CALL TIME (never at module load) so a test
 * can redirect it per test — the hermetic-test rule in CLAUDE.md depends on this.
 */
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
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

export const paths = {
  prose: (dir: string) => join(dir, "prose"),
  proseKind: (dir: string, type: string) => join(dir, "prose", PROSE_DIR[type] ?? type),
  proseFile: (dir: string, type: string, id: string) =>
    join(dir, "prose", PROSE_DIR[type] ?? type, `${id}.md`),
  versions: (dir: string) => join(dir, "versions"),
  versionsFor: (dir: string, id: string) => join(dir, "versions", id),
  versionFile: (dir: string, id: string, seq: number, hash: string) =>
    join(dir, "versions", id, `${String(seq).padStart(4, "0")}-${hash}.md`),
  tmp: (dir: string) => join(dir, "tmp"),
  operational: (dir: string) => join(dir, "operational.sqlite"),
  cacheDir: (dir: string) => join(dir, "cache"),
  cache: (dir: string) => join(dir, "cache", "cache.sqlite"),
} as const;
