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

import { Accounts, normalizeEmail, validTimeZone } from "../src/accounts.js";
import { memoryMailer, resendMailer, RESEND_ENDPOINT } from "../src/egress.js";
import { accountPages } from "../src/pages.js";
import { createHostedServer } from "../src/server.js";
import { Tenants } from "../src/tenants.js";
import { safeNext } from "../src/web.js";
import { openDb } from "../../src/core/store/db.js";
import { listen, tempRoot } from "./helpers.js";

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

async function rig(opts: { trustProxy?: boolean } = {}): Promise<Rig> {
  let now = Date.UTC(2026, 9, 26, 12);
  const clock = (): number => now;
  const accounts = new Accounts({ path: join(tmp.root, "control", "accounts.sqlite"), now: clock });
  closers.push(() => accounts.close());
  const mail = memoryMailer();
  const pages = accountPages({ accounts, mailer: mail, publicOrigin: "http://127.0.0.1", now: clock, ...(opts.trustProxy === true ? { trustProxy: true } : {}) });
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
    const used = await me.go(asked.link);
    assert.equal(used.status, 303);
    assert.equal(used.headers.get("location"), "/account");
    const account = await (await me.go("/account")).text();
    assert.match(account, /Signed in as <strong>katie@example\.com<\/strong>/);
    assert.match(account, /value="America\/Denver"/);
    // The store id is 128 random bits; the person row carries the zone from the browser.
    const db = readFileSync(join(tmp.root, "control", "accounts.sqlite")).toString("latin1");
    assert.doesNotMatch(db, /cpl_|cps_|cpi_/); // no raw secret anywhere in the file
  });

  test("an unknown address without an invite gets the same page as a known one, and no email", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const first = new Browser(r.base);
    const signup = await askLink(r, first, "known@example.com", code);
    await first.go(signup.link!);
    const known = await askLink(r, new Browser(r.base), "known@example.com");
    const unknown = await askLink(r, new Browser(r.base), "stranger@example.com");
    const badInvite = await askLink(r, new Browser(r.base), "stranger2@example.com", "cpi_not-a-real-code-at-all-000000");
    assert.ok(known.link !== null);
    assert.equal(unknown.link, null);
    assert.equal(badInvite.link, null);
    assert.equal(unknown.res.status, known.res.status);
    const unNonced = (h: string): string => h.replace(/nonce="[^"]+"/g, "nonce");
    assert.equal(unNonced(unknown.body), unNonced(known.body));
    assert.equal(unNonced(badInvite.body), unNonced(known.body));
  });

  test("a link works once, for 15 minutes, and only in the browser that asked — the wrong browser does not spend it", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 3 });
    const me = new Browser(r.base);
    const a = await askLink(r, me, "a@example.com", code);
    // Another browser (a forwarded email, a mail scanner): refused, link intact.
    const other = new Browser(r.base);
    await other.go("/login");
    const wrong = await other.go(a.link!);
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /browser where you asked/);
    const noCookie = await fetch(`${r.base}${a.link!}`, { redirect: "manual" });
    assert.equal(noCookie.status, 400);
    assert.equal((await me.go(a.link!)).status, 303);
    // Used.
    assert.equal((await me.go(a.link!)).status, 400);
    // Expired (a second browser: the first is signed in now).
    const later = new Browser(r.base);
    const b = await askLink(r, later, "a@example.com");
    r.setNow(Date.UTC(2026, 9, 26, 12, 16));
    assert.equal((await later.go(b.link!)).status, 400);
    // A token nobody issued.
    assert.equal((await me.go("/login/link?token=cpl_nonsense_nonsense_nonsense")).status, 400);
  });

  test("an invite used up: the second sign-up through it is refused even if both links were asked for first", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 1 });
    const one = new Browser(r.base);
    const two = new Browser(r.base);
    const l1 = await askLink(r, one, "one@example.com", code);
    const l2 = await askLink(r, two, "two@example.com", code);
    assert.equal((await one.go(l1.link!)).status, 303);
    assert.equal((await two.go(l2.link!)).status, 400);
    assert.equal((await two.go("/account")).status, 303); // not signed in: back to login
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
    assert.equal((await b.go(evil.link!)).headers.get("location"), "/account");
    const b2 = new Browser(r.base);
    const good = await askLink(r, b2, "n@example.com", "", "/oauth/allow/abc123");
    assert.equal((await b2.go(good.link!)).headers.get("location"), "/oauth/allow/abc123");
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
    await b.go((await askLink(r, b, "redirect@example.com", code)).link!);
    const res = await b.go(`/login?next=${encodeURIComponent("/oauth/..//evil.example/phish")}`);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/account");
    // And through the emailed link's `next`.
    const b2 = new Browser(r.base);
    const viaLink = await askLink(r, b2, "redirect@example.com", "", "/oauth/..//evil.example/phish");
    assert.equal((await b2.go(viaLink.link!)).headers.get("location"), "/account");
  });

  test("review of #644: behind the proxy, the per-IP limit keys on the hop the proxy appended, not the one the client wrote", async () => {
    const r = await rig({ trustProxy: true });
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

  test("review of #644: a refused ask costs the same commit as a sent one, and keeps no address", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const first = new Browser(r.base);
    await first.go((await askLink(r, first, "member@example.com", code)).link!);
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
    await b.go((await askLink(r, b, "audit@example.com", code)).link!);
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
    await b.go((await askLink(r, b, "again@example.com", code)).link!);
    const old = b.jar.get("cp_session")!;
    assert.ok(r.accounts.sessionPerson(old) !== null);
    // A second link asked for and used in this same browser (the form's token is the browser's, on any page).
    const form = await (await b.go("/account")).text();
    await b.form("/login", { csrf: csrfOf(form), email: "again@example.com", next: "/account" });
    const link = /https?:\/\/[^\s]+/.exec(r.mail.sent.at(-1)!.text)![0].replace(/^https?:\/\/[^/]+/, "");
    assert.equal((await b.go(link)).status, 303);
    assert.equal(r.accounts.sessionPerson(old), null);
    assert.ok(r.accounts.sessionPerson(b.jar.get("cp_session")!) !== null);
  });

  test("sign out ends the session; a suspended person's session stops at the next request", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite({ maxUses: 2 });
    const b = new Browser(r.base);
    await b.go((await askLink(r, b, "s@example.com", code)).link!);
    const page = await (await b.go("/account")).text();
    const out = await b.form("/logout", { csrf: csrfOf(page) });
    assert.equal(out.status, 303);
    assert.equal((await b.go("/account")).status, 303);
    const c = new Browser(r.base);
    await c.go((await askLink(r, c, "t@example.com", code)).link!);
    assert.equal((await c.go("/account")).status, 200);
    const personId = r.accounts.sessionPerson(c.jar.get("cp_session") ?? null)!;
    r.accounts.setState(personId, "suspended");
    assert.equal((await c.go("/account")).status, 303);
  });

  test("time zone: a real IANA zone is kept, anything else refused", async () => {
    const r = await rig();
    const { code } = r.accounts.createInvite();
    const b = new Browser(r.base);
    await b.go((await askLink(r, b, "tz@example.com", code)).link!);
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
