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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The store directory under the base. Named, because three files agree on it. */
export const DEFAULT_STORE_DIR = "store";

// The two credential NAMES, taken from the adapter that defines them rather
// than retyped here — a template that named a third variable, or misspelled one
// of these, would be a file the loader silently ignores and counts. The same
// direction `mcp/bin/serve.ts` already takes for the same reason.
import { API_KEY_ENV, EMBED_KEY_ENV } from "../claude-code/config.js";
import { loadCredentials } from "../claude-code/credentials.js";
import { CONFIG_ENV, CONFIG_FLAG, defaultConfigPath } from "../config-path.js";
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
 * **`--dir` never moves the base.** `claude-code/bin/hook.ts` and `bin/runner.ts`
 * read `~/.counterparts/claude-code.json` unless something NAMES another file —
 * `--config <absolute path>`, else `COUNTERPARTS_CONFIG`
 * (`adapters/config-path.ts`) — and they fall back to `COUNTERPARTS_DATA_DIR`
 * only when the configuration they read names no store. A hook that finds no
 * config stands down and exits 0 (the Stop ask's exit 2 is the one deliberate
 * non-zero), so a config nothing points them at is a config the ambient half
 * never finds and never complains about. The cold-stranger review of 2026-09-04
 * found exactly that: `--dir` produced a working store, a correct config and
 * correct printed hooks, and an ambient half permanently blind, with nothing on
 * screen to say so.
 *
 * So `--dir` (and `COUNTERPARTS_DATA_DIR`) move the STORE and only the store;
 * `dataDir` in the config is how the hooks are told where it went. `--config`
 * moves the CONFIGURATION — and with it the credentials file beside it and the
 * default store beneath it — and then the printed hooks block and `claude mcp
 * add` line carry it, because a file nothing points at is the failure above.
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

/**
 * The roots this machine hands out for THROWAWAY files: `os.tmpdir()`, the three
 * variables that set it, and `/tmp`. Each is listed twice — as spelled and as
 * realpath'd — because macOS spells the same directory `/var/folders/…` and
 * `/private/var/folders/…` depending on who asked, and a prefix test that knows
 * only one of the two silently answers "no".
 */
export function tempRoots(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const add = (value: string): void => {
    if (!out.includes(value)) out.push(value);
  };
  for (const raw of [tmpdir(), env["TMPDIR"], env["TMP"], env["TEMP"], "/tmp"]) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const abs = resolve(raw.trim());
    add(abs);
    try {
      add(realpathSync(abs));
    } catch {
      // A root that is not there cannot contain anything; nothing to add.
    }
  }
  return out;
}

/** True when `path` is one of the temp roots or lives under one. */
function underTempRoot(path: string, roots: readonly string[]): boolean {
  const abs = resolve(path);
  return roots.some((root) => isWithin(root, abs));
}

/**
 * Why this install may not write THE DEFAULT CONFIGURATION, or null.
 *
 * The one case, and it is a scar rather than a theory: on 2026-09-04 a suite run
 * that had lost `test/preload.ts`'s home mock resolved the real
 * `~/.counterparts/claude-code.json` and rewrote its `dataDir` to a temp path.
 * The file is the one the hook, the worker and the MCP server read with NO flag,
 * so from that moment the owner's live memory was a directory the OS was free to
 * delete — and it recorded nothing for three days before anyone noticed. A
 * throwaway store must never become the live default.
 *
 * So: the default configuration file will not be written with a `dataDir` under
 * a temp root. `--config <somewhere else>` is the way through, and it moves the
 * credentials and the store with it (`installLayout`), which is the whole point
 * — a scratch install should be scratch all the way down.
 *
 * THE THIRD CLAUSE, and why the clean room still works: the refusal also
 * requires that the CONFIGURATION not be under a temp root. `tools/install-loop/run.sh`
 * installs into a fake `$HOME` beneath `$TMPDIR` with no `--config` at all, so
 * its default config and its store are both throwaway and both under the same
 * base — a stranger's install, correctly measured, not a live default pointed at
 * a temp store. Keying on the store alone would refuse the loop; keying on the
 * pair is what "the REAL default path" means on a machine where the temp dir can
 * hold a whole home. Test-suite installs are in the same position (the mocked
 * home is minted under `os.tmpdir()`), which is why this is provable only with
 * an injected home outside the temp tree.
 *
 * Not bypassable by `--force`: `--force` says "overwrite the file I named", and
 * the file this refuses to write is one nobody named.
 */
export function throwawayDefaultRefusal(
  layout: InstallLayout,
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string | null {
  const defaultConfig = defaultConfigPath(home);
  if (resolve(layout.config) !== defaultConfig) return null;
  const roots = tempRoots(env);
  if (!underTempRoot(layout.store, roots)) return null;
  if (underTempRoot(defaultConfig, roots)) return null;
  return (
    `refused: this would write the DEFAULT configuration, ${defaultConfig}, with a data dir ` +
    `under the system temp directory (${layout.store}). That file is the one the hook, the ` +
    "worker and the MCP server read when nothing names another, so a throwaway store would " +
    "become this machine's live memory and the real one would stop being written to. " +
    `Name a scratch install instead: ` +
    `${CONFIG_FLAG} <absolute path outside ${join(home, DEFAULT_DATA_DIR_NAME)}>, which moves the ` +
    "configuration, the credentials and the store together. A permanent store outside the temp " +
    "dir is the other way through."
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

/**
 * WHICH honored credential names an existing file actually holds. NAMES ONLY.
 *
 * THE 2026-09-04 INCIDENT, second half (I32). A forced install rewrote the
 * owner's `credentials.env` with the template below. The file went from two keys
 * to zero, the detached worker was refused at every boundary for a week, and the
 * store's clock stopped while every visible surface read healthy. `--force` is
 * consent to replace a file you are re-installing; it is not consent to destroy
 * a secret that cannot be regenerated from anything on this machine.
 *
 * It reuses `loadCredentials` rather than parsing the file a second time — the
 * quoting, the `export ` prefix, the CRLF, the first-occurrence rule are all
 * there, and a second parser is how the two would come to disagree about what
 * counts as a key. The scratch environment it fills is DISCARDED on this line:
 * nothing from it is returned, printed, emitted or compared. What comes back is
 * the list of NAMES, which is all any caller needs.
 */
export function credentialsHeld(path: string): string[] {
  if (!existsSync(path)) return [];
  const scratch: NodeJS.ProcessEnv = {};
  try {
    // `loaded` is "the file answered this name"; with an empty scratch env
    // nothing can be `skippedPresent`, so this is the file's whole content.
    return loadCredentials(path, scratch).loaded;
  } catch {
    // An unreadable file holds nothing we can vouch for; the ordinary write
    // path decides what happens to it.
    return [];
  }
}

/** The template written into a fresh `credentials.env`. Names, never values. */
export function credentialsTemplate(): string {
  return [
    "# Counterparts reads exactly two names from this file, and only to fill a",
    "# gap: a value already exported in the environment always wins.",
    "#",
    `# ${API_KEY_ENV}=...   the crash-recovery sweep's one model call.`,
    "#                          Without it the worker still runs the day — clock,",
    "#                          flush, cycle, briefing — and SKIPS the sweep, so a",
    "#                          crashed session's spans stay uninterpreted.",
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

// ── did the two printed steps actually take (2026-09-20, finding 4) ─────────

/**
 * READ THE HOST'S OWN FILES and say whether what `install` printed is there.
 *
 * `install` prints the hooks block and the `claude mcp add` line and applies
 * neither — correctly, because they edit somebody else's editor configuration.
 * Nothing then checked them, so a user who pasted the block into a project
 * settings file instead of the user one, or who never restarted, got a fully
 * green `doctor` and total silence. The failure mode of this product is
 * silence, and QUICKSTART §4 says as much about a hook that stands down.
 *
 * It lives HERE and not in `doctor.ts` because it is the other half of what
 * this file prints: the block and the line are `settingsBlock` and
 * `mcpCommand`, and the names they use — `HOST_EVENTS`, `MCP_SERVER_NAME` — are
 * this module's. `doctor.ts` grades the reading and holds none of that
 * vocabulary, exactly as it already takes `checkout` and `open` from its caller.
 *
 * **READ-ONLY, AND EVERY ANSWER NAMES THE FILES IT READ.** None of these paths
 * is ours. `~/.claude.json` in particular is the host's own state file, which
 * its documentation describes as one the host writes for itself — so it may
 * move, and the line must then read "I looked here and did not find it", never
 * "you did not install it". `CLAUDE_CONFIG_DIR` relocates both, checked first.
 *
 * Hooks MERGE across the host's settings files, so all four places a block can
 * land are read and the answer is their union: finding the command in a project
 * file is still finding it, and the line says where it looked.
 *
 * Verified against the host's documentation on 2026-09-20. True for now.
 */
export interface HostRead {
  readonly expected: readonly string[];
  readonly events: readonly string[];
  readonly settingsRead: readonly string[];
  readonly mcp: boolean;
  readonly mcpName: string;
  readonly mcpFile: string;
  readonly mcpUnreadable: boolean;
}

/** What a hook command of ours looks like, wherever it was installed from —
 *  a global install, a clone, or a worktree. Matched as a SUBSTRING: demanding
 *  the exact text `install` printed would fail for everyone running from
 *  source, which §2 of the QUICKSTART tells people they may do. */
export const HOOK_COMMAND_MARK = /counterparts-hook|claude-code[/\\]bin[/\\]hook\.ts/;

/** The host's settings files that can carry a user's hooks, in merge order. */
export function hostSettingsFiles(base: string, cwd: string): string[] {
  return [
    join(base, ".claude", "settings.json"),
    join(base, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(cwd, ".claude", "settings.local.json"),
  ];
}

/** Where a `-s user` MCP registration lands. `CLAUDE_CONFIG_DIR` moves it. */
export function hostMcpFile(base: string): string {
  return join(base, ".claude.json");
}

/** The base both live under: `CLAUDE_CONFIG_DIR` when set, else the home dir. */
export function hostConfigBase(home: string, env: Record<string, string | undefined>): string {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? moved : home;
}

function readJsonFile(path: string): { ok: boolean; value: Record<string, unknown> } {
  if (!existsSync(path)) return { ok: false, value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed as Record<string, unknown> }
      : { ok: false, value: {} };
  } catch {
    return { ok: false, value: {} };
  }
}

export function readHost(
  home: string,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): HostRead {
  const base = hostConfigBase(home, env);
  const events = new Set<string>();
  const settingsRead: string[] = [];
  for (const path of hostSettingsFiles(base, cwd)) {
    const read = readJsonFile(path);
    if (!read.ok) continue;
    settingsRead.push(path);
    const hooks = read.value["hooks"];
    if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) continue;
    for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries as unknown[]) {
        if (entry === null || typeof entry !== "object") continue;
        const inner = (entry as Record<string, unknown>)["hooks"];
        if (!Array.isArray(inner)) continue;
        for (const h of inner as unknown[]) {
          if (h === null || typeof h !== "object") continue;
          const command = (h as Record<string, unknown>)["command"];
          if (typeof command === "string" && HOOK_COMMAND_MARK.test(command)) events.add(event);
        }
      }
    }
  }
  const mcpFile = hostMcpFile(base);
  const mcpRead = readJsonFile(mcpFile);
  const servers = mcpRead.value["mcpServers"];
  const mcp =
    servers !== null &&
    typeof servers === "object" &&
    !Array.isArray(servers) &&
    MCP_SERVER_NAME in (servers as Record<string, unknown>);
  return {
    expected: [...HOST_EVENTS],
    events: [...events].sort(),
    settingsRead,
    mcp,
    mcpName: MCP_SERVER_NAME,
    mcpFile,
    mcpUnreadable: existsSync(mcpFile) && !mcpRead.ok,
  };
}
