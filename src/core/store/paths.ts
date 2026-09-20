/**
 * Where the data dir is, what lives in it, and which of it is backed up.
 *
 * `dataDir()` reads the environment AT CALL TIME (never at module load) so a test
 * can redirect it per test — the hermetic-test rule in CLAUDE.md depends on this.
 */
import { homedir } from "node:os";
import { join, posix, resolve, relative, isAbsolute, sep } from "node:path";
import { StoreError, isStoreError } from "./errors.js";

export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
/**
 * THE EXPLICIT-DIR GUARD. Armed (`1`, `true` or `on`), it makes `dataDir()` REFUSE
 * its fallback instead of returning `~/.counterparts/store`: a caller who named
 * no directory — no `dir`, no `COUNTERPARTS_DATA_DIR` — gets
 * `IMPLICIT_DEFAULT_DIR_REFUSED` and nothing opens. Unset — or set to `0`, `false`
 * or `off` — nothing changes. A value that is neither is REFUSED rather than
 * read as off (`EXPLICIT_DIR_ARMING_VALUES` below).
 *
 * Why it exists (LAUNCH-STATUS I21, owner ruling 2026-09-05): on the owner's
 * machine the fallback IS his live memory, and a library caller reached it
 * overnight by passing the wrong option name — `dir` was undefined, the default
 * answered, and nine titles were read out of the live store. `.counterparts`
 * cannot go on `FORBIDDEN_ROOT_NAMES` (the store must open its own default), so
 * the guard is opt-in: OFF by default so every installed host behaves exactly as
 * before, ON wherever this repo's own tooling runs — `test/preload.ts`, the demo
 * seeder, the visual loop, the recall bench, and the agent shells the owner
 * ruled it into. The install loop deliberately UNSETS it inside its clean room
 * (`tools/install-loop/run.sh`): its fake HOME makes the default throwaway, and
 * it measures a stranger's environment, which has no such variable.
 *
 * `adapters/config-path.ts#implicitConfigRefusal` is the same guard at the other
 * door: a default-sourced `~/.counterparts/claude-code.json` NAMES a store, so the
 * hook, the worker and the MCP server reach the live one without ever calling
 * `dataDir()`, and `install` writes under that base.
 */
export const REQUIRE_EXPLICIT_DIR_ENV = "COUNTERPARTS_REQUIRE_EXPLICIT_DIR";
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
 * The canonical database's file name (owner ruling 5, 2026-09-18).
 *
 * It was `operational.sqlite` while the memories themselves were markdown files
 * beside it and the database held "the operational bits". Once the bodies are
 * rows the name stops being true, and a name that lies is a name somebody will
 * one day act on. There is no migration to worry about: the cut-over starts a
 * blank store, and a directory holding the OLD name is refused by name before
 * anything opens it (`STORE_PRE_ROWS`, `store/index.ts`).
 *
 * Spelled once. `LAYOUT` and `paths.operational` both read it, and
 * `adapters/snapshots.ts` takes it from `basename(paths.operational("."))`
 * rather than typing it a second time.
 */
export const DATABASE_FILE = "counterparts.sqlite";

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
 * THE THREE READINGS OF THE SWITCH. Whitespace is trimmed and case is ignored on
 * all of them; blank is absent.
 *
 *   - `EXPLICIT_DIR_ARMING_VALUES` — the guard is on. It is a SUPERSET of the two
 *     `COUNTERPARTS_OBSERVER` accepts (`cli/commands.ts`,
 *     `mcp/bin/serve.ts#launchOptions` both match `"1"` and `"true"` exactly), so
 *     a person who exports `=true` by analogy IS protected. `COUNTERPARTS_OBSERVER`
 *     is deliberately NOT widened to match from here: it is read on the live MCP
 *     server's launch path, which this change promises to leave instruction-for-
 *     instruction identical, and giving it a fail-closed arm is its own ruling.
 *   - `EXPLICIT_DIR_DISARMING_VALUES` — the guard is off, exactly as if the
 *     variable were unset. A guard whose `=0` REFUSED would trip the shell of the
 *     person it protects, which is the surprising direction; `off` means off
 *     (owner ruling on the #80 review round).
 *   - anything else non-blank is REFUSED, never ignored. The #80 review measured
 *     `=true`, `=yes`, `=on` and `= 1` all falling silently to the default under
 *     the first draft, and falling open is the one failure direction a safety
 *     guard may not have. Junk is not "off"; junk is a question this will not
 *     answer.
 */
export const EXPLICIT_DIR_ARMING_VALUES: readonly string[] = ["1", "true", "on"];
export const EXPLICIT_DIR_DISARMING_VALUES: readonly string[] = ["0", "false", "off"];

export type ExplicitDirSetting =
  /** Armed; `value` is the trimmed text that armed it, so a refusal can quote it as typed. */
  | { readonly armed: true; readonly value: string }
  /** Not armed: `malformed` is null when the variable is absent, blank or a disarming value, else the text the guard refuses to guess at. */
  | { readonly armed: false; readonly malformed: string | null };

/** What the variable says, read without judgement. Pure; never throws. */
export function explicitDirSetting(
  env: Record<string, string | undefined> = process.env,
): ExplicitDirSetting {
  const value = (env[REQUIRE_EXPLICIT_DIR_ENV] ?? "").trim();
  if (value.length === 0) return { armed: false, malformed: null };
  const word = value.toLowerCase();
  if (EXPLICIT_DIR_ARMING_VALUES.includes(word)) return { armed: true, value };
  if (EXPLICIT_DIR_DISARMING_VALUES.includes(word)) return { armed: false, malformed: null };
  return { armed: false, malformed: value };
}

/**
 * True when the guard is armed. THROWS `EXPLICIT_DIR_GUARD_MALFORMED` on a value
 * it will not guess at — this is the guard's decision point, and it is exactly
 * where falling open would cost a live store. A caller who wants the reading
 * without the throw uses `explicitDirSetting`.
 */
export function explicitDirRequired(env: Record<string, string | undefined> = process.env): boolean {
  const setting = explicitDirSetting(env);
  if (!setting.armed && setting.malformed !== null) {
    throw new StoreError("EXPLICIT_DIR_GUARD_MALFORMED", {
      guard: REQUIRE_EXPLICIT_DIR_ENV,
      value: setting.malformed,
      accepted: EXPLICIT_DIR_ARMING_VALUES.join("|"),
      off: EXPLICIT_DIR_DISARMING_VALUES.join("|"),
    });
  }
  return setting.armed;
}

/** The sentence for a value the guard refuses to guess at. One copy, so the two doors say the same thing. */
export function explicitDirMalformedRefusal(value: string): string {
  return (
    `refused: ${REQUIRE_EXPLICIT_DIR_ENV} is set to '${value}', which this will not guess at — it arms on ` +
    `${EXPLICIT_DIR_ARMING_VALUES.join(", ")} and stands down on ${EXPLICIT_DIR_DISARMING_VALUES.join(", ")} ` +
    "(case and surrounding whitespace ignored), and a safety guard fails closed on anything else. " +
    "Unset it, set it to 1, or set it to 0."
  );
}

/**
 * The guard's two refusals as ONE SENTENCE, for a surface that has a reader —
 * the console, the dashboard, the hook, the worker, the MCP server. `remedy` is
 * that surface's OWN way of naming a store: the console has `--dir`, the hook
 * has a field in the file it was pointed at, and a remedy that names a flag the
 * reader does not have is worse than none (#80 review). Null for any other
 * error, so a caller falls through to its usual rendering.
 */
export function describeGuardRefusal(err: unknown, remedy: string): string | null {
  if (isStoreError(err, "IMPLICIT_DEFAULT_DIR_REFUSED")) {
    return (
      `refused: ${String(err.detail["guard"])} and no store was named, so this would have opened the ` +
      `default data dir, ${String(err.detail["dir"])} — on a machine with an install, somebody's live ` +
      `memory. ${remedy}`
    );
  }
  if (isStoreError(err, "EXPLICIT_DIR_GUARD_MALFORMED")) {
    return explicitDirMalformedRefusal(String(err.detail["value"]));
  }
  return null;
}

/** The path the fallback WOULD return — so a refusal can name it without resolving it. */
export function defaultDataDir(): string {
  return join(homedir(), DEFAULT_DATA_DIR_NAME, DEFAULT_STORE_SUBDIR);
}

/**
 * The data directory for THIS call. Resolution order:
 *   1. `COUNTERPARTS_DATA_DIR` (read now, not at import)
 *   2. `~/.counterparts/store` (the base dir minus its host-adapter files) —
 *      unless `COUNTERPARTS_REQUIRE_EXPLICIT_DIR` is armed, which refuses it by
 *      name; a value that neither arms nor is blank is refused too
 *      (`explicitDirRequired`).
 *
 * `env` defaults to the process's own and is injectable for the one caller that
 * carries an environment of its own (`cli/commands.ts#resolveDir`, whose tests
 * pass one) — so the guard is provable without mutating `process.env`. It is
 * read from THAT object only: a `run(argv, { env: {} })` is unarmed for that
 * call whatever `process.env` says (`NOTES.md` 2026-09-05, the observation).
 *
 * The env-set case returns FIRST, before the guard is so much as read: a process
 * launched with the variable (the live MCP server) runs exactly the instructions
 * it ran before the guard existed — and a malformed guard value beside a named
 * store is not consulted either, because the guard's only question is about
 * the fallback.
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env[DATA_DIR_ENV];
  if (fromEnv && fromEnv.trim().length > 0) return assertSafeDataDir(fromEnv);
  const fallback = defaultDataDir();
  const setting = explicitDirSetting(env);
  if (setting.armed) {
    throw new StoreError("IMPLICIT_DEFAULT_DIR_REFUSED", {
      guard: `${REQUIRE_EXPLICIT_DIR_ENV}=${setting.value}`,
      dir: fallback,
      remedy: `name the store: pass dir (--dir on a command line, "dataDir" in a host configuration), or set ${DATA_DIR_ENV}`,
    });
  }
  // Fails closed: a value this cannot read refuses here, where falling open
  // would have handed back the live store.
  explicitDirRequired(env);
  return assertSafeDataDir(fallback);
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
    name: DATABASE_FILE,
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
    why: "adapters/sessions.ts — the live-session registry a host's hooks leave for its tools, plus the notes one process leaves another inside it: adapters/expansions.ts' handle log and associate/pending.ts' co-activation deltas (sessions/association/). Host state, not memory: no content, and its loss costs a lazy bind or one pass's reinforcement, never a memory. New state of that kind goes INSIDE this directory rather than beside it, because `assertLayout()` runs in the store's constructor and a store opened by code that predates the name would refuse to open at all.",
  },
];

/**
 * The ONE database sidecar that holds no content of its own: the `-shm`, WAL's
 * shared index, which every connection writes read-marks into — a read-only one
 * included. The suites that hash a store directory and mean "nothing wrote"
 * skip this and nothing else (2026-09-18, when box 2 and box 3 went to WAL).
 *
 * **The `-wal` is deliberately not here.** Committed pages live in it until a
 * checkpoint moves them into the file, so a write that landed since the last
 * checkpoint is IN the `-wal` and nowhere else; a hash that skipped it would
 * pass over exactly the write it exists to catch. **Nor is the `-journal`**:
 * one beside the database means a rollback-mode writer is mid-transaction, and
 * during the changeover that writer is a process on the build before this one —
 * which is a thing those suites should see, not skip.
 *
 * `classifyTopLevel` covers all three by prefix. That is a different question,
 * about what the layout allows.
 */
export function isDatabaseSidecar(name: string): boolean {
  return name.endsWith("-shm");
}

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

/**
 * The two stored spellings of a canonical file, RELATIVE to the store root and
 * POSIX-separated whatever the host: `prose/<family>/<id>.md` and
 * `versions/<id>/<seq>-<hash>.md`. These are what `memories.prose_path` and
 * `versions.path` hold (CONTRACT §5 G15, 2026-09-05); the absolute forms below
 * are `join(dir, …)` of exactly these, so there is one spelling of each.
 *
 * A store directory is SELF-CONTAINED: copy it, move it, restore it from a
 * backup — the rows inside still name the files beside them, never the files
 * of the store they were copied from (finding I22: an absolute path made a
 * copied store read and DELETE the source's prose).
 */
export const stored = {
  proseFile: (type: string, id: string): string =>
    posix.join("prose", PROSE_DIR[type] ?? type, `${id}.md`),
  versionFile: (id: string, seq: number, hash: string): string =>
    posix.join("versions", id, `${String(seq).padStart(4, "0")}-${hash}.md`),
} as const;

export const paths = {
  prose: (dir: string) => join(dir, "prose"),
  proseKind: (dir: string, type: string) => join(dir, "prose", PROSE_DIR[type] ?? type),
  proseFile: (dir: string, type: string, id: string) => join(dir, stored.proseFile(type, id)),
  versions: (dir: string) => join(dir, "versions"),
  versionsFor: (dir: string, id: string) => join(dir, "versions", id),
  versionFile: (dir: string, id: string, seq: number, hash: string) =>
    join(dir, stored.versionFile(id, seq, hash)),
  tmp: (dir: string) => join(dir, "tmp"),
  operational: (dir: string) => join(dir, DATABASE_FILE),
  cacheDir: (dir: string) => join(dir, "cache"),
  cache: (dir: string) => join(dir, "cache", "cache.sqlite"),
} as const;

/**
 * A stored path, made absolute against the store that holds the row — the ONE
 * way a stored value becomes a filesystem address (CONTRACT §5 G15).
 *
 * Four cases, each deliberate:
 *   - `""` → `""`. A chased row's pointers are blanked (`owner-op-seam.ts`), and
 *     `join(dir, "")` is the STORE ROOT — handed to the removal path's
 *     `existsSync` + `rmSync`, that would be the one address worse than the
 *     source's file. A blank pointer resolves to nothing, never to a directory.
 *   - relative → `join(dir, stored)`. The v5 shape.
 *   - absolute → PLACED against the opened dir by the same rule the migration
 *     uses (`relativizeStoredPath`; pure, no stat, no write), so an INSTRUMENT
 *     on a pre-v5 copy, backup or moved store reads ITS OWN file rather than the
 *     source's — the review of PR #79 reproduced a v5 observer on a v4 copy
 *     reading the live store's prose and calling the copy's own files missing.
 *     Only an unplaceable row (no `prose/` or `versions/` segment to key on) is
 *     read as given; `verify` counts those as "absolute (unplaceable)".
 *   - anything that would resolve OUTSIDE `<dir>/prose/` or `<dir>/versions/` —
 *     `../ESCAPE/…`, `.`, `cache/cache.sqlite`, an absolute row whose tail is
 *     `prose/../../x` — is refused with `STORED_PATH_ESCAPES` and never returned.
 *     No writer in this module produces such a row; a hand-edited database can.
 *     The guard runs AFTER the join, on both branches, so the two rules compose.
 */
export function resolveStoredPath(dir: string, storedPath: string): string {
  if (storedPath.length === 0) return "";
  if (isAbsolute(storedPath)) {
    const placed = relativizeStoredPath(dir, storedPath);
    if (placed === null || isAbsolute(placed)) return storedPath;
    return joinInsideStore(dir, placed, storedPath);
  }
  return joinInsideStore(dir, storedPath, storedPath);
}

function joinInsideStore(dir: string, rel: string, original: string): string {
  if (!isCanonicalRelativePath(dir, rel)) {
    throw new StoreError("STORED_PATH_ESCAPES", { path: original });
  }
  return join(dir, rel);
}

/**
 * True when `rel`, joined onto `dir`, lands strictly under `<dir>/prose/` or
 * `<dir>/versions/` — the only two places a stored path may name. Resolved
 * before compared (scar §2.13), so `prose/../../x` and `./prose/x` are judged
 * by where they land, not by how they are spelled. Pure: no stat, no write.
 */
export function isCanonicalRelativePath(dir: string, rel: string): boolean {
  if (rel.length === 0 || isAbsolute(rel)) return false;
  const back = relative(resolve(dir), resolve(join(dir, rel)));
  if (back.length === 0 || back.startsWith("..") || isAbsolute(back)) return false;
  const posixBack = toPosix(back);
  return posixBack.startsWith("prose/") || posixBack.startsWith("versions/");
}

/**
 * The v4 → v5 conversion of ONE path: absolute in, store-relative POSIX out, or
 * `null` when the path cannot be placed.
 *
 * Two rules, in order. If the path lies under `dir` the relative part is exact.
 * Otherwise the DEEPEST `/prose/` or `/versions/` segment keys the tail — which
 * is what places a row whose store was written under one spelling and opened
 * under another (`/var/…` vs `/private/var/…` on macOS), or a backup restored
 * to a new directory with rows that still name the old one. The tail after the
 * store-level segment can never contain a second such segment: it is
 * `prose/<family>/<id>.md` or `versions/<id>/<seq>-<hash>.md`, and an id may
 * not contain a slash (`serializeProse` refuses one).
 *
 * A relative path is returned unchanged, so the conversion is idempotent by
 * construction and a second run finds nothing to do.
 */
export function relativizeStoredPath(dir: string, path: string): string | null {
  if (path.length === 0) return path;
  if (!isAbsolute(path)) return toPosix(path);
  if (isWithin(dir, path)) {
    const rel = relative(resolve(dir), resolve(path));
    if (rel.length > 0) return toPosix(rel);
  }
  const normalized = toPosix(path);
  let best = -1;
  for (const segment of ["/prose/", "/versions/"]) {
    const at = normalized.lastIndexOf(segment);
    if (at > best) best = at;
  }
  if (best === -1) return null;
  return normalized.slice(best + 1);
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}
