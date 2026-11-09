/**
 * THE WINDOWS PORT (W1, 2026-11-09), from a POSIX host: every Windows branch
 * here is a pure function given `platform: "win32"`, a PATH and a fake disk.
 * The real proof is CI's npm door on windows-latest (`tools/door/npm-door.mjs`,
 * `.github/workflows/windows.yml`); this holds the shapes so a refactor on a
 * Mac cannot quietly break them.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hookTargetPath, runCommand, HOOK_SCRIPT } from "../src/adapters/cli/install.js";
import { isOurHookCommand } from "../src/adapters/cli/wire.js";
import {
  NODE_HOOKS,
  hostExe,
  hostInvocation,
  parseScriptInvocation,
  scriptArgs,
  shellTokens,
  whichOnPath,
  windowsFileUrl,
  windowsLaunch,
} from "../src/adapters/runtime.js";
// @ts-expect-error — a plain .mjs with no types: what the postinstall runs.
import { binDirs, fixShims, rewriteShim } from "../src/adapters/windows-shims.mjs";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const WIN_ENV = { Path: "C:\\Windows\\system32;C:\\Program Files\\nodejs\\;C:\\Users\\me\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
const disk = (...files: string[]) => {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (p: string): boolean => set.has(p.toLowerCase());
};

describe("shellTokens: a backslash in quotes escapes only what bash says it does", () => {
  test("a hand-typed Windows line keeps its backslashes (blocker a)", () => {
    expect(shellTokens('"C:\\Users\\me\\counterparts.exe" hook')).toEqual(["C:\\Users\\me\\counterparts.exe", "hook"]);
  });
  test("what shellQuote writes still reads back", () => {
    expect(shellTokens('"C:\\\\Users\\\\me\\\\node.exe" "a \\"b\\" \\$c"')).toEqual(["C:\\Users\\me\\node.exe", 'a "b" $c']);
  });
  test("a single-binary Windows hook line is recognised as ours", () => {
    expect(isOurHookCommand('"C:\\Users\\me\\counterparts.exe" hook')).toBe(true);
    expect(parseScriptInvocation(shellTokens('"C:\\Users\\me\\counterparts.exe" hook'))?.mode).toBe("hook");
  });
});

describe("what a host is told to run on win32", () => {
  test("--import gets a file: URL there, the plain path elsewhere", () => {
    expect(scriptArgs("/x/hook.ts", "/usr/bin/node", null, "darwin")).toEqual(["--import", NODE_HOOKS, "/x/hook.ts"]);
    const win = scriptArgs("C:\\p\\hook.ts", NODE, null, "win32");
    expect(win[1]).toBe(windowsFileUrl(NODE_HOOKS));
    expect(windowsFileUrl("C:\\Users\\John Smith\\x#1.mjs")).toBe("file:///C:/Users/John%20Smith/x%231.mjs");
  });
  test("PATH lookup tries PATHEXT, and reads Windows' `Path`", () => {
    const exists = disk("C:\\Program Files\\nodejs\\node.exe");
    expect(whichOnPath("node", WIN_ENV, "win32", exists)).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(whichOnPath("node", WIN_ENV, "linux", exists)).toBeNull();
    // npm's extensionless sh script beside `claude.cmd` is not what Windows starts (CI 11-09).
    const npm = "C:\\Users\\me\\AppData\\Roaming\\npm";
    expect(whichOnPath("claude", WIN_ENV, "win32", disk(`${npm}\\claude`, `${npm}\\claude.cmd`))).toBe(`${npm}\\claude.cmd`);
  });
  test("node by name when PATH finds this very node; its / path when not; POSIX untouched", () => {
    expect(hostExe(NODE, "win32", WIN_ENV, disk(NODE))).toBe("node");
    expect(hostExe("D:\\nvm\\node.exe", "win32", WIN_ENV, disk(NODE, "D:\\nvm\\node.exe"))).toBe("D:/nvm/node.exe");
    expect(hostExe("/usr/local/bin/node", "darwin", {}, () => true)).toBe("/usr/local/bin/node");
  });
  test("hostInvocation: / paths and a URL loader on win32", () => {
    const { command, args } = hostInvocation("C:\\npm\\node_modules\\counterparts\\src\\adapters\\claude-code\\bin\\hook.ts", NODE, "win32", WIN_ENV, disk(NODE));
    expect(command).toBe("node");
    expect(args[0]).toBe("--import");
    expect(args[1]?.startsWith("file:///")).toBe(true);
    expect(args[2]).toBe("C:/npm/node_modules/counterparts/src/adapters/claude-code/bin/hook.ts");
  });
  test("the hook line written for win32 has no backslash and a bare first word, and reads back as ours", () => {
    const line = runCommand(HOOK_SCRIPT, process.execPath, "win32");
    expect(line.includes("\\")).toBe(false);
    expect(isOurHookCommand(line)).toBe(true);
    expect(hookTargetPath('node --import "file:///C:/p/node-hooks.mjs" "C:/p/src/adapters/claude-code/bin/hook.ts"')).toBe(
      "C:/p/src/adapters/claude-code/bin/hook.ts",
    );
  });
  test("POSIX lines are byte-for-byte what they were", () => {
    expect(runCommand("/p/hook.ts", "/usr/local/bin/node", "darwin")).toBe(`"/usr/local/bin/node" --import "${NODE_HOOKS}" "/p/hook.ts"`);
  });
});

describe("windowsLaunch: an npm .cmd shim is read, never run through cmd", () => {
  // What npm's cmd-shim writes for a `#!/usr/bin/env node` bin: node.exe first, the target last.
  const SHIM_JS = [
    "@ECHO off",
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    ")",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  ].join("\r\n");
  const SHIM_EXE = '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  const npm = "C:\\Users\\me\\AppData\\Roaming\\npm";
  test("a .js target is given to node, with the arguments whole", () => {
    const exists = disk(NODE, `${npm}\\claude.cmd`, `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`);
    const how = windowsLaunch("claude", ["mcp", "add", "x y", '{"a":"b"}'], WIN_ENV, exists, () => SHIM_JS);
    expect(how).toEqual({ file: NODE, args: [`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, "mcp", "add", "x y", '{"a":"b"}'] });
  });
  test("an .exe target is spawned itself; a native claude.exe as it is", () => {
    const exe = `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    expect(windowsLaunch("claude", ["-p"], WIN_ENV, disk(`${npm}\\claude.cmd`, exe), () => SHIM_EXE)).toEqual({ file: exe, args: ["-p"] });
    expect(windowsLaunch("claude", ["-p"], WIN_ENV, disk(`${npm}\\claude.exe`))).toEqual({ file: `${npm}\\claude.exe`, args: ["-p"] });
  });
  test("not on PATH, or a .cmd it cannot read: null", () => {
    expect(windowsLaunch("claude", [], WIN_ENV, disk())).toBeNull();
    expect(windowsLaunch("claude", [], WIN_ENV, disk(`${npm}\\claude.cmd`), () => "@echo hi\r\n")).toBeNull();
  });
});

describe("the postinstall: npm's .cmd and .ps1 made to run node", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const CMD = [
    'IF EXIST "%dp0%\\/bin/sh.exe" (',
    '  SET "_prog=%dp0%\\/bin/sh.exe"',
    ") ELSE (",
    '  SET "_prog=/bin/sh"',
    ")",
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\counterparts\\src\\adapters\\cli\\bin\\counterparts.mjs" %*',
  ].join("\r\n");
  const PS1 = 'if (Test-Path "$basedir//bin/sh$exe") {\n  & "$basedir//bin/sh$exe"  "$basedir/node_modules/counterparts/src/adapters/cli/bin/counterparts.mjs" $args\n} else {\n  & "/bin/sh$exe"  "$basedir/node_modules/counterparts/src/adapters/cli/bin/counterparts.mjs" $args\n}';
  test("rewriteShim swaps /bin/sh for node, and leaves another package's shim alone", () => {
    const cmd = rewriteShim(CMD, "counterparts\\src\\adapters\\") as string;
    expect(cmd).toContain('IF EXIST "%dp0%\\node.exe"');
    expect(cmd).toContain('SET "_prog=node"');
    expect(cmd).not.toContain("/bin/sh");
    const ps1 = rewriteShim(PS1, "counterparts/src/adapters/") as string;
    expect(ps1).toContain('Test-Path "$basedir/node$exe"');
    expect(ps1).toContain('& "node$exe"');
    expect(rewriteShim(CMD.replace(/counterparts/g, "other"), "counterparts\\src\\adapters\\")).toBeNull();
  });
  test("fixShims touches nothing off win32, and the global prefix's two files on win32", () => {
    const prefix = mkdtempSync(join(tmpdir(), "w1-shims-"));
    made.push(prefix);
    const pkg = join(prefix, "node_modules", "counterparts");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(prefix, "counterparts.cmd"), CMD);
    writeFileSync(join(prefix, "counterparts.ps1"), PS1);
    writeFileSync(join(prefix, "counterparts"), "#!/bin/sh\nexec /bin/sh x\n");
    expect(binDirs(pkg)).toEqual([prefix, join(prefix, "node_modules", ".bin")]);
    expect(fixShims(pkg, "darwin")).toEqual([]);
    expect(readFileSync(join(prefix, "counterparts.cmd"), "utf8")).toBe(CMD);
    expect(fixShims(pkg, "win32").length).toBe(2);
    expect(readFileSync(join(prefix, "counterparts.cmd"), "utf8")).not.toContain("/bin/sh");
    // The shell script Git Bash runs stays as npm wrote it.
    expect(readFileSync(join(prefix, "counterparts"), "utf8")).toContain("/bin/sh");
    // Run twice, the second changes nothing.
    expect(fixShims(pkg, "win32")).toEqual([]);
  });
});
