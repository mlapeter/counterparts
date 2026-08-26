/**
 * Copying a store safely — the sharpest scar in this adapter's list (§2.11).
 *
 * **A canonical database is never file-copied.** v1 copied its SQLite file with
 * no checkpoint, and it was harmless *because the database was a declared
 * rebuildable cache*. Rescope 1 removed exactly that mitigation: box 2 is
 * canonical now, so the same flaw is canonical-data loss. Here the database is
 * copied by `VACUUM INTO`, which is SQLite's own consistent-snapshot operation:
 * it takes a read transaction, so a writer holding an uncommitted transaction
 * cannot tear the copy — the snapshot contains the last committed state and
 * nothing half-written. `test/cli.test.ts` proves it by holding an open write
 * transaction across the copy and reading the result back.
 *
 * **Scope is asserted against the layout, not documented** (§5 G5). `LAYOUT` in
 * `store/paths.ts` classifies every top-level path as backed-up or explicitly
 * excluded, and `Store.assertLayout()` throws on anything unclassified. This
 * module copies exactly `Store.backupSet()` — so adding a directory to the data
 * dir without classifying it breaks the build, and adding one that IS classified
 * changes the backup automatically. v1's allowlist landed hours before the
 * episode directory existed and silently omitted the canonical journal for three
 * weeks; a hand-maintained second list here would re-create that bug exactly.
 *
 * **Nothing throws at the caller** (§5 G8). A backup problem must not block a
 * consolidation cycle, so every failure is a row in the report.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { openDb } from "../../core/store/db.js";
import {
  LAYOUT,
  assertSafeDataDir,
  isWithin,
  paths,
} from "../../core/store/index.js";
import type { Store } from "../../core/store/index.js";

export type CopyMethod = "vacuum-into" | "file-tree" | "skipped";

export interface CopiedEntry {
  readonly name: string;
  readonly method: CopyMethod;
  readonly ok: boolean;
  readonly files: number;
  readonly why: string;
}

export interface SnapshotReport {
  readonly ok: boolean;
  readonly target: string;
  readonly copied: readonly CopiedEntry[];
  /** Every classified-but-excluded path, with the reason from the layout. */
  readonly excluded: readonly { name: string; why: string }[];
  readonly errors: readonly string[];
}

/**
 * The destination guard (§5 G3, scar §2.13). BOTH SIDES ARE RESOLVED BEFORE THEY
 * ARE COMPARED — v1's migration guard was a raw string comparison, and
 * `--out ~/.bansai/` with a trailing slash pointed it at the live store and
 * mass-wrote about 11,000 files.
 *
 * Two refusals, and the second one is the one people forget: a destination
 * INSIDE the data directory would put the copy in the tree it is copying, which
 * both recurses and lands an unclassified top-level path in the store.
 */
export function assertSafeTarget(dataDir: string, target: string): string {
  const resolvedTarget = assertSafeDataDir(target);
  const resolvedSource = resolve(dataDir);
  if (isWithin(resolvedSource, resolvedTarget)) {
    throw new Error(
      `refusing to write a copy inside the store it is copying: ${resolvedTarget}`,
    );
  }
  if (isWithin(resolvedTarget, resolvedSource)) {
    throw new Error(`refusing a destination that contains the store: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

function copyTree(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  const stat = statSync(from);
  if (!stat.isDirectory()) {
    mkdirSync(join(to, ".."), { recursive: true });
    copyFileSync(from, to);
    return 1;
  }
  mkdirSync(to, { recursive: true });
  let files = 0;
  for (const name of readdirSync(from)) {
    files += copyTree(join(from, name), join(to, name));
  }
  return files;
}

/**
 * Snapshot a store into `target`. The database goes through `VACUUM INTO`; every
 * other backed-up path is an ordinary file-tree copy, which is correct for plain
 * files and correct for prose.
 *
 * `store` is passed so the copy is made against the SAME layout the store
 * asserted at open — not against a directory listing this module took on its
 * own, which could disagree.
 */
export function snapshot(store: Store, target: string): SnapshotReport {
  const copied: CopiedEntry[] = [];
  const excluded: { name: string; why: string }[] = [];
  const errors: string[] = [];
  let resolvedTarget: string;
  try {
    resolvedTarget = assertSafeTarget(store.dir, target);
    // The layout is re-asserted here, not assumed from open: a directory that
    // appeared since the store opened must be classified before it is skipped.
    store.assertLayout();
    mkdirSync(resolvedTarget, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      target,
      copied: [],
      excluded: [],
      errors: [String((err as Error).message ?? err)],
    };
  }

  const backupSet = new Set(store.backupSet());
  for (const entry of LAYOUT) {
    if (!backupSet.has(entry.name)) {
      excluded.push({ name: entry.name, why: entry.why });
      continue;
    }
    const from = join(store.dir, entry.name);
    const to = join(resolvedTarget, entry.name);
    // The canonical database, and only it, takes the database's own route.
    if (entry.name === "operational.sqlite") {
      const result = vacuumInto(paths.operational(store.dir), to);
      copied.push({
        name: entry.name,
        method: "vacuum-into",
        ok: result.ok,
        files: result.ok ? 1 : 0,
        why: result.ok
          ? "Copied through SQLite's own consistent-snapshot path, never as a file copy (scar §2.11)."
          : result.error,
      });
      if (!result.ok) errors.push(`${entry.name}: ${result.error}`);
      continue;
    }
    try {
      const files = copyTree(from, to);
      copied.push({
        name: entry.name,
        method: "file-tree",
        ok: true,
        files,
        why: entry.why,
      });
    } catch (err) {
      const message = String((err as Error).message ?? err);
      copied.push({ name: entry.name, method: "file-tree", ok: false, files: 0, why: message });
      errors.push(`${entry.name}: ${message}`);
    }
  }

  return { ok: errors.length === 0, target: resolvedTarget, copied, excluded, errors };
}

/**
 * `VACUUM INTO` on its own connection. The destination must not exist — SQLite
 * refuses to overwrite, which is the right default for a snapshot: a backup that
 * silently replaces yesterday's is one crash away from being no backup at all.
 */
export function vacuumInto(
  source: string,
  destination: string,
): { ok: true } | { ok: false; error: string } {
  if (!existsSync(source)) return { ok: false, error: "no canonical database at source" };
  if (existsSync(destination)) {
    return { ok: false, error: `destination already exists: ${destination}` };
  }
  let db;
  try {
    db = openDb(source);
    // Single-quoted SQL literal: the path is escaped for SQL, never interpolated
    // into a shell, because nothing here shells out.
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

/** A snapshot directory name that sorts chronologically and never collides. */
export function snapshotName(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, "-");
}
