/**
 * THE REAL BINARY THROUGH THE REAL LAUNCHER (docs/single-binary.md).
 *
 *   ~/.bun/bin/bun tools/single-binary/launcher-e2e.ts <dir holding counterparts-<v>-<platform> and its .gz>
 *
 * A throwaway plugin root (this checkout's `plugin-run.sh` and `plugin.json`,
 * and a `binaries.json` written for the built binary by `build.ts`'s own
 * writer), a throwaway HOME and plugin data directory, NO runtime for the
 * launcher to find, and a local HTTP server standing in for the GitHub
 * release. Then, through `sh plugin-run.sh` only: the first SessionStart
 * (getting ready), the download landing and verified, the console's install,
 * a SessionStart that wakes, and the memory server's note and recall. Every
 * process gets `COUNTERPARTS_REQUIRE_EXPLICIT_DIR=1` and names its store; the
 * temp directory is removed at the end. Exit 0 when every step passed.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import { assetName, binariesJson, hostPlatform } from "./build.js";

const REPO = resolve(import.meta.dir, "../..");
const dir = resolve(process.argv[2] ?? "");
const version = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version;
const platform = hostPlatform();
const exe = platform.startsWith("windows") ? ".exe" : "";
const file = join(dir, `counterparts-${version}-${platform}${exe}`);
const gzFile = join(dir, assetName(version, platform));
if (!existsSync(file) || !existsSync(gzFile)) throw new Error(`no ${file} and ${gzFile}; run build.ts first`);

const work = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "counterparts-launcher-e2e-"));
if (process.env["HOME"] !== undefined && work.startsWith(`${process.env["HOME"]}/`)) throw new Error(`refused: ${work} is inside the real home`);
const pluginRoot = join(work, "plugin");
const home = join(work, "home");
const data = join(home, ".claude", "plugins", "data", "counterparts-counterparts");
const project = join(home, "project");
const cfg = join(home, "cp", "claude-code.json");
const store = join(home, "cp", "store");
mkdirSync(join(pluginRoot, "src", "adapters"), { recursive: true });
mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
mkdirSync(project, { recursive: true });
copyFileSync(join(REPO, "src", "adapters", "plugin-run.sh"), join(pluginRoot, "src", "adapters", "plugin-run.sh"));
copyFileSync(join(REPO, ".claude-plugin", "plugin.json"), join(pluginRoot, ".claude-plugin", "plugin.json"));
const raw = readFileSync(file);
const gz = readFileSync(gzFile);
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
writeFileSync(
  join(pluginRoot, ".claude-plugin", "binaries.json"),
  binariesJson(version, [
    { platform, file: `counterparts-${version}-${platform}${exe}`, asset: assetName(version, platform), bytes: raw.length, sha256: sha(raw), gzBytes: gz.length, gzSha256: sha(gz) },
  ]),
);

let requests = 0;
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => {
    requests += 1;
    return new URL(req.url).pathname.endsWith(`/${assetName(version, platform)}`) ? new Response(Bun.file(gzFile)) : new Response("no", { status: 404 });
  },
});

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  TMPDIR: work,
  CLAUDE_PLUGIN_ROOT: pluginRoot,
  CLAUDE_PLUGIN_DATA: data,
  COUNTERPARTS_RUNTIME: join(work, "no", "bun"),
  COUNTERPARTS_BINARY_URL: `http://127.0.0.1:${String(server.port)}`,
  COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
  ...extra,
});
const launcher = join(pluginRoot, "src", "adapters", "plugin-run.sh");
const launch = (mode: string, args: string[], input: string, extra: Record<string, string> = {}): { code: number | null; out: string; err: string; ms: number } => {
  const t0 = performance.now();
  const r = spawnSync("/bin/sh", [launcher, mode, ...args], { cwd: project, input, env: env(extra), encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: performance.now() - t0 };
};

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (ok) pass += 1;
  else fail += 1;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail.length === 0 ? "" : `\n      ${detail.slice(0, 600).replaceAll("\n", "\n      ")}`}\n`);
};
const payload = (event: string, session: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ hook_event_name: event, session_id: session, cwd: project, transcript_path: join(project, "t.jsonl"), ...extra });

try {
  const first = launch("hook", [], payload("SessionStart", "e2e-1", { source: "startup" }));
  const said = first.out.length > 0 ? (JSON.parse(first.out) as { systemMessage?: string }).systemMessage ?? "" : "";
  check(`first SessionStart says it is getting ready, in ${String(Math.round(first.ms))} ms`, first.code === 0 && said.includes("getting ready") && first.ms < 3000, `${first.out}${first.err}`);

  const bin = join(data, "bin", version, `counterparts${exe}`);
  const end = Date.now() + 120_000;
  while (Date.now() < end && !(existsSync(bin) && !existsSync(join(data, "bin", `download-${version}.lock`)))) await Bun.sleep(100);
  check(
    `the launcher downloaded, verified and kept the binary (${String(requests)} request, ${(statSync(bin, { throwIfNoEntry: false })?.size ?? 0) === raw.length ? "same bytes" : "DIFFERENT bytes"})`,
    existsSync(bin) && requests === 1 && sha(readFileSync(bin)) === sha(raw),
  );

  const install = launch("cli", ["install", "--config", cfg, "--name", "E2E", "--no-connect"], "");
  check("install through the launcher made the store", install.code === 0 && existsSync(join(store, "counterparts.sqlite")) && install.out.includes("nothing to connect"), `${install.out}${install.err}`);

  const wake = launch("hook", [], payload("SessionStart", "e2e-2", { source: "startup" }), { COUNTERPARTS_CONFIG: cfg });
  check(`SessionStart through the launcher wakes from the binary (${String(Math.round(wake.ms))} ms)`, wake.code === 0 && wake.out.includes("Now:"), `${wake.out}${wake.err}`);

  const prompt = launch("hook", [], payload("UserPromptSubmit", "e2e-2", { prompt: "which kettle is in the studio?" }), { COUNTERPARTS_CONFIG: cfg });
  // Its one stderr line is the plugin's own: the downloaded binary knows it
  // is the plugin's (it sits under CLAUDE_PLUGIN_DATA), and skips the first
  // run because a configuration was named.
  check(
    `UserPromptSubmit through the launcher, as the plugin (${String(Math.round(prompt.ms))} ms)`,
    prompt.code === 0 && prompt.err.trim() === "[counterparts] plugin first run skipped: configuration named by COUNTERPARTS_CONFIG",
    prompt.err,
  );

  const rpc = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "note", arguments: { text: "The kettle in the studio is a Fellow Stagg." } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "recall", arguments: { question: "what do we boil water with?", mode: "facts" } } },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n");
  const mcp = launch("mcp", [], `${rpc}\n`, { COUNTERPARTS_CONFIG: cfg, COUNTERPARTS_DATA_DIR: store });
  const recalled = mcp.out.split("\n").find((l) => l.includes('"id":3')) ?? "";
  check("the memory server through the launcher notes, and recalls by meaning", recalled.includes("Fellow Stagg") && recalled.includes('"semantic":"in-line"'), `${mcp.out.slice(0, 400)}${mcp.err}`);
} finally {
  server.stop(true);
  await Bun.sleep(1500); // a worker the Stop-less run may have started
  rmSync(work, { recursive: true, force: true });
}
process.stdout.write(`\n${String(pass)} passed, ${String(fail)} failed\n`);
process.exit(fail === 0 ? 0 : 1);
