/**
 * DIR1 (2026-11-10): the hosted connector, as the directory's reviewers and its clients meet it.
 * Through the real hosted door (`createApp` on a free port, real OAuth, real `/mcp`):
 *
 *   - Claude Code signs in with its own Client ID Metadata Document: `localhost` and `127.0.0.1` on any
 *     port come back (RFC 8252 §7.3), through the token and a `tools/list`; another path, another host
 *     or an https look-alike still needs an exact match.
 *   - The reviewer's test account: made past closed spots, never over a real person's address; its code
 *     beside its email signs in with no email, a wrong one looks like any ask; expired and revoked codes
 *     sign nobody in; its store fills with the sample at the first connection, once, through the tools;
 *     the operator's `reviewer` command prints the code once and refuses an address with an account.
 *   - Every tool once, through the door, on that account (portal step 8's record: `DIR1_RECORD=<file>`).
 *
 * Hermetic: a temp data root per test, removed after; an in-memory mailer; a CIMD fetch serving fixture
 * documents (Claude Code's is its real one, copied); a stub spawner. No network, no live store.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { scriptArgs } from "../../src/adapters/runtime.js";
import { openDb } from "../../src/core/store/db.js";
import { MAIN, rpc, tempRoot } from "./helpers.js";
import { Browser, CLAUDE_CODE_CIMD, CLAUDE_CODE_CIMD_URL, bearer, connect, csrfOf, insecure, rig } from "./oauth-rig.js";
import type { Rig } from "./oauth-rig.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("dir1");
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

async function open(): Promise<Rig> {
  const r = await rig(tmp.root);
  closers.push(() => r.close());
  return r;
}

/** A rig on a clock the test moves (the accounts' and the pages' `now`). */
async function rigAt(now: () => number): Promise<Rig> {
  const r = await rig(tmp.root, { now });
  closers.push(() => r.close());
  return r;
}

/** Where `/oauth/authorize` sends a client with this redirect: the Allow page (accepted), or an error. */
async function authorizeAnswer(r: Rig, clientId: string, redirectUri: string): Promise<{ status: number; location: string | null; body: string }> {
  const as = await oauth.processDiscoveryResponse(new URL(r.origin), await oauth.discoveryRequest(new URL(r.origin), { algorithm: "oauth2", ...insecure }));
  const u = new URL(as.authorization_endpoint!);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "memory",
    resource: `${r.origin}/mcp`,
    code_challenge: await oauth.calculatePKCECodeChallenge(oauth.generateRandomCodeVerifier()),
    code_challenge_method: "S256",
    state: "s",
  }).toString();
  const res = await fetch(u, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

describe("Claude Code signs in to hosted with its own CIMD document (item 5)", () => {
  for (const host of ["localhost", "127.0.0.1"]) {
    test(`a loopback return on an arbitrary port (${host}:3118) goes through the Allow page, the token and tools/list`, async () => {
      const r = await open();
      r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
      const { code } = r.app.accounts.createInvite();
      const c = await connect(r, { clientId: CLAUDE_CODE_CIMD_URL, redirectUri: `http://${host}:3118/callback`, email: `cc-${host}@example.com`, invite: code });
      const list = await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access));
      assert.equal(list.status, 200);
      const names = ((list.body["result"] as { tools: { name: string }[] }).tools).map((t) => t.name);
      assert.ok(names.includes("wake") && names.includes("delete_memory"), names.join(","));
    });
  }

  test("any other port is accepted too (localhost:61999): the authorization goes on to the Allow page", async () => {
    const r = await open();
    r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
    const answer = await authorizeAnswer(r, CLAUDE_CODE_CIMD_URL, "http://localhost:61999/callback");
    assert.equal(answer.status, 303, answer.body);
    assert.match(String(answer.location), /\/oauth\/allow\//);
  });

  test("still refused: another path, a look-alike host, a non-loopback http host, and https that isn't listed", async () => {
    const r = await open();
    r.cimd.set(CLAUDE_CODE_CIMD_URL, CLAUDE_CODE_CIMD);
    for (const bad of ["http://localhost:3118/other", "http://localhost.evil.example:3118/callback", "http://192.168.1.5:3118/callback", "https://localhost/callback", "http://127.0.0.2:3118/callback"]) {
      const answer = await authorizeAnswer(r, CLAUDE_CODE_CIMD_URL, bad);
      assert.notEqual(answer.status, 303, `${bad} was accepted`);
      assert.match(answer.body, /redirect_uri/i, bad);
    }
  });

  test("an https client still needs its exact redirect: claude.ai's callback with a port or path changed is refused", async () => {
    const r = await open();
    const id = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    r.cimd.set(id, { client_id: id, redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    assert.equal((await authorizeAnswer(r, id, "https://claude.ai/api/mcp/auth_callback")).status, 303);
    for (const bad of ["https://claude.ai:8443/api/mcp/auth_callback", "https://claude.ai/api/mcp/other"]) {
      assert.notEqual((await authorizeAnswer(r, id, bad)).status, 303, bad);
    }
  });
});

/** Sign `browser` in with a reviewer's code, typed beside the account's email in /login's code field. */
const withCode =
  (email: string, code: string) =>
  async (browser: Browser, next: string): Promise<Response> => {
    const form = await (await browser.go(`/login?next=${encodeURIComponent(next)}`)).text();
    return browser.form("/login", { csrf: csrfOf(form), email, invite: code, tz: "UTC", next });
  };

/** A tool call through the door, its structured result and whether it was an error. */
async function callTool(r: Rig, access: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; out: Record<string, unknown>; text: string }> {
  const a = await rpc(`${r.origin}/mcp`, "tools/call", { name, arguments: args }, bearer(access));
  assert.equal(a.status, 200, `${name}: HTTP ${String(a.status)}`);
  const result = a.body["result"] as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> } | undefined;
  assert.ok(result !== undefined, `${name}: ${JSON.stringify(a.body).slice(0, 300)}`);
  return { isError: result.isError === true, out: result.structuredContent, text: result.content.map((c) => c.text).join("\n") };
}

describe("the reviewer's test account (item 7)", () => {
  test("`reviewer` makes a new account past closed spots; its code beside its email signs in with no email, through OAuth to /mcp", async () => {
    const r = await open();
    assert.equal(r.app.accounts.spots().left, 0, "spots closed");
    const made = r.app.accounts.createReviewer({ email: "Reviewer@Example.com", days: 90 });
    assert.ok(!("refusal" in made));
    assert.match(made.code, /^cpr_/);
    const before = r.mail.sent.length;
    const c = await connect(r, { signIn: withCode("reviewer@example.com", made.code) });
    assert.equal(r.mail.sent.length, before, "no email was sent");
    assert.equal((await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access))).status, 200);
    // The code is stored as its hash only.
    const control = openDb(join(tmp.root, "data", "control", "accounts.sqlite"));
    try {
      assert.equal(control.all("SELECT 1 FROM reviewer_codes WHERE code_hash = ?", made.code).length, 0);
      assert.equal(control.all<{ action: string }>("SELECT action FROM audit WHERE action = 'login.reviewer-code'").length, 1);
    } finally {
      control.close();
    }
  });

  test("never a real person's account: refused for an email that has one; a code never signs in another address", async () => {
    const r = await open();
    const { code: invite } = r.app.accounts.createInvite();
    await connect(r, { email: "member@example.com", invite });
    const refused = r.app.accounts.createReviewer({ email: "member@example.com", days: 30 });
    assert.ok("refusal" in refused && /already has an account/.test(refused.refusal));
    const made = r.app.accounts.createReviewer({ email: "reviewer@example.com", days: 30 });
    assert.ok(!("refusal" in made));
    // The reviewer's code beside the member's email: no sign-in, just the ordinary ask (a link to the member).
    assert.equal(r.app.accounts.reviewerSignIn("member@example.com", made.code), null);
    assert.equal(r.app.accounts.reviewerSignIn("reviewer@example.com", `${made.code}x`), null);
    assert.equal(r.app.accounts.reviewerSignIn("reviewer@example.com", ""), null);
    for (const bad of [0, 366, 1.5]) assert.ok("refusal" in r.app.accounts.createReviewer({ email: `r${String(bad)}@example.com`, days: bad }));
  });

  test("a wrong code looks like an ordinary ask: the same page, and it goes on as an invite code would", async () => {
    const r = await open();
    const made = r.app.accounts.createReviewer({ email: "reviewer@example.com", days: 30 });
    assert.ok(!("refusal" in made));
    const page = async (email: string, invite: string): Promise<{ status: number; body: string; cookie: boolean }> => {
      const b = new Browser(r.origin);
      const form = await (await b.go("/login")).text();
      const res = await b.form("/login", { csrf: csrfOf(form), email, invite, tz: "UTC", next: "/account" });
      return { status: res.status, body: (await res.text()).replace(/name="csrf" value="[^"]+"/g, "").replace(/nonce="[^"]+"/g, ""), cookie: res.headers.getSetCookie().some((c) => c.includes("session")) };
    };
    const wrong = await page("reviewer@example.com", "cpr_not-the-code");
    const none = await page("reviewer@example.com", "");
    const stranger = await page("stranger@example.com", "cpr_not-the-code");
    assert.equal(wrong.status, 200);
    assert.equal(wrong.body, none.body);
    assert.equal(wrong.body, stranger.body);
    assert.equal(wrong.cookie, false);
    // The right code: a redirect with a session, and nothing mailed for it.
    const sent = r.mail.sent.length;
    const right = await page("reviewer@example.com", made.code);
    assert.equal(right.status, 303);
    assert.equal(right.cookie, true);
    assert.equal(r.mail.sent.length, sent);
  });

  test("expired or revoked, a code signs nobody in; revoke ends the account's web sessions", async () => {
    let clock = Date.now();
    const r = await rigAt(() => clock);
    const made = r.app.accounts.createReviewer({ email: "reviewer@example.com", days: 1 });
    assert.ok(!("refusal" in made));
    assert.notEqual(r.app.accounts.reviewerSignIn("reviewer@example.com", made.code), null);
    clock += 25 * 60 * 60 * 1000;
    assert.equal(r.app.accounts.reviewerSignIn("reviewer@example.com", made.code), null, "expired");
    const again = r.app.accounts.createReviewer({ email: "reviewer2@example.com", days: 30 });
    assert.ok(!("refusal" in again));
    const personId = r.app.accounts.reviewerSignIn("reviewer2@example.com", again.code)!;
    const session = r.app.accounts.startSession(personId);
    assert.equal(r.app.accounts.sessionPerson(session), personId);
    assert.equal(r.app.accounts.revokeReviewer("reviewer2@example.com"), 1);
    assert.equal(r.app.accounts.reviewerSignIn("reviewer2@example.com", again.code), null, "revoked");
    assert.equal(r.app.accounts.sessionPerson(session), null, "its sessions ended");
  });

  test("the sample: seeded at the first connection, through the tools, before any call; a wake, recall, the self page and the night all show it; seeded once", async () => {
    const r = await open();
    const made = r.app.accounts.createReviewer({ email: "reviewer@example.com", days: 30 });
    assert.ok(!("refusal" in made));
    assert.equal(r.app.accounts.seedOf(made.storeId), "sample");
    const c = await connect(r, { signIn: withCode("reviewer@example.com", made.code) });
    const woke = await callTool(r, c.access, "wake", {});
    assert.equal(woke.isError, false);
    const session = String(woke.out["session"]);
    assert.match(woke.text, /Sam/);
    assert.match(woke.text, /While I slept I tied Ana's visit to the cabin question/, "the morning share reaches the first wake");
    assert.equal(r.app.accounts.seedOf(made.storeId), null, "cleared once it ran");
    const budget = await callTool(r, c.access, "recall", { session, question: "what did we decide about the kitchen budget?", mode: "facts" });
    assert.match(budget.text, /18,000/);
    const page = await callTool(r, c.access, "self_page", { session });
    assert.match(page.text, /sample account for reviewing Counterparts/);
    const night = await callTool(r, c.access, "recall", { session, handle: "last dream" });
    assert.match(night.text, /A cabin on the kitchen table/);
    const status = await callTool(r, c.access, "status", { session });
    assert.ok(Number(status.out["live"]) >= 12, JSON.stringify(status.out));
    // Closed and opened again: the seed never runs twice.
    await r.app.tenants.closeAll();
    const after = await callTool(r, c.access, "status", { session });
    assert.equal(after.out["live"], status.out["live"]);
    const control = openDb(join(tmp.root, "data", "control", "accounts.sqlite"));
    try {
      assert.deepEqual(control.all<{ action: string }>("SELECT action FROM audit WHERE action LIKE 'sample.%'").map((x) => x.action), ["sample.seeded"]);
    } finally {
      control.close();
    }
  });

  test("an ordinary sign-up's store is not seeded", async () => {
    const r = await open();
    const { code } = r.app.accounts.createInvite();
    const c = await connect(r, { email: "plain@example.com", invite: code });
    const woke = await callTool(r, c.access, "wake", {});
    assert.doesNotMatch(woke.text, /Sam/);
    const status = await callTool(r, c.access, "status", { session: String(woke.out["session"]) });
    assert.ok(Number(status.out["live"]) < 12, JSON.stringify(status.out));
  });
});

describe("the operator's `reviewer` command (item 7)", () => {
  test("prints the code once and says how to sign in; refuses an address that has an account, and no address; `revoke` ends it", () => {
    const env = { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: tmp.root, COUNTERPARTS_REQUIRE_EXPLICIT_DIR: "1", HOSTED_DATA_ROOT: join(tmp.root, "data"), PUBLIC_ORIGIN: "http://127.0.0.1", MAIL: "log", BACKUPS: "off" };
    const run = (...args: string[]) => spawnSync(process.execPath, [...scriptArgs(MAIN), "reviewer", ...args], { env, encoding: "utf8", timeout: 30_000 });
    const made = run("reviewer@example.com", "--days", "30");
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout.trim(), /^cpr_[A-Za-z0-9_-]{43}$/);
    assert.match(made.stderr, /sign in at \/login with that email and this code/);
    assert.match(made.stderr, /expires \d{4}-\d{2}-\d{2}T/);
    const twice = run("reviewer@example.com");
    assert.equal(twice.status, 1);
    assert.match(twice.stderr, /already has an account/);
    assert.doesNotMatch(twice.stdout, /cpr_/);
    for (const bad of [[], ["--days", "30"], ["r2@example.com", "--days", "400"]]) {
      const refused = run(...bad);
      assert.equal(refused.status, 1, bad.join(" "));
      assert.doesNotMatch(refused.stdout, /cpr_/);
    }
    const revoked = run("revoke", "reviewer@example.com");
    assert.equal(revoked.status, 0, revoked.stderr);
    assert.equal(revoked.stdout.trim(), "1 reviewer code revoked");
    const db = openDb(join(tmp.root, "data", "control", "accounts.sqlite"));
    try {
      assert.equal(db.all("SELECT 1 FROM reviewer_codes").length, 0);
      assert.equal(db.all<{ seed: string | null }>("SELECT seed FROM stores")[0]?.seed, "sample");
    } finally {
      db.close();
    }
  });
});

/**
 * THE RECORD (item 8; portal step 8: "you've run every tool yourself"). Every tool `tools/list` names, once,
 * through the real hosted door on the reviewer's sample account, plus scope off and on, and a delete and
 * its undo. Each call must answer without an error. `DIR1_RECORD=<file>` writes the record (Markdown) there;
 * the PR carries it. This is the local, hermetic run; the live run is a RUNBOOK step on Mike's word.
 */
describe("every tool once, through the hosted door, on the reviewer's account (item 8)", () => {
  test("each listed tool answers; the record names the call, what came back, and the tool's annotations", async () => {
    const r = await open();
    const made = r.app.accounts.createReviewer({ email: "reviewer@example.com", days: 30 });
    assert.ok(!("refusal" in made));
    const c = await connect(r, { signIn: withCode("reviewer@example.com", made.code) });
    const listed = await rpc(`${r.origin}/mcp`, "tools/list", undefined, bearer(c.access));
    const tools = (listed.body["result"] as { tools: { name: string; annotations: Record<string, unknown> }[] }).tools;
    const bytes = Buffer.byteLength(JSON.stringify(listed.body["result"]), "utf8");
    const rows: string[] = [];
    const seen = new Set<string>();
    const run = async (name: string, args: Record<string, unknown>, summary: (out: Record<string, unknown>, text: string) => string): Promise<Record<string, unknown>> => {
      const a = await callTool(r, c.access, name, args);
      assert.equal(a.isError, false, `${name} ${JSON.stringify(args)}: ${a.text.slice(0, 400)}`);
      seen.add(name);
      const shown = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, k === "session" ? "<session>" : typeof v === "string" && v.length > 60 ? `${v.slice(0, 57)}...` : v]));
      const ann = tools.find((t) => t.name === name)?.annotations ?? {};
      rows.push(`| \`${name}\` | \`${JSON.stringify(shown).replaceAll("|", "\\|")}\` | ok: ${summary(a.out, a.text).replaceAll("|", "\\|").replaceAll("\n", " ")} | ${String(ann["readOnlyHint"])} / ${String(ann["destructiveHint"])} |`);
      return a.out;
    };
    const woke = await run("wake", {}, (_o, t) => `session id; ${String(t.match(/\d+ memories/)?.[0] ?? "?")}; Who I am, Coming up, Still open, last night`);
    const session = String(woke["session"]);
    const kept = await run("remember", { session, text: "Sam's reviewer asked to remember that the robotics club meets in room 114.", title: "Robotics club room", about: "owner", saidBy: "owner" }, (o) => `stored ${String(o["id"])}`);
    await run("recall", { session, question: "what did Sam decide about the kitchen budget?", mode: "facts" }, (_o, t) => (t.includes("18,000") ? "the $18,000 decision, with its date" : "answered"));
    await run("status", { session }, (o) => `${String(o["live"])} memories held`);
    await run("session_end", { session, memories: [{ content: "Sam prefers the science fair judges to be parents from another grade.", about: "owner", saidBy: "owner" }] }, (o) => `${String((o["stored"] as unknown[] | undefined)?.length ?? o["count"] ?? "1")} entry stored`);
    await run("chapter", { session, text: "A reviewer tried each tool on Sam's sample account.", title: "Trying every tool", about: "us" }, (o) => `chapter ${String(o["chapter"] ?? "1")} written`);
    await run("scope", { session }, (o) => `reads ${String(o["mode"])}`);
    await run("scope", { session, mode: "off" }, (o) => `set ${String(o["mode"] ?? "off")}`);
    await run("scope", { session, mode: "on" }, (o) => `set ${String(o["mode"] ?? "on")}`);
    await run("self_page", { session }, (o) => `version ${String(o["version"])}, ${String(o["bytes"] ?? "")} bytes`);
    await run("dream", { session, phase: "setting", value: "auto" }, (o) => `setting ${String(o["setting"] ?? o["value"] ?? "auto")}`);
    await run("reflect", { session, phase: "launch" }, (o) => (typeof o["prompt"] === "string" ? "the reflection's steps (a prompt)" : String(o["reason"] ?? "answered")));
    await run("meet", { session }, (o) => `the meeting's script; met: ${String((o["meet"] as string | undefined) ?? o["state"] ?? "done")}`);
    await run("recall", { session, ids: [String(kept["id"])] }, () => "the memory, read whole (shown, so it may be deleted)");
    await run("delete_memory", { session, id: String(kept["id"]) }, (o) => `${String(o["reason"])}: hidden now, erased after 24 hours`);
    await run("delete_memory", { session, id: String(kept["id"]), undo: true }, (o) => `${String(o["reason"])}: back as it was`);
    assert.deepEqual([...seen].sort(), tools.map((t) => t.name).sort(), "every listed tool was called");
    const out = process.env["DIR1_RECORD"];
    if (out !== undefined && out.length > 0) {
      const table = tools.map((t) => `| \`${t.name}\` | ${String(t.annotations["title"])} | ${String(t.annotations["readOnlyHint"])} | ${String(t.annotations["destructiveHint"])} | ${String(t.annotations["idempotentHint"])} | ${String(t.annotations["openWorldHint"])} |`);
      writeFileSync(
        out,
        [
          `Local hosted server (createApp, temp data root, http://127.0.0.1), reviewer account signed in by code, OAuth (DCR + PKCE) to a bearer token. tools/list: ${String(tools.length)} tools, ${String(bytes)} bytes.`,
          "",
          "| tool | title | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |",
          "|---|---|---|---|---|---|",
          ...table,
          "",
          "| tool | arguments | response | readOnly / destructive |",
          "|---|---|---|---|",
          ...rows,
          "",
        ].join("\n"),
      );
    }
  });
});
