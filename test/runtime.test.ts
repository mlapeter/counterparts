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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { nightMcpConfig } from "../src/adapters/claude-code/night-run.js";
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
import { isOurHookCommand, mcpAddArgs, readMcp } from "../src/adapters/cli/wire.js";
import {
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
  });

  test("nothing of ours configured: no Runtime line at all", () => {
    expect(runtimeLine().line).toBeUndefined();
  });
});
