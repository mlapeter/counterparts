/**
 * THE STORE IS PRIVATE TO ITS USER (2026-10-27, R1).
 *
 * Until this build `~/.counterparts` came out the way the umask made it: on a
 * Mac `755` for the directories and `644` for `counterparts.sqlite`, so any
 * other account on the machine could read every memory. Now:
 *
 *   - **The database family is `0600`**: `db.ts#openDb` sets it on a file it
 *     just created, before anything turns WAL on, and SQLite gives `-wal` and
 *     `-shm` the database file's own mode (measured, bun 1.3 and Node 22/24).
 *   - **A `VACUUM INTO` copy is `0600`** (`pre-migration.ts#vacuumInto`): it
 *     does NOT take the source's mode, it takes `0644 & ~umask` (measured on
 *     both runtimes), so the copy is chmodded after.
 *   - **The roots it creates are `0700`** (`mkdirPrivate`): the store, its
 *     cache, the snapshots directory, the base directory beside them. A
 *     directory nobody else can enter keeps everything under it private
 *     whatever the files' own modes, which is the guarantee that matters; our
 *     own processes also run under umask `077` (`adapters/private-umask.ts`),
 *     so their files come out `0600` too. The core never sets the umask: an
 *     embedder's process is not ours.
 *   - **An existing store is tightened** (`tightenStore`) the first time this
 *     build opens it to write: directories to `0700`, files lose their group
 *     and other bits. BEST-EFFORT: a chmod the filesystem will not take
 *     (exFAT, some network drives) is skipped and counted, and is never a
 *     reason to refuse an open. "Once" is two stats, not a stored flag: an
 *     open that writes nothing at open stays that way (the store constructor's
 *     rule), and a store that is already tight costs two `stat` calls.
 *
 * Hosted is out of scope: its volume layout sets its own modes.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { DATABASE_FILE, DEFAULT_STORE_SUBDIR } from "./paths.js";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
/** The bits that make a path readable (or enterable) by anybody but its owner. */
export const OPEN_BITS = 0o077;

/** `chmod`, as a seam: a test makes one path refuse, the way exFAT does. */
export type Chmod = (path: string, mode: number) => void;

/** Set `mode` and swallow a refusal: modes are a guarantee we keep where the
 *  filesystem lets us, never a reason to fail. True when it took. */
export function chmodQuiet(path: string, mode: number, chmod: Chmod = chmodSync): boolean {
  try {
    chmod(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * `mkdir -p`, with every directory it CREATES set to `0700` (an existing one is
 * left alone: `tightenStore` is the one that changes an existing directory).
 * `mkdirSync`'s own `mode` is masked by the umask and is not applied to an
 * intermediate directory on every runtime, so the chmod is done here.
 */
export function mkdirPrivate(dir: string, chmod: Chmod = chmodSync): void {
  const target = resolve(dir);
  const created: string[] = [];
  let head = target;
  while (!existsSync(head)) {
    created.push(head);
    const up = dirname(head);
    if (up === head) break;
    head = up;
  }
  mkdirSync(target, { recursive: true, mode: PRIVATE_DIR_MODE });
  for (const d of created) chmodQuiet(d, PRIVATE_DIR_MODE, chmod);
}

/** Is this path open to group or other? False for a path that is not there. */
export function isOpen(path: string): boolean {
  try {
    return (statSync(path).mode & OPEN_BITS) !== 0;
  } catch {
    return false;
  }
}

export interface TightenReport {
  /** Paths whose mode was changed. */
  readonly tightened: number;
  /** Paths the filesystem would not change, as given. */
  readonly skipped: readonly string[];
}

/** The directories a store's privacy covers: the store itself, its snapshots
 *  directory, and, in the layout this package makes (`<base>/store`), the base
 *  directory (its configuration, credentials and log sit there). */
export function privateRoots(storeDir: string, snapshotsDir?: string | null): { recursive: string[]; topOnly: string[] } {
  const store = resolve(storeDir);
  const recursive = [store];
  const topOnly: string[] = [];
  const base = basename(store) === DEFAULT_STORE_SUBDIR ? dirname(store) : null;
  if (snapshotsDir !== undefined && snapshotsDir !== null) recursive.push(resolve(snapshotsDir));
  if (base !== null) {
    topOnly.push(base);
    const snaps = join(base, "snapshots");
    if (!recursive.includes(snaps)) recursive.push(snaps);
    const log = join(base, "log");
    recursive.push(log);
  }
  return { recursive, topOnly };
}

/** Does this store need tightening? Two stats: the store directory and the database. */
export function storeNeedsTightening(storeDir: string): boolean {
  const store = resolve(storeDir);
  const base = basename(store) === DEFAULT_STORE_SUBDIR ? dirname(store) : null;
  return isOpen(store) || isOpen(join(store, DATABASE_FILE)) || (base !== null && isOpen(base));
}

/**
 * Take group and other bits off every directory and file under the roots
 * (`privateRoots`). Never follows a symlink (`lstat`), never throws: a path
 * that will not change is listed in `skipped` and the walk goes on.
 */
export function tightenStore(storeDir: string, snapshotsDir?: string | null, chmod: Chmod = chmodSync): TightenReport {
  let tightened = 0;
  const skipped: string[] = [];
  // Only the group and other bits go; the owner's are left as they are (a
  // directory 0755 becomes 0700, a file 0644 becomes 0600, an owner x-bit stays).
  const fix = (path: string, mode: number): void => {
    if ((mode & OPEN_BITS) === 0) return;
    if (chmodQuiet(path, mode & 0o7777 & ~OPEN_BITS, chmod)) tightened += 1;
    else skipped.push(path);
  };
  const walk = (path: string, depth: number, recurse: boolean): void => {
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      fix(path, st.mode);
      if (!recurse && depth > 0) return;
      let names: string[] = [];
      try {
        names = readdirSync(path);
      } catch {
        return;
      }
      for (const name of names) walk(join(path, name), depth + 1, recurse);
      return;
    }
    if (st.isFile()) fix(path, st.mode);
  };
  const roots = privateRoots(storeDir, snapshotsDir);
  for (const dir of roots.topOnly) walk(dir, 0, false);
  for (const dir of roots.recursive) walk(dir, 0, true);
  return { tightened, skipped };
}
