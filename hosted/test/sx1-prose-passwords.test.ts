/**
 * SX1 ON A HOSTED TENANT (2026-11-09). A password said in a sentence, through
 * the real `/mcp` door over a socket, into a real tenant's store: the memory
 * and the note's raw line keep the sentence, and no file of the tenant's holds
 * the password. Hosted runs the same core, so the gate is the same one; this
 * proves the door.
 *
 * The local shape, and the Stop hook's capture, are in `test/sx1-raw-buffer.test.ts`.
 *
 * Hermetic: a temp root per test, removed after it.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { createHostedServer } from "../src/server.js";
import type { Caller } from "../src/server.js";
import { Tenants, tenantDir } from "../src/tenants.js";
import { listen, storeId, tempRoot, tool } from "./helpers.js";

const PASSWORD = "tigerlily7x";

let tmp: { root: string; remove: () => void };
const closers: (() => unknown)[] = [];

beforeEach(() => {
  tmp = tempRoot("sx1");
});

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
  tmp.remove();
});

/** Every file under `at` that holds `needle`, as bytes. */
function filesHolding(at: string, needle: string): string[] {
  const out: string[] = [];
  const bytes = Buffer.from(needle, "utf8");
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (readFileSync(p).includes(bytes)) out.push(p);
    }
  };
  if (existsSync(at)) walk(at);
  return out;
}

describe("a hosted tenant's remember", () => {
  test("a password named in a sentence is stripped from the memory and the raw line; the sentence stays", async () => {
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

    const out = await tool(
      url,
      "remember",
      { text: `Sam moved into the new flat this week. The wifi password's ${PASSWORD}, and the building's door code changes monthly.` },
      headers,
    );
    assert.equal(out["stored"], true);

    const home = tenantDir(tenants.root, caller.storeId);
    const storeDir = join(home, "store");
    const spans = join(storeDir, "spans");
    const lines: string[] = [];
    for (const key of readdirSync(spans)) {
      const file = join(spans, key, "jots.jsonl");
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (line.length > 0) lines.push((JSON.parse(line) as { text: string }).text);
      }
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /The wifi password's \[REDACTED:password\], and the building's door code/);

    const read = await tool(url, "recall", { question: "Sam's wifi password at the new flat", mode: "facts" }, headers);
    const text = JSON.stringify(read);
    assert.ok(text.includes("[REDACTED:password]"), "the memory says a password was there");
    assert.ok(!text.includes(PASSWORD));
    await tenants.closeAll();
    assert.deepEqual(filesHolding(home, PASSWORD), []);
  });
});
