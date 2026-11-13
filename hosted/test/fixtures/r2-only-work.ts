/**
 * Run as a CHILD by `loop-hold.test.ts`: one object-store call (argv[2] names
 * the method) as the process's only work, its answer arriving through something
 * that holds nothing open. An unref'd timer stands in for whatever let go under
 * bun on Linux (the traces point at aws4fetch's WebCrypto signing). The call
 * must hold the process open itself and finish: prints `<method> done` and
 * exits 0. Without that, the loop ran empty mid-call and the process exited 0
 * having printed nothing.
 */
import { r2ObjectStore } from "../../src/egress.js";

const LIST = "<ListBucketResult><IsTruncated>false</IsTruncated><Key>keys/a</Key></ListBucketResult>";
const store = r2ObjectStore({
  endpoint: "https://r2.invalid",
  bucket: "bkt",
  accessKeyId: "test-id",
  secretAccessKey: "test-secret",
  fetchFn: (req) => new Promise<Response>((r) => setTimeout(() => r(new Response(new URL(req.url).searchParams.has("list-type") ? LIST : "the body", { status: 200 })), 200).unref()),
});
const calls: Record<string, () => Promise<unknown>> = {
  put: () => store.put("keys/a", "body"),
  get: () => store.get("keys/a"),
  delete: () => store.delete("keys/a"),
  list: () => store.list("keys/"),
  deletePrefix: () => store.deletePrefix("keys/"),
  readableWith: () => store.readableWith!("keys/a", Buffer.alloc(32).toString("base64")),
};
const method = process.argv[2] ?? "";
const call = calls[method];
if (call === undefined) throw new Error(`no such method: ${method}`);
// Not a top-level await: bun keeps a process alive for one, and main.ts's entry point isn't one.
void call().then((out) => process.stdout.write(`${method} done ${JSON.stringify(out ?? null)}\n`));
