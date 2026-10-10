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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

  test("repairDesktop never throws, and refuses a file it cannot parse", () => {
    const path = desktopConfigPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");
    expect(repairDesktop({ home, exe: BUN, desktopRunning: false, dryRun: false, now: Date.now() }).outcome).toBe("none");
    expect(readFileSync(path, "utf8")).toBe("{ not json");
  });

  test("Claude Desktop's own process is recognised, its helpers and mentions are not", () => {
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/MacOS/Claude")).toBe(true);
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/MacOS/Claude --some-flag")).toBe(true);
    expect(DESKTOP_APP_PROCESS.test("/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper")).toBe(false);
    expect(DESKTOP_APP_PROCESS.test("vim /notes/Claude.app/Contents/MacOS/Claude-notes.txt")).toBe(false);
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
    expect(line?.detail).toContain("Claude Desktop's server run under bun");
    expect(line?.detail).toContain("Claude Desktop's server was wired before Counterparts told Bun to skip a project's .env");
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
    expect(line?.detail).toContain("the Claude Desktop's server was wired before");
  });
});
