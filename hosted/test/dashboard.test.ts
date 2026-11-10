/**
 * HD2: the local dashboard on hosted, at /dashboard/, for the signed-in owner,
 * read-only. Through the real doors: a person signs up by email link in a
 * browser (a cookie jar), their store is lived in through the tenant's own
 * queue, and every check is an HTTP request to the composed server.
 *
 * What has to hold:
 *   - no session: the page goes to sign-in, `/api` and the files are a 401;
 *   - the owner gets the page, its files and the shipped views, from their store;
 *   - another account's session never reaches the first's store, whatever the URL says;
 *   - the views the first release hides answer "not on hosted yet", and nothing acts;
 *   - a pending delete opens nothing; a store never connected isn't created by a look;
 *   - a look isn't a wake: `last_wake_on`, the worker and the event log stay as they were;
 *   - the page runs under a CSP with no inline script and no inline handler.
 *
 * Hermetic: a temp data root per test, removed after it. No network, no
 * bucket (backups off), no live store.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { DASHBOARD_CSP } from "../src/dashboard.js";
import { memoryMailer } from "../src/egress.js";
import { tenantDir } from "../src/tenants.js";
import { safeNext } from "../src/web.js";
import { HOSTED_VIEWS } from "../../src/adapters/dashboard/web/respond.js";
import { DATABASE_FILE } from "../../src/core/store/paths.js";
import { freePort, tempRoot } from "./helpers.js";

const WEB = fileURLToPath(new URL("../../src/adapters/dashboard/web/", import.meta.url));

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("dashboard");
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

class Browser {
  readonly jar = new Map<string, string>();
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  cookie(name: string): string | null {
    return this.jar.get(name) ?? null;
  }
  async go(target: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(target, this.base);
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const raw of res.headers.getSetCookie()) {
      const parts = raw.split(";").map((p) => p.trim());
      const i = parts[0]!.indexOf("=");
      const k = parts[0]!.slice(0, i);
      const v = parts[0]!.slice(i + 1);
      if (v === "" || parts.some((p) => /^max-age=0$/i.test(p))) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async form(target: string, fields: Record<string, string>): Promise<Response> {
    return this.go(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
  async json(target: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await this.go(target);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
  spawns: { n: number };
}

async function rig(): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const spawns = { n: 0 };
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => {
      spawns.n += 1;
      return { pid: 1 };
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
  return { app, origin, mail, spawns };
}

async function signIn(r: Rig, browser: Browser, email: string, invite: string, next = "/account"): Promise<Response> {
  const form = await (await browser.go(`/login?next=${encodeURIComponent(next)}`)).text();
  await browser.form("/login", { csrf: csrfOf(form), email, invite, tz: "America/Denver", next });
  return browser.go(/https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0]);
}

async function signUp(r: Rig, email: string): Promise<{ browser: Browser; personId: string; storeId: string }> {
  const { code } = r.app.accounts.createInvite();
  const browser = new Browser(r.origin);
  assert.equal((await signIn(r, browser, email, code)).status, 303);
  const personId = r.app.accounts.sessionPerson(browser.cookie("cp_session"))!;
  return { browser, personId, storeId: r.app.accounts.person(personId)!.storeId! };
}

/** The store lived in, as a first chat would open it (the tenant's own queue), with one memory of ours. */
async function live(r: Rig, storeId: string, body: string): Promise<string> {
  return r.app.tenants.withTenant(storeId, { timeZone: "America/Denver" }, (t, server) =>
    t.serial(async () => {
      const store = server.counterpart.store;
      const day = store.livedDay();
      return store.put({
        type: "memory",
        kind: "fact",
        body,
        salience: { relevance: 0.6, emotional: 0.3, predictive: 0.6 },
        physics: { birthDay: day, lastUsedDay: day },
      });
    }),
  );
}

describe("HD2: the dashboard on hosted, through the real door", () => {
  test("no session: the page goes to sign-in (and back after), every file and view is a 401", async () => {
    const r = await rig();
    const stranger = new Browser(r.origin);
    const bare = await stranger.go("/dashboard");
    assert.equal(bare.status, 303);
    assert.equal(bare.headers.get("location"), "/dashboard/");
    const page = await stranger.go("/dashboard/");
    assert.equal(page.status, 303);
    assert.equal(page.headers.get("location"), "/login?next=%2Fdashboard%2F");
    // The sign-in page keeps that `next`, so the person lands on the dashboard.
    assert.equal(safeNext("/dashboard/"), "/dashboard/");
    assert.equal(safeNext("/dashboard/api/meta"), "/account");
    for (const path of ["/dashboard/api/meta", "/dashboard/api/memories/list", "/dashboard/app.js", "/dashboard/shared/tokens.css", "/dashboard/api/health"]) {
      const res = await stranger.go(path);
      assert.equal(res.status, 401, path);
    }
    // And the account page links to it.
    const me = await signUp(r, "linked@example.com");
    assert.match(await (await me.browser.go("/account")).text(), /href="\/dashboard\/"/);
  });

  test("the owner: the page under a strict CSP, its files, and their own store's views", async () => {
    const r = await rig();
    const me = await signUp(r, "owner@example.com");
    const id = await live(r, me.storeId, "The kingfisher came back to the willow by the weir.");

    const page = await me.browser.go("/dashboard/");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-security-policy"), DASHBOARD_CSP);
    const directives = DASHBOARD_CSP.split("; ");
    assert.ok(directives.includes("script-src 'self'"), "scripts from this origin only");
    assert.ok(directives.includes("default-src 'none'"));
    // The one inline allowance is style ATTRIBUTES; nothing inline for script or <style>.
    assert.deepEqual(directives.filter((d) => d.includes("unsafe")), ["style-src-attr 'unsafe-inline'"]);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const html = await page.text();
    assert.match(html, /<meta name="counterparts-host" content="hosted">/);
    // The brain (the one large file) is off on hosted for now.
    assert.match(html, /<meta name="counterparts-brain" content="off">/);
    // No action token on hosted: the page can't act.
    assert.match(html, /<meta name="counterparts-action-token" content="">/);
    // Every reference is under the base, and every script is a file (none inline).
    assert.match(html, /<script type="module" src="\/dashboard\/app\.js"><\/script>/);
    assert.doesNotMatch(html, /(href|src)="\/(?!dashboard\/)/);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1]!, /\bsrc="/);
    assert.doesNotMatch(html, /\son[a-z]+=/i);

    const js = await me.browser.go("/dashboard/app.js");
    assert.equal(js.status, 200);
    assert.match(String(js.headers.get("content-type")), /^text\/javascript/);
    const css = await (await me.browser.go("/dashboard/shared/tokens.css")).text();
    assert.match(css, /url\("\/dashboard\/shared\/fonts\//);
    const font = await me.browser.go("/dashboard/shared/fonts/outfit-latin-wght.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal((await me.browser.go("/dashboard/shared/../../server.ts")).status, 404);
    assert.equal((await me.browser.go("/dashboard/server.ts")).status, 404);

    const meta = await me.browser.json("/dashboard/api/meta");
    assert.equal(meta.status, 200);
    assert.equal(meta.body["observer"], true);
    // The store's folder is a server path: not sent.
    assert.equal("dir" in meta.body, false);
    assert.ok(Number(meta.body["rows"]) > 0);
    const overview = await me.browser.json("/dashboard/api/overview");
    assert.equal(overview.status, 200);
    assert.match(String((overview.body["hero"] as { headline: string }).headline), /\d+ memor/);
    const list = await (await me.browser.go("/dashboard/api/memories/list?limit=200")).text();
    assert.match(list, /kingfisher came back/);
    const card = await me.browser.json(`/dashboard/api/memory?id=${encodeURIComponent(id)}`);
    assert.equal(card.status, 200);
    assert.equal(card.body["found"], true);
    assert.match(String(card.body["text"]), /kingfisher/);
    assert.match(await (await me.browser.go("/dashboard/api/search?q=kingfisher")).text(), /kingfisher/);
    assert.equal((await me.browser.go("/dashboard/api/mind")).status, 200);
    assert.equal((await me.browser.go("/dashboard/api/memories")).status, 200);
    assert.equal((await me.browser.go("/dashboard/api/activity?limit=5&sinceSeq=0")).status, 200);
    // Every view the shipped tabs fetch answers (the list the server keeps).
    for (const view of HOSTED_VIEWS) {
      const q = view === "/api/memory" ? `?id=${encodeURIComponent(id)}` : "";
      assert.equal((await me.browser.go(`/dashboard${view}${q}`)).status, 200, view);
    }
  });

  test("a second account never reaches the first's store, whatever the URL names", async () => {
    const r = await rig();
    const a = await signUp(r, "first@example.com");
    const b = await signUp(r, "second@example.com");
    const aId = await live(r, a.storeId, "The heron's secret nest is past the third alder.");
    await live(r, b.storeId, "Second's own memory: the bakery opens at six.");

    const bList = await (await b.browser.go("/dashboard/api/memories/list?limit=200")).text();
    assert.match(bList, /bakery opens at six/);
    assert.doesNotMatch(bList, /heron/);
    // A's memory id, under B's session: not found in B's store.
    const card = await b.browser.json(`/dashboard/api/memory?id=${encodeURIComponent(aId)}`);
    assert.equal(card.status, 200);
    assert.equal(card.body["found"], false);
    assert.doesNotMatch(JSON.stringify(card.body), /heron/);
    // A's store id in the query, under every name a store could be asked by: ignored.
    for (const name of ["store", "storeId", "dir", "tenant", "person"]) {
      const res = await (await b.browser.go(`/dashboard/api/memories/list?limit=200&${name}=${a.storeId}`)).text();
      assert.doesNotMatch(res, /heron/, name);
      assert.match(res, /bakery/, name);
      // (The search says back what was asked; what it found is B's alone.)
      const found = await b.browser.json(`/dashboard/api/search?q=heron&${name}=${a.storeId}`);
      assert.equal(found.body["total"], 0, name);
      assert.doesNotMatch(JSON.stringify(found.body["hits"]), /heron/, name);
    }
    // And in the path: not a route.
    for (const path of [`/dashboard/${a.storeId}/api/memories/list`, `/dashboard/api/memories/list/${a.storeId}`, `/dashboard/tenants/${a.storeId}/store/${DATABASE_FILE}`]) {
      const res = await b.browser.go(path);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(await res.text(), /heron/);
    }
    // A still reads A's.
    assert.match(await (await a.browser.go("/dashboard/api/search?q=heron")).text(), /heron/);
  });

  test("what the first release hides says so, and nothing acts: no POST, no action route", async () => {
    const r = await rig();
    const me = await signUp(r, "looks@example.com");
    await live(r, me.storeId, "A memory to count.");
    const rows = Number((await me.browser.json("/dashboard/api/meta")).body["rows"]);
    for (const view of ["/api/health", "/api/flow", "/api/node?key=store", "/api/fired", "/api/mechanisms", "/api/mechanism?id=decay", "/api/subjects", "/api/subject?id=me", "/api/tag?tag=x", "/api/event?seq=1", "/api/dreams", "/api/pulse", "/api/whoami", "/api/onboarding", "/api/action/note", "/api/action/remove"]) {
      const res = await me.browser.json(`/dashboard${view}`);
      assert.equal(res.status, 404, view);
      assert.equal(res.body["error"], "not on hosted yet", view);
    }
    for (const [path, body] of [
      ["/dashboard/api/action/note", { text: "written by a page" }],
      ["/dashboard/api/action/remove", { id: "x", confirm: "x" }],
      ["/dashboard/api/action/backup", {}],
      ["/dashboard/api/meta", {}],
      ["/dashboard/", {}],
    ] as const) {
      const res = await me.browser.go(path, { method: "POST", headers: { "content-type": "application/json", origin: r.origin }, body: JSON.stringify(body) });
      assert.equal(res.status, 405, path);
    }
    for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal((await me.browser.go("/dashboard/api/meta", { method })).status, 405, method);
    assert.equal(Number((await me.browser.json("/dashboard/api/meta")).body["rows"]), rows, "nothing was written");
  });

  test("a look is not a wake: no last_wake_on, no worker, no event, no write", async () => {
    const r = await rig();
    const me = await signUp(r, "quiet@example.com");
    await live(r, me.storeId, "A quiet memory.");
    const spawnsBefore = r.spawns.n;
    const before = await me.browser.json("/dashboard/api/activity?limit=1");
    const metaBefore = (await me.browser.json("/dashboard/api/meta")).body;
    // COLD: the tenant closed (idle), so the next look is the one that opens it, as it is in production.
    await r.app.tenants.close(me.storeId);
    assert.equal(r.app.tenants.isOpen(me.storeId), false);
    for (let i = 0; i < 3; i++) {
      if (i === 1) await r.app.tenants.close(me.storeId);
      await me.browser.go("/dashboard/");
      for (const view of ["/api/meta", "/api/overview", "/api/memories", "/api/memories/list", "/api/mind", "/api/search?q=quiet", "/api/activity?limit=40&sinceSeq=0"]) {
        assert.equal((await me.browser.go(`/dashboard${view}`)).status, 200, view);
      }
    }
    assert.equal(r.app.accounts.lastWakeOn(me.personId), null, "a look moved last_wake_on");
    assert.equal(r.spawns.n, spawnsBefore, "a look started the worker");
    const after = await me.browser.json("/dashboard/api/activity?limit=1");
    assert.equal(after.body["lastSeq"], before.body["lastSeq"], "a look wrote an event");
    const metaAfter = (await me.browser.json("/dashboard/api/meta")).body;
    assert.equal(metaAfter["rows"], metaBefore["rows"]);
    assert.equal(metaAfter["lastActive"], metaBefore["lastActive"], "a look moved the store's last-active day");
  });

  test("a pending delete opens nothing: the page goes to the pending page, the views refuse", async () => {
    const r = await rig();
    const me = await signUp(r, "leaving@example.com");
    await live(r, me.storeId, "A memory that is locked now.");
    const page = await (await me.browser.go("/account")).text();
    assert.equal((await me.browser.form("/account/delete", { csrf: csrfOf(page), when: "later", confirm: "leaving@example.com" })).status, 200);
    assert.equal(r.app.accounts.person(me.personId)!.state, "pending-delete");
    // Signed back in, the session is a pending one.
    assert.equal((await signIn(r, me.browser, "leaving@example.com", "")).headers.get("location"), "/account");
    await r.app.tenants.close(me.storeId);
    const dash = await me.browser.go("/dashboard/");
    assert.equal(dash.status, 303);
    assert.equal(dash.headers.get("location"), "/account");
    assert.match(await (await me.browser.go("/account")).text(), /Your account is set to be deleted/);
    for (const view of ["/api/meta", "/api/memories/list", "/api/memory?id=x", "/api/search?q=locked"]) {
      const res = await me.browser.go(`/dashboard${view}`);
      assert.equal(res.status, 403, view);
      assert.doesNotMatch(await res.text(), /locked now/);
    }
    assert.equal(r.app.tenants.isOpen(me.storeId), false, "a look opened a locked store");
  });

  test("a store never connected isn't created by a look", async () => {
    const r = await rig();
    const me = await signUp(r, "new@example.com");
    const dir = join(tenantDir(r.app.tenants.root, me.storeId), "store");
    assert.equal((await me.browser.go("/dashboard/")).status, 200);
    const meta = await me.browser.json("/dashboard/api/meta");
    assert.equal(meta.status, 409);
    assert.match(String(meta.body["error"]), /empty so far/);
    assert.equal(existsSync(join(dir, DATABASE_FILE)), false, "a look created the store");
    assert.equal(r.app.tenants.isOpen(me.storeId), false);
  });
});

describe("HD2: the shared page has no inline handler anywhere", () => {
  test("no on*= attribute in any module or the shell, so hosted's CSP never needs unsafe-inline for script", () => {
    const walk = (at: string, out: string[] = []): string[] => {
      for (const e of readdirSync(at, { withFileTypes: true })) {
        const full = join(at, e.name);
        if (e.isDirectory()) {
          if (e.name !== "vendor") walk(full, out);
        } else if (/\.(js|html)$/.test(e.name)) out.push(full);
      }
      return out;
    };
    const offenders = walk(WEB).filter((f) => /\son(click|keydown|keyup|change|input|submit|load|error|mouse\w+|focus|blur)\s*=\s*["'\\]/i.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => relative(WEB, f)), []);
  });
});
