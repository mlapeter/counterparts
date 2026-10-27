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
import type { Sidecar } from "../src/backup.js";
import { memoryMailer, memoryObjectStore, r2ObjectStore } from "../src/egress.js";
import type { ObjectStore } from "../src/egress.js";
import { openDb } from "../../src/core/store/db.js";
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
    // Every file under src/, at any depth, and every spelling of a cipher or KDF node offers.
    for (const f of (readdirSync(dir, { recursive: true }) as string[]).filter((n) => /\.(m?[jt]s)$/.test(n))) {
      const code = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/^\s*\*.*$/gm, " ");
      if (/HOSTED_KEK|createCipher|createDecipher|\bhkdf|subtle|webcrypto|aes-\d|chacha20/i.test(code)) touching.push(f);
    }
    assert.deepEqual(touching, ["keys.ts"]);
  });

  test("the version is bound too: a value relabelled to another version, or a ring repeating a version or a key, is refused", async () => {
    // The same key bytes held as v1 by one wrapper and as v2 by another (each ring legal on
    // its own): relabelling v1→v2 fails only because the version is in the associated data.
    const k = randomBytes(32);
    const asV1 = new EnvKeyWrapper(new Map([["v1", k]]), "v1");
    const asV2 = new EnvKeyWrapper(new Map([["v2", Buffer.from(k)]]), "v2");
    const dek = randomBytes(32);
    const wrapped = await asV1.wrap(dek, "store-a");
    assert.deepEqual(await asV1.unwrap(wrapped, "store-a"), dek);
    const relabelled = wrapped.replace(/^w1\.v1\./, "w1.v2.");
    await assert.rejects(asV2.unwrap(relabelled, "store-a"));
    // And no ring may hold one key under two versions (an operator's copy-paste), which would make the label moot.
    const same = randomBytes(32);
    assert.throws(() => new EnvKeyWrapper(new Map([["v1", same], ["v2", same]]), "v1"));
    const key = randomBytes(32).toString("base64");
    const dupKey = kekRingFromEnv({ HOSTED_KEKS: `v1:${key},v2:${key}`, HOSTED_KEK_CURRENT: "v2" });
    assert.ok("refusal" in dupKey && !dupKey.refusal.includes(key));
    const dupVersion = kekRingFromEnv({ HOSTED_KEKS: `v1:${key},v1:${randomBytes(32).toString("base64")}` });
    assert.ok("refusal" in dupVersion && !dupVersion.refusal.includes(key));
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
    await sidecar.reload();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0]!.args, ["replicate", "-config", "/data/litestream.yml"]);
    assert.deepEqual(Object.keys(spawned[0]!.env).sort(), ["LITESTREAM_ACCESS_KEY_ID", "LITESTREAM_SECRET_ACCESS_KEY", "PATH"]);
    await sidecar.reload();
    assert.equal(spawned.length, 2);
    assert.deepEqual(spawned[0]!.child.killed, ["SIGTERM"]);
    await sidecar.stop();
    assert.deepEqual(spawned[1]!.child.killed, ["SIGTERM"]);
  });
});

describe("the Litestream sidecar, on its way out", () => {
  test("reload resolves only after the old child has exited; one that ignores SIGTERM gets SIGKILL", async () => {
    const children: SlowChild[] = [];
    const sidecar = new LitestreamSidecar({
      binary: "litestream",
      configPath: "/data/litestream.yml",
      env: { PATH: "/usr/bin" },
      killAfterMs: 50,
      spawnFn: () => {
        const c = new SlowChild(children.length === 0 ? 30 : null);
        children.push(c);
        return c as unknown as ChildProcess;
      },
    });
    await sidecar.reload();
    const t0 = Date.now();
    await sidecar.reload();
    assert.ok(children[0]!.exited, "the first child had exited when reload resolved");
    assert.ok(Date.now() - t0 >= 25);
    // The second child ignores SIGTERM: stop escalates.
    await sidecar.stop();
    assert.deepEqual(children[1]!.killed, ["SIGTERM", "SIGKILL"]);
  });
});

/** A child that exits `exitAfterMs` after SIGTERM (null: only on SIGKILL). */
class SlowChild extends EventEmitter {
  killed: string[] = [];
  exited = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  private readonly exitAfterMs: number | null;
  constructor(exitAfterMs: number | null) {
    super();
    this.exitAfterMs = exitAfterMs;
  }
  kill(sig: string): boolean {
    this.killed.push(sig);
    if (sig === "SIGKILL" || this.exitAfterMs !== null) {
      setTimeout(() => {
        this.exited = true;
        this.exitCode = 0;
        this.emit("exit", 0);
      }, sig === "SIGKILL" ? 0 : this.exitAfterMs!);
    }
    return true;
  }
}

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
    // The "purged within 24 h" bound: snapshots every 12 h, kept 12 h (backup.ts#config).
    assert.match(yml, /^snapshot:\n {2}interval: 12h\n {2}retention: 12h$/m);
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

async function appRig(
  o: { objects?: ObjectStore; sidecar?: Sidecar; wrapper?: EnvKeyWrapper } = {},
): Promise<{ app: App; base: string; mail: ReturnType<typeof memoryMailer>; objects: ReturnType<typeof memoryObjectStore>; reloads: () => number }> {
  const mail = memoryMailer();
  const objects = memoryObjectStore();
  let reloads = 0;
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: "http://127.0.0.1",
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    backup: {
      wrapper: o.wrapper ?? new EnvKeyWrapper(ring("v1"), "v1"),
      objects: o.objects ?? objects,
      bucket: "bkt",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      sidecar: o.sidecar ?? { reload: () => void reloads++, stop: async () => undefined },
    },
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

  test("delete everything now happens AT ONCE, everywhere: the wrapped key and every replica object are gone from R2 right after; nothing of the store is left", async () => {
    const r = await appRig();
    const me = await signUp(r, "gone@example.com");
    const other = await signUp(r, "stays@example.com");
    // Litestream's objects for both stores, as the sidecar would have written them.
    for (const id of [me.storeId, other.storeId]) for (const n of [1, 2, 3]) await r.objects.put(`${replicaPrefix(id)}ltx/0/${String(n)}.ltx`, "ciphertext");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    const page = await (await me.browser.go("/account")).text();
    // A mistyped confirmation deletes nothing.
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "someone@example.com" })).status, 400);
    assert.ok(r.objects.objects.has(keyObject(me.storeId)));
    const done = await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "gone@example.com" });
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

// ── the awkward states of a delete, built on purpose (OL2 security review) ────

describe("delete, when things go wrong", () => {
  test("Litestream's last upload on SIGTERM lands BEFORE the prefix delete, not after it: R2 is empty for the store right after", async () => {
    const objects = memoryObjectStore();
    const configPath = join(tmp.root, "data", "litestream.yml");
    // A stand-in for `litestream replicate`: on SIGTERM it flushes one more segment
    // for every store in the configuration it started with, a moment later, then exits.
    const sidecar = new LitestreamSidecar({
      binary: "litestream",
      configPath,
      env: { PATH: "/usr/bin" },
      spawnFn: () => {
        const stores = existsSync(configPath) ? [...readFileSync(configPath, "utf8").matchAll(/path: "tenants\/([^"]+)"/g)].map((m) => m[1]!) : [];
        const child = new EventEmitter() as EventEmitter & { kill: (s: string) => boolean; exitCode: number | null; signalCode: string | null };
        child.exitCode = null;
        child.signalCode = null;
        child.kill = (): boolean => {
          setTimeout(() => {
            void (async (): Promise<void> => {
              for (const id of stores) await objects.put(`${replicaPrefix(id)}ltx/0/final-flush.ltx`, "ciphertext");
              child.exitCode = 0;
              child.emit("exit", 0);
            })();
          }, 30);
          return true;
        };
        return child as unknown as ChildProcess;
      },
    });
    const r = await appRig({ objects, sidecar });
    const me = await signUp(r, "flush@example.com");
    const other = await signUp(r, "keeps@example.com");
    const page = await (await me.browser.go("/account")).text();
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "flush@example.com" })).status, 200);
    assert.deepEqual(await objects.list(replicaPrefix(me.storeId)), []);
    assert.equal(objects.objects.has(keyObject(me.storeId)), false);
    // The other store's final flush (from the same restart) is its own and stays.
    assert.ok((await objects.list(replicaPrefix(other.storeId))).length > 0);
    await new Promise((res) => setTimeout(res, 60));
    assert.deepEqual(await objects.list(replicaPrefix(me.storeId)), [], "and nothing arrives later either");
  });

  test("a delete cut short (R2 down) is never resurrected by a restart, and the restart finishes it", async () => {
    const inner = memoryObjectStore();
    let down = false;
    const flaky: ObjectStore = {
      put: (k, b) => inner.put(k, b),
      get: (k) => inner.get(k),
      list: (p) => inner.list(p),
      delete: async (k) => {
        if (down) throw new Error("object store DELETE answered 503");
        await inner.delete(k);
      },
      deletePrefix: async (p) => {
        if (down) throw new Error("object store DELETE answered 503");
        return inner.deletePrefix(p);
      },
    };
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const r = await appRig({ objects: flaky, wrapper });
    const me = await signUp(r, "halfway@example.com");
    for (const n of [1, 2]) await inner.put(`${replicaPrefix(me.storeId)}ltx/0/${String(n)}.ltx`, "ciphertext");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    const page = await (await me.browser.go("/account")).text();
    down = true;
    const res = await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "halfway@example.com" });
    assert.equal(res.status, 202);
    // Closed already: signed out, no way back in, the store out of start-up's live list.
    assert.equal((await me.browser.go("/account")).status, 303);
    assert.equal(r.app.accounts.requestLink({ email: "halfway@example.com", browser: "b".repeat(43) }).send, false);
    assert.equal(r.app.accounts.liveStoreIds().includes(me.storeId), false);
    assert.deepEqual(r.app.accounts.pendingDeletes(), [me.personId]);
    // An operator can't reactivate a person mid-delete.
    r.app.accounts.setState(me.personId, "active");
    assert.equal(r.app.accounts.isLive(me.personId), false);
    // A call that was authenticated just before the revoke can't re-open (and re-create) the store.
    await assert.rejects(r.app.tenants.withTenant(me.storeId, {}, async () => undefined));
    // The process dies here. A new one starts on the same volume, R2 back.
    await r.app.close();
    down = false;
    const r2 = await appRig({ objects: flaky, wrapper });
    // No new key, no key object, no replica, no tenant dir, not in the config; the person a tombstone.
    assert.equal(r2.app.keys!.wrapped(me.storeId), null);
    assert.equal(inner.objects.has(keyObject(me.storeId)), false);
    assert.deepEqual(await inner.list(replicaPrefix(me.storeId)), []);
    assert.equal(existsSync(tenantDir(r2.app.tenants.root, me.storeId)), false);
    assert.doesNotMatch(readFileSync(r2.app.backups!.configPath, "utf8"), new RegExp(me.storeId));
    assert.equal(r2.app.accounts.person(me.personId)!.state, "deleted");
    assert.deepEqual(r2.app.accounts.pendingDeletes(), []);
  });

  test("nothing of a deleted person stays in a free cell: not the wrapped DEK in keys.sqlite, not the address in accounts.sqlite", async () => {
    const r = await appRig();
    const me = await signUp(r, "no-trace-left@example.com");
    const wrapped = r.app.keys!.wrapped(me.storeId)!;
    const page = await (await me.browser.go("/account")).text();
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "no-trace-left@example.com" })).status, 200);
    const keysFile = join(tmp.root, "data", "keys", "keys.sqlite");
    for (const f of [keysFile, `${keysFile}-wal`]) {
      if (existsSync(f)) assert.equal(readFileSync(f).includes(Buffer.from(wrapped.split(".")[3]!)), false, `${f} still holds the wrapped DEK`);
    }
    // accounts.sqlite's log is Litestream's to fold; once it is folded, the file has no address in it.
    const accountsFile = join(tmp.root, "data", "control", "accounts.sqlite");
    const db = openDb(accountsFile, { wal: true });
    try {
      db.get("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    assert.equal(readFileSync(accountsFile).includes(Buffer.from("no-trace-left@example.com")), false);
  });

  test("start-up refuses a ring that can't open a store's key (a version dropped before a rewrap finished)", async () => {
    const keysRing = ring("v1", "v2");
    const r = await appRig({ wrapper: new EnvKeyWrapper(keysRing, "v1") });
    await signUp(r, "rotate@example.com");
    await r.app.close();
    await assert.rejects(appRig({ wrapper: new EnvKeyWrapper(new Map([["v2", keysRing.get("v2")!]]), "v2") }), /don't open with the KEK ring/);
  });

  test("a rewrap that died between its key writes and its uploads is repaired by running it again", async () => {
    const keysRing = ring("v1", "v2");
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(keysRing, "v1") });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    const ids = [storeId(), storeId()];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => ids });
    await backups.ensureAll();
    const v2 = new EnvKeyWrapper(keysRing, "v2");
    await keys.rewrap(v2); // ... and the process dies before any upload
    assert.equal(kekVersionOf(objects.objects.get(keyObject(ids[0]!))!), "v1");
    assert.deepEqual(await keys.rewrap(v2), []); // the second run moves nothing
    assert.equal(await backups.syncKeyObjects(), ids.length + 1); // but its sync puts every stale object
    for (const id of [...ids, CONTROL_KEY_ID]) assert.equal(objects.objects.get(keyObject(id)), keys.wrapped(id));
    assert.equal(await backups.syncKeyObjects(), 0);
  });
});
