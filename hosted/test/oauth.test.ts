/**
 * OL2 step 4: OAuth 2.1 for the connector, end to end through the real socket,
 * driven by real clients — `oauth4webapi` (a strict, certified-grade client)
 * and the MCP TypeScript SDK's own client auth — as claude.ai would: discover
 * from the 401, register (DCR) or present a metadata URL (CIMD), sign in by
 * email link in the same browser, press Allow, exchange the code with PKCE,
 * call `/mcp`. Then every awkward state on purpose: no PKCE, a reused code, a
 * reused refresh token, deny, disconnect, revoke, the wrong resource, another
 * browser's Allow page, a forged Allow, a suspended person, and one person's
 * token against another person's memory.
 *
 * Hermetic: a temp data root, an in-memory mailer, a CIMD fetch that serves a
 * fixture generated in the test. No network.
 */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { cimdFetch, memoryMailer } from "../src/egress.js";
import { clientLabel, returnsTo } from "../src/oauth.js";
import { listen, rpc, tempRoot, tool } from "./helpers.js";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("oauth");
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

class Browser {
  readonly jar = new Map<string, { v: string; path: string }>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  private cookieFor(pathname: string): string {
    return [...this.jar]
      .filter(([, c]) => pathname.startsWith(c.path))
      .map(([k, c]) => `${k.split("|")[0]}=${c.v}`)
      .join("; ");
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(target, this.base);
    const headers = new Headers(init.headers);
    const c = this.cookieFor(url.pathname);
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

interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
  cimd: Map<string, unknown>;
  /** Every outbound fetch the library asked for, with the init it passed. */
  fetched: { url: string; init: RequestInit | undefined }[];
}

async function rig(opts: { trustProxy?: boolean } = {}): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const cimd = new Map<string, unknown>();
  const fetched: Rig["fetched"] = [];
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    ...(opts.trustProxy === true ? { trustProxy: true } : {}),
    cimdFetch: async (input, init) => {
      fetched.push({ url: String(input), init });
      const doc = cimd.get(String(input));
      return doc === undefined ? new Response("no", { status: 404 }) : new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  closers.push(() => app.close());
  await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
  closers.push(
    () =>
      new Promise<void>((r) => {
        app.server.close(() => r());
        app.server.closeAllConnections?.();
      }),
  );
  return { app, origin, mail, cimd, fetched };
}

/** Sign `browser` in as `email` (a sign-up when `invite` is given), landing on `next`. */
async function signIn(r: Rig, browser: Browser, email: string, invite: string, next: string): Promise<Response> {
  const form = await (await browser.go(`/login?next=${encodeURIComponent(next)}`)).text();
  const before = r.mail.sent.length;
  await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next });
  assert.equal(r.mail.sent.length, before + 1, "a link was mailed");
  const link = /https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0];
  return browser.go(link);
}

interface Connected {
  as: oauth.AuthorizationServer;
  client: oauth.Client;
  access: string;
  refresh: string;
  params: URLSearchParams;
  verifier: string;
  browser: Browser;
}

/** Everything claude.ai does, from the 401 to a token. */
async function connect(r: Rig, email: string, opts: { invite?: string; browser?: Browser; clientId?: string; decision?: "allow" | "deny"; resource?: string } = {}): Promise<Connected> {
  // 1. The 401 points at the resource metadata; it names the authorization server.
  const unauth = await rpc(`${r.origin}/mcp`, "tools/list");
  assert.equal(unauth.status, 401);
  const pointer = /resource_metadata="([^"]+)"/.exec(String(unauth.headers.get("www-authenticate")))![1]!;
  const prm = (await (await fetch(pointer)).json()) as { resource: string; authorization_servers: string[] };
  assert.equal(prm.resource, `${r.origin}/mcp`);
  const issuer = new URL(prm.authorization_servers[0]!);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  // 2. Register (DCR), unless a CIMD client id was given.
  let client: oauth.Client;
  if (opts.clientId === undefined) {
    const reg = await oauth.processDynamicClientRegistrationResponse(
      await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
    );
    client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  } else {
    client = { client_id: opts.clientId, token_endpoint_auth_method: "none" };
  }
  // 3. Authorize with PKCE S256 and the resource, in a browser.
  const verifier = oauth.generateRandomCodeVerifier();
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    response_type: "code",
    scope: "memory",
    resource: opts.resource ?? prm.resource,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const browser = opts.browser ?? new Browser(r.origin);
  let res = await browser.go(authz.toString());
  let loc = new URL(res.headers.get("location")!, r.origin);
  assert.match(loc.pathname, /^\/oauth\/allow\//);
  const allowPath = loc.pathname;
  res = await browser.go(allowPath);
  if (res.status === 303) {
    // Not signed in: the login keeps the way back to Allow.
    assert.equal(res.headers.get("location"), `/login?next=${encodeURIComponent(allowPath)}`);
    const signed = await signIn(r, browser, email, opts.invite ?? "", allowPath);
    assert.equal(signed.headers.get("location"), allowPath);
    res = await browser.go(allowPath);
  }
  assert.equal(res.status, 200);
  const html = await res.text();
  res = await browser.form(allowPath, { csrf: csrfOf(html), decision: opts.decision ?? "allow" });
  for (let i = 0; i < 5 && res.status === 303; i++) {
    loc = new URL(res.headers.get("location")!, r.origin);
    if (loc.origin === "https://claude.ai") break;
    res = await browser.go(loc.toString());
  }
  assert.equal(loc.origin + loc.pathname, CALLBACK);
  // 4. The code, with the verifier (and `iss` checked by the client, RFC 9207).
  const params = oauth.validateAuthResponse(as, client, loc, "st-1");
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, CALLBACK, verifier, { additionalParameters: { resource: opts.resource ?? prm.resource }, ...insecure }),
  );
  assert.ok(tokens.refresh_token !== undefined);
  return { as, client, access: tokens.access_token, refresh: tokens.refresh_token!, params, verifier, browser };
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe("discovery", () => {
  test("resource metadata at both well-knowns; the authorization-server document at both, advertising what claude.ai needs for CIMD", async () => {
    const r = await rig();
    for (const p of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const doc = (await (await fetch(`${r.origin}${p}`)).json()) as Record<string, unknown>;
      assert.deepEqual(doc["authorization_servers"], [r.origin]);
      assert.equal(doc["resource"], `${r.origin}/mcp`);
    }
    for (const p of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
      const doc = (await (await fetch(`${r.origin}${p}`)).json()) as Record<string, unknown>;
      assert.equal(doc["issuer"], r.origin);
      assert.equal(doc["client_id_metadata_document_supported"], true);
      assert.deepEqual(doc["token_endpoint_auth_methods_supported"], ["none"]);
      assert.deepEqual(doc["code_challenge_methods_supported"], ["S256"]);
      assert.equal(doc["authorization_response_iss_parameter_supported"], true);
      assert.equal(doc["registration_endpoint"], `${r.origin}/oauth/register`);
      assert.equal(doc["authorization_endpoint"], `${r.origin}/oauth/authorize`);
      assert.ok(!JSON.stringify(doc["scopes_supported"]).includes("offline_access"));
    }
  });
});

describe("connecting, as claude.ai does", () => {
  test("DCR → sign up by email link in the same browser → Allow → code + PKCE → /mcp works, as that person's store", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "mike@example.com", { invite: code });
    const list = await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access));
    assert.equal(list.status, 200);
    const woke = await tool(`${r.origin}/mcp`, "wake", {}, bearer(c.access));
    await tool(`${r.origin}/mcp`, "remember", { session: String(woke["session"]), text: "Mike's first hosted memory: the porch light is amber." }, bearer(c.access));
    const person = r.app.accounts.person(r.app.accounts.sessionPerson([...c.browser.jar].find(([k]) => k.startsWith("cp_session|"))![1].v)!)!;
    const storeDb = join(r.app.tenants.root, person.storeId!, "store", "counterparts.sqlite");
    const onDisk = [storeDb, `${storeDb}-wal`].map((p) => { try { return readFileSync(p).toString("latin1"); } catch { return ""; } }).join("");
    assert.match(onDisk, /porch light is amber/);
    // No bearer value is stored anywhere in the control files.
    for (const f of ["accounts.sqlite", "oauth.sqlite", "oauth.sqlite-wal"]) {
      let bytes = "";
      try {
        bytes = readFileSync(join(tmp.root, "data", "control", f)).toString("latin1");
      } catch {
        continue;
      }
      assert.ok(!bytes.includes(c.access), `${f} holds the access token`);
      assert.ok(!bytes.includes(c.refresh), `${f} holds the refresh token`);
    }
  });

  test("CIMD: a metadata URL as client_id; the Allow page names the app by its host, not by what it calls itself", async () => {
    const r = await rig();
    const id = "https://claude.example/oauth/client.json";
    r.cimd.set(id, { client_id: id, client_name: "Totally Your Bank", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    const { code } = r.app.accounts.createInvite();
    // Sign in first, so the Allow page can be read before pressing it.
    const browser = new Browser(r.origin);
    await signIn(r, browser, "cimd@example.com", code, "/account");
    const c = await connect(r, "cimd@example.com", { clientId: id, browser });
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 200);
    const account = await (await browser.go("/account")).text();
    assert.match(account, /claude\.example/);
    assert.doesNotMatch(account, /Totally Your Bank/);
  });

  test("refresh rotates; the old refresh token is dead; an expired-or-unknown one is invalid_grant", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "r@example.com", { invite: code });
    const next = await oauth.processRefreshTokenResponse(c.as, c.client, await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure));
    assert.notEqual(next.refresh_token, c.refresh);
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(next.access_token))).status, 200);
    const old = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure);
    assert.equal(old.status, 400);
    assert.equal(((await old.json()) as { error: string }).error, "invalid_grant");
    const bogus = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), "not-a-refresh-token-at-all-0000000000", insecure);
    assert.equal(((await bogus.json()) as { error: string }).error, "invalid_grant");
  });
});

describe("refusals, on purpose", () => {
  test("no PKCE, or a plain challenge: refused before any page", async () => {
    const r = await rig();
    const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
    const reg = await oauth.processDynamicClientRegistrationResponse(await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }, insecure));
    const extras: Record<string, string>[] = [{}, { code_challenge: "a".repeat(43), code_challenge_method: "plain" }];
    for (const extra of extras) {
      const u = new URL(as.authorization_endpoint!);
      u.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", state: "s", ...extra }).toString();
      const res = await fetch(u, { redirect: "manual" });
      const loc = new URL(res.headers.get("location") ?? "/", r.origin);
      assert.equal(loc.origin, "https://claude.ai");
      assert.equal(loc.searchParams.get("error"), "invalid_request");
    }
  });

  test("another resource is refused (invalid_target); a token is only ever for /mcp", async () => {
    const r = await rig();
    const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
    const reg = await oauth.processDynamicClientRegistrationResponse(await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }, insecure));
    const u = new URL(as.authorization_endpoint!);
    u.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", resource: "https://evil.example/api", code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()), code_challenge_method: "S256", state: "s" }).toString();
    const res = await fetch(u, { redirect: "manual" });
    assert.equal(new URL(res.headers.get("location")!, r.origin).searchParams.get("error"), "invalid_target");
  });

  test("a reused code is refused, and the grant it made is revoked: its access token stops working", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "reuse@example.com", { invite: code });
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 200);
    const again = await oauth.authorizationCodeGrantRequest(c.as, c.client, oauth.None(), c.params, CALLBACK, c.verifier, insecure);
    assert.equal(((await again.json()) as { error: string }).error, "invalid_grant");
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
  });

  test("Deny sends access_denied back to the app, and no grant exists", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const browser = new Browser(r.origin);
    await signIn(r, browser, "deny@example.com", code, "/account");
    await assert.rejects(connect(r, "deny@example.com", { browser, decision: "deny" }), (e: unknown) => (e as { error?: string }).error === "access_denied");
    const personId = r.app.pages.personOf({ headers: { cookie: [...browser.jar].map(([k, v]) => `${k.split("|")[0]}=${v.v}`).join("; ") } } as never)!;
    assert.deepEqual(await r.app.oauth.connections.list(personId), []);
  });

  test("the Allow page belongs to the browser that started the sign-in; a forged Allow (no CSRF) is refused", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite({ maxUses: 2 });
    const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
    const reg = await oauth.processDynamicClientRegistrationResponse(await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" }, insecure));
    const u = new URL(as.authorization_endpoint!);
    u.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()), code_challenge_method: "S256", state: "s" }).toString();
    const attacker = new Browser(r.origin);
    const started = await attacker.go(u.toString());
    const allowPath = new URL(started.headers.get("location")!, r.origin).pathname;
    // The victim, signed in, opens the attacker's Allow link: no interaction cookie, no page.
    const victim = new Browser(r.origin);
    await signIn(r, victim, "victim@example.com", code, "/account");
    const seen = await victim.go(allowPath);
    assert.equal(seen.status, 400);
    // The attacker, signed in as themself, posts Allow without a token.
    await signIn(r, attacker, "attacker@example.com", code, allowPath);
    const forged = await attacker.form(allowPath, { decision: "allow" });
    assert.equal(forged.status, 403);
  });

  test("disconnect on the account page: the connection's tokens stop at once; refresh is invalid_grant", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "d@example.com", { invite: code });
    const account = await (await c.browser.go("/account")).text();
    assert.match(account, /claude\.ai/);
    const id = /name="id" value="([^"]+)"/.exec(account)![1]!;
    const out = await c.browser.form("/account/disconnect", { csrf: csrfOf(account), id });
    assert.equal(out.status, 303);
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
    const refresh = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure);
    assert.equal(((await refresh.json()) as { error: string }).error, "invalid_grant");
  });

  test("revoke (RFC 7009): the access token stops; an unknown token is still 200", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "rv@example.com", { invite: code });
    const rv = await oauth.revocationRequest(c.as, c.client, oauth.None(), c.access, insecure);
    assert.equal(rv.status, 200);
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
    assert.equal((await oauth.revocationRequest(c.as, c.client, oauth.None(), "nonsense-token-value", insecure)).status, 200);
  });

  test("a suspended person's token stops at the next call", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "sus@example.com", { invite: code });
    const personId = (await r.app.oauth.authenticate(c.access))!.personId;
    r.app.accounts.setState(personId, "suspended");
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 401);
  });
});

describe("two people, crossing on purpose", () => {
  test("A's token reaches only A's store; B's reaches only B's; A's session and words are nothing in B; B cannot disconnect A", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite({ maxUses: 2 });
    const a = await connect(r, "a@example.com", { invite: code });
    const b = await connect(r, "b@example.com", { invite: code });
    const wakeA = await tool(`${r.origin}/mcp`, "wake", {}, bearer(a.access));
    await tool(`${r.origin}/mcp`, "remember", { session: String(wakeA["session"]), text: "A's secret garden has a blue door behind the quince." }, bearer(a.access));
    const asB = await rpc(`${r.origin}/mcp`, "tools/call", { name: "recall", arguments: { session: String(wakeA["session"]), question: "garden door", mode: "facts" } }, bearer(b.access));
    assert.equal(asB.status, 200);
    assert.doesNotMatch(JSON.stringify(asB.body), /quince|blue door/);
    const asA = await rpc(`${r.origin}/mcp`, "tools/call", { name: "recall", arguments: { session: String(wakeA["session"]), question: "garden door", mode: "facts" } }, bearer(a.access));
    assert.match(JSON.stringify(asA.body), /quince/);
    const callerA = (await r.app.oauth.authenticate(a.access))!;
    const callerB = (await r.app.oauth.authenticate(b.access))!;
    assert.notEqual(callerA.storeId, callerB.storeId);
    // B posts a disconnect for A's grant id from B's own account page: nothing happens to A.
    const aGrant = (await r.app.oauth.connections.list(callerA.personId))[0]!.id;
    const bPage = await (await b.browser.go("/account")).text();
    await b.browser.form("/account/disconnect", { csrf: csrfOf(bPage), id: aGrant });
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(a.access))).status, 200);
    // A's refresh token, presented with B's client id, is not B's to use.
    const swapped = await oauth.refreshTokenGrantRequest(b.as, b.client, oauth.None(), a.refresh, insecure);
    assert.equal(((await swapped.json()) as { error: string }).error, "invalid_grant");
  });
});

describe("the MCP SDK's own client, as a second real client", () => {
  test("discovers from the 401, registers, sends the person to Allow, finishes with the code, lists tools", async () => {
    const r = await rig();
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const { UnauthorizedError } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const state: { info?: unknown; tokens?: unknown; verifier?: string; authUrl?: URL } = {};
    const provider = {
      get redirectUrl(): string {
        return CALLBACK;
      },
      get clientMetadata() {
        return { client_name: "sdk-test", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
      },
      clientInformation: () => state.info as never,
      saveClientInformation: (i: unknown) => void (state.info = i),
      tokens: () => state.tokens as never,
      saveTokens: (t: unknown) => void (state.tokens = t),
      redirectToAuthorization: (u: URL) => void (state.authUrl = u),
      saveCodeVerifier: (v: string) => void (state.verifier = v),
      codeVerifier: () => state.verifier!,
    };
    const url = new URL(`${r.origin}/mcp`);
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await assert.rejects(new Client({ name: "sdk-test", version: "0" }).connect(first), (e: unknown) => e instanceof UnauthorizedError);
    assert.ok(state.authUrl !== undefined, "the SDK asked to send the person to sign in");
    assert.equal(state.authUrl.searchParams.get("code_challenge_method"), "S256");
    // The person: sign up, Allow.
    const { code: invite } = r.app.accounts.createInvite();
    const browser = new Browser(r.origin);
    let res = await browser.go(state.authUrl.toString());
    const allowPath = new URL(res.headers.get("location")!, r.origin).pathname;
    await signIn(r, browser, "sdk@example.com", invite, allowPath);
    const html = await (await browser.go(allowPath)).text();
    res = await browser.form(allowPath, { csrf: csrfOf(html), decision: "allow" });
    let loc = new URL(res.headers.get("location")!, r.origin);
    for (let i = 0; i < 5 && loc.origin !== "https://claude.ai"; i++) {
      res = await browser.go(loc.toString());
      loc = new URL(res.headers.get("location")!, r.origin);
    }
    await first.finishAuth(loc.searchParams.get("code")!);
    const client = new Client({ name: "sdk-test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "wake"));
    await client.close();
  });
});

describe("Claude Code's loopback redirect, and the slash", () => {
  test("a loopback client registered without a port may come back on any port (RFC 8252 §7.3)", async () => {
    const r = await rig();
    const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
    const reg = await oauth.processDynamicClientRegistrationResponse(
      await oauth.dynamicClientRegistrationRequest(as, { application_type: "native", redirect_uris: ["http://localhost/callback"], token_endpoint_auth_method: "none" }, insecure),
    );
    const u = new URL(as.authorization_endpoint!);
    u.search = new URLSearchParams({ client_id: reg.client_id, redirect_uri: "http://localhost:54321/callback", response_type: "code", scope: "memory", code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()), code_challenge_method: "S256", state: "s" }).toString();
    const res = await fetch(u, { redirect: "manual" });
    assert.match(String(res.headers.get("location")), /\/oauth\/allow\//);
  });

  test("a resource typed with the trailing slash is ours too; its token works at /mcp and /mcp/", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "slash@example.com", { invite: code, resource: `${r.origin}/mcp/` });
    assert.equal((await rpc(`${r.origin}/mcp/`, "tools/list", undefined, bearer(c.access))).status, 200);
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 200);
  });
});

describe("limits on the open endpoints", () => {
  test("registration is open but bounded: the 31st in an hour from one address is 429", async () => {
    const r = await rig();
    const body = JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await fetch(`${r.origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body });
      statuses.push(res.status);
      await res.text();
    }
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(201));
    assert.equal(statuses[30], 429);
  });
});

describe("review of #646: the attacker's cases", () => {
  const discover = async (r: Rig): Promise<oauth.AuthorizationServer> => oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
  const authzUrl = async (as: oauth.AuthorizationServer, clientId: string, redirect: string): Promise<string> => {
    const u = new URL(as.authorization_endpoint!);
    u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: "memory", code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()), code_challenge_method: "S256", state: "s" }).toString();
    return u.toString();
  };
  const register = async (r: Rig, meta: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`${r.origin}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token_endpoint_auth_method: "none", ...meta }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  test("metadata that would make the server fetch a URL of the client's choosing is refused, and nothing is fetched", async () => {
    const r = await rig();
    // sector_identifier_uri used to be FETCHED at registration: any https host, any port, no body limit.
    for (const extra of [{ sector_identifier_uri: "https://internal.example:8443/sector.json" }, { jwks_uri: "https://internal.example/jwks.json" }, { backchannel_logout_uri: "https://internal.example/bc" }, { jwks: { keys: [] } }]) {
      const out = await register(r, { redirect_uris: [CALLBACK], ...extra });
      assert.equal(out.status, 400, JSON.stringify(extra));
      assert.equal(out.body["error"], "invalid_client_metadata");
    }
    assert.equal(r.fetched.length, 0);
    // The same rule holds for a CIMD document: the document is fetched, its sector URI is not.
    const id = "https://claude.example/oauth/client.json";
    r.cimd.set(id, { client_id: id, redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", sector_identifier_uri: "https://internal.example/sector.json" });
    const res = await fetch(await authzUrl(await discover(r), id, CALLBACK), { redirect: "manual" });
    assert.notEqual(res.status, 303);
    assert.ok(r.fetched.length > 0);
    assert.deepEqual([...new Set(r.fetched.map((f) => f.url))], [id]);
  });

  test("a redirect over plain http is accepted only on loopback; the Allow page names any other host as itself", async () => {
    const r = await rig();
    assert.equal((await register(r, { redirect_uris: ["http://evil.example/cb"] })).status, 400);
    assert.equal((await register(r, { redirect_uris: [CALLBACK, "http://192.168.1.20/cb"] })).status, 400);
    assert.equal((await register(r, { redirect_uris: ["http://localhost:33418/callback"] })).status, 201);
    assert.equal((await register(r, { application_type: "native", redirect_uris: ["http://127.0.0.1/callback"] })).status, 201);
    assert.equal(returnsTo("http://evil.example/cb"), "evil.example");
    assert.equal(returnsTo("http://localhost:5000/cb"), "an app on this computer");
  });

  test("consent phishing: a registered app's own name can't stand in front of where it really returns to", async () => {
    const r = await rig();
    const as = await discover(r);
    const reg = await register(r, { redirect_uris: ["https://claude-ai.evil.example/cb"], client_name: "Claude (claude.ai)" });
    assert.equal(reg.status, 201);
    const { code } = r.app.accounts.createInvite();
    const b = new Browser(r.origin);
    await signIn(r, b, "phish@example.com", code, "/account");
    const started = await b.go(await authzUrl(as, String(reg.body["client_id"]), "https://claude-ai.evil.example/cb"));
    const html = await (await b.go(new URL(started.headers.get("location")!, r.origin).pathname)).text();
    const h1 = /<h1>([^<]*)<\/h1>/.exec(html)![1]!;
    assert.match(h1, /^Connect claude-ai\.evil\.example \(calls itself/);
    assert.equal(clientLabel("abc", [CALLBACK], "Claude‮"), "claude.ai (calls itself “Claude”)");
  });

  test("a grant is reused without the Allow page only while OUR session is the same person's: after sign-out, Allow and login come back", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite({ maxUses: 2 });
    const c = await connect(r, "shared@example.com", { invite: code });
    // Still signed in, same browser, same app: the library's silent re-authorization (a code, no page).
    const again = await c.browser.go(await authzUrl(c.as, c.client.client_id, CALLBACK));
    assert.equal(new URL(again.headers.get("location")!, r.origin).origin, "https://claude.ai");
    // Signed out of Counterparts: the next connect in this browser must go through Allow, which asks for a login.
    const acct = await (await c.browser.go("/account")).text();
    assert.equal((await c.browser.form("/logout", { csrf: csrfOf(acct) })).status, 303);
    const after = await c.browser.go(await authzUrl(c.as, c.client.client_id, CALLBACK));
    const allow = new URL(after.headers.get("location")!, r.origin);
    assert.equal(allow.origin, r.origin, "no code was minted for a signed-out browser");
    assert.match(allow.pathname, /^\/oauth\/allow\//);
    const page = await c.browser.go(allow.pathname);
    assert.equal(page.status, 303);
    assert.match(String(page.headers.get("location")), /^\/login\?next=/);
    // Someone else signs in in that browser: the Allow page is theirs to answer, not a silent code for the first person.
    const other = await signIn(r, c.browser, "other@example.com", code, allow.pathname);
    assert.equal(other.headers.get("location"), allow.pathname);
    const otherPage = await (await c.browser.go(allow.pathname)).text();
    assert.match(otherPage, /Signed in as <strong>other@example\.com<\/strong>/);
  });

  test("a replayed refresh token revokes the grant: the tokens rotated from it die too", async () => {
    const r = await rig();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "replay@example.com", { invite: code });
    const next = await oauth.processRefreshTokenResponse(c.as, c.client, await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure));
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(next.access_token))).status, 200);
    // The thief replays the old one.
    const replay = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), c.refresh, insecure);
    assert.equal(((await replay.json()) as { error: string }).error, "invalid_grant");
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(next.access_token))).status, 401);
    const nextRefresh = await oauth.refreshTokenGrantRequest(c.as, c.client, oauth.None(), next.refresh_token!, insecure);
    assert.equal(((await nextRefresh.json()) as { error: string }).error, "invalid_grant");
    // And racing the same refresh token four ways: exactly one wins.
    const d = await connect(r, "replay@example.com", { browser: c.browser });
    const raced = await Promise.all([0, 1, 2, 3].map(async () => (await oauth.refreshTokenGrantRequest(d.as, d.client, oauth.None(), d.refresh, insecure)).status));
    assert.equal(raced.filter((s) => s === 200).length, 1);
  });

  test("a forged Host or X-Forwarded-Host never reaches a URL the library publishes", async () => {
    const r = await rig({ trustProxy: true });
    const viaXfh = await (await fetch(`${r.origin}/.well-known/oauth-authorization-server`, { headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" } })).text();
    assert.doesNotMatch(viaXfh, /evil\.example/);
    assert.match(viaXfh, new RegExp(`"token_endpoint":"${r.origin}/oauth/token"`));
    const viaHost = await new Promise<string>((resolve, reject) => {
      const u = new URL(`${r.origin}/.well-known/openid-configuration`);
      const req = httpRequest({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: "evil.example" } }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString()));
        res.on("end", () => resolve(body));
      });
      req.on("error", reject);
      req.end();
    });
    assert.doesNotMatch(viaHost, /evil\.example/);
  });

  test("no bearer value of any kind is on disk: not the code, not the registration access token", async () => {
    const r = await rig();
    const reg = await register(r, { redirect_uris: [CALLBACK] });
    const rat = String(reg.body["registration_access_token"]);
    assert.ok(rat.length > 20);
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, "disk@example.com", { invite: code });
    let bytes = "";
    for (const f of ["oauth.sqlite", "oauth.sqlite-wal"]) {
      try {
        bytes += readFileSync(join(tmp.root, "data", "control", f)).toString("latin1");
      } catch {
        /* not there */
      }
    }
    assert.ok(bytes.length > 0);
    assert.ok(!bytes.includes(c.params.get("code")!), "the authorization code is stored");
    assert.ok(!bytes.includes(rat), "the registration access token is stored");
  });

  test("the library's error page can't be framed", async () => {
    const r = await rig();
    const res = await fetch(`${r.origin}/oauth/authorize?client_id=nobody&response_type=code`, { redirect: "manual" });
    assert.equal(res.status, 400);
    assert.match(String(res.headers.get("content-security-policy")), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });

  test("starting sign-ins is bounded per address, because each can make the server fetch a CIMD document", async () => {
    const r = await rig();
    const statuses: number[] = [];
    for (let i = 0; i < 301; i++) {
      const res = await fetch(`${r.origin}/oauth/authorize?client_id=nobody${String(i)}&response_type=code`, { redirect: "manual" });
      statuses.push(res.status);
      await res.text();
    }
    assert.ok(statuses.slice(0, 300).every((s) => s !== 429));
    assert.equal(statuses[300], 429);
  });

  test("on Node, the library's SSRF guard reaches our CIMD fetch and refuses a loopback address", async () => {
    // Bun has no undici dispatcher (the library warns and fetches unguarded); production runs Node 24, and CI runs this there.
    if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") return;
    const r = await rig();
    const id = "https://claude.example/oauth/client.json";
    r.cimd.set(id, { client_id: id, redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    await (await fetch(await authzUrl(await discover(r), id, CALLBACK), { redirect: "manual" })).text();
    const init = r.fetched[0]!.init as RequestInit & { dispatcher?: unknown };
    assert.ok(init.dispatcher !== undefined, "the library handed its guarded dispatcher to our fetch");
    assert.equal(init.redirect, "manual");
    const target = createHttpServer((_req, res) => res.end("internal"));
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", () => resolve()));
    const url = `http://127.0.0.1:${String((target.address() as { port: number }).port)}/`;
    try {
      assert.equal(await (await fetch(url)).text(), "internal"); // reachable without the guard
      await assert.rejects(cimdFetch(url, { dispatcher: init.dispatcher } as RequestInit));
    } finally {
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });
});
