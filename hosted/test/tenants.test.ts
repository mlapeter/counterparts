/**
 * OL2 step 2: many stores behind one door, driven through the real socket
 * (`fetch` against the hosted server on 127.0.0.1), plus the tenant registry
 * and the worker pool. Cross-tenant attempts are made ON PURPOSE.
 *
 * Auth here is a test map of tokens to callers (the composition seam the OAuth
 * step fills in); the tokens are generated per test, nothing is a fixture.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";

import { scriptArgs } from "../../src/adapters/runtime.js";
import type { SpawnPlan } from "../../src/adapters/spawn.js";
import { createHostedServer, resourceMetadataUrl } from "../src/server.js";
import type { Caller, HostedCallRecord } from "../src/server.js";
import { STORE_ID, Tenants, tenantDir, workerEnv, workerPool } from "../src/tenants.js";
import { listen, rpc, storeId, tempRoot, tool } from "./helpers.js";

const ORIGIN = "https://app.counterparts.ai";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("tenants");
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* already closed */
    }
  }
  tmp.remove();
});

const stubSpawner = (): { plans: SpawnPlan[]; spawner: (p: SpawnPlan) => { pid: number } } => {
  const plans: SpawnPlan[] = [];
  return { plans, spawner: (p) => (plans.push(p), { pid: 4242 }) };
};

interface Rig {
  url: string;
  tenants: Tenants;
  tokens: Record<"a" | "b", string>;
  callers: Record<"a" | "b", Caller>;
  calls: HostedCallRecord[];
  plans: SpawnPlan[];
}

async function rig(opts: { maxOpen?: number; allowedOrigins?: string[] } = {}): Promise<Rig> {
  const stub = stubSpawner();
  const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: stub.spawner, ...(opts.maxOpen === undefined ? {} : { maxOpen: opts.maxOpen }) });
  closers.push(() => tenants.closeAll());
  const callers = {
    a: { personId: "person-a", storeId: storeId(), timeZone: "America/Denver" },
    b: { personId: "person-b", storeId: storeId(), timeZone: "Pacific/Kiritimati" },
  };
  const tokens = { a: randomBytes(24).toString("base64url"), b: randomBytes(24).toString("base64url") };
  const map = new Map<string, Caller>([
    [tokens.a, callers.a],
    [tokens.b, callers.b],
  ]);
  const calls: HostedCallRecord[] = [];
  const server = createHostedServer({
    tenants,
    publicOrigin: ORIGIN,
    authenticate: async (t) => map.get(t) ?? null,
    onCall: (r) => calls.push(r),
    ...(opts.allowedOrigins === undefined ? {} : { allowedOrigins: opts.allowedOrigins }),
  });
  const { base, close } = await listen(server);
  closers.push(close);
  return { url: `${base}/mcp`, tenants, tokens, callers, calls, plans: stub.plans };
}

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

describe("the gate", () => {
  test("no token: 401 with the resource-metadata pointer claude.ai follows; a token nobody issued: 401 invalid_token", async () => {
    const r = await rig();
    const none = await rpc(r.url, "tools/list");
    assert.equal(none.status, 401);
    assert.equal(none.headers.get("www-authenticate"), `Bearer resource_metadata="${resourceMetadataUrl(ORIGIN)}"`);
    const forged = await rpc(r.url, "tools/list", undefined, auth(randomBytes(24).toString("base64url")));
    assert.equal(forged.status, 401);
    assert.match(String(forged.headers.get("www-authenticate")), /error="invalid_token"/);
    // A token in the query string is not a token.
    const res = await fetch(`${r.url}?access_token=${r.tokens.a}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
    assert.equal(r.tenants.size, 0);
  });

  test("method, origin and content type are refused before any store opens", async () => {
    const r = await rig({ allowedOrigins: ["https://inspector.example"] });
    assert.equal((await fetch(r.url, { headers: auth(r.tokens.a) })).status, 405);
    assert.equal((await fetch(r.url, { method: "DELETE", headers: auth(r.tokens.a) })).status, 405);
    const evil = await rpc(r.url, "tools/list", undefined, { ...auth(r.tokens.a), origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    const fine = await rpc(r.url, "tools/list", undefined, { ...auth(r.tokens.a), origin: "https://inspector.example" });
    assert.equal(fine.status, 200);
    const simple = await fetch(r.url, { method: "POST", headers: { ...auth(r.tokens.b), "content-type": "text/plain" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(simple.status, 415);
    assert.equal(r.tenants.isOpen(r.callers.b.storeId), false);
  });

  test("/mcp/ is /mcp (no redirect); health answers; everything else is 404", async () => {
    const r = await rig();
    const slash = await rpc(`${r.url}/`, "tools/list", undefined, auth(r.tokens.a));
    assert.equal(slash.status, 200);
    const base = r.url.slice(0, -"/mcp".length);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/mcp/x`)).status, 404);
    assert.equal((await fetch(`${base}/${r.callers.a.storeId}/mcp`, { method: "POST" })).status, 404);
  });
});

describe("two people, two stores, one door", () => {
  test("each token reaches its own store; A's words, session and memory ids are nothing in B", async () => {
    const r = await rig();
    const wakeA = await tool(r.url, "wake", {}, auth(r.tokens.a));
    const sessionA = String(wakeA["session"]);
    assert.ok(sessionA.length > 0);
    const saved = await tool(r.url, "remember", { session: sessionA, text: "A keeps bees on a rooftop in Ogden, and names the queen Marigold." }, auth(r.tokens.a));
    assert.notEqual(saved["stored"], false);
    const own = await rpc(r.url, "tools/call", { name: "recall", arguments: { session: sessionA, question: "rooftop bees", mode: "facts" } }, auth(r.tokens.a));
    assert.match(JSON.stringify(own.body), /Marigold/);

    // B, naming A's session and asking A's question.
    const crossed = await rpc(r.url, "tools/call", { name: "recall", arguments: { session: sessionA, question: "rooftop bees", mode: "facts" } }, auth(r.tokens.b));
    assert.equal(crossed.status, 200);
    assert.doesNotMatch(JSON.stringify(crossed.body), /Marigold|Ogden/);
    // B's own wake mints B's session, never A's.
    const wakeB = await tool(r.url, "wake", {}, auth(r.tokens.b));
    assert.notEqual(String(wakeB["session"]), sessionA);
    // Every memory id A can see, asked for by id from B: not found.
    const ids = [...JSON.stringify(own.body).matchAll(/\b(mem_[A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
    for (const id of new Set(ids)) {
      const byId = await rpc(r.url, "tools/call", { name: "recall", arguments: { session: String(wakeB["session"]), ids: [id] } }, auth(r.tokens.b));
      assert.doesNotMatch(JSON.stringify(byId.body), /Marigold/);
    }
    // Two directories, under the root, named by the ids.
    const dirA = tenantDir(r.tenants.root, r.callers.a.storeId);
    const dirB = tenantDir(r.tenants.root, r.callers.b.storeId);
    assert.ok(existsSync(join(dirA, "store")) && existsSync(join(dirB, "store")));
    assert.doesNotMatch(readFileSync(join(dirB, "store", "counterparts.sqlite")).toString("latin1"), /Marigold/);
  });

  test("calls for A and B run side by side; the call log tags stores without naming them, and holds no words", async () => {
    const r = await rig();
    const [a, b] = await Promise.all([tool(r.url, "wake", {}, auth(r.tokens.a)), tool(r.url, "wake", {}, auth(r.tokens.b))]);
    await Promise.all([
      tool(r.url, "remember", { session: String(a["session"]), text: "The lighthouse keeper is named Quillmere." }, auth(r.tokens.a)),
      tool(r.url, "remember", { session: String(b["session"]), text: "The orchard has forty-one pear trees." }, auth(r.tokens.b)),
    ]);
    const tags = new Set(r.calls.map((c) => c.store));
    assert.equal(tags.size, 2);
    const log = JSON.stringify(r.calls);
    assert.doesNotMatch(log, /Quillmere|pear trees/);
    assert.ok(!log.includes(r.callers.a.storeId) && !log.includes(r.callers.b.storeId));
    assert.ok(!log.includes(r.tokens.a) && !log.includes(r.tokens.b));
  });

  test("the synthesized configuration: the store dir and the person's zone, 0600, beside the store", async () => {
    const r = await rig();
    await tool(r.url, "wake", {}, auth(r.tokens.b));
    const dir = tenantDir(r.tenants.root, r.callers.b.storeId);
    const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(config, { dataDir: join(dir, "store"), timeZone: "Pacific/Kiritimati", updateCheck: false });
    assert.equal(statSync(join(dir, "config.json")).mode & 0o777, 0o600);
  });

  test("a wake's worker is planned for the caller's store, with that store's configuration", async () => {
    const r = await rig();
    await tool(r.url, "wake", {}, auth(r.tokens.a));
    assert.ok(r.plans.length >= 1);
    const plan = r.plans.at(-1)!;
    const dir = tenantDir(r.tenants.root, r.callers.a.storeId);
    assert.equal(plan.env["COUNTERPARTS_DATA_DIR"], join(dir, "store"));
    assert.equal(plan.env["COUNTERPARTS_CONFIG"], join(dir, "config.json"));
  });
});

describe("a new person's store", () => {
  test("starts like a new install: the first meeting offered, dreaming auto — no night starts on its own, and the person's own routine runs it", async () => {
    const r = await rig();
    const wake = await rpc(r.url, "tools/call", { name: "wake", arguments: {} }, auth(r.tokens.a));
    const session = String(((wake.body["result"] as Record<string, unknown>)["structuredContent"] as Record<string, unknown>)["session"]);
    await r.tenants.withTenant(r.callers.a.storeId, {}, async (_t, server) => {
      assert.equal(server.counterpart.store.getMeta("dream.setting"), "auto");
      assert.notEqual(server.counterpart.store.getMeta("onboarding.meet"), "done");
    });
    // The wake offers the meeting (its offer line mentions it).
    assert.match(JSON.stringify(wake.body), /counterparts-meet/);
    // Under auto, nothing starts a night on this host: the wake carries no dream
    // offer, and every child planned is the worker (runner.ts), none a night run.
    assert.doesNotMatch(JSON.stringify(wake.body), /nightly run|no dreams/i);
    assert.ok(r.plans.length >= 1);
    for (const p of r.plans) {
      assert.ok(p.args.some((a) => a.endsWith("runner.ts")), JSON.stringify(p.args));
      assert.equal(p.env["COUNTERPARTS_NIGHT_RUN"], undefined);
      assert.equal(p.env["COUNTERPARTS_NIGHT_CHILD"], undefined);
    }
    // The routine's way in: `dream` launch works under auto.
    const launch = await rpc(r.url, "tools/call", { name: "dream", arguments: { session, phase: "launch" } }, auth(r.tokens.a));
    const out = (launch.body["result"] as Record<string, unknown>)["structuredContent"] as Record<string, unknown>;
    assert.notEqual((launch.body["result"] as Record<string, unknown>)["isError"], true, JSON.stringify(out));
  });

  test("a store that already exists is never re-initialized when it reopens", async () => {
    const r = await rig({ maxOpen: 1 });
    await tool(r.url, "wake", {}, auth(r.tokens.a));
    await r.tenants.withTenant(r.callers.a.storeId, {}, async (_t, server) => {
      server.counterpart.store.setMeta("onboarding.meet", "done");
      server.counterpart.store.setMeta("dream.setting", "ask");
    });
    await tool(r.url, "wake", {}, auth(r.tokens.b)); // closes A (cap of 1)
    assert.equal(r.tenants.isOpen(r.callers.a.storeId), false);
    await r.tenants.withTenant(r.callers.a.storeId, {}, async (_t, server) => {
      assert.equal(server.counterpart.store.getMeta("onboarding.meet"), "done");
      assert.equal(server.counterpart.store.getMeta("dream.setting"), "ask");
    });
  });
});

describe("the tenant registry", () => {
  test("store ids: only 32 lowercase hex characters ever become a path", () => {
    const root = join(tmp.root, "t");
    for (const bad of ["", "..", "../etc", "A".repeat(32), "0".repeat(31), `${"0".repeat(31)}/`, `${"0".repeat(16)}/../${"0".repeat(13)}`]) {
      assert.throws(() => tenantDir(root, bad));
    }
    const ok = "0123456789abcdef0123456789abcdef";
    assert.ok(STORE_ID.test(ok));
    assert.equal(tenantDir(root, ok), join(root, ok));
  });

  test("over the cap, the least recently used idle store closes; its memories are there when it reopens", async () => {
    const r = await rig({ maxOpen: 1 });
    const a = await tool(r.url, "wake", {}, auth(r.tokens.a));
    await tool(r.url, "remember", { session: String(a["session"]), text: "A's cat is called Tolliver." }, auth(r.tokens.a));
    assert.equal(r.tenants.isOpen(r.callers.a.storeId), true);
    await tool(r.url, "wake", {}, auth(r.tokens.b));
    assert.equal(r.tenants.isOpen(r.callers.a.storeId), false);
    assert.equal(r.tenants.isOpen(r.callers.b.storeId), true);
    const again = await rpc(r.url, "tools/call", { name: "recall", arguments: { session: String(a["session"]), question: "cat name", mode: "facts" } }, auth(r.tokens.a));
    assert.match(JSON.stringify(again.body), /Tolliver/);
  });

  test("a store in use is never closed by the cap or the idle sweep; it closes once released", async () => {
    const stub = stubSpawner();
    let now = 0;
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: stub.spawner, maxOpen: 1, idleMs: 10, now: () => now });
    closers.push(() => tenants.closeAll());
    const a = storeId();
    const b = storeId();
    let release!: () => void;
    const held = tenants.withTenant(a, {}, () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 5));
    await tenants.withTenant(b, {}, async () => undefined);
    // Over the cap of 1, and A is in use: nothing closed.
    assert.equal(tenants.size, 2);
    now = 1000;
    assert.equal(await tenants.sweepIdle(), 1);
    assert.equal(tenants.isOpen(a), true);
    assert.equal(tenants.isOpen(b), false);
    release();
    await held;
    now = 2000;
    assert.equal(await tenants.sweepIdle(), 1);
    assert.equal(tenants.size, 0);
  });

  test("close() waits for the store's queued calls (account delete), and a call after it reopens cleanly", async () => {
    const stub = stubSpawner();
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: stub.spawner });
    closers.push(() => tenants.closeAll());
    const a = storeId();
    const order: string[] = [];
    const slow = tenants.withTenant(a, {}, (t) => t.serial(async () => (await new Promise((r) => setTimeout(r, 30)), order.push("call"))));
    await new Promise((r) => setTimeout(r, 5));
    await tenants.close(a);
    order.push("closed");
    await slow;
    assert.deepEqual(order, ["call", "closed"]);
    assert.equal(tenants.isOpen(a), false);
    await tenants.withTenant(a, {}, async (_t, server) => assert.ok(server.counterpart.store.dir.endsWith(join(a, "store"))));
  });

  test("close() raced by a request whose body is still arriving: the process keeps turning, and the store closes once the answer is out (review 10-26)", async () => {
    // In a child: the bug froze its whole event loop, which in-process would
    // freeze this runner's timers too. The child is killed if it hangs.
    const fixture = fileURLToPath(new URL("./fixtures/close-in-flight.ts", import.meta.url));
    const out = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, scriptArgs(fixture), { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1" } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    assert.equal(out.code, 0, `the child hung or failed: ${out.stderr}`);
    const line = JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
    assert.deepEqual(line, { openBefore: true, ticked: true, status: 200, openAfter: false });
  });

  test("close() (account delete) drops the store's worker: the owed run never starts, the running child is stopped", async () => {
    const children: { dir: string; child: EventEmitter & { killed: string | null } }[] = [];
    const pool = workerPool({
      max: 1,
      run: (p) => {
        const child = Object.assign(new EventEmitter(), {
          pid: children.length + 1,
          killed: null as string | null,
          kill(this: EventEmitter & { killed: string | null }, sig: string) {
            this.killed = sig;
            setTimeout(() => this.emit("exit", null, sig), 5);
            return true;
          },
        });
        children.push({ dir: p.env["COUNTERPARTS_DATA_DIR"]!, child });
        return child as never;
      },
    });
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: pool });
    closers.push(() => tenants.closeAll());
    const a = storeId();
    const b = storeId();
    const wake = (id: string): Promise<unknown> => tenants.withTenant(id, {}, (t) => t.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wake", arguments: {} } }));
    await wake(a);
    await wake(a); // owed behind a's running child
    await wake(b); // owed: the pool's one slot is a's
    const dirA = join(tenantDir(tenants.root, a), "store");
    const dirB = join(tenantDir(tenants.root, b), "store");
    assert.deepEqual(pool.running(), [dirA]);
    assert.deepEqual(pool.pending().sort(), [dirA, dirB].sort());
    await tenants.close(a);
    assert.equal(children[0]!.child.killed, "SIGKILL");
    // a's owed run was forgotten; the freed slot went to b, never back to a.
    assert.deepEqual(children.map((c) => c.dir), [dirA, dirB]);
    assert.deepEqual(pool.pending(), []);
    assert.equal(tenants.isOpen(a), false);
  });
});

describe("the worker pool", () => {
  class FakeChild extends EventEmitter {
    readonly pid: number;
    constructor(pid: number) {
      super();
      this.pid = pid;
    }
  }
  const plan = (dir: string, extra: Record<string, string> = {}): SpawnPlan =>
    ({ ok: true, reason: "ready", command: "/bin/true", args: [], env: { COUNTERPARTS_DATA_DIR: dir, ...extra }, timeoutMs: 1000, escalate: false }) as SpawnPlan;

  test("one worker per store at a time (the rest coalesce into one more run), at most `max` in all", () => {
    const started: { dir: string; child: FakeChild }[] = [];
    const pool = workerPool({
      max: 2,
      run: (p) => {
        const child = new FakeChild(started.length + 1);
        started.push({ dir: p.env["COUNTERPARTS_DATA_DIR"]!, child });
        return child as never;
      },
    });
    pool(plan("/t/a"));
    pool(plan("/t/a"));
    pool(plan("/t/a"));
    pool(plan("/t/b"));
    pool(plan("/t/c"));
    assert.deepEqual(started.map((s) => s.dir), ["/t/a", "/t/b"]);
    assert.deepEqual(pool.pending().sort(), ["/t/a", "/t/c"]);
    started[0]!.child.emit("exit", 0);
    // a's slot freed: the oldest owed run that is not running starts (c was owed after a's re-owe? order is insertion).
    assert.equal(started.length, 3);
    started[1]!.child.emit("exit", 0);
    assert.equal(started.length, 4);
    assert.deepEqual(started.map((s) => s.dir).sort(), ["/t/a", "/t/a", "/t/b", "/t/c"]);
    assert.deepEqual(pool.pending(), []);
  });

  test("the child's environment is allow-listed: the server's secrets never reach it", () => {
    const env = workerEnv(plan("/data/tenants/x/store", { PATH: "/usr/bin", HOSTED_KEK: "s3cr3t", RESEND_API_KEY: "re_x", AWS_SECRET_ACCESS_KEY: "y", COUNTERPARTS_WATCHDOG_MS: "1000", HOME: "/root" }));
    assert.equal(env["HOSTED_KEK"], undefined);
    assert.equal(env["RESEND_API_KEY"], undefined);
    assert.equal(env["AWS_SECRET_ACCESS_KEY"], undefined);
    assert.equal(env["PATH"], "/usr/bin");
    assert.equal(env["COUNTERPARTS_WATCHDOG_MS"], "1000");
    assert.equal(env["HOME"], "/data/tenants/x");
    assert.equal(env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"], "1");
    // Hosted is always current: its workers never ask npm (U1b).
    assert.equal(env["COUNTERPARTS_UPDATE_CHECK"], "off");
  });

  test("COUNTERPARTS_* values pass by name, not by prefix: the server's own never steer or reach a child (review 10-26)", () => {
    const env = workerEnv(
      plan("/data/tenants/x/store", {
        COUNTERPARTS_CONFIG: "/data/tenants/x/config.json",
        COUNTERPARTS_SESSION: "s-1",
        COUNTERPARTS_OBSERVER: "1",
        COUNTERPARTS_NIGHT_CHILD: "1",
        COUNTERPARTS_NIGHT_RUN: "1",
        COUNTERPARTS_HOSTED_SECRET: "nope",
        NODE_OPTIONS: "--require /tmp/evil.js",
      }),
    );
    assert.deepEqual(Object.keys(env).sort(), ["COUNTERPARTS_CONFIG", "COUNTERPARTS_DATA_DIR", "COUNTERPARTS_REQUIRE_EXPLICIT_DIR", "COUNTERPARTS_SESSION", "COUNTERPARTS_UPDATE_CHECK", "HOME"]);
  });

  test("through a real wake: the pool hands the child only allow-listed variables, even with secrets in the server's environment", async () => {
    process.env["HOSTED_KEK"] = "test-only-not-a-key";
    try {
      const envs: Record<string, string>[] = [];
      const pool = workerPool({ max: 1, run: (_p, env) => (envs.push(env), new FakeChild(7) as never) });
      const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: pool });
      closers.push(() => tenants.closeAll());
      const id = storeId();
      await tenants.withTenant(id, {}, async (t) => {
        await t.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wake", arguments: {} } });
      });
      assert.equal(envs.length, 1);
      assert.equal(envs[0]!["HOSTED_KEK"], undefined);
      assert.equal(envs[0]!["COUNTERPARTS_DATA_DIR"], join(tenantDir(tenants.root, id), "store"));
    } finally {
      delete process.env["HOSTED_KEK"];
    }
  });
});

describe("hardening from the stack's review", () => {
  test("an authenticate that throws (accounts down) answers 503 with Retry-After, never 401", async () => {
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: () => ({ pid: 1 }) });
    closers.push(() => tenants.closeAll());
    const server = createHostedServer({ tenants, publicOrigin: ORIGIN, authenticate: async () => {
      throw new Error("database is locked");
    } });
    const { base, close } = await listen(server);
    closers.push(close);
    const out = await rpc(`${base}/mcp`, "tools/list", undefined, { authorization: `Bearer ${randomBytes(24).toString("base64url")}` });
    assert.equal(out.status, 503);
    assert.equal(out.headers.get("retry-after"), "30");
    assert.equal(out.headers.get("www-authenticate"), null);
    assert.equal(server.headersTimeout, 30_000);
    assert.equal(server.requestTimeout, 300_000);
  });

  test("only origin-form request targets: //host/x and absolute-form are 400, so no route ever sees a client-chosen host", async () => {
    const r = await rig();
    const { createConnection } = await import("node:net");
    const port = new URL(r.url).port;
    const raw = (target: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const sock = createConnection(Number(port), "127.0.0.1", () => sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
        let data = "";
        sock.on("data", (d: Buffer) => (data += d.toString()));
        sock.on("end", () => resolve(data));
        sock.on("error", reject);
      });
    for (const target of ["//attacker.example/healthz", "http://attacker.example/healthz"]) {
      const answer = await raw(target);
      assert.match(answer.split("\r\n")[0]!, /^HTTP\/1\.1 400/, target);
    }
    assert.match((await raw("/healthz")).split("\r\n")[0]!, /^HTTP\/1\.1 200/);
  });

  test("the real worker child runs, with the pool's allow-listed environment, against a temp tenant", { timeout: 150_000 }, async () => {
    const exits: { code: number | null; err: string }[] = [];
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const pool = workerPool({
      max: 1,
      run: (plan, env) => {
        const child = spawn(plan.command, [...plan.args], { env, stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 });
        let err = "";
        child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
        child.once("exit", (code) => {
          exits.push({ code, err });
          done();
        });
        return child;
      },
    });
    process.env["HOSTED_KEKS"] = "v1:test-only-not-a-key";
    try {
      const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: pool });
      closers.push(() => tenants.closeAll());
      const id = storeId();
      await tenants.withTenant(id, {}, async (t) => {
        await t.server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wake", arguments: {} } });
      });
      await finished;
      assert.equal(exits.length, 1);
      assert.equal(exits[0]!.code, 0, exits[0]!.err.slice(0, 2000));
      // The child wrote into its own tenant, and nowhere else under the root.
      assert.ok(existsSync(join(tenantDir(tenants.root, id), "store", "counterparts.sqlite")));
    } finally {
      delete process.env["HOSTED_KEKS"];
    }
  });
});
