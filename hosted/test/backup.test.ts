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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import type { App, AppBackupOptions } from "../src/app.js";
import { Backups, CONTROL_KEY_ID, LitestreamSidecar, TENANT_DATABASES_META, UploadWatch, WATCHED_REPLICA, keyObject, maxTxid, replicaPrefix, tenantDatabasePaths, tenantDatabasePrefix } from "../src/backup.js";
import type { LitestreamRun, Sidecar, UploadsEvent } from "../src/backup.js";
import { memoryMailer, memoryObjectStore, r2ObjectStore } from "../src/egress.js";
import type { ObjectStore } from "../src/egress.js";
import { openDb } from "../../src/core/store/db.js";
import { EnvKeyWrapper, KeyStore, kekRingFromEnv, kekVersionOf, litestreamKey } from "../src/keys.js";
import { tenantDir } from "../src/tenants.js";
import { startOverCommand } from "../src/main.js";
import { RECOVERY, listen, storeId, tempRoot, testRecovery } from "./helpers.js";

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
      // A cipher name always carries its mode (aes-256-gcm); the page copy's "AES-256 at rest" (G4) doesn't.
      if (/HOSTED_KEK|createCipher|createDecipher|\bhkdf|subtle|webcrypto|aes-\d+-|chacha20/i.test(code)) touching.push(f);
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
  test("a store's backup: its DEK, a 0600 key file holding its derived SSE-C key, one key object sealed to the recovery key, a place in the config with no secret in it", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    let reloads = 0;
    const id = storeId();
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: { reload: () => void reloads++, stop: async () => undefined }, liveStores: () => [id] });
    await backups.ensureAll();
    await backups.ensureAll(); // idempotent
    const keyFile = join(tenantDir(join(tmp.root, "data", "tenants"), id), "litestream.key");
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    const dek = await keys.dek(id);
    assert.equal(readFileSync(keyFile, "utf8").trim(), litestreamKey(dek));
    assert.equal(Buffer.from(readFileSync(keyFile, "utf8").trim(), "base64").length, 32);
    assert.deepEqual(RECOVERY.opener.open(objects.objects.get(keyObject(id))!, id), await keys.dek(id), "its one key object: the DEK, sealed to the recovery key");
    assert.ok(!objects.objects.get(keyObject(id))!.includes(keys.wrapped(id)!.split(".")[3]!), "not the volume wrapping");
    assert.ok(objects.objects.has(keyObject(CONTROL_KEY_ID)));
    const yml = readFileSync(backups.configPath, "utf8");
    assert.match(yml, new RegExp(`path: ".*/tenants/${id}/store/counterparts.sqlite"`));
    assert.match(yml, new RegExp(`path: "tenants/${id}"`));
    assert.match(yml, /sse-customer-key-path: ".*litestream.key"/);
    // Litestream's own state beside the store, never in it: the core layout refuses a name it doesn't know (11-03).
    assert.match(yml, new RegExp(`counterparts.sqlite"\n {4}meta-path: ".*/tenants/${id}/litestream-meta"\n`));
    assert.equal((yml.match(/meta-path:/g) ?? []).length, 1); // the control databases aren't a store: Litestream's default stays
    assert.match(yml, /control\/accounts\.sqlite/);
    // The "purged within 24 h" bound: snapshots every 12 h, kept 12 h (backup.ts#config).
    assert.match(yml, /^snapshot:\n {2}interval: 12h\n {2}retention: 12h$/m);
    // Litestream's own lines reach the container's log (0.5.17 logs to stdout, which the sidecar doesn't keep).
    assert.match(yml, /^logging:\n {2}stderr: true$/m);
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
  o: { objects?: ObjectStore; sidecar?: Sidecar; wrapper?: EnvKeyWrapper; tenantDatabases?: string[]; finishEveryMs?: number } = {},
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
    ...(o.finishEveryMs === undefined ? {} : { finishEveryMs: o.finishEveryMs }),
    backup: {
      ...(o.tenantDatabases === undefined ? {} : { tenantDatabases: o.tenantDatabases }),
      wrapper: o.wrapper ?? new EnvKeyWrapper(ring("v1"), "v1"),
      sealer: RECOVERY.sealer,
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
    assert.deepEqual(RECOVERY.opener.open(r.objects.objects.get(keyObject(id))!, id), await r.app.keys!.dek(id));
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
  test("a rewrap on the volume changes nothing in the bucket: the sealed objects name the DEK, not its wrapping (WB1)", async () => {
    const keysRing = ring("v1", "v2");
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(keysRing, "v1") });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    const ids = [storeId(), storeId()];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => ids });
    await backups.ensureAll();
    const before = new Map(objects.objects);
    const moved = await keys.rewrap(new EnvKeyWrapper(keysRing, "v2"));
    assert.equal(moved.length, ids.length + 1);
    await backups.ensureAll();
    assert.deepEqual(new Map(objects.objects), before);
    for (const id of [...ids, CONTROL_KEY_ID]) {
      assert.equal(kekVersionOf(keys.wrapped(id)!), "v2");
      assert.equal(await backups.sealedState(id), "ok");
      assert.deepEqual(RECOVERY.opener.open(objects.objects.get(keyObject(id))!, id), await keys.dek(id));
    }
    assert.equal((await objects.list("keys/")).length, ids.length + 1);
  });

  test("a new recovery key: the next start seals every key object to it, one object per store still; the old private key opens none", async () => {
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring("v1"), "v1") });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    const ids = [storeId(), storeId()];
    const opts = { dataRoot: join(tmp.root, "data"), keys, objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => ids };
    await new Backups({ ...opts, sealer: RECOVERY.sealer }).ensureAll();
    const next = testRecovery();
    const b2 = new Backups({ ...opts, sealer: next.sealer });
    for (const id of ids) assert.equal(await b2.sealedState(id), "stale");
    await b2.ensureAll();
    for (const id of [...ids, CONTROL_KEY_ID]) {
      const sealed = objects.objects.get(keyObject(id))!;
      assert.deepEqual(next.opener.open(sealed, id), await keys.dek(id));
      assert.throws(() => RECOVERY.opener.open(sealed, id), /another recovery key/);
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
    await assert.rejects(appRig({ wrapper: new EnvKeyWrapper(new Map([["v2", keysRing.get("v2")!]]), "v2") }), /don't open/);
  });

  test("syncKeyObjects puts a sealed object where one is missing, never over one naming another key; a dry run puts nothing", async () => {
    const keys = new KeyStore({ path: join(tmp.root, "data", "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring("v1"), "v1") });
    closers.push(() => keys.close());
    const objects = memoryObjectStore();
    const ids = [storeId(), storeId()];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys, objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => ids });
    await backups.ensureAll();
    objects.objects.delete(keyObject(ids[0]!));
    const foreign = RECOVERY.sealer.seal(randomBytes(32), ids[1]!);
    objects.objects.set(keyObject(ids[1]!), foreign);
    assert.deepEqual(await backups.syncKeyObjects({ dryRun: true }), { put: 1, different: [ids[1]] });
    assert.equal(objects.objects.has(keyObject(ids[0]!)), false);
    assert.deepEqual(await backups.syncKeyObjects(), { put: 1, different: [ids[1]] });
    assert.equal(await backups.sealedState(ids[0]!), "ok");
    assert.equal(objects.objects.get(keyObject(ids[1]!)), foreign, "never over another key");
    assert.deepEqual(await backups.syncKeyObjects(), { put: 0, different: [ids[1]] });
  });
});

// ── the upload watch (G3), alone ─────────────────────────────────────────────

describe("UploadWatch", () => {
  const ltx = (n: number, level = "0000"): string => `${WATCHED_REPLICA}${level}/${"1".padStart(16, "0")}-${n.toString(16).padStart(16, "0")}.ltx`;

  test("maxTxid reads every level's LTX names under the prefix, and nothing else", () => {
    assert.equal(maxTxid([ltx(5), ltx(0x2a, "0001"), `${WATCHED_REPLICA}standin/db`, "control/oauth.sqlite/0000/0000000000000001-00000000000000ff.ltx"], WATCHED_REPLICA), 0x2an);
    assert.equal(maxTxid([], WATCHED_REPLICA), 0n);
  });

  test("before begin nothing is looked at; a lower TXID is a new baseline, not a rise; a failed heartbeat is its own reason", async () => {
    const objects = memoryObjectStore();
    let t = 1_000_000;
    let beats = 0;
    let beatFails = false;
    const events: UploadsEvent[] = [];
    const w = new UploadWatch({
      objects,
      heartbeat: () => {
        if (beatFails) throw new Error("SQLITE_BUSY");
        beats += 1;
      },
      now: () => t,
      staleAfterMs: 30,
      onEvent: (e) => events.push(e),
    });
    await w.look();
    assert.equal(beats, 0, "no look before the sidecar runs");
    assert.equal(w.state(), "ok");
    await objects.put(ltx(10), "");
    w.begin();
    await w.look(); // baseline 10
    assert.equal(beats, 1);
    for (const k of await objects.list(WATCHED_REPLICA)) await objects.delete(k);
    await objects.put(ltx(3), ""); // a restore, a new bucket: lower
    t += 20;
    await w.look(); // baseline 3, no rise
    t += 20;
    beatFails = true;
    await w.look();
    assert.equal(w.state(), "stale");
    assert.deepEqual(events, [{ state: "stale", minutes: 0, reason: "heartbeat-failed" }]);
    beatFails = false;
    await objects.put(ltx(4), "");
    t += 1;
    await w.look();
    assert.equal(w.state(), "ok");
    assert.deepEqual(events.at(-1), { state: "ok", minutes: 0 });
  });

  test("stop: a look in flight at close skips its heartbeat and its event; later looks do nothing", async () => {
    const inner = memoryObjectStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const objects: ObjectStore = { ...inner, list: async (p) => (await gate, inner.list(p)) };
    let beats = 0;
    const events: UploadsEvent[] = [];
    let t = 0;
    const w = new UploadWatch({ objects, heartbeat: () => void (beats += 1), now: () => t, staleAfterMs: 1, onEvent: (e) => events.push(e) });
    w.begin();
    t = 100; // stale by the clock
    const inFlight = w.look();
    w.stop();
    release();
    await inFlight;
    await w.look();
    assert.equal(beats, 0);
    assert.deepEqual(events, []);
  });

  test("a look asked for while one is out on its LIST waits for that one: it resolves after the event, and the LIST isn't doubled", async () => {
    // The boot's look is not awaited (app.ts); a look asked for straight after must not resolve before it lands.
    const inner = memoryObjectStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let lists = 0;
    const objects: ObjectStore = { ...inner, list: async (p) => ((lists += 1), await gate, inner.list(p)) };
    const events: UploadsEvent[] = [];
    let t = 0;
    const w = new UploadWatch({ objects, heartbeat: () => undefined, now: () => t, staleAfterMs: 30 * 60_000, onEvent: (e) => events.push(e) });
    w.begin();
    const boot = w.look();
    t = 31 * 60_000;
    let settled = false;
    const asked = w.look().then(() => void (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, false, "still waiting on the boot's LIST");
    release();
    await asked;
    assert.deepEqual(events, [{ state: "stale", minutes: 31, reason: "no-rise" }]);
    await boot;
    assert.equal(lists, 1);
    await w.look(); // the next one is its own look
    assert.equal(lists, 2);
  });

  test("a look asked for just after one finished is its own look, never a join on the finished one's older clock", async () => {
    // Every microtask count between the LIST's answer and the look's promise settling: none may join the old look.
    for (let k = 0; k <= 7; k++) {
      const inner = memoryObjectStore();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      const objects: ObjectStore = { ...inner, list: async (p) => (await gate, inner.list(p)) };
      const events: UploadsEvent[] = [];
      let t = 0;
      const w = new UploadWatch({ objects, heartbeat: () => undefined, now: () => t, staleAfterMs: 30 * 60_000, onEvent: (e) => events.push(e) });
      w.begin();
      const boot = w.look();
      release();
      let p: Promise<unknown> = gate;
      for (let i = 0; i < k; i++) p = p.then(() => undefined);
      await p;
      t = 31 * 60_000;
      await w.look();
      assert.deepEqual(events, [{ state: "stale", minutes: 31, reason: "no-rise" }], `after ${String(k)} microtasks`);
      await boot;
    }
  });

  test("a prefix that throws before any await: list-failed, and the next look still runs (the slot doesn't stick)", async () => {
    let asked = 0;
    const events: UploadsEvent[] = [];
    let t = 0;
    const w = new UploadWatch({
      objects: memoryObjectStore(),
      heartbeat: () => undefined,
      prefix: () => {
        asked += 1;
        throw new Error("no control key yet");
      },
      now: () => t,
      staleAfterMs: 30 * 60_000,
      onEvent: (e) => events.push(e),
    });
    w.begin();
    t = 31 * 60_000;
    await w.look();
    assert.deepEqual(events, [{ state: "stale", minutes: 31, reason: "list-failed" }]);
    await w.look();
    assert.equal(asked, 2);
    assert.equal(events.length, 2);
  });
});

// ── A HOST'S OWN PER-TENANT DATABASES (`AppBackupOptions.tenantDatabases`; the living journal's `app/app.sqlite`) ──

const JOURNAL = "app/app.sqlite";

/** The product's own database, as the journal makes it: WAL, one row of the person's words. */
function makeJournal(tenant: string, words: string): void {
  mkdirSync(join(tenant, "app"), { recursive: true });
  const db = openDb(join(tenant, JOURNAL), { wal: true });
  db.exec("CREATE TABLE IF NOT EXISTS entries (text TEXT NOT NULL)");
  db.run("INSERT INTO entries (text) VALUES (?)", words);
  db.close();
}

/** One `- path:` entry of the configuration, by its database path: its lines up to the next entry. */
function entryOf(yml: string, dbPath: string): string | null {
  const start = yml.indexOf(`  - path: ${JSON.stringify(dbPath)}\n`);
  if (start < 0) return null;
  const next = yml.indexOf("\n  - path: ", start + 1);
  return yml.slice(start, next < 0 ? undefined : next + 1);
}

describe("a host's own per-tenant databases (backup.tenantDatabases)", () => {
  test("unset, [] and a listed database not made yet: the configuration is byte for byte what it was before the option", async () => {
    const r = await appRig();
    const { storeId: id } = await signUp(r, "same@example.com");
    const data = join(tmp.root, "data");
    const tenant = tenantDir(r.app.tenants.root, id);
    const control = (db: string): string[] => [
      `  - path: ${JSON.stringify(join(data, "control", db))}`,
      "    replica:",
      "      type: s3",
      '      bucket: "bkt"',
      `      path: "control/${db}"`,
      '      endpoint: "https://acct.r2.cloudflarestorage.com"',
      "      region: auto",
      `      sse-customer-key-path: ${JSON.stringify(join(data, "control", "litestream.key"))}`,
    ];
    const expected = [
      "# Generated by hosted/src/backup.ts. Do not edit: it is rewritten at every sign-up and delete.",
      "logging:",
      "  stderr: true",
      "snapshot:",
      "  interval: 12h",
      "  retention: 12h",
      "dbs:",
      ...control("accounts.sqlite"),
      ...control("oauth.sqlite"),
      `  - path: ${JSON.stringify(join(tenant, "store", "counterparts.sqlite"))}`,
      `    meta-path: ${JSON.stringify(join(tenant, "litestream-meta"))}`,
      "    replica:",
      "      type: s3",
      '      bucket: "bkt"',
      `      path: "tenants/${id}"`,
      '      endpoint: "https://acct.r2.cloudflarestorage.com"',
      "      region: auto",
      `      sse-customer-key-path: ${JSON.stringify(join(tenant, "litestream.key"))}`,
      "",
    ].join("\n");
    assert.equal(readFileSync(r.app.backups!.configPath, "utf8"), expected);
    // The same keys, the option given as [] and as a database the product hasn't made yet.
    const base = { dataRoot: data, keys: r.app.keys!, objects: r.objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, liveStores: () => [id] };
    assert.equal(new Backups({ ...base, tenantDatabases: [] }).config(), expected);
    assert.equal(new Backups({ ...base, tenantDatabases: [JOURNAL] }).config(), expected);
  });

  test("once the product makes it, refresh lists it: the store's own key file, a replica inside the store's prefix, its state out of the product's folder; a second refresh is a no-op", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL] });
    const { storeId: id } = await signUp(r, "journal@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    const file = join(tenant, JOURNAL);
    assert.equal(entryOf(readFileSync(r.app.backups!.configPath, "utf8"), file), null, "not listed before its file exists");
    // Nothing to pick up yet: no reload.
    const before = r.reloads();
    assert.equal(await r.app.backups!.refresh(), false);
    assert.equal(r.reloads(), before);

    makeJournal(tenant, "Tuesday: the heron came back to the pond.");
    assert.equal(await r.app.backups!.refresh(), true);
    assert.equal(r.reloads(), before + 1, "the sidecar restarted on the new configuration");
    const yml = readFileSync(r.app.backups!.configPath, "utf8");
    const store = entryOf(yml, join(tenant, "store", "counterparts.sqlite"))!;
    const entry = entryOf(yml, file)!;
    assert.ok(entry !== null, "listed once it exists");
    const keyLine = `      sse-customer-key-path: ${JSON.stringify(join(tenant, "litestream.key"))}\n`;
    assert.ok(store.includes(keyLine) && entry.includes(keyLine), "the store's own SSE-C key file, for both");
    assert.ok(entry.includes(`      path: ${JSON.stringify(`tenants/${id}/host/app/app.sqlite`)}\n`));
    assert.equal(tenantDatabasePrefix(id, JOURNAL), `tenants/${id}/host/app/app.sqlite/`);
    assert.ok(tenantDatabasePrefix(id, JOURNAL).startsWith(replicaPrefix(id)), "inside the store's replica prefix");
    assert.ok(entry.includes(`    meta-path: ${JSON.stringify(join(tenant, TENANT_DATABASES_META, JOURNAL))}\n`));
    assert.doesNotMatch(yml, /[0-9a-f]{64}/, "no key in the configuration");
    // Nothing changed: no restart.
    assert.equal(await r.app.backups!.refresh(), false);
    assert.equal(r.reloads(), before + 1);
  });

  test("the app's own timer picks up a database made after sign-up, with no call from the product", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL], finishEveryMs: 20 });
    const { storeId: id } = await signUp(r, "timer@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    makeJournal(tenant, "Wednesday: rain all day.");
    const until = Date.now() + 5_000;
    while (entryOf(readFileSync(r.app.backups!.configPath, "utf8"), join(tenant, JOURNAL)) === null) {
      assert.ok(Date.now() < until, "the timer never listed it");
      await new Promise((res) => setTimeout(res, 20));
    }
  });

  test("a store waiting for a restore streams neither its file nor the product's (an empty one made meanwhile never goes over the backup)", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL] });
    const { storeId: id } = await signUp(r, "waits@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    await r.app.tenants.withTenant(id, {}, async () => undefined);
    r.app.accounts.markOpened(id);
    await r.app.tenants.closeAll();
    rmSync(join(tenant, "store"), { recursive: true, force: true });
    makeJournal(tenant, "");
    await r.app.backups!.refresh();
    assert.doesNotMatch(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(id));
  });

  test("delete at once takes the product's replica with the store's: nothing of either is left in the bucket", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL] });
    const me = await signUp(r, "journal-gone@example.com");
    const other = await signUp(r, "journal-stays@example.com");
    for (const who of [me, other]) {
      makeJournal(tenantDir(r.app.tenants.root, who.storeId), "words");
      for (const n of [1, 2]) {
        await r.objects.put(`${replicaPrefix(who.storeId)}0000/${String(n)}.ltx`, "ciphertext");
        await r.objects.put(`${tenantDatabasePrefix(who.storeId, JOURNAL)}0000/${String(n)}.ltx`, "ciphertext");
      }
    }
    await r.app.backups!.refresh();
    const page = await (await me.browser.go("/account")).text();
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "journal-gone@example.com" })).status, 200);
    assert.deepEqual(await r.objects.list(tenantDatabasePrefix(me.storeId, JOURNAL)), []);
    assert.deepEqual(await r.objects.list(replicaPrefix(me.storeId)), []);
    assert.equal(await r.app.backups!.objectsLeft(me.storeId), 0);
    assert.equal(existsSync(tenantDir(r.app.tenants.root, me.storeId)), false);
    assert.doesNotMatch(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(me.storeId));
    // The other person's journal replica and its place in the configuration are untouched.
    assert.equal((await r.objects.list(tenantDatabasePrefix(other.storeId, JOURNAL))).length, 2);
    assert.ok(entryOf(readFileSync(r.app.backups!.configPath, "utf8"), join(tenantDir(r.app.tenants.root, other.storeId), JOURNAL)) !== null);
  });

  test("a path that escapes the tenant's dir, or is hosted's own, is refused by createApp before anything is opened", () => {
    const bad = ["../x.sqlite", "/etc/x.sqlite", "app/../../x.sqlite", "./app.sqlite", "app//x.sqlite", "app/", "", ".hidden.sqlite", "store/counterparts.sqlite", "litestream.key", "litestream-meta-host/x", "config.json", "app/app.sqlite-wal"];
    for (const rel of bad) {
      const data = join(tmp.root, `refused-${String(bad.indexOf(rel))}`);
      assert.throws(
        () =>
          createApp({
            dataRoot: data,
            publicOrigin: "http://127.0.0.1",
            mailer: memoryMailer(),
            embedder: null,
            spawner: () => ({ pid: 1 }),
            backup: { wrapper: new EnvKeyWrapper(ring("v1"), "v1"), sealer: RECOVERY.sealer, objects: memoryObjectStore(), bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, tenantDatabases: [rel] },
          }),
        /backup\.tenantDatabases/,
        rel,
      );
      assert.equal(existsSync(join(data, "control")), false, `nothing opened for ${JSON.stringify(rel)}`);
    }
    // Repeats and nesting.
    for (const list of [[JOURNAL, JOURNAL], ["app", JOURNAL]]) {
      assert.throws(() => new Backups({ dataRoot: tmp.root, keys: null as unknown as KeyStore, objects: memoryObjectStore(), sealer: RECOVERY.sealer, bucket: "b", endpoint: "e", liveStores: () => [], tenantDatabases: list }), /repeats or nests/);
    }
  });

  test("restore brings the product's database back with the store, the store's file LAST; a restore cut short leaves the store waiting, and its retry isn't refused", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL] });
    const { storeId: id } = await signUp(r, "restore-journal@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    await r.app.tenants.closeAll();
    const events: string[] = [];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys: r.app.keys!, objects: r.objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, tenantDatabases: [JOURNAL], liveStores: () => [id], openedBefore: () => true, onHostDatabase: (s, what) => void events.push(`${s} ${what}`) });
    const order: string[] = [];
    // A runner standing in for `litestream restore`: the database must be in the configuration it is given.
    const runner =
      (failOn: string | null): LitestreamRun =>
      async (args) => {
        const path = args.at(-1)!;
        const out = args[args.indexOf("-o") + 1]!;
        if (!readFileSync(args[args.indexOf("-config") + 1]!, "utf8").includes(`  - path: ${JSON.stringify(path)}\n`)) return { code: 1, stderr: "Error: database not found in config" };
        if (path === failOn) return { code: 1, stderr: "Error: cut short" };
        order.push(path);
        writeFileSync(out, `restored ${path}`);
        return { code: 0, stderr: "" };
      };
    rmSync(tenant, { recursive: true, force: true });
    const storeFile = join(tenant, "store", "counterparts.sqlite");
    const journal = join(tenant, JOURNAL);
    assert.deepEqual(backups.dbPaths(id), [storeFile, journal]);
    assert.deepEqual(backups.missingStores(), [id]);

    // Cut short on the store's file: the product's came back, the store still waits.
    await assert.rejects(backups.restore(id, runner(storeFile)), /cut short/);
    assert.ok(existsSync(journal));
    assert.equal(existsSync(storeFile), false);
    assert.deepEqual(backups.missingStores(), [id]);
    // The retry: the journal in place is KEPT, untouched (it may be live; the #834 review, B1), not refused; only the store's file comes back.
    writeFileSync(journal, "the product wrote since");
    order.length = 0;
    assert.deepEqual(await backups.restore(id, runner(null)), { restored: 1, empty: 0, kept: 1 });
    assert.deepEqual(order, [storeFile]);
    assert.equal(readFileSync(journal, "utf8"), "the product wrote since");
    assert.equal(readdirSync(join(tenant, "app")).some((n) => n.includes(".pre-restore-")), false);
    assert.deepEqual(backups.missingStores(), []);
    assert.deepEqual(events, []);
    // The store's file in place: refused as before.
    await assert.rejects(backups.restore(id, runner(null)), /already in place/);
    // --force: the journal in place is moved aside, said, and replaced.
    order.length = 0;
    assert.deepEqual(await backups.restore(id, runner(null), { force: true }), { restored: 2, empty: 0, kept: 0 });
    assert.deepEqual(order, [journal, storeFile]);
    assert.equal(readFileSync(journal, "utf8"), `restored ${journal}`);
    assert.ok(readdirSync(join(tenant, "app")).some((n) => n.startsWith("app.sqlite.pre-restore-")));
    assert.deepEqual(events, [`${id} set-aside`]);

    // Cut short on the product's database: nothing of the store is put in place.
    rmSync(tenant, { recursive: true, force: true });
    await assert.rejects(backups.restore(id, runner(journal)), /cut short/);
    assert.equal(existsSync(storeFile), false);
    assert.deepEqual(backups.missingStores(), [id]);
  });
});

describe("a host's own per-tenant databases, at RESTORE_ON_BOOT", () => {
  test("a store whose own replica is empty but whose journal's isn't: the journal comes back, the store is NOT marked opened, and it opens as new", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const r = await appRig({ tenantDatabases: [JOURNAL], wrapper });
    const { storeId: id } = await signUp(r, "journal-only@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    await r.app.close();
    const journal = join(tenant, JOURNAL);
    // `litestream restore`: the journal's replica exists, the store's doesn't (exit 0, no file).
    const runner: LitestreamRun = async (args) => {
      const path = args.at(-1)!;
      if (path === journal) writeFileSync(args[args.indexOf("-o") + 1]!, "journal bytes");
      return { code: 0, stderr: "" };
    };
    const b = createApp({
      dataRoot: join(tmp.root, "data"),
      publicOrigin: "http://127.0.0.1",
      mailer: memoryMailer(),
      embedder: null,
      spawner: () => ({ pid: 1 }),
      backup: { wrapper, sealer: RECOVERY.sealer, objects: r.objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, tenantDatabases: [JOURNAL] },
    });
    closers.push(() => b.close());
    const report = await b.start({ restore: runner });
    assert.equal(report.restored, 0, "no store came back");
    assert.equal(report.restoreFailed, 0);
    assert.equal(readFileSync(journal, "utf8"), "journal bytes");
    assert.equal(b.accounts.wasOpened(id), false, "never marked opened without its file");
    // Its next open makes it as new, beside the journal: no 503, no dead end.
    await b.tenants.withTenant(id, {}, async () => undefined);
    assert.ok(existsSync(join(tenant, "store", "counterparts.sqlite")));
  });
});

describe("a host's own per-tenant databases: a live one is never replaced (the #834 review)", () => {
  const reopen = (wrapper: EnvKeyWrapper, objects: ObjectStore, sidecar: Sidecar | null = null): App => {
    const b = createApp({
      dataRoot: join(tmp.root, "data"),
      publicOrigin: "http://127.0.0.1",
      mailer: memoryMailer(),
      embedder: null,
      spawner: () => ({ pid: 1 }),
      backup: { wrapper, sealer: RECOVERY.sealer, objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar, tenantDatabases: [JOURNAL] },
    });
    closers.push(() => b.close());
    return b;
  };

  test("B1's probe: a journal made at sign-up, its store never opened; RESTORE_ON_BOOT leaves the journal's bytes as they were", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const r = await appRig({ tenantDatabases: [JOURNAL], wrapper });
    const { storeId: id } = await signUp(r, "probe@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    const journal = join(tenant, JOURNAL);
    makeJournal(tenant, "Live words written at sign-up.");
    const before = readFileSync(journal);
    await r.app.close();
    // The bucket has an older journal; the store's own replica is empty.
    const runner: LitestreamRun = async (args) => {
      if (args.at(-1) === journal) writeFileSync(args[args.indexOf("-o") + 1]!, "an older bucket copy");
      return { code: 0, stderr: "" };
    };
    const b = reopen(wrapper, r.objects);
    assert.ok(b.backups!.missingStores().includes(id), "the never-opened store is one restore-on-boot tries");
    const report = await b.start({ restore: runner });
    assert.equal(report.restoreFailed, 0);
    assert.equal(report.restored, 0);
    assert.deepEqual(readFileSync(journal), before, "the live journal untouched");
    assert.equal(readdirSync(join(tenant, "app")).some((n) => n.includes(".pre-restore-")), false, "nothing set aside to be swept");
    assert.equal(b.storeWaiting(id), false);
  });

  test("an opened store that lost only its own file while the product kept writing: the store comes back, the journal's bytes stay", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const r = await appRig({ tenantDatabases: [JOURNAL], wrapper });
    const { storeId: id } = await signUp(r, "kept-writing@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    await r.app.tenants.withTenant(id, {}, async () => undefined);
    await r.app.tenants.closeAll();
    assert.ok(r.app.accounts.wasOpened(id));
    makeJournal(tenant, "Words written after the store's file was lost.");
    const journal = join(tenant, JOURNAL);
    const before = readFileSync(journal);
    // The store's file is lost (kept aside here, as the bucket's copy).
    const saved = join(tmp.root, "bucket-store");
    renameSync(join(tenant, "store"), saved);
    assert.equal(r.app.storeWaiting(id), true, "the product can see the store waits");
    await r.app.close();
    const runner: LitestreamRun = async (args) => {
      const path = args.at(-1)!;
      const out = args[args.indexOf("-o") + 1]!;
      if (path === journal) writeFileSync(out, "an older bucket copy");
      else {
        copyFileSync(join(saved, "counterparts.sqlite"), out);
        if (existsSync(join(saved, "counterparts.sqlite-wal"))) copyFileSync(join(saved, "counterparts.sqlite-wal"), `${out}-wal`);
      }
      return { code: 0, stderr: "" };
    };
    const b = reopen(wrapper, r.objects);
    const report = await b.start({ restore: runner });
    assert.equal(report.restoreFailed, 0);
    assert.equal(report.restored, 1);
    assert.ok(existsSync(join(tenant, "store", "counterparts.sqlite")));
    assert.deepEqual(readFileSync(journal), before, "the journal the product kept writing is untouched");
    assert.equal(b.storeWaiting(id), false);
  });

  test("refresh is a no-op until start-up has released the hold", async () => {
    let reloads = 0;
    const b = reopen(new EnvKeyWrapper(ring("v1"), "v1"), memoryObjectStore(), { reload: () => void reloads++, stop: async () => undefined });
    assert.equal(await b.backups!.refresh(), false);
    assert.equal(reloads, 0);
    await b.start();
    const after = reloads;
    assert.equal(await b.backups!.refresh(), false, "nothing changed since the start's own reload");
    assert.equal(reloads, after);
  });

  test("a host database whose folder is a symlink out of the tenant's dir is neither listed nor restored, and said once", async () => {
    const r = await appRig({ tenantDatabases: [JOURNAL] });
    const { storeId: id } = await signUp(r, "symlink@example.com");
    const tenant = tenantDir(r.app.tenants.root, id);
    const outside = join(tmp.root, "elsewhere");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(tenant, "app"));
    makeJournal(tenant, "written through a symlink");
    const events: string[] = [];
    const backups = new Backups({ dataRoot: join(tmp.root, "data"), keys: r.app.keys!, objects: r.objects, sealer: RECOVERY.sealer, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, tenantDatabases: [JOURNAL], liveStores: () => [id], onHostDatabase: (s, what) => void events.push(`${s} ${what}`) });
    assert.equal(entryOf(backups.config(), join(tenant, JOURNAL)), null);
    backups.config();
    assert.deepEqual(events, [`${id} outside`]);
    // Restore (the store's file missing): the journal through the symlink is not restored.
    rmSync(join(outside, "app.sqlite"));
    rmSync(join(tenant, "store"), { recursive: true, force: true });
    const asked: string[] = [];
    const r2 = await backups.restore(id, async (args) => {
      asked.push(args.at(-1)!);
      return { code: 0, stderr: "" };
    });
    assert.deepEqual(asked, [join(tenant, "store", "counterparts.sqlite")]);
    assert.equal(r2.kept, 1);
  });

  test("names compare case-insensitively: Store/, LITESTREAM.key, a -WAL side file are refused", () => {
    for (const rel of ["Store/counterparts.sqlite", "LITESTREAM.key", "Config.json", "app/app.sqlite-WAL"]) assert.throws(() => tenantDatabasePaths([rel]), /backup\.tenantDatabases/, rel);
    assert.throws(() => tenantDatabasePaths(["app/app.sqlite", "App/app.sqlite"]), /repeats or nests/);
  });

  test("start-over reads the store's own replica only: a product-only replica doesn't wedge it", async () => {
    const wrapper = new EnvKeyWrapper(ring("v1"), "v1");
    const r = await appRig({ tenantDatabases: [JOURNAL], wrapper });
    const { storeId: id } = await signUp(r, "start-over@example.com");
    await r.app.tenants.withTenant(id, {}, async () => undefined);
    await r.app.close();
    rmSync(join(tenantDir(r.app.tenants.root, id), "store"), { recursive: true, force: true });
    const opts: AppBackupOptions = { wrapper, sealer: RECOVERY.sealer, objects: r.objects, bucket: "bkt", endpoint: "https://acct.r2.cloudflarestorage.com", sidecar: null, tenantDatabases: [JOURNAL] };
    await r.objects.put(`${tenantDatabasePrefix(id, JOURNAL)}0000/1.ltx`, "ciphertext");
    assert.match(await startOverCommand(join(tmp.root, "data"), opts, id), /starts over/);
    await r.objects.put(`${replicaPrefix(id)}0000/1.ltx`, "ciphertext");
    await assert.rejects(startOverCommand(join(tmp.root, "data"), opts, id), /restore it instead/);
  });
});
