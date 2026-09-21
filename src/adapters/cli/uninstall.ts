/**
 * `counterparts uninstall` — leave, and leave the memory alone.
 *
 * **The owner's ruling, 2026-09-21, quoted from `docs/new-user-findings.md`:**
 *
 *   > Uninstall leaves `~/.counterparts` in place by default. `--park` moves it
 *   > aside under a dated name. `--delete-memories` deletes it, and only after a
 *   > warning that counts what is about to go — `WARNING: this will delete 1,204
 *   > memories.` — and the person typing `DELETE MEMORIES` exactly. No `--yes`
 *   > for that one.
 *
 * Everything below is that paragraph, mechanized. The shape of it:
 *
 *   - **The default removes WIRING, never memory.** It unwires Claude Code, says
 *     plainly where the memory still is and how much of it there is, and gives
 *     the one command that removes the package — `bun remove -g counterparts`,
 *     because a program cannot cleanly delete itself while it is running.
 *   - **`--park` is one `rename(2)`.** Never a copy, never a delete, and the
 *     store is never opened. The single `mv` that undoes it is printed, guarded
 *     the way `start-fresh` guards its way back (a bare `mv` onto an existing
 *     directory moves the source INSIDE it, silently).
 *   - **`--delete-memories` is the only destructive verb in this package**, and
 *     it is the one with no `--yes`. It counts first, warns with the number,
 *     and takes a typed phrase — which cannot be answered by reflex, which is
 *     the whole reason a phrase is asked for instead of a letter.
 *   - **Both of those refuse while anything of ours is running.** An MCP server,
 *     the worker or a dashboard holding the directory open turns a rename into a
 *     process writing into a parked directory, and a delete into a process
 *     writing into nothing. The plain uninstall does not refuse: it changes no
 *     directory, so an open session simply keeps what it already has.
 *
 * THE PATH RING is `start-fresh`'s lesson taken whole (`start-fresh.ts`'s "ONE
 * GUARD RING"): every path this command would rename or remove goes through the
 * same function, in the same order, whichever flag asked for it. The clauses
 * differ from `start-fresh`'s only where the subject does — this acts on the
 * CONFIGURATION DIRECTORY rather than on the store inside it, so "contains the
 * configuration" is the normal case here rather than a refusal.
 */
import { existsSync, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, parse as parsePath, resolve } from "node:path";

import { Store, assertSafeDataDir, dateOf, isWithin, storeExists } from "../../core/store/index.js";
import type { Io } from "./commands.js";
import { BIN, CONFIG_FILE } from "./install.js";
import { PARKED_INFIX, guardedMove, parkedPath, realpathDeep, sameFilesystemRefusal } from "./start-fresh.js";
import { confirm, typed, ui } from "./ui.js";
import type { Outcome, ProcessLister, Spawner, WireInput } from "./wire.js";
import { unwire } from "./wire.js";

/** The phrase `--delete-memories` asks for, exactly. Case-sensitive, and
 *  nothing is trimmed but the end-of-line (`ui.ts#typed`). */
export const DELETE_PHRASE = "DELETE MEMORIES";

/** The one command that removes the package. A program does not delete itself
 *  out from under the process that is running it. */
export const REMOVE_PACKAGE = `bun remove -g ${BIN.cli}`;

// ── the path ring ───────────────────────────────────────────────────────────

/**
 * Why this configuration directory may not be renamed or removed, or null.
 *
 * Every clause is one way a path can turn out to name somewhere that matters,
 * and the order is the order in which a wrong answer does the most damage.
 * `assertSafeDataDir` runs on BOTH spellings — the path as written and the path
 * as it resolves — because it is pure string math and follows no links, so a
 * `--config` inside a symlink into `~/.bansai` clears it on the written
 * spelling alone (`snapshots.ts#assertRotatableDir`, the F2 review's lesson).
 */
export function baseRefusal(base: string, home: string, verb: string): string | null {
  const raw = base.trim();
  if (raw.length === 0) {
    return `refused: there is no directory to ${verb} — nothing named one.`;
  }
  if (!isAbsolute(raw)) {
    return (
      `refused: "${raw}" is not an absolute path, so it names a different directory in every ` +
      `process that reads it. This will not ${verb} whatever happens to sit at that name in ` +
      `its own working directory (${resolve(raw)}).`
    );
  }
  const written = resolve(raw);
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
  const real = realpathDeep(written);
  if (real === parsePath(real).root) {
    return `refused: ${written} resolves to a filesystem root (${real}). Nothing here will ${verb} that.`;
  }
  const realHome = realpathDeep(home);
  if (real === realHome) {
    return `refused: ${written} resolves to your home directory (${real}). Nothing here will ${verb} that.`;
  }
  if (!isWithin(realHome, real)) {
    return (
      `refused: ${written} resolves to ${real}, which is outside your home directory ` +
      `(${realHome}). This command ${verb}s the directory an install of yours created; a path ` +
      "anywhere else is one somebody else is responsible for."
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
  if (!existsSync(join(written, CONFIG_FILE))) {
    return (
      `refused: ${written} does not hold ${CONFIG_FILE}, so it does not look like a ` +
      `Counterparts configuration directory. This command will not ${verb} a directory on the ` +
      "strength of a path alone."
    );
  }
  return null;
}

// ── how much is about to go ─────────────────────────────────────────────────

export type Census =
  | { readonly kind: "memories"; readonly n: number }
  | { readonly kind: "size"; readonly bytes: number; readonly why: string };

/** Every byte under a directory. Used only when the store will not open, so
 *  that the warning still carries a number rather than a shrug. */
export function dirSize(path: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries) {
    const child = join(path, name);
    try {
      const stat = lstatSync(child);
      if (stat.isDirectory()) total += dirSize(child);
      else total += stat.size;
    } catch {
      continue;
    }
  }
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

/**
 * How many memories are about to go — or, when the store will not open on this
 * build, how big the directory is instead.
 *
 * The second arm is not a corner case. A store written before this build's
 * floor is refused BY NAME (`STORE_PRE_ROWS`), which is exactly the state a
 * person who is uninstalling after an upgrade went wrong is in. A warning that
 * said "0 memories" there would be the most dangerous sentence this command
 * could print, so a store that will not open produces a size and says why.
 */
export function censusOf(base: string, dataDir: string | undefined): Census {
  const store = dataDir !== undefined && dataDir.trim().length > 0 ? resolve(dataDir) : join(base, "store");
  if (!storeExists(store)) {
    return {
      kind: "size",
      bytes: dirSize(base),
      why: "there is no store this build recognises at the path the configuration names",
    };
  }
  try {
    const opened = Store.open({ dir: store });
    try {
      return { kind: "memories", n: opened.countMemories() };
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

/** `1,204` — the ruling's own spelling of a count. */
export function grouped(n: number): string {
  return n.toLocaleString("en-US");
}

// ── the command ─────────────────────────────────────────────────────────────

export interface UninstallInput {
  readonly io: Io;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  readonly configPath: string;
  readonly custom: string | undefined;
  /** `dataDir` from the configuration, when it names one. */
  readonly dataDir: string | undefined;
  readonly now: number;
  readonly yes: boolean;
  readonly park: boolean;
  readonly deleteMemories: boolean;
  readonly exe: string;
  readonly spawner: Spawner;
  readonly lister: ProcessLister;
}

export async function uninstall(input: UninstallInput): Promise<Outcome> {
  const { io, env, home } = input;
  const u = ui(io, env);
  const base = resolve(join(input.configPath, ".."));
  const moving = input.park || input.deleteMemories;

  u.heading(`${BIN.cli} uninstall`);
  u.hint(`configuration: ${input.configPath}`);
  u.hint(`memory:        ${base}`);
  u.blank();

  // ── the two flags are one choice ─────────────────────────────────────────
  if (input.park && input.deleteMemories) {
    io.err(
      "refused: --park moves your memory aside and --delete-memories destroys it. They are two " +
        "answers to one question, and this will not guess which one you meant.",
    );
    return "refused";
  }

  // ── the path ring, BEFORE anything is unwired ────────────────────────────
  if (moving) {
    const why = baseRefusal(base, home, input.park ? "park" : "delete");
    if (why !== null) {
      io.err(why);
      io.err("Nothing has changed.");
      return "refused";
    }
    if (input.park) {
      const cross = sameFilesystemRefusal(base);
      if (cross !== null) {
        io.err(cross);
        io.err("Nothing has changed.");
        return "refused";
      }
    }
    // ── AND NOTHING OF OURS MAY BE RUNNING ─────────────────────────────────
    //
    // A rename does not break an open file handle: an MCP server or a worker
    // would go on writing into the PARKED directory, which is the one thing
    // that could stop it being byte-identical to this moment. A delete is
    // worse: the writes go nowhere at all and nothing says so.
    let running: readonly { pid: number; what: string }[] = [];
    try {
      running = input.lister();
    } catch {
      running = [];
    }
    if (running.length > 0) {
      io.err(
        `refused: ${String(running.length)} Counterparts process${running.length === 1 ? " is" : "es are"} still running:`,
      );
      for (const p of running) io.err(`  ${p.what}, pid ${String(p.pid)}`);
      io.err(
        "A rename does not break an open file handle and a delete does not tell a running " +
          "process it has gone. Close Claude Code sessions and try again.",
      );
      io.err("Nothing has changed.");
      return "refused";
    }
  }

  // ── the count, and the typed phrase, BEFORE the hooks come out ───────────
  //
  // Asked first on purpose: a person who mistypes the phrase should still have
  // a wired install, not a machine that has lost its hooks for nothing.
  let census: Census | null = null;
  if (input.deleteMemories) {
    if (io.prompt === undefined) {
      io.err(
        "refused: --delete-memories needs a person. It has no --yes and never will: the typed " +
          "phrase is the whole guard, and a script that could supply it would be a script that " +
          "deletes somebody's memory by having the right string in it.",
      );
      return "refused";
    }
    census = censusOf(base, input.dataDir);
    u.blank();
    if (census.kind === "memories") {
      u.fail(`WARNING: this will delete ${grouped(census.n)} memories.`);
    } else {
      u.fail(`WARNING: this will delete ${base} (${humanBytes(census.bytes)}).`);
      u.hint(`The count could not be taken: ${census.why}.`);
    }
    u.hint("Everything under that directory goes: the store, the configuration, the");
    u.hint("credentials file, the scopes registry and every snapshot. Nothing is recoverable");
    u.hint(`from this package afterwards. ${BIN.cli} uninstall --park moves it aside instead.`);
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
        ? "This removes the Claude Code wiring and moves your memory aside under a dated name."
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
    store: input.dataDir ?? join(base, "store"),
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

  // ── the memory ────────────────────────────────────────────────────────────
  u.blank();
  if (input.park) return parkBase(input, u, base);
  if (input.deleteMemories) return deleteBase(input, u, base, census);

  u.heading("Your memory");
  const kept = censusOf(base, input.dataDir);
  u.ok(
    kept.kind === "memories"
      ? `${grouped(kept.n)} memories are still at ${base}.`
      : `everything is still at ${base} (${humanBytes(kept.bytes)}).`,
  );
  u.hint("Nothing here deleted anything. To move it aside under a dated name:");
  u.hint(`  ${BIN.cli} uninstall --park`);
  u.hint("To destroy it (it counts first, and asks you to type a phrase):");
  u.hint(`  ${BIN.cli} uninstall --delete-memories`);
  u.blank();
  u.heading("The package itself");
  u.hint("A program does not delete itself while it is running, so this is yours to run:");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}

/** ONE atomic rename, never a copy, and the store is never opened. */
function parkBase(input: UninstallInput, u: ReturnType<typeof ui>, base: string): Outcome {
  const { io } = input;
  let to: string;
  try {
    to = parkedPath(base, PARKED_INFIX, dateOf(input.now));
  } catch (err) {
    io.err(`refused: ${String((err as Error).message ?? err)}`);
    io.err("Nothing has changed.");
    return "refused";
  }
  try {
    renameSync(base, to);
  } catch (err) {
    io.err(`failed to park ${base}: ${String((err as Error).message ?? err)}`);
    io.err("Nothing was moved. The wiring has been removed; `counterparts wire` puts it back.");
    return "failed";
  }
  u.heading("Your memory, parked");
  u.ok(`${base}`);
  u.hint(`  -> ${to}`);
  u.hint("One rename. Nothing was copied, nothing was deleted, and the store was never opened.");
  u.blank();
  u.hint("The one line that undoes it — it REFUSES rather than moving one directory inside");
  u.hint("another, which is what a bare `mv` does when the destination exists:");
  io.out(guardedMove(to, base));
  u.blank();
  u.heading("The package itself");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}

/** The only delete in this package, and it happens after everything above. */
function deleteBase(
  input: UninstallInput,
  u: ReturnType<typeof ui>,
  base: string,
  census: Census | null,
): Outcome {
  const { io } = input;
  try {
    rmSync(base, { recursive: true, force: true });
  } catch (err) {
    io.err(`failed to delete ${base}: ${String((err as Error).message ?? err)}`);
    io.err("Some of it may be gone. The wiring has been removed.");
    return "failed";
  }
  u.heading("Deleted");
  u.ok(
    census !== null && census.kind === "memories"
      ? `${grouped(census.n)} memories are gone, and so is ${base}.`
      : `${base} is gone.`,
  );
  u.hint("Nothing in this package can bring it back.");
  u.blank();
  u.heading("The package itself");
  u.hint(`  ${REMOVE_PACKAGE}`);
  return "ok";
}
