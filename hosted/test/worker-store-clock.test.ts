/**
 * The worker child on the store's clock (2026-11-16; journal findings 4, the
 * clock note). Under `storeClock` (a simulated month), the store's own server
 * dates the page by that clock, but the worker child a wake starts opened the
 * store on the system clock: its published wake said a page revised the day
 * before was "last revised … more than 14 days before this wake was composed".
 *
 * Real path: `createApp` with a store clock two months behind the system's, a
 * page revised on the store's yesterday, a `wake` through the tenant's server,
 * and the REAL worker child run from the plan the hosted pool hands it (the
 * pool's own env cut). The bundle it publishes is read back from the store.
 *
 * Hermetic: a temp root, removed after; no network, backups off; every word is invented.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { planSpawn, STORE_CLOCK_OFFSET_ENV } from "../../src/adapters/spawn.js";
import { BRIEFING_KEY } from "../../src/core/self/index.js";
import { addDays } from "../../src/core/time.js";
import { createApp } from "../src/app.js";
import { memoryMailer } from "../src/egress.js";
import { workerPool } from "../src/tenants.js";
import { tempRoot } from "./helpers.js";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];
beforeEach(() => {
  tmp = tempRoot("worker-store-clock");
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

const DAY = 24 * 60 * 60 * 1000;

describe("the worker child dates the store by the store's clock", () => {
  test("a page revised on the store's yesterday is not called more than 14 days old in the bundle the worker publishes", { timeout: 60_000 }, async () => {
    // Two months behind the system clock, at noon UTC.
    const start = Math.floor((Date.now() - 60 * DAY) / DAY) * DAY + 12 * 60 * 60 * 1000;
    const clock = { at: start };
    const exits: Promise<number | null>[] = [];
    const pool = workerPool({
      max: 1,
      run: (plan, env) => {
        const child = spawn(plan.command, [...plan.args], { stdio: "ignore", env, timeout: plan.timeoutMs });
        exits.push(new Promise((r) => child.once("exit", (code) => r(code))));
        return child;
      },
    });
    const app = createApp({
      dataRoot: join(tmp.root, "data"),
      publicOrigin: "http://127.0.0.1:1",
      mailer: memoryMailer(),
      embedder: null,
      spawner: pool,
      storeClock: () => clock.at,
    });
    closers.push(() => app.close());
    await app.start();
    const storeId = app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-worker-clock" }).storeId!;

    const revisedOn = await app.tenants.withTenant(storeId, { timeZone: "UTC" }, async (_t, s) => {
      s.counterpart.store.setMeta("onboarding.meet", "done");
      s.counterpart.revisePage("## Who I am here\n\nI keep Wren's garden notes and the seed swap dates.", { by: "owner", reason: "test" });
      return s.counterpart.self.page()?.revisedOn;
    });
    const storeToday = addDays(new Date(start).toISOString().slice(0, 10), 0);
    assert.equal(revisedOn, storeToday);

    // The next evening, on the store's clock.
    clock.at += DAY;
    await app.tenants.withTenant(storeId, { timeZone: "UTC" }, (t, s) => t.serial(() => s.call("wake", {})));
    assert.equal(exits.length, 1, "the wake started one worker child");
    assert.equal(await exits[0], 0);

    const bundle = await app.tenants.withTenant(storeId, {}, async (_t, s) => s.counterpart.store.getMeta(BRIEFING_KEY) ?? "");
    assert.ok(bundle.includes("Wren's garden notes"), bundle.slice(0, 600));
    assert.ok(!bundle.includes("more than"), bundle.slice(0, 1200));
    assert.ok(bundle.includes(`(Last revised ${storeToday}.)`), bundle.slice(0, 1200));
  });

  test("no storeClock: no offset reaches the child, and one exported in the caller's environment is dropped", async () => {
    const envs: Record<string, string>[] = [];
    const app = createApp({
      dataRoot: join(tmp.root, "data"),
      publicOrigin: "http://127.0.0.1:1",
      mailer: memoryMailer(),
      embedder: null,
      spawner: workerPool({ max: 1, run: (_p, env) => (envs.push(env), { pid: 7, once: () => undefined, kill: () => true }) as never }),
    });
    closers.push(() => app.close());
    await app.start();
    const storeId = app.accounts.signUpWithIdentity({ kind: "apple", value: "invented-no-clock" }).storeId!;
    process.env[STORE_CLOCK_OFFSET_ENV] = String(-60 * DAY);
    try {
      await app.tenants.withTenant(storeId, {}, (t, s) => t.serial(() => s.call("wake", {})));
    } finally {
      delete process.env[STORE_CLOCK_OFFSET_ENV];
    }
    assert.equal(envs.length, 1);
    assert.equal(envs[0]![STORE_CLOCK_OFFSET_ENV], undefined);
    const plan = planSpawn({ config: { dataDir: tmp.root }, command: "x", args: [], baseEnv: { [STORE_CLOCK_OFFSET_ENV]: "5" } });
    assert.equal(plan.env[STORE_CLOCK_OFFSET_ENV], undefined);
  });
});
