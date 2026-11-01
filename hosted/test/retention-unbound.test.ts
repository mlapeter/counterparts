/**
 * THE SHARED "mcp" BUCKET ON A HOSTED TENANT (2026-11-01). A `remember` that
 * names no live session, through the real `/mcp` door over a socket, into a
 * real tenant's store; then the real worker, in this process rather than the
 * child a `wake` would start, reading the tenant's own `config.json`. The clock
 * is `Date.now`, turned by the test, which the door and the worker both read.
 * A second test starts the real child through a real `wake`, on lines aged on disk.
 *
 * The local shape, and the edges, are in `test/retention-unbound.test.ts`.
 *
 * Hermetic: a temp root per test, removed after it.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { retentionClocks } from "../../src/adapters/config.js";
import type { AdapterConfig } from "../../src/adapters/config.js";
import { runOnce } from "../../src/adapters/claude-code/bin/runner.js";
import { Counterpart } from "../../src/core/counterpart.js";
import { lastRetentionRun } from "../../src/core/remember/index.js";
import { UNBOUND_SESSION } from "../../src/core/types.js";
import { createHostedServer } from "../src/server.js";
import type { Caller } from "../src/server.js";
import { Tenants, tenantDir, workerPool } from "../src/tenants.js";
import { listen, storeId, tempRoot, tool } from "./helpers.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T15:00:00Z");
const realNow = Date.now;

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("unbound");
});

afterEach(async () => {
  Date.now = realNow;
  for (const c of closers.splice(0).reverse()) await c();
  tmp.remove();
});

const turnTo = (day: number): void => {
  Date.now = () => T0 + day * DAY;
};

const note = (day: number): string =>
  `Field note for day ${String(day)}: the survey of the north ridge counted ${String(day * 7 + 3)} nests and the weather held.`;

/** Every raw `"mcp"` line this tenant holds, in every folder its store files under. */
function rawCopies(storeDir: string): string[] {
  const spans = join(storeDir, "spans");
  if (!existsSync(spans)) return [];
  const out: string[] = [];
  for (const scope of readdirSync(spans)) {
    const file = join(spans, scope, "jots.jsonl");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const span = JSON.parse(line) as { session: string; text: string };
      if (span.session === UNBOUND_SESSION) out.push(span.text);
    }
  }
  return out;
}

describe("a tenant's notes with no live session", () => {
  test("a note every 2 days: day 0's raw copy goes on its own age, newer ones stay, the worker's clocks are the defaults", async () => {
    turnTo(0);
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: () => ({ pid: 4242 }) });
    closers.push(() => tenants.closeAll());
    const caller: Caller = { personId: "person-a", storeId: storeId(), timeZone: "America/Denver" };
    const token = randomBytes(24).toString("base64url");
    const server = createHostedServer({
      tenants,
      publicOrigin: "https://app.counterparts.ai",
      authenticate: (t) => Promise.resolve(t === token ? caller : null),
    });
    const running = await listen(server);
    closers.push(() => running.close());
    const url = `${running.base}/mcp`;
    const headers = { authorization: `Bearer ${token}` };

    const home = tenantDir(tenants.root, caller.storeId);
    const storeDir = join(home, "store");
    for (let day = 0; day <= 20; day += 2) {
      turnTo(day);
      const out = await tool(url, "remember", { text: note(day) }, headers);
      assert.equal(out["stored"], true);
      const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as AdapterConfig;
      if (day === 0) {
        assert.equal(config.dataDir, storeDir);
        assert.deepEqual(retentionClocks(config).maxDays, 14);
      }
      const run = await runOnce({ config: { ...config, snapshots: { dir: join(tmp.root, "snaps") } }, date: new Date(T0 + day * DAY).toISOString().slice(0, 10) });
      assert.equal(run.retention?.reason, "ran");
      if (day === 2) assert.deepEqual(rawCopies(storeDir), [note(0), note(2)]);
    }
    assert.deepEqual(rawCopies(storeDir), [note(18), note(20)]);
  });

  test("the child a real wake starts lets the old lines go, in that tenant's store only", async () => {
    // A real child cannot be handed a clock, so the lines are aged on disk instead.
    const pool = workerPool({ max: 2 });
    const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: pool });
    closers.push(() => tenants.closeAll());
    const mine: Caller = { personId: "person-a", storeId: storeId(), timeZone: "America/Denver" };
    const other: Caller = { personId: "person-b", storeId: storeId(), timeZone: "America/Denver" };
    const tokens = new Map([[randomBytes(24).toString("base64url"), mine], [randomBytes(24).toString("base64url"), other]]);
    const server = createHostedServer({
      tenants,
      publicOrigin: "https://app.counterparts.ai",
      authenticate: (t) => Promise.resolve(tokens.get(t) ?? null),
    });
    const running = await listen(server);
    closers.push(() => running.close());
    const url = `${running.base}/mcp`;
    const headersOf = (c: Caller): Record<string, string> => ({ authorization: `Bearer ${[...tokens].find(([, v]) => v === c)?.[0] as string}` });

    const ids = new Map<number, unknown>();
    for (const caller of [mine, other]) {
      for (const day of [0, 2, 16, 17]) {
        const out = await tool(url, "remember", { text: note(day) }, headersOf(caller));
        assert.equal(out["stored"], true);
        if (caller === mine) ids.set(day, out["id"]);
      }
    }
    const homeOf = (c: Caller): string => join(tenantDir(tenants.root, c.storeId), "store");
    const age = (dir: string): void => {
      for (const scope of readdirSync(join(dir, "spans"))) {
        const file = join(dir, "spans", scope, "jots.jsonl");
        if (!existsSync(file)) continue;
        const now = Date.now();
        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
        const aged = lines.map((l) => {
          const s = JSON.parse(l) as { text: string; at: number };
          const day = Number(/day (\d+)/.exec(s.text)?.[1]);
          return JSON.stringify({ ...s, at: now - (17 - day) * DAY });
        });
        writeFileSync(file, `${aged.join("\n")}\n`, "utf8");
      }
    };
    age(homeOf(mine));
    const otherBefore = rawCopies(homeOf(other));

    await tool(url, "wake", {}, headersOf(mine));
    for (let i = 0; i < 600 && (pool.running().length > 0 || pool.pending().length > 0); i++) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(pool.running(), []);

    // Day 0 and day 2 are past 14 and past 3: gone. Day 16 is 1 day old and day 17 is new: stayed.
    assert.deepEqual(rawCopies(homeOf(mine)), [note(16), note(17)]);
    assert.deepEqual(rawCopies(homeOf(other)), otherBefore);
    const c = Counterpart.open({ dir: homeOf(mine) });
    closers.push(() => c.close());
    assert.equal(lastRetentionRun(c.store)?.unboundLines, 2);
    // The memories were not touched: every one of the four reads back.
    for (const [day, id] of ids) assert.ok(JSON.stringify(await tool(url, "recall", { handle: id }, headersOf(mine))).includes(note(day)));
  });
});
