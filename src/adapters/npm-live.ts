/**
 * THE NPM INSTALL'S WORD THAT IT IS WIRED HERE (2026-10-15) — a small file
 * beside the configuration, `npm-live.json`, so the plugin directory's build
 * can stand down without opening any file of Claude Code's.
 *
 * The directory flavor never reads `~/.claude.json` (owner's decision,
 * 2026-10-14, `runtime.ts#readsHostUserConfig`), and `host-wiring.ts#npmWiring`
 * reads nothing there, the settings files included. So beside a live npm
 * install it stood nothing down: the per-event claim kept one wake per event,
 * but Claude was offered every memory tool twice (the owner, running both,
 * 2026-10-15).
 *
 * **Who writes it.** The npm install's own hook, which is not the plugin's and
 * may read Claude Code's files: what it writes is a READING of the user-level
 * wiring (`npmWiring` with no project, so only `~/.claude/settings.json` and the
 * `-s user` registration), the same entries the full flavor stands down for —
 * the live hook's command and the file it is in, the live server's program and
 * script, or null for a half that is not there. `counterparts connect` (and
 * `install`, which runs it) writes it the moment it wires; `disconnect` and
 * `uninstall` remove it. A hook rewrites it only when it is missing, names
 * another build or Claude Code configuration directory, or is older than
 * {@link NPM_LIVE_REFRESH_MS}, so `~/.claude.json` is parsed about once a day,
 * not per prompt; a reading that found nothing is written too (nulls), for the
 * same reason. Never written from the plugin's own processes, and never by a
 * build that does not read those files.
 *
 * **Who reads it.** Only the plugin's hook and server in the directory flavor
 * ({@link npmWiringForGate}). They read this file and nothing else, then check
 * that what it names still runs — the runtime and the script on disk, which is
 * a stat, not a read (`host-wiring.ts#hookCommandLive`). A marker left by an
 * npm install removed without `counterparts uninstall` names a program that is
 * gone, so it stands nothing down. The full flavor keeps reading the real
 * wiring and never looks here.
 *
 * **Age.** A marker older than {@link NPM_LIVE_MAX_AGE_MS} is not believed
 * either. Program-exists alone misses one case: npm wiring removed by hand (or
 * a Claude Code configuration reset) while the package stays. No npm hook runs
 * then, so nobody refreshes the file, and without a bound the plugin would
 * stand down beside wiring that no longer exists, with memory off and nothing
 * said after the once-only line. The cost of the bound is the other way round
 * and smaller: after a week without Claude Code, the first session may offer
 * the tools twice (the server decides once, at start, and can start before the
 * npm hook refreshes the file); hooks stay single through the claim.
 *
 * **Which Claude Code.** The file records the writer's `CLAUDE_CONFIG_DIR`, and
 * a reader under another one ignores it: wiring in one Claude Code
 * configuration says nothing about a session of another.
 *
 * **Where.** Beside the configuration, like `scopes.json` and `sidebar.json`:
 * the npm hooks and the plugin resolve the same default configuration, so the
 * file is found exactly when both serve the same memory (an npm install wired to
 * a configuration of its own is another memory, and nothing should stand down).
 * Written to a temp file of this process's own and renamed, mode 0600. Never
 * throws.
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { hookCommandLive, npmWiring } from "./host-wiring.js";
import type { NpmWiring, WiredHook, WiredMcp } from "./host-wiring.js";
import { readsHostUserConfig, runtimePresent } from "./runtime.js";

export const NPM_LIVE_FILE_NAME = "npm-live.json";
/** The file's shape. A reader that does not know a version stands nothing down. */
export const NPM_LIVE_VERSION = 1;
/** A hook rewrites the file once it is this old. */
export const NPM_LIVE_REFRESH_MS = 24 * 60 * 60_000;
/** A reader believes it for this long after it was written. */
export const NPM_LIVE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** `<config dir>/npm-live.json`. */
export function npmLivePath(configPath: string): string {
  return join(dirname(configPath), NPM_LIVE_FILE_NAME);
}

export interface NpmLiveHooks {
  /** The settings file the hook entry is in, for the line a person reads. */
  readonly file: string;
  /** The hook command as written there, so the reader can tell it still runs. */
  readonly command: string;
}

export interface NpmLiveServer {
  readonly file: string;
  readonly scope: "user";
  /** The program and the script the registration runs (script null when it names none). */
  readonly exe: string;
  readonly script: string | null;
  readonly command: string;
}

export interface NpmLiveMarker {
  readonly version: number;
  /** The npm install's version, when known. */
  readonly build: string | null;
  /** The writer's `CLAUDE_CONFIG_DIR`, resolved; null for the default. */
  readonly claudeConfigDir: string | null;
  /** Epoch ms. */
  readonly writtenAt: number;
  readonly hooks: NpmLiveHooks | null;
  readonly server: NpmLiveServer | null;
}

/** `CLAUDE_CONFIG_DIR`, resolved, or null when it is not set. */
function claudeConfigDirOf(env: Record<string, string | undefined>): string | null {
  const moved = (env["CLAUDE_CONFIG_DIR"] ?? "").trim();
  return moved.length > 0 ? resolve(moved) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(r: Record<string, unknown>, k: string): string | null {
  const v = r[k];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** The marker, or null when absent, unreadable or not one this build knows. */
export function readNpmLive(configPath: string): NpmLiveMarker | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(npmLivePath(configPath), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(value) || value["version"] !== NPM_LIVE_VERSION) return null;
  const at = value["writtenAt"];
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const h = value["hooks"];
  const s = value["server"];
  const hooks: NpmLiveHooks | null =
    isRecord(h) && str(h, "file") !== null && str(h, "command") !== null
      ? { file: str(h, "file") as string, command: str(h, "command") as string }
      : null;
  const server: NpmLiveServer | null =
    isRecord(s) && str(s, "file") !== null && str(s, "exe") !== null
      ? {
          file: str(s, "file") as string,
          scope: "user",
          exe: str(s, "exe") as string,
          script: str(s, "script"),
          command: str(s, "command") ?? (str(s, "exe") as string),
        }
      : null;
  return {
    version: NPM_LIVE_VERSION,
    build: str(value, "build"),
    claudeConfigDir: str(value, "claudeConfigDir"),
    writtenAt: at,
    hooks,
    server,
  };
}

/**
 * The npm wiring as the marker says it, for the directory flavor's gates:
 * nothing at all unless the marker is this Claude Code configuration's and
 * younger than {@link NPM_LIVE_MAX_AGE_MS}; then each half it names, `live`
 * only when its program is still on disk. Reads the marker and stats paths;
 * opens no file of Claude Code's.
 */
export function npmWiringFromMarker(input: {
  readonly configPath: string;
  readonly env: Record<string, string | undefined>;
  readonly read?: { readonly hooks?: boolean; readonly mcp?: boolean };
  readonly now?: number;
}): NpmWiring {
  const none: NpmWiring = { hooks: [], mcp: [] };
  const marker = readNpmLive(input.configPath);
  if (marker === null) return none;
  if (marker.claudeConfigDir !== claudeConfigDirOf(input.env)) return none;
  // The DISTANCE from now, as the claims' lock: a marker dated ahead after the
  // clock stepped back is as old as it is far.
  if (Math.abs((input.now ?? Date.now()) - marker.writtenAt) > NPM_LIVE_MAX_AGE_MS) return none;
  const hooks: WiredHook[] = [];
  if (input.read?.hooks !== false && marker.hooks !== null) {
    hooks.push({ file: marker.hooks.file, event: "*", command: marker.hooks.command, live: hookCommandLive(marker.hooks.command, input.env) });
  }
  const mcp: WiredMcp[] = [];
  if (input.read?.mcp !== false && marker.server !== null) {
    const s = marker.server;
    const live = runtimePresent(s.exe, input.env) && (s.script === null || existsSync(s.script));
    mcp.push({ file: s.file, scope: "user", command: s.command, live, exe: s.exe, script: s.script });
  }
  return { hooks, mcp };
}

/** What a directory-flavor plugin would stand down for, by the marker, for
 *  `doctor`: null when there is no marker it would believe. */
export function npmMarkerReading(
  configPath: string,
  env: Record<string, string | undefined>,
  now?: number,
): { readonly hooks: boolean; readonly server: boolean } | null {
  const w = npmWiringFromMarker({ configPath, env, ...(now === undefined ? {} : { now }) });
  if (w.hooks.length === 0 && w.mcp.length === 0) return null;
  return { hooks: w.hooks.some((h) => h.live), server: w.mcp.some((m) => m.live) };
}

/**
 * The wiring the plugin's gates (`plugin.ts#hookGate`, `#mcpGate`) decide on:
 * the real wiring wherever this build reads Claude Code's files, the npm
 * install's marker in the directory flavor, which reads none of them.
 */
export function npmWiringForGate(input: {
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly cwd: string | null;
  readonly configPath: string;
  readonly read?: { readonly hooks?: boolean; readonly mcp?: boolean };
  /** `runtime.ts#readsHostUserConfig` by default; a test's seam. */
  readonly readsUserConfig?: boolean;
  readonly now?: number;
}): NpmWiring {
  if (input.readsUserConfig ?? readsHostUserConfig()) {
    return npmWiring({ home: input.home, env: input.env, cwd: input.cwd, ...(input.read === undefined ? {} : { read: input.read }) });
  }
  return npmWiringFromMarker({
    configPath: input.configPath,
    env: input.env,
    ...(input.read === undefined ? {} : { read: input.read }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export type NpmLiveNote = "written" | "fresh" | "skipped" | "failed";

/**
 * The npm side's write (a settings-wired hook, `connect`). `force`: write
 * whatever the file says (`connect`, which has just changed the wiring).
 * Otherwise only when the file is missing, unreadable, another build's or
 * another Claude Code configuration's, or older than {@link NPM_LIVE_REFRESH_MS}.
 * Skipped where this build reads none of Claude Code's files (it would have
 * nothing true to write) and where no configuration exists (no install here).
 * Never throws.
 */
export function noteNpmLive(input: {
  readonly configPath: string;
  readonly home: string;
  readonly env: Record<string, string | undefined>;
  readonly build: string | null;
  readonly force?: boolean;
  readonly now?: number;
  /** `runtime.ts#readsHostUserConfig` by default; a test's seam. */
  readonly readsUserConfig?: boolean;
}): NpmLiveNote {
  try {
    if (!(input.readsUserConfig ?? readsHostUserConfig())) return "skipped";
    if (input.configPath.length === 0 || !existsSync(input.configPath)) return "skipped";
    const now = input.now ?? Date.now();
    const there = input.force === true ? null : readNpmLive(input.configPath);
    const configDir = claudeConfigDirOf(input.env);
    if (
      there !== null &&
      there.build === input.build &&
      there.claudeConfigDir === configDir &&
      Math.abs(now - there.writtenAt) < NPM_LIVE_REFRESH_MS
    ) {
      return "fresh";
    }
    // The user level only (no project): a hook wired into one project's
    // settings must not stand the plugin down in every other.
    // (npmWiring's own gate, `readsHostUserConfig`, is the one already passed above.)
    const wiring = npmWiring({ home: input.home, env: input.env, cwd: null });
    const hook = wiring.hooks.find((h) => h.live);
    const mcp = wiring.mcp.find((m) => m.live && m.scope === "user");
    const marker: NpmLiveMarker = {
      version: NPM_LIVE_VERSION,
      build: input.build,
      claudeConfigDir: configDir,
      writtenAt: now,
      hooks: hook === undefined ? null : { file: hook.file, command: hook.command },
      server:
        mcp === undefined || mcp.exe === undefined
          ? null
          : { file: mcp.file, scope: "user", exe: mcp.exe, script: mcp.script ?? null, command: mcp.command },
    };
    const file = npmLivePath(input.configPath);
    const tmp = `${file}.${String(process.pid)}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify(marker)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        chmodSync(tmp, 0o600);
      } catch {
        // a filesystem without modes: the write stands
      }
      renameSync(tmp, file);
      return "written";
    } catch {
      rmSync(tmp, { force: true });
      return "failed";
    }
  } catch {
    return "failed";
  }
}

/** The marker, gone (`disconnect`, `uninstall`). True when there was one. Never throws. */
export function removeNpmLive(configPath: string): boolean {
  try {
    const file = npmLivePath(configPath);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
