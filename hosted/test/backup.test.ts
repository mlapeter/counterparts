/**
 * OL2 step 5: per-store keys, backups, export and delete-at-once.
 *
 * The KEK is generated per test (never a fixture: the repo is public). R2 is
 * either an in-memory store or, for the client itself, a local S3 stand-in on
 * 127.0.0.1 that the real `r2ObjectStore` signs requests to. The Litestream
 * sidecar is a recorded stub; its configuration is checked as written.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { Backups, CONTROL_KEY_ID, LitestreamSidecar, keyObject, replicaPrefix } from "../src/backup.js";
import { memoryMailer, memoryObjectStore, r2ObjectStore } from "../src/egress.js";
import { EnvKeyWrapper, KeyStore, kekRingFromEnv, kekVersionOf, litestreamKey } from "../src/keys.js";
import { tenantDir } from "../src/tenants.js";
import { listen, storeId, tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("backup");
});
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    try {
      await c();
    } catch {
      /* closed */
    }
  }
  tmp.remove();
});

const ring = (...versions: string[]): Map<string, Buffer> => new Map(versions.map((v) => [v, randomBytes(32)]));

describe("the KEK seam", () => {
  test("wrap/unwrap round-trips under the store id; the wrong store id, a tampered value or an unknown version fails", async () => {
    const w = new EnvKeyWrapper(ring("v1"), "v1");
    const dek = randomBytes(32);
    const wrapped = await w.wrap(dek, "store-a");
    assert.equal(kekVersionOf(wrapped), "v1");
    assert.deepEqual(await w.unwrap(wrapped, "store-a"), dek);
    await assert.rejects(w.unwrap(wrapped, "store-b"));
    const parts = wrapped.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0] = body[0]! ^ 1;
    await assert.rejects(w.unwrap([parts[0], parts[1], parts[2], body.toString("base64url")].join("."), "store-a"));
    await assert.rejects(new EnvKeyWrapper(ring("v2"), "v2").unwrap(wrapped, "store-a"));
  });

  test("the ring from the environment: refusals never echo a key", () => {
    const key = randomBytes(32).toString("base64");
    assert.ok("refusal" in kekRingFromEnv({}));
    const short = kekRingFromEnv({ HOSTED_KEKS: `v1:${randomBytes(16).toString("base64")}` });
    assert.ok("refusal" in short && !short.refusal.includes(key));
    const noCurrent = kekRingFromEnv({ HOSTED_KEKS: `v1:${key},v2:${randomBytes(32).toString("base64")}` });
    assert.ok("refusal" in noCurrent && !noCurrent.refusal.includes(key));
    const ok = kekRingFromEnv({ HOSTED_KEKS: `v1:${key}` });
    assert.ok(!("refusal" in ok) && ok.version === "v1");
  });

  test("nothing in hosted/src but keys.ts touches the raw KEK or the cipher", () => {
    const dir = fileURLToPath(new URL("../src/", import.meta.url));
    const touching: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const code = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/^\s*\*.*$/gm, " ");
      if (/HOSTED_KEKS|HOSTED_KEK_CURRENT|createCipheriv|createDecipheriv|hkdfSync/.test(code)) touching.push(f);
    }
    assert.deepEqual(touching, ["keys.ts"]);
  });

  test("rewrap moves every DEK from v1 to v2 without changing it; afterwards v1 can be dropped", async () => {
    const keysRing = ring("v1", "v2");
    const v1 = new EnvKeyWrapper(keysRing, "v1");
    const keys = new KeyStore({ path: join(tmp.root, "keys", "keys.sqlite"), wrapper: v1 });
    closers.push(() => keys.close());
    const ids = [storeId(), storeId(), storeId()];
    for (const id of ids) await keys.create(id);
    const before = await Promise.all(ids.map((id) => keys.dek(id)));
    const moved = await keys.rewrap(new EnvKeyWrapper(keysRing, "v2"));
    assert.deepEqual(moved.sort(), [...ids].sort());
    for (const id of ids) assert.equal(kekVersionOf(keys.wrapped(id)!), "v2");
    const onlyV2 = new EnvKeyWrapper(new Map([["v2", keysRing.get("v2")!]]), "v2");
    for (const [i, id] of ids.entries()) assert.deepEqual(await onlyV2.unwrap(keys.wrapped(id)!, id), before[i]);
    assert.deepEqual(await keys.rewrap(new EnvKeyWrapper(keysRing, "v2")), []);
  });
});

describe("R2, through the real client, against a local S3 stand-in", () => {
  test("put, get, list (paged), delete and deletePrefix — every request signed SigV4 for s3/auto", async () => {
    const objects = new Map<string, string>();
    const auths: string[] = [];
    const server = createServer((req, res) => {
      auths.push(String(req.headers["authorization"] ?? ""));
      const url = new URL(req.url ?? "/", "http://x");
      const [, bucket, ...rest] = url.pathname.split("/");
      const key = rest.map(decodeURIComponent).join("/");
      if (bucket !== "bkt") return void res.writeHead(404).end();
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (req.method === "PUT") {
          objects.set(key, Buffer.concat(chunks).toString("utf8"));
          return void res.writeHead(200).end();
        }
        if (req.method === "DELETE") {
          objects.delete(key);
          return void res.writeHead(204).end();
        }
        if (key.length === 0 && url.searchParams.get("list-type") === "2") {
          const prefix = url.searchParams.get("prefix") ?? "";
          const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
          const start = Number(url.searchParams.get("continuation-token") ?? "0");
          const page = all.slice(start, start + 2);
          const more = start + 2 < all.length;
          return void res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>${String(more)}</IsTruncated>${more ? `<NextContinuationToken>${String(start + 2)}</NextContinuationToken>` : ""}</ListBucketResult>`);
        }
        const v = objects.get(key);
        if (v === undefined) return void res.writeHead(404).end();
        res.writeHead(200).end(v);
      });
    });
    const { base, close } = await listen(server);
    closers.push(close);
    const r2 = r2ObjectStore({ endpoint: base, bucket: "bkt", accessKeyId: "test-generated-id", secretAccessKey: randomBytes(20).toString("hex"), fetchFn: (r) => fetch(r) });
    await r2.put("keys/aa.wrapped", "w1.v1.x.y");
    for (const n of [1, 2, 3, 4, 5]) await r2.put(`tenants/aa/ltx/${String(n)}`, "x");
    await r2.put("tenants/bb/ltx/1", "x");
    assert.equal(await r2.get("keys/aa.wrapped"), "w1.v1.x.y");
    assert.equal(await r2.get("keys/none.wrapped"), null);
    assert.equal((await r2.list("tenants/aa/")).length, 5);
    assert.equal(await r2.deletePrefix("tenants/aa/"), 5);
    await r2.delete("keys/aa.wrapped");
    assert.deepEqual([...objects.keys()], ["tenants/bb/ltx/1"]);
    assert.ok(auths.every((a) => /^AWS4-HMAC-SHA256 Credential=test-generated-id\/\d{8}\/auto\/s3\/aws4_request/.test(a)));
    await assert.rejects(r2.deletePrefix("tenants/bb"));
    await assert.rejects(r2.put("../escape", "x"));
  });
});

class FakeChild extends EventEmitter {
  killed: string[] = [];
  kill(sig: string): boolean {
    this.killed.push(sig);
    setImmediate(() => this.emit("exit", 0));
    return true;
  }
}

describe("the Litestream sidecar", () => {
  test("reload restarts the one child on the same config with only the R2 credentials; stop ends it", async () => {
    const spawned: { args: string[]; env: Record<string, string>; child: FakeChild }[] = [];
    const sidecar = new LitestreamSidecar({
      binary: "litestream",
      configPath: "/data/litestream.yml",
      env: { PATH: "/usr/bin", LITESTREAM_ACCESS_KEY_ID: "id", LITESTREAM_SECRET_ACCESS_KEY: "s" },
      spawnFn: (_cmd, args, env) => {
        const child = new FakeChild();
        spawned.push({ args, env, child });
        return child as unknown as ChildProcess;
      },
    });
    sidecar.reload();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0]!.args, ["replicate", "-config", "/data/litestream.yml"]);
    assert.deepEqual(Object.keys(spawned[0]!.env).sort(), ["LITESTREAM_ACCESS_KEY_ID", "LITESTREAM_SECRET_ACCESS_KEY", "PATH"]);
    sidecar.reload();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(spawned.length, 2);
    assert.deepEqual(spawned[0]!.child.killed, ["SIGTERM"]);
    await sidecar.stop();
    assert.deepEqual(spawned[1]!.child.killed, ["SIGTERM"]);
  });
});

describe("Backups", () => {
  test("a store's backup: its DEK, a 0600 key file holding its derived SSE-C key, one wrapped-key object, a place in the config with no secret in it", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    let reloads = 0;
    const id = storeId();
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: { reload: () => void reloads++, stop: async () => undefined }, liveStores: () => [id] });
    await backups.ensureAll();
    await backups.ensureAll(); // idempotent
    const keyFile = join(tenantDir(join(tmp.root, "data", "tenants"), id), "litestream.key");
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    const dek = await keys.dek(id);
    assert.equal(readFileSync(keyFile, "utf8").trim(), litestreamKey(dek));
    assert.equal(Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64").length, 32);
    assert.equal(objects.objects.get(keyObject(id)), keys.wrapped(id));
    assert.ok(objects.objects.has(keyObject(CONTROL_KEY_ID)));
    const yml = readFileSync(backups.configPath, "utf8");
    assert.match(yml, new RegExp(`path: ".*/tenants/${id}/store/counterparts.sqlite"`));
    assert.match(yml, new RegExp(`path: "tenants/${id}"`));
    assert.match(yml, /sse-customer-key-path: ".*litestream.key"/);
    assert.match(yml, /control\/accounts\.sqlite/);
    assert.doesNotMatch(yml, new RegExp(litestreamKey(dek).replace(/[+/=]/g, ".")));
    assert.ok(!yml.includes(keys.wrapped(id)!));
    assert.equal(reloads, 2);
  });
});

// ── through the app: sign up, export, delete at once ─────────────────────────

class Browser {
  readonly jar = new Map<string, string>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async go(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(`${this.base}${path}`, { ...init, headers, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv!.indexOf("=");
      const k = kv!.slice(0, i).trim();
      const v = kv!.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async form(path: string, fields: Record<string, string>): Promise<Response> {
    return this.go(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

async function appRig(): Promise<{ app: App; base: string; mail: ReturnType<typeof memoryMailer>; objects: ReturnType<typeof memoryObjectStore>; reloads: () => number }> {
  const mail = memoryMailer();
  const objects = memoryObjectStore();
  let reloads = 0;
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: "http://127.0.0.1",
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    backup: { wrapper: new EnvKeyWrapper(ring("v1"), "v1"), objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: { reload: () => void reloads++, stop: async () => undefined } },
  });
  closers.push(() => app.close());
  await app.start();
  const { base, close } = await listen(app.server);
  closers.push(close);
  return { app, base, mail, objects, reloads: () => reloads };
}

async function signUp(r: { app: App; base: string; mail: ReturnType<typeof memoryMailer> }, email: string): Promise<{ browser: Browser; personId: string; storeId: string }> {
  const { code } = r.app.accounts.createInvite();
  const browser = new Browser(r.base);
  const form = await (await browser.go("/login")).text();
  await browser.form("/login", { csrf: csrfOf(form), email, invite: code, tz: "America/Denver", next: "/account" });
  const link = /https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0].replace(/^https?:\/\/[^/]+/, "");
  assert.equal((await browser.go(link)).status, 303);
  const personId = r.app.accounts.sessionPerson(browser.jar.get("cp_session") ?? null)!;
  return { browser, personId, storeId: r.app.accounts.person(personId)!.storeId! };
}

describe("sign-up, export and delete, through the app", () => {
  test("sign-up gives the store its key, its one wrapped-key object and a place in the sidecar's config", async () => {
    const r = await appRig();
    const { storeId: id } = await signUp(r, "keys@example.com");
    assert.equal(r.objects.objects.get(keyObject(id)), r.app.keys!.wrapped(id));
    assert.match(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(id));
    assert.ok(existsSync(join(tenantDir(r.app.tenants.root, id), "litestream.key")));
  });

  test("export: the whole memory as one SQLite file, to the signed-in person, behind CSRF", async () => {
    const r = await appRig();
    const me = await signUp(r, "export@example.com");
    await r.app.tenants.withTenant(me.storeId, {}, async (_t, server) => {
      const woke = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wake", arguments: {} } })) as unknown as { result: { structuredContent: { session: string } } };
      await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "remember", arguments: { session: woke.result.structuredContent.session, text: "The export holds the lemon tree by the gate." } } });
    });
    const page = await (await me.browser.go("/account")).text();
    assert.equal((await me.browser.form("/account/export", {})).status, 403);
    const res = await me.browser.form("/account/export", { csrf: csrfOf(page) });
    assert.equal(res.status, 200);
    assert.match(String(res.headers.get("content-disposition")), /attachment; filename="counterparts-\d{4}-\d{2}-\d{2}\.sqlite"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 15).toString("latin1"), "SQLite format 3");
    assert.match(bytes.toString("latin1"), /lemon tree by the gate/);
  });

  test("delete happens AT ONCE, everywhere: the wrapped key and every replica object are gone from R2 right after; nothing of the store is left", async () => {
    const r = await appRig();
    const me = await signUp(r, "gone@example.com");
    const other = await signUp(r, "stays@example.com");
    // Litestream's objects for both stores, as the sidecar would have written them.
    for (const id of [me.storeId, other.storeId]) for (const n of [1, 2, 3]) await r.objects.put(`${replicaPrefix(id)}ltx/0/${String(n)}.ltx`, "ciphertext");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    const page = await (await me.browser.go("/account")).text();
    // A mistyped confirmation deletes nothing.
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), confirm: "someone@example.com" })).status, 400);
    assert.ok(r.objects.objects.has(keyObject(me.storeId)));
    const done = await me.browser.form("/account/delete", { csrf: csrfOf(page), confirm: "gone@example.com" });
    assert.equal(done.status, 200);
    // R2, right after: no wrapped key, no replica object.
    assert.equal(r.objects.objects.has(keyObject(me.storeId)), false);
    assert.deepEqual(await r.objects.list(replicaPrefix(me.storeId)), []);
    // Locally: no wrapped DEK, no tenant dir, not in the sidecar's config.
    assert.equal(r.app.keys!.wrapped(me.storeId), null);
    assert.equal(existsSync(tenantDir(r.app.tenants.root, me.storeId)), false);
    assert.doesNotMatch(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(me.storeId));
    // The account: signed out, and the address is a stranger again (an invite is needed to come back).
    assert.equal((await me.browser.go("/account")).status, 303);
    assert.equal(r.app.accounts.person(me.personId)!.state, "deleted");
    assert.equal(r.app.accounts.person(me.personId)!.email, null);
    const again = r.app.accounts.requestLink({ email: "gone@example.com", browser: "b".repeat(43) });
    assert.equal(again.send, false);
    // The other person's backups are untouched.
    assert.ok(r.objects.objects.has(keyObject(other.storeId)));
    assert.equal((await r.objects.list(replicaPrefix(other.storeId))).length, 3);
    assert.ok(existsSync(tenantDir(r.app.tenants.root, other.storeId)));
  });
});

describe("rotation, end to end", () => {
  test("after a rewrap onto v2, each store's one key object carries the v2 wrapping (an overwrite, no second copy)", async () => {
    const keysRing = ring("v1", "v2");
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(keysRing, "v1") });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    const ids = [storeId(), storeId()];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => ids });
    await backups.ensureAll();
    const moved = await keys.rewrap(new EnvKeyWrapper(keysRing, "v2"));
    await backups.reuploadKeys(moved);
    for (const id of [...ids, CONTROL_KEY_ID]) {
      assert.equal(kekVersionOf(objects.objects.get(keyObject(id))!), "v2");
      assert.equal(objects.objects.get(keyObject(id)), keys.wrapped(id));
    }
    assert.equal((await objects.list("keys/")).length, ids.length + 1);
  });
});
