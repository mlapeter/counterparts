/**
 * EVERY CLAUDE CODE INSTALL COMPOSES A WAKE (2026-10-12, the 0.3.20 release check).
 *
 * Only the terminal install wrote `injectionBudgetBytes`. The plugin's first run
 * is `install --no-connect` with stdin ignored, so it took the scripted arm, which
 * wrote no key — and with no ceiling the renderer composes nothing
 * (`briefing.no-budget`): every session of every plugin install woke on the
 * bootstrap line, day after day. The fix is two halves: every Claude Code arm
 * writes 9,000 into a configuration it creates, and a file without the key wakes
 * under the same number at load (`config.ts#withBudgetDefault`).
 *
 * The first three tests go through the real processes: the plugin launcher (whose
 * first SessionStart makes the install through `plugin.ts#ensureFirstRun`), the
 * console's `install --yes` with no terminal, and the hook script. "The next day"
 * is the next session after the first one's turn-end and end — the boundary the
 * bootstrap line waits for; no process here can be handed tomorrow's clock.
 *
 * Hermetic: every process gets an explicit environment whose HOME is this test's
 * own directory, removed afterwards.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HOOK_SCRIPT } from "../src/adapters/cli/install.js";
import { CLI_SCRIPT } from "../src/adapters/runtime.js";
import { CLAUDE_CODE_BUDGET_BYTES, capabilities, loadConfig, withBudgetDefault } from "../src/adapters/config.js";
import { hostCeiling } from "../src/adapters/cli/commands-scope.js";
import { desktopConfigPath } from "../src/adapters/cli/desktop.js";
import { run } from "../src/adapters/cli/index.js";
import { BOOTSTRAP } from "../src/core/self/index.js";
import { Store } from "../src/core/store/index.js";

const ROOT = resolve(import.meta.dir, "..");
const LAUNCHER = join(ROOT, "src", "adapters", "plugin-run.sh");
const WAIT_MS = 45_000;

let work: string;
let home: string;
let project: string;
let emptyBin: string;
let tmp: string;
let transcript: string;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-ceiling-")));
  home = join(work, "home");
  project = join(home, "project");
  emptyBin = join(work, "bin");
  tmp = join(work, "tmp");
  for (const d of [project, emptyBin, tmp]) mkdirSync(d, { recursive: true });
  transcript = join(project, "t.jsonl");
  const at = new Date().toISOString();
  writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "Let's settle it: the parser uses a Pratt design for expressions." }, timestamp: at }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Agreed: Pratt for expressions, recursive descent elsewhere." }] }, timestamp: at }),
    ].join("\n") + "\n",
  );
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const configPath = (): string => join(home, ".counterparts", "claude-code.json");

/** What Claude Code gives the plugin's processes, at this test's HOME. */
function pluginEnv(): Record<string, string> {
  return {
    PATH: emptyBin,
    HOME: home,
    USERPROFILE: home,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    CLAUDE_PLUGIN_ROOT: ROOT,
    CLAUDE_PLUGIN_DATA: join(home, ".claude", "plugins", "data", "counterparts-counterparts"),
    CLAUDE_PROJECT_DIR: project,
    COUNTERPARTS_RUNTIME: process.execPath,
    TMPDIR: tmp,
  };
}

/** What a settings-wired (npm) hook gets: no plugin variables. */
function npmEnv(): Record<string, string> {
  return { PATH: emptyBin, HOME: home, USERPROFILE: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", CLAUDE_PROJECT_DIR: project, TMPDIR: tmp };
}

function payload(event: string, session: string): string {
  return JSON.stringify({
    hook_event_name: event,
    session_id: session,
    cwd: project,
    transcript_path: transcript,
    ...(event === "SessionStart" ? { source: "startup" } : {}),
    ...(event === "UserPromptSubmit" ? { prompt: "Let's settle it: the parser uses a Pratt design." } : {}),
    ...(event === "SessionEnd" ? { reason: "exit" } : {}),
  });
}

type Hook = (event: string, session: string) => { code: number; stdout: string };

const pluginHook: Hook = (event, session) => {
  const r = spawnSync("/bin/sh", [LAUNCHER, "hook"], { input: payload(event, session), encoding: "utf8", env: pluginEnv(), timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "" };
};

const npmHook: Hook = (event, session) => {
  const r = spawnSync(process.execPath, ["run", HOOK_SCRIPT], { input: payload(event, session), encoding: "utf8", env: npmEnv(), timeout: 60_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "" };
};

/** The model-facing text of a SessionStart: JSON when it carries a line for
 *  the person too, plain text otherwise. */
function wakeText(stdout: string): string {
  try {
    const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
    return out.hookSpecificOutput?.additionalContext ?? "";
  } catch {
    return stdout;
  }
}

/** Day one through the hooks, then session starts until one wakes composed (the
 *  worker the Stop spawned is detached) or the wait runs out. */
async function dayOneThenNextWake(hook: Hook): Promise<string> {
  const first = hook("SessionStart", "day-1");
  expect(first.code).toBe(0);
  for (const event of ["UserPromptSubmit", "Stop", "SessionEnd"]) expect(hook(event, "day-1").code).toBe(0);
  const until = Date.now() + WAIT_MS;
  let n = 0;
  let wake = "";
  do {
    n += 1;
    wake = wakeText(hook("SessionStart", `day-2-${String(n)}`).stdout);
    if (!wake.includes(BOOTSTRAP)) break;
    await new Promise((r) => setTimeout(r, 1_000));
  } while (Date.now() < until);
  return wake;
}

function expectComposed(wake: string): void {
  expect(wake).not.toContain(BOOTSTRAP);
  // The head tag, with the hook's fields in it since 2026-10-20 (ONE TAG).
  expect(wake).toMatch(/<!-- counterparts:wake (?:[a-z]+=\S+ )*elements=/);
  // Day one's content, in the next session's wake.
  expect(wake).toContain("Pratt");
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
}

describe("a Claude Code install wakes composed from the next session", () => {
  test(
    "the plugin's first run (`install --no-connect`, stdin ignored) writes the ceiling, and the next session's wake is composed",
    async () => {
      const wake = await dayOneThenNextWake(pluginHook);
      expect(readConfig()["injectionBudgetBytes"]).toBe(9000);
      expectComposed(wake);
    },
    120_000,
  );

  test(
    "`install --yes` with no terminal writes the ceiling, and the npm hooks wake composed",
    async () => {
      const r = spawnSync(process.execPath, ["run", CLI_SCRIPT, "install", "--yes"], {
        env: npmEnv(),
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(r.status).toBe(0);
      expect(readConfig()["injectionBudgetBytes"]).toBe(9000);
      expectComposed(await dayOneThenNextWake(npmHook));
    },
    120_000,
  );

  test(
    "a configuration an earlier install wrote with no ceiling wakes under Claude Code's, and the file is not rewritten",
    async () => {
      const r = spawnSync(process.execPath, ["run", CLI_SCRIPT, "install", "--yes"], {
        env: npmEnv(),
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(r.status).toBe(0);
      // The 0.3.18–0.3.19 plugin and scripted shape: no key.
      const { injectionBudgetBytes: _dropped, ...keyless } = readConfig();
      const text = `${JSON.stringify(keyless, null, 2)}\n`;
      writeFileSync(configPath(), text);
      expectComposed(await dayOneThenNextWake(npmHook));
      expect(readFileSync(configPath(), "utf8")).toBe(text);
    },
    120_000,
  );
});

describe("the fallback, unit by unit", () => {
  test("withBudgetDefault fills an absent ceiling, marks it defaulted, and never overrides a file's", () => {
    const absent = withBudgetDefault(loadConfig({ dataDir: "/x" }).config);
    expect(absent.injectionBudgetBytes).toBe(CLAUDE_CODE_BUDGET_BYTES);
    expect(CLAUDE_CODE_BUDGET_BYTES).toBe(9000);
    expect(absent.injectionBudgetDefaulted).toBe(true);
    // Still not REPORTED: a default is not the host saying so (scar §2.4).
    expect(capabilities(absent).find((c) => c.name === "injectionBudgetBytes")).toMatchObject({ reported: false, value: 9000 });
    const set = withBudgetDefault(loadConfig({ dataDir: "/x", injectionBudgetBytes: 4321 }).config);
    expect(set.injectionBudgetBytes).toBe(4321);
    expect(set.injectionBudgetDefaulted).toBeUndefined();
    expect(capabilities(set).find((c) => c.name === "injectionBudgetBytes")).toMatchObject({ reported: true, value: 4321 });
    // A file cannot claim the flag: it is not a key the loader reads.
    expect(loadConfig({ injectionBudgetDefaulted: true }).config.injectionBudgetDefaulted).toBeUndefined();
  });

  test("rebrief's ceiling: a config there without the key gives Claude Code's default and says so; no config at all still refuses", () => {
    const base = join(work, "base");
    const dir = join(base, "store");
    mkdirSync(dir, { recursive: true });
    const absent = hostCeiling(dir, undefined, home);
    expect("refusal" in absent).toBe(true);
    writeFileSync(join(base, "claude-code.json"), JSON.stringify({ dataDir: dir }));
    const found = hostCeiling(dir, undefined, home);
    expect("bytes" in found && found.bytes).toBe(9000);
    expect("source" in found && found.source).toContain("Claude Code's default");
  });

  test("`rebrief` on a store whose config has no key composes and publishes the wake", async () => {
    const base = join(work, "rb");
    const dir = join(base, "store");
    Store.open({ dir }).close();
    writeFileSync(join(base, "claude-code.json"), JSON.stringify({ dataDir: dir }));
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(["rebrief", "--dir", dir], { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, env: {}, home });
    expect(err.join("\n")).toBe("");
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("budget 9000 bytes from");
    expect(out.join("\n")).toContain("Claude Code's default");
  });

  test("a --budget on the line always wins over the default, and Claude Desktop's install writes no ceiling", async () => {
    const io = { out: () => {}, err: () => {} };
    for (const extra of [["--no-connect"], ["--yes"]]) {
      const h = join(work, `flag${extra.join("")}`);
      expect(await run(["install", "--dir", join(h, "store"), "--budget", "4000", ...extra], { io, env: {}, home: h })).toBe(0);
      expect(JSON.parse(readFileSync(join(h, ".counterparts", "claude-code.json"), "utf8"))["injectionBudgetBytes"]).toBe(4000);
    }
    // Desktop: a configuration it CREATES gets no key (`defaultBudget: false`).
    const d = join(work, "desktop");
    const cfg = join(d, "elsewhere", "claude-code.json");
    const desktopFile = desktopConfigPath(d);
    mkdirSync(join(desktopFile, ".."), { recursive: true });
    writeFileSync(desktopFile, "{}\n");
    expect(await run(["install", "--host", "claude-desktop", "--config", cfg], { io, env: {}, home: d })).toBe(0);
    expect(JSON.parse(readFileSync(cfg, "utf8"))["injectionBudgetBytes"]).toBeUndefined();
  });

  test("doctor's Config line says which ceiling is in force", async () => {
    const dir = join(work, "doc", "store");
    Store.open({ dir }).close();
    const read = async (config: Record<string, unknown>): Promise<string> => {
      const path = join(work, "doc", "claude-code.json");
      writeFileSync(path, JSON.stringify(config));
      const out: string[] = [];
      await run(["doctor", `--config=${path}`, "--json"], { io: { out: (l) => out.push(l), err: () => {} }, env: {}, home: join(work, "doc") });
      const json = JSON.parse(out.join("\n")) as { findings: { key: string; detail: string }[] };
      return json.findings.find((f) => f.key === "config")?.detail ?? "";
    };
    expect(await read({ dataDir: dir })).toContain("wake ceiling 9000 bytes, Claude Code's default");
    const set = await read({ dataDir: dir, injectionBudgetBytes: 7000 });
    expect(set).toContain("wake ceiling 7000 bytes");
    expect(set).not.toContain("default");
  });
});
