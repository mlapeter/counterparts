/**
 * CN1, SA1, AL1 and the 100 MB quota (Mike, 2026-11-17), through the real door.
 *
 *   - SA1: a sign-up that came through `/login?r=&ref=&land=` keeps where it came
 *     from (cleaned), a member's sign-in and a refused ask keep nothing, and an
 *     erase clears it; the sanitizers refuse anything that could carry more.
 *   - CN1: `/ops/counts` answers counts only, with the token; 401 without or with
 *     a wrong one; a 404 when no token is configured. "connected" and "active"
 *     follow real MCP tool calls.
 *   - The migration: a database made by the build before this one (its DDL here),
 *     with people, a store and an unused login link, opens with every row intact,
 *     the new columns NULL, `last_seen_on` back-filled from the last wake, and the
 *     old link still signing in.
 *   - AL1: one email per spots threshold per total (80, 95, 100), re-armed by a new
 *     total; the storage alert once at 70% of the volume (or the byte override),
 *     re-armed only well below. Never counted against the sign-up email cap.
 *   - The quota: 100 MB by default, a store already over its quota refuses writes in
 *     plain words and keeps every memory, and writes come back when it is raised.
 *   - The account page's empty state links the step-by-step setup.
 *   - The whole path as a process: `main.ts serve` with MAIL=log.
 *
 * Every test makes its own temp root (helpers.ts#tempRoot) and removes it.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { openDb } from "../../src/core/store/db.js";
import { Accounts, cleanAttribution, cleanLanding, cleanReferrer, cleanSource, sha256 } from "../src/accounts.js";
import { Alerts } from "../src/alerts.js";
import { memoryMailer } from "../src/egress.js";
import { McpLimits, STORE_QUOTA_BYTES } from "../src/limits.js";
import { SETUP_URL } from "../src/pages.js";
import { freePort, rpc, tempRoot, tool } from "./helpers.js";
import { Browser, bearer, connect, csrfOf, rig, signInByLink } from "./oauth-rig.js";
import type { Rig } from "./oauth-rig.js";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TOKEN = "counts-token-for-the-test-0123456789abcdef";
const OPS = "ops@example.com";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("cn1");
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

async function started(extra: Parameters<typeof rig>[1] = {}): Promise<Rig> {
  const r = await rig(tmp.root, extra);
  closers.push(r.close);
  return r;
}

/** Every hidden input of a served form, as the browser would post it. */
function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)"(?: id="[^"]*")? value="([^"]*)">/g)) out[m[1]!] = m[2]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return out;
}

/** Sign up through the site's link: `/login?<query>`, the hidden fields posted as served, the emailed link clicked. */
async function signUpFrom(r: { origin: string; mail: { sent: { to: string; text: string }[] } }, browser: Browser, email: string, query: string, next = "/account"): Promise<Response> {
  const html = await (await browser.go(`/login?next=${encodeURIComponent(next)}&${query}`)).text();
  const fields = hiddenFields(html);
  const before = r.mail.sent.length;
  await browser.form("/login", { ...fields, email, invite: "", tz: "America/Denver" });
  // The page answers before the mail is handed over (never awaited, CONTRACT §12); a log's line can come a moment later.
  for (let i = 0; i < 50 && r.mail.sent.length === before; i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(r.mail.sent.length, before + 1, "a link was mailed");
  return browser.go(/https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0]);
}

const counts = async (origin: string, token?: string): Promise<Response> => fetch(`${origin}/ops/counts`, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });
const alertsTo = (r: Rig): { subject: string; text: string }[] => r.mail.sent.filter((m) => m.to === OPS);

describe("SA1: where a sign-up came from", () => {
  test("the sanitizers keep a short tag, an origin and a path, and refuse anything more", () => {
    assert.equal(cleanSource("Reddit"), "reddit");
    assert.equal(cleanSource("hn_launch-2.1"), "hn_launch-2.1");
    assert.equal(cleanSource("someone@example.com"), null);
    assert.equal(cleanSource("a".repeat(41)), null);
    assert.equal(cleanSource("two words"), null);
    assert.equal(cleanReferrer("https://www.reddit.com/r/ClaudeAI/comments/abc?utm=1#x"), "https://www.reddit.com");
    assert.equal(cleanReferrer("news.ycombinator.com/item?id=1"), "https://news.ycombinator.com");
    assert.equal(cleanReferrer("javascript:alert(1)"), null);
    assert.equal(cleanReferrer("https://me:secret@example.com/"), null);
    assert.equal(cleanReferrer(`https://${"a".repeat(120)}.com`), null);
    assert.equal(cleanLanding("/claude-ai/?email=someone@example.com#setup"), "/claude-ai/");
    assert.equal(cleanLanding("//evil.example/"), null);
    assert.equal(cleanLanding("https://counterparts.ai/"), null);
    assert.equal(cleanLanding("/<script>"), null);
    assert.equal(cleanLanding(`/${"a".repeat(100)}`), null);
    assert.deepEqual(cleanAttribution({ utm_source: "Bluesky", ref: "", land: "/" }), { source: "bluesky", referrer: null, landing: "/" });
    // `r` wins over utm_source.
    assert.equal(cleanAttribution({ r: "friend", utm_source: "bluesky" }).source, "friend");
  });

  test("a sign-up through /login?r=&ref=&land= keeps them; a member's sign-in and a plain sign-up keep nothing; an erase clears them", async () => {
    const r = await started();
    r.app.accounts.setSpots(10);
    const b = new Browser(r.origin);
    const res = await signUpFrom(r, b, "from-reddit@example.com", `r=Reddit&ref=${encodeURIComponent("https://www.reddit.com/r/ClaudeAI/x?y=1")}&land=${encodeURIComponent("/claude-ai/?q=1")}`);
    assert.equal(res.status, 303);
    const person = r.app.accounts.person(await personOf(r, "from-reddit@example.com"))!;
    assert.deepEqual(r.app.accounts.attributionOf(person.id), { source: "reddit", referrer: "https://www.reddit.com", landing: "/claude-ai/" });
    // The emailed link carries no source: the fields ride the link's row, not its URL.
    assert.doesNotMatch(r.mail.sent.at(-1)!.text, /reddit|claude-ai/);
    // A member signing in again through a tagged link changes nothing.
    await signUpFrom(r, new Browser(r.origin), "from-reddit@example.com", "r=other&land=/other/");
    assert.equal(r.app.accounts.attributionOf(person.id).source, "reddit");
    // A plain sign-up (no query, no Referer) keeps nothing.
    await signInByLink(r, new Browser(r.origin), "plain@example.com", "", "/account");
    assert.deepEqual(r.app.accounts.attributionOf(await personOf(r, "plain@example.com")), { source: null, referrer: null, landing: null });
    // A bad email re-renders the form with the fields still in it.
    const fresh = new Browser(r.origin);
    const form = await (await fresh.go("/login?r=bluesky")).text();
    const bad = await fresh.form("/login", { ...hiddenFields(form), email: "not an email" });
    assert.equal(bad.status, 400);
    assert.equal(hiddenFields(await bad.text())["r"], "bluesky");
    // The erase clears them with the rest of the row.
    assert.ok(r.app.accounts.markDeleting(person.id));
    r.app.accounts.markDeleted(person.id);
    assert.deepEqual(r.app.accounts.attributionOf(person.id), { source: null, referrer: null, landing: null });
    assert.equal(r.app.accounts.lastSeenOn(person.id), null);
  });

  test("with no `ref`, another site's Referer gives its origin; our own never does", async () => {
    const r = await started();
    r.app.accounts.setSpots(10);
    const b = new Browser(r.origin);
    const html = await (await b.go("/login?r=hn", { headers: { referer: "https://news.ycombinator.com/item?id=42" } })).text();
    assert.equal(hiddenFields(html)["ref"], "https://news.ycombinator.com");
    const own = await (await b.go("/login", { headers: { referer: `${r.origin}/account` } })).text();
    assert.equal(hiddenFields(own)["ref"], undefined);
  });
});

async function personOf(_r: Rig, email: string): Promise<string> {
  const db = openDb(join(tmp.root, "data", "control", "accounts.sqlite"), { wal: true });
  try {
    return db.get<{ person_id: string }>("SELECT person_id FROM identities WHERE kind = 'email' AND value = ?", email)!.person_id;
  } finally {
    db.close();
  }
}

describe("CN1: /ops/counts, and AL1's spots alert, through the real door", () => {
  test("a tagged sign-up, a connection and a tool call; the counts with and without the token; one alert at 80%, none again, one at 100%, re-armed by a new total", async () => {
    const r = await started({ countsToken: TOKEN, alerts: { to: OPS, volume: () => ({ total: 1000, used: 10 }) } });
    r.app.accounts.setSpots(5);
    // The account page's empty state, right after the first sign-up's link.
    const first = new Browser(r.origin);
    await signUpFrom(r, first, "one@example.com", "r=reddit&ref=https://www.reddit.com/");
    const page = await (await first.go("/account")).text();
    assert.ok(page.includes(`href="${SETUP_URL}"`), "the empty state links the step-by-step");
    assert.match(page, /Step-by-step: how to add it in Claude/);
    assert.match(page, /\/mcp<\/code>/);
    // Connected over OAuth and one real tool call.
    const c = await connect(r, { browser: first, signIn: async () => assert.fail("already signed in") });
    await tool(`${r.origin}/mcp`, "status", {}, bearer(c.access));

    // The counts: 401 without the token, or a wrong one; 200 with it, counts only.
    assert.equal((await counts(r.origin)).status, 401);
    assert.equal((await counts(r.origin, "wrong")).status, 401);
    assert.equal((await counts(r.origin, `${TOKEN}x`)).status, 401);
    assert.equal((await fetch(`${r.origin}/ops/counts`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
    const ok = await counts(r.origin, TOKEN);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
    const body = (await ok.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["accounts", "active7d", "at", "connected", "referrers", "sources", "spots"]);
    assert.deepEqual({ ...body, at: "" }, { at: "", accounts: 1, connected: 1, active7d: 1, spots: { total: 5, left: 4 }, sources: { reddit: 1 }, referrers: { "https://www.reddit.com": 1 } });
    assert.doesNotMatch(JSON.stringify(body), /@|[0-9a-f]{32}/);
    assert.equal(alertsTo(r).length, 0);

    // Three more plain sign-ups: 4 of 5 is 80%. One alert, sent at the sign-up (joined here).
    for (const n of ["two", "three", "four"]) await signInByLink(r, new Browser(r.origin), `${n}@example.com`, "", "/account");
    await r.app.checkAlerts();
    assert.equal(alertsTo(r).length, 1);
    assert.match(alertsTo(r)[0]!.subject, /80% of spots used \(4 of 5\)/);
    assert.doesNotMatch(alertsTo(r)[0]!.text, /@example\.com/);
    // Checked again (the timer): nothing more.
    await r.app.checkAlerts();
    await r.app.checkAlerts();
    assert.equal(alertsTo(r).length, 1);
    const later = (await (await counts(r.origin, TOKEN)).json()) as { accounts: number; connected: number; sources: Record<string, number> };
    assert.deepEqual([later.accounts, later.connected, later.sources], [4, 1, { "(none)": 3, reddit: 1 }]);

    // The fifth: 100%, one more.
    await signInByLink(r, new Browser(r.origin), "five@example.com", "", "/account");
    await r.app.checkAlerts();
    assert.equal(alertsTo(r).length, 2);
    assert.match(alertsTo(r)[1]!.subject, /all 5 spots are taken/);
    // A new total re-arms: 5 of 6 is past 80% again.
    r.app.accounts.setSpots(6);
    await r.app.checkAlerts();
    await r.app.checkAlerts();
    assert.equal(alertsTo(r).length, 3);
    assert.match(alertsTo(r)[2]!.subject, /80% of spots used \(5 of 6\)/);
    // The alerts never counted against the sign-up email cap (EC1): only the five sign-in asks did.
    assert.equal(r.app.accounts.emailCap().thisHour, 5);
  });

  test("no token configured: /ops/counts is a 404, token or not; no alert address: none is sent", async () => {
    const r = await started();
    r.app.accounts.setSpots(1);
    assert.equal((await counts(r.origin)).status, 404);
    assert.equal((await counts(r.origin, TOKEN)).status, 404);
    await signInByLink(r, new Browser(r.origin), "only@example.com", "", "/account");
    await r.app.checkAlerts();
    assert.equal(r.mail.sent.length, 1, "only the sign-in link");
  });

  test("active: a tool call 8 days ago is connected, not active; today's is both", async () => {
    let clock = Date.parse("2026-11-01T12:00:00Z");
    const r = await started({ countsToken: TOKEN, now: () => clock });
    r.app.accounts.setSpots(5);
    const c = await connect(r, { email: "old@example.com", invite: r.app.accounts.createInvite().code });
    await tool(`${r.origin}/mcp`, "status", {}, bearer(c.access));
    clock += 8 * 24 * 60 * 60 * 1000;
    const body = (await (await counts(r.origin, TOKEN)).json()) as { connected: number; active7d: number };
    assert.deepEqual([body.connected, body.active7d], [1, 0]);
    await tool(`${r.origin}/mcp`, "status", {}, bearer(c.access));
    const again = (await (await counts(r.origin, TOKEN)).json()) as { connected: number; active7d: number };
    assert.deepEqual([again.connected, again.active7d], [1, 1]);
  });
});

describe("AL1: the storage alert", () => {
  const make = (used: { v: number }, storageBytes?: number): { alerts: Alerts; mail: ReturnType<typeof memoryMailer>; accounts: Accounts } => {
    const accounts = new Accounts({ path: join(tmp.root, "control", "accounts.sqlite") });
    closers.push(() => accounts.close());
    const mail = memoryMailer();
    const alerts = new Alerts({ to: OPS, accounts, mailer: mail, dataRoot: tmp.root, publicOrigin: "https://app.example", volume: () => ({ total: 1000, used: used.v }), ...(storageBytes === undefined ? {} : { storageBytes }) });
    return { alerts, mail, accounts };
  };

  test("once at 70% of the volume; not again until it drops below 90% of the line", async () => {
    const used = { v: 600 };
    const { alerts, mail } = make(used);
    await alerts.check();
    assert.equal(mail.sent.length, 0);
    used.v = 700;
    await alerts.check();
    await alerts.check();
    assert.equal(mail.sent.length, 1);
    assert.match(mail.sent[0]!.subject, /data volume/);
    assert.match(mail.sent[0]!.text, /Grow the Railway volume/);
    used.v = 650; // still above 630: not re-armed
    await alerts.check();
    used.v = 710;
    await alerts.check();
    assert.equal(mail.sent.length, 1);
    used.v = 600; // below 630: re-armed
    await alerts.check();
    used.v = 720;
    await alerts.check();
    assert.equal(mail.sent.length, 2);
  });

  test("HOSTED_STORAGE_ALERT_BYTES overrides the share; a send that fails is tried again", async () => {
    const used = { v: 550 };
    const { alerts, mail, accounts } = make(used, 500);
    const failing = new Alerts({ to: OPS, accounts, mailer: { send: () => Promise.reject(new Error("down")) }, dataRoot: tmp.root, publicOrigin: "https://app.example", volume: () => ({ total: 1000, used: used.v }), storageBytes: 500 });
    await failing.check();
    assert.equal(accounts.alertState("storage"), null, "a failed send leaves it armed");
    await alerts.check();
    assert.equal(mail.sent.length, 1);
    assert.match(mail.sent[0]!.text, /HOSTED_STORAGE_ALERT_BYTES/);
  });

  test("the real volume reader answers on this machine", async () => {
    const { volumeUsage } = await import("../src/alerts.js");
    const v = volumeUsage(tmp.root);
    assert.ok(v !== null && v.total > 0 && v.used >= 0 && v.used <= v.total);
  });
});

describe("the migration: a database from the build before this one", () => {
  test("opens with every row intact, the new columns NULL, last_seen_on back-filled, and an old link still signing in", () => {
    const path = join(tmp.root, "control", "accounts.sqlite");
    mkdirSync(join(tmp.root, "control"), { recursive: true });
    const old = openDb(path, { wal: true });
    // origin/master's tables at ac0a4d91, columns as its ALTERs left them.
    old.exec(`
CREATE TABLE people (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, deleted_at INTEGER, state TEXT NOT NULL DEFAULT 'active', display_name TEXT, time_zone TEXT, invite_id TEXT, delete_after INTEGER, last_wake_on TEXT, kind TEXT);
CREATE TABLE identities (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), kind TEXT NOT NULL, value TEXT NOT NULL, verified_at INTEGER, created_at INTEGER NOT NULL, UNIQUE (kind, value));
CREATE TABLE stores (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id), created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active', quota_bytes INTEGER, size_bytes INTEGER, size_checked_at INTEGER, opened_at INTEGER, removal_due_at INTEGER, seed TEXT);
CREATE TABLE login_links (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, identity_id TEXT, invite_id TEXT, time_zone TEXT, browser_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, set_at INTEGER NOT NULL);
CREATE TABLE audit (at INTEGER NOT NULL, person_id TEXT, store_id TEXT, action TEXT NOT NULL, detail TEXT);
`);
    const now = Date.now();
    old.run("INSERT INTO people (id, created_at, state, time_zone, last_wake_on) VALUES ('p1', ?, 'active', 'America/Denver', '2026-11-16')", now - 1000);
    old.run("INSERT INTO people (id, created_at, state) VALUES ('p2', ?, 'active')", now - 500);
    old.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES ('i1', 'p1', 'email', 'woke@example.com', ?, ?)", now, now);
    old.run("INSERT INTO identities (id, person_id, kind, value, verified_at, created_at) VALUES ('i2', 'p2', 'email', 'quiet@example.com', ?, ?)", now, now);
    old.run("INSERT INTO stores (id, person_id, created_at, opened_at) VALUES ('s1', 'p1', ?, ?)", now, now);
    old.run("INSERT INTO stores (id, person_id, created_at) VALUES ('s2', 'p2', ?)", now);
    old.run("INSERT INTO settings (key, value, set_at) VALUES ('spots', '500', ?)", now);
    // An unused sign-in link for p1, and an unused sign-up link for a new address, both made before the upgrade.
    old.run("INSERT INTO login_links (id, token_hash, email, identity_id, invite_id, time_zone, browser_hash, created_at, expires_at, used_at) VALUES ('l1', ?, 'woke@example.com', 'i1', NULL, NULL, ?, ?, ?, NULL)", sha256("cpl_old_member_token_0123456789"), sha256("browser-1"), now, now + 10 * 60_000);
    old.run("INSERT INTO login_links (id, token_hash, email, identity_id, invite_id, time_zone, browser_hash, created_at, expires_at, used_at) VALUES ('l2', ?, 'new@example.com', NULL, NULL, 'Europe/Paris', ?, ?, ?, NULL)", sha256("cpl_old_signup_token_0123456789"), sha256("browser-2"), now, now + 10 * 60_000);
    old.close();

    for (let open = 0; open < 2; open++) {
      // Twice: the migration is safe to run again.
      const a = new Accounts({ path });
      try {
        assert.equal(a.person("p1")?.email, "woke@example.com");
        assert.equal(a.person("p1")?.timeZone, "America/Denver");
        assert.equal(a.person("p1")?.storeId, "s1");
        assert.equal(a.person("p2")?.storeId, "s2");
        assert.equal(a.lastWakeOn("p1"), "2026-11-16");
        assert.equal(a.lastSeenOn("p1"), "2026-11-16", "back-filled from the last wake");
        assert.equal(a.lastSeenOn("p2"), null);
        assert.deepEqual(a.attributionOf("p1"), { source: null, referrer: null, landing: null });
        assert.equal(a.spots().total, 500);
        assert.equal(a.counts().connected, 1);
        assert.deepEqual(a.counts().sources, { "(none)": 2 });
      } finally {
        a.close();
      }
    }
    const a = new Accounts({ path });
    try {
      assert.deepEqual(a.useLink({ token: "cpl_old_member_token_0123456789", browser: "browser-1" }), { ok: true, personId: "p1", created: false });
      const made = a.useLink({ token: "cpl_old_signup_token_0123456789", browser: "browser-2" });
      assert.ok(made.ok && made.created);
      if (made.ok) {
        assert.deepEqual(a.attributionOf(made.personId), { source: null, referrer: null, landing: null });
        assert.equal(a.person(made.personId)?.timeZone, "Europe/Paris");
      }
    } finally {
      a.close();
    }
  });
});

describe("the 100 MB quota", () => {
  test("the default is 100 MB, and its refusal says so plainly and what to do", () => {
    assert.equal(STORE_QUOTA_BYTES, 100 * 1024 * 1024);
    const limits = new McpLimits({ sizeOf: () => 101 * 1024 * 1024 });
    const refused = limits.check("p", "s", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: { text: "x" } } });
    assert.equal(refused?.reason, "store-full");
    const result = (refused?.response as unknown as { result: { structuredContent: { message: string; quotaBytes: number } } }).result.structuredContent;
    assert.equal(result.quotaBytes, 100 * 1024 * 1024);
    assert.match(result.message, /^This memory is full: it has reached the hosted beta's size limit of 100 MB, so this was not saved\. Nothing already in it was lost, and recall still works\. To get more room, email support@counterparts\.ai/);
    assert.equal(new McpLimits({ sizeOf: () => 99 * 1024 * 1024 }).check("p", "s", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "remember", arguments: {} } }), null);
  });

  test("a store already over its quota: writes refused through the real write path, every memory kept, reads and deletes work, writes back once raised", async () => {
    const r = await started();
    const c = await connect(r, { email: "full@example.com", invite: r.app.accounts.createInvite().code });
    const url = `${r.origin}/mcp`;
    const session = String((await tool(url, "wake", {}, bearer(c.access)))["session"]);
    const kept = await tool(url, "remember", { session, text: "The lighthouse keeper's name is Ada Lindqvist." }, bearer(c.access));
    const other = await tool(url, "remember", { session, text: "The spare oars are in the boathouse loft." }, bearer(c.access));
    const storeId = r.app.accounts.person(await personOf(r, "full@example.com"))!.storeId!;
    // The quota drops below what the store already holds (as 1 GiB → 100 MB would for a big one).
    r.app.accounts.setQuota(storeId, 1);
    const refused = await rpc(url, "tools/call", { name: "remember", arguments: { session, text: "This one does not fit." } }, bearer(c.access));
    const res = refused.body["result"] as { isError: boolean; structuredContent: { reason: string; message: string } };
    assert.equal(res.isError, true);
    assert.equal(res.structuredContent.reason, "store-full");
    assert.match(res.structuredContent.message, /This memory is full.*Nothing already in it was lost.*email support@counterparts\.ai/);
    // Every memory is still there, and recall finds it.
    const found = await tool(url, "recall", { session, question: "lighthouse keeper Ada", mode: "facts" }, bearer(c.access));
    assert.match(JSON.stringify(found), /Ada Lindqvist/);
    assert.doesNotMatch(JSON.stringify(found), /does not fit/);
    // A delete still works over the quota.
    const del = await rpc(url, "tools/call", { name: "delete_memory", arguments: { session, id: String(other["id"]) } }, bearer(c.access));
    assert.notEqual((del.body["result"] as { structuredContent?: { reason?: string } }).structuredContent?.reason, "store-full");
    // Raised (back to the default): writes come back, and the first memory is untouched.
    r.app.accounts.setQuota(storeId, null);
    const back = await tool(url, "remember", { session, text: "The boathouse key hangs by the door." }, bearer(c.access));
    assert.notEqual(back["reason"], "store-full");
    assert.match(JSON.stringify(await tool(url, "recall", { session, question: "lighthouse keeper Ada", mode: "facts" }, bearer(c.access))), /Ada Lindqvist/);
    assert.ok(kept["id"] !== undefined);
  });
});

describe("the whole path as a process: main.ts serve, MAIL=log", () => {
  test("a tagged sign-up, a tool call, the counts with and without the token, one alert at 80% in the log", async () => {
    const dataRoot = join(tmp.root, "data");
    const env: Record<string, string> = {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: tmp.root,
      COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
      HOSTED_DATA_ROOT: dataRoot,
      MAIL: "log",
      BACKUPS: "off",
      HOSTED_COUNTS_TOKEN: TOKEN,
      HOSTED_ALERT_EMAIL: OPS,
      // Far above any test machine's disk, so only the spots alert can fire here.
      HOSTED_STORAGE_ALERT_BYTES: String(2 ** 52),
    };
    const set = spawnSync(process.execPath, [...scriptArgs(MAIN), "spots", "set", "5"], { env: { ...env, PUBLIC_ORIGIN: "http://127.0.0.1" }, encoding: "utf8", timeout: 30_000 });
    assert.equal(set.status, 0, set.stderr);
    const port = await freePort();
    const origin = `http://127.0.0.1:${String(port)}`;
    const child = spawn(process.execPath, [...scriptArgs(MAIN), "serve"], { env: { ...env, PUBLIC_ORIGIN: origin, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
    closers.push(() => child.kill("SIGTERM"));
    let err = "";
    child.stderr!.on("data", (d: Buffer) => {
      err += d.toString();
    });
    const waitFor = async (re: RegExp, what: string): Promise<void> => {
      for (let i = 0; i < 300 && !re.test(err); i++) await new Promise((res) => setTimeout(res, 100));
      assert.match(err, re, `${what}: ${err.slice(-2000)}`);
    };
    await waitFor(/serving/, "started");
    // The mailer as the log shows it: every email, in order.
    const sent: { to: string; text: string }[] = [];
    const mail = {
      get sent(): { to: string; text: string }[] {
        sent.length = 0;
        for (const m of err.matchAll(/\(MAIL=log\) an email for (\S+), "[^"]*":\n([\s\S]*?)(?=\n\[hosted\]|$)/g)) sent.push({ to: m[1]!.replace(/,$/, ""), text: m[2]! });
        return sent;
      },
    };
    const logRig = { origin, mail };
    const first = new Browser(origin);
    await signUpFrom(logRig, first, "one@example.com", "r=reddit&land=/claude-ai/");
    const c = await connect({ ...(logRig as unknown as Rig) }, { browser: first, signIn: async () => assert.fail("already signed in") });
    await tool(`${origin}/mcp`, "status", {}, bearer(c.access));
    assert.equal((await counts(origin)).status, 401);
    const body = (await (await counts(origin, TOKEN)).json()) as Record<string, unknown>;
    assert.deepEqual({ ...body, at: "" }, { at: "", accounts: 1, connected: 1, active7d: 1, spots: { total: 5, left: 4 }, sources: { reddit: 1 }, referrers: { "(none)": 1 } });
    for (const n of ["two", "three", "four"]) await signUpFrom(logRig, new Browser(origin), `${n}@example.com`, "");
    await waitFor(/alert\.sent which=spots-80/, "the 80% alert");
    const alerts = (): number => err.split(`an email for ${OPS}`).length - 1;
    assert.equal(alerts(), 1);
    assert.match(err, /80% of spots used \(4 of 5\)/);
    // A member signing in again is no new account: nothing more.
    await signUpFrom(logRig, new Browser(origin), "two@example.com", "");
    await new Promise((res) => setTimeout(res, 300));
    // `quota`, beside the running server: one store's limit, and a refusal for an address with no account.
    const quota = (...args: string[]) => spawnSync(process.execPath, [...scriptArgs(MAIN), "quota", ...args], { env: { ...env, PUBLIC_ORIGIN: origin }, encoding: "utf8", timeout: 30_000 });
    const raised = quota("one@example.com", "300");
    assert.equal(raised.status, 0, raised.stderr);
    assert.equal(raised.stdout, "quota: 300 MB\n");
    assert.equal(quota("nobody@example.com", "300").status, 1);
    assert.equal(quota("one@example.com", "lots").status, 1);
    assert.equal(quota("one@example.com", "default").stdout, "quota: the default (100 MB)\n");
    assert.equal(alerts(), 1);
    child.kill("SIGTERM");
  });
});
