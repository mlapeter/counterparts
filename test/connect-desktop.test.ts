/**
 * `counterparts connect` REWRITES CLAUDE DESKTOP'S ENTRY TOO, AND DOCTOR READS
 * IT (2026-10-10, the 0.3.14 release check).
 *
 * `install --host claude-desktop` writes a server command into Desktop's own
 * `claude_desktop_config.json`. 0.3.14 taught Bun to skip a project's `.env`
 * and `bunfig.toml` (`runtime.ts`), and `connect` rewrote the hooks and Claude
 * Code's registration — but not Desktop's entry, and doctor's Runtime line did
 * not read it. Hermetic: a temp HOME with a fake Desktop config, `claude`
 * answered by a fake spawner, the process list by a fake lister (which also
 * says whether Desktop is open). The real Desktop file is never named.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { desktopConfigPath, isOurDesktopEntry, repairDesktop } from "../src/adapters/cli/desktop.js";
import { MCP_SCRIPT, MCP_SERVER_NAME, readHost } from "../src/adapters/cli/install.js";
import type { ProcessLister, SpawnResult, Spawner } from "../src/adapters/cli/wire.js";
import { DESKTOP_APP_PROCESS } from "../src/adapters/cli/wire.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { scriptArgs } from "../src/adapters/runtime.js";

const BUN = process.execPath;
const OTHER = { command: "/usr/local/bin/other-server", args: ["--stdio"], env: { TOKEN: "x" } };

let work: string;
let home: string;
let cfg: string;
let store: string;

const OK: SpawnResult = { missing: false, code: 0, out: "", err: "" };
const spawner: Spawner = () => OK;
const lister = (desktopRunning: boolean | undefined, looked = true): ProcessLister => () => ({
  looked,
  processes: [],
  ...(desktopRunning === undefined ? {} : { desktopRunning }),
});

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

/** What Desktop's file held after `install --host claude-desktop` before 0.3.14. */
function oldEntry(dataDir = store): Record<string, unknown> {
  return { command: BUN, args: ["run", MCP_SCRIPT], env: { COUNTERPARTS_DATA_DIR: dataDir, COUNTERPARTS_CONFIG: cfg } };
}

function writeDesktop(entry: unknown): void {
  const path = desktopConfigPath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ globalShortcut: "Cmd+K", mcpServers: { other: OTHER, [MCP_SERVER_NAME]: entry } }, null, 2)}\n`);
}

const desktopFile = (): string => readFileSync(desktopConfigPath(home), "utf8");
const desktopEntry = (): Record<string, unknown> =>
  (JSON.parse(desktopFile()) as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers[MCP_SERVER_NAME] ?? {};
const backups = (): string[] => readdirSync(dirname(desktopConfigPath(home))).filter((n) => n !== "claude_desktop_config.json");

async function connect(processes: ProcessLister, extra: string[] = []): Promise<{ code: number; said: string }> {
  const c = consoleWith();
  const code = await run(["connect", "--config", cfg, ...extra], {
    io: c.io,
    env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" },
    home,
    spawner,
    processes,
  });
  return { code, said: `${c.out.join("\n")}\n${c.err.join("\n")}` };
}

beforeEach(async () => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-connect-desktop-")));
  home = join(work, "home");
  cfg = join(work, "cp", "claude-code.json");
  store = join(work, "cp", "store");
  mkdirSync(home, { recursive: true });
  const c = consoleWith();
  expect(await run(["install", "--config", cfg, "--no-connect", "--name", "Ada"], { io: c.io, env: {}, home })).toBe(EXIT.ok);
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("connect and Claude Desktop's entry", () => {
  test("Desktop closed: the entry gets today's command, its env and every other server untouched, a backup taken", async () => {
    writeDesktop(oldEntry());
    const r = await connect(lister(false));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("Claude Desktop: rewrote its counterparts entry");
    const entry = desktopEntry();
    expect(entry["command"]).toBe(BUN);
    expect(entry["args"]).toEqual(scriptArgs(MCP_SCRIPT, BUN));
    expect(entry["args"]).toContain("--no-env-file");
    expect((entry["args"] as string[]).some((a) => a.startsWith("--config="))).toBe(true);
    expect(entry["env"]).toEqual(oldEntry()["env"]);
    const whole = JSON.parse(desktopFile()) as { globalShortcut: string; mcpServers: Record<string, unknown> };
    expect(whole.globalShortcut).toBe("Cmd+K");
    expect(whole.mcpServers["other"]).toEqual(OTHER);
    expect(backups()).toHaveLength(1);

    // Again: nothing to do, nothing said, no second backup.
    const again = await connect(lister(false));
    expect(again.said).not.toContain("Claude Desktop");
    expect(backups()).toHaveLength(1);
  });

  test("Desktop open: the file is left byte for byte, and the person is told to quit it and connect again", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const r = await connect(lister(true));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("Claude Desktop is open");
    expect(r.said).toContain("Quit Claude Desktop, run `counterparts connect` again");
    expect(desktopFile()).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  test("the process list could not be read: treated as open, and said so", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const notLooked = await connect(lister(undefined, false));
    expect(notLooked.said).toContain("whether Desktop is open could not be checked");
    // A lister that does not report Desktop at all is the same: not known.
    const silent = await connect(lister(undefined, true));
    expect(silent.said).toContain("could not be checked");
    expect(desktopFile()).toBe(before);
  });

  test("--dry-run says what it would do and writes nothing", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const r = await connect(lister(false), ["--dry-run"]);
    expect(r.said).toContain("would rewrite its counterparts entry");
    expect(desktopFile()).toBe(before);
  });

  test("a Desktop entry naming another store keeps its store: only the command changes", async () => {
    const elsewhere = join(work, "elsewhere", "store");
    writeDesktop(oldEntry(elsewhere));
    await connect(lister(false));
    const entry = desktopEntry();
    expect(entry["args"]).toEqual(scriptArgs(MCP_SCRIPT, BUN));
    expect((entry["env"] as Record<string, string>)["COUNTERPARTS_DATA_DIR"]).toBe(elsewhere);
  });

  test("an entry that is not ours, no entry, and no Desktop at all are left alone", async () => {
    writeDesktop({ command: "npx", args: ["-y", "someone-elses-server"] });
    const before = desktopFile();
    expect((await connect(lister(false))).said).not.toContain("Claude Desktop");
    expect(desktopFile()).toBe(before);
    rmSync(dirname(desktopConfigPath(home)), { recursive: true });
    expect((await connect(lister(false))).said).not.toContain("Claude Desktop");
    expect(existsSync(desktopConfigPath(home))).toBe(false);
  });

  test("an entry already in today's shape is not rewritten, even with Desktop open", async () => {
    writeDesktop({ ...oldEntry(), args: scriptArgs(MCP_SCRIPT, BUN) });
    const before = desktopFile();
    const r = await connect(lister(true));
    expect(r.said).not.toContain("Claude Desktop");
    expect(desktopFile()).toBe(before);
  });

  test("what counts as ours: a server command we write, in either shape", () => {
    expect(isOurDesktopEntry(oldEntry())).toBe(true);
    expect(isOurDesktopEntry({ command: BUN, args: scriptArgs(MCP_SCRIPT, BUN) })).toBe(true);
    expect(isOurDesktopEntry({ command: "/u/node", args: ["--import", "/p/node-hooks.mjs", MCP_SCRIPT] })).toBe(true);
    expect(isOurDesktopEntry({ command: "/d/bin/0.3.14/counterparts", args: ["mcp"] })).toBe(true);
    expect(isOurDesktopEntry({ command: BUN, args: ["run", "/x/other.ts"] })).toBe(false);
    expect(isOurDesktopEntry({ command: "npx", args: ["x"] })).toBe(false);
    expect(isOurDesktopEntry("nope")).toBe(false);
  });

  test("repairDesktop never throws, and refuses a file it cannot parse — and says why", () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    const r = repairDesktop({ home, exe: BUN, desktopRunning: false, dryRun: false, now: Date.now() });
    expect(r.outcome).toBe("refused");
    expect(r.detail).toContain("does not parse as JSON");
    expect(r.detail).toContain("cannot tell whether it holds a counterparts entry");
    expect(readFileSync(path, "utf8")).toBe("{ not json");
    // An empty file is not a broken one: nothing in it, nothing to say.
    writeFileSync(path, "");
    expect(repairDesktop({ home, exe: BUN, desktopRunning: false, dryRun: false, now: Date.now() }).outcome).toBe("none");
  });

  // ── review of #354 ────────────────────────────────────────────────────────

  test("a commented Desktop file: connect says so, and the file and folder are left exactly as they were", async () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    const raw = `{\n  // my servers\n  "mcpServers": {\n    "${MCP_SERVER_NAME}": ${JSON.stringify(oldEntry())}\n  }\n}\n`;
    writeFileSync(path, raw);
    const r = await connect(lister(false));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json holds comments");
    expect(r.said).toContain("nothing in it was changed");
    expect(readFileSync(path, "utf8")).toBe(raw);
    expect(backups()).toHaveLength(0);
  });

  test("a Desktop-written file with many servers: only our entry's command and args change, every other byte stays", async () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    const before = {
      globalShortcut: "Alt+Space",
      "//": "a comment-like key some people keep",
      mcpServers: {
        filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x/Desktop", "/Users/x/Down loads"] },
        github: { command: "docker", args: ["run", "-i", "--rm", "ghcr.io/github/github-mcp-server"], env: { GITHUB_TOKEN: "ghp_x" } },
        [MCP_SERVER_NAME]: { ...oldEntry(), disabled: false, note: "ünïcödé — 名前 \"quoted\" https://x.example/y" },
        python: { command: "/usr/bin/python3", args: ["-m", "srv", "--port", "8080"], env: {}, timeout: 30000, flags: [true, null, 1.5] },
        remote: { url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer t" } },
      },
      preferences: { menuBarEnabled: true, nested: { deeper: [{ a: 1 }, { b: [] }] } },
      _comment: "kept",
    };
    // Four spaces and no final newline: a shape other than this package's default.
    writeFileSync(path, JSON.stringify(before, null, 4));
    const r = await connect(lister(false));
    expect(r.said).toContain("Claude Desktop: rewrote its counterparts entry");
    const after = readFileSync(path, "utf8");
    const want = structuredClone(before) as typeof before;
    (want.mcpServers[MCP_SERVER_NAME] as Record<string, unknown>)["args"] = scriptArgs(MCP_SCRIPT, BUN);
    expect(after).toBe(JSON.stringify(want, null, 4));
    expect(backups()).toHaveLength(1);
    expect(readFileSync(join(dirname(path), backups()[0] ?? ""), "utf8")).toBe(JSON.stringify(before, null, 4));
  });

  test("a hand-edited file (inline arrays, CRLF, escapes): every other server and key reads back the same, in the same order", async () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    const entry = JSON.stringify(oldEntry());
    const raw = [
      "{",
      '  "mcpServers": {',
      '    "a": { "command": "npx", "args": ["-y", "a-server"], "env": { "K": "caf\\u00e9 \\/ \\t" } },',
      `    "${MCP_SERVER_NAME}": ${entry},`,
      '    "z": { "command": "/opt/z", "args": [] }',
      "  },",
      '  "isUsingBuiltInNodeForMcp": false,',
      '  "url": "https://example.com//path"',
      "}",
      "",
    ].join("\r\n");
    writeFileSync(path, raw);
    const beforeValue = JSON.parse(raw) as { mcpServers: Record<string, unknown> } & Record<string, unknown>;
    await connect(lister(false));
    const after = readFileSync(path, "utf8");
    const afterValue = JSON.parse(after) as typeof beforeValue;
    expect(Object.keys(afterValue)).toEqual(Object.keys(beforeValue));
    expect(Object.keys(afterValue.mcpServers)).toEqual(Object.keys(beforeValue.mcpServers));
    expect(afterValue.mcpServers["a"]).toEqual(beforeValue.mcpServers["a"]);
    expect(afterValue.mcpServers["z"]).toEqual(beforeValue.mcpServers["z"]);
    expect(afterValue["url"]).toBe("https://example.com//path");
    expect((afterValue.mcpServers[MCP_SERVER_NAME] as Record<string, unknown>)["args"]).toEqual(scriptArgs(MCP_SCRIPT, BUN));
    expect(after.includes("\r\n")).toBe(true);
    expect(after.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  test("an entry of ours with arguments added after the script is somebody's edit: left alone, nothing said", async () => {
    writeDesktop({ ...oldEntry(), args: ["run", MCP_SCRIPT, "--verbose"] });
    const before = desktopFile();
    expect(isOurDesktopEntry(JSON.parse(before).mcpServers[MCP_SERVER_NAME])).toBe(false);
    expect(isOurDesktopEntry({ command: "/d/bin/counterparts", args: ["mcp", "--extra"] })).toBe(false);
    const r = await connect(lister(false));
    expect(r.said).not.toContain("Claude Desktop");
    expect(desktopFile()).toBe(before);
  });

  test("Claude Desktop's own process is recognised, its helpers and mentions are not", () => {
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/MacOS/Claude")).toBe(true);
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/MacOS/Claude --some-flag")).toBe(true);
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper")).toBe(false);
    expect(DESKTOP_APP_PROCESS.test("vim /notes/Claude.app/Contents/MacOS/Claude-notes.txt")).toBe(false);
  });

  test("captured `ps` lines (review of #354): Desktop's main process only — never Claude Code, nor a helper that runs with Desktop closed", () => {
    // Captured on the owner's Mac, 2026-10-09, with Desktop CLOSED: Chrome's
    // native-messaging host lives inside Claude.app and runs whenever Chrome
    // does. Matching it would block `connect` forever with nothing to quit.
    const closed = [
      "/Applications/Claude.app/Contents/Helpers/chrome-native-host chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/",
      "claude",
      "claude --resume ce5829f0-990c-4b80-ada0-05a94e2bfc05",
      "claude -p --model claude-haiku-5-5 --output-format json --system-prompt You are an AI assistant",
      // Squirrel's updater runs after the app has quit.
      "/Applications/Claude.app/Contents/Frameworks/Squirrel.framework/Resources/ShipIt com.anthropic.claudefordesktop.ShipIt /Users/x/Library/Caches/com.anthropic.claudefordesktop.ShipIt/ShipItState.plist",
      "/Applications/Claude.app/Contents/Frameworks/Electron Framework.framework/Helpers/chrome_crashpad_handler --no-rate-limit",
      // Desktop's other helpers, by the bundle's own layout (Contents/Helpers, Frameworks).
      "/Applications/Claude.app/Contents/Helpers/disclaimer /Users/x/.bun/bin/bun run serve.ts",
      "/Applications/Claude.app/Contents/Helpers/app-cu-helper",
      "/Applications/Claude.app/Contents/Helpers/Claude iOS Sim.app/Contents/MacOS/Claude iOS Sim",
      // Electron's helpers, in the shape VS Code's run on this Mac.
      "/Applications/Claude.app/Contents/Frameworks/Claude Helper (GPU).app/Contents/MacOS/Claude Helper (GPU) --type=gpu-process --user-data-dir=/Users/x/Library/Application Support/Claude",
      "/Applications/Claude.app/Contents/Frameworks/Claude Helper (Renderer).app/Contents/MacOS/Claude Helper (Renderer) --type=renderer",
      "/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin) --type=utility",
      // Somebody else's app with Claude in its name.
      "/Applications/Claude Notes.app/Contents/MacOS/Claude Notes",
      "/Users/x/Library/Application Support/Claude/claude-code/2.1.0/claude --output-format stream-json",
    ];
    for (const line of closed) expect([line, DESKTOP_APP_PROCESS.test(line)]).toEqual([line, false]);
    // The main process, as an Electron app's runs (VS Code's on this Mac:
    // `/Applications/Visual Studio Code.app/Contents/MacOS/Code docs/ROADMAP.md`),
    // under /Applications, ~/Applications, or a translocated copy.
    const open = [
      "/Applications/Claude.app/Contents/MacOS/Claude",
      "/Users/x/Applications/Claude.app/Contents/MacOS/Claude",
      "/private/var/folders/ab/T/AppTranslocation/0F1E/d/Claude.app/Contents/MacOS/Claude",
      "/Applications/Claude.app/Contents/MacOS/Claude --enable-logging",
    ];
    for (const line of open) expect([line, DESKTOP_APP_PROCESS.test(line)]).toEqual([line, true]);
  });
});

/**
 * `install` AT A TERMINAL REPAIRS DESKTOP'S ENTRY TOO (2026-10-10, left open
 * by #354): it is the other caller of `wire()`, and a person who re-runs it
 * after an upgrade should not need to know `connect` exists. Same path as
 * `connect` (`commands.ts#repairDesktopEntry`). The console says it is a
 * terminal; `claude` is the fake spawner, the process list the fake lister,
 * and the local table is pinned so the closing line does not depend on what
 * this checkout's `node_modules` holds.
 */
describe("install at a terminal and Claude Desktop's entry", () => {
  async function installAtTerminal(processes: ProcessLister, spawn: Spawner = spawner): Promise<{ code: number; said: string }> {
    const table = join(work, "table");
    mkdirSync(table, { recursive: true });
    writeFileSync(join(table, "model.safetensors"), "");
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      prompt: async () => "",
      promptHidden: async () => "",
      // Wide, and no colour: the lines below are matched whole.
      tty: { stdin: true, stdout: true, columns: 1000 },
    };
    const code = await run(["install", "--config", cfg], {
      io,
      env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", COUNTERPARTS_STATIC_WEIGHTS_DIR: table, NO_COLOR: "1" },
      home,
      spawner: spawn,
      processes,
    });
    return { code, said: `${out.join("\n")}\n${err.join("\n")}` };
  }

  test("Desktop closed: the entry gets today's command, its env and every other server untouched, one backup; again, nothing", async () => {
    writeDesktop(oldEntry());
    const r = await installAtTerminal(lister(false));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("Connecting Claude Code…");
    expect(r.said).toContain("Claude Desktop: rewrote its counterparts entry");
    expect(r.said).toContain("it should be all green");
    const entry = desktopEntry();
    expect(entry["command"]).toBe(BUN);
    expect(entry["args"]).toEqual(scriptArgs(MCP_SCRIPT, BUN));
    expect(entry["env"]).toEqual(oldEntry()["env"]);
    const whole = JSON.parse(desktopFile()) as { globalShortcut: string; mcpServers: Record<string, unknown> };
    expect(whole.globalShortcut).toBe("Cmd+K");
    expect(whole.mcpServers["other"]).toEqual(OTHER);
    expect(backups()).toHaveLength(1);
    // Doctor's Runtime line no longer counts Desktop's entry as wired before the flags.
    expect(readHost(home, home, {}).runtimes.find((row) => row.used.includes("desktop"))?.projectEnv).toEqual([]);

    const again = await installAtTerminal(lister(false));
    expect(again.said).not.toContain("Claude Desktop");
    expect(backups()).toHaveLength(1);
  });

  test("Desktop open: the file is left byte for byte, the person is told to quit it and connect, and the ending promises no green", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const r = await installAtTerminal(lister(true));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("Claude Desktop is open");
    expect(r.said).toContain("Quit Claude Desktop, run `counterparts connect` again");
    expect(r.said).not.toContain("it should be all green");
    expect(r.said).toContain("its Runtime line stays amber until Claude Desktop's entry is rewritten");
    expect(desktopFile()).toBe(before);
    expect(backups()).toHaveLength(0);
  });

  test("the process list could not be read: treated as open, nothing written", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const r = await installAtTerminal(lister(undefined, false));
    expect(r.said).toContain("whether Desktop is open could not be checked");
    expect(desktopFile()).toBe(before);
  });

  test("an entry already current, an entry not ours, and no Desktop at all: nothing said, nothing written", async () => {
    writeDesktop({ ...oldEntry(), args: scriptArgs(MCP_SCRIPT, BUN) });
    let before = desktopFile();
    let r = await installAtTerminal(lister(true));
    expect(r.said).not.toContain("Claude Desktop");
    expect(r.said).toContain("it should be all green");
    expect(desktopFile()).toBe(before);

    writeDesktop({ command: "npx", args: ["-y", "someone-elses-server"] });
    before = desktopFile();
    r = await installAtTerminal(lister(false));
    expect(r.said).not.toContain("Claude Desktop");
    expect(desktopFile()).toBe(before);

    rmSync(dirname(desktopConfigPath(home)), { recursive: true });
    r = await installAtTerminal(lister(false));
    expect(r.said).not.toContain("Claude Desktop");
    expect(existsSync(desktopConfigPath(home))).toBe(false);
  });

  // Review of #356: a Desktop file that does not parse is left alone and said,
  // and doctor cannot read an entry in it (its Runtime line is green), so the
  // ending promises neither green nor amber for Desktop.
  test("a Desktop file with a trailing comma: left byte for byte, said, and the ending promises no green", async () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    const raw = `{\n  "mcpServers": {\n    "${MCP_SERVER_NAME}": ${JSON.stringify(oldEntry())},\n  }\n}\n`;
    writeFileSync(path, raw);
    const r = await installAtTerminal(lister(false));
    expect(r.code).toBe(EXIT.ok);
    expect(r.said).toContain("has a comma just before a closing } or ]");
    expect(r.said).not.toContain("it should be all green");
    expect(r.said).toContain("Claude Desktop's config was left as it was, as said above");
    expect(readFileSync(path, "utf8")).toBe(raw);
    expect(backups()).toHaveLength(0);
  });

  // Review of #356: a write that fails is a fail line and no green from
  // `install` (exit 0, like its other host steps), and exit 1 from `connect`.
  test.skipIf(process.getuid?.() === 0)("a write that fails: install exits 0 with a fail line and no green; connect exits 1", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const folder = dirname(desktopConfigPath(home));
    chmodSync(folder, 0o555);
    try {
      const r = await installAtTerminal(lister(false));
      expect(r.code).toBe(EXIT.ok);
      expect(r.said).toContain("Claude Desktop's entry could not be rewritten");
      expect(r.said).not.toContain("it should be all green");
      expect(r.said).toContain("its Runtime line stays amber until Claude Desktop's entry is rewritten");
      const c = await connect(lister(false));
      expect(c.code).toBe(EXIT.failed);
      expect(c.said).toContain("Claude Desktop's entry could not be rewritten");
    } finally {
      chmodSync(folder, 0o755);
    }
    expect(desktopFile()).toBe(before);
  });

  test("with no Claude Code on this machine, Desktop's entry is still brought up to date", async () => {
    writeDesktop(oldEntry());
    const r = await installAtTerminal(lister(false), () => ({ missing: true, code: null, out: "", err: "" }));
    expect(r.said).toContain("Claude Code is not on this machine");
    expect(r.said).toContain("Claude Desktop: rewrote its counterparts entry");
    expect(desktopEntry()["args"]).toEqual(scriptArgs(MCP_SCRIPT, BUN));
  });

  test("the scripted install (no terminal) reads no host file: Desktop's entry is left as it was", async () => {
    writeDesktop(oldEntry());
    const before = desktopFile();
    const c = consoleWith();
    expect(await run(["install", "--config", cfg], { io: c.io, env: { COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" }, home, spawner, processes: lister(false) })).toBe(EXIT.ok);
    expect(desktopFile()).toBe(before);
    expect(backups()).toHaveLength(0);
  });
});

describe("doctor's Runtime line reads Claude Desktop's entry", () => {
  function runtimeLine() {
    const host = readHost(home, home, {});
    const line = doctorFindings({
      configPath: cfg,
      configReason: "loaded",
      config: {},
      dir: store,
      store: null,
      today: "2026-10-10",
      refusals: {},
      host,
    }).find((f) => f.key === "runtime");
    return { host, line };
  }

  test("the old shape is amber, names Desktop, and says to quit it before connect", () => {
    writeDesktop(oldEntry());
    const { host, line } = runtimeLine();
    expect(host.runtimes).toEqual([{ exe: BUN, kind: "bun", present: true, used: ["desktop"], projectEnv: ["desktop"] }]);
    expect(line?.severity).toBe("amber");
    expect(line?.detail).toContain("Claude Desktop server run under bun");
    expect(line?.detail).toContain("the Claude Desktop server was wired before Counterparts told Bun to skip a project's .env");
    expect(line?.fix).toMatch(/^Quit Claude Desktop first/);
    expect(line?.fix).toContain("counterparts connect");
    expect(line?.fix).toContain("reopen Claude Desktop");
    expect(line?.data["projectEnv"]).toBe("desktop");
  });

  test("after connect with Desktop closed, green", async () => {
    writeDesktop(oldEntry());
    await connect(lister(false));
    const { host, line } = runtimeLine();
    expect(host.runtimes.find((r) => r.used.includes("desktop"))?.projectEnv).toEqual([]);
    expect(line?.severity).toBe("green");
  });

  test("Claude Code's commands current and Desktop's old: the amber names Desktop alone", async () => {
    // A connect run while Desktop was open: Claude Code's half is done.
    writeDesktop(oldEntry());
    await connect(lister(true));
    const { line } = runtimeLine();
    expect(line?.severity).toBe("amber");
    expect(line?.data["projectEnv"]).toBe("desktop");
    expect(line?.detail).toContain("the Claude Desktop server was wired before");
  });

  test("a hand-made Desktop entry under our name is not graded: connect would never touch it, so an amber would never clear", () => {
    writeDesktop({ command: BUN, args: ["run", "/x/their-own-server.ts"] });
    expect(readHost(home, home, {}).runtimes.some((r) => r.used.includes("desktop"))).toBe(false);
    writeDesktop({ ...oldEntry(), args: ["run", MCP_SCRIPT, "--verbose"] });
    expect(readHost(home, home, {}).runtimes.some((r) => r.used.includes("desktop"))).toBe(false);
  });

  test("Claude Code's hooks and Desktop both old: one amber, Claude Code's named first, the fix says quit Desktop then connect", () => {
    writeDesktop(oldEntry());
    const host = readHost(home, home, {});
    const line = doctorFindings({
      configPath: cfg,
      configReason: "loaded",
      config: {},
      dir: store,
      store: null,
      today: "2026-10-10",
      refusals: {},
      host: {
        ...host,
        runtimes: [
          { exe: BUN, kind: "bun", present: true, used: ["hooks", "mcp", "desktop"], projectEnv: ["hooks", "mcp", "desktop"] },
        ],
      },
    }).find((f) => f.key === "runtime");
    expect(line?.severity).toBe("amber");
    expect(line?.detail).toContain("the hooks and mcp and Claude Desktop server were wired before");
    expect(line?.fix).toMatch(/^Quit Claude Desktop first .*Run: counterparts connect/);
  });
});
