/**
 * THE SINGLE BINARY'S BRANCHES, RUN FROM SOURCE (docs/single-binary.md).
 *
 * Inside a `bun build --compile` binary every module shares one URL, embedded
 * files sit under a virtual root, and the binary runs itself by mode. Each of
 * those branches takes the binary as a parameter defaulting to
 * `runtime.ts#BINARY` (null here, under `bun test`), so a fake one drives
 * them all without a build. `tools/single-binary/smoke.sh` runs the real
 * thing; CI runs it on every platform (.github/workflows/single-binary.yml).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BINARY_CONNECT_REFUSAL, EXIT, run } from "../src/adapters/cli/index.js";
import type { Io } from "../src/adapters/cli/index.js";
import { hookTargetPath, readHost } from "../src/adapters/cli/install.js";
import { isOurHookCommand, processMark } from "../src/adapters/cli/wire.js";
import { hookCommandLive } from "../src/adapters/host-wiring.js";
import { isEntryPoint as hookIsEntry } from "../src/adapters/claude-code/bin/hook.js";
import { isEntryPoint as runnerIsEntry } from "../src/adapters/claude-code/bin/runner.js";
import { isEntryPoint as serveIsEntry } from "../src/adapters/mcp/bin/serve.js";
import { isEntryPoint as cliIsEntry } from "../src/adapters/cli/bin/counterparts.js";
import { isEntryPoint as dashboardIsEntry } from "../src/adapters/dashboard/bin/dashboard.js";
import { doctorFindings } from "../src/adapters/claude-code/doctor.js";
import { MCP_SERVER_NAME } from "../src/adapters/cli/install.js";
import { runningAsPlugin } from "../src/adapters/plugin.js";
import {
  BINARY,
  BINARY_MODES,
  BINARY_MODE_OF,
  binaryOf,
  bundledModelDir,
  isBinaryName,
  isCompiled,
  packagePath,
  parseScriptInvocation,
  runtimeLabel,
  scriptArgs,
  EMPTY_BUNFIG,
} from "../src/adapters/runtime.js";
import type { Binary } from "../src/adapters/runtime.js";
import { PLATFORMS, RELEASED, RELEASE_URL, assetName, binariesJson } from "../tools/single-binary/build.js";

const ROOT = join(import.meta.dir, "..");

let work: string;
let fake: Binary;

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-binary-")));
  // Where `plugin-run.sh` keeps it: <CLAUDE_PLUGIN_DATA>/bin/<version>/counterparts.
  const self = join(work, "plugin-data", "bin", "0.3.14", "counterparts");
  mkdirSync(join(work, "plugin-data", "bin", "0.3.14"), { recursive: true });
  writeFileSync(self, "");
  fake = { root: "/$bunfs/root", self };
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function consoleWith(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe("knowing it is the binary", () => {
  test("from source, under bun test, it is not", () => {
    expect(BINARY).toBeNull();
    expect(isCompiled()).toBe(false);
    expect(runtimeLabel()).toMatch(/^bun \d/);
  });

  test("a module URL inside the binary names its virtual root, on macOS/Linux and on Windows", () => {
    expect(binaryOf("file:///$bunfs/root/counterparts", "/d/counterparts")).toEqual({ root: "/$bunfs/root", self: "/d/counterparts" });
    expect(binaryOf("file:///B:/~BUN/root/counterparts.exe", "C:\\d\\counterparts.exe")).toEqual({
      root: "B:/~BUN/root",
      self: "C:\\d\\counterparts.exe",
    });
    expect(binaryOf("B:\\~BUN\\root\\counterparts.exe", "C:\\d\\counterparts.exe")?.root).toBe("B:\\~BUN\\root");
    expect(binaryOf(import.meta.url, process.execPath)).toBeNull();
    expect(binaryOf("file:///Users/x/bun/root/counterparts", "/x")).toBeNull();
  });

  test("the console says which runtime it is", () => {
    expect(runtimeLabel(fake)).toMatch(/^the single binary \(bun /);
  });
});

describe("its own files", () => {
  test("a file of the package resolves under the virtual root, the top-level ones as ./<name>", () => {
    expect(packagePath("package.json", fake)).toBe("/$bunfs/root/./package.json");
    expect(packagePath("src/adapters/dashboard/web", fake)).toBe("/$bunfs/root/src/adapters/dashboard/web");
    expect(packagePath("src/x/y.js", { root: "B:\\~BUN\\root", self: "C:\\c.exe" })).toBe("B:\\~BUN\\root\\src\\x\\y.js");
  });

  test("from source, the same paths are on disk", () => {
    expect(packagePath("package.json")).toBe(join(ROOT, "package.json"));
    expect(existsSync(packagePath("src/adapters/dashboard/web/app.html"))).toBe(true);
    expect(JSON.parse(readFileSync(packagePath("package.json"), "utf8")).name).toBe("counterparts");
  });

  test("the model table is named only in the binary; from source the package resolves itself", () => {
    expect(bundledModelDir(fake)).toBe("/$bunfs/root/node_modules/counterparts-model-potion");
    expect(bundledModelDir(null)).toBeUndefined();
  });
});

describe("running itself", () => {
  test("every entry script becomes the binary and its mode", () => {
    for (const [file, mode] of Object.entries(BINARY_MODE_OF)) {
      // The virtual path an entry's constant resolves to inside the binary.
      expect(scriptArgs(`/$bunfs/x/bin/${file}`, fake.self, fake)).toEqual([mode]);
    }
    expect(Object.values(BINARY_MODE_OF).sort()).toEqual([...BINARY_MODES].sort());
  });

  test("another executable, or a script that is not an entry, keeps the runtime's shape", () => {
    const bun = ["--no-env-file", `--config=${EMPTY_BUNFIG}`, "run"];
    expect(scriptArgs("/s/hook.ts", "/usr/local/bin/bun", fake)).toEqual([...bun, "/s/hook.ts"]);
    expect(scriptArgs("/s/other.ts", fake.self, fake)).toEqual([...bun, "/s/other.ts"]);
    expect(scriptArgs("/s/hook.ts", fake.self, null)).toEqual([...bun, "/s/hook.ts"]);
  });

  test("no entry's main-script guard fires inside the binary; from source they still do", () => {
    const guards = [hookIsEntry, runnerIsEntry, serveIsEntry, cliIsEntry, dashboardIsEntry];
    const url = "file:///$bunfs/root/counterparts";
    for (const guard of guards) {
      // Inside the binary argv[1] IS every module's URL — the case that made them all fire.
      expect(guard("/$bunfs/root/counterparts", url, fake)).toBe(false);
      expect(guard(fileURLToPath(import.meta.url), import.meta.url, null)).toBe(true);
    }
  });
});

describe("reading the binary's own commands back", () => {
  test("`<binary> <mode> …` parses: the binary is the file that must be there", () => {
    expect(parseScriptInvocation([fake.self, "hook", "--config", "/c.json"])).toEqual({
      exe: fake.self,
      runtime: "binary",
      script: fake.self,
      mode: "hook",
      rest: ["--config", "/c.json"],
      projectEnv: "ignored",
    });
    expect(parseScriptInvocation(["C:\\d\\counterparts.exe", "mcp"])?.mode).toBe("mcp");
    for (const mode of BINARY_MODES) expect(parseScriptInvocation([fake.self, mode])?.mode).toBe(mode);
  });

  test("what scriptArgs writes for the binary reads back as the same mode", () => {
    for (const [file, mode] of Object.entries(BINARY_MODE_OF)) {
      expect(parseScriptInvocation([fake.self, ...scriptArgs(`/$bunfs/x/${file}`, fake.self, fake)])?.mode).toBe(mode);
    }
  });

  test("the npm shims and other words are not the binary", () => {
    for (const name of ["counterparts-hook", "counterparts-mcp", "counterparts-dashboard"]) {
      expect(isBinaryName(`/u/bin/${name}`)).toBe(false);
    }
    for (const name of ["counterparts", "counterparts.exe", "counterparts-0.3.14-darwin-arm64"]) expect(isBinaryName(`/d/${name}`)).toBe(true);
    expect(parseScriptInvocation([fake.self, "bogus"])).toBeNull();
    expect(parseScriptInvocation(["/u/bin/bun", "hook"])).toBeNull();
  });

  test("the binary's hook command is ours, live while the file is there, and names it as its target", () => {
    const command = `"${fake.self}" hook`;
    expect(isOurHookCommand(command)).toBe(true);
    expect(isOurHookCommand(`${command} --config "/c/claude-code.json"`)).toBe(true);
    expect(isOurHookCommand(`"${fake.self}" mcp`)).toBe(false);
    expect(isOurHookCommand(`${command} --verbose`)).toBe(false);
    expect(hookTargetPath(command)).toBe(fake.self);
    expect(hookCommandLive(command, { PATH: "" })).toBe(true);
    rmSync(fake.self);
    expect(hookCommandLive(command, { PATH: "" })).toBe(false);
  });

  test("its processes are recognised for disconnect and uninstall", () => {
    expect(processMark(`${fake.self} mcp`)).toBe("an MCP server");
    expect(processMark(`${fake.self} runner`)).toBe("the worker");
    expect(processMark(`${fake.self} dashboard serve --port 4747`)).toBe("a dashboard");
    expect(processMark(`${fake.self} hook`)).toBeNull();
    expect(processMark("/x/bun --no-env-file /pkg/src/adapters/cli/bin/counterparts.mjs dashboard")).toBeNull();
  });

  test("doctor's Runtime line names the binary", () => {
    const home = join(work, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `"${fake.self}" hook` }] }] } }),
    );
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: fake.self, args: ["mcp"] } } }));
    const host = readHost(home, home, {});
    expect(host.runtimes).toEqual([{ exe: fake.self, kind: "binary", present: true, used: ["hooks", "mcp"], projectEnv: [] }]);
    const line = doctorFindings({
      configPath: join(home, "claude-code.json"),
      configReason: "loaded",
      config: {},
      dir: join(home, "store"),
      store: null,
      today: "2026-10-09",
      refusals: {},
      host,
    }).find((f) => f.key === "runtime");
    expect(line?.severity).toBe("green");
    expect(line?.detail).toContain(`hooks and mcp run as the single binary (${fake.self})`);
  });
});

describe("knowing it is the plugin's", () => {
  test("a binary under CLAUDE_PLUGIN_DATA, with CLAUDE_PLUGIN_ROOT set, is the plugin's", () => {
    const env = { CLAUDE_PLUGIN_ROOT: join(work, "plugin-root"), CLAUDE_PLUGIN_DATA: join(work, "plugin-data") };
    expect(runningAsPlugin(env, "/anything", fake)).toBe(true);
    // The same binary somewhere else is not; nor without either variable.
    expect(runningAsPlugin(env, "/anything", { ...fake, self: join(work, "elsewhere", "counterparts") })).toBe(false);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT }, "/anything", fake)).toBe(false);
    expect(runningAsPlugin({ CLAUDE_PLUGIN_DATA: env.CLAUDE_PLUGIN_DATA }, "/anything", fake)).toBe(false);
    // A data dir whose name merely begins the same is not the parent.
    expect(runningAsPlugin({ ...env, CLAUDE_PLUGIN_DATA: join(work, "plugin-dat") }, "/anything", fake)).toBe(false);
  });
});

describe("the binary wires no host", () => {
  test("connect refuses, and says how to wire a host by hand", async () => {
    const c = consoleWith();
    const code = await run(["connect"], { io: c.io, env: {}, home: join(work, "home"), binary: fake });
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toBe(BINARY_CONNECT_REFUSAL);
    expect(BINARY_CONNECT_REFUSAL).toContain("npm i -g counterparts");
    expect(existsSync(join(work, "home", ".claude"))).toBe(false);
  });

  test("install --host claude-desktop refuses the same way", async () => {
    const c = consoleWith();
    const cfg = join(work, "cp", "claude-code.json");
    const code = await run(["install", "--host", "claude-desktop", "--config", cfg], { io: c.io, env: {}, home: join(work, "home"), binary: fake });
    expect(code).toBe(EXIT.refused);
    expect(c.err.join("\n")).toBe(BINARY_CONNECT_REFUSAL);
    expect(existsSync(cfg)).toBe(false);
  });

  test("install makes the store and the configuration, and prints no hooks block naming itself", async () => {
    const c = consoleWith();
    const cfg = join(work, "cp", "claude-code.json");
    const code = await run(["install", "--config", cfg, "--name", "Ada"], { io: c.io, env: {}, home: join(work, "home"), binary: fake });
    expect(code).toBe(EXIT.ok);
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(join(work, "cp", "store", "counterparts.sqlite"))).toBe(true);
    const said = c.out.join("\n");
    expect(said).toContain("nothing to connect");
    expect(said).not.toContain("Merge this into");
    expect(said).not.toContain("claude mcp add");
    expect(existsSync(join(work, "home", ".claude"))).toBe(false);
  });
});

describe("the checksums the plugin carries (.claude-plugin/binaries.json)", () => {
  test("the writer puts one platform per line, as `\"key\": value` — the shape plugin-run.sh reads with parameter expansion", () => {
    const text = binariesJson("1.2.3", [
      { platform: "darwin-arm64", file: "f", asset: "counterparts-1.2.3-darwin-arm64.gz", bytes: 10, sha256: "a".repeat(64), gzBytes: 5, gzSha256: "b".repeat(64) },
      { platform: "linux-x64", file: "g", asset: "counterparts-1.2.3-linux-x64.gz", bytes: 11, sha256: "c".repeat(64), gzBytes: 6, gzSha256: "d".repeat(64) },
    ]);
    const parsed = JSON.parse(text) as { version: string; url: string; platforms: Record<string, Record<string, unknown>> };
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.url).toBe(`${RELEASE_URL}/v1.2.3`);
    const lines = text.split("\n");
    expect(lines.filter((l) => l.includes('"darwin-arm64": '))).toEqual([
      `    "darwin-arm64": { "file": "counterparts-1.2.3-darwin-arm64.gz", "bytes": 10, "sha256": "${"a".repeat(64)}", "gzBytes": 5, "gzSha256": "${"b".repeat(64)}" },`,
    ]);
    expect(lines.filter((l) => l.includes('"version": '))).toEqual(['  "version": "1.2.3",']);
  });

  test("a release offers every platform CI builds but Windows, whose binary has not yet run through the launcher", () => {
    expect([...RELEASED].sort()).toEqual(Object.keys(PLATFORMS).filter((p) => !p.startsWith("windows")).sort());
  });

  test("when it is there, it is THIS version's, for every platform a release ships", () => {
    const path = join(ROOT, ".claude-plugin", "binaries.json");
    // Absent until the first release that ships the binary: the launcher then
    // keeps its old message (test/plugin-binary.test.ts).
    if (!existsSync(path)) return;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { version: string; url: string; platforms: Record<string, { file: string; sha256: string; gzSha256: string }> };
    const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
    // A release commit that bumped the version and did not rebuild: run
    // `bun tools/single-binary/build.ts --release` (docs/single-binary.md, "Releasing").
    expect(parsed.version).toBe(version);
    expect(parsed.url).toBe(`${RELEASE_URL}/v${version}`);
    expect(Object.keys(parsed.platforms).sort()).toEqual([...RELEASED].sort());
    for (const [platform, p] of Object.entries(parsed.platforms)) {
      expect(p.file).toBe(assetName(version, platform));
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.gzSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(binariesJson(parsed.version, [])).toContain(`"version": "${version}"`);
  });
});
