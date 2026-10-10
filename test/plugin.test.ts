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
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
  npmDoctorCommand,
  pluginOrigin,
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

  test("marketplace.json pins the plugin to a release tag — never a branch, HEAD, or the checkout itself", () => {
    // A `./` source, a branch, or no `ref` at all would hand a stranger
    // whatever master holds. The pin names a release tag, and each release
    // moves it (docs/plugin.md, "Releasing"). Until the first release that
    // carries the plugin's files, it names that release, whose tag doesn't
    // exist yet, so an install fails rather than fetch unreleased code: 0.3.12
    // and earlier have no plugin to install. If #328 misses 0.3.13, raise
    // FIRST_PLUGIN_RELEASE (and the pin) to the release it ships in.
    const FIRST_PLUGIN_RELEASE = "0.3.13";
    const market = readJson(join(ROOT, ".claude-plugin", "marketplace.json"));
    expect(market["name"]).toBe("counterparts");
    const plugins = market["plugins"] as { name: string; source: unknown; version?: unknown }[];
    expect(plugins.map((p) => p.name)).toEqual(["counterparts"]);
    const entry = plugins[0]!;
    // plugin.json's version is the one Claude Code uses; one in the entry too
    // would only be a second number to keep in step.
    expect(entry.version).toBeUndefined();
    const source = entry.source as Record<string, unknown>;
    expect(typeof source).toBe("object");
    expect(source["source"]).toBe("github");
    expect(source["repo"]).toBe("mlapeter/counterparts");
    const ref = String(source["ref"] ?? "");
    // A tag shaped like a release: not main, master, HEAD, refs/…, or a sha.
    expect(ref).toMatch(/^v\d+\.\d+\.\d+$/);
    if (source["sha"] !== undefined) expect(String(source["sha"])).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(source).sort()).toEqual(source["sha"] === undefined ? ["ref", "repo", "source"] : ["ref", "repo", "sha", "source"]);

    const semver = (v: string): number[] => v.replace(/^v/, "").split(".").map(Number);
    const below = (a: string, b: string): boolean => {
      const [x, y] = [semver(a), semver(b)];
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
      return false;
    };
    const version = String(pkg["version"]);
    const expected = below(version, FIRST_PLUGIN_RELEASE) ? `v${FIRST_PLUGIN_RELEASE}` : `v${version}`;
    if (ref !== expected) {
      throw new Error(
        `package.json is ${version} and marketplace.json pins ${ref}; the pin must be ${expected}. ` +
          `Move the pin in the release commit: docs/plugin.md, "Releasing".`,
      );
    }
  });

  test("the npm tarball is untouched: none of the plugin's own files is in `files`", () => {
    const files = pkg["files"] as string[];
    for (const f of [".claude-plugin", ".claude-plugin/", "hooks", "hooks/", "commands", "commands/"]) {
      expect(files).not.toContain(f);
    }
  });

  test("/counterparts:doctor grants exactly the one command it runs, and no plugin command grants more", () => {
    // Claude Code substitutes ${CLAUDE_PLUGIN_ROOT} in a plugin command's
    // `allowed-tools` (2.1.295), so the rule is the launcher's absolute path,
    // `cli doctor`, and nothing else — not `Bash(sh:*)`, which let any `sh …`
    // run unprompted while the command ran.
    const text = readFileSync(join(ROOT, "commands", "doctor.md"), "utf8");
    const grant = /^allowed-tools:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const run = `sh "${LAUNCHER_ARG}" cli doctor`;
    expect(grant).toBe(`Bash(${run})`);
    expect(text).toContain(`\n${run}\n`);
    for (const name of readdirSync(join(ROOT, "commands"))) {
      const body = readFileSync(join(ROOT, "commands", name), "utf8");
      for (const m of body.matchAll(/^allowed-tools:\s*(.+)$/gm)) {
        expect(m[1] ?? "").not.toMatch(/:\*|\*|^Bash\s*(,|$)|Bash\(\s*\)/);
      }
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

  test("live npm hooks, an installed plugin: its hooks stand down, and moving is offered as optional", () => {
    writeSettings({ SessionStart: [liveHookCommand()], Stop: [liveHookCommand()] });
    const w = npmWiring({ home, env: {}, cwd: project });
    expect(w.hooks.map((h) => [h.event, h.live])).toEqual([
      ["SessionStart", true],
      ["Stop", true],
    ]);
    const gate = hookGate(w, home, { installed: true, root: join(home, ".claude", "plugins", "cache", "m", "counterparts", "0.3.13") });
    expect(gate.standDown).toBe(true);
    expect(gate.line).toContain("installed twice");
    expect(gate.line).toContain("~/.claude/settings.json");
    expect(gate.line).toContain("nothing needs to change");
    expect(gate.line).toContain("Optional, only if you want the plugin alone: `counterparts disconnect`");
  });

  test("live npm wiring, the plugin run from a folder (--plugin-dir): expected, and nothing is suggested", () => {
    writeSettings({ SessionStart: [liveHookCommand()] });
    const dev = { installed: false, root: join(home, "src", "counterparts") };
    const gate = hookGate(npmWiring({ home, env: {}, cwd: project }), home, dev);
    expect(gate.standDown).toBe(true);
    expect(gate.line).toContain("running from a folder (~/src/counterparts)");
    expect(gate.line).toContain("Nothing to do.");
    expect(gate.line).not.toContain("disconnect");
    const entry = { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT], env: {} };
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: entry } }));
    const server = mcpGate(npmWiring({ home, env: {}, cwd: project }), home, dev);
    expect(server.standDown).toBe(true);
    expect(server.instructions).toContain("Nothing needs to change");
    expect(server.instructions).not.toContain("`counterparts disconnect`");
    // An install's server says moving is the person's choice, never one to make for them.
    expect(mcpGate(npmWiring({ home, env: {}, cwd: project }), home).instructions).toContain("never one to make for them");
  });

  test("pluginOrigin: under Claude Code's plugins directory, or the recorded install path, is an install; anything else is a folder", () => {
    const cached = join(home, ".claude", "plugins", "cache", "m", "counterparts", "0.3.13");
    mkdirSync(cached, { recursive: true });
    expect(pluginOrigin({ home, env: {}, root: cached }).installed).toBe(true);
    const dev = join(work, "checkout");
    mkdirSync(dev, { recursive: true });
    expect(pluginOrigin({ home, env: {}, root: dev })).toEqual({ installed: false, root: dev });
    // A folder marketplace is read in place: the recorded installPath is an install too.
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "counterparts@local": [{ scope: "user", installPath: dev, version: "0.3.13" }] } }),
    );
    expect(pluginOrigin({ home, env: {}, root: dev }).installed).toBe(true);
    // CLAUDE_CODE_PLUGIN_CACHE_DIR moves the plugins directory.
    const moved = join(work, "plugin-cache");
    mkdirSync(join(moved, "cache", "x"), { recursive: true });
    expect(pluginOrigin({ home, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: moved }, root: join(moved, "cache", "x") }).installed).toBe(true);
    expect(pluginOrigin({ home, env: { CLAUDE_CODE_PLUGIN_CACHE_DIR: moved }, root: cached }).installed).toBe(false);
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

  test("each process reads only its own half: the hook never parses ~/.claude.json", () => {
    writeSettings({ Stop: [liveHookCommand()] });
    // Both halves are wired, so each side's empty half is the option at work.
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { counterparts: { command: process.execPath, args: ["run", MCP_SCRIPT] } } }),
    );
    const hookSide = npmWiring({ home, env: {}, cwd: project, read: { mcp: false } });
    expect(hookSide.hooks).toHaveLength(1);
    expect(hookSide.mcp).toEqual([]);
    const serverSide = npmWiring({ home, env: {}, cwd: project, read: { hooks: false } });
    expect(serverSide.hooks).toEqual([]);
    expect(serverSide.mcp).toHaveLength(1);
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

  test("a memory parked beside it is named in the first-run line, and left where it is", () => {
    const parked = join(home, ".counterparts.parked-2026-10-01");
    mkdirSync(join(parked, "store"), { recursive: true });
    mkdirSync(join(home, ".counterparts.parked-someday"), { recursive: true });
    const r = ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: lockIn() });
    expect(r.state).toBe("created");
    expect(r.line).toContain("A memory set aside earlier is still at ~/.counterparts.parked-2026-10-01, untouched");
    expect(r.line).not.toContain("someday");
    expect(existsSync(join(parked, "store"))).toBe(true);
  });

  test("a concurrent first run is waited for, and joined", async () => {
    mkdirSync(lockIn());
    // Another process "installs" while this one waits (the wait blocks this
    // thread, so the writer has to be a separate process).
    const config = defaultChoice().path;
    const writer = spawn("/bin/sh", ["-c", `sleep 0.4; mkdir -p "${join(home, ".counterparts")}"; echo '{}' > "${config}"`], {
      env: { ...firstRunEnv(), PATH: "/bin:/usr/bin" } as NodeJS.ProcessEnv,
    });
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
  /** An npm install's layout in the work dir: its hook script and, unless told not to, its console printing what it was asked. */
  function fakeInstall(withCli = true): string {
    const root = join(work, "npm-install");
    mkdirSync(join(root, "src", "adapters", "claude-code", "bin"), { recursive: true });
    writeFileSync(join(root, "src", "adapters", "claude-code", "bin", "hook.ts"), "// a stand-in hook\n");
    if (withCli) {
      mkdirSync(join(root, "src", "adapters", "cli", "bin"), { recursive: true });
      writeFileSync(
        join(root, "src", "adapters", "cli", "bin", "counterparts.ts"),
        'console.log(`wired doctor ran: ${process.argv.slice(2).join(" ")} (plugin root: ${process.env.CLAUDE_PLUGIN_ROOT ?? "none"})`);\n',
      );
    }
    writeSettings({ SessionStart: [`"${process.execPath}" run "${join(root, "src", "adapters", "claude-code", "bin", "hook.ts")}" --config "${join(work, "claude-code.json")}"`] });
    return root;
  }

  function pathCounterparts(): string {
    const bin = join(work, "path-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "counterparts"), '#!/bin/sh\necho "PATH doctor ran: $*"\n');
    chmodSync(join(bin, "counterparts"), 0o755);
    return bin;
  }

  function doctor(env: Record<string, string>): { status: number | null; stdout: string } {
    const e = { ...env };
    delete e["CLAUDE_PLUGIN_ROOT"]; // a Bash call from the command carries none; the launcher sets it
    const r = spawnSync("/bin/sh", [LAUNCHER, "cli", "doctor"], { encoding: "utf8", env: e, timeout: 60_000 });
    return { status: r.status, stdout: r.stdout ?? "" };
  }

  test("/counterparts:doctor beside a live npm install: says the plugin stands down, then runs THAT install's doctor with its runtime and config", () => {
    fakeInstall();
    const r = doctor(pluginEnv({ PATH: `${pathCounterparts()}:${emptyBin}` }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("is standing down: the npm install is the live one here (its hooks in ~/.claude/settings.json)");
    expect(r.stdout).toContain("This plugin (running from "); // this checkout is a folder, not an install
    expect(r.stdout).toContain(`wired doctor ran: doctor --config ${join(work, "claude-code.json")} (plugin root: none)`);
    expect(r.stdout).not.toContain("PATH doctor"); // PATH's `counterparts` might be another install
  });

  test("/counterparts:doctor: the wired install's console can't be found, so PATH's `counterparts`; neither, so how to run it", () => {
    fakeInstall(false);
    expect(doctor(pluginEnv({ PATH: `${pathCounterparts()}:${emptyBin}` })).stdout).toContain("PATH doctor ran: doctor");
    const none = doctor(pluginEnv());
    expect(none.status).toBe(0);
    expect(none.stdout).toContain("is standing down");
    expect(none.stdout).toContain("Run `counterparts doctor` in a terminal.");
  });

  test("npmDoctorCommand reads a node-wired entry too, and skips one it can't read", () => {
    const root = fakeInstall();
    const hook = join(root, "src", "adapters", "claude-code", "bin", "hook.ts");
    const hooksMjs = join(root, "src", "adapters", "node-hooks.mjs");
    expect(
      npmDoctorCommand({ hooks: [{ file: "f", event: "Stop", command: `"/usr/bin/node" --import "${hooksMjs}" "${hook}"`, live: true }], mcp: [] }),
    ).toEqual({ exe: "/usr/bin/node", args: ["--import", hooksMjs, join(root, "src", "adapters", "cli", "bin", "counterparts.ts"), "doctor"] });
    expect(npmDoctorCommand({ hooks: [{ file: "f", event: "Stop", command: "~/bin/wrapper.sh", live: true }], mcp: [] })).toBeNull();
  });

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
    // Launched from this checkout, not from Claude Code's plugins directory: a
    // folder beside the npm install, which is expected and needs nothing done.
    expect(systemMessage(start.stdout)).toContain("running from a folder");
    expect(systemMessage(start.stdout)).not.toContain("disconnect");
    expect(start.stdout).not.toContain("additionalContext");
    const prompt = launch("hook", payload("UserPromptSubmit"), pluginEnv());
    expect(prompt.stdout).toBe("");
    expect(existsSync(join(home, ".counterparts"))).toBe(false);
  });

  // THE SHAPES AN NPM INSTALL WIRES, each of which must make the plugin stand
  // down (2026-10-09: a plugin copy that predated #349 could not read the
  // `--no-env-file "--config=…"` shape 0.3.14's `connect` writes, did not stand
  // down, and Mike got a second wake and a second recall on every prompt).
  for (const shape of ["0.3.13 and before", "0.3.14 (--no-env-file, --config=)", "single binary"] as const) {
    test(`all five npm hooks live in the ${shape} shape: the plugin stands down, says so once, wakes nothing, opens no store`, () => {
      const npm = join(work, "npm-install");
      const hookTs = join(npm, "src", "adapters", "claude-code", "bin", "hook.ts");
      mkdirSync(dirname(hookTs), { recursive: true });
      writeFileSync(hookTs, "// a stand-in hook\n");
      writeFileSync(join(npm, "src", "adapters", "empty-bunfig.toml"), "");
      const bin = join(work, "npm-bin");
      mkdirSync(bin, { recursive: true });
      if (!existsSync(join(bin, "bun"))) symlinkSync(process.execPath, join(bin, "bun"));
      const binary = join(bin, "counterparts");
      writeFileSync(binary, "#!/bin/sh\nexit 0\n");
      chmodSync(binary, 0o755);
      const command =
        shape === "0.3.13 and before"
          ? `"bun" run "${hookTs}"`
          : shape === "0.3.14 (--no-env-file, --config=)"
            ? `"bun" --no-env-file "--config=${join(npm, "src", "adapters", "empty-bunfig.toml")}" run "${hookTs}"`
            : `"${binary}" hook`;
      writeSettings({ SessionStart: [command], UserPromptSubmit: [command], Stop: [command], SessionEnd: [command], PreCompact: [command] });
      const env = pluginEnv({ PATH: `${bin}:${emptyBin}`, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });
      const start = launch("hook", payload("SessionStart"), env);
      expect(start.code).toBe(0);
      expect(start.stderr).toContain("plugin hook stood down");
      const said = systemMessage(start.stdout) ?? "";
      expect(said).toContain("running from a folder");
      expect(said).toContain("Nothing to do.");
      expect(start.stdout).not.toContain("additionalContext"); // no wake
      const prompt = launch("hook", payload("UserPromptSubmit"), env);
      expect(prompt.code).toBe(0);
      expect(prompt.stdout).toBe(""); // no recall
      expect(prompt.stderr).toContain("plugin hook stood down");
      // No store opened: the gate stops the hook before the plugin's first run,
      // which is where a store would be chosen. (With the gate broken, the
      // explicit-dir guard above refuses that first run, so the folder below
      // stays absent either way; the "first run" lines are what tell.)
      expect(start.stderr).not.toContain("first run");
      expect(prompt.stderr).not.toContain("first run");
      expect(existsSync(join(home, ".counterparts"))).toBe(false);
    });
  }

  test("not launched as the plugin (no CLAUDE_PLUGIN_ROOT): no first run", () => {
    const env = pluginEnv();
    delete env["CLAUDE_PLUGIN_ROOT"];
    const r = launch("hook", payload("SessionStart"), { ...env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("first run");
    expect(existsSync(join(home, ".counterparts", "claude-code.json"))).toBe(false);
  });

  test("no runtime: SessionStart says what to install, every other event is silent, the server exits 127", () => {
    // The single binary's download is off, so this never reaches the network
    // whatever `.claude-plugin/binaries.json` holds (test/plugin-binary.test.ts
    // covers the download).
    const env = pluginEnv({ COUNTERPARTS_RUNTIME: join(work, "no", "bun"), COUNTERPARTS_BINARY_DOWNLOAD: "off" });
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
    const r = launch("mcp", "", pluginEnv({ COUNTERPARTS_RUNTIME: fake, COUNTERPARTS_BINARY_DOWNLOAD: "off" }));
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

// ── the npm install's own processes (review of #328) ────────────────────────
//
// The owner runs Counterparts from the npm install, and this PR's runtime code
// ships in that same package. These run the hook and the server exactly as
// `connect` wires them — `<runtime> run <script>`, no launcher, no guard (the
// owner's host has none) — with the plugin ALSO recorded installed and enabled,
// and once more with a `CLAUDE_PLUGIN_ROOT` inherited from somewhere, naming
// another copy. Nothing of the plugin's may happen in any of them: no first
// run, no stand-down, no line of its own, and the same bytes either way.

describe("the npm install's hook and server never take themselves for the plugin", () => {
  const OTHER_COPY = (): string => join(home, ".claude", "plugins", "cache", "counterparts", "counterparts", "0.3.12");

  /** The npm wiring's environment: no plugin variables, no explicit-dir guard. */
  function npmEnv(extra: Record<string, string> = {}): Record<string, string> {
    return {
      PATH: emptyBin,
      HOME: home,
      USERPROFILE: home,
      TZ: "UTC",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      CLAUDE_PROJECT_DIR: project,
      ...extra,
    };
  }

  function npmHook(event: string, env: Record<string, string>, session = "npm-test-1"): { code: number; stdout: string; stderr: string } {
    const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT], { input: payload(event, session), encoding: "utf8", env, timeout: 60_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  /** The owner's machine: an install, the npm hooks and server wired, and the
   *  plugin recorded installed and enabled beside them. */
  function bothInstalled(): void {
    expect(ensureFirstRun({ choice: defaultChoice(), env: firstRunEnv(), home, lockPath: firstRunLockPath(defaultChoice().path, work) }).state).toBe("created");
    const hooks: Record<string, string[]> = {};
    for (const e of HOST_EVENTS) hooks[e] = [liveHookCommand()];
    writeSettings(hooks);
    const settings = readJson(join(home, ".claude", "settings.json"));
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ ...settings, enabledPlugins: { "counterparts@counterparts": true } }));
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { counterparts: { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT] } } }));
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    mkdirSync(OTHER_COPY(), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "counterparts@counterparts": [{ scope: "user", installPath: OTHER_COPY(), version: "0.3.12" }] } }),
    );
  }

  const PLUGIN_WORDS = /first run|installed twice|standing down|stood down|plugin/i;
  /** The temp directory's own name says "plugin"; only what the process said counts. */
  const said = (s: string): string => s.split(work).join("<work>");
  /** The clock line is the only thing two runs a minute apart may disagree on. */
  const steady = (s: string): string => s.replace(/Now: [^\n"\\]*/g, "Now: <now>");

  test(
    "no install: the npm hook makes nothing and says nothing of the plugin's, on any event",
    () => {
      for (const event of HOST_EVENTS) {
        const r = npmHook(event, npmEnv());
        expect(r.code).toBe(0);
        expect(said(r.stdout + r.stderr)).not.toMatch(PLUGIN_WORDS);
      }
      // The first run's one mark. (The default store itself is master's to make or
      // not: an unguarded hook with no configuration opens it, as it always has.)
      expect(existsSync(join(home, ".counterparts", "claude-code.json"))).toBe(false);
    },
    120_000,
  );

  test(
    "installed both ways: every event of the npm hook runs in full, and an inherited CLAUDE_PLUGIN_ROOT changes not a byte",
    () => {
      bothInstalled();
      const plain: string[] = [];
      for (const event of HOST_EVENTS) {
        const r = npmHook(event, npmEnv(), "npm-test-plain");
        expect(r.code).toBe(0);
        expect(said(r.stdout + r.stderr)).not.toMatch(PLUGIN_WORDS);
        plain.push(steady(JSON.stringify(r).replaceAll("npm-test-plain", "<session>")));
      }
      // The wake is the npm hook's own, delivered — not a stand-down.
      expect(plain[0]).toContain("Now: <now>");
      const inherited: string[] = [];
      for (const event of HOST_EVENTS) {
        const r = npmHook(event, npmEnv({ CLAUDE_PLUGIN_ROOT: OTHER_COPY(), CLAUDE_PLUGIN_DATA: join(home, "plugin-data") }), "npm-test-inherited");
        inherited.push(steady(JSON.stringify(r).replaceAll("npm-test-inherited", "<session>")));
      }
      expect(inherited).toEqual(plain);
    },
    120_000,
  );

  test(
    "installed both ways: the npm server offers every tool, with or without an inherited CLAUDE_PLUGIN_ROOT",
    () => {
      bothInstalled();
      const handshake =
        [
          { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } } },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: 2, method: "tools/list" },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n";
      const serve = (env: Record<string, string>): { init: Record<string, unknown>; tools: string[]; stderr: string } => {
        const r = spawnSync(process.execPath, ["run", MCP_SCRIPT], { input: handshake, encoding: "utf8", env, timeout: 60_000 });
        const lines = (r.stdout ?? "")
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        const init = (lines[0]?.["result"] ?? {}) as Record<string, unknown>;
        const tools = ((lines[1]?.["result"] as { tools?: { name: string }[] } | undefined)?.tools ?? []).map((t) => t.name);
        return { init, tools, stderr: r.stderr ?? "" };
      };
      const plain = serve(npmEnv());
      expect(plain.tools.length).toBe(9);
      expect(said(String(plain.init["instructions"] ?? ""))).not.toMatch(PLUGIN_WORDS);
      expect(said(plain.stderr)).not.toMatch(PLUGIN_WORDS);
      const inherited = serve(npmEnv({ CLAUDE_PLUGIN_ROOT: OTHER_COPY(), CLAUDE_PLUGIN_DATA: join(home, "plugin-data") }));
      expect(inherited.tools).toEqual(plain.tools);
      expect(inherited.init).toEqual(plain.init);
      expect(inherited.stderr).toBe(plain.stderr);
    },
    120_000,
  );
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

  test("the npm wiring alone (the owner's machine): green, and not a word about a plugin", () => {
    const hooks: Record<string, string[]> = {};
    for (const e of HOST_EVENTS) hooks[e] = [liveHookCommand()];
    writeSettings(hooks);
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { counterparts: { type: "stdio", command: process.execPath, args: ["run", MCP_SCRIPT] } } }),
    );
    // Another plugin installed changes nothing: only `counterparts@…` is ours.
    mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "design@knowledge-work": [{ scope: "user", installPath: join(home, "x"), version: "1.0.0" }] } }),
    );
    const f = hostFinding(readHost(home, project, {}));
    expect(f.severity).toBe("green");
    expect(f.detail).not.toMatch(/plugin/i);
    expect(f.fix).toBe("");
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
