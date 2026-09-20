/**
 * `counterparts start-fresh` — beginning again without losing what came before.
 *
 * **What it is for.** The owner is about to use this system as a stranger would:
 * a blank store, the QUICKSTART followed literally, every rough edge collected,
 * fixed, and then started over again (plan §2 ruling 6, "cut-over carries
 * NOTHING"). Doing that by hand is five steps
 * (`docs/plan-step3-the-floor-2026-09-17.md` §2 step 5) with seventeen thousand
 * private memories on the other side of a typo. This is those steps, once, with
 * the guards written down.
 *
 * **THE ONE RULE, and everything below is a way of keeping it: it never deletes,
 * and it never opens the old store.** Not for writing, not for reading, not
 * read-only — a WAL store's `-wal` holds committed pages until somebody
 * checkpoints it, and an opener is somebody. The old store is moved by a single
 * `rename(2)` and then left exactly as it was, byte for byte, including its
 * sidecars. Nothing in this file calls `Store.open`, `openDb`, `rm`, `unlink` or
 * `cp` on anything at all. The only mutating call it makes is `rename`.
 *
 * Which is also why the command works on CUT-OVER DAY, when the running build
 * REFUSES the store on disk by name (`STORE_PRE_ROWS`, F5): a rename does not
 * care what floor a directory is on. For the same reason the question "is there
 * a store here?" is asked as **does this directory exist and hold anything**,
 * never `storeExists()` — that one looks for the canonical database by NAME, and
 * the name changes with the floor, so on cut-over day it would answer "no store
 * here" about the very store this command exists to protect.
 *
 * **Why the configuration decides which store, and `--dir` is refused.** The
 * store that matters is the one the HOOKS and the MCP SERVER open, and that is
 * `dataDir` in `claude-code.json` — nothing else. A `--dir` on this command line
 * would be a second answer to "which store", which is the `--dirr` scar
 * (`commands.ts#COMMAND_FLAGS`) pointed at the most dangerous verb in the
 * package. So it is refused by name rather than quietly ignored.
 *
 * **Why the new store lands at the SAME path.** The floor plan's step 5 made a
 * `store-v2` beside the old one and re-ran `claude mcp add`. Parking in place
 * instead means `dataDir` does not move, so the configuration is kept
 * byte-for-byte, the MCP registration (`-e COUNTERPARTS_DATA_DIR=<store>`) still
 * names the right path, and there is no re-registration step to forget — which
 * was named as failure mode (b) of the clean cut.
 *
 * **What a kill can leave behind.** The snapshots directory is parked FIRST and
 * the store SECOND, so the only window in which the configuration names a
 * directory that is not there is between the store's rename and the blank
 * store's creation, which is two syscalls wide — and the rollback lines are
 * printed BEFORE the first rename, so even a kill inside that window leaves the
 * way back on the screen. A later run reads the ground and finishes.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";

import { assertSafeDataDir, dateOf, isWithin } from "../../core/store/index.js";
import { SESSIONS_DIR } from "../sessions.js";

/** The infix a parked directory wears: `store.parked-2026-09-20`. */
export const PARKED_INFIX = "parked";

/** And the one the BLANK store wears when a rollback parks it in turn. */
export const BLANK_INFIX = "blank";

/**
 * How recently something must have touched the store for this command to call
 * it open.
 *
 * It is short on purpose. A crashed session leaves a record behind, and a
 * window measured in hours (`sessions.ts#SESSION_TTL_MS` is four of them) would
 * lock the owner out of his own cut-over until it expired. Ten minutes is long
 * enough that a session anybody is actually using has touched a boundary or a
 * `-wal` inside it, and short enough that yesterday's crash is not an obstacle.
 *
 * **It is a floor on the evidence, never a proof of the absence.** A Claude Code
 * session sitting idle with its MCP server attached writes nothing and is
 * invisible here. That is exactly why the confirmation below exists and says so
 * in those words: the check catches the obvious case, the human catches the
 * rest.
 */
export const OPEN_WINDOW_MS = 10 * 60_000;

// ── what is on the ground ───────────────────────────────────────────────────

export interface DirSighting {
  readonly path: string;
  /** The directory is there. `lstat`, so a symlink counts as present. */
  readonly present: boolean;
  /** It is a symbolic link rather than a directory. Refused; see `parkRefusal`. */
  readonly symlink: boolean;
  /** How many entries it holds. 0 for an absent one, and for an empty one. */
  readonly entries: number;
}

/**
 * Is there something here, and what is it? FLOOR-AGNOSTIC BY CONSTRUCTION: it
 * asks the filesystem, never the store, so an old-floor store, a half-restored
 * copy and a store from a build nobody has written yet all read the same.
 */
export function sight(path: string): DirSighting {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return { path, present: false, symlink: false, entries: 0 };
  }
  if (stat.isSymbolicLink()) return { path, present: true, symlink: true, entries: 0 };
  if (!stat.isDirectory()) return { path, present: true, symlink: false, entries: 0 };
  let entries = 0;
  try {
    entries = readdirSync(path).length;
  } catch {
    // Unreadable is not empty. Treated as holding something, which is the
    // direction that parks rather than overwrites.
    entries = 1;
  }
  return { path, present: true, symlink: false, entries };
}

/**
 * Why this directory may not be parked, or null.
 *
 * Every clause is the same mistake in a different costume: a path that turns
 * out to name somewhere that matters. The forbidden-root check runs on BOTH
 * spellings — the path as the configuration wrote it, and the path it actually
 * reaches — which is the lesson the F2 adversarial review taught
 * (`adapters/snapshots.ts#assertRotatableDir`): `assertSafeDataDir` is pure
 * string math and follows no links, so a `dataDir` that is a symlink into
 * `~/.bansai` clears it on the written spelling alone.
 *
 * A SYMLINK IS REFUSED OUTRIGHT rather than followed or renamed. Renaming a
 * symlink moves the LINK: the real store would stay where it is, unparked,
 * while a fresh empty directory appeared at the name the configuration points
 * at — the old memories still live, still written to by anything holding them
 * open, and no longer reachable by the configuration. That is the one outcome
 * worse than refusing.
 */
export function parkRefusal(
  label: string,
  path: string,
  configPath: string,
  home: string = homedir(),
): string | null {
  const written = resolve(path);
  // As WRITTEN first, so the sentence names what the owner typed...
  const forbidden = forbiddenRefusal(label, written);
  if (forbidden !== null) return forbidden;
  // ...and then as it RESOLVES, which is the spelling that decides where a
  // rename would actually land.
  const real = realpathDeep(written);
  const forbiddenReal = forbiddenRefusal(label, real);
  if (forbiddenReal !== null) return forbiddenReal;

  if (real === parsePath(real).root) {
    return `refused: the ${label} resolves to a filesystem root (${real}). Nothing here will rename that.`;
  }
  if (real === realpathDeep(home)) {
    return `refused: the ${label} resolves to your home directory (${real}). Nothing here will rename that.`;
  }
  if (isWithin(written, configPath)) {
    return (
      `refused: the ${label} at ${written} CONTAINS the configuration ${configPath}. ` +
      "Parking it would move the file that says where your memory is, and the hooks would " +
      "read a path that is no longer there. The store belongs one level below the " +
      "configuration (`install` puts it there); move it before starting fresh."
    );
  }
  const seen = sight(path);
  if (seen.symlink) {
    let target = "somewhere else";
    try {
      target = realpathDeep(written);
    } catch {
      /* the sentence is about the link, not the target */
    }
    return (
      `refused: the ${label} at ${written} is a SYMBOLIC LINK (to ${target}). ` +
      "Renaming a link moves the link and leaves the real directory exactly where it is — " +
      "so the memories would stay live, still open to anything holding them, and no longer " +
      "reachable from your configuration. Park the real directory by hand, or point " +
      `"dataDir" at it directly.`
    );
  }
  return null;
}

function forbiddenRefusal(label: string, path: string): string | null {
  try {
    assertSafeDataDir(path);
    return null;
  } catch (err) {
    const root =
      err !== null && typeof err === "object" && "detail" in err
        ? String((err as { detail: Record<string, unknown> }).detail["root"] ?? "a live store")
        : "a live store";
    return (
      `refused by name: the ${label} (${path}) is inside ${root}. ` +
      "That is a live memory this package never touches — not to read it, not to move it, " +
      "not to rename it (CLAUDE.md, the second safety rule)."
    );
  }
}

/**
 * The real path of a directory that may not exist yet — the same helper
 * `adapters/snapshots.ts` carries, and for the same reason: `resolve` follows no
 * links and `realpathSync` throws on a path that is not there, and both cases
 * are ordinary here (macOS spells `$TMPDIR` through a symlink, and the
 * snapshots directory does not exist before the first copy).
 */
export function realpathDeep(path: string): string {
  const resolved = resolve(path);
  let head = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      // `realpathSync` is a READ of a path, never an open of a database.
      const real = realpathSync(head);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolved;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

// ── the parked name ─────────────────────────────────────────────────────────

/**
 * `<path>.<infix>-<date>`, with `-2`, `-3` … if that is taken.
 *
 * The date is the store's own UTC calendar date (`dateOf`), the same spelling
 * every other date in this tree uses, so a parked directory sorts beside the
 * snapshots and the journal entries of the day it was parked.
 *
 * `taken` is injected so the choice is provable without a filesystem, and so a
 * caller can ask the question twice — once when it prints the plan and once
 * after the human has confirmed it, because a name that was free before
 * somebody went to make coffee may not be free after (scar §2.13).
 */
export function parkedPath(
  path: string,
  infix: string,
  date: string,
  taken: (candidate: string) => boolean = existsSync,
): string {
  const base = `${resolve(path)}.${infix}-${date}`;
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${String(n)}`;
    if (!taken(candidate)) return candidate;
  }
  // A thousand parked stores in one day is not a case worth guessing at.
  throw new Error(`no free parked name beside ${path} for ${date}`);
}

// ── who has it open ─────────────────────────────────────────────────────────

export interface OpenSign {
  /** `session <id>` or the sidecar's file name. */
  readonly what: string;
  /** Where it was seen, in plain words. */
  readonly where: string;
  readonly agoMs: number;
}

export interface Liveness {
  /** Evidence good enough to REFUSE on: a session the host has not ended whose
   *  hooks ran inside the window. */
  readonly signs: readonly OpenSign[];
  /** Evidence good enough to SAY, and not to refuse on: something wrote to the
   *  store recently, which may well have been the reader's own last command. */
  readonly recent: readonly OpenSign[];
  /** True when the sessions directory could not be read at all — not a refusal:
   *  an unreadable registry is no evidence either way, and the confirmation is
   *  what stands between this command and an open session regardless. */
  readonly unreadable: boolean;
}

/**
 * Cheap, honest evidence that something still has this store open — split into
 * what is worth REFUSING on and what is only worth SAYING.
 *
 * Two sources, both READS OF METADATA — a `readdir`, a `stat`, and one small
 * JSON file per live session. Neither opens a database.
 *
 *   1. **The live-session registry** (`<store>/sessions/<id>.json`): host state
 *      the hooks leave for the MCP server. A record with no `endedAt` whose last
 *      boundary is inside the window is a session whose hooks — and whose MCP
 *      server — are very likely still attached. **This is the refusal.**
 *
 *   2. **A fresh `-shm`.** Measured on this build, 2026-09-20: under `bun:sqlite`
 *      the `-wal` and the `-shm` SURVIVE a clean close — a store that nothing has
 *      open still has both, with the mtime of whatever last wrote. So a fresh
 *      `-shm` does NOT mean a connection is open; it means something wrote
 *      recently, and on this command line the likeliest something is the
 *      owner's own `doctor` a minute ago. Refusing on it made `start-fresh`
 *      refuse itself in testing. It is reported, in the sentence above the
 *      confirmation, and it is not a refusal. Matched by SUFFIX, never by
 *      database name, because the name changes with the floor.
 *
 * What neither can see is said out loud wherever they are printed: an idle open
 * session writes nothing at all.
 */
export function readLiveness(
  storeDir: string,
  now: number,
  windowMs: number = OPEN_WINDOW_MS,
): Liveness {
  const signs: OpenSign[] = [];
  const recent: OpenSign[] = [];
  let unreadable = false;

  const sessions = join(storeDir, SESSIONS_DIR);
  let names: string[];
  try {
    names = readdirSync(sessions);
  } catch {
    names = [];
    // An ABSENT sessions directory is ordinary — a store nothing has ever run
    // against has none. `unreadable` is reserved for one that is THERE and
    // would not list, because that is the source that could have answered and
    // did not.
    unreadable = existsSync(sessions);
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(sessions, name), "utf8"));
    } catch {
      continue;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    if (rec["endedAt"] !== null && rec["endedAt"] !== undefined) continue;
    const last = rec["lastBoundaryAt"];
    if (typeof last !== "number") continue;
    const agoMs = now - last;
    if (agoMs > windowMs || agoMs < -windowMs) continue;
    const id = typeof rec["sessionId"] === "string" ? rec["sessionId"] : name.replace(/\.json$/, "");
    const scope = typeof rec["scope"] === "string" ? rec["scope"] : "an unrecorded directory";
    signs.push({ what: `session ${id}`, where: scope, agoMs });
  }

  for (const path of sidecarCandidates(storeDir)) {
    try {
      const agoMs = now - statSync(path).mtimeMs;
      if (agoMs > windowMs || agoMs < -windowMs) continue;
      recent.push({ what: basename(path), where: dirname(path), agoMs });
    } catch {
      continue;
    }
  }
  return { signs, recent, unreadable };
}

/** Every `-shm` at the top of the store and inside `cache/`. Suffix, never name:
 *  the database is renamed by the floor and this check must not go with it. */
function sidecarCandidates(storeDir: string): string[] {
  const out: string[] = [];
  for (const dir of [storeDir, join(storeDir, "cache")]) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith("-shm")) out.push(join(dir, entry.name));
      }
    } catch {
      continue;
    }
  }
  return out;
}

// ── the plan ────────────────────────────────────────────────────────────────

export interface ParkStep {
  /** What is being moved, in the words the output uses. */
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export type StartFreshShape =
  /** A store is there and will be parked. The ordinary case. */
  | "park"
  /** Nothing to park: no store directory, or an empty one. It is just an install. */
  | "nothing-to-park"
  /** The store directory is gone and something is parked beside it: a previous
   *  run was interrupted between the rename and the creation. Finish it. */
  | "resume";

export interface StartFreshPlan {
  readonly shape: StartFreshShape;
  readonly configPath: string;
  readonly configPresent: boolean;
  readonly storeDir: string;
  readonly date: string;
  /** Snapshots first, store second. Empty for `nothing-to-park` and `resume`. */
  readonly parks: readonly ParkStep[];
  /** Already-parked directories a resume found, for the report. */
  readonly alreadyParked: readonly string[];
  /** The snapshots directory, when it is the one beside the store. */
  readonly snapshotsDir: string | null;
  /** Said when `snapshots.dir` points somewhere this command will not touch. */
  readonly snapshotsElsewhere: string | null;
  readonly liveness: Liveness;
  readonly refusal: string | null;
}

export interface PlanInput {
  readonly configPath: string;
  readonly configPresent: boolean;
  /** `dataDir` exactly as the configuration holds it. */
  readonly dataDir: string | undefined;
  /** `snapshots.dir` from the configuration, when it names one. */
  readonly snapshotsConfigured: string | undefined;
  readonly now: number;
  readonly home?: string;
  /** Injected by the tests that prove the name choice without a filesystem. */
  readonly taken?: (candidate: string) => boolean;
}

/**
 * Read the ground, decide the renames, and collect every reason not to.
 *
 * Pure but for the reads: it stats, lists and parses, and it changes nothing.
 * `commands.ts` calls it TWICE — once to print, once after the confirmation —
 * so it must be safe to call as often as anyone likes.
 */
export function planStartFresh(input: PlanInput): StartFreshPlan {
  const date = dateOf(input.now);
  const home = input.home ?? homedir();
  const configPath = resolve(input.configPath);
  const empty = {
    shape: "nothing-to-park" as StartFreshShape,
    configPath,
    configPresent: input.configPresent,
    date,
    parks: [] as ParkStep[],
    alreadyParked: [] as string[],
    snapshotsDir: null,
    snapshotsElsewhere: null,
    liveness: { signs: [], recent: [], unreadable: false } as Liveness,
  };

  // A CONFIGURATION THAT IS THERE AND NAMES NO STORE IS A REFUSAL, not a guess.
  // The hooks fall back to `COUNTERPARTS_DATA_DIR` when the file names no store
  // (`claude-code/bin/hook.ts`), so "the store the hooks open" is a fact about
  // somebody's shell rather than about this file — and guessing `<base>/store`
  // would park a directory nobody pointed at.
  if (input.configPresent && (input.dataDir === undefined || input.dataDir.trim().length === 0)) {
    return {
      ...empty,
      storeDir: "",
      refusal:
        `refused: ${configPath} names no "dataDir", so there is no way to know which store your ` +
        "hooks open — with that key absent they fall back to $COUNTERPARTS_DATA_DIR, which is a " +
        'fact about a shell rather than about this file. Add "dataDir": "<absolute path>" to the ' +
        "configuration first (that is what `counterparts install` writes), then run this again.",
    };
  }

  const storeDir =
    input.dataDir !== undefined && input.dataDir.trim().length > 0
      ? resolve(input.dataDir.trim())
      : "";

  // No configuration at all: a machine that has never had an install. Nothing
  // is parked, and the command is an ordinary first `install` that says so.
  if (!input.configPresent) {
    return { ...empty, storeDir, refusal: null };
  }

  const refusal = parkRefusal("store", storeDir, configPath, home);
  if (refusal !== null) {
    return { ...empty, storeDir, shape: "park", refusal };
  }

  const store = sight(storeDir);
  // WHERE THE SNAPSHOTS ARE IS THE SNAPSHOT MODULE'S QUESTION, asked in its own
  // words rather than by rebuilding the rule here: the default is a sibling of
  // the store, and a configured `snapshots.dir` is a directory the OWNER pointed
  // at, which this command leaves alone and says so.
  const beside = join(dirname(storeDir), "snapshots");
  const configured = input.snapshotsConfigured;
  const snapshotsElsewhere =
    configured !== undefined && configured.trim().length > 0 && resolve(configured) !== beside
      ? resolve(configured)
      : null;
  const snapshotsDir =
    snapshotsElsewhere === null && basename(storeDir) === "store" ? beside : null;

  const taken = input.taken ?? existsSync;

  if (!store.present || store.entries === 0) {
    // Nothing to park. Two readings, and the difference matters to the reader:
    // a store that was never there, and one a previous run already moved.
    const parked = siblingsParked(storeDir, taken);
    return {
      ...empty,
      storeDir,
      snapshotsDir,
      snapshotsElsewhere,
      shape: parked.length > 0 && !store.present ? "resume" : "nothing-to-park",
      alreadyParked: parked,
      refusal: null,
    };
  }

  const snapshotsRefusal =
    snapshotsDir === null ? null : parkRefusal("snapshots directory", snapshotsDir, configPath, home);
  if (snapshotsRefusal !== null) {
    return { ...empty, storeDir, snapshotsDir, snapshotsElsewhere, shape: "park", refusal: snapshotsRefusal };
  }

  const crossDevice = sameFilesystemRefusal(storeDir);
  if (crossDevice !== null) {
    return { ...empty, storeDir, snapshotsDir, snapshotsElsewhere, shape: "park", refusal: crossDevice };
  }

  const parks: ParkStep[] = [];
  // SNAPSHOTS FIRST. A kill between the two renames then leaves the
  // configuration pointing at a store that is still there — the harmless order.
  if (snapshotsDir !== null && sight(snapshotsDir).present && !sight(snapshotsDir).symlink) {
    parks.push({
      label: "snapshots",
      from: snapshotsDir,
      to: parkedPath(snapshotsDir, PARKED_INFIX, date, taken),
    });
  }
  parks.push({
    label: "store",
    from: storeDir,
    to: parkedPath(storeDir, PARKED_INFIX, date, taken),
  });

  return {
    shape: "park",
    configPath,
    configPresent: input.configPresent,
    storeDir,
    date,
    parks,
    alreadyParked: [],
    snapshotsDir,
    snapshotsElsewhere,
    liveness: readLiveness(storeDir, input.now),
    refusal: null,
  };
}

/**
 * Why this rename cannot be atomic, or null.
 *
 * `rename(2)` is atomic within one filesystem and fails with `EXDEV` across
 * two. A store that is itself a mount point — an external disk, a network
 * volume, a container bind — is exactly that case, and the alternative
 * (copy-then-delete) is the one thing this command may never do. So it is
 * measured BEFORE anything moves, by comparing device numbers, and refused with
 * the reason rather than discovered halfway through.
 */
export function sameFilesystemRefusal(storeDir: string): string | null {
  let here: number;
  let parent: number;
  try {
    here = statSync(storeDir).dev;
    parent = statSync(dirname(storeDir)).dev;
  } catch (err) {
    return `refused: could not read ${storeDir} or its parent (${String((err as Error).message ?? err)}).`;
  }
  if (here === parent) return null;
  return (
    `refused: ${storeDir} is on a different filesystem from ${dirname(storeDir)}, so moving it ` +
    "beside itself would be a COPY followed by a DELETE rather than one atomic rename — and this " +
    "command does not delete, ever. Move the store by hand with a tool you trust, verify the copy, " +
    `and point "dataDir" at whatever you want the new store to be.`
  );
}

/** Parked siblings of a store path, newest name last. Used only to REPORT. */
function siblingsParked(storeDir: string, taken: (c: string) => boolean): string[] {
  const out: string[] = [];
  try {
    const prefix = `${basename(storeDir)}.${PARKED_INFIX}-`;
    for (const entry of readdirSync(dirname(storeDir))) {
      if (entry.startsWith(prefix)) out.push(join(dirname(storeDir), entry));
    }
  } catch {
    return out;
  }
  return out.filter((p) => taken(p)).sort();
}

// ── doing it ────────────────────────────────────────────────────────────────

/**
 * The filesystem, injected — ONE call, so a test can fail step N deterministically
 * and then prove that what is on disk is either the before or the after and never
 * a third thing.
 */
export interface StartFreshOps {
  readonly rename: (from: string, to: string) => void;
}

export const REAL_OPS: StartFreshOps = {
  rename: (from, to) => {
    renameSync(from, to);
  },
};

export interface ParkOutcome {
  readonly done: readonly ParkStep[];
  /** The step that failed, when one did. */
  readonly failed: ParkStep | null;
  readonly error: string | null;
}

/**
 * Perform the renames, in order, stopping at the first failure.
 *
 * It does exactly as many `rename` calls as there are steps and nothing else:
 * no mkdir, no chmod, no cleanup, no attempt to undo a rename that worked. An
 * "undo" here would be a second rename of a directory whose state nobody has
 * re-read, which is how a recovery path destroys what the failure left intact.
 * The caller prints what was done and what was not, and the rollback lines it
 * printed before starting are still correct.
 */
export function park(steps: readonly ParkStep[], ops: StartFreshOps = REAL_OPS): ParkOutcome {
  const done: ParkStep[] = [];
  for (const step of steps) {
    try {
      ops.rename(step.from, step.to);
      done.push(step);
    } catch (err) {
      const code =
        err !== null && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
          ? `${(err as { code: string }).code}: `
          : "";
      return { done, failed: step, error: `${code}${String((err as Error).message ?? err)}` };
    }
  }
  return { done, failed: null, error: null };
}

// ── what the owner reads ────────────────────────────────────────────────────

/** The plan, in the order it will happen. One line per rename, paths in full. */
export function planLines(plan: StartFreshPlan): string[] {
  const out: string[] = [];
  out.push(`Configuration: ${plan.configPath}${plan.configPresent ? "" : " (not there yet)"}`);
  out.push(`Store:         ${plan.storeDir}`);
  out.push("");
  if (plan.shape === "nothing-to-park") {
    out.push("Nothing to park: there is no store at that path (or it is empty).");
    out.push("So this is an ordinary first install, and it says so rather than pretending");
    out.push("it moved something.");
    return out;
  }
  if (plan.shape === "resume") {
    out.push("A previous run was interrupted: the store directory is gone and these are");
    out.push("parked beside it —");
    for (const p of plan.alreadyParked) out.push(`  ${p}`);
    out.push("");
    out.push("Nothing will be moved. This run only creates the blank store at the path");
    out.push("your configuration names, which is what that run had left to do.");
    return out;
  }
  out.push("It will rename, in this order — one atomic rename each, nothing copied,");
  out.push("nothing deleted, and the old store is never opened:");
  for (const step of plan.parks) {
    out.push(`  ${step.from}`);
    out.push(`    -> ${step.to}`);
  }
  out.push("");
  out.push("Then it will create a blank store at:");
  out.push(`  ${plan.storeDir}`);
  if (plan.snapshotsElsewhere !== null) {
    out.push("");
    out.push(`  Snapshots are configured at ${plan.snapshotsElsewhere}, which is a directory`);
    out.push("  you pointed at rather than one this layout owns, so it is LEFT ALONE. The");
    out.push("  new store's rotation will see the old store's copies there and count them.");
  } else if (plan.snapshotsDir === null) {
    out.push("");
    out.push("  No snapshots directory belongs to this layout (the store is not named");
    out.push("  'store' under a base directory), so there is none to park.");
  }
  return out;
}

/** The configuration's side of it — today, always "nothing changes". */
export function configLines(plan: StartFreshPlan): string[] {
  if (!plan.configPresent) {
    return [
      `  ${plan.configPath}: will be CREATED by the install below.`,
    ];
  }
  return [
    `  ${plan.configPath}: unchanged — "dataDir" already names ${plan.storeDir},`,
    "    and the blank store is created at that same path. Nothing in the file is",
    "    rewritten, so your credentials file, your ceiling and every other value",
    "    stay exactly as they are, byte for byte.",
  ];
}

/** The line that undoes everything, and the sentence that says what it costs. */
export function rollbackLines(
  plan: StartFreshPlan,
  taken: (candidate: string) => boolean = existsSync,
): string[] {
  if (plan.parks.length === 0) return [];
  const blank = parkedPath(plan.storeDir, BLANK_INFIX, plan.date, taken);
  const out: string[] = [
    "  mv " + shell(plan.storeDir) + " " + shell(blank),
  ];
  for (const step of [...plan.parks].reverse()) {
    out.push("  mv " + shell(step.to) + " " + shell(step.from));
  }
  return out;
}

function shell(path: string): string {
  return /^[A-Za-z0-9._\-/]+$/.test(path) ? path : `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** What the confirmation asks to be typed back: the parked store's own name. */
export function confirmationWord(plan: StartFreshPlan): string {
  const store = plan.parks.find((p) => p.label === "store");
  return store === undefined ? "" : basename(store.to);
}
