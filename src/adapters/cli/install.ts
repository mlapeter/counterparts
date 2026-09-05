/**
 * `counterparts install` — the cold-start command.
 *
 * It exists because a stranger's first five minutes were, until this file, five
 * hand-written files: the store, the adapter's configuration, the credential
 * file at 0600, a hooks block in the host's settings, and an MCP registration.
 * Four of those are OURS and one is the HOST'S, and the split is the whole
 * design of this command:
 *
 *   - **Ours, so we write them**: the data directory, `claude-code.json` BESIDE
 *     it, and an empty `credentials.env` at 0600. Nothing here is a host file
 *     and nothing here belongs to another program.
 *   - **The host's, so we only PRINT them**: the `settings.json` hooks block and
 *     the `claude mcp add` line. An installer that edits somebody's editor
 *     configuration without being asked is the same class of surprise as a
 *     memory layer that writes without being asked. `install` never opens
 *     `~/.claude/settings.json` — not to read it, not to back it up, not at all.
 *
 * Three rules the code below mechanizes:
 *
 *   1. **The config sits BESIDE the store, never inside it.** `store/paths.ts`
 *      classifies every top-level entry of the data dir and `assertLayout()`
 *      refuses an unclassified one (§5 G11), so `claude-code.json` inside the
 *      data dir is a store that will not open. Hence the default layout:
 *      `~/.counterparts/` holds the config and the credentials, and the store
 *      is `~/.counterparts/store`.
 *   2. **Nothing existing is overwritten without `--force`.** A second
 *      `install` on a live machine reports what it found and changes nothing —
 *      the same idempotence `init` already has, extended to the two files.
 *   3. **No ceiling is invented** (scar §2.18). `injectionBudgetBytes` is
 *      written only when `--budget` says what it is; without it the config is
 *      written without the key and the printed steps say so out loud.
 */
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The store directory under the base. Named, because three files agree on it. */
export const DEFAULT_STORE_DIR = "store";

// The two credential NAMES, taken from the adapter that defines them rather
// than retyped here — a template that named a third variable, or misspelled one
// of these, would be a file the loader silently ignores and counts. The same
// direction `mcp/bin/serve.ts` already takes for the same reason.
import { API_KEY_ENV, EMBED_KEY_ENV } from "../claude-code/config.js";
import { CONFIG_ENV, CONFIG_FLAG } from "../config-path.js";
import { DEFAULT_DATA_DIR_NAME, isWithin } from "../../core/store/index.js";

/** The five host events one executable serves (`claude-code/bin/hook.ts`). */
export const HOST_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
  "PreCompact",
] as const;

/** The installed executables, by the names `package.json#bin` gives them. */
export const BIN = {
  cli: "counterparts",
  hook: "counterparts-hook",
  mcp: "counterparts-mcp",
  dashboard: "counterparts-dashboard",
} as const;

/** The name the MCP server is registered under, and the one `status` reports. */
export const MCP_SERVER_NAME = "counterparts";

/**
 * THE TWO ENTRY SCRIPTS, ABSOLUTE, resolved from THIS file's location — never
 * from a working directory and never from a name on a PATH.
 *
 * This is scar §2.18 again, in its sharpest form. `credentials.ts` measured, on
 * day 0 of the parallel run, that this host's hook processes carry neither of
 * the owner's exported API keys: **the host's process environment is not the
 * login shell's**. The same sentence is true of `PATH`. `counterparts-hook` is
 * a shim whose shebang is `#!/usr/bin/env bun`, so a host that launches hooks
 * without `~/.bun/bin` on PATH gets "command not found" on every event — a
 * memory that is simply never there, with nothing on screen to say why.
 *
 * So the printed commands name the RUNTIME and the SCRIPT by absolute path,
 * which is what the live host has run since 2026-09-03 and what `hook.ts`
 * already does for its own worker (`command: process.execPath, args: ["run",
 * RUNNER_PATH]`). The short names stay on PATH for a human at a terminal; they
 * are not what goes into a host's configuration.
 */
export const HOOK_SCRIPT = fileURLToPath(new URL("../claude-code/bin/hook.ts", import.meta.url));
export const MCP_SCRIPT = fileURLToPath(new URL("../mcp/bin/serve.ts", import.meta.url));

/** Double-quote a path so a shell keeps it whole. Paths with `"` are refused
 *  by being escaped rather than silently mangled. */
export function shellQuote(path: string): string {
  return `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** `<runtime> run <script>` — the shape both printed host commands take. */
export function runCommand(script: string, exe: string = process.execPath): string {
  return `${shellQuote(exe)} run ${shellQuote(script)}`;
}

/**
 * The hook command the host is told to run — and the ONE case where it carries
 * a flag.
 *
 * The default path IS the rule (`adapters/config-path.ts`): a hooks block that
 * spelled out `--config "$HOME/.counterparts/claude-code.json"` would teach a
 * reader that the flag is part of the wiring, and would then be wrong the moment
 * they moved a home directory. So the flag is printed only when this install put
 * the configuration somewhere the hooks would not find on their own, and the
 * output says why (`commands.ts#installCommand`).
 */
export function hookCommand(configPath?: string, exe: string = process.execPath): string {
  const base = runCommand(HOOK_SCRIPT, exe);
  return configPath === undefined || configPath.length === 0
    ? base
    : `${base} ${CONFIG_FLAG} ${shellQuote(configPath)}`;
}

export const CONFIG_FILE = "claude-code.json";
export const CREDENTIALS_FILE = "credentials.env";

export interface InstallLayout {
  /** The directory holding the config, the credentials, and the store. */
  readonly base: string;
  /** The data dir itself — a SUBDIRECTORY of `base`, never `base` (rule 1). */
  readonly store: string;
  readonly config: string;
  readonly credentials: string;
}

/**
 * Where an install lands, from the flags and the environment — resolved, never
 * guessed halfway.
 *
 * **The base is ALWAYS `~/.counterparts`, whatever `--dir` says.** That is not a
 * convenience; it is the only shape that works. `claude-code/bin/hook.ts:39` and
 * `bin/runner.ts` both hardcode `join(homedir(), ".counterparts",
 * "claude-code.json")` as the one configuration they read, taking no flag and
 * falling back to `COUNTERPARTS_DATA_DIR` only when that file names no store —
 * and a hook that finds no config stands down and exits 0 (the Stop ask's exit 2
 * is the one deliberate non-zero). So a config written anywhere else is a config
 * the ambient half never finds and never complains about. The cold-stranger review of 2026-09-04 found exactly that: `--dir`
 * produced a working store, a correct config and correct printed hooks, and an
 * ambient half permanently blind, with nothing on screen to say so.
 *
 * So `--dir` (and `COUNTERPARTS_DATA_DIR`) move the STORE and only the store;
 * `dataDir` in the config is how the hooks are told where it went.
 *
 * The default store is `~/.counterparts/store`, deliberately NOT `dataDir()`'s
 * `~/.counterparts` — that is the directory holding the two unclassifiable
 * files, and rule 1 is why.
 */
export function installLayout(
  dirFlag: string | undefined,
  env: Record<string, string | undefined>,
  home = homedir(),
  configPath?: string,
): InstallLayout {
  const named =
    dirFlag !== undefined && dirFlag.length > 0
      ? dirFlag
      : (env["COUNTERPARTS_DATA_DIR"] ?? "").trim().length > 0
        ? (env["COUNTERPARTS_DATA_DIR"] as string)
        : undefined;
  // `--config` (or `COUNTERPARTS_CONFIG`) moves the whole BASE — the config, the
  // credentials beside it, and, when no `--dir` says otherwise, the store
  // beneath it. Splitting them would put a scratch install's credentials file in
  // `~/.counterparts/`, which is the live one on the owner's machine; an install
  // that writes there because it was pointed somewhere else is the accident this
  // flag exists to prevent.
  const base =
    configPath === undefined || configPath.length === 0
      ? join(home, DEFAULT_DATA_DIR_NAME)
      : dirname(resolve(configPath));
  const store = named === undefined ? join(base, DEFAULT_STORE_DIR) : resolve(named);
  return {
    base,
    store,
    config:
      configPath === undefined || configPath.length === 0
        ? join(base, CONFIG_FILE)
        : resolve(configPath),
    credentials: join(base, CREDENTIALS_FILE),
  };
}

/**
 * Why this store cannot hold this install's configuration, or null when it can.
 *
 * The one case: a `--dir` that IS `~/.counterparts`, or any ancestor of it, puts
 * `claude-code.json` and `credentials.env` inside the data dir, and the layout
 * totality check (§5 G11) refuses an unclassified top-level entry at open. The
 * store would be created and then never open again. Caught before anything is
 * written, and named.
 */
export function layoutRefusal(layout: InstallLayout): string | null {
  if (!isWithin(layout.store, layout.config)) return null;
  return (
    `refused: the configuration lives at ${layout.config}, which would sit INSIDE the ` +
    `data dir ${layout.store}. The store's layout check refuses an unclassified file at ` +
    `open (§5 G11), so that store would never open again. Choose a --dir that is not ` +
    `${layout.base} or an ancestor of it — ${join(layout.base, DEFAULT_STORE_DIR)} is the default.`
  );
}

export interface ConfigInput {
  readonly layout: InstallLayout;
  readonly budgetBytes?: number;
  readonly name?: string;
  readonly embedder?: boolean;
}

/**
 * The adapter configuration this install writes. Absolute paths only: the file
 * is read by three processes the owner never launches by hand (the hook, the
 * worker, the MCP server), and `~` is a shell's idea, not a path.
 */
export function configObject(input: ConfigInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dataDir: input.layout.store,
    credentialsFile: input.layout.credentials,
    owner: true,
  };
  // Scar §2.18: written only when a number was SUPPLIED. There is no default
  // for a host's ceiling anywhere in this package and this is not the place
  // there starts being one.
  if (input.budgetBytes !== undefined) out["injectionBudgetBytes"] = input.budgetBytes;
  if (input.name !== undefined && input.name.length > 0) out["identity"] = { name: input.name };
  // The egress knob. Absent means absent: no client is built and no socket
  // opens, whatever a key in the environment says.
  if (input.embedder === true) out["embedder"] = { enabled: true };
  return out;
}

/** The template written into a fresh `credentials.env`. Names, never values. */
export function credentialsTemplate(): string {
  return [
    "# Counterparts reads exactly two names from this file, and only to fill a",
    "# gap: a value already exported in the environment always wins.",
    "#",
    `# ${API_KEY_ENV}=...   the crash-recovery sweep's one model call.`,
    `#                          Without it the sweep refuses NO_CREDENTIAL and`,
    "#                          a crashed session's spans stay uninterpreted.",
    `# ${EMBED_KEY_ENV}=...      embeddings. Without it (or without`,
    '#                          "embedder": { "enabled": true } in',
    "#                          claude-code.json) recall is lexical-only.",
    "#",
    "# Anything else in this file is ignored and counted. Keep it 0600.",
    "",
  ].join("\n");
}

/** The hooks block to paste into `~/.claude/settings.json`. Printed, never written. */
export function settingsBlock(hookCommand = runCommand(HOOK_SCRIPT)): string {
  const hooks: Record<string, unknown> = {};
  for (const event of HOST_EVENTS) {
    hooks[event] = [{ hooks: [{ type: "command", command: hookCommand }] }];
  }
  return JSON.stringify({ hooks }, null, 2);
}

/**
 * The MCP registration line. Printed, never run — it edits the host's config.
 *
 * A non-default configuration travels as `-e COUNTERPARTS_CONFIG=…`, not as a
 * flag, and that is the whole reason the environment variable exists: this host
 * launches MCP servers from a STATIC registration, and `-e` is the channel that
 * registration has. It sits beside `COUNTERPARTS_DATA_DIR` because the two names
 * answer different questions — which store, and whose keys.
 */
export function mcpCommand(
  store: string,
  serve = runCommand(MCP_SCRIPT),
  configPath?: string,
): string {
  const config =
    configPath === undefined || configPath.length === 0
      ? ""
      : ` -e ${CONFIG_ENV}=${shellQuote(configPath)}`;
  return `claude mcp add ${MCP_SERVER_NAME} -s user -e COUNTERPARTS_DATA_DIR=${shellQuote(store)}${config} -- ${serve}`;
}

export type WroteWhat = "created" | "kept" | "replaced";

export interface FileResult {
  readonly path: string;
  readonly what: WroteWhat;
  /** Octal mode after the call, for the credential file's 0600 report. */
  readonly mode?: string;
}

/** Write `text` at `path` unless it is already there and `--force` was not given. */
export function writeOnce(
  path: string,
  text: string,
  opts: { force: boolean; mode?: number },
): FileResult {
  const present = existsSync(path);
  if (present && !opts.force) {
    return { path, what: "kept", ...modeOf(path) };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, opts.mode === undefined ? {} : { mode: opts.mode });
  // `writeFileSync`'s mode is a CREATION mode and the umask applies; an
  // existing file keeps the mode it had. Both cases are fixed here, so "0600"
  // is a fact about the file rather than about the call that made it.
  if (opts.mode !== undefined) chmodSync(path, opts.mode);
  return { path, what: present ? "replaced" : "created", ...modeOf(path) };
}

function modeOf(path: string): { mode?: string } {
  try {
    return { mode: (statSync(path).mode & 0o777).toString(8).padStart(3, "0") };
  } catch {
    return {};
  }
}
