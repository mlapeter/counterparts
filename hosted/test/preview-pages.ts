/**
 * Render every hosted page variant to static HTML, for a look in a browser
 * before a deploy (gate S, 2026-11-06). Not a test: run it by hand.
 *
 *   bun hosted/test/preview-pages.ts <out-dir>
 *
 * It stands up the real app on a temp data root (removed at the end), walks
 * the flows a person walks (sign in, Allow, the account page, the error and
 * delete pages) through the socket, and saves each page as it was served, so
 * the copy is the code's own. The CSP is a header, so it doesn't apply to the
 * saved files; the inline style still renders. Hermetic: an in-memory mailer, a
 * fake spawner, no network.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import * as oauth from "oauth4webapi";

import { createApp } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { tempRoot } from "./helpers.js";

const out = process.argv[2];
if (out === undefined) {
  console.error("usage: bun hosted/test/preview-pages.ts <out-dir>");
  process.exit(2);
}
const dir = resolve(out);
mkdirSync(dir, { recursive: true });

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;

class Browser {
  readonly jar = new Map<string, string>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(new URL(target, this.base), { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie()) {
      const first = raw.split(";")[0]!;
      const i = first.indexOf("=");
      const v = first.slice(i + 1);
      if (v === "" || /max-age=0/i.test(raw)) this.jar.delete(first.slice(0, i));
      else this.jar.set(first.slice(0, i), v);
    }
    return res;
  }
  form(target: string, fields: Record<string, string>): Promise<Response> {
    return this.go(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: this.base }, body: new URLSearchParams(fields).toString() });
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

const saved: string[] = [];
const save = async (name: string, res: Response): Promise<string> => {
  const html = await res.text();
  if (!html.startsWith("<!doctype html>")) throw new Error(`${name}: not a page (${String(res.status)})`);
  writeFileSync(join(dir, `${name}.html`), html);
  saved.push(`${name}.html (${String(res.status)})`);
  return html;
};

const tmp = tempRoot("preview");
const free = createServer();
await new Promise<void>((r) => free.listen(0, "127.0.0.1", () => r()));
const port = (free.address() as { port: number }).port;
await new Promise<void>((r) => free.close(() => r()));
const origin = `http://127.0.0.1:${String(port)}`;
const mail = memoryMailer();
const app = createApp({ dataRoot: join(tmp.root, "data"), publicOrigin: origin, mailer: mail, embedder: null, spawner: () => ({ pid: 1 }) });
await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));

try {
  const me = new Browser(origin);
  const { code } = app.accounts.createInvite({ maxUses: 5 });

  // Sign in, and the page after it.
  const loginHtml = await save("01-sign-in", await me.go("/login"));
  await save("02-check-your-email", await me.form("/login", { csrf: csrfOf(loginHtml), email: "katie@example.com", invite: code, tz: "America/Denver", next: "/account" }));
  const link = /https?:\/\/\S+/.exec(mail.sent.at(-1)!.text)![0];
  await save("03-link-used-in-another-browser", await new Browser(origin).go(link));
  await me.go(link);
  await save("03a-account-no-connections", await me.go("/account"));

  // The Allow page: what claude.ai does, from discovery to the page.
  const issuer = new URL(origin);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  const reg = await oauth.processDynamicClientRegistrationResponse(
    await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
  );
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({
    client_id: reg.client_id,
    redirect_uri: CALLBACK,
    response_type: "code",
    scope: "memory",
    resource: `${origin}/mcp`,
    code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()),
    code_challenge_method: "S256",
    state: "st-1",
  }).toString();
  const started = await me.go(authz.toString());
  const allowPath = new URL(started.headers.get("location")!, origin).pathname;
  const allowHtml = await save("04-allow", await me.go(allowPath));
  await save("05-allow-form-expired", await me.form(allowPath, { csrf: "stale", decision: "allow" }));
  let res = await me.form(allowPath, { csrf: csrfOf(allowHtml), decision: "allow" });
  for (let i = 0; i < 5 && res.status === 303; i++) {
    const loc = new URL(res.headers.get("location")!, origin);
    if (loc.origin !== origin) break;
    res = await me.go(loc.toString());
  }

  // The account page, with the connection just made, and its errors.
  const accountHtml = await save("06-account", await me.go("/account"));
  await save("07-error-form-expired", await me.form("/account/delete", { csrf: "stale", when: "later", confirm: "katie@example.com" }));
  await save("08-error-not-deleted", await me.form("/account/delete", { csrf: csrfOf(accountHtml), when: "later", confirm: "someone@example.com" }));

  // Delete later, then the pending page a sign-in brings back.
  await save("09-set-to-be-deleted", await me.form("/account/delete", { csrf: csrfOf(accountHtml), when: "later", confirm: "katie@example.com" }));
  const again = new Browser(origin);
  const againLogin = await (await again.go("/login")).text();
  await again.form("/login", { csrf: csrfOf(againLogin), email: "katie@example.com", invite: "", tz: "America/Denver", next: "/account" });
  await again.go(/https?:\/\/\S+/.exec(mail.sent.filter((m) => /sign/i.test(m.subject)).at(-1)!.text)![0]);
  const pendingHtml = await save("10-pending-delete", await again.go("/account"));
  await save("11-kept", await again.form("/account/keep", { csrf: csrfOf(pendingHtml) }));

  // Delete now: the done page.
  const fresh = await (await again.go("/account")).text();
  await save("12-deleted", await again.form("/account/delete", { csrf: csrfOf(fresh), when: "now", confirm: "katie@example.com" }));

  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Hosted pages preview</title><style>body{font:16px/1.6 system-ui,sans-serif;margin:2rem auto;max-width:40rem;padding:0 16px}</style><h1>Hosted pages preview</h1><ul>${saved
      .map((s) => `<li><a href="${s.split(" ")[0]!}">${s}</a></li>`)
      .join("")}</ul>`,
  );
  console.log(`wrote ${String(saved.length)} pages to ${dir}:\n  ${saved.join("\n  ")}`);
} finally {
  await new Promise<void>((r) => {
    app.server.close(() => r());
    app.server.closeAllConnections?.();
  });
  await app.close();
  tmp.remove();
}
