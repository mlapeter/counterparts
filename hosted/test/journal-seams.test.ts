/**
 * JS1 (2026-11-13): two seams for a product built on hosted's `createApp`.
 *
 *   - Accounts by identity: `signUpWithIdentity` makes a person, an identity
 *     and a store once, answers the same person after, gives a pending delete
 *     back (never a second account), refuses `email`, and makes a new person
 *     after an erase; a web session started for that person works.
 *   - Who runs the night, and a new store's start: through `createApp` with
 *     `nights: "host"` and a `newStore` hook, a chat's `wake` on a day that
 *     owes a night carries no night line and claims nothing, a `dream` launch
 *     after it is not refused, and the hook (not hosted's starters) is what
 *     ran, before and after a reopen. The same day without the options does
 *     carry the line, so the "absent" is not vacuous.
 *
 * Hermetic: a temp root per test, removed after; a stub spawner (no worker
 * runs); no network, backups off; every word is invented.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { CLAUDE_AI_NIGHT_SAID } from "../../src/adapters/mcp/server-words.js";
import type { McpServer } from "../../src/adapters/mcp/index.js";
import { addDays } from "../../src/core/time.js";
import { TOLD_SURFACE_KEY } from "../../src/core/told.js";
import { Accounts } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import type { App, AppOptions } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("journal-seams");
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

describe("accounts by identity (JS1)", () => {
  test("sign up once, the same person after, a working session, a pending delete given back, a new person after an erase", () => {
    const clock = { at: Date.UTC(2026, 10, 13, 12) };
    const accounts = new Accounts({ path: join(tmp.root, "control", "accounts.sqlite"), now: () => clock.at });
    closers.push(() => accounts.close());
    const id = { kind: "apple", value: "sha256-of-an-invented-sub" };

    assert.equal(accounts.personByIdentity(id.kind, id.value), null);
    const first = accounts.signUpWithIdentity({ ...id, timeZone: "America/Denver" });
    assert.equal(first.created, true);
    assert.equal(first.state, "active");
    assert.ok(first.storeId !== null);
    assert.equal(accounts.personByIdentity(id.kind, id.value), first.personId);
    const p = accounts.person(first.personId);
    assert.equal(p?.storeId, first.storeId);
    assert.equal(p?.timeZone, "America/Denver");
    assert.equal(p?.email, null);
    // Audited as a sign-up, the kind as its detail; never the value.
    const audit = accounts.auditOf(first.personId);
    assert.ok(audit.some((a) => a.action === "signup" && a.detail === "apple"), JSON.stringify(audit));
    assert.ok(!JSON.stringify(audit).includes(id.value));
    // Spots are not read: hosted's default is 0 (closed), and the sign-up went through.
    assert.equal(accounts.spots().total, 0);

    const again = accounts.signUpWithIdentity(id);
    assert.deepEqual(again, { personId: first.personId, storeId: first.storeId, created: false, state: "active" });

    const token = accounts.startSession(first.personId);
    assert.equal(accounts.sessionPerson(token), first.personId);

    // The email link's kind is not this door's.
    assert.throws(() => accounts.signUpWithIdentity({ kind: "email", value: "someone@example.com" }));
    // Nor a spelling of it, nor a kind or value past the limits.
    assert.throws(() => accounts.signUpWithIdentity({ kind: "Email", value: "someone@example.com" }));
    assert.throws(() => accounts.signUpWithIdentity({ kind: "email ", value: "someone@example.com" }));
    assert.throws(() => accounts.signUpWithIdentity({ kind: "a".repeat(65), value: "x" }));
    assert.throws(() => accounts.signUpWithIdentity({ kind: "apple", value: "x".repeat(513) }));
    assert.throws(() => accounts.signUpWithIdentity({ kind: "apple", value: "" }));

    // A pending delete: the same person, no store to serve, a session only for the pending pages.
    assert.ok(accounts.markPendingDelete(first.personId) !== null);
    const pending = accounts.signUpWithIdentity(id);
    assert.deepEqual(pending, { personId: first.personId, storeId: null, created: false, state: "pending-delete" });
    const pendingToken = accounts.startSession(first.personId);
    assert.equal(accounts.sessionPerson(pendingToken), null);
    assert.equal(accounts.sessionPendingDelete(pendingToken), first.personId);

    // Erased: the identity went with the person, and the next sign-up is someone new.
    assert.equal(accounts.markDeleting(first.personId), true);
    assert.equal(accounts.signUpWithIdentity(id).state, "suspended");
    accounts.markDeleted(first.personId);
    assert.equal(accounts.personByIdentity(id.kind, id.value), null);
    const fresh = accounts.signUpWithIdentity(id);
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.personId, first.personId);
    assert.notEqual(fresh.storeId, first.storeId);
    assert.equal(accounts.sessionPerson(accounts.startSession(fresh.personId)), fresh.personId);
  });
});

interface Rig {
  app: App;
  storeClock: { at: number };
}

async function rig(extra: Partial<AppOptions>): Promise<Rig> {
  const storeClock = { at: Date.UTC(2026, 10, 13, 12) };
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: "http://127.0.0.1:1",
    mailer: memoryMailer(),
    embedder: null,
    spawner: () => ({ pid: 4242 }),
    storeClock: () => storeClock.at,
    ...extra,
  });
  closers.push(() => app.close());
  await app.start();
  return { app, storeClock };
}

interface Answer {
  isError: boolean;
  text: string;
  out: Record<string, unknown>;
}

async function call(app: App, storeId: string, name: string, args: Record<string, unknown>): Promise<Answer> {
  return app.tenants.withTenant(storeId, { timeZone: "UTC" }, (t, server) =>
    t.serial(async () => {
      const r = await server.call(name, args);
      const content = (r as { content?: { text?: string }[] }).content ?? [];
      return { isError: (r as { isError?: boolean }).isError === true, text: content[0]?.text ?? "", out: ((r as { structuredContent?: Record<string, unknown> }).structuredContent ?? {}) };
    }),
  );
}

/** A night owed today: ten lived days, the first meeting done, four lived memories nobody dreamed (as `first-chat-night.test.ts`). */
async function owed(app: App, storeId: string): Promise<string> {
  return app.tenants.withTenant(storeId, { timeZone: "UTC" }, async (_t, server) => {
    const c = server.counterpart;
    const today = c.store.today();
    c.store.setMeta("onboarding.meet", "done");
    for (let d = 10; d >= 1; d -= 1) c.store.advanceClock(addDays(today, -d));
    for (const body of ["The cold frame lid sticks in the morning damp.", "Wren talks plans through out loud first.", "The rain barrel overflows toward the shed.", "Wren wants the bean trellis taller this year."]) {
      const day = c.store.livedDay();
      c.store.put({ type: "memory", kind: "fact", body, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    }
    assert.equal(c.dreams.setSetting("auto", { by: "owner" }).ok, true);
    return today;
  });
}

const told = (text: string): boolean => text.includes(CLAUDE_AI_NIGHT_SAID) || text.includes("dreaming asks first");
const JOURNAL_STARTER = "The journal keeps every entry in its own words.";

describe("who runs the night, and how a new store starts (JS1)", () => {
  test("default: the same owed day's first wake carries the night line and claims the day", async () => {
    const r = await rig({});
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-default" });
    const today = await owed(r.app, signed.storeId!);
    const wake = await call(r.app, signed.storeId!, "wake", {});
    assert.equal(told(wake.text), true, wake.text.slice(-400));
    const row = await r.app.tenants.withTenant(signed.storeId!, {}, async (_t, s) => s.counterpart.store.dreamAsk(today));
    assert.ok(row !== undefined);
  });

  test("nights: host and a newStore hook: no night line, no claim, a later dream launch runs, and the hook's start stays", async () => {
    const ran: string[] = [];
    const newStore = (server: McpServer): void => {
      ran.push("journal");
      const store = server.counterpart.store;
      const day = store.livedDay();
      store.put({ type: "memory", kind: "fact", body: JOURNAL_STARTER, salience: { relevance: 0.5, emotional: 0, predictive: 0.5 }, physics: { birthDay: day, lastUsedDay: day } });
    };
    const r = await rig({ nights: "host", newStore });
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-journal" });
    assert.equal(signed.created, true);
    const storeId = signed.storeId!;
    const today = await owed(r.app, storeId);
    assert.deepEqual(ran, ["journal"]);

    const wake = await call(r.app, storeId, "wake", {});
    assert.equal(wake.isError, false);
    assert.equal(told(wake.text), false, wake.text.slice(-400));
    const session = String(wake.out["session"]);
    assert.ok(wake.text.includes(session));
    const row = await r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.store.dreamAsk(today));
    assert.equal(row, undefined, "an ordinary chat wake claims nothing when the host runs nights");

    // The host's own night: launch is not refused.
    const launch = await call(r.app, storeId, "dream", { phase: "launch", session });
    assert.equal(launch.isError, false, launch.text);
    assert.equal(launch.out["phase"], "launch");

    // The hook's start, not hosted's: no starter memories, no told surface, and the same after a reopen.
    const check = async (): Promise<void> =>
      r.app.tenants.withTenant(storeId, {}, async (_t, s) => {
        const store = s.counterpart.store;
        assert.deepEqual(store.toldIds(), []);
        assert.equal(store.getMeta(TOLD_SURFACE_KEY), undefined);
      });
    await check();
    await r.app.tenants.closeAll();
    await check();
    assert.deepEqual(ran, ["journal"], "the hook ran once, at the store's first open");
  });

  test("storeClock moves the store's day", async () => {
    const r = await rig({ nights: "host" });
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-clock" });
    const day = async (): Promise<string> => r.app.tenants.withTenant(signed.storeId!, { timeZone: "UTC" }, async (_t, s) => s.counterpart.store.today());
    const before = await day();
    r.storeClock.at += 2 * 24 * 60 * 60 * 1000;
    assert.equal(await day(), addDays(before, 2));
  });
});
