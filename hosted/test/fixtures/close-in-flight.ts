/**
 * Run as a CHILD by `tenants.test.ts` (review 10-26): `Tenants.close()` raced
 * one request whose body is still arriving. Before the fix `close()` looped on
 * already-settled promises and the event loop never turned again, so this
 * process froze; run in-process, that would freeze the test runner with it,
 * timers included. The parent kills this child if it does not exit in time.
 *
 * Prints one JSON line: whether a timer fired while `close()` waited, the
 * request's status, and whether the store was closed at the end.
 */
import { request } from "node:http";
import { join } from "node:path";

import { createHostedServer } from "../../src/server.js";
import { Tenants } from "../../src/tenants.js";
import { listen, storeId, tempRoot } from "../helpers.js";

const tmp = tempRoot("close-in-flight");
const tenants = new Tenants({ root: join(tmp.root, "tenants"), embedder: null, spawner: () => ({ pid: undefined }) });
const id = storeId();
const server = createHostedServer({ tenants, publicOrigin: "http://127.0.0.1", authenticate: async () => ({ personId: "p", storeId: id }) });
const { base, close } = await listen(server);

const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
const half = Math.floor(body.length / 2);
const req = request(`${base}/mcp`, {
  method: "POST",
  headers: { authorization: `Bearer ${"t".repeat(32)}`, "content-type": "application/json", "content-length": String(body.length) },
});
const status = new Promise<number>((resolve) => {
  req.on("response", (res) => {
    res.resume();
    res.on("end", () => resolve(res.statusCode ?? 0));
  });
  req.on("error", () => resolve(-1));
});
req.flushHeaders();
req.write(body.slice(0, half));
for (let i = 0; i < 100 && !tenants.isOpen(id); i++) await new Promise((r) => setTimeout(r, 10));
const openBefore = tenants.isOpen(id);

let ticked = false;
setTimeout(() => {
  ticked = true;
  req.end(body.slice(half));
}, 50);
await tenants.close(id);
const got = await status;
console.log(JSON.stringify({ openBefore, ticked, status: got, openAfter: tenants.isOpen(id) }));
await close();
tmp.remove();
