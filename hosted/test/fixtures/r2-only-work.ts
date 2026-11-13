/**
 * Run as a CHILD by `loop-hold.test.ts`: an object-store call as the process's
 * only work, its answer arriving through something that holds nothing open
 * (an unref'd timer stands in for a fetch or a WebCrypto sign that didn't keep
 * bun's event loop alive on Linux). The call must hold the process open itself
 * and finish: prints `got <body>` and exits 0. Without that, the loop ran empty
 * mid-call and the process exited 0 having printed nothing.
 */
import { r2ObjectStore } from "../../src/egress.js";

const store = r2ObjectStore({
  endpoint: "https://r2.invalid",
  bucket: "bkt",
  accessKeyId: "test-id",
  secretAccessKey: "test-secret",
  fetchFn: () => new Promise<Response>((r) => setTimeout(() => r(new Response("the body", { status: 200 })), 200).unref()),
});
// Not a top-level await: bun keeps a process alive for one of those, and main.ts's entry point isn't one.
void store.get("keys/a").then((body) => process.stdout.write(`got ${String(body)}\n`));
