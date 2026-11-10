/**
 * THE OAUTH RIG, SHARED (DIR1, 2026-11-10): a real `createApp` on a free port, a cookie-keeping
 * browser, and every step a connector client takes from the 401 to a token: discovery, DCR or a CIMD
 * client id, PKCE S256, sign-in, the Allow page, the code. `oauth.test.ts` keeps its own copy; this
 * one also takes the redirect URI (Claude Code's loopback) and how to sign in (a reviewer's code).
 *
 * Hermetic: a temp data root the caller made, an in-memory mailer, a CIMD fetch that serves fixture
 * documents and never the network, and a stub spawner (no worker runs).
 */
import assert from "node:assert/strict";
import { join } from "node:path";

import * as oauth from "oauth4webapi";

import { createApp } from "../src/app.js";
import type { App, AppOptions } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { freePort, rpc } from "./helpers.js";

export const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
export const insecure = { [oauth.allowInsecureRequests]: true } as const;

/** Claude Code's own Client ID Metadata Document, as https://claude.ai/oauth/claude-code-client-metadata served it on 2026-11-10. */
export const CLAUDE_CODE_CIMD_URL = "https://claude.ai/oauth/claude-code-client-metadata";
export const CLAUDE_CODE_CIMD = {
  client_id: CLAUDE_CODE_CIMD_URL,
  client_name: "Claude Code",
  client_uri: "https://claude.ai",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
} as const;

export class Browser {
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

export const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

export interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
  cimd: Map<string, unknown>;
  close: () => Promise<void>;
}

/** A listening app under `dataRoot`. `extra` reaches `createApp` as is. */
export async function rig(dataRoot: string, extra: Partial<AppOptions> = {}): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const cimd = new Map<string, unknown>();
  const app = createApp({
    dataRoot: join(dataRoot, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
    cimdFetch: async (input) => {
      const doc = cimd.get(String(input));
      return doc === undefined ? new Response("no", { status: 404 }) : new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
    },
    ...extra,
  });
  await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
  const close = async (): Promise<void> => {
    await new Promise<void>((r) => {
      app.server.close(() => r());
      app.server.closeAllConnections?.();
    });
    await app.close();
  };
  return { app, origin, mail, cimd, close };
}

/** Sign `browser` in by emailed link as `email` (a sign-up when `invite` is a code), landing on `next`. */
export async function signInByLink(r: Rig, browser: Browser, email: string, invite: string, next: string): Promise<Response> {
  const form = await (await browser.go(`/login?next=${encodeURIComponent(next)}`)).text();
  const before = r.mail.sent.length;
  await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next });
  assert.equal(r.mail.sent.length, before + 1, "a link was mailed");
  const link = /https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0];
  return browser.go(link);
}

export interface Connected {
  access: string;
  refresh: string;
  browser: Browser;
  clientId: string;
}

export interface ConnectOptions {
  /** A CIMD client id; absent, the client registers (DCR) with `redirectUri`. */
  clientId?: string;
  redirectUri?: string;
  browser?: Browser;
  /** How the browser signs in when the Allow page sends it to /login. Default: an emailed link for `email`. */
  signIn?: (browser: Browser, next: string) => Promise<Response>;
  email?: string;
  invite?: string;
}

/** Everything a connector client does, from the 401 to a token. */
export async function connect(r: Rig, opts: ConnectOptions = {}): Promise<Connected> {
  const redirectUri = opts.redirectUri ?? CALLBACK;
  const unauth = await rpc(`${r.origin}/mcp`, "tools/list");
  assert.equal(unauth.status, 401);
  const pointer = /resource_metadata="([^"]+)"/.exec(String(unauth.headers.get("www-authenticate")))![1]!;
  const prm = (await (await fetch(pointer)).json()) as { resource: string; authorization_servers: string[] };
  const issuer = new URL(prm.authorization_servers[0]!);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  let client: oauth.Client;
  if (opts.clientId === undefined) {
    const reg = await oauth.processDynamicClientRegistrationResponse(
      await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [redirectUri], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
    );
    client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  } else {
    client = { client_id: opts.clientId, token_endpoint_auth_method: "none" };
  }
  const verifier = oauth.generateRandomCodeVerifier();
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "memory",
    resource: prm.resource,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const browser = opts.browser ?? new Browser(r.origin);
  let res = await browser.go(authz.toString());
  assert.equal(res.status, 303, `authorize answered ${String(res.status)}: ${await res.clone().text()}`);
  let loc = new URL(res.headers.get("location")!, r.origin);
  assert.match(loc.pathname, /^\/oauth\/allow\//);
  const allowPath = loc.pathname;
  res = await browser.go(allowPath);
  if (res.status === 303) {
    assert.equal(res.headers.get("location"), `/login?next=${encodeURIComponent(allowPath)}`);
    const signed = opts.signIn !== undefined ? await opts.signIn(browser, allowPath) : await signInByLink(r, browser, opts.email ?? "someone@example.com", opts.invite ?? "", allowPath);
    assert.equal(signed.headers.get("location"), allowPath);
    res = await browser.go(allowPath);
  }
  assert.equal(res.status, 200);
  const html = await res.text();
  res = await browser.form(allowPath, { csrf: csrfOf(html), decision: "allow" });
  const back = new URL(redirectUri);
  for (let i = 0; i < 5 && res.status === 303; i++) {
    loc = new URL(res.headers.get("location")!, r.origin);
    if (loc.origin === back.origin) break;
    res = await browser.go(loc.toString());
  }
  assert.equal(loc.origin + loc.pathname, back.origin + back.pathname);
  const params = oauth.validateAuthResponse(as, client, loc, "st-1");
  const tokens = await oauth.processAuthorizationCodeResponse(
    as,
    client,
    await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, redirectUri, verifier, { additionalParameters: { resource: prm.resource }, ...insecure }),
  );
  return { access: tokens.access_token, refresh: tokens.refresh_token!, browser, clientId: client.client_id };
}

export const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
