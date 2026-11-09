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

import { runtimeFindings } from "../src/adapters/claude-code/doctor-host.js";
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
  windowsHookFit,
  windowsHookWord,
  windowsLaunch,
} from "../src/adapters/runtime.js";
// @ts-expect-error — a plain .mjs with no types: what the postinstall runs.
import { fixShims, globalBinDir, rewriteShim } from "../src/adapters/windows-shims.mjs";

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
  test("older npm's and pnpm's `%~dp0` reads the same (W1 review, 3)", () => {
    const exists = disk(NODE, `${npm}\\claude.cmd`, `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`);
    const old = SHIM_JS.replace(/%dp0%/g, "%~dp0");
    expect(windowsLaunch("claude", ["-p"], WIN_ENV, exists, () => old)).toEqual({ file: NODE, args: [`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, "-p"] });
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
  const TARGET = "node_modules/counterparts/src/adapters/cli/bin/counterparts.mjs";
  test("rewriteShim swaps /bin/sh for node in npm's exact shim for our bin, and nothing else", () => {
    const cmd = rewriteShim(CMD, ".cmd", TARGET) as string;
    expect(cmd).toContain('IF EXIST "%dp0%\\node.exe"');
    expect(cmd).toContain('SET "_prog=node"');
    expect(cmd).not.toContain("/bin/sh");
    const ps1 = rewriteShim(PS1, ".ps1", TARGET) as string;
    expect(ps1).toContain('Test-Path "$basedir/node$exe"');
    expect(ps1).toContain('& "node$exe"');
    // Older npm's `%~dp0` reads the same.
    expect(rewriteShim(CMD.replace(/%dp0%/g, "%~dp0"), ".cmd", TARGET)).toContain('SET "_prog=node"');
    // Another package's shim, or another bin's target: untouched.
    expect(rewriteShim(CMD.replace(/counterparts/g, "other"), ".cmd", TARGET)).toBeNull();
    expect(rewriteShim(CMD, ".cmd", "node_modules/counterparts/src/adapters/mcp/bin/serve.mjs")).toBeNull();
    // A person's own file that mentions our path and /bin/sh but is not npm's shim shape (W1 review, 1).
    const theirs = '@echo off\r\nREM runs node_modules\\counterparts\\src\\adapters\\cli\\bin\\counterparts.mjs under /bin/sh\r\nmy-tool %*\r\n';
    expect(rewriteShim(theirs, ".cmd", TARGET)).toBeNull();
  });
  test("fixShims: only a global install on win32, only the global prefix's two files", () => {
    const prefix = mkdtempSync(join(tmpdir(), "w1-shims-"));
    made.push(prefix);
    const pkg = join(prefix, "node_modules", "counterparts");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(prefix, "counterparts.cmd"), CMD);
    writeFileSync(join(prefix, "counterparts.ps1"), PS1);
    writeFileSync(join(prefix, "counterparts"), "#!/bin/sh\nexec /bin/sh x\n");
    const global = { npm_config_global: "true" };
    expect(globalBinDir(pkg, global)).toBe(prefix);
    expect(fixShims(pkg, "darwin", global)).toEqual([]);
    // A LOCAL install (`npm i counterparts` in a project whose root holds a
    // counterparts.cmd of its own): nothing is touched (W1 review, 1).
    expect(globalBinDir(pkg, {})).toBeNull();
    expect(fixShims(pkg, "win32", {})).toEqual([]);
    expect(readFileSync(join(prefix, "counterparts.cmd"), "utf8")).toBe(CMD);
    expect(fixShims(pkg, "win32", global).length).toBe(2);
    expect(readFileSync(join(prefix, "counterparts.cmd"), "utf8")).not.toContain("/bin/sh");
    // The shell script Git Bash runs stays as npm wrote it.
    expect(readFileSync(join(prefix, "counterparts"), "utf8")).toContain("/bin/sh");
    // Run twice, the second changes nothing.
    expect(fixShims(pkg, "win32", global)).toEqual([]);
  });
});

describe("a Windows hook line's first word (W1 review, 2)", () => {
  test("node by name only when PATH's node is this very file, links followed", () => {
    const shim = "C:\\Users\\me\\AppData\\Local\\Volta\\bin\\node.exe";
    const env = { Path: "C:\\Users\\me\\AppData\\Local\\Volta\\bin", PATHEXT: ".EXE" };
    const real = "C:\\Users\\me\\AppData\\Local\\Volta\\tools\\image\\node\\24.11.0\\node.exe";
    // Volta: `node` on PATH is its shim, another file.
    expect(hostExe(real, "win32", env, disk(shim, real), (p) => p)).toBe("C:/Users/me/AppData/Local/Volta/tools/image/node/24.11.0/node.exe");
    // A link to the same file reads as the same.
    expect(hostExe(real, "win32", env, disk(shim, real), (p) => (p === shim ? real : p))).toBe("node");
  });
  test("a path is written so the shell Claude Code uses there runs it", () => {
    const noGit = { Path: "C:\\Windows" };
    expect(windowsHookWord("node", noGit, disk())).toEqual({ word: "node", form: "name" });
    expect(windowsHookWord("C:/Users/me/Volta/node.exe", noGit, disk())).toEqual({ word: "C:/Users/me/Volta/node.exe", form: "plain" });
    expect(windowsHookWord("C:/Program Files/nodejs/node.exe", noGit, disk())).toEqual({ word: '& "C:/Program Files/nodejs/node.exe"', form: "powershell" });
    expect(windowsHookWord("C:/Program Files/nodejs/node.exe", noGit, disk("C:\\Program Files\\Git\\bin\\bash.exe"))).toEqual({ word: '"C:/Program Files/nodejs/node.exe"', form: "bash" });
    expect(windowsHookFit("name", "node")).toBeNull();
    expect(windowsHookFit("plain", "C:/x/node.exe")).toBeNull();
    expect(windowsHookFit("powershell", "C:/Program Files/nodejs/node.exe")).toContain("PowerShell only");
  });
  test("a PowerShell line (`& \"…\"`) reads back as ours", () => {
    const line = '& "C:/Program Files/nodejs/node.exe" --import "file:///C:/p/node-hooks.mjs" "C:/p/src/adapters/claude-code/bin/hook.ts"';
    expect(shellTokens(line)[0]).toBe("C:/Program Files/nodejs/node.exe");
    expect(isOurHookCommand(line)).toBe(true);
  });
  test("doctor: a quoted path is amber on win32; green elsewhere, and for node by name", () => {
    const row = (exe: string) => ({ runtimes: [{ kind: "node" as const, exe, used: ["hooks"], present: true }] });
    const quoted = runtimeFindings(row("C:/Program Files/nodejs/node.exe") as never, "win32")[0];
    expect(quoted?.severity).toBe("amber");
    expect(quoted?.detail ?? "").toContain("only one of Git Bash and PowerShell");
    expect(runtimeFindings(row("node") as never, "win32")[0]?.severity).toBe("green");
    expect(runtimeFindings(row("C:/Program Files/nodejs/node.exe") as never, "darwin")[0]?.severity).toBe("green");
  });
});
