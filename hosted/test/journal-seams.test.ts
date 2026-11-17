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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { CLAUDE_AI_NIGHT_SAID } from "../../src/adapters/mcp/server-words.js";
import { Counterpart } from "../../src/core/counterpart.js";
import { WAKE_SHAPE_KEY } from "../../src/core/counterpart-wake-shape.js";
import { PUBLISHED_WORDS } from "../../src/core/self/briefing-delivery.js";
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

describe("the morning share, as the product wants it (2026-11-13)", () => {
  test("shares and sharesPerWeek reach the store's config.json (the worker's night) and its own server: a reflection there offers no share", async () => {
    const r = await rig({ nights: "host", shares: "off", sharesPerWeek: 2 });
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-shares" });
    const storeId = signed.storeId!;
    await owed(r.app, storeId);
    const config = JSON.parse(readFileSync(join(tmp.root, "data", "tenants", storeId, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(config["shares"], "off");
    assert.equal(config["sharesPerWeek"], 2);

    const wake = await call(r.app, storeId, "wake", {});
    const session = String(wake.out["session"]);
    const begun = await call(r.app, storeId, "reflect", { phase: "begin", session });
    assert.equal(begun.isError, false, begun.text);
    const reflection = String(begun.out["reflection"]);
    const done = await call(r.app, storeId, "reflect", { phase: "finish", session, reflection, entry: "A short look back at the garden.", cites: ["m1"], share: { text: "The cold frame lid keeps sticking.", cites: ["m1"] } });
    assert.equal(done.isError, false, done.text);
    assert.deepEqual((done.out["share"] as Record<string, unknown>)["reason"], "host-off");
    const state = await r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.store.reflection(reflection)?.share_state);
    assert.equal(state, "none");
  });

  test("absent: nothing written to config.json, and the store's config reads as on", async () => {
    const r = await rig({});
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-shares-default" });
    await r.app.tenants.withTenant(signed.storeId!, {}, async () => undefined);
    const config = JSON.parse(readFileSync(join(tmp.root, "data", "tenants", signed.storeId!, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(config["shares"], undefined);
    assert.equal(config["sharesPerWeek"], undefined);
  });
});

describe("a host's evening session and its wakes (2026-11-16)", () => {
  const HOUR = 60 * 60 * 1000;

  /** The evening: a wake, a memory, then the store's clock past the 4-hour default (7 hours, ~03:00). */
  async function evening(r: Rig, value: string): Promise<{ storeId: string; session: string }> {
    const signed = r.app.accounts.signUpWithIdentity({ kind: "apple", value });
    const storeId = signed.storeId!;
    const wake = await call(r.app, storeId, "wake", {});
    assert.equal(wake.isError, false, wake.text);
    const session = String(wake.out["session"]);
    const kept = await call(r.app, storeId, "remember", { session, text: "Wren moved the seed swap to Saturday." });
    assert.equal(kept.isError, false, kept.text);
    r.storeClock.at += 7 * HOUR;
    return { storeId, session };
  }

  const close = (r: Rig, storeId: string, session: string): Promise<Answer> =>
    call(r.app, storeId, "session_end", { session, memories: [], handoff: "The seed swap moved to Saturday." });

  test("absent: a close naming the evening's session 7 hours on is refused session-not-live, as today", async () => {
    const r = await rig({ nights: "host" });
    const { storeId, session } = await evening(r, "invented-ttl-default");
    const ended = await close(r, storeId, session);
    assert.equal(ended.out["reason"], "session-not-live", ended.text);
  });

  test("sessionTtlMs: the same close 7 hours on is not refused", async () => {
    const r = await rig({ nights: "host", sessionTtlMs: 36 * HOUR });
    const { storeId, session } = await evening(r, "invented-ttl-long");
    const ended = await close(r, storeId, session);
    assert.equal(ended.isError, false, ended.text);
    assert.notEqual(ended.out["reason"], "session-not-live", ended.text);
    assert.equal(ended.out["sessionRefused"], undefined, ended.text);
  });

  /**
   * A bundle published as the worker child publishes one (its own counterpart,
   * a budget of its own), with the store's handle closed around it, so the
   * server that wakes next holds no budget it was not given.
   */
  async function published(r: Rig, storeId: string): Promise<void> {
    await r.app.tenants.withTenant(storeId, { timeZone: "UTC" }, async () => undefined);
    await r.app.tenants.closeAll();
    const worker = Counterpart.open({ dir: join(tmp.root, "data", "tenants", storeId, "store"), timeZone: "UTC", now: () => r.storeClock.at });
    try {
      const out = worker.refreshWake({ budgetBytes: 9_000, trigger: "run-end" });
      assert.equal(out.reason, "rendered");
    } finally {
      worker.close();
    }
  }

  const wakes = async (r: Rig, storeId: string): Promise<{ texts: string[]; assembled: number }> => {
    const texts = [(await call(r.app, storeId, "wake", {})).text, (await call(r.app, storeId, "wake", {})).text];
    // Composed for this moment: by the wake's shape (WK2) when it is on, by `assembleWake` when it is not.
    const assembled = await r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.events().filter((e) => e.name === "counterpart.wake.shaped" || e.name === "counterpart.wake.assembled").length);
    return { texts, assembled };
  };

  test("absent: no key in config.json, and both wakes are the bundle as published", async () => {
    const r = await rig({ nights: "host" });
    const storeId = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-budget-default" }).storeId!;
    await published(r, storeId);
    const config = JSON.parse(readFileSync(join(tmp.root, "data", "tenants", storeId, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(config["injectionBudgetBytes"], undefined);
    const { texts, assembled } = await wakes(r, storeId);
    for (const text of texts) assert.ok(text.includes(PUBLISHED_WORDS), text.slice(0, 400));
    assert.equal(assembled, 0);
  });

  test("wakeBudgetBytes: written to config.json, and every wake, the first one in the process too, is assembled at session start", async () => {
    const r = await rig({ nights: "host", wakeBudgetBytes: 9_000 });
    const storeId = r.app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-budget" }).storeId!;
    await published(r, storeId);
    const config = JSON.parse(readFileSync(join(tmp.root, "data", "tenants", storeId, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(config["injectionBudgetBytes"], 9_000);
    const { texts, assembled } = await wakes(r, storeId);
    for (const text of texts) assert.ok(!text.includes(PUBLISHED_WORDS), text.slice(0, 400));
    assert.equal(assembled, 2);
  });

  test("a bad number is refused at createApp", () => {
    for (const bad of [{ sessionTtlMs: 0 }, { wakeBudgetBytes: -1 }, { wakeBudgetBytes: Number.NaN }, { wakeBudgetBytes: 1 }, { wakeBudgetBytes: 9000.5 }]) {
      assert.throws(() =>
        createApp({ dataRoot: join(tmp.root, "bad"), publicOrigin: "http://127.0.0.1:1", mailer: memoryMailer(), embedder: null, spawner: () => ({ pid: 1 }), ...bad }),
      );
    }
  });
});

describe("a host that runs its own nights has no handoffs in its wakes (2026-11-16, finding 18)", () => {
  const HANDOFF = "The seed swap moved to Saturday; ask Wren about the trellis.";
  const HANDOFF_WORDS = ["No handoff here", "session_end's handoff field", "Handoff, ", "Last handoff", "Older handoffs", "Open here now"];

  /** A worker child's bundle, as the describe above publishes one. */
  async function published(r: Rig, storeId: string): Promise<void> {
    await r.app.tenants.withTenant(storeId, { timeZone: "UTC" }, async () => undefined);
    await r.app.tenants.closeAll();
    const worker = Counterpart.open({ dir: join(tmp.root, "data", "tenants", storeId, "store"), timeZone: "UTC", now: () => r.storeClock.at });
    try {
      assert.equal(worker.refreshWake({ budgetBytes: 9_000, trigger: "run-end" }).reason, "rendered");
    } finally {
      worker.close();
    }
  }

  /**
   * A close that leaves a handoff, a second chat left open, then a third chat's
   * wake: on the shaped road (`WAKE_SHAPE_KEY` on, said here though a
   * new store starts with it) or the assembled one (a published bundle, the shape
   * off), with a budget so it is composed now.
   * `ran`: how many times that road's ring event fired for the third wake.
   */
  async function third(extra: Partial<AppOptions>, value: string, road: "shaped" | "assembled"): Promise<{ text: string; ran: number }> {
    const r = await rig({ wakeBudgetBytes: 9_000, ...extra });
    const storeId = r.app.accounts.signUpWithIdentity({ kind: "apple", value }).storeId!;
    if (road === "assembled") await published(r, storeId);
    await r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.store.setMeta(WAKE_SHAPE_KEY, road === "shaped" ? "on" : "off"));
    const first = await call(r.app, storeId, "wake", {});
    const ended = await call(r.app, storeId, "session_end", { session: String(first.out["session"]), memories: [], handoff: HANDOFF });
    assert.equal(ended.isError, false, ended.text);
    assert.equal((await call(r.app, storeId, "wake", {})).isError, false);
    const name = road === "shaped" ? "counterpart.wake.shaped" : "counterpart.wake.assembled";
    const count = async (): Promise<number> => r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.events().filter((e) => e.name === name).length);
    const was = await count();
    const text = (await call(r.app, storeId, "wake", {})).text;
    return { text, ran: (await count()) - was };
  }

  test("shaped, default host: the handoff and Open here now are there", async () => {
    const { text, ran } = await third({}, "invented-shaped-default", "shaped");
    assert.equal(ran, 1);
    assert.match(text, /Handoff, [^\n]*recall sch_[0-9a-f]+/, text);
    assert.ok(text.includes("seed swap moved to Saturday"), text);
    assert.ok(text.includes("Open here now: session "), text);
  });

  test("shaped, nights: host: no handoff line and no Open here now; the wake is still there", async () => {
    const { text, ran } = await third({ nights: "host" }, "invented-shaped-host", "shaped");
    assert.equal(ran, 1);
    for (const w of HANDOFF_WORDS) assert.ok(!text.includes(w), `${w}\n${text}`);
    assert.doesNotMatch(text, /sch_[0-9a-f]+/, text);
    assert.ok(!text.includes("seed swap moved to Saturday"), text);
    assert.ok(text.includes("counterparts:wake"), text);
  });

  test("shaped, a fresh store: the default host says 'No handoff here'; nights: host doesn't, and keeps the section's other line", async () => {
    const fresh = async (extra: Partial<AppOptions>, value: string): Promise<string> => {
      const r = await rig({ wakeBudgetBytes: 9_000, ...extra });
      const storeId = r.app.accounts.signUpWithIdentity({ kind: "apple", value }).storeId!;
      await r.app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.store.setMeta(WAKE_SHAPE_KEY, "on"));
      return (await call(r.app, storeId, "wake", {})).text;
    };
    assert.ok((await fresh({}, "invented-fresh-default")).includes("No handoff here. Leave one with session_end's handoff field when you stop."));
    const text = await fresh({ nights: "host" }, "invented-fresh-host");
    for (const w of HANDOFF_WORDS) assert.ok(!text.includes(w), `${w}\n${text}`);
    // What's left of the section is what isn't a handoff's.
    assert.ok(text.includes("Where this folder stands:\nNothing here since yesterday.\n\n"), text);
  });

  test("assembled, default host: the handoff is there", async () => {
    const { text, ran } = await third({}, "invented-assembled-default", "assembled");
    assert.equal(ran, 1);
    assert.match(text, /sch_[0-9a-f]+/, text);
    assert.ok(text.includes("seed swap moved to Saturday"), text);
  });

  test("assembled, nights: host: no handoff", async () => {
    const { text, ran } = await third({ nights: "host" }, "invented-assembled-host", "assembled");
    assert.equal(ran, 1);
    assert.doesNotMatch(text, /sch_[0-9a-f]+/, text);
    assert.ok(!text.includes("seed swap moved to Saturday"), text);
    for (const w of HANDOFF_WORDS) assert.ok(!text.includes(w), `${w}\n${text}`);
  });
});
