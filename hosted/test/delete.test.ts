/**
 * R6 (Mike, 2026-10-27): delete is LOCKED AT ONCE and ERASED AFTER 24 HOURS
 * unless the person keeps it; "delete everything now" stays beside it.
 *
 * Through the real doors: the account pages in a browser, a real OAuth client
 * (`oauth4webapi`, as claude.ai) and `/mcp`, and the app's own finish timer —
 * run every few milliseconds here, with an injected clock standing in for the
 * 24 hours. R2 is an in-memory object store; the sidecar is a stub.
 *
 * Hermetic: a temp data root per test, removed after it. No network.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { DELETE_GRACE_MS, Accounts } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { keyObject, replicaPrefix, tombstoneObject } from "../src/backup.js";
import { memoryMailer, memoryObjectStore } from "../src/egress.js";
import type { ObjectStore } from "../src/egress.js";
import { EnvKeyWrapper } from "../src/keys.js";
import { StoreLocked, tenantDir } from "../src/tenants.js";
import { openDb } from "../../src/core/store/db.js";
import { rpc, tempRoot, tool } from "./helpers.js";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;
const HOUR = 60 * 60 * 1000;
const TICK_MS = 15;

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("delete");
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
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** A browser: a cookie jar that honours each cookie's path (the OAuth library sets path cookies). */
class Browser {
  readonly jar = new Map<string, { v: string; path: string }>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  cookie(name: string): string | null {
    for (const [k, c] of this.jar) if (k.split("|")[0] === name) return c.v;
    return null;
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(target, this.base);
    const headers = new Headers(init.headers);
    const c = [...this.jar]
      .filter(([, x]) => url.pathname.startsWith(x.path))
      .map(([k, x]) => `${k.split("|")[0]}=${x.v}`)
      .join("; ");
    if (c.length > 0) headers.set("cookie", c);
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie()) {
      const parts = raw.split(";").map((p) => p.trim());
      const i = parts[0]!.indexOf("=");
      const k = parts[0]!.slice(0, i);
      const v = parts[0]!.slice(i + 1);
      const path = parts.find((p) => /^path=/i.test(p))?.slice(5) ?? "/";
      const gone = v === "" || parts.some((p) => /^max-age=0$/i.test(p) || (/^expires=/i.test(p) && Date.parse(p.slice(8)) < Date.now()));
      if (gone) this.jar.delete(`${k}|${path}`);
      else this.jar.set(`${k}|${path}`, { v, path });
    }
    return res;
  }
  async form(target: string, fields: Record<string, string>): Promise<Response> {
    return this.go(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
  objects: ReturnType<typeof memoryObjectStore>;
  clock: { at: number };
}

const ring = (): Map<string, Buffer> => new Map([["v1", randomBytes(32)]]);

/** One server on a data root. Pass the same `dataRoot`, `objects` and `wrapper` to restart it on the same volume and bucket. */
async function rig(o: { clock?: { at: number }; objects?: ReturnType<typeof memoryObjectStore>; store?: ObjectStore; wrapper?: EnvKeyWrapper; finishEveryMs?: number } = {}): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const objects = o.objects ?? memoryObjectStore();
  const clock = o.clock ?? { at: Date.now() };
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    now: () => clock.at,
    finishEveryMs: o.finishEveryMs ?? TICK_MS,
    backup: {
      wrapper: o.wrapper ?? new EnvKeyWrapper(ring(), "v1"),
      objects: o.store ?? objects,
      bucket: "bkt",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      sidecar: { reload: () => undefined, stop: async () => undefined },
    },
  });
  closers.push(() => app.close());
  await app.start();
  await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
  closers.push(
    () =>
      new Promise<void>((r) => {
        app.server.close(() => r());
        app.server.closeAllConnections?.();
      }),
  );
  return { app, origin, mail, objects, clock };
}

async function stop(r: Rig): Promise<void> {
  await new Promise<void>((res) => {
    r.app.server.close(() => res());
    r.app.server.closeAllConnections?.();
  });
  await r.app.close();
}

/** Sign `browser` in by email link (a sign-up when `invite` is given), landing on `next`. */
async function signIn(r: Rig, browser: Browser, email: string, invite: string, next = "/account"): Promise<Response> {
  const form = await (await browser.go(`/login?next=${encodeURIComponent(next)}`)).text();
  const before = r.mail.sent.length;
  await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next });
  assert.equal(r.mail.sent.length, before + 1, "a sign-in link was mailed");
  const link = /https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0];
  return browser.go(link);
}

/** A person signed up in a browser, with their ids. */
async function signUp(r: Rig, email: string): Promise<{ browser: Browser; personId: string; storeId: string }> {
  const { code } = r.app.accounts.createInvite();
  const browser = new Browser(r.origin);
  assert.equal((await signIn(r, browser, email, code)).status, 303);
  const personId = r.app.accounts.sessionPerson(browser.cookie("cp_session"))!;
  return { browser, personId, storeId: r.app.accounts.person(personId)!.storeId! };
}

interface Connected {
  as: oauth.AuthorizationServer;
  client: oauth.Client;
  access: string;
  refresh: string;
}

/** What claude.ai does, from the 401 to a token, in a browser already signed in. */
async function connect(r: Rig, browser: Browser): Promise<Connected> {
  const unauth = await rpc(`${r.origin}/mcp`, "tools/list");
  const pointer = /resource_metadata="([^"]+)"/.exec(String(unauth.headers.get("www-authenticate")))![1]!;
  const prm = (await (await fetch(pointer)).json()) as { resource: string; authorization_servers: string[] };
  const issuer = new URL(prm.authorization_servers[0]!);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  const reg = await oauth.processDynamicClientRegistrationResponse(
    await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
  );
  const client: oauth.Client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  const verifier = oauth.generateRandomCodeVerifier();
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    response_type: "code",
    scope: "memory",
    resource: prm.resource,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  let res = await browser.go(authz.toString());
  let loc = new URL(res.headers.get("location")!, r.origin);
  const allowPath = loc.pathname;
  res = await browser.go(allowPath);
  assert.equal(res.status, 200, "the Allow page (the browser is signed in)");
  res = await browser.form(allowPath, { csrf: csrfOf(await res.text()), decision: "allow" });
  for (let i = 0; i < 5 && res.status === 303; i++) {
    loc = new URL(res.headers.get("location")!, r.origin);
    if (loc.origin === "https://claude.ai") break;
    res = await browser.go(loc.toString());
  }
  const params = oauth.validateAuthResponse(as, client, loc, "st-1");
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, CALLBACK, verifier, { additionalParameters: { resource: prm.resource }, ...insecure }),
  );
  return { as, client, access: tokens.access_token, refresh: tokens.refresh_token! };
}

/** Wait for the finish timer to have run a few times (it ticks every TICK_MS). */
const ticks = (n = 6): Promise<void> => new Promise((res) => setTimeout(res, TICK_MS * n));

async function until(cond: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((res) => setTimeout(res, 5));
  }
}

/** Delete (the default button) from the account page. */
async function deleteLater(browser: Browser, email: string): Promise<Response> {
  const page = await (await browser.go("/account")).text();
  return browser.form("/account/delete", { csrf: csrfOf(page), when: "later", confirm: email });
}

/** Everything of the store is still here and in the bucket. */
async function assertKept(r: Rig, storeId: string): Promise<void> {
  assert.ok(existsSync(join(tenantDir(r.app.tenants.root, storeId), "store")), "the store's files");
  assert.notEqual(r.app.keys!.wrapped(storeId), null, "its wrapped key");
  assert.ok(r.objects.objects.has(keyObject(storeId)), "its key object in R2");
  assert.ok((await r.objects.list(replicaPrefix(storeId))).length > 0, "its replica in R2");
  assert.match(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(storeId), "its place in the sidecar's configuration");
}

/** Nothing of the store is left, here or in the bucket (the existing §5.4 check). */
async function assertErased(r: Rig, storeId: string): Promise<void> {
  assert.equal(r.objects.objects.has(keyObject(storeId)), false, "no key object in R2");
  assert.deepEqual(await r.objects.list(replicaPrefix(storeId)), [], "no replica in R2");
  assert.ok(r.objects.objects.has(tombstoneObject(storeId)), "the tombstone");
  assert.equal(r.app.keys!.wrapped(storeId), null, "no wrapped key here");
  assert.equal(existsSync(tenantDir(r.app.tenants.root, storeId)), false, "no tenant dir");
  assert.doesNotMatch(readFileSync(r.app.backups!.configPath, "utf8"), new RegExp(storeId), "not in the sidecar's configuration");
}

/** Litestream's objects for a store, as the sidecar would have written them. */
async function replicate(r: Rig, storeId: string): Promise<void> {
  for (const n of [1, 2]) await r.objects.put(`${replicaPrefix(storeId)}ltx/0/${String(n)}.ltx`, "ciphertext");
}

describe("delete, the default: locked at once, kept within 24 hours", () => {
  test("pending: every door refuses but keep and delete-now; a keep at 23 h brings it back as it was, and the old token stays refused", async () => {
    const r = await rig();
    const me = await signUp(r, "kept@example.com");
    const c = await connect(r, me.browser);
    const woke = await tool(`${r.origin}/mcp`, "wake", {}, bearer(c.access));
    const session = String(woke["session"]);
    await tool(`${r.origin}/mcp`, "remember", { session, text: "The kept memory: a blue heron nests by the mill pond." }, bearer(c.access));
    await replicate(r, me.storeId);
    const t0 = r.clock.at;

    // Delete (the default). The done page names the deadline, and signs out.
    const done = await deleteLater(me.browser, "kept@example.com");
    assert.equal(done.status, 200);
    const words = await done.text();
    assert.match(words, /set to be deleted/);
    assert.match(words, /Changed your mind\? Sign in before then and keep your account/);
    assert.equal(me.browser.cookie("cp_session"), null);
    const person = r.app.accounts.person(me.personId)!;
    assert.equal(person.state, "pending-delete");
    assert.equal(person.deleteAfter, t0 + DELETE_GRACE_MS);
    assert.match(words, /Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday/);

    // Every door refuses: the connector (the token, its refresh, a new connection) ...
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
    const refreshed = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure);
    assert.equal(((await refreshed.json()) as { error: string }).error, "invalid_grant");
    // ... and nothing opens the store, even from inside the process.
    await assert.rejects(r.app.tenants.withTenant(me.storeId, {}, async () => undefined), StoreLocked);
    // The store is kept as it was: files, key, backups.
    await assertKept(r, me.storeId);
    // An operator can't change a pending person either way: keeping is the person's.
    assert.equal(r.app.accounts.setState(me.personId, "active"), false);
    assert.equal(r.app.accounts.setState(me.personId, "suspended"), false);
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");

    // Signing in (by a new link: every session ended) shows the pending page, and only it.
    assert.equal((await signIn(r, me.browser, "kept@example.com", "")).headers.get("location"), "/account");
    const pending = await (await me.browser.go("/account")).text();
    assert.match(pending, /Your account is set to be deleted/);
    assert.match(pending, /Keep my account/);
    assert.match(pending, /Delete everything now/);
    assert.doesNotMatch(pending, /Connected AIs|Download my memory|Time zone/);
    const csrf = csrfOf(pending);
    for (const [path, fields] of [
      ["/account/export", {}],
      ["/account/timezone", { tz: "Europe/Berlin" }],
      ["/account/disconnect", { id: "x" }],
    ] as const) {
      assert.equal((await me.browser.form(path, { csrf, ...fields })).status, 403, `${path} refuses a pending delete`);
    }
    assert.equal((await me.browser.go("/login")).headers.get("location"), "/account");
    // A new connection can't be made: the Allow page sends them to sign in, which sends them back to the pending page.
    const unauth = await rpc(`${r.origin}/mcp`, "tools/list");
    assert.equal(unauth.status, 401);
    const reg = await oauth.processDynamicClientRegistrationResponse(
      await oauth.dynamicClientRegistrationRequest(c.as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
    );
    const authz = new URL(c.as.authorization_endpoint!);
    authz.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", resource: `${r.origin}/mcp`, code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()), code_challenge_method: "S256", state: "s" }).toString();
    // (The library's own login session of this browser ended with the delete: a 500 here before R6 ended it.)
    const started = await me.browser.go(authz.toString());
    assert.equal(started.status, 303);
    const allowAt = new URL(started.headers.get("location")!, r.origin).pathname;
    const toLogin = await me.browser.go(allowAt);
    assert.equal(toLogin.status, 303);
    assert.match(String(toLogin.headers.get("location")), /^\/login\?next=/);
    assert.equal((await me.browser.go(toLogin.headers.get("location")!)).headers.get("location"), "/account");
    // "Delete" again from the pending page sets no new deadline.
    assert.equal((await me.browser.form("/account/delete", { csrf, when: "later", confirm: "kept@example.com" })).headers.get("location"), "/account");
    assert.equal(r.app.accounts.person(me.personId)!.deleteAfter, t0 + DELETE_GRACE_MS);

    // 23 hours on, the timer has run and erased nothing.
    r.clock.at = t0 + 23 * HOUR;
    await ticks();
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    await assertKept(r, me.storeId);

    // Keep it.
    const kept = await me.browser.form("/account/keep", { csrf: csrfOf(await (await me.browser.go("/account")).text()) });
    assert.equal(kept.status, 200);
    assert.match(await kept.text(), /connect them again from Claude/);
    const back = r.app.accounts.person(me.personId)!;
    assert.equal(back.state, "active");
    assert.equal(back.deleteAfter, null);
    assert.equal(back.storeId, me.storeId);
    assert.match(await (await me.browser.go("/account")).text(), /Connected AIs/);
    // The old token and its refresh stay refused: grants are not restored.
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
    const again = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure);
    assert.equal(((await again.json()) as { error: string }).error, "invalid_grant");
    // Connected again, the memory is all there.
    const c2 = await connect(r, me.browser);
    const woke2 = await tool(`${r.origin}/mcp`, "wake", {}, bearer(c2.access));
    const found = await rpc(`${r.origin}/mcp`, "tools/call", { name: "recall", arguments: { session: String(woke2["session"]), question: "heron mill pond", mode: "facts" } }, bearer(c2.access));
    assert.match(JSON.stringify(found.body), /blue heron nests by the mill pond/);
    // Past the old deadline, nothing happens to a kept account.
    r.clock.at = t0 + 25 * HOUR;
    await ticks();
    assert.equal(r.app.accounts.person(me.personId)!.state, "active");
    await assertKept(r, me.storeId);
    const audit = r.app.accounts.auditOf(me.personId).map((a) => a.action);
    assert.ok(audit.includes("account.pending-delete") && audit.includes("account.kept"));
  });

  test("24 hours pass: the timer erases it with the existing sequence (R2 has no key or replica), and not a tick early", async () => {
    const r = await rig();
    const me = await signUp(r, "erased@example.com");
    const other = await signUp(r, "stays@example.com");
    for (const id of [me.storeId, other.storeId]) {
      await r.app.tenants.withTenant(id, {}, async () => undefined);
      await replicate(r, id);
    }
    const t0 = r.clock.at;
    assert.equal((await deleteLater(me.browser, "erased@example.com")).status, 200);

    r.clock.at = t0 + DELETE_GRACE_MS - 1;
    await ticks();
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    await assertKept(r, me.storeId);

    r.clock.at = t0 + DELETE_GRACE_MS;
    await until(() => r.app.accounts.person(me.personId)!.state === "deleted", "the erase");
    await assertErased(r, me.storeId);
    assert.equal(r.app.accounts.person(me.personId)!.email, null);
    assert.equal(r.app.accounts.requestLink({ email: "erased@example.com", browser: "b".repeat(43) }).send, false);
    assert.ok(r.app.accounts.auditOf(me.personId).some((a) => a.action === "account.deleting.due"));
    // The other person is untouched.
    await assertKept(r, other.storeId);
    assert.equal(r.app.accounts.person(other.personId)!.state, "active");
  });

  test("a keep after the deadline, before the timer's tick, is refused: the erase is due, and runs", async () => {
    const r = await rig({ finishEveryMs: 60 * 60 * 1000 });
    const me = await signUp(r, "late@example.com");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    const t0 = r.clock.at;
    assert.equal((await deleteLater(me.browser, "late@example.com")).status, 200);
    await signIn(r, me.browser, "late@example.com", "");
    const csrf = csrfOf(await (await me.browser.go("/account")).text());
    r.clock.at = t0 + DELETE_GRACE_MS + 1;
    const page = await (await me.browser.go("/account")).text();
    assert.match(page, /The time to keep it has passed/);
    assert.doesNotMatch(page, /Keep my account/);
    assert.equal((await me.browser.form("/account/keep", { csrf })).status, 409);
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    assert.equal(await r.app.finishPendingDeletes(), 1);
    assert.equal(r.app.accounts.person(me.personId)!.state, "deleted");
  });
});

describe("delete everything now", () => {
  test("from the pending page: erased at once, with the typed address; R2 has nothing of it right after", async () => {
    const r = await rig({ finishEveryMs: 60 * 60 * 1000 });
    const me = await signUp(r, "now@example.com");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    await replicate(r, me.storeId);
    assert.equal((await deleteLater(me.browser, "now@example.com")).status, 200);
    await signIn(r, me.browser, "now@example.com", "");
    const csrf = csrfOf(await (await me.browser.go("/account")).text());
    assert.equal((await me.browser.form("/account/delete", { csrf, when: "now", confirm: "someone@example.com" })).status, 400);
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    const gone = await me.browser.form("/account/delete", { csrf, when: "now", confirm: "now@example.com" });
    assert.equal(gone.status, 200);
    assert.match(await gone.text(), /Your memory, its backups and its key are erased/);
    assert.equal(r.app.accounts.person(me.personId)!.state, "deleted");
    await assertErased(r, me.storeId);
    assert.equal((await me.browser.go("/account")).status, 303);
  });

  test("from an active account: the account page offers both, and 'now' erases at once", async () => {
    const r = await rig({ finishEveryMs: 60 * 60 * 1000 });
    const me = await signUp(r, "both@example.com");
    await replicate(r, me.storeId);
    const page = await (await me.browser.go("/account")).text();
    assert.match(page, /Delete my account \(24 hours to change your mind\)/);
    assert.match(page, /Delete everything now/);
    // The default button comes first, so Enter in the address field is the delete that can be kept.
    assert.ok(page.indexOf('value="later"') < page.indexOf('value="now"'));
    assert.match(page, /Forgetting one memory is different/);
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "now", confirm: "both@example.com" })).status, 200);
    await assertErased(r, me.storeId);
  });
});

describe("a pending delete across restarts and outages", () => {
  test("a restart mid-window keeps the deadline and the lock; start-up never erases early; the timer erases at 24 h", async () => {
    const clock = { at: Date.now() };
    const wrapper = new EnvKeyWrapper(ring(), "v1");
    const objects = memoryObjectStore();
    const a = await rig({ clock, objects, wrapper });
    const me = await signUp(a, "restart@example.com");
    await a.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    await replicate(a, me.storeId);
    const t0 = clock.at;
    assert.equal((await deleteLater(me.browser, "restart@example.com")).status, 200);
    clock.at = t0 + 12 * HOUR;
    await stop(a);

    const b = await rig({ clock, objects, wrapper });
    const person = b.app.accounts.person(me.personId)!;
    assert.equal(person.state, "pending-delete");
    assert.equal(person.deleteAfter, t0 + DELETE_GRACE_MS);
    await assertKept(b, me.storeId);
    // The lock is the accounts row, not this process's memory.
    await assert.rejects(b.app.tenants.withTenant(me.storeId, {}, async () => undefined), StoreLocked);
    // A start at 23 h erases nothing either.
    clock.at = t0 + 23 * HOUR;
    await stop(b);
    const c = await rig({ clock, objects, wrapper });
    assert.equal(c.app.accounts.person(me.personId)!.state, "pending-delete");
    await assertKept(c, me.storeId);

    clock.at = t0 + DELETE_GRACE_MS;
    await until(() => c.app.accounts.person(me.personId)!.state === "deleted", "the erase");
    await assertErased(c, me.storeId);
  });

  test("a start after the deadline erases it before serving", async () => {
    const clock = { at: Date.now() };
    const wrapper = new EnvKeyWrapper(ring(), "v1");
    const objects = memoryObjectStore();
    const a = await rig({ clock, objects, wrapper, finishEveryMs: 60 * 60 * 1000 });
    const me = await signUp(a, "boot@example.com");
    await a.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    const t0 = clock.at;
    assert.equal((await deleteLater(me.browser, "boot@example.com")).status, 200);
    await stop(a);
    clock.at = t0 + DELETE_GRACE_MS + 5 * HOUR; // the server was down through the deadline
    const b = await rig({ clock, objects, wrapper, finishEveryMs: 60 * 60 * 1000 });
    assert.equal(b.app.accounts.person(me.personId)!.state, "deleted");
    await assertErased(b, me.storeId);
  });

  test("R2 down at the deadline: nothing before it, the erase begins at it and is finished once R2 is back, never early", async () => {
    const clock = { at: Date.now() };
    const inner = memoryObjectStore();
    let down = false;
    const flaky: ObjectStore = {
      put: async (k, b) => {
        if (down) throw new Error("object store PUT answered 503");
        await inner.put(k, b);
      },
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
    const r = await rig({ clock, objects: inner, store: flaky });
    const me = await signUp(r, "outage@example.com");
    await r.app.tenants.withTenant(me.storeId, {}, async () => undefined);
    await replicate(r, me.storeId);
    const t0 = clock.at;
    down = true;
    // The delete itself needs no R2.
    assert.equal((await deleteLater(me.browser, "outage@example.com")).status, 200);
    clock.at = t0 + 20 * HOUR;
    await ticks();
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    await assertKept(r, me.storeId);

    clock.at = t0 + DELETE_GRACE_MS + 1;
    await until(() => r.app.accounts.auditOf(me.personId).some((x) => x.action === "delete.retry.failed"), "a failed erase");
    // Begun and cut short: no keep, no sign-in, still in the bucket, retried.
    assert.equal(r.app.accounts.person(me.personId)!.state, "suspended");
    assert.equal(r.app.accounts.keep(me.personId), false);
    assert.equal(r.app.accounts.requestLink({ email: "outage@example.com", browser: "b".repeat(43) }).send, false);
    assert.ok(inner.objects.has(keyObject(me.storeId)));

    down = false;
    await until(() => r.app.accounts.person(me.personId)!.state === "deleted", "the erase, once R2 is back");
    await assertErased(r, me.storeId);
  });
});

describe("keys and the schema", () => {
  test("a store set to be deleted is never given a new key at start-up (a lost key stays lost); an active one in the same state is", async () => {
    const clock = { at: Date.now() };
    const wrapper = new EnvKeyWrapper(ring(), "v1");
    const objects = memoryObjectStore();
    const a = await rig({ clock, objects, wrapper });
    // Two people signed up and never opened: the only state today's start-up mints a key for.
    const gone = await signUp(a, "locked-key@example.com");
    const live = await signUp(a, "live-key@example.com");
    assert.equal((await deleteLater(gone.browser, "locked-key@example.com")).status, 200);
    for (const id of [gone.storeId, live.storeId]) {
      a.app.keys!.delete(id);
      await objects.delete(keyObject(id));
    }
    await stop(a);
    const b = await rig({ clock, objects, wrapper });
    assert.equal(b.app.keys!.wrapped(gone.storeId), null);
    assert.equal(objects.objects.has(keyObject(gone.storeId)), false);
    assert.notEqual(b.app.keys!.wrapped(live.storeId), null);
    assert.equal(b.app.accounts.person(gone.personId)!.state, "pending-delete");
  });

  test("an accounts database from before R6 (no delete_after) opens and gains the column; its people are untouched", () => {
    const path = join(tmp.root, "control", "accounts.sqlite");
    const old = new Accounts({ path });
    const { code } = old.createInvite();
    const asked = old.requestLink({ email: "beta@example.com", inviteCode: code, browser: "b".repeat(43) });
    assert.ok(asked.send);
    const used = old.useLink({ token: asked.token, browser: "b".repeat(43) });
    assert.ok(used.ok);
    old.close();
    // Make it the beta's shape: drop the column (SQLite 3.35+), as a volume made before this change has it.
    const db = openDb(path, { wal: true });
    db.exec("ALTER TABLE people DROP COLUMN delete_after");
    assert.equal(db.all<{ name: string }>("PRAGMA table_info(people)").some((c) => c.name === "delete_after"), false);
    db.close();
    const now = new Accounts({ path });
    try {
      const p = now.person(used.personId)!;
      assert.equal(p.state, "active");
      assert.equal(p.email, "beta@example.com");
      assert.equal(p.deleteAfter, null);
      assert.notEqual(now.markPendingDelete(used.personId), null);
      assert.equal(now.person(used.personId)!.state, "pending-delete");
    } finally {
      now.close();
    }
  });
});
