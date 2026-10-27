/**
 * THE BASE DIRECTORY OF AN INSTALL, KEPT PRIVATE (2026-10-27, R1; moved out
 * of the core in the review of #657, narrowed in its re-check).
 *
 * The core tightens only the store it opens (`core/store/private.ts`). The
 * directory around it holds the configuration and the files this package
 * writes beside it, and only an adapter can say which those are: here, from
 * the configuration this process loaded, which names `<that directory>/store`
 * as its store. A store dir that merely happens to be called `store` proves
 * nothing, and its parent is left alone.
 *
 * ONLY OUR NAMES, NEVER THE DIRECTORY'S OTHER ENTRIES (re-check of #657):
 * `install --config ~/counterparts.json` makes `$HOME` the base, and a config
 * in a project directory makes the project the base. So what is tightened is
 * the list of names this package writes there (`ownNames`): the configuration
 * itself, `scopes.json`, the sidebar's two files, the npm marker, a legacy
 * `credentials.env`, and `store/` and `snapshots/` whole. Everything else in
 * the directory keeps its mode. The directory ITSELF is made `0700` only when
 * it holds nothing but ours and is not the home directory or above it: the
 * default `~/.counterparts` is, a home or a project never is.
 *
 * Run by the session-start hook and by `connect` (the upgrade path); best-
 * effort and silent, gated by a few stats, never on Windows. `doctor`'s
 * Privacy line reads the same set (`installBasePaths`).
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { DATABASE_FILE, DEFAULT_STORE_SUBDIR, SNAPSHOTS_DIR_NAME, isWithin, realRoot, rootsNeedTightening, tightenRoots } from "../core/store/index.js";
import type { Chmod, PrivateRoots, TightenReport } from "../core/store/index.js";
import { NPM_LIVE_NAME } from "./npm-live.js";
import { SCOPES_FILE_NAME } from "./scopes.js";

/** The old credentials file's name (`cli/install.ts#LEGACY_CREDENTIALS_FILE`),
 *  spelled here so this leaf does not import the console. */
const LEGACY_CREDENTIALS = "credentials.env";
/** The sidebar's two files (`sidebar-status.ts#SIDEBAR_FILE_NAME`, `#PLUGIN_PRESENCE_NAME`),
 *  spelled here because that module pulls in the dashboard, which the hook
 *  must not load; `test/private-store.test.ts` holds the two spellings together. */
export const SIDEBAR_NAMES: readonly string[] = ["sidebar.json", "sidebar-plugin-here"];

/** Is this entry of the base one this package writes? Directories go whole. */
function ownName(name: string, configName: string): "file" | "tree" | null {
  if (name === DEFAULT_STORE_SUBDIR || name === SNAPSHOTS_DIR_NAME) return "tree";
  if (name === configName || name === SCOPES_FILE_NAME || SIDEBAR_NAMES.includes(name)) return "file";
  if (name === LEGACY_CREDENTIALS || NPM_LIVE_NAME.test(name)) return "file";
  return null;
}

export interface BasePaths {
  readonly base: string;
  /** The base directory itself, when it is ours to close (see the header). */
  readonly baseIsOurs: boolean;
  /** Our entries in it that are there: files alone, directories whole. */
  readonly files: readonly string[];
  readonly trees: readonly string[];
}

/** Our paths in an install's base, or null when `storeDir` is not
 *  `<dirname(configPath)>/store` with that configuration in place. */
export function installBasePaths(configPath: string, storeDir: string, home: string = homedir()): BasePaths | null {
  if (!existsSync(configPath)) return null;
  const base = dirname(resolve(configPath));
  if (realRoot(join(base, DEFAULT_STORE_SUBDIR)) !== realRoot(storeDir)) return null;
  const configName = basename(resolve(configPath));
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
    const kind = ownName(name, configName);
    if (kind === "file") files.push(join(base, name));
    else if (kind === "tree") trees.push(join(base, name));
    else foreign += 1;
  }
  const h = resolve(home);
  const homeOrAbove = resolve(base) === h || isWithin(resolve(base), h);
  return { base, baseIsOurs: foreign === 0 && !homeOrAbove, files, trees };
}

/** The same set as roots for `tightenRoots`. */
export function installBaseRoots(configPath: string, storeDir: string, home: string = homedir()): PrivateRoots | null {
  const p = installBasePaths(configPath, storeDir, home);
  if (p === null) return null;
  return { only: [...(p.baseIsOurs ? [p.base] : []), ...p.files], recursive: p.trees.map((t) => (basename(t) === DEFAULT_STORE_SUBDIR ? realRoot(t) : t)) };
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
