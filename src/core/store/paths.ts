/**
 * Where the data dir is, what lives in it, and which of it is backed up.
 *
 * `dataDir()` reads the environment AT CALL TIME (never at module load) so a test
 * can redirect it per test — the hermetic-test rule in CLAUDE.md depends on this.
 */
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { StoreError, isStoreError } from "./errors.js";

export const DATA_DIR_ENV = "COUNTERPARTS_DATA_DIR";
/**
 * THE EXPLICIT-DIR GUARD. Armed (`1` or `true`), it makes `dataDir()` REFUSE
 * its fallback instead of returning `~/.counterparts/store`: a caller who named
 * no directory — no `dir`, no `COUNTERPARTS_DATA_DIR` — gets
 * `IMPLICIT_DEFAULT_DIR_REFUSED` and nothing opens. Unset, nothing changes.
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
 * The values that ARM the guard — the same two `COUNTERPARTS_OBSERVER` accepts
 * (`cli/commands.ts`, `mcp/bin/serve.ts#launchOptions`), so a person who exports
 * `=true` by analogy IS protected. Whitespace around them is trimmed; blank is
 * unset. ANY OTHER non-empty value is refused, never ignored: the #80 review
 * measured `=true`, `=yes`, `=on` and `= 1` all falling silently to the default,
 * and falling open is the one failure direction a safety guard may not have.
 */
export const EXPLICIT_DIR_ARMING_VALUES: readonly string[] = ["1", "true"];

export type ExplicitDirSetting =
  /** Armed; `value` is the trimmed text that armed it, so a refusal can quote it. */
  | { readonly armed: true; readonly value: string }
  /** Not armed: `malformed` is null when the variable is absent or blank, else the text the guard refuses to guess at. */
  | { readonly armed: false; readonly malformed: string | null };

/** What the variable says, read without judgement. Pure; never throws. */
export function explicitDirSetting(
  env: Record<string, string | undefined> = process.env,
): ExplicitDirSetting {
  const value = (env[REQUIRE_EXPLICIT_DIR_ENV] ?? "").trim();
  if (value.length === 0) return { armed: false, malformed: null };
  if (EXPLICIT_DIR_ARMING_VALUES.includes(value)) return { armed: true, value };
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
    });
  }
  return setting.armed;
}

/** The sentence for a value the guard refuses to guess at. One copy, so the two doors say the same thing. */
export function explicitDirMalformedRefusal(value: string): string {
  return (
    `refused: ${REQUIRE_EXPLICIT_DIR_ENV} is set to '${value}', which this will not guess at — it arms on ` +
    `${EXPLICIT_DIR_ARMING_VALUES.join(" or ")}, and a safety guard fails closed on anything else. ` +
    `Unset it, or set it to 1.`
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
    name: "operational.sqlite",
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
    why: "adapters/sessions.ts — the live-session registry a host's hooks leave for its tools. Host state, not memory: no content, and its loss costs a lazy bind, never a memory.",
  },
];

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

export const paths = {
  prose: (dir: string) => join(dir, "prose"),
  proseKind: (dir: string, type: string) => join(dir, "prose", PROSE_DIR[type] ?? type),
  proseFile: (dir: string, type: string, id: string) =>
    join(dir, "prose", PROSE_DIR[type] ?? type, `${id}.md`),
  versions: (dir: string) => join(dir, "versions"),
  versionsFor: (dir: string, id: string) => join(dir, "versions", id),
  versionFile: (dir: string, id: string, seq: number, hash: string) =>
    join(dir, "versions", id, `${String(seq).padStart(4, "0")}-${hash}.md`),
  tmp: (dir: string) => join(dir, "tmp"),
  operational: (dir: string) => join(dir, "operational.sqlite"),
  cacheDir: (dir: string) => join(dir, "cache"),
  cache: (dir: string) => join(dir, "cache", "cache.sqlite"),
} as const;
