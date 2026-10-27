/**
 * THE BASE DIRECTORY OF AN INSTALL, KEPT PRIVATE (2026-10-27, R1; moved out
 * of the core in the review of #657, narrowed in its re-checks).
 *
 * The core tightens only the store it opens (`core/store/private.ts`). The
 * directory around it holds the configuration and the files this package
 * writes beside it, and only an adapter can say which those are: here, from
 * the configuration this process loaded, which names `<that directory>/store`
 * as its store. A store dir that merely happens to be called `store` proves
 * nothing, and its parent is left alone.
 *
 * ONLY OUR NAMES, NEVER THE DIRECTORY'S OTHER ENTRIES: `install --config
 * ~/counterparts.json` makes `$HOME` the base, and a config in a project
 * directory makes the project the base. What is tightened is the list
 * `uninstall` reads too (`owned-names.ts#ownedKind`): the configuration and
 * its backups and temp siblings, `scopes.json`, the sidebar's files, the npm
 * marker, `store/` and `snapshots/` (or the configured snapshots dir, when it
 * sits here) with their parked, blank and new siblings, `rollback`'s
 * set-aside stores, and a `debug/` of night transcripts; plus a legacy
 * `credentials.env`. Directories go whole, symbolic links are skipped. In a
 * home or a project base a file of somebody else's that happens to carry one
 * of those names is tightened too; that is the one collision left, and the
 * names are specific enough that it should not happen.
 *
 * The directory ITSELF is made `0700` only when it holds nothing but ours and
 * is not the home directory or above it, not writable by others, not sticky,
 * and owned by this account: the default `~/.counterparts` is closed, a home
 * or a project never is.
 *
 * Run by the session-start hook and by `connect` (the upgrade path); best-
 * effort and silent, gated by a few stats, never on Windows. `doctor`'s
 * Privacy line reads the same set (`installBasePaths`).
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { DATABASE_FILE, DEFAULT_STORE_SUBDIR, isWithin, realRoot, rootsNeedTightening, tightenRoots } from "../core/store/index.js";
import type { Chmod, PrivateRoots, TightenReport } from "../core/store/index.js";
import { ownedKind, ownedNames } from "./owned-names.js";

export { SIDEBAR_NAMES } from "./owned-names.js";

/** The old credentials file's name (`cli/install.ts#LEGACY_CREDENTIALS_FILE`),
 *  spelled here so this leaf does not import the console. `uninstall` leaves
 *  it (a file the person may want), but it is ours to make private. */
const LEGACY_CREDENTIALS = "credentials.env";

export interface BasePaths {
  readonly base: string;
  /** The base directory itself, when it is ours to close (see the header). */
  readonly baseIsOurs: boolean;
  /** Our entries in it that are there: files alone, directories whole. */
  readonly files: readonly string[];
  readonly trees: readonly string[];
}

/** `snapshots.dir` from the configuration file; absent when it names none or
 *  cannot be read. */
function configuredSnapshots(configPath: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as { snapshots?: { dir?: unknown } };
    const dir = raw.snapshots?.dir;
    return typeof dir === "string" ? dir : undefined;
  } catch {
    return undefined;
  }
}

/** May the base directory itself be closed (beyond holding only ours)? Not the
 *  home or above it, not writable by others, not sticky, owned by this account. */
function closable(base: string, home: string): boolean {
  const h = resolve(home);
  const b = resolve(base);
  if (b === h || isWithin(b, h)) return false;
  try {
    const st = lstatSync(b);
    if ((st.mode & 0o002) !== 0 || (st.mode & 0o1000) !== 0) return false;
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    return uid === null || st.uid === uid;
  } catch {
    return false;
  }
}

/** Our paths in an install's base, or null when `storeDir` is not
 *  `<dirname(configPath)>/store` with that configuration in place. */
export function installBasePaths(configPath: string, storeDir: string, home: string = homedir()): BasePaths | null {
  if (!existsSync(configPath)) return null;
  const base = dirname(resolve(configPath));
  const store = join(base, DEFAULT_STORE_SUBDIR);
  if (realRoot(store) !== realRoot(storeDir)) return null;
  const snapshotsDir = configuredSnapshots(configPath);
  const owned = ownedNames(configPath, snapshotsDir === undefined ? {} : { snapshots: { dir: snapshotsDir } }, store);
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return null;
  }
  const files: string[] = [];
  const trees: string[] = [];
  let foreign = 0;
  for (const name of names) {
    if (ownedKind(name, owned, base) === null && name !== LEGACY_CREDENTIALS) {
      foreign += 1;
      continue;
    }
    const path = join(base, name);
    try {
      const st = lstatSync(path);
      if (st.isSymbolicLink()) continue;
      (st.isDirectory() ? trees : files).push(path);
    } catch {
      continue;
    }
  }
  return { base, baseIsOurs: foreign === 0 && closable(base, home), files, trees };
}

/** The same set as roots for `tightenRoots`; the store by its real path. */
export function installBaseRoots(configPath: string, storeDir: string, home: string = homedir()): PrivateRoots | null {
  const p = installBasePaths(configPath, storeDir, home);
  if (p === null) return null;
  const store = realRoot(join(p.base, DEFAULT_STORE_SUBDIR));
  return { only: [...(p.baseIsOurs ? [p.base] : []), ...p.files], recursive: [...p.trees.filter((t) => t !== join(p.base, DEFAULT_STORE_SUBDIR)), store] };
}

/** Tighten an install's base, when it is one. Null when there was nothing to do. */
export function tightenInstallBase(
  configPath: string,
  storeDir: string,
  opts: { chmod?: Chmod; platform?: string; home?: string } = {},
): TightenReport | null {
  try {
    if ((opts.platform ?? process.platform) === "win32") return null;
    const roots = installBaseRoots(configPath, storeDir, opts.home);
    if (roots === null || !rootsNeedTightening(roots, [join(realRoot(storeDir), DATABASE_FILE)])) return null;
    return tightenRoots(roots, opts.chmod);
  } catch {
    return null;
  }
}
