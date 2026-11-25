/**
 * OL2 step 3: accounts and the email-link login, through the real socket.
 * A browser is simulated by a cookie jar; mail goes to an in-memory mailer;
 * nothing touches the network. Every awkward state is made on purpose: reuse,
 * expiry, the wrong browser, a forged form, an open redirect, a spent invite.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { Accounts, INVITE_TTL_MS, normalizeEmail, validTimeZone } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import { memoryMailer, resendMailer, RESEND_ENDPOINT } from "../src/egress.js";
import { SETUP_INSTRUCTIONS, accountPages } from "../src/pages.js";
import { createHostedServer } from "../src/server.js";
import { Tenants } from "../src/tenants.js";
import { safeNext } from "../src/web.js";
import { openDb } from "../../src/core/store/db.js";
import { formFields, freePort, listen, pressLink, tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("accounts");
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

/** A browser: a cookie jar that follows nothing automatically. */
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
  async form(path: string, fields: Record<string, string>, extra: Record<string, string> = {}): Promise<Response> {
    return this.go(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams(fields).toString() });
  }
}

const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

interface Rig {
  base: string;
  accounts: Accounts;
  mail: ReturnType<typeof memoryMailer>;
  setNow: (t: number) => void;
}

async function rig(opts: { trustProxy?: number } = {}): Promise<Rig> {
  let now = Date.UTC(2026, 9, 26, 12);
  const clock = (): number => now;
  const accounts = new Accounts({ path: join(tmp.root, "control", "accounts.sqlite"), now: clock });
  closers.push(() => accounts.close());
  const mail = memoryMailer();
  const pages = accountPages({ accounts, mailer: mail, publicOrigin: "http://127.0.0.1", now: clock, ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }) });
  const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: () => ({ pid: 1 }) });
  closers.push(() => tenants.closeAll());
  const server = createHostedServer({ tenants, publicOrigin: "http://127.0.0.1", authenticate: async () => null, routes: [pages.route] });
  const { base, close } = await listen(server);
  closers.push(close);
  return { base, accounts, mail, setNow: (t) => (now = t) };
}

/** Ask for a link as `browser` and return the link path from the email (or null when none was sent). */
async function askLink(r: Rig, browser: Browser, email: string, invite = "", next = ""): Promise<{ res: Response; body: string; link: string | null }> {
  const form = await (await browser.go(`/login${next.length > 0 ? `?next=${encodeURIComponent(next)}` : ""}`)).text();
  const before = r.mail.sent.length;
  const res = await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next: /name="next" value="([^"]+)"/.exec(form)?.[1] ?? "/account" });
  const body = await res.text();
  const mail = r.mail.sent.length > before ? r.mail.sent.at(-1)! : null;
  const link = mail === null ? null : (/https?:\/\/[^\s]+/.exec(mail.text)?.[0] ?? null);
  return { res, body, link: link === null ? null : link.replace(/^https?:\/\/[^/]+/, "") };
}

describe("signing up and signing in", () => {
  test("an invite, an email, a click in the same browser: a person, a verified identity, a store, a session", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ note: "katie" });
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "Katie@Example.com ", code);
    assert.equal(asked.res.status, 200);
    assert.match(asked.body, /Check your email/);
    assert.ok(asked.link !== null);
    assert.equal(r.mail.sent[0]!.to, "katie@example.com");
    const used = await pressLink(me, asked.link);
    assert.equal(used.status, 303);
    assert.equal(used.headers.get("location"), "/account");
    const account = await (await me.go("/account")).text();
    assert.match(account, /Signed in as <strong>katie@example\.com<\/strong>/);
    assert.match(account, /value="America\/Denver"/);
    // The store id is 128 random bits; the person row carries the zone from the browser.
    const db = readFileSync(join(tmp.root, "control", "accounts.sqlite")).toString("latin1");
    assert.doesNotMatch(db, /cpl_|cps_|cpi_/); // no raw secret anywhere in the file
    // The login code (PR B): only its hash, 64 hex characters, never the code itself.
    const sent = /in that same browser: (\d{6})/.exec(r.mail.sent[0]!.text)![1]!;
    const rows = openDb(join(tmp.root, "control", "accounts.sqlite"));
    try {
      const hashes = rows.all<{ code_hash: string | null }>("SELECT code_hash FROM login_links").map((x) => x.code_hash);
      assert.ok(hashes.length > 0);
      for (const h of hashes) {
        assert.match(String(h), /^[0-9a-f]{64}$/);
        assert.notEqual(h, sent);
      }
      assert.equal(rows.all("SELECT 1 FROM login_links WHERE code_hash = ? OR code_hash = ?", sent, Number(sent)).length, 0);
    } finally {
      rows.close();
    }
  });

  test("an unknown address without an invite gets the same page as a known one, and no email", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const first = new Browser(r.base);
    const signup = await askLink(r, first, "known@example.com", code);
    await pressLink(first, signup.link!);
    const known = await askLink(r, new Browser(r.base), "known@example.com");
    const unknown = await askLink(r, new Browser(r.base), "stranger@example.com");
    const badInvite = await askLink(r, new Browser(r.base), "stranger2@example.com", "cpi_not-a-real-code-at-all-000000");
    assert.ok(known.link !== null);
    assert.equal(unknown.link, null);
    assert.equal(badInvite.link, null);
    assert.equal(unknown.res.status, known.res.status);
    // The nonce, and the code box's own browser token and the address it was typed as (PR B), differ by request alone.
    const unNonced = (h: string): string => h.replace(/nonce="[^"]+"/g, "nonce").replace(/name="(csrf|email)" value="[^"]*"/g, 'name="$1"');
    assert.equal(unNonced(unknown.body), unNonced(known.body));
    assert.equal(unNonced(badInvite.body), unNonced(known.body));
  });

  test("opening a link spends nothing, in any browser; the press spends it once", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const me = new Browser(r.base);
    const a = await askLink(r, me, "a@example.com", code);
    // A mail scanner (no cookie), another browser, and the asking browser, each opening it twice: nothing spent.
    for (let i = 0; i < 2; i++) {
      const scanner = await fetch(`${r.base}${a.link!}`, { redirect: "manual" });
      assert.equal(scanner.status, 200);
      assert.equal(scanner.headers.getSetCookie().some((c) => c.startsWith("cp_session=")), false, "a GET signs nobody in");
      assert.equal((await new Browser(r.base).go(a.link!)).status, 200);
      const mine = await me.go(a.link!);
      assert.equal(mine.status, 200);
      const html = await mine.text();
      assert.match(html, /<h1>Sign in<\/h1>/);
      assert.match(html, /<button type="submit">Sign in<\/button>/);
      assert.doesNotMatch(html, /\*\*\*@/, "the asking browser isn't shown an address");
    }
    assert.equal((await me.go("/account")).status, 303, "still signed out after the opens");
    assert.equal(r.accounts.spots().people, 0, "and no account made");
    // The press: signed in.
    const pressed = await pressLink(me, a.link!);
    assert.equal(pressed.status, 303);
    assert.equal(pressed.headers.get("location"), "/account");
    assert.equal((await me.go("/account")).status, 200);
    // Used: the page says so, and a second press is refused.
    assert.equal((await me.go(a.link!)).status, 400);
    assert.equal((await pressLink(me, a.link!)).status, 400);
    assert.equal(r.accounts.auditOf(r.accounts.sessionPerson(me.jar.get("cp_session")!)!).some((x) => x.action === "login.link.other-browser"), false);
    // A token nobody issued.
    assert.equal((await me.go("/login/link?token=cpl_nonsense_nonsense_nonsense")).status, 400);
  });

  test("another browser: a confirm with the whole address; the browser that presses is signed in, the asker isn't; counted", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const asker = new Browser(r.base);
    const a = await askLink(r, asker, "mike.l@example.com", code);
    const phone = new Browser(r.base);
    const opened = await phone.go(a.link!);
    assert.equal(opened.status, 200);
    const html = await opened.text();
    assert.match(html, /<h1>Sign in on this browser as mike\.l@example\.com\?<\/h1>/);
    assert.match(html, /<button type="submit">Sign in on this browser<\/button>/);
    assert.doesNotMatch(html, /signed in here as/, "nobody is signed in in this browser");
    const pressed = await pressLink(phone, a.link!);
    assert.equal(pressed.status, 303);
    assert.match((await (await phone.go("/account")).text()), /Signed in as <strong>mike\.l@example\.com<\/strong>/);
    assert.equal((await asker.go("/account")).status, 303, "the asking browser gets nothing");
    // A second press, from either browser, is refused.
    assert.equal((await pressLink(phone, a.link!)).status, 400);
    assert.equal((await pressLink(asker, a.link!)).status, 400);
    // Counted: one audit row beside the sign-up's, and the operator's count.
    const person = r.accounts.sessionPerson(phone.jar.get("cp_session")!)!;
    assert.deepEqual(r.accounts.auditOf(person).map((x) => x.action), ["signup", "login.link.other-browser"]);
    assert.equal(r.accounts.counts().otherBrowser7d, 1);
    // A member's sign-in finished elsewhere counts too; eight days on, neither is in the week.
    const later = await askLink(r, new Browser(r.base), "mike.l@example.com");
    assert.equal((await pressLink(new Browser(r.base), later.link!)).status, 303);
    assert.equal(r.accounts.counts().otherBrowser7d, 2);
    // A reviewer's account (DIR1) finishing a link elsewhere isn't counted: §40 counts the spots' people.
    const made = r.accounts.createReviewer({ email: "reviewer@example.com", days: 30 });
    assert.ok(!("refusal" in made));
    const rev = await askLink(r, new Browser(r.base), "reviewer@example.com");
    assert.equal((await pressLink(new Browser(r.base), rev.link!)).status, 303);
    assert.equal(r.accounts.counts().otherBrowser7d, 2);
    r.setNow(Date.UTC(2026, 10, 3, 13));
    assert.equal(r.accounts.counts().otherBrowser7d, 0);
  });

  test("a forwarded link, opened where someone else is signed in: the page says whose session the press ends, before the press", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const victim = new Browser(r.base);
    assert.equal((await pressLink(victim, (await askLink(r, victim, "victim@example.com", code)).link!)).status, 303);
    // The attacker asks for a link to their own account and forwards it.
    const forwarded = await askLink(r, new Browser(r.base), "attacker@example.com", code);
    const html = await (await victim.go(forwarded.link!)).text();
    assert.match(html, /<h1>Sign in on this browser as attacker@example\.com\?<\/h1>/);
    assert.match(html, /You&rsquo;re signed in here as victim@example\.com; this signs you in as attacker@example\.com instead\./);
    // A link to the same person, opened where they're already signed in: no warning.
    const own = await askLink(r, new Browser(r.base), "victim@example.com");
    assert.doesNotMatch(await (await victim.go(own.link!)).text(), /signed in here as/);
  });

  test("an OAuth connect finished in another browser lands on the account page, which says to go back to the browser that started it", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const a = await askLink(r, new Browser(r.base), "oauth-elsewhere@example.com", code, "/oauth/allow/abc123");
    const phone = new Browser(r.base);
    const pressed = await pressLink(phone, a.link!);
    assert.equal(pressed.headers.get("location"), "/account?from=elsewhere");
    const page = await (await phone.go(pressed.headers.get("location")!)).text();
    assert.match(page, /Signed in here\. To finish connecting Claude, go back to the browser where you started\./);
    assert.doesNotMatch(await (await phone.go("/account")).text(), /go back to the browser where you started/);
  });

  test("an expired link: refused at the open and at the press", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const me = new Browser(r.base);
    const a = await askLink(r, me, "late@example.com", code);
    // Opened in time, pressed too late.
    const page = await (await me.go(a.link!)).text();
    r.setNow(Date.UTC(2026, 9, 26, 12, 16));
    const late = await me.form("/login/link", { csrf: csrfOf(page), token: /name="token" value="([^"]+)"/.exec(page)![1]!, next: "/account" });
    assert.equal(late.status, 400);
    assert.match(await late.text(), /can&#39;t be used/);
    // Opened too late.
    assert.equal((await me.go(a.link!)).status, 400);
    assert.equal(r.accounts.spots().people, 0);
  });

  test("the press: no CSRF token, another browser's token, a foreign Origin, or not a form are refused, and spend nothing", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const me = new Browser(r.base);
    const a = await askLink(r, me, "csrf@example.com", code);
    const page = await (await me.go(a.link!)).text();
    const token = /name="token" value="([^"]+)"/.exec(page)![1]!;
    const other = new Browser(r.base);
    const otherPage = await (await other.go(a.link!)).text();
    assert.equal((await me.form("/login/link", { token, next: "/account" })).status, 403);
    assert.equal((await me.form("/login/link", { csrf: csrfOf(otherPage), token, next: "/account" })).status, 403);
    assert.equal((await me.form("/login/link", { csrf: csrfOf(page), token, next: "/account" }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await me.go("/login/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf: csrfOf(page), token }) })).status, 403);
    // A cross-site page can't carry this browser's cookie into the form either: a bare POST is refused.
    assert.equal((await fetch(`${r.base}/login/link`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: csrfOf(page), token }).toString(), redirect: "manual" })).status, 403);
    assert.equal(r.accounts.spots().people, 0, "nothing spent");
    assert.equal((await me.form("/login/link", { csrf: csrfOf(page), token, next: "/account" })).status, 303, "the real press still works");
  });

  test("the email and the sent page say once, 15 minutes, the device that opens it; never 'the same browser'", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const a = await askLink(r, new Browser(r.base), "words@example.com", code);
    const text = r.mail.sent.at(-1)!.text;
    assert.match(text, /Open this link on the device you want to sign in on\. It works once, for 15 minutes, and signs in whichever device opens it/);
    assert.match(text, /Don't give this code or link to anyone, a person or an AI\./);
    assert.doesNotMatch(text, /Open this link in the same browser/);
    assert.match(a.body, /It works once, for 15 minutes, and signs in whichever device opens it\./);
    assert.doesNotMatch(a.body, /once, in this browser/);
  });

  test("a new account sees the dashboard, then the setup steps (leak 4): the address and the instructions to copy; the beta note at the foot", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const me = new Browser(r.base);
    assert.equal((await pressLink(me, (await askLink(r, me, "new@example.com", code)).link!)).headers.get("location"), "/account");
    const res = await me.go("/account");
    const html = await res.text();
    const at = (s: string): number => {
      const i = html.indexOf(s);
      assert.ok(i >= 0, `the page has ${s}`);
      return i;
    };
    // The dashboard first, then the steps in order, and the beta note at the foot (11-25).
    const order = [at('href="/dashboard/">Open your dashboard</a>'), at('<h2 id="setup">Set it up in claude.ai</h2>'), at("<h3>1. Make your account: done</h3>"), at("<h3>2. Add Counterparts to claude.ai</h3>"), at("<strong>Always allow</strong>"), at("<h3>4. Tell Claude to use it</h3>"), at("<h3>5. Say hi</h3>"), at("<h2>Connected AIs</h2>"), at("<h2>Your day</h2>"), at('<h2 id="privacy">What we keep, and your choices</h2>'), at("Hosted Counterparts is a free beta.")];
    assert.deepEqual([...order].sort((x, y) => x - y), order);
    assert.ok(html.includes('<pre class="cp-paste" id="cp-mcp">http://127.0.0.1/mcp</pre>'));
    // The site's 11-25 wording, in the second copy too.
    assert.ok(html.includes("A connector is claude.ai&rsquo;s name for an outside tool Claude can use. Counterparts is one: it&rsquo;s where this memory lives."));
    assert.ok(html.includes("<strong>Instructions</strong>, a note Claude reads at the start of every chat (or, in the older layout,"));
    assert.ok(html.includes("and usually won&rsquo;t read its memory at all.") && html.includes("never read this one.") && html.includes("have Claude read its memory at the start of each chat."));
    // The instruction block, exactly the site's (escaped once), with its own Copy button.
    assert.ok(html.includes(`<pre class="cp-paste" id="cp-instructions">${SETUP_INSTRUCTIONS.replace(/'/g, "&#39;")}</pre>`));
    assert.equal(html.match(/<button type="button" class="cp-copy" data-copy="cp-(mcp|instructions)">/g)?.length, 2);
    // The copy script runs under the page's nonce; the CSP is unchanged otherwise.
    const nonce = /script-src 'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")![1]!;
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline handlers");
  });

  test("an invite used up: the second sign-up through it is refused even if both links were asked for first", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 1 });
    const one = new Browser(r.base);
    const two = new Browser(r.base);
    const l1 = await askLink(r, one, "one@example.com", code);
    const l2 = await askLink(r, two, "two@example.com", code);
    assert.equal((await pressLink(one, l1.link!)).status, 303);
    assert.equal((await pressLink(two, l2.link!)).status, 400);
    assert.equal((await two.go("/account")).status, 303); // not signed in: back to login
  });

  test("G1 L4: an invite expires 7 days after it is made unless told otherwise; a code from before the default stays valid", async () => {
    const r = await rig();
    const start = Date.UTC(2026, 9, 26, 12);
    const week = r.accounts.createInvite();
    assert.equal(week.expiresAt, start + INVITE_TTL_MS);
    const month = r.accounts.createInvite({ expiresAt: start + 30 * 86_400_000 });
    const old = r.accounts.createInvite();
    // A code made before the default had no expiry (expires_at NULL): it is kept valid, not expired by the deploy.
    const db = openDb(join(tmp.root, "control", "accounts.sqlite"));
    try {
      db.run("UPDATE invites SET expires_at = NULL WHERE id = ?", old.id);
    } finally {
      db.close();
    }
    // A minute inside the week: the default code still signs up.
    r.setNow(start + INVITE_TTL_MS - 60_000);
    assert.ok((await askLink(r, new Browser(r.base), "inside@example.com", week.code)).link !== null);
    // A minute past it: refused, the same page as no invite, and no email.
    r.setNow(start + INVITE_TTL_MS + 60_000);
    const late = await askLink(r, new Browser(r.base), "late@example.com", week.code);
    assert.equal(late.link, null);
    assert.equal(late.res.status, 200);
    assert.ok((await askLink(r, new Browser(r.base), "month@example.com", month.code)).link !== null);
    // Ninety days on: the month's code is gone, the code from before the default still works.
    r.setNow(start + 90 * 86_400_000);
    assert.equal((await askLink(r, new Browser(r.base), "month2@example.com", month.code)).link, null);
    assert.ok((await askLink(r, new Browser(r.base), "old@example.com", old.code)).link !== null);
  });

  test("forms: no CSRF token, a foreign Origin, or the wrong content type are refused", async () => {
    const r = await rig();
    const b = new Browser(r.base);
    const form = await (await b.go("/login")).text();
    assert.equal((await b.form("/login", { email: "x@example.com" })).status, 403);
    assert.equal((await b.form("/login", { csrf: csrfOf(form), email: "x@example.com" }, { origin: "https://evil.example" })).status, 403);
    const json = await b.go("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csrf: csrfOf(form), email: "x@example.com" }) });
    assert.equal(json.status, 403);
    // Another browser's token is not this browser's.
    const other = new Browser(r.base);
    const otherForm = await (await other.go("/login")).text();
    assert.equal((await b.form("/login", { csrf: csrfOf(otherForm), email: "x@example.com" })).status, 403);
    assert.equal(r.mail.sent.length, 0);
  });

  test("the first deploy: our pages' referrer policy lets a browser name our origin on its own form POSTs", async () => {
    // Under no-referrer, Chrome sends `Origin: null` on a same-origin form POST, and every
    // sign-in was refused as "This form expired". A null Origin stays refused (a sandboxed frame
    // sends one), so the page must not ask for it.
    const r = await rig();
    const b = new Browser(r.base);
    const page = await b.go("/login");
    assert.equal(page.headers.get("referrer-policy"), "same-origin");
    const form = await page.text();
    assert.equal((await b.form("/login", { csrf: csrfOf(form), email: "x@example.com" }, { origin: "null" })).status, 403);
    assert.equal((await b.form("/login", { csrf: csrfOf(form), email: "x@example.com" }, { origin: "http://127.0.0.1" })).status, 200);
  });

  test("rate limits: five emails an hour per address", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 10 });
    const b = new Browser(r.base);
    for (let i = 0; i < 5; i++) assert.equal((await askLink(r, b, "busy@example.com", code)).res.status, 200);
    assert.equal((await askLink(r, b, "busy@example.com", code)).res.status, 429);
  });

  test("after login, only our own paths: next=//evil and friends land on /account; an /oauth/ path survives", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 5 });
    const b = new Browser(r.base);
    const evil = await askLink(r, b, "n@example.com", code, "//evil.example/x");
    assert.equal((await pressLink(b, evil.link!)).headers.get("location"), "/account");
    const b2 = new Browser(r.base);
    const good = await askLink(r, b2, "n@example.com", "", "/oauth/allow/abc123");
    assert.equal((await pressLink(b2, good.link!)).headers.get("location"), "/oauth/allow/abc123");
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/account/../..//evil", "/elsewhere"]) {
      assert.equal(safeNext(bad), "/account", bad);
    }
  });

  test("review of #644: dot-segments under an allowed prefix can't resolve to another host", async () => {
    // Each of these passed the old prefix check and came out as `//evil.example…`.
    for (const bad of ["/oauth/..//evil.example", "/oauth/../\t/evil.example", "/oauth/%2e%2e//evil.example", "/oauth/.%2e//evil.example/x", "/oauth/../account/..//evil.example", "/oauth/..\n//evil.example"]) {
      const out = safeNext(bad);
      assert.ok(!out.startsWith("//"), `${JSON.stringify(bad)} → ${out}`);
      assert.equal(out, "/account", JSON.stringify(bad));
    }
    assert.equal(safeNext("/oauth/allow/abc?x=1"), "/oauth/allow/abc?x=1");
    // Through the door: a signed-in browser opening /login?next=… is redirected at once.
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const b = new Browser(r.base);
    await pressLink(b, (await askLink(r, b, "redirect@example.com", code)).link!);
    const res = await b.go(`/login?next=${encodeURIComponent("/oauth/..//evil.example/phish")}`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/account");
    // And through the emailed link's `next`.
    const b2 = new Browser(r.base);
    const viaLink = await askLink(r, b2, "redirect@example.com", "", "/oauth/..//evil.example/phish");
    assert.equal((await pressLink(b2, viaLink.link!)).headers.get("location"), "/account");
  });

  test("review of #644: behind the proxy, the per-IP limit keys on the hop the proxy appended, not the one the client wrote", async () => {
    const r = await rig({ trustProxy: 1 });
    const b = new Browser(r.base);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const form = await (await b.go("/login")).text();
      // The client forges a new first hop every time; the proxy appends the real address last.
      const res = await b.form("/login", { csrf: csrfOf(form), email: `spray${String(i)}@example.com` }, { "x-forwarded-for": `198.51.100.${String(i)}, 203.0.113.7` });
      statuses.push(res.status);
      await res.text();
    }
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(200));
    assert.equal(statuses[20], 429);
  });

  test("two hops (Railway: the client, then its edge): two people behind one edge get their own limits, and a forged prefix still isn't one", async () => {
    const r = await rig({ trustProxy: 2 });
    const EDGE = "203.0.113.7";
    const ask = async (b: Browser, i: number, xff: string): Promise<number> => {
      const form = await (await b.go("/login")).text();
      const res = await b.form("/login", { csrf: csrfOf(form), email: `edge${String(i)}@example.com` }, { "x-forwarded-for": xff });
      await res.text();
      return res.status;
    };
    // Person A uses up their 20, forging a new first entry each time: the edge's entry for them stays the same.
    const a = new Browser(r.base);
    const aStatuses: number[] = [];
    for (let i = 0; i < 21; i++) aStatuses.push(await ask(a, i, `198.51.100.${String(i)}, 192.0.2.1, ${EDGE}`));
    assert.deepEqual(aStatuses.slice(0, 20), Array(20).fill(200));
    assert.equal(aStatuses[20], 429);
    // Person B, behind the same edge hop, still has all of theirs.
    const b = new Browser(r.base);
    for (let i = 0; i < 20; i++) assert.equal(await ask(b, 100 + i, `192.0.2.2, ${EDGE}`), 200);
  });

  test("review of #644: a refused ask costs the same commit as a sent one, and keeps no address", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const first = new Browser(r.base);
    await pressLink(first, (await askLink(r, first, "member@example.com", code)).link!);
    const dbPath = join(tmp.root, "control", "accounts.sqlite");
    const count = (): number => {
      const db = openDb(dbPath, { wal: true });
      try {
        return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM login_links")!.n;
      } finally {
        db.close();
      }
    };
    const before = count();
    assert.equal((await askLink(r, new Browser(r.base), "member@example.com")).link !== null, true);
    assert.equal(count(), before + 1);
    assert.equal((await askLink(r, new Browser(r.base), "outsider@example.com")).link, null);
    assert.equal(count(), before + 2, "the refused ask wrote its (dead) row too");
    assert.equal((await askLink(r, new Browser(r.base), "outsider2@example.com", "cpi_wrong_wrong_wrong_wrong_wrong_wrong")).link, null);
    assert.equal(count(), before + 3);
    const bytes = ["", "-wal"].map((s) => { try { return readFileSync(`${dbPath}${s}`).toString("latin1"); } catch { return ""; } }).join("");
    assert.doesNotMatch(bytes, /outsider/);
    // A link a day past its expiry is swept by the next ask.
    r.setNow(Date.UTC(2026, 9, 28, 12));
    await askLink(r, new Browser(r.base), "member@example.com");
    assert.equal(count(), 1);
  });

  test("a refused state change writes no audit row: the log never says a deleted person was restored", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const b = new Browser(r.base);
    await pressLink(b, (await askLink(r, b, "audit@example.com", code)).link!);
    const personId = r.accounts.sessionPerson(b.jar.get("cp_session")!)!;
    assert.equal(r.accounts.setState(personId, "suspended"), true);
    const db = openDb(join(tmp.root, "control", "accounts.sqlite"), { wal: true });
    db.run("UPDATE people SET state = 'deleted' WHERE id = ?", personId);
    db.close();
    assert.equal(r.accounts.setState(personId, "active"), false);
    assert.equal(r.accounts.setState("0".repeat(32), "suspended"), false);
    const actions = r.accounts.auditOf(personId).map((a) => a.action);
    assert.deepEqual(actions.filter((a) => a.startsWith("person.")), ["person.suspended"]);
    assert.equal(r.accounts.isLive(personId), false);
  });

  test("review of #644: signing in again in the same browser ends the session it carried", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const b = new Browser(r.base);
    await pressLink(b, (await askLink(r, b, "again@example.com", code)).link!);
    const old = b.jar.get("cp_session")!;
    assert.ok(r.accounts.sessionPerson(old) !== null);
    // A second link asked for and used in this same browser (the form's token is the browser's, on any page).
    const form = await (await b.go("/account")).text();
    await b.form("/login", { csrf: csrfOf(form), email: "again@example.com", next: "/account" });
    const link = /https?:\/\/[^\s]+/.exec(r.mail.sent.at(-1)!.text)![0].replace(/^https?:\/\/[^/]+/, "");
    assert.equal((await pressLink(b, link)).status, 303);
    assert.equal(r.accounts.sessionPerson(old), null);
    assert.ok(r.accounts.sessionPerson(b.jar.get("cp_session")!) !== null);
  });

  test("sign out ends the session; a suspended person's session stops at the next request", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 2 });
    const b = new Browser(r.base);
    await pressLink(b, (await askLink(r, b, "s@example.com", code)).link!);
    const page = await (await b.go("/account")).text();
    const out = await b.form("/logout", { csrf: csrfOf(page) });
    assert.equal(out.status, 303);
    assert.equal((await b.go("/account")).status, 303);
    const c = new Browser(r.base);
    await pressLink(c, (await askLink(r, c, "t@example.com", code)).link!);
    assert.equal((await c.go("/account")).status, 200);
    const personId = r.accounts.sessionPerson(c.jar.get("cp_session") ?? null)!;
    r.accounts.setState(personId, "suspended");
    assert.equal((await c.go("/account")).status, 303);
  });

  test("time zone: a real IANA zone is kept, anything else refused", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const b = new Browser(r.base);
    await pressLink(b, (await askLink(r, b, "tz@example.com", code)).link!);
    let html = await (await b.go("/account")).text();
    assert.equal((await b.form("/account/timezone", { csrf: csrfOf(html), tz: "Mars/Olympus" })).status, 400);
    assert.equal((await b.form("/account/timezone", { csrf: csrfOf(html), tz: "Europe/Berlin" })).status, 303);
    html = await (await b.go("/account")).text();
    assert.match(html, /value="Europe\/Berlin"/);
    assert.equal(validTimeZone("Pacific/Kiritimati"), "Pacific/Kiritimati");
    assert.equal(normalizeEmail("not an email"), null);
  });
});

describe("egress", () => {
  test("Resend: one POST to its endpoint, the key only in the Authorization header; a failure throws", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok = resendMailer({ apiKey: "re_test_generated", from: "Counterparts <memory@counterparts.ai>", fetchFn: (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch });
    await ok.send({ to: "a@example.com", subject: "s", text: "t" });
    assert.equal(seen[0]!.url, RESEND_ENDPOINT);
    assert.equal(new Headers(seen[0]!.init.headers).get("authorization"), "Bearer re_test_generated");
    assert.doesNotMatch(String(seen[0]!.init.body), /re_test_generated/);
    const bad = resendMailer({ apiKey: "k", from: "f", fetchFn: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    await assert.rejects(bad.send({ to: "a@example.com", subject: "s", text: "t" }));
  });

  test("the egress list is enumerated: only egress.ts may open a connection", () => {
    const dir = new URL("../src/", import.meta.url).pathname;
    const callers: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      if (/\b\w*[fF]etch\s*\(|from\s+"node:(https|net|tls|dgram)"|\.request\s*\(|new\s+WebSocket/.test(text)) callers.push(f);
    }
    assert.deepEqual(callers.sort(), ["egress.ts"]);
  });
});

// ── H1: a restart keeps the open forms ─────────────────────────────────────────

describe("a form opened before a restart (H1: the CSRF key comes from COOKIE_KEYS)", () => {
  /** The whole app on one data root and port, as `main.ts serve` composes it with BACKUPS=off. */
  async function serve(port: number, cookieKeys?: readonly string[]): Promise<{ mail: ReturnType<typeof memoryMailer>; stop: () => Promise<void> }> {
    const mail = memoryMailer();
    const app = createApp({
      dataRoot: join(tmp.root, "data"),
      publicOrigin: `http://127.0.0.1:${String(port)}`,
      mailer: mail,
      embedder: null,
      spawner: () => ({ pid: 1 }),
      ...(cookieKeys === undefined ? {} : { cookieKeys }),
    });
    await app.start();
    await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      await new Promise<void>((r) => {
        app.server.close(() => r());
        app.server.closeAllConnections?.();
      });
      await app.close();
    };
    closers.push(stop);
    return { mail, stop };
  }
  const KEYS = ["k".repeat(40), "o".repeat(40)];
  // No spots set (SU1), so the page's words are the full ones: a link if the address has an account or a good code.
  const SENT = "a link is on its way";

  /** Open /login on one server, restart it with `after`'s keys, and post the form there, as the browser does. */
  async function acrossRestart(before: readonly string[] | undefined, after: readonly string[] | undefined): Promise<{ status: number; body: string; mailed: number }> {
    const port = await freePort();
    const first = await serve(port, before);
    const b = new Browser(`http://127.0.0.1:${String(port)}`);
    const form = await (await b.go("/login")).text();
    assert.ok(csrfOf(form).length > 0);
    await first.stop();
    const second = await serve(port, after);
    const res = await b.form("/login", { csrf: csrfOf(form), email: "restart@example.com", next: "/account" }, { origin: `http://127.0.0.1:${String(port)}` });
    return { status: res.status, body: await res.text(), mailed: second.mail.sent.length };
  }

  test("the same COOKIE_KEYS: the form posts after the restart", async () => {
    const out = await acrossRestart(KEYS, KEYS);
    assert.equal(out.status, 200);
    assert.ok(out.body.includes(SENT), out.body);
    assert.doesNotMatch(out.body, /expired/);
  });

  test("other keys, or a rotation that put a new key first: the form has expired", async () => {
    for (const after of [["x".repeat(40)], ["n".repeat(40), ...KEYS]]) {
      const out = await acrossRestart(KEYS, after);
      assert.equal(out.status, 403);
      assert.match(out.body, /This form expired or came from somewhere else/);
      assert.equal(out.mailed, 0);
    }
  });

  test("no COOKIE_KEYS: the form expires on a restart, as before", async () => {
    const out = await acrossRestart(undefined, undefined);
    assert.equal(out.status, 403);
    assert.match(out.body, /This form expired/);
  });
});

describe("G4: the beta note, and the bare address", () => {
  // Mike's paragraph (2026-11-06), copied here by hand: importing the page's
  // constant would let a changed word through.
  const NOTE =
    "Hosted Counterparts is a free beta. We store what Claude writes through Counterparts' tools (your memories, their earlier versions, a journal, dreams, reflections and a self page) and your account details: your email, time zone, connected AIs, sign-in sessions, which invite you used, if any (a reference, not the code), and a record of account events (kept for 12 months, then erased). We also keep the day you last started a chat with Counterparts and the day you last used Counterparts' tools (just the dates), to tell quiet accounts from active ones and count them. If the link you signed up through carried it, we keep where you came from: a campaign tag, the referring site's address (no page or search terms) and the page you landed on. We keep no transcript of your chats. Our hosting provider encrypts its disks (AES-256 at rest), and backups of your memories that leave our server are encrypted with a key that belongs to your account. Our hosting provider also keeps short-term snapshots of its disks for its own recovery, and rotates them on its own schedule. You can delete a single memory by asking Claude, and you can delete your whole account any time: it locks at once and is erased after 24 hours unless you keep it, or you can delete everything now. You can download your whole memory any time as one SQLite file (not encrypted: keep it somewhere safe). Found a bug? Open an issue at https://github.com/mlapeter/counterparts/issues (please don't paste memories into it). For anything else, write to mike@resonantventures.com.";
  // The page splits the note into short paragraphs at sentence ends (11-25): the words
  // between tags are compared with runs of whitespace made one space.
  const visible = (html: string): string =>
    html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<\/p>\s*<p[^>]*>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ");

  test("the account page a new sign-up lands on carries the note word for word, with a link to the issues and a mailto", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({});
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "new@example.com", code);
    const used = await pressLink(me, asked.link!);
    assert.equal(used.headers.get("location"), "/account");
    const html = await (await me.go("/account")).text();
    assert.ok(visible(html).includes(NOTE), "the note, verbatim");
    assert.equal(visible(html).split(NOTE).length, 2, "once");
    assert.match(html, /<a href="https:\/\/github\.com\/mlapeter\/counterparts\/issues">https:\/\/github\.com\/mlapeter\/counterparts\/issues<\/a>/);
    assert.match(html, /<a href="mailto:mike@resonantventures\.com">mike@resonantventures\.com<\/a>/);
    // Under its own heading at the foot (11-25), after the dashboard and the rest of the page.
    const head = html.indexOf('<h2 id="privacy">What we keep, and your choices</h2>');
    assert.ok(html.indexOf('href="/dashboard/"') < head && html.indexOf("<h2>Your day</h2>") > 0 && html.indexOf("<h2>Your day</h2>") < head);
    assert.ok(head < html.indexOf("Hosted Counterparts is a free beta."));
  });

  test("GET / goes to the account page, and a signed-out visitor from there to sign in", async () => {
    const r = await rig();
    const b = new Browser(r.base);
    const root = await b.go("/");
    assert.equal(root.status, 303);
    assert.equal(root.headers.get("location"), "/account");
    assert.equal(root.headers.get("cache-control"), "no-store");
    const account = await b.go(root.headers.get("location")!);
    assert.equal(account.status, 303);
    assert.equal(account.headers.get("location"), "/login?next=%2Faccount");
    assert.equal((await b.go("/", { method: "HEAD" })).status, 303);
    assert.equal((await b.go("/nope")).status, 404); // only the bare address
  });
});

describe("PR B: the 6-digit code, only in the browser that asked", () => {
  const codeOf = (r: Rig): string => /in that same browser: (\d{6})/.exec(r.mail.sent.at(-1)!.text)![1]!;
  const notIt = (code: string, by = 1): string => String((Number(code) + by) % 1_000_000).padStart(6, "0");
  /** Type `code` in the code box of `body` (a "check your email" page), as `browser`. */
  const typeCode = async (browser: Browser, body: string, code: string, extra: Record<string, string> = {}): Promise<Response> =>
    browser.form("/login/code", { ...formFields(body, "/login/code")!, code }, extra);
  const CALM = /That code didn&#39;t work\./;
  const words = (h: string): string => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  test("the right code in the right browser signs in (a sign-up here), and spends the link too", async () => {
    const r = await rig();
    const { code: invite } = r.accounts.createInvite();
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "Coder@Example.com", invite);
    assert.match(asked.body, /<form method="post" action="\/login\/code">/);
    assert.match(asked.body, /autocomplete="one-time-code"/);
    // One recommendation leads (11-25): the link, then the code as the fallback; the code's limits stay said.
    const lead = asked.body.indexOf("Click the link in the email. If it opens somewhere else, or you&#39;d rather not, type the 6-digit code here.");
    // Just under the heading: the first paragraph after the h1, ahead of the sent words and the code form.
    const afterH1 = asked.body.slice(asked.body.indexOf("<h1>Check your email</h1>"));
    assert.equal(afterH1.indexOf("<p>"), afterH1.indexOf("<p>Click the link in the email."));
    assert.ok(lead >= 0 && lead < asked.body.indexOf("a link is on its way") && lead < asked.body.indexOf('<form method="post" action="/login/code">'));
    assert.match(asked.body, /The code works only here, in this browser\. The link works on any device\./);
    assert.match(asked.body, /It works once, for 15 minutes/);
    const code = codeOf(r);
    assert.match(r.mail.sent.at(-1)!.text, /Don't give this code or link to anyone/);
    const res = await typeCode(me, asked.body, `${code.slice(0, 3)} ${code.slice(3)}`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/account");
    assert.match(await (await me.go("/account")).text(), /Signed in as <strong>coder@example\.com<\/strong>/);
    assert.equal(r.accounts.spots().people, 1);
    // One use covers both: the link is spent, and the code again is refused.
    assert.equal((await me.go(asked.link!)).status, 400);
    assert.equal((await typeCode(me, asked.body, code)).status, 400);
  });

  test("the right code in a different browser is refused, in the calm words; the asking browser's code still works", async () => {
    const r = await rig();
    const { code: invite } = r.accounts.createInvite({ maxUses: 2 });
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "phone@example.com", invite);
    const code = codeOf(r);
    // Another browser that asked too (for its own address), typing the first one's address and code.
    const laptop = new Browser(r.base);
    const its = await askLink(r, laptop, "laptop@example.com", invite);
    const stolen = await laptop.form("/login/code", { ...formFields(its.body, "/login/code")!, email: "phone@example.com", code });
    assert.equal(stolen.status, 400);
    assert.match(await stolen.text(), CALM);
    // And one that never asked.
    const stranger = new Browser(r.base);
    const page = await (await stranger.go("/login")).text();
    assert.equal((await stranger.form("/login/code", { csrf: csrfOf(page), email: "phone@example.com", code, next: "/account" })).status, 400);
    assert.equal(r.accounts.spots().people, 0, "nobody signed in");
    assert.equal((await typeCode(me, asked.body, code)).status, 303);
  });

  test("five wrong tries kill the code (the link still works); a parallel burst can't pass five", async () => {
    const r = await rig();
    const { code: invite } = r.accounts.createInvite({ maxUses: 2 });
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "fumble@example.com", invite);
    const code = codeOf(r);
    for (let i = 0; i < 5; i++) {
      const res = await typeCode(me, asked.body, notIt(code));
      assert.equal(res.status, 400);
      assert.match(await res.text(), CALM);
    }
    const dead = await typeCode(me, asked.body, code);
    assert.equal(dead.status, 400, "the right code, after five wrong ones");
    assert.match(await dead.text(), CALM);
    assert.equal((await pressLink(me, asked.link!)).status, 303, "the link still signs in");

    const you = new Browser(r.base);
    const burst = await askLink(r, you, "burst@example.com", invite);
    const its = codeOf(r);
    await Promise.all(Array.from({ length: 8 }, () => typeCode(you, burst.body, notIt(its, 7))));
    assert.equal((await typeCode(you, burst.body, its)).status, 400);
  });

  test("an expired code is refused; no CSRF token or a foreign Origin is refused", async () => {
    const r = await rig();
    const { code: invite } = r.accounts.createInvite();
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "slow@example.com", invite);
    const code = codeOf(r);
    assert.equal((await me.form("/login/code", { ...formFields(asked.body, "/login/code")!, csrf: "", code })).status, 403);
    assert.equal((await typeCode(me, asked.body, code, { origin: "https://evil.example" })).status, 403);
    r.setNow(Date.UTC(2026, 9, 26, 12, 16));
    assert.equal((await typeCode(me, asked.body, code)).status, 400);
    assert.equal(r.accounts.spots().people, 0);
  });

  test("an OAuth connect's next rides through the code box, in the browser that started it", async () => {
    const r = await rig();
    const { code: invite } = r.accounts.createInvite();
    const me = new Browser(r.base);
    const asked = await askLink(r, me, "connect@example.com", invite, "/oauth/allow/abc123");
    assert.equal((await typeCode(me, asked.body, codeOf(r))).headers.get("location"), "/oauth/allow/abc123");
  });

  test("the caps fail closed: ten tries an hour per address across links, twenty per IP; refused in the same words", async () => {
    const r = await rig({ trustProxy: 1 });
    const { code: invite } = r.accounts.createInvite({ maxUses: 5 });
    const me = new Browser(r.base);
    const ip = { "x-forwarded-for": "198.51.100.7" };
    // Two links, five wrong tries each (each code dies at five): ten tries on this address.
    for (let n = 0; n < 2; n++) {
      const asked = await askLink(r, me, "capped@example.com", invite);
      const code = codeOf(r);
      for (let i = 0; i < 5; i++) assert.equal((await typeCode(me, asked.body, notIt(code), ip)).status, 400);
    }
    // A third link, its right code at once: refused by the address's cap.
    const third = await askLink(r, me, "capped@example.com", invite);
    const capped = await typeCode(me, third.body, codeOf(r), ip);
    assert.equal(capped.status, 400);
    assert.match(await capped.text(), CALM);
    assert.equal(r.accounts.spots().people, 0);
    assert.equal((await pressLink(me, third.link!)).status, 303, "the link is still the way in");

    // Per IP: twenty tries from one address of the internet, any emails; the twenty-first is refused.
    const other = new Browser(r.base);
    const page = await (await other.go("/login")).text();
    const walker = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 20; i++) await other.form("/login/code", { csrf: csrfOf(page), email: `walk${String(i)}@example.com`, code: "000000", next: "/account" }, walker);
    const fresh = await askLink(r, other, "fresh@example.com", invite);
    const code = codeOf(r);
    assert.equal((await typeCode(other, fresh.body, code, walker)).status, 400);
    assert.equal((await typeCode(other, fresh.body, code, { "x-forwarded-for": "203.0.113.10" })).status, 303, "another IP, the same code: in");
  });

  test("a stranger who ASKS for an address can fill its daily code cap (four asks, five wrong each): the person's code is refused for the day, the link still works", async () => {
    const r = await rig({ trustProxy: 1 });
    const { code: invite } = r.accounts.createInvite();
    const attacker = new Browser(r.base);
    // Four asks for the victim's address from the attacker's own browser (each emails the victim), five wrong codes each.
    for (let n = 0; n < 4; n++) {
      const asked = await askLink(r, attacker, "target@example.com", invite);
      const code = codeOf(r);
      for (let i = 0; i < 5; i++) assert.equal((await typeCode(attacker, asked.body, notIt(code), { "x-forwarded-for": `203.0.113.${String(30 + n)}` })).status, 400);
    }
    assert.equal(r.mail.sent.filter((m) => m.to === "target@example.com").length, 4, "the person got an email per ask");
    // Two hours on (the hourly cap long clear), the person asks: their right code is refused, in the same words.
    r.setNow(Date.UTC(2026, 9, 26, 14, 1));
    const victim = new Browser(r.base);
    const asked = await askLink(r, victim, "target@example.com", invite);
    const refused = await typeCode(victim, asked.body, codeOf(r), { "x-forwarded-for": "198.51.100.30" });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), CALM);
    // The link still signs them in.
    assert.equal((await pressLink(victim, asked.link!)).status, 303);
    assert.equal(r.accounts.spots().people, 1);
  });

  test("nobody uses up a person's code tries by typing their address alone (the Phone's re-check)", async () => {
    const r = await rig({ trustProxy: 1 });
    const { code: invite } = r.accounts.createInvite({ maxUses: 2 });
    // Another browser, which asked for its own address, types the victim's address fifteen times.
    const attacker = new Browser(r.base);
    const its = await askLink(r, attacker, "attacker@example.com", invite);
    for (let i = 0; i < 15; i++) await attacker.form("/login/code", { ...formFields(its.body, "/login/code")!, email: "victim@example.com", code: "000000" }, { "x-forwarded-for": "203.0.113.20" });
    // The victim's caps are untouched: their own code signs them in.
    const victim = new Browser(r.base);
    const asked = await askLink(r, victim, "victim@example.com", invite);
    assert.equal((await typeCode(victim, asked.body, codeOf(r), { "x-forwarded-for": "198.51.100.20" })).status, 303);
  });

  test("no enumeration: a member's and a stranger's code box answer a wrong code alike, and each try costs the same write", async () => {
    const r = await rig();
    // Spots are 0 here (never set): a stranger without an invite gets no email, only the same page.
    const { code: invite } = r.accounts.createInvite();
    const first = new Browser(r.base);
    await pressLink(first, (await askLink(r, first, "member2@example.com", invite)).link!);
    const knownBrowser = new Browser(r.base);
    const known = await askLink(r, knownBrowser, "member2@example.com");
    const memberCode = codeOf(r);
    const sent = r.mail.sent.length;
    const unknownBrowser = new Browser(r.base);
    const unknown = await askLink(r, unknownBrowser, "nobody@example.com");
    assert.equal(r.mail.sent.length, sent, "the stranger was sent nothing");
    const a = await typeCode(knownBrowser, known.body, notIt(memberCode));
    const b = await typeCode(unknownBrowser, unknown.body, notIt(memberCode));
    assert.equal(a.status, b.status);
    assert.equal(words(await a.text()), words(await b.text()));
    // The stranger's dead row took its try too: one write each.
    const db = openDb(join(tmp.root, "control", "accounts.sqlite"));
    try {
      const tries = db.all<{ email: string; code_tries: number }>("SELECT email, code_tries FROM login_links WHERE code_tries > 0 ORDER BY email");
      assert.deepEqual(
        tries.map((t) => [t.email, Number(t.code_tries)]),
        [
          ["", 1],
          ["member2@example.com", 1],
        ],
      );
      // And no code is kept: the hash only, under the row's id.
      assert.equal(db.all("SELECT 1 FROM login_links WHERE code_hash IS NULL OR length(code_hash) != 64").length, 0);
    } finally {
      db.close();
    }
  });
});
