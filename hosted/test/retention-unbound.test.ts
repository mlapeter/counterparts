/**
 * THE SHARED "mcp" BUCKET ON A HOSTED TENANT (2026-11-01). A `remember` that
 * names no live session, through the real `/mcp` door over a socket, into a
 * real tenant's store; then the real worker, in this process rather than the
 * child a `wake` would start, reading the tenant's own `config.json`. The clock
 * is `Date.now`, turned by the test, which the door and the worker both read.
 *
 * The local shape, and the edges, are in `test/retention-unbound.test.ts`.
 *
 * Hermetic: a temp root per test, removed after it.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { retentionClocks } from "../../src/adapters/config.js";
import type { AdapterConfig } from "../../src/adapters/config.js";
import { runOnce } from "../../src/adapters/claude-code/bin/runner.js";
import { UNBOUND_SESSION } from "../../src/core/types.js";
import { createHostedServer } from "../src/server.js";
import type { Caller } from "../src/server.js";
import { Tenants, tenantDir } from "../src/tenants.js";
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
});
