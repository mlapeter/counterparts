/**
 * A PROJECT'S `.env` CANNOT POINT COUNTERPARTS AT ANOTHER MEMORY (2026-10-09).
 *
 * Bun loads `.env` from the working directory into `process.env` before any of
 * our code runs, and the host starts our hooks and servers in the person's
 * project. A variable the real environment already holds wins over the file,
 * so the hole was every variable nobody set — and nothing pins the plugin
 * server's `COUNTERPARTS_DATA_DIR`, nor the npm hook's `COUNTERPARTS_CONFIG`.
 * Every launch now tells Bun `--no-env-file` (`adapters/runtime.ts`).
 *
 * Each test starts Counterparts the way a host does — the plugin's launcher,
 * the hook command `install` writes, the installed CLI shim — in a project
 * whose `.env` names a DECOY store or configuration, and checks the decoy is
 * never touched. Hermetic: a temp HOME, store and project, an explicit `env`
 * on every child (test/preload.ts), `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { hookCommand } from "../src/adapters/cli/install.js";
import { CLI_SCRIPT, scriptArgs } from "../src/adapters/runtime.js";

const ROOT = resolve(import.meta.dir, "..");
const LAUNCHER = join(ROOT, "src", "adapters", "plugin-run.sh");
const SHIMS = ["cli/bin/counterparts.mjs", "claude-code/bin/hook.mjs", "mcp/bin/serve.mjs", "dashboard/bin/dashboard.mjs"].map((p) =>
  join(ROOT, "src", "adapters", p),
);
const CANARY = "The project env canary: the kettle in the studio is a Fellow Stagg.";

let work: string;
let home: string;
let project: string;
let config: string;
let store: string;
let decoyConfig: string;
let decoyStore: string;

/** Exactly these variables, nothing inherited: what a host hands a child, pointed at this test's HOME. */
function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: work,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    ...extra,
  };
}

/** `counterparts install`, non-interactive, writing a config and its store where told. */
function installAt(configPath: string): void {
  const r = spawnSync(process.execPath, [...scriptArgs(CLI_SCRIPT), "install", "--config", configPath, "--name", "T", "--no-connect"], {
    cwd: work,
    env: env(),
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(r.status).toBe(0);
  expect(existsSync(configPath)).toBe(true);
}

/** Every file under a directory, relative — what "the decoy was not touched" compares. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(d, name.name), `${rel}${name.name}/`);
      else out.push(`${rel}${name.name}`);
    }
  };
  walk(dir, "");
  return out.sort();
}

function rpc(...calls: Record<string, unknown>[]): string {
  return (
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      ...calls,
    ]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n"
  );
}

function response(stdout: string, id: number): string {
  return stdout.split("\n").find((l) => l.includes(`"id":${String(id)}`)) ?? "";
}

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-project-env-")));
  home = join(work, "home");
  project = join(home, "project");
  mkdirSync(project, { recursive: true });
  config = join(work, "real", "claude-code.json");
  store = join(work, "real", "store");
  decoyConfig = join(work, "decoy", "claude-code.json");
  decoyStore = join(work, "decoy", "store");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("a project's .env", () => {
  test("cannot redirect the plugin's memory server: COUNTERPARTS_DATA_DIR in .env is ignored", () => {
    installAt(config);
    // The plugin's server is launched with no -e, so a store named in the
    // environment is the one it opens — which is why the FILE must not count.
    writeFileSync(join(project, ".env"), `COUNTERPARTS_DATA_DIR=${decoyStore}\n`);
    const note = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "note", arguments: { text: CANARY } } };
    const serve = (extra: Record<string, string>) =>
      spawnSync("/bin/sh", [LAUNCHER, "mcp"], {
        cwd: project,
        env: env({ COUNTERPARTS_RUNTIME: process.execPath, ...extra }),
        input: rpc(note),
        encoding: "utf8",
        timeout: 60_000,
      });

    // The configuration is named and the store is not: the explicit-dir guard
    // refuses ("no store was named"). Reading the .env, the server would have
    // opened the decoy and noted there (measured on the code before this fix).
    const ignored = serve({ COUNTERPARTS_CONFIG: config });
    expect(ignored.stderr).toContain("no store was named");
    expect(response(ignored.stdout ?? "", 2)).toBe("");
    expect(existsSync(decoyStore)).toBe(false);

    // The control: the same variable in the REAL environment still decides.
    const named = serve({ COUNTERPARTS_DATA_DIR: store, COUNTERPARTS_CONFIG: config });
    const noted = response(named.stdout ?? "", 2);
    expect(noted).toContain('"result"');
    expect(noted).not.toContain('"isError":true');
    expect(existsSync(decoyStore)).toBe(false);
    const recall = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "recall", arguments: { question: "which kettle is in the studio?", mode: "facts" } } };
    const back = spawnSync(process.execPath, [...scriptArgs(join(ROOT, "src/adapters/mcp/bin/serve.ts"))], {
      cwd: work,
      env: env({ COUNTERPARTS_DATA_DIR: store, COUNTERPARTS_CONFIG: config }),
      input: rpc(recall),
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(response(back.stdout ?? "", 2)).toContain("Fellow Stagg");
  }, 120_000);

  test("cannot redirect the npm hook: COUNTERPARTS_CONFIG in .env is ignored", () => {
    installAt(decoyConfig);
    const before = filesUnder(decoyStore);
    writeFileSync(join(project, ".env"), `COUNTERPARTS_CONFIG=${decoyConfig}\n`);
    // The hook command exactly as `install` writes it for a default install: no --config.
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "project-env-1",
      cwd: project,
      transcript_path: join(project, "t.jsonl"),
      source: "startup",
    });
    const r = spawnSync("/bin/sh", ["-c", hookCommand(undefined, process.execPath)], {
      cwd: project,
      env: env(),
      input: payload,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status).toBe(0);
    // With nothing naming a configuration, the explicit-dir guard stands the
    // hook down; reading the .env, it would have opened the decoy and recorded
    // the session there.
    expect(r.stderr).toContain("stood down");
    expect(filesUnder(decoyStore)).toEqual(before);
    expect(existsSync(join(decoyStore, "sessions", "project-env-1.json"))).toBe(false);
  }, 120_000);

  test("cannot redirect the installed console: the CLI shim tells Bun to skip it", () => {
    installAt(decoyConfig);
    const before = filesUnder(decoyStore);
    writeFileSync(join(project, ".env"), `COUNTERPARTS_DATA_DIR=${decoyStore}\n`);
    const r = spawnSync("/bin/sh", [SHIMS[0] as string, "note", "This must not land in the decoy."], {
      cwd: project,
      env: env(),
      encoding: "utf8",
      timeout: 60_000,
    });
    // No store named anywhere it may be named: the guard refuses, and says so.
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toContain("Remembered");
    expect(filesUnder(decoyStore)).toEqual(before);
  }, 120_000);

  test("every launcher that can pick Bun tells it --no-env-file", () => {
    for (const shim of SHIMS) {
      const line = readFileSync(shim, "utf8").split("\n")[1] ?? "";
      expect(line).toContain('then exec bun --no-env-file "$0" "$@";');
      expect(line).toContain('then exec node "$0" "$@";');
    }
    const launcher = readFileSync(LAUNCHER, "utf8");
    expect(launcher).toContain('exec "$runtime" --no-env-file "$entry" "$@"');
  });
});
