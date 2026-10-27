/**
 * WHICH NAMES IN A CONFIGURATION DIRECTORY ARE OURS — one list, read by
 * `cli/uninstall.ts` (what a delete may take) and `private-base.ts` (what is
 * made private), so the two cannot drift (re-check of #657). Moved here from
 * `uninstall.ts`, a leaf: no console, no dashboard.
 *
 * The sidecars matter as much as the files: `scopes.ts` writes `<path>.<pid>.tmp`
 * siblings (and the removed `keys.ts` wrote them too, and a bare `<path>.tmp`
 * before review n4, which a leftover may still be), `start-fresh` leaves
 * `store.parked-<date>`, `store.blank-<date>` and `store.new-<pid>` (and the
 * same beside `snapshots`) behind, `rollback` sets the store aside as
 * `rollback-aside-v<n>-<instant>`, and `wire` leaves
 * `<file>.counterparts-backup-<stamp>`. A directory holding only those is still
 * a directory holding only ours.
 */
import { basename, dirname, join, resolve } from "node:path";

import { DEFAULT_STORE_SUBDIR, defaultSnapshotsDir } from "../core/store/paths.js";
import { NIGHT_DEBUG_DIR, onlyNightTranscripts } from "./config.js";
import type { AdapterConfig } from "./config.js";
import { NPM_LIVE_NAME } from "./npm-live.js";
import { SCOPES_FILE_NAME } from "./scopes.js";

/** The sidebar's two files (`sidebar-status.ts#SIDEBAR_FILE_NAME`, `#PLUGIN_PRESENCE_NAME`),
 *  spelled here because that module pulls in the dashboard, which the hook
 *  must not load; `test/private-store.test.ts` holds the spellings together. */
export const SIDEBAR_NAMES: readonly string[] = ["sidebar.json", "sidebar-plugin-here"];

/** `<base>/rollback-aside-v13-2026-10-11T07-25-00-000Z` (`cli/rollback.ts`). */
export const ASIDE_PREFIX = "rollback-aside-v";
export const ASIDE_NAME_RE = /^rollback-aside-v[0-9A-Za-z]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export type OwnedKind = "config" | "scopes" | "snapshots" | "store" | "sidecar";

/** The basenames this package writes inside a configuration directory. Built
 *  from the configuration rather than assumed, because three of the five are
 *  things the file itself can move. */
export interface OwnedNames {
  readonly config: string;
  readonly scopes: string;
  /** Null when `snapshots.dir` points at a directory the OWNER chose, which
   *  this command leaves alone exactly as `start-fresh` does. */
  readonly snapshots: string | null;
  /** Null when `dataDir` is not directly inside the configuration directory. */
  readonly store: string | null;
}

export function ownedNames(
  configPath: string,
  config: AdapterConfig,
  storeDir: string | null,
): OwnedNames {
  const dir = resolve(dirname(configPath));
  const configured = config.snapshots?.dir;
  const snaps =
    storeDir === null
      ? null
      : configured !== undefined && configured.trim().length > 0
        ? resolve(configured)
        : defaultSnapshotsDir(storeDir);
  return {
    config: basename(resolve(configPath)),
    scopes: SCOPES_FILE_NAME,
    snapshots: snaps !== null && resolve(dirname(snaps)) === dir ? basename(snaps) : null,
    store: storeDir !== null && resolve(dirname(storeDir)) === dir ? basename(storeDir) : null,
  };
}

/** Is this entry name one this package writes, and which kind? */
export function ownedKind(name: string, owned: OwnedNames, configDir?: string): OwnedKind | null {
  if (name === owned.config) return "config";
  if (name === owned.scopes) return "scopes";
  if (owned.snapshots !== null && name === owned.snapshots) return "snapshots";
  if (owned.store !== null && name === owned.store) return "store";
  if (SIDEBAR_NAMES.includes(name) || /^sidebar\.json\.\d+\.tmp$/.test(name)) return "sidecar";
  if (NPM_LIVE_NAME.test(name)) return "sidecar";
  // `rollback`'s set-aside store, beside a store this package laid out.
  if (owned.store !== null && ASIDE_NAME_RE.test(name)) return "sidecar";
  // A developer's night transcripts (2026-10-23, `debug.nightTranscripts`),
  // beside a store this package laid out (`config.ts#nightDebugDir`) — ours
  // only while it holds nothing else: a `debug` folder with anything of the
  // owner's in it is the owner's, never deleted whole (review of C1).
  if (name === NIGHT_DEBUG_DIR) {
    return owned.store === DEFAULT_STORE_SUBDIR && configDir !== undefined && onlyNightTranscripts(join(configDir, name)) ? "sidecar" : null;
  }
  const bases = [owned.config, owned.scopes, owned.snapshots, owned.store];
  for (const base of bases) {
    if (base === null || !name.startsWith(`${base}.`)) continue;
    const suffix = name.slice(base.length + 1);
    if (
      /^\d+\.tmp$/.test(suffix) ||
      suffix === "tmp" ||
      /^counterparts-backup-/.test(suffix) ||
      /^(parked|blank|new)-/.test(suffix)
    ) {
      return "sidecar";
    }
  }
  return null;
}
