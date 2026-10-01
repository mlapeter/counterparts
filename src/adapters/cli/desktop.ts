/**
 * CLAUDE DESKTOP'S CONFIG ENTRY — `counterparts install --host claude-desktop`
 * writes it, `counterparts doctor` reads it (2026-09-30, host groundwork PR B,
 * brief items 7 and 8).
 *
 * Desktop starts its local MCP servers from ONE file,
 * `~/Library/Application Support/Claude/claude_desktop_config.json`, under
 * `mcpServers`. This merges a `counterparts` entry into it and touches nothing
 * else: the file is backed up first, beside itself (`wire.ts#copyToFreeBackup`),
 * every other server's entry is written back as it was, and the file keeps its
 * own indentation and line endings (`wire.ts#sightSettings`, the same reader
 * and refusals `connect` uses on `~/.claude/settings.json`).
 *
 * **The command is the bun-run `counterparts-mcp`, not a `.mcpb` bundle**:
 * Desktop runs bundles under its own Node, and this package is untested on
 * Node. The runtime and the script are ABSOLUTE for the reason `install.ts`
 * gives for the hooks — a host's environment is not the login shell's.
 *
 * **Nothing in the entry says "Desktop".** The server learns who it is talking
 * to from the client's own name at `initialize` (`hosts.ts#hostOfClient`). That
 * matters because Desktop's Code tab ALSO loads this file, and there the
 * client is Claude Code: the same entry must behave exactly as Claude Code's
 * own registration does. A flag saying "desktop" would be false in that tab.
 *
 * **The name clash, and why it is allowed.** In the Code tab a same-name entry
 * from this file wins over `~/.claude.json`'s `counterparts`. Both are written
 * by this package and both name the store the configuration names, so which
 * one wins changes nothing — and doctor says so, and turns amber only if the
 * two point at different stores (`readDesktop`). Measured 2026-10-01: what
 * wins is Desktop's RUNNING server (Desktop mode, shared by its chats), not a
 * Claude Code copy of this entry — so the Code-tab wake names the session id
 * and that server serves a call naming it as the Claude Code session
 * (`mcp/server.ts#claudeCodeSessionNamed`).
 *
 * The home directory is always the caller's (`install`'s `home`, a test's fake
 * one): nothing here reads `os.homedir()`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_ENV } from "../config-path.js";
import { hostConfigBase, hostMcpFile, MCP_SCRIPT, MCP_SERVER_NAME } from "./install.js";
import { sightSettings, writeSettings } from "./wire.js";

/** The variable the server reads its store from (`mcp/bin/serve.ts#ENV.dir`). */
const DATA_DIR_VAR = "COUNTERPARTS_DATA_DIR";

/** Where Claude Desktop keeps its MCP servers, under a home directory (macOS). */
export function desktopConfigPath(home: string): string {
  return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

/** The `mcpServers.counterparts` entry this install writes. */
export interface DesktopEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The entry for `store`, run by `exe`, with a non-default `configPath` carried in `env`. */
export function desktopEntry(store: string, exe: string, configPath?: string): DesktopEntry {
  return {
    command: exe,
    args: ["run", MCP_SCRIPT],
    env: {
      [DATA_DIR_VAR]: store,
      ...(configPath === undefined || configPath.length === 0 ? {} : { [CONFIG_ENV]: configPath }),
    },
  };
}

export interface DesktopConnect {
  /** `added`: a new entry; `updated`: ours was there and said something else;
   *  `already`: exactly this entry was there, and nothing was written. */
  readonly outcome: "added" | "updated" | "already" | "refused" | "failed";
  readonly path: string;
  /** The backup taken before the write, or null (no file yet, or no write). */
  readonly backup: string | null;
  /** Why it was refused or failed; null otherwise. */
  readonly detail: string | null;
  /** On `updated`: the store the replaced entry named, when it named one. */
  readonly previousStore?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Same entry, key for key — the idempotence test. */
function sameEntry(a: unknown, b: DesktopEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MERGE OUR ENTRY INTO DESKTOP'S CONFIG. Idempotent: the same entry again
 * writes nothing and takes no backup. A file this cannot read as a JSON object,
 * or whose `mcpServers` is not an object, is refused, never rewritten. Never
 * throws.
 */
export function connectDesktop(input: {
  home: string;
  store: string;
  exe: string;
  configPath?: string;
  now: number;
}): DesktopConnect {
  const path = desktopConfigPath(input.home);
  try {
    const sight = sightSettings(path, input.home);
    if (sight.refusal !== null) return { outcome: "refused", path, backup: null, detail: sight.refusal };
    const servers = sight.value["mcpServers"];
    if (servers !== undefined && !isRecord(servers)) {
      return {
        outcome: "refused",
        path,
        backup: null,
        detail: `refused: "mcpServers" in ${path} is not an object. Nothing was changed; add the entry by hand.`,
      };
    }
    const entry = desktopEntry(input.store, input.exe, input.configPath);
    const prior = servers?.[MCP_SERVER_NAME];
    if (prior !== undefined && sameEntry(prior, entry)) return { outcome: "already", path, backup: null, detail: null };
    const value = { ...sight.value, mcpServers: { ...(servers ?? {}), [MCP_SERVER_NAME]: entry } };
    const wrote = writeSettings(sight, value, input.now);
    if (wrote.error !== null) return { outcome: "failed", path, backup: wrote.backup, detail: wrote.error };
    return prior === undefined
      ? { outcome: "added", path, backup: wrote.backup, detail: null }
      : { outcome: "updated", path, backup: wrote.backup, detail: null, previousStore: dataDirOf(prior) };
  } catch (err) {
    return { outcome: "failed", path, backup: null, detail: String((err as Error).message ?? err) };
  }
}

/** What doctor reads about Claude Desktop (`claude-code/doctor.ts#DesktopReading`). */
export interface DesktopConfigReading {
  readonly path: string;
  /** `absent`: no config file; `no-entry`: a file with no `counterparts`;
   *  `entry`: ours is there; `unreadable`: a file that is not a JSON object. */
  readonly state: "absent" | "no-entry" | "entry" | "unreadable";
  /** The store the Desktop entry names (`COUNTERPARTS_DATA_DIR`), or null. */
  readonly dataDir: string | null;
  /** Whether Claude Code's own registration (`~/.claude.json`) names `counterparts` too. */
  readonly codeTab: boolean;
  /** The store Claude Code's registration names, or null. */
  readonly codeDataDir: string | null;
}

function readObject(path: string): { state: "absent" | "unreadable" | "read"; value: Record<string, unknown> } {
  if (!existsSync(path)) return { state: "absent", value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? { state: "read", value: parsed } : { state: "unreadable", value: {} };
  } catch {
    return { state: "unreadable", value: {} };
  }
}

function dataDirOf(entry: unknown): string | null {
  if (!isRecord(entry)) return null;
  const env = entry["env"];
  if (!isRecord(env)) return null;
  const dir = env[DATA_DIR_VAR];
  return typeof dir === "string" && dir.length > 0 ? dir : null;
}

/**
 * READ DESKTOP'S CONFIG FOR DOCTOR — two small file reads, never a write:
 * Desktop's own file, and Claude Code's `~/.claude.json` for the name clash.
 */
export function readDesktop(home: string, env: Record<string, string | undefined> = {}): DesktopConfigReading {
  const path = desktopConfigPath(home);
  const read = readObject(path);
  const servers = read.value["mcpServers"];
  const ours = isRecord(servers) ? servers[MCP_SERVER_NAME] : undefined;
  const code = readObject(hostMcpFile(hostConfigBase(home, env)));
  const codeServers = code.value["mcpServers"];
  const codeOurs = isRecord(codeServers) ? codeServers[MCP_SERVER_NAME] : undefined;
  return {
    path,
    state: read.state === "absent" ? "absent" : read.state === "unreadable" ? "unreadable" : ours === undefined ? "no-entry" : "entry",
    dataDir: dataDirOf(ours),
    codeTab: codeOurs !== undefined,
    codeDataDir: dataDirOf(codeOurs),
  };
}
