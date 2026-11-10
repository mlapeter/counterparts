/**
 * AN ERROR THAT BECOMES A 500 IS TOLD, BY TYPE AND PLACE, NEVER BY MESSAGE (2026-11-02). claude.ai got a 500
 * from `/mcp` after a sign-in and the container log said nothing: both catch-alls swallowed the error. Now
 * each is told to `onError` once, and `errorLine` keeps its type, code and code locations only.
 *
 * Through the real door over a socket, with a stand-in for the tenants (the store open is what throws).
 * Hermetic: no store, no files.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, test } from "node:test";

import { errorLine, createHostedServer } from "../src/server.js";
import type { Caller, ErrorWhere } from "../src/server.js";
import type { Tenants } from "../src/tenants.js";
import { callLine } from "../src/main.js";
import { listen, rpc, storeId } from "./helpers.js";
import { StoreError } from "../../src/core/store/errors.js";

const SECRET = "what Mike wrote /data/tenants/0123abcd/store/counterparts.sqlite";

const closers: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

type Told = { where: ErrorWhere; store: string | null; line: string };

async function door(withTenant: Tenants["withTenant"]): Promise<{ url: string; headers: Record<string, string>; told: Told[] }> {
  const caller: Caller = { personId: "person-a", storeId: storeId() };
  const token = randomBytes(24).toString("base64url");
  const told: Told[] = [];
  const tenants = { withTenant, isLocked: () => false } as unknown as Tenants;
  const server = createHostedServer({
    tenants,
    publicOrigin: "https://app.counterparts.ai",
    authenticate: (t) => Promise.resolve(t === token ? caller : null),
    onError: (where, store, err) => told.push({ where, store, line: errorLine(where, store, err) }),
  });
  const running = await listen(server);
  closers.push(() => running.close());
  return { url: `${running.base}/mcp`, headers: { authorization: `Bearer ${token}` }, told };
}

describe("errors that become a 500", () => {
  test("errorLine: type, code and app paths; never the message", () => {
    const err = Object.assign(new TypeError(SECRET), { code: "SQLITE_CORRUPT" });
    err.stack = `TypeError: ${SECRET}\n    at Store.open (/app/src/core/store/index.ts:120:9)\n    at async Tenants.withTenant (/app/hosted/src/tenants.ts:310:5)\n    at /app/node_modules/oidc-provider/lib/x.js:1:2\n    at file:///private/var/folders/xy/T/thing.js:5:1`;
    const line = errorLine("tenant", "abcd1234abcd1234", err);
    assert.equal(
      line,
      "[hosted] error where=tenant store=abcd1234abcd1234 name=TypeError code=SQLITE_CORRUPT at=Store.open@src/core/store/index.ts:120 < Tenants.withTenant@hosted/src/tenants.ts:310 < node_modules/oidc-provider/lib/x.js:1 < thing.js:5\n",
    );
    assert.ok(!line.includes("Mike") && !line.includes("0123abcd"));
    // A code that isn't a short constant is left out, and a thrown non-error still gives a line.
    assert.equal(errorLine("route", null, Object.assign(new Error("x"), { code: SECRET, stack: "" })), "[hosted] error where=route name=Error at=?\n");
    assert.equal(errorLine("door", null, SECRET), "[hosted] error where=door name=string at=?\n");
  });

  test("errorLine: a message line shaped like a frame is never read as one; sqlite's errcode and a syscall are kept", () => {
    const message = `first line\n    at Mike.wrote (/data/tenants/0123abcd/what-he-said.ts:1:2)`;
    const err = Object.assign(new Error(message), { code: "ERR_SQLITE_ERROR", errcode: 11, syscall: "open" });
    err.stack = `Error: ${message}\n    at Store.open (/app/src/core/store/index.ts:120:9)`;
    const line = errorLine("tenant", null, err);
    assert.equal(line, "[hosted] error where=tenant name=Error code=ERR_SQLITE_ERROR errcode=11 syscall=open at=Store.open@src/core/store/index.ts:120\n");
    assert.ok(!line.includes("Mike") && !line.includes("what-he-said"));
  });

  test("errorLine: a store refused for an unclassified name says which name (a file the host wrote), and only that code does", () => {
    const err = new StoreError("LAYOUT_UNCLASSIFIED", { name: ".counterparts.sqlite-litestream" });
    err.stack = "StoreError: x\n    at assertLayoutClassified (/app/src/core/store/paths.ts:374:13)";
    assert.equal(errorLine("tenant", null, err), "[hosted] error where=tenant name=StoreError code=LAYOUT_UNCLASSIFIED entry=.counterparts.sqlite-litestream at=assertLayoutClassified@src/core/store/paths.ts:374\n");
    const odd = Object.assign(new StoreError("LAYOUT_UNCLASSIFIED", { name: `${SECRET} /x` }), { stack: "" });
    assert.equal(errorLine("tenant", null, odd), "[hosted] error where=tenant name=StoreError code=LAYOUT_UNCLASSIFIED entry=? at=?\n");
    const other = Object.assign(new StoreError("DB_CLOSED", { name: "kept-out" }), { stack: "" });
    assert.ok(!errorLine("tenant", null, other).includes("kept-out"));
  });

  test("the store's open throws: 500, told once as `tenant` with the store tag, no message", async () => {
    const d = await door(() => Promise.reject(new Error(SECRET)));
    const out = await rpc(d.url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, d.headers);
    assert.equal(out.status, 500);
    assert.equal(d.told.length, 1);
    assert.equal(d.told[0]?.where, "tenant");
    assert.match(d.told[0]?.store ?? "", /^[0-9a-f]{16}$/);
    assert.match(d.told[0]?.line ?? "", /name=Error at=.*error-log\.test\.ts:\d+/);
    assert.ok(!(d.told[0]?.line ?? "").includes("Mike"));
  });

  test("a method throws: the JSON-RPC internal error, told as `call`", async () => {
    const d = await door(async (_id, _opts, fn) => {
      const server = { handle: () => Promise.reject(new RangeError(SECRET)) };
      return fn({ serial: (c: () => Promise<unknown>) => c(), server } as never, {} as never);
    });
    const out = await rpc(d.url, "tools/list", {}, d.headers);
    assert.equal(out.status, 200);
    assert.ok((out.body["error"] as { message: string }).message.startsWith("internal error:"));
    assert.deepEqual(d.told.map((t) => t.where), ["call"]);
    assert.match(d.told[0]?.line ?? "", /name=RangeError/);
    assert.ok(!(d.told[0]?.line ?? "").includes("Mike"));
  });

  test("callLine: ids and codes, the client quoted", () => {
    const line = callLine({ at: "2026-11-02T22:26:49.000Z", method: "initialize", connection: "0f1e2d3c-aaaa-bbbb-cccc-111122223333", ok: true, ms: 12.4, client: "claude-ai web", clientVersion: "0.1.0", protocolVersion: "2025-06-18", store: "abcd1234abcd1234" });
    assert.equal(line, '[hosted] mcp store=abcd1234abcd1234 method=initialize ok=true ms=12 conn=0f1e2d3c client="claude-ai web" clientVersion="0.1.0" protocol=2025-06-18\n');
  });
});
