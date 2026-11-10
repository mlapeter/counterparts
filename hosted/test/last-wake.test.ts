/**
 * LW1 (Mike, 2026-11-09): the DAY of each person's last wake, kept in the
 * control database (`people.last_wake_on`, `YYYY-MM-DD` in UTC) and nothing
 * else, to tell a quiet account from a live one.
 *
 * Through the real doors: a person signed up and connected as claude.ai does
 * (Allow, the token exchange), then `wake` over the real `/mcp` socket. The
 * day moves on an injected clock. "No write" is read from a second connection
 * to the control database: SQLite's `data_version` moves only when another
 * connection commits.
 *
 * Hermetic: a temp data root per test, removed after it. No network, no
 * bucket (backups off), no live store.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { Accounts, utcDay } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { openDb } from "../../src/core/store/db.js";
import { freePort, rpc, tempRoot, tool } from "./helpers.js";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("last-wake");
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
      if (v === "" || parts.some((p) => /^max-age=0$/i.test(p) || (/^expires=/i.test(p) && Date.parse(p.slice(8)) < Date.now()))) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async form(target: string, fields: Record<string, string>): Promise<Response> {
    return this.go(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  }
}
const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

interface Rig {
  app: App;
  origin: string;
  mail: ReturnType<typeof memoryMailer>;
  clock: { at: number };
  control: string;
}

async function rig(): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  // Noon UTC, so a minute later is never across midnight (a run that starts at 23:59:30 UTC would be).
  const clock = { at: Date.UTC(2026, 10, 9, 12) };
  const dataRoot = join(tmp.root, "data");
  const app = createApp({ dataRoot, publicOrigin: origin, mailer: mail, embedder: null, spawner: () => ({ pid: 1 }), now: () => clock.at });
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
  return { app, origin, mail, clock, control: join(dataRoot, "control", "accounts.sqlite") };
}

/** Sign up through Allow and the token exchange: what claude.ai does. */
async function connect(r: Rig, email: string): Promise<{ access: string; personId: string }> {
  const issuer = new URL(r.origin);
  const as = await oauth.processDiscoveryResponse(issuer, await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...insecure }));
  const reg = await oauth.processDynamicClientRegistrationResponse(
    await oauth.dynamicClientRegistrationRequest(as, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, insecure),
  );
  const client: oauth.Client = { client_id: reg.client_id, token_endpoint_auth_method: "none" };
  const verifier = oauth.generateRandomCodeVerifier();
  const resource = `${r.origin}/mcp`;
  const authz = new URL(as.authorization_endpoint!);
  authz.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", scope: "memory", resource, code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state: "st" }).toString();
  const browser = new Browser(r.origin);
  let res = await browser.go(authz.toString());
  const allowPath = new URL(res.headers.get("location")!, r.origin).pathname;
  res = await browser.go(allowPath);
  if (res.status === 303) {
    const form = await (await browser.go(`/login?next=${encodeURIComponent(allowPath)}`)).text();
    const { code } = r.app.accounts.createInvite();
    await browser.form("/login", { csrf: csrfOf(form), email, invite: code, tz: "America/Denver", next: allowPath });
    await browser.go(/https?:\/\/\S+/.exec(r.mail.sent.at(-1)!.text)![0]);
    res = await browser.go(allowPath);
  }
  res = await browser.form(allowPath, { csrf: csrfOf(await res.text()), decision: "allow" });
  let loc = new URL(res.headers.get("location")!, r.origin);
  for (let i = 0; i < 5 && res.status === 303 && loc.origin !== "https://claude.ai"; i++) {
    res = await browser.go(loc.toString());
    loc = new URL(res.headers.get("location")!, r.origin);
  }
  const params = oauth.validateAuthResponse(as, client, loc, "st");
  const tokens = await oauth.processAuthorizationCodeResponse(as, client, await oauth.authorizationCodeGrantRequest(as, client, oauth.None(), params, CALLBACK, verifier, { additionalParameters: { resource }, ...insecure }));
  const personId = r.app.accounts.sessionPerson(browser.jar.get("cp_session") ?? null)!;
  return { access: tokens.access_token, personId };
}

/**
 * A second connection to the test's own control database, with a trigger that
 * counts every UPDATE touching `last_wake_on` — even one that writes the same
 * value again, which SQLite's `data_version` alone would not show — and the
 * commit counter, which moves only when the server commits a write.
 */
function watcher(path: string): { writes: () => number; version: () => number; row: (personId: string) => Record<string, unknown>; close: () => void } {
  const db = openDb(path, { wal: true });
  db.exec("CREATE TABLE lw_writes (n INTEGER); CREATE TRIGGER lw_count AFTER UPDATE OF last_wake_on ON people BEGIN INSERT INTO lw_writes VALUES (1); END;");
  return {
    writes: () => db.get<{ n: number }>("SELECT count(*) AS n FROM lw_writes")!.n,
    version: () => db.get<{ data_version: number }>("PRAGMA data_version")!.data_version,
    row: (personId) => db.get<Record<string, unknown>>("SELECT * FROM people WHERE id = ?", personId)!,
    close: () => db.close(),
  };
}

describe("LW1: the day of the last wake, through the real /mcp door", () => {
  test("a wake sets today's UTC date; a second wake that day writes nothing; the next day's wake moves it", async () => {
    const r = await rig();
    const who = await connect(r, "wake-day@example.com");
    const url = `${r.origin}/mcp`;
    const auth = bearer(who.access);
    const w = watcher(r.control);
    closers.push(() => w.close());

    // Connected, and a call that isn't a wake: no day yet.
    const listed = await rpc(url, "tools/list", {}, auth);
    assert.equal(listed.status, 200);
    assert.equal(r.app.accounts.lastWakeOn(who.personId), null);

    // The first wake of the day: today's date, UTC, day only.
    await tool(url, "wake", {}, auth);
    const today = utcDay(r.clock.at);
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.app.accounts.lastWakeOn(who.personId), today);
    assert.equal(w.row(who.personId)["last_wake_on"], today);
    assert.equal(w.writes(), 1, "the first wake of the day was written once");

    // A second (and third) wake the same day: no UPDATE runs, nothing is committed.
    const before = w.version();
    r.clock.at += 60 * 1000;
    await tool(url, "wake", {}, auth);
    await tool(url, "wake", {}, auth);
    assert.equal(w.writes(), 1, "a later wake the same day ran an UPDATE");
    assert.equal(w.version(), before, "a later wake the same day committed to the control database");
    assert.equal(r.app.accounts.lastWakeOn(who.personId), today);

    // The next day: one write, the new date.
    r.clock.at += DAY_MS;
    await tool(url, "wake", {}, auth);
    const tomorrow = utcDay(r.clock.at);
    assert.notEqual(tomorrow, today);
    assert.equal(r.app.accounts.lastWakeOn(who.personId), tomorrow);
    assert.equal(w.writes(), 2, "the next day's wake was written once");
    assert.notEqual(w.version(), before);

    // Nothing but the day: no audit row for it (an audit row carries the time).
    assert.ok(!r.app.accounts.auditOf(who.personId).some((a) => /wake/i.test(a.action)));
  });

  test("the day is UTC's: one minute either side of 00:00 UTC are two days", () => {
    const midnight = Date.UTC(2026, 10, 9);
    assert.equal(utcDay(midnight - 60_000), "2026-11-08");
    assert.equal(utcDay(midnight + 60_000), "2026-11-09");
  });

  test("an account's erase clears its day with the rest", () => {
    const clock = { at: Date.UTC(2026, 10, 9, 12) };
    const accounts = new Accounts({ path: join(tmp.root, "control", "accounts.sqlite"), now: () => clock.at });
    try {
      const db = openDb(join(tmp.root, "control", "accounts.sqlite"));
      db.run("INSERT INTO people (id, created_at, state) VALUES (?, ?, 'active')", "p".repeat(32), clock.at);
      db.close();
      assert.equal(accounts.noteWake("p".repeat(32)), true);
      assert.equal(accounts.noteWake("p".repeat(32)), false);
      assert.equal(accounts.lastWakeOn("p".repeat(32)), "2026-11-09");
      accounts.markDeleted("p".repeat(32));
      assert.equal(accounts.lastWakeOn("p".repeat(32)), null);
      // A tombstone takes no new day.
      assert.equal(accounts.noteWake("p".repeat(32)), false);
    } finally {
      accounts.close();
    }
  });

  test("a control database made before the column (the beta volume) gains it, once, and a wake then writes it", () => {
    const path = join(tmp.root, "old", "accounts.sqlite");
    new Accounts({ path }).close();
    const old = openDb(path);
    old.exec("ALTER TABLE people DROP COLUMN last_wake_on");
    assert.equal(old.all<{ name: string }>("PRAGMA table_info(people)").some((c) => c.name === "last_wake_on"), false);
    old.run("INSERT INTO people (id, created_at, state, time_zone) VALUES (?, ?, 'active', 'UTC')", "a".repeat(32), 1);
    old.close();

    const clock = { at: Date.UTC(2026, 10, 9, 23, 59) };
    for (let i = 0; i < 2; i++) new Accounts({ path, now: () => clock.at }).close();
    const reopened = new Accounts({ path, now: () => clock.at });
    try {
      assert.equal(reopened.lastWakeOn("a".repeat(32)), null, "an existing person starts with no day");
      assert.equal(reopened.person("a".repeat(32))?.timeZone, "UTC", "the rest of the row is untouched");
      assert.equal(reopened.noteWake("a".repeat(32)), true);
      assert.equal(reopened.lastWakeOn("a".repeat(32)), "2026-11-09");
    } finally {
      reopened.close();
    }
    const db = openDb(path);
    try {
      const cols = db.all<{ name: string; type: string; notnull: number }>("PRAGMA table_info(people)").filter((c) => c.name === "last_wake_on");
      assert.equal(cols.length, 1);
      assert.equal(cols[0]!.type, "TEXT");
      assert.equal(cols[0]!.notnull, 0);
    } finally {
      db.close();
    }
  });
});
