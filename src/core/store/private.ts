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
 *     That is every database an open creates, the store's own and any other
 *     (hosted's control databases too).
 *   - **A `VACUUM INTO` copy is `0600`** (`pre-migration.ts#vacuumInto`): it
 *     does NOT take the source's mode, it takes `0644 & ~umask` (measured on
 *     both runtimes), so the copy is chmodded after.
 *   - **The directories it creates are `0700`** (`mkdirPrivate`): the store,
 *     its cache, a snapshot's folder, and any missing parent made on the way.
 *     A directory nobody else can enter keeps everything under it private
 *     whatever the files' own modes. Our own processes also run under umask
 *     `077` (`adapters/private-umask.ts`), so their files come out `0600` too.
 *     The core never sets the umask: an embedder's process is not ours.
 *   - **An existing store is tightened** (`tightenStore`) when a writer opens
 *     it: the store directory and everything under it, and a snapshots
 *     directory the caller NAMED (`opts.snapshotsDir`), lose their group and
 *     other bits. NOTHING ELSE: the core does not guess at a parent directory
 *     from a name (review of #657: a store dir named `store` made its parent
 *     and every sibling lose their bits, which on an embedder's machine is an
 *     app's files and on hosted a tenant's). The base directory of the layout
 *     this package makes (`~/.counterparts`) is the adapters' to tighten
 *     (`adapters/private-base.ts`), which know it from the configuration
 *     sitting in it. BEST-EFFORT: a chmod the filesystem will not take (exFAT,
 *     some network drives) is skipped and counted, never a refusal. "Once" is
 *     stats, not a stored flag: an already-tight store costs two `stat` calls,
 *     and an open writes nothing at open.
 *   - **A store meant to be shared with a group is tightened again** at every
 *     writer's open. There is no opt-out today (few guards, loose limits: one
 *     can be added when somebody needs it).
 *
 * Hosted: its tenant stores get the same at-open tightening of the store
 * directory (its volume layout already writes 0700/0600 as one user, so it
 * finds nothing to do), and any database it creates through `openDb` is 0600.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DATABASE_FILE } from "./paths.js";

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

/** Is this path open to group or other? False for a path that is not there,
 *  and for a symbolic link (a link's own mode means nothing, and the walk
 *  never follows one, so a check that read through it would ask forever). */
export function isOpen(path: string): boolean {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return false;
    return (st.mode & OPEN_BITS) !== 0;
  } catch {
    return false;
  }
}

/** The real path of a directory root, so a symlinked store is read and
 *  tightened where it actually is; the path as given when it is not there. */
export function realRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export interface TightenReport {
  /** Paths whose mode was changed. */
  readonly tightened: number;
  /** Paths the filesystem would not change, as given. */
  readonly skipped: readonly string[];
}

/** What to tighten: `recursive` paths whole (a file, or a directory and all
 *  under it), `only` paths alone (the path itself, never what is in it). */
export interface PrivateRoots {
  readonly recursive: readonly string[];
  readonly only?: readonly string[];
}

/** The core's own roots: the store, and a snapshots directory the caller named. */
export function storeRoots(storeDir: string, snapshotsDir?: string | null): PrivateRoots {
  const recursive = [realRoot(storeDir)];
  if (snapshotsDir !== undefined && snapshotsDir !== null) recursive.push(realRoot(snapshotsDir));
  return { recursive };
}

/** Does any root need tightening? A stat each, and the database's (`lstat`). */
export function rootsNeedTightening(roots: PrivateRoots, files: readonly string[] = []): boolean {
  return [...(roots.only ?? []), ...roots.recursive, ...files].some((p) => isOpen(p));
}

/** Does this store need tightening? The store directory and its database. */
export function storeNeedsTightening(storeDir: string, snapshotsDir?: string | null): boolean {
  const roots = storeRoots(storeDir, snapshotsDir);
  return rootsNeedTightening(roots, [join(roots.recursive[0] ?? storeDir, DATABASE_FILE)]);
}

/**
 * Take group and other bits off every directory and file under the roots.
 * Never follows a symlink below a root (`lstat`), never throws: a path that
 * will not change is listed in `skipped` and the walk goes on. Only the group
 * and other bits go; the owner's stay (0755 becomes 0700, 0644 becomes 0600,
 * an owner x-bit stays).
 */
export function tightenRoots(roots: PrivateRoots, chmod: Chmod = chmodSync): TightenReport {
  let tightened = 0;
  const skipped: string[] = [];
  const fix = (path: string, mode: number): void => {
    if ((mode & OPEN_BITS) === 0) return;
    if (chmodQuiet(path, mode & 0o7777 & ~OPEN_BITS, chmod)) tightened += 1;
    else skipped.push(path);
  };
  const walk = (path: string, recurse: boolean): void => {
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      fix(path, st.mode);
      if (!recurse) return;
      let names: string[] = [];
      try {
        names = readdirSync(path);
      } catch {
        return;
      }
      for (const name of names) walk(join(path, name), true);
      return;
    }
    if (st.isFile()) fix(path, st.mode);
  };
  // As given: a caller that wants a root link followed resolves it first
  // (`storeRoots`); an entry that is itself a link is never chmodded through.
  for (const p of roots.only ?? []) walk(p, false);
  for (const p of roots.recursive) walk(p, true);
  return { tightened, skipped };
}

/** The core's tightening: the store and a named snapshots directory, nothing else. */
export function tightenStore(storeDir: string, snapshotsDir?: string | null, chmod: Chmod = chmodSync): TightenReport {
  return tightenRoots(storeRoots(storeDir, snapshotsDir), chmod);
}

