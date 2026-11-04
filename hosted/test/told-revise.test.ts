/**
 * THE ONE REVISION OF AN OLD STARTER SET (v1 → v2, HD1, 2026-11-04;
 * `src/core/told.ts#reviseTold`), on hosted.
 *
 * A person signed up before HD1 has starter #9 saying "one memory can't be
 * removed yet", which recall can hand the model: the opposite of the chat
 * delete. Each person's store here is put back to what 0.3.46's signup
 * planted (#1 and #9, and #2 in the second case, in v1's words, the meta `v1`), its handle closed, and
 * the next call over the real `/mcp` socket opens it again, as the first chat
 * after the deploy does. An unchanged #9 gets the new words; one the person
 * edited stays theirs.
 *
 * Hermetic: a temp data root per test, removed after it. No network, no
 * bucket (backups off), no live store.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import * as oauth from "oauth4webapi";

import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { TOLD_REVISE_REASON, TOLD_SET_KEY, toldSet } from "../../src/core/told.js";
import { freePort, tempRoot, tool } from "./helpers.js";

const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const insecure = { [oauth.allowInsecureRequests]: true } as const;

const TIPS = "Told: tips to offer once";
const NINE = "Told: seeing and changing what I keep";
/* 0.3.46's hosted words, copied from `git show v0.3.46:src/core/told.ts` (never built from told.ts). */
const V1_NINE = "Told, not lived: They ask me; one memory can't be removed yet, but a correction takes it out of what comes up.";
const V1_TIPS = [
  "Told, not lived: a few things people often don't know they can say. Offer one when it fits what they're doing. Don't list them all, and don't repeat one they've heard.",
  '- "Where did we leave off?" brings back our last conversation.',
  '- "Remember this" saves something on purpose, right now.',
  '- "How did X go?" or "what do you remember about Y?" asks my memory, not just this chat.',
  '- "Remind me Thursday to ...": I save it with the date and as a plain reminder, so it comes up that day, or the next time we talk.',
  '- "That\'s wrong" corrects a memory, and the wrong one stops coming up.',
  '- Nights run when they set up a nightly routine, or say "dream".',
].join("\n");

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("told-revise");
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
}

async function rig(): Promise<Rig> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const mail = memoryMailer();
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: origin,
    mailer: mail,
    embedder: null,
    spawner: () => ({ pid: 1 }),
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
  return { app, origin, mail };
}

/** Sign up through Allow and the token exchange: what claude.ai does. */
async function connect(r: Rig, email: string): Promise<{ access: string; storeId: string }> {
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
  return { access: tokens.access_token, storeId: r.app.accounts.person(personId)!.storeId! };
}

type TenantStore = NonNullable<Parameters<Parameters<App["tenants"]["withTenant"]>[2]>[1]>["counterpart"]["store"];

function inStore<T>(r: Rig, storeId: string, fn: (store: TenantStore) => T): Promise<T> {
  return r.app.tenants.withTenant(storeId, {}, (t, server) => t.serial(async () => fn(server.counterpart.store)));
}

function toldRow(store: TenantStore, title: string): NonNullable<ReturnType<TenantStore["row"]>> {
  const rows = store
    .toldIds()
    .map((id) => store.row(id)!)
    .filter((x) => x.title === title);
  assert.equal(rows.length, 1, title);
  return rows[0]!;
}

/** Put a person's store back to what 0.3.46's signup planted: #1 and #9 in v1's words, the meta `v1`. */
function asBeforeHd1(store: TenantStore, nine = V1_NINE): void {
  store.revise(toldRow(store, TIPS).id, { body: V1_TIPS, meta: { told: "v1" } });
  store.revise(toldRow(store, NINE).id, { body: nine, meta: { told: "v1" } });
  store.setMeta(TOLD_SET_KEY, "v1");
}

const v2 = (title: string): string => toldSet("hosted").find((m) => m.title === title)!.body;

describe("hosted: a person's existing store gets the new #1 and #9 once, at its next open, where still the words it was given", () => {
  test("an unchanged #9 gets the chat delete's words; an edited one stays; both stores say v2 after", async () => {
    const r = await rig();
    const url = `${r.origin}/mcp`;
    const plain = await connect(r, "plain@example.com");
    const edited = await connect(r, "edited@example.com");
    // Signed up today: the new words, already v2, nothing to revise.
    await tool(url, "wake", {}, bearer(plain.access));
    await tool(url, "wake", {}, bearer(edited.access));
    await inStore(r, plain.storeId, (s) => {
      assert.equal(s.getMeta(TOLD_SET_KEY), "v2");
      assert.equal(toldRow(s, NINE).body, v2(NINE));
    });

    const MINE = "Told, not lived: I'd rather fix a memory than delete it, so they ask me to correct it.";
    await inStore(r, plain.storeId, (s) => asBeforeHd1(s));
    await inStore(r, edited.storeId, (s) => asBeforeHd1(s, MINE));
    await inStore(r, plain.storeId, (s) => {
      assert.equal(toldRow(s, NINE).body, V1_NINE);
      assert.equal(s.getMeta(TOLD_SET_KEY), "v1");
    });
    // The deploy: every handle closes, and the next chat opens the store again.
    await r.app.tenants.close(plain.storeId);
    await r.app.tenants.close(edited.storeId);
    assert.equal(r.app.tenants.isOpen(plain.storeId), false);

    // The first chat after it, over /mcp: the recall that would have said "can't be removed" now says the delete.
    const woke = await tool(url, "wake", {}, bearer(plain.access));
    assert.equal(r.app.tenants.isOpen(plain.storeId), true);
    const asked = await tool(url, "recall", { session: String(woke["session"]), mode: "facts", query: "can one memory be deleted or removed" }, bearer(plain.access));
    assert.doesNotMatch(JSON.stringify(asked), /can.t be removed yet/);
    assert.match(JSON.stringify(asked), /delete one memory, and undo it within a day/);
    await tool(url, "wake", {}, bearer(edited.access));

    await inStore(r, plain.storeId, (s) => {
      assert.equal(s.getMeta(TOLD_SET_KEY), "v2");
      const nine = toldRow(s, NINE);
      assert.equal(nine.body, v2(NINE));
      assert.equal(nine.body, "Told, not lived: They ask me. They can ask me to delete one memory, and undo it within a day.");
      assert.equal(nine.source, "told");
      assert.equal(JSON.parse(nine.meta ?? "{}").told, "v2");
      assert.equal(s.versions(nine.id).at(-1)?.reason, TOLD_REVISE_REASON);
      assert.equal(s.versions(nine.id).at(-1)?.body, V1_NINE);
      const tips = toldRow(s, TIPS);
      assert.equal(tips.body, v2(TIPS));
      assert.match(tips.body, /"Delete that" removes one memory; "undo that" brings it back within a day\./);
    });
    await inStore(r, edited.storeId, (s) => {
      assert.equal(s.getMeta(TOLD_SET_KEY), "v2");
      assert.equal(toldRow(s, NINE).body, MINE);
      // Its #1 was still v1's words, so that one moved.
      assert.equal(toldRow(s, TIPS).body, v2(TIPS));
    });
  });
});

/* 0.3.46's hosted #2, copied from `git show v0.3.46:src/core/told.ts` (never built from told.ts). */
const HOW = "Told: how my memory works";
const V1_HOW = [
  "Told, not lived: I keep what something meant and how it went, in my own words, not a transcript. What isn't used fades, on purpose, so the important things stay easy to find. If I can't find something, I try other words before saying it's gone.",
  'When their nightly routine runs, or they say "dream", a night pass sorts the day the same way.',
  "The person owns all of it.",
  "It lives on Counterparts' server, with encrypted backups.",
].join(" ");

describe("hosted: an existing store's #2 gets HN1's nights words once, where still the words it was given", () => {
  test("an unchanged #2 says the day's first chat runs the night; an edited one stays", async () => {
    const r = await rig();
    const url = `${r.origin}/mcp`;
    const plain = await connect(r, "plain2@example.com");
    const edited = await connect(r, "edited2@example.com");
    await tool(url, "wake", {}, bearer(plain.access));
    await tool(url, "wake", {}, bearer(edited.access));

    const MINE = "Told, not lived: My nights run when they ask for one, and only then.";
    await inStore(r, plain.storeId, (s) => {
      asBeforeHd1(s);
      s.revise(toldRow(s, HOW).id, { body: V1_HOW, meta: { told: "v1" } });
    });
    await inStore(r, edited.storeId, (s) => {
      asBeforeHd1(s);
      s.revise(toldRow(s, HOW).id, { body: MINE, meta: { told: "v1" } });
    });
    await r.app.tenants.close(plain.storeId);
    await r.app.tenants.close(edited.storeId);

    await tool(url, "wake", {}, bearer(plain.access));
    await tool(url, "wake", {}, bearer(edited.access));

    await inStore(r, plain.storeId, (s) => {
      assert.equal(s.getMeta(TOLD_SET_KEY), "v2");
      const how = toldRow(s, HOW);
      assert.equal(how.body, v2(HOW));
      assert.match(how.body, /the next day's first chat runs a night pass before I answer/);
      assert.doesNotMatch(how.body, /When their nightly routine runs, or they say "dream"/);
      assert.equal(how.source, "told");
      assert.equal(JSON.parse(how.meta ?? "{}").told, "v2");
      assert.equal(s.versions(how.id).at(-1)?.reason, TOLD_REVISE_REASON);
      assert.equal(s.versions(how.id).at(-1)?.body, V1_HOW);
    });
    await inStore(r, edited.storeId, (s) => {
      assert.equal(s.getMeta(TOLD_SET_KEY), "v2");
      assert.equal(toldRow(s, HOW).body, MINE);
      // Its #1 and #9 were still v1's words, so those moved.
      assert.equal(toldRow(s, NINE).body, v2(NINE));
      assert.equal(toldRow(s, TIPS).body, v2(TIPS));
    });
  });
});
