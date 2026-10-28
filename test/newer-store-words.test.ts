/**
 * AN OLD WINDOW MEETING AN UPGRADED MEMORY SAYS WHAT TO DO (U1a, 2026-10-27).
 *
 * After an update, an open Claude Code window keeps the code it loaded: its
 * MCP server always, and — for the plugin — its hooks too, because Claude Code
 * keeps the previous version's folder until `/reload-plugins`. When the newer
 * code upgrades the memory, the old window's server refused every tool with
 * "Run /mcp and Reconnect", which for the plugin restarts the same old code,
 * and its hook printed "Run: counterparts doctor", a command a plugin install
 * does not have, to the person only.
 *
 * Now (`src/adapters/update-words.ts`):
 *   - the plugin's step is `/reload-plugins` (with `--force`, or a new
 *     session) when Claude Code records a NEWER plugin than the window runs,
 *     and update-then-reload otherwise, so neither wording can loop;
 *   - Claude Desktop's Code tab leads with a new session;
 *   - an npm server keeps "/mcp and Reconnect" (which works there); an npm
 *     hook, which is the installed code, says to update the npm install;
 *   - the hook tells the model too, so it does not act as if it remembers;
 *   - the first watched wake after an upgrade names the older windows once.
 *
 * Proved through the doors: the MCP server process (`bin/serve.ts`) over
 * stdio, the hook process (`bin/hook.ts`), the adapter's SessionStart and
 * Desktop's wake notice. Hermetic: a temp directory per test, a temp HOME for
 * every child, `installed_plugins.json` written there.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { CACHE_SCHEMA_VERSION, SCHEMA_VERSION, Store, paths } from "../src/core/store/index.js";
import { openDb } from "../src/core/store/db.js";
import { localDate } from "../src/core/time.js";
import { WAKE_BUILD_KEY } from "../src/core/self/index.js";
import { openAdapter } from "../src/adapters/claude-code/index.js";
import { doctorFindings, readCounterpartOpen } from "../src/adapters/claude-code/doctor.js";
import type { DoctorInput } from "../src/adapters/claude-code/doctor.js";
import { STALE_WINDOWS_LEAD, STALE_WINDOWS_TOLD_KEY, staleWindowsWords } from "../src/adapters/claude-code/stale-windows.js";
import type { AdapterConfig } from "../src/adapters/config.js";
import { pluginVersionRecorded } from "../src/adapters/host-wiring.js";
import { desktopWakeNotice } from "../src/adapters/mcp/bin/serve.js";
import { openServer } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { STALE_SERVER_REFUSAL, newerStoreRefusal, staleServerRefusal, SERVER_VERSION } from "../src/adapters/mcp/server.js";
import type { InstallRoute } from "../src/adapters/plugin.js";
import { DESKTOP_SCOPE } from "../src/adapters/hosts.js";
import { recordServerLaunch, serverRecordPath } from "../src/adapters/sessions.js";
import { MEANING_OFF_LEAD } from "../src/adapters/claude-code/doctor-meaning.js";
import { STATIC_WEIGHTS_ENV } from "../src/core/embed/static.js";
import {
  PLUGIN_UPDATE,
  RELOAD_STEP,
  RELOAD_STEP_CODE_TAB,
  newerStoreWords,
  npmUpdateCommand,
} from "../src/adapters/update-words.js";

const HOOK_SCRIPT = resolve(import.meta.dir, "../src/adapters/claude-code/bin/hook.ts");
const SERVE_SCRIPT = resolve(import.meta.dir, "../src/adapters/mcp/bin/serve.ts");
const REPO_ROOT = resolve(import.meta.dir, "..");

/** The version this code is, and one patch past it (what an update would record). */
const LOADED = SERVER_VERSION;
function patchPast(v: string): string {
  const [a, b, c] = v.split(".").map(Number);
  return `${String(a)}.${String(b)}.${String((c ?? 0) + 1)}`;
}
const NEWER = patchPast(LOADED);
/** The marketplace's own shape: `<version>-<12 hex>`. */
const SHA = "14cfc833eed5";

const RELOAD_WORDS = `A newer version of Counterparts upgraded this memory, and this window still runs the old one. Run /reload-plugins (if it warns about the cache, /reload-plugins --force), or start a new session.`;

let root: string;
let dir: string;
let project: string;
let home: string;
const open: { close(): void }[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cp-newer-store-")));
  dir = join(root, "store");
  project = join(root, "proj");
  home = join(root, "home");
  for (const d of [project, home, join(root, "bin")]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  for (const c of open.splice(0)) {
    try {
      c.close();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

/** Claude Code's record of the plugin, under the temp HOME. */
function recordPlugin(plugins: Record<string, unknown>): void {
  const at = join(home, ".claude", "plugins");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
}

function coreRecord(version: string, extra: Record<string, unknown> = {}): unknown[] {
  return [{ scope: "user", installPath: join(home, ".claude", "plugins", "cache", "counterparts", "counterparts", version), version, ...extra }];
}

/** Move the store's stamp one version past this code, the way a newer build's migration leaves it — from a connection of its own. */
function bumpStore(box: "store" | "cache" = "store"): void {
  const db = openDb(box === "store" ? paths.operational(dir) : paths.cache(dir));
  try {
    if (box === "store") db.run("UPDATE meta SET value = ? WHERE key = 'schemaVersion'", String(SCHEMA_VERSION + 1));
    else db.run("UPDATE cache_meta SET value = ? WHERE key = 'schemaVersion'", String(CACHE_SCHEMA_VERSION + 1));
  } finally {
    db.close();
  }
}

function seedStore(): void {
  const s = Store.open({ dir });
  try {
    s.put({ type: "memory", kind: "fact", body: "the kiln is fired on Thursdays" });
  } finally {
    s.close();
  }
}

// ── the words ───────────────────────────────────────────────────────────────

describe("reload or update: decided by what Claude Code records", () => {
  test("a newer plugin recorded (the marketplace's -<sha> shape): reload, with --force and a new session, and never Reconnect", () => {
    const words = newerStoreWords({ route: "plugin", who: "server", loaded: LOADED, recorded: `${NEWER}-${SHA}` });
    expect(words).toBe(RELOAD_WORDS);
    expect(words).not.toContain("/mcp");
    expect(words).not.toContain("Update now");
  });

  test("the same version recorded (with a -<sha> suffix): update first, then reload — a bare reload would load this same code", () => {
    const words = newerStoreWords({ route: "plugin", who: "server", loaded: LOADED, recorded: `${LOADED}-${SHA}`, writer: NEWER });
    expect(words).toBe(
      `A newer version of Counterparts (${NEWER}) upgraded this memory; this one is ${LOADED}. To use it here, update Counterparts: ${PLUGIN_UPDATE}; then ${RELOAD_STEP}.`,
    );
    // An older record (a rollback) and no record at all say the same.
    for (const recorded of ["0.0.1", null]) {
      expect(newerStoreWords({ route: "plugin", who: "server", loaded: LOADED, recorded })).toContain(`To use it here, update Counterparts: ${PLUGIN_UPDATE}`);
    }
  });

  test("Claude Desktop's Code tab leads with a new session: /reload-plugins leaves the plugin's server as it was there", () => {
    const words = newerStoreWords({ route: "plugin", who: "server", loaded: LOADED, recorded: NEWER, codeTab: true });
    expect(words).toContain(`and this window still runs the old one. Start a new session (in Claude Desktop's Code tab, /reload-plugins doesn't restart Counterparts' memory tools).`);
    expect(newerStoreWords({ route: "plugin", who: "hook", loaded: LOADED, recorded: null, codeTab: true })).toEndWith(`; then ${RELOAD_STEP_CODE_TAB}.`);
  });

  test("npm: the server keeps Reconnect (the install was replaced in place); the hook, which IS the install, says to update it", () => {
    expect(newerStoreRefusal({ route: "npm", loaded: LOADED, recorded: null })).toBe(STALE_SERVER_REFUSAL);
    expect(newerStoreWords({ route: "npm", who: "hook", loaded: LOADED, recorded: null, runtime: "bun" })).toBe(
      `A newer version of Counterparts upgraded this memory; this one is ${LOADED}. To use it here, update Counterparts: in a terminal, run bun add -g counterparts@latest; then run /mcp and Reconnect.`,
    );
    expect(npmUpdateCommand("node")).toBe("npm install -g counterparts@latest");
  });

  test("a CLAUDE_PLUGIN_ROOT naming another copy: both routes, each with its own step", () => {
    const words = newerStoreWords({ route: "either", who: "server", loaded: LOADED, recorded: NEWER });
    expect(words).toBe(
      `A newer version of Counterparts upgraded this memory, and this window runs an older one. For the plugin, ${RELOAD_STEP}; for an npm install, run /mcp and Reconnect.`,
    );
  });

  test("Claude Desktop's and claude.ai's own servers keep their hosts' words, whatever the route", () => {
    expect(newerStoreRefusal({ route: "plugin", loaded: LOADED, recorded: NEWER, host: "claude-desktop" })).toBe(staleServerRefusal("claude-desktop"));
  });
});

describe("what installed_plugins.json records", () => {
  test("the highest x.y.z among the counterparts@ records that apply to this folder; the sidebar and other folders' project installs don't count", () => {
    const elsewhere = join(root, "elsewhere");
    recordPlugin({
      "counterparts@counterparts": coreRecord(`${LOADED}-${SHA}`),
      "counterparts@claude-community": [{ scope: "project", projectPath: elsewhere, version: "9.0.0" }],
      "counterparts-sidebar@counterparts": coreRecord("9.9.9"),
    });
    expect(pluginVersionRecorded({ home, env: {}, cwd: project })).toBe(LOADED);
    expect(pluginVersionRecorded({ home, env: {}, cwd: join(elsewhere, "sub") })).toBe("9.0.0");
    // resolvedVersion stands in for a version that is not one.
    recordPlugin({ "counterparts@counterparts": coreRecord("abc1234", { resolvedVersion: NEWER }) });
    expect(pluginVersionRecorded({ home, env: {}, cwd: project })).toBe(NEWER);
    // Nothing recorded, or unreadable: null.
    writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "{ not json");
    expect(pluginVersionRecorded({ home, env: {}, cwd: project })).toBeNull();
  });
});

// ── the MCP server ──────────────────────────────────────────────────────────

function server(install: InstallRoute, recorded: string | null, env: Record<string, string> = {}): McpServer {
  const s = openServer({ dir, session: "sess_newer_1", scope: project, scopesFile: join(root, "scopes.json"), install, pluginVersion: () => recorded, env });
  open.push(s.counterpart);
  return s;
}

const REMEMBER = { content: "A note made in a window left open across an update." };

describe("the plugin's MCP server, after a newer build upgraded the store under it", () => {
  test("a newer plugin recorded: every tool says to reload, in a sentence the model can pass on", async () => {
    const s = server("plugin", `${NEWER}-${SHA}`);
    bumpStore();
    const r = await s.call("remember", REMEMBER);
    expect(r.isError).toBe(true);
    expect(r.structuredContent["reason"]).toBe("schema-ahead");
    expect(r.structuredContent["detail"]).toBe(`This tool did nothing: ${RELOAD_WORDS.charAt(0).toLowerCase()}${RELOAD_WORDS.slice(1)}`);
  });

  test("the same version recorded: update words, naming the version that wrote the memory", async () => {
    const s = server("plugin", `${LOADED}-${SHA}`);
    s.counterpart.store.setMeta(WAKE_BUILD_KEY, NEWER);
    bumpStore();
    const detail = String((await s.call("status", {})).structuredContent["detail"]);
    expect(detail).toBe(
      `This tool did nothing: a newer version of Counterparts (${NEWER}) upgraded this memory; this one is ${LOADED}. To use it here, update Counterparts: ${PLUGIN_UPDATE}; then ${RELOAD_STEP}.`,
    );
  });

  test("in Desktop's Code tab: a new session first", async () => {
    const s = server("plugin", NEWER, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" });
    bumpStore();
    expect(String((await s.call("remember", REMEMBER)).structuredContent["detail"])).toContain(`still runs the old one. Start a new session (in Claude Desktop's Code tab`);
  });

  test("only the CACHE ahead: the newer build's step is the plugin's too, and so is the restart after deleting it", async () => {
    const s = server("plugin", NEWER);
    bumpStore("cache");
    const detail = String((await s.call("remember", REMEMBER)).structuredContent["detail"]);
    expect(detail).toContain(`If that newer build is installed, ${RELOAD_STEP}.`);
    expect(detail).toEndWith(`to rebuild its word index, then ${RELOAD_STEP}.`);
    expect(detail).not.toContain("/mcp");
  });

  test("a newer build stamped the memory without moving its format: every result says how to load it here, not 'installed somewhere else'", async () => {
    const s = server("plugin", NEWER);
    expect((await s.call("status", {})).structuredContent["updated"]).toBeUndefined();
    s.counterpart.store.setMeta(WAKE_BUILD_KEY, NEWER);
    const updated = String((await s.call("status", {})).structuredContent["updated"]);
    expect(updated).toContain(`A newer version of Counterparts (${NEWER}) has written this memory; this window still runs ${LOADED}. To use it here, ${RELOAD_STEP}.`);
    expect(updated).not.toContain("installed somewhere else");
  });

  test("npm: unchanged — Reconnect", async () => {
    const s = server("npm", NEWER);
    bumpStore();
    expect((await s.call("remember", REMEMBER)).structuredContent["detail"]).toBe(STALE_SERVER_REFUSAL);
  });
});

describe("through the real MCP door: an old plugin server process, a store migrated after it started", () => {
  /** One `bin/serve.ts` process over stdio, as Claude Code starts the plugin's server. */
  async function withServer(env: Record<string, string>, body: (ask: (msg: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<void>): Promise<void> {
    const configPath = join(root, "claude-code.json");
    writeFileSync(configPath, JSON.stringify({ dataDir: dir }), "utf8");
    const child = spawn(process.execPath, ["run", SERVE_SCRIPT, "--config", configPath, "--dir", dir, "--scope", project], {
      env: { PATH: join(root, "bin"), HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", CLAUDE_PROJECT_DIR: project, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const waiting = new Map<number, (m: Record<string, unknown>) => void>();
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const m = JSON.parse(line) as Record<string, unknown>;
        const id = typeof m["id"] === "number" ? m["id"] : -1;
        waiting.get(id)?.(m);
      } catch {
        /* not a message */
      }
    });
    let next = 1;
    const ask = (msg: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const id = next++;
      const answered = new Promise<Record<string, unknown>>((done) => waiting.set(id, done));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...msg })}\n`);
      return answered;
    };
    try {
      await body(ask);
    } finally {
      child.stdin.end();
      child.kill();
    }
  }

  test("the plugin, a newer version recorded: tools/call answers the reload sentence", async () => {
    recordPlugin({ "counterparts@counterparts": coreRecord(`${NEWER}-${SHA}`) });
    await withServer({ CLAUDE_PLUGIN_ROOT: REPO_ROOT, CLAUDE_PLUGIN_DATA: join(root, "plugin-data") }, async (ask) => {
      const init = await ask({ method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } } });
      expect(init["result"]).toBeDefined();
      // The newer build migrates the store while this server runs.
      bumpStore();
      const r = await ask({ method: "tools/call", params: { name: "remember", arguments: REMEMBER } });
      const result = r["result"] as { isError?: boolean; structuredContent?: Record<string, unknown> };
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.["detail"]).toBe(`This tool did nothing: ${RELOAD_WORDS.charAt(0).toLowerCase()}${RELOAD_WORDS.slice(1)}`);
    });
  }, 120_000);

  test("the plugin, the same version recorded: the update sentence, so the reload can't loop", async () => {
    recordPlugin({ "counterparts@counterparts": coreRecord(`${LOADED}-${SHA}`) });
    await withServer({ CLAUDE_PLUGIN_ROOT: REPO_ROOT, CLAUDE_PLUGIN_DATA: join(root, "plugin-data") }, async (ask) => {
      await ask({ method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } } });
      bumpStore();
      const r = await ask({ method: "tools/call", params: { name: "status", arguments: {} } });
      const detail = String((r["result"] as { structuredContent?: Record<string, unknown> }).structuredContent?.["detail"]);
      expect(detail).toContain(`this one is ${LOADED}. To use it here, update Counterparts: ${PLUGIN_UPDATE}; then ${RELOAD_STEP}.`);
    });
  }, 120_000);
});

// ── the hook ────────────────────────────────────────────────────────────────

describe("through the real hook: an old hook against a newer store", () => {
  const configPath = (): string => join(root, "claude-code.json");

  function runHook(event: "SessionStart" | "UserPromptSubmit", session: string, env: Record<string, string>): { code: number; stdout: string; stderr: string } {
    writeFileSync(configPath(), JSON.stringify({ dataDir: dir, injectionBudgetBytes: 9000 }), "utf8");
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT, "--config", configPath()], {
      input: JSON.stringify({
        cwd: project,
        hook_event_name: event,
        session_id: session,
        ...(event === "SessionStart" ? { source: "startup" } : { prompt: "what did we decide yesterday?" }),
      }),
      encoding: "utf8",
      env: { PATH: join(root, "bin"), HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", ...env },
      timeout: 60_000,
    });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  function parsed(stdout: string): { person: string; model: string } {
    const o = JSON.parse(stdout) as { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
    return { person: o.systemMessage ?? "", model: o.hookSpecificOutput?.additionalContext ?? "" };
  }

  const PLUGIN_ENV = (): Record<string, string> => ({ CLAUDE_PLUGIN_ROOT: REPO_ROOT, CLAUDE_PLUGIN_DATA: join(root, "plugin-data") });

  test("the plugin (CLAUDE_PLUGIN_ROOT is this copy), a newer version recorded: the person gets the reload step, the model a line too", () => {
    seedStore();
    bumpStore();
    recordPlugin({ "counterparts@counterparts": coreRecord(`${NEWER}-${SHA}`) });
    const r = runHook("SessionStart", "sess-old-window-1", PLUGIN_ENV());
    expect(r.code).toBe(0);
    const { person, model } = parsed(r.stdout);
    expect(person).toBe(`Counterparts memory is OFF in this window: ${RELOAD_WORDS.charAt(0).toLowerCase()}${RELOAD_WORDS.slice(1)}`);
    expect(person).not.toContain("counterparts doctor");
    expect(model).toContain("Counterparts memory is off in this window: a newer version of Counterparts upgraded this memory");
    expect(model).toContain("Run /reload-plugins (if it warns about the cache, /reload-plugins --force), or start a new session.");
    expect(model).toContain("Don't act as if you remember earlier sessions; tell the person this step.");
    // No wake rode with it.
    expect(model).not.toContain("<!--");
    expect(r.stderr).toContain("hook stood down");
    // Told once: the next prompt in the same session is quiet; a new session is told.
    expect(runHook("UserPromptSubmit", "sess-old-window-1", PLUGIN_ENV()).stdout).toBe("");
    expect(parsed(runHook("UserPromptSubmit", "sess-old-window-2", PLUGIN_ENV()).stdout).person).toStartWith("Counterparts memory is OFF in this window");
  }, 120_000);

  test("the plugin, the same version recorded: update first", () => {
    seedStore();
    bumpStore();
    recordPlugin({ "counterparts@counterparts": coreRecord(`${LOADED}-${SHA}`) });
    const { person, model } = parsed(runHook("SessionStart", "sess-old-window-3", PLUGIN_ENV()).stdout);
    expect(person).toContain(`this one is ${LOADED}. To use it here, update Counterparts: ${PLUGIN_UPDATE}; then ${RELOAD_STEP}.`);
    expect(model).toContain(PLUGIN_UPDATE);
  }, 60_000);

  test("npm (no CLAUDE_PLUGIN_ROOT): the hook is the install, so the step updates it", () => {
    seedStore();
    bumpStore();
    // A plugin record is beside it, newer: it is not this hook's to reload.
    recordPlugin({ "counterparts@counterparts": coreRecord(NEWER) });
    const { person, model } = parsed(runHook("SessionStart", "sess-npm-1", {}).stdout);
    expect(person).toBe(
      `Counterparts memory is OFF in this window: a newer version of Counterparts upgraded this memory; this one is ${LOADED}. To use it here, update Counterparts: in a terminal, run ${npmUpdateCommand()}; then run /mcp and Reconnect.`,
    );
    expect(person).not.toContain("/reload-plugins");
    expect(model).toContain("Don't act as if you remember");
  }, 60_000);
});

describe("doctor's Store open line says the same step (constitution 16)", () => {
  function doctorInput(over: Partial<DoctorInput>): DoctorInput {
    return {
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: { dataDir: dir },
      dir,
      credentials: { loaded: [], skippedPresent: [], mode: null, permissive: false, reason: "absent" },
      credentialsPath: undefined,
      store: null,
      today: "2026-10-27",
      refusals: {},
      ...over,
    } as DoctorInput;
  }

  test("a store a newer copy upgraded: the update step for this route, not 'Restore <the database>'", () => {
    seedStore();
    bumpStore();
    const reading = readCounterpartOpen(dir);
    expect(reading.code).toBe("SCHEMA_AHEAD");
    const plugin = doctorFindings(doctorInput({ open: reading, install: "plugin" })).find((f) => f.key === "store-open");
    expect(plugin?.severity).toBe("red");
    expect(plugin?.fix).toContain(`this one is ${LOADED}. To use it here, update Counterparts: ${PLUGIN_UPDATE}; then ${RELOAD_STEP}.`);
    expect(plugin?.fix).not.toContain("Restore");
    const npm = doctorFindings(doctorInput({ open: reading, install: "npm" })).find((f) => f.key === "store-open");
    expect(npm?.fix).toContain(`update Counterparts: in a terminal, run ${npmUpdateCommand()}; then run /mcp and Reconnect.`);
  });
});

// ── the wake after an upgrade ───────────────────────────────────────────────

describe("the first watched wake after an upgrade names the older windows, once", () => {
  /** Older servers still running: two windows (two host processes), one with two servers. */
  function olderServers(build = { version: "0.3.30", storeSchema: SCHEMA_VERSION - 1, cacheSchema: CACHE_SCHEMA_VERSION }): void {
    // Believed live: running pids (this test and its parent) and fresh heartbeats.
    recordServerLaunch(dir, { scope: project, build, pid: process.pid, hostPid: 101 });
    recordServerLaunch(dir, { scope: join(root, "other"), build, pid: process.ppid, hostPid: 202 });
  }

  function wake(opts: { install?: InstallRoute; source?: string; nightRun?: boolean; embedder?: AdapterConfig["embedder"] } = {}): string {
    const a = openAdapter({ dataDir: dir, ...(opts.embedder === undefined ? {} : { embedder: opts.embedder }) }, {
      command: "/bin/true",
      args: ["runner"],
      spawner: () => ({ pid: 1 }),
      embedder: null,
      ...(opts.install === undefined ? {} : { install: opts.install }),
    });
    open.push(a.counterpart);
    const r = a.sessionStart({
      sessionId: `s-${Math.random().toString(36).slice(2)}`,
      scope: project,
      at: localDate(Date.now()),
      source: opts.source ?? "startup",
      ...(opts.nightRun === true ? { nightRun: true } : {}),
    });
    a.counterpart.close();
    open.length = 0;
    return r.injection ?? "";
  }

  const lineOf = (text: string): string | undefined => text.split("\n").find((l) => l.startsWith(STALE_WINDOWS_LEAD));

  test("plugin: two windows, the reload step for each; a second wake does not repeat it", () => {
    seedStore();
    olderServers();
    const first = wake({ install: "plugin" });
    expect(lineOf(first)).toBe(
      `${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. 2 Claude Code windows opened before that can't use it until they're reloaded: in each, ${RELOAD_STEP}."`,
    );
    expect(lineOf(wake({ install: "plugin" }))).toBeUndefined();
  });

  test("npm: Reconnect is the step; one window says 'there'", () => {
    seedStore();
    recordServerLaunch(dir, { scope: project, build: { version: "0.3.30", storeSchema: SCHEMA_VERSION, cacheSchema: CACHE_SCHEMA_VERSION - 1 }, pid: process.pid, hostPid: 101 });
    expect(lineOf(wake({ install: "npm" }))).toBe(
      `${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. 1 Claude Code window opened before that can't use it until it's reloaded: there, run /mcp and Reconnect."`,
    );
  });

  test("a nightly run or a compaction doesn't spend it; the next watched start says it", () => {
    seedStore();
    olderServers();
    expect(lineOf(wake({ install: "plugin", nightRun: true }))).toBeUndefined();
    expect(lineOf(wake({ install: "plugin", source: "compact" }))).toBeUndefined();
    expect(lineOf(wake({ install: "plugin" }))).toContain("2 Claude Code windows");
  });

  test("current servers, dead ones and stale heartbeats: nothing, and nothing claimed", () => {
    seedStore();
    recordServerLaunch(dir, { scope: project, build: { version: LOADED, storeSchema: SCHEMA_VERSION, cacheSchema: CACHE_SCHEMA_VERSION }, pid: process.pid, hostPid: 101 });
    const older = { version: "0.3.30", storeSchema: SCHEMA_VERSION - 1, cacheSchema: CACHE_SCHEMA_VERSION };
    // A pid nothing runs (a record a killed server left).
    recordServerLaunch(dir, { scope: project, build: older, pid: 2 ** 22 + 12345, hostPid: 303 });
    // A running pid whose heartbeat stopped an hour ago (the pid since reused by something else).
    recordServerLaunch(dir, { scope: project, build: older, pid: process.ppid, hostPid: 404 });
    const stale = (Date.now() - 3_600_000) / 1000;
    utimesSync(serverRecordPath(dir, process.ppid) ?? "", stale, stale);
    expect(lineOf(wake({ install: "plugin" }))).toBeUndefined();
    const s = Store.open({ dir });
    try {
      expect(s.getMeta(STALE_WINDOWS_TOLD_KEY)).toBeUndefined();
    } finally {
      s.close();
    }
  });

  test("it ranks above W1's meaning line, under the clock", () => {
    seedStore();
    olderServers();
    // W1's line due too: search by meaning on, and its table nowhere.
    const saved = process.env[STATIC_WEIGHTS_ENV];
    const empty = join(root, "no-table");
    mkdirSync(empty, { recursive: true });
    process.env[STATIC_WEIGHTS_ENV] = empty;
    let lines: string[];
    try {
      lines = wake({ install: "plugin", embedder: { enabled: true, kind: "static" } }).split("\n");
    } finally {
      if (saved === undefined) delete process.env[STATIC_WEIGHTS_ENV];
      else process.env[STATIC_WEIGHTS_ENV] = saved;
    }
    expect(lines[0]).toStartWith("Now: ");
    expect(lines.findIndex((l) => l.startsWith(STALE_WINDOWS_LEAD))).toBe(1);
    expect(lines.findIndex((l) => l.startsWith(MEANING_OFF_LEAD))).toBe(2);
  });

  test("Claude Desktop's wake says it too (not about its own server), and only once", () => {
    seedStore();
    olderServers();
    const s = Store.open({ dir });
    open.push(s);
    const input = { store: s, config: { dataDir: dir }, configPath: join(root, "claude-code.json"), today: localDate(Date.now()), env: {} };
    // Its own record is not an older window.
    expect(desktopWakeNotice({ ...input, night: true, selfPid: -1 })).toBeNull();
    const said = desktopWakeNotice({ ...input, selfPid: -1 });
    expect(said).toContain(`${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. 2 Claude Code windows`);
    expect(desktopWakeNotice({ ...input, selfPid: -1 }) ?? "").not.toContain(STALE_WINDOWS_LEAD);
  });

  test("an older Claude Desktop is named in its own words", () => {
    expect(staleWindowsWords({ windows: 0, desktop: true }, "npm")).toBe(
      `${STALE_WINDOWS_LEAD} "My memory was just upgraded to a newer version. Claude Desktop, open since before that, can't use it until you quit and reopen Claude Desktop."`,
    );
    expect(staleWindowsWords({ windows: 0, desktop: false }, "npm")).toBeNull();
    expect(staleWindowsWords({ windows: 1, desktop: false }, undefined)).toContain(`there, for the plugin, ${RELOAD_STEP}; for an npm install, run /mcp and Reconnect.`);
    // Desktop's place counts as Desktop, not as a window.
    expect(DESKTOP_SCOPE).toBe("claude-desktop:");
  });
});
