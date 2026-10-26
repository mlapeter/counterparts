/**
 * OAUTH 2.1 FOR THE CONNECTOR (OL2 step 4; design §4.3–§4.6).
 *
 * oidc-provider 9.13.0 (pinned exactly; DESIGN Q1) is the protocol core: DCR,
 * CIMD (an experiment in this version, `ack: "draft-02"`), PKCE S256 only,
 * resource indicators with an audience, opaque tokens, refresh rotation,
 * revocation, `iss` on the authorization response. Around it, ours:
 *
 *   - **the metadata** claude.ai discovers: Protected Resource Metadata at the
 *     path-inserted and root well-knowns, and the authorization-server document
 *     at both the RFC 8414 and the OIDC well-known;
 *   - **the Allow page** (the library's "interaction"): signed in with OUR
 *     account (`pages.ts`), CSRF-bound, framed by nobody, naming the app by
 *     where it really lives;
 *   - **`authenticate`**: an access token → the person and their one store,
 *     checking expiry, audience, scope, that the grant still exists (so a
 *     disconnect is immediate), and that the person is live;
 *   - **connections**: list and disconnect for the account page;
 *   - **storage** in `oauth-adapter.ts`, every bearer value hashed.
 *
 * Every URL is built from `publicOrigin`, never from a request's Host.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import Provider, { errors } from "oidc-provider";
import type { Configuration, KoaContextWithOIDC } from "oidc-provider";

import type { Accounts } from "./accounts.js";
import { cimdFetch } from "./egress.js";
import type { CimdFetch } from "./egress.js";
import { OidcStore } from "./oauth-adapter.js";
import type { ConnectionView, Pages } from "./pages.js";
import { resourceMetadataUrl, resourceUrl } from "./server.js";
import type { Authenticate, Caller, Route } from "./server.js";
import { RateLimit, clientIp, escapeHtml, page, parseCookies, readForm, redirect, sameOrigin } from "./web.js";

export const SCOPE = "memory";
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
/** No absolute cap in the beta (Q11): a grant outlives any refresh token by far. */
export const GRANT_TTL_S = 5 * 365 * 24 * 60 * 60;
export const CODE_TTL_S = 120;
export const INTERACTION_TTL_S = 60 * 60;

export interface OAuthOptions {
  readonly publicOrigin: string;
  readonly accounts: Accounts;
  readonly pages: Pages;
  /** `HOSTED_DATA_ROOT/control/oauth.sqlite`. */
  readonly storePath: string;
  /** Behind Railway's proxy: trust X-Forwarded-Proto for cookies and URLs. */
  readonly trustProxy?: boolean;
  /** Keys for oidc-provider's own signed cookies; random per process when absent (a restart drops in-flight sign-ins only). */
  readonly cookieKeys?: readonly string[];
  /** How CIMD documents are fetched (tests point it at a fixture). The library adds its own SSRF guard on Node. */
  readonly fetch?: CimdFetch;
}

export interface OAuth {
  readonly provider: Provider;
  readonly store: OidcStore;
  /** Metadata, the Allow page, and the library's endpoints. */
  readonly route: Route;
  readonly authenticate: Authenticate;
  readonly connections: {
    list(personId: string): Promise<ConnectionView[]>;
    disconnect(personId: string, id: string): Promise<void>;
  };
  /** Every connection of one person (account delete, suspension). */
  revokeAll(personId: string): void;
  close(): void;
}

/** Both spellings of the resource people paste: `/mcp` and `/mcp/`. Nothing else. */
export function isOurResource(value: unknown, publicOrigin: string): boolean {
  const ours = resourceUrl(publicOrigin);
  return value === ours || value === `${ours}/`;
}

/** Where an app sends the person back, as they would recognise it. */
export function returnsTo(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return u.host;
    if (u.protocol === "http:") return "an app on this computer";
    return `an app (${u.protocol.replace(/:$/, "")})`;
  } catch {
    return "an app";
  }
}

/** Who is asking, by where they really are: a CIMD client by its URL's host; a registered one by where it returns to. */
export function clientLabel(clientId: string, redirectUris: readonly string[], clientName?: string): string {
  if (/^https:\/\//.test(clientId)) {
    try {
      return new URL(clientId).host;
    } catch {
      /* fall through */
    }
  }
  const hosts = [...new Set(redirectUris.map(returnsTo))];
  const where = hosts.join(", ") || "an app";
  return clientName !== undefined && clientName.length > 0 ? `${clientName.slice(0, 60)} (${where})` : where;
}

export function protectedResourceMetadata(publicOrigin: string): Record<string, unknown> {
  return {
    resource: resourceUrl(publicOrigin),
    authorization_servers: [publicOrigin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Counterparts",
    resource_documentation: "https://counterparts.ai",
  };
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", ...CORS, ...extra });
  res.end(JSON.stringify(body));
}

export function createOAuth(opts: OAuthOptions): OAuth {
  const origin = opts.publicOrigin.replace(/\/+$/, "");
  const secure = origin.startsWith("https://");
  const store = new OidcStore(opts.storePath);
  const RESOURCE = resourceUrl(origin);
  const { accounts, pages } = opts;

  // Signing keys: no ID tokens are issued (no `openid` scope) and access tokens
  // are opaque, but the library wants a key set. A fresh EC key per process,
  // generated at start; nothing persisted is signed with it.
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });

  const configuration = {
    clients: [],
    jwks: { keys: [{ ...jwk, use: "sig", alg: "ES256", kid: randomBytes(8).toString("hex") }] },
    adapter: (name: string) => store.adapterFor(name),
    findAccount: async (_ctx: KoaContextWithOIDC, id: string) => (accounts.isLive(id) ? { accountId: id, claims: async () => ({ sub: id }) } : undefined),
    scopes: [SCOPE],
    claims: {},
    clientAuthMethods: ["none"],
    clientDefaults: { token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], id_token_signed_response_alg: "ES256" },
    enabledJWA: { idTokenSigningAlgValues: ["ES256"] },
    responseTypes: ["code"],
    pkce: { required: () => true },
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx: unknown, client: { grantTypeAllowed(t: string): boolean }) => client.grantTypeAllowed("refresh_token"),
    routes: {
      authorization: "/oauth/authorize",
      token: "/oauth/token",
      registration: "/oauth/register",
      revocation: "/oauth/revoke",
      jwks: "/oauth/jwks",
      userinfo: "/oauth/userinfo",
      end_session: "/oauth/session/end",
      introspection: "/oauth/introspect",
      pushed_authorization_request: "/oauth/par",
      device_authorization: "/oauth/device",
      backchannel_authentication: "/oauth/backchannel",
      code_verification: "/oauth/device/verify",
      challenge: "/oauth/challenge",
    },
    ttl: {
      AccessToken: ACCESS_TTL_S,
      AuthorizationCode: CODE_TTL_S,
      RefreshToken: REFRESH_TTL_S,
      Grant: GRANT_TTL_S,
      Interaction: INTERACTION_TTL_S,
      Session: 24 * 60 * 60,
    },
    cookies: {
      keys: opts.cookieKeys !== undefined && opts.cookieKeys.length > 0 ? [...opts.cookieKeys] : [randomBytes(32).toString("base64url")],
      long: { secure, sameSite: "lax", httpOnly: true },
      short: { secure, sameSite: "lax", httpOnly: true },
    },
    interactions: { url: (_ctx: unknown, interaction: { uid: string }) => `/oauth/allow/${interaction.uid}` },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      introspection: { enabled: false },
      registration: { enabled: true, initialAccessToken: false },
      revocation: { enabled: true },
      clientIdMetadataDocument: {
        enabled: true,
        ack: "draft-02",
        // https on the default port only; the library itself refuses non-https,
        // fragments, credentials and dot-segments, and (on Node) special-use IPs.
        allowFetch: async (_ctx: unknown, clientId: string) => {
          try {
            const u = new URL(clientId);
            return u.protocol === "https:" && u.port === "";
          } catch {
            return false;
          }
        },
        allowClient: async () => true,
        cacheDuration: { min: 30, max: 24 * 60 * 60 },
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => RESOURCE,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx: unknown, resource: string) => {
          if (!isOurResource(resource, origin)) throw new errors.InvalidTarget("resource must be this server's /mcp");
          return { scope: SCOPE, audience: resource, accessTokenFormat: "opaque", accessTokenTTL: ACCESS_TTL_S };
        },
      },
    },
    fetch: opts.fetch ?? cimdFetch,
    renderError: async (ctx: KoaContextWithOIDC, out: { error: string; error_description?: string }) => {
      ctx.type = "html";
      ctx.body = `<!doctype html><meta charset="utf-8"><title>Sign-in problem · Counterparts</title><body style="font:16px system-ui;max-width:34rem;margin:3rem auto"><h1>That sign-in didn't work</h1><p>${escapeHtml(out.error)}${out.error_description === undefined ? "" : `: ${escapeHtml(out.error_description)}`}</p><p>Start connecting again from the app.</p></body>`;
    },
  } as unknown as Configuration;

  const provider = new Provider(origin, configuration);
  provider.proxy = opts.trustProxy === true;
  const callback = provider.callback();

  /** Hand a request to the library, optionally under another path (the RFC 8414 alias). */
  const toProvider = (req: IncomingMessage, res: ServerResponse, path?: string): Promise<void> =>
    new Promise<void>((done) => {
      if (path !== undefined) req.url = path;
      res.once("finish", () => done());
      res.once("close", () => done());
      void (callback as (req: IncomingMessage, res: ServerResponse) => unknown)(req, res);
    });

  // Per-IP limits on the open endpoints (registration is open to anyone, and
  // Claude registers a client per fresh connection). Generous: a person
  // connecting twice a day never meets them.
  const registerLimit = new RateLimit(30, 60 * 60 * 1000);
  const tokenLimit = new RateLimit(600, 60 * 60 * 1000);
  const limited = (res: ServerResponse): void => {
    res.writeHead(429, { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "3600" });
    res.end(JSON.stringify({ error: "slow_down", error_description: "too many requests from this network in the last hour" }));
  };

  // ── the Allow page ────────────────────────────────────────────────────────

  const allowPage = async (req: IncomingMessage, res: ServerResponse, uid: string): Promise<void> => {
    let details: Awaited<ReturnType<Provider["interactionDetails"]>>;
    try {
      details = await provider.interactionDetails(req, res);
    } catch {
      page(res, 400, { title: "Start again", body: `<h1>Start again</h1><p>This sign-in has expired or was started in another browser. Start connecting again from the app.</p>` });
      return;
    }
    if (details.uid !== uid) {
      page(res, 400, { title: "Start again", body: `<h1>Start again</h1><p>This sign-in doesn't match. Start connecting again from the app.</p>` });
      return;
    }
    const browser = pages.browserOf(req, res);
    const personId = pages.personOf(req);
    if (personId === null) {
      redirect(res, `/login?next=${encodeURIComponent(`/oauth/allow/${uid}`)}`);
      return;
    }
    const person = accounts.person(personId);
    const params = details.params as Record<string, unknown>;
    const client = await provider.Client.find(String(params["client_id"]));
    if (client === undefined || person === null) {
      page(res, 400, { title: "Start again", body: `<h1>Start again</h1><p>The app that sent you here isn't known. Start connecting again from the app.</p>` });
      return;
    }
    const redirectUri = String(params["redirect_uri"] ?? "");
    const label = clientLabel(client.clientId, client.redirectUris ?? [], client.clientName);
    let formAction = "'self'";
    try {
      const back = new URL(redirectUri);
      if (back.protocol === "https:" || back.protocol === "http:") formAction = `'self' ${back.origin}`;
    } catch {
      /* the library validated it; nothing to add */
    }
    if (req.method === "GET") {
      page(res, 200, {
        title: "Allow access",
        formAction,
        body: `<h1>Connect ${escapeHtml(label)} to your memory?</h1>
<p><strong>${escapeHtml(label)}</strong> is asking to <strong>read and add to your Counterparts memory</strong>, as you.</p>
<p class="muted">It will send you back to ${escapeHtml(returnsTo(redirectUri))}. You can disconnect it any time from your account page.</p>
<p>Signed in as <strong>${escapeHtml(person.email ?? "")}</strong>. <a href="/account">Not you?</a></p>
<form method="post" action="/oauth/allow/${escapeHtml(uid)}">
<input type="hidden" name="csrf" value="${escapeHtml(pages.csrf.token(browser))}">
<button type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`,
      });
      return;
    }
    // POST: the person's answer.
    const form = await readForm(req);
    if (form === null || !sameOrigin(req, origin) || !pages.csrf.check(parseCookies(req).get(pages.cookieNames.browser), form.get("csrf"))) {
      page(res, 403, { title: "Start again", body: `<h1>Start again</h1><p>This form expired or came from somewhere else.</p>` });
      return;
    }
    if (form.get("decision") !== "allow") {
      accounts.audit(personId, null, "oauth.denied", null);
      await provider.interactionFinished(req, res, { error: "access_denied", error_description: "the person declined" }, { mergeWithLastSubmission: false });
      return;
    }
    const grant = new provider.Grant({ accountId: personId, clientId: client.clientId });
    const asked = params["resource"];
    const resources = (Array.isArray(asked) ? asked : asked === undefined ? [RESOURCE] : [asked]).map(String).filter((r) => isOurResource(r, origin));
    for (const r of resources.length === 0 ? [RESOURCE] : resources) grant.addResourceScope(r, SCOPE);
    // `memory` asked for as a plain scope too (it is in `scopes`): granted as
    // such, and nothing else — no other scope exists to grant.
    if (String(params["scope"] ?? "").split(" ").includes(SCOPE)) grant.addOIDCScope(SCOPE);
    const grantId = await grant.save();
    accounts.audit(personId, null, "oauth.allowed", client.clientId.slice(0, 120));
    await provider.interactionFinished(req, res, { login: { accountId: personId }, consent: { grantId } }, { mergeWithLastSubmission: false });
  };

  // ── routes ────────────────────────────────────────────────────────────────

  const route: Route = async (req, res, url) => {
    const p = url.pathname;
    if (p === "/.well-known/oauth-protected-resource/mcp" || p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp/") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS).end();
        return true;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      req.resume();
      json(res, 200, protectedResourceMetadata(origin));
      return true;
    }
    if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/openid-configuration") {
      // One document at both: clients must try both (MCP spec), and the library serves the OIDC one.
      await toProvider(req, res, `/.well-known/openid-configuration${url.search}`);
      return true;
    }
    const allow = /^\/oauth\/allow\/([A-Za-z0-9_-]{8,64})$/.exec(p);
    if (allow !== null && (req.method === "GET" || req.method === "POST")) {
      await allowPage(req, res, allow[1]!);
      return true;
    }
    if (p.startsWith("/oauth/") && p !== "/oauth/allow" && !p.startsWith("/oauth/allow/")) {
      const ip = clientIp(req, opts.trustProxy === true);
      if (req.method === "POST" && ((p === "/oauth/register" && !registerLimit.take(ip)) || (p === "/oauth/token" && !tokenLimit.take(ip)))) {
        req.resume();
        limited(res);
        return true;
      }
      await toProvider(req, res);
      return true;
    }
    return false;
  };

  // ── the resource server side ──────────────────────────────────────────────

  const authenticate: Authenticate = async (token: string): Promise<Caller | null> => {
    const at = await provider.AccessToken.find(token);
    if (at === undefined || at.isExpired) return null;
    if (!isOurResource(at.aud, origin)) return null;
    if (!String(at.scope ?? "").split(" ").includes(SCOPE)) return null;
    if (at.grantId === undefined || (await provider.Grant.find(at.grantId)) === undefined) return null;
    const personId = at.accountId;
    if (personId === undefined || !accounts.isLive(personId)) return null;
    const person = accounts.person(personId);
    if (person === null || person.storeId === null) return null;
    store.touchGrant(at.grantId);
    return { personId, storeId: person.storeId, ...(person.timeZone === null ? {} : { timeZone: person.timeZone }) };
  };

  const connections = {
    async list(personId: string): Promise<ConnectionView[]> {
      const out: ConnectionView[] = [];
      for (const g of store.grantsOf(personId)) {
        const client = await provider.Client.find(g.clientId).catch(() => undefined);
        out.push({
          id: g.id,
          client: client === undefined ? clientLabel(g.clientId, []) : clientLabel(client.clientId, client.redirectUris ?? [], client.clientName),
          createdAt: g.createdAt,
          lastUsedAt: store.lastUsed(g.id),
        });
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },
    async disconnect(personId: string, id: string): Promise<void> {
      // Only this person's grant: an id from someone else's page does nothing.
      if (store.grantAccount(id) !== personId) return;
      store.revokeGrant(id);
      accounts.audit(personId, null, "oauth.disconnected", null);
    },
  };

  return {
    provider,
    store,
    route,
    authenticate,
    connections,
    revokeAll: (personId) => store.revokeAccount(personId),
    close: () => store.close(),
  };
}

export { resourceMetadataUrl };
