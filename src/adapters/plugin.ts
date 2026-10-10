/**
 * THE CLAUDE CODE PLUGIN'S SEAM — prototype, 2026-10-09.
 *
 * Counterparts can reach Claude Code two ways now. The npm way: `npm i -g
 * counterparts`, then `counterparts install`, which writes the store and its
 * configuration and wires the host by editing `~/.claude/settings.json` and
 * running `claude mcp add`. The plugin way: Claude Code fetches this
 * repository as a plugin (`.claude-plugin/plugin.json` at its root), runs the
 * five hooks `hooks/hooks.json` names and the MCP server `plugin.json` names,
 * and nothing in the person's settings is edited by us at all.
 *
 * Both launch the SAME entry points (`claude-code/bin/hook.ts`,
 * `mcp/bin/serve.ts`) through `plugin-run.sh`. This file is the few things
 * that differ when the launcher is the plugin's:
 *
 *   1. **Knowing it.** `CLAUDE_PLUGIN_ROOT` is set by Claude Code on the
 *      plugin's own hook and server processes, and it is THIS package's root
 *      exactly when the plugin is this copy of Counterparts. Equality, not
 *      presence: the variable is inherited by children, and a settings-wired
 *      hook of a different install must never mistake itself for the plugin.
 *   2. **Not firing twice.** A person with the npm wiring AND the plugin gets
 *      every hook twice (Claude Code merges hooks from settings and plugins
 *      and runs them all) and two memory servers (plugin servers are deduped
 *      only by identical command). The npm installs already out there cannot
 *      learn about the plugin, so the rule has to live on THIS side: **the
 *      plugin stands down wherever the npm wiring is live** — hooks for
 *      hooks, the server for the server — and says once, at session start,
 *      how to move (`counterparts disconnect`). Same store either way, so
 *      moving loses nothing.
 *   3. **First run without a terminal.** The npm way creates the store and
 *      `~/.counterparts/claude-code.json` at `install`. A plugin has no
 *      install step we run, so the first hook or server to start runs that
 *      same `install` (non-interactive, `--no-connect`: it writes OUR two
 *      things and touches no host file), under a lock so the hook and the
 *      server racing at session start produce one install, not two. The
 *      layout is therefore exactly the npm one, which is what makes moving
 *      between the two a non-event.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, rmdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { implicitConfigRefusal } from "./config-path.js";
import type { ConfigChoice } from "./config-path.js";
import type { NpmWiring } from "./host-wiring.js";
import { BINARY, CLI_SCRIPT, scriptArgs } from "./runtime.js";
import type { Binary } from "./runtime.js";

/** Set by Claude Code on a plugin's hook, MCP and LSP processes. */
export const PLUGIN_ROOT_ENV = "CLAUDE_PLUGIN_ROOT";
/**
 * The plugin's persistent directory — and the memory is deliberately NOT in
 * it. Claude Code deletes `~/.claude/plugins/data/<id>/` when the plugin is
 * uninstalled from its last scope (unless `--keep-data`), and a memory that an
 * uninstall erases is not one anybody agreed to. The store stays where the
 * npm install puts it, `~/.counterparts/store`, which is also what lets a
 * person move between the two installs without moving anything.
 */
export const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

/** This package's root — the directory holding `package.json` and, in this
 *  repository, `.claude-plugin/`. */
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Is this process the plugin's? True when Claude Code's `CLAUDE_PLUGIN_ROOT`
 * names this very package. Both sides are realpath'd: macOS spells one
 * directory `/var/…` and `/private/var/…`, and a plugin added from a symlinked
 * checkout is the same plugin.
 */
export function runningAsPlugin(
  env: Record<string, string | undefined>,
  packageRoot: string = PACKAGE_ROOT,
  binary: Binary | null = BINARY,
): boolean {
  const named = (env[PLUGIN_ROOT_ENV] ?? "").trim();
  if (named.length === 0) return false;
  // THE SINGLE BINARY: it has no package root on disk — `plugin-run.sh`
  // downloads it into the plugin's own data directory — so "this very copy"
  // is a binary sitting under CLAUDE_PLUGIN_DATA, which Claude Code sets only
  // on the plugin's processes and their children.
  if (binary !== null) {
    const data = (env[PLUGIN_DATA_ENV] ?? "").trim();
    if (data.length === 0) return false;
    const rel = relative(realOrResolved(data), realOrResolved(binary.self));
    return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  }
  return realOrResolved(named) === realOrResolved(packageRoot);
}

/** `~/…` for a path under the home directory, for a line a person reads. */
function tildeOf(path: string, home: string): string {
  const h = resolve(home);
  const p = resolve(path);
  return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}

/** What the plugin's hook does about the npm wiring, and what it says. */
export interface PluginGate {
  readonly standDown: boolean;
  /** One line for the owner at session start, or null. */
  readonly line: string | null;
}

/**
 * THE HOOKS' RULE: live npm hooks win. A DEAD npm entry (its runtime or script
 * gone — an uninstalled package, a deleted checkout) runs nothing, so the
 * plugin carries on and says the stale lines are there. "Ours" is read by the
 * script the line runs (`host-wiring.ts#readOurHook`), so a line a newer
 * `connect` wrote, with flags this build never heard of, still stands the
 * plugin down. Whatever this misses, the per-event claim in the store catches
 * (`claude-code/claim.ts`): of two hooks that run one event, one delivers.
 */
export function hookGate(wiring: NpmWiring, home: string): PluginGate {
  const live = wiring.hooks.find((h) => h.live);
  if (live !== undefined) {
    return {
      standDown: true,
      line:
        `Counterparts is installed twice: the npm install's hooks in ${tildeOf(live.file, home)} and this plugin. ` +
        "The plugin is standing down so nothing is captured twice. To keep only the plugin, run " +
        "`counterparts disconnect` and restart Claude Code; the memory is the same either way.",
    };
  }
  const dead = wiring.hooks[0];
  if (dead !== undefined) {
    return {
      standDown: false,
      line:
        `Counterparts: ${tildeOf(dead.file, home)} still names an old Counterparts hook that no longer runs. ` +
        "The plugin is keeping your memory; remove those entries to quiet them.",
    };
  }
  return { standDown: false, line: null };
}

/**
 * THE SERVER'S RULE: a live `counterparts` registration in the user or local
 * scope wins. The words become the stood-down server's `instructions`, which
 * is the only thing a model sees of a server with no tools.
 */
export function mcpGate(wiring: NpmWiring, home: string): { readonly standDown: boolean; readonly instructions: string | null } {
  const live = wiring.mcp.find((m) => m.live);
  if (live === undefined) return { standDown: false, instructions: null };
  return {
    standDown: true,
    instructions:
      `This plugin's Counterparts server is standing down: the npm install already registers a ` +
      `"counterparts" memory server (${live.scope} scope, ${tildeOf(live.file, home)}), and two servers ` +
      "over one memory would offer every tool twice. Use that server's tools. To use the plugin's " +
      "instead, run `counterparts disconnect` and restart Claude Code.",
  };
}

// ── first run ───────────────────────────────────────────────────────────────

/**
 * `joined`: absent when this process looked, made by a CONCURRENT first run
 * (the hook and the server start together) while this one waited. It is still
 * this session's first run, so it carries the same line as `created`.
 */
export type FirstRunState = "existed" | "created" | "joined" | "skipped" | "failed";

export interface FirstRun {
  readonly state: FirstRunState;
  /** One line for the owner at session start, or null when there is nothing
   *  to say (an existing install, a skipped one). */
  readonly line: string | null;
  /** Why it failed or was skipped, for stderr. */
  readonly detail?: string;
}

/** How long a waiting process gives the one holding the lock. An install is a
 *  directory, an empty database and a small JSON file: well under a second on
 *  the machines measured, so twenty is generous and still inside Claude
 *  Code's thirty-second MCP start-up window. */
export const FIRST_RUN_WAIT_MS = 20_000;
/** A lock older than this is a process that died holding it. */
export const FIRST_RUN_STALE_MS = 120_000;
/** The install's own ceiling, as a child process. */
export const FIRST_RUN_TIMEOUT_MS = 60_000;

/**
 * Where the lock lives: the system temp directory, keyed by the configuration
 * path — never inside `~/.counterparts`, where a leftover lock directory would
 * be one more entry for `doctor` and `start-fresh` to have an opinion about.
 */
export function firstRunLockPath(configPath: string, tmp: string = tmpdir()): string {
  const key = createHash("sha256").update(resolve(configPath)).digest("hex").slice(0, 16);
  return join(tmp, `counterparts-first-run-${key}.lock`);
}

/**
 * A MEMORY SET ASIDE BESIDE THE ONE ABOUT TO BE MADE (review of #328).
 * `counterparts uninstall --park` leaves `<base>.parked-<date>[-N]` next to
 * where the configuration lives (`cli/install.ts#parkedNameParts`, which also
 * checks the date is a real day; the shape is enough here). A non-interactive
 * install walks past one and makes a blank store beside it, and says so on
 * stdout (review M4: "a second store the person does not know about") — but
 * the first run drops that stdout, so the line it hands the wake has to say it
 * instead. Named only: nothing here opens, moves or counts it.
 */
export function parkedBeside(base: string): string[] {
  const dir = dirname(resolve(base));
  const prefix = `${basename(resolve(base))}.parked-`;
  try {
    return readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(n.slice(prefix.length)))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface FirstRunInput {
  readonly choice: ConfigChoice;
  readonly env: Record<string, string | undefined>;
  readonly home: string;
  /** The runtime that runs the console: this process's own, by default. */
  readonly runtime?: string;
  readonly cliScript?: string;
  readonly lockPath?: string;
  readonly waitMs?: number;
  readonly staleMs?: number;
  readonly now?: () => number;
}

/**
 * Make sure the store and the default configuration exist, the way
 * `counterparts install` makes them — by running it.
 *
 * SKIPPED, and nothing written, when a configuration was NAMED (`--config`,
 * `COUNTERPARTS_CONFIG`: somebody chose a file, and a missing one is that
 * entry point's refusal to make) or when the explicit-dir guard is armed (it
 * refuses the implicit default by design; `config-path.ts#implicitConfigRefusal`).
 *
 * The console is SPAWNED rather than imported: adapters do not import each
 * other, and the console is the one place that knows how an install is made
 * ("invent no second install path"). Its output is captured and dropped — a
 * hook's stdout is the model's context, and a server's is the JSON-RPC wire.
 */
export function ensureFirstRun(input: FirstRunInput): FirstRun {
  const { choice, env } = input;
  if (choice.source !== "default") return { state: "skipped", line: null, detail: `configuration named by ${choice.source}` };
  if (existsSync(choice.path)) return { state: "existed", line: null };
  const guard = implicitConfigRefusal(choice, env);
  if (guard !== null) return { state: "skipped", line: null, detail: guard };

  const now = input.now ?? ((): number => Date.now());
  const lock = input.lockPath ?? firstRunLockPath(choice.path);
  const waitMs = input.waitMs ?? FIRST_RUN_WAIT_MS;
  const staleMs = input.staleMs ?? FIRST_RUN_STALE_MS;
  const base = dirname(choice.path);
  const parked = parkedBeside(base);
  const created: FirstRun = {
    state: "created",
    line:
      `Counterparts: first run — a new memory was set up at ${tildeOf(base, input.home)}. ` +
      "It stays on this computer." +
      (parked.length === 0
        ? ""
        : ` A memory set aside earlier is still at ${parked.map((p) => tildeOf(p, input.home)).join(", ")}, untouched; ` +
          "the new one does not include it."),
  };

  const take = (): boolean => {
    try {
      mkdirSync(lock);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };

  let held = take();
  if (!held) {
    // Somebody else is installing. Wait for the configuration to appear; a
    // lock older than `staleMs` is a dead process's, and is taken over once.
    const until = now() + waitMs;
    while (!held) {
      if (existsSync(choice.path)) return { ...created, state: "joined" };
      let age = 0;
      try {
        age = now() - statSync(lock).mtimeMs;
      } catch {
        age = 0;
      }
      if (age > staleMs) {
        try {
          rmdirSync(lock);
        } catch {
          // Gone already, or not ours to remove; `take` below decides.
        }
      }
      held = take();
      if (held) break;
      if (now() >= until) {
        return { state: "failed", line: null, detail: `timed out after ${String(waitMs)} ms waiting for another first run (${lock})` };
      }
      sleepSync(100);
    }
  }
  try {
    // The one who waited may find it done the moment it gets the lock.
    if (existsSync(choice.path)) return { ...created, state: "joined" };
    const runtime = input.runtime ?? process.execPath;
    const script = input.cliScript ?? CLI_SCRIPT;
    const res = spawnSync(runtime, [...scriptArgs(script, runtime), "install", "--no-connect"], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: FIRST_RUN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status === 0 && existsSync(choice.path)) return created;
    const why = (String(res.stderr ?? "").trim().split("\n").pop() ?? "") || (res.error?.message ?? `exit ${String(res.status)}`);
    return {
      state: "failed",
      line: `Counterparts could not set up its memory on first run (${why.slice(0, 200)}). Memory is off for this session.`,
      detail: why,
    };
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // Already gone: nothing to release.
    }
  }
}
