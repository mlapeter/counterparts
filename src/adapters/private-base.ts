/**
 * THE BASE DIRECTORY OF AN INSTALL, KEPT PRIVATE (2026-10-27, R1; moved out
 * of the core in the review of #657).
 *
 * The core tightens only the store it opens (`core/store/private.ts`). The
 * directory around it, `~/.counterparts` with the configuration, credentials,
 * snapshots and log, is this package's layout, and only an adapter can say a
 * directory IS that layout: here, because the configuration this process
 * loaded sits in it and names `<that directory>/store` as its store. A store
 * dir that merely happens to be called `store` proves nothing, and its parent
 * is left alone.
 *
 * Run by the session-start hook and by `connect` (the upgrade path). The
 * base and its immediate entries lose their group and other bits, and
 * `snapshots/` and `log/` whole; best-effort and silent, gated by a few
 * stats, never on Windows.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEFAULT_STORE_SUBDIR, SNAPSHOTS_DIR_NAME, realRoot, rootsNeedTightening, tightenRoots } from "../core/store/index.js";
import type { Chmod, PrivateRoots, TightenReport } from "../core/store/index.js";

/** The base's roots, or null when `storeDir` is not `<dirname(configPath)>/store`. */
export function installBaseRoots(configPath: string, storeDir: string): PrivateRoots | null {
  if (!existsSync(configPath)) return null;
  const base = dirname(resolve(configPath));
  if (realRoot(join(base, DEFAULT_STORE_SUBDIR)) !== realRoot(storeDir)) return null;
  return { topOnly: [base], recursive: [join(base, SNAPSHOTS_DIR_NAME), join(base, "log")] };
}

/** Tighten an install's base, when it is one. Null when there was nothing to do. */
export function tightenInstallBase(
  configPath: string,
  storeDir: string,
  opts: { chmod?: Chmod; platform?: string } = {},
): TightenReport | null {
  try {
    if ((opts.platform ?? process.platform) === "win32") return null;
    const roots = installBaseRoots(configPath, storeDir);
    if (roots === null || !rootsNeedTightening(roots)) return null;
    return tightenRoots(roots, opts.chmod);
  } catch {
    return null;
  }
}
