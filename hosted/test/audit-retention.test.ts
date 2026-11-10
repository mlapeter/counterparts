/**
 * AR1 (Mike, 2026-11-10): THE 12-MONTH LIMIT on account events and on a deleted
 * account's tombstone. Audit rows older than 365 days are erased; a deleted
 * account, 365 days after its erase, loses its audit rows, its person and store
 * tombstone rows and the bucket's `deleted/<storeId>` marker — only once
 * uploads are proven landing and the bucket holds nothing of the store
 * (CONTRACT §31c).
 *
 * Through the real paths: sign-up by the accounts' own link (the page's door),
 * the app's own delete (`deleteAccount`, what "delete everything now" runs), the
 * app's own upload watch, its retention pass and its timer, and a restart on the
 * same volume and bucket. The clock is injected and moved past 365 days. R2 is
 * an in-memory object store; the sidecar is a stub.
 *
 * Hermetic: a temp data root per test, removed after it. No network.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { RETENTION_DAYS, RETENTION_MS } from "../src/accounts.js";
import { createApp } from "../src/app.js";
import type { App } from "../src/app.js";
import { keyObject, replicaPrefix, tombstoneObject } from "../src/backup.js";
import { memoryMailer, memoryObjectStore } from "../src/egress.js";
import type { ObjectStore } from "../src/egress.js";
import { EnvKeyWrapper } from "../src/keys.js";
import { tenantDir } from "../src/tenants.js";
import { openDb } from "../../src/core/store/db.js";
import { RECOVERY, tempRoot } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-10T12:00:00Z");

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("retention");
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

interface Rig {
  app: App;
  clock: { at: number };
  objects: ReturnType<typeof memoryObjectStore>;
  wrapper: EnvKeyWrapper;
  txid: { n: number };
}

/** One app on the data root. Pass `objects`, `wrapper`, `clock` and `txid` from an earlier rig to restart on the same volume and bucket. */
async function rig(o: { backups?: boolean; clock?: { at: number }; objects?: ReturnType<typeof memoryObjectStore>; store?: ObjectStore; wrapper?: EnvKeyWrapper; finishEveryMs?: number; txid?: { n: number } } = {}): Promise<Rig> {
  const objects = o.objects ?? memoryObjectStore();
  const wrapper = o.wrapper ?? new EnvKeyWrapper(new Map([["v1", randomBytes(32)]]), "v1");
  const clock = o.clock ?? { at: T0 };
  const app = createApp({
    dataRoot: join(tmp.root, "data"),
    publicOrigin: "http://127.0.0.1:1",
    mailer: memoryMailer(),
    embedder: null,
    spawner: () => ({ pid: 1 }),
    now: () => clock.at,
    finishEveryMs: o.finishEveryMs ?? 60 * 60 * 1000,
    ...(o.backups === false
      ? {}
      : {
          backup: {
            wrapper,
            sealer: RECOVERY.sealer,
            objects: o.store ?? objects,
            bucket: "bkt",
            endpoint: "https://acct.r2.cloudflarestorage.com",
            sidecar: { reload: () => undefined, stop: async () => undefined },
          },
        }),
  });
  closers.push(() => app.close());
  return { app, clock, objects, wrapper, txid: o.txid ?? { n: 0 } };
}

/** A person signed up through the accounts' own link (an invite, a click in the same browser), their store backed up as the page's sign-up does. */
async function signUp(r: Rig, email: string): Promise<{ personId: string; storeId: string }> {
  const a = r.app.accounts;
  const { code } = a.createInvite();
  const link = a.requestLink({ email, inviteCode: code, browser: "browser-1" });
  assert.ok(link.send);
  const used = a.useLink({ token: link.token, browser: "browser-1" });
  assert.ok(used.ok);
  const storeId = a.person(used.personId)!.storeId!;
  await r.app.backups?.ensureStore(storeId);
  await r.app.tenants.withTenant(storeId, {}, async () => undefined);
  if (r.app.backups !== null) for (const n of [1, 2]) await r.objects.put(`${replicaPrefix(storeId)}ltx/0/${String(n)}.ltx`, "ciphertext");
  return { personId: used.personId, storeId };
}

/** The sidecar's uploads of the accounts database landing, as the upload watch sees them: two looks, each after a new LTX. */
async function uploadsLand(r: Rig): Promise<void> {
  const prefix = r.app.backups!.controlPrefix("accounts.sqlite");
  for (let i = 0; i < 3; i++) {
    r.txid.n += 1;
    await r.objects.put(`${prefix}0000/${"1".padStart(16, "0")}-${r.txid.n.toString(16).padStart(16, "0")}.ltx`, "ciphertext");
    await r.app.lookAtUploads();
  }
}

/** Every audit row naming this person or this store, read from the accounts database itself. */
function auditRows(personId: string, storeId: string): number {
  const db = openDb(join(tmp.root, "data", "control", "accounts.sqlite"));
  try {
    return db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE person_id = ? OR store_id = ?", personId, storeId)?.n ?? 0;
  } finally {
    db.close();
  }
}

/** Nothing of the store in the bucket: no key object, no replica, no marker. */
function bucketHasNothingOf(r: Rig, storeId: string): void {
  const left = [...r.objects.objects.keys()].filter((k) => k.includes(storeId));
  assert.deepEqual(left, [], "nothing in the bucket names the store");
}

describe("AR1: account events, kept 365 days", () => {
  test("the limit is 365 days, named", () => {
    assert.equal(RETENTION_DAYS, 365);
    assert.equal(RETENTION_MS, 365 * DAY);
  });

  test("audit rows older than 365 days go, a live account's recent ones stay, and the account is untouched", async () => {
    const r = await rig();
    await r.app.start();
    const me = await signUp(r, "live@example.com");
    const before = r.app.accounts.auditOf(me.personId).map((a) => a.action);
    assert.ok(before.includes("signup"));
    r.clock.at = T0 + 200 * DAY;
    assert.ok(r.app.accounts.setTimeZone(me.personId, "Europe/Paris"));

    r.clock.at = T0 + 364 * DAY;
    assert.equal((await r.app.pruneRetention()).audit, 0, "nothing is 365 days old yet");
    assert.deepEqual(r.app.accounts.auditOf(me.personId).map((a) => a.action), [...before, "timezone.set"]);

    r.clock.at = T0 + 366 * DAY;
    const report = await r.app.pruneRetention();
    assert.ok(report.audit >= before.length, "the sign-up's rows went");
    assert.deepEqual(r.app.accounts.auditOf(me.personId).map((a) => a.action), ["timezone.set"], "the 200-day-old row stays");
    const p = r.app.accounts.person(me.personId)!;
    assert.equal(p.state, "active");
    assert.equal(p.email, "live@example.com");
    assert.equal(p.storeId, me.storeId);
    assert.equal(report.forgotten, 0);
  });
});

describe("AR1: a deleted account's tombstone, kept 365 days after the erase", () => {
  test("kept at 364 days; at 366 its rows, its audit and its marker go; a restart after brings nothing back", async () => {
    const r = await rig();
    await r.app.start();
    const gone = await signUp(r, "gone@example.com");
    const stays = await signUp(r, "stays@example.com");
    await r.app.deleteAccount(gone.personId);
    assert.equal(r.app.accounts.person(gone.personId)!.state, "deleted");
    assert.ok(r.objects.objects.has(tombstoneObject(gone.storeId)), "the marker, from the delete");
    assert.equal(r.objects.objects.has(keyObject(gone.storeId)), false);

    // 364 days: everything of the tombstone stays, uploads landing or not.
    r.clock.at = T0 + 364 * DAY;
    await uploadsLand(r);
    let report = await r.app.pruneRetention();
    assert.deepEqual([report.forgotten, report.waiting], [0, 0]);
    assert.ok(r.objects.objects.has(tombstoneObject(gone.storeId)));
    assert.equal(r.app.accounts.person(gone.personId)!.state, "deleted");
    assert.ok(r.app.accounts.deletedStoreIds().includes(gone.storeId));
    assert.ok(auditRows(gone.personId, gone.storeId) > 0);

    // 366 days, and no upload seen since the clock moved (stale): not proven, so it waits.
    r.clock.at = T0 + 366 * DAY;
    report = await r.app.pruneRetention();
    assert.deepEqual([report.forgotten, report.waiting], [0, 1]);
    assert.ok(r.objects.objects.has(tombstoneObject(gone.storeId)), "the marker stays while uploads aren't proven");
    assert.equal(r.app.accounts.person(gone.personId)!.state, "deleted");
    assert.ok(auditRows(gone.personId, gone.storeId) > 0, "the delete's own rows stay with the tombstone");

    // Uploads land: forgotten.
    await uploadsLand(r);
    report = await r.app.pruneRetention();
    assert.deepEqual([report.forgotten, report.waiting], [1, 0]);
    assert.equal(r.app.accounts.person(gone.personId), null, "no person tombstone");
    assert.equal(r.app.accounts.personOfStore(gone.storeId), null, "no store tombstone");
    assert.equal(r.app.accounts.deletedStoreIds().includes(gone.storeId), false);
    assert.equal(auditRows(gone.personId, gone.storeId), 0, "no audit row names it");
    bucketHasNothingOf(r, gone.storeId);
    // The other account is as it was.
    assert.equal(r.app.accounts.person(stays.personId)!.state, "active");
    assert.ok(r.objects.objects.has(keyObject(stays.storeId)));

    // A restart on the same volume and bucket: starts, finishes nothing, restores nothing, mints nothing for it.
    await r.app.close();
    const again = await rig({ objects: r.objects, wrapper: r.wrapper, clock: r.clock, txid: r.txid });
    const started = await again.app.start();
    assert.equal(started.tombstoned, 0);
    assert.equal(started.leftovers, 0);
    assert.equal(started.needsRestore, 0);
    assert.equal(started.restoreFailed, 0);
    assert.equal(again.app.accounts.person(gone.personId), null);
    assert.equal(again.app.accounts.liveStoreIds().includes(gone.storeId), false);
    assert.equal(existsSync(tenantDir(again.app.tenants.root, gone.storeId)), false);
    assert.equal(again.app.keys!.wrapped(gone.storeId), null);
    assert.doesNotMatch(readFileSync(again.app.backups!.configPath, "utf8"), new RegExp(gone.storeId));
    bucketHasNothingOf(again, gone.storeId);
    assert.equal(again.app.accounts.person(stays.personId)!.storeId, stays.storeId);
  });

  test("leftovers in the bucket: erased first, then forgotten; with R2 down, nothing is forgotten and the marker stays", async () => {
    const objects = memoryObjectStore();
    const down = { on: false };
    const store: ObjectStore = {
      put: (k, b) => objects.put(k, b),
      get: (k) => objects.get(k),
      delete: async (k) => {
        if (down.on) throw new Error("R2 answered 503");
        return objects.delete(k);
      },
      list: async (p) => {
        if (down.on) throw new Error("R2 answered 503");
        return objects.list(p);
      },
      deletePrefix: async (p) => {
        if (down.on) throw new Error("R2 answered 503");
        return objects.deletePrefix(p);
      },
    };
    const r = await rig({ objects, store });
    await r.app.start();
    const gone = await signUp(r, "leftover@example.com");
    await r.app.deleteAccount(gone.personId);
    // Something of the store landed after the delete (a stray object): the prune must not forget a store the bucket still holds.
    await objects.put(`${replicaPrefix(gone.storeId)}ltx/0/9.ltx`, "ciphertext");

    r.clock.at = T0 + 366 * DAY;
    await uploadsLand(r);
    down.on = true;
    let report = await r.app.pruneRetention();
    assert.deepEqual([report.forgotten, report.waiting], [0, 1]);
    assert.ok(objects.objects.has(tombstoneObject(gone.storeId)));
    assert.equal(r.app.accounts.person(gone.personId)!.state, "deleted");

    down.on = false;
    report = await r.app.pruneRetention();
    assert.deepEqual([report.forgotten, report.waiting], [1, 0]);
    assert.equal(r.app.accounts.person(gone.personId), null);
    bucketHasNothingOf(r, gone.storeId);
  });

  test("backups off: old audit rows still go, and tombstones wait (no bucket to prove anything against)", async () => {
    const r = await rig({ backups: false });
    await r.app.start();
    const gone = await signUp(r, "nobackups@example.com");
    await r.app.deleteAccount(gone.personId);
    r.clock.at = T0 + 366 * DAY;
    const report = await r.app.pruneRetention();
    assert.ok(report.audit > 0);
    assert.deepEqual([report.forgotten, report.waiting], [0, 1]);
    assert.equal(r.app.accounts.person(gone.personId)!.state, "deleted");
  });

  test("the timer runs it: a deleted account past 365 days is forgotten while serving", async () => {
    const r = await rig({ finishEveryMs: 15 });
    await r.app.start();
    const gone = await signUp(r, "timer@example.com");
    await r.app.deleteAccount(gone.personId);
    r.clock.at = T0 + 366 * DAY;
    await uploadsLand(r);
    const end = Date.now() + 5000;
    while (r.app.accounts.person(gone.personId) !== null) {
      if (Date.now() > end) throw new Error("timed out waiting for the timer's retention pass");
      await new Promise((res) => setTimeout(res, 10));
    }
    bucketHasNothingOf(r, gone.storeId);
  });
});
