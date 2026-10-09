/**
 * THE CLAUDE CODE PLUGIN PROTOTYPE (2026-10-09): its files, the launcher, the
 * double-install guard and the first run.
 *
 * Hermetic like every test here: each case mints its own temp directory with a
 * temp HOME inside it, and every child process gets a curated `env` naming
 * that HOME (`test/preload.ts`, "where this guard stops"). `PATH` is a
 * directory with nothing in it, so no `git` grades the agent's own worktree
 * and no runtime is found by accident; the launcher is pinned to this test's
 * own bun through `COUNTERPARTS_RUNTIME`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { HOOK_SCRIPT, HOST_EVENTS, MCP_SCRIPT, MCP_SERVER_NAME, readHost } from "../src/adapters/cli/install.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import type { Finding, HostReading } from "../src/adapters/claude-code/doctor.js";
import { Counterpart } from "../src/core/counterpart.js";
import { Store } from "../src/core/store/index.js";
import { isOurHookCommand as wireIsOurs } from "../src/adapters/cli/wire.js";
import { HOST_SESSION_ENV } from "../src/adapters/claude-code/night-run.js";
import { NPM_MCP_NAME, claudeUserFiles, isOurHookCommand, npmWiring, pluginInstall } from "../src/adapters/host-wiring.js";
import {
  PACKAGE_ROOT,
  ensureFirstRun,
  firstRunLockPath,
  hookGate,
  mcpGate,
  runningAsPlugin,
} from "../src/adapters/plugin.js";
import type { ConfigChoice } from "../src/adapters/config-path.js";

const ROOT = resolve(import.meta.dir, "..");
const LAUNCHER = join(ROOT, "src", "adapters", "plugin-run.sh");
const LAUNCHER_ARG = "${CLAUDE_PLUGIN_ROOT}/src/adapters/plugin-run.sh";

let work: string;
let home: string;
let project: string;
let emptyBin: string;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-")));
  home = join(work, "home");
  project = join(home, "project");
  emptyBin = join(work, "bin");
  mkdirSync(project, { recursive: true });
  mkdirSync(emptyBin, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The environment Claude Code gives the plugin's processes, pointed at this
 *  test's HOME and this checkout as the plugin root. */
function pluginEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: emptyBin,
    HOME: home,
    USERPROFILE: home,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_DATA: join(home, ".claude", "plugins", "data", "counterparts-counterparts"),
    CLAUDE_PROJECT_DIR: project,
    COUNTERPARTS_RUNTIME: process.execPath,
    ...extra,
  };
}

function payload(event: string, session = "plugin-test-1"): string {
  return JSON.stringify({
    hook_event_name: event,
    session_id: session,
    cwd: project,
    transcript_path: join(project, "t.jsonl"),
    ...(event === "SessionStart" ? { source: "startup" } : {}),
    ...(event === "UserPromptSubmit" ? { prompt: "hello" } : {}),
  });
}

function launch(mode: string, input: string, env: Record<string, string>): { code: number; stdout: string; stderr: string } {
  const r = spawnSync("/bin/sh", [LAUNCHER, mode], { input, encoding: "utf8", env, timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function systemMessage(stdout: string): string | null {
  if (stdout.trim().length === 0) return null;
  const v = (JSON.parse(stdout) as Record<string, unknown>)["systemMessage"];
  return typeof v === "string" ? v : null;
}

/** A live `<runtime> run <hook.ts>` line, exactly as `connect` writes it. */
function liveHookCommand(): string {
  return `"${process.execPath}" run "${HOOK_SCRIPT}"`;
}

function writeSettings(hooks: Record<string, string[]>): void {
  mkdirSync(join(home, ".claude"), { recursive: true });
  const value: Record<string, unknown> = {};
  for (const [event, commands] of Object.entries(hooks)) {
    value[event] = [{ hooks: commands.map((command) => ({ type: "command", command })) }];
  }
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: value }), "utf8");
}

function defaultChoice(): ConfigChoice {
  return { path: join(home, ".counterparts", "claude-code.json"), source: "default", refusal: null };
}

/** An environment for the first run's own child: this HOME, no guard. */
function firstRunEnv(): Record<string, string | undefined> {
  return { PATH: emptyBin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}

// ── the files Claude Code reads ─────────────────────────────────────────────

describe("the plugin's files", () => {
  const pkg = readJson(join(ROOT, "package.json"));

  test("plugin.json names the plugin, keeps the package's version, and launches the server from the plugin root", () => {
    const manifest = readJson(join(ROOT, ".claude-plugin", "plugin.json"));
    expect(manifest["name"]).toBe("counterparts");
    // Setting `version` pins plugin users to it until it changes, so it moves
    // with the npm release and only with it.
    expect(manifest["version"]).toBe(pkg["version"]);
    const servers = manifest["mcpServers"] as Record<string, { command: string; args: string[] }>;
    expect(Object.keys(servers)).toEqual(["counterparts"]);
    expect(servers["counterparts"]).toEqual({ command: "sh", args: [LAUNCHER_ARG, "mcp"] });
  });

  test("hooks.json wires exactly the five events `install` wires, each to the launcher", () => {
    const file = readJson(join(ROOT, "hooks", "hooks.json"));
    const hooks = file["hooks"] as Record<string, { hooks: { type: string; command: string; args: string[] }[] }[]>;
    expect(Object.keys(hooks).sort()).toEqual([...HOST_EVENTS].sort());
    for (const event of HOST_EVENTS) {
      expect(hooks[event]).toEqual([{ hooks: [{ type: "command", command: "sh", args: [LAUNCHER_ARG, "hook"] }] }]);
    }
  });

  test("marketplace.json lists the repository root as the plugin", () => {
    const market = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
    expect(market["name"]).toBe("counterparts");
    const plugins = market["plugins"] as { name: string; source: string }[];
    expect(plugins.map((p) => [p.name, p.source])).toEqual([["counterparts", "./"]]);
  });

  test("the npm tarball is untouched: none of the plugin's own files is in `files`", () => {
    const files = pkg["files"] as string[];
    for (const f of [".claude-plugin", ".claude-plugin/", "hooks", "hooks/", "commands", "commands/"]) {
      expect(files).not.toContain(f);
    }
  });

  test("no top-level bin/ (chat and Cowork refuse such a plugin) and no root .mcp.json (it would be every dev session's project config)", () => {
    expect(existsSync(join(ROOT, "bin"))).toBe(false);
    expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  });

  test("the server name the plugin guard looks for is the one `connect` registers", () => {
    expect(NPM_MCP_NAME).toBe(MCP_SERVER_NAME);
  });

  test("the move left wire.ts recognising exactly what it recognised", () => {
    expect(wireIsOurs).toBe(isOurHookCommand);
  });

  test("the headless night run strips the plugin's variables from its child", () => {
    expect(HOST_SESSION_ENV).toContain("CLAUDE_PLUGIN_ROOT");
    expect(HOST_SESSION_ENV).toContain("CLAUDE_PLUGIN_DATA");
  });
});

// ── which process is the plugin's ───────────────────────────────────────────

describe("runningAsPlugin", () => {
  test("only when CLAUDE_PLUGIN_ROOT is this package", () => {
    expect(runningAsPlugin({}, ROOT)).toBe(false);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: "" }, ROOT)).toBe(false);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: ROOT }, ROOT)).toBe(true);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: work }, ROOT)).toBe(false);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: ROOT })).toBe(true);
    expect(realpathSync(PACKAGE_ROOT)).toBe(realpathSync(ROOT));
  });

  test("through a symlink, the same plugin", () => {
    const link = join(work, "link");
    symlinkSync(ROOT, link);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: link }, ROOT)).toBe(true);
  });
});

// ── the npm wiring, read ────────────────────────────────────────────────────

describe("npmWiring and the two gates", () => {
  test("nothing wired: nobody stands down", () => {
    const w = npmWiring({ home, env: {}, cwd: project });
    expect(w).toEqual({ hooks: [], mcp: [] });
    expect(hookGate(w, home)).toEqual({ standDown: false, line: null });
    expect(mcpGate(w, home)).toEqual({ standDown: false, instructions: null });
  });

  test("live npm hooks: the plugin's hooks stand down, and say how to move", () => {
    writeSettings({ SessionStart: [liveHookCommand()], Stop: [liveHookCommand()] });
    const w = npmWiring({ home, env: {}, cwd: project });
    expect(w.hooks.map((h) => [h.event, h.live])).toEqual([
      ["SessionStart", true],
      ["Stop", true],
    ]);
    const gate = hookGate(w, home);
    expect(gate.standDown).toBe(true);
    expect(gate.line).toContain("installed twice");
    expect(gate.line).toContain("~/.claude/settings.json");
    expect(gate.line).toContain("counterparts disconnect");
  });

  test("a dead npm entry runs nothing, so the plugin carries on and names it", () => {
    writeSettings({ SessionStart: [`"${join(work, "gone", "bun")}" run "${join(work, "gone", "src", "adapters", "claude-code", "bin", "hook.ts")}"`] });
    const gate = hookGate(npmWiring({ home, env: {}, cwd: project }), home);
    expect(gate.standDown).toBe(false);
    expect(gate.line).toContain("no longer runs");
  });

  test("somebody else's hooks, and a wrapper around ours, are not the npm wiring", () => {
    writeSettings({ SessionStart: ["~/bin/log.sh", `~/bin/log.sh && ${liveHookCommand()}`] });
    expect(npmWiring({ home, env: {}, cwd: project }).hooks).toEqual([]);
  });

  test("project and local settings count too", () => {
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.local.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: liveHookCommand() }] }] } }),
    );
    const w = npmWiring({ home, env: {}, cwd: project });
    expect(w.hooks.map((h) => h.file)).toEqual([join(project, ".claude", "settings.local.json")]);
  });

  test("CLAUDE_CONFIG_DIR moves both files to its top level (measured on 2.1.295)", () => {
    const cfg = join(work, "cfg");
    expect(claudeUserFiles(home, { CLAUDE_CONFIG_DIR: cfg })).toEqual({
      settings: join(cfg, "settings.json"),
      globalConfig: join(cfg, ".claude.json"),
    });
    mkdirSync(cfg, { recursive: true });
    writeFileSync(
      join(cfg, "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: liveHookCommand() }] }] } }),
    );
    expect(npmWiring({ home, env: { CLAUDE_CONFIG_DIR: cfg }, cwd: project }).hooks).toHaveLength(1);
    // And ~/.claude/settings.json is NOT read when the variable moves it.
    expect(npmWiring({ home: join(work, "elsewhere"), env: { CLAUDE_CONFIG_DIR: cfg }, cwd: null }).hooks).toHaveLength(1);
  });

  test("a live `counterparts` server in the user or local scope stands the plugin's server down", () => {
    const entry = { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT], env: {} };
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: entry } }));
    let gate = mcpGate(npmWiring({ home, env: {}, cwd: project }), home);
    expect(gate.standDown).toBe(true);
    expect(gate.instructions).toContain("standing down");
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { other: entry }, projects: { [project]: { mcpServers: { counterparts: entry } } } }),
    );
    gate = mcpGate(npmWiring({ home, env: {}, cwd: project }), home);
    expect(gate.standDown).toBe(true);
    expect(gate.instructions).toContain("local scope");
  });

  test("a registration whose runtime is gone does not stand anybody down", () => {
    const entry = { type: "stdio", command: join(work, "gone", "bun"), args: ["run", MCP_SCRIPT] };
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: entry } }));
    expect(mcpGate(npmWiring({ home, env: {}, cwd: project }), home).standDown).toBe(false);
  });
});

// ── the first run ───────────────────────────────────────────────────────────

describe("ensureFirstRun", () => {
  const lockIn = (): string => firstRunLockPath(defaultChoice().path, work);

  test("a named configuration is never created for the person", () => {
    const r = ensureFirstRun({
      choice: { path: join(work, "named.json"), source: "--config", refusal: null },
      env: firstRunEnv(),
      home,
      lockPath: lockIn(),
    });
    expect(r.state).toBe("skipped");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the explicit-dir guard stands it down", () => {
    const r = ensureFirstRun({
      choice: defaultChoice(),
      env: { ...firstRunEnv(), COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
      home,
      lockPath: lockIn(),
    });
    expect(r.state).toBe("skipped");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("creates exactly what `counterparts install` creates, once", () => {
    const r = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn() });
    expect(r.state).toBe("created");
    expect(r.line).toContain("first run");
    expect(r.line).toContain("~/.counterparts");
    const config = readJson(defaultChoice().path);
    expect(config["dataDir"]).toBe(join(realpathSync(home), ".counterparts", "store"));
    expect(existsSync(join(home, ".counterparts", "store", "counterparts.sqlite"))).toBe(true);
    expect(existsSync(lockIn())).toBe(false);
    const again = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn() });
    expect(again).toEqual({ state: "existed", line: null });
  });

  test("a concurrent first run is waited for, and joined", async () => {
    mkdirSync(lockIn());
    // Another process "installs" while this one waits (the wait blocks this
    // thread, so the writer has to be a separate process).
    const config = defaultChoice().path;
    const writer = spawn("/bin/sh", ["-c", `sleep 0.4; mkdir -p "${join(home, ".counterparts")}"; echo '{}' > "${config}"`]);
    const r = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn(), waitMs: 10_000 });
    await new Promise((done) => writer.on("exit", done));
    expect(r.state).toBe("joined");
    expect(r.line).toContain("first run");
  });

  test("a stale lock is taken over", () => {
    mkdirSync(lockIn());
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lockIn(), old, old);
    const r = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn() });
    expect(r.state).toBe("created");
  });

  test("a live lock that never yields a configuration times out, writing nothing", () => {
    mkdirSync(lockIn());
    const r = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn(), waitMs: 300 });
    expect(r.state).toBe("failed");
    expect(r.detail).toContain("timed out");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });
});

// ── the launcher, end to end (no Claude Code; the plugin's processes as it runs them) ──

describe("plugin-run.sh", () => {
  test("SessionStart on a machine with no install: first run, then the wake", () => {
    const r = launch("hook", payload("SessionStart"), pluginEnv());
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { systemMessage?: string; hookSpecificOutput?: { additionalContext?: string } };
    expect(out.systemMessage).toContain("first run");
    expect(out.hookSpecificOutput?.additionalContext ?? "").toContain("Now:");
    expect(existsSync(join(home, ".counterparts", "claude-code.json"))).toBe(true);
    // The second session says nothing about a first run.
    const again = launch("hook", payload("SessionStart", "plugin-test-2"), pluginEnv());
    expect(again.stdout).not.toContain("first run");
  });

  test("the npm hooks live: SessionStart says so once, a prompt says nothing, and no store is made", () => {
    writeSettings({ SessionStart: [liveHookCommand()], UserPromptSubmit: [liveHookCommand()] });
    const start = launch("hook", payload("SessionStart"), pluginEnv());
    expect(start.code).toBe(0);
    expect(systemMessage(start.stdout)).toContain("installed twice");
    expect(start.stdout).not.toContain("additionalContext");
    const prompt = launch("hook", payload("UserPromptSubmit"), pluginEnv());
    expect(prompt.stdout).toBe("");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("not launched as the plugin (no CLAUDE_PLUGIN_ROOT): no first run", () => {
    const env = pluginEnv();
    delete env["CLAUDE_PLUGIN_ROOT"];
    const r = launch("hook", payload("SessionStart"), { ...env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("first run");
    expect(existsSync(join(home, ".counterparts", "claude-code.json"))).toBe(false);
  });

  test("no runtime: SessionStart says what to install, every other event is silent, the server exits 127", () => {
    const env = pluginEnv({ COUNTERPARTS_RUNTIME: join(work, "no", "bun") });
    const start = launch("hook", payload("SessionStart"), env);
    expect(start.code).toBe(0);
    const out = JSON.parse(start.stdout) as { systemMessage: string; hookSpecificOutput: { hookEventName: string } };
    expect(out.systemMessage).toContain("Bun 1.3+ or Node.js 22.15+");
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(launch("hook", payload("Stop"), env)).toEqual({ code: 0, stdout: "", stderr: "" });
    const server = launch("mcp", "", env);
    expect(server.code).toBe(127);
    expect(server.stderr).toContain("Bun 1.3+ or Node.js 22.15+");
  });

  test("a Node older than 22.15 is not a runtime", () => {
    const fake = join(emptyBin, "node");
    writeFileSync(fake, "#!/bin/sh\necho v20.19.1\n", { mode: 0o755 });
    const r = launch("mcp", "", pluginEnv({ COUNTERPARTS_RUNTIME: fake }));
    expect(r.code).toBe(127);
  });

  const rpc = (lines: object[]): string => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const handshake = rpc([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]);
  const responses = (stdout: string): Record<string, unknown>[] =>
    stdout
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  test("the server, npm registration live: the protocol, no tools, the reason in instructions, nothing opened", () => {
    const entry = { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT] };
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: entry } }));
    const r = launch("mcp", handshake, pluginEnv());
    const [init, list] = responses(r.stdout);
    expect((init?.["result"] as { instructions: string }).instructions).toContain("standing down");
    expect((list?.["result"] as { tools: unknown[] }).tools).toEqual([]);
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  test("the server on a machine with no install: first run, then every tool", () => {
    const r = launch("mcp", handshake, pluginEnv());
    const [, list] = responses(r.stdout);
    const tools = (list?.["result"] as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(tools).toContain("recall");
    expect(tools).toContain("note");
    expect(existsSync(join(home, ".counterparts", "claude-code.json"))).toBe(true);
  });
});

// ── doctor, for a plugin install ────────────────────────────────────────────

describe("doctor's Claude Code line knows the plugin", () => {
  const ID = "counterparts@counterparts";

  function recordPlugin(enabled?: boolean, file = join(home, ".claude", "settings.json")): void {
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { [ID]: [{ scope: "user", installPath: join(home, "cache", "0.3.12"), version: "0.3.12" }] },
      }),
    );
    if (enabled !== undefined) {
      mkdirSync(join(file, ".."), { recursive: true });
      const was = existsSync(file) ? readJson(file) : {};
      writeFileSync(file, JSON.stringify({ ...was, enabledPlugins: { [ID]: enabled } }));
    }
  }

  function hostFinding(host: HostReading): Finding {
    const dir = join(work, "store");
    Counterpart.open({ dir }).close();
    const store = Store.open({ dir });
    try {
      const found = doctorFindings({
        configPath: join(work, "claude-code.json"),
        configReason: "loaded",
        config: { dataDir: dir },
        dir,
        store,
        today: "2026-10-09",
        refusals: {},
        host,
      }).find((f) => f.key === "host");
      if (found === undefined) throw new Error("no host finding");
      return found;
    } finally {
      store.close();
    }
  }

  test("pluginInstall reads Claude Code's record and the enabled switch, local settings last", () => {
    expect(pluginInstall({ home, env: {}, cwd: project })).toBeNull();
    recordPlugin();
    expect(pluginInstall({ home, env: {}, cwd: project })).toEqual({
      id: ID,
      installPath: join(home, "cache", "0.3.12"),
      version: "0.3.12",
      enabled: true,
    });
    recordPlugin(false);
    expect(pluginInstall({ home, env: {}, cwd: project })?.enabled).toBe(false);
    recordPlugin(true, join(project, ".claude", "settings.local.json"));
    expect(pluginInstall({ home, env: {}, cwd: project })?.enabled).toBe(true);
  });

  test("the plugin alone is connected — not \"run counterparts connect\"", () => {
    recordPlugin();
    const f = hostFinding(readHost(home, project, {}));
    expect(f.severity).toBe("green");
    expect(f.detail).toContain("connected as the Claude Code plugin (counterparts@counterparts 0.3.12)");
    expect(f.fix).toBe("");
  });

  test("a disabled plugin is no install: the line is what it always was", () => {
    recordPlugin(false);
    const f = hostFinding(readHost(home, project, {}));
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("no hook of ours is connected");
  });

  test("the plugin AND the npm wiring: amber, and both ways out", () => {
    const hooks: Record<string, string[]> = {};
    for (const e of HOST_EVENTS) hooks[e] = [liveHookCommand()];
    writeSettings(hooks);
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { counterparts: { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT] } } }),
    );
    recordPlugin(true);
    const f = hostFinding(readHost(home, project, {}));
    expect(f.severity).toBe("amber");
    expect(f.detail).toContain("ALSO installed as the Claude Code plugin");
    expect(f.fix).toContain("counterparts disconnect");
    expect(f.fix).toContain("claude plugin uninstall counterparts@counterparts");
  });
});
