/**
 * WHAT THE NPM INSTALL WROTE INTO CLAUDE CODE'S OWN FILES — recognised, and
 * only ever READ.
 *
 * Two installs of Counterparts can now reach one Claude Code: the npm one,
 * which `counterparts connect` wires by editing `settings.json` (five hook
 * entries) and running `claude mcp add` (one server), and the Claude Code
 * plugin, whose hooks and server Claude Code loads from the plugin's own files
 * (`.claude-plugin/plugin.json`, `hooks/hooks.json`). Hooks from settings and
 * hooks from plugins MERGE — they all fire, in parallel — and an MCP server
 * from a plugin is a duplicate of a configured one only when it runs the same
 * command, which ours never does (the paths differ). So a person who has both
 * gets every turn captured twice and two sets of memory tools. `plugin.ts`
 * decides who stands down; this file only answers "is the npm wiring there,
 * and would it run?".
 *
 * Why it lives here and not in `cli/wire.ts`, which wrote the entries: the
 * hook and the MCP server both need the answer, and adapters are leaves that
 * never import each other (`mcp/INTERFACE-GAPS.md` §7). `isOurHookCommand`
 * moved here from `wire.ts` on 2026-10-09 for that reason and `wire.ts`
 * re-exports it unchanged, so the writer and this reader still recognise
 * exactly the same set of commands.
 *
 * WHERE CLAUDE CODE KEEPS THEM, measured against 2.1.295 on 2026-10-09 (a
 * throwaway HOME, `--debug-file` naming every settings path it read):
 * `$CLAUDE_CONFIG_DIR/settings.json` and `$CLAUDE_CONFIG_DIR/.claude.json` when
 * that variable is set, else `~/.claude/settings.json` and `~/.claude.json`.
 * (`cli/wire.ts#userSettingsPath` puts the settings file at
 * `$CLAUDE_CONFIG_DIR/.claude/settings.json`, which is not where Claude Code
 * reads it; recorded in the plugin PR rather than changed here.)
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { CONFIG_FLAG } from "./config-path.js";
import { parseScriptInvocation, runtimePresent, shellTokens } from "./runtime.js";

/** The name `counterparts connect` registers the server under
 *  (`cli/install.ts#MCP_SERVER_NAME`), spelled again because this module may
 *  not import the console. `test/plugin.test.ts` holds the two equal. */
export const NPM_MCP_NAME = "counterparts";

/**
 * IS THIS COMMAND OURS TO REWRITE — which is a stricter question than "does it
 * mention us" (review m1).
 *
 * `HOOK_COMMAND_MARK` answers the reporting question `doctor` asks: is a hook
 * of ours installed on this event? It matches a COMPOSITE command, and it
 * should — a wrapper that ends in `counterparts-hook` really does run our hook,
 * and a doctor that said otherwise would be wrong.
 *
 * It is the wrong question for a WRITE. The review wrapped our hook two ways —
 * `~/bin/log-start.sh && counterparts-hook`, and `/opt/mytool/bin/wrap --then
 * counterparts-hook` — and `wire` overwrote the first with ours alone while
 * `unwire` deleted the second outright. Both are somebody's own line, and
 * `wire.ts`'s own promise is that nothing belonging to another tool is a
 * candidate.
 *
 * So a command is ours to rewrite only when it IS our invocation and nothing
 * else: our runtime and our hook script, or the installed shim, optionally
 * followed by `--config <path>`. Anything with a shell operator in it is
 * refused outright, whatever else it looks like — a command this cannot parse
 * is a command this does not edit.
 *
 * `test/wire.test.ts` holds the two to each other in the direction that
 * matters: everything `wire` WRITES is matched by both, so a hook we installed
 * can never read as missing on the surface a person checks.
 */
export function isOurHookCommand(command: string): boolean {
  // A shell operator means the line does something besides run our hook.
  if (/&&|\|\||;|\||>|<|`|\$\(/.test(command)) return false;
  const tokens = shellTokens(command);
  if (tokens.length === 0) return false;
  const tail = (from: number): boolean => {
    const rest = tokens.slice(from);
    if (rest.length === 0) return true;
    return rest.length === 2 && rest[0] === CONFIG_FLAG && (rest[1] ?? "").length > 0;
  };
  const first = tokens[0] ?? "";
  // The installed shim, by itself.
  if (/(^|[/\\])counterparts-hook$/.test(first)) return tail(1);
  // `<runtime> run <our hook script>`, or Node's
  // `<runtime> --import <node-hooks.mjs> <our hook script>` (`runtime.ts`).
  const run = parseScriptInvocation(tokens);
  if (run !== null && /claude-code[/\\]bin[/\\]hook\.ts$/.test(run.script)) {
    return tail(tokens.length - run.rest.length);
  }
  return false;
}

/** Claude Code's two user-level files, wherever `CLAUDE_CONFIG_DIR` puts them. */
export function claudeUserFiles(
  home: string,
  env: Record<string, string | undefined>,
): { readonly settings: string; readonly globalConfig: string } {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0
    ? { settings: join(moved, "settings.json"), globalConfig: join(moved, ".claude.json") }
    : { settings: join(home, ".claude", "settings.json"), globalConfig: join(home, ".claude.json") };
}

/** A hook entry of ours in a settings file, and whether it would run. */
export interface WiredHook {
  readonly file: string;
  readonly event: string;
  readonly command: string;
  /** Its runtime and its script are both still there. A dead entry (an npm
   *  install removed, a checkout deleted) runs nothing, so nobody stands down
   *  for it — it is reported instead. */
  readonly live: boolean;
}

/** Our MCP registration in one of the two scopes `claude mcp add` writes. */
export interface WiredMcp {
  readonly file: string;
  readonly scope: "user" | "local";
  readonly command: string;
  readonly live: boolean;
}

export interface NpmWiring {
  readonly hooks: readonly WiredHook[];
  readonly mcp: readonly WiredMcp[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON object from disk, or null for absent, unreadable or not-an-object.
 *  Read-only, and quiet: a file this cannot read says nothing about our wiring. */
function readObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Would this hook command actually run? The shim must be on PATH (or at the
 * absolute path named); `<runtime> run <script>` needs both the runtime and
 * the script on disk. `env` is the hook process's own, which is the host's —
 * the PATH that counts is the one the host will run the command with.
 */
export function hookCommandLive(command: string, env: Record<string, string | undefined>): boolean {
  const tokens = shellTokens(command);
  const first = tokens[0] ?? "";
  if (/(^|[/\\])counterparts-hook$/.test(first)) return runtimePresent(first, env);
  const run = parseScriptInvocation(tokens);
  if (run === null) return false;
  return runtimePresent(run.exe, env) && existsSync(run.script);
}

/** Every hook entry of ours in one settings object, by event. */
function hooksIn(file: string, settings: Record<string, unknown> | null, env: Record<string, string | undefined>): WiredHook[] {
  if (settings === null) return [];
  const hooks = settings["hooks"];
  if (!isRecord(hooks)) return [];
  const out: WiredHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) continue;
      for (const entry of group["hooks"] as unknown[]) {
        if (!isRecord(entry)) continue;
        const command = entry["command"];
        if (typeof command !== "string" || !isOurHookCommand(command)) continue;
        out.push({ file, event, command, live: hookCommandLive(command, env) });
      }
    }
  }
  return out;
}

/** An MCP entry named like ours, with the command it would run. */
function mcpEntry(
  file: string,
  scope: WiredMcp["scope"],
  servers: unknown,
  env: Record<string, string | undefined>,
): WiredMcp[] {
  if (!isRecord(servers)) return [];
  const entry = servers[NPM_MCP_NAME];
  if (!isRecord(entry)) return [];
  const command = typeof entry["command"] === "string" ? entry["command"] : "";
  const args = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]).filter((a): a is string => typeof a === "string") : [];
  // A disabled-in-`/mcp` server is still registered; Claude Code keeps the
  // switch elsewhere and this reader does not chase it. Live means "the
  // command it names is there", which is the half that decides double tools.
  const run = parseScriptInvocation([command, ...args]);
  const live =
    command.length > 0 &&
    runtimePresent(command, env) &&
    (run === null ? true : existsSync(isAbsolute(run.script) ? run.script : resolve(run.script)));
  return [{ file, scope, command: [command, ...args].join(" "), live }];
}

/**
 * The npm install's wiring as Claude Code will see it for a session in `cwd`:
 * our hook entries in the user, project and local settings files, and a
 * server registered as `counterparts` in the user scope (`~/.claude.json`) or
 * the local scope (that file's `projects[<cwd>]`). READ-ONLY, every file,
 * always.
 */
export function npmWiring(input: {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  /** The session's project directory: `CLAUDE_PROJECT_DIR`, else the event's `cwd`. */
  readonly cwd: string | null;
}): NpmWiring {
  const { settings, globalConfig } = claudeUserFiles(input.home, input.env);
  const hooks: WiredHook[] = [...hooksIn(settings, readObject(settings), input.env)];
  const cwd = input.cwd === null || input.cwd.length === 0 ? null : resolve(input.cwd);
  if (cwd !== null) {
    for (const name of ["settings.json", "settings.local.json"]) {
      const file = join(cwd, ".claude", name);
      hooks.push(...hooksIn(file, readObject(file), input.env));
    }
  }
  const mcp: WiredMcp[] = [];
  const global = readObject(globalConfig);
  if (global !== null) {
    mcp.push(...mcpEntry(globalConfig, "user", global["mcpServers"], input.env));
    const projects = global["projects"];
    if (cwd !== null && isRecord(projects) && isRecord(projects[cwd])) {
      mcp.push(...mcpEntry(globalConfig, "local", (projects[cwd] as Record<string, unknown>)["mcpServers"], input.env));
    }
  }
  // A project `.mcp.json` is not read: `connect` never writes one, and a server
  // there waits for the person's approval, so its presence says nothing about
  // whether it runs.
  return { hooks, mcp };
}
