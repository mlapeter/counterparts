/**
 * THE CLAUDE.AI TRIAL'S DOOR (2026-10-26): the memory server over HTTP
 * (`adapters/remote/http.ts`), driven through the real socket — `fetch` against
 * a server listening on 127.0.0.1 — never by calling `handle` directly.
 *
 * What is held: initialize, tools/list, a wake, a remember then a recall over
 * HTTP; the secret path (everything else 404, the same body); the method and
 * size refusals; one message at a time when two arrive at once; the canary
 * only in `instructions`; the call log carries no memory text; claude.ai's host
 * survives a client that says `claude-ai`; and the entry point refuses a store
 * or configuration nobody named.
 *
 * Hermetic (CLAUDE.md): a fresh temp directory per test, removed after. No
 * worker is started — every server here is handed a stub spawner — except the
 * one subprocess test, which never calls `wake`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_AI_HOST, CLAUDE_AI_SCOPE, DESKTOP_HOST } from "../src/adapters/hosts.js";
import { CLAUDE_AI_TOOLS, CLAUDE_AI_WAKE, DESKTOP_TOOLS, TOOLS, openServer, renderDescription, toolDefinitions } from "../src/adapters/mcp/index.js";
import type { McpServer } from "../src/adapters/mcp/index.js";
import { CLAUDE_AI_INSTRUCTIONS, DESKTOP_INSTRUCTIONS } from "../src/adapters/mcp/server-words.js";
import { readSession } from "../src/adapters/sessions.js";
import type { SpawnPlan } from "../src/adapters/spawn.js";
import { LOOPBACK, newSecret, serveHttp } from "../src/adapters/remote/http.js";
import type { CallRecord, RunningHttp } from "../src/adapters/remote/http.js";
import { openCallLog, summarizeCalls, summarizeChats } from "../src/adapters/remote/call-log.js";
import { livePathRefusal, liveStoreRefusal, readLaunch } from "../src/adapters/remote/bin/serve-http.js";

const CANARY = "Canary for this trial: the person's imaginary lighthouse is called Quillmere Saffron.";

let root: string;
let dir: string;
const closers: (() => unknown)[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "counterparts-remote-")));
  dir = join(root, "store");
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  rmSync(root, { recursive: true, force: true });
});

function claudeAiServer(): McpServer {
  const s = openServer({
    dir,
    host: CLAUDE_AI_HOST,
    canary: CANARY,
    env: {},
    lifecycle: { spawner: (_plan: SpawnPlan) => ({ pid: 4242 }) },
    manifestVersion: () => null,
  });
  closers.push(() => s.counterpart.close());
  return s;
}

async function door(opts: { maxBodyBytes?: number } = {}): Promise<{ http: RunningHttp; s: McpServer; calls: CallRecord[] }> {
  const s = claudeAiServer();
  const calls: CallRecord[] = [];
  const http = await serveHttp({ server: s, onCall: (r) => calls.push(r), ...opts });
  closers.push(() => http.close());
  return { http, s, calls };
}

let nextId = 1;
async function rpc(url: string, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }),
  });
  const text = await res.text();
  return { status: res.status, body: text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>), headers: res.headers };
}

function result(body: Record<string, unknown>): Record<string, unknown> {
  return body["result"] as Record<string, unknown>;
}

async function tool(url: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await rpc(url, "tools/call", { name, arguments: args });
  expect(out.status).toBe(200);
  return result(out.body)["structuredContent"] as Record<string, unknown>;
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "0.1.0" } };

describe("the HTTP door, through the socket", () => {
  test("binds 127.0.0.1 only, and the URL carries a fresh 192-bit secret", async () => {
    const { http } = await door();
    expect(http.address).toBe(LOOPBACK);
    expect(http.url.startsWith(`http://127.0.0.1:${String(http.port)}/`)).toBe(true);
    const secret = http.url.slice(http.url.lastIndexOf("/") + 1);
    expect(Buffer.from(secret, "base64url").length).toBe(24);
    expect(newSecret()).not.toBe(newSecret());
  });

  test("initialize: JSON, a connection id, claude.ai's instructions with the canary — and a client saying claude-ai does not make it Desktop", async () => {
    const { http, s, calls } = await door();
    const init = await rpc(http.url, "initialize", INIT);
    expect(init.status).toBe(200);
    expect(init.headers.get("content-type")).toBe("application/json");
    expect(init.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    const r = result(init.body);
    expect(r["serverInfo"]).toMatchObject({ name: "counterparts" });
    expect(String(r["instructions"])).toBe(`${CLAUDE_AI_INSTRUCTIONS}\n\n${CANARY}`);
    expect(String(r["instructions"])).not.toContain("Code tab");
    expect(s.host).toBe(CLAUDE_AI_HOST);
    expect(s.clientName).toBe("claude-ai");
    expect(calls[0]).toMatchObject({ method: "initialize", client: "claude-ai", clientVersion: "0.1.0", protocolVersion: "2025-06-18", ok: true, connection: init.headers.get("mcp-session-id") });
  });

  test("a notification is 202 with no body", async () => {
    const { http } = await door();
    const res = await fetch(http.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("tools/list: wake first, every host's tools after it, the canary in no description", async () => {
    const { http } = await door();
    await rpc(http.url, "initialize", INIT);
    const list = result((await rpc(http.url, "tools/list")).body)["tools"] as Record<string, unknown>[];
    expect(list.map((t) => t["name"])).toEqual(["wake", ...TOOLS.map((t) => t.name)]);
    const wake = list[0] as Record<string, unknown>;
    expect(String(wake["description"]).startsWith("Call this first in every conversation.")).toBe(true);
    for (const t of list) {
      const text = JSON.stringify(t);
      expect(text).not.toContain("Quillmere");
      expect(text).not.toContain("Code tab");
    }
  });

  test("a wake, a remember, then a recall — over HTTP, under claude-ai:", async () => {
    const { http, calls } = await door();
    await rpc(http.url, "initialize", INIT);
    const woke = await tool(http.url, "wake", {});
    const session = String(woke["session"]);
    expect(woke).toMatchObject({ host: CLAUDE_AI_HOST, scope: CLAUDE_AI_SCOPE });
    expect(readSession(dir, session)).toMatchObject({ host: CLAUDE_AI_HOST, scope: CLAUDE_AI_SCOPE });
    const noted = await tool(http.url, "remember", { session, text: "They keep a fern named Gustav zqfernwick on the kitchen windowsill." });
    expect(noted["stored"]).toBe(true);
    expect(noted["boundTo"]).toBeUndefined();
    expect(noted["sessionRefused"]).toBeUndefined();
    const found = await tool(http.url, "recall", { session, question: "zqfernwick", mode: "facts" });
    expect(JSON.stringify(found)).toContain("Gustav");
    // The call log: ids and codes, the minted session on the wake, no memory text.
    const tools = calls.filter((c) => c.method === "tools/call");
    expect(tools.map((c) => [c.tool, c.ok, c.session])).toEqual([
      ["wake", true, session],
      ["remember", true, session],
      ["recall", true, session],
    ]);
    expect(JSON.stringify(calls)).not.toContain("Gustav");
    expect(JSON.stringify(calls)).not.toContain(http.url.slice(http.url.lastIndexOf("/") + 1));
  });

  test("a night through the tools alone: the dream's launch prompt names only tools this door offers", async () => {
    const { http } = await door();
    await rpc(http.url, "initialize", INIT);
    const offered = new Set((result((await rpc(http.url, "tools/list")).body)["tools"] as Record<string, unknown>[]).map((t) => String(t["name"])));
    const session = String((await tool(http.url, "wake", {}))["session"]);
    const launched = await tool(http.url, "dream", { phase: "launch", session });
    const prompt = String(launched["prompt"]);
    expect(prompt.length).toBeGreaterThan(200);
    const named = new Set([...prompt.matchAll(/counterparts (\w+) tool|the (\w+) tool/g)].map((m) => m[1] ?? m[2]));
    for (const name of ["dream", "reflect"]) expect(named.has(name)).toBe(true);
    for (const name of named) if (name !== undefined && /^[a-z_]+$/.test(name)) expect({ name, offered: offered.has(name) }).toEqual({ name, offered: true });
    // Its first step answers over the same door.
    const writer = await rpc(http.url, "tools/call", { name: "dream", arguments: { phase: "writer", session } });
    expect(writer.status).toBe(200);
  });

  test("a session from another conversation's id that is not claude.ai's is refused in claude.ai's words", async () => {
    const { http } = await door();
    await rpc(http.url, "initialize", INIT);
    const noted = await tool(http.url, "remember", { session: "00000000-0000-4000-8000-000000000000", text: "A note under an id nobody minted." });
    expect(noted["sessionRefused"]).toBe("session-unknown");
    expect(String(noted["sessionNote"])).toContain("No claude.ai session by that id is recorded.");
    expect(String(noted["sessionNote"])).toContain("under claude.ai's place (claude-ai:)");
    expect(String(noted["sessionNote"])).not.toContain("Desktop");
  });

  test("every other path is the same 404 — any method, a prefix of the secret, the secret plus more, .well-known", async () => {
    const { http } = await door();
    const base = `http://127.0.0.1:${String(http.port)}`;
    const secret = http.url.slice(http.url.lastIndexOf("/") + 1);
    const wrong = ["/", "/mcp", `/${secret.slice(0, -1)}`, `/${secret}x`, `/${secret}/mcp`, "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];
    for (const path of wrong) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const res = await fetch(`${base}${path}`, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) });
        expect({ path, method, status: res.status }).toEqual({ path, method, status: 404 });
        expect(await res.text()).toBe("Not found\n");
      }
    }
    // The secret path itself answers POST only.
    expect((await fetch(http.url)).status).toBe(405);
    expect((await fetch(http.url, { method: "DELETE" })).status).toBe(405);
    // A trailing slash is the same path.
    expect((await rpc(`${http.url}/`, "ping")).status).toBe(200);
  });

  test("a body that is not JSON is 400; one past the cap is 413", async () => {
    const { http } = await door({ maxBodyBytes: 2_000 });
    const bad = await fetch(http.url, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700);
    const big = await fetch(http.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(10_000) } }) }).catch(() => null);
    if (big !== null) expect(big.status).toBe(413);
  });

  test("two calls at once are served one at a time: each lands under the session it named", async () => {
    const { http } = await door();
    await rpc(http.url, "initialize", INIT);
    const a = String((await tool(http.url, "wake", {}))["session"]);
    const b = String((await tool(http.url, "wake", {}))["session"]);
    const both = await Promise.all([
      tool(http.url, "remember", { session: a, text: "Conversation A's own note about the blue kettle." }),
      tool(http.url, "remember", { session: b, text: "Conversation B's own note about the red bicycle." }),
      tool(http.url, "status", { session: a }),
      tool(http.url, "status", { session: b }),
    ]);
    for (const out of both) expect(out["sessionRefused"]).toBeUndefined();
    expect(both[0]?.["stored"]).toBe(true);
    expect(both[1]?.["stored"]).toBe(true);
    expect(readSession(dir, a)?.desk?.calls).toBe(2);
    expect(readSession(dir, b)?.desk?.calls).toBe(2);
  });

  test("the transport never hands the server a second message while one is in flight", async () => {
    let inFlight = 0;
    let most = 0;
    const slow = {
      async handle(request: { id?: string | number }): Promise<{ jsonrpc: string; id: string | number; result: Record<string, unknown> }> {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight -= 1;
        return { jsonrpc: "2.0", id: request.id ?? 0, result: {} };
      },
    };
    const http = await serveHttp({ server: slow });
    closers.push(() => http.close());
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => rpc(http.url, "ping")));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200, 200]);
    expect(most).toBe(1);
  });

  test("a throw inside the server answers 'internal error', never its message (it could name a path)", async () => {
    const throwing = {
      async handle(): Promise<never> {
        throw new Error("ENOENT: no such file, open '/Users/someone/counterparts-trials/claude-ai/store/x'");
      },
    };
    const http = await serveHttp({ server: throwing });
    closers.push(() => http.close());
    const out = await rpc(http.url, "ping");
    expect(out.status).toBe(200);
    expect(out.body["error"]).toEqual({ code: -32603, message: "internal error" });
    expect(JSON.stringify(out.body)).not.toContain("/Users/");
  });

  test("a batch (2025-03-26) is answered as an array, notifications left out", async () => {
    const { http } = await door();
    const res = await fetch(http.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: INIT },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number }[];
    expect(body.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("claude.ai's tools and words", () => {
  test("the claude.ai list is its own; Desktop's and Claude Code's are unchanged", () => {
    expect(toolDefinitions(CLAUDE_AI_HOST).map((t) => t["name"])).toEqual(CLAUDE_AI_TOOLS.map((t) => t.name));
    expect(toolDefinitions(DESKTOP_HOST)).toEqual(toolDefinitions(true));
    expect(toolDefinitions("claude-code")).toEqual(toolDefinitions(false));
    expect(DESKTOP_TOOLS.at(-1)?.name).toBe("wake");
    expect(CLAUDE_AI_TOOLS[0]).toBe(CLAUDE_AI_WAKE);
    expect(renderDescription(CLAUDE_AI_WAKE)).toContain("remember what matters as it comes up");
    expect(DESKTOP_INSTRUCTIONS).toContain("Code tab");
  });

  test("no tool carries an annotation that asks for a person (a scheduled task skips those)", () => {
    for (const spec of CLAUDE_AI_TOOLS) {
      expect(Object.keys(spec.annotations).sort()).toEqual(["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint", "title"]);
    }
  });
});

describe("the call log", () => {
  test("appends JSON lines and reads back per connection: wake first or not", () => {
    const path = join(root, "calls.jsonl");
    const log = openCallLog(path);
    const at = new Date().toISOString();
    log.write({ at, method: "initialize", connection: "c1", ok: true, ms: 1, client: "claude-ai" });
    log.write({ at, method: "tools/call", tool: "wake", connection: "c1", session: "s1", ok: true, ms: 3 });
    log.write({ at, method: "tools/call", tool: "remember", connection: "c1", session: "s1", ok: true, ms: 3 });
    log.write({ at, method: "initialize", connection: "c2", ok: true, ms: 1, client: "claude-ai" });
    log.write({ at, method: "tools/call", tool: "recall", connection: "c2", ok: false, reason: "mode-required", ms: 2 });
    const summary = summarizeCalls(path);
    expect(summary.map((c) => [c.connection, c.wokeFirst, c.remembered, c.errors, c.client])).toEqual([
      ["c1", true, 1, 0, "claude-ai"],
      ["c2", false, 0, 1, "claude-ai"],
    ]);
    expect((readFileSync(path, "utf8").match(/\n/g) ?? []).length).toBe(5);
  });

  test("per chat, through the door (OL1b): one connection, two chats keyed by the session wake minted; calls that named none counted apart", async () => {
    const path = join(root, "calls.jsonl");
    const log = openCallLog(path);
    const s = claudeAiServer();
    const http = await serveHttp({ server: s, onCall: (r) => log.write(r) });
    closers.push(() => http.close());
    const init = await rpc(http.url, "initialize", INIT);
    const conn = { "mcp-session-id": String(init.headers.get("mcp-session-id")) };
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
      result((await rpc(http.url, "tools/call", { name, arguments: args }, conn)).body)["structuredContent"] as Record<string, unknown>;
    // A chat that asks before it wakes: no session named, before any wake.
    await call("status", {});
    const a = String((await call("wake", {}))["session"]);
    await call("remember", { session: a, text: "The greenhouse vents open at nine.", kind: "fact" });
    await call("chapter", { session: a, text: "We talked about the greenhouse vents and settled on nine." });
    // A second chat on the SAME connection, as claude.ai does it.
    const b = String((await call("wake", {}))["session"]);
    expect(b).not.toBe(a);
    await call("remember", { session: b, text: "The cellar door sticks in the rain.", kind: "fact" });
    await call("remember", { text: "The cellar key hangs by the stove.", kind: "fact" });

    const report = summarizeChats(path);
    expect(report.clients).toEqual(["claude-ai"]);
    expect(report.chats.map((c) => [c.session, c.woke, c.tools, c.remembered, c.chapter])).toEqual([
      [a, true, ["wake", "remember", "chapter"], 1, true],
      [b, true, ["wake", "remember"], 1, false],
    ]);
    expect(new Set(report.chats.map((c) => c.connection)).size).toBe(1);
    expect(report.unnamed).toEqual([{ connection: conn["mcp-session-id"], calls: 2, beforeWake: 1, tools: ["status", "remember"], errors: 0 }]);
    // The old per-connection view sees one row for both chats.
    expect(summarizeCalls(path)).toHaveLength(1);
    // And the trial's own reader prints it.
    const out = await new Promise<string>((resolveRun) => {
      const child = spawn(process.execPath, [join(import.meta.dir, "..", "tools", "trials", "claude-ai", "report.ts"), path], { stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d: Buffer) => (text += d.toString()));
      child.on("close", () => resolveRun(text));
    });
    expect(out).toContain("2 chats; 2 woke in this log.");
    expect(out).toContain("2 calls, 1 before any wake on it");
    expect(out).toContain(a.slice(0, 8));
    expect(out).not.toContain("greenhouse");
  });
});

describe("the entry point's refusals", () => {
  test("no --dir is refused; a live store is refused by name", () => {
    expect(readLaunch([])).toHaveProperty("refusal");
    expect(String((readLaunch(["--port", "1"]) as { refusal: string }).refusal)).toContain("--dir");
    const home = join(root, "home");
    for (const live of [".counterparts", ".counterparts/store"]) {
      expect(liveStoreRefusal(join(home, live), home)).toContain("live store");
    }
    // The ancestors' stores, refused by the store seam's own list (under the run's home).
    for (const live of [".bansai", ".claude-engram/x"]) {
      expect(liveStoreRefusal(join(homedir(), live))).toContain("off-limits");
    }
    expect(liveStoreRefusal(join(home, "counterparts-trials", "claude-ai"), home)).toBeNull();
    // As the disk resolves it (review of #634): a `..`, or a symlink into the live store.
    expect(liveStoreRefusal(join(home, "counterparts-trials", "..", ".counterparts", "store"), home)).toContain("live store");
    mkdirSync(join(home, ".counterparts"), { recursive: true });
    symlinkSync(join(home, ".counterparts"), join(home, "trial-link"));
    expect(liveStoreRefusal(join(home, "trial-link", "store"), home)).toContain("live store");
    expect(liveStoreRefusal(join(home, "trial-link"), home)).toContain("live store");
    // The configuration's folder and its snapshots folder are held the same way.
    expect(livePathRefusal(join(home, ".counterparts"), "the configuration", home)).toContain("inside a live store");
    expect(livePathRefusal(join(home, "trial-link", "snapshots"), "the snapshots folder", home)).toContain("inside a live store");
    expect(livePathRefusal(join(home, "counterparts-trials", "claude-ai"), "the configuration", home)).toBeNull();
    expect(readLaunch(["--dir", join(root, "s"), "--port", "99999"])).toHaveProperty("refusal");
    expect(readLaunch(["--dir", join(root, "s"), "--canary", "  x  "])).toMatchObject({ dir: join(root, "s"), port: 0, canary: "x" });
  });

  const BIN = join(import.meta.dir, "..", "src", "adapters", "remote", "bin", "serve-http.ts");

  function launch(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; err: string; firstLine: string }> {
    return new Promise((resolveRun) => {
      const child = spawn(process.execPath, [BIN, ...args], {
        env: { PATH: process.env["PATH"] ?? "", COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      let firstLine = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        if (firstLine === "" && out.includes("\n")) {
          firstLine = out.slice(0, out.indexOf("\n"));
          child.kill("SIGTERM");
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveRun({ code, out, err, firstLine });
      });
    });
  }

  test("the process: refuses without --dir, refuses without --config, and with both prints one url line on 127.0.0.1", async () => {
    const noDir = await launch([]);
    expect(noDir.code).toBe(1);
    expect(noDir.out).toBe("");
    expect(noDir.err).toContain("--dir");
    const noConfig = await launch(["--dir", dir]);
    expect(noConfig.code).toBe(1);
    expect(noConfig.out).toBe("");
    expect(noConfig.err).toContain("--config");
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ dataDir: dir, snapshots: { dir: join(root, "snapshots") } }));
    const ok = await launch(["--dir", dir, "--config", config, "--call-log", join(root, "calls.jsonl")]);
    expect(ok.firstLine).toMatch(/^url http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32}$/);
    // The secret is on stdout's one line and nowhere on stderr.
    expect(ok.err).not.toContain(ok.firstLine.slice(ok.firstLine.lastIndexOf("/") + 1));
    expect(ok.code).toBe(0);
  }, 60_000);

  test("the process: a configuration in a live store, or one naming its snapshots folder, is refused before a byte is served", async () => {
    // A HOME of the test's own (hermetic): its `.counterparts` stands for the owner's.
    const home = join(root, "home");
    const live = join(home, ".counterparts");
    mkdirSync(live, { recursive: true });
    const inLive = join(live, "trial.json");
    writeFileSync(inLive, JSON.stringify({ dataDir: dir }));
    const refusedConfig = await launch(["--dir", dir, "--config", inLive], { HOME: home });
    expect(refusedConfig.code).toBe(1);
    expect(refusedConfig.out).toBe("");
    expect(refusedConfig.err).toContain("the configuration is inside a live store");
    const snapping = join(root, "trial.json");
    writeFileSync(snapping, JSON.stringify({ dataDir: dir, snapshots: { dir: join(live, "snapshots") } }));
    const refusedSnapshots = await launch(["--dir", dir, "--config", snapping], { HOME: home });
    expect(refusedSnapshots.code).toBe(1);
    expect(refusedSnapshots.out).toBe("");
    expect(refusedSnapshots.err).toContain("snapshots folder is inside a live store");
  }, 60_000);
});
