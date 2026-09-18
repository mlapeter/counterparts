/**
 * The daily rotating snapshot — and the only mechanism in this package that
 * DELETES a copy of the owner's memory.
 *
 * **Why it is here and not in the core.** The store exports no delete of any
 * kind (store CONTRACT §5 G2), and rotation is a delete. So the deciding — is
 * today's copy already made, how many are kept, which ones go — lives in an
 * adapter, where a person can read the whole rule in one file.
 *
 * **What it copies is not decided here.** It calls `cli/snapshot.ts#snapshot`
 * unchanged, which copies exactly `Store.backupSet()`. That matters more than it
 * looks: v1 hand-maintained a second allowlist, it landed hours before the
 * episode directory existed, and the canonical journal was silently absent from
 * every backup for three weeks (scar §2.11). A database-only snapshot here would
 * re-enact that on today's floor, where the prose files are canonical.
 *
 * **THE TWO THINGS THAT CAN HURT SOMEONE**, and the shape of each defence:
 *
 *   1. *Rotation deletes.* It deletes only directories sitting DIRECTLY inside
 *      the resolved snapshots directory whose names match the one pattern this
 *      module writes (`snapshotName`); it reads the directory with `Dirent`s, so
 *      a symlink is never followed out; it refuses the whole rotation if that
 *      directory resolves inside the store, contains the store, is a filesystem
 *      root or is the home directory itself; it never deletes the copy just
 *      taken; it never rotates at all after a copy that FAILED — losing the
 *      oldest good backup on the day you could not make a new one is the worst
 *      outcome available here; and a `keep` that is not a positive integer falls
 *      back to the default rather than meaning "delete everything".
 *
 *   2. *A half-copy must never count as a snapshot.* The worker runs under a
 *      watchdog and the copy is synchronous, so the process can be killed
 *      mid-copy with no chance to clean up. Every copy is therefore written to a
 *      `.partial-…` name inside the snapshots directory and RENAMED into place
 *      when it completes — one atomic step. An interrupted copy is not counted
 *      toward `keep`, does not satisfy "today's exists", is never a rotation
 *      candidate (its name does not match), and is swept up by a later run once
 *      it is old enough that no live run could still be writing it.
 *
 * **It never throws** (cli CONTRACT §5 G8, and the worker's degrade-don't-abort
 * rule): a snapshot problem must not take a consolidation cycle down. Every
 * failure is a field in the report and, where it is worth a durable record, a
 * `snapshot.failed` row.
 *
 * **Which skips leave a row, and which do not.** A row at every session boundary
 * is a flood, not a record, so: `already-today` writes nothing — today's
 * `snapshot.taken` row IS the record; `attempts-exhausted` writes nothing — the
 * `snapshot.failed` rows it counted are; `no-default-dir` writes nothing,
 * because it is a configuration fact rather than an event and doctor says it in
 * words. Everything that stopped a copy that should have happened — a refused
 * directory, a failed copy, a failed rename, an aborted run — is a
 * `snapshot.failed` row carrying its `reason` and the `step` it died at.
 */
import { cpSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";

import type { Counterpart } from "../core/counterpart.js";
import {
  SNAPSHOT_FAILED_EVENT,
  SNAPSHOT_ROTATED_EVENT,
  SNAPSHOT_TAKEN_EVENT,
} from "../core/counterpart.js";
import {
  DEFAULT_STORE_SUBDIR,
  assertSafeDataDir,
  dateOf,
  isWithin,
} from "../core/store/index.js";
import type { Store } from "../core/store/index.js";

import { assertSafeTarget, snapshot, snapshotName } from "./cli/snapshot.js";

/** The directory the copies live in, beside the store rather than inside it. */
export const SNAPSHOTS_DIR_NAME = "snapshots";

/** How many copies are kept. Owner's ruling, 2026-09-18. */
export const DEFAULT_KEEP = 14;

/**
 * The prefix a copy wears while it is being written. It starts with a dot so it
 * sorts and reads as "not one of the snapshots", and it can never collide with
 * `snapshotName`, whose output starts with a digit.
 */
export const PARTIAL_PREFIX = ".partial-";

/**
 * How old an abandoned `.partial-…` directory must be before a later run removes
 * it. Comfortably past the worker's watchdog (`claude-code/config.ts` TUNABLES,
 * 5 minutes), because the one thing this must not do is delete the directory a
 * CONCURRENT run is still writing into.
 *
 * It is fixed while `watchdogMs` is configurable, so a host that set a watchdog
 * longer than this could in principle have a partial swept out from under a live
 * copy. The direction is safe: that run's rename then fails, its `snapshot.failed`
 * row says so, and — because a failed copy never rotates — nothing old is lost.
 */
export const PARTIAL_STALE_MS = 30 * 60_000;

/**
 * How many times a day a failing copy is retried. A copy of this store is tens
 * of megabytes and thousands of files, the worker runs at every session
 * boundary, and a persistent failure (a full disk, a permission) would otherwise
 * pay that cost dozens of times between midnight and midnight. Three attempts is
 * enough for a transient lock and cheap enough for a permanent one.
 */
export const MAX_ATTEMPTS_PER_DAY = 3;

/**
 * The name pattern rotation is allowed to delete — `snapshotName`'s output, and
 * nothing else. It is written here rather than derived so that widening the
 * DELETE side takes a deliberate edit to this line.
 */
export const SNAPSHOT_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export interface SnapshotsConfig {
  /** Where the copies go. Absent ⇒ beside the store; see `resolveSnapshotsDir`. */
  readonly dir?: string;
  readonly keep?: number;
  /** A second location that receives the same copy, with its own rotation. */
  readonly mirror?: string;
}

export type SnapshotReason =
  | "taken"
  | "already-today"
  | "no-default-dir"
  | "attempts-exhausted"
  | "aborted"
  | "refused"
  | "failed";

export interface RotationReport {
  /** The snapshot names that were deleted, oldest first. */
  readonly deleted: readonly string[];
  /** How many snapshots remain, including the one just taken. */
  readonly kept: number;
  /** The oldest snapshot still there, by name, or null when there are none. */
  readonly oldest: string | null;
  /** Abandoned `.partial-…` directories this pass removed. */
  readonly cleaned: number;
  readonly errors: readonly string[];
}

export interface SnapshotRunReport {
  readonly reason: SnapshotReason;
  /** The resolved snapshots directory, or null when none could be resolved. */
  readonly dir: string | null;
  /** The name of the copy this run made, or null when it made none. */
  readonly name: string | null;
  readonly files: number;
  readonly ms: number;
  readonly rotation: RotationReport | null;
  /** The mirror's own result, or null when no mirror is configured. */
  readonly mirror: { readonly ok: boolean; readonly why: string; readonly rotation: RotationReport | null } | null;
  /** Everything that went wrong, in the order it went wrong. */
  readonly errors: readonly string[];
}

const EMPTY_ROTATION: RotationReport = {
  deleted: [],
  kept: 0,
  oldest: null,
  cleaned: 0,
  errors: [],
};

// ── where the copies go ─────────────────────────────────────────────────────

/**
 * The snapshots directory for this store, and the rule that chose it.
 *
 * The default is a SIBLING of the store directory — `~/.counterparts/snapshots`
 * for the owner — and that is deliberate on two counts: `assertSafeTarget`
 * refuses a destination inside the store, and a destination inside would land an
 * unclassified top-level path that `assertLayout()` then refuses at every open.
 *
 * **The default only applies inside the layout this package creates.** The base
 * directory belongs to the host adapters and the store sits one level below it
 * (`store/paths.ts` DEFAULT_STORE_SUBDIR, owner ruling 2026-09-04). A store
 * somebody pointed at an arbitrary directory has no base directory, and helping
 * ourselves to a sibling of it would write tens of megabytes into a directory
 * this package does not own. That case resolves to null and doctor says so in
 * words; `snapshots.dir` in the configuration names one explicitly.
 *
 * `dataDir` is the one this adapter was HANDED. Never `$HOME`, so a hermetic
 * test cannot reach a real `~/.counterparts` however it is run.
 */
export function resolveSnapshotsDir(
  dataDir: string,
  configured?: string,
): { dir: string | null; reason: "configured" | "beside-the-store" | "no-default-dir" } {
  if (configured !== undefined && configured.trim().length > 0) {
    return { dir: resolve(configured), reason: "configured" };
  }
  const store = resolve(dataDir);
  if (basename(store) !== DEFAULT_STORE_SUBDIR) {
    return { dir: null, reason: "no-default-dir" };
  }
  return { dir: join(dirname(store), SNAPSHOTS_DIR_NAME), reason: "beside-the-store" };
}

/**
 * THE GUARD ON THE DIRECTORY ROTATION IS ALLOWED TO DELETE INSIDE.
 *
 * Every refusal here is about the same mistake in a different costume: a
 * configured path that turns out to name somewhere that matters. So both sides
 * are resolved — and REALPATHED where the directory already exists, because
 * `resolve` does not follow symlinks and a symlinked `snapshots` pointing at
 * `$HOME` would pass a string comparison while rotation walked the home
 * directory. A symlink to an external volume is a legitimate arrangement and
 * still works; it is the TARGET that is judged.
 *
 * Throws. Every caller in this file is inside a try.
 */
export function assertRotatableDir(storeDir: string, dir: string): string {
  // `assertSafeDataDir` first: it is the guard that refuses v1's live stores.
  const real = realpathDeep(assertSafeDataDir(dir));
  const store = realpathDeep(storeDir);
  // The two absolutes first, so each gets the refusal that names it. A
  // filesystem root also CONTAINS the store, and the containment message would
  // be true and useless.
  if (real === parse(real).root) {
    throw new Error(`refusing a filesystem root as a snapshots directory: ${real}`);
  }
  if (real === realpathDeep(homedir())) {
    throw new Error(`refusing the home directory as a snapshots directory: ${real}`);
  }
  if (isWithin(store, real)) {
    throw new Error(`refusing to keep snapshots inside the store they copy: ${real}`);
  }
  if (isWithin(real, store)) {
    throw new Error(`refusing a snapshots directory that contains the store: ${real}`);
  }
  return real;
}

/**
 * The real path of a directory that may not exist yet.
 *
 * `resolve` does not follow symlinks and `realpathSync` throws on a path that is
 * not there — and BOTH cases are ordinary here: the snapshots directory does not
 * exist before the first run, and on macOS the directory a test or a `$TMPDIR`
 * names is very often a symlink. Comparing one side realpathed against the other
 * side merely resolved is how a containment check says "no" to a path that is
 * the same directory. So: realpath the deepest ancestor that DOES exist, and put
 * the rest back on.
 */
function realpathDeep(path: string): string {
  const resolved = resolve(path);
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      // Nothing on this path exists. The resolved form is the whole answer.
      if (parent === head) return resolved;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

export interface SnapshotRunInput {
  /** The open counterpart. Its store is copied; its seam records the run. */
  readonly counterpart: Counterpart;
  readonly config?: SnapshotsConfig;
  /** The data directory this adapter was handed. The default location hangs off
   *  it, never off `$HOME`. */
  readonly dataDir: string;
  /** Injected so a test pins the day and the name without touching the clock. */
  readonly now?: number;
  /** The calendar date this run is about, UTC. Defaults to `now`'s. */
  readonly date?: string;
  /** The worker's watchdog. Aborted ⇒ no copy is started. */
  readonly signal?: AbortSignal;
}

/**
 * One run: decide, copy, rotate, record. Never throws.
 *
 * ORDER IS THE DESIGN. The copy happens first and lands under a partial name;
 * the rename is the moment it becomes a snapshot; rotation runs only after a
 * copy that succeeded; and the `snapshot.taken` row is written LAST, after the
 * copy — which means **a snapshot never contains its own record**. It appears in
 * the next one. That is the honest arrangement: a row written before the copy
 * would be a record of a copy that had not happened yet.
 */
export function runSnapshot(input: SnapshotRunInput): SnapshotRunReport {
  const started = Date.now();
  const errors: string[] = [];
  const now = input.now ?? started;
  const date = input.date ?? dateOf(now);
  const counterpart = input.counterpart;
  const store: Store = counterpart.store;

  const resolved = resolveSnapshotsDir(input.dataDir, input.config?.dir);
  if (resolved.dir === null) {
    // No row: a store outside this package's layout is a configuration fact, and
    // one row per boundary for a thing that will never change is a flood.
    // `doctor.ts#snapshotFindings` says it in words instead.
    return done("no-default-dir", null, null, 0, null, null, errors, started);
  }

  let dir: string;
  try {
    dir = assertRotatableDir(store.dir, resolved.dir);
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    // Deduped per calendar date: a refused directory refuses identically at
    // every boundary, and the count belongs nowhere.
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "resolve", reason: why }, `${SNAPSHOT_FAILED_EVENT}:resolve:${date}`);
    return done("refused", resolved.dir, null, 0, null, null, errors, started);
  }

  // Sweep up whatever a killed run left behind BEFORE anything else looks at the
  // directory, so a stale partial cannot be mistaken for anything and the count
  // of what was cleaned reaches the report even on a day that takes no copy.
  const cleaned = cleanPartials(dir, now, errors);

  if (todaysSnapshot(dir, date) !== null) {
    return done("already-today", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (failedAttemptsToday(store, date) >= MAX_ATTEMPTS_PER_DAY) {
    return done("attempts-exhausted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }
  if (input.signal?.aborted === true) {
    // The watchdog already fired. Starting a copy of the whole store here is
    // exactly the copy most likely to be killed halfway.
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: "copy", reason: "aborted" }, undefined);
    errors.push("aborted before the copy started");
    return done("aborted", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }

  const name = snapshotName(now);
  const copy = copyInto(store, dir, name, errors);
  if (!copy.ok) {
    note(counterpart, SNAPSHOT_FAILED_EVENT, { date, step: copy.step, reason: copy.why }, undefined);
    // NO ROTATION after a failed copy. Deleting the oldest good backup on the
    // day no new one could be made is the one outcome worth refusing outright.
    return done("failed", dir, null, 0, withCleaned(cleaned), null, errors, started);
  }

  const rotation = rotate(dir, input.config?.keep, name, cleaned, errors);
  const mirror = mirrorTo(store, dir, name, input.config?.mirror, input.config?.keep, now, errors);

  note(
    counterpart,
    SNAPSHOT_TAKEN_EVENT,
    {
      date,
      name,
      files: copy.files,
      ms: Date.now() - started,
      kept: rotation.kept,
      oldest: rotation.oldest,
      deleted: rotation.deleted.length,
      mirror: mirror === null ? "off" : mirror.ok ? "ok" : "failed",
      // The mirror's reason rides on this row too: "failed" with no why is the
      // half-record this project keeps finding in v1.
      mirrorWhy: mirror === null || mirror.ok ? null : mirror.why,
    },
    undefined,
  );
  // Only when something actually went (scar §2.4: every discard says what and
  // how much). A daily row saying "nothing was deleted" would make a store that
  // has not filled up yet read like a rotation that is working.
  if (rotation.deleted.length > 0) {
    note(
      counterpart,
      SNAPSHOT_ROTATED_EVENT,
      {
        date,
        keep: keepOf(input.config?.keep),
        deleted: rotation.deleted.length,
        names: [...rotation.deleted],
        kept: rotation.kept,
        oldest: rotation.oldest,
      },
      undefined,
    );
  }
  return done("taken", dir, name, copy.files, rotation, mirror, errors, started);
}

function done(
  reason: SnapshotReason,
  dir: string | null,
  name: string | null,
  files: number,
  rotation: RotationReport | null,
  mirror: SnapshotRunReport["mirror"],
  errors: readonly string[],
  started: number,
): SnapshotRunReport {
  return { reason, dir, name, files, ms: Date.now() - started, rotation, mirror, errors: [...errors] };
}

function withCleaned(cleaned: number): RotationReport {
  return { ...EMPTY_ROTATION, cleaned };
}

// ── the copy, and the rename that makes it a snapshot ───────────────────────

/**
 * Copy the store into `<dir>/.partial-<name>` and rename it to `<dir>/<name>`.
 *
 * The rename is the whole point: it is one step, so a process killed at any
 * instant leaves either a partial directory (which is not a snapshot by name and
 * will be swept) or a complete one. There is no in-between state that counts.
 */
function copyInto(
  store: Store,
  dir: string,
  name: string,
  errors: string[],
): { ok: true; files: number } | { ok: false; step: string; why: string } {
  // The pid makes the partial name unique to THIS process, so two runs that
  // overlap cannot write into each other's directory.
  const partial = join(dir, `${PARTIAL_PREFIX}${name}-${String(process.pid)}`);
  const report = snapshot(store, partial);
  if (!report.ok) {
    const why = report.errors.join("; ") || "the copy reported no detail";
    errors.push(why);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch (err) {
      errors.push(`could not remove the failed partial copy: ${messageOf(err)}`);
    }
    return { ok: false, step: "copy", why };
  }
  const files = report.copied.reduce((n, entry) => n + entry.files, 0);
  try {
    renameSync(partial, join(dir, name));
  } catch (err) {
    const why = messageOf(err);
    errors.push(why);
    try {
      rmSync(partial, { recursive: true, force: true });
    } catch {
      /* the sweep will get it */
    }
    return { ok: false, step: "rename", why };
  }
  return { ok: true, files };
}

/**
 * The mirror — a second location that receives the same copy and rotates on its
 * own terms. **A mirror failure is reported, never fatal**: the snapshot beside
 * the store has already landed, and losing the second copy is not worth losing
 * the first.
 *
 * It is copied from the finished primary rather than taken from the store a
 * second time. Two reasons: the two locations then hold BYTE-IDENTICAL copies of
 * one instant rather than two snapshots taken minutes apart, and the store is
 * read once instead of twice. This does not cross scar §2.11's line — that rule
 * is about copying a CANONICAL database as a file. The database inside a
 * finished snapshot is a `VACUUM INTO` output that no process holds open.
 */
function mirrorTo(
  store: Store,
  dir: string,
  name: string,
  configured: string | undefined,
  keep: number | undefined,
  now: number,
  errors: string[],
): SnapshotRunReport["mirror"] {
  if (configured === undefined || configured.trim().length === 0) return null;
  try {
    const target = assertRotatableDir(store.dir, configured);
    // The same guard the primary copy passes through, on the FULL destination.
    assertSafeTarget(store.dir, join(target, name));
    const partial = join(target, `${PARTIAL_PREFIX}${name}-${String(process.pid)}`);
    cleanPartials(target, now, errors);
    try {
      cpSync(join(dir, name), partial, { recursive: true });
      renameSync(partial, join(target, name));
    } catch (err) {
      try {
        rmSync(partial, { recursive: true, force: true });
      } catch {
        /* the sweep will get it */
      }
      throw err;
    }
    const rotation = rotate(target, keep, name, 0, errors);
    return { ok: true, why: "mirrored", rotation };
  } catch (err) {
    const why = messageOf(err);
    errors.push(`mirror: ${why}`);
    return { ok: false, why, rotation: null };
  }
}

// ── rotation: the part that deletes ─────────────────────────────────────────

/** `keep`, defended. Anything that is not a positive whole number is a
 *  misconfiguration, and the safe reading of one is the default — never zero,
 *  which would mean "delete them all". */
export function keepOf(keep: number | undefined): number {
  return keep !== undefined && Number.isInteger(keep) && keep > 0 ? keep : DEFAULT_KEEP;
}

/**
 * Keep the newest `keep`, delete the rest OLDEST FIRST, and say what went.
 *
 * Sorted by NAME, never by mtime: the names are ISO instants, so they sort
 * chronologically by construction, and an mtime is a property of the filesystem
 * that a copy, a restore or a `touch` can rewrite.
 *
 * `dir` has already been through `assertRotatableDir`. `justTaken` is excluded
 * from the candidates explicitly — it is the newest by name and could not be
 * chosen anyway, but a rule this consequential should not rest on an ordering.
 */
export function rotate(
  dir: string,
  keep: number | undefined,
  justTaken: string | null,
  cleaned: number,
  errors: string[],
): RotationReport {
  const limit = keepOf(keep);
  const names = snapshotNamesIn(dir);
  const deleted: string[] = [];
  const rotationErrors: string[] = [];
  // Newest last. Everything before the final `limit` entries goes, oldest first.
  const doomed = names.slice(0, Math.max(0, names.length - limit));
  for (const name of doomed) {
    if (name === justTaken) continue;
    try {
      rmSync(join(dir, name), { recursive: true, force: true });
      deleted.push(name);
    } catch (err) {
      const why = `could not remove ${name}: ${messageOf(err)}`;
      rotationErrors.push(why);
      errors.push(why);
    }
  }
  const remaining = names.filter((n) => !deleted.includes(n));
  return {
    deleted,
    kept: remaining.length,
    oldest: remaining[0] ?? null,
    cleaned,
    errors: rotationErrors,
  };
}

/**
 * The snapshots in a directory, sorted oldest first — and the one place that
 * decides what COUNTS as a snapshot, which is the same decision as what rotation
 * may delete.
 *
 * `readdirSync(..., { withFileTypes: true })` reports the entry's OWN type, so a
 * symlink is `isSymbolicLink()` and never `isDirectory()`: a link pointing
 * anywhere at all is skipped rather than followed, and rotation cannot walk out
 * of this directory.
 */
export function snapshotNamesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A directory that does not exist yet holds no snapshots. Not an error.
    return [];
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!SNAPSHOT_NAME_RE.test(entry.name)) continue;
    names.push(entry.name);
  }
  return names.sort();
}

/** Today's snapshot, by name, or null. The names are UTC ISO instants, so the
 *  calendar date is their first ten characters — the same UTC day every other
 *  date in this store is spelled in. */
export function todaysSnapshot(dir: string, date: string): string | null {
  for (const name of snapshotNamesIn(dir)) {
    if (name.startsWith(`${date}T`)) return name;
  }
  return null;
}

/**
 * Remove `.partial-…` directories a killed run left behind — but only ones old
 * enough that no live run could still be writing into them. A sweep that deleted
 * a fresh partial would be this module destroying its own concurrent copy.
 */
export function cleanPartials(dir: string, now: number, errors: string[]): number {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let cleaned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(PARTIAL_PREFIX)) continue;
    const path = join(dir, entry.name);
    try {
      if (now - statSync(path).mtimeMs < PARTIAL_STALE_MS) continue;
      rmSync(path, { recursive: true, force: true });
      cleaned += 1;
    } catch (err) {
      errors.push(`could not remove an abandoned copy ${entry.name}: ${messageOf(err)}`);
    }
  }
  return cleaned;
}

// ── the durable record ──────────────────────────────────────────────────────

/**
 * How many copy attempts already failed today. The cap's input.
 *
 * `eventLog` is `ORDER BY seq ASC LIMIT`, so a read that comes back FULL is the
 * OLDEST rows and today's are exactly the ones missing — the same trap
 * `doctor.ts#newestRows` carries a paragraph about. It bites hardest under the
 * failure this project has already lived through: a frozen lived-day clock (I32)
 * leaves every row inside one `day`, the window fills, and the cap silently
 * reads zero forever. So the limit is generous, and a read that REACHES it is
 * treated as exhausted rather than as zero — the fail-closed direction, and the
 * cheap one, because the thing being refused is a retry rather than a backup.
 */
const FAILED_READ_LIMIT = 1000;

function failedAttemptsToday(store: Store, date: string): number {
  try {
    const livedDay = store.livedDay();
    // A lived day is never longer than a calendar day, so two lived days back
    // certainly covers today's rows whichever side of a cycle they landed on.
    const rows = store.eventLog({
      name: SNAPSHOT_FAILED_EVENT,
      sinceDay: Math.max(0, livedDay - 2),
      limit: FAILED_READ_LIMIT,
    });
    if (rows.length >= FAILED_READ_LIMIT) return MAX_ATTEMPTS_PER_DAY;
    let n = 0;
    for (const row of rows) {
      if (row.payload === null) continue;
      try {
        const p: unknown = JSON.parse(row.payload);
        if (p === null || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        // Only a failed COPY counts against the cap. A refused directory costs
        // nothing to re-check, and capping on it would hide a fixed one.
        if (rec["date"] === date && (rec["step"] === "copy" || rec["step"] === "rename")) n += 1;
      } catch {
        /* an unparseable row is not an attempt */
      }
    }
    return n;
  } catch {
    // A store that cannot be read is not a store that has used up its attempts.
    return 0;
  }
}

/** One durable row, and never a throw: a failed record may not turn a failed
 *  step into a failed process. */
function note(
  counterpart: Counterpart,
  name: typeof SNAPSHOT_TAKEN_EVENT | typeof SNAPSHOT_FAILED_EVENT | typeof SNAPSHOT_ROTATED_EVENT,
  data: Record<string, unknown>,
  dedupKey: string | undefined,
): void {
  try {
    counterpart.noteAdapterEvent(name, data, dedupKey === undefined ? {} : { dedupKey });
  } catch {
    /* §5 G8 */
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
