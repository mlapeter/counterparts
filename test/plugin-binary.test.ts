/**
 * `plugin-run.sh` WITH NO RUNTIME: THE SINGLE BINARY'S DOWNLOAD (docs/single-binary.md).
 *
 * A throwaway plugin root (the real launcher, a `plugin.json`, a
 * `binaries.json`), a throwaway HOME and plugin data directory, no Bun or
 * Node for the launcher to find (`COUNTERPARTS_RUNTIME` names one that is not
 * there), and a local HTTP server standing in for the GitHub release
 * (`COUNTERPARTS_BINARY_URL`; the checksums still come from the plugin). The
 * "binary" is a two-line shell script that prints its arguments: what is under
 * test is the launcher — that it says the right thing, returns at once,
 * downloads once, verifies before running, and never runs what fails. The real
 * binary through the real launcher is `tools/single-binary/smoke.sh --via-launcher`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { assetName, binariesJson, hostPlatform } from "../tools/single-binary/build.js";

const ROOT = resolve(import.meta.dir, "..");
const VERSION = "9.9.9";
const FAKE = "#!/bin/sh\nprintf 'fake counterparts %s\\n' \"$*\"\ncat >/dev/null\n";

let work: string;
let pluginRoot: string;
let data: string;
let server: ReturnType<typeof Bun.serve> | null = null;
let requests = 0;
/** The paths the stand-in release was asked for. */
let asked: string[] = [];
let hold: Promise<void> | null = null;
/** When set, the asset's URL answers with a redirect to this. */
let redirect: string | null = null;

const sha = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");

/** Write the plugin root: the real launcher, a plugin.json, a binaries.json. */
function plugin(opts: { manifestVersion?: string; rawSha?: string } = {}): void {
  mkdirSync(join(pluginRoot, "src", "adapters"), { recursive: true });
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  copyFileSync(join(ROOT, "src", "adapters", "plugin-run.sh"), join(pluginRoot, "src", "adapters", "plugin-run.sh"));
  writeFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), `{\n  "name": "counterparts",\n  "version": "${VERSION}"\n}\n`);
  const raw = Buffer.from(FAKE);
  const gz = gzipSync(raw);
  const platform = hostPlatform();
  const version = opts.manifestVersion ?? VERSION;
  writeFileSync(join(work, "asset.gz"), gz);
  writeFileSync(
    join(pluginRoot, ".claude-plugin", "binaries.json"),
    binariesJson(version, [
      {
        platform,
        file: `counterparts-${version}-${platform}`,
        asset: assetName(version, platform),
        bytes: raw.length,
        sha256: opts.rawSha ?? sha(raw),
        gzBytes: 56 * 1048576, // what the message reads the size from
        gzSha256: sha(gz),
      },
    ]),
  );
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: join(work, "home"),
    TMPDIR: work,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_DATA: data,
    COUNTERPARTS_RUNTIME: join(work, "no", "bun"),
    COUNTERPARTS_BINARY_URL: `http://127.0.0.1:${String(server?.port ?? 9)}`,
    ...extra,
  };
}

function launch(mode: string, input: string, e: Record<string, string> = env()): { code: number; stdout: string; ms: number } {
  const t0 = performance.now();
  const r = spawnSync("/bin/sh", [join(pluginRoot, "src", "adapters", "plugin-run.sh"), mode], { input, encoding: "utf8", env: e, timeout: 30_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", ms: performance.now() - t0 };
}

function sessionStart(session = "s1"): string {
  return JSON.stringify({ hook_event_name: "SessionStart", session_id: session, cwd: work, transcript_path: join(work, "t.jsonl"), source: "startup" });
}

function message(stdout: string): string {
  return (JSON.parse(stdout) as { systemMessage: string }).systemMessage;
}

const bin = (): string => join(data, "bin", VERSION, `counterparts${hostPlatform().startsWith("windows") ? ".exe" : ""}`);
const lock = (): string => join(data, "bin", `download-${VERSION}.lock`);
const failed = (): string => join(data, "bin", `download-${VERSION}.failed`);
const verified = (): string => join(data, "bin", VERSION, "verified");

async function until(check: () => boolean, ms = 20_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-plugin-binary-")));
  pluginRoot = join(work, "plugin");
  data = join(work, "home", ".claude", "plugins", "data", "counterparts-counterparts");
  mkdirSync(join(work, "home"), { recursive: true });
  requests = 0;
  asked = [];
  hold = null;
  redirect = null;
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      requests += 1;
      asked.push(new URL(req.url).pathname);
      if (hold !== null) await hold;
      if (redirect !== null && new URL(req.url).pathname.endsWith(".gz")) return Response.redirect(redirect, 302);
      return new URL(req.url).pathname.endsWith(".gz") ? new Response(Bun.file(join(work, "asset.gz"))) : new Response("no", { status: 404 });
    },
  });
});

afterEach(async () => {
  // Let a download still in flight finish before its directory goes.
  await until(() => !existsSync(lock()), 10_000);
  server?.stop(true);
  rmSync(work, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("plugin-run.sh with no runtime: the single binary", () => {
  test("the first SessionStart says it is getting ready and returns at once; one download lands, and the next start runs it", async () => {
    plugin();
    const first = launch("hook", sessionStart());
    expect(first.code).toBe(0);
    expect(first.ms).toBeLessThan(3000);
    const said = message(first.stdout);
    expect(said).toContain("getting ready");
    expect(said).toContain("about 56 MB");
    expect(said).toContain("github.com/mlapeter/counterparts releases");
    expect(said).toContain("next session");
    expect(first.stdout).toContain("downloading its program");

    // Every other event says nothing, and starts no second download.
    expect(launch("hook", JSON.stringify({ hook_event_name: "Stop", session_id: "s1" })).stdout).toBe("");

    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(requests).toBe(1);
    expect(existsSync(failed())).toBe(false);
    expect(readdirSync(join(data, "bin")).filter((n) => n.startsWith(".partial"))).toEqual([]);

    // From now on the launcher runs it, mode first, the rest as given.
    const next = launch("hook", sessionStart("s2"));
    expect(next.stdout).toBe("fake counterparts hook\n");
    expect(launch("cli", "").stdout).toBe("fake counterparts cli\n");
    expect(requests).toBe(1);
  });

  test("/counterparts:doctor, through the Bash tool with no CLAUDE_PLUGIN_DATA, still finds the binary", async () => {
    plugin();
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    const e = env();
    delete e["CLAUDE_PLUGIN_DATA"];
    expect(launch("cli", "", e).stdout).toBe("fake counterparts cli\n");
  });

  test("the hook and the server starting together download once", async () => {
    plugin();
    hold = Bun.sleep(400);
    const go = (mode: string, input: string): Promise<void> =>
      new Promise((done) => {
        const child = spawn("/bin/sh", [join(pluginRoot, "src", "adapters", "plugin-run.sh"), mode], { env: env(), stdio: ["pipe", "ignore", "ignore"] });
        child.stdin.end(input);
        child.on("close", () => done());
      });
    await Promise.all([go("hook", sessionStart()), go("mcp", ""), go("hook", sessionStart("s3"))]);
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(requests).toBe(1);
  });

  test("while it downloads, the server answers with no tools and says why", () => {
    plugin();
    mkdirSync(lock(), { recursive: true }); // a download in flight
    try {
      const rpc = [
        JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "t" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: "two", method: "tools/list" }),
        // An "id" inside the params, in both key orders: the MCP SDK's
        // (method, params, jsonrpc, id) and the hand-written one.
        '{"method":"tools/call","params":{"name":"recall","arguments":{"id":7}},"jsonrpc":"2.0","id":3}',
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "recall", arguments: { id: 8 } } }),
      ].join("\n");
      const r = launch("mcp", `${rpc}\n`);
      expect(r.code).toBe(0);
      const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, any>);
      expect(lines).toHaveLength(4);
      expect(lines[0]?.id).toBe(0);
      expect(lines[0]?.result.protocolVersion).toBe("2025-06-18");
      expect(lines[0]?.result.serverInfo).toEqual({ name: "counterparts", version: VERSION });
      expect(lines[0]?.result.instructions).toContain("downloading its program");
      expect(lines[1]).toEqual({ jsonrpc: "2.0", id: "two", result: { tools: [] } });
      expect(lines[2]?.id).toBe(3);
      expect(lines[2]?.error.message).toContain("next session");
      expect(lines[3]?.id).toBe(4);
      expect(requests).toBe(0);
    } finally {
      rmSync(lock(), { recursive: true, force: true });
    }
  });

  test("a program that does not match its checksum is deleted, never run, said once, and retried after ten minutes", async () => {
    plugin({ rawSha: "0".repeat(64) });
    expect(message(launch("hook", sessionStart()).stdout)).toContain("getting ready");
    expect(await until(() => existsSync(failed()) && !existsSync(lock()))).toBe(true);
    expect(existsSync(bin())).toBe(false);
    expect(readdirSync(join(data, "bin")).filter((n) => n.startsWith(".partial"))).toEqual([]);

    const again = message(launch("hook", sessionStart("s2")).stdout);
    expect(again).toContain("could not get its program ready: the program did not match the checksum the plugin carries");
    expect(again).toContain("Nothing unchecked was run");
    expect(requests).toBe(1);

    // Ten minutes on, a start tries again.
    const old = new Date(Date.now() - 11 * 60_000);
    utimesSync(failed(), old, old);
    expect(message(launch("hook", sessionStart("s3")).stdout)).toContain("getting ready");
    expect(await until(() => requests === 2 && !existsSync(lock()))).toBe(true);
  });

  test("what it keeps, only this user can enter, and a full check is stamped beside it", async () => {
    plugin();
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(statSync(join(data, "bin")).mode & 0o077).toBe(0);
    expect(statSync(join(data, "bin", VERSION)).mode & 0o077).toBe(0);
    expect(statSync(bin()).mode & 0o777).toBe(0o700);
    const st = statSync(bin());
    expect(readFileSync(verified(), "utf8")).toBe(`${sha(FAKE)} ${String(st.ino)} ${String(st.size)} ${String(Math.floor(st.mtimeMs / 1000))}\n`);
  });

  test("directories that were already there, open to others, are closed: by the download, and by a full check of a kept program", async () => {
    plugin();
    const dirs = [join(data, "bin"), join(data, "bin", VERSION)];
    for (const d of dirs) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, 0o755);
    }
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    for (const d of dirs) expect(statSync(d).mode & 0o077).toBe(0);

    for (const d of dirs) chmodSync(d, 0o755);
    expect(launch("mcp", "").stdout).toBe("fake counterparts mcp\n"); // the server's start: a full check
    for (const d of dirs) expect(statSync(d).mode & 0o077).toBe(0);
  });

  test("paths with spaces (and a backslash), and a host PATH without /usr/sbin: this computer's own program, found and checked", async () => {
    pluginRoot = join(work, "my plugin");
    data = join(work, "home", "Application Support", "data \\ dir");
    plugin();
    const e = env({ PATH: "/usr/bin:/bin" });
    expect(message(launch("hook", sessionStart(), e).stdout)).toContain("getting ready");
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(asked).toEqual([`/${assetName(VERSION, hostPlatform())}`]);
    expect(launch("hook", sessionStart("s2"), e).stdout).toBe("fake counterparts hook\n");
    expect(launch("mcp", "", e).stdout).toBe("fake counterparts mcp\n");
    expect(requests).toBe(1);
  });

  test("a partial download whose process still runs is left to it; one whose process is gone is swept", async () => {
    plugin();
    const live = join(data, "bin", `.partial-${VERSION}-${String(process.pid)}`);
    const dead = join(data, "bin", `.partial-9.9.8-99999`);
    for (const d of [live, dead]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "download.gz"), "half");
    }
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(existsSync(join(live, "download.gz"))).toBe(true);
    expect(existsSync(dead)).toBe(false);
  });

  test("a kept program that changed is never run: it is deleted and fetched again", async () => {
    plugin();
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    appendFileSync(bin(), "echo tampered\n");

    const r = launch("hook", sessionStart("s2"));
    expect(r.stdout).not.toContain("fake counterparts");
    expect(r.stdout).not.toContain("tampered");
    expect(message(r.stdout)).toContain("getting ready");
    expect(await until(() => requests === 2 && existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(launch("hook", sessionStart("s3")).stdout).toBe("fake counterparts hook\n");
  });

  test("the server's start re-hashes the whole file, even when its size and dates were kept", async () => {
    plugin();
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    const before = statSync(bin());
    // Same length, same inode, mtime put back: only the bytes differ.
    writeFileSync(bin(), FAKE.replace("fake", "evil"));
    utimesSync(bin(), before.atime, before.mtime);

    const r = launch("mcp", "");
    expect(r.stdout).not.toContain("evil");
    expect(existsSync(bin())).toBe(false);
    expect(await until(() => requests === 2 && existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(launch("mcp", "").stdout).toBe("fake counterparts mcp\n");
  });

  test("a stamp for another checksum, or a day old, sends a hook through the full check", async () => {
    plugin();
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    const good = readFileSync(verified(), "utf8");

    writeFileSync(verified(), good.replace(sha(FAKE), "0".repeat(64)));
    expect(launch("hook", sessionStart("s2")).stdout).toBe("fake counterparts hook\n");
    expect(readFileSync(verified(), "utf8")).toBe(good);

    const old = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(verified(), old, old);
    expect(launch("cli", "").stdout).toBe("fake counterparts cli\n");
    expect(statSync(verified()).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
    expect(requests).toBe(1);
  });

  test("a redirect to plain HTTP is refused, and what a killed download left is cleared", async () => {
    plugin();
    // What a download killed mid-transfer leaves: never executable, swept by the next one.
    const dead = join(data, "bin", `.partial-${VERSION}-99999`);
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, "download.gz"), "half");
    redirect = `http://127.0.0.1:${String(server?.port)}/elsewhere/asset.gz`;
    launch("hook", sessionStart());
    expect(await until(() => existsSync(failed()) && !existsSync(lock()))).toBe(true);
    expect(readFileSync(failed(), "utf8")).toContain("the download from GitHub failed");
    expect(requests).toBe(1); // the redirect was not followed
    expect(existsSync(bin())).toBe(false);
    expect(readdirSync(join(data, "bin")).filter((n) => n.startsWith(".partial"))).toEqual([]);
  });

  test("another version's program, not started for a week, is cleared when a new one lands", async () => {
    plugin();
    const stale = join(data, "bin", "9.9.7");
    const recent = join(data, "bin", "9.9.8");
    for (const d of [stale, recent]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "counterparts"), FAKE);
      writeFileSync(join(d, "verified"), "x\n");
    }
    const weekAgo = new Date(Date.now() - 8 * 24 * 3_600_000);
    utimesSync(join(stale, "verified"), weekAgo, weekAgo);
    launch("hook", sessionStart());
    expect(await until(() => existsSync(bin()) && !existsSync(lock()))).toBe(true);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(recent, "counterparts"))).toBe(true);
  });

  test("COUNTERPARTS_BINARY_DOWNLOAD=off: the old message, and nothing is fetched", async () => {
    plugin();
    const r = launch("hook", sessionStart(), env({ COUNTERPARTS_BINARY_DOWNLOAD: "off" }));
    expect(message(r.stdout)).toContain("needs Bun 1.3+ or Node.js 22.15+");
    expect(message(r.stdout)).toContain("COUNTERPARTS_BINARY_DOWNLOAD is off");
    await Bun.sleep(300);
    expect(requests).toBe(0);
    expect(existsSync(join(data, "bin"))).toBe(false);
  });

  test("checksums for another version are not used", async () => {
    plugin({ manifestVersion: "9.9.8" });
    const r = launch("hook", sessionStart());
    expect(message(r.stdout)).toContain(`no prebuilt program was published for version ${VERSION}`);
    await Bun.sleep(300);
    expect(requests).toBe(0);
  });

  test("a plugin with no binaries.json keeps the old message", () => {
    plugin();
    rmSync(join(pluginRoot, ".claude-plugin", "binaries.json"));
    const r = launch("hook", sessionStart());
    expect(message(r.stdout)).toContain("this version of the plugin carries no prebuilt program");
    expect(launch("mcp", "").code).toBe(127);
  });
});
