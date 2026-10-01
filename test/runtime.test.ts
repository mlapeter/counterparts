/**
 * THE RUNTIME SEAM (2026-10-01, Node support): `adapters/runtime.ts` decides
 * the arguments that make an executable run one of our scripts, and every
 * writer and reader of a host's configuration goes through it.
 *
 * The rule these hold: the Bun shape is byte-for-byte what was written before
 * Node support (so no installed host config reads as changed), the Node shape
 * is `--import <node-hooks.mjs> <script>`, and everything a writer writes in
 * either shape is read back as ours. `test/node-smoke.ts` runs the Node side
 * for real (`bun run test:node`); this file is the Bun suite's half.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { CATCH_UP_TOOLS } from "../src/adapters/claude-code/night-catch-up.js";
import { nightMcpConfig, planNightChild } from "../src/adapters/claude-code/night-run.js";
import { desktopEntry, desktopUnavailable } from "../src/adapters/cli/desktop.js";
import {
  HOOK_SCRIPT,
  MCP_SCRIPT,
  MCP_SERVER_NAME,
  hookCommand,
  hookTargetPath,
  mcpCommand,
  readHost,
  runCommand,
} from "../src/adapters/cli/install.js";
import { isOurHookCommand, mcpAddArgs, processMark, readMcp } from "../src/adapters/cli/wire.js";
import { describeFault } from "../src/adapters/claude-code/standdown.js";
import { StoreError } from "../src/core/store/index.js";
import {
  CLI_SCRIPT,
  NODE_HOOKS,
  currentRuntime,
  parseScriptInvocation,
  runtimeOf,
  runtimePresent,
  scriptArgs,
  shellTokens,
} from "../src/adapters/runtime.js";

const BUN = "/Users/x/.bun/bin/bun";
const NODE = "/usr/local/bin/node";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "counterparts-runtime-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("which runtime an executable names", () => {
  test("node, a versioned node, Debian's nodejs and node.exe are Node; the rest is Bun", () => {
    for (const exe of [NODE, "node", "/opt/n/node24", "/usr/bin/nodejs", "C:\\n\\node.exe"]) {
      expect(runtimeOf(exe)).toBe("node");
    }
    for (const exe of [BUN, "bun", "/usr/local/bin/bun", "/x/nodemon", "/x/denode"]) expect(runtimeOf(exe)).toBe("bun");
  });

  test("this suite runs under Bun", () => {
    expect(currentRuntime()).toBe("bun");
  });

  test("the arguments: `run <script>` for Bun, `--import <node-hooks.mjs> <script>` for Node", () => {
    expect(scriptArgs("/s/hook.ts", BUN)).toEqual(["run", "/s/hook.ts"]);
    expect(scriptArgs("/s/hook.ts", NODE)).toEqual(["--import", NODE_HOOKS, "/s/hook.ts"]);
    expect(NODE_HOOKS.endsWith("/src/adapters/node-hooks.mjs")).toBe(true);
  });

  test("a bare name is looked up on PATH; a path is looked up on disk", () => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "node"), "");
    expect(runtimePresent("node", { PATH: bin })).toBe(true);
    expect(runtimePresent("bun", { PATH: bin })).toBe(false);
    expect(runtimePresent(join(bin, "node"), {})).toBe(true);
    expect(runtimePresent(join(root, "gone", "bun"), {})).toBe(false);
  });
});

describe("reading an invocation back", () => {
  test("both shapes parse, with what follows the script kept", () => {
    expect(parseScriptInvocation([BUN, "run", "/s/hook.ts", "--config", "/c.json"])).toEqual({
      exe: BUN,
      runtime: "bun",
      script: "/s/hook.ts",
      rest: ["--config", "/c.json"],
    });
    expect(parseScriptInvocation([NODE, "--import", NODE_HOOKS, "/s/hook.ts"])).toEqual({
      exe: NODE,
      runtime: "node",
      script: "/s/hook.ts",
      rest: [],
    });
  });

  test("anything else is not an invocation of ours", () => {
    expect(parseScriptInvocation([])).toBeNull();
    expect(parseScriptInvocation([BUN, "/s/hook.ts"])).toBeNull();
    expect(parseScriptInvocation([NODE, "--import", "/x/other.mjs", "/s/hook.ts"])).toBeNull();
    expect(parseScriptInvocation([NODE, "--import", NODE_HOOKS])).toBeNull();
  });
});

describe("what install writes, and what reads it back", () => {
  test("the Bun hook command is exactly the shape written before Node support", () => {
    expect(runCommand("/s/hook.ts", BUN)).toBe(`"${BUN}" run "/s/hook.ts"`);
    expect(hookCommand("/c/claude-code.json", BUN)).toBe(`"${BUN}" run "${HOOK_SCRIPT}" --config "/c/claude-code.json"`);
  });

  test("the Node hook command names the loader and the script, both quoted", () => {
    expect(runCommand("/s/hook.ts", NODE)).toBe(`"${NODE}" --import "${NODE_HOOKS}" "/s/hook.ts"`);
  });

  test("every hook command install writes, in either runtime, is ours — and a wrapped one is not", () => {
    for (const exe of [BUN, NODE]) {
      const plain = hookCommand(undefined, exe);
      const configured = hookCommand("/c/claude-code.json", exe);
      expect(isOurHookCommand(plain)).toBe(true);
      expect(isOurHookCommand(configured)).toBe(true);
      expect(isOurHookCommand(`${plain} && echo done`)).toBe(false);
      expect(isOurHookCommand(`${plain} --verbose`)).toBe(false);
      expect(shellTokens(plain)[0]).toBe(exe);
    }
  });

  test("doctor's path check reads the hook script, not Node's loader", () => {
    expect(hookTargetPath(hookCommand(undefined, NODE))).toBe(HOOK_SCRIPT);
    expect(hookTargetPath(hookCommand(undefined, BUN))).toBe(HOOK_SCRIPT);
  });

  test("the MCP registration carries the runtime's arguments, and reads back as a match", () => {
    expect(mcpAddArgs("/st", undefined, BUN).slice(-3)).toEqual([BUN, "run", MCP_SCRIPT]);
    expect(mcpAddArgs("/st", undefined, NODE).slice(-4)).toEqual([NODE, "--import", NODE_HOOKS, MCP_SCRIPT]);
    expect(mcpCommand("/st", runCommand(MCP_SCRIPT, NODE))).toContain(`-- "${NODE}" --import "${NODE_HOOKS}"`);
    for (const exe of [BUN, NODE]) {
      writeFileSync(
        join(root, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            [MCP_SERVER_NAME]: {
              type: "stdio",
              command: exe,
              args: scriptArgs(MCP_SCRIPT, exe),
              env: { COUNTERPARTS_DATA_DIR: "/st" },
            },
          },
        }),
      );
      expect(readMcp(root, {}, "/st", undefined, exe).matches).toBe(true);
      // The other runtime's console reads it as NOT matching — `connect` there
      // rewrites it with its own runtime, which is the rule.
      expect(readMcp(root, {}, "/st", undefined, exe === BUN ? NODE : BUN).matches).toBe(false);
    }
  });

  test("Claude Desktop's entry and the nightly run's server carry the same arguments", () => {
    expect(desktopEntry("/st", NODE).args).toEqual(["--import", NODE_HOOKS, MCP_SCRIPT]);
    expect(desktopEntry("/st", BUN).args).toEqual(["run", MCP_SCRIPT]);
    const night = JSON.parse(nightMcpConfig({ runtime: NODE, dataDir: "/st", session: "s", scope: "/p" })) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const server = Object.values(night.mcpServers)[0];
    expect(server?.command).toBe(NODE);
    expect(server?.args.slice(0, 2)).toEqual(["--import", NODE_HOOKS]);
  });

  test("both night children (the dream and #308's catch-up) start the server through the seam", () => {
    for (const tools of [undefined, CATCH_UP_TOOLS]) {
      const plan = planNightChild({
        config: { dataDir: "/st" },
        run: "r",
        prompt: "p",
        scope: "/p",
        session: "s",
        runtime: NODE,
        baseEnv: {},
        ...(tools === undefined ? {} : { tools }),
      });
      const config = JSON.parse(plan.args[plan.args.indexOf("--mcp-config") + 1] ?? "{}") as {
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
      const server = Object.values(config.mcpServers)[0];
      expect(server?.command).toBe(NODE);
      expect(server?.args).toEqual(["--import", NODE_HOOKS, MCP_SCRIPT]);
    }
  });

  test("Claude Desktop is macOS only here: Linux is told so, by name", () => {
    expect(desktopUnavailable("darwin")).toBeNull();
    expect(desktopUnavailable("linux")).toContain("not available on Linux");
    expect(desktopUnavailable("win32")).toContain("only supported on macOS");
    // A Desktop config folder that is really there is used, on any platform.
    expect(desktopUnavailable("linux", root)).toContain("not available on Linux");
    mkdirSync(join(root, "Library", "Application Support", "Claude"), { recursive: true });
    expect(desktopUnavailable("linux", root)).toBeNull();
  });
});

describe("doctor's Runtime line", () => {
  function hostWith(exe: string, mcpExe: string = exe): void {
    const hooks: Record<string, unknown> = {
      SessionStart: [{ hooks: [{ type: "command", command: hookCommand(undefined, exe) }] }],
    };
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks }));
    writeFileSync(
      join(root, ".claude.json"),
      JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: mcpExe, args: scriptArgs(MCP_SCRIPT, mcpExe) } } }),
    );
  }

  function runtimeLine(consoleRuntime = "bun 1.3.10") {
    const host = { ...readHost(root, root, {}), consoleRuntime };
    const findings = doctorFindings({
      configPath: join(root, "claude-code.json"),
      configReason: "loaded",
      config: {},
      dir: join(root, "store"),
      store: null,
      today: "2026-10-01",
      refusals: {},
      host,
    });
    return { host, line: findings.find((f) => f.key === "runtime") };
  }

  test("the hooks and the tools under one present runtime: green, naming it and this console", () => {
    const node = join(root, "bin", "node");
    mkdirSync(join(root, "bin"));
    writeFileSync(node, "");
    hostWith(node);
    const { host, line } = runtimeLine("node 24.9.0");
    expect(host.runtimes).toEqual([{ exe: node, kind: "node", present: true, used: ["hooks", "mcp"] }]);
    expect(line?.severity).toBe("green");
    expect(line?.detail).toBe(`hooks and mcp run under node (${node}); this console is node 24.9.0`);
  });

  test("a runtime that is not there is amber, names the path, and says connect rewrites it", () => {
    const gone = join(root, "gone", "bun");
    hostWith(gone);
    const { line } = runtimeLine();
    expect(line?.severity).toBe("amber");
    expect(line?.detail).toContain(`${gone} is not there`);
    expect(line?.fix).toContain("counterparts connect");
    // The launcher prefers bun, so the Node way is spelled out, not left to "run it under X".
    expect(line?.fix).toContain(`node --import "${NODE_HOOKS}" "${CLI_SCRIPT}" connect`);
    expect(line?.fix).not.toContain("under the runtime you want");
  });

  test("nothing of ours configured: no Runtime line at all", () => {
    expect(runtimeLine().line).toBeUndefined();
  });
});

describe("the installed commands", () => {
  const PKG = new URL("../package.json", import.meta.url);
  const bins = (JSON.parse(readFileSync(PKG, "utf8")) as { bin: Record<string, string> }).bin;

  test("every bin is a /bin/sh launcher, executable, that imports a .ts entry beside it", () => {
    for (const target of Object.values(bins)) {
      const path = new URL(`../${target}`, import.meta.url);
      const text = readFileSync(path, "utf8");
      expect(text.startsWith("#!/bin/sh\n")).toBe(true);
      expect(statSync(path).mode & 0o111).not.toBe(0);
      const entry = /new URL\("\.\/([a-z-]+\.ts)"/.exec(text)?.[1];
      expect(entry).toBeDefined();
    }
  });

  /**
   * THE OLD TARGETS STAY RUNNABLE (review of #312): an upgrade can leave an
   * existing bin symlink pointing at the .ts it was made for, so those keep the
   * bun shebang and the exec bit. A tidy-up that drops either breaks installs.
   */
  test("the four .ts files the bins used to point at keep their bun shebang and exec bit", () => {
    for (const old of [
      "src/adapters/cli/bin/counterparts.ts",
      "src/adapters/claude-code/bin/hook.ts",
      "src/adapters/mcp/bin/serve.ts",
      "src/adapters/dashboard/bin/dashboard.ts",
    ]) {
      const path = new URL(`../${old}`, import.meta.url);
      expect(readFileSync(path, "utf8").split("\n")[0]).toBe("#!/usr/bin/env bun");
      expect(statSync(path).mode & 0o111).not.toBe(0);
    }
  });

  test("a server or dashboard started through a launcher is recognised as ours", () => {
    expect(processMark("node /p/lib/node_modules/counterparts/src/adapters/mcp/bin/serve.mjs")).toBe("an MCP server");
    expect(processMark("bun /p/src/adapters/dashboard/bin/dashboard.mjs serve")).toBe("a dashboard");
    expect(processMark(`/n/node --import ${NODE_HOOKS} /p/src/adapters/mcp/bin/serve.ts`)).toBe("an MCP server");
  });
});

describe("a Node that cannot load node:sqlite", () => {
  test("the stand-down names the Node version and the way out", () => {
    const fault = describeFault(
      new StoreError("SQLITE_UNAVAILABLE", { driver: "node:sqlite", nodeVersionFloor: "22.15", running: "22.14.0", reason: "x" }),
    );
    expect(fault.reason).toBe("Node 22.14.0 can't load node:sqlite; use Node 22.15 or later, or Bun");
    const bun = describeFault(new StoreError("SQLITE_UNAVAILABLE", { driver: "bun:sqlite", reason: "x" }));
    expect(bun.reason).toBe("this runtime has no SQLite binding");
  });
});
