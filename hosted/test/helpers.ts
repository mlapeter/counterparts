/**
 * Shared test helpers for the hosted package. Every test makes its own temp
 * root and removes it (CLAUDE.md: tests are hermetic); nothing here names a
 * real store or a home directory. Written for `node:test` so the same files
 * run under Node (production's runtime) and under `bun test`.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createTlsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { scriptArgs } from "../../src/adapters/runtime.js";

// THE GUARD, armed here: Node has no test/preload.ts.
process.env["COUNTERPARTS_REQUIRE_EXPLICIT_DIR"] = "1";

export function tempRoot(label: string): { root: string; remove: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `counterparts-hosted-${label}-`)));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

export async function listen(server: Server): Promise<{ base: string; close: () => Promise<void> }> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      }),
  };
}

let nextId = 1;

export interface RpcAnswer {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/** One JSON-RPC POST, as a real client sends it. */
export async function rpc(url: string, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<RpcAnswer> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params === undefined ? {} : { params }) }),
    // A server that never answers fails the test, never hangs the run.
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    body = { text };
  }
  return { status: res.status, body, headers: res.headers };
}

/** A tool call's structured result (throws when the call was not a 200 result). */
export async function tool(url: string, name: string, args: Record<string, unknown>, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const out = await rpc(url, "tools/call", { name, arguments: args }, headers);
  if (out.status !== 200) throw new Error(`tools/call ${name}: HTTP ${String(out.status)}`);
  const result = out.body["result"] as Record<string, unknown> | undefined;
  if (result === undefined) throw new Error(`tools/call ${name}: ${JSON.stringify(out.body)}`);
  return result["structuredContent"] as Record<string, unknown>;
}

/** A fresh store id (the accounts table's shape). */
export function storeId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A port the system says is free now (a random pick collides with another file's listener under Node's parallel runner). */
export async function freePort(): Promise<number> {
  const s = createNetServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// ── a local S3 that enforces SSE-C (OL2b; over https too since R5) ─────────────

export interface Stored {
  body: Buffer;
  /** The SSE-C key's MD5 it was put under, or null. */
  keyMd5: string | null;
}

export interface S3StandIn {
  /** `http://127.0.0.1:<port>`: for a server run in the test's own process. */
  readonly base: string;
  /** `https://127.0.0.1:<port>` over the SAME objects, or null without `tls`: for a spawned `main.ts serve`, whose R2_ENDPOINT must be https. */
  readonly tlsBase: string | null;
  /** The self-signed certificate's path: a spawned process's NODE_EXTRA_CA_CERTS. */
  readonly ca: string | null;
  readonly objects: Map<string, Stored>;
  /** A status to answer instead (a request failed on purpose), or null to serve it. Set and cleared by the test. */
  fault: ((req: { method: string; key: string; prefix: string | null }) => number | null) | null;
  close(): Promise<void>;
}

/**
 * A self-signed certificate for 127.0.0.1, made with the `openssl` on PATH
 * (macOS and the CI runners have it), valid a day. Nothing is committed.
 */
export function tlsCertificate(dir: string): { key: string; cert: string } {
  const own = mkdtempSync(join(dir, "tls-")); // two stand-ins in one test each get their own
  const key = join(own, "key.pem");
  const cert = join(own, "cert.pem");
  const args = ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"];
  const made = spawnSync("openssl", args, { encoding: "utf8", timeout: 30_000 });
  if (made.status !== 0) throw new Error(`openssl couldn't make the test certificate: ${String(made.stderr ?? made.error).slice(0, 300)}`);
  return { key, cert };
}

const xmlError = (code: string): string => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;

/**
 * Bucket `bkt` only: any other bucket answers 404 NoSuchBucket, as R2 does; a
 * missing object is 404 NoSuchKey. An object put under an SSE-C key is refused
 * to a GET without that key. With `tls`, the same objects are served over
 * https too, under a certificate made in `tls.dir`.
 */
export async function s3StandIn(opts: { tls?: { dir: string } } = {}): Promise<S3StandIn> {
  const objects = new Map<string, Stored>();
  let fault: S3StandIn["fault"] = null;
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://x");
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const sseKey = req.headers["x-amz-server-side-encryption-customer-key"];
    const keyMd5 = typeof sseKey === "string" ? createHash("md5").update(Buffer.from(sseKey, "base64")).digest("base64") : null;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (bucket !== "bkt") return void res.writeHead(404, { "content-type": "application/xml" }).end(xmlError("NoSuchBucket"));
      const listing = key.length === 0 && url.searchParams.get("list-type") === "2";
      const failed = fault?.({ method: req.method ?? "GET", key, prefix: listing ? (url.searchParams.get("prefix") ?? "") : null }) ?? null;
      if (failed !== null) return void res.writeHead(failed, { "content-type": "application/xml" }).end(xmlError("InternalError"));
      if (req.method === "PUT") {
        objects.set(key, { body: Buffer.concat(chunks), keyMd5 });
        return void res.writeHead(200).end();
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        return void res.writeHead(204).end();
      }
      if (listing) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        return void res.writeHead(200, { "content-type": "application/xml" }).end(`<ListBucketResult>${all.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
      }
      const v = objects.get(key);
      if (v === undefined) return void res.writeHead(404, { "content-type": "application/xml" }).end(xmlError("NoSuchKey"));
      // SSE-C, as S3 and R2 enforce it: the same key, or nothing.
      if (v.keyMd5 !== keyMd5) return void res.writeHead(400).end("InvalidRequest: the SSE-C key does not match");
      res.writeHead(200).end(v.body);
    });
  };
  const plain = await listen(createServer(handle));
  let tlsBase: string | null = null;
  let ca: string | null = null;
  let closeTls = async (): Promise<void> => undefined;
  if (opts.tls !== undefined) {
    const files = tlsCertificate(opts.tls.dir);
    const secure = createTlsServer({ key: readFileSync(files.key), cert: readFileSync(files.cert) }, handle);
    await new Promise<void>((r) => secure.listen(0, "127.0.0.1", () => r()));
    tlsBase = `https://127.0.0.1:${String((secure.address() as AddressInfo).port)}`;
    ca = files.cert;
    closeTls = () =>
      new Promise<void>((r) => {
        secure.close(() => r());
        secure.closeAllConnections?.();
      });
  }
  return {
    base: plain.base,
    tlsBase,
    ca,
    objects,
    get fault() {
      return fault;
    },
    set fault(f) {
      fault = f;
    },
    close: async () => {
      await plain.close();
      await closeTls();
    },
  };
}

// ── the entry point as a process ─────────────────────────────────────────────

export const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

export interface Spawned {
  /** It printed `serving`; false: it exited first (a refusal, `did not start`) or timed out. */
  readonly up: boolean;
  /** Its stderr so far. */
  stderr(): string;
  /** SIGTERM (when still running), then its whole stderr once it has exited. */
  stop(): Promise<string>;
}

/**
 * `main.ts serve` as its own process, under the runtime running the tests (bun
 * or Node), with exactly `env`: resolves when it says `serving` or exits.
 */
export async function spawnServe(env: Record<string, string>, ms = 30_000): Promise<Spawned> {
  // Its own process group, so whatever it leaves behind (a sidecar child that
  // inherited its stderr) is ended with it, and no test waits on a pipe forever.
  const child = spawn(process.execPath, [...scriptArgs(MAIN), "serve"], { env, stdio: ["ignore", "ignore", "pipe"], detached: true });
  let err = "";
  child.stderr!.on("data", (d: Buffer) => {
    err += d.toString("utf8");
  });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  const closed = new Promise<void>((r) => child.once("close", () => r()));
  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      /* gone */
    }
  };
  const settle = async (): Promise<string> => {
    killGroup("SIGKILL"); // after its exit: only what it left behind
    await Promise.race([closed, new Promise((r) => setTimeout(r, 2000))]);
    return err;
  };
  const serving = (): boolean => err.includes("[hosted] serving ");
  const up = await new Promise<boolean>((resolveUp) => {
    const t = setTimeout(() => {
      killGroup("SIGKILL"); // never left running behind a failed assertion
      resolveUp(false);
    }, ms);
    child.stderr!.on("data", () => {
      if (serving()) {
        clearTimeout(t);
        resolveUp(true);
      }
    });
    void exited.then(() => {
      clearTimeout(t);
      resolveUp(serving());
    });
  });
  return {
    up,
    stderr: () => err,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      const t = setTimeout(() => killGroup("SIGKILL"), 20_000);
      await exited;
      clearTimeout(t);
      return settle();
    },
  };
}
