/**
 * OL2b: the hosted server's operations, through the real door.
 *
 *   - the restore drill: sign up, connect over OAuth, `remember` through
 *     `/mcp`, wipe the whole volume, restore from the bucket, and `recall` the
 *     words back through `/mcp` with the SAME token (the control databases
 *     came back too);
 *   - the bucket's key is never overwritten by a new one;
 *   - a store that lived and lost its files waits for a restore;
 *   - `/readyz`;
 *   - `/mcp`'s per-account limits;
 *   - the DCR sweep.
 *
 * Hermetic: a temp data root, an in-memory mailer, a local S3 stand-in on
 * 127.0.0.1 that ENFORCES SSE-C (an object put under a key is refused to a GET
 * without it), and a stand-in Litestream binary (`fixtures/litestream-standin.mjs`)
 * that proves our plumbing, not Litestream's replication. The real binary's
 * drill is a runbook step (docs/hosted/RUNBOOK.md).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as oauth from "oauth4webapi";

import { createApp, restoreControl } from "../src/app.js";
import { openDb } from "../../src/core/store/db.js";
import type { App, AppBackupOptions } from "../src/app.js";
import { Backups, CONTROL_KEY_ID, LitestreamSidecar, keyObject, litestreamRunner, replicaPrefix, tombstoneObject } from "../src/backup.js";
import { memoryMailer, r2ObjectStore } from "../src/egress.js";
import { EnvKeyWrapper, KeyStore } from "../src/keys.js";
import { controlAside, controlAsideAtStart, eventLine, overrideGuard, prepareVolume, restoreCommand, startOverCommand, storeTag } from "../src/main.js";
import { tenantDir } from "../src/tenants.js";
import { listen, rpc, tempRoot, tool } from "./helpers.js";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;
const STANDIN = fileURLToPath(new URL("./fixtures/litestream-standin.mjs", import.meta.url));

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("ops");
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

async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// ── a local S3 that enforces SSE-C ───────────────────────────────────────────

interface Stored {
  body: Buffer;
  /** The SSE-C key's MD5 it was put under, or null. */
  keyMd5: string | null;
}

async function s3StandIn(): Promise<{ base: string; objects: Map<string, Stored> }> {
  const objects = new Map<string, Stored>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    if (bucket !== "bkt") return void res.writeHead(404).end();
    const sseKey = req.headers["x-amz-server-side-encryption-customer-key"];
    const keyMd5 = typeof sseKey === "string" ? createHash("md5").update(Buffer.from(sseKey, "base64")).digest("base64") : null;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "PUT") {
        objects.set(key, { body: Buffer.concat(chunks), keyMd5 });
        return void res.writeHead(200).end();
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        return void res.writeHead(204).end();
      }
      if (key.length === 0 && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        return void res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult>${all.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      }
      const v = objects.get(key);
      if (v === undefined) return void res.writeHead(404).end();
      // SSE-C, as S3 and R2 enforce it: the same key, or nothing.
      if (v.keyMd5 !== keyMd5) return void res.writeHead(400).end("InvalidRequest: the SSE-C key does not match");
      res.writeHead(200).end(v.body);
    });
  });
  const { base, close } = await listen(server);
  closers.push(close);
  return { base, objects };
}

/** The stand-in binary, as an executable the sidecar and the runner can spawn by path. */
function standinBinary(): string {
  const bin = join(tmp.root, "litestream");
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${STANDIN}" "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const CREDS = { LITESTREAM_ACCESS_KEY_ID: "test-generated-id", LITESTREAM_SECRET_ACCESS_KEY: randomBytes(20).toString("hex") };
const litestreamEnv = (): Record<string, string> => ({ PATH: process.env["PATH"] ?? "/usr/bin:/bin", ...CREDS });

// ── a browser and claude.ai's OAuth flow, compact (oauth.test.ts has the strict one) ──

class Browser {
  readonly jar = new Map<string, string>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(target, this.base);
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie()) {
      const parts = raw.split(";").map((p) => p.trim());
      const i = parts[0]!.indexOf("=");
      const k = parts[0]!.slice(0, i);
      const v = parts[0]!.slice(i + 1);
      if (v === "" || parts.some((p) => /^max-age=0$/i.test(p) || (/^expires=/i.test(p) && Date.parse(p.slice(8)) < Date.now()))) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async form(target: string, fields: Record<string, string>): Promise<Response> {
    return this.go(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
}

/** Sign up through Allow and the token exchange: what claude.ai does. Returns the bearer and the person's store. */
async function connect(r: Rig, email: string): Promise<{ access: string; storeId: string; personId: string; clientId: string }> {
  const issuer = new URL(r.origin);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  const reg = await oauth.processDynamicClientRegistrationResponse(
    await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
  );
  const client: oauth.Client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  const verifier = oauth.generateRandomCodeVerifier();
  const resource = `${r.origin}/mcp`;
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", resource, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state: "st" }).toString();
  const browser = new Browser(r.origin);
  let res = await browser.go(authz.toString());
  const allowPath = new URL(res.headers.get("location")!, r.origin).pathname;
  res = await browser.go(allowPath);
  if (res.status === 303) {
    const form = await (await browser.go(`/login?next=${encodeURIComponent(allowPath)}`)).text();
    const { code } = r.app.accounts.createInvite();
    await browser.form("/login", { csrf: csrfOf(form), email, invite: code, tz: "America/Denver", next: allowPath });
    await browser.go(/https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0]);
    res = await browser.go(allowPath);
  }
  res = await browser.form(allowPath, { csrf: csrfOf(await res.text()), decision: "allow" });
  let loc = new URL(res.headers.get("location")!, r.origin);
  for (let i = 0; i < 5 && res.status === 303 && loc.origin !== "https://claude.ai"; i++) {
    res = await browser.go(loc.toString());
    loc = new URL(res.headers.get("location")!, r.origin);
  }
  const params = oauth.validateAuthResponse(as, client, loc, "st");
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, CALLBACK, verifier, { additionalParameters: { resource }, ...insecure }));
  const personId = r.app.accounts.sessionPerson(browser.jar.get("cp_session") ?? null)!;
  return { access: tokens.access_token, storeId: r.app.accounts.person(personId)!.storeId!, personId, clientId: client.client_id };
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

/**
 * Until the sidecar has put something under each prefix: a drill waits for its
 * backup to land before it wipes anything (and a child killed before it has
 * even loaded has no SIGTERM handler yet, real Litestream included).
 */
async function replicated(objects: Map<string, Stored>, prefixes: string[], ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!prefixes.every((p) => [...objects.keys()].some((k) => k.startsWith(p)))) {
    if (Date.now() > until) throw new Error(`not replicated: ${prefixes.join(", ")}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function rig(o: { dataRoot?: string; port?: number; backup?: AppBackupOptions; mcpLimits?: Parameters<typeof createApp>[0]["mcpLimits"]; onEvent?: Parameters<typeof createApp>[0]["onEvent"]; logForwardedFor?: (raw: string) => void; now?: () => number; start?: boolean } = {}): Promise<Rig & { port: number }> {
  const port = o.port ?? (await freePort());
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const app = createApp({
    dataRoot: o.dataRoot ?? join(tmp.root, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    ...(o.backup === undefined ? {} : { backup: o.backup }),
    ...(o.mcpLimits === undefined ? {} : { mcpLimits: o.mcpLimits }),
    ...(o.onEvent === undefined ? {} : { onEvent: o.onEvent }),
    ...(o.logForwardedFor === undefined ? {} : { logForwardedFor: o.logForwardedFor }),
    ...(o.now === undefined ? {} : { now: o.now }),
  });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((r) => {
      app.server.close(() => r());
      app.server.closeAllConnections?.();
    });
    await app.close();
  };
  closers.push(close);
  if (o.start !== false) await app.start();
  await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
  return { app, origin, mail, port, close } as Rig & { port: number; close: () => Promise<void> };
}

function backupOptions(s3: { base: string }, ring: Map<string, Buffer>, sidecar: LitestreamSidecar | null): AppBackupOptions {
  return {
    wrapper: new EnvKeyWrapper(ring, "v1"),
    objects: r2ObjectStore({ endpoint: s3.base, bucket: "bkt", accessKeyId: CREDS.LITESTREAM_ACCESS_KEY_ID, secretAccessKey: CREDS.LITESTREAM_SECRET_ACCESS_KEY }),
    bucket: "bkt",
    endpoint: s3.base,
    sidecar,
  };
}

const sidecarFor = (dataRoot: string, binary: string): LitestreamSidecar => new LitestreamSidecar({ binary, configPath: join(dataRoot, "litestream.yml"), env: litestreamEnv(), killAfterMs: 10_000 });

// ── the drill ────────────────────────────────────────────────────────────────

describe("the restore drill, through the door", () => {
  test("write through /mcp, wipe the whole volume, restore from the bucket, read the words back through /mcp with the same token", async () => {
    const s3 = await s3StandIn();
    const bin = standinBinary();
    const run = litestreamRunner(bin, litestreamEnv());
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");

    // 1. A live server with backups, a person, a memory.
    const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, sidecarFor(dataRoot, bin)) })) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(a, "drill@example.com");
    const woke = await tool(`${a.origin}/mcp`, "wake", {}, bearer(who.access));
    const saved = await tool(`${a.origin}/mcp`, "remember", { session: String(woke["session"]), text: "The drill's words: the copper kettle lives on the third shelf." }, bearer(who.access));
    assert.notEqual(saved["stored"], false);
    const keyBefore = s3.objects.get(keyObject(who.storeId))!.body.toString("utf8");
    await replicated(s3.objects, [replicaPrefix(who.storeId), "control/accounts.sqlite/", "control/oauth.sqlite/"]);
    // 2. The server stops: the sidecar's last sync on SIGTERM lands every file.
    await a.close();
    const replica = [...s3.objects.entries()].filter(([k]) => k.startsWith(replicaPrefix(who.storeId)));
    assert.ok(replica.length > 0, "the store reached the bucket");
    assert.ok(replica.every(([, v]) => v.keyMd5 !== null), "every replica object is under an SSE-C key");
    assert.ok([...s3.objects.keys()].some((k) => k.startsWith("control/accounts.sqlite/")));
    // The SSE-C key is the store's own: the control databases' is another.
    const controlMd5 = [...s3.objects.entries()].find(([k]) => k.startsWith("control/accounts.sqlite/"))![1].keyMd5;
    assert.notEqual(replica[0]![1].keyMd5, controlMd5);

    // 3. The volume is lost: everything, keys.sqlite included.
    rmSync(dataRoot, { recursive: true, force: true });

    // 4. Without RESTORE_ON_BOOT, a start on the empty volume is refused (it would replicate empty databases over the real ones).
    const backupB = backupOptions(s3, ring, sidecarFor(dataRoot, bin));
    const refused = await prepareVolume(dataRoot, backupB, null);
    assert.match(String(refused.refusal), /RESTORE_ON_BOOT=1/);
    assert.equal(existsSync(join(dataRoot, "control", "accounts.sqlite")), false);

    // 5. RESTORE_ON_BOOT: the control databases first, then the stores, then serve.
    const prepared = await prepareVolume(dataRoot, backupB, run);
    assert.match(String(prepared.restored), /^2 restored/);
    const b = await rig({ dataRoot, port: a.port, backup: backupB, start: false });
    const report = await b.app.start({ restore: run });
    assert.equal(report.restored, 1);
    assert.equal(report.needsRestore, 0);
    // The bucket's key object is the one from before: adopted, never replaced.
    assert.equal(s3.objects.get(keyObject(who.storeId))!.body.toString("utf8"), keyBefore);
    assert.equal(b.app.keys!.wrapped(who.storeId), keyBefore);

    // 6. The same token (the OAuth database came back), the same words.
    const session = String((await tool(`${b.origin}/mcp`, "wake", {}, bearer(who.access)))["session"]);
    const again = await rpc(`${b.origin}/mcp`, "tools/call", { name: "recall", arguments: { session, question: "copper kettle shelf", mode: "facts" } }, bearer(who.access));
    assert.equal(again.status, 200);
    assert.match(JSON.stringify(again.body), /copper kettle lives on the third shelf/);
    assert.equal((await fetch(`${b.origin}/readyz`)).status, 200);
  });

  test("restore by hand: one store, refused over a file in place, refused with a ring that can't open its key; nothing to restore without a key object", async () => {
    const s3 = await s3StandIn();
    const bin = standinBinary();
    const run = litestreamRunner(bin, litestreamEnv());
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");
    const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, sidecarFor(dataRoot, bin)) })) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(a, "byhand@example.com");
    const woke = await tool(`${a.origin}/mcp`, "wake", {}, bearer(who.access));
    await tool(`${a.origin}/mcp`, "remember", { session: String(woke["session"]), text: "By hand: the spare key is under the blue pot." }, bearer(who.access));
    await replicated(s3.objects, [replicaPrefix(who.storeId)]);
    await a.close();

    const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring, "v1") });
    closers.push(() => keys.close());
    const backups = new Backups({ dataRoot, keys, objects: backupOptions(s3, ring, null).objects, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [who.storeId] });
    await assert.rejects(backups.restore(who.storeId, run), /already in place/);
    // The store's dir lost; its key lost too (keys.sqlite is not replicated).
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    keys.delete(who.storeId);
    // A ring without the store's KEK can't adopt the bucket's key: refused, nothing written.
    const strangers = new KeyStore({ path: join(tmp.root, "other-keys.sqlite"), wrapper: new EnvKeyWrapper(new Map([["v1", randomBytes(32)]]), "v1") });
    closers.push(() => strangers.close());
    const wrongRing = new Backups({ dataRoot, keys: strangers, objects: backupOptions(s3, ring, null).objects, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [who.storeId] });
    await assert.rejects(wrongRing.restore(who.storeId, run), /doesn't open with the KEK ring/);
    assert.equal(strangers.wrapped(who.storeId), null);
    // The right ring: back.
    assert.deepEqual(await backups.restore(who.storeId, run), { restored: 1, empty: 0, kept: 0 });
    // A store the bucket never heard of: refused, and no key is made for it.
    const unknown = "0".repeat(32);
    await assert.rejects(backups.restore(unknown, run), /no key object/);
    assert.equal(keys.wrapped(unknown), null);

    const b = await rig({ dataRoot, port: a.port, backup: backupOptions(s3, ring, null) });
    const session = String((await tool(`${b.origin}/mcp`, "wake", {}, bearer(who.access)))["session"]);
    const back = await rpc(`${b.origin}/mcp`, "tools/call", { name: "recall", arguments: { session, question: "spare key blue pot", mode: "facts" } }, bearer(who.access));
    assert.match(JSON.stringify(back.body), /spare key is under the blue pot/);
  });

  test("restoreControl alone: the accounts and OAuth databases, under the control key adopted from the bucket", async () => {
    const s3 = await s3StandIn();
    const bin = standinBinary();
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");
    const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, sidecarFor(dataRoot, bin)) })) as Rig & { port: number; close: () => Promise<void> };
    await connect(a, "control@example.com");
    await replicated(s3.objects, ["control/accounts.sqlite/", "control/oauth.sqlite/"]);
    await a.close();
    rmSync(dataRoot, { recursive: true, force: true });
    const r = await restoreControl(dataRoot, backupOptions(s3, ring, null), litestreamRunner(bin, litestreamEnv()));
    assert.deepEqual(r, { restored: 2, empty: 0, kept: 0 });
    assert.ok(existsSync(join(dataRoot, "control", "accounts.sqlite")) && existsSync(join(dataRoot, "control", "oauth.sqlite")));
  });
});

// ── the bucket's key is the store's key ──────────────────────────────────────

describe("keys on a new volume", () => {
  test("a start with keys.sqlite lost ADOPTS each bucket key object; it never mints a new key over one", async () => {
    const s3 = await s3StandIn();
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");
    const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, null) })) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(a, "adopt@example.com");
    const storeKey = a.app.keys!.wrapped(who.storeId)!;
    const controlKey = a.app.keys!.wrapped(CONTROL_KEY_ID)!;
    const keyFile = readFileSync(join(tenantDir(a.app.tenants.root, who.storeId), "litestream.key"), "utf8");
    await a.close();
    rmSync(join(dataRoot, "keys"), { recursive: true, force: true });
    rmSync(join(tenantDir(join(dataRoot, "tenants"), who.storeId), "litestream.key"));
    const b = await rig({ dataRoot, port: a.port, backup: backupOptions(s3, ring, null) });
    assert.equal(b.app.keys!.wrapped(who.storeId), storeKey);
    assert.equal(b.app.keys!.wrapped(CONTROL_KEY_ID), controlKey);
    assert.equal(s3.objects.get(keyObject(who.storeId))!.body.toString("utf8"), storeKey);
    assert.equal(readFileSync(join(tenantDir(b.app.tenants.root, who.storeId), "litestream.key"), "utf8"), keyFile);
  });

  test("a bucket key object that is a DIFFERENT key from the one here is refused at start-up, and left alone", async () => {
    const s3 = await s3StandIn();
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");
    const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, null) })) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(a, "different@example.com");
    await a.close();
    // Someone's other key for this store id, wrapped under the same ring.
    const other = await new EnvKeyWrapper(ring, "v1").wrap(randomBytes(32), who.storeId);
    s3.objects.set(keyObject(who.storeId), { body: Buffer.from(other), keyMd5: null });
    const b = createApp({ dataRoot, publicOrigin: "http://127.0.0.1", mailer: memoryMailer(), embedder: null, spawner: () => ({ pid: 1 }), backup: backupOptions(s3, ring, null) });
    closers.push(() => b.close());
    await assert.rejects(b.start(), /different key/);
    assert.equal(s3.objects.get(keyObject(who.storeId))!.body.toString("utf8"), other);
  });
});

// ── a store that lived and lost its files ────────────────────────────────────

describe("a store whose files are gone", () => {
  test("waits for a restore: 503 with Retry-After at /mcp, and no new empty store is made in its place", async () => {
    const events: string[] = [];
    const r = (await rig({ onEvent: (name) => events.push(name) })) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(r, "lost@example.com");
    const woke = await tool(`${r.origin}/mcp`, "wake", {}, bearer(who.access));
    await tool(`${r.origin}/mcp`, "remember", { session: String(woke["session"]), text: "Lost: the ferry leaves at seven." }, bearer(who.access));
    await r.app.tenants.close(who.storeId);
    const dir = tenantDir(r.app.tenants.root, who.storeId);
    rmSync(dir, { recursive: true, force: true });
    const res = await rpc(`${r.origin}/mcp`, "tools/call", { name: "recall", arguments: { question: "ferry" } }, bearer(who.access));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "300");
    assert.equal(existsSync(dir), false);
    assert.deepEqual(events, ["store.needs-restore"]);
    // A new person's first call still makes their store.
    const fresh = await connect(r, "fresh@example.com");
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(fresh.access))).status, 200);
  });
});

// ── /readyz ──────────────────────────────────────────────────────────────────

describe("/readyz", () => {
  test("503 before start-up, 200 after; 503 while the sidecar is down; the body names checks, never a store id or a key", async () => {
    const s3 = await s3StandIn();
    const bin = standinBinary();
    const ring = new Map([["v1", randomBytes(32)]]);
    const dataRoot = join(tmp.root, "volume");
    const sidecar = sidecarFor(dataRoot, bin);
    const r = (await rig({ dataRoot, backup: backupOptions(s3, ring, sidecar), start: false })) as Rig & { port: number; close: () => Promise<void> };
    const before = await fetch(`${r.origin}/readyz`);
    assert.equal(before.status, 503);
    assert.equal(((await before.json()) as { checks: Record<string, string> }).checks["started"], "starting");
    await r.app.start();
    const who = await connect(r, "ready@example.com");
    const ok = await fetch(`${r.origin}/readyz`);
    const body = await ok.text();
    assert.equal(ok.status, 200, body);
    assert.deepEqual(JSON.parse(body), { ready: true, checks: { started: "ok", control: "ok", keys: "ok", backups: "ok" } });
    assert.doesNotMatch(body, new RegExp(who.storeId));
    for (const k of ring.values()) assert.ok(!body.includes(k.toString("base64")));
    assert.equal((await fetch(`${r.origin}/readyz`, { method: "HEAD" })).status, 200);
    await sidecar.stop();
    const down = await fetch(`${r.origin}/readyz`);
    assert.equal(down.status, 503);
    assert.equal(((await down.json()) as { checks: Record<string, string> }).checks["backups"], "down");
  });

  test("with backups off, ready once started: backups and keys say off; the first deploy's hop check logs the raw X-Forwarded-For", async () => {
    const seen: string[] = [];
    const r = await rig({ logForwardedFor: (raw) => seen.push(raw) });
    const res = await fetch(`${r.origin}/readyz`, { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.2" } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ready: true, checks: { started: "ok", control: "ok", keys: "off", backups: "off" } });
    await fetch(`${r.origin}/readyz`);
    assert.deepEqual(seen, ["203.0.113.7, 10.0.0.2", "(none)"]);
  });
});

// ── /mcp's limits ────────────────────────────────────────────────────────────

describe("/mcp's limits, per account", () => {
  test("calls a minute: the next tools/call is a tool refusal the model can relay; initialize and tools/list don't count; another account is unaffected", async () => {
    const events: string[] = [];
    const r = await rig({ mcpLimits: { perMinute: 3 }, onEvent: (name) => events.push(name) });
    const one = await connect(r, "busy@example.com");
    const two = await connect(r, "calm@example.com");
    const url = `${r.origin}/mcp`;
    for (let i = 0; i < 5; i++) assert.equal((await rpc(url, "tools/list", {}, bearer(one.access))).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await rpc(url, "tools/call", { name: "status", arguments: {} }, bearer(one.access))).body["error"], undefined);
    const refused = await rpc(url, "tools/call", { name: "status", arguments: {} }, bearer(one.access));
    assert.equal(refused.status, 200);
    const result = refused.body["result"] as { isError: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] };
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent["reason"], "rate-limited");
    assert.equal(result.structuredContent["retryAfterSeconds"], 60);
    assert.match(String(result.structuredContent["message"]), /Nothing was lost\. Try again in about a minute/);
    assert.match(result.content[0]!.text, /rate-limited/);
    assert.deepEqual(events, ["limit.rate-limited"]);
    const other = await rpc(url, "tools/call", { name: "status", arguments: {} }, bearer(two.access));
    assert.notEqual((other.body["result"] as { isError?: boolean }).isError, true);
  });

  test("the size quota: over it, remember refuses as store-full; recall, status and reading the self page still work", async () => {
    const r = await rig({ mcpLimits: { quotaBytes: 1 } });
    const who = await connect(r, "full@example.com");
    const url = `${r.origin}/mcp`;
    const woke = await tool(url, "wake", {}, bearer(who.access));
    const session = String(woke["session"]);
    const full = await rpc(url, "tools/call", { name: "remember", arguments: { session, text: "This would not fit." } }, bearer(who.access));
    const result = full.body["result"] as { isError: boolean; structuredContent: Record<string, unknown> };
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent["reason"], "store-full");
    assert.match(String(result.structuredContent["message"]), /recall still works/);
    for (const [name, args] of [["recall", { session, question: "anything" }], ["status", {}], ["self_page", {}]] as const) {
      const ok = await rpc(url, "tools/call", { name, arguments: args }, bearer(who.access));
      assert.notEqual((ok.body["result"] as { structuredContent?: { reason?: string } }).structuredContent?.reason, "store-full", name);
    }
    const write = await rpc(url, "tools/call", { name: "self_page", arguments: { body: "## Core\nA page." } }, bearer(who.access));
    assert.equal((write.body["result"] as { structuredContent: { reason: string } }).structuredContent.reason, "store-full");
  });

  test("in flight: a POST past the cap for one account is a 429 with Retry-After (8 by default; 1 here)", async () => {
    const events: string[] = [];
    const r = await rig({ mcpLimits: { inFlight: 1 }, onEvent: (name) => events.push(name) });
    const who = await connect(r, "flying@example.com");
    // One POST held open mid-body (a raw socket: the headers go now, the body never ends), then a second for the same account.
    const { connect: dial } = await import("node:net");
    const held = dial(r.port, "127.0.0.1");
    held.on("error", () => undefined);
    held.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nAuthorization: Bearer ${who.access}\r\nContent-Length: 1000\r\n\r\n{`);
    await new Promise((res) => setTimeout(res, 300));
    const second = await rpc(`${r.origin}/mcp`, "tools/list", {}, bearer(who.access));
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "5");
    assert.deepEqual(events, ["limit.in-flight"]);
    // The held one finishes its body and is answered (an abort is the next describe's case).
    const answered = new Promise<string>((res) => held.once("data", (d: Buffer) => res(d.toString("utf8"))));
    held.write(`${" ".repeat(998)}}`);
    assert.match(await answered, /^HTTP\/1\.1 /);
    held.destroy();
    // And with nothing in flight, the account is served again.
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", {}, bearer(who.access))).status, 200);
  });
});

// ── the DCR sweep ────────────────────────────────────────────────────────────

describe("the DCR client sweep", () => {
  test("a registered client nobody ever allowed goes after the window; one that was allowed stays, even after a disconnect", async () => {
    const r = await rig();
    const used = await connect(r, "sweep@example.com");
    const reg = await fetch(`${r.origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
    assert.equal(reg.status, 201);
    const unused = ((await reg.json()) as { client_id: string }).client_id;
    const store = r.app.oauth.store;
    const clients = (): string[] => store.db.all<{ key: string }>("SELECT key FROM oidc WHERE model = 'Client'").map((x) => x.key).sort();
    assert.deepEqual(clients(), [used.clientId, unused].sort());
    // Inside the window: nothing goes.
    assert.equal(store.sweepClients(), 0);
    // Disconnect the used one: it was allowed once, so it stays.
    for (const c of await r.app.oauth.connections.list(used.personId)) await r.app.oauth.connections.disconnect(used.personId, c.id);
    // Past the window (a negative age puts the cutoff in the future): the never-used one goes, with its registration token.
    assert.ok(store.db.all("SELECT key FROM oidc WHERE model = 'RegistrationAccessToken'").length >= 1);
    assert.equal(store.sweepClients(-60_000), 1);
    assert.deepEqual(clients(), [used.clientId]);
    assert.equal(store.db.all<{ payload: string }>("SELECT payload FROM oidc WHERE model = 'RegistrationAccessToken'").filter((x) => x.payload.includes(unused)).length, 0);
    // The swept client is unknown now.
    const gone = await fetch(`${r.origin}/oauth/authorize?client_id=${encodeURIComponent(unused)}&redirect_uri=${encodeURIComponent(CALLBACK)}&response_type=code&scope=memory&code_challenge=x&code_challenge_method=S256`, { redirect: "manual" });
    assert.notEqual(gone.status, 303);
  });
});

// ── the review's awkward states (#OL2b review) ───────────────────────────────

/** A person with a memory, replicated to the bucket, server stopped: the starting point of every awkward restore. */
async function livedStore(): Promise<{ s3: Awaited<ReturnType<typeof s3StandIn>>; bin: string; ring: Map<string, Buffer>; dataRoot: string; port: number; who: Awaited<ReturnType<typeof connect>> }> {
  const s3 = await s3StandIn();
  const bin = standinBinary();
  const ring = new Map([["v1", randomBytes(32)]]);
  const dataRoot = join(tmp.root, "volume");
  const a = (await rig({ dataRoot, backup: backupOptions(s3, ring, sidecarFor(dataRoot, bin)) })) as Rig & { port: number; close: () => Promise<void> };
  const who = await connect(a, "awkward@example.com");
  const woke = await tool(`${a.origin}/mcp`, "wake", {}, bearer(who.access));
  await tool(`${a.origin}/mcp`, "remember", { session: String(woke["session"]), text: "Awkward: the gate code is the year the oak was planted." }, bearer(who.access));
  await replicated(s3.objects, [replicaPrefix(who.storeId), "control/accounts.sqlite/", "control/oauth.sqlite/"]);
  await a.close();
  return { s3, bin, ring, dataRoot, port: a.port, who };
}


describe("restore, when things go wrong", () => {
  test("a store dir left behind with NO database (a restore that failed or found nothing) still waits: 503, and no empty database is made", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    const storeDir = join(tenantDir(join(dataRoot, "tenants"), who.storeId), "store");
    for (const f of ["counterparts.sqlite", "counterparts.sqlite-wal", "counterparts.sqlite-shm"]) rmSync(join(storeDir, f), { force: true });
    assert.ok(existsSync(storeDir));
    const b = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null) });
    const res = await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access));
    assert.equal(res.status, 503);
    assert.equal(existsSync(join(storeDir, "counterparts.sqlite")), false);
  });

  test("one store's restore failing at boot leaves it waiting and starts everyone else", async () => {
    const { s3, bin, ring, dataRoot, port, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const real = litestreamRunner(bin, litestreamEnv());
    const failing: typeof real = async (args) => (args.at(-1)!.includes(who.storeId) ? { code: 1, stderr: "standin: the bucket answered 500" } : real(args));
    const b = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null), start: false });
    const report = await b.app.start({ restore: failing });
    assert.equal(report.restoreFailed, 1);
    assert.equal(report.needsRestore, 1);
    assert.equal((await fetch(`${b.origin}/readyz`)).status, 200);
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 503);
  });

  test("an empty volume where an invite made accounts.sqlite is refused (it isn't the bucket's); so is the invite itself", async () => {
    const { s3, bin, ring, dataRoot } = await livedStore();
    rmSync(dataRoot, { recursive: true, force: true });
    // What `invite` would leave: a new, empty accounts database, and no control key here.
    const { Accounts } = await import("../src/accounts.js");
    new Accounts({ path: join(dataRoot, "control", "accounts.sqlite") }).close();
    const backup = backupOptions(s3, ring, null);
    for (const run of [null, litestreamRunner(bin, litestreamEnv())]) {
      const p = await prepareVolume(dataRoot, backup, run);
      assert.match(String(p.refusal), /not the key that wrote the bucket's backups/);
    }
    // After moving control/ aside, RESTORE_ON_BOOT restores both.
    rmSync(join(dataRoot, "control"), { recursive: true, force: true });
    assert.match(String((await prepareVolume(dataRoot, backup, litestreamRunner(bin, litestreamEnv()))).restored), /^2 restored/);
  });

  test("a control restore cut short after accounts: the missing oauth.sqlite is restored ALONE, never made empty; accounts.sqlite is kept", async () => {
    const { s3, bin, ring, dataRoot } = await livedStore();
    rmSync(join(dataRoot, "control", "oauth.sqlite"), { force: true });
    rmSync(join(dataRoot, "control", "oauth.sqlite-wal"), { force: true });
    const accountsBefore = readFileSync(join(dataRoot, "control", "accounts.sqlite"));
    const backup = backupOptions(s3, ring, null);
    assert.match(String((await prepareVolume(dataRoot, backup, null)).refusal), /1 of the control databases are missing/);
    assert.match(String((await prepareVolume(dataRoot, backup, litestreamRunner(bin, litestreamEnv()))).restored), /^1 restored, 1 already here/);
    assert.ok(existsSync(join(dataRoot, "control", "oauth.sqlite")));
    assert.deepEqual(readFileSync(join(dataRoot, "control", "accounts.sqlite")), accountsBefore);
  });

  test("--force moves the file in place aside (never deletes it), and drops Litestream's position for it", async () => {
    const { s3, bin, ring, dataRoot, who } = await livedStore();
    const storeDir = join(tenantDir(join(dataRoot, "tenants"), who.storeId), "store");
    const meta = join(storeDir, ".counterparts.sqlite-litestream");
    writeFileSync(join(storeDir, "marker-only"), "");
    rmSync(join(storeDir, "marker-only"));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(meta, { recursive: true });
    const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring, "v1") });
    closers.push(() => keys.close());
    const backups = new Backups({ dataRoot, keys, objects: backupOptions(s3, ring, null).objects, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [who.storeId] });
    const before = readFileSync(join(storeDir, "counterparts.sqlite"));
    assert.equal((await backups.restore(who.storeId, litestreamRunner(bin, litestreamEnv()), { force: true })).restored, 1);
    const { readdirSync } = await import("node:fs");
    const aside = readdirSync(storeDir).filter((n) => n.startsWith("counterparts.sqlite.pre-restore-"));
    assert.equal(aside.length, 1);
    assert.deepEqual(readFileSync(join(storeDir, aside[0]!)), before);
    assert.equal(existsSync(meta), false);
  });

  test("a store that lived, whose key is gone here AND in the bucket, is never given a new key; the start goes on", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    rmSync(join(dataRoot, "keys"), { recursive: true, force: true });
    s3.objects.delete(keyObject(who.storeId));
    const b = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null), start: false });
    const report = await b.app.start();
    assert.equal(report.keyless, 1);
    assert.equal(b.app.keys!.wrapped(who.storeId), null);
    assert.equal(s3.objects.has(keyObject(who.storeId)), false);
  });

  test("a store from before opened_at (the mark NULL) is marked at the next start, so the guard covers it", async () => {
    const r = (await rig()) as Rig & { port: number; close: () => Promise<void> };
    const who = await connect(r, "older@example.com");
    await tool(`${r.origin}/mcp`, "wake", {}, bearer(who.access));
    const dataRoot = join(tmp.root, "data");
    await r.close();
    const db = openDb(join(dataRoot, "control", "accounts.sqlite"), { wal: true });
    db.run("UPDATE stores SET opened_at = NULL");
    db.close();
    const b = await rig({ dataRoot, port: r.port });
    assert.equal(b.app.accounts.wasOpened(who.storeId), true);
  });
});

describe("limits, the review's cases", () => {
  test("initialize doesn't count against the calls; an aborted mid-body POST gives its in-flight slot back", async () => {
    const r = (await rig({ mcpLimits: { perMinute: 1, inFlight: 1 } })) as Rig & { port: number };
    const who = await connect(r, "abort@example.com");
    const url = `${r.origin}/mcp`;
    for (let i = 0; i < 3; i++) assert.equal((await rpc(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, bearer(who.access))).status, 200);
    const first = await rpc(url, "tools/call", { name: "status", arguments: {} }, bearer(who.access));
    assert.notEqual((first.body["result"] as { isError?: boolean }).isError, true);
    const { connect: dial } = await import("node:net");
    for (let i = 0; i < 3; i++) {
      const s = dial(r.port, "127.0.0.1");
      s.on("error", () => undefined);
      s.write(`POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nAuthorization: Bearer ${who.access}\r\nContent-Length: 1000\r\n\r\n{`);
      await new Promise((res) => setTimeout(res, 100));
      s.destroy();
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.equal((await rpc(url, "tools/list", {}, bearer(who.access))).status, 200);
  });
});

describe("the DCR sweep, on an older database", () => {
  test("a client with a live grant but no client_use row (a database from before the table) is kept", async () => {
    const r = await rig();
    const used = await connect(r, "olddb@example.com");
    const store = r.app.oauth.store;
    store.db.run("DELETE FROM client_use");
    assert.equal(store.sweepClients(-60_000), 0);
    assert.ok(store.db.get("SELECT 1 AS one FROM oidc WHERE model = 'Client' AND key = ?", used.clientId) !== undefined);
  });
});

// ── the #653 review (independent, high) ──────────────────────────────────────

describe("#653 review: restores and deletes", () => {
  test("H1: `restore control` on a lost volume where an invite made accounts.sqlite refuses, and adopts no key", async () => {
    const { s3, bin, ring, dataRoot } = await livedStore();
    rmSync(dataRoot, { recursive: true, force: true });
    const { Accounts } = await import("../src/accounts.js");
    const fake = new Accounts({ path: join(dataRoot, "control", "accounts.sqlite") });
    fake.createInvite();
    fake.close();
    const backup = backupOptions(s3, ring, null);
    const run = litestreamRunner(bin, litestreamEnv());
    await assert.rejects(restoreControl(dataRoot, backup, run, { missingOnly: true }), /not the key that wrote the bucket's backups/);
    // The CLI's own path (restore control, restore --all) goes through the same refusal.
    await assert.rejects(restoreCommand(dataRoot, backup, run, ["control"], null), /not the key that wrote/);
    await assert.rejects(restoreCommand(dataRoot, backup, run, ["--all"], null), /not the key that wrote/);
    assert.equal(existsSync(join(dataRoot, "control", "oauth.sqlite")), false);
    const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring, "v1") });
    closers.push(() => keys.close());
    assert.equal(keys.wrapped(CONTROL_KEY_ID), null, "no control key adopted beside a kept foreign file");
    // So the next serve still refuses.
    assert.match(String((await prepareVolume(dataRoot, backup, null)).refusal), /not the key that wrote/);
  });

  test("M1: an account deleted while the sidecar was down, then the volume lost: the restore's start finishes the delete (the tombstone), the email is gone", async () => {
    const { s3, bin, ring, dataRoot, port, who } = await livedStore();
    // The delete runs with no sidecar: the bucket's accounts.sqlite still says active.
    const down = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null) });
    await down.app.deleteAccount(who.personId);
    assert.ok(s3.objects.has(tombstoneObject(who.storeId)));
    assert.equal(s3.objects.has(keyObject(who.storeId)), false);
    assert.doesNotMatch(String(s3.objects.get(tombstoneObject(who.storeId))!.body), /@/);
    await (down as unknown as { close: () => Promise<void> }).close();
    rmSync(dataRoot, { recursive: true, force: true });
    const run = litestreamRunner(bin, litestreamEnv());
    const backup = backupOptions(s3, ring, null);
    await prepareVolume(dataRoot, backup, run);
    const b = await rig({ dataRoot, port, backup, start: false });
    assert.equal(b.app.accounts.person(who.personId)!.state, "active", "the restored accounts database predates the delete");
    const report = await b.app.start({ restore: run });
    assert.equal(report.tombstoned, 1);
    const person = b.app.accounts.person(who.personId)!;
    assert.equal(person.state, "deleted");
    assert.equal(person.email, null);
    assert.equal(b.app.keys!.wrapped(who.storeId), null, "no key made for it");
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 401);
  });

  test("M1: the restore CLI never restores a store the bucket has a tombstone for", async () => {
    const { s3, bin, ring, dataRoot, who } = await livedStore();
    s3.objects.set(tombstoneObject(who.storeId), { body: Buffer.from("2026-10-26T00:00:00.000Z\n"), keyMd5: null });
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const out = await restoreCommand(dataRoot, backupOptions(s3, ring, null), litestreamRunner(bin, litestreamEnv()), ["--all"], null);
    assert.match(out.text, /deleted \(the bucket has its tombstone\)/);
    assert.match(out.text, /stores: 0 restored/);
    assert.equal(existsSync(join(tenantDir(join(dataRoot, "tenants"), who.storeId), "store", "counterparts.sqlite")), false);
  });

  test("M2: a delete made with backups off leaves its key object and replica in the bucket; the next start with backups removes them", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    const off = await rig({ dataRoot, port });
    await off.app.deleteAccount(who.personId);
    await (off as unknown as { close: () => Promise<void> }).close();
    assert.ok(s3.objects.has(keyObject(who.storeId)));
    assert.ok([...s3.objects.keys()].some((k) => k.startsWith(replicaPrefix(who.storeId))));
    const on = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null), start: false });
    const report = await on.app.start();
    assert.equal(report.leftovers, 1);
    assert.equal(s3.objects.has(keyObject(who.storeId)), false);
    assert.equal([...s3.objects.keys()].some((k) => k.startsWith(replicaPrefix(who.storeId))), false);
    assert.ok(s3.objects.has(tombstoneObject(who.storeId)));
  });

  test("M4: the sidecar's configuration leaves out a store that lived and has no database, and keeps one never opened", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const b = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null) });
    const fresh = await connect(b, "never-opened@example.com");
    const config = readFileSync(b.app.backups!.configPath, "utf8");
    assert.doesNotMatch(config, new RegExp(who.storeId));
    assert.match(config, new RegExp(fresh.storeId));
  });

  test("L1: the marker is written and the cache dropped BEFORE the file moves in: a move that fails leaves the marker", async () => {
    const { s3, bin, ring, dataRoot, who } = await livedStore();
    const storeDir = join(tenantDir(join(dataRoot, "tenants"), who.storeId), "store");
    for (const f of ["counterparts.sqlite", "counterparts.sqlite-wal", "counterparts.sqlite-shm"]) rmSync(join(storeDir, f), { force: true });
    rmSync(join(storeDir, "cache"), { recursive: true, force: true });
    const real = litestreamRunner(bin, litestreamEnv());
    const { chmodSync: chmod } = await import("node:fs");
    // Litestream writes its output, then the store dir turns read-only: the move into place fails.
    const thenStuck: typeof real = async (args) => {
      const r = await real(args);
      chmod(storeDir, 0o500);
      return r;
    };
    closers.push(() => chmod(storeDir, 0o700));
    const keys = new KeyStore({ path: join(dataRoot, "keys", "keys.sqlite"), wrapper: new EnvKeyWrapper(ring, "v1") });
    closers.push(() => keys.close());
    const backups = new Backups({ dataRoot, keys, objects: backupOptions(s3, ring, null).objects, bucket: "bkt", endpoint: s3.base, sidecar: null, liveStores: () => [who.storeId] });
    await assert.rejects(backups.restore(who.storeId, thenStuck));
    assert.ok(existsSync(join(tenantDir(join(dataRoot, "tenants"), who.storeId), "restored.marker")));
  });

  test("L2: a pending delete finished at start-up does not start the sidecar before the restores run", async () => {
    const { s3, bin, ring, dataRoot, port, who } = await livedStore();
    // A second person, deleted part-way (state deleting), and the first person's store lost.
    const b0 = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null) });
    const other = await connect(b0, "pending@example.com");
    b0.app.accounts.markDeleting(other.personId);
    await (b0 as unknown as { close: () => Promise<void> }).close();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const order: string[] = [];
    const real = litestreamRunner(bin, litestreamEnv());
    const run: typeof real = async (args) => {
      order.push("restore");
      return real(args);
    };
    const b = await rig({ dataRoot, port, backup: { ...backupOptions(s3, ring, null), sidecar: { reload: () => void order.push("sidecar"), stop: async () => undefined } }, start: false });
    const report = await b.app.start({ restore: run });
    assert.equal(report.restored, 1);
    assert.deepEqual(order, ["restore", "sidecar"]);
    assert.equal(b.app.accounts.person(other.personId)!.state, "deleted");
  });

  test("L5: the restore CLI names a failing store by its tag, never its id", async () => {
    const { s3, ring, dataRoot, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const failing = async (): Promise<{ code: number; stderr: string }> => ({ code: 1, stderr: "standin: the bucket answered 500" });
    const out = await restoreCommand(dataRoot, backupOptions(s3, ring, null), failing, ["--all"], null);
    assert.equal(out.failed, 1);
    assert.doesNotMatch(out.text, new RegExp(who.storeId));
    assert.match(out.text, new RegExp(storeTag(who.storeId)));
  });

  test("L8: start-over frees a store that lived and never reached the bucket; refused while the bucket has a replica", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    const backup = backupOptions(s3, ring, null);
    await assert.rejects(startOverCommand(dataRoot, backup, who.storeId), /restore it instead/);
    for (const k of [...s3.objects.keys()]) if (k.startsWith(replicaPrefix(who.storeId))) s3.objects.delete(k);
    assert.match(await startOverCommand(dataRoot, backup, who.storeId), /starts over/);
    const b = await rig({ dataRoot, port, backup });
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 200);
  });
});

describe("#653 review: limits", () => {
  test("L3: over the quota, self_page with `summary` is a write and refused; a plain read still works", async () => {
    const r = await rig({ mcpLimits: { quotaBytes: 1 } });
    const who = await connect(r, "summary@example.com");
    const url = `${r.origin}/mcp`;
    await tool(url, "wake", {}, bearer(who.access));
    const summary = await rpc(url, "tools/call", { name: "self_page", arguments: { summary: "A new summary." } }, bearer(who.access));
    assert.equal((summary.body["result"] as { structuredContent: { reason: string } }).structuredContent.reason, "store-full");
    const read = await rpc(url, "tools/call", { name: "self_page", arguments: { ifVersion: -1 } }, bearer(who.access));
    assert.notEqual((read.body["result"] as { structuredContent?: { reason?: string } }).structuredContent?.reason, "store-full");
  });
});

// ── the #653 re-review ───────────────────────────────────────────────────────

describe("#653 re-review", () => {
  test("N1: start-over on a RUNNING server: the new store gets its key and a place in the sidecar's configuration at its first call", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    for (const k of [...s3.objects.keys()]) if (k.startsWith(replicaPrefix(who.storeId))) s3.objects.delete(k);
    let reloads = 0;
    const backup = { ...backupOptions(s3, ring, null), sidecar: { reload: () => void reloads++, stop: async () => undefined } };
    const b = await rig({ dataRoot, port, backup });
    assert.doesNotMatch(readFileSync(b.app.backups!.configPath, "utf8"), new RegExp(who.storeId));
    const before = reloads;
    // The operator, in the running container.
    assert.match(await startOverCommand(dataRoot, backupOptions(s3, ring, null), who.storeId), /starts over/);
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 200);
    const until = Date.now() + 5000;
    while (!readFileSync(b.app.backups!.configPath, "utf8").includes(who.storeId) && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    assert.match(readFileSync(b.app.backups!.configPath, "utf8"), new RegExp(who.storeId));
    assert.ok(reloads > before, "the sidecar was reloaded onto it");
    assert.ok(existsSync(join(tenantDir(b.app.tenants.root, who.storeId), "litestream.key")));
    assert.equal(b.app.accounts.wasOpened(who.storeId), true);
  });

  test("N3: start-over refuses a store the bucket has a tombstone for", async () => {
    const { s3, ring, dataRoot, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    for (const k of [...s3.objects.keys()]) if (k.startsWith(replicaPrefix(who.storeId))) s3.objects.delete(k);
    s3.objects.set(tombstoneObject(who.storeId), { body: Buffer.from("2026-10-26T00:00:00.000Z\n"), keyMd5: null });
    await assert.rejects(startOverCommand(dataRoot, backupOptions(s3, ring, null), who.storeId), /tombstone/);
  });

  test("N2: one deleted store whose leftovers can't be checked is audited and skipped; the start goes on", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    const off = await rig({ dataRoot, port });
    await off.app.deleteAccount(who.personId);
    await (off as unknown as { close: () => Promise<void> }).close();
    const base = backupOptions(s3, ring, null);
    const stuck = { ...base.objects, list: async (prefix: string) => (prefix === replicaPrefix(who.storeId) ? Promise.reject(new Error("R2 500")) : base.objects.list(prefix)) };
    const b = await rig({ dataRoot, port, backup: { ...base, objects: stuck }, start: false });
    const report = await b.app.start();
    assert.equal(report.leftovers, 0);
    assert.ok(b.app.accounts.auditOf(who.personId).some((a) => a.action === "delete.leftovers.failed"));
    assert.equal((await fetch(`${b.origin}/readyz`)).status, 200);
  });

  test("N4: a delete that ran with backups on is not checked again at every start", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    const on = await rig({ dataRoot, port, backup: backupOptions(s3, ring, null) });
    await on.app.deleteAccount(who.personId);
    await (on as unknown as { close: () => Promise<void> }).close();
    const base = backupOptions(s3, ring, null);
    const asked: string[] = [];
    const watched = { ...base.objects, get: async (k: string) => (asked.push(k), base.objects.get(k)), list: async (p: string) => (asked.push(p), base.objects.list(p)) };
    const b = await rig({ dataRoot, port, backup: { ...base, objects: watched }, start: false });
    await b.app.start();
    assert.equal(asked.filter((k) => k.includes(who.storeId)).length, 0, asked.join(", "));
  });

  test("N5: copies set aside (control.aside-*, *.pre-restore-*) are deleted at a start once they are a day old, kept before", async () => {
    const dataRoot = join(tmp.root, "data");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dataRoot, "control.aside-1"), { recursive: true });
    writeFileSync(join(dataRoot, "control.aside-1", "accounts.sqlite"), "an address lived here");
    mkdirSync(join(dataRoot, "control"), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(dataRoot, "control", `accounts.sqlite.pre-restore-${stamp}`), "x");
    const fresh = await rig({ dataRoot });
    assert.equal((await fresh.app.start()).asideSwept, 0);
    assert.ok(existsSync(join(dataRoot, "control.aside-1")));
    await (fresh as unknown as { close: () => Promise<void> }).close();
    const later = await rig({ dataRoot, now: () => Date.now() + 2 * 24 * 60 * 60 * 1000, start: false });
    assert.equal((await later.app.start()).asideSwept, 2);
    assert.equal(existsSync(join(dataRoot, "control.aside-1")), false);
    assert.equal(existsSync(join(dataRoot, "control", `accounts.sqlite.pre-restore-${stamp}`)), false);
  });
});

// ── R3: the #653 final check's two LOWs ──────────────────────────────────────

describe("R3: CONTROL_ASIDE is one-shot; backup.ensure.failed reaches the log", () => {
  test("CONTROL_ASIDE moves control/ once per label, on a refusing volume: a restart, the day-old sweep and a second incident move nothing; a new label re-arms it", async () => {
    const { s3, bin, ring, dataRoot, port, who } = await livedStore();
    // Only keys.sqlite lost: the start refuses (it can't tell this control/ from an invite's), naming the variables.
    rmSync(join(dataRoot, "keys"), { recursive: true, force: true });
    const backup = backupOptions(s3, ring, null);
    const run = litestreamRunner(bin, litestreamEnv());
    const refusal = String((await prepareVolume(dataRoot, backup, run)).refusal);
    assert.match(refusal, /not the key that wrote the bucket's backups/);
    assert.match(refusal, /CONTROL_ASIDE=<new label> and RESTORE_ON_BOOT=1/);
    const before = readFileSync(join(dataRoot, "control", "accounts.sqlite"));

    // Deploy 1, CONTROL_ASIDE=1 + RESTORE_ON_BOOT=1: what `serve` runs, in its order.
    assert.match(((await controlAsideAtStart(dataRoot, "1", backup)) as { line: string }).line, /moved control\/ to control\.aside-1/);
    assert.deepEqual(readFileSync(join(dataRoot, "control.aside-1", "accounts.sqlite")), before);
    assert.match(readFileSync(overrideGuard(dataRoot, "1"), "utf8"), /^moved \d{4}-/);
    assert.match(String((await prepareVolume(dataRoot, backup, run)).restored), /^2 restored/);
    const a = await rig({ dataRoot, port, backup, start: false });
    await a.app.start({ restore: run });
    // The same token works: the bucket's control databases are the ones in place.
    assert.equal((await rpc(`${a.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 200);
    await (a as unknown as { close: () => Promise<void> }).close();

    // A crash-restart of the same deploy: the restored control/ stays.
    assert.match(((await controlAsideAtStart(dataRoot, "1", backup)) as { line: string }).line, /used once already: nothing moved/);
    assert.ok(existsSync(join(dataRoot, "control", "accounts.sqlite")));

    // Two days on, the override forgotten: the start's sweep deletes the copy, never the guard.
    const later = await rig({ dataRoot, port, backup, now: () => Date.now() + 2 * 24 * 60 * 60 * 1000, start: false });
    assert.equal((await later.app.start()).asideSwept, 1);
    assert.equal(existsSync(join(dataRoot, "control.aside-1")), false);
    assert.ok(existsSync(overrideGuard(dataRoot, "1")));
    await (later as unknown as { close: () => Promise<void> }).close();
    const restored = readFileSync(join(dataRoot, "control", "accounts.sqlite"));

    // A second incident (keys.sqlite lost again) with CONTROL_ASIDE=1 still set: nothing moves, the start refuses.
    rmSync(join(dataRoot, "keys"), { recursive: true, force: true });
    assert.match(((await controlAsideAtStart(dataRoot, "1", backup)) as { line: string }).line, /used once already: nothing moved/);
    assert.deepEqual(readFileSync(join(dataRoot, "control", "accounts.sqlite")), restored);
    assert.equal(existsSync(join(dataRoot, "control.aside-1")), false);
    assert.match(String((await prepareVolume(dataRoot, backup, null)).refusal), /not the key that wrote/);

    // Re-armed on purpose, with a new label.
    assert.match(((await controlAsideAtStart(dataRoot, "2", backup)) as { line: string }).line, /moved control\/ to control\.aside-2/);
    assert.deepEqual(readFileSync(join(dataRoot, "control.aside-2", "accounts.sqlite")), restored);
  });

  test("CONTROL_ASIDE on a volume with good control/ and no keys/, beside a bucket with no control key (the #655 review): nothing moves, no guard, the start goes on", async () => {
    const dataRoot = join(tmp.root, "volume");
    // A server that ran without backups: real accounts, no keys/.
    const off = await rig({ dataRoot });
    const who = await connect(off, "only-copy@example.com");
    await (off as unknown as { close: () => Promise<void> }).close();
    assert.equal(existsSync(join(dataRoot, "keys")), false);
    const before = readFileSync(join(dataRoot, "control", "accounts.sqlite"));
    const s3 = await s3StandIn();
    const ring = new Map([["v1", randomBytes(32)]]);
    const backup = backupOptions(s3, ring, null);
    const out = (await controlAsideAtStart(dataRoot, "1", backup)) as { line: string };
    assert.match(out.line, /isn't refusing for the control key .*: nothing moved/);
    assert.deepEqual(readFileSync(join(dataRoot, "control", "accounts.sqlite")), before);
    assert.equal(existsSync(join(dataRoot, "control.aside-1")), false);
    assert.equal(existsSync(overrideGuard(dataRoot, "1")), false);
    // What serve does next: the volume check passes, the server starts on the real control databases.
    assert.equal((await prepareVolume(dataRoot, backup, null)).refusal, undefined);
    const b = await rig({ dataRoot, port: off.port, backup });
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 200);
  });

  test("CONTROL_ASIDE with a fresh label on a healthy volume moves nothing and writes no guard", async () => {
    const { s3, ring, dataRoot } = await livedStore();
    const before = readFileSync(join(dataRoot, "control", "accounts.sqlite"));
    const out = (await controlAsideAtStart(dataRoot, "5", backupOptions(s3, ring, null))) as { line: string };
    assert.match(out.line, /nothing moved/);
    assert.deepEqual(readFileSync(join(dataRoot, "control", "accounts.sqlite")), before);
    assert.equal(existsSync(join(dataRoot, "control.aside-5")), false);
    assert.equal(existsSync(overrideGuard(dataRoot, "5")), false);
  });

  test("CONTROL_ASIDE's move: a bad label is refused; an aside dir already there is never moved into; a claim whose move didn't finish says so", () => {
    const dataRoot = join(tmp.root, "data");
    mkdirSync(join(dataRoot, "control"), { recursive: true });
    writeFileSync(join(dataRoot, "control", "accounts.sqlite"), "now");
    assert.match((controlAside(dataRoot, "../x") as { refusal: string }).refusal, /CONTROL_ASIDE must be a label/);
    mkdirSync(join(dataRoot, "control.aside-7"), { recursive: true });
    assert.match((controlAside(dataRoot, "7") as { line: string }).line, /already here, so nothing moved/);
    assert.equal(readFileSync(join(dataRoot, "control", "accounts.sqlite"), "utf8"), "now");
    assert.deepEqual(readdirSync(join(dataRoot, "control.aside-7")), []);
    // A crash after the claim, before the rename.
    mkdirSync(join(dataRoot, "overrides"), { recursive: true });
    writeFileSync(overrideGuard(dataRoot, "8"), "claimed 2026-10-27T00:00:00.000Z\n");
    assert.match((controlAside(dataRoot, "8") as { line: string }).line, /claimed but the move didn't finish: nothing moved\. Set a new label/);
    assert.equal(readFileSync(join(dataRoot, "control", "accounts.sqlite"), "utf8"), "now");
  });

  test("backup.ensure.failed: a started-over store whose backup set-up fails is audited AND logged, by tag, never by id or address", async () => {
    const { s3, ring, dataRoot, port, who } = await livedStore();
    rmSync(tenantDir(join(dataRoot, "tenants"), who.storeId), { recursive: true, force: true });
    for (const k of [...s3.objects.keys()]) if (k.startsWith(replicaPrefix(who.storeId))) s3.objects.delete(k);
    let failing = false;
    const backup = {
      ...backupOptions(s3, ring, null),
      sidecar: {
        reload: () => {
          if (failing) throw new Error("sidecar: spawn EACCES at /data/litestream.yml for awkward@example.com");
        },
        stop: async () => undefined,
      },
    };
    const events: [string, string][] = [];
    const b = await rig({ dataRoot, port, backup, onEvent: (name, store) => void events.push([name, store]) });
    failing = true;
    assert.match(await startOverCommand(dataRoot, backupOptions(s3, ring, null), who.storeId), /starts over/);
    assert.equal((await rpc(`${b.origin}/mcp`, "tools/call", { name: "wake", arguments: {} }, bearer(who.access))).status, 200);
    const until = Date.now() + 5000;
    while (!events.some(([n]) => n === "backup.ensure.failed") && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    const failed = events.filter(([n]) => n === "backup.ensure.failed");
    assert.deepEqual(failed, [["backup.ensure.failed", storeTag(who.storeId)]]);
    assert.ok(b.app.accounts.auditOf(who.personId).some((x) => x.action === "backup.ensure.failed"));
    // The line serve writes for it.
    const line = eventLine(...failed[0]!);
    assert.match(line, new RegExp(`^\\[hosted\\] backup\\.ensure\\.failed storeTag=${storeTag(who.storeId)}: this store is NOT backed up yet`));
    assert.doesNotMatch(line, new RegExp(who.storeId));
    assert.doesNotMatch(line, /@|EACCES|litestream\.yml for/);
  });
});
