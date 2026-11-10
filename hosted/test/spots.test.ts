/**
 * SU1 (2026-11-10): sign-up by spots, through the real door. POST /login, the
 * emailed link, the click, the account; a browser is a cookie jar, mail goes to
 * an in-memory mailer, nothing touches the network. Every test makes its own
 * temp root (helpers.ts#tempRoot) and removes it.
 *
 * What each test tells apart:
 *   - the production default (never set): a code-less address is refused, and an invite still works;
 *   - spots left: a code-less address signs up with just its email, and the count drops at the click only;
 *   - the last spot raced: two links asked for while one is left, both clicked: one account;
 *   - full: the POST page is the same for an address with an account and one without (CONTRACT §12);
 *   - an invite at 0 signs up past the cap, and `left` never reads below zero;
 *   - an erased account frees its spot; a pending delete still holds it;
 *   - /spots: exactly `{left, open}`, CORS for counterparts.ai only, cached a few seconds;
 *   - `main.ts spots` / `spots set N` as a process.
 *   - EC1, the hourly email cap while open: emails stop at M for new addresses; the count
 *     survives a restart; nothing changes while closed; a member and a stranger over the cap
 *     see the same words, and both count alike; `spots emails M` sets and shows it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { Accounts } from "../src/accounts.js";
import { memoryMailer } from "../src/egress.js";
import { SPOTS_CACHE_MS, WAITLIST_URL, accountPages } from "../src/pages.js";
import { createHostedServer } from "../src/server.js";
import { Tenants } from "../src/tenants.js";
import { listen, tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("spots");
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
  async form(path: string, fields: Record<string, string>): Promise<Response> {
    return this.go(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
}

const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

interface Rig {
  base: string;
  accounts: Accounts;
  mail: ReturnType<typeof memoryMailer>;
  path: string;
  setNow: (t: number) => void;
  now: () => number;
}

async function rig(start = Date.UTC(2026, 10, 10, 12)): Promise<Rig> {
  let now = start;
  const clock = (): number => now;
  const path = join(tmp.root, "control", "accounts.sqlite");
  const accounts = new Accounts({ path, now: clock });
  closers.push(() => accounts.close());
  const mail = memoryMailer();
  const pages = accountPages({ accounts, mailer: mail, publicOrigin: "http://127.0.0.1", now: clock });
  const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: () => ({ pid: 1 }) });
  closers.push(() => tenants.closeAll());
  const server = createHostedServer({ tenants, publicOrigin: "http://127.0.0.1", authenticate: async () => null, routes: [pages.route] });
  const { base, close } = await listen(server);
  closers.push(close);
  return { base, accounts, mail, path, setNow: (t) => (now = t), now: clock };
}

/** Ask for a link as `browser`; the link path from the email, or null when none was sent. */
async function askLink(r: Rig, browser: Browser, email: string, invite = ""): Promise<{ status: number; body: string; link: string | null }> {
  const form = await (await browser.go("/login")).text();
  const before = r.mail.sent.length;
  const res = await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next: "/account" });
  const body = await res.text();
  const mail = r.mail.sent.length > before ? r.mail.sent.at(-1)! : null;
  const link = mail === null ? null : (/https?:\/\/[^\s]+/.exec(mail.text)?.[0] ?? null);
  return { status: res.status, body, link: link === null ? null : link.replace(/^https?:\/\/[^/]+/, "") };
}

/** Ask, click, and land on the account page: true when an account was made and signed in. */
async function signUp(r: Rig, email: string, invite = ""): Promise<{ browser: Browser; asked: Awaited<ReturnType<typeof askLink>>; click: Response | null; clickBody: string }> {
  const browser = new Browser(r.base);
  const asked = await askLink(r, browser, email, invite);
  if (asked.link === null) return { browser, asked, click: null, clickBody: "" };
  const click = await browser.go(asked.link);
  return { browser, asked, click, clickBody: await click.text() };
}

const people = (r: Rig): number => r.accounts.spots().people;

/** The person this browser's session signs in as, or null. */
const personOf = (r: Rig, browser: Browser): string | null => {
  const name = [...browser.jar.keys()].find((k) => k.includes("session"));
  return name === undefined ? null : r.accounts.sessionPerson(browser.jar.get(name) ?? null);
};

/** The page's visible words, tags dropped (the CSRF token and nonce differ per page, not per address). */
const words = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the production default: spots never set", () => {
  test("a code-less address gets no email and no account; /spots says closed; an invite still signs up", async () => {
    const r = await rig();
    assert.deepEqual(r.accounts.spots(), { total: 0, people: 0, left: 0 });
    const spots = await fetch(`${r.base}/spots`);
    assert.equal(spots.status, 200);
    assert.deepEqual(await spots.json(), { left: 0, open: false });
    const login = await (await new Browser(r.base).go("/login")).text();
    assert.match(login, /Hosted is full for now/);
    assert.ok(login.includes(`href="${WAITLIST_URL}"`));
    assert.match(login, /Have an invite code\?/);
    assert.doesNotMatch(login, /only the first time/);
    // Sign-in leads; the full notice is for newcomers, after the form, and the code field stays folded.
    assert.ok(login.indexOf("<form") < login.indexOf("Hosted is full for now"));
    assert.match(login, /New to Counterparts\? Hosted is full for now/);
    assert.doesNotMatch(login, /<details open/);

    const stranger = await signUp(r, "stranger@example.com");
    assert.equal(stranger.asked.status, 200);
    assert.match(stranger.asked.body, /Check your email/);
    assert.match(stranger.asked.body, /join the waiting list/);
    assert.equal(stranger.asked.link, null, "no email");
    assert.equal(r.mail.sent.length, 0);
    assert.equal(people(r), 0);

    const { code } = r.accounts.createInvite({ note: "katie" });
    const katie = await signUp(r, "katie@example.com", code);
    assert.ok(katie.click !== null);
    assert.equal(katie.click.status, 303);
    assert.equal(katie.click.headers.get("location"), "/account");
    assert.equal(people(r), 1);
    assert.deepEqual(r.accounts.spots(), { total: 0, people: 1, left: 0 }, "an invite past a cap of 0 leaves left at 0, never below");
  });
});

describe("spots left", () => {
  test("a new address signs up with just its email; the spot is taken at the click, not at the ask", async () => {
    const r = await rig();
    r.accounts.setSpots(2);
    assert.deepEqual(r.accounts.spots(), { total: 2, people: 0, left: 2 });
    const login = await (await new Browser(r.base).go("/login")).text();
    assert.doesNotMatch(login, /Hosted is full/);
    assert.match(login, /Your email is all it takes to sign up/);

    const me = new Browser(r.base);
    const asked = await askLink(r, me, "New@Example.com");
    assert.equal(asked.status, 200);
    assert.match(asked.body, /Check your email/);
    assert.ok(asked.link !== null, "a link was emailed");
    assert.equal(r.mail.sent.at(-1)!.to, "new@example.com");
    assert.equal(r.mail.sent.at(-1)!.subject, "Finish signing up for Counterparts");
    // Asked, not clicked: nothing taken.
    assert.equal(r.accounts.spots().left, 2);
    // An unclicked link that expires takes nothing either.
    const idle = await askLink(r, new Browser(r.base), "idle@example.com");
    assert.ok(idle.link !== null);
    assert.equal(r.accounts.spots().left, 2);

    const click = await me.go(asked.link);
    assert.equal(click.status, 303);
    const account = await (await me.go("/account")).text();
    assert.match(account, /Signed in as <strong>new@example\.com<\/strong>/);
    assert.deepEqual(r.accounts.spots(), { total: 2, people: 1, left: 1 });
    assert.equal(r.accounts.auditOf(personOf(r, me)!).find((a) => a.action === "signup")?.detail, "spot");

    // The same address again is a sign-in: no second account, no second spot.
    const again = await signUp(r, "new@example.com");
    assert.equal(again.click?.status, 303);
    assert.equal(r.mail.sent.at(-1)!.subject, "Your Counterparts sign-in link");
    assert.equal(people(r), 1);
  });

  test("a mistyped or used-up code while spots are left falls through to a spot", async () => {
    const r = await rig();
    r.accounts.setSpots(1);
    const typo = await signUp(r, "typo@example.com", "cpi_not-a-real-code");
    assert.equal(typo.click?.status, 303);
    assert.deepEqual(r.accounts.spots(), { total: 1, people: 1, left: 0 });
  });

  test("the last spot, raced: two links asked for while one is left, both clicked at once: one account, and the other is told it's full", async () => {
    const r = await rig();
    r.accounts.setSpots(1);
    const a = new Browser(r.base);
    const b = new Browser(r.base);
    // Ask, ask, then click, click: the interleaving where a check at the ask alone would let both in.
    const askedA = await askLink(r, a, "a@example.com");
    const askedB = await askLink(r, b, "b@example.com");
    assert.ok(askedA.link !== null && askedB.link !== null, "both were sent a link while one spot was left");
    const [clickA, clickB] = await Promise.all([a.go(askedA.link), b.go(askedB.link)]);
    const outcomes = [clickA, clickB].map((c) => c.status).sort();
    assert.deepEqual(outcomes, [200, 303], "one signed in (303), one shown a page (200)");
    const loser = clickA.status === 200 ? clickA : clickB;
    const page = await loser.text();
    assert.match(page, /Hosted is full for now/);
    assert.ok(page.includes(`href="${WAITLIST_URL}"`));
    assert.equal(people(r), 1);
    assert.deepEqual(r.accounts.spots(), { total: 1, people: 1, left: 0 });
  });

  test("the last spot across two connections to one database (the CLI's and the server's): the count and the insert are one transaction", () => {
    const path = join(tmp.root, "control", "accounts.sqlite");
    const one = new Accounts({ path });
    const two = new Accounts({ path });
    closers.push(() => one.close(), () => two.close());
    one.setSpots(1);
    const x = one.requestLink({ email: "x@example.com", browser: "bx" });
    const y = two.requestLink({ email: "y@example.com", browser: "by" });
    assert.ok(x.send && y.send);
    const ux = one.useLink({ token: x.token, browser: "bx" });
    const uy = two.useLink({ token: y.token, browser: "by" });
    assert.equal(ux.ok, true);
    assert.deepEqual(uy, { ok: false, reason: "full" });
    assert.deepEqual(two.spots(), { total: 1, people: 1, left: 0 });
  });
});

describe("full", () => {
  test("the POST page is word for word the same for an address with an account and one without (CONTRACT §12)", async () => {
    const r = await rig();
    r.accounts.setSpots(1);
    assert.equal((await signUp(r, "member@example.com")).click?.status, 303);
    assert.equal(r.accounts.spots().left, 0);
    const known = await askLink(r, new Browser(r.base), "member@example.com");
    const unknown = await askLink(r, new Browser(r.base), "newcomer@example.com");
    assert.ok(known.link !== null, "the member still gets a sign-in link");
    assert.equal(unknown.link, null, "the newcomer gets none");
    assert.equal(known.status, unknown.status);
    assert.equal(words(known.body), words(unknown.body));
    assert.match(unknown.body, /join the waiting list/);
    assert.equal(people(r), 1);
  });

  test("an invite signs up past the cap; lowering N removes nobody", async () => {
    const r = await rig();
    r.accounts.setSpots(1);
    assert.equal((await signUp(r, "first@example.com")).click?.status, 303);
    const { code } = r.accounts.createInvite({ note: "tester" });
    const tester = await signUp(r, "tester@example.com", code);
    assert.equal(tester.click?.status, 303);
    assert.deepEqual(r.accounts.spots(), { total: 1, people: 2, left: 0 });
    r.accounts.setSpots(0);
    assert.deepEqual(r.accounts.spots(), { total: 0, people: 2, left: 0 });
    // Both still sign in.
    assert.equal((await signUp(r, "first@example.com")).click?.status, 303);
    assert.equal((await signUp(r, "tester@example.com")).click?.status, 303);
  });

  test("an erased account frees its spot; a pending delete still holds it", async () => {
    const r = await rig();
    r.accounts.setSpots(1);
    const gone = await signUp(r, "leaving@example.com");
    assert.equal(gone.click?.status, 303);
    const personId = personOf(r, gone.browser);
    assert.ok(personId !== null);
    assert.ok(r.accounts.markPendingDelete(personId) !== null);
    assert.equal(r.accounts.spots().left, 0, "pending: still theirs, they may keep it");
    r.accounts.markDeleted(personId);
    assert.deepEqual(r.accounts.spots(), { total: 1, people: 0, left: 1 });
    assert.equal((await signUp(r, "next@example.com")).click?.status, 303);
    assert.equal(r.accounts.spots().left, 0);
  });
});

describe("GET /spots", () => {
  test("exactly {left, open}; CORS for counterparts.ai only; cached a few seconds", async () => {
    const r = await rig();
    r.accounts.setSpots(3);
    const site = await fetch(`${r.base}/spots`, { headers: { origin: "https://counterparts.ai" } });
    assert.equal(site.status, 200);
    assert.match(site.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(site.headers.get("access-control-allow-origin"), "https://counterparts.ai");
    assert.match(site.headers.get("vary") ?? "", /Origin/);
    assert.match(site.headers.get("cache-control") ?? "", /max-age=5\b/);
    const body = (await site.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["left", "open"]);
    assert.deepEqual(body, { left: 3, open: true });
    for (const other of ["https://evil.example", "https://www.counterparts.ai", "http://counterparts.ai", "null"]) {
      const res = await fetch(`${r.base}/spots`, { headers: { origin: other } });
      assert.equal(res.headers.get("access-control-allow-origin"), null, other);
      await res.text();
    }
    const none = await fetch(`${r.base}/spots`);
    assert.equal(none.headers.get("access-control-allow-origin"), null);
    await none.text();

    // Cached: a change shows after SPOTS_CACHE_MS, not before.
    r.accounts.setSpots(0);
    assert.deepEqual(await (await fetch(`${r.base}/spots`)).json(), { left: 3, open: true });
    r.setNow(r.now() + SPOTS_CACHE_MS);
    assert.deepEqual(await (await fetch(`${r.base}/spots`)).json(), { left: 0, open: false });
  });
});

describe("EC1: the hourly email cap while spots are open", () => {
  // At 12:10, so the hour's bucket is plain; rollovers move the clock an hour.
  const T = Date.UTC(2026, 10, 10, 12, 10);

  test("the default is 100; emails to new addresses stop at M, the page says so to all, and the next hour sends again", async () => {
    const r = await rig(T);
    assert.deepEqual(r.accounts.emailCap(), { perHour: 100, thisHour: 0, reached: false });
    r.accounts.setSpots(50);
    r.accounts.setEmailsPerHour(3);
    for (const who of ["a", "b", "c"]) {
      const asked = await askLink(r, new Browser(r.base), `${who}@example.com`);
      assert.equal(asked.status, 200);
      assert.doesNotMatch(asked.body, /Lots of people are signing up/);
      assert.ok(asked.link !== null, `${who}: emailed under a cap of three`);
    }
    assert.equal(r.mail.sent.length, 3);
    const over = await askLink(r, new Browser(r.base), "d@example.com");
    assert.equal(over.status, 200);
    assert.equal(over.link, null, "the fourth new address gets no email");
    assert.equal(r.mail.sent.length, 3);
    assert.match(over.body, /Check your email/);
    assert.match(over.body, /Lots of people are signing up right now\. New to Counterparts\? Try again in an hour\./);
    assert.deepEqual(r.accounts.emailCap(), { perHour: 3, thisHour: 3, reached: true });
    r.setNow(T + 60 * 60 * 1000);
    assert.equal(r.accounts.emailCap().thisHour, 0, "a new hour, a new count");
    const next = await askLink(r, new Browser(r.base), "e@example.com");
    assert.ok(next.link !== null, "the next hour sends again");
    assert.doesNotMatch(next.body, /Lots of people/);
  });

  test("the count is in control: a restart (new Accounts, new pages, same database) keeps the count and M", async () => {
    const first = await rig(T);
    first.accounts.setSpots(50);
    first.accounts.setEmailsPerHour(2);
    assert.ok((await askLink(first, new Browser(first.base), "one@example.com")).link !== null);
    assert.ok((await askLink(first, new Browser(first.base), "two@example.com")).link !== null);
    // The deploy: everything closed, then a fresh process on the same control database.
    for (const c of closers.splice(0).reverse()) await c();
    const again = await rig(T + 60_000);
    assert.equal(again.path, first.path);
    assert.deepEqual(again.accounts.emailCap(), { perHour: 2, thisHour: 2, reached: true });
    const over = await askLink(again, new Browser(again.base), "three@example.com");
    assert.equal(over.link, null, "the restart didn't reset the count");
    assert.equal(again.mail.sent.length, 0);
    assert.match(over.body, /Lots of people are signing up/);
  });

  test("closed: nothing changes and nothing counts; members and invites still get their emails past M", async () => {
    const r = await rig(T);
    r.accounts.setSpots(1);
    r.accounts.setEmailsPerHour(1);
    assert.equal((await signUp(r, "member@example.com")).click?.status, 303);
    assert.equal(r.accounts.spots().left, 0, "closed now");
    const counted = r.accounts.emailCap().thisHour;
    assert.equal(counted, 1);
    const before = r.mail.sent.length;
    const member = await askLink(r, new Browser(r.base), "member@example.com");
    assert.ok(member.link !== null, "a member signs in");
    const { code } = r.accounts.createInvite({ note: "invited" });
    const invited = await askLink(r, new Browser(r.base), "invited@example.com", code);
    assert.ok(invited.link !== null, "an invite signs up");
    const stranger = await askLink(r, new Browser(r.base), "stranger@example.com");
    assert.equal(stranger.link, null, "a code-less address gets nothing while closed, as before EC1");
    assert.equal(r.mail.sent.length, before + 2);
    assert.equal(r.accounts.emailCap().thisHour, counted, "nothing counted while closed");
    for (const body of [member.body, invited.body, stranger.body]) {
      assert.doesNotMatch(body, /Lots of people/);
      assert.match(body, /join the waiting list/);
    }
  });

  test("over the cap, a member and a stranger see word for word the same page; the member still gets a working link", async () => {
    const r = await rig(T);
    r.accounts.setSpots(50);
    assert.equal((await signUp(r, "member@example.com")).click?.status, 303);
    r.accounts.setEmailsPerHour(1);
    assert.ok(r.accounts.emailCap().reached, "the member's own sign-up took this hour's one");
    const knownBrowser = new Browser(r.base);
    const known = await askLink(r, knownBrowser, "member@example.com");
    const unknown = await askLink(r, new Browser(r.base), "newcomer@example.com");
    assert.ok(known.link !== null, "members are never refused by the cap");
    assert.equal(unknown.link, null, "the newcomer gets none");
    assert.equal(known.status, unknown.status);
    assert.equal(words(known.body), words(unknown.body));
    assert.match(unknown.body, /Lots of people are signing up/);
    assert.equal((await knownBrowser.go(known.link)).status, 303, "the member's link signs them in");
  });

  test("a member's ask and a stranger's count alike, so the next newcomer can't tell which came before", async () => {
    const outcome = async (second: "member" | "stranger"): Promise<string> => {
      const r = await rig(T);
      r.accounts.setSpots(50);
      assert.equal((await signUp(r, "member@example.com")).click?.status, 303);
      r.accounts.setEmailsPerHour(2); // one counted (the member's sign-up), one left
      await askLink(r, new Browser(r.base), second === "member" ? "member@example.com" : "someone@example.com");
      const probe = await askLink(r, new Browser(r.base), "probe@example.com");
      const cap = r.accounts.emailCap();
      for (const c of closers.splice(0).reverse()) await c();
      tmp.remove();
      tmp = tempRoot("spots");
      return `${String(cap.thisHour)} ${probe.link === null ? "none" : "sent"} ${words(probe.body)}`;
    };
    const afterMember = await outcome("member");
    assert.equal(afterMember, await outcome("stranger"));
    assert.match(afterMember, /^2 none /);
  });
});

describe("main.ts spots", () => {
  const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const env = (): Record<string, string> => ({
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: tmp.root,
    COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1",
    HOSTED_DATA_ROOT: join(tmp.root, "data"),
    PUBLIC_ORIGIN: "http://127.0.0.1",
    MAIL: "log",
    BACKUPS: "off",
  });
  const run = (...args: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, [...scriptArgs(MAIN), "spots", ...args], { env: env(), encoding: "utf8", timeout: 30_000 });

  test("shows 0 when never set; `set N` stores it in control; a bad N is refused and changes nothing", () => {
    const shown = run();
    assert.equal(shown.status, 0, String(shown.stderr));
    assert.match(String(shown.stdout), /^spots: 0 \(accounts in all\)\npeople: 0 .*\nleft: 0 \(closed/);
    const set = run("set", "10");
    assert.equal(set.status, 0, String(set.stderr));
    assert.match(String(set.stdout), /^spots: 10 .*\npeople: 0 .*\nleft: 10 \(open/);
    for (const bad of [["set"], ["set", "-1"], ["set", "1.5"], ["set", "ten"], ["set", "100001"], ["10"], ["set", "3", "4"]]) {
      const out = run(...bad);
      assert.equal(out.status, 1, bad.join(" "));
      assert.match(String(out.stderr), /refused: spots takes nothing \(show\), `set N`/);
    }
    const accounts = new Accounts({ path: join(tmp.root, "data", "control", "accounts.sqlite") });
    try {
      assert.deepEqual(accounts.spots(), { total: 10, people: 0, left: 10 });
    } finally {
      accounts.close();
    }
  });

  test("EC1: shows the email cap (100 when never set); `emails M` stores it in control and leaves N alone; a bad M is refused", () => {
    const shown = run();
    assert.equal(shown.status, 0, String(shown.stderr));
    assert.match(String(shown.stdout), /\nemails: 100 an hour while open \(0 this hour\)\n$/);
    assert.equal(run("set", "10").status, 0);
    const set = run("emails", "25");
    assert.equal(set.status, 0, String(set.stderr));
    assert.match(String(set.stdout), /^spots: 10 .*\npeople: 0 .*\nleft: 10 \(open.*\nemails: 25 an hour while open \(0 this hour\)\n$/);
    for (const bad of [["emails"], ["emails", "-1"], ["emails", "2.5"], ["emails", "lots"], ["emails", "100001"], ["emails", "3", "4"], ["email", "3"]]) {
      const out = run(...bad);
      assert.equal(out.status, 1, bad.join(" "));
      assert.match(String(out.stderr), /refused: spots takes nothing \(show\), `set N` .* or `emails M`/);
    }
    const accounts = new Accounts({ path: join(tmp.root, "data", "control", "accounts.sqlite") });
    try {
      assert.deepEqual(accounts.spots(), { total: 10, people: 0, left: 10 });
      assert.equal(accounts.emailCap().perHour, 25);
    } finally {
      accounts.close();
    }
  });
});
