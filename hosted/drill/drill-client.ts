/**
 * The restore drill's client (docs/hosted/RUNBOOK.md, "The drill with the real
 * binary"): what a person's browser and claude.ai do against the drill
 * container, and the reads drill.sh needs from the drill bucket. drill.sh runs
 * one subcommand at a time:
 *
 *   ~/.bun/bin/bun hosted/drill/drill-client.ts <command> [args]
 *
 * Adapted from hosted/test/ops.test.ts (`Browser`, `connect`) and
 * delete.test.ts (connect from a signed-in browser, refresh). It runs from this
 * checkout, with hosted/'s own dependencies (bun install --cwd hosted); the
 * image it drives is built from a worktree at production's deployed commit.
 * Its own state (emails, invite codes, cookie jars, tokens, nonces) is the 0600
 * JSON file DRILL_STATE, in the drill's scratch directory, never in the
 * repository. It never prints a token, a cookie, an invite code, the KEK or
 * the R2 secret.
 *
 * Environment: DRILL_STATE (required), DRILL_NAME (the container, for
 * `invite` and the SSE-C key file `ssec-check` reads), and for the bucket commands R2_ENDPOINT,
 * R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 *
 * `smoke` checks the bucket helpers against the SSE-C stand-in, with no
 * network and no credentials: `DRILL_STATE=$(mktemp) bun hosted/drill/drill-client.ts smoke`.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import { AwsClient } from "aws4fetch";
import * as oauth from "oauth4webapi";

import { r2ObjectStore } from "../src/egress.js";
import { rpc, s3StandIn } from "../test/helpers.js";

const ORIGIN = "http://127.0.0.1:8080"; // exactly this: the token's audience is ORIGIN/mcp
const MCP = `${ORIGIN}/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback"; // read from Location, never fetched
const insecure = { [oauth.allowInsecureRequests]: true } as const;

class Failed extends Error {}
const fail = (expected: string, saw: string): never => {
  throw new Failed(`expected ${expected}; saw ${saw}`);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── state ─────────────────────────────────────────────────────────────────────

interface State {
  emails: string[];
  invites: string[];
  jars: Record<string, Record<string, string>>;
  oauth?: { clientId: string; access: string; refresh: string; issuedAt: number };
  session?: string;
  nonces: Record<string, string[]>;
}
const STATE = process.env["DRILL_STATE"] ?? fail("DRILL_STATE set", "nothing");
function load(): State {
  if (!existsSync(STATE)) return { emails: [], invites: [], jars: {}, nonces: {} };
  return JSON.parse(readFileSync(STATE, "utf8")) as State;
}
function save(s: State): void {
  writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 });
  chmodSync(STATE, 0o600);
}

// ── a browser (ops.test.ts) ───────────────────────────────────────────────────

class Browser {
  readonly jar: Map<string, string>;
  constructor(jar: Record<string, string> = {}) {
    this.jar = new Map(Object.entries(jar));
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(target, ORIGIN);
    if (url.origin !== ORIGIN) fail(`a request to ${ORIGIN}`, `a request to ${url.origin}`);
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
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
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? fail("a csrf field on the page", html.slice(0, 200));

// ── the person: invite, sign up ───────────────────────────────────────────────

function container(): string {
  return process.env["DRILL_NAME"] ?? fail("DRILL_NAME set", "nothing");
}

/** `invite` in the running container; the code goes to the state file, never to stdout. */
function invite(n: number): string {
  const out = spawnSync("docker", ["exec", container(), "node", "--import", "./src/adapters/node-hooks.mjs", "hosted/src/main.ts", "invite", "--note", `drill-${String(n)}`], { encoding: "utf8", timeout: 60_000 });
  const code = out.stdout.trim();
  if (out.status !== 0 || !/^\S{6,}$/.test(code)) fail("invite to exit 0 with a code on stdout", `exit ${String(out.status)}, stderr: ${out.stderr.trim().slice(0, 300)}`);
  const s = load();
  s.invites[n - 1] = code;
  save(s);
  return `invite ${String(n)} made (${String(code.length)} characters)`;
}

/** Sign-up through the magic link; the link is read from the container's log (MAIL=log), polled: the send isn't awaited. */
async function signup(n: number, log: string): Promise<string> {
  const s = load();
  const code = s.invites[n - 1] ?? fail(`invite ${String(n)} in the state file`, "none");
  const email = s.emails[n - 1] ?? `drill-${String(n)}-${randomBytes(4).toString("hex")}@example.com`;
  s.emails[n - 1] = email;
  save(s);
  const b = new Browser();
  const offset = readFileSync(log).length; // only an email sent from here on: a re-run must not reuse a spent link
  const page = await b.go("/login");
  if (page.status !== 200) fail("GET /login 200", String(page.status));
  const sent = await b.form("/login", { csrf: csrfOf(await page.text()), email, invite: code, tz: "America/Denver", next: "/account" });
  const sentText = await sent.text();
  if (sent.status !== 200 || !sentText.includes("Check your email")) fail('POST /login 200 "Check your email"', `${String(sent.status)} ${sentText.slice(0, 200)}`);
  const marker = `(MAIL=log) an email for ${email}`;
  let link: string | null = null;
  for (let i = 0; i < 40 && link === null; i++) {
    const text = readFileSync(log).subarray(offset).toString("utf8");
    const at = text.lastIndexOf(marker);
    if (at >= 0) link = /http:\/\/127\.0\.0\.1:8080\/login\/link\?token=\S+/.exec(text.slice(at))?.[0] ?? null;
    if (link === null) await sleep(500);
  }
  if (link === null) fail(`"${marker}" and a link in ${log} within 20 s`, "neither");
  const used = await b.go(link!);
  if (used.status !== 303 && used.status !== 302) fail("the link to redirect (303) with a session", `${String(used.status)} ${(await used.text()).slice(0, 200)}`);
  if (![...b.jar.keys()].some((k) => k.endsWith("cp_session"))) fail("a cp_session cookie after the link", [...b.jar.keys()].join(",") || "no cookies");
  const account = await b.go("/account");
  if (account.status !== 200) fail("GET /account 200 once signed in", String(account.status));
  s.jars[String(n)] = Object.fromEntries(b.jar);
  save(s);
  return `user ${String(n)} signed up (${email}); /login ${String(sent.status)}, link ${String(used.status)}, /account ${String(account.status)}`;
}

// ── claude.ai: OAuth from a signed-in browser (delete.test.ts#connect) ────────

async function discover(): Promise<{ as: oauth.AuthorizationServer; resource: string }> {
  const unauth = await rpc(MCP, "tools/list");
  if (unauth.status !== 401) fail("/mcp without a token: 401", String(unauth.status));
  const pointer = /resource_metadata="([^"]+)"/.exec(String(unauth.headers.get("www-authenticate")))?.[1] ?? fail("a resource_metadata pointer", String(unauth.headers.get("www-authenticate")));
  const prm = (await (await fetch(pointer)).json()) as { resource: string; authorization_servers: string[] };
  if (prm.resource !== MCP) fail(`resource ${MCP}`, prm.resource);
  const issuer = new URL(prm.authorization_servers[0]!);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  return { as, resource: prm.resource };
}

async function connect(): Promise<string> {
  const s = load();
  const b = new Browser(s.jars["1"] ?? fail("user 1's cookie jar in the state file", "none"));
  const { as, resource } = await discover();
  const reg = await oauth.processDynamicClientRegistrationResponse(
    await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
  );
  const client: oauth.Client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  const verifier = oauth.generateRandomCodeVerifier();
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", resource, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state: "drill" }).toString();
  let res = await b.go(authz.toString());
  let loc = new URL(res.headers.get("location") ?? fail("a redirect from /authorize", String(res.status)), ORIGIN);
  const allowPath = loc.pathname;
  res = await b.go(allowPath);
  if (res.status !== 200) fail("the Allow page 200 (the browser is signed in)", String(res.status));
  res = await b.form(allowPath, { csrf: csrfOf(await res.text()), decision: "allow" });
  for (let i = 0; i < 5 && res.status === 303; i++) {
    loc = new URL(res.headers.get("location")!, ORIGIN);
    if (loc.origin === "https://claude.ai") break;
    res = await b.go(loc.toString());
  }
  if (loc.origin + loc.pathname !== CALLBACK) fail(`a redirect to ${CALLBACK}`, `${String(res.status)} to ${loc.origin}${loc.pathname}`);
  const params = oauth.validateAuthResponse(as, client, loc, "drill");
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, CALLBACK, verifier, { additionalParameters: { resource }, ...insecure }));
  if (tokens.refresh_token === undefined) fail("a refresh token", "none");
  s.oauth = { clientId: client.client_id, access: tokens.access_token, refresh: tokens.refresh_token!, issuedAt: Date.now() };
  s.jars["1"] = Object.fromEntries(b.jar);
  save(s);
  return `OAuth: DCR, PKCE, Allow, code exchanged; access token (expires_in ${String(tokens.expires_in)} s) and refresh token kept`;
}

async function refresh(): Promise<string> {
  const s = load();
  const o = s.oauth ?? fail("tokens in the state file", "none");
  const { as } = await discover();
  const client: oauth.Client = { client_id: o.clientId, token_endpoint_auth_method: "none" };
  const res = await oauth.refreshTokenGrantRequest(as, client, oauth.None(), o.refresh, insecure);
  if (res.status !== 200) fail("the refresh grant 200", `${String(res.status)} ${(await res.clone().text()).slice(0, 200)}`);
  const next = await oauth.processRefreshTokenResponse(as, client, res);
  // Rotation (oauth.ts rotateRefreshToken): the old one is spent now, so the new one is kept at once.
  s.oauth = { clientId: o.clientId, access: next.access_token, refresh: next.refresh_token ?? o.refresh, issuedAt: Date.now() };
  save(s);
  if (next.access_token === o.access) fail("a new access token", "the old one");
  return `refresh: 200, new access token${next.refresh_token !== undefined && next.refresh_token !== o.refresh ? ", refresh token rotated" : ", refresh token NOT rotated"}`;
}

// ── the memory tools ──────────────────────────────────────────────────────────

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const s = load();
  const o = s.oauth ?? fail("tokens in the state file", "none");
  const out = await rpc(MCP, "tools/call", { name, arguments: args }, { authorization: `Bearer ${o.access}` });
  if (out.status !== 200) fail(`tools/call ${name}: HTTP 200`, `HTTP ${String(out.status)} ${JSON.stringify(out.body).slice(0, 300)}`);
  const result = (out.body["result"] as Record<string, unknown> | undefined) ?? fail(`tools/call ${name}: a result`, JSON.stringify(out.body).slice(0, 300));
  if (result["isError"] === true) fail(`tools/call ${name}: no error`, JSON.stringify(result).slice(0, 300));
  return result;
}

async function wake(): Promise<string> {
  const r = await call("wake", {});
  const session = (r["structuredContent"] as { session?: unknown } | undefined)?.session;
  if (typeof session !== "string" || session.length === 0) fail("wake to return a session", JSON.stringify(r).slice(0, 300));
  const s = load();
  s.session = session as string;
  save(s);
  return `wake: 200, session ${(session as string).slice(0, 6)}…`;
}

/**
 * The memory each label leaves: its own sentence (the same words under two labels are
 * near-duplicates, and recall shows one of them), the nonce near the front (recall's
 * answer lines are cut short). Recall asks each label's question, never the nonce.
 */
const MEMORIES: Record<string, { words: string; question: string }> = {
  A: { words: "the brass lantern hangs on the hook in the north shed", question: "where does the brass lantern hang" },
  B: { words: "the spare canoe paddles lean behind the boathouse door", question: "where are the spare canoe paddles" },
  C: { words: "the copper kettle sits on the second shelf of the pantry", question: "where is the copper kettle" },
};
const memory = (label: string): { words: string; question: string } => MEMORIES[label] ?? fail("a label A, B or C", label);

async function remember(label: string): Promise<string> {
  const s = load();
  const session = s.session ?? fail("a session from wake", "none");
  const nonce = `drill${label.toLowerCase()}${randomBytes(5).toString("hex")}`;
  await call("remember", { session, text: `Drill memory ${label}, tag ${nonce}: ${memory(label).words}.` });
  // Every nonce a label was given: a re-run step remembers the same sentence again, and
  // recall may show the earlier copy of what is then a near-duplicate.
  s.nonces[label] = [...(s.nonces[label] ?? []), nonce];
  save(s);
  return `remember ${label}: 200 (nonce ${nonce})`;
}

/**
 * Recall each label by its own question. "A" passes on any nonce A was given (a re-run
 * step remembers it again). "B!" asks for B's NEWEST nonce only, and says "NOT found"
 * instead of failing: drill.sh records that as a finding (the write before the stop).
 */
async function recall(labels: string[]): Promise<string> {
  await wake();
  const s = load();
  const found: string[] = [];
  for (const raw of labels) {
    const newest = raw.endsWith("!");
    const l = newest ? raw.slice(0, -1) : raw;
    const r = await call("recall", { session: s.session, question: memory(l).question, mode: "facts" });
    const text = JSON.stringify(r);
    const mine = s.nonces[l] ?? fail(`a nonce for ${l} in the state file`, "none");
    if (newest) {
      const last = mine.at(-1)!;
      const earlier = mine.slice(0, -1).filter((n) => text.includes(n));
      found.push(text.includes(last) ? `${l} newest (${last}) found` : `${l} newest (${last}) NOT found${earlier.length > 0 ? ` (an earlier attempt's ${earlier.join(", ")} was)` : ""}`);
      continue;
    }
    const hit = [...mine].reverse().find((n) => text.includes(n));
    if (hit === undefined) fail(`recall "${memory(l).question}" to return ${l} (${mine.join(" or ")})`, text.slice(0, 600));
    found.push(`${l} (${hit!}${hit === mine.at(-1) ? "" : ", an earlier attempt's: the step was re-run"}) found`);
  }
  return `recall: ${found.join(", ")}`;
}

/** Minutes since the access token was issued (step 10 says an expired token is time, not the restore). */
function tokenAge(): string {
  const o = load().oauth ?? fail("tokens in the state file", "none");
  return String(Math.floor((Date.now() - o.issuedAt) / 60_000));
}

// ── the drill bucket ──────────────────────────────────────────────────────────

interface R2 {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}
function r2FromEnv(): R2 {
  const need = (k: string): string => process.env[k] ?? fail(`${k} set (drill.sh reads ~/.config/counterparts-drill.env)`, "nothing");
  const r = { endpoint: need("R2_ENDPOINT").replace(/\/+$/, ""), bucket: need("R2_BUCKET"), accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") };
  if (r.bucket !== "counterparts-drill") fail("R2_BUCKET=counterparts-drill (never the production bucket)", r.bucket);
  return r;
}
const store = (r: R2): ReturnType<typeof r2ObjectStore> => r2ObjectStore({ ...r, timeoutMs: 30_000 });

/** The highest maxTXID among `<prefix><4-hex level>/<16 hex>-<16 hex>.ltx` (Litestream 0.5.17, ltx v0.5.2's FormatFilename); 0n for none. */
function maxTxid(keys: string[], prefix: string): bigint {
  let max = 0n;
  for (const k of keys) {
    if (!k.startsWith(prefix)) continue;
    const m = /^[0-9a-f]{4}\/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/.exec(k.slice(prefix.length));
    if (m !== null && BigInt(`0x${m[2]!}`) > max) max = BigInt(`0x${m[2]!}`);
  }
  return max;
}

async function txid(r: R2, prefix: string): Promise<bigint> {
  return maxTxid(await store(r).list(prefix), prefix);
}

/** Until the highest maxTXID under `prefix` is above `baseline`; prints it. On timeout, the listing (the diagnostic drill.sh adds Litestream's own view to). */
async function waitTxid(r: R2, prefix: string, baseline: bigint, seconds: number): Promise<string> {
  const until = Date.now() + seconds * 1000;
  const started = Date.now();
  for (;;) {
    const keys = await store(r).list(prefix);
    const now = maxTxid(keys, prefix);
    if (now > baseline) return `${now.toString()} (from ${baseline.toString()}, ${((Date.now() - started) / 1000).toFixed(1)} s)`;
    if (Date.now() > until) fail(`maxTXID under ${prefix} above ${baseline.toString()} within ${String(seconds)} s`, `${now.toString()}; ${String(keys.length)} objects: ${keys.slice(-8).join(" ")}`);
    await sleep(1000);
  }
}

/** Until the highest maxTXID under `prefix` holds still for 6 s (a baseline no write in flight will lift). */
async function settle(r: R2, prefix: string, seconds = 60): Promise<string> {
  const until = Date.now() + seconds * 1000;
  let last = await txid(r, prefix);
  let since = Date.now();
  for (;;) {
    await sleep(2000);
    const now = await txid(r, prefix);
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= 6000) return last.toString();
    if (Date.now() > until) fail(`maxTXID under ${prefix} to hold still within ${String(seconds)} s`, `still moving at ${now.toString()}`);
  }
}

/** Everything in the bucket deleted, and the listing then empty. */
async function empty(r: R2): Promise<string> {
  const st = store(r);
  const keys = await st.list("");
  for (const k of keys) await st.delete(k);
  const left = await st.list("");
  if (left.length > 0) fail("an empty bucket after deleting", `${String(left.length)} objects left`);
  return `bucket emptied: ${String(keys.length)} objects deleted, listing now empty`;
}

type FetchFn = (req: Request) => Promise<Response>;
const aws = (r: R2): AwsClient => new AwsClient({ accessKeyId: r.accessKeyId, secretAccessKey: r.secretAccessKey, service: "s3", region: "auto" });
const objectUrl = (r: R2, key: string): string => `${r.endpoint}/${encodeURIComponent(r.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
const xmlText = (s: string): string => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** ListObjectsV2 with each object's ETag and Size (r2ObjectStore.list keeps the keys only). */
async function listDetailed(r: R2, prefix: string, fetchFn: FetchFn = fetch): Promise<{ key: string; etag: string; size: string }[]> {
  const out: { key: string; etag: string; size: string }[] = [];
  let token: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const q = new URLSearchParams({ "list-type": "2", prefix, ...(token === null ? {} : { "continuation-token": token }) });
    const res = await fetchFn(await aws(r).sign(`${r.endpoint}/${encodeURIComponent(r.bucket)}?${q.toString()}`, { method: "GET", signal: AbortSignal.timeout(30_000) }));
    const xml = await res.text();
    if (res.status !== 200) fail("LIST 200", `${String(res.status)} ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const field = (name: string): string => xmlText(new RegExp(`<${name}>([^<]*)</${name}>`).exec(m[1]!)?.[1] ?? "");
      out.push({ key: field("Key"), etag: field("ETag"), size: field("Size") });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : null;
    if (token === null || token.length === 0) break;
  }
  return out;
}

/**
 * "Unchanged" = the same fingerprint: every key with its ETag and Size, and the sha256
 * of each plain keys/* body (an overwritten keys/control.sealed changes it even where
 * a listing carries no ETag).
 */
async function snapshot(r: R2, fetchFn: FetchFn = fetch): Promise<string> {
  const objects = (await listDetailed(r, "", fetchFn)).sort((x, y) => (x.key < y.key ? -1 : 1));
  const h = createHash("sha256");
  for (const o of objects) {
    h.update(`${o.key}\t${o.etag}\t${o.size}\n`);
    if (o.key.startsWith("keys/")) {
      const res = await fetchFn(await aws(r).sign(objectUrl(r, o.key), { method: "GET", signal: AbortSignal.timeout(30_000) }));
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status !== 200) fail(`GET ${o.key}: 200`, String(res.status));
      h.update(`${o.key}\t${createHash("sha256").update(body).digest("hex")}\n`);
    }
  }
  return `${String(objects.length)} objects, fingerprint ${h.digest("hex").slice(0, 12)}`;
}

/** A store's SSE-C key, read from its key file in the running container: held in memory, never printed. */
function containerKey(storeId: string): string {
  if (!/^[0-9a-f]{32}$/.test(storeId)) fail("a store id (32 hex)", storeId);
  const out = spawnSync("docker", ["exec", container(), "cat", `/data/tenants/${storeId}/litestream.key`], { encoding: "utf8", timeout: 30_000 });
  const key = out.stdout.trim();
  if (out.status !== 0 || Buffer.from(key, "base64").length !== 32) fail(`the store's litestream.key in ${container()} (32 bytes, base64)`, `exit ${String(out.status)}`);
  return key;
}

/**
 * SSE-C. Every replica object (tenants/, control/): a plain signed GET, no customer key,
 * answers one and the same 4xx (a thrown fetch, a 5xx, a 200 or a 404 fails). Positive
 * controls: the plain keys/control.sealed answers 200, and one of the store's own
 * objects answers 200 WITH its key.
 */
async function ssecCheck(r: R2, storeId: string, keyOf: (id: string) => string, fetchFn: FetchFn = fetch): Promise<string> {
  const get = async (key: string, headers: Record<string, string> = {}): Promise<{ status: number; code: string }> => {
    try {
      const res = await fetchFn(await aws(r).sign(objectUrl(r, key), { method: "GET", headers, signal: AbortSignal.timeout(30_000) }));
      const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
      return { status: res.status, code: /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? (res.status === 200 ? "" : body.slice(0, 40).replace(/\s+/g, " ")) };
    } catch (err) {
      return { status: 0, code: err instanceof Error ? err.message.slice(0, 80) : String(err) };
    }
  };
  const keys = [...(await listDetailed(r, "tenants/", fetchFn)), ...(await listDetailed(r, "control/", fetchFn))].map((o) => o.key);
  if (keys.length === 0) fail("tenants/ and control/ objects to check", "none");
  const tally = new Map<string, number>();
  const bad: string[] = [];
  for (const k of keys) {
    const { status, code } = await get(k);
    const t = `${String(status)} ${code}`;
    tally.set(t, (tally.get(t) ?? 0) + 1);
    if (status < 400 || status >= 500 || status === 404) bad.push(`${k}: ${t}`);
  }
  const seen = [...tally].map(([t, n]) => `${t} ×${String(n)}`).join("; ");
  if (bad.length > 0) fail("every plain GET of a replica object refused with a 4xx (not 0, not 5xx, not 200, not 404)", `${bad.slice(0, 5).join("; ")} (all: ${seen})`);
  if (new Set([...tally.keys()].map((t) => t.split(" ")[0])).size !== 1) fail("one and the same 4xx for every replica object", seen);
  const control = await get("keys/control.sealed");
  if (control.status !== 200) fail("plain GET of keys/control.sealed: 200 (positive control)", `${String(control.status)} ${control.code}`);
  const own = keys.find((k) => k.startsWith(`tenants/${storeId}/`)) ?? fail(`an object under tenants/${storeId}/`, "none");
  const sse = keyOf(storeId);
  const withKey = await get(own, {
    "x-amz-server-side-encryption-customer-algorithm": "AES256",
    "x-amz-server-side-encryption-customer-key": sse,
    "x-amz-server-side-encryption-customer-key-md5": createHash("md5").update(Buffer.from(sse, "base64")).digest("base64"),
  });
  if (withKey.status !== 200) fail(`GET of ${own.split("/").slice(2).join("/")} WITH the store's SSE-C key: 200`, `${String(withKey.status)} ${withKey.code}`);
  return `SSE-C: ${String(keys.length)} tenants/+control/ objects, plain GET answered ${seen}; keys/control.sealed answered 200; the store's ${own.split("/").slice(2).join("/")} WITH its key answered 200`;
}

/**
 * WB1: every key object in the bucket is SEALED to the recovery key (`s1.<16 hex
 * fingerprint>.…`, the fingerprint the one this run made), none is a KEK-wrapped
 * `w1.` value or a `.wrapped` object, and none holds the store's SSE-C key.
 */
async function sealedCheck(r: R2, storeId: string, fingerprint: string, keyOf: (id: string) => string): Promise<string> {
  if (!/^[0-9a-f]{16}$/.test(fingerprint)) fail("a recovery key fingerprint (16 hex)", fingerprint);
  const names = await store(r).list("keys/");
  if (names.length === 0) fail("key objects under keys/", "none");
  const sse = keyOf(storeId);
  for (const name of names) {
    if (!name.endsWith(".sealed")) fail("every key object keys/<id>.sealed", name.replace(/[0-9a-f]{32}/, "<id>"));
    const body = (await store(r).get(name)) ?? fail(`GET ${name}`, "none");
    if (!body.startsWith(`s1.${fingerprint}.`)) fail(`${name.replace(/[0-9a-f]{32}/, "<id>")} sealed to recovery key ${fingerprint}`, body.slice(0, 20));
    if (body.includes(sse) || body.includes(Buffer.from(sse, "base64").toString("base64url"))) fail("no key object holding the store's SSE-C key", name.replace(/[0-9a-f]{32}/, "<id>"));
  }
  return `sealed: ${String(names.length)} key objects, every one keys/<id>.sealed, sealed to recovery key ${fingerprint}; none holds the store's SSE-C key`;
}

/** The bucket helpers against the SSE-C stand-in from hosted/test/helpers.ts: no network, no credentials. */
async function smoke(): Promise<string> {
  const s3 = await s3StandIn();
  try {
    const r: R2 = { endpoint: s3.base, bucket: "bkt", accessKeyId: "smoke-id", secretAccessKey: randomBytes(20).toString("hex") };
    const lines: string[] = [];
    const eq = (what: string, got: string, want: string): void => {
      if (got !== want) fail(`${what}: ${want}`, got);
      lines.push(`${what}: ${got}`);
    };
    eq("empty listing", JSON.stringify(await store(r).list("")), "[]");
    eq("empty maxTXID", (await txid(r, "tenants/abc/")).toString(), "0");
    eq("empty snapshot", await snapshot(r), `0 objects, fingerprint ${createHash("sha256").digest("hex").slice(0, 12)}`);
    const storeKey = randomBytes(32).toString("base64");
    const sse = { "x-amz-server-side-encryption-customer-algorithm": "AES256", "x-amz-server-side-encryption-customer-key": storeKey };
    const put = async (key: string, headers: Record<string, string> = {}, body = "x"): Promise<void> => {
      const res = await fetch(`${s3.base}/bkt/${key}`, { method: "PUT", headers, body });
      if (!res.ok) fail(`PUT ${key} to the stand-in`, String(res.status));
    };
    await put("tenants/abc/0000/0000000000000001-0000000000000003.ltx", sse);
    await put("tenants/abc/0001/0000000000000001-000000000000000a.ltx", sse);
    await put("tenants/abc/0000/not-an-ltx-file", sse);
    await put("tenants/abcd/0000/00000000000000ff-00000000000000ff.ltx", sse); // another store whose id shares the prefix
    await put("control/accounts.sqlite/0000/0000000000000001-0000000000000002.ltx", sse);
    await put("keys/control.sealed");
    eq("maxTXID across levels, one store", (await txid(r, "tenants/abc/")).toString(), "10");
    eq("maxTXID, control prefix", (await txid(r, "control/accounts.sqlite/")).toString(), "2");
    eq("wait sees a rise", (await waitTxid(r, "tenants/abc/", 3n, 5)).split(" ")[0]!, "10");
    let timedOut = "no";
    await waitTxid(r, "tenants/abc/", 10n, 2).catch((e: unknown) => {
      timedOut = e instanceof Failed ? "yes" : String(e);
    });
    eq("wait times out with no rise", timedOut, "yes");
    eq("settle", await settle(r, "tenants/abc/", 20), "10");
    const failsWith = async (what: string, run: () => Promise<unknown>): Promise<void> => {
      let caught = "no";
      await run().catch((e: unknown) => {
        caught = e instanceof Failed ? "yes" : String(e);
      });
      eq(what, caught, "yes");
    };
    const key = (): string => storeKey;
    lines.push(await ssecCheck(r, "abc", key));
    await failsWith("ssec-check fails when the store's own key is wrong", () => ssecCheck(r, "abc", () => randomBytes(32).toString("base64")));
    await failsWith("ssec-check fails on a thrown fetch (status 0)", () => ssecCheck(r, "abc", key, async (req) => (new URL(req.url).pathname.endsWith(".ltx") ? Promise.reject(new Error("connection reset")) : fetch(req))));
    s3.fault = ({ key: k }) => (k === "tenants/abc/0001/0000000000000001-000000000000000a.ltx" ? 503 : null);
    await failsWith("ssec-check fails on a 5xx", () => ssecCheck(r, "abc", key));
    s3.fault = null;
    const before = await snapshot(r);
    await put("keys/control.sealed", {}, "y"); // the same key, another body: an overwrite
    const after = await snapshot(r);
    eq("snapshot catches an overwritten keys/control.sealed", String(before !== after && before.split(",")[0] === after.split(",")[0]), "true");
    await put("tenants/abc/0000/0000000000000004-0000000000000004.ltx"); // a replica object put WITHOUT SSE-C
    await failsWith("ssec-check fails on a plain replica object", () => ssecCheck(r, "abc", key));
    lines.push(await empty(r));
    eq("listing after empty", JSON.stringify(await store(r).list("")), "[]");
    return lines.map((l) => `smoke ok: ${l}`).join("\n");
  } finally {
    await s3.close();
  }
}

// ── the command line ──────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<string> {
  const [cmd, ...a] = argv;
  switch (cmd) {
    case "invite":
      return invite(Number(a[0]));
    case "signup":
      return signup(Number(a[0]), a[1] ?? fail("signup <n> <log>", "no log"));
    case "oauth":
      return connect();
    case "refresh":
      return refresh();
    case "wake":
      return wake();
    case "remember":
      return remember(a[0] ?? fail("remember <label>", "no label"));
    case "recall":
      return recall(a);
    case "token-age":
      return tokenAge();
    case "r2-list":
      return (await store(r2FromEnv()).list(a[0] ?? "")).join("\n");
    case "r2-txid":
      return (await txid(r2FromEnv(), a[0] ?? fail("r2-txid <prefix>", "none"))).toString();
    case "r2-wait":
      return waitTxid(r2FromEnv(), a[0] ?? fail("r2-wait <prefix> <baseline> <s>", "none"), BigInt(a[1] ?? "0"), Number(a[2] ?? "60"));
    case "r2-settle":
      return settle(r2FromEnv(), a[0] ?? fail("r2-settle <prefix>", "none"));
    case "r2-empty":
      return empty(r2FromEnv());
    case "r2-snapshot":
      return snapshot(r2FromEnv());
    case "ssec-check":
      return ssecCheck(r2FromEnv(), a[0] ?? fail("ssec-check <storeId>", "none"), containerKey);
    case "sealed-check":
      return sealedCheck(r2FromEnv(), a[0] ?? fail("sealed-check <storeId> <fingerprint>", "none"), a[1] ?? fail("sealed-check <storeId> <fingerprint>", "no fingerprint"), containerKey);
    case "smoke":
      return smoke();
    default:
      return fail("a command: invite signup oauth refresh wake remember recall token-age r2-list r2-txid r2-wait r2-settle r2-empty r2-snapshot ssec-check sealed-check smoke", String(cmd));
  }
}

main(process.argv.slice(2)).then(
  (out) => {
    if (out.length > 0) process.stdout.write(`${out}\n`);
    process.exit(0);
  },
  (err: unknown) => {
    process.stdout.write(`${err instanceof Failed ? err.message : `expected no error; saw ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`}\n`);
    process.exit(1);
  },
);
