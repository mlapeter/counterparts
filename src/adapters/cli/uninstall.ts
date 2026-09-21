/**
 * `counterparts uninstall` — leave, and leave everything that is not ours alone.
 *
 * **The owner's ruling, 2026-09-21, quoted from `docs/new-user-findings.md`:**
 *
 *   > Uninstall leaves `~/.counterparts` in place by default. `--park` moves it
 *   > aside under a dated name. `--delete-memories` deletes it, and only after a
 *   > warning that counts what is about to go — `WARNING: this will delete 1,204
 *   > memories.` — and the person typing `DELETE MEMORIES` exactly. No `--yes`
 *   > for that one.
 *
 * ── THE BLOCKER THIS FILE WAS REWRITTEN AROUND ──────────────────────────────
 *
 * The first version read that ruling as "the directory the configuration sits
 * in", and `install --config <path>` is the supported way to put a configuration
 * anywhere. The adversarial review of 2026-09-21 pointed one at `~/.claude` and
 * watched `--park` rename Claude Code's entire user configuration — settings,
 * project transcripts, todos — under a heading that said "Your memory, parked";
 * then pointed one at `~/Documents` and watched `--delete-memories` destroy
 * `taxes/` and `photos/` after warning about **one memory**. Both reproduced
 * again here before this was written.
 *
 * So the subject of this command is no longer a directory. **It is an explicit
 * list of the things this package writes**, built from names we own:
 *
 *   - the configuration file, and our own temp and backup siblings of it;
 *   - `credentials.env` (or whatever the configuration NAMES, when that sits
 *     beside it);
 *   - `scopes.json` and its siblings;
 *   - `snapshots/`, when it is the one this layout owns rather than a directory
 *     the owner pointed at;
 *   - the STORE — at `dataDir`, **wherever that is**, which is the other half of
 *     the same finding: the store can live outside the configuration directory,
 *     and the old code counted it, deleted the directory without it, and said
 *     the memory was gone.
 *
 * The configuration directory itself moves or goes **only when it holds nothing
 * else**, which keeps the ordinary `~/.counterparts` a single atomic rename. If
 * it holds anything we do not own, the directory is never touched: our entries
 * go one by one, the foreign ones are NAMED, and the output says the directory
 * stays.
 *
 * And four directories are refused outright whatever they hold: `~/.claude`
 * (the host's own), the home directory, any parent of it, and anything holding
 * a `.git` — a configuration inside somebody's repository is a configuration
 * this command will not reason about.
 *
 * ── the rest of the shape ───────────────────────────────────────────────────
 *
 *   - **The default removes WIRING, never memory.** It unwires, says where the
 *     memory still is and how much of it there is, and gives the one command
 *     that removes the package.
 *   - **`--park` is `rename(2)`**, once per thing. Never a copy, never a delete.
 *     The `mv` that undoes each one is printed, guarded the way `start-fresh`
 *     guards its way back.
 *   - **`--delete-memories` is the only destructive verb in this package**, and
 *     the one with no `--yes`. It PRINTS THE WHOLE PLAN — every path, with its
 *     size — and then takes a typed phrase.
 *   - **Both moving arms refuse unless the deregistration is CONFIRMED** and
 *     unless the process check actually LOOKED. A guard that cannot tell "I
 *     found nothing" from "I could not look" is not a guard (review M2, M3);
 *     `--nothing-is-open` is the explicit override, the same flag and the same
 *     meaning `start-fresh` gives it.
 */
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";

import { Store, assertSafeDataDir, dateOf, isWithin, storeExists } from "../../core/store/index.js";
import { isJournal } from "../../core/sleep/index.js";
import { SCOPES_FILE_NAME } from "../scopes.js";
import { SNAPSHOTS_DIR_NAME, resolveSnapshotsDir } from "../snapshots.js";
import type { AdapterConfig } from "../claude-code/config.js";
import type { Io } from "./commands.js";
import { BIN, CONFIG_FILE, CREDENTIALS_FILE, MCP_SERVER_NAME } from "./install.js";
import {
  PARKED_INFIX,
  guardedMove,
  pairedSuffix,
  realpathDeep,
  sameFilesystemRefusal,
} from "./start-fresh.js";
import { confirm, typed, ui } from "./ui.js";
import type { Ui } from "./ui.js";
import type { Outcome, ProcessLister, Spawner, WireInput } from "./wire.js";
import { look, readMcp, unwire } from "./wire.js";

/** The phrase `--delete-memories` asks for, exactly. Case-sensitive, and
 *  nothing is trimmed but the end-of-line (`ui.ts#typed`). */
export const DELETE_PHRASE = "DELETE MEMORIES";

/** The one command that removes the package. A program does not delete itself
 *  out from under the process that is running it. */
export const REMOVE_PACKAGE = `bun remove -g ${BIN.cli}`;

// ── the forbidden-root clause, which every arm runs ─────────────────────────

/**
 * Is this path inside a live v1 store? Run on BOTH spellings, because
 * `assertSafeDataDir` is pure string math and follows no links, so a `--config`
 * inside a symlink into `~/.bansai` clears it on the written spelling alone
 * (`snapshots.ts#assertRotatableDir`, the F2 review's lesson).
 *
 * Every arm runs it, the plain one included: that arm renames nothing and
 * deletes nothing, but it READS — the size fallback walks the directory — and
 * the second safety rule forbids reading those stores as flatly as writing to
 * them.
 */
export function forbiddenBaseRefusal(base: string): string | null {
  const written = resolve(base);
  for (const spelling of [written, realpathDeep(written)]) {
    try {
      assertSafeDataDir(spelling);
    } catch (err) {
      const root =
        err !== null && typeof err === "object" && "detail" in err
          ? String((err as { detail: Record<string, unknown> }).detail["root"] ?? "a live store")
          : "a live store";
      return (
        `refused by name: ${spelling} is inside ${root}. That is a live memory this package ` +
        "never touches — not to read it, not to move it, not to rename it (CLAUDE.md, the " +
        "second safety rule)."
      );
    }
  }
  return null;
}

// ── what we own, by name ────────────────────────────────────────────────────

export type OwnedKind = "config" | "credentials" | "scopes" | "snapshots" | "store" | "sidecar";

/** The basenames this package writes inside a configuration directory. Built
 *  from the configuration rather than assumed, because three of the five are
 *  things the file itself can move. */
export interface OwnedNames {
  readonly config: string;
  /** Null when `credentialsFile` points somewhere else entirely. */
  readonly credentials: string | null;
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
  const credentials =
    config.credentialsFile === undefined || config.credentialsFile.trim().length === 0
      ? CREDENTIALS_FILE
      : resolve(dirname(resolve(config.credentialsFile))) === dir
        ? basename(resolve(config.credentialsFile))
        : null;
  const snaps =
    storeDir === null
      ? null
      : resolveSnapshotsDir(storeDir, config.snapshots?.dir).dir;
  return {
    config: basename(resolve(configPath)),
    credentials,
    scopes: SCOPES_FILE_NAME,
    snapshots:
      snaps !== null && resolve(dirname(snaps)) === dir ? basename(snaps) : null,
    store: storeDir !== null && resolve(dirname(storeDir)) === dir ? basename(storeDir) : null,
  };
}

/**
 * Is this entry name one this package writes, and which kind?
 *
 * The sidecars matter as much as the files: `keys.ts` and `scopes.ts` both
 * write `<path>.tmp` siblings, `start-fresh` leaves `store.parked-<date>`,
 * `store.blank-<date>` and `store.new-<pid>` behind, and `wire` leaves
 * `<file>.counterparts-backup-<stamp>`. A directory holding only those is still
 * a directory holding only ours.
 */
export function ownedKind(name: string, owned: OwnedNames): OwnedKind | null {
  if (name === owned.config) return "config";
  if (owned.credentials !== null && name === owned.credentials) return "credentials";
  if (name === owned.scopes) return "scopes";
  if (owned.snapshots !== null && name === owned.snapshots) return "snapshots";
  if (owned.store !== null && name === owned.store) return "store";
  const bases = [owned.config, owned.credentials, owned.scopes, owned.snapshots, owned.store];
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

// ── how much is about to go ─────────────────────────────────────────────────

export type Census =
  | {
      readonly kind: "memories";
      readonly memories: number;
      readonly journal: number;
      /** Beliefs, entities and the self page — `status`'s second population.
       *  Reported so a warning is never the bare word "0" while a store goes. */
      readonly schemas: number;
    }
  | { readonly kind: "size"; readonly bytes: number; readonly why: string };

/** Every byte under a path. Used for the printed plan and for the fallback when
 *  the store will not open, so a warning always carries a number. */
export function dirSize(path: string): number {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries) total += dirSize(join(path, name));
  return total;
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i] ?? "KB"}`;
}

/** `1,204` — the ruling's own spelling of a count. */
export function grouped(n: number): string {
  return n.toLocaleString("en-US");
}

/** `1,204 memories`, and `1 memory`. A brand-new install holds exactly one — its
 *  identity core — so "1 memories" was what somebody leaving after five minutes
 *  actually read. */
export function memories(n: number): string {
  return n === 1 ? "1 memory" : `${grouped(n)} memories`;
}

/**
 * How many memories are about to go — **the same number `status` calls
 * Memories** (review m5), plus the journal on its own line.
 *
 * It used to be `countMemories()` with no filter at all, which counts every
 * archived row, every superseded version, every belief, every entity, the self
 * page and the whole episode journal. On the owner's own store that reads high
 * by thousands, and the number is the ONE thing a person is consenting to. So
 * the population is the census's: not archived, not superseded, not a journal
 * episode, not a schema row — and the journal is reported beside it rather than
 * folded in, because it is a different thing that is also going.
 *
 * **READ-ONLY, AND OBSERVER** (review m6). This used to be a writer open, with
 * `initialize: true`, on the arm whose whole promise is that it changes
 * nothing: it could take the write lock against a live session (the I38
 * "database is locked" shape) and would migrate a schema-behind store during a
 * command that says it touches nothing. `storeExists` is checked first for a
 * second reason — `Store.open` CREATES what it opens, and a count must never be
 * the thing that mints a store.
 */
export function censusOf(base: string, storeDir: string | null): Census {
  const store = storeDir === null ? join(base, "store") : resolve(storeDir);
  if (!storeExists(store)) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: "there is no store this build recognises at the path the configuration names",
    };
  }
  try {
    const opened = Store.open({ dir: store, observer: true });
    try {
      const denied = new Set(opened.deniedIds());
      let live = 0;
      let journal = 0;
      let schemas = 0;
      for (const id of opened.list()) {
        const row = opened.row(id);
        if (row === undefined || denied.has(id)) continue;
        if (row.archived === 1) continue;
        if (row.superseded_by !== null) continue;
        if (isJournal(row)) {
          journal += 1;
          continue;
        }
        if (row.type === "schema") {
          schemas += 1;
          continue;
        }
        live += 1;
      }
      return { kind: "memories", memories: live, journal, schemas };
    } finally {
      opened.close();
    }
  } catch (err) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: `the store would not open on this build (${String((err as Error).message ?? err).split("\n")[0] ?? "no detail"})`,
    };
  }
}

/**
 * The warning's first line, in the ruling's own shape — `WARNING: this will
 * delete 1,204 memories.` — with two departures the pty drive earned.
 *
 * The journal rides BESIDE the count rather than inside it, because it is a
 * different population that is also going. And a store with **no memories yet**
 * never headlines a bare `0`: a fresh install holds an identity core and no
 * memories at all, so "this will delete 0 memories" was the whole warning while
 * two hundred kilobytes of store went. That case leads with the store instead.
 */
export function censusLine(census: Census, where: string): string {
  if (census.kind === "size") {
    return `WARNING: this will delete ${where} (${humanBytes(census.bytes)}).`;
  }
  const journal =
    census.journal === 0
      ? ""
      : ` + ${grouped(census.journal)} journal episode${census.journal === 1 ? "" : "s"}`;
  if (census.memories > 0) {
    return `WARNING: this will delete ${memories(census.memories)}${journal}.`;
  }
  const rest =
    census.schemas === 0
      ? ""
      : `, only ${grouped(census.schemas)} belief${census.schemas === 1 ? "" : "s"} or entit${
          census.schemas === 1 ? "y" : "ies"
        }`;
  const episodes = journal.replace(" + ", " and ");
  return `WARNING: this will delete your whole store: no memories in it yet${rest}${episodes}.`;
}

// ── the plan ────────────────────────────────────────────────────────────────

export interface PlanEntry {
  readonly path: string;
  /** In the words the printed plan uses. */
  readonly what: string;
  readonly bytes: number;
  readonly directory: boolean;
}

export interface UninstallPlan {
  readonly configDir: string;
  readonly configPath: string;
  /** `dataDir` as resolved, or null when the configuration names none. */
  readonly storeDir: string | null;
  readonly storeInside: boolean;
  /** True when the store is there and will be acted on. */
  readonly storeActed: boolean;
  /** Every path that will move or go, store first. */
  readonly entries: readonly PlanEntry[];
  /** Names in the configuration directory that are NOT ours. Never touched. */
  readonly foreign: readonly string[];
  /** True when the directory itself may move or go — it holds nothing else. */
  readonly wholeDirectory: boolean;
  /**
   * THE PATHS THAT ACTUALLY MOVE OR GO, in order — the one list both arms act
   * on, so a park and a delete cannot disagree about what this command's
   * subject is. It is the directory itself (plus an outside store) when nothing
   * foreign is in it, and our entries one by one when something is.
   */
  readonly targets: readonly string[];
  /**
   * The count, and ONLY on the arm that needs it.
   *
   * Null for `--park`, deliberately: counting means OPENING the store, and
   * `start-fresh`'s discipline — the store being moved is never opened, not
   * even read-only — is worth keeping for the arm that does not have to. The
   * printed plan gets its sizes from the filesystem either way.
   */
  readonly census: Census | null;
  readonly bytes: number;
  readonly refusal: string | null;
}

export interface PlanInput {
  readonly configPath: string;
  readonly config: AdapterConfig;
  readonly home: string;
  /** "park" or "delete", for the refusals' wording. */
  readonly verb: string;
}

/**
 * Read the ground and decide exactly what this command may act on.
 *
 * Pure but for the reads: it stats, lists and opens the store read-only, and it
 * changes nothing. The caller prints it before it asks.
 */
export function planUninstall(input: PlanInput): UninstallPlan {
  const configPath = resolve(input.configPath);
  const configDir = resolve(dirname(configPath));
  const written = input.config.dataDir;
  const storeDir =
    written === undefined || written.trim().length === 0
      ? null
      : isAbsolute(written.trim())
        ? resolve(written.trim())
        : null;
  // COUNTED ONLY WHEN IT IS ABOUT TO GO. See `UninstallPlan.census`.
  const census = input.verb === "delete" ? censusOf(configDir, storeDir) : null;
  const empty: UninstallPlan = {
    configDir,
    configPath,
    storeDir,
    storeInside: storeDir !== null && isWithin(configDir, storeDir),
    storeActed: false,
    entries: [],
    foreign: [],
    wholeDirectory: false,
    targets: [],
    census,
    bytes: 0,
    refusal: null,
  };

  const dirRefusal = configDirRefusal(configDir, configPath, input.home, input.verb);
  if (dirRefusal !== null) return { ...empty, refusal: dirRefusal };

  if (written !== undefined && written.trim().length > 0 && storeDir === null) {
    return {
      ...empty,
      refusal:
        `refused: ${configPath} names "${written.trim()}" as its store, which is not an absolute ` +
        "path — it means a different directory in every process that reads it. This will not " +
        `${input.verb} whatever happens to sit at that name.`,
    };
  }
  if (storeDir !== null && existsSync(storeDir)) {
    const storeWhy = storeRefusal(storeDir, input.home, input.verb);
    if (storeWhy !== null) return { ...empty, refusal: storeWhy };
  }

  // ── what is in the configuration directory, ours and not ──────────────────
  const owned = ownedNames(configPath, input.config, storeDir);
  const ours: PlanEntry[] = [];
  const foreign: string[] = [];
  let names: string[];
  try {
    names = readdirSync(configDir).sort();
  } catch (err) {
    return {
      ...empty,
      refusal: `refused: ${configDir} could not be listed (${String((err as Error).message ?? err)}).`,
    };
  }
  for (const name of names) {
    const kind = ownedKind(name, owned);
    if (kind === null) {
      foreign.push(name);
      continue;
    }
    if (kind === "store") continue; // added first, below, wherever it lives
    const path = join(configDir, name);
    ours.push({
      path,
      what: WHAT[kind],
      bytes: dirSize(path),
      directory: isDirectory(path),
    });
  }

  // THE STORE IS FIRST AND IT IS ITS OWN ENTRY, wherever it lives (review M1).
  const entries: PlanEntry[] = [];
  const storeActed = storeDir !== null && existsSync(storeDir);
  if (storeActed && storeDir !== null) {
    entries.push({
      path: storeDir,
      what: "your memory",
      bytes: dirSize(storeDir),
      directory: true,
    });
  }
  entries.push(...ours);

  // A STORE THAT LIVES ELSEWHERE DOES NOT MAKE THE DIRECTORY FOREIGN. It is
  // simply one more target beside it, and the directory it left behind still
  // holds nothing but ours.
  const wholeDirectory = foreign.length === 0;
  const storeOutside = storeActed && storeDir !== null && !isWithin(configDir, storeDir);
  const targets = wholeDirectory
    ? [...(storeOutside && storeDir !== null ? [storeDir] : []), configDir]
    : entries.map((e) => e.path);
  return {
    ...empty,
    storeActed,
    entries,
    foreign,
    wholeDirectory,
    targets,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    refusal: null,
  };
}

const WHAT: Record<OwnedKind, string> = {
  config: "the configuration",
  credentials: "the credentials file",
  scopes: "the scope registry",
  snapshots: "the snapshots",
  store: "your memory",
  sidecar: "a file this package left",
};

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Why this CONFIGURATION DIRECTORY may not be acted on, or null.
 *
 * `start-fresh`'s ring, plus the four the blocker added: the host's own
 * `~/.claude`, the home directory, any PARENT of the home directory, and
 * anything holding a `.git`.
 */
export function configDirRefusal(
  configDir: string,
  configPath: string,
  home: string,
  verb: string,
): string | null {
  // THE RAW SPELLING DECIDES THIS ONE. `resolve()` is relative to the process
  // working directory and always hands back an absolute path, so a test on the
  // resolved value can never fail — and a relative `dataDir` or `--config`
  // names a different directory in every process that reads it.
  const raw = configDir.trim();
  if (raw.length === 0) {
    return `refused: nothing named a directory to ${verb}.`;
  }
  if (!isAbsolute(raw)) {
    return (
      `refused: "${raw}" is not an absolute path, so it names a different directory in every ` +
      `process that reads it. This will not ${verb} whatever happens to sit at that name in ` +
      `its own working directory (${resolve(raw)}).`
    );
  }
  const written = resolve(raw);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null) return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root) {
    return `refused: ${written} resolves to a filesystem root (${real}). Nothing here will ${verb} that.`;
  }
  if (real === realHome) {
    return `refused: ${written} resolves to your home directory (${real}). Nothing here will ${verb} that.`;
  }
  if (isWithin(real, realHome)) {
    return (
      `refused: ${written} resolves to ${real}, which CONTAINS your home directory. ` +
      `Nothing here will ${verb} that.`
    );
  }
  if (!isWithin(realHome, real)) {
    return (
      `refused: ${written} resolves to ${real}, which is outside your home directory ` +
      `(${realHome}). This command acts on what an install of yours wrote; a path anywhere ` +
      "else is one somebody else is responsible for."
    );
  }
  // THE HOST'S OWN DIRECTORY, BY NAME. `install --config ~/.claude/claude-code.json`
  // is a command somebody can type, and the first version of this file renamed
  // Claude Code's settings, project transcripts and todos away under a heading
  // that said "Your memory, parked".
  if (real === realpathDeep(join(home, ".claude"))) {
    return (
      `refused: ${written} is Claude Code's own configuration directory. Whatever this ` +
      "install put there, the settings, the project transcripts and the todos beside it are " +
      `the host's, and this command will not ${verb} them. Move the configuration somewhere ` +
      "of its own and run this again."
    );
  }
  if (existsSync(join(written, ".git"))) {
    return (
      `refused: ${written} holds a .git, so it is a repository somebody is working in. ` +
      `This command will not ${verb} a directory whose contents are under version control ` +
      "alongside a configuration that happens to sit in it."
    );
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return `refused: ${written} is not there, so there is nothing to ${verb}.`;
  }
  if (stat.isSymbolicLink()) {
    return (
      `refused: ${written} is a SYMBOLIC LINK (to ${real}). Renaming a link moves the link and ` +
      "leaves the real directory exactly where it is — and removing one removes the link while " +
      "the memories stay live and unreachable. Act on the real directory by hand."
    );
  }
  if (!stat.isDirectory()) {
    return `refused: ${written} is not a directory.`;
  }
  if (!existsSync(configPath)) {
    return (
      `refused: ${configPath} is not there, so this is not a Counterparts install to ${verb}.`
    );
  }
  return null;
}

/**
 * Why the STORE may not be acted on, or null — the same ring, applied to the
 * one thing that can live anywhere (review M1).
 *
 * A store that fails any of these is a refusal rather than something left
 * behind: the whole purpose of both moving arms is the memory, and a `--park`
 * that parked a configuration and left the memory live somewhere else is the
 * lie the review found.
 */
export function storeRefusal(storeDir: string, home: string, verb: string): string | null {
  const written = resolve(storeDir);
  const forbidden = forbiddenBaseRefusal(written);
  if (forbidden !== null) return forbidden;
  const real = realpathDeep(written);
  const realHome = realpathDeep(home);
  if (real === parsePath(real).root || real === realHome || isWithin(real, realHome)) {
    return `refused: the store resolves to ${real}. Nothing here will ${verb} that.`;
  }
  if (!isWithin(realHome, real)) {
    return (
      `refused: the store is at ${real}, outside your home directory (${realHome}). This ` +
      `command will not ${verb} it there. Move it by hand, or point "dataDir" somewhere of ` +
      "your own first."
    );
  }
  let stat;
  try {
    stat = lstatSync(written);
  } catch {
    return null; // not there: nothing to act on, and not a refusal
  }
  if (stat.isSymbolicLink()) {
    return (
      `refused: the store at ${written} is a SYMBOLIC LINK (to ${real}). Renaming one moves the ` +
      "link and leaves the memories exactly where they are; removing one leaves them live and " +
      "unreachable. Act on the real directory by hand."
    );
  }
  if (!stat.isDirectory()) {
    return `refused: the store at ${written} is not a directory.`;
  }
  if (!storeExists(written)) {
    return (
      `refused: ${written} does not look like a Counterparts store — nothing this build ` +
      `recognises as one is in it. This will not ${verb} a directory on the strength of a ` +
      `"dataDir" alone.`
    );
  }
  return null;
}

// ── printing it ─────────────────────────────────────────────────────────────

/** The plan, path by path, with sizes — printed BEFORE anything is asked. */
export function planLines(plan: UninstallPlan, verb: "park" | "delete", home: string): string[] {
  const out: string[] = [];
  const width = plan.entries.reduce((n, e) => Math.max(n, e.path.length), 0);
  out.push(verb === "park" ? "This will move, one rename each:" : "This will delete:");
  for (const e of plan.entries) {
    out.push(`  ${e.path.padEnd(Math.min(width, 60))}  ${humanBytes(e.bytes)}  — ${e.what}`);
  }
  if (plan.entries.length === 0) out.push("  (nothing — there is none of ours left here)");
  if (plan.wholeDirectory) {
    out.push(`  and ${plan.configDir} itself, which holds nothing but the above.`);
  } else if (plan.foreign.length > 0) {
    out.push("");
    out.push(
      `  ${plan.configDir} itself STAYS. It also holds ` +
        (plan.foreign.length === 1
          ? "1 thing that is not ours:"
          : `${String(plan.foreign.length)} things that are not ours:`),
    );
    for (const name of plan.foreign.slice(0, 12)) out.push(`    ${name}`);
    if (plan.foreign.length > 12) out.push(`    … and ${String(plan.foreign.length - 12)} more`);
    out.push("  None of those is touched.");
  }
  if (plan.storeDir !== null && !plan.storeInside) {
    out.push("");
    out.push(`  Your memory is NOT inside that directory — it is at ${plan.storeDir},`);
    out.push(`  and it is ${verb === "park" ? "moved" : "deleted"} there, on its own line above.`);
  }
  if (plan.storeDir !== null && !plan.storeActed) {
    out.push("");
    out.push(`  There is no store at ${plan.storeDir}, so no memory is ${verb === "park" ? "moved" : "deleted"}.`);
  }
  void home;
  return out;
}

// ── the command ─────────────────────────────────────────────────────────────

export interface UninstallInput {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  readonly configPath: string;
  readonly custom: string | undefined;
  /** The whole configuration, so the plan can find the store, the credentials
   *  file and the snapshots wherever the file put them. */
  readonly config: AdapterConfig;
  readonly now: number;
  readonly yes: boolean;
  readonly park: boolean;
  readonly deleteMemories: boolean;
  /** The assertion that every session, dashboard and MCP server is closed —
   *  the same flag and the same meaning `start-fresh` gives it. Only a way past
   *  a process check that could not LOOK; it never excuses one that found
   *  something. */
  readonly nothingIsOpen: boolean;
  readonly exe: string;
  readonly spawner: Spawner;
  readonly lister: ProcessLister;
}

export async function uninstall(input: UninstallInput): Promise<Outcome> {
  const { io, env, home } = input;
  const u = ui(io, env);
  const configDir = resolve(join(input.configPath, ".."));
  const moving = input.park || input.deleteMemories;
  const verb = input.park ? "park" : "delete";

  u.heading(`${BIN.cli} uninstall`);
  u.hint(`configuration: ${input.configPath}`);
  u.blank();

  // ── BEFORE EVERY ARM, including the one that only reads ──────────────────
  const forbidden = forbiddenBaseRefusal(configDir);
  if (forbidden !== null) {
    io.err(forbidden);
    io.err("Nothing has changed and nothing was read.");
    return "refused";
  }

  // ── the two flags are one choice ─────────────────────────────────────────
  if (input.park && input.deleteMemories) {
    io.err(
      "refused: --park moves your memory aside and --delete-memories destroys it. They are two " +
        "answers to one question, and this will not guess which one you meant.",
    );
    return "refused";
  }

  let plan: UninstallPlan | null = null;
  if (moving) {
    plan = planUninstall({ configPath: input.configPath, config: input.config, home, verb });
    if (plan.refusal !== null) {
      io.err(plan.refusal);
      io.err("Nothing has changed.");
      return "refused";
    }
    if (input.park) {
      // `plan.targets`, NOT `plan.entries`: when the directory moves whole it
      // is the directory that is renamed, and checking only the things inside
      // it left a `~/.counterparts` that is its own mount point to fail at
      // `renameSync` with EXDEV instead of refusing up front.
      for (const entry of plan.targets) {
        const cross = sameFilesystemRefusal(entry);
        if (cross !== null) {
          io.err(cross);
          io.err("Nothing has changed.");
          return "refused";
        }
      }
    }

    // ── AND NOTHING OF OURS MAY BE RUNNING — FAILING CLOSED (review M3) ─────
    //
    // A rename does not break an open file handle: an MCP server or a worker
    // would go on writing into the PARKED directory. A delete is worse: the
    // writes go nowhere at all and nothing says so. And a check that cannot
    // tell "I found nothing" from "I could not look" is not a check — the
    // review parked a store on a box with no `ps` and got no word about it.
    const sighting = look(input.lister);
    if (!sighting.looked && !input.nothingIsOpen) {
      io.err(
        "refused: this could not check whether anything of ours is still running — there is no " +
          "usable `ps` here, or it would not answer. A rename does not break an open file handle " +
          "and a delete does not tell a running process it has gone, so this will not proceed on " +
          "a look that did not happen. Close every Claude Code session, dashboard and worker, and " +
          "say so: --nothing-is-open.",
      );
      io.err("Nothing has changed.");
      return "refused";
    }
    if (sighting.processes.length > 0) {
      io.err(
        `refused: ${String(sighting.processes.length)} Counterparts process${sighting.processes.length === 1 ? " is" : "es are"} still running:`,
      );
      for (const p of sighting.processes) io.err(`  ${p.what}, pid ${String(p.pid)}`);
      io.err(
        "A rename does not break an open file handle and a delete does not tell a running " +
          "process it has gone. Close Claude Code sessions and try again.",
      );
      io.err("Nothing has changed.");
      return "refused";
    }

    // ── AND `claude` MUST BE REACHABLE IF THERE IS ANYTHING TO DEREGISTER ──
    //
    // The pre-flight half of review M2: the common failure is `claude` simply
    // not on this PATH, and finding that out AFTER the hooks are gone costs a
    // person their wiring for nothing. `claude mcp list` is read-only.
    const preflight = mcpPreflight(input, home);
    if (preflight !== null) {
      io.err(preflight);
      io.err("Nothing has changed.");
      return "refused";
    }

    // ── THE PLAN, PRINTED, BEFORE A SINGLE QUESTION ────────────────────────
    u.blank();
    for (const line of planLines(plan, input.park ? "park" : "delete", home)) io.out(line);
    u.blank();
  }

  // ── the count, and the typed phrase, BEFORE the hooks come out ───────────
  if (input.deleteMemories && plan !== null && plan.census !== null) {
    if (io.prompt === undefined) {
      io.err(
        "refused: --delete-memories needs a person. It has no --yes and never will: the typed " +
          "phrase is the whole guard, and a script that could supply it would be a script that " +
          "deletes somebody's memory by having the right string in it.",
      );
      return "refused";
    }
    const census = plan.census;
    u.fail(censusLine(census, plan.configDir));
    if (census.kind === "size") u.hint(`The count could not be taken: ${census.why}.`);
    u.hint(`Everything listed above goes — ${humanBytes(plan.bytes)} in total.`);
    u.hint(`Nothing is recoverable from this package afterwards. ${BIN.cli} uninstall --park`);
    u.hint("moves the same things aside instead.");
    u.blank();
    const said = await typed(io, DELETE_PHRASE, `Type ${DELETE_PHRASE} to go ahead: `);
    if (!said) {
      io.err(`refused: that was not "${DELETE_PHRASE}". Nothing was deleted and nothing was changed.`);
      return "refused";
    }
  } else if (!input.yes) {
    if (io.prompt === undefined) {
      io.err(
        "refused: this is not an interactive console and nothing was confirmed. Pass --yes if " +
          "that is what you mean.",
      );
      return "refused";
    }
    u.hint(
      input.park
        ? "This removes the Claude Code wiring and moves the things listed above aside."
        : "This removes the Claude Code wiring. Your memory stays exactly where it is.",
    );
    const go = await confirm(io, "Go ahead?", { default: true });
    if (!go) {
      u.hint("Nothing has changed.");
      return "ok";
    }
  }

  // ── the wiring ────────────────────────────────────────────────────────────
  const wireInput: WireInput = {
    io,
    env,
    home,
    configPath: input.configPath,
    custom: input.custom,
    store: input.config.dataDir ?? join(configDir, "store"),
    now: input.now,
    yes: true,
    dryRun: false,
    exe: input.exe,
    spawner: input.spawner,
    lister: input.lister,
    heading: true,
  };
  u.blank();
  const removed = await unwire(wireInput);
  if (removed.outcome !== "ok") {
    io.err("");
    io.err(
      moving
        ? "The wiring could not be removed, so NOTHING WAS MOVED OR DELETED — hooks pointing at " +
          "a directory that is not there fail at every session start, silently. Fix the above " +
          "and run this again."
        : "The wiring could not be removed. Your memory is untouched.",
    );
    return removed.outcome;
  }
  // ── THE DEREGISTRATION IS CONFIRMED, OR THIS STOPS HERE (review M2) ───────
  if (moving && !removed.mcpConfirmed) {
    io.err("");
    io.err(
      "refused: the MCP registration is still there and this could not remove it, so NOTHING " +
        "WAS MOVED OR DELETED. A server pointed at a store that is gone fails at every session " +
        "start with nothing on screen — which is the same reason the hooks are not left behind " +
        "either. Run the line above, then run this again.",
    );
    io.err(`The hooks are out; \`${BIN.cli} wire\` puts them back if you want them.`);
    return "refused";
  }

  // ── the memory ────────────────────────────────────────────────────────────
  u.blank();
  if (plan !== null && input.park) return parkPlan(input, u, plan);
  if (plan !== null && input.deleteMemories) return deletePlan(input, u, plan);

  u.heading("Your memory");
  const kept = censusOf(configDir, input.config.dataDir ?? null);
  u.ok(
    kept.kind === "memories"
      ? `${memories(kept.memories)} ${kept.memories === 1 ? "is" : "are"} still at ${input.config.dataDir ?? join(configDir, "store")}.`
      : `everything is still at ${configDir} (${humanBytes(kept.bytes)}).`,
  );
  u.hint("Nothing here deleted anything. To move it aside under a dated name:");
  u.hint(`  ${BIN.cli} uninstall --park`);
  u.hint("To destroy it (it prints the whole plan first, then asks you to type a phrase):");
  u.hint(`  ${BIN.cli} uninstall --delete-memories`);
  u.blank();
  u.heading("The package itself");
  u.hint("A program does not delete itself while it is running, so this is yours to run:");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}

/**
 * Is `claude` reachable, when there is a registration that has to go?
 *
 * The pre-flight half of review M2, and it is deliberately narrow: **it only
 * bites when a registration is actually there.** A person who never wired, or
 * who drives this package from another host entirely, has nothing to deregister
 * and must not be stopped by a binary they do not need. The first cut asked
 * unconditionally and refused every `--park` on a box without `claude` — the
 * opposite failure, and it showed up on the very repro it was written for.
 *
 * Read-only: `claude mcp list` changes nothing. A registration we cannot SEE is
 * not a reason to refuse either; `unwire`'s own confirmation covers that one
 * after the fact, before anything irreversible happens.
 */
function mcpPreflight(input: UninstallInput, home: string): string | null {
  const mcp = readMcp(home, input.env, input.config.dataDir ?? "", input.custom, input.exe);
  if (!mcp.present && !mcp.unreadable) return null;
  // MISSING, HANGING **AND** ANGRY. A `spawnSync` that timed out comes back
  // `missing: false, code: null`, and a `claude` that exits non-zero on a
  // read-only `mcp list` is one that will not manage a removal either. Testing
  // only `missing` meant a hung binary passed the pre-flight, the hooks came
  // out, and the refusal landed thirty seconds later on the removal instead.
  const probe = input.spawner(["mcp", "list"]);
  if (!probe.missing && probe.code === 0) return null;
  const why = probe.missing
    ? "`claude` is not on this PATH"
    : probe.code === null
      ? "`claude` did not answer"
      : `\`claude mcp list\` exited ${String(probe.code)}`;
  return (
    `refused: ${mcp.file} ${mcp.unreadable ? "could not be read, so a registration may still be there" : `still registers "${MCP_SERVER_NAME}"`}, and ${why}, ` +
    "so it cannot be deregistered — this will not move or delete a store while something may " +
    "still be registered to open it. Fix that, or run " +
    `\`claude mcp remove ${MCP_SERVER_NAME} -s user\` yourself first, then run this again.`
  );
}

/** ONE atomic rename per thing, never a copy, and the store is never opened. */
function parkPlan(input: UninstallInput, u: Ui, plan: UninstallPlan): Outcome {
  const { io } = input;
  const date = dateOf(input.now);
  const all = [...plan.targets];
  if (all.length === 0) {
    u.heading("Nothing to park");
    u.hint("None of this install's own files is still here.");
    return "ok";
  }
  // ONE SUFFIX FOR EVERYTHING THIS RUN MOVES, so a set of parked things reads
  // as a set (`start-fresh#pairedSuffix`, same reason).
  let suffix: string;
  try {
    suffix = pairedSuffix(all, date);
  } catch (err) {
    io.err(`refused: ${String((err as Error).message ?? err)}`);
    io.err("Nothing has changed.");
    return "refused";
  }

  const done: { from: string; to: string }[] = [];
  for (const from of all) {
    const to = `${from}${suffix}`;
    try {
      renameSync(from, to);
      done.push({ from, to });
    } catch (err) {
      io.err(`failed to park ${from}: ${String((err as Error).message ?? err)}`);
      io.err(
        done.length === 0
          ? "Nothing was moved. The wiring has been removed; `counterparts wire` puts it back."
          : "What is listed below HAS moved; nothing else has, and nothing was deleted.",
      );
      for (const d of done) io.err(`  ${d.from} -> ${d.to}`);
      return "failed";
    }
  }

  u.heading("Parked");
  for (const d of done) {
    u.ok(d.from);
    u.hint(`  -> ${d.to}`);
  }
  u.hint("One rename each. Nothing was copied, nothing was deleted, and the store was never");
  u.hint("opened — not even read-only, which is why this arm does not print a count.");
  if (!plan.storeActed) {
    u.hint("No memory was moved: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(`${plan.configDir} itself was left where it is, with everything in it that is not ours.`);
  }
  u.blank();
  u.heading("To undo this");
  u.hint("Paste the line below. It refuses, rather than nesting one folder inside another,");
  u.hint("if the original path exists again by then (say, because you installed again).");
  for (const d of done) io.out(guardedMove(d.to, d.from));
  u.blank();
  u.heading("The package itself");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}

/** The only delete in this package, and it happens after everything above. */
function deletePlan(input: UninstallInput, u: Ui, plan: UninstallPlan): Outcome {
  const { io } = input;
  const gone: string[] = [];
  for (const path of plan.targets) {
    try {
      rmSync(path, { recursive: true, force: true });
      gone.push(path);
    } catch (err) {
      io.err(`failed to delete ${path}: ${String((err as Error).message ?? err)}`);
      io.err("What is listed below is gone; nothing else was touched.");
      for (const g of gone) io.err(`  ${g}`);
      return "failed";
    }
  }

  u.heading("Deleted");
  // EXACTLY WHAT WENT, PATH BY PATH (review M1). Never "your memory is gone"
  // unless the store itself went.
  for (const path of gone) u.ok(path);
  if (plan.storeActed) {
    u.hint(
      plan.census !== null && plan.census.kind === "memories"
        ? `${memories(plan.census.memories)} ${plan.census.memories === 1 ? "is" : "are"} gone with it.`
        : "Your memory went with it.",
    );
  } else {
    u.hint("No memory was deleted: there was no store at the path the configuration named.");
  }
  if (plan.foreign.length > 0) {
    u.hint(`${plan.configDir} itself is still there, with everything in it that is not ours.`);
  }
  u.hint("Nothing in this package can bring the rest back.");
  u.blank();
  u.heading("The package itself");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}
